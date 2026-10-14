import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { SceneRepository } from '../repositories/scenes';
import { SessionRepository, type JourneySession } from '../repositories/sessions';
import { eventSchema, type DynamicEvent, type RouteSegment } from '../../shared/domain/schema';
import { route } from '../../shared/routing/route';
import { segmentRoute } from '../../shared/journey/segment';

const sceneIdSchema = z.string().regex(/^[a-z0-9-]+$/);
const weatherSchema = z.enum(['sunny', 'rain', 'heat', 'observatory']);
const profileSchema = z.enum(['walking', 'wheelchair', 'elderly', 'stroller', 'heavy_luggage']);
const objectiveSchema = z.enum([
  'balanced',
  'shortest',
  'sheltered',
  'indoor',
  'least_effort',
  'fastest',
]);
const stepSchema = z.object({
  title: z.string().min(1).max(200),
  detail: z.string().max(1000),
  distanceM: z.number().finite().nonnegative(),
  sceneId: sceneIdSchema,
  levelId: z.string().min(1).max(200).optional(),
  fromNodeId: z.string().min(1).max(200).optional(),
  toNodeId: z.string().min(1).max(200).optional(),
});
const commandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('set_journey'),
    originSceneId: sceneIdSchema,
    destinationSceneId: sceneIdSchema,
  }),
  z.object({
    type: z.literal('set_preferences'),
    profile: profileSchema,
    objective: objectiveSchema,
  }),
  z.object({ type: z.literal('set_weather'), weather: weatherSchema }),
  z.object({ type: z.literal('plan'), steps: z.array(stepSchema).max(500) }),
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('advance') }),
  z.object({
    type: z.literal('set_position'),
    position: z.object({
      sceneId: sceneIdSchema,
      nodeId: z.string().min(1).max(200),
      levelId: z.string().min(1).max(200).optional(),
    }),
  }),
  z.object({ type: z.literal('set_facility_event'), sceneId: sceneIdSchema, event: eventSchema }),
  z.object({ type: z.literal('set_status'), status: z.enum(['waiting', 'navigating', 'exited']) }),
  z.object({ type: z.literal('reset') }),
]);

function sameOriginAllowed(origin: string | undefined, host: string | undefined) {
  if (!origin) return true;
  return [
    `http://${host}`,
    `https://${host}`,
    'http://127.0.0.1:5173',
    'http://localhost:5173',
  ].includes(origin);
}

export function sessionsRouter(
  sessions: SessionRepository,
  scenes: SceneRepository,
  allowWrites: boolean,
) {
  const router = Router();
  const requireWriteAccess = (req: Request, res: Response) => {
    if (!allowWrites) {
      res.status(403).json({ error: 'Session writes disabled' });
      return false;
    }
    if (!sameOriginAllowed(req.get('origin'), req.get('host'))) {
      res.status(403).json({ error: 'Untrusted origin' });
      return false;
    }
    return true;
  };

  router.post('/sessions', async (req, res) => {
    if (!requireWriteAccess(req, res)) return;
    const input = z
      .object({
        originSceneId: sceneIdSchema,
        destinationSceneId: sceneIdSchema,
        profile: profileSchema.default('walking'),
        weather: weatherSchema.default('sunny'),
      })
      .parse(req.body);
    if (input.originSceneId === input.destinationSceneId) {
      res.status(400).json({ error: 'Departure and destination must be different scenes' });
      return;
    }
    const [origin, destination] = await Promise.all([
      scenes.load(input.originSceneId),
      scenes.load(input.destinationSceneId),
    ]);
    const session = await sessions.create({
      originSceneId: origin.manifest.sceneId,
      destinationSceneId: destination.manifest.sceneId,
      originNodeId: origin.manifest.defaultStart,
      destinationNodeId: destination.manifest.defaultEnd,
      profile: input.profile,
      weather: input.weather,
      objective: 'balanced',
      status: 'planning',
      currentStep: 0,
      position: { sceneId: origin.manifest.sceneId, nodeId: origin.manifest.defaultStart },
      steps: [],
      facilityEvents: [],
    });
    res.status(201).json(session);
  });

  router.get('/sessions/:id', async (req, res) => {
    const session = await sessions.get(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Journey session not found' });
      return;
    }
    res.json(session);
  });

  router.get('/sessions/:id/facilities', async (req, res) => {
    const session = await sessions.get(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Journey session not found' });
      return;
    }
    const sceneIds = [...new Set([session.state.originSceneId, session.state.destinationSceneId])];
    const available = await Promise.all(
      sceneIds.map(async (sceneId) => {
        const scene = await scenes.load(sceneId);
        return {
          sceneId,
          name: scene.manifest.nameZh,
          facilities: scene.graph.facilities.map(({ id, label, kind }) => ({ id, label, kind })),
        };
      }),
    );
    res.json(available);
  });

  router.post('/sessions/:id/commands', async (req, res) => {
    if (!requireWriteAccess(req, res)) return;
    const input = z
      .object({
        operationId: z.string().uuid(),
        expectedRevision: z.number().int().positive(),
        command: commandSchema,
      })
      .parse(req.body);
    const current = await sessions.get(req.params.id);
    if (!current) {
      res.status(404).json({ error: 'Journey session not found' });
      return;
    }
    const commandContext = await validateCommandReferences(input.command, scenes);
    if (
      input.command.type === 'set_facility_event' &&
      ![current.state.originSceneId, current.state.destinationSceneId].includes(
        input.command.sceneId,
      )
    ) {
      res.status(400).json({ error: 'Facility event scene is outside this journey' });
      return;
    }
    const facilityReplan =
      input.command.type === 'set_facility_event'
        ? await replanForFacilityEvent(current, input.command.sceneId, input.command.event, scenes)
        : undefined;
    const result = await sessions.transact(
      req.params.id,
      input.operationId,
      input.expectedRevision,
      (session) => reduce(session.state, input.command, { ...commandContext, facilityReplan }),
    );
    if (!result.session) {
      res.status(404).json({ error: 'Journey session not found' });
      return;
    }
    if ('conflict' in result && result.conflict) {
      res.status(409).json({ error: 'Session revision conflict', session: result.session });
      return;
    }
    res.json({ session: result.session, replayed: result.replayed });
  });

  router.get('/sessions/:id/stream', async (req, res) => {
    let responseReady = false;
    let lastRevision = 0;
    let buffered: JourneySession | undefined;
    const send = (session: JourneySession) => {
      if (session.revision <= lastRevision) return;
      if (!responseReady) {
        buffered = session;
        return;
      }
      lastRevision = session.revision;
      res.write(`id: ${session.revision}\nevent: session\ndata: ${JSON.stringify(session)}\n\n`);
    };
    const unsubscribe = sessions.subscribe(req.params.id, send);
    const initial = await sessions.get(req.params.id);
    if (!initial) {
      unsubscribe();
      res.status(404).json({ error: 'Journey session not found' });
      return;
    }
    res.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    responseReady = true;
    send(buffered && buffered.revision > initial.revision ? buffered : initial);
    const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 20_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
  return router;
}

async function validateCommandReferences(
  command: z.infer<typeof commandSchema>,
  scenes: SceneRepository,
) {
  const ids =
    command.type === 'set_journey'
      ? [command.originSceneId, command.destinationSceneId]
      : command.type === 'plan'
        ? command.steps.map((step) => step.sceneId)
        : command.type === 'set_position'
          ? [command.position.sceneId]
          : command.type === 'set_facility_event'
            ? [command.sceneId]
            : [];
  const loaded = new Map<string, Awaited<ReturnType<SceneRepository['load']>>>();
  for (const id of new Set(ids)) loaded.set(id, await scenes.load(id));
  if (command.type === 'set_journey' && command.originSceneId === command.destinationSceneId)
    throw Object.assign(new Error('Departure and destination must be different scenes'), {
      status: 400,
    });
  for (const step of command.type === 'plan' ? command.steps : []) {
    const scene = loaded.get(step.sceneId)!;
    const graph = scene.graph;
    if (
      (step.levelId && !scene.manifest.levels.some((level) => level.id === step.levelId)) ||
      (step.fromNodeId && !graph.nodes.some((node) => node.id === step.fromNodeId)) ||
      (step.toNodeId && !graph.nodes.some((node) => node.id === step.toNodeId))
    )
      throw Object.assign(new Error('Navigation step references an unknown map node'), {
        status: 400,
      });
  }
  if (command.type === 'set_position') {
    const scene = loaded.get(command.position.sceneId)!;
    if (!scene.graph.nodes.some((node) => node.id === command.position.nodeId))
      throw Object.assign(new Error('Position references an unknown map node'), { status: 400 });
  }
  if (command.type === 'set_facility_event') {
    const scene = loaded.get(command.sceneId)!;
    const { facilityId, edgeIds } = command.event.target;
    if (
      (facilityId && !scene.graph.facilities.some((facility) => facility.id === facilityId)) ||
      edgeIds?.some((edgeId) => !scene.graph.edges.some((edge) => edge.id === edgeId))
    )
      throw Object.assign(new Error('Facility event references an unknown scene object'), {
        status: 400,
      });
  }
  return command.type === 'set_journey'
    ? {
        originNodeId: loaded.get(command.originSceneId)!.manifest.defaultStart,
        destinationNodeId: loaded.get(command.destinationSceneId)!.manifest.defaultEnd,
      }
    : {};
}

function reduce(
  state: JourneySession['state'],
  command: z.infer<typeof commandSchema>,
  context: {
    originNodeId?: string;
    destinationNodeId?: string;
    facilityReplan?: {
      steps: JourneySession['state']['steps'];
      routeStatus: 'ok' | 'no_route';
      currentStep: number;
    };
  },
) {
  switch (command.type) {
    case 'set_journey':
      return {
        ...state,
        originSceneId: command.originSceneId,
        destinationSceneId: command.destinationSceneId,
        originNodeId: context.originNodeId || state.originNodeId,
        destinationNodeId: context.destinationNodeId || state.destinationNodeId,
        status: 'planning' as const,
        currentStep: 0,
        position: {
          sceneId: command.originSceneId,
          nodeId: context.originNodeId || state.originNodeId,
        },
        steps: [],
      };
    case 'set_preferences':
      return { ...state, profile: command.profile, objective: command.objective };
    case 'set_weather':
      return { ...state, weather: command.weather };
    case 'plan':
      return {
        ...state,
        steps: command.steps,
        routeStatus: 'ok' as const,
        status: 'planned' as const,
        currentStep: 0,
        position: command.steps[0]
          ? {
              sceneId: command.steps[0].sceneId,
              ...(command.steps[0].fromNodeId ? { nodeId: command.steps[0].fromNodeId } : {}),
            }
          : state.position,
      };
    case 'start':
      return state.steps.length ? { ...state, status: 'navigating' as const } : state;
    case 'advance': {
      if (state.status !== 'navigating' || !state.steps.length || state.routeStatus === 'no_route')
        return state;
      const step = state.steps[state.currentStep];
      const next = state.currentStep + 1;
      const nextStep = state.steps[next];
      const position = step.toNodeId
        ? { sceneId: step.sceneId, nodeId: step.toNodeId }
        : nextStep
          ? {
              sceneId: nextStep.sceneId,
              ...(nextStep.fromNodeId ? { nodeId: nextStep.fromNodeId } : {}),
            }
          : { sceneId: step.sceneId };
      return {
        ...state,
        currentStep: Math.min(next, state.steps.length - 1),
        position,
        status: next >= state.steps.length ? ('complete' as const) : state.status,
      };
    }
    case 'set_position':
      return { ...state, position: command.position };
    case 'set_facility_event':
      return {
        ...state,
        facilityEvents: [
          ...state.facilityEvents.filter(
            (entry) => entry.sceneId !== command.sceneId || entry.event.id !== command.event.id,
          ),
          { sceneId: command.sceneId, event: command.event },
        ],
        ...(context.facilityReplan
          ? {
              steps: context.facilityReplan.steps,
              routeStatus: context.facilityReplan.routeStatus,
              currentStep: context.facilityReplan.currentStep,
            }
          : {}),
      };
    case 'set_status':
      return { ...state, status: command.status };
    case 'reset':
      return {
        ...state,
        status: 'planning' as const,
        currentStep: 0,
        position: { sceneId: state.originSceneId, nodeId: state.originNodeId },
        steps: [],
      };
  }
}

async function replanForFacilityEvent(
  session: JourneySession,
  sceneId: string,
  event: DynamicEvent,
  scenes: SceneRepository,
) {
  const state = session.state;
  const events = [
    ...state.facilityEvents.filter(
      (entry) => entry.sceneId !== sceneId || entry.event.id !== event.id,
    ),
    { sceneId, event },
  ].map((entry) => entry.event);
  const activeEvents = events.filter((item) => item.status === 'active');
  const firstIndex = state.steps.findIndex(
    (step, index) =>
      index >= state.currentStep &&
      step.sceneId === sceneId &&
      !!step.fromNodeId &&
      !!step.toNodeId,
  );
  if (firstIndex < 0) return undefined;

  let lastIndex = firstIndex;
  while (
    lastIndex + 1 < state.steps.length &&
    state.steps[lastIndex + 1].sceneId === sceneId &&
    state.steps[lastIndex + 1].fromNodeId &&
    state.steps[lastIndex + 1].toNodeId
  )
    lastIndex += 1;

  const scene = await scenes.load(sceneId);
  const startStep = state.steps[firstIndex];
  const endStep = state.steps[lastIndex];
  const from =
    state.position.sceneId === sceneId && state.position.nodeId
      ? state.position.nodeId
      : startStep.fromNodeId!;
  const to = endStep.toNodeId!;
  const routeResult = route(scene.graph, from, to, {
    profile: state.profile,
    rain: state.weather === 'rain',
    objective: state.objective,
    strictAccessibility: false,
    now: new Date().toISOString(),
    events: activeEvents,
  });
  const steps =
    routeResult.status === 'ok'
      ? stepsFromSegments(scene.graph, segmentRoute(scene.graph, routeResult))
      : state.steps.slice(firstIndex, lastIndex + 1);
  const prefix = state.steps.slice(0, firstIndex);
  const suffix = state.steps.slice(lastIndex + 1);
  return {
    steps: [...prefix, ...steps, ...suffix],
    routeStatus: routeResult.status,
    currentStep: routeResult.status === 'ok' ? prefix.length : state.currentStep,
  };
}

function stepsFromSegments(
  graph: Awaited<ReturnType<SceneRepository['load']>>['graph'],
  segments: RouteSegment[],
) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  return segments.map((segment) => {
    const start = nodes.get(segment.nodeIds[0]);
    const end = nodes.get(segment.nodeIds.at(-1)!);
    const from = start?.label || '目前位置';
    const to = end?.label || '下一位置';
    const title =
      segment.type === 'transition'
        ? `${segment.mode === 'lift' ? '電梯' : segment.mode === 'ramp' ? '坡道' : segment.mode === 'stairs' ? '樓梯' : '扶手電梯'}${(end?.z ?? 0) > (start?.z ?? 0) ? '上樓' : (end?.z ?? 0) < (start?.z ?? 0) ? '下樓' : '換層'}`
        : segment.type === 'bridge'
          ? '沿天橋前行'
          : segment.type === 'outdoor'
            ? '沿室外路段前行'
            : `沿 ${segment.levelId || '室內'} 通道前行`;
    return {
      title,
      detail: `${from} → ${to}`,
      distanceM: segment.distanceM,
      sceneId: graph.sceneId,
      ...(segment.type === 'transition'
        ? { levelId: segment.fromLevel }
        : segment.type === 'floor'
          ? { levelId: segment.levelId }
          : {}),
      fromNodeId: segment.nodeIds[0],
      toNodeId: segment.nodeIds.at(-1),
    };
  });
}
