export function apiUrl(
  path: string,
  baseUrl = import.meta.env.VITE_API_BASE_URL || '',
): string {
  if (!path.startsWith('/api/')) {
    throw new Error('API paths must start with /api/.');
  }
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}
