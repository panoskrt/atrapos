import type { Coord } from '../editor/geo';

const EARTH_RADIUS_M = 6371008.8;
const METRES_PER_DEGREE = (Math.PI * EARTH_RADIUS_M) / 180;

/** Douglas–Peucker in metres. Mirrors Geo.SimplifyIndices (RoutePoiManager.Domain/Geo.cs) exactly (same
 *  projection, same tie-breaking), so the dialog's point count matches what the server imports. */
export function simplifyIndices(line: Coord[], toleranceM: number): number[] {
  const n = line.length;
  if (n <= 2 || toleranceM <= 0) return line.map((_, i) => i);

  const lat0 = line.reduce((s, c) => s + c[1], 0) / n;
  const k = Math.cos((lat0 * Math.PI) / 180) * METRES_PER_DEGREE;
  const xs = line.map((c) => c[0] * k);
  const ys = line.map((c) => c[1] * METRES_PER_DEGREE);

  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  const tolSq = toleranceM * toleranceM;

  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxSq = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segmentDistanceSq(xs[i]!, ys[i]!, xs[a]!, ys[a]!, xs[b]!, ys[b]!);
      if (d > maxSq) {
        maxSq = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxSq > tolSq) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }

  const out: number[] = [];
  keep.forEach((v, i) => v && out.push(i));
  return out;
}

function segmentDistanceSq(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const ex = ax + t * dx - px;
  const ey = ay + t * dy - py;
  return ex * ex + ey * ey;
}

/** Distance from a point to the nearest vertex of a line, in metres (good enough for "x km off route"). */
export function offsetFromLine(line: Coord[], lon: number, lat: number): number {
  const k = Math.cos((lat * Math.PI) / 180) * METRES_PER_DEGREE;
  let best = Infinity;
  for (const c of line) {
    const dx = (c[0] - lon) * k;
    const dy = (c[1] - lat) * METRES_PER_DEGREE;
    best = Math.min(best, dx * dx + dy * dy);
  }
  return Math.sqrt(best);
}
