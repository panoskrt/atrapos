import { useMemo, useRef, type PointerEvent } from 'react';
import { Icon } from '../../components/Icon';
import { usePersistentState } from '../../lib/usePersistentState';
import { formatDistance, formatElevation, positionAtDistance, type Coord } from './geo';
import { useEditorStore, useHoverStore, useSectionStore } from './store';
import styles from './Editor.module.css';

const W = 1000;
const H = 120;
const PAD_TOP = 8;
const MAX_SAMPLES = 800;
/** A drag shorter than this (fraction of the route, or metres) is a click, not a selection. */
const MIN_SECTION_FRACTION = 0.005;
const MIN_SECTION_M = 20;
const CLICK_SLOP_PX = 4;

export interface ProfilePoi {
  id: string;
  name: string;
  alongM: number;
}

interface Props {
  line: Coord[];
  cumulative: number[];
  pending: boolean;
  pois: ProfilePoi[];
}

export function ElevationProfile({ line, cumulative, pending, pois }: Props) {
  const [collapsed, setCollapsed] = usePersistentState('editor.profileCollapsed', false, isBoolean);
  const hoverDistance = useHoverStore((s) => s.distance);
  const setHover = useHoverStore((s) => s.setDistance);
  const selectedPoiId = useEditorStore((s) => s.selectedPoiId);
  const selectPoi = useEditorStore((s) => s.selectPoi);
  const total = cumulative.at(-1) ?? 0;
  const sectionFrom = useSectionStore((s) => s.from);
  const sectionTo = useSectionStore((s) => s.to);
  const pickStart = useSectionStore((s) => s.pending);
  const drag = useRef<{ mode: 'new' | 'from' | 'to'; anchor: number; startX: number; moved: boolean } | null>(null);
  const section = sectionFrom !== null && sectionTo !== null && total > 0 ? { from: sectionFrom, to: sectionTo } : null;

  const chart = useMemo(() => {
    const known: { d: number; e: number }[] = [];
    const step = Math.max(1, Math.ceil(line.length / MAX_SAMPLES));
    line.forEach((c, i) => {
      if (c[2] !== null && (i % step === 0 || i === line.length - 1)) known.push({ d: cumulative[i]!, e: c[2] });
    });
    if (known.length < 2 || total <= 0) return null;

    const minE = Math.min(...known.map((k) => k.e));
    const maxE = Math.max(...known.map((k) => k.e));
    const yMin = Math.floor(minE / 50) * 50;
    const yMax = Math.max(yMin + 100, Math.ceil(maxE / 50) * 50);
    const x = (d: number) => (d / total) * W;
    const y = (e: number) => H - ((e - yMin) / (yMax - yMin)) * (H - PAD_TOP);

    const pts = known.map((k) => `${x(k.d).toFixed(1)},${y(k.e).toFixed(1)}`);
    return {
      minE,
      maxE,
      /** Vertical position (% from top) of an elevation, for HTML overlays. */
      topPct: (e: number) => (y(e) / H) * 100,
      yTicks: [yMax, (yMax + yMin) / 2, yMin],
      linePath: `M${pts.join(' L')}`,
      areaPath: `M${x(known[0]!.d).toFixed(1)},${H} L${pts.join(' L')} L${x(known.at(-1)!.d).toFixed(1)},${H} Z`,
    };
  }, [line, cumulative, total]);

  const hover = useMemo(() => {
    if (hoverDistance === null || total <= 0) return null;
    const here = positionAtDistance(line, cumulative, hoverDistance);
    const before = positionAtDistance(line, cumulative, Math.max(0, hoverDistance - 50));
    const after = positionAtDistance(line, cumulative, Math.min(total, hoverDistance + 50));
    const span = Math.min(total, hoverDistance + 50) - Math.max(0, hoverDistance - 50);
    const grade =
      before?.[2] != null && after?.[2] != null && span > 0 ? ((after[2] - before[2]) / span) * 100 : null;
    return { left: (hoverDistance / total) * 100, ele: here?.[2] ?? null, grade };
  }, [hoverDistance, line, cumulative, total]);

  const distanceAt = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / (r.width || 1))) * total;
  };

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = distanceAt(e);
    setHover(d);
    const g = drag.current;
    if (!g) return;
    const section = useSectionStore.getState();
    if (g.mode === 'from') section.setFrom(d);
    else if (g.mode === 'to') section.setTo(d);
    else {
      if (!g.moved && Math.abs(e.clientX - g.startX) < CLICK_SLOP_PX) return;
      g.moved = true;
      section.setRange(g.anchor, d);
    }
  };

  // Drag across the profile to select that part of the route; drag a handle to adjust it; click to clear it.
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || total <= 0 || (e.target as HTMLElement).closest('button')) return;
    const handle = (e.target as HTMLElement).dataset.handle;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = {
      mode: handle === 'from' ? 'from' : handle === 'to' ? 'to' : 'new',
      anchor: distanceAt(e),
      startX: e.clientX,
      moved: false,
    };
  };

  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    const g = drag.current;
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (!g || g.mode !== 'new') return;
    const { from, to, clear } = useSectionStore.getState();
    if (!g.moved || from === null || to === null || to - from < Math.max(MIN_SECTION_M, total * MIN_SECTION_FRACTION)) clear();
  };

  return (
    <section className={`${styles.profile} ${collapsed ? styles.profileCollapsed : ''}`} aria-label="Elevation profile">
      <div className={styles.profileHeader}>
        <span className={`display ${styles.profileTitle}`}>Elevation</span>
        {chart && (
          <span className={styles.muted}>
            {formatElevation(chart.minE)} – {formatElevation(chart.maxE)}
          </span>
        )}
        {chart && !section && !collapsed && <span className={styles.muted}>Drag across the profile to analyse a section</span>}
        <button
          type="button"
          className={styles.panelToggle}
          aria-label={collapsed ? 'Show elevation profile' : 'Hide elevation profile'}
          title={collapsed ? 'Show elevation profile' : 'Hide elevation profile'}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
        >
          <Icon name={collapsed ? 'chevronUp' : 'chevronDown'} size={18} />
        </button>
      </div>

      {collapsed ? null : chart ? (
        <div className={styles.profileBody}>
          <div className={styles.yAxis} aria-hidden="true">
            {chart.yTicks.map((t) => (
              <span key={t}>{Math.round(t).toLocaleString('en-US')}</span>
            ))}
          </div>
          <div className={styles.plotWrap}>
            <div
              className={styles.plot}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              onPointerLeave={() => setHover(null)}
            >
              <svg
                viewBox={`0 0 ${W} ${H}`}
                preserveAspectRatio="none"
                role="img"
                aria-label={`Elevation from ${formatElevation(chart.minE)} to ${formatElevation(chart.maxE)} over ${formatDistance(total)}`}
              >
                <path className={styles.grid} d={`M0,${PAD_TOP} L${W},${PAD_TOP} M0,${(H + PAD_TOP) / 2} L${W},${(H + PAD_TOP) / 2} M0,${H} L${W},${H}`} />
                <path className={styles.area} d={chart.areaPath} />
                <path className={styles.profileLine} d={chart.linePath} />
              </svg>
              {section && (
                <div
                  className={styles.selection}
                  style={{ left: `${(section.from / total) * 100}%`, width: `${((section.to - section.from) / total) * 100}%` }}
                >
                  <span className={styles.handle} data-handle="from" />
                  <span className={`${styles.handle} ${styles.handleEnd}`} data-handle="to" />
                </div>
              )}
              {pickStart !== null && total > 0 && (
                <span className={styles.pendingMark} style={{ left: `${(pickStart / total) * 100}%` }} />
              )}
              {pois.map((p) => {
                const at = positionAtDistance(line, cumulative, p.alongM);
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`${styles.profilePoi} ${p.id === selectedPoiId ? styles.profilePoiOn : ''}`}
                    style={{ left: `${(p.alongM / total) * 100}%`, top: `${at?.[2] != null ? chart.topPct(at[2]) : 50}%` }}
                    onClick={() => selectPoi(p.id)}
                    aria-label={`POI ${p.name} at ${formatDistance(p.alongM)}`}
                    title={p.name}
                  />
                );
              })}
              {hover && (
                <>
                  <span className={styles.cursor} style={{ left: `${hover.left}%` }} />
                  <span
                    className={styles.tooltip}
                    style={hover.left > 70 ? { right: `${100 - hover.left}%` } : { left: `${hover.left}%` }}
                  >
                    <strong>{formatDistance(hoverDistance!)}</strong>
                    {hover.ele !== null && ` · ${formatElevation(hover.ele)}`}
                    {hover.grade !== null && ` · ${hover.grade > 0 ? '+' : ''}${Math.round(hover.grade)}%`}
                  </span>
                </>
              )}
            </div>
            <div className={styles.xAxis} aria-hidden="true">
              {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                <span key={f}>{f === 0 ? '0' : formatDistance(total * f)}</span>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <p className={styles.profileEmpty}>
          {line.length < 2
            ? 'Add at least two points to see the elevation profile.'
            : pending
              ? 'Loading elevation…'
              : 'No elevation data for this route.'}
        </p>
      )}
    </section>
  );
}

const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';
