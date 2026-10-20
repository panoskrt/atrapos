import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../../components/Icon';
import { useMe } from '../auth/useMe';
import { SelectBox, SelectionBar, TriCheckbox } from '../../components/SelectionBar';
import { toast } from '../../components/Toast';
import { useSelection, type Selection } from '../../lib/useSelection';
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
        <p className={styles.sub}>Loading POIs…</p>
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
  const tone =
    p.syncState === 'synced' ? styles.ok : p.syncState === 'localOnly' ? styles.muted : p.syncState === 'localChanges' ? styles.warn : styles.danger;
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
      </span>
      {suuntoConnected && (
        <span className={tone}>
          <span className={styles.dot} />
          {p.syncState === 'localOnly' ? 'Not pushed' : syncStateLabel[p.syncState]}
        </span>
      )}
      <button type="button" className={styles.iconBtn} onClick={onDelete} aria-label={`Delete ${p.name}`} title="Delete">
        <Icon name="trash" size={18} />
      </button>
    </li>
  );
}
