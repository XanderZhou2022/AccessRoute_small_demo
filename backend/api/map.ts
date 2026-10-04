import { Router } from 'express';
import { z } from 'zod';
import { contextSchema, eventSchema } from '../../shared/domain/schema';
import { route, planRoutes } from '../../shared/routing/route';
import { segmentRoute } from '../../shared/journey/segment';
import type { SceneRepository } from '../repositories/scenes';
import type { EventRepository } from '../repositories/events';
export function mapRouter(scenes: SceneRepository, events: EventRepository, allowWrites: boolean) {
  const router = Router();
  router.get('/scenes', async (_req, res) => res.json(await scenes.list()));
  router.get('/scenes/:id', async (req, res) =>
    res.json(
      await scenes.load(
        String(req.params.id),
        z.enum(['base', 'scenario']).parse(req.query.mode || 'base'),
      ),
    ),
  );
  router.post('/route', async (req, res) => {
    const input = z
      .object({ sceneId: z.string(), from: z.string(), to: z.string(), context: contextSchema })
      .parse(req.body);
    const scene = await scenes.load(input.sceneId, input.context.graphMode);
    if (![input.from, input.to].every((id) => scene.graph.nodes.some((n) => n.id === id))) {
      res.status(400).json({ error: 'Unknown route endpoint' });
      return;
    }
    const merged = new Map(
      [...(await events.list()), ...input.context.events].map((e) => [e.id, e]),
    );
    const context = {
      ...input.context,
      events: [...merged.values()],
    };
    const result = route(scene.graph, input.from, input.to, context);
    const alternatives = planRoutes(scene.graph, input.from, input.to, context).map((p) => ({
      ...p,
      segments: segmentRoute(scene.graph, p.route),
    }));
    res.json({ route: result, segments: segmentRoute(scene.graph, result), alternatives });
  });
  router.get('/events', async (_req, res) => res.json(await events.list()));
  router.post('/events', async (req, res) => {
    if (!allowWrites) {
      res.status(403).json({ error: 'Event writes disabled' });
      return;
    }
    const origin = req.get('origin');
    if (origin) {
      const trusted = [
        `http://${req.get('host')}`,
        `https://${req.get('host')}`,
        'http://127.0.0.1:5173',
        'http://localhost:5173',
      ];
      if (!trusted.includes(origin)) {
        res.status(403).json({ error: 'Untrusted origin' });
        return;
      }
    }
    const event = eventSchema.parse(req.body);
    if (event.source !== 'demo') {
      res.status(400).json({ error: 'Local demo accepts only source=demo' });
      return;
    }
    await events.save(event);
    res.status(201).json(event);
  });
  return router;
}
