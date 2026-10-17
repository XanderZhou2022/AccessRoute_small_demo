import express from 'express';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { IntegrationError } from '../shared/genai/contracts';
import { SceneRepository } from './repositories/scenes';
import { EventRepository } from './repositories/events';
import { SessionRepository } from './repositories/sessions';
import { HkoWeatherProvider } from './providers/weather';
import { configuredQwen } from './providers/qwen';
import type { ModelProvider } from './providers/model';
import { configuredSpeechProvider, type SpeechProvider } from './providers/speech';
import { WorkflowService } from './workflows/service';
import { genaiRouter } from './api/genai';
import { mapRouter } from './api/map';
import { knowledgeRouter } from './api/knowledge';
import { sessionsRouter } from './api/sessions';
import { weatherRouter } from './api/weather';
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function createApp(
  options: {
    dataRoot?: string;
    landmarkRoot?: string;
    knowledgeRoot?: string;
    eventFile?: string;
    sessionsFile?: string;
    allowedOrigins?: string[];
    weatherProvider?: HkoWeatherProvider;
    useVercelWeatherLocationHeaders?: boolean;
    allowWrites?: boolean;
    model?: ModelProvider;
    speech?: SpeechProvider;
  } = {},
) {
  const app = express();
  const scenes = new SceneRepository(
    options.dataRoot || resolve(project, 'data/scenes'),
    options.landmarkRoot || resolve(project, 'data/landmarks'),
    options.knowledgeRoot || resolve(project, 'data/knowledge'),
  );
  const events = new EventRepository(options.eventFile);
  const sessions = new SessionRepository(options.sessionsFile);
  const weather = options.weatherProvider || new HkoWeatherProvider();
  const allowedOrigins = new Set(
    options.allowedOrigins ??
      (process.env.ACCESSROUTE_CORS_ORIGINS || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
  );
  const model = options.model || configuredQwen();
  const speech = options.speech || configuredSpeechProvider();
  const workflows = new WorkflowService({
    scenes,
    events,
    model,
    speech,
  });
  app.disable('x-powered-by');
  app.use('/api/genai/workflows', express.json({ limit: '12mb' }));
  app.use(express.json({ limit: '128kb' }));
  app.use((_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', (req, res, next) => {
    const origin = req.get('origin');
    if (!origin) {
      if (req.method === 'OPTIONS') {
        res.sendStatus(403);
        return;
      }
      next();
      return;
    }
    if (!allowedOrigins.has(origin)) {
      if (req.method === 'OPTIONS') res.sendStatus(403);
      else next();
      return;
    }

    res.setHeader('Access-Control-Allow-Origin', origin);
    res.vary('Origin');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.sendStatus(204);
      return;
    }
    next();
  });
  app.get('/api/health', (_req, res) =>
    res.json({
      status: 'ok',
      version: '0.2.0',
      mode: 'local-demo',
      writes: options.allowWrites ?? false,
    }),
  );
  app.use(
    '/api/genai',
    genaiRouter(
      workflows,
      scenes,
      model,
      !!options.model || !!process.env.DASHSCOPE_API_KEY,
      speech,
    ),
  );
  app.use('/api', sessionsRouter(sessions, scenes, options.allowWrites ?? false));
  app.use(
    '/api',
    weatherRouter(weather, {
      useVercelLocationHeaders:
        options.useVercelWeatherLocationHeaders ?? process.env.VERCEL === '1',
    }),
  );
  app.use('/api', mapRouter(scenes, events, options.allowWrites ?? false));
  app.use('/api/knowledge', knowledgeRouter(scenes));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found' }));
  app.use(express.static(resolve(project, 'frontend/dist'), { index: 'index.html' }));
  app.use(
    (
      err: Error & { status?: number; code?: string },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const status =
        err instanceof ZodError || err instanceof IntegrationError
          ? 400
          : err.code === 'ENOENT'
            ? 404
            : err.status || 500;
      res.status(status).json({
        error: status === 500 ? 'Internal server error' : err.message,
        code:
          err instanceof IntegrationError
            ? err.code
            : err instanceof ZodError
              ? 'INVALID_PAYLOAD'
              : err.code,
      });
    },
  );
  return app;
}
