import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router';
import { Icon } from '../../components/Icon';
import { chooseAction } from '../../components/ConfirmDialog';
import { toast } from '../../components/Toast';
import { ApiError } from '../../lib/api';
import { routeKeys, useCreateRoute, useRoute, type RouteDetail, type UpdateRouteRequest } from '../routes/api';
import { loadBaseLayer, type BaseLayerId } from './baseLayers';
import { EditorActionBar, EditorSidebar } from './EditorSidebar';
import { ElevationProfile } from './ElevationProfile';
import { cumulativeDistances, joinSegments, stats } from './geo';
import { LayerSwitcher, MapToolbar } from './MapToolbar';
import { MapView } from './MapView';
import { displayPositions, seedSegments, segmentKey, toWire, useSegments, type SegmentFailure } from './segments';
import { PoiCard } from '../pois/PoiCard';
import { usePoiLocations } from '../pois/placement';
import { SectionAnalysis } from './SectionAnalysis';
import { SelectedPointBar } from './SelectedPointBar';
import { useEditorStore, useHoverStore, useSectionStore } from './store';
import { useManualSave } from './useManualSave';
import { useEditorShortcuts } from './useEditorShortcuts';
import { useUpdateUserSettings, useUserSettings } from '../profile/userSettings';
import styles from './Editor.module.css';

export function EditorPage() {
  const { id = '' } = useParams();
  return id === 'new' ? <NewRouteEditor /> : <ExistingRouteEditor id={id} />;
}

function ExistingRouteEditor({ id }: { id: string }) {
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
  // fresh undo history and saved-state baseline.
  return <LoadedEditor key={`${id}:${route.data.localModifiedAt}`} route={route.data} />;
}

function NewRouteEditor() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    useEditorStore.getState().startNew();
    useHoverStore.getState().setDistance(null);
    setReady(true);
  }, []);
  return ready ? <Editor routeId="new" hadLine={false} onReload={() => {}} isDraft /> : null;
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

function Editor({
  routeId,
  hadLine,
  onReload,
  isDraft = false,
}: {
  routeId: string;
  hadLine: boolean;
  onReload: () => void;
  isDraft?: boolean;
}) {
  const points = useEditorStore((s) => s.points);
  const profile = useEditorStore((s) => s.routingProfile);
  const { segments, snapped, pending, failures } = useSegments(points, profile);
  const line = useMemo(() => joinSegments(segments), [segments]);
  const cumulative = useMemo(() => cumulativeDistances(line), [line]);
  const routeStats = useMemo(() => stats(line), [line]);
  const markerPositions = useMemo(() => displayPositions(points, segments, snapped), [points, segments, snapped]);
  const qc = useQueryClient();
  const createRoute = useCreateRoute();
  const navigate = useNavigate();
  const name = useEditorStore((s) => s.name);
  const description = useEditorStore((s) => s.description);
  const activityIds = useEditorStore((s) => s.activityIds);
  const turnWaypointsEnabled = useEditorStore((s) => s.turnWaypointsEnabled);
  const routingProfile = useEditorStore((s) => s.routingProfile);
  const pois = useEditorStore((s) => s.pois);
  const request = useMemo<UpdateRouteRequest>(
    () => ({
      name: name.trim() || 'Untitled route',
      description: description.trim() || null,
      activityIds,
      turnWaypointsEnabled,
      routingProfile,
      controlPoints: points.map((point, index) => ({
        lon: point.lon,
        lat: point.lat,
        modeToNext: point.mode,
        segment: index < segments.length ? toWire(segments[index]!) : null,
      })),
      pois: pois.map((poi) => ({
        id: poi.id,
        name: poi.name.trim() || 'POI',
        description: poi.description.trim() || null,
        poiType: poi.poiType,
        lon: poi.lon,
        lat: poi.lat,
        ele: poi.ele,
      })),
    }),
    [name, description, activityIds, turnWaypointsEnabled, routingProfile, points, segments, pois],
  );
  const requestKey = useMemo(
    () =>
      JSON.stringify({
        ...request,
        controlPoints: request.controlPoints.map(({ lon, lat, modeToNext }) => ({ lon, lat, modeToNext })),
      }),
    [request],
  );
  const initialRequestKey = useRef(requestKey);
  const draftSaved = useRef(false);
  const draftDirty = isDraft && requestKey !== initialRequestKey.current;
  const manualSave = useManualSave(routeId, request, requestKey, pending, !isDraft);
  const isDirty = isDraft ? draftDirty : manualSave.isDirty;
  const blocker = useBlocker(() => isDirty && !draftSaved.current);
  const blockerHandled = useRef(false);
  const save = isDraft
    ? {
        status: draftDirty ? ('pending' as const) : ('saved' as const),
        error: null,
        retry: () => {},
        flush: async () => false,
      }
    : manualSave;

  const saveNow = async (navigateAfterCreate = true): Promise<boolean> => {
    if (isDraft) {
      if (points.length === 0) {
        toast('Add at least one map point before saving this route.', { tone: 'error' });
        return false;
      }
      if (pending || createRoute.isPending) {
        toast('Wait for route geometry to finish before saving.', { tone: 'error' });
        return false;
      }
      try {
        const created = await createRoute.mutateAsync(request);
        draftSaved.current = true;
        if (navigateAfterCreate) navigate(`/routes/${created.id}`, { replace: true });
        return true;
      } catch (error) {
        toast(`Couldn't save route: ${error instanceof Error ? error.message : 'Unknown error'}`, { tone: 'error' });
        return false;
      }
    }
    const saved = await manualSave.save();
    if (!saved) toast('Could not save all changes. Check the save status and try again.', { tone: 'error' });
    return saved;
  };
  const saveNowRef = useRef(saveNow);
  saveNowRef.current = saveNow;

  useEffect(() => {
    if (blocker.state !== 'blocked') {
      blockerHandled.current = false;
      return;
    }
    if (blockerHandled.current) return;
    blockerHandled.current = true;
    void chooseAction({
      title: 'Unsaved changes',
      body: 'Do you want to save your changes before returning to the dashboard?',
      cancelLabel: 'Cancel',
      alternativeLabel: 'No',
      confirmLabel: 'Yes',
      icon: 'alert',
    }).then((choice) => {
      if (choice === 'cancel') {
        blocker.reset();
      } else if (choice === 'alternative') {
        blocker.proceed();
      } else {
        void saveNowRef.current(false).then((saved) => (saved ? blocker.proceed() : blocker.reset()));
      }
    });
  }, [blocker]);

  useEffect(() => {
    if (!isDirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [isDirty]);

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
  // The leg that closed the loop now ends on the start point; it is the same line, so hand it over instead of re-routing.
  const startLoopHere = (id: string) => {
    const last = points.length - 1;
    const a = points[last - 1];
    if (a && segments[last - 1]) qc.setQueryData(segmentKey(a, points[0]!, a.mode, profile), segments[last - 1]);
    useEditorStore.getState().rotateLoop(id);
  };
  const poiLocations = usePoiLocations(pois, line, cumulative);
  const profilePois = useMemo(
    () =>
      pois.flatMap((p) => {
        const along = poiLocations.get(p.id)?.alongM;
        return along != null ? [{ id: p.id, name: p.name, alongM: along }] : [];
      }),
    [pois, poiLocations],
  );
  // Distances along the line stop meaning the same place once it changes.
  useEffect(() => {
    useSectionStore.getState().clear();
  }, [cumulative]);
  useEffect(() => () => useSectionStore.getState().clear(), []);
  const sectionPending = useSectionStore((s) => s.pending !== null);
  const [focus, setFocus] = useState<{ lon: number; lat: number; seq: number } | null>(null);
  const focusOn = (lon: number, lat: number) => setFocus((f) => ({ lon, lat, seq: (f?.seq ?? 0) + 1 }));
  const [baseLayer, setBaseLayer] = useState<BaseLayerId>(loadBaseLayer);
  const userSettings = useUserSettings();
  const updateUserSettings = useUpdateUserSettings();
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
      <EditorActionBar
        save={save}
        onSave={() => void saveNow()}
        savePending={isDraft ? createRoute.isPending : manualSave.status === 'saving'}
        canSave={isDraft ? points.length > 0 && !pending : manualSave.isDirty && !pending}
      />
      <EditorSidebar
        stats={routeStats}
        vertexCount={line.length}
        save={save}
        poiLocations={poiLocations}
        onFocus={focusOn}
        routeId={routeId}
        onReload={onReload}
        isDraft={isDraft}
        onSave={() => void saveNow()}
        savePending={isDraft ? createRoute.isPending : manualSave.status === 'saving'}
        canSave={isDraft ? points.length > 0 && !pending : manualSave.isDirty && !pending}
      />
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
              if (userSettings.data && userSettings.data.defaultMap !== l) {
                updateUserSettings.mutate(
                  { ...userSettings.data, defaultMap: l },
                  { onError: (error) => toast(`Couldn't save the default map: ${error.message}`, { tone: 'error' }) },
                );
              }
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
          <SectionAnalysis line={line} cumulative={cumulative} pois={profilePois} />
          {!isDraft && <SelectedPointBar routeId={routeId} flush={save.flush} onReload={onReload} onStartHere={startLoopHere} />}
          <div className={styles.hint}>
            <Icon name={tool === 'extend' ? 'routePlus' : tool === 'poi' ? 'pinPlus' : tool === 'section' ? 'ruler' : 'cursor'} size={16} />
            {tool === 'extend'
              ? points.length === 0
                ? 'Click the map to place the start'
                : 'Click to extend · drag ○ on the line to add a point between'
              : tool === 'section'
                ? sectionPending
                  ? 'Click the second point on the route · Esc to cancel'
                  : 'Click two points on the route (or its markers) to analyse the section between them'
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
