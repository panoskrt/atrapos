import { useEffect, useRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { Icon } from './Icon';
import styles from './SelectionBar.module.css';

/** Floating bar with the bulk actions for the current selection. Escape clears the selection. */
export function SelectionBar({
  count,
  noun,
  onClear,
  children,
}: {
  count: number;
  noun: [singular: string, plural: string];
  onClear: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (count === 0) return;
    const onKey = (e: KeyboardEvent) => {
      // A dialog handles its own Escape.
      if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('dialog[open]')) onClear();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [count, onClear]);

  return (
    <div className={styles.bar} role="region" aria-label="Selection" hidden={count === 0}>
      <span className={styles.count} aria-live="polite">
        {count} {count === 1 ? noun[0] : noun[1]} selected
      </span>
      <div className={styles.actions}>{children}</div>
      <button type="button" className={styles.clear} onClick={onClear} aria-label="Clear selection" title="Clear selection (Esc)">
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}

/** One item's checkbox. Reports Shift so a click can select a range. */
export function SelectBox({
  checked,
  label,
  onToggle,
  className,
}: {
  checked: boolean;
  label: string;
  onToggle: (extend: boolean) => void;
  className?: string;
}) {
  return (
    <input
      type="checkbox"
      className={className ? `check ${className}` : 'check'}
      checked={checked}
      aria-label={label}
      // React drives checkbox onChange from the click event, so Shift is on the native event.
      onChange={(e) => onToggle((e.nativeEvent as MouseEvent).shiftKey === true)}
    />
  );
}

/** A checkbox that can show "some selected". */
export function TriCheckbox({
  state,
  ...props
}: { state: 'all' | 'some' | 'none' } & Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'checked'>) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'some';
  }, [state]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={state === 'all'}
      aria-checked={state === 'some' ? 'mixed' : undefined}
      {...props}
      className={props.className ? `check ${props.className}` : 'check'}
    />
  );
}
