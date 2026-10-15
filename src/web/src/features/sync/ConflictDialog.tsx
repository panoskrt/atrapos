import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { formatDistance } from '../editor/geo';
import type { ConflictStrategy, RoutePushResponse } from './api';
import { Spinner } from '../../components/Spinner';
import styles from './Sync.module.css';

interface Props {
  conflict: RoutePushResponse;
  busy: boolean;
  onResolve: (strategy: ConflictStrategy) => void;
  onClose: () => void;
}

/** The route changed (or was deleted) in the Suunto app since our last sync. Nothing is overwritten until the user chooses. */
export function ConflictDialog({ conflict, busy, onResolve, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const missing = conflict.reason === 'remote_missing';
  const [chosen, setChosen] = useState<ConflictStrategy | null>(null);
  const choose = (strategy: ConflictStrategy) => {
    setChosen(strategy);
    onResolve(strategy);
  };
  const working = (strategy: ConflictStrategy) => busy && chosen === strategy && <Spinner />;

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    }
  }, []);

  const modified = conflict.remote?.modified ? new Date(conflict.remote.modified).toLocaleString() : null;

  return (
    <dialog ref={ref} className={styles.dialog} aria-labelledby={titleId} onClose={onClose}>
      <div className={styles.dialogIcon} aria-hidden="true">
        <Icon name="alert" size={24} />
      </div>
      <h2 id={titleId} className={`display ${styles.dialogTitle}`}>
        {missing ? 'Route deleted in the Suunto app' : 'Route changed in the Suunto app'}
      </h2>
      <p className={styles.dialogText}>
        {missing
          ? `"${conflict.route.name}" no longer exists in your Suunto app.`
          : `"${conflict.route.name}" was edited in the Suunto app after you last synced, so pushing now would overwrite those edits.`}
      </p>

      {!missing && (
        <div className={styles.compare}>
          <div>
            <span>Your version</span>
            <strong>{formatDistance(conflict.route.distanceM)}</strong>
            <span>{conflict.route.pois.length} POIs</span>
          </div>
          <div>
            <span>On Suunto</span>
            <strong>{conflict.remote ? formatDistance(conflict.remote.distanceM) : '–'}</strong>
            <span>{modified ? `changed ${modified}` : conflict.remote?.name ?? ''}</span>
          </div>
        </div>
      )}

      <div className={styles.choices}>
        <button type="button" className="btn btn-primary" disabled={busy} aria-busy={busy && chosen === 'keepMine'} onClick={() => choose('keepMine')}>
          {working('keepMine')}
          {missing ? 'Upload again as a new Suunto route' : 'Keep mine and push it on top'}
        </button>
        <button type="button" className="btn" disabled={busy} aria-busy={busy && chosen === 'takeTheirs'} onClick={() => choose('takeTheirs')}>
          {working('takeTheirs')}
          {missing ? 'Keep it in this app only' : 'Load the Suunto version (discard my edits)'}
        </button>
        {!missing && (
          <button type="button" className="btn" disabled={busy} aria-busy={busy && chosen === 'saveCopy'} onClick={() => choose('saveCopy')}>
            {working('saveCopy')}
            Save mine as a new route, then load Suunto's
          </button>
        )}
        <button type="button" className={styles.textBtn} disabled={busy} onClick={() => ref.current?.close()}>
          Decide later
        </button>
      </div>
      {busy && (
        <p role="status" className={styles.dialogText}>
          {chosen === 'keepMine'
            ? 'Uploading your version to Suunto…'
            : chosen === 'saveCopy'
              ? 'Saving your copy, then fetching the Suunto version…'
              : missing
                ? 'Checking with Suunto…'
                : 'Fetching the Suunto version…'}
        </p>
      )}
    </dialog>
  );
}
