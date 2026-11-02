import { describe, expect, it } from 'vitest';
import type { Coord } from '../editor/geo';
import { shrinkSummary } from './shrink';

// 2 m zig-zag along a straight ~2.2 km line, then a 90° turn north.
const zigzag: Coord[] = Array.from({ length: 200 }, (_, i) => [24 + i * 0.0001, 60 + (i % 2 ? 0.000018 : -0.000018), 100]);
const line: Coord[] = [...zigzag, [24.0199, 60.01, 120]];

describe('shrinkSummary', () => {
  it('drops points that only add jitter and keeps the corners', () => {
    const s = shrinkSummary({ coordinates: line, originalPointCount: 400 }, 5);
    expect(s.points).toBe(3);
    expect(s.line[0]).toEqual(line[0]);
    expect(s.line.at(-1)).toEqual(line.at(-1));
    expect(s.reduction).toBeCloseTo(1 - 3 / 400);
  });

  it('keeps more points at a tighter tolerance', () => {
    const tight = shrinkSummary({ coordinates: line, originalPointCount: 201 }, 1);
    const loose = shrinkSummary({ coordinates: line, originalPointCount: 201 }, 20);
    expect(tight.points).toBeGreaterThan(loose.points);
    expect(tight.distanceM).toBeGreaterThan(loose.distanceM);
  });
});
