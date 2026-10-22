import L from 'leaflet';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Polyline, TileLayer, useMap } from 'react-leaflet';
import { Icon } from '../../components/Icon';
import { Spinner } from '../../components/Spinner';
import { usePersistentState } from '../../lib/usePersistentState';
import { baseLayers } from '../editor/baseLayers';
import { formatDistance } from '../editor/geo';
import { previewImport, useUploadLimit } from '../import/api';
import { formatBytes, postForFile, saveFile } from './fileApi';
import {
  DEFAULT_SHRINK_TOLERANCE_M,
  MAX_SHRINK_TOLERANCE_M,
  MIN_SHRINK_TOLERANCE_M,
  shrinkSummary,
} from './shrink';
import styles from './GpxToolsPage.module.css';

const isTolerance = (v: unknown): v is number =>
  typeof v === 'number' && v >= MIN_SHRINK_TOLERANCE_M && v <= MAX_SHRINK_TOLERANCE_M;

/** Reduces the points of a GPX or FIT file while keeping the route's shape; the result has the same format. */
export function ShrinkTool({ file, onFile }: { file: File | null; onFile: (file: File | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [toleranceM, setToleranceM] = usePersistentState('gpxTools.shrinkToleranceM', DEFAULT_SHRINK_TOLERANCE_M, isTolerance);
  const [shrinking, setShrinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ file: File; points: number } | null>(null);
  const { maxFileBytes, maxFileLabel } = useUploadLimit();

  const fileError = file && !/\.(gpx|fit)$/i.test(file.name)
    ? `${file.name} isn't a GPX or FIT file.`
    : file && file.size > maxFileBytes
      ? `${file.name} is larger than ${maxFileLabel}.`
      : null;

  const preview = useQuery({
    queryKey: ['gpx-tools', 'shrink-preview', file?.name, file?.size, file?.lastModified],
    queryFn: () => previewImport(file!),
    enabled: file !== null && fileError === null,
    staleTime: Infinity,
    retry: false,
  });
  const track = preview.data?.tracks[0];
  const summary = useMemo(() => (track ? shrinkSummary(track, toleranceM) : null), [track, toleranceM]);

  const shrink = async () => {
    if (!file) return;
    setShrinking(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('toleranceM', String(toleranceM));
      const extension = file.name.toLowerCase().endsWith('.fit') ? 'fit' : 'gpx';
      const shrunk = await postForFile('/api/imports/shrink', form, `${file.name.replace(/\.(gpx|fit)$/i, '')}-shrunk.${extension}`, 'Shrinking');
      setResult({ file: shrunk, points: summary?.points ?? 0 });
      saveFile(shrunk);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The file could not be shrunk.');
    } finally {
      setShrinking(false);
    }
  };

  const layer = baseLayers.find((item) => item.id === 'topo')!;
  const loadError = fileError ?? (preview.isError ? (preview.error instanceof Error ? preview.error.message : 'The file could not be read.') : null);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".gpx,.fit,application/gpx+xml,application/vnd.ant.fit"
        hidden
        onChange={(event) => {
          onFile(event.target.files?.[0] ?? null);
          setError(null);
          setResult(null);
          event.target.value = '';
        }}
      />
      <div className={styles.controls}>
        <p className={styles.note}>
          {file ? `${file.name} · ${formatBytes(file.size)}` : `Choose one GPX or FIT file (up to ${maxFileLabel}).`}
        </p>
        <button type="button" className="btn" onClick={() => inputRef.current?.click()}>
          <Icon name="fileUp" size={18} />
          {file ? 'Choose another file' : 'Choose GPX or FIT'}
        </button>
      </div>

      {!file && (
        <button type="button" className={styles.dropTarget} onClick={() => inputRef.current?.click()}>
          <Icon name="fileUp" size={30} />
          <strong>Drop a GPX or FIT file here or browse</strong>
          <span>Large recordings often have a point every second. Most of them don't change the route.</span>
        </button>
      )}

      {preview.isFetching && (
        <p role="status" className={styles.note}>
          <Spinner /> Reading the route…
        </p>
      )}

      {track && summary && (
        <>
          <label className={styles.toleranceField}>
            <span>
              <strong>Keep the route within {toleranceM} m</strong>
              <span>Every removed point stays within this distance of the new line.</span>
            </span>
            <input
              type="range"
              min={MIN_SHRINK_TOLERANCE_M}
              max={MAX_SHRINK_TOLERANCE_M}
              step={1}
              value={toleranceM}
              aria-valuetext={`${toleranceM} metres`}
              onChange={(event) => {
                setToleranceM(Number(event.target.value));
                setResult(null);
              }}
            />
          </label>

          <dl className={styles.stats} aria-label="Shrink result">
            <div>
              <dt>Points</dt>
              <dd>
                {track.originalPointCount.toLocaleString()} → <strong>{summary.points.toLocaleString()}</strong>
              </dd>
            </div>
            <div>
              <dt>Fewer points</dt>
              <dd>
                <strong>{Math.round(summary.reduction * 100)}%</strong>
              </dd>
            </div>
            <div>
              <dt>Distance</dt>
              <dd>
                {formatDistance(track.distanceM)} → <strong>{formatDistance(summary.distanceM)}</strong>
              </dd>
            </div>
          </dl>

          <div className={styles.previewMap} role="region" aria-label="Original and shrunk route">
            <MapContainer className="rpm-split-map" center={[track.coordinates[0]![1], track.coordinates[0]![0]]} zoom={5} scrollWheelZoom>
              <TileLayer
                url={layer.url}
                attribution={layer.attribution}
                maxZoom={layer.maxZoom}
                subdomains={layer.subdomains ?? 'abc'}
                className="rpm-tiles"
              />
              <FitTrack coordinates={track.coordinates} />
              <Polyline
                positions={track.coordinates.map((c) => [c[1], c[0]] as [number, number])}
                pathOptions={{ color: 'var(--text-muted)', weight: 8, opacity: 0.35 }}
                interactive={false}
              />
              <Polyline
                positions={summary.line.map((c) => [c[1], c[0]] as [number, number])}
                pathOptions={{ color: 'var(--accent)', weight: 3, opacity: 0.95 }}
                interactive={false}
              />
            </MapContainer>
          </div>
          <p className={styles.legend}>
            <span className={styles.legendOriginal} aria-hidden="true" /> Original
            <span className={styles.legendShrunk} aria-hidden="true" /> Shrunk
          </p>

          <div className={styles.footer}>
            <p className={styles.note}>
              The result is a {file?.name.toLowerCase().endsWith('.fit') ? 'FIT' : 'GPX'} file with the first track. Waypoints, elevation and recorded times stay on the points that are kept. The distance can come out a little shorter: GPS jitter between points no longer adds to it.
            </p>
            <button type="button" className="btn btn-primary" disabled={shrinking} aria-busy={shrinking} onClick={() => void shrink()}>
              {shrinking ? <Spinner /> : <Icon name="download" size={18} />}
              {shrinking ? 'Shrinking…' : 'Shrink and download'}
            </button>
          </div>
        </>
      )}

      {result && (
        <p role="status" className={styles.success}>
          <Icon name="check" size={18} />
          Downloaded {result.file.name}: {formatBytes(file!.size)} → {formatBytes(result.file.size)}, {result.points.toLocaleString()} points.
        </p>
      )}
      {(loadError ?? error) && (
        <p role="alert" className={styles.error}>
          <Icon name="alert" size={18} />
          {loadError ?? error}
        </p>
      )}
    </>
  );
}

function FitTrack({ coordinates }: { coordinates: [number, number, number | null][] }) {
  const map = useMap();
  useEffect(() => {
    if (coordinates.length < 2) return;
    // The panel is still laying out when the map mounts: measure again before fitting.
    const frame = requestAnimationFrame(() => {
      map.invalidateSize();
      map.fitBounds(L.latLngBounds(coordinates.map((c) => [c[1], c[0]] as [number, number])), { padding: [28, 28] });
    });
    return () => cancelAnimationFrame(frame);
  }, [map, coordinates]);
  return null;
}
