import { describe, expect, it } from 'vitest';
import type { Coord } from '../editor/geo';
import { offsetFromLine, simplifyIndices } from './simplify';

describe('simplifyIndices', () => {
  it('keeps both ends and drops points on a straight line', () => {
    const line: Coord[] = Array.from({ length: 50 }, (_, i) => [24 + i * 0.001, 60, null]);
    expect(simplifyIndices(line, 1)).toEqual([0, 49]);
  });

  it('keeps a corner that deviates more than the tolerance', () => {
    // An L shape: east 1 km, then north 1 km. The corner is ~700 m off the start–end chord.
    const line: Coord[] = [
      [24.0, 60.0, null],
      [24.009, 60.0, null],
      [24.018, 60.0, null],
      [24.018, 60.0045, null],
      [24.018, 60.009, null],
    ];
    expect(simplifyIndices(line, 10)).toEqual([0, 2, 4]);
  });

  it('removes zig-zag noise smaller than the tolerance', () => {
    // 2 m alternating jitter (0.000018° of latitude) along a straight east-going line.
    const line: Coord[] = Array.from({ length: 200 }, (_, i) => [24 + i * 0.0001, 60 + (i % 2 ? 0.000018 : -0.000018), null]);
    expect(simplifyIndices(line, 5)).toEqual([0, 199]);
    expect(simplifyIndices(line, 1).length).toBeGreaterThan(100);
  });

  it('returns every index with zero tolerance', () => {
    const line: Coord[] = [
      [24, 60, null],
      [24.1, 60.1, null],
      [24.2, 60, null],
    ];
    expect(simplifyIndices(line, 0)).toEqual([0, 1, 2]);
  });

  it('measures how far a waypoint is from the track', () => {
    const line: Coord[] = [
      [24.0, 60.0, null],
      [24.0, 60.01, null],
    ];
    const d = offsetFromLine(line, 24.0, 60.0009); // 100 m north of the first vertex
    expect(d).toBeGreaterThan(95);
    expect(d).toBeLessThan(105);
  });
});
