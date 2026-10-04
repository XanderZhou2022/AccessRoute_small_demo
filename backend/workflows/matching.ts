import type { Observation } from '../agents/vision';
import { matchMapEvidence } from '../agents/map-matcher';
import { retrieveNearby, normalize } from '../retrieval/map-index';
import { shortlist, rankCandidates } from '../retrieval/rank';
import type { PhotoInput } from '../../shared/genai/workflows';
import type { WorkflowDependencies } from './types';
export async function retrieveAndMatch(
  deps: WorkflowDependencies,
  observation: Observation,
  photo: PhotoInput,
  target: 'landmark' | 'lift' | 'facility' | 'path',
) {
  const floor = observation.floor_label
    ? deps.scene.manifest.levels.find(
        (l) => normalize(l.label) === normalize(observation.floor_label!),
      )?.id
    : undefined;
  if (observation.floor_label && !floor) return [];
  if (floor && photo.level_id && floor !== photo.level_id) return [];
  const nearby = retrieveNearby(
    deps.scene,
    deps.index,
    deps.map,
    { ...photo, level_id: floor || photo.level_id },
    target,
  );
  const candidates = shortlist(observation, nearby);
  if (!candidates.length) return [];
  const matches = await matchMapEvidence(deps.model, observation, candidates);
  return rankCandidates(observation, candidates, matches);
}
