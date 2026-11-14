import { describe, expect, it } from 'vitest';
import { readGpxPoints } from './mergeGpx';
import { splitGpxPoints, splitGpxPointsByDistance } from './splitGpx';

describe('splitGpxPoints', () => {
  const points = [0, 1, 2, 3, 4, 5].map((index) => ({
    lat: 10 + index,
    lon: 20 + index,
    elevation: String(100 + index),
    time: `2024-01-01T00:0${index}:00Z`,
  }));

  it('splits at selected point boundaries without losing or repeating points', () => {
    const parts = splitGpxPoints(points, [1, 3], 'Trip');

    expect(parts.map((part) => part.fileName)).toEqual(['Trip - Part 1.gpx', 'Trip - Part 2.gpx', 'Trip - Part 3.gpx']);
    expect(parts.map((part) => part.pointCount)).toEqual([2, 2, 2]);
    const partCoordinates = parts.map((part) => {
      const document = new DOMParser().parseFromString(part.xml, 'application/xml');
      expect(document.getElementsByTagName('parsererror')).toHaveLength(0);
      return Array.from(document.getElementsByTagNameNS('*', 'rtept'), (point) => [
        Number(point.getAttribute('lat')),
        Number(point.getAttribute('lon')),
      ]);
    });
    expect(partCoordinates.flat()).toEqual(points.map((point) => [point.lat, point.lon]));
  });

  it('retains elevation and timestamps and escapes route names', () => {
    const [part] = splitGpxPoints(points, [2], 'A & B');
    const document = new DOMParser().parseFromString(part!.xml, 'application/xml');
    const firstPoint = document.getElementsByTagNameNS('*', 'rtept')[0]!;

    expect(part!.xml).toContain('<name>A &amp; B - Part 1</name>');
    expect(firstPoint.getElementsByTagNameNS('*', 'ele')[0]?.textContent).toBe('100');
    expect(firstPoint.getElementsByTagNameNS('*', 'time')[0]?.textContent).toBe('2024-01-01T00:00:00Z');
  });

  it('rejects invalid split positions', () => {
    expect(() => splitGpxPoints(points, [], 'Trip')).toThrow('Choose at least one split point.');
    expect(() => splitGpxPoints(points, [1, 1], 'Trip')).toThrow('Split points must leave at least two points');
    expect(() => splitGpxPoints(points, [4], 'Trip')).toThrow('Split points must leave at least two points');
    expect(() => splitGpxPoints(points, [0], 'Trip')).toThrow('Split points must leave at least two points');
  });

  it('loads route points when the GPX has no track points', () => {
    const contents =
      '<gpx xmlns="http://www.topografix.com/GPX/1/1"><rte><rtept lat="1" lon="2" /><rtept lat="3" lon="4" /><rtept lat="5" lon="6" /><rtept lat="7" lon="8" /></rte></gpx>';
    const parsed = readGpxPoints({ fileName: 'route.gpx', contents });
    const parts = splitGpxPoints(parsed, [1], 'Route');

    expect(parts.map((part) => part.pointCount)).toEqual([2, 2]);
  });

  it('splits into distance-based parts at the nearest available points', () => {
    const spacedPoints = Array.from({ length: 10 }, (_, index) => ({
      lat: 0,
      lon: index * 0.001,
      elevation: String(index),
      time: null,
    }));
    const parts = splitGpxPointsByDistance(spacedPoints, 220, 'Trip');
    const coordinates = parts.map((part) => {
      const document = new DOMParser().parseFromString(part.xml, 'application/xml');
      return Array.from(document.getElementsByTagNameNS('*', 'rtept'), (point) => Number(point.getAttribute('lon')));
    });

    expect(parts.map((part) => part.pointCount)).toEqual([3, 2, 2, 3]);
    expect(coordinates.flat()).toEqual(spacedPoints.map((point) => point.lon));
    expect(parts.map((part) => part.fileName)).toEqual([
      'Trip - Part 1.gpx',
      'Trip - Part 2.gpx',
      'Trip - Part 3.gpx',
      'Trip - Part 4.gpx',
    ]);
  });

  it('rejects invalid distances and tracks that cannot be split into multiple parts', () => {
    expect(() => splitGpxPointsByDistance(points, 0, 'Trip')).toThrow('Enter a split distance greater than zero.');
    expect(() => splitGpxPointsByDistance(points, Number.POSITIVE_INFINITY, 'Trip')).toThrow(
      'Enter a split distance greater than zero.',
    );
    expect(() => splitGpxPointsByDistance(points, 1_000_000, 'Trip')).toThrow(
      'The split distance must be shorter than the route',
    );
    expect(() => splitGpxPointsByDistance(points.slice(0, 3), 1, 'Trip')).toThrow(
      'The route does not have enough points',
    );
  });
});
