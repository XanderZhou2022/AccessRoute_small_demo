import { it, expect } from 'vitest';
import request from 'supertest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createApp } from '../../backend/app';
import { ctx, scene, close } from '../fixtures';
it('health, scenes and route API return actual contracts', async () => {
  const app = createApp();
  await request(app).get('/api/health').expect(200);
  const list = await request(app).get('/api/scenes').expect(200);
  expect(list.body).toHaveLength(2);
  const s = scene('hysan-place');
  const r = await request(app)
    .post('/api/route')
    .send({
      sceneId: s.manifest.sceneId,
      from: s.manifest.defaultStart,
      to: s.manifest.defaultEnd,
      context: ctx,
    })
    .expect(200);
  expect(r.body.route.status).toBe('ok');
  expect(r.body.segments.map((s: any) => s.type)).toEqual([
    'floor',
    'transition',
    'floor',
    'outdoor',
  ]);
});
it('validates input and unknown scene', async () => {
  const app = createApp();
  await request(app).post('/api/route').send({ bad: 1 }).expect(400);
  await request(app).get('/api/scenes/not-found').expect(404);
  await request(app).get('/api/not-found').expect(404);
});
it('writes are disabled by default and foreign origin is rejected', async () => {
  await request(createApp()).post('/api/events').send(close('lift-a')).expect(403);
  await request(createApp({ allowWrites: true }))
    .post('/api/events')
    .set('Origin', 'https://other.example')
    .send(close('lift-a'))
    .expect(403);
});
it('events survive backend restart and change routing', async () => {
  const dir = await mkdtemp(tmpdir() + '/accessroute-test-'),
    eventFile = dir + '/events.json',
    app = createApp({ eventFile, allowWrites: true }),
    s = scene('hysan-place');
  await request(app).post('/api/events').send(close(s.graph.facilities[0].id)).expect(201);
  const second = createApp({ eventFile });
  const events = await request(second).get('/api/events').expect(200);
  expect(events.body).toHaveLength(1);
  expect(JSON.parse(await readFile(eventFile, 'utf8'))).toHaveLength(1);
});
it('concurrent event writes preserve both events', async () => {
  const dir = await mkdtemp(tmpdir() + '/accessroute-test-'),
    app = createApp({ eventFile: dir + '/events.json', allowWrites: true });
  await Promise.all([
    request(app).post('/api/events').send(close('lift-a')).expect(201),
    request(app).post('/api/events').send(close('lift-b')).expect(201),
  ]);
  const r = await request(app).get('/api/events');
  expect(r.body).toHaveLength(2);
});
