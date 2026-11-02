import { useQuery } from '@tanstack/react-query';
import { apiFetch, api } from '../../lib/api';
import type { RouteDetail, RouteSource } from '../routes/api';

export interface ImportTrack {
  name: string | null;
  originalPointCount: number;
  distanceM: number;
  hasElevation: boolean;
  coordinates: [number, number, number | null][];
}

export interface ImportWaypoint {
  name: string;
  sourceType: string;
  poiType: number;
  include: boolean;
  lon: number;
  lat: number;
  ele: number | null;
  description: string | null;
}

export interface ImportPreview {
  fileName: string;
  kind: RouteSource;
  name: string | null;
  suggestedActivityIds: number[];
  baseToleranceM: number;
  tracks: ImportTrack[];
  waypoints: ImportWaypoint[];
}

export interface ImportOptions {
  trackIndex: number;
  toleranceM: number;
  name: string | null;
  activityIds: number[];
  waypoints: { index: number; include: boolean; name: string; poiType: number }[];
}

export interface PoiType {
  id: number;
  name: string;
}

export const ACCEPTED_EXTENSIONS = ['.gpx', '.fit'];
/** Used until the API has said what it accepts (Uploads:MaxFileSizeMb); the API enforces its own limit either way. */
export const DEFAULT_MAX_FILE_BYTES = 20 * 1024 * 1024;

export interface UploadLimits {
  maxFileBytes: number;
}

/** The largest GPX or FIT file the API accepts, and a label for messages ("20 MB"). */
export function useUploadLimit() {
  const { data } = useQuery({
    queryKey: ['upload-limits'],
    queryFn: () => api.get<UploadLimits>('/api/imports/limits'),
    staleTime: Infinity,
    retry: false,
  });
  const maxFileBytes = typeof data?.maxFileBytes === 'number' && data.maxFileBytes > 0 ? data.maxFileBytes : DEFAULT_MAX_FILE_BYTES;
  return { maxFileBytes, maxFileLabel: formatSizeLimit(maxFileBytes) };
}

export function formatSizeLimit(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}

export function isImportable(file: File): boolean {
  return ACCEPTED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext));
}

function form(file: File, options?: ImportOptions) {
  const f = new FormData();
  f.append('file', file, file.name);
  if (options) f.append('options', JSON.stringify(options));
  return f;
}

export function previewImport(file: File) {
  return apiFetch<ImportPreview>('/api/imports/preview', { method: 'POST', body: form(file) });
}

export function commitImport(file: File, options: ImportOptions) {
  return apiFetch<RouteDetail>('/api/imports', { method: 'POST', body: form(file, options) });
}

export function usePoiTypes(enabled = true) {
  return useQuery({
    queryKey: ['lookups', 'poi-types'],
    queryFn: () => api.get<PoiType[]>('/api/lookups/poi-types'),
    staleTime: Infinity,
    enabled,
  });
}
