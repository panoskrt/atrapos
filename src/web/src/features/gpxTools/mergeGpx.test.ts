import { describe, expect, it } from 'vitest';
import { mergeGpxFiles } from './mergeGpx';

const gpx = (points: string) =>
  `<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1"><trk><trkseg>${points}</trkseg></trk></gpx>`;

describe('mergeGpxFiles', () => {
  it('joins track points in input order into one named, timestamped track', () => {
    const result = mergeGpxFiles(
      [
        { fileName: 'first.gpx', contents: gpx('<trkpt lat="10" lon="20"><ele>123</ele></trkpt>') },
        { fileName: 'second.gpx', contents: gpx('<trkpt lat="11" lon="21"><time>2024-01-01T00:00:00Z</time></trkpt>') },
      ],
      'Weekend & hike',
    );

    const document = new DOMParser().parseFromString(result.xml, 'application/xml');
    const tracks = document.getElementsByTagNameNS('*', 'trk');
    const points = document.getElementsByTagNameNS('*', 'trkpt');

    expect(document.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(tracks).toHaveLength(1);
    expect(document.getElementsByTagNameNS('*', 'name')[0]?.textContent).toBe('Weekend & hike');
    expect(result.xml).toContain('Weekend &amp; hike');
    expect(Array.from(points, (point) => [point.getAttribute('lat'), point.getAttribute('lon')])).toEqual([
      ['10', '20'],
      ['11', '21'],
    ]);
    expect(points[0]?.getElementsByTagNameNS('*', 'ele')[0]?.textContent).toBe('123');
    expect(points[0]?.getElementsByTagNameNS('*', 'time')[0]?.textContent).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(points[1]?.getElementsByTagNameNS('*', 'time')[0]?.textContent).toBe('2024-01-01T00:00:00Z');
    expect(result.pointCount).toBe(2);
  });

  it('uses route points when a GPX file does not contain tracks and preserves their times', () => {
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
    expect(documentTimes(result.xml)).toHaveLength(2);
  });

  it('fills missing timestamps between existing timestamps', () => {
    const result = mergeGpxFiles(
      [
        {
          fileName: 'first.gpx',
          contents: gpx('<trkpt lat="1" lon="1"><time>2024-01-01T00:00:00Z</time></trkpt><trkpt lat="2" lon="2" />'),
        },
        {
          fileName: 'second.gpx',
          contents: gpx('<trkpt lat="3" lon="3"><time>2024-01-01T00:00:02Z</time></trkpt>'),
        },
      ],
      '',
    );

    expect(documentTimes(result.xml)).toEqual([
      '2024-01-01T00:00:00Z',
      '2024-01-01T00:00:01.000Z',
      '2024-01-01T00:00:02Z',
    ]);
  });

  it('rejects invalid source timestamps', () => {
    const contents = gpx('<trkpt lat="1" lon="1"><time>not-a-time</time></trkpt>');

    expect(() => mergeGpxFiles(
      [
        { fileName: 'bad.gpx', contents },
        { fileName: 'ok.gpx', contents: gpx('<trkpt lat="2" lon="2" />') },
      ],
      '',
    )).toThrow('bad.gpx has an invalid time at point 1.');
  });

  it('rejects malformed input and invalid coordinates', () => {
    expect(() => mergeGpxFiles([{ fileName: 'bad.gpx', contents: '<gpx>' }, { fileName: 'ok.gpx', contents: gpx('<trkpt lat="1" lon="2" />') }], ''))
      .toThrow('bad.gpx is not a valid GPX file.');
    expect(() => mergeGpxFiles([{ fileName: 'bad.gpx', contents: gpx('<trkpt lat="91" lon="2" />') }, { fileName: 'ok.gpx', contents: gpx('<trkpt lat="1" lon="2" />') }], ''))
      .toThrow('bad.gpx has invalid coordinates at point 1.');
  });
});

function documentTimes(xml: string): string[] {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  return Array.from(document.getElementsByTagNameNS('*', 'time'), (time) => time.textContent ?? '');
}
