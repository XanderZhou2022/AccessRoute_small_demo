// Model transport only. Agents own prompts; workflows own decisions.
export type ModelTask =
  'preferences' | 'localization-observation' | 'obstacle-observation' | 'map-matching' | 'guidance';
export type ModelRequest = {
  task: ModelTask;
  system: string;
  input: unknown;
  image?: string;
};
export interface ModelProvider {
  json(request: ModelRequest): Promise<unknown>;
}
export class ProviderError extends Error {
  readonly status = 502;
  readonly code = 'MODEL_API_ERROR';
}
