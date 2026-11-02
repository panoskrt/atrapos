export interface GpxInput {
  fileName: string;
  contents: string;
}

export interface GpxPoint {
  lat: number;
  lon: number;
  elevation: string | null;
  time: string | null;
}

export interface GpxMergeResult {
  xml: string;
  pointCount: number;
}

export function mergeGpxFiles(inputs: GpxInput[], routeName: string): GpxMergeResult {
  if (inputs.length < 2) throw new Error('Choose at least two GPX files to merge.');

  const points = inputs.flatMap((input) => readGpxPoints(input));
  if (!points.length) throw new Error('The selected files do not contain any track or route points.');

  const name = routeName.trim() || 'Merged route';
  const timedPoints = addMissingTimes(points);
  const trackPoints = timedPoints
    .map((point) => {
      const attrs = `lat="${point.lat}" lon="${point.lon}"`;
      const elevation = point.elevation === null ? '' : `<ele>${escapeXml(point.elevation)}</ele>`;
      return `      <trkpt ${attrs}>${elevation}<time>${escapeXml(point.time)}</time></trkpt>`;
    })
    .join('\n');

  return {
    xml: [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" creator="Atrapos" xmlns="http://www.topografix.com/GPX/1/1">',
      '  <trk>',
      `    <name>${escapeXml(name)}</name>`,
      '    <trkseg>',
      trackPoints,
      '    </trkseg>',
      '  </trk>',
      '</gpx>',
      '',
    ].join('\n'),
    pointCount: points.length,
  };
}

function addMissingTimes(points: GpxPoint[]): (GpxPoint & { time: string })[] {
  const result: (GpxPoint & { time: string })[] = points.map((point) => ({ ...point, time: point.time ?? '' }));
  const lastIndex = points.length - 1;
  const fallbackStart = Date.now() - (lastIndex + 60) * 1000;

  for (let index = 0; index < result.length; index++) {
    if (result[index]!.time !== '') continue;

    let nextTimedIndex = index + 1;
    while (nextTimedIndex < result.length && result[nextTimedIndex]!.time === '') nextTimedIndex++;

    let previousTimedIndex = index - 1;
    while (previousTimedIndex >= 0 && result[previousTimedIndex]!.time === '') previousTimedIndex--;

    const previousTime = previousTimedIndex >= 0 ? Date.parse(result[previousTimedIndex]!.time!) : null;
    const nextTime = nextTimedIndex < result.length ? Date.parse(result[nextTimedIndex]!.time!) : null;
    let timestamp: number;

    if (previousTime !== null && nextTime !== null && nextTime > previousTime) {
      const gap = nextTimedIndex - previousTimedIndex;
      timestamp = previousTime + ((nextTime - previousTime) * (index - previousTimedIndex)) / gap;
    } else if (previousTime !== null) {
      timestamp = previousTime + 1000;
    } else if (nextTime !== null) {
      timestamp = nextTime - (nextTimedIndex - index) * 1000;
    } else {
      timestamp = fallbackStart + index * 1000;
    }

    result[index]!.time = new Date(timestamp).toISOString();
  }

  return result;
}

export function readGpxPoints(input: GpxInput): GpxPoint[] {
  const document = new DOMParser().parseFromString(input.contents, 'application/xml');
  if (
    document.getElementsByTagName('parsererror').length > 0 ||
    document.documentElement.localName.toLowerCase() !== 'gpx'
  ) {
    throw new Error(`${input.fileName} is not a valid GPX file.`);
  }

  const trackPoints = Array.from(document.getElementsByTagNameNS('*', 'trkpt'));
  const routePoints = trackPoints.length ? [] : Array.from(document.getElementsByTagNameNS('*', 'rtept'));
  const elements = trackPoints.length ? trackPoints : routePoints;
  if (!elements.length) throw new Error(`${input.fileName} has no track or route points.`);

  return elements.map((element, index) => {
    const latText = element.getAttribute('lat');
    const lonText = element.getAttribute('lon');
    const lat = Number(latText);
    const lon = Number(lonText);
    if (
      latText === null ||
      latText.trim() === '' ||
      lonText === null ||
      lonText.trim() === '' ||
      !Number.isFinite(lat) ||
      lat < -90 ||
      lat > 90 ||
      !Number.isFinite(lon) ||
      lon < -180 ||
      lon > 180
    ) {
      throw new Error(`${input.fileName} has invalid coordinates at point ${index + 1}.`);
    }

    const elevation = directChildText(element, 'ele');
    if (elevation !== null && (elevation.length === 0 || !Number.isFinite(Number(elevation)))) {
      throw new Error(`${input.fileName} has an invalid elevation at point ${index + 1}.`);
    }

    const time = directChildText(element, 'time');
    if (time !== null && (time.length === 0 || !Number.isFinite(Date.parse(time)))) {
      throw new Error(`${input.fileName} has an invalid time at point ${index + 1}.`);
    }

    return { lat, lon, elevation, time };
  });
}

function directChildText(element: Element, name: string): string | null {
  for (const child of Array.from(element.children)) {
    if (child.localName === name) return child.textContent?.trim() ?? '';
  }
  return null;
}

export function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (character) => {
    switch (character) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case '"':
        return '&quot;';
      default:
        return '&apos;';
    }
  });
}
