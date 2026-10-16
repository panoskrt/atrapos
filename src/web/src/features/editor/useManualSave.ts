import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { routeKeys, saveRoute, type UpdateRouteRequest } from '../routes/api';
import { useEditorStore } from './store';

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error';

/** Persists editor changes only when the user explicitly saves. */
export function useManualSave(routeId: string, body: UpdateRouteRequest, bodyKey: string, geometryPending: boolean, enabled = true) {
  const qc = useQueryClient();
  const setPoiServerState = useEditorStore((s) => s.setPoiServerState);
  const setSyncState = useEditorStore((s) => s.setSyncState);
  const savedKey = useRef(bodyKey);
  const latest = useRef({ body, bodyKey });
  latest.current = { body, bodyKey };
  const geometryPendingRef = useRef(geometryPending);
  geometryPendingRef.current = geometryPending;
  const inFlight = useRef<Promise<boolean> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDirty = enabled && bodyKey !== savedKey.current;

  const save = async (): Promise<boolean> => {
    if (!enabled || geometryPendingRef.current) return false;
    if (inFlight.current) return inFlight.current;
    const { body: currentBody, bodyKey: currentKey } = latest.current;
    if (currentKey === savedKey.current) return true;

    setSaving(true);
    setError(null);
    const operation = (async () => {
      const saved = await saveRoute(routeId, currentBody);
      savedKey.current = currentKey;
      setSyncState(saved.syncState);
      setPoiServerState(Object.fromEntries(saved.pois.map((p) => [p.id, { syncState: p.syncState, suuntoPoiKey: p.suuntoPoiKey }])));
      void qc.invalidateQueries({ queryKey: routeKeys.detail(routeId), exact: true, refetchType: 'none' });
      void qc.invalidateQueries({ queryKey: routeKeys.all, exact: true });
      return latest.current.bodyKey === currentKey;
    })();
    inFlight.current = operation;
    try {
      return await operation;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
      return false;
    } finally {
      inFlight.current = null;
      setSaving(false);
    }
  };

  const status: SaveStatus = saving ? 'saving' : error && isDirty ? 'error' : isDirty ? 'pending' : 'saved';

  return {
    status,
    error,
    isDirty,
    save,
    retry: () => void save(),
    /** True only if all edits are already saved; this never saves implicitly. */
    flush: async (): Promise<boolean> => enabled && !geometryPendingRef.current && latest.current.bodyKey === savedKey.current,
  };
}
