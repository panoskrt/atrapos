import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useMemo, useRef, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router';
import { Icon } from '../../components/Icon';
import { SelectionBar, TriCheckbox } from '../../components/SelectionBar';
import { toast } from '../../components/Toast';
import { usePersistentState } from '../../lib/usePersistentState';
import { useSelection } from '../../lib/useSelection';
import { formatDistance } from '../editor/geo';
import { ACCEPTED_EXTENSIONS, isImportable, MAX_FILE_BYTES } from '../import/api';
import { ImportDialog } from '../import/ImportDialog';
import {
  routeKeys,
  useActivityTypes,
  useDeleteRoute,
  useDeleteRoutes,
  useRoutes,
  type RouteSummary,
} from '../routes/api';
import { allPoisKey, refreshFromSuunto, summarizeRefresh, syncErrorMessage } from '../sync/api';
import { confirmRouteDelete } from './confirmRouteDelete';
import {
  activityOptions,
  FILTER_LABELS,
  filterAndSort,
  isRouteSort,
  isRouteView,
  nextSort,
  SORT_LABELS,
  summarize,
  type RouteFilter,
  type RouteSort,
  type RouteSortKey,
} from './dashboard';
import { RouteCards, RouteTable } from './RouteViews';
import toolbar from '../../components/Toolbar.module.css';
import { Spinner } from '../../components/Spinner';
import styles from './LibraryPage.module.css';

const DEFAULT_SORT: RouteSort = { key: 'modified', dir: 'desc' };

export function LibraryPage() {
  const routes = useRoutes();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const [view, setView] = usePersistentState('rpm.library.view', 'cards', isRouteView);
  const [sort, setSort] = usePersistentState('rpm.library.sort', DEFAULT_SORT, isRouteSort);
  const [filter, setFilter] = useState<RouteFilter>('all');
  const [query, setQuery] = useState('');
  const [chosenActivity, setActivity] = useState<number | null>(null);
  const ids = { search: useId(), filter: useId(), activity: useId(), sort: useId() };
  const activityTypes = useActivityTypes();

  const all = routes.data;
  const stats = useMemo(() => summarize(all ?? []), [all]);
  const activities = useMemo(
    () => activityOptions(all ?? [], (id) => activityTypes.data?.find((a) => a.id === id)?.name),
    [all, activityTypes.data],
  );
  // If the last route with that activity is deleted, fall back to all activities rather than an empty list.
  const activity = activities.some((a) => a.id === chosenActivity) ? chosenActivity : null;
  const shown = useMemo(
    () => filterAndSort(all ?? [], { query, filter, sort, activity }),
    [all, query, filter, sort, activity],
  );
  const shownIds = useMemo(() => shown.map((r) => r.id), [shown]);
  const selection = useSelection(shownIds);
  const filtering = filter !== 'all' || activity !== null || query.trim() !== '';

  const qc = useQueryClient();
  // Only on click: Suunto prohibits polling.
  const refresh = useMutation({
    mutationFn: refreshFromSuunto,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: routeKeys.all, exact: true });
      void qc.invalidateQueries({ queryKey: allPoisKey });
    },
  });
  const deleteOne = useDeleteRoute();
  const deleteMany = useDeleteRoutes();

  const newRoute = () => navigate('/routes/new');

  const onDelete = async (route: RouteSummary) => {
    if (await confirmRouteDelete([route])) deleteOne.mutate(route.id);
  };

  const deleteSelected = async () => {
    const chosen = shown.filter((r) => selection.has(r.id));
    if (!chosen.length || !(await confirmRouteDelete(chosen))) return;
    deleteMany.mutate(
      chosen.map((r) => r.id),
      {
        onSuccess: ({ deleted }) => {
          selection.clear();
          toast(`Deleted ${deleted} ${deleted === 1 ? 'route' : 'routes'}.`);
        },
        onError: (e) => toast(`Couldn't delete the routes: ${e.message}`, { tone: 'error' }),
      },
    );
  };

  const onSort = (key: RouteSortKey) => setSort(nextSort(sort, key));

  const startImport = (file: File | undefined) => {
    if (!file) return;
    if (!isImportable(file)) {
      setFileError(`${file.name} isn't a GPX or FIT file.`);
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setFileError(`${file.name} is larger than 20 MB.`);
      return;
    }
    setFileError(null);
    setImportFile(file);
  };

  const dropHandlers = {
    onDragEnter: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes('Files')) return;
      dragDepth.current++;
      setDragging(true);
    },
    onDragOver: (e: DragEvent) => {
      if (e.dataTransfer.types.includes('Files')) e.preventDefault();
    },
    onDragLeave: () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      startImport(e.dataTransfer.files[0]);
    },
  };

  const dropCard = (
    <button type="button" className={styles.dropCard} onClick={() => fileInput.current?.click()}>
      <Icon name="fileUp" size={36} />
      <strong>Drop GPX or FIT files</strong>
      <span>Tracks, routes, FIT courses and activities</span>
    </button>
  );

  return (
    <div className={styles.page} {...dropHandlers}>
      {dragging && (
        <div className={styles.dropOverlay} aria-hidden="true">
          <Icon name="fileUp" size={40} />
          Drop the GPX or FIT file to import it
        </div>
      )}
      <input
        ref={fileInput}
        type="file"
        accept={ACCEPTED_EXTENSIONS.join(',')}
        hidden
        onChange={(e) => {
          startImport(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {importFile && <ImportDialog file={importFile} onClose={() => setImportFile(null)} />}

      <div className={styles.header}>
        <div className={styles.heading}>
          <h1 className={`display ${styles.title}`}>My routes</h1>
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
          aria-busy={refresh.isPending}
        >
          {refresh.isPending ? <Spinner /> : <Icon name="refresh" size={18} />}
          {refresh.isPending ? 'Refreshing…' : 'Refresh from Suunto'}
        </button>
        <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
          <Icon name="fileUp" size={18} />
          Import GPX / FIT
        </button>
        <button type="button" className="btn btn-primary" onClick={newRoute}>
          <Icon name="plus" size={18} />
          New route
        </button>
      </div>

      {fileError && (
        <p role="alert" className={styles.error}>
          {fileError}
        </p>
      )}
      {refresh.isError && (
        <p role="alert" className={styles.error}>
          Couldn't refresh from Suunto: {syncErrorMessage(refresh.error).message}{' '}
          {syncErrorMessage(refresh.error).signIn && (
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
      {refresh.isSuccess && (
        <p role="status" className={styles.sub}>
          {summarizeRefresh(refresh.data)}
        </p>
      )}

      {routes.isPending ? (
        <p className={styles.sub} aria-busy="true">
          Loading routes…
        </p>
      ) : routes.isError ? (
        <p role="alert" className={styles.error}>
          Couldn't load routes: {routes.error.message}
        </p>
      ) : routes.data.length === 0 ? (
        <div className={styles.empty}>
          <Icon name="logo" size={40} />
          <h2 className={styles.emptyTitle}>Your library is empty</h2>
          <p className={styles.emptyText}>
            Draw a route on the map, or drop a GPX or FIT file here. Routes and their POIs stay here until you push
            them to the Suunto app.
          </p>
          <div className={styles.emptyActions}>
            <button type="button" className="btn btn-primary" onClick={newRoute}>
              <Icon name="plus" size={18} />
              Draw your first route
            </button>
            <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
              <Icon name="fileUp" size={18} />
              Import a file
            </button>
          </div>
        </div>
      ) : (
        <>
          <section className={styles.stats} aria-label="Library summary">
            <Stat label={stats.routes === 1 ? 'Route' : 'Routes'} value={stats.routes.toLocaleString()} />
            <Stat label="Distance" value={formatDistance(stats.distanceM)} />
            <Stat label="Climbing" value={`${Math.round(stats.ascentM).toLocaleString()} m`} />
            <Stat label="POIs" value={stats.pois.toLocaleString()} />
            <FilterStat
              label="Not pushed"
              value={stats.toPush}
              tone="warn"
              active={filter === 'toPush'}
              onClick={() => setFilter(filter === 'toPush' ? 'all' : 'toPush')}
            />
            {stats.attention > 0 && (
              <FilterStat
                label="Needs attention"
                value={stats.attention}
                tone="danger"
                active={filter === 'attention'}
                onClick={() => setFilter(filter === 'attention' ? 'all' : 'attention')}
              />
            )}
          </section>

          <div className={toolbar.toolbar} role="toolbar" aria-label="Show routes">
            {view === 'cards' && (
              <label className={toolbar.selectAll}>
                <TriCheckbox
                  state={selection.stateOf()}
                  onChange={() => selection.toggleAll()}
                  disabled={shown.length === 0}
                />
                Select all
              </label>
            )}
            <div className={toolbar.search}>
              <label htmlFor={ids.search} className="visually-hidden">
                Search routes
              </label>
              <Icon name="search" size={18} className={toolbar.searchIcon} />
              <input
                id={ids.search}
                type="search"
                placeholder="Search routes"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <label htmlFor={ids.filter} className="visually-hidden">
              Show
            </label>
            <select id={ids.filter} className={toolbar.select} value={filter} onChange={(e) => setFilter(e.target.value as RouteFilter)}>
              {Object.entries(FILTER_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <label htmlFor={ids.activity} className="visually-hidden">
              Activity
            </label>
            <select
              id={ids.activity}
              className={toolbar.select}
              value={activity ?? ''}
              onChange={(e) => setActivity(e.target.value === '' ? null : Number(e.target.value))}
            >
              <option value="">All activities</option>
              {activities.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.count})
                </option>
              ))}
            </select>
            <div className={styles.sortGroup}>
              <label htmlFor={ids.sort} className={styles.inlineLabel}>
                Sort by
              </label>
              <select
                id={ids.sort}
                className={toolbar.select}
                value={sort.key}
                onChange={(e) => onSort(e.target.value as RouteSortKey)}
              >
                {Object.entries(SORT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={styles.toolBtn}
                onClick={() => setSort({ ...sort, dir: sort.dir === 'asc' ? 'desc' : 'asc' })}
                aria-label={sort.dir === 'asc' ? 'Ascending; switch to descending' : 'Descending; switch to ascending'}
                title={sort.dir === 'asc' ? 'Ascending' : 'Descending'}
              >
                <Icon name={sort.dir === 'asc' ? 'arrowUp' : 'arrowDown'} size={18} />
              </button>
            </div>
            <div className={styles.viewToggle} role="group" aria-label="Layout">
              <button
                type="button"
                className={styles.toolBtn}
                aria-pressed={view === 'cards'}
                onClick={() => setView('cards')}
                title="Boxes"
              >
                <Icon name="grid" size={18} />
                <span className={styles.toggleText}>Boxes</span>
              </button>
              <button
                type="button"
                className={styles.toolBtn}
                aria-pressed={view === 'list'}
                onClick={() => setView('list')}
                title="List"
              >
                <Icon name="list" size={18} />
                <span className={styles.toggleText}>List</span>
              </button>
            </div>
          </div>

          <p className={styles.sub} aria-live="polite">
            {filtering
              ? `Showing ${shown.length} of ${stats.routes} ${stats.routes === 1 ? 'route' : 'routes'}`
              : `${stats.routes} ${stats.routes === 1 ? 'route' : 'routes'}`}
          </p>

          {shown.length === 0 ? (
            <div className={styles.noMatch}>
              <p>No routes match.</p>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setFilter('all');
                  setActivity(null);
                  setQuery('');
                }}
              >
                Clear search and filters
              </button>
            </div>
          ) : view === 'cards' ? (
            <RouteCards
              routes={shown}
              selection={selection}
              onDelete={onDelete}
              deleting={deleteOne.isPending}
              leading={filtering ? undefined : dropCard}
            />
          ) : (
            <RouteTable
              routes={shown}
              selection={selection}
              onDelete={onDelete}
              deleting={deleteOne.isPending}
              sort={sort}
              onSort={onSort}
            />
          )}
        </>
      )}

      <SelectionBar count={selection.count} noun={['route', 'routes']} onClear={selection.clear}>
        <button type="button" className="btn btn-danger" onClick={deleteSelected} disabled={deleteMany.isPending}>
          <Icon name="trash" size={18} />
          {deleteMany.isPending ? 'Deleting…' : `Delete ${selection.count}`}
        </button>
      </SelectionBar>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

/** A summary tile that doubles as a filter shortcut. */
function FilterStat({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: number;
  tone: 'warn' | 'danger';
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`${styles.stat} ${styles.statButton} ${value ? styles[`stat_${tone}`] : ''}`}
      aria-pressed={active}
      onClick={onClick}
      disabled={value === 0 && !active}
    >
      <span className={styles.statValue}>{value.toLocaleString()}</span>
      <span className={styles.statLabel}>{label}</span>
    </button>
  );
}
