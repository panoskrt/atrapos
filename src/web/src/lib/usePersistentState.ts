import { useState } from 'react';

/** useState that remembers its value in this browser. Storage can be missing or blocked, so it's best effort. */
export function usePersistentState<T>(key: string, fallback: T, isValid: (v: unknown) => v is T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      const parsed: unknown = raw === null ? null : JSON.parse(raw);
      return isValid(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  });

  const set = (next: T) => {
    setValue(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Not persisted; the choice still applies until the page is reloaded.
    }
  };

  return [value, set] as const;
}
