import { describe, expect, it } from 'vitest';
import { apiUrl } from '../../frontend/src/api/url';

describe('API URL configuration', () => {
  it('keeps web API requests same-origin by default', () => {
    expect(apiUrl('/api/weather')).toBe('/api/weather');
  });

  it('targets the configured backend origin for the Android bundle', () => {
    expect(apiUrl('/api/genai/capabilities', 'https://api.example/')).toBe(
      'https://api.example/api/genai/capabilities',
    );
  });

  it('rejects paths outside the backend API', () => {
    expect(() => apiUrl('/other')).toThrow('API paths must start with /api/.');
  });
});
