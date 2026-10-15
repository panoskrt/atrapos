import { useMemo, type PointerEvent } from 'react';
import { formatDistance, formatElevation, positionAtDistance, type Coord } from './geo';
import { useEditorStore, useHoverStore } from './store';
import styles from './Editor.module.css';

const W = 1000;
const H = 120;
const PAD_TOP = 8;
const MAX_SAMPLES = 800;

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
  const hoverDistance = useHoverStore((s) => s.distance);
  const setHover = useHoverStore((s) => s.setDistance);
  const selectedPoiId = useEditorStore((s) => s.selectedPoiId);
  const selectPoi = useEditorStore((s) => s.selectPoi);
  const total = cumulative.at(-1) ?? 0;

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

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    setHover(frac * total);
  };

  return (
    <section className={styles.profile} aria-label="Elevation profile">
      <div className={styles.profileHeader}>
        <span className={`display ${styles.profileTitle}`}>Elevation</span>
        {chart && (
          <span className={styles.muted}>
            {formatElevation(chart.minE)} – {formatElevation(chart.maxE)}
          </span>
        )}
      </div>

      {chart ? (
        <div className={styles.profileBody}>
          <div className={styles.yAxis} aria-hidden="true">
            {chart.yTicks.map((t) => (
              <span key={t}>{Math.round(t).toLocaleString('en-US')}</span>
            ))}
          </div>
          <div className={styles.plotWrap}>
            <div
              className={styles.plot}
              onPointerMove={onMove}
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
