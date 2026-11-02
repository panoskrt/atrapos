import { describe, expect, it } from 'vitest';
import { cumulativeDistances, locateOnLine, type Coord } from '../editor/geo';
import { COMMON_POI_TYPES, humanizeType, poiGlyph } from './poiTypes';

describe('locateOnLine', () => {
  // ~1110 m due east along 60°N, climbing from 100 to 200 m.
  const line: Coord[] = [
    [24.0, 60.0, 100],
    [24.02, 60.0, 200],
  ];
  const cum = cumulativeDistances(line);

  it('projects onto the segment and interpolates elevation', () => {
    const loc = locateOnLine(line, cum, { lon: 24.01, lat: 60.0009 })!;
    expect(loc.alongM).toBeGreaterThan(540);
    expect(loc.alongM).toBeLessThan(570);
    expect(loc.offsetM).toBeGreaterThan(95);
    expect(loc.offsetM).toBeLessThan(105);
    expect(loc.point[1]).toBeCloseTo(60.0, 6);
    expect(loc.point[2]).toBeCloseTo(150, 0);
  });

  it('clamps to the ends', () => {
    const loc = locateOnLine(line, cum, { lon: 23.9, lat: 60.0 })!;
    expect(loc.alongM).toBe(0);
    expect(loc.point[0]).toBe(24.0);
  });

  it('needs a line', () => {
    expect(locateOnLine([[24, 60, null]], [0], { lon: 24, lat: 60 })).toBeNull();
  });
});

describe('poiTypes', () => {
  it('has a glyph for every Suunto POI type', () => {
    const ids = [-1, ...Array.from({ length: 48 }, (_, i) => i), ...Array.from({ length: 14 }, (_, i) => 64 + i)];
    for (const id of ids) expect(poiGlyph(id)).toMatch(/^M/);
    expect(COMMON_POI_TYPES.every((id) => ids.includes(id))).toBe(true);
  });

  it('humanizes Suunto type names', () => {
    expect(humanizeType('FishingSpot')).toBe('Fishing spot');
    expect(humanizeType('AidStation')).toBe('Aid station');
    expect(humanizeType('POI')).toBe('Generic POI');
    expect(humanizeType('Water')).toBe('Water');
  });
});
