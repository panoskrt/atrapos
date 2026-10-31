import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../../lib/api';
import { PageHeader, QueryState } from './AdminUi';
import { adminPath, syncStates, type AdminStats } from './api';
import { fmtBytes } from './format';
import styles from './Admin.module.css';

export function OverviewPage() {
  const stats = useQuery({ queryKey: ['admin', 'stats'], queryFn: () => api.get<AdminStats>(adminPath('stats')) });
  return (
    <>
      <PageHeader title="Overview" sub="What is in the database right now." />
      <QueryState query={stats}>
        {stats.data && <Tiles s={stats.data} />}
      </QueryState>
    </>
  );
}

function Tiles({ s }: { s: AdminStats }) {
  const tiles: { label: string; value: string | number; to: string; note?: string }[] = [
    { label: 'Users', value: s.users, to: '/admin/users' },
    { label: 'Routes', value: s.routes, to: '/admin/routes' },
    { label: 'POIs', value: s.pois, to: '/admin/pois', note: `${s.deletedPois} soft-deleted` },
    { label: 'Source files', value: s.sourceFiles, to: '/admin/source-files', note: fmtBytes(s.sourceFileBytes) },
    { label: 'Sync log entries', value: s.syncLogEntries, to: '/admin/sync-log' },
    { label: 'Error log entries', value: s.errorLogEntries, to: '/admin/error-log', note: `${s.errorsLast24h} in the last 24 h` },
    { label: 'Database size', value: fmtBytes(s.databaseBytes), to: '/admin/settings' },
  ];
  return (
    <>
      <div className={styles.tiles}>
        {tiles.map((t) => (
          <Link key={t.label} to={t.to} className={styles.tile}>
            <span className={styles.tileLabel}>{t.label}</span>
            <strong className={styles.tileValue}>{t.value}</strong>
            {t.note && <span className={styles.tileNote}>{t.note}</span>}
          </Link>
        ))}
      </div>
      <div className={styles.twoCol}>
        <Breakdown title="Routes by sync state" counts={s.routesBySyncState} resource="routes" />
        <Breakdown title="POIs by sync state" counts={s.poisBySyncState} resource="pois" />
      </div>
    </>
  );
}

function Breakdown({ title, counts, resource }: { title: string; counts: Record<string, number>; resource: string }) {
  return (
    <section className={styles.card}>
      <h2 className={styles.cardTitle}>{title}</h2>
      <ul className={styles.breakdown}>
        {syncStates.map((st) => (
          <li key={st.id}>
            <Link to={`/admin/${resource}?syncState=${st.id}`}>{st.label}</Link>
            <strong>{counts[st.id] ?? 0}</strong>
          </li>
        ))}
      </ul>
    </section>
  );
}
