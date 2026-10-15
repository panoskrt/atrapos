import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { routeKeys, saveRoute, type UpdateRouteRequest } from '../routes/api';
import type { Coord } from './geo';
import { toWire } from './segments';
import { useEditorStore } from './store';

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error';

const DEBOUNCE_MS = 800;

/** Saves the route shortly after each change, once every segment's geometry has settled. */
export function useAutosave(routeId: string, segments: Coord[][], geometryPending: boolean) {
  const qc = useQueryClient();
  const name = useEditorStore((s) => s.name);
  const description = useEditorStore((s) => s.description);
  const points = useEditorStore((s) => s.points);
  const activityIds = useEditorStore((s) => s.activityIds);
  const turnWaypointsEnabled = useEditorStore((s) => s.turnWaypointsEnabled);
  const routingProfile = useEditorStore((s) => s.routingProfile);
  const pois = useEditorStore((s) => s.pois);
  const setPoiServerState = useEditorStore((s) => s.setPoiServerState);
  const setSyncState = useEditorStore((s) => s.setSyncState);

  const body = useMemo<UpdateRouteRequest>(
    () => ({
      name: name.trim() || 'Untitled route',
      description: description.trim() || null,
      activityIds,
      turnWaypointsEnabled,
      routingProfile,
      controlPoints: points.map((p, i) => ({
        lon: p.lon,
        lat: p.lat,
        modeToNext: p.mode,
        segment: i < segments.length ? toWire(segments[i]!) : null,
      })),
      pois: pois.map((p) => ({
        id: p.id,
        name: p.name.trim() || 'POI',
        description: p.description.trim() || null,
        poiType: p.poiType,
        lon: p.lon,
        lat: p.lat,
        ele: p.ele,
      })),
    }),
    [name, description, activityIds, turnWaypointsEnabled, routingProfile, points, segments, pois],
  );
  const bodyKey = useMemo(() => JSON.stringify(body), [body]);

  const lastSaved = useRef<string | null>(null);
  const latest = useRef({ body, bodyKey });
  latest.current = { body, bodyKey };
  const geometryPendingRef = useRef(geometryPending);
  geometryPendingRef.current = geometryPending;
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [error, setError] = useState<string | null>(null);

  // The first settled state after loading is what the server already has.
  useEffect(() => {
    if (lastSaved.current === null && !geometryPending) lastSaved.current = bodyKey;
  }, [bodyKey, geometryPending]);

  /** Resolves true when the server has the latest state (saved now, or nothing to save). */
  const save = async (): Promise<boolean> => {
    const { body: b, bodyKey: k } = latest.current;
    // No baseline yet (still loading) or nothing changed: saving would only bump the modified time.
    if (lastSaved.current === null || k === lastSaved.current) return lastSaved.current !== null;
    setStatus('saving');
    try {
      const saved = await saveRoute(routeId, b);
      lastSaved.current = k;
      setSyncState(saved.syncState);
      setPoiServerState(Object.fromEntries(saved.pois.map((p) => [p.id, { syncState: p.syncState, suuntoPoiKey: p.suuntoPoiKey }])));
      setError(null);
      setStatus(latest.current.bodyKey === k ? 'saved' : 'pending');
      void qc.invalidateQueries({ queryKey: routeKeys.all, exact: true });
      return latest.current.bodyKey === k;
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : 'Save failed');
      return false;
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (lastSaved.current === null || bodyKey === lastSaved.current) return;
    setStatus('pending');
    if (geometryPending) return;
    const t = window.setTimeout(() => void saveRef.current(), DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [bodyKey, geometryPending]);

  // Leaving the editor: save what we have; warn on tab close if something is unsaved.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (lastSaved.current !== null && latest.current.bodyKey !== lastSaved.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      void saveRef.current();
    };
  }, []);

  return {
    status,
    error,
    retry: () => void saveRef.current(),
    /** Saves right away (used before pushing). False while the route is still being computed or if saving fails. */
    flush: async (): Promise<boolean> => (geometryPendingRef.current ? false : saveRef.current()),
  };
}
