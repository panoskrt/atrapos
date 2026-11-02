import type L from 'leaflet';
import { useMemo } from 'react';
import { api } from '../../lib/api';
import { locateOnLine, type Coord, type LonLat } from '../editor/geo';
import type { EditorPoi } from '../editor/store';

/** Mirrors PoiBehaviour.OnRouteMaxOffsetM: further than this from the line, a POI is "off route". */
export const ON_ROUTE_MAX_OFFSET_M = 200;

/** A click or drop this many screen pixels from the line snaps onto it. */
const SNAP_PIXELS = 20;

export interface Placement extends LonLat {
  ele: number | null;
  snapped: boolean;
}

/** Where a POI dropped at `at` should go: onto the route if close on screen, else exactly there. */
export function placePoi(map: L.Map, at: L.LatLng, line: Coord[], cumulative: number[]): Placement {
  const loc = locateOnLine(line, cumulative, { lon: at.lng, lat: at.lat });
  if (loc) {
    const px = map.latLngToContainerPoint(at);
    const thresholdM = Math.min(ON_ROUTE_MAX_OFFSET_M, at.distanceTo(map.containerPointToLatLng(px.add([SNAP_PIXELS, 0]))));
    if (loc.offsetM <= thresholdM) return { lon: loc.point[0], lat: loc.point[1], ele: loc.point[2], snapped: true };
  }
  return { lon: at.lng, lat: at.lat, ele: null, snapped: false };
}

/** Elevation for an off-route POI (on-route ones take the route's elevation). */
export async function lookupElevation(p: LonLat): Promise<number | null> {
  try {
    const res = await api.post<{ elevations: (number | null)[] }>('/api/elevation', { points: [[p.lon, p.lat]] });
    return res.elevations[0] ?? null;
  } catch {
    return null;
  }
}

export interface PoiLocation {
  /** Distance along the route, or null when off route. */
  alongM: number | null;
  /** Distance from the route line; null when there's no line yet. */
  offsetM: number | null;
}

/** Live position of each POI relative to the route as it's being edited (the server stores the same on save). */
export function usePoiLocations(pois: EditorPoi[], line: Coord[], cumulative: number[]): Map<string, PoiLocation> {
  return useMemo(() => {
    const out = new Map<string, PoiLocation>();
    for (const p of pois) {
      const loc = locateOnLine(line, cumulative, p);
      out.set(p.id, {
        alongM: loc && loc.offsetM <= ON_ROUTE_MAX_OFFSET_M ? loc.alongM : null,
        offsetM: loc?.offsetM ?? null,
      });
    }
    return out;
  }, [pois, line, cumulative]);
}
