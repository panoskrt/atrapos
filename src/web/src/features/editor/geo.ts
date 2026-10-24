import { currentUserSettings } from '../../lib/userPreferences';

/** Geometry helpers. `stats` mirrors Geo.Stats in RoutePoiManager.Domain/Geo.cs; keep them in step. */

/** [lon, lat, ele] with ele null when unknown. */
export type Coord = [number, number, number | null];

export interface LonLat {
  lon: number;
  lat: number;
}

const EARTH_RADIUS_M = 6371008.8;
export const CLIMB_HYSTERESIS_M = 20;
const CLIMB_COMPARISON_EPSILON_M = 1e-9;
const ELEVATION_NOISE_FILTER_WINDOW_M = 100;
const ELEVATION_NOISE_RMS_THRESHOLD_M = 3;
const ELEVATION_NOISE_FILTER_MIN_ROUTE_LENGTH_M = 10_000;
/** Freehand segments are sampled this often so the elevation profile has detail. */
export const DENSIFY_STEP_M = 50;
const MAX_POINTS_PER_SEGMENT = 200;

const rad = (d: number) => (d * Math.PI) / 180;

export function distanceM(a: LonLat, b: LonLat): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

const ll = (c: Coord): LonLat => ({ lon: c[0], lat: c[1] });

/** Straight line from a to b sampled every DENSIFY_STEP_M (both ends included). */
export function densify(a: LonLat, b: LonLat): Coord[] {
  const d = distanceM(a, b);
  const n = Math.min(MAX_POINTS_PER_SEGMENT, Math.max(1, Math.ceil(d / DENSIFY_STEP_M)));
  const out: Coord[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push([a.lon + (b.lon - a.lon) * t, a.lat + (b.lat - a.lat) * t, null]);
  }
  return out;
}

/** Points closer than this are the same joint (mirrors RouteDrawing.JointToleranceM). */
export const JOINT_TOLERANCE_M = 1;

/** Joins segments. Consecutive segments usually share their joint point; when they don't (a snapped segment
 *  ends on the trail, a freehand one at the raw click) the gap is bridged by a straight connector. */
export function joinSegments(segments: Coord[][]): Coord[] {
  const line: Coord[] = [];
  for (const seg of segments) {
    const last = line.at(-1);
    const sharesJoint = last && seg[0] && distanceM(ll(last), ll(seg[0])) <= JOINT_TOLERANCE_M;
    line.push(...(sharesJoint ? seg.slice(1) : seg));
  }
  return line;
}

export function cumulativeDistances(line: Coord[]): number[] {
  const out = new Array<number>(line.length);
  let total = 0;
  line.forEach((c, i) => {
    if (i > 0) total += distanceM(ll(line[i - 1]!), ll(c));
    out[i] = total;
  });
  return out;
}

export interface RouteStats {
  distanceM: number;
  ascentM: number;
  descentM: number;
}

export function stats(line: Coord[]): RouteStats {
  const cumulative = cumulativeDistances(line);
  let elevations = line.map(([, , ele]) => ele);
  if (
    cumulative.length > 1 &&
    cumulative[cumulative.length - 1]! >= ELEVATION_NOISE_FILTER_MIN_ROUTE_LENGTH_M &&
    elevations.every((ele) => ele !== null)
  ) {
    const knownElevations = elevations.filter((ele): ele is number => ele !== null);
    const smoothed = smoothElevations(knownElevations, cumulative);
    const residualRms = Math.sqrt(
      smoothed.reduce((sum, ele, i) => sum + (knownElevations[i]! - ele) ** 2, 0) / elevations.length,
    );
    // Smooth high-frequency DEM noise for totals without changing the plotted profile.
    if (residualRms > ELEVATION_NOISE_RMS_THRESHOLD_M) elevations = smoothed;
  }

  let ascent = 0;
  let descent = 0;
  let anchor: number | null = null;
  for (const ele of elevations) {
    if (ele === null) continue;
    if (anchor === null) {
      anchor = ele;
      continue;
    }
    const diff = ele - anchor;
    if (Math.abs(diff) < CLIMB_HYSTERESIS_M - CLIMB_COMPARISON_EPSILON_M) continue;
    if (diff > 0) ascent += diff;
    else descent -= diff;
    anchor = ele;
  }
  return { distanceM: cumulative.at(-1) ?? 0, ascentM: ascent, descentM: descent };
}

function smoothElevations(elevations: number[], cumulative: number[]): number[] {
  const smoothed = new Array<number>(elevations.length);
  const halfWindow = ELEVATION_NOISE_FILTER_WINDOW_M / 2;
  let left = 0;
  let right = 0;
  let count = 0;
  let sum = 0;

  for (let i = 0; i < elevations.length; i++) {
    const start = cumulative[i]! - halfWindow;
    const end = cumulative[i]! + halfWindow;
    while (right < elevations.length && cumulative[right]! <= end) {
      sum += elevations[right++]!;
      count++;
    }
    while (left < elevations.length && cumulative[left]! < start) {
      sum -= elevations[left++]!;
      count--;
    }
    smoothed[i] = sum / count;
  }

  return smoothed;
}

/** Position (and elevation, if known on both sides) at a distance along the line. */
export function positionAtDistance(line: Coord[], cumulative: number[], d: number): Coord | null {
  if (line.length === 0) return null;
  if (d <= 0) return line[0]!;
  const last = cumulative.length - 1;
  if (d >= cumulative[last]!) return line[last]!;

  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid]! <= d) lo = mid;
    else hi = mid;
  }
  const a = line[lo]!;
  const b = line[hi]!;
  const span = cumulative[hi]! - cumulative[lo]!;
  const t = span > 0 ? (d - cumulative[lo]!) / span : 0;
  const ele = a[2] !== null && b[2] !== null ? a[2] + (b[2] - a[2]) * t : (a[2] ?? b[2]);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, ele];
}

/** Distance along the line of the vertex nearest to p (good enough for hover sync on dense lines). */
export function nearestDistance(line: Coord[], cumulative: number[], p: LonLat): number | null {
  let best = Infinity;
  let bestD: number | null = null;
  const k = Math.cos(rad(p.lat));
  line.forEach((c, i) => {
    const dx = (c[0] - p.lon) * k;
    const dy = c[1] - p.lat;
    const sq = dx * dx + dy * dy;
    if (sq < best) {
      best = sq;
      bestD = cumulative[i]!;
    }
  });
  return bestD;
}

export interface LineLocation {
  /** Distance along the line to the nearest spot on it. */
  alongM: number;
  /** Distance from the point to that spot. */
  offsetM: number;
  /** The nearest spot on the line, with interpolated elevation. */
  point: Coord;
}

const METRES_PER_DEGREE = (Math.PI * EARTH_RADIUS_M) / 180;

/** Projects a point onto the line (nearest spot on any segment). Mirrors Geo.Locate on the server. */
export function locateOnLine(line: Coord[], cumulative: number[], p: LonLat): LineLocation | null {
  if (line.length < 2) return null;
  const k = Math.cos(rad(p.lat)) * METRES_PER_DEGREE;
  const px = p.lon * k;
  const py = p.lat * METRES_PER_DEGREE;
  let best: { sq: number; i: number; t: number } = { sq: Infinity, i: 1, t: 0 };
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const ax = a[0] * k;
    const ay = a[1] * METRES_PER_DEGREE;
    const dx = b[0] * k - ax;
    const dy = b[1] * METRES_PER_DEGREE - ay;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    const ex = ax + t * dx - px;
    const ey = ay + t * dy - py;
    const sq = ex * ex + ey * ey;
    if (sq < best.sq) best = { sq, i, t };
  }
  const along = cumulative[best.i - 1]! + best.t * (cumulative[best.i]! - cumulative[best.i - 1]!);
  return { alongM: along, offsetM: Math.sqrt(best.sq), point: positionAtDistance(line, cumulative, along)! };
}

/** The part of the line between two distances along it, with interpolated ends. */
export function sectionLine(line: Coord[], cumulative: number[], fromM: number, toM: number): Coord[] {
  const total = cumulative.at(-1) ?? 0;
  const from = Math.max(0, Math.min(fromM, toM));
  const to = Math.min(total, Math.max(fromM, toM));
  const start = positionAtDistance(line, cumulative, from);
  const end = positionAtDistance(line, cumulative, to);
  if (!start || !end || to <= from) return [];
  const inside = line.filter((_, i) => cumulative[i]! > from && cumulative[i]! < to);
  return [start, ...inside, end];
}

export interface SectionStats extends RouteStats {
  fromM: number;
  toM: number;
  startEleM: number | null;
  endEleM: number | null;
  minEleM: number | null;
  maxEleM: number | null;
  /** End minus start elevation. */
  netM: number | null;
  /** Net change over the length, in percent. */
  avgGradePct: number | null;
  /** Steepest climb and descent over a short stretch (GRADE_WINDOW_M), in percent; the descent is negative. */
  maxClimbPct: number | null;
  maxDescentPct: number | null;
}

/** Grades are measured over this length so a single noisy elevation sample doesn't read as a cliff. */
export const GRADE_WINDOW_M = 100;
const GRADE_STEP_M = 25;

/** Distance, climbing and elevation figures for the part of the route between two distances along it.
 *  Ascent and descent use the same rules as the whole-route totals (`stats`). */
export function sectionStats(line: Coord[], cumulative: number[], fromM: number, toM: number): SectionStats | null {
  const sub = sectionLine(line, cumulative, fromM, toM);
  if (sub.length < 2) return null;
  const total = cumulative.at(-1) ?? 0;
  const from = Math.max(0, Math.min(fromM, toM));
  const to = Math.min(total, Math.max(fromM, toM));
  const base = stats(sub);

  const known = sub.map((c) => c[2]).filter((e): e is number => e !== null);
  const startEleM = sub[0]![2];
  const endEleM = sub.at(-1)![2];
  const netM = startEleM !== null && endEleM !== null ? endEleM - startEleM : null;

  let maxClimbPct: number | null = null;
  let maxDescentPct: number | null = null;
  if (known.length === sub.length) {
    const window = Math.min(GRADE_WINDOW_M, to - from);
    for (let d = from; ; d += GRADE_STEP_M) {
      const a = Math.min(d, to - window);
      const e0 = positionAtDistance(line, cumulative, a)?.[2];
      const e1 = positionAtDistance(line, cumulative, a + window)?.[2];
      if (e0 != null && e1 != null && window > 0) {
        const grade = ((e1 - e0) / window) * 100;
        maxClimbPct = maxClimbPct === null ? grade : Math.max(maxClimbPct, grade);
        maxDescentPct = maxDescentPct === null ? grade : Math.min(maxDescentPct, grade);
      }
      if (a >= to - window) break;
    }
  }

  return {
    ...base,
    fromM: from,
    toM: to,
    startEleM,
    endEleM,
    minEleM: known.length ? Math.min(...known) : null,
    maxEleM: known.length ? Math.max(...known) : null,
    netM,
    avgGradePct: netM !== null && base.distanceM > 0 ? (netM / base.distanceM) * 100 : null,
    maxClimbPct: maxClimbPct !== null && maxClimbPct > 0 ? maxClimbPct : null,
    maxDescentPct: maxDescentPct !== null && maxDescentPct < 0 ? maxDescentPct : null,
  };
}

/** Midpoint (by distance) of a segment, for the "drag to insert" handles. */
export function segmentMidpoint(segment: Coord[]): LonLat | null {
  if (segment.length < 2) return null;
  const cum = cumulativeDistances(segment);
  const mid = positionAtDistance(segment, cum, cum.at(-1)! / 2);
  return mid ? { lon: mid[0], lat: mid[1] } : null;
}

export function formatDistance(m: number): string {
  if (currentUserSettings().units === 'imperial') {
    const feet = m * 3.280839895;
    if (m < 1609.344) return `${Math.round(feet).toLocaleString('en-US')} ft`;
    const miles = m / 1609.344;
    return `${miles.toFixed(miles < 100 ? 1 : 0)} mi`;
  }
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 100_000 ? 1 : 0)} km`;
}

export function formatElevation(m: number): string {
  const imperial = currentUserSettings().units === 'imperial';
  return `${Math.round(imperial ? m * 3.280839895 : m).toLocaleString('en-US')} ${imperial ? 'ft' : 'm'}`;
}

export function formatTemperature(celsius: number): string {
  const imperial = currentUserSettings().units === 'imperial';
  const temperature = imperial ? (celsius * 9) / 5 + 32 : celsius;
  return `${Math.round(temperature)}°`;
}

export function temperatureUnit(): string {
  return currentUserSettings().units === 'imperial' ? 'F' : 'C';
}

export function formatWindSpeed(kmh: number): string {
  const imperial = currentUserSettings().units === 'imperial';
  const speed = imperial ? kmh / 1.609344 : kmh;
  return `${Math.round(speed)} ${imperial ? 'mph' : 'km/h'}`;
}
