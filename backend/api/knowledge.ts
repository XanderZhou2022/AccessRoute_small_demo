import { Router } from 'express';
import { searchKnowledge } from '../../shared/demo/knowledge';
import type { SceneRepository } from '../repositories/scenes';
export function knowledgeRouter(scenes: SceneRepository) {
  const router = Router();
  router.get('/:sceneId', async (req, res) => {
    const records = await scenes.knowledge(req.params.sceneId);
    const query = String(req.query.q || ''),
      level = req.query.level ? String(req.query.level) : undefined;
    res.json({
      scene_id: req.params.sceneId,
      total: records.length,
      results: searchKnowledge(records, query, level),
      association_note: '近似節點需確認；未映射 POI 只能作檢索線索。',
    });
  });
  return router;
}
