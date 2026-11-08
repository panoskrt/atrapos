import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Icon } from '../../components/Icon';
import { useMe } from '../auth/useMe';
import type { PoiLocation } from '../pois/placement';
import { PoiList } from '../pois/PoiList';
import { SyncPanel } from '../sync/SyncPanel';
import { toast } from '../../components/Toast';
import {
  downloadRouteGpx,
  routeKeys,
  splitRouteByDistance,
  useActivityTypes,
  useRoutingProfiles,
  type RouteDetail,
  type RoutingProfile,
} from '../routes/api';
import { formatDistance, formatElevation, type RouteStats } from './geo';
import { useEditorStore } from './store';
import type { SaveStatus } from './useManualSave';
import { WeatherPanel } from '../weather/WeatherPanel';
import { preferredRoutingGroup, prioritizeRoutingProfileGroups, suggestedRoutingProfile } from './routingProfilePreference';
import { useUserSettings } from '../profile/userSettings';
import { DEFAULT_FAVORITE_ACTIVITY_IDS } from '../../lib/userPreferences';
import type { UserSettings } from '../../lib/userPreferences';
import styles from './Editor.module.css';

interface Props {
  stats: RouteStats;
  vertexCount: number;
  save: { status: SaveStatus; error: string | null; retry: () => void; flush: () => Promise<boolean> };
  poiLocations: Map<string, PoiLocation>;
  onFocus: (lon: number, lat: number) => void;
  routeId: string;
  onReload: () => void;
  isDraft: boolean;
  onSave: () => void;
  savePending: boolean;
  canSave: boolean;
}

export function EditorSidebar({
  stats,
  vertexCount,
  save,
  poiLocations,
  onFocus,
  routeId,
  onReload,
  isDraft,
  onSave,
  savePending,
  canSave,
}: Props) {
  const me = useMe();
  const suuntoConnected = me.data?.suuntoConnected ?? false;
  const name = useEditorStore((s) => s.name);
  const setName = useEditorStore((s) => s.setName);
  const hasLine = useEditorStore((s) => s.points.length > 1);
  const pointCount = useEditorStore((s) => s.points.length);
  const poiCount = useEditorStore((s) => s.pois.length);
  const setRoutingProfile = useEditorStore((s) => s.setRoutingProfile);
  const selectedPoiId = useEditorStore((s) => s.selectedPoiId);
  const tool = useEditorStore((s) => s.tool);
  const [tab, setTab] = useState<'route' | 'pois' | 'weather'>('route');
  const [downloading, setDownloading] = useState(false);
  const userSettings = useUserSettings();
  const appliedDefaultProfile = useRef<string | null>(null);

  useEffect(() => {
    if (!isDraft || !userSettings.data || appliedDefaultProfile.current === routeId) return;
    appliedDefaultProfile.current = routeId;
    if (userSettings.data.defaultRoutingProfile) {
      setRoutingProfile(userSettings.data.defaultRoutingProfile);
    }
  }, [isDraft, routeId, setRoutingProfile, userSettings.data]);
  // Placing or selecting a POI shows the POI list.
  useEffect(() => {
    if (selectedPoiId || tool === 'poi') setTab('pois');
  }, [selectedPoiId, tool]);
  const nameId = useId();

  const download = async () => {
    setDownloading(true);
    try {
      if (!(await save.flush())) {
        toast('Save your changes before downloading the route.', { tone: 'error' });
        return;
      }
      downloadRouteGpx(routeId);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <aside className={styles.sidebar}>
      <div className={styles.sideHead}>
        <div className={styles.sideTopRow}>
          <SaveControls save={save} onSave={onSave} savePending={savePending} canSave={canSave} />
        </div>
        <label htmlFor={nameId} className={styles.label}>
          Route name
        </label>
        <div className={styles.nameRow}>
          <input
            id={nameId}
            className={styles.nameInput}
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
            placeholder="Untitled route"
          />
          {!isDraft && (
            <button
              type="button"
              className={`btn btn-icon ${styles.downloadBtn}`}
              onClick={() => void download()}
              disabled={!hasLine || downloading}
              title={hasLine ? 'Download GPX' : 'Draw at least two points first'}
              aria-label="Download GPX"
            >
              <Icon name="download" size={18} />
            </button>
          )}
          {!isDraft && (
            <DistanceSplitControl
              routeId={routeId}
              routeName={name}
              distanceM={stats.distanceM}
              pointCount={pointCount}
              flush={save.flush}
            />
          )}
        </div>
        <dl className={styles.stats}>
          <div>
            <dt>Distance</dt>
            <dd>{formatDistance(stats.distanceM)}</dd>
          </div>
          <div>
            <dt>Ascent</dt>
            <dd>+{formatElevation(stats.ascentM)}</dd>
          </div>
          <div>
            <dt>Descent</dt>
            <dd>−{formatElevation(stats.descentM)}</dd>
          </div>
          <div>
            <dt>Points</dt>
            <dd>{vertexCount.toLocaleString('en-US')}</dd>
          </div>
        </dl>
      </div>

      <div role="tablist" aria-label="Editor panels" className={styles.tabs}>
        <button type="button" role="tab" aria-selected={tab === 'route'} className={tab === 'route' ? styles.tabOn : styles.tab} onClick={() => setTab('route')}>
          Route
        </button>
        <button type="button" role="tab" aria-selected={tab === 'pois'} className={tab === 'pois' ? styles.tabOn : styles.tab} onClick={() => setTab('pois')}>
          POIs <span className={styles.tabCount}>{poiCount}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'weather'}
          className={tab === 'weather' ? styles.tabOn : styles.tab}
          onClick={() => setTab('weather')}
        >
          Weather
        </button>
      </div>

      <div className={styles.sideBody} role="tabpanel">
        {tab === 'route' ? (
          <RouteTab suuntoConnected={suuntoConnected} settings={userSettings.data} />
        ) : tab === 'pois' ? (
          <PoiList locations={poiLocations} onFocus={onFocus} suuntoConnected={suuntoConnected} />
        ) : (
          <WeatherPanel routeId={routeId} isDraft={isDraft} />
        )}
      </div>

      {suuntoConnected && !isDraft && <SyncPanel routeId={routeId} flush={save.flush} onReload={onReload} />}
    </aside>
  );
}

function DistanceSplitControl({
  routeId,
  routeName,
  distanceM,
  pointCount,
  flush,
}: {
  routeId: string;
  routeName: string;
  distanceM: number;
  pointCount: number;
  flush: () => Promise<boolean>;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={`btn ${styles.openSplitDialog}`}
        onClick={() => setOpen(true)}
        disabled={pointCount < 3}
        title={pointCount < 3 ? 'At least three route points are needed' : 'Split into new routes by distance'}
        aria-label="Split into new routes by distance"
      >
        <Icon name="scissors" size={16} />
        Split
      </button>
      {open && (
        <DistanceSplitDialog
          routeId={routeId}
          routeName={routeName}
          distanceM={distanceM}
          pointCount={pointCount}
          flush={flush}
          queryClient={queryClient}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function DistanceSplitDialog({
  routeId,
  routeName,
  distanceM,
  pointCount,
  flush,
  queryClient,
  onClose,
}: {
  routeId: string;
  routeName: string;
  distanceM: number;
  pointCount: number;
  flush: () => Promise<boolean>;
  queryClient: ReturnType<typeof useQueryClient>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const inputId = useId();
  const [intervalKm, setIntervalKm] = useState('5');
  const [splitting, setSplitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdRoutes, setCreatedRoutes] = useState<RouteDetail[] | null>(null);
  const intervalM = Number(intervalKm) * 1000;
  const canSplit = Number.isFinite(intervalM) && intervalM > 0 && intervalM < distanceM && pointCount >= 3;

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
  }, []);

  const split = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSplit || splitting) return;

    setSplitting(true);
    setError(null);
    try {
      if (!(await flush())) throw new Error('Save your changes before splitting the route.');
      const result = await splitRouteByDistance(routeId, intervalM);
      void queryClient.invalidateQueries({ queryKey: routeKeys.all, exact: true });
      setCreatedRoutes(result.routes);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The route could not be split.');
    } finally {
      setSplitting(false);
    }
  };

  return (
    <dialog ref={ref} className={styles.splitDialog} aria-labelledby={titleId} onClose={onClose}>
      <div className={styles.splitDialogHead}>
        <h2 id={titleId} className="display">{createdRoutes ? 'Routes created' : 'Split into new routes'}</h2>
        <button type="button" className={styles.splitDialogClose} onClick={() => ref.current?.close()} aria-label="Close">
          <Icon name="close" />
        </button>
      </div>
      {createdRoutes ? (
        <div className={styles.splitDialogBody}>
          <p role="status" className={styles.splitDialogSuccess}>
            Created {createdRoutes.length} new {createdRoutes.length === 1 ? 'route' : 'routes'} from “{routeName}”.
            The original route is unchanged.
          </p>
          <ul className={styles.splitResultList} aria-label="Created routes">
            {createdRoutes.map((route) => (
              <li key={route.id}>
                <Link to={`/routes/${route.id}`} onClick={() => ref.current?.close()}>
                  {route.name}
                </Link>
              </li>
            ))}
          </ul>
          <div className={styles.splitDialogActions}>
            <button type="button" className="btn btn-primary" onClick={() => ref.current?.close()}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <form className={styles.splitDialogBody} onSubmit={(event) => void split(event)}>
          <p>
            Create new route parts from “{routeName}”. The original route will stay unchanged. Cuts use the nearest saved
            control points, so part lengths may differ slightly. POIs are copied to their part.
          </p>
          <label className={styles.field} htmlFor={inputId}>
            Distance between parts (km)
            <input
              id={inputId}
              className={styles.select}
              type="number"
              min="0.1"
              step="0.1"
              value={intervalKm}
              onChange={(event) => setIntervalKm(event.target.value)}
            />
          </label>
          {pointCount < 3 ? (
            <p className={styles.splitDistanceHint}>At least three route points are needed to create multiple routes.</p>
          ) : !canSplit ? (
            <p className={styles.splitDistanceHint}>Enter a distance greater than zero and shorter than this route.</p>
          ) : null}
          {error && <p role="alert" className={styles.splitDialogError}>{error}</p>}
          <div className={styles.splitDialogActions}>
            <button type="button" className="btn" onClick={() => ref.current?.close()} disabled={splitting}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={!canSplit || splitting}>
              <Icon name="scissors" size={16} />
              {splitting ? 'Creating routes…' : 'Create routes'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}

function RouteTab({ suuntoConnected, settings }: { suuntoConnected: boolean; settings?: UserSettings }) {
  const activityIds = useEditorStore((s) => s.activityIds);
  const toggleActivity = useEditorStore((s) => s.toggleActivity);
  const turnWaypoints = useEditorStore((s) => s.turnWaypointsEnabled);
  const setTurnWaypoints = useEditorStore((s) => s.setTurnWaypoints);
  const description = useEditorStore((s) => s.description);
  const setDescription = useEditorStore((s) => s.setDescription);
  const activities = useActivityTypes(suuntoConnected);
  const routingProfile = useEditorStore((s) => s.routingProfile);
  const setRoutingProfile = useEditorStore((s) => s.setRoutingProfile);
  const profiles = useRoutingProfiles();
  const profileGroups = Object.entries(
    Object.groupBy(profiles.data ?? [{ id: routingProfile, label: routingProfile, group: 'Profile' }], (p) => p.group),
  ) as [string, RoutingProfile[]][];
  const prioritizedProfileGroups = prioritizeRoutingProfileGroups(profileGroups, activityIds);
  const descId = useId();
  const moreId = useId();
  const turnId = useId();

  const nameOf = (id: number) => activities.data?.find((a) => a.id === id)?.name ?? `Activity ${id}`;
  const favoriteActivityIds = settings?.favoriteActivityIds ?? DEFAULT_FAVORITE_ACTIVITY_IDS;
  const activityName = (id: number) => nameOf(id);
  const sortedFavoriteActivityIds = [...favoriteActivityIds].sort((a, b) => activityName(a).localeCompare(activityName(b)));
  const selectedOtherActivityIds = activityIds
    .filter((id) => !favoriteActivityIds.includes(id))
    .sort((a, b) => activityName(a).localeCompare(activityName(b)));
  const chipIds = [...new Set([...activityIds, ...favoriteActivityIds])];
  const others = (activities.data ?? [])
    .filter((a) => !chipIds.includes(a.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const toggleSport = (id: number) => {
    if ((activityIds.includes(id) && activityIds.length === 1) || (!activityIds.includes(id) && activityIds.length >= 10)) return;
    const nextActivityIds = activityIds.includes(id) ? activityIds.filter((activityId) => activityId !== id) : [...activityIds, id];
    toggleActivity(id);

    const preferredGroup = preferredRoutingGroup(nextActivityIds);
    const currentGroup = profiles.data?.find((profile) => profile.id === routingProfile)?.group;
    if (preferredGroup && currentGroup && currentGroup !== preferredGroup) {
      const userDefault = profiles.data?.find((profile) => profile.id === settings?.defaultRoutingProfile);
      const suggestedProfile = userDefault?.group === preferredGroup
        ? userDefault.id
        : suggestedRoutingProfile(nextActivityIds);
      if (suggestedProfile && profiles.data?.some((profile) => profile.id === suggestedProfile)) {
        setRoutingProfile(suggestedProfile);
      }
    }
  };

  return (
    <>
      {suuntoConnected && (
        <fieldset className={styles.fieldset}>
          <legend className={styles.label}>Suunto activities</legend>
          {favoriteActivityIds.length > 0 && (
            <div className={styles.chips}>
              {sortedFavoriteActivityIds.map((id) => {
                const on = activityIds.includes(id);
                return (
                  <label key={id} className={on ? styles.chipOn : styles.chip}>
                    <input type="checkbox" checked={on} onChange={() => toggleSport(id)} />
                    {nameOf(id)}
                  </label>
                );
              })}
            </div>
          )}
          {selectedOtherActivityIds.length > 0 && (
            <div className={styles.chips} aria-label="Selected other activities">
              {selectedOtherActivityIds.map((id) => (
                <label key={id} className={styles.chipOn}>
                  <input type="checkbox" checked onChange={() => toggleSport(id)} />
                  {nameOf(id)}
                </label>
              ))}
            </div>
          )}
          {others.length > 0 && (
            <>
              <label htmlFor={moreId} className="visually-hidden">
                Add another activity
              </label>
              <select
                id={moreId}
                className={styles.select}
                value=""
                onChange={(e) => e.target.value && toggleSport(Number(e.target.value))}
              >
                <option value="">More activities…</option>
                {others.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </>
          )}
        </fieldset>
      )}

      <label className={styles.field}>
        <span className={styles.label}>Routing profile (BRouter)</span>
        <select className={styles.select} value={routingProfile} onChange={(e) => setRoutingProfile(e.target.value)}>
          {prioritizedProfileGroups.map(([group, items]) => (
            <optgroup key={group} label={group}>
              {items.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <span className={styles.muted}>Used by snapped segments. Changing it re-routes them.</span>
      </label>

      {suuntoConnected && (
        <div className={styles.toggleRow}>
          <label htmlFor={turnId} className={styles.toggleText}>
            <strong>Turn-by-turn waypoints</strong>
            <span className={styles.muted}>Suunto adds turn alerts on the watch</span>
          </label>
          <input id={turnId} type="checkbox" checked={turnWaypoints} onChange={(e) => setTurnWaypoints(e.target.checked)} />
        </div>
      )}

      <label htmlFor={descId} className={styles.label}>
        Description
      </label>
      <textarea
        id={descId}
        className={styles.textarea}
        rows={3}
        maxLength={4000}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

    </>
  );
}

interface SaveControlsProps {
  save: Props['save'];
  onSave: () => void;
  savePending: boolean;
  canSave: boolean;
}

/** Back link, Save and the save status. */
function SaveControls({ save, onSave, savePending, canSave }: SaveControlsProps) {
  return (
    <>
      <Link to="/" className={styles.back}>
        <Icon name="chevronLeft" size={16} />
        Library
      </Link>
      <div className={styles.saveActions}>
        <button type="button" className="btn btn-primary" onClick={onSave} disabled={!canSave || savePending}>
          {savePending ? 'Saving…' : 'Save'}
        </button>
        <SaveIndicator {...save} />
      </div>
    </>
  );
}

/** Phones show the map first, so Back and Save live in a bar that stays under the top bar while the page scrolls. */
export function EditorActionBar(props: SaveControlsProps) {
  return (
    <div className={styles.actionBar}>
      <SaveControls {...props} />
    </div>
  );
}

function SaveIndicator({ status, error, retry }: Props['save']) {
  if (status === 'error')
    return (
      <span className={styles.saveError} role="status">
        Save failed{error ? `: ${error}` : ''}{' '}
        <button type="button" className={styles.linkBtn} onClick={retry}>
          Retry
        </button>
      </span>
    );
  return (
    <span className={styles.saveStatus} role="status">
      {status === 'saved' ? 'Saved' : status === 'saving' ? 'Saving…' : 'Unsaved changes'}
    </span>
  );
}
