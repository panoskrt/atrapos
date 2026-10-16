import { useEffect, useId, useRef, type ReactNode } from 'react';
import { create } from 'zustand';
import { Icon, type IconName } from './Icon';
import styles from './ConfirmDialog.module.css';

export interface ConfirmOptions {
  title: string;
  body: ReactNode;
  /** What happens to what: e.g. [["Route on Suunto", "Stays"], ["Local copy", "Deleted"]]. */
  facts?: [string, string, 'danger'?][];
  confirmLabel: string;
  cancelLabel?: string;
  alternativeLabel?: string;
  tone?: 'danger' | 'primary';
  icon?: IconName;
}

export type ConfirmChoice = 'cancel' | 'confirm' | 'alternative';

interface ConfirmState {
  current: (ConfirmOptions & { resolve: (choice: ConfirmChoice) => void }) | null;
  ask: (options: ConfirmOptions) => Promise<ConfirmChoice>;
}

const useConfirmStore = create<ConfirmState>()((set, get) => ({
  current: null,
  ask: (options) =>
    new Promise<ConfirmChoice>((resolve) => {
      get().current?.resolve('cancel');
      set({ current: { ...options, resolve } });
    }),
}));

/** Shows the styled confirmation dialog and resolves true when the user confirms. */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return useConfirmStore.getState().ask(options).then((choice) => choice === 'confirm');
}

/** Shows the styled dialog and returns which of its actions the user chose. */
export function chooseAction(options: ConfirmOptions): Promise<ConfirmChoice> {
  return useConfirmStore.getState().ask(options);
}

/** Renders whichever confirmation is pending. Mount once (AppShell). */
export function ConfirmHost() {
  const current = useConfirmStore((s) => s.current);
  if (!current) return null;
  return <ConfirmDialogView key={current.title + current.confirmLabel} options={current} />;
}

function ConfirmDialogView({ options }: { options: NonNullable<ConfirmState['current']> }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const answered = useRef(false);

  const finish = (choice: ConfirmChoice) => {
    if (answered.current) return;
    answered.current = true;
    options.resolve(choice);
    useConfirmStore.setState({ current: null });
  };

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    }
  }, []);

  const tone = options.tone ?? 'primary';
  return (
    <dialog ref={ref} className={styles.dialog} aria-labelledby={titleId} onClose={() => finish('cancel')}>
      <div className={tone === 'danger' ? styles.iconWarn : styles.iconInfo} aria-hidden="true">
        <Icon name={options.icon ?? (tone === 'danger' ? 'trash' : 'alert')} size={24} />
      </div>
      <h2 id={titleId} className={`display ${styles.title}`}>
        {options.title}
      </h2>
      <div className={styles.body}>{options.body}</div>
      {options.facts && (
        <dl className={styles.facts}>
          {options.facts.map(([label, value, factTone]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd className={factTone === 'danger' ? styles.factDanger : undefined}>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className={styles.actions}>
        <button type="button" className="btn" onClick={() => finish('cancel')} autoFocus>
          {options.cancelLabel ?? 'Cancel'}
        </button>
        {options.alternativeLabel && (
          <button type="button" className="btn" onClick={() => finish('alternative')}>
            {options.alternativeLabel}
          </button>
        )}
        <button type="button" className={tone === 'danger' ? `btn ${styles.danger}` : 'btn btn-primary'} onClick={() => finish('confirm')}>
          {options.confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
