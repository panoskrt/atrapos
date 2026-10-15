import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Icon } from '../../components/Icon';
import { ApiError } from '../../lib/api';
import { routeKeys, useRoute, type RouteDetail } from '../routes/api';
import { loadBaseLayer, storeBaseLayer, type BaseLayerId } from './baseLayers';
import { EditorSidebar } from './EditorSidebar';
import { ElevationProfile } from './ElevationProfile';
import { cumulativeDistances, joinSegments, stats } from './geo';
import { LayerSwitcher, MapToolbar } from './MapToolbar';
import { MapView } from './MapView';
import { displayPositions, seedSegments, segmentKey, useSegments, type SegmentFailure } from './segments';
import { PoiCard } from '../pois/PoiCard';
import { usePoiLocations } from '../pois/placement';
import { SelectedPointBar } from './SelectedPointBar';
import { useEditorStore, useHoverStore } from './store';
import { useAutosave } from './useAutosave';
import { useEditorShortcuts } from './useEditorShortcuts';
import styles from './Editor.module.css';

export function EditorPage() {
  const { id = '' } = useParams();
  const route = useRoute(id);

  if (route.isPending) return <div className={styles.centered} aria-busy="true">Loading route…</div>;
  if (route.isError)
    return (
      <div className={styles.centered} role="alert">
        <p>
          {route.error instanceof ApiError && route.error.status === 404
            ? "This route doesn't exist."
            : `Couldn't load the route: ${route.error.message}`}
        </p>
        <Link to="/" className="btn">
          Back to library
        </Link>
      </div>
    );

  // Keyed by the server's modified time too: a reload after taking the Suunto version remounts the editor with a
  // fresh undo history and autosave baseline. Autosave itself never refetches the route, so editing doesn't remount.
  return <LoadedEditor key={`${id}:${route.data.localModifiedAt}`} route={route.data} />;
}

function LoadedEditor({ route }: { route: RouteDetail }) {
  const qc = useQueryClient();
  const [ready, setReady] = useState(false);
  const reload = () => void qc.resetQueries({ queryKey: routeKeys.detail(route.id) });

  // Seed cached segments before the store renders them, so nothing is recomputed on open.
  useEffect(() => {
    seedSegments(qc, route.controlPoints, route.routingProfile);
    useEditorStore.getState().load(route);
    useHoverStore.getState().setDistance(null);
    setReady(true);
  }, [qc, route]);

  return ready ? <Editor routeId={route.id} hadLine={route.controlPoints.length > 1} onReload={reload} /> : null;
}

interface SnapNotice {
  message: string;
  /** Points whose outgoing segment fell back to freehand. */
  ids: string[];
  retryable: boolean;
}

function Editor({ routeId, hadLine, onReload }: { routeId: string; hadLine: boolean; onReload: () => void }) {
  const points = useEditorStore((s) => s.points);
  const profile = useEditorStore((s) => s.routingProfile);
  const { segments, snapped, pending, failures } = useSegments(points, profile);
  const line = useMemo(() => joinSegments(segments), [segments]);
  const cumulative = useMemo(() => cumulativeDistances(line), [line]);
  const routeStats = useMemo(() => stats(line), [line]);
  const markerPositions = useMemo(() => displayPositions(points, segments, snapped), [points, segments, snapped]);
  const save = useAutosave(routeId, segments, pending);
  const qc = useQueryClient();

  // Freehand legs are the same line backwards, so seed them reversed instead of recomputing; snapped legs are
  // re-routed, because one-way paths make direction matter (especially on bike profiles).
  const reverseRoute = () => {
    points.slice(0, -1).forEach((a, i) => {
      const b = points[i + 1]!;
      if (a.mode === 'freehand' && segments[i])
        qc.setQueryData(segmentKey(b, a, 'freehand', profile), [...segments[i]!].reverse());
    });
    useEditorStore.getState().reverse();
  };
  const pois = useEditorStore((s) => s.pois);
  const poiLocations = usePoiLocations(pois, line, cumulative);
  const profilePois = useMemo(
    () =>
      pois.flatMap((p) => {
        const along = poiLocations.get(p.id)?.alongM;
        return along != null ? [{ id: p.id, name: p.name, alongM: along }] : [];
      }),
    [pois, poiLocations],
  );
  const [focus, setFocus] = useState<{ lon: number; lat: number; seq: number } | null>(null);
  const focusOn = (lon: number, lat: number) => setFocus((f) => ({ lon, lat, seq: (f?.seq ?? 0) + 1 }));
  const [baseLayer, setBaseLayer] = useState<BaseLayerId>(loadBaseLayer);
  const [fitRequest, setFitRequest] = useState(hadLine ? 1 : 0);
  const [locateRequest, setLocateRequest] = useState(0);
  const [notice, setNotice] = useState<SnapNotice | null>(null);
  const tool = useEditorStore((s) => s.tool);
  useEditorShortcuts();

  // A snapped segment that can't be routed falls back to a straight line, and the user is told.
  useSnapFallback(failures, setNotice);

  const retrySnap = () => {
    if (!notice) return;
    useEditorStore.getState().setSegmentModesSilently(notice.ids, 'snap');
    setNotice(null);
  };

  const routing = pending && points.some((p, i) => p.mode === 'snap' && i < points.length - 1 && !snapped[i]);

  return (
    <div className={styles.editor}>
      <EditorSidebar stats={routeStats} vertexCount={line.length} save={save} poiLocations={poiLocations} onFocus={focusOn} routeId={routeId} onReload={onReload} />
      <div className={styles.mapColumn}>
        <div className={styles.mapWrap}>
          <MapView
            segments={segments}
            line={line}
            cumulative={cumulative}
            markerPositions={markerPositions}
            baseLayer={baseLayer}
            fitRequest={fitRequest}
            locateRequest={locateRequest}
            focus={focus}
          />
          <PoiCard line={line} cumulative={cumulative} locations={poiLocations} />
          <MapToolbar
            canFit={line.length > 1}
            onFit={() => setFitRequest((n) => n + 1)}
            onLocate={() => setLocateRequest((n) => n + 1)}
            onReverse={reverseRoute}
          />
          <LayerSwitcher
            value={baseLayer}
            onChange={(l) => {
              setBaseLayer(l);
              storeBaseLayer(l);
            }}
          />
          {notice ? (
            <div className={styles.notice} role="alert">
              <Icon name="alert" size={18} />
              <span>{notice.message}</span>
              {notice.retryable && (
                <button type="button" className={styles.linkBtn} onClick={retrySnap}>
                  Retry snapping
                </button>
              )}
              <button type="button" className={styles.noticeClose} onClick={() => setNotice(null)} aria-label="Dismiss">
                <Icon name="close" size={16} />
              </button>
            </div>
          ) : routing ? (
            <div className={styles.notice} role="status">
              <span className={styles.spinner} aria-hidden="true" />
              Finding the trail…
            </div>
          ) : null}
          <SelectedPointBar routeId={routeId} flush={save.flush} onReload={onReload} />
          <div className={styles.hint}>
            <Icon name={tool === 'extend' ? 'routePlus' : tool === 'poi' ? 'pinPlus' : 'cursor'} size={16} />
            {tool === 'extend'
              ? points.length === 0
                ? 'Click the map to place the start'
                : 'Click to extend · drag ○ on the line to add a point between'
              : tool === 'poi'
                ? 'Click to place a POI · clicks near the route snap onto it'
                : 'Drag points and POIs to move · right-click a point to delete'}
          </div>
        </div>
        <ElevationProfile line={line} cumulative={cumulative} pending={pending} pois={profilePois} />
      </div>
    </div>
  );
}

function useSnapFallback(failures: SegmentFailure[], setNotice: (n: SnapNotice) => void) {
  const failureKey = failures.map((f) => `${f.index}:${f.error.code}`).join('|');

  useEffect(() => {
    if (failures.length === 0) return;
    const { points, setSegmentModesSilently } = useEditorStore.getState();
    const ids = failures.map((f) => points[f.index]?.id).filter((id): id is string => !!id);
    if (ids.length === 0) return;
    setSegmentModesSilently(ids, 'freehand');

    const first = failures[0]!.error;
    const unavailable = failures.some((f) => !f.error.permanent);
    setNotice({
      ids,
      retryable: unavailable,
      message: unavailable
        ? 'The routing service is unavailable, so the segment was drawn as a straight line.'
        : `${first.message} The segment was drawn as a straight line.`,
    });
    // Keyed on failureKey: the failures array is a new object on every render.
  }, [failureKey]);
}
