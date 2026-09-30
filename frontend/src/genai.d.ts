import type { AgentResult, IntegrationContext } from '../../shared/genai/contracts';
import type { Scene } from '../../shared/domain/schema';
import type { Receipt } from './components/GenAIConsole';
declare global {
  interface Window {
    accessrouteGenAI?: {
      version: '1.0';
      getContext(): IntegrationContext;
      getScene(): Scene;
      getExamples(): AgentResult[];
      submit(result: unknown): Receipt;
    };
  }
}
