import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { manifestSchema, validateScene, type Scene } from '../../shared/domain/schema';
import { landmarkSchema, type LandmarkRecord } from '../../shared/genai/workflows';
import { z } from 'zod';
import { applyDemoOverlay } from '../../shared/demo/navigation';
import type { DemoOverlay } from '../../shared/demo/types';
import type { KnowledgeRecord } from '../../shared/demo/types';
export class SceneRepository {
  private readonly scenes = new Map<string, Promise<Scene>>();
  constructor(
    private readonly dataRoot: string,
    private readonly landmarkRoot: string,
    private readonly knowledgeRoot?: string,
  ) {}
  async list() {
    const index = JSON.parse(await readFile(resolve(this.dataRoot, 'index.json'), 'utf8'));
    return Promise.all(index.scenes.map(async (id: string) => (await this.load(id)).manifest));
  }
  async load(id: string, mode: 'base' | 'scenario' = 'base'): Promise<Scene> {
    if (!/^[a-z0-9-]+$/.test(id))
      throw Object.assign(new Error('Invalid scene ID'), { status: 400 });
    if (!this.scenes.has(id)) this.scenes.set(id, this.readScene(id));
    const scene = await this.scenes.get(id)!;
    if (mode === 'base') return scene;
    const overlays: DemoOverlay[] = JSON.parse(
      await readFile(resolve(this.dataRoot, '../demo/overlays.json'), 'utf8'),
    );
    const overlay = overlays.find((o) => o.scene_id === id);
    if (!overlay) throw new Error(`Missing planning scenario ${id}`);
    return applyDemoOverlay(scene, overlay);
  }
  private async readScene(id: string) {
    const manifest = manifestSchema.parse(
      JSON.parse(await readFile(resolve(this.dataRoot, id, 'manifest.json'), 'utf8')),
    );
    const values = await Promise.all(
      Object.entries(manifest.files).map(async ([key, file]) => [
        key,
        JSON.parse(await readFile(resolve(this.dataRoot, id, file), 'utf8')),
      ]),
    );
    return validateScene({ manifest, ...Object.fromEntries(values) } as Scene);
  }
  async landmarks(scene: Scene): Promise<LandmarkRecord[]> {
    let raw = '[]';
    try {
      raw = await readFile(resolve(this.landmarkRoot, `${scene.manifest.sceneId}.json`), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const records = z.array(landmarkSchema).parse(JSON.parse(raw));
    const knowledge = await this.knowledge(scene.manifest.sceneId);
    records.push(
      ...knowledge
        .filter((r) => r.node_id && r.category !== 'lift')
        .map((r) =>
          landmarkSchema.parse({
            id: r.id,
            scene_id: r.scene_id,
            node_id: r.node_id,
            level_id: r.level_id,
            names: r.names,
            category: r.category,
            descriptions: [],
            source: r.source,
            association: r.association,
          }),
        ),
    );
    const ids = new Set<string>();
    for (const record of records) {
      const node = scene.graph.nodes.find((n) => n.id === record.node_id);
      if (
        ids.has(record.id) ||
        record.scene_id !== scene.manifest.sceneId ||
        !node ||
        node.levelId !== record.level_id
      ) {
        throw new Error(`地標 ${record.id} 的 scene/node/level 或唯一 ID 不正確`);
      }
      ids.add(record.id);
    }
    return records;
  }
  async knowledge(sceneId: string): Promise<KnowledgeRecord[]> {
    if (!/^[a-z0-9-]+$/.test(sceneId))
      throw Object.assign(new Error('Invalid scene ID'), { status: 400 });
    if (!this.knowledgeRoot) return [];
    try {
      const data = JSON.parse(
        await readFile(resolve(this.knowledgeRoot, `${sceneId}.json`), 'utf8'),
      );
      return data.records;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
}
