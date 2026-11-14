import { useQueries, type QueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { ApiError, api } from '../../lib/api';
import type { ControlPointDto, SegmentMode } from '../routes/api';
import { densify, isStraight, type Coord, type LonLat } from './geo';

const round = (v: number, digits: number) => Number(v.toFixed(digits));

/** Freehand and track segments don't depend on the routing profile, so it's only part of the key for snapped ones. */
export function segmentKey(a: LonLat, b: LonLat, mode: SegmentMode, profile: string) {
  return ['segment', mode === 'snap' ? `snap:${profile}` : mode, round(a.lon, 6), round(a.lat, 6), round(b.lon, 6), round(b.lat, 6)] as const;
}

/** The mode a saved leg is edited in. Routes imported before `track` existed stored their recorded legs as
 *  freehand; a freehand leg whose line isn't straight is one of those. */
export function legMode(cp: ControlPointDto): SegmentMode {
  if (cp.modeToNext !== 'freehand' || !cp.segment || cp.segment.length <= 2) return cp.modeToNext;
  return isStraight(cp.segment.map((c) => [c[0]!, c[1]!, c[2] ?? null])) ? 'freehand' : 'track';
}

// The segment cache, for store actions that keep a line while changing its points (merging two recorded legs).
let segmentCache: QueryClient | null = null;

/** Lets the editor store read and write cached legs; returns the unbind. */
export function bindSegmentCache(qc: QueryClient) {
  segmentCache = qc;
  return () => {
    if (segmentCache === qc) segmentCache = null;
  };
}

export function cachedSegment(a: LonLat, b: LonLat, mode: SegmentMode, profile: string): Coord[] | undefined {
  return segmentCache?.getQueryData<Coord[]>(segmentKey(a, b, mode, profile));
}

export function cacheSegment(a: LonLat, b: LonLat, mode: SegmentMode, profile: string, line: Coord[]) {
  segmentCache?.setQueryData(segmentKey(a, b, mode, profile), line);
}

/** Snap-to-trail couldn't produce a segment. */
export class SnapError extends Error {
  readonly code: 'no_route' | 'too_long' | 'routing_unavailable';

  constructor(code: SnapError['code'], message: string) {
    super(message);
    this.name = 'SnapError';
    this.code = code;
  }

  /** Retrying won't help: the points really aren't connected by a trail. */
  get permanent(): boolean {
    return this.code !== 'routing_unavailable';
  }
}

async function fetchElevation(line: Coord[]): Promise<Coord[]> {
  try {
    const res = await api.post<{ elevations: (number | null)[] }>('/api/elevation', {
      points: line.map(([lon, lat]) => [lon, lat]),
    });
    return line.map(([lon, lat], i) => [lon, lat, res.elevations[i] ?? null]);
  } catch {
    // No elevation is better than no route; the profile just shows a gap.
    return line;
  }
}

async function routeSegment(a: LonLat, b: LonLat, profile: string): Promise<Coord[]> {
  try {
    const res = await api.post<{ coordinates: (number | null)[][] }>('/api/routing/segment', {
      from: [a.lon, a.lat],
      to: [b.lon, b.lat],
      profile,
    });
    return res.coordinates.map((c) => [c[0]!, c[1]!, c[2] ?? null]);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 422 || e.status === 503)) {
      const code = e.code === 'too_long' || e.code === 'no_route' ? e.code : 'routing_unavailable';
      throw new SnapError(code, e.message);
    }
    if (e instanceof ApiError && e.status === 401) throw e;
    throw new SnapError('routing_unavailable', e instanceof Error ? e.message : 'Routing failed');
  }
}

export interface SegmentFailure {
  /** Index of the segment (= index of its start point). */
  index: number;
  error: SnapError;
}

export interface RouteGeometry {
  /** One line per segment (points[i] → points[i+1]). */
  segments: Coord[][];
  /** Per segment: true when it's a computed snap-to-trail line (its ends lie on the trail). */
  snapped: boolean[];
  /** True while any segment is still being computed (placeholders are straight lines). */
  pending: boolean;
  /** Per segment: true when snapping it failed; it is drawn as a straight stand-in until its points move. */
  failed: boolean[];
  failures: SegmentFailure[];
}

/** Computes (and caches by endpoints + mode + profile) the line of every segment. */
export function useSegments(points: (LonLat & { mode: SegmentMode })[], profile: string): RouteGeometry {
  const pairs = useMemo(
    () => points.slice(0, -1).map((a, i) => ({ a, b: points[i + 1]!, mode: a.mode })),
    [points],
  );

  return useQueries({
    queries: pairs.map(({ a, b, mode }) => ({
      queryKey: segmentKey(a, b, mode, profile),
      // A track leg's line is seeded from the saved route; without it, all that's known is a straight line.
      queryFn: () => (mode === 'snap' ? routeSegment(a, b, profile) : fetchElevation(densify(a, b))),
      placeholderData: () => densify(a, b),
      staleTime: Infinity,
      // Kept for the session: undoing a drag over an imported track must bring its original detail back.
      gcTime: Infinity,
      // One retry for a flaky router; "no trail here" won't change by asking again.
      retry: (count: number, err: Error) => mode === 'snap' && count < 1 && !(err instanceof SnapError && err.permanent),
    })),
    combine: (results) => ({
      segments: results.map((r, i) => r.data ?? densify(pairs[i]!.a, pairs[i]!.b)),
      snapped: results.map((r, i) => pairs[i]!.mode === 'snap' && !!r.data && !r.isPlaceholderData),
      // A failed leg isn't pending: it stays a snap leg (moving a point retries it) and doesn't block saving.
      pending: results.some((r) => r.isPlaceholderData || r.isPending),
      failed: results.map((r) => r.isError),
      failures: results.flatMap((r, i) => (r.error instanceof SnapError ? [{ index: i, error: r.error }] : [])),
    }),
  });
}

/** Where to draw each control point: on the trail when an adjacent segment is snapped, else at the click. */
export function displayPositions(points: LonLat[], segments: Coord[][], snapped: boolean[]): LonLat[] {
  return points.map((p, i) => {
    const out = snapped[i] ? segments[i]?.[0] : undefined;
    const inc = snapped[i - 1] ? segments[i - 1]?.at(-1) : undefined;
    const c = out ?? inc;
    return c ? { lon: c[0], lat: c[1] } : p;
  });
}

/** Puts saved segments into the cache so opening a route doesn't recompute anything. */
export function seedSegments(qc: QueryClient, controlPoints: ControlPointDto[], profile: string) {
  controlPoints.slice(0, -1).forEach((cp, i) => {
    const next = controlPoints[i + 1]!;
    if (!cp.segment || cp.segment.length < 2) return;
    const coords = cp.segment.map((c) => [c[0], c[1], c[2] ?? null] as Coord);
    qc.setQueryData(segmentKey(cp, next, legMode(cp), profile), coords);
  });
}

/** Caches the two halves of a segment split at an inserted point, so inserting it doesn't re-route or straighten
 *  the line (an imported track keeps its detail, a snapped leg its trail). */
export function seedSplit(
  qc: QueryClient,
  a: LonLat & { mode: SegmentMode },
  b: LonLat,
  at: LonLat,
  before: Coord[],
  after: Coord[],
  profile: string,
) {
  if (before.length >= 2) qc.setQueryData(segmentKey(a, at, a.mode, profile), before);
  if (after.length >= 2) qc.setQueryData(segmentKey(at, b, a.mode, profile), after);
}

/** Rounds for the wire: ~0.1 m horizontally, 0.1 m vertically. */
export function toWire(segment: Coord[]): (number | null)[][] {
  return segment.map(([lon, lat, ele]) => [round(lon, 6), round(lat, 6), ele === null ? null : round(ele, 1)]);
}
