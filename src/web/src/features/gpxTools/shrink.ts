import { stats, type Coord } from '../editor/geo';
import { simplifyIndices } from '../import/simplify';

export const MIN_SHRINK_TOLERANCE_M = 1;
export const MAX_SHRINK_TOLERANCE_M = 50;
export const DEFAULT_SHRINK_TOLERANCE_M = 5;

export interface ShrinkSummary {
  /** The line that will be written: every dropped point lies within the tolerance of it. */
  line: Coord[];
  points: number;
  distanceM: number;
  /** Share of the file's original points that are dropped, 0–1. */
  reduction: number;
}

/** What /api/imports/shrink will produce for a previewed track. The server runs the same Douglas–Peucker on the same
 *  pre-simplified track, so the point count is exact. */
export function shrinkSummary(track: { coordinates: Coord[]; originalPointCount: number }, toleranceM: number): ShrinkSummary {
  const line = simplifyIndices(track.coordinates, toleranceM).map((i) => track.coordinates[i]!);
  return {
    line,
    points: line.length,
    distanceM: stats(line).distanceM,
    reduction: track.originalPointCount > 0 ? 1 - line.length / track.originalPointCount : 0,
  };
}
