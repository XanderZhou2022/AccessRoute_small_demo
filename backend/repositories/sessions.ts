import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

export type JourneyWeather = 'sunny' | 'rain' | 'heat' | 'observatory';
export type JourneyStatus =
  'planning' | 'planned' | 'navigating' | 'waiting' | 'complete' | 'exited';
export type JourneyProfile = 'walking' | 'wheelchair' | 'elderly' | 'stroller' | 'heavy_luggage';
export type JourneyStep = {
  title: string;
  detail: string;
  distanceM: number;
  sceneId: string;
  levelId?: string;
  fromNodeId?: string;
  toNodeId?: string;
};
export type JourneyPosition = { sceneId: string; nodeId?: string; levelId?: string };
export type JourneySession = {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  state: {
    originSceneId: string;
    destinationSceneId: string;
    originNodeId: string;
    destinationNodeId: string;
    profile: JourneyProfile;
    weather: JourneyWeather;
    objective: 'balanced' | 'shortest' | 'sheltered' | 'indoor' | 'least_effort' | 'fastest';
    status: JourneyStatus;
    routeStatus?: 'ok' | 'no_route';
    currentStep: number;
    position: JourneyPosition;
    steps: JourneyStep[];
    facilityEvents: { sceneId: string; event: import('../../shared/domain/schema').DynamicEvent }[];
  };
};
type SessionFile = { sessions: JourneySession[]; operations: Record<string, unknown> };

export class SessionRepository {
  private sessions = new Map<string, JourneySession>();
  private operations = new Map<string, { sessionId: string; response: JourneySession }>();
  private ready?: Promise<void>;
  private writing: Promise<void> = Promise.resolve();
  private listeners = new Map<string, Set<(session: JourneySession) => void>>();

  constructor(private readonly file?: string) {}

  private ensure() {
    return (this.ready ??= (async () => {
      if (!this.file) return;
      try {
        const saved = JSON.parse(await readFile(this.file, 'utf8')) as SessionFile;
        for (const session of saved.sessions) this.sessions.set(session.id, session);
        for (const [key, value] of Object.entries(saved.operations || {})) {
          const operation = value as { sessionId: string; response: JourneySession };
          this.operations.set(key, operation);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    })());
  }

  private async persist() {
    if (!this.file) return;
    await mkdir(dirname(this.file), { recursive: true });
    const data: SessionFile = {
      sessions: [...this.sessions.values()],
      operations: Object.fromEntries(this.operations),
    };
    await writeFile(this.file + '.tmp', JSON.stringify(data, null, 2), { mode: 0o600 });
    await rename(this.file + '.tmp', this.file);
  }

  private serial<T>(action: () => Promise<T>) {
    const result = this.writing.then(action);
    this.writing = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async create(state: JourneySession['state']) {
    return this.serial(async () => {
      await this.ensure();
      const now = new Date().toISOString();
      const session: JourneySession = {
        id: randomUUID(),
        revision: 1,
        createdAt: now,
        updatedAt: now,
        state,
      };
      this.sessions.set(session.id, session);
      await this.persist();
      this.publish(session);
      return session;
    });
  }

  async get(id: string) {
    await this.ensure();
    return this.sessions.get(id);
  }

  async transact(
    id: string,
    operationId: string,
    expectedRevision: number,
    reduce: (current: JourneySession) => JourneySession['state'],
  ) {
    return this.serial(async () => {
      await this.ensure();
      const operationKey = `${id}:${operationId}`;
      const previous = this.operations.get(operationKey);
      if (previous) return { session: previous.response, replayed: true as const };
      const current = this.sessions.get(id);
      if (!current) return { session: undefined, replayed: false as const };
      if (current.revision !== expectedRevision)
        return { session: current, conflict: true as const, replayed: false as const };
      const now = new Date().toISOString();
      const updated: JourneySession = {
        ...current,
        revision: current.revision + 1,
        updatedAt: now,
        state: reduce(current),
      };
      this.sessions.set(id, updated);
      this.operations.set(operationKey, { sessionId: id, response: updated });
      while (this.operations.size > 1000) {
        const oldest = this.operations.keys().next().value as string | undefined;
        if (!oldest) break;
        this.operations.delete(oldest);
      }
      await this.persist();
      this.publish(updated);
      return { session: updated, replayed: false as const };
    });
  }

  subscribe(id: string, listener: (session: JourneySession) => void) {
    const subscribers = this.listeners.get(id) || new Set();
    subscribers.add(listener);
    this.listeners.set(id, subscribers);
    return () => {
      subscribers.delete(listener);
      if (!subscribers.size) this.listeners.delete(id);
    };
  }

  private publish(session: JourneySession) {
    for (const listener of this.listeners.get(session.id) || []) listener(session);
  }
}
