export type BaseLayerId = 'osm' | 'topo' | 'cyclosm';

export interface BaseLayer {
  id: BaseLayerId;
  label: string;
  url: string;
  attribution: string;
  maxZoom: number;
  subdomains?: string;
}

// Each provider's attribution is required by its tile usage policy; keep it intact.
export const baseLayers: BaseLayer[] = [
  {
    id: 'osm',
    label: 'OSM',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
  {
    id: 'topo',
    label: 'OpenTopoMap',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution:
      'Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Style © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    maxZoom: 17,
    subdomains: 'abc',
  },
  {
    id: 'cyclosm',
    label: 'CyclOSM',
    url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
    attribution:
      '<a href="https://www.cyclosm.org">CyclOSM</a> | Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 20,
    subdomains: 'abc',
  },
];

const KEY = 'rpm.baseLayer';

export function loadBaseLayer(): BaseLayerId {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'osm' || v === 'topo' || v === 'cyclosm') return v;
  } catch {
    // ignore
  }
  return 'topo';
}

export function storeBaseLayer(id: BaseLayerId) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // ignore
  }
}

const VIEW_KEY = 'rpm.mapView';

export function loadMapView(): { lat: number; lon: number; zoom: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null') as { lat: number; lon: number; zoom: number } | null;
    return v && Number.isFinite(v.lat) && Number.isFinite(v.lon) && Number.isFinite(v.zoom) ? v : null;
  } catch {
    return null;
  }
}

export function storeMapView(v: { lat: number; lon: number; zoom: number }) {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(v));
  } catch {
    // ignore
  }
}
