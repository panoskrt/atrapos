import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Icon } from '../../components/Icon';
import { SelectBox, TriCheckbox } from '../../components/SelectionBar';
import type { Selection } from '../../lib/useSelection';
import { formatDistance } from '../editor/geo';
import { syncStateLabel, useActivityTypes, type RouteSummary, type SyncState } from '../routes/api';
import { formatChanged, SORT_LABELS, type RouteSort, type RouteSortKey } from './dashboard';
import styles from './LibraryPage.module.css';

interface ViewProps {
  routes: RouteSummary[];
  selection: Selection;
  onDelete: (route: RouteSummary) => void;
  deleting: boolean;
}

const sourceLabel: Record<RouteSummary['source'], string> = {
  drawn: 'Drawn',
  gpx: 'GPX',
  fitCourse: 'FIT course',
  fitActivity: 'FIT activity',
  suunto: 'From Suunto',
};

const stateTone: Record<SyncState, string> = {
  localOnly: 'muted',
  synced: 'ok',
  localChanges: 'warn',
  remoteNewer: 'danger',
  conflict: 'danger',
  error: 'danger',
};

function useActivityNames() {
  const activities = useActivityTypes();
  return (route: RouteSummary) =>
    route.activityIds
      .map((id) => activities.data?.find((a) => a.id === id)?.name)
      .filter(Boolean)
      .join(' · ');
}

function RouteStatus({ route }: { route: RouteSummary }) {
  return (
    <span className={styles[`tone_${stateTone[route.syncState]}`]}>
      <span className={styles.dot} />
      {syncStateLabel[route.syncState]}
    </span>
  );
}

function PoiStatus({ route }: { route: RouteSummary }) {
  const tone = route.poiCount === 0 ? styles.tone_muted : route.poisPending ? styles.tone_warn : styles.tone_ok;
  const text =
    route.poiCount === 0
      ? 'None'
      : route.poisPending === route.poiCount
        ? `${route.poiCount} not pushed`
        : route.poisPending
          ? `${route.poisPending} of ${route.poiCount} not pushed`
          : `${route.poiCount} synced`;
  return (
    <span className={tone}>
      <span className={styles.dot} />
      {text}
    </span>
  );
}

function DeleteButton({ route, onDelete, disabled }: { route: RouteSummary; onDelete: ViewProps['onDelete']; disabled: boolean }) {
  return (
    <button
      type="button"
      className={styles.iconBtn}
      onClick={() => onDelete(route)}
      disabled={disabled}
      aria-label={`Delete ${route.name}`}
      title="Delete"
    >
      <Icon name="trash" size={18} />
    </button>
  );
}

/** Boxes with a route outline: the visual overview. */
export function RouteCards({ routes, selection, onDelete, deleting, leading }: ViewProps & { leading?: ReactNode }) {
  const activityNames = useActivityNames();
  return (
    <ul className={styles.grid} data-selecting={selection.count > 0 || undefined}>
      {leading && <li>{leading}</li>}
      {routes.map((route) => {
        const selected = selection.has(route.id);
        const names = activityNames(route);
        return (
          <li key={route.id} className={`${styles.card} ${selected ? styles.selected : ''}`}>
            <SelectBox
              className={styles.cardCheck}
              checked={selected}
              label={`Select ${route.name}`}
              onToggle={(extend) => selection.toggle(route.id, extend)}
            />
            <Link to={`/routes/${route.id}`} className={styles.thumb} aria-label={`Open ${route.name}`} tabIndex={-1}>
              <Thumbnail preview={route.preview} />
              <span className={styles.source}>{sourceLabel[route.source]}</span>
            </Link>
            <div className={styles.cardBody}>
              <div className={styles.cardTitleRow}>
                <h2 className={styles.cardTitle}>
                  <Link to={`/routes/${route.id}`}>{route.name}</Link>
                </h2>
                <DeleteButton route={route} onDelete={onDelete} disabled={deleting} />
              </div>
              <p className={styles.meta}>
                {formatDistance(route.distanceM)} · +{Math.round(route.ascentM)} m{names && ` · ${names}`}
              </p>
              <div className={styles.statusRow}>
                <span className={styles.statusLabel}>Route</span>
                <RouteStatus route={route} />
              </div>
              <div className={styles.statusRow}>
                <span className={styles.statusLabel}>POIs</span>
                <PoiStatus route={route} />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** A dense, sortable table: for comparing and bulk work. */
export function RouteTable({
  routes,
  selection,
  onDelete,
  deleting,
  sort,
  onSort,
}: ViewProps & { sort: RouteSort; onSort: (key: RouteSortKey) => void }) {
  const activityNames = useActivityNames();
  const header = (key: RouteSortKey, className?: string) => {
    const active = sort.key === key;
    return (
      <th
        scope="col"
        className={className}
        aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      >
        <button type="button" className={`${styles.sortBtn} ${active ? styles.sortActive : ''}`} onClick={() => onSort(key)}>
          {SORT_LABELS[key]}
          <Icon name={active && sort.dir === 'asc' ? 'arrowUp' : 'arrowDown'} size={14} className={styles.sortIcon} />
        </button>
      </th>
    );
  };

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col" className={styles.checkCol}>
              <TriCheckbox
                state={selection.stateOf()}
                onChange={() => selection.toggleAll()}
                aria-label="Select all routes shown"
                disabled={routes.length === 0}
              />
            </th>
            {header('name')}
            <th scope="col" className={styles.colWide}>
              Activity
            </th>
            {header('distance', styles.num)}
            {header('ascent', `${styles.num} ${styles.colMid}`)}
            {header('status')}
            {header('pois', styles.colMid)}
            {header('modified', styles.colWide)}
            <th scope="col" className={styles.actionCol}>
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {routes.map((route) => {
            const selected = selection.has(route.id);
            return (
              <tr key={route.id} className={selected ? styles.selected : undefined}>
                <td className={styles.checkCol}>
                  <SelectBox
                    checked={selected}
                    label={`Select ${route.name}`}
                    onToggle={(extend) => selection.toggle(route.id, extend)}
                  />
                </td>
                <td>
                  <div className={styles.nameCell}>
                    <span className={styles.miniThumb}>
                      <Thumbnail preview={route.preview} compact />
                    </span>
                    <span className={styles.nameText}>
                      <Link to={`/routes/${route.id}`}>{route.name}</Link>
                      <span className={styles.meta}>{sourceLabel[route.source]}</span>
                    </span>
                  </div>
                </td>
                <td className={`${styles.colWide} ${styles.muted}`}>{activityNames(route) || '–'}</td>
                <td className={styles.num}>{formatDistance(route.distanceM)}</td>
                <td className={`${styles.num} ${styles.colMid}`}>+{Math.round(route.ascentM).toLocaleString()} m</td>
                <td>
                  <RouteStatus route={route} />
                </td>
                <td className={styles.colMid}>
                  <PoiStatus route={route} />
                </td>
                <td className={`${styles.colWide} ${styles.muted}`}>
                  <time dateTime={route.localModifiedAt} title={new Date(route.localModifiedAt).toLocaleString()}>
                    {formatChanged(route.localModifiedAt)}
                  </time>
                </td>
                <td className={styles.actionCol}>
                  <DeleteButton route={route} onDelete={onDelete} disabled={deleting} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Route outline projected into the box (equirectangular with latitude correction). */
function Thumbnail({ preview, compact = false }: { preview: [number, number][]; compact?: boolean }) {
  const [w, h, pad] = compact ? [64, 40, 5] : [300, 140, 20];
  if (preview.length < 2) {
    return (
      <svg viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
        {!compact && (
          <text x={w / 2} y={h / 2 + 6} textAnchor="middle" className={styles.thumbEmpty}>
            No route drawn yet
          </text>
        )}
      </svg>
    );
  }
  const lons = preview.map((p) => p[0]);
  const lats = preview.map((p) => p[1]);
  const k = Math.cos((((Math.min(...lats) + Math.max(...lats)) / 2) * Math.PI) / 180);
  const minX = Math.min(...lons) * k;
  const maxX = Math.max(...lons) * k;
  const minY = Math.min(...lats);
  const maxY = Math.max(...lats);
  const scale = Math.min((w - 2 * pad) / Math.max(maxX - minX, 1e-9), (h - pad - 10) / Math.max(maxY - minY, 1e-9));
  const offX = (w - (maxX - minX) * scale) / 2;
  const offY = (h - (maxY - minY) * scale) / 2;
  const d = preview
    .map(([lon, lat], i) => `${i ? 'L' : 'M'}${(offX + (lon * k - minX) * scale).toFixed(1)},${(offY + (maxY - lat) * scale).toFixed(1)}`)
    .join(' ');

  return (
    <svg viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className={compact ? styles.compact : undefined}>
      <path d={d} className={styles.thumbCasing} />
      <path d={d} className={styles.thumbLine} />
    </svg>
  );
}
