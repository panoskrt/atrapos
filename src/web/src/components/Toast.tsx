import { useEffect } from 'react';
import { Link } from 'react-router';
import { create } from 'zustand';
import { Icon } from './Icon';
import styles from './Toast.module.css';

interface ToastMessage {
  id: number;
  text: string;
  link?: { to: string; label: string };
  tone: 'info' | 'error';
}

const useToastStore = create<{ toasts: ToastMessage[]; dismiss: (id: number) => void }>()((set, get) => ({
  toasts: [],
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

let nextId = 1;

/** Shows a short message at the bottom of the screen (announced to screen readers). */
export function toast(text: string, options: { link?: ToastMessage['link']; tone?: ToastMessage['tone'] } = {}) {
  const t: ToastMessage = { id: nextId++, text, link: options.link, tone: options.tone ?? 'info' };
  useToastStore.setState((s) => ({ toasts: [...s.toasts.slice(-2), t] }));
}

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <div className={styles.host} role="status" aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}

function ToastItem({ toast: t }: { toast: ToastMessage }) {
  const dismiss = useToastStore((s) => s.dismiss);
  useEffect(() => {
    // Errors stay until dismissed; info goes away by itself.
    if (t.tone === 'error') return;
    const timer = window.setTimeout(() => dismiss(t.id), 8000);
    return () => window.clearTimeout(timer);
  }, [t, dismiss]);

  return (
    <div className={t.tone === 'error' ? styles.error : styles.toast}>
      <Icon name={t.tone === 'error' ? 'alert' : 'check'} size={18} />
      <span className={styles.text}>
        {t.text}{' '}
        {t.link && (
          <Link to={t.link.to} onClick={() => dismiss(t.id)}>
            {t.link.label}
          </Link>
        )}
      </span>
      <button type="button" className={styles.close} onClick={() => dismiss(t.id)} aria-label="Dismiss">
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
