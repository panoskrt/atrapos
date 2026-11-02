import { describe, expect, it } from 'vitest';
import { joinSegments, type Coord } from './geo';
import { displayPositions, segmentKey, SnapError } from './segments';

describe('segments', () => {
  it('bridges a gap between a snapped and a freehand segment', () => {
    // Snapped segment ends on the trail ~70 m short of the click; the freehand one starts at the click.
    const line = joinSegments([
      [
        [24.0, 60.0, 1],
        [24.0987, 60.0, 2],
      ],
      [
        [24.1, 60.0, 3],
        [24.2, 60.0, 4],
      ],
    ]);
    expect(line.map((c) => c[0])).toEqual([24.0, 24.0987, 24.1, 24.2]);
  });

  it('draws control points on the trail next to snapped segments', () => {
    const points = [
      { lon: 24.0, lat: 60.0 },
      { lon: 24.1, lat: 60.0 },
      { lon: 24.2, lat: 60.0 },
    ];
    const segments: Coord[][] = [
      [
        [24.0005, 60.0003, null],
        [24.0995, 60.0002, null],
      ],
      [
        [24.1, 60.0, null],
        [24.2, 60.0, null],
      ],
    ];
    const shown = displayPositions(points, segments, [true, false]);
    expect(shown[0]).toEqual({ lon: 24.0005, lat: 60.0003 }); // start of snapped segment
    expect(shown[1]).toEqual({ lon: 24.0995, lat: 60.0002 }); // end of the incoming snapped segment
    expect(shown[2]).toEqual(points[2]); // freehand: where the user clicked
  });

  it('keys snapped segments by profile but freehand ones not', () => {
    const a = { lon: 24.1234567, lat: 60.1 };
    const b = { lon: 24.2, lat: 60.2 };
    expect(segmentKey(a, b, 'snap', 'mtb')).not.toEqual(segmentKey(a, b, 'snap', 'trekking'));
    expect(segmentKey(a, b, 'freehand', 'mtb')).toEqual(segmentKey(a, b, 'freehand', 'trekking'));
    expect(segmentKey(a, b, 'freehand', 'mtb')[2]).toBe(24.123457);
  });

  it('treats only an unavailable router as worth retrying', () => {
    expect(new SnapError('no_route', 'x').permanent).toBe(true);
    expect(new SnapError('too_long', 'x').permanent).toBe(true);
    expect(new SnapError('routing_unavailable', 'x').permanent).toBe(false);
  });
});
