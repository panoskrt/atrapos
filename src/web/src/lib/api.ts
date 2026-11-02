/** Thin fetch wrapper for our own backend (same origin, cookie session). */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  /** The parsed JSON body, for endpoints whose error responses carry data (e.g. a 409 conflict). */
  readonly body: unknown;

  constructor(status: number, message: string, code?: string, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }

  /** The Suunto session is gone; the user has to sign in again. */
  get needsSignIn(): boolean {
    return this.status === 401;
  }
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  // The backend rejects unsafe requests without this header (CSRF defence).
  if (UNSAFE.has(method)) headers.set('X-RPM-CSRF', '1');
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(path, { ...init, method, headers, credentials: 'same-origin' });

  if (!res.ok) {
    let title = res.statusText || `Request failed (${res.status})`;
    let code: string | undefined;
    let body: unknown;
    try {
      body = await res.json();
      const b = body as { title?: string; code?: string };
      title = b.title ?? title;
      code = b.code;
    } catch {
      // Non-JSON error body; keep the status text.
    }
    throw new ApiError(res.status, title, code, body);
  }

  if (res.status === 204 || res.headers.get('Content-Length') === '0') return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => apiFetch<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
};
