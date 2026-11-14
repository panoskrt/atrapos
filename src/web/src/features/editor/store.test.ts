import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RouteDetail } from '../routes/api';
import type { Coord } from './geo';
import { bindSegmentCache, cachedSegment, cacheSegment } from './segments';
import { useEditorStore } from './store';

const route = (controlPoints: RouteDetail['controlPoints'] = [], pois: RouteDetail['pois'] = []): RouteDetail => ({
  pois,
  id: 'r1',
  name: 'Test',
  description: null,
  activityIds: [11],
  turnWaypointsEnabled: false,
  routingProfile: 'hiking-mountain',
  source: 'drawn',
  syncState: 'localOnly',
  suuntoRouteId: null,
  distanceM: 0,
  ascentM: 0,
  descentM: 0,
  hasElevation: false,
  controlPoints,
  createdAt: '',
  localModifiedAt: '',
});

const s = () => useEditorStore.getState();
const t = () => useEditorStore.temporal.getState();
const lons = () => s().points.map((p) => p.lon);

describe('editor store', () => {
  beforeEach(() => s().load(route()));

  it('starts a new route with clean defaults and empty history', () => {
    s().load(
      route(
        [{ lon: 24, lat: 60, modeToNext: 'freehand' }],
        [
          {
            id: 'poi-1',
            name: 'Hut',
            description: null,
            poiType: 9,
            lon: 24,
            lat: 60,
            ele: null,
            distanceAlongM: null,
            syncState: 'synced',
            suuntoPoiKey: 'key-1',
          },
        ],
      ),
    );
    s().setName('Old route');
    s().setDescription('Old description');
    s().addPoint({ lon: 25, lat: 61 });
    s().setDrawMode('freehand');
    s().setTool('poi');

    s().startNew();

    expect(s()).toMatchObject({
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
    expect(s().tool).toBe('extend');
    expect(t().pastStates).toHaveLength(0);
  });

  it('opens an existing route in select mode', () => {
    s().load(
      route([
        { lon: 1, lat: 1, modeToNext: 'freehand' },
        { lon: 2, lat: 2, modeToNext: 'freehand' },
      ]),
    );
    expect(s().tool).toBe('select');
    expect(lons()).toEqual([1, 2]);
  });

  it('adds, inserts, moves and deletes points with undo/redo', () => {
    s().addPoint({ lon: 1, lat: 0 });
    s().addPoint({ lon: 3, lat: 0 });
    s().insertPoint(1, { lon: 2, lat: 0 });
    expect(lons()).toEqual([1, 2, 3]);

    const middle = s().points[1]!.id;
    s().movePoint(middle, { lon: 2.5, lat: 0.5 });
    expect(lons()).toEqual([1, 2.5, 3]);

    s().deletePoint(middle);
    expect(lons()).toEqual([1, 3]);

    t().undo();
    expect(lons()).toEqual([1, 2.5, 3]);
    t().undo();
    expect(lons()).toEqual([1, 2, 3]);
    t().redo();
    expect(lons()).toEqual([1, 2.5, 3]);
  });

  it('does not record selection or tool changes in history', () => {
    s().addPoint({ lon: 1, lat: 0 });
    const before = t().pastStates.length;
    s().select(null);
    s().setTool('select');
    s().setName('Renamed');
    expect(t().pastStates).toHaveLength(before);
  });

  it('keeps at least one activity', () => {
    s().toggleActivity(11);
    expect(s().activityIds).toEqual([11]);
    s().toggleActivity(22);
    s().toggleActivity(11);
    expect(s().activityIds).toEqual([22]);
  });

  it('sets the mode of several segments in one undo step', () => {
    s().addPoint({ lon: 1, lat: 0 });
    s().addPoint({ lon: 2, lat: 0 });
    s().addPoint({ lon: 3, lat: 0 });
    const ids = s().points.slice(0, 2).map((p) => p.id);
    const steps = t().pastStates.length;

    s().setSegmentMode(ids, 'freehand');

    expect(s().points.map((p) => p.mode)).toEqual(['freehand', 'freehand', 'snap']);
    expect(t().pastStates).toHaveLength(steps + 1);
  });

  it('makes routing profile and segment mode changes undoable', () => {
    s().addPoint({ lon: 1, lat: 0 });
    s().addPoint({ lon: 2, lat: 0 });
    s().setRoutingProfile('mtb');
    s().setSegmentMode(s().points[0]!.id, 'freehand');

    t().undo();
    expect(s().points[0]!.mode).toBe('snap');
    t().undo();
    expect(s().routingProfile).toBe('hiking-mountain');
  });

  it('adds, edits and deletes POIs with undo, keeping the same id', () => {
    const id = s().addPoi({ lon: 24.5, lat: 60.3, ele: 120 });
    expect(s().selectedPoiId).toBe(id);
    s().updatePoi(id, { name: 'Spring', poiType: 12 });
    s().deletePoi(id);
    expect(s().pois).toHaveLength(0);

    t().undo();
    expect(s().pois[0]).toMatchObject({ id, name: 'Spring', poiType: 12 });
    t().undo();
    expect(s().pois[0]!.name).toBe('POI 1');
  });

  it('fills in a looked-up elevation without an undo step', () => {
    const id = s().addPoi({ lon: 24.5, lat: 60.3, ele: null });
    const steps = t().pastStates.length;
    s().setPoiElevationSilently(id, 87);
    expect(s().pois[0]!.ele).toBe(87);
    expect(t().pastStates).toHaveLength(steps);
  });

  it('selects either a point or a POI, never both', () => {
    s().addPoint({ lon: 1, lat: 0 });
    const poi = s().addPoi({ lon: 1, lat: 0, ele: null });
    expect(s().selectedId).toBeNull();
    s().select(s().points[0]!.id);
    expect(s().selectedPoiId).toBeNull();
    s().selectPoi(poi);
    expect(s().selectedId).toBeNull();
  });

  it('loads POIs and their server state', () => {
    s().load(
      route(
        [],
        [
          {
            id: 'a1',
            name: 'Hut',
            description: null,
            poiType: 9,
            lon: 24,
            lat: 60,
            ele: null,
            distanceAlongM: null,
            syncState: 'synced',
            suuntoPoiKey: 'k1',
          },
        ],
      ),
    );
    expect(s().pois[0]).toEqual({ id: 'a1', name: 'Hut', description: '', poiType: 9, lon: 24, lat: 60, ele: null });
    expect(s().poiServer.a1).toEqual({ syncState: 'synced', suuntoPoiKey: 'k1' });
  });

  it('reverses the route, handing each leg its mode', () => {
    s().setDrawMode('snap');
    s().addPoint({ lon: 1, lat: 0 });
    s().addPoint({ lon: 2, lat: 0 }); // leg 1→2 snap
    s().setDrawMode('freehand');
    s().addPoint({ lon: 3, lat: 0 }); // leg 2→3 freehand

    s().reverse();

    expect(lons()).toEqual([3, 2, 1]);
    // 3→2 is the old freehand leg, 2→1 the old snapped one.
    expect(s().points.slice(0, 2).map((p) => p.mode)).toEqual(['freehand', 'snap']);
    t().undo();
    expect(lons()).toEqual([1, 2, 3]);
  });

  it('rotates a loop to start at another point, keeping every leg', () => {
    s().setDrawMode('snap');
    s().addPoint({ lon: 1, lat: 0 }); // A: leg A→B snap
    s().addPoint({ lon: 2, lat: 0 }); // B
    s().setDrawMode('freehand');
    s().addPoint({ lon: 2, lat: 1 }); // C: leg B→C freehand
    s().setDrawMode('snap');
    s().addPoint({ lon: 1, lat: 1 }); // D: leg C→D snap
    s().setDrawMode('freehand');
    s().addPoint({ lon: 1, lat: 0 }); // back at A: leg D→A freehand
    const legs = () => s().points.slice(0, -1).map((p, i) => `${p.lon},${p.lat}>${s().points[i + 1]!.lon},${s().points[i + 1]!.lat}:${p.mode}`);
    const before = legs();
    const c = s().points[2]!.id;

    s().rotateLoop(c);

    // Same legs, in a rotated order: C→D, D→A, A→B, B→C.
    expect(legs()).toEqual([before[2], before[3], before[0], before[1]]);
    expect(s().points[0]!.id).toBe(c);
    expect(s().points).toHaveLength(5);
    t().undo();
    expect(legs()).toEqual(before);
  });

  it('only rotates loops, and not from their ends', () => {
    [1, 2, 3, 4].forEach((lon) => s().addPoint({ lon, lat: 0 }));
    s().rotateLoop(s().points[1]!.id);
    expect(lons()).toEqual([1, 2, 3, 4]);

    s().addPoint({ lon: 1, lat: 0 });
    s().rotateLoop(s().points[0]!.id);
    s().rotateLoop(s().points.at(-1)!.id);
    expect(lons()).toEqual([1, 2, 3, 4, 1]);
  });

  it('trims before and after a point, undoably', () => {
    [1, 2, 3, 4].forEach((lon) => s().addPoint({ lon, lat: 0 }));
    const second = s().points[1]!.id;
    const third = s().points[2]!.id;

    s().trimBefore(second);
    expect(lons()).toEqual([2, 3, 4]);
    s().trimAfter(third);
    expect(lons()).toEqual([2, 3]);
    t().undo();
    t().undo();
    expect(lons()).toEqual([1, 2, 3, 4]);
  });

  it('draws the segment leading to a new point in the current mode', () => {
    s().addPoint({ lon: 1, lat: 0 });
    s().setDrawMode('snap');
    s().addPoint({ lon: 2, lat: 0 });
    expect(s().points.map((p) => p.mode)).toEqual(['snap', 'snap']);
  });
});

describe('recorded (track) legs', () => {
  // An imported track: two bends between three points, kept as recorded detail.
  const leg1: Coord[] = [[24.0, 60.0, 10], [24.005, 60.002, 11], [24.01, 60.0, 12]];
  const leg2: Coord[] = [[24.01, 60.0, 12], [24.015, 60.002, 13], [24.02, 60.0, 14]];
  const leg3: Coord[] = [[24.02, 60.0, 14], [24.025, 60.002, 15], [24.03, 60.0, 16]];
  const imported = () =>
    route([
      { lon: 24.0, lat: 60.0, modeToNext: 'track', segment: leg1 },
      { lon: 24.01, lat: 60.0, modeToNext: 'track', segment: leg2 },
      { lon: 24.02, lat: 60.0, modeToNext: 'track', segment: leg3 },
      { lon: 24.03, lat: 60.0, modeToNext: 'track' },
    ]);
  const modes = () => s().points.map((p) => p.mode);
  let unbind: () => void;

  beforeEach(() => {
    unbind = bindSegmentCache(new QueryClient());
    s().load(imported());
    s().points.slice(0, -1).forEach((p, i) => cacheSegment(p, s().points[i + 1]!, 'track', 'hiking-mountain', [leg1, leg2, leg3][i]!));
  });
  afterEach(() => unbind());

  it('treats curved freehand legs of older imports as recorded, straight ones as freehand', () => {
    s().load(
      route([
        { lon: 24.0, lat: 60.0, modeToNext: 'freehand', segment: leg1 },
        { lon: 24.01, lat: 60.0, modeToNext: 'freehand', segment: [[24.01, 60.0, null], [24.015, 60.0, null], [24.02, 60.0, null]] },
        { lon: 24.02, lat: 60.0, modeToNext: 'snap', segment: leg3 },
        { lon: 24.03, lat: 60.0, modeToNext: 'freehand' },
      ]),
    );
    expect(modes()).toEqual(['track', 'freehand', 'snap', 'freehand']);
  });

  it('re-routes only the recorded legs that end at a moved point', () => {
    s().movePoint(s().points[1]!.id, { lon: 24.01, lat: 60.01 });
    expect(modes()).toEqual(['snap', 'snap', 'track', 'track']);
  });

  it('keeps freehand legs freehand when a point moves', () => {
    s().setSegmentMode(s().points[0]!.id, 'freehand');
    s().movePoint(s().points[1]!.id, { lon: 24.01, lat: 60.01 });
    expect(modes().slice(0, 2)).toEqual(['freehand', 'snap']);
  });

  it('keeps the leg recorded when a point is added on the line, and re-routes it when the point goes elsewhere', () => {
    s().insertPoint(1, { lon: 24.005, lat: 60.002 }, { keepLine: true });
    expect(modes()).toEqual(['track', 'track', 'track', 'track', 'track']);
    t().undo();
    s().insertPoint(1, { lon: 24.005, lat: 60.01 });
    expect(modes()).toEqual(['snap', 'snap', 'track', 'track', 'track']);
  });

  it('merges two recorded legs into one with the same line when the point between them is deleted', () => {
    const [a, , c] = s().points;
    s().deletePoint(s().points[1]!.id);
    expect(modes()).toEqual(['track', 'track', 'track']);
    expect(cachedSegment(a!, c!, 'track', 'hiking-mountain')).toEqual([...leg1, ...leg2.slice(1)]);
  });

  it('re-routes the leg across a deleted point when a recorded line is missing', () => {
    unbind();
    unbind = bindSegmentCache(new QueryClient());
    s().deletePoint(s().points[1]!.id);
    expect(modes()).toEqual(['snap', 'track', 'track']);
  });
});
