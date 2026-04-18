const DEFAULT_FRONTEND_URL = 'https://www.zapheit.com';

export function getFrontendBaseUrl(): string {
  const raw = process.env.FRONTEND_URL?.trim();
  if (!raw) return DEFAULT_FRONTEND_URL;

  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  try {
    return new URL(withScheme).origin;
  } catch {
    return raw.replace(/\/+$/, '') || DEFAULT_FRONTEND_URL;
  }
}

export function buildFrontendUrl(path = ''): string {
  const baseUrl = getFrontendBaseUrl();
  if (!path) return baseUrl;
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}