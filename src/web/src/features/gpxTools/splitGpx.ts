import { escapeXml, type GpxPoint } from './mergeGpx';

export interface GpxSplitPart {
  fileName: string;
  xml: string;
  pointCount: number;
}

export function splitGpxPoints(points: GpxPoint[], cuts: number[], routeName: string): GpxSplitPart[] {
  if (points.length < 2) throw new Error('The GPX needs at least two points to split.');
  if (cuts.length < 1) throw new Error('Choose at least one split point.');

  const orderedCuts = [...cuts].sort((a, b) => a - b);
  if (
    orderedCuts.some(
      (cut, index) =>
        !Number.isInteger(cut) ||
        cut < 0 ||
        cut >= points.length - 1 ||
        cut - (index === 0 ? -1 : orderedCuts[index - 1]!) < 2,
    )
  ) {
    throw new Error('Split points must leave at least two points in each part.');
  }
  if (points.length - 1 - orderedCuts[orderedCuts.length - 1]! < 2) {
    throw new Error('Split points must leave at least two points in each part.');
  }

  const boundaries = [...orderedCuts, points.length - 1];
  const parts: GpxSplitPart[] = [];
  let start = 0;
  for (let index = 0; index < boundaries.length; index++) {
    const end = boundaries[index]!;
    const partPoints = points.slice(start, end + 1);
    const name = `${routeName.trim() || 'Split route'} - Part ${index + 1}`;
    parts.push({
      fileName: `${safeFileName(name)}.gpx`,
      xml: writePart(partPoints, name),
      pointCount: partPoints.length,
    });
    start = end + 1;
  }
  return parts;
}

function writePart(points: GpxPoint[], name: string): string {
  const routePoints = points
    .map((point) => {
      const elevation = point.elevation === null ? '' : `<ele>${escapeXml(point.elevation)}</ele>`;
      const time = point.time === null ? '' : `<time>${escapeXml(point.time)}</time>`;
      return `    <rtept lat="${point.lat}" lon="${point.lon}">${elevation}${time}</rtept>`;
    })
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Route &amp; POI Manager" xmlns="http://www.topografix.com/GPX/1/1">',
    '  <rte>',
    `    <name>${escapeXml(name)}</name>`,
    routePoints,
    '  </rte>',
    '</gpx>',
    '',
  ].join('\n');
}

function safeFileName(name: string): string {
  const safe = name.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '');
  return safe || 'split-route';
}
