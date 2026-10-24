import { useEffect, useId, useRef, useState, type DragEvent } from 'react';
import { Icon } from '../../components/Icon';
import { ACCEPTED_EXTENSIONS } from './api';
import styles from './ImportPickerDialog.module.css';

interface Props {
  /** Why the file can't be imported, or null when it can. */
  validate: (file: File) => string | null;
  maxFileLabel: string;
  onPick: (file: File) => void;
  onClose: () => void;
}

/** The app's own "choose a file" step. Browsing still hands over to the browser's file picker, since a web page can't read files any other way. */
export function ImportPickerDialog({ validate, maxFileLabel, onPick, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const depth = useRef(0);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    }
  }, []);

  const choose = (file: File | undefined) => {
    if (!file) return;
    const problem = validate(file);
    if (problem) {
      setError(problem);
      return;
    }
    onPick(file);
    ref.current?.close?.();
  };

  const isFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files');

  return (
    <dialog ref={ref} className={styles.dialog} aria-labelledby={titleId} onClose={onClose}>
      <div className={styles.head}>
        <h1 id={titleId} className={`display ${styles.title}`}>
          Import a route file
        </h1>
        <button type="button" className={styles.close} onClick={() => ref.current?.close()} aria-label="Close">
          <Icon name="close" />
        </button>
      </div>

      <div className={styles.body}>
        <div
          className={over ? styles.zoneOver : styles.zone}
          onDragEnter={(e) => {
            e.stopPropagation();
            if (!isFiles(e)) return;
            depth.current++;
            setOver(true);
          }}
          onDragOver={(e) => {
            e.stopPropagation();
            if (isFiles(e)) e.preventDefault();
          }}
          onDragLeave={(e) => {
            e.stopPropagation();
            depth.current = Math.max(0, depth.current - 1);
            if (depth.current === 0) setOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            depth.current = 0;
            setOver(false);
            choose(e.dataTransfer.files[0]);
          }}
        >
          <Icon name="fileUp" size={40} />
          <strong>Drop a GPX or FIT file here</strong>
          <span className={styles.or}>or</span>
          <button type="button" className="btn btn-primary" onClick={() => input.current?.click()} autoFocus>
            Browse files
          </button>
          <input
            ref={input}
            type="file"
            accept={ACCEPTED_EXTENSIONS.join(',')}
            hidden
            onChange={(e) => {
              choose(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>

        {error && (
          <p role="alert" className={styles.error}>
            <Icon name="alert" size={18} />
            {error}
          </p>
        )}

        <dl className={styles.facts}>
          <div>
            <dt>Formats</dt>
            <dd>GPX tracks, routes and waypoints · FIT courses and activities</dd>
          </div>
          <div>
            <dt>Largest file</dt>
            <dd>{maxFileLabel}</dd>
          </div>
          <div>
            <dt>Next</dt>
            <dd>Preview the track, simplify it and choose which waypoints become POIs</dd>
          </div>
        </dl>
      </div>

      <div className={styles.foot}>
        <button type="button" className="btn" onClick={() => ref.current?.close()}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}
