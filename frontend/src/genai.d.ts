import type { AgentResult, IntegrationContext } from '../../shared/genai/contracts';
import type { Scene } from '../../shared/domain/schema';
import type { RankedCandidate, WorkflowContext } from '../../shared/genai/workflows';
import type { Receipt } from './components/GenAIConsole';
declare global {
  interface Window {
    accessrouteGenAI?: {
      version: '1.0';
      getContext(): IntegrationContext;
      getScene(): Scene;
      getExamples(): AgentResult[];
      getWorkflowContext?(sceneId?: string, currentNodeId?: string): WorkflowContext;
      previewMapCandidate?(sceneId: string, candidate: RankedCandidate): Receipt;
      clearMapCandidatePreview?(): void;
      applyMapObstacleResult?(result: unknown): Receipt;
      applyMapLocalizationResult?(result: unknown): Receipt;
      submit(result: unknown): Receipt;
    };
  }
}
