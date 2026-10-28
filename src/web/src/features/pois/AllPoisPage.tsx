import { useMutation, useQueryClient } from '@tanstack/react-query';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../../components/Icon';
import { LeafletMap, Marker, TileLayer, useMap, useMapEvents } from '../../components/LeafletMap';
import { useMe } from '../auth/useMe';
import { SelectBox, SelectionBar, TriCheckbox } from '../../components/SelectionBar';
import { toast } from '../../components/Toast';
import { usePersistentState } from '../../lib/usePersistentState';
import { useSelection, type Selection } from '../../lib/useSelection';
import { baseLayers, loadBaseLayer } from '../editor/baseLayers';
import { formatDistance, formatElevation } from '../editor/geo';
import { usePoiTypes } from '../import/api';
import { fold } from '../library/dashboard';
import { routeKeys, syncStateLabel, type SyncState } from '../routes/api';
import {
  allPoisKey,
  deletePoi,
  deletePois,
  pushPois,
  syncErrorMessage,
  useAllPois,
  type PoiListItem,
  type PoiPushResult,
} from '../sync/api';
import { PushResultDialog } from '../sync/PushResultDialog';
import { confirmPoiDelete, confirmPoisDelete } from './confirmDelete';
import { humanizeType, poiGlyph } from './poiTypes';
import toolbar from '../../components/Toolbar.module.css';
import { Spinner } from '../../components/Spinner';
import styles from './AllPoisPage.module.css';

const PENDING: SyncState[] = ['localOnly', 'localChanges', 'error', 'conflict'];
const isPending = (i: PoiListItem) => PENDING.includes(i.poi.syncState);

type PoiFilter = 'all' | 'pending' | 'synced';
const FILTERS: Record<PoiFilter, string> = { all: 'All POIs', pending: 'Not pushed', synced: 'Synced' };

type PoiView = 'list' | 'map';
const isPoiView = (v: unknown): v is PoiView => v === 'list' || v === 'map';

/** Every POI: grouped by route, then the standalone ones (pulled from Suunto, or not on any route). */
export function AllPoisPage() {
  const me = useMe();
  const suuntoConnected = me.data?.suuntoConnected ?? false;
  const pois = useAllPois();
  const types = usePoiTypes(suuntoConnected);
  const qc = useQueryClient();
  const [results, setResults] = useState<PoiPushResult[] | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PoiFilter>('all');
  const [view, setView] = usePersistentState<PoiView>('rpm.pois.view', 'list', isPoiView);
  const ids = { search: useId(), filter: useId() };

  const typeName = (id: number) => humanizeType(types.data?.find((t) => t.id === id)?.name ?? 'POI');
  const items = useMemo(() => pois.data ?? [], [pois.data]);
  const pending = items.filter(isPending).length;

  const shown = useMemo(() => {
    const q = fold(query.trim());
    return items.filter(
      (i) =>
        (filter === 'all' || (filter === 'pending' ? isPending(i) : i.poi.syncState === 'synced')) &&
        (!q || fold(i.poi.name).includes(q) || fold(i.routeName ?? '').includes(q)),
    );
  }, [items, query, filter]);
  const shownIds = useMemo(() => shown.map((i) => i.poi.id), [shown]);
  const selection = useSelection(shownIds);
  const chosen = shown.filter((i) => selection.has(i.poi.id));
  const chosenPending = chosen.filter(isPending);
  const groups = Map.groupBy(shown, (i) => i.routeId ?? '');

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: allPoisKey });
    void qc.invalidateQueries({ queryKey: routeKeys.all, exact: true });
  };
  const push = useMutation({
    mutationFn: (ids: string[] | null) => pushPois(ids),
    onSuccess: (res) => {
      setResults(res.results);
      void qc.invalidateQueries({ queryKey: allPoisKey });
    },
  });
  // The header pushes everything (null); the selection bar pushes chosen ids. Show the spinner where it was clicked.
  const pushingAll = push.isPending && push.variables === null;
  const pushingSelected = push.isPending && push.variables !== null;
  const remove = useMutation({ mutationFn: deletePoi, onSuccess: invalidate });
  const removeMany = useMutation({ mutationFn: deletePois, onSuccess: invalidate });

  const deleteSelected = async () => {
    if (!chosen.length || !(await confirmPoisDelete(chosen.map((i) => i.poi)))) return;
    removeMany.mutate(
      chosen.map((i) => i.poi.id),
      {
        onSuccess: ({ deleted }) => {
          selection.clear();
          toast(`Deleted ${deleted} ${deleted === 1 ? 'POI' : 'POIs'}.`);
        },
        onError: (e) => toast(`Couldn't delete the POIs: ${e.message}`, { tone: 'error' }),
      },
    );
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.heading}>
          <h1 className={`display ${styles.title}`}>All POIs</h1>
          <p className={styles.sub}>
            {pois.data ? `${items.length} POIs${suuntoConnected ? ` · ${pending} not pushed` : ''}` : ' '}
          </p>
        </div>
        {suuntoConnected && (
          <button type="button" className="btn btn-primary" disabled={!pending || push.isPending} aria-busy={pushingAll} onClick={() => push.mutate(null)}>
            {pushingAll ? <Spinner /> : <Icon name="pin" size={18} />}
            {pushingAll ? `Pushing ${pending}…` : pending ? `Push ${pending} to Suunto` : 'All pushed'}
          </button>
        )}
      </div>

      {suuntoConnected && push.isError && (
        <p role="alert" className={styles.error}>
          {syncErrorMessage(push.error).message}{' '}
          {syncErrorMessage(push.error).signIn && (
            <button
              type="button"
              className={styles.inlineLink}
              onClick={() => {
                const popup = window.open('/auth/login', 'suunto-login', 'width=520,height=720');
                if (!popup) window.location.assign('/auth/login');
              }}
            >
              Sign in with Suunto again
            </button>
          )}
        </p>
      )}

      {pois.isPending ? (
        <div role="status" aria-busy="true" style={{ display: 'grid', gap: 10 }}>
          <span className="visually-hidden">Loading POIs…</span>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton" style={{ height: 64 }} aria-hidden="true" />
          ))}
        </div>
      ) : pois.isError ? (
        <p role="alert" className={styles.error}>
          Couldn't load POIs: {pois.error.message}
        </p>
      ) : items.length === 0 ? (
        <div className={styles.empty}>
          <Icon name="pin" size={36} />
          <p>
            {suuntoConnected
              ? 'No POIs yet. Add them to a route in the editor, or use Refresh from Suunto in the library to bring in the POIs you already have.'
              : 'No POIs yet. Add them to a route in the editor or import them from a GPX or FIT file.'}
          </p>
        </div>
      ) : (
        <>
          <div className={toolbar.toolbar} role="toolbar" aria-label="Show POIs">
            <label className={toolbar.selectAll}>
              <TriCheckbox state={selection.stateOf()} onChange={() => selection.toggleAll()} disabled={shown.length === 0} />
              Select all
            </label>
            <div className={toolbar.search}>
              <label htmlFor={ids.search} className="visually-hidden">
                Search POIs
              </label>
              <Icon name="search" size={18} className={toolbar.searchIcon} />
              <input
                id={ids.search}
                type="search"
                placeholder="Search POIs or routes"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {suuntoConnected && (
              <>
                <label htmlFor={ids.filter} className="visually-hidden">
                  Show
                </label>
                <select id={ids.filter} className={toolbar.select} value={filter} onChange={(e) => setFilter(e.target.value as PoiFilter)}>
                  {Object.entries(FILTERS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </>
            )}
            <div className={styles.viewToggle} role="group" aria-label="Show as">
              <button type="button" className={styles.toolBtn} aria-pressed={view === 'list'} onClick={() => setView('list')} title="List">
                <Icon name="list" size={18} />
                <span className={styles.toggleText}>List</span>
              </button>
              <button type="button" className={styles.toolBtn} aria-pressed={view === 'map'} onClick={() => setView('map')} title="Map">
                <Icon name="pin" size={18} />
                <span className={styles.toggleText}>Map</span>
              </button>
            </div>
          </div>

          {shown.length === 0 ? (
            <div className={styles.empty}>
              <p>No POIs match.</p>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setQuery('');
                  setFilter('all');
                }}
              >
                Clear search and filter
              </button>
            </div>
          ) : view === 'map' ? (
            <PoiMap items={shown} selection={selection} typeName={typeName} suuntoConnected={suuntoConnected} />
          ) : (
            [...groups.entries()].map(([routeId, group]) => (
              <PoiGroup
                key={routeId || 'standalone'}
                routeId={routeId}
                group={group}
                selection={selection}
                typeName={typeName}
                suuntoConnected={suuntoConnected}
                onDelete={async (item) => {
                  if (await confirmPoiDelete(item.poi, item.poi)) remove.mutate(item.poi.id);
                }}
              />
            ))
          )}
        </>
      )}

      <SelectionBar count={selection.count} noun={['POI', 'POIs']} onClear={selection.clear}>
        {suuntoConnected && (
          <button
            type="button"
            className="btn"
            disabled={!chosenPending.length || push.isPending}
            aria-busy={pushingSelected}
            onClick={() => push.mutate(chosenPending.map((i) => i.poi.id), { onSuccess: selection.clear })}
            title={chosenPending.length ? undefined : 'All selected POIs are already on Suunto'}
          >
            {pushingSelected ? <Spinner /> : <Icon name="pin" size={18} />}
            {pushingSelected ? 'Pushing…' : `Push ${chosenPending.length}`}
          </button>
        )}
        <button type="button" className="btn btn-danger" onClick={deleteSelected} disabled={removeMany.isPending}>
          <Icon name="trash" size={18} />
          {removeMany.isPending ? 'Deleting…' : `Delete ${selection.count}`}
        </button>
      </SelectionBar>

      {results && <PushResultDialog results={results} onClose={() => setResults(null)} />}
    </div>
  );
}

function PoiGroup({
  routeId,
  group,
  selection,
  typeName,
  suuntoConnected,
  onDelete,
}: {
  routeId: string;
  group: PoiListItem[];
  selection: Selection;
  typeName: (id: number) => string;
  suuntoConnected: boolean;
  onDelete: (item: PoiListItem) => void;
}) {
  const headingId = `g-${routeId || 'standalone'}`;
  const title = routeId ? group[0]!.routeName : 'Not on a route';
  const groupIds = group.map((i) => i.poi.id);
  return (
    <section className={styles.group} aria-labelledby={headingId}>
      <div className={styles.groupHead}>
        <TriCheckbox
          state={selection.stateOf(groupIds)}
          onChange={() => selection.toggleAll(groupIds)}
          aria-label={`Select all POIs in ${title}`}
        />
        <h2 id={headingId} className={styles.groupTitle}>
          {routeId ? <Link to={`/routes/${routeId}`}>{title}</Link> : title}
          <span className={styles.count}>{group.length}</span>
        </h2>
      </div>
      <ul className={styles.list}>
        {group.map((item) => (
          <PoiRow
            key={item.poi.id}
            item={item}
            typeName={suuntoConnected ? typeName(item.poi.poiType) : ''}
            suuntoConnected={suuntoConnected}
            selected={selection.has(item.poi.id)}
            onToggle={(extend) => selection.toggle(item.poi.id, extend)}
            onDelete={() => onDelete(item)}
          />
        ))}
      </ul>
    </section>
  );
}

function PoiRow({
  item,
  typeName,
  suuntoConnected,
  selected,
  onToggle,
  onDelete,
}: {
  item: PoiListItem;
  typeName: string;
  suuntoConnected: boolean;
  selected: boolean;
  onToggle: (extend: boolean) => void;
  onDelete: () => void;
}) {
  const p = item.poi;
  const metadata = [
    ...(suuntoConnected ? [typeName] : []),
    ...(item.routeId ? [p.distanceAlongM != null ? formatDistance(p.distanceAlongM) : 'off route'] : []),
    ...(p.ele !== null ? [formatElevation(p.ele)] : []),
  ].join(' · ');
  return (
    <li className={`${styles.row} ${selected ? styles.selected : ''}`}>
      <SelectBox checked={selected} label={`Select ${p.name}`} onToggle={onToggle} />
      {suuntoConnected && (
        <span className={styles.badge} aria-hidden="true">
          <svg viewBox="0 0 16 16" width="16" height="16">
            <path d={poiGlyph(p.poiType)} />
          </svg>
        </span>
      )}
      <span className={styles.rowText}>
        <strong>{p.name}</strong>
        <span className={styles.meta}>{metadata}</span>
        {p.description && <span className={styles.desc}>{p.description}</span>}
      </span>
      {suuntoConnected && <SyncStatus state={p.syncState} />}
      <button type="button" className={styles.iconBtn} onClick={onDelete} aria-label={`Delete ${p.name}`} title="Delete">
        <Icon name="trash" size={18} />
      </button>
    </li>
  );
}

function SyncStatus({ state }: { state: SyncState }) {
  const tone = state === 'synced' ? styles.ok : state === 'localOnly' ? styles.muted : state === 'localChanges' ? styles.warn : styles.danger;
  return (
    <span className={tone}>
      <span className={styles.dot} />
      {state === 'localOnly' ? 'Not pushed' : syncStateLabel[state]}
    </span>
  );
}

/** The shown POIs on one map. Clicking a pin opens its details; POIs selected in the list are outlined. */
function PoiMap({
  items,
  selection,
  typeName,
  suuntoConnected,
}: {
  items: PoiListItem[];
  selection: Selection;
  typeName: (id: number) => string;
  suuntoConnected: boolean;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = items.find((i) => i.poi.id === activeId);
  const layer = baseLayers.find((l) => l.id === loadBaseLayer())!;
  const first = items[0]!.poi;
  return (
    <div className={styles.mapWrap}>
      <div className={styles.map} role="region" aria-label="POI map">
        <LeafletMap center={[first.lat, first.lon]} zoom={5} scrollWheelZoom>
          <TileLayer
            url={layer.url}
            attribution={layer.attribution}
            maxZoom={layer.maxZoom}
            subdomains={layer.subdomains ?? 'abc'}
            className="rpm-tiles"
          />
          <FitPois items={items} onBackgroundClick={() => setActiveId(null)} />
          {items.map((item) => (
            <PoiPin
              key={item.poi.id}
              item={item}
              showType={suuntoConnected}
              selected={selection.has(item.poi.id)}
              active={item.poi.id === activeId}
              onOpen={setActiveId}
            />
          ))}
        </LeafletMap>
      </div>
      {active ? (
          <PoiDetails
            item={active}
            typeName={typeName(active.poi.poiType)}
            suuntoConnected={suuntoConnected}
            selected={selection.has(active.poi.id)}
            onToggle={(extend) => selection.toggle(active.poi.id, extend)}
          onClose={() => setActiveId(null)}
        />
      ) : (
        <p className={styles.mapHint}>Click a POI to see its details. POIs selected in the list are outlined.</p>
      )}
    </div>
  );
}

function pinIcon(type: number | null, selected: boolean, active: boolean) {
  return L.divIcon({
    className: [styles.pin, selected && styles.pinSelected, active && styles.pinActive].filter(Boolean).join(' '),
    iconSize: active ? [40, 40] : [30, 30],
    html: type === null ? '' : `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="${poiGlyph(type)}"/></svg>`,
  });
}

function PoiPin({
  item,
  showType,
  selected,
  active,
  onOpen,
}: {
  item: PoiListItem;
  showType: boolean;
  selected: boolean;
  active: boolean;
  onOpen: (id: string) => void;
}) {
  const p = item.poi;
  const icon = useMemo(() => pinIcon(showType ? p.poiType : null, selected, active), [showType, p.poiType, selected, active]);
  const handlers = useMemo<L.LeafletEventHandlerFnMap>(() => ({ click: () => onOpen(p.id) }), [onOpen, p.id]);
  return (
    <Marker
      position={[p.lat, p.lon]}
      icon={icon}
      title={p.name}
      // Selected pins stay above the rest, and the open one above those.
      zIndexOffset={active ? 2000 : selected ? 1000 : 0}
      eventHandlers={handlers}
    />
  );
}

/** Frames the shown POIs whenever the set changes (search, filter, deletes), and closes details on a map click. */
function FitPois({ items, onBackgroundClick }: { items: PoiListItem[]; onBackgroundClick: () => void }) {
  const map = useMap();
  useMapEvents({ click: onBackgroundClick });
  const latest = useRef(items);
  latest.current = items;
  const key = items.map((i) => i.poi.id).join();
  useEffect(() => {
    const points = latest.current.map((i) => [i.poi.lat, i.poi.lon] as L.LatLngTuple);
    if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 14 });
    else if (points.length === 1) map.setView(points[0]!, 13);
  }, [map, key]);
  return null;
}

function PoiDetails({
  item,
  typeName,
  suuntoConnected,
  selected,
  onToggle,
  onClose,
}: {
  item: PoiListItem;
  typeName: string;
  suuntoConnected: boolean;
  selected: boolean;
  onToggle: (extend: boolean) => void;
  onClose: () => void;
}) {
  const p = item.poi;
  const headingId = useId();
  return (
    <section className={styles.details} aria-labelledby={headingId}>
      <div className={styles.detailsHead}>
        {suuntoConnected && (
          <span className={styles.badge} aria-hidden="true">
            <svg viewBox="0 0 16 16" width="16" height="16">
              <path d={poiGlyph(p.poiType)} />
            </svg>
          </span>
        )}
        <h2 id={headingId} className={styles.detailsTitle}>
          {p.name}
        </h2>
        <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close details" title="Close">
          <Icon name="close" size={18} />
        </button>
      </div>
      {p.description && <p className={styles.detailsDesc}>{p.description}</p>}
      <dl className={styles.facts}>
        {suuntoConnected && (
          <>
            <dt>Type</dt>
            <dd>{typeName}</dd>
          </>
        )}
        <dt>Elevation</dt>
        <dd>{p.ele !== null ? formatElevation(p.ele) : 'Unknown'}</dd>
        <dt>Route</dt>
        <dd>{item.routeId ? <Link to={`/routes/${item.routeId}`}>{item.routeName}</Link> : 'Not on a route'}</dd>
        {suuntoConnected && (
          <>
            <dt>Sync</dt>
            <dd>
              <SyncStatus state={p.syncState} />
            </dd>
          </>
        )}
        <dt>Coordinates</dt>
        <dd>
          {p.lat.toFixed(5)}, {p.lon.toFixed(5)}
        </dd>
      </dl>
      <label className={styles.detailsSelect}>
        <SelectBox checked={selected} label={`Select ${p.name}`} onToggle={onToggle} />
        Selected
      </label>
    </section>
  );
}
