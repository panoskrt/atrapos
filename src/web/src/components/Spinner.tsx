import styles from './Spinner.module.css';

/** A small busy indicator. Decorative by default: pair it with text that says what's happening. */
export function Spinner({ size = 18, label, className }: { size?: number; label?: string; className?: string }) {
  return (
    <svg
      className={className ? `${styles.spinner} ${className}` : styles.spinner}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
