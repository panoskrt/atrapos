import { useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../../components/Icon';
import { useEditorStore } from '../editor/store';
import { syncStateLabel } from '../routes/api';
import {
  pushRoute,
  pushRoutePois,
  resolveConflict,
  syncErrorMessage,
  type ConflictStrategy,
  type PoiPushResult,
  type RoutePushResponse,
} from './api';
import { ConflictDialog } from './ConflictDialog';
import { PushResultDialog } from './PushResultDialog';
import { Spinner } from '../../components/Spinner';
import styles from './Sync.module.css';

interface Props {
  routeId: string;
  /** Saves pending edits; false if that isn't possible right now. */
  flush: () => Promise<boolean>;
  /** Reloads the editor from the server (after taking the Suunto version). */
  onReload: () => void;
}

/** "Sync to Suunto app": the route and its POIs are pushed separately (two different Suunto APIs). */
export function SyncPanel({ routeId, flush, onReload }: Props) {
  const syncState = useEditorStore((s) => s.syncState);
  const setSyncState = useEditorStore((s) => s.setSyncState);
  const setPoiServerState = useEditorStore((s) => s.setPoiServerState);
  const pois = useEditorStore((s) => s.pois);
  const poiServer = useEditorStore((s) => s.poiServer);
  const hasLine = useEditorStore((s) => s.points.length > 1);

  const [busy, setBusy] = useState<'route' | 'pois' | 'resolve' | null>(null);
  const [error, setError] = useState<{ message: string; signIn: boolean } | null>(null);
  const [conflict, setConflict] = useState<RoutePushResponse | null>(null);
  const [poiResults, setPoiResults] = useState<PoiPushResult[] | null>(null);
  const [copy, setCopy] = useState<{ id: string; name: string } | null>(null);

  const pendingPois = pois.filter((p) => (poiServer[p.id]?.syncState ?? 'localOnly') !== 'synced').length;
  const routeUpToDate = syncState === 'synced';

  const run = async (kind: 'route' | 'pois' | 'resolve', action: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      if (!(await flush())) {
        setError({ message: 'Your latest changes are still being saved. Try again in a moment.', signIn: false });
        return;
      }
      await action();
    } catch (e) {
      setError(syncErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const onPushRoute = () =>
    run('route', async () => {
      const res = await pushRoute(routeId);
      setSyncState(res.route.syncState);
      if (res.outcome === 'conflict') setConflict(res);
    });

  const onPushPois = () =>
    run('pois', async () => {
      const res = await pushRoutePois(routeId);
      setPoiServerState(Object.fromEntries(res.pois.map((p) => [p.id, { syncState: p.syncState, suuntoPoiKey: p.suuntoPoiKey }])));
      setPoiResults(res.results);
    });

  const onResolve = (strategy: ConflictStrategy) =>
    run('resolve', async () => {
      const res = await resolveConflict(routeId, strategy);
      setConflict(null);
      if (res.copyId) setCopy({ id: res.copyId, name: `${res.result.route.name} (my version)` });
      if (strategy === 'keepMine') setSyncState(res.result.route.syncState);
      else onReload();
    });

  return (
    <div className={styles.panel}>
      <span className={styles.label}>Sync to Suunto app</span>

      <div className={styles.row}>
        <Icon name="logo" style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <span className={styles.rowText}>
          <strong>Route</strong>
          <span className={stateClass(syncState)}>{syncStateLabel[syncState]}</span>
        </span>
        <button
          type="button"
          className="btn btn-primary"
          // In conflict, pushing again re-checks Suunto and reopens the choice.
          onClick={() => void onPushRoute()}
          disabled={!hasLine || busy !== null || routeUpToDate}
          aria-busy={busy === 'route'}
          title={!hasLine ? 'Draw at least two points first' : routeUpToDate ? 'Suunto has this version' : undefined}
        >
          {busy === 'route' && <Spinner />}
          {busy === 'route' ? 'Pushing…' : syncState === 'conflict' ? 'Resolve…' : routeUpToDate ? 'Pushed' : 'Push route'}
        </button>
      </div>

      <div className={styles.row}>
        <Icon name="pin" style={{ color: 'var(--poi)', flexShrink: 0 }} />
        <span className={styles.rowText}>
          <strong>POIs</strong>
          <span className={pendingPois ? styles.stateWarn : styles.stateOk}>
            {pois.length === 0 ? 'None on this route' : pendingPois ? `${pendingPois} of ${pois.length} not pushed` : 'All pushed'}
          </span>
        </span>
        <button type="button" className={`btn ${styles.poiBtn}`} onClick={() => void onPushPois()} disabled={!pendingPois || busy !== null} aria-busy={busy === 'pois'}>
          {busy === 'pois' && <Spinner />}
          {busy === 'pois' ? 'Pushing…' : pendingPois ? `Push ${pendingPois} ${pendingPois === 1 ? 'POI' : 'POIs'}` : 'Pushed'}
        </button>
      </div>

      {(busy === 'route' || busy === 'pois') && (
        <p role="status" className={styles.note}>
          {busy === 'route' ? 'Uploading the route to Suunto…' : `Uploading ${pendingPois === 1 ? 'the POI' : `${pendingPois} POIs`} to Suunto, one at a time…`}
        </p>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error.message}{' '}
          {error.signIn && (
            <a href="/auth/login" className={styles.inlineLink}>
              Sign in with Suunto again
            </a>
          )}
        </p>
      )}
      {copy && (
        <p role="status" className={styles.note}>
          Your version was saved as{' '}
          <Link to={`/routes/${copy.id}`} className={styles.inlineLink}>
            {copy.name}
          </Link>
          .
        </p>
      )}

      {conflict && (
        <ConflictDialog conflict={conflict} busy={busy === 'resolve'} onResolve={onResolve} onClose={() => setConflict(null)} />
      )}
      {poiResults && <PushResultDialog results={poiResults} onClose={() => setPoiResults(null)} />}
    </div>
  );
}

function stateClass(state: string) {
  return state === 'synced' ? styles.stateOk : state === 'localOnly' ? styles.stateMuted : state === 'localChanges' ? styles.stateWarn : styles.stateDanger;
}
