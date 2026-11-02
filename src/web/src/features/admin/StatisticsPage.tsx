import { useCallback, useMemo } from 'react';
import { BarChart, fullLabel } from './BarChart';
import { PageHeader, QueryState } from './AdminUi';
import { useTimeSeries, type AdminTimeSeries } from './api';
import { useListParams } from './useListParams';
import adminStyles from './Admin.module.css';
import styles from './Charts.module.css';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));

const presets: { label: string; days: number }[] = [
  { label: '7 days', days: 6 },
  { label: '30 days', days: 29 },
  { label: '90 days', days: 89 },
  { label: '12 months', days: 364 },
];

export function StatisticsPage() {
  const { params, set } = useListParams(['from', 'to', 'bucket']);
  // The default range is fixed when the page opens, so it doesn't shift while it is on screen.
  const defaults = useMemo(() => ({ from: daysAgo(29), to: daysAgo(0) }), []);
  const from = params.from || defaults.from;
  const to = params.to || defaults.to;
  const series = useTimeSeries(from, to, params.bucket);
  const invalid = from > to;

  const choose = useCallback((days: number) => set({ from: daysAgo(days), to: daysAgo(0) }), [set]);
  const activePreset = presets.find((p) => from === daysAgo(p.days) && to === daysAgo(0));

  return (
    <>
      <PageHeader title="Statistics" sub="Activity over time. Dates and buckets are in UTC; weeks start on Monday." />
      <div className={styles.filters} role="group" aria-label="Date range">
        <div className={styles.presets}>
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              className={activePreset === p ? `${styles.preset} ${styles.presetActive}` : styles.preset}
              aria-pressed={activePreset === p}
              onClick={() => choose(p.days)}
            >
              Last {p.label}
            </button>
          ))}
        </div>
        <label className={styles.dateField}>
          From
          <input type="date" value={from} max={to} onChange={(e) => e.target.value && set({ from: e.target.value, to })} />
        </label>
        <label className={styles.dateField}>
          To
          <input type="date" value={to} min={from} max={daysAgo(0)} onChange={(e) => e.target.value && set({ from, to: e.target.value })} />
        </label>
        <label className={styles.dateField}>
          Group by
          <select value={params.bucket} onChange={(e) => set({ from, to, bucket: e.target.value })}>
            <option value="">Automatic</option>
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
        </label>
      </div>

      {invalid ? (
        <p className={adminStyles.error} role="alert">The start date must not be after the end date.</p>
      ) : (
        <QueryState query={series}>{series.data && <Charts data={series.data} />}</QueryState>
      )}
    </>
  );
}

function Charts({ data }: { data: AdminTimeSeries }) {
  return (
    <>
      <div className={styles.grid2}>
        {data.metrics.map((m) => (
          <section key={m.key} className={styles.card} aria-label={m.label}>
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle}>{m.label}</h2>
              <span className={styles.total} title="Total in the selected range">{m.total.toLocaleString()}</span>
            </div>
            <BarChart title={m.label} buckets={data.buckets} values={m.values} bucket={data.bucket} />
          </section>
        ))}
      </div>
      <p className={styles.note}>
        Per {data.bucket}, {data.from} to {data.to}. The first and last {data.bucket} may be partial.
      </p>
      <details className={styles.table}>
        <summary>Show the data as a table</summary>
        <div className={adminStyles.tableWrap}>
          <table className={adminStyles.table}>
            <thead>
              <tr>
                <th scope="col">{data.bucket === 'day' ? 'Day' : data.bucket === 'week' ? 'Week of' : 'Month'}</th>
                {data.metrics.map((m) => (
                  <th key={m.key} scope="col" className={adminStyles.num}>{m.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.buckets.map((b, i) => (
                <tr key={b}>
                  <th scope="row">{fullLabel(b, data.bucket)}</th>
                  {data.metrics.map((m) => (
                    <td key={m.key} className={adminStyles.num}>{m.values[i]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
