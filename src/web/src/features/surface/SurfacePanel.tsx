import { useRouteSurface } from './api';
import styles from './SurfacePanel.module.css';

export function SurfacePanel({ routeId, isDraft }: { routeId: string; isDraft: boolean }) {
  const surface = useRouteSurface(routeId, !isDraft);

  return (
    <section className={styles.panel} aria-label="Route surface breakdown">
      <h3 className={styles.title}>Route surface</h3>
      {isDraft ? (
        <p className={styles.message}>Save the route to calculate its surface breakdown.</p>
      ) : surface.isPending ? (
        <p className={styles.message} role="status">Loading OpenStreetMap surface data…</p>
      ) : surface.isError ? (
        <div className={styles.message} role="alert">
          <p>Surface data is temporarily unavailable: {surface.error.message}</p>
          <button type="button" className="btn" onClick={() => void surface.refetch()}>Try again</button>
        </div>
      ) : (
        <>
          <p className={styles.description}>
            {surface.data.totalDistanceKm.toFixed(1)} km total · calculated from the saved route
          </p>
          <p className={styles.description}>
            Footpaths, cycleways and similar routes count as Path regardless of paving. Other ways are grouped by mapped surface.
          </p>
          <dl className={styles.breakdown}>
            <SurfaceRow label="Asphalt" amount={surface.data.asphalt} />
            <SurfaceRow label="Off road" amount={surface.data.offRoad} />
            <SurfaceRow label="Path" amount={surface.data.path} />
            {surface.data.unclassifiedPercent > 0 && (
              <div className={styles.row}>
                <dt>Unclassified</dt>
                <dd>{surface.data.unclassifiedDistanceKm.toFixed(1)} km · {surface.data.unclassifiedPercent.toFixed(1)}%</dd>
              </div>
            )}
          </dl>
          <p className={styles.attribution}>
            Surface estimates from nearby{' '}
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> data.
          </p>
        </>
      )}
    </section>
  );
}

function SurfaceRow({ label, amount }: { label: string; amount: { distanceKm: number; percent: number } }) {
  return (
    <div className={styles.row}>
      <dt>{label}</dt>
      <dd>{amount.distanceKm.toFixed(1)} km · {amount.percent.toFixed(1)}%</dd>
    </div>
  );
}
