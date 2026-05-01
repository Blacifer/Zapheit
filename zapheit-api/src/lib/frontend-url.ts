const DEFAULT_FRONTEND_URL = 'https://www.zapheit.com';

export function getFrontendBaseUrl(): string {
  const raw = process.env.FRONTEND_URL?.trim();
  if (!raw) return DEFAULT_FRONTEND_URL;

  // FRONTEND_URL may be comma-separated. Take the first.
  const first = raw.split(',')[0].trim();

  const withScheme = /^https?:\/\//i.test(first) ? first : `https://${first}`;

  try {
    return new URL(withScheme).origin;
  } catch {
    return first.replace(/\/+$/, '') || DEFAULT_FRONTEND_URL;
  }
}

export function buildFrontendUrl(path = ''): string {
  const baseUrl = getFrontendBaseUrl();
  if (!path) return baseUrl;
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}