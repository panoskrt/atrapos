import { useEffect, useId, useRef } from 'react';
import { Icon } from '../../components/Icon';
import styles from './Sync.module.css';

/** Confirms a route push, like {@link PushResultDialog} does for POIs. */
export function RoutePushedDialog({ name, onClose }: { name: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    }
  }, []);

  return (
    <dialog ref={ref} className={styles.dialog} aria-labelledby={titleId} onClose={onClose}>
      <h2 id={titleId} className={`display ${styles.dialogTitle}`}>
        Pushed to Suunto
      </h2>
      <p className={styles.dialogText}>Open the Suunto app and sync your watch to get the changes.</p>
      <ul className={styles.results}>
        <li>
          <Icon name="check" size={18} style={{ color: 'var(--ok)', flexShrink: 0 }} />
          <span className={styles.resultText}>Route "{name}" pushed</span>
        </li>
      </ul>
      <p className={styles.dialogText}>Routes and POIs are separate uploads: push the POIs on their own.</p>
      <div className={styles.choicesRow}>
        <button type="button" className="btn btn-primary" onClick={() => ref.current?.close()}>
          Done
        </button>
      </div>
    </dialog>
  );
}
