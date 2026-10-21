import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Icon } from '../../components/Icon';
import { useMe } from '../auth/useMe';
import { formatDistance, type Coord } from '../editor/geo';
import { COMMON_ACTIVITY_IDS, routeKeys, useActivityTypes, type RouteSource } from '../routes/api';
import { commitImport, previewImport, usePoiTypes, type ImportPreview, type ImportWaypoint } from './api';
import { offsetFromLine, simplifyIndices } from './simplify';
import styles from './ImportDialog.module.css';

const kindLabel: Record<RouteSource, string> = {
  gpx: 'GPX',
  fitCourse: 'FIT course',
  fitActivity: 'FIT activity',
  drawn: 'Drawn',
  suunto: 'Suunto',
};

const DEFAULT_TOLERANCE_M = 5;
const MAX_TOLERANCE_M = 25;
/** Matches ImportService.OnRouteMaxOffsetM. */
const ON_ROUTE_MAX_OFFSET_M = 200;

interface Props {
  file: File;
  onClose: () => void;
  onImported?: () => void;
  onDownload?: () => void;
}

export function ImportDialog({ file, onClose, onImported, onDownload }: Props) {
  const me = useMe();
  const suuntoConnected = me.data?.suuntoConnected ?? false;
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const preview = useQuery({
    queryKey: ['import-preview', file.name, file.size, file.lastModified],
    queryFn: () => previewImport(file),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });

  useEffect(() => {
    const d = ref.current;
    // jsdom (tests) has no showModal; open it non-modally there.
    if (d && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    }
  }, []);

  return (
    <dialog ref={ref} className={styles.dialog} aria-labelledby={titleId} onClose={onClose}>
      <div className={styles.head}>
        <h1 id={titleId} className={`display ${styles.title}`}>
          Import route file
        </h1>
        <button type="button" className={styles.close} onClick={() => ref.current?.close()} aria-label="Close">
          <Icon name="close" />
        </button>
      </div>

      {preview.isPending ? (
        <div className={styles.state} aria-busy="true">
          Reading {file.name}…
        </div>
      ) : preview.isError ? (
        <div className={styles.state} role="alert">
          <Icon name="alert" size={28} />
          <p>
            <strong>{file.name}</strong> couldn't be imported: {preview.error.message}
          </p>
          <button type="button" className="btn" onClick={() => ref.current?.close()}>
            Close
          </button>
        </div>
      ) : (
        <ImportForm
          file={file}
          preview={preview.data}
          onCancel={() => ref.current?.close()}
          onImported={onImported}
          onDownload={onDownload}
          suuntoConnected={suuntoConnected}
        />
      )}
    </dialog>
  );
}

function ImportForm({
  file,
  preview,
  onCancel,
  onImported,
  onDownload,
  suuntoConnected,
}: {
  file: File;
  preview: ImportPreview;
  onCancel: () => void;
  onImported?: () => void;
  onDownload?: () => void;
  suuntoConnected: boolean;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const activities = useActivityTypes(suuntoConnected);
  const poiTypes = usePoiTypes(suuntoConnected);
  const nameId = useId();
  const tolId = useId();
  const trackId = useId();

  const [trackIndex, setTrackIndex] = useState(0);
  const [tolerance, setTolerance] = useState(DEFAULT_TOLERANCE_M);
  const [name, setName] = useState(preview.name ?? file.name.replace(/\.(gpx|fit)$/i, ''));
  const [activityIds, setActivityIds] = useState<number[]>(preview.suggestedActivityIds);
  const [choices, setChoices] = useState(() =>
    preview.waypoints.map((w) => ({ include: w.include, name: w.name, poiType: w.poiType })),
  );

  const track = preview.tracks[trackIndex]!;
  const simplified = useMemo(() => {
    const idx = simplifyIndices(track.coordinates, tolerance);
    return idx.map((i) => track.coordinates[i]!);
  }, [track, tolerance]);
  const offsets = useMemo(
    () => preview.waypoints.map((w) => offsetFromLine(track.coordinates, w.lon, w.lat)),
    [preview.waypoints, track],
  );

  const create = useMutation({
    mutationFn: () =>
      commitImport(file, {
        trackIndex,
        toleranceM: tolerance,
        name: name.trim() || null,
        activityIds,
        waypoints: choices.map((c, index) => ({ index, ...c })),
      }),
    onSuccess: (route) => {
      void qc.invalidateQueries({ queryKey: routeKeys.all, exact: true });
      if (onImported) onImported();
      else navigate(`/routes/${route.id}`);
    },
  });

  const toggleActivity = (id: number) =>
    setActivityIds((ids) => (ids.includes(id) ? (ids.length > 1 ? ids.filter((a) => a !== id) : ids) : [...ids, id]));
  const chipIds = [...new Set([...preview.suggestedActivityIds, ...COMMON_ACTIVITY_IDS])].slice(0, 8);
  const activityName = (id: number) => activities.data?.find((a) => a.id === id)?.name ?? `Activity ${id}`;
  const included = choices.filter((c) => c.include).length;

  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <div className={styles.body}>
        <div className={styles.fileRow}>
          <Icon name="fileUp" size={26} />
          <div className={styles.fileText}>
            <strong>{preview.fileName}</strong>
            <span className={styles.muted}>
              {preview.kind === 'suunto' && !suuntoConnected ? 'Imported route' : kindLabel[preview.kind]} · {(file.size / 1024).toFixed(0)} KB · {preview.tracks.length}{' '}
              {preview.tracks.length === 1 ? 'track' : 'tracks'} · {preview.waypoints.length}{' '}
              {preview.kind === 'fitCourse' ? 'course points' : preview.kind === 'fitActivity' ? 'laps' : 'waypoints'}
            </span>
          </div>
          <span className={styles.parsed}>
            <Icon name="check" size={16} />
            Parsed
          </span>
        </div>

        <div className={styles.columns}>
          <div className={styles.left}>
            <TrackPreview original={track.coordinates} simplified={simplified} waypoints={preview.waypoints} choices={choices} />
            {preview.tracks.length > 1 && (
              <label htmlFor={trackId} className={styles.field}>
                <span className={styles.label}>Track</span>
                <select id={trackId} className={styles.input} value={trackIndex} onChange={(e) => setTrackIndex(Number(e.target.value))}>
                  {preview.tracks.map((t, i) => (
                    <option key={i} value={i}>
                      {t.name ?? `Track ${i + 1}`} · {formatDistance(t.distanceM)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label htmlFor={tolId} className={styles.field}>
              <span className={styles.labelRow}>
                <span className={styles.label}>Simplify tolerance</span>
                <strong>{tolerance === 0 ? 'Off' : `${tolerance} m`}</strong>
              </span>
              <input
                id={tolId}
                type="range"
                min={0}
                max={MAX_TOLERANCE_M}
                step={1}
                value={tolerance}
                onChange={(e) => setTolerance(Number(e.target.value))}
                className={styles.range}
              />
            </label>
            <dl className={styles.counts}>
              <div>
                <dt>original points</dt>
                <dd>{track.originalPointCount.toLocaleString('en-US')}</dd>
              </div>
              <div>
                <dt>after simplify</dt>
                <dd className={styles.accent}>{simplified.length.toLocaleString('en-US')}</dd>
              </div>
              <div>
                <dt>distance</dt>
                <dd>{formatDistance(track.distanceM)}</dd>
              </div>
            </dl>
            {!track.hasElevation && (
              <p className={styles.note}>
                <Icon name="alert" size={16} /> This track has no elevation data, so the route won't have an elevation profile.
              </p>
            )}
          </div>

          <div className={styles.right}>
            <label htmlFor={nameId} className={styles.field}>
              <span className={styles.label}>Route name</span>
              <input id={nameId} className={styles.input} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
            </label>

            {suuntoConnected && (
              <fieldset className={styles.fieldset}>
                <legend className={styles.label}>Suunto activities</legend>
                <div className={styles.chips}>
                  {chipIds.map((id) => {
                    const on = activityIds.includes(id);
                    return (
                      <label key={id} className={on ? styles.chipOn : styles.chip}>
                        <input type="checkbox" checked={on} onChange={() => toggleActivity(id)} />
                        {activityName(id)}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            )}

            {preview.waypoints.length > 0 ? (
              <div className={styles.field}>
                <span className={styles.labelRow}>
                  <span className={styles.label}>
                    {preview.kind === 'fitCourse' ? 'Course points' : preview.kind === 'fitActivity' ? 'Laps' : 'Waypoints'} → POIs
                  </span>
                  <span className={styles.muted}>
                    {included} of {choices.length} selected
                  </span>
                </span>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th scope="col">
                          <span className="visually-hidden">Import</span>
                        </th>
                        <th scope="col">Name</th>
                        <th scope="col">In file</th>
                        {suuntoConnected && <th scope="col">Suunto type</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.waypoints.map((w, i) => (
                        <WaypointRow
                          key={i}
                          waypoint={w}
                          offsetM={offsets[i]!}
                          choice={choices[i]!}
                          poiTypes={poiTypes.data ?? []}
                          suuntoConnected={suuntoConnected}
                          onChange={(c) => setChoices((all) => all.map((x, j) => (j === i ? { ...x, ...c } : x)))}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className={styles.muted}>
                  {suuntoConnected
                    ? 'Selected points become Suunto POIs and are added as waypoints to the route. Points more than 200 m off the track can only be POIs.'
                    : 'Selected points become POIs in this app and are included in the route when they are within 200 m of the track.'}
                </p>
              </div>
            ) : (
              <p className={styles.muted}>No waypoints in this file. You can add POIs in the editor.</p>
            )}
          </div>
        </div>
      </div>

      <div className={styles.foot}>
        {create.isError ? (
          <span role="alert" className={styles.error}>
            Import failed: {create.error.message}
          </span>
        ) : (
          <span className={styles.muted}>
            {suuntoConnected
              ? 'Nothing is uploaded to Suunto yet. You review in the editor, then push.'
              : 'The imported route and POIs are saved only to your account.'}
          </span>
        )}
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        {onDownload && (
          <button type="button" className="btn" onClick={onDownload}>
            <Icon name="download" size={18} />
            Download GPX
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={create.isPending}>
          {create.isPending ? 'Importing…' : 'Import & open editor'}
        </button>
      </div>
    </form>
  );
}

function WaypointRow({
  waypoint,
  offsetM,
  choice,
  poiTypes,
  suuntoConnected,
  onChange,
}: {
  waypoint: ImportWaypoint;
  offsetM: number;
  choice: { include: boolean; name: string; poiType: number };
  poiTypes: { id: number; name: string }[];
  suuntoConnected: boolean;
  onChange: (c: Partial<{ include: boolean; name: string; poiType: number }>) => void;
}) {
  const far = offsetM > ON_ROUTE_MAX_OFFSET_M;
  return (
    <tr className={choice.include ? undefined : styles.rowOff}>
      <td>
        <input
          type="checkbox"
          checked={choice.include}
          onChange={(e) => onChange({ include: e.target.checked })}
          aria-label={`Import ${choice.name}`}
          className={styles.poiCheck}
        />
      </td>
      <td>
        <input
          className={styles.cellInput}
          value={choice.name}
          maxLength={200}
          onChange={(e) => onChange({ name: e.target.value })}
          aria-label="POI name"
        />
        {far && <span className={styles.far}>{formatDistance(offsetM)} off route</span>}
      </td>
      <td className={styles.muted}>{waypoint.sourceType}</td>
      {suuntoConnected && (
        <td>
          <select
            className={styles.cellInput}
            value={choice.poiType}
            onChange={(e) => onChange({ poiType: Number(e.target.value) })}
            aria-label={`Suunto type for ${choice.name}`}
          >
            {poiTypes.length === 0 && <option value={choice.poiType}>{choice.poiType}</option>}
            {poiTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </td>
      )}
    </tr>
  );
}

/** Original (grey) vs simplified (accent) track, plus selected waypoints. Equirectangular, latitude-corrected. */
function TrackPreview({
  original,
  simplified,
  waypoints,
  choices,
}: {
  original: Coord[];
  simplified: Coord[];
  waypoints: ImportWaypoint[];
  choices: { include: boolean }[];
}) {
  const W = 400;
  const H = 260;
  const view = useMemo(() => {
    const lons = original.map((c) => c[0]);
    const lats = original.map((c) => c[1]);
    const k = Math.cos((((Math.min(...lats) + Math.max(...lats)) / 2) * Math.PI) / 180);
    const minX = Math.min(...lons) * k;
    const maxY = Math.max(...lats);
    const spanX = Math.max(...lons) * k - minX;
    const spanY = maxY - Math.min(...lats);
    const scale = Math.min((W - 32) / Math.max(spanX, 1e-9), (H - 32) / Math.max(spanY, 1e-9));
    const offX = (W - spanX * scale) / 2;
    const offY = (H - spanY * scale) / 2;
    return (lon: number, lat: number) => [offX + (lon * k - minX) * scale, offY + (maxY - lat) * scale] as const;
  }, [original]);

  const path = (line: Coord[]) =>
    line.map((c, i) => {
      const [x, y] = view(c[0], c[1]);
      return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

  return (
    <div className={styles.preview}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Track preview: original in grey, simplified in blue">
        <path d={path(original)} className={styles.original} />
        <path d={path(simplified)} className={styles.simplified} />
        {waypoints.map((w, i) => {
          if (!choices[i]?.include) return null;
          const [x, y] = view(w.lon, w.lat);
          return <circle key={i} cx={x} cy={y} r={6} className={styles.wp} />;
        })}
      </svg>
      <div className={styles.legend} aria-hidden="true">
        <span>
          <i className={styles.swatchOriginal} />
          Original
        </span>
        <span>
          <i className={styles.swatchSimplified} />
          Simplified
        </span>
      </div>
    </div>
  );
}
