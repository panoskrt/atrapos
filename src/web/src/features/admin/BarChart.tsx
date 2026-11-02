import { useId, useState, type KeyboardEvent } from 'react';
import type { Bucket } from './api';
import styles from './Charts.module.css';

const W = 640;
const H = 200;
const M = { top: 10, right: 8, bottom: 26, left: 40 };
const MAX_BAR = 24;
const GAP = 2;
const RADIUS = 4;

/** A "nice" axis maximum and tick step for whole-number counts (1, 2, 5 × 10ⁿ). */
export function niceScale(max: number): { top: number; step: number } {
  if (max <= 0) return { top: 4, step: 1 };
  const rough = max / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? pow * 10);
  return { top: Math.ceil(max / step) * step, step };
}

const compact = (n: number) => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const parse = (iso: string) => new Date(`${iso}T00:00:00Z`);

export function tickLabel(iso: string, bucket: Bucket): string {
  const d = parse(iso);
  return bucket === 'month'
    ? d.toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' })
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function fullLabel(iso: string, bucket: Bucket): string {
  const d = parse(iso);
  if (bucket === 'month') return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const day = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return bucket === 'week' ? `Week of ${day}` : day;
}

/** A column with a 4px rounded top and a square base, so it grows from the axis. */
function barPath(x: number, base: number, w: number, h: number): string {
  const r = Math.min(RADIUS, w / 2, h);
  return `M${x},${base}V${base - h + r}Q${x},${base - h} ${x + r},${base - h}H${x + w - r}Q${x + w},${base - h} ${x + w},${base - h + r}V${base}Z`;
}

/** One series as columns. Hover or focus a column (or use the arrow keys) to read its value. */
export function BarChart({ title, buckets, values, bucket }: { title: string; buckets: string[]; values: number[]; bucket: Bucket }) {
  const [active, setActive] = useState<number | null>(null);
  const id = useId();
  const n = buckets.length;
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const base = M.top + plotH;
  const max = Math.max(0, ...values);
  const { top, step } = niceScale(max);
  const slot = plotW / Math.max(n, 1);
  const barW = Math.max(1, Math.min(MAX_BAR, slot - GAP));
  const y = (v: number) => (v / top) * plotH;

  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);

  // About six x labels, evenly spread, never closer than the label is wide.
  const every = Math.max(1, Math.ceil(n / 6));
  const labelled = buckets.map((_, i) => i).filter((i) => i % every === 0);

  const peak = max === 0 ? -1 : values.indexOf(max);
  const summary =
    `${title}: ${values.reduce((a, b) => a + b, 0)} in total` +
    (peak >= 0 ? `, highest ${max} (${fullLabel(buckets[peak]!, bucket)})` : '') +
    '. Use the left and right arrow keys to read each column.';

  const onKey = (e: KeyboardEvent) => {
    if (n === 0) return;
    const cur = active ?? -1;
    const next =
      e.key === 'ArrowRight' ? Math.min(n - 1, cur + 1)
      : e.key === 'ArrowLeft' ? Math.max(0, cur === -1 ? 0 : cur - 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? n - 1
      : null;
    if (next === null) return;
    e.preventDefault();
    setActive(next);
  };

  const cx = (i: number) => M.left + slot * i + slot / 2;
  const tipPct = active === null ? 0 : (cx(active) / W) * 100;

  return (
    <div className={styles.chart} onPointerLeave={() => setActive(null)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={summary}
        aria-describedby={active === null ? undefined : `${id}-readout`}
        tabIndex={0}
        className={styles.svg}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={W - M.right} y1={base - y(t)} y2={base - y(t)} className={t === 0 ? styles.axis : styles.grid} />
            <text x={M.left - 8} y={base - y(t)} className={styles.tick} textAnchor="end" dominantBaseline="middle">
              {compact(t)}
            </text>
          </g>
        ))}
        {labelled.map((i) => (
          <text key={i} x={cx(i)} y={H - 6} className={styles.tick} textAnchor="middle">
            {tickLabel(buckets[i]!, bucket)}
          </text>
        ))}
        {values.map((v, i) =>
          v > 0 ? (
            <path
              key={buckets[i]}
              d={barPath(cx(i) - barW / 2, base, barW, Math.max(y(v), 1))}
              className={i === active ? `${styles.bar} ${styles.barActive}` : styles.bar}
            />
          ) : null,
        )}
        {/* Full-height hit areas: wider than the bars, and there for empty buckets too. */}
        {buckets.map((b, i) => (
          <rect
            key={b}
            x={M.left + slot * i}
            y={M.top}
            width={slot}
            height={plotH}
            className={styles.hit}
            onPointerEnter={() => setActive(i)}
            onPointerMove={() => setActive(i)}
          />
        ))}
      </svg>
      {active !== null && (
        <div
          id={`${id}-readout`}
          role="status"
          className={styles.tooltip}
          style={{ left: `clamp(70px, ${tipPct}%, calc(100% - 70px))` }}
        >
          <strong>{values[active]}</strong>
          <span>{fullLabel(buckets[active]!, bucket)}</span>
        </div>
      )}
    </div>
  );
}
