import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import { Link } from 'react-router';
import { Icon } from '../../components/Icon';
import { SelectBox, TriCheckbox } from '../../components/SelectionBar';
import type { Selection } from '../../lib/useSelection';
import { formatDistance, formatElevation } from '../editor/geo';
import { baseLayers, loadBaseLayer } from '../editor/baseLayers';
import { downloadRouteGpx, syncStateLabel, useActivityTypes, type RouteSummary, type SyncState } from '../routes/api';
import { formatChanged, SORT_LABELS, type RouteSort, type RouteSortKey } from './dashboard';
import styles from './LibraryPage.module.css';

const TILE_SIZE = 256;
const MAX_TILE_ZOOM = 17;
const MAP_ATTRIBUTION = '© OpenStreetMap contributors';

interface ViewProps {
  routes: RouteSummary[];
  selection: Selection;
  onDelete: (route: RouteSummary) => void;
  deleting: boolean;
  suuntoConnected: boolean;
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

function useActivityNames(suuntoConnected: boolean) {
  const activities = useActivityTypes(suuntoConnected);
  if (!suuntoConnected) return () => '';
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

function DownloadButton({ route }: { route: RouteSummary }) {
  return (
    <button
      type="button"
      className={styles.downloadBtn}
      onClick={() => downloadRouteGpx(route.id)}
      aria-label={`Download ${route.name} as GPX`}
      title="Download GPX"
    >
      <Icon name="download" size={18} />
    </button>
  );
}

/** Boxes with a route outline: the visual overview. */
export function RouteCards({ routes, selection, onDelete, deleting, suuntoConnected, leading }: ViewProps & { leading?: ReactNode }) {
  const activityNames = useActivityNames(suuntoConnected);
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
            <div className={styles.thumb}>
              <Thumbnail preview={route.preview} />
              <Link to={`/routes/${route.id}`} className={styles.thumbTarget} aria-label={`Open ${route.name}`} tabIndex={-1} />
              <span className={styles.source}>
                {route.source === 'suunto' && !suuntoConnected ? 'Imported' : sourceLabel[route.source]}
              </span>
            </div>
            <div className={styles.cardBody}>
              <div className={styles.cardTitleRow}>
                <h2 className={styles.cardTitle}>
                  <Link to={`/routes/${route.id}`}>{route.name}</Link>
                </h2>
                <DownloadButton route={route} />
                <DeleteButton route={route} onDelete={onDelete} disabled={deleting} />
              </div>
              <p className={styles.meta}>
                {formatDistance(route.distanceM)} · +{formatElevation(route.ascentM)}{names && ` · ${names}`}
              </p>
              {suuntoConnected && (
                <>
                  <div className={styles.statusRow}>
                    <span className={styles.statusLabel}>Route</span>
                    <RouteStatus route={route} />
                  </div>
                  <div className={styles.statusRow}>
                    <span className={styles.statusLabel}>POIs</span>
                    <PoiStatus route={route} />
                  </div>
                </>
              )}
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
  suuntoConnected,
}: ViewProps & { sort: RouteSort; onSort: (key: RouteSortKey) => void }) {
  const activityNames = useActivityNames(suuntoConnected);
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
            {suuntoConnected && (
              <th scope="col" className={styles.colWide}>
                Activity
              </th>
            )}
            {header('distance', styles.num)}
            {header('ascent', `${styles.num} ${styles.colMid}`)}
            {suuntoConnected && header('status')}
            {suuntoConnected && header('pois', styles.colMid)}
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
                      <span className={styles.meta}>
                        {route.source === 'suunto' && !suuntoConnected ? 'Imported' : sourceLabel[route.source]}
                      </span>
                    </span>
                  </div>
                </td>
                {suuntoConnected && <td className={`${styles.colWide} ${styles.muted}`}>{activityNames(route) || '–'}</td>}
                <td className={styles.num}>{formatDistance(route.distanceM)}</td>
                <td className={`${styles.num} ${styles.colMid}`}>+{formatElevation(route.ascentM)}</td>
                {suuntoConnected && (
                  <>
                    <td>
                      <RouteStatus route={route} />
                    </td>
                    <td className={styles.colMid}>
                      <PoiStatus route={route} />
                    </td>
                  </>
                )}
                <td className={`${styles.colWide} ${styles.muted}`}>
                  <time dateTime={route.localModifiedAt} title={new Date(route.localModifiedAt).toLocaleString()}>
                    {formatChanged(route.localModifiedAt)}
                  </time>
                </td>
                <td className={styles.actionCol}>
                  <div className={styles.rowActions}>
                    <DownloadButton route={route} />
                    <DeleteButton route={route} onDelete={onDelete} disabled={deleting} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Routes plotted from their summary previews; selecting one shows its details and a link to open it. */
export function RouteMap({ routes }: { routes: RouteSummary[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const layer = baseLayers.find((l) => l.id === loadBaseLayer())!;
  const plottedRoutes = useMemo(
    () =>
      routes.map((route, index) => ({
        route,
        color: `hsl(${(index * 137.508) % 360} 78% 45%)`,
        positions: route.preview
          .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90)
          .map(([lon, lat]) => [lat, lon] as L.LatLngTuple),
      })),
    [routes],
  );
  const active = plottedRoutes.find(({ route }) => route.id === activeId)?.route;
  const points = useMemo(() => plottedRoutes.flatMap((item) => item.positions), [plottedRoutes]);
  const withoutGeometry = plottedRoutes.filter((item) => item.positions.length === 0);
  const center = points[0] ?? ([50, 10] as L.LatLngTuple);

  return (
    <div className={styles.routeMapWrap}>
      <div className={styles.routeMap} role="region" aria-label="Route map">
        <MapContainer center={center} zoom={5} scrollWheelZoom>
          <TileLayer
            url={layer.url}
            attribution={layer.attribution}
            maxZoom={layer.maxZoom}
            subdomains={layer.subdomains ?? 'abc'}
            className="rpm-tiles"
          />
          <FitRoutes points={points} onBackgroundClick={() => setActiveId(null)} />
          {plottedRoutes.map(({ route, positions, color }) =>
            positions.length > 1 ? (
              <RouteMapLine key={route.id} route={route} positions={positions} color={color} onSelect={setActiveId} />
            ) : positions.length === 1 ? (
              <RouteMapPoint key={route.id} route={route} position={positions[0]!} color={color} onSelect={setActiveId} />
            ) : null,
          )}
        </MapContainer>
      </div>
      {active && <RouteMapDetails route={active} onClose={() => setActiveId(null)} />}
      {withoutGeometry.length > 0 && (
        <section className={styles.routesWithoutGeometry} aria-label="Routes without map geometry">
          <strong>Routes without map geometry</strong>
          <ul>
            {withoutGeometry.map(({ route }) => (
              <li key={route.id}>
                <Link to={`/routes/${route.id}`}>{route.name}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className={styles.routeMapHint}>Select a route line or marker to see its details.</p>
    </div>
  );
}

function RouteMapLine({
  route,
  positions,
  color,
  onSelect,
}: {
  route: RouteSummary;
  positions: L.LatLngTuple[];
  color: string;
  onSelect: (id: string) => void;
}) {
  const eventHandlers = useMemo<L.LeafletEventHandlerFnMap>(
    () => ({
      click: (event) => {
        L.DomEvent.stopPropagation(event.originalEvent);
        onSelect(route.id);
      },
    }),
    [onSelect, route.id],
  );
  const icon = useMemo(
    () => L.divIcon({
      className: styles.routeMarker,
      html: `<span style="--route-color:${color}"></span>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    }),
    [color],
  );
  return (
    <>
      <Polyline positions={positions} pathOptions={{ color: 'var(--bg)', weight: 10, opacity: 0.9 }} interactive={false} />
      <Polyline
        positions={positions}
        pathOptions={{ color, weight: 5, opacity: 0.95 }}
        eventHandlers={eventHandlers}
      >
        <Tooltip sticky>{route.name}</Tooltip>
      </Polyline>
      <Marker position={positions[0]!} icon={icon} title={`Show ${route.name}`} eventHandlers={eventHandlers}>
        <Tooltip>{route.name}</Tooltip>
      </Marker>
    </>
  );
}

function RouteMapPoint({
  route,
  position,
  color,
  onSelect,
}: {
  route: RouteSummary;
  position: L.LatLngTuple;
  color: string;
  onSelect: (id: string) => void;
}) {
  const eventHandlers = useMemo<L.LeafletEventHandlerFnMap>(
    () => ({
      click: (event) => {
        L.DomEvent.stopPropagation(event.originalEvent);
        onSelect(route.id);
      },
    }),
    [onSelect, route.id],
  );
  const icon = useMemo(
    () => L.divIcon({
      className: styles.routeMarker,
      html: `<span style="--route-color:${color}"></span>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    }),
    [color],
  );
  return (
    <Marker position={position} icon={icon} title={`Show ${route.name}`} eventHandlers={eventHandlers}>
      <Tooltip sticky>{route.name}</Tooltip>
    </Marker>
  );
}

function FitRoutes({ points, onBackgroundClick }: { points: L.LatLngTuple[]; onBackgroundClick: () => void }) {
  const map = useMap();
  useMapEvents({ click: onBackgroundClick });
  useEffect(() => {
    if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 14 });
    else if (points.length === 1) map.setView(points[0]!, 13);
  }, [map, points]);
  return null;
}

function RouteMapDetails({ route, onClose }: { route: RouteSummary; onClose: () => void }) {
  const headingId = useId();
  return (
    <section className={styles.routeDetails} aria-labelledby={headingId}>
      <div className={styles.routeDetailsHead}>
        <h2 id={headingId} className={styles.routeDetailsTitle}>{route.name}</h2>
        <button type="button" className={styles.routeDetailsClose} onClick={onClose} aria-label="Close details" title="Close">
          <Icon name="close" size={18} />
        </button>
      </div>
      <p className={styles.routeDetailsMeta}>
        {formatDistance(route.distanceM)} · +{formatElevation(route.ascentM)} · {route.poiCount} {route.poiCount === 1 ? 'POI' : 'POIs'}
      </p>
      <Link className="btn btn-primary" to={`/routes/${route.id}`}>View route details</Link>
    </section>
  );
}

/** Route displayed on OpenStreetMap tiles, fitted to the card or list thumbnail. */
function Thumbnail({ preview, compact = false }: { preview: [number, number][]; compact?: boolean }) {
  const [w, h, pad] = compact ? [64, 40, 5] : [300, 140, 20];
  if (preview.length < 2) {
    return (
      <svg viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className={compact ? styles.compact : undefined}>
        {!compact && (
          <text x={w / 2} y={h / 2 + 6} textAnchor="middle" className={styles.thumbEmpty}>
            No route drawn yet
          </text>
        )}
      </svg>
    );
  }
  const { path, tiles } = getThumbnailProjection(preview, w, h, pad);

  return (
    <div className={`${styles.thumbMap} ${compact ? styles.compact : ''}`}>
      <div className={styles.thumbTiles} aria-hidden="true">
        {tiles.map((tile) => (
          <img
            key={tile.key}
            src={`https://tile.openstreetmap.org/${tile.zoom}/${tile.x}/${tile.y}.png`}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            style={{
              left: `${(tile.left / w) * 100}%`,
              top: `${(tile.top / h) * 100}%`,
              width: `${(TILE_SIZE / w) * 100}%`,
              height: `${(TILE_SIZE / h) * 100}%`,
            }}
          />
        ))}
      </div>
      <svg className={styles.thumbRoute} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
        <path d={path} className={styles.thumbCasing} />
        <path d={path} className={styles.thumbLine} />
      </svg>
      <a
        className={styles.mapAttribution}
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer"
        title="Map data © OpenStreetMap contributors"
      >
        {MAP_ATTRIBUTION}
      </a>
    </div>
  );
}

function getThumbnailProjection(preview: [number, number][], width: number, height: number, padding: number) {
  const projected = preview.map(([lon, lat]) => {
    const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
    const sin = Math.sin((clampedLat * Math.PI) / 180);
    return { x: (lon + 180) / 360, y: 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI) };
  });
  const minX = Math.min(...projected.map((point) => point.x));
  const maxX = Math.max(...projected.map((point) => point.x));
  const minY = Math.min(...projected.map((point) => point.y));
  const maxY = Math.max(...projected.map((point) => point.y));
  const availableWidth = width - 2 * padding;
  const availableHeight = height - 2 * padding;
  const zoomForWidth = availableWidth / Math.max((maxX - minX) * TILE_SIZE, 1e-6);
  const zoomForHeight = availableHeight / Math.max((maxY - minY) * TILE_SIZE, 1e-6);
  const zoom = Math.max(0, Math.min(MAX_TILE_ZOOM, Math.floor(Math.log2(Math.min(zoomForWidth, zoomForHeight)))));
  const tileCount = 2 ** zoom;
  const worldSize = TILE_SIZE * tileCount;
  const originX = (minX + maxX) * worldSize / 2 - width / 2;
  const originY = (minY + maxY) * worldSize / 2 - height / 2;
  const path = projected
    .map((point, index) => `${index ? 'L' : 'M'}${(point.x * worldSize - originX).toFixed(1)},${(point.y * worldSize - originY).toFixed(1)}`)
    .join(' ');
  const firstX = Math.floor(originX / TILE_SIZE);
  const lastX = Math.floor((originX + width) / TILE_SIZE);
  const firstY = Math.floor(originY / TILE_SIZE);
  const lastY = Math.floor((originY + height) / TILE_SIZE);
  const tiles: { key: string; zoom: number; x: number; y: number; left: number; top: number }[] = [];

  for (let tileY = firstY; tileY <= lastY; tileY++) {
    if (tileY < 0 || tileY >= tileCount) continue;
    for (let tileX = firstX; tileX <= lastX; tileX++) {
      const x = ((tileX % tileCount) + tileCount) % tileCount;
      tiles.push(
        { key: `${tileX}:${tileY}`, zoom, x, y: tileY, left: tileX * TILE_SIZE - originX, top: tileY * TILE_SIZE - originY },
      );
    }
  }

  return { path, tiles };
}
