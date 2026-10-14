import {
  validateScene,
  manifestSchema,
  type Scene,
  type SceneManifest,
  type DynamicEvent,
} from '../domain/schema';
export interface SceneDataProvider {
  list(): Promise<SceneManifest[]>;
  load(id: string): Promise<Scene>;
}
export interface EventProvider {
  list(): Promise<DynamicEvent[]>;
}
export class StaticSceneDataProvider implements SceneDataProvider {
  constructor(
    private base: string,
    private request: typeof fetch = (input, init) => fetch(input, init),
  ) {}
  private async json(path: string) {
    const r = await this.request(this.base + path);
    if (!r.ok) throw new Error(`Unable to load scene data (${r.status})`);
    return r.json();
  }
  async list(): Promise<SceneManifest[]> {
    const index = await this.json('/index.json');
    return Promise.all(
      index.scenes.map(async (id: string) =>
        manifestSchema.parse(await this.json(`/${id}/manifest.json`)),
      ),
    );
  }
  async load(id: string) {
    if (!/^[a-z0-9-]+$/.test(id)) throw new Error('Invalid scene ID');
    const manifest = manifestSchema.parse(await this.json(`/${id}/manifest.json`));
    const values = await Promise.all(
      ['graph', 'levels', 'units', 'openings', 'amenities', 'surroundings', 'metadata'].map(
        async (key) => [key, await this.json(`/${id}/${manifest.files[key]}`)],
      ),
    );
    return validateScene({ manifest, ...Object.fromEntries(values) } as Scene);
  }
}
export class HttpSceneDataProvider implements SceneDataProvider {
  constructor(
    private base = '/api',
    private request: typeof fetch = (input, init) => fetch(input, init),
  ) {}
  private async json(path: string) {
    const r = await this.request(this.base + path);
    if (!r.ok) throw new Error(`Backend unavailable (${r.status})`);
    return r.json();
  }
  async list(): Promise<SceneManifest[]> {
    return (await this.json('/scenes')).map((x: unknown) => manifestSchema.parse(x));
  }
  async load(id: string) {
    return validateScene(await this.json('/scenes/' + encodeURIComponent(id)));
  }
}
export class StaticEventProvider implements EventProvider {
  async list() {
    return [];
  }
}
export class HttpEventProvider implements EventProvider {
  constructor(private base = '/api') {}
  async list() {
    const r = await fetch(this.base + '/events');
    if (!r.ok) throw new Error('Cannot load events');
    return r.json() as Promise<DynamicEvent[]>;
  }
}
