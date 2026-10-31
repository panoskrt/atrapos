import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

/** List filters and the page number live in the URL, so a filtered view can be linked to and survives reloads. */
export function useListParams<K extends string>(keys: readonly K[]) {
  const [search, setSearch] = useSearchParams();
  const params = {} as Record<K, string>;
  for (const k of keys) params[k] = search.get(k) ?? '';
  const page = Math.max(Number(search.get('page')) || 1, 1);

  const set = useCallback(
    (patch: Record<string, string | number | undefined>) => {
      setSearch(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined || v === '') next.delete(k);
            else next.set(k, String(v));
          }
          if (!('page' in patch)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setSearch],
  );

  return { params, page, set };
}
