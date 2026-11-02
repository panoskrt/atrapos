import { beforeEach, describe, expect, it } from 'vitest';
import type { RouteDetail } from '../routes/api';
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

  it('falls back to freehand without adding an undo step', () => {
    s().addPoint({ lon: 1, lat: 0 });
    s().addPoint({ lon: 2, lat: 0 });
    const first = s().points[0]!.id;
    const steps = t().pastStates.length;

    s().setSegmentModesSilently([first], 'freehand');

    expect(s().points[0]!.mode).toBe('freehand');
    expect(t().pastStates).toHaveLength(steps);
    t().undo(); // undoes adding the second point, not the fallback
    expect(lons()).toEqual([1]);
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
