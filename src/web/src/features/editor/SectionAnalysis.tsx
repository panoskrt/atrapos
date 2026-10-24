import { useId, useMemo } from 'react';
import { Icon } from '../../components/Icon';
import { formatDistance, formatElevation, sectionStats, type Coord } from './geo';
import type { ProfilePoi } from './ElevationProfile';
import { useSectionStore } from './store';
import styles from './Editor.module.css';

const signed = (text: string, value: number) => (value > 0 ? `+${text}` : value < 0 ? `−${text.replace('-', '')}` : text);
const percent = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`;

interface Props {
  line: Coord[];
  cumulative: number[];
  pois: ProfilePoi[];
}

/** Figures for the part of the route chosen on the profile or the map. */
export function SectionAnalysis({ line, cumulative, pois }: Props) {
  const from = useSectionStore((s) => s.from);
  const to = useSectionStore((s) => s.to);
  const setFrom = useSectionStore((s) => s.setFrom);
  const setTo = useSectionStore((s) => s.setTo);
  const clear = useSectionStore((s) => s.clear);
  const requestFit = useSectionStore((s) => s.requestFit);
  const fromId = useId();
  const toId = useId();
  const total = cumulative.at(-1) ?? 0;

  const result = useMemo(
    () => (from !== null && to !== null ? sectionStats(line, cumulative, from, to) : null),
    [line, cumulative, from, to],
  );
  if (!result || from === null || to === null) return null;

  const inSection = pois.filter((p) => p.alongM >= result.fromM && p.alongM <= result.toM).length;
  const main: [string, string][] = [
    ['Distance', formatDistance(result.distanceM)],
    ['Ascent', result.startEleM !== null ? `+${formatElevation(result.ascentM)}` : '–'],
    ['Descent', result.startEleM !== null ? `−${formatElevation(result.descentM)}` : '–'],
  ];
  const more: [string, string][] = [];
  if (result.netM !== null) more.push(['Net change', signed(formatElevation(result.netM), result.netM)]);
  if (result.avgGradePct !== null) more.push(['Average grade', percent(result.avgGradePct)]);
  if (result.maxEleM !== null) more.push(['Highest', formatElevation(result.maxEleM)]);
  if (result.minEleM !== null) more.push(['Lowest', formatElevation(result.minEleM)]);
  if (result.maxClimbPct !== null) more.push(['Steepest climb', percent(result.maxClimbPct)]);
  if (result.maxDescentPct !== null) more.push(['Steepest descent', percent(result.maxDescentPct)]);
  more.push(['POIs', String(inSection)]);

  return (
    <section className={styles.sectionCard} aria-label="Section analysis">
      <div className={styles.sectionHead}>
        <h2 className={`display ${styles.sectionTitle}`}>
          {formatDistance(result.fromM)} – {formatDistance(result.toM)}
        </h2>
        <button type="button" className={styles.noticeClose} onClick={requestFit} aria-label="Zoom to section" title="Zoom to section">
          <Icon name="fit" size={16} />
        </button>
        <button type="button" className={styles.noticeClose} onClick={clear} aria-label="Clear section" title="Clear section">
          <Icon name="close" size={16} />
        </button>
      </div>

      <Metrics items={main} />

      <details className={styles.sectionFine}>
        <summary>More figures and end handles</summary>
        <Metrics items={more} />
        <div className={styles.sectionRanges}>
          <label htmlFor={fromId}>From</label>
          <input id={fromId} type="range" min={0} max={total} step={10} value={from} onChange={(e) => setFrom(Number(e.target.value))} />
          <label htmlFor={toId}>To</label>
          <input id={toId} type="range" min={0} max={total} step={10} value={to} onChange={(e) => setTo(Number(e.target.value))} />
        </div>
      </details>
    </section>
  );
}

function Metrics({ items }: { items: [string, string][] }) {
  return (
    <dl className={styles.sectionMetrics}>
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
