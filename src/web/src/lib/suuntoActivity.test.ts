import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useSuuntoActivity, withSuunto } from './suuntoActivity';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('withSuunto', () => {
  it('shows the latest call while any is running and clears when all settle', async () => {
    const { result } = renderHook(() => useSuuntoActivity());
    const a = deferred<number>();
    const b = deferred<number>();

    let pa!: Promise<number>;
    let pb!: Promise<number>;
    act(() => {
      pa = withSuunto('Pushing the route', () => a.promise);
      pb = withSuunto('Pushing 2 POIs', () => b.promise);
    });
    expect(result.current).toBe('Pushing 2 POIs');

    await act(async () => {
      b.resolve(2);
      await pb;
    });
    expect(result.current).toBe('Pushing the route');

    await act(async () => {
      a.resolve(1);
      await expect(pa).resolves.toBe(1);
    });
    expect(result.current).toBeNull();
  });

  it('clears after a failure and passes the error on', async () => {
    const { result } = renderHook(() => useSuuntoActivity());
    const d = deferred<void>();
    let p!: Promise<void>;
    act(() => {
      p = withSuunto('Refreshing', () => d.promise);
    });
    expect(result.current).toBe('Refreshing');

    await act(async () => {
      d.reject(new Error('Suunto is down'));
      await expect(p).rejects.toThrow('Suunto is down');
    });
    expect(result.current).toBeNull();
  });
});
