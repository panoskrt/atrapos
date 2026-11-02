import { useCallback, useMemo, useRef, useState } from 'react';

export interface Selection {
  /** Selected ids that are still visible. Hidden items are never acted on. */
  ids: string[];
  count: number;
  has: (id: string) => boolean;
  /** Shift extends from the last toggled item, like a file manager. */
  toggle: (id: string, extend?: boolean) => void;
  /** Selects all of `ids` (default: everything visible), or clears them when they're all selected already. */
  toggleAll: (ids?: readonly string[]) => void;
  /** 'all' | 'some' | 'none' of `ids` (default: everything visible) are selected; drives tri-state checkboxes. */
  stateOf: (ids?: readonly string[]) => 'all' | 'some' | 'none';
  clear: () => void;
}

/** Multi-select over an ordered list of visible ids. */
export function useSelection(visible: readonly string[]): Selection {
  const [raw, setRaw] = useState<ReadonlySet<string>>(() => new Set());
  const anchor = useRef<string | null>(null);

  const ids = useMemo(() => visible.filter((id) => raw.has(id)), [visible, raw]);
  const selected = useMemo(() => new Set(ids), [ids]);

  const toggle = useCallback(
    (id: string, extend = false) => {
      const from = anchor.current ? visible.indexOf(anchor.current) : -1;
      const to = visible.indexOf(id);
      setRaw((prev) => {
        const next = new Set(prev);
        if (extend && from >= 0 && to >= 0) {
          // The range takes the anchor's state, so shift-click can also deselect a run.
          const on = prev.has(visible[from]!);
          for (const v of visible.slice(Math.min(from, to), Math.max(from, to) + 1)) on ? next.add(v) : next.delete(v);
        } else if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      anchor.current = id;
    },
    [visible],
  );

  const stateOf = useCallback(
    (of: readonly string[] = visible) => {
      const n = of.filter((id) => selected.has(id)).length;
      return n === 0 ? 'none' : n === of.length ? 'all' : 'some';
    },
    [visible, selected],
  );

  const toggleAll = useCallback(
    (of: readonly string[] = visible) => {
      const all = of.length > 0 && of.every((id) => selected.has(id));
      setRaw((prev) => {
        const next = new Set(prev);
        for (const id of of) all ? next.delete(id) : next.add(id);
        return next;
      });
    },
    [visible, selected],
  );

  const clear = useCallback(() => {
    setRaw(new Set());
    anchor.current = null;
  }, []);

  return { ids, count: ids.length, has: (id) => selected.has(id), toggle, toggleAll, stateOf, clear };
}
