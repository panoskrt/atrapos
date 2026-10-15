import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { useEditorStore } from '../editor/store';
import { pushPois, syncErrorMessage, type PoiPushResult } from './api';
import { Spinner } from '../../components/Spinner';
import styles from './Sync.module.css';

/** Per-POI outcome of a push. POIs are pushed one by one, so failures can be retried on their own. */
export function PushResultDialog({ results: initial, onClose }: { results: PoiPushResult[]; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [results, setResults] = useState(initial);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const setPoiServerState = useEditorStore((s) => s.setPoiServerState);
  const poiServer = useEditorStore((s) => s.poiServer);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    }
  }, []);

  const retry = async (id: string) => {
    setRetrying(id);
    setError(null);
    try {
      const res = await pushPois([id]);
      const r = res.results[0];
      if (r) {
        setResults((all) => all.map((x) => (x.id === id ? r : x)));
        if (r.status !== 'failed') setPoiServerState({ [id]: { syncState: 'synced', suuntoPoiKey: poiServer[id]?.suuntoPoiKey ?? null } });
      }
    } catch (e) {
      setError(syncErrorMessage(e).message);
    } finally {
      setRetrying(null);
    }
  };

  const failed = results.filter((r) => r.status === 'failed').length;

  return (
    <dialog ref={ref} className={styles.dialog} aria-labelledby={titleId} onClose={onClose}>
      <h2 id={titleId} className={`display ${styles.dialogTitle}`}>
        {results.length === 0 ? 'Nothing to push' : failed ? 'Pushed with problems' : 'Pushed to Suunto'}
      </h2>
      <p className={styles.dialogText}>
        {failed
          ? 'Some POIs could not be pushed. The others are on Suunto already.'
          : 'Open the Suunto app and sync your watch to get the changes.'}
      </p>
      <ul className={styles.results}>
        {results.map((r) => (
          <li key={r.id}>
            <Icon
              name={r.status === 'failed' ? 'alert' : 'check'}
              size={18}
              style={{ color: r.status === 'failed' ? 'var(--danger)' : 'var(--ok)', flexShrink: 0 }}
            />
            <span className={styles.resultText}>
              POI "{r.name}" {r.status === 'created' ? 'created' : r.status === 'updated' ? 'updated' : 'failed'}
              {r.message && <small>{r.message}</small>}
            </span>
            {r.status === 'failed' && (
              <button type="button" className="btn" disabled={retrying !== null} aria-busy={retrying === r.id} onClick={() => void retry(r.id)}>
                {retrying === r.id && <Spinner />}
                {retrying === r.id ? 'Retrying…' : 'Retry'}
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <p className={styles.dialogText}>Routes and POIs are separate uploads: one failing doesn't block the other.</p>
      <div className={styles.choicesRow}>
        <button type="button" className="btn btn-primary" onClick={() => ref.current?.close()}>
          Done
        </button>
      </div>
    </dialog>
  );
}
