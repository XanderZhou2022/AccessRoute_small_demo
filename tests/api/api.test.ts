import { it, expect } from 'vitest';
import request from 'supertest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createApp } from '../../backend/app';
import { ctx, scene, close } from '../fixtures';
import { route } from '../../shared/routing/route';
import { segmentRoute } from '../../shared/journey/segment';
it('health, scenes and route API return actual contracts', async () => {
  const app = createApp();
  await request(app).get('/api/health').expect(200);
  const list = await request(app).get('/api/scenes').expect(200);
  expect(list.body).toHaveLength(12);
  expect(new Set(list.body.map((s: any) => s.sceneId)).size).toBe(12);
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

it('persists journey sessions and applies ordered, idempotent commands', async () => {
  const dir = await mkdtemp(tmpdir() + '/accessroute-session-test-');
  const sessionsFile = dir + '/sessions.json';
  const app = createApp({ sessionsFile, allowWrites: true });
  const origin = scene('hysan-place');
  const destination = scene('popcorn-2');
  const created = await request(app)
    .post('/api/sessions')
    .send({
      originSceneId: origin.manifest.sceneId,
      destinationSceneId: destination.manifest.sceneId,
      profile: 'elderly',
      weather: 'rain',
    })
    .expect(201);
  const initial = created.body;
  expect(initial.state.position).toEqual({
    sceneId: origin.manifest.sceneId,
    nodeId: origin.manifest.defaultStart,
  });

  const command = (expectedRevision: number, operationId: string, body: unknown) =>
    request(app)
      .post(`/api/sessions/${initial.id}/commands`)
      .send({ expectedRevision, operationId, command: body });

  const planned = await command(1, randomUUID(), {
    type: 'plan',
    steps: [
      {
        title: 'Walk to station',
        detail: 'Follow the public route',
        distanceM: 35,
        sceneId: origin.manifest.sceneId,
        fromNodeId: origin.manifest.defaultStart,
        toNodeId: origin.manifest.defaultEnd,
      },
    ],
  }).expect(200);
  expect(planned.body.session.state.status).toBe('planned');
  const startOperationId = randomUUID();
  const started = await command(2, startOperationId, { type: 'start' }).expect(200);
  expect(started.body.session.state.status).toBe('navigating');
  const replay = await command(2, startOperationId, { type: 'start' }).expect(200);
  expect(replay.body.replayed).toBe(true);
  expect(replay.body.session.revision).toBe(started.body.session.revision);
  await command(2, randomUUID(), { type: 'advance' }).expect(409);

  const restored = createApp({ sessionsFile });
  const loaded = await request(restored).get(`/api/sessions/${initial.id}`).expect(200);
  expect(loaded.body.revision).toBe(3);
  expect(loaded.body.state.status).toBe('navigating');
  expect(loaded.body.state.profile).toBe('elderly');
});

it('moves the paired position to the destination map when the rail leg ends', async () => {
  const app = createApp({ allowWrites: true });
  const origin = scene('hysan-place');
  const destination = scene('popcorn-2');
  const created = await request(app)
    .post('/api/sessions')
    .send({
      originSceneId: origin.manifest.sceneId,
      destinationSceneId: destination.manifest.sceneId,
    })
    .expect(201);
  const send = (expectedRevision: number, command: unknown) =>
    request(app)
      .post(`/api/sessions/${created.body.id}/commands`)
      .send({ operationId: randomUUID(), expectedRevision, command });
  const planned = await send(1, {
    type: 'plan',
    steps: [
      {
        title: 'Walk to station',
        detail: 'Origin route',
        distanceM: 35,
        sceneId: origin.manifest.sceneId,
        fromNodeId: origin.manifest.defaultStart,
        toNodeId: origin.manifest.defaultEnd,
      },
      {
        title: 'Take the train',
        detail: 'Rail stage',
        distanceM: 0,
        sceneId: origin.manifest.sceneId,
      },
      {
        title: 'Walk to destination',
        detail: 'Destination route',
        distanceM: 40,
        sceneId: destination.manifest.sceneId,
        fromNodeId: destination.manifest.defaultStart,
        toNodeId: destination.manifest.defaultEnd,
      },
    ],
  }).expect(200);
  const started = await send(planned.body.session.revision, { type: 'start' }).expect(200);
  const atStation = await send(started.body.session.revision, { type: 'advance' }).expect(200);
  expect(atStation.body.session.state.position).toEqual({
    sceneId: origin.manifest.sceneId,
    nodeId: origin.manifest.defaultEnd,
  });
  const arrived = await send(atStation.body.session.revision, { type: 'advance' }).expect(200);
  expect(arrived.body.session.state.currentStep).toBe(2);
  expect(arrived.body.session.state.position).toEqual({
    sceneId: destination.manifest.sceneId,
    nodeId: destination.manifest.defaultStart,
  });
});

it('checks session writes, scene references, and optimistic revisions', async () => {
  const readOnly = createApp();
  await request(readOnly)
    .post('/api/sessions')
    .send({ originSceneId: 'hysan-place', destinationSceneId: 'popcorn-2' })
    .expect(403);

  const app = createApp({ allowWrites: true });
  await request(app)
    .post('/api/sessions')
    .set('Origin', 'https://untrusted.example')
    .send({ originSceneId: 'hysan-place', destinationSceneId: 'popcorn-2' })
    .expect(403);
  const created = await request(app)
    .post('/api/sessions')
    .send({ originSceneId: 'hysan-place', destinationSceneId: 'popcorn-2' })
    .expect(201);
  await request(app)
    .post(`/api/sessions/${created.body.id}/commands`)
    .send({
      operationId: randomUUID(),
      expectedRevision: 1,
      command: { type: 'set_position', position: { sceneId: 'hysan-place', nodeId: 'unknown' } },
    })
    .expect(400);
  await request(app)
    .post(`/api/sessions/${created.body.id}/commands`)
    .send({
      operationId: randomUUID(),
      expectedRevision: 1,
      command: { type: 'set_weather', weather: 'heat' },
    })
    .expect(200);
  await request(app)
    .post(`/api/sessions/${created.body.id}/commands`)
    .send({
      operationId: randomUUID(),
      expectedRevision: 1,
      command: { type: 'set_weather', weather: 'sunny' },
    })
    .expect(409);
});

it('streams the initial session and each committed state over SSE', async () => {
  const server = createServer(createApp({ allowWrites: true }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind a port');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const createdResponse = await fetch(`${base}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ originSceneId: 'hysan-place', destinationSceneId: 'popcorn-2' }),
    });

    const created = (await createdResponse.json()) as {
      id: string;
      revision: number;
      state: { weather: string };
    };
    const stream = await fetch(`${base}/api/sessions/${created.id}/stream`);
    expect(stream.headers.get('content-type')).toContain('text/event-stream');
    const reader = stream.body?.getReader();
    if (!reader) throw new Error('SSE response has no stream body');
    const initial = await reader.read();
    expect(new TextDecoder().decode(initial.value)).toContain(`"revision":${created.revision}`);
    const updated = await fetch(`${base}/api/sessions/${created.id}/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operationId: randomUUID(),
        expectedRevision: created.revision,
        command: { type: 'set_weather', weather: 'rain' },
      }),
    });
    expect(updated.status).toBe(200);
    const pushed = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('SSE update timed out')), 2_000),
      ),
    ]);
    expect(new TextDecoder().decode(pushed.value)).toContain('"weather":"rain"');
    await reader.cancel();
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it('reroutes a paired journey around a closed facility and restores it when reopened', async () => {
  const app = createApp({ allowWrites: true });
  const origin = scene('hysan-place');
  const destination = scene('popcorn-2');
  const baseline = route(origin.graph, origin.manifest.defaultStart, origin.manifest.defaultEnd, {
    ...ctx,
    profile: 'wheelchair',
    objective: 'shortest',
  });
  if (baseline.status !== 'ok') throw new Error('Expected the baseline route to be available');
  expect(
    baseline.edgeIds.some(
      (id) =>
        origin.graph.edges.find((edge) => edge.id === id)?.facilityId === 'hysan-place-lift-a',
    ),
  ).toBe(true);

  const created = await request(app)
    .post('/api/sessions')
    .send({
      originSceneId: origin.manifest.sceneId,
      destinationSceneId: destination.manifest.sceneId,
      profile: 'wheelchair',
    })
    .expect(201);
  const steps = segmentRoute(origin.graph, baseline).map((segment) => ({
    title: segment.type === 'transition' ? `電梯${segment.mode}` : '沿通道前行',
    detail: '沿已計算路線前往下一點',
    distanceM: segment.distanceM,
    sceneId: origin.manifest.sceneId,
    ...(segment.type === 'transition'
      ? { levelId: segment.fromLevel }
      : segment.type === 'floor'
        ? { levelId: segment.levelId }
        : {}),
    fromNodeId: segment.nodeIds[0],
    toNodeId: segment.nodeIds.at(-1),
  }));
  const send = (revision: number, command: unknown) =>
    request(app)
      .post(`/api/sessions/${created.body.id}/commands`)
      .send({ operationId: randomUUID(), expectedRevision: revision, command });
  await send(1, { type: 'plan', steps: [{ ...steps[0], levelId: 'missing-floor' }] }).expect(400);
  const planned = await send(1, { type: 'plan', steps }).expect(200);
  expect(planned.body.session.state.steps.some((step: { levelId?: string }) => step.levelId)).toBe(
    true,
  );
  const started = await send(planned.body.session.revision, { type: 'start' }).expect(200);
  const facilityEvent = {
    id: `session-${created.body.id}-lift-a`,
    type: 'facility_closed',
    target: { facilityId: 'hysan-place-lift-a' },
    status: 'active',
    validFrom: new Date().toISOString(),
    source: 'demo',
    confidence: 1,
  };
  const closed = await send(started.body.session.revision, {
    type: 'set_facility_event',
    sceneId: origin.manifest.sceneId,
    event: facilityEvent,
  }).expect(200);

  expect(closed.body.session.state.routeStatus).toBe('ok');
  expect(closed.body.session.state.facilityEvents).toHaveLength(1);
  const reroutedDistance = closed.body.session.state.steps.reduce(
    (sum: number, step: { distanceM: number }) => sum + step.distanceM,
    0,
  );
  expect(reroutedDistance).toBeGreaterThan(baseline.distanceM + 1);

  const restored = await send(closed.body.session.revision, {
    type: 'set_facility_event',
    sceneId: origin.manifest.sceneId,
    event: { ...facilityEvent, status: 'resolved' },
  }).expect(200);
  expect(restored.body.session.state.routeStatus).toBe('ok');
  expect(restored.body.session.state.facilityEvents[0].event.status).toBe('resolved');
  const restoredDistance = restored.body.session.state.steps.reduce(
    (sum: number, step: { distanceM: number }) => sum + step.distanceM,
    0,
  );
  expect(restoredDistance).toBeCloseTo(baseline.distanceM, 0);

  const liftIds = origin.graph.facilities
    .filter((facility) => facility.kind === 'lift')
    .map((facility) => facility.id);
  expect(liftIds.length).toBeGreaterThan(1);
  let revision = restored.body.session.revision;
  for (const facilityId of liftIds) {
    const blocked = await send(revision, {
      type: 'set_facility_event',
      sceneId: origin.manifest.sceneId,
      event: {
        ...facilityEvent,
        id: `session-${created.body.id}-${facilityId}`,
        target: { facilityId },
        status: 'active',
      },
    }).expect(200);
    revision = blocked.body.session.revision;
  }
  const noRoute = await request(app).get(`/api/sessions/${created.body.id}`).expect(200);
  expect(noRoute.body.state.routeStatus).toBe('no_route');
  const stepBeforeAdvance = noRoute.body.state.currentStep;
  const blockedAdvance = await send(revision, { type: 'advance' }).expect(200);
  expect(blockedAdvance.body.session.state.currentStep).toBe(stepBeforeAdvance);
});
