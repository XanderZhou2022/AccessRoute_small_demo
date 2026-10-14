// Model transport only. Agents own prompts; workflows own decisions.
export type ModelTask =
  | 'preferences'
  | 'location-resolution'
  | 'localization-observation'
  | 'obstacle-observation'
  | 'map-matching'
  | 'guidance';
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
  constructor(
    message: string,
    readonly status = 502,
    readonly code = 'MODEL_API_ERROR',
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
