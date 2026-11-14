import { create } from 'zustand';
import { temporal } from 'zundo';
import type { DrawMode, RouteDetail, SegmentMode, SyncState } from '../routes/api';
import { distanceM, joinSegments, type LonLat } from './geo';
import { cachedSegment, cacheSegment, legMode } from './segments';

export interface EditorPoint extends LonLat {
  id: string;
  /** How the segment from this point to the next is built. */
  mode: SegmentMode;
}

export interface EditorPoi extends LonLat {
  /** Stable UUID; the server uses it to match edits, deletes and undo-restores. */
  id: string;
  name: string;
  description: string;
  poiType: number;
  ele: number | null;
}

/** A route is a loop when it ends within this distance of where it starts. */
export const LOOP_CLOSE_TOLERANCE_M = 25;

export function isLoop(points: LonLat[]): boolean {
  return points.length >= 3 && distanceM(points[0]!, points.at(-1)!) <= LOOP_CLOSE_TOLERANCE_M;
}

export type Tool = 'select' | 'extend' | 'poi' | 'section';

/** The parts of the route that undo/redo covers. Text fields rely on the browser's own undo. */
interface UndoableDoc {
  points: EditorPoint[];
  pois: EditorPoi[];
  activityIds: number[];
  turnWaypointsEnabled: boolean;
  routingProfile: string;
}

export interface PoiServerState {
  syncState: SyncState;
  suuntoPoiKey: string | null;
}

interface EditorState extends UndoableDoc {
  routeId: string | null;
  name: string;
  description: string;
  syncState: SyncState;
  /** Per POI id, as last reported by the server. Kept for deleted POIs too, so undo shows the right state. */
  poiServer: Record<string, PoiServerState>;
  selectedId: string | null;
  selectedPoiId: string | null;
  tool: Tool;
  drawMode: DrawMode;

  load: (route: RouteDetail) => void;
  startNew: () => void;
  setName: (name: string) => void;
  setDescription: (description: string) => void;
  toggleActivity: (id: number) => void;
  setTurnWaypoints: (on: boolean) => void;
  setRoutingProfile: (profile: string) => void;
  setSyncState: (s: SyncState) => void;
  setPoiServerState: (states: Record<string, PoiServerState>) => void;
  /** Mode of the segments that start at these points (one undo step). */
  setSegmentMode: (ids: string | string[], mode: SegmentMode) => void;

  addPoint: (p: LonLat) => void;
  /** Inserts a point into the segment that ends at `index`. With `keepLine` the caller has cached the two halves
   *  of the old line, so a recorded leg stays recorded; otherwise the point is about to go somewhere new and a
   *  recorded leg is re-routed. */
  insertPoint: (index: number, p: LonLat, options?: { keepLine?: boolean }) => void;
  /** Moves a point; recorded legs ending at it are re-routed (snap), the others keep their mode. */
  movePoint: (id: string, p: LonLat) => void;
  /** Deletes a point. Two recorded legs either side merge into one with the same line; any other recorded leg
   *  that now spans the gap is re-routed. */
  deletePoint: (id: string) => void;
  /** Reverses the direction; each segment keeps its mode. */
  reverse: () => void;
  /** For a loop: makes this inner point the start and end, keeping the route itself the same. */
  rotateLoop: (id: string) => void;
  /** Removes everything before this point (it becomes the start). */
  trimBefore: (id: string) => void;
  /** Removes everything after this point (it becomes the end). */
  trimAfter: (id: string) => void;
  select: (id: string | null) => void;

  addPoi: (p: LonLat & { ele: number | null }) => string;
  updatePoi: (id: string, patch: Partial<Omit<EditorPoi, 'id'>>) => void;
  /** Fills in an elevation looked up after placing, without an undo step. */
  setPoiElevationSilently: (id: string, ele: number | null) => void;
  deletePoi: (id: string) => void;
  selectPoi: (id: string | null) => void;

  setTool: (tool: Tool) => void;
  setDrawMode: (mode: DrawMode) => void;
}

let counter = 0;
const newId = () => `p${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Recorded legs re-route once an end moves: the recorded line no longer fits the new end. */
const rerouted = (mode: SegmentMode): SegmentMode => (mode === 'track' ? 'snap' : mode);

/** Runs a state change without recording an undo step. */
function silently(fn: () => void) {
  const t = useEditorStore.temporal.getState();
  t.pause();
  try {
    fn();
  } finally {
    t.resume();
  }
}

export const useEditorStore = create<EditorState>()(
  temporal(
    (set, get) => ({
      routeId: null,
      name: '',
      description: '',
      syncState: 'localOnly',
      poiServer: {},
      points: [],
      pois: [],
      activityIds: [],
      turnWaypointsEnabled: false,
      routingProfile: 'hiking-mountain',
      selectedId: null,
      selectedPoiId: null,
      tool: 'extend',
      drawMode: 'snap',

      load: (route) => {
        set({
          routeId: route.id,
          name: route.name,
          description: route.description ?? '',
          syncState: route.syncState,
          activityIds: route.activityIds,
          turnWaypointsEnabled: route.turnWaypointsEnabled,
          routingProfile: route.routingProfile,
          points: route.controlPoints.map((cp) => ({ id: newId(), lon: cp.lon, lat: cp.lat, mode: legMode(cp) })),
          pois: route.pois.map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description ?? '',
            poiType: p.poiType,
            lon: p.lon,
            lat: p.lat,
            ele: p.ele,
          })),
          poiServer: Object.fromEntries(route.pois.map((p) => [p.id, { syncState: p.syncState, suuntoPoiKey: p.suuntoPoiKey }])),
          selectedId: null,
          selectedPoiId: null,
          tool: route.controlPoints.length < 2 ? 'extend' : 'select',
        });
        // A freshly opened route starts with an empty history.
        useEditorStore.temporal.getState().clear();
      },
      startNew: () => {
        set({
          routeId: null,
          name: 'Untitled route',
          description: '',
          syncState: 'localOnly',
          poiServer: {},
          points: [],
          pois: [],
          activityIds: [11],
          turnWaypointsEnabled: false,
          routingProfile: 'hiking-mountain',
          selectedId: null,
          selectedPoiId: null,
          tool: 'extend',
          drawMode: 'snap',
        });
        useEditorStore.temporal.getState().clear();
      },
      setName: (name) => set({ name }),
      setDescription: (description) => set({ description }),
      toggleActivity: (id) => {
        const current = get().activityIds;
        if (current.includes(id)) {
          // Suunto needs at least one activity.
          if (current.length > 1) set({ activityIds: current.filter((a) => a !== id) });
        } else if (current.length < 10) {
          set({ activityIds: [...current, id] });
        }
      },
      setTurnWaypoints: (on) => set({ turnWaypointsEnabled: on }),
      setRoutingProfile: (routingProfile) => set({ routingProfile }),
      setSyncState: (syncState) => set({ syncState }),
      setPoiServerState: (states) => set({ poiServer: { ...get().poiServer, ...states } }),
      setSegmentMode: (ids, mode) => {
        const list = typeof ids === 'string' ? [ids] : ids;
        set({ points: get().points.map((p) => (list.includes(p.id) ? { ...p, mode } : p)) });
      },

      addPoint: (p) => {
        const point: EditorPoint = { id: newId(), lon: p.lon, lat: p.lat, mode: get().drawMode };
        // The previous last point's segment now leads to the new point, drawn in the current mode.
        const points = get().points.map((x, i, all) => (i === all.length - 1 ? { ...x, mode: get().drawMode } : x));
        set({ points: [...points, point], selectedId: point.id, selectedPoiId: null });
      },
      insertPoint: (index, p, options) => {
        const points = [...get().points];
        // Both halves take the mode of the segment being split.
        const split = points[index - 1]?.mode ?? get().drawMode;
        const mode = options?.keepLine ? split : rerouted(split);
        if (points[index - 1]) points[index - 1] = { ...points[index - 1]!, mode };
        const point: EditorPoint = { id: newId(), lon: p.lon, lat: p.lat, mode };
        points.splice(index, 0, point);
        set({ points, selectedId: point.id, selectedPoiId: null });
      },
      movePoint: (id, p) => {
        const points = get().points;
        const i = points.findIndex((x) => x.id === id);
        if (i < 0) return;
        set({
          points: points.map((x, j) =>
            j === i ? { ...x, lon: p.lon, lat: p.lat, mode: rerouted(x.mode) } : j === i - 1 ? { ...x, mode: rerouted(x.mode) } : x,
          ),
        });
      },
      deletePoint: (id) => {
        const points = get().points;
        const i = points.findIndex((x) => x.id === id);
        if (i < 0) return;
        const prev = points[i - 1];
        const next = points[i + 1];
        let merged = prev?.mode;
        if (prev && next && prev.mode === 'track') {
          // Two recorded legs join into one with exactly the same line; anything else is re-routed.
          const profile = get().routingProfile;
          const before = points[i]!.mode === 'track' ? cachedSegment(prev, points[i]!, 'track', profile) : undefined;
          const after = before ? cachedSegment(points[i]!, next, 'track', profile) : undefined;
          if (before && after) cacheSegment(prev, next, 'track', profile, joinSegments([before, after]));
          else merged = 'snap';
        }
        set({
          points: points.filter((x) => x.id !== id).map((x) => (x === prev && merged ? { ...x, mode: merged } : x)),
          selectedId: get().selectedId === id ? null : get().selectedId,
        });
      },
      reverse: () => {
        const pts = get().points;
        if (pts.length < 2) return;
        // Segment i (pts[i] → pts[i+1]) is owned by pts[i]; reversed, the same leg is owned by pts[i+1].
        const reversed = pts.map((p, i) => ({ ...p, mode: i > 0 ? pts[i - 1]!.mode : p.mode })).reverse();
        set({ points: reversed });
      },
      rotateLoop: (id) => {
        const pts = get().points;
        const k = pts.findIndex((p) => p.id === id);
        if (!isLoop(pts) || k < 1 || k > pts.length - 2) return;
        // The old end sits on the old start, so it is dropped and the start point takes its place at the seam.
        // Leg i belongs to point i, so every leg keeps its mode and its own two ends.
        set({ points: [...pts.slice(k, -1), pts[0]!, ...pts.slice(1, k), { ...pts[k]!, id: newId() }] });
      },
      trimBefore: (id) => {
        const i = get().points.findIndex((p) => p.id === id);
        if (i > 0) set({ points: get().points.slice(i) });
      },
      trimAfter: (id) => {
        const pts = get().points;
        const i = pts.findIndex((p) => p.id === id);
        if (i >= 0 && i < pts.length - 1) set({ points: pts.slice(0, i + 1) });
      },
      select: (selectedId) => set({ selectedId, selectedPoiId: selectedId ? null : get().selectedPoiId }),

      addPoi: (p) => {
        const id = crypto.randomUUID();
        const poi: EditorPoi = { id, name: `POI ${get().pois.length + 1}`, description: '', poiType: 26, lon: p.lon, lat: p.lat, ele: p.ele };
        set({ pois: [...get().pois, poi], selectedPoiId: id, selectedId: null });
        return id;
      },
      updatePoi: (id, patch) => set({ pois: get().pois.map((p) => (p.id === id ? { ...p, ...patch } : p)) }),
      setPoiElevationSilently: (id, ele) =>
        silently(() => set({ pois: get().pois.map((p) => (p.id === id ? { ...p, ele } : p)) })),
      deletePoi: (id) =>
        set({
          pois: get().pois.filter((p) => p.id !== id),
          selectedPoiId: get().selectedPoiId === id ? null : get().selectedPoiId,
        }),
      selectPoi: (selectedPoiId) => set({ selectedPoiId, selectedId: selectedPoiId ? null : get().selectedId }),

      setTool: (tool) => set({ tool }),
      setDrawMode: (drawMode) => set({ drawMode }),
    }),
    {
      partialize: (s): UndoableDoc => ({
        points: s.points,
        pois: s.pois,
        activityIds: s.activityIds,
        turnWaypointsEnabled: s.turnWaypointsEnabled,
        routingProfile: s.routingProfile,
      }),
      // Only record a step when an undoable field actually changed (not on selection or tool changes).
      equality: (a, b) =>
        a.points === b.points &&
        a.pois === b.pois &&
        a.activityIds === b.activityIds &&
        a.turnWaypointsEnabled === b.turnWaypointsEnabled &&
        a.routingProfile === b.routingProfile,
      limit: 200,
    },
  ),
);

/** Transient UI state shared by the map and the elevation profile. Not undoable, not saved. */
export const useHoverStore = create<{ distance: number | null; setDistance: (d: number | null) => void }>()((set) => ({
  distance: null,
  setDistance: (distance) => set({ distance }),
}));

/** A chosen part of the route, as distances along it. Transient like the hover: not undoable, not saved, and
 *  cleared whenever the line changes (distances along it would no longer mean the same place). */
interface SectionState {
  from: number | null;
  to: number | null;
  /** First point of a two-point pick, waiting for the second. */
  pending: number | null;
  /** Bumped to ask the map to zoom to the section. */
  fitSeq: number;
  /** Sets the section from two distances in either order. */
  setRange: (a: number, b: number) => void;
  setFrom: (d: number) => void;
  setTo: (d: number) => void;
  /** Two-point pick: the first call remembers the point, the second completes the section. */
  pick: (d: number) => void;
  clear: () => void;
  requestFit: () => void;
}

export const useSectionStore = create<SectionState>()((set, get) => ({
  from: null,
  to: null,
  pending: null,
  fitSeq: 0,
  setRange: (a, b) => set({ from: Math.min(a, b), to: Math.max(a, b), pending: null }),
  setFrom: (d) => {
    const { to } = get();
    if (to !== null) set({ from: Math.min(d, to) });
  },
  setTo: (d) => {
    const { from } = get();
    if (from !== null) set({ to: Math.max(d, from) });
  },
  pick: (d) => {
    const { pending } = get();
    if (pending === null) set({ pending: d, from: null, to: null });
    else set({ from: Math.min(pending, d), to: Math.max(pending, d), pending: null });
  },
  clear: () => set({ from: null, to: null, pending: null }),
  requestFit: () => set({ fitSeq: get().fitSeq + 1 }),
}));
