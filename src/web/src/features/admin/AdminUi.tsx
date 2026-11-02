import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { Spinner } from '../../components/Spinner';
import type { Paged, SyncState } from './api';
import { syncLabel } from './format';
import styles from './Admin.module.css';

export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className={styles.pageHeader}>
      <div>
        <h1 className={`display ${styles.title}`}>{title}</h1>
        {sub && <p className={styles.sub}>{sub}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}

export function Badge({ children, tone }: { children: ReactNode; tone?: 'ok' | 'warn' | 'danger' | 'muted' | 'accent' }) {
  return <span className={`${styles.badge} ${tone ? styles[`badge_${tone}`] : ''}`}>{children}</span>;
}

const syncTone: Record<SyncState, 'ok' | 'warn' | 'danger' | 'muted' | 'accent'> = {
  localOnly: 'muted',
  synced: 'ok',
  localChanges: 'accent',
  remoteNewer: 'warn',
  conflict: 'danger',
  error: 'danger',
};

export const SyncBadge = ({ state }: { state: SyncState }) => <Badge tone={syncTone[state]}>{syncLabel(state)}</Badge>;

/** A search box that reports its text after the user pauses typing. */
export function SearchBox({ value, onChange, placeholder = 'Search' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text === value) return;
    const t = setTimeout(() => onChange(text), 300);
    return () => clearTimeout(t);
  }, [text, value, onChange]);
  return (
    <label className={styles.search}>
      <Icon name="search" size={18} />
      <input type="search" value={text} placeholder={placeholder} aria-label={placeholder} onChange={(e) => setText(e.target.value)} />
    </label>
  );
}

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  empty = 'Nothing here.',
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  empty?: string;
}) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.header} scope="col" className={c.className}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className={styles.empty}>
                {empty}
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={onRowClick ? styles.clickable : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(row) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
            >
              {columns.map((c) => (
                <td key={c.header} className={c.className}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pager({ data, onPage }: { data: Paged<unknown>; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const from = data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1;
  const to = Math.min(data.page * data.pageSize, data.total);
  return (
    <div className={styles.pager}>
      <span>
        {from}–{to} of {data.total}
      </span>
      <div className={styles.pagerButtons}>
        <button type="button" className="btn" disabled={data.page <= 1} onClick={() => onPage(data.page - 1)}>
          Previous
        </button>
        <span aria-live="polite">
          Page {data.page} of {pages}
        </span>
        <button type="button" className="btn" disabled={data.page >= pages} onClick={() => onPage(data.page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}

/** Loading, error and data states for a list page. */
export function QueryState({
  query,
  children,
}: {
  query: { isPending: boolean; isError: boolean; error: Error | null; isFetching: boolean; data: unknown };
  children: ReactNode;
}) {
  if (query.isPending)
    return (
      <div className={styles.state} role="status">
        <Spinner size={22} /> Loading…
      </div>
    );
  if (query.isError)
    return (
      <p className={styles.error} role="alert">
        Couldn’t load: {query.error?.message}
      </p>
    );
  return <div className={query.isFetching ? styles.fetching : undefined}>{children}</div>;
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? `${styles.modal} ${styles.modalWide}` : styles.modal}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      <div className={styles.modalHead}>
        <h2 id={titleId} className={styles.modalTitle}>
          {title}
        </h2>
        <button type="button" className="btn btn-icon" aria-label="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div className={styles.modalBody}>{children}</div>
    </dialog>
  );
}

export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
      {hint && <span className={styles.hint}>{hint}</span>}
      {error && (
        <span className={styles.fieldError} role="alert">
          {error}
        </span>
      )}
    </label>
  );
}

export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className={styles.facts}>
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Field-level messages from an ASP.NET validation problem, keyed by camelCase field name. */
export function fieldErrors(error: unknown): Record<string, string> {
  const body = (error as { body?: { errors?: Record<string, string[]> } } | null)?.body;
  return Object.fromEntries(Object.entries(body?.errors ?? {}).map(([k, v]) => [k, v.join(' ')]));
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const fields = fieldErrors(error);
  const general = Object.keys(fields).length === 0;
  return general ? (
    <p className={styles.error} role="alert">
      {(error as Error).message}
    </p>
  ) : null;
}
