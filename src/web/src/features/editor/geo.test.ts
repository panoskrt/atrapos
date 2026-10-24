import { afterEach, describe, expect, it } from 'vitest';
import {
  cumulativeDistances,
  densify,
  distanceM,
  formatDistance,
  formatElevation,
  formatTemperature,
  formatWindSpeed,
  joinSegments,
  nearestDistance,
  positionAtDistance,
  sectionLine,
  sectionStats,
  stats,
  type Coord,
} from './geo';
import { applyUserSettings } from '../../lib/userPreferences';

describe('geo', () => {
  afterEach(() => applyUserSettings({ defaultMap: 'topo', units: 'metric', theme: 'dark', design: 'classic' }));

  it('formats values using the selected unit system', () => {
    applyUserSettings({ defaultMap: 'topo', units: 'imperial', theme: 'dark', design: 'classic' });
    expect(formatDistance(1609.344)).toBe('1.0 mi');
    expect(formatElevation(100)).toBe('328 ft');
    expect(formatTemperature(0)).toBe('32°');
    expect(formatWindSpeed(16.09344)).toBe('10 mph');
  });

  it('matches the server distance for a known pair', () => {
    // Same pair as GeoTests.Distance_matches_known_value: ~160.6 km.
    const d = distanceM({ lon: 24.9522, lat: 60.1704 }, { lon: 23.769, lat: 61.5004 });
    expect(d).toBeGreaterThan(159_500);
    expect(d).toBeLessThan(161_500);
  });

  it('densifies roughly every 50 m and keeps both ends', () => {
    const a = { lon: 24.5, lat: 60.3 };
    const b = { lon: 24.51, lat: 60.3 }; // ~552 m
    const pts = densify(a, b);
    expect(pts).toHaveLength(13);
    expect(pts[0]).toEqual([24.5, 60.3, null]);
    expect(pts.at(-1)![0]).toBeCloseTo(24.51, 9);
  });

  it('joins segments without duplicating joints', () => {
    const line = joinSegments([
      [
        [0, 0, 1],
        [1, 0, 2],
      ],
      [
        [1, 0, 2],
        [2, 0, 3],
      ],
    ]);
    expect(line.map((c) => c[0])).toEqual([0, 1, 2]);
  });

  it('applies the same climb hysteresis as the server', () => {
    // Same series as GeoTests.Climb_ignores_noise_below_hysteresis.
    const line: Coord[] = [100, 101, 99.5, 102, 110, 109, 120, 118.5, 100].map((e, i) => [24 + i * 0.001, 60, e]);
    const s = stats(line);
    expect(s.ascentM).toBeCloseTo(20, 6);
    expect(s.descentM).toBeCloseTo(20, 6);
  });

  it('ignores repeated small elevation undulations', () => {
    const line: Coord[] = [100, 104, 100, 104, 100, 104, 100].map((e, i) => [24 + i * 0.001, 60, e]);
    const s = stats(line);
    expect(s.ascentM).toBe(0);
    expect(s.descentM).toBe(0);
  });

  it('smooths high-frequency elevation noise on long routes', () => {
    const line: Coord[] = Array.from({ length: 2001 }, (_, i) => [
      24 + i * 0.00009,
      60,
      100 + i * 0.1 + (i % 2 === 0 ? 12 : -12),
    ]);
    const s = stats(line);
    expect(s.ascentM).toBeGreaterThanOrEqual(195);
    expect(s.ascentM).toBeLessThanOrEqual(205);
    expect(s.descentM).toBe(0);
  });

  it('interpolates position and elevation along the line', () => {
    const line: Coord[] = [
      [24, 60, 100],
      [24.01, 60, 200],
    ];
    const cum = cumulativeDistances(line);
    const mid = positionAtDistance(line, cum, cum[1]! / 2)!;
    expect(mid[0]).toBeCloseTo(24.005, 9);
    expect(mid[2]).toBeCloseTo(150, 6);
    expect(positionAtDistance(line, cum, -5)).toEqual(line[0]);
    expect(positionAtDistance(line, cum, 1e9)).toEqual(line[1]);
  });

  it('finds the distance of the nearest vertex', () => {
    const line: Coord[] = [
      [24, 60, null],
      [24.01, 60, null],
      [24.02, 60, null],
    ];
    const cum = cumulativeDistances(line);
    expect(nearestDistance(line, cum, { lon: 24.0101, lat: 60.0001 })).toBe(cum[1]);
  });

  it('formats distances', () => {
    expect(formatDistance(420.4)).toBe('420 m');
    expect(formatDistance(12_440)).toBe('12.4 km');
  });

  describe('sections', () => {
    // Climbs 100 m over the first 1 km-ish, is flat, then drops 60 m: points 0.01° (~556 m) apart at lat 60.
    const line: Coord[] = [100, 150, 200, 200, 200, 140].map((e, i) => [24 + i * 0.02, 60, e]);
    const cum = cumulativeDistances(line);

    it('cuts the line at interpolated ends', () => {
      const sub = sectionLine(line, cum, cum[1]! / 2, cum[2]! + 10);
      expect(sub).toHaveLength(4);
      expect(sub[0]![2]).toBeCloseTo(125, 6);
      expect(sub[1]).toEqual(line[1]);
      expect(sub[2]).toEqual(line[2]);
      expect(sub.at(-1)![2]).toBeGreaterThan(150);
      expect(sectionLine(line, cum, 100, 100)).toEqual([]);
    });

    it('measures only the chosen part, whichever order the ends are given', () => {
      const climb = sectionStats(line, cum, cum[0]!, cum[2]!)!;
      expect(climb.distanceM).toBeCloseTo(cum[2]!, 6);
      expect(climb.ascentM).toBeCloseTo(100, 6);
      expect(climb.descentM).toBe(0);
      expect(climb.netM).toBeCloseTo(100, 6);
      expect(climb.minEleM).toBe(100);
      expect(climb.maxEleM).toBe(200);
      expect(climb.avgGradePct).toBeCloseTo((100 / cum[2]!) * 100, 6);
      expect(climb.maxClimbPct).toBeGreaterThan(0);
      expect(climb.maxDescentPct).toBeNull();

      const drop = sectionStats(line, cum, cum[5]!, cum[4]!)!;
      expect(drop.fromM).toBe(cum[4]);
      expect(drop.descentM).toBeCloseTo(60, 6);
      expect(drop.ascentM).toBe(0);
      expect(drop.netM).toBeCloseTo(-60, 6);
      expect(drop.maxDescentPct).toBeLessThan(0);
      expect(drop.maxClimbPct).toBeNull();
    });

    it('covering the whole route matches the route totals', () => {
      const all = sectionStats(line, cum, 0, cum.at(-1)!)!;
      const total = stats(line);
      expect(all.distanceM).toBeCloseTo(total.distanceM, 6);
      expect(all.ascentM).toBeCloseTo(total.ascentM, 6);
      expect(all.descentM).toBeCloseTo(total.descentM, 6);
    });

    it('has distance but no elevation figures when elevation is unknown', () => {
      const flat: Coord[] = [24, 24.01, 24.02].map((lon) => [lon, 60, null]);
      const result = sectionStats(flat, cumulativeDistances(flat), 0, 800)!;
      expect(result.distanceM).toBeCloseTo(800, 6);
      expect(result.netM).toBeNull();
      expect(result.minEleM).toBeNull();
      expect(result.avgGradePct).toBeNull();
      expect(result.maxClimbPct).toBeNull();
    });

    it('needs a stretch with length', () => {
      expect(sectionStats(line, cum, 50, 50)).toBeNull();
    });
  });
});
