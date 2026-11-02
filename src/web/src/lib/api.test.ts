import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from './api';

function mockFetch(status: number, body?: unknown) {
  const fn = vi.fn().mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('api', () => {
  it('adds the CSRF header to unsafe requests only', async () => {
    const fetch = mockFetch(204);
    await api.post('/auth/logout');
    await api.get('/api/me').catch(() => undefined);

    const post = fetch.mock.calls[0]![1] as RequestInit;
    const get = fetch.mock.calls[1]![1] as RequestInit;
    expect(new Headers(post.headers).get('X-RPM-CSRF')).toBe('1');
    expect(new Headers(get.headers).has('X-RPM-CSRF')).toBe(false);
  });

  it('returns undefined for 204', async () => {
    mockFetch(204);
    await expect(api.post('/auth/logout')).resolves.toBeUndefined();
  });

  it('surfaces the problem title and code on errors', async () => {
    mockFetch(401, { title: 'Suunto session expired. Sign in again.', code: 'suunto_reauth' });

    const err = await api.get('/api/routes').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect((err as ApiError).code).toBe('suunto_reauth');
    expect((err as ApiError).message).toBe('Suunto session expired. Sign in again.');
    expect((err as ApiError).needsSignIn).toBe(true);
  });
});
