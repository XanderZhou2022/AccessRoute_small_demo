import { Router } from 'express';
import { z } from 'zod';
import { resultSchema, validateResult } from '../../shared/genai/contracts';
import {
  preferenceRequestSchema,
  locationResolutionRequestSchema,
  photoRequestSchema,
  guidanceRequestSchema,
  workflowContextSchema,
} from '../../shared/genai/workflows';
import { resolveLocations } from '../agents/location-resolver';
import type { ModelProvider } from '../providers/model';
import type { WorkflowService } from '../workflows/service';
import type { SceneRepository } from '../repositories/scenes';
export function genaiRouter(
  workflows: WorkflowService,
  scenes: SceneRepository,
  model: ModelProvider,
  configured: boolean,
) {
  const router = Router();
  router.get('/capabilities', (_req, res) =>
    res.json({
      configured,
      workflows: ['preferences', 'location-resolution', 'obstacle', 'localization', 'guidance'],
      speech: 'browser',
    }),
  );
  router.post('/validate', async (req, res) => {
    const input = resultSchema.parse(req.body);
    const result = validateResult(input, await scenes.load(input.scene_id));
    res.json({ status: 'validated', applied: false, result });
  });
  router.post('/workflows/preferences', async (req, res) => {
    const input = preferenceRequestSchema.parse(req.body);
    res.json(await workflows.run('preferences', input.context, input.text));
  });
  router.post('/location-resolution', async (req, res) => {
    const input = locationResolutionRequestSchema.parse(req.body);
    res.json(await resolveLocations(model, input));
  });
  for (const workflow of ['obstacle', 'localization'] as const) {
    router.post(`/workflows/${workflow}`, async (req, res) => {
      const { context, ...photo } = photoRequestSchema.parse(req.body);
      res.json(await workflows.run(workflow, context, photo));
    });
  }
  router.post('/workflows/guidance', async (req, res) => {
    const input = guidanceRequestSchema.parse(req.body);
    res.json(await workflows.run('guidance', input.context));
  });
  router.post('/confirm', async (req, res) => {
    const input = z
      .object({
        confirmation_id: z.string().uuid(),
        candidate_id: z.string().min(1),
        context: workflowContextSchema,
      })
      .parse(req.body);
    res.json(await workflows.confirm(input.confirmation_id, input.candidate_id, input.context));
  });
  return router;
}
