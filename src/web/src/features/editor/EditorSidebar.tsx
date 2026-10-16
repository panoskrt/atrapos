import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../../components/Icon';
import type { PoiLocation } from '../pois/placement';
import { PoiList } from '../pois/PoiList';
import { SyncPanel } from '../sync/SyncPanel';
import { toast } from '../../components/Toast';
import { gpxDownloadUrl } from '../routes/api';
import {
  COMMON_ACTIVITY_IDS,
  useActivityTypes,
  useRoutingProfiles,
  type RoutingProfile,
} from '../routes/api';
import { formatDistance, type RouteStats } from './geo';
import { useEditorStore } from './store';
import type { SaveStatus } from './useManualSave';
import { WeatherPanel } from '../weather/WeatherPanel';
import { SurfacePanel } from '../surface/SurfacePanel';
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
  const name = useEditorStore((s) => s.name);
  const setName = useEditorStore((s) => s.setName);
  const poiCount = useEditorStore((s) => s.pois.length);
  const selectedPoiId = useEditorStore((s) => s.selectedPoiId);
  const tool = useEditorStore((s) => s.tool);
  const [tab, setTab] = useState<'route' | 'pois' | 'weather'>('route');

  // Placing or selecting a POI shows the POI list.
  useEffect(() => {
    if (selectedPoiId || tool === 'poi') setTab('pois');
  }, [selectedPoiId, tool]);
  const nameId = useId();

  return (
    <aside className={styles.sidebar}>
      <div className={styles.sideHead}>
        <div className={styles.sideTopRow}>
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
        </div>
        <label htmlFor={nameId} className={styles.label}>
          Route name
        </label>
        <input
          id={nameId}
          className={styles.nameInput}
          value={name}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
          placeholder="Untitled route"
        />
        <dl className={styles.stats}>
          <div>
            <dt>Distance</dt>
            <dd>{formatDistance(stats.distanceM)}</dd>
          </div>
          <div>
            <dt>Ascent</dt>
            <dd>+{Math.round(stats.ascentM)} m</dd>
          </div>
          <div>
            <dt>Descent</dt>
            <dd>−{Math.round(stats.descentM)} m</dd>
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
          <RouteTab routeId={routeId} flush={save.flush} isDraft={isDraft} />
        ) : tab === 'pois' ? (
          <PoiList locations={poiLocations} onFocus={onFocus} />
        ) : (
          <WeatherPanel routeId={routeId} isDraft={isDraft} />
        )}
      </div>

      {!isDraft && <SyncPanel routeId={routeId} flush={save.flush} onReload={onReload} />}
    </aside>
  );
}

function RouteTab({ routeId, flush, isDraft }: { routeId: string; flush: () => Promise<boolean>; isDraft: boolean }) {
  const hasLine = useEditorStore((s) => s.points.length > 1);
  const [downloading, setDownloading] = useState(false);
  const download = async () => {
    setDownloading(true);
    try {
      if (!(await flush())) {
        toast('Save your changes before downloading the route.', { tone: 'error' });
        return;
      }
      // A plain link download keeps the server's file name (Content-Disposition).
      const a = document.createElement('a');
      a.href = gpxDownloadUrl(routeId);
      a.download = '';
      document.body.append(a);
      a.click();
      a.remove();
    } finally {
      setDownloading(false);
    }
  };
  const activityIds = useEditorStore((s) => s.activityIds);
  const toggleActivity = useEditorStore((s) => s.toggleActivity);
  const turnWaypoints = useEditorStore((s) => s.turnWaypointsEnabled);
  const setTurnWaypoints = useEditorStore((s) => s.setTurnWaypoints);
  const description = useEditorStore((s) => s.description);
  const setDescription = useEditorStore((s) => s.setDescription);
  const activities = useActivityTypes();
  const routingProfile = useEditorStore((s) => s.routingProfile);
  const setRoutingProfile = useEditorStore((s) => s.setRoutingProfile);
  const profiles = useRoutingProfiles();
  const profileGroups = Object.entries(
    Object.groupBy(profiles.data ?? [{ id: routingProfile, label: routingProfile, group: 'Profile' }], (p) => p.group),
  ) as [string, RoutingProfile[]][];
  const descId = useId();
  const moreId = useId();
  const turnId = useId();

  const nameOf = (id: number) => activities.data?.find((a) => a.id === id)?.name ?? `Activity ${id}`;
  const chipIds = [...new Set([...activityIds, ...COMMON_ACTIVITY_IDS])];
  const others = (activities.data ?? []).filter((a) => !chipIds.includes(a.id));

  return (
    <>
      <SurfacePanel routeId={routeId} isDraft={isDraft} />
      <fieldset className={styles.fieldset}>
        <legend className={styles.label}>Suunto activities</legend>
        <div className={styles.chips}>
          {chipIds.map((id) => {
            const on = activityIds.includes(id);
            return (
              <label key={id} className={on ? styles.chipOn : styles.chip}>
                <input type="checkbox" checked={on} onChange={() => toggleActivity(id)} />
                {nameOf(id)}
              </label>
            );
          })}
        </div>
        {others.length > 0 && (
          <>
            <label htmlFor={moreId} className="visually-hidden">
              Add another activity
            </label>
            <select
              id={moreId}
              className={styles.select}
              value=""
              onChange={(e) => e.target.value && toggleActivity(Number(e.target.value))}
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

      <label className={styles.field}>
        <span className={styles.label}>Routing profile (BRouter)</span>
        <select className={styles.select} value={routingProfile} onChange={(e) => setRoutingProfile(e.target.value)}>
          {profileGroups.map(([group, items]) => (
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

      <div className={styles.toggleRow}>
        <label htmlFor={turnId} className={styles.toggleText}>
          <strong>Turn-by-turn waypoints</strong>
          <span className={styles.muted}>Suunto adds turn alerts on the watch</span>
        </label>
        <input id={turnId} type="checkbox" checked={turnWaypoints} onChange={(e) => setTurnWaypoints(e.target.checked)} />
      </div>

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

      {!isDraft && (
        <button
          type="button"
          className={`btn ${styles.downloadBtn}`}
          onClick={() => void download()}
          disabled={!hasLine || downloading}
          title={hasLine ? 'GPX with the route and all its POIs, for other apps' : 'Draw at least two points first'}
        >
          <Icon name="download" size={18} />
          {downloading ? 'Preparing…' : 'Download GPX'}
        </button>
      )}
    </>
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
