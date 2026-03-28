const ACCESS_TOKEN_PARAM = 'access_token';
const ACCESS_TOKEN_HEADER = 'X-GhostLink-Access-Token';
const ACCESS_TOKEN_STORAGE_KEY = 'ghostlink.remoteAccessToken';

function readAccessTokenFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get(ACCESS_TOKEN_PARAM)?.trim() || '';
}

function persistAccessToken(token: string): void {
  if (!token) return;
  sessionStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, token);
}

function stripAccessTokenFromUrl(): void {
  const params = new URLSearchParams(window.location.search);
  if (!params.has(ACCESS_TOKEN_PARAM)) return;
  params.delete(ACCESS_TOKEN_PARAM);
  const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash}`;
  window.history.replaceState(null, '', next);
}

export function getRemoteAccessToken(): string {
  const fromUrl = readAccessTokenFromUrl();
  if (fromUrl) {
    persistAccessToken(fromUrl);
    stripAccessTokenFromUrl();
    return fromUrl;
  }
  return sessionStorage.getItem(ACCESS_TOKEN_STORAGE_KEY)?.trim() || '';
}

function isSameOriginRequest(input: RequestInfo | URL): boolean {
  const rawUrl = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
  const url = new URL(rawUrl, window.location.origin);
  return url.origin === window.location.origin;
}

export function installRemoteAccessFetch(): void {
  const token = getRemoteAccessToken();
  if (!token) return;

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isSameOriginRequest(input)) return originalFetch(input, init);

    if (input instanceof Request) {
      const headers = new Headers(input.headers);
      headers.set(ACCESS_TOKEN_HEADER, token);
      return originalFetch(new Request(input, { headers }), init);
    }

    const headers = new Headers(init?.headers);
    headers.set(ACCESS_TOKEN_HEADER, token);
    return originalFetch(input, { ...init, headers });
  };
}
