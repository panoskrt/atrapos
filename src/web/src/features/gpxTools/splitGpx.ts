import { escapeXml, type GpxPoint } from './mergeGpx';
import { distanceM } from '../editor/geo';

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

  return makeParts(points, orderedCuts, routeName);
}

export function splitGpxPointsByDistance(
  points: GpxPoint[],
  distanceIntervalM: number,
  routeName: string,
): GpxSplitPart[] {
  return splitGpxPoints(points, getDistanceSplitCuts(points, distanceIntervalM), routeName);
}

function getDistanceSplitCuts(points: GpxPoint[], distanceIntervalM: number): number[] {
  if (points.length < 2) throw new Error('The GPX needs at least two points to split.');
  if (!Number.isFinite(distanceIntervalM) || distanceIntervalM <= 0) {
    throw new Error('Enter a split distance greater than zero.');
  }

  const cumulativeDistances = [0];
  for (let index = 1; index < points.length; index++) {
    cumulativeDistances.push(
      cumulativeDistances[index - 1]! +
        distanceM(
          { lat: points[index - 1]!.lat, lon: points[index - 1]!.lon },
          { lat: points[index]!.lat, lon: points[index]!.lon },
        ),
    );
  }

  const totalDistance = cumulativeDistances.at(-1)!;
  if (distanceIntervalM >= totalDistance) {
    throw new Error('The split distance must be shorter than the route to create multiple parts.');
  }

  const cuts: number[] = [];
  const lastPossibleCut = points.length - 3;
  for (let targetDistance = distanceIntervalM; targetDistance < totalDistance; targetDistance += distanceIntervalM) {
    const firstPossibleCut = cuts.length === 0 ? 1 : cuts.at(-1)! + 2;
    if (firstPossibleCut > lastPossibleCut) break;

    let low = firstPossibleCut;
    let high = lastPossibleCut + 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (cumulativeDistances[middle]! < targetDistance) low = middle + 1;
      else high = middle;
    }

    const afterTarget = Math.min(low, lastPossibleCut);
    const beforeTarget = Math.max(firstPossibleCut, afterTarget - 1);
    const cut =
      Math.abs(cumulativeDistances[beforeTarget]! - targetDistance) <=
      Math.abs(cumulativeDistances[afterTarget]! - targetDistance)
        ? beforeTarget
        : afterTarget;
    cuts.push(cut);
  }

  if (cuts.length === 0) {
    throw new Error('The route does not have enough points to split into parts at this distance.');
  }
  return cuts;
}

function makeParts(points: GpxPoint[], cuts: number[], routeName: string): GpxSplitPart[] {
  const boundaries = [...cuts, points.length - 1];
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
    '<gpx version="1.1" creator="Atrapos" xmlns="http://www.topografix.com/GPX/1/1">',
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
