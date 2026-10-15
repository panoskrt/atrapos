import { describe, expect, it } from 'vitest';
import { mergeGpxFiles } from './mergeGpx';

const gpx = (points: string) =>
  `<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1"><trk><trkseg>${points}</trkseg></trk></gpx>`;

describe('mergeGpxFiles', () => {
  it('joins track points in input order into one named route', () => {
    const result = mergeGpxFiles(
      [
        { fileName: 'first.gpx', contents: gpx('<trkpt lat="10" lon="20"><ele>123</ele></trkpt>') },
        { fileName: 'second.gpx', contents: gpx('<trkpt lat="11" lon="21"><time>2024-01-01T00:00:00Z</time></trkpt>') },
      ],
      'Weekend & hike',
    );

    const document = new DOMParser().parseFromString(result.xml, 'application/xml');
    const route = document.getElementsByTagNameNS('*', 'rte');
    const points = document.getElementsByTagNameNS('*', 'rtept');

    expect(document.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(route).toHaveLength(1);
    expect(document.getElementsByTagNameNS('*', 'name')[0]?.textContent).toBe('Weekend & hike');
    expect(result.xml).toContain('Weekend &amp; hike');
    expect(Array.from(points, (point) => [point.getAttribute('lat'), point.getAttribute('lon')])).toEqual([
      ['10', '20'],
      ['11', '21'],
    ]);
    expect(points[0]?.getElementsByTagNameNS('*', 'ele')[0]?.textContent).toBe('123');
    expect(points[1]?.getElementsByTagNameNS('*', 'time')[0]?.textContent).toBe('2024-01-01T00:00:00Z');
    expect(result.pointCount).toBe(2);
  });

  it('uses route points when a GPX file does not contain tracks', () => {
    const contents = '<gpx xmlns="http://www.topografix.com/GPX/1/1"><rte><rtept lat="1" lon="2" /></rte></gpx>';
    const result = mergeGpxFiles(
      [
        { fileName: 'first.gpx', contents },
        { fileName: 'second.gpx', contents },
      ],
      '',
    );

    expect(result.pointCount).toBe(2);
    expect(result.xml).toContain('<name>Merged route</name>');
  });

  it('rejects malformed input and invalid coordinates', () => {
    expect(() => mergeGpxFiles([{ fileName: 'bad.gpx', contents: '<gpx>' }, { fileName: 'ok.gpx', contents: gpx('<trkpt lat="1" lon="2" />') }], ''))
      .toThrow('bad.gpx is not a valid GPX file.');
    expect(() => mergeGpxFiles([{ fileName: 'bad.gpx', contents: gpx('<trkpt lat="91" lon="2" />') }, { fileName: 'ok.gpx', contents: gpx('<trkpt lat="1" lon="2" />') }], ''))
      .toThrow('bad.gpx has invalid coordinates at point 1.');
  });
});
