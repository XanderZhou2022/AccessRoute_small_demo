import express from 'express';
import { validateResult, resultSchema, IntegrationError } from '../shared/genai/contracts';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z, ZodError } from 'zod';
import {
  manifestSchema,
  validateScene,
  contextSchema,
  eventSchema,
  type Scene,
  type DynamicEvent,
} from '../shared/domain/schema';
import { route } from '../shared/routing/route';
import { segmentRoute } from '../shared/journey/segment';
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function createApp(
  options: { dataRoot?: string; eventFile?: string; allowWrites?: boolean } = {},
) {
  const app = express(),
    dataRoot = options.dataRoot || resolve(project, 'data/scenes');
  let events: DynamicEvent[] = [];
  let ready = false;
  let writing = Promise.resolve();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '128kb' }));
  app.use((_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'no-store');
    next();
  });
  async function ensureEvents() {
    if (ready) return;
    if (options.eventFile) {
      try {
        events = z.array(eventSchema).parse(JSON.parse(await readFile(options.eventFile, 'utf8')));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
    ready = true;
  }
  async function save(next: DynamicEvent[]) {
    if (options.eventFile) {
      await mkdir(dirname(options.eventFile), { recursive: true });
      const tmp = options.eventFile + '.tmp';
      await writeFile(tmp, JSON.stringify(next, null, 2));
      await rename(tmp, options.eventFile);
    }
    events = next;
  }
  async function load(id: string): Promise<Scene> {
    if (!/^[a-z0-9-]+$/.test(id))
      throw Object.assign(new Error('Invalid scene ID'), { status: 400 });
    const manifest = manifestSchema.parse(
      JSON.parse(await readFile(resolve(dataRoot, id, 'manifest.json'), 'utf8')),
    );
    const values = await Promise.all(
      Object.entries(manifest.files).map(async ([k, v]) => [
        k,
        JSON.parse(await readFile(resolve(dataRoot, id, v), 'utf8')),
      ]),
    );
    return validateScene({ manifest, ...Object.fromEntries(values) } as Scene);
  }
  app.get('/api/health', (_req, res) =>
    res.json({
      status: 'ok',
      version: '0.1.0',
      mode: 'local-demo',
      writes: options.allowWrites ?? false,
    }),
  );
  app.get('/api/scenes', async (_req, res) => {
    const index = JSON.parse(await readFile(resolve(dataRoot, 'index.json'), 'utf8'));
    const manifests = await Promise.all(
      index.scenes.map(async (id: string) =>
        manifestSchema.parse(
          JSON.parse(await readFile(resolve(dataRoot, id, 'manifest.json'), 'utf8')),
        ),
      ),
    );
    res.json(manifests);
  });
  app.get('/api/scenes/:id', async (req, res) => res.json(await load(String(req.params.id))));
  app.post('/api/genai/validate', async (req, res) => {
    const input = resultSchema.parse(req.body);
    const result = validateResult(input, await load(input.scene_id));
    res.json({ status: 'validated', applied: false, result });
  });
  app.post('/api/route', async (req, res) => {
    const input = z
      .object({ sceneId: z.string(), from: z.string(), to: z.string(), context: contextSchema })
      .parse(req.body);
    const scene = await load(input.sceneId);
    await ensureEvents();
    const merged = new Map([...events, ...input.context.events].map((e) => [e.id, e]));
    if (
      !scene.graph.nodes.some((n) => n.id === input.from) ||
      !scene.graph.nodes.some((n) => n.id === input.to)
    ) {
      res.status(400).json({ error: 'Unknown route endpoint' });
      return;
    }
    const result = route(scene.graph, input.from, input.to, {
      ...input.context,
      events: [...merged.values()],
    });
    res.json({ route: result, segments: segmentRoute(scene.graph, result) });
  });
  app.get('/api/events', async (_req, res) => {
    await ensureEvents();
    res.json(events);
  });
  app.post('/api/events', async (req, res) => {
    if (!options.allowWrites) {
      res.status(403).json({ error: 'Event writes disabled' });
      return;
    }
    const origin = req.get('origin');
    if (origin) {
      let valid = false;
      try {
        valid =
          new URL(origin).host === req.get('host') ||
          new URL(origin).origin === 'http://127.0.0.1:5173' ||
          new URL(origin).origin === 'http://localhost:5173';
      } catch {}
      if (!valid) {
        res.status(403).json({ error: 'Untrusted origin' });
        return;
      }
    }
    const event = eventSchema.parse(req.body);
    if (event.source !== 'demo') {
      res.status(400).json({ error: 'Local demo accepts only source=demo' });
      return;
    }
    const run = writing.then(async () => {
      await ensureEvents();
      await save([...events.filter((e) => e.id !== event.id), event]);
    });
    writing = run.catch(() => {});
    await run;
    res.status(201).json(event);
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found' }));
  app.use(express.static(resolve(project, 'frontend/dist'), { index: 'index.html' }));
  app.use(
    (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const status =
        err instanceof ZodError || err instanceof IntegrationError
          ? 400
          : (err as NodeJS.ErrnoException).code === 'ENOENT'
            ? 404
            : (err as Error & { status?: number }).status || 500;
      res
        .status(status)
        .json({
          error: status === 500 ? 'Internal server error' : err.message,
          code:
            err instanceof IntegrationError
              ? err.code
              : err instanceof ZodError
                ? 'INVALID_PAYLOAD'
                : undefined,
        });
    },
  );
  return app;
}
