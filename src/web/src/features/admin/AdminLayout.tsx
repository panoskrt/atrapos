import { NavLink, Outlet } from 'react-router';
import { Icon } from '../../components/Icon';
import { useMe } from '../auth/useMe';
import styles from './Admin.module.css';

const sections = [
  { to: '/admin', label: 'Overview', end: true },
  { to: '/admin/statistics', label: 'Statistics' },
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/routes', label: 'Routes' },
  { to: '/admin/pois', label: 'POIs' },
  { to: '/admin/source-files', label: 'Source files' },
  { to: '/admin/sync-log', label: 'Sync log' },
  { to: '/admin/error-log', label: 'Error log' },
  { to: '/admin/settings', label: 'Settings' },
];

/** The admin area. The server enforces access; this only avoids showing a broken page to everyone else. */
export function AdminLayout() {
  const me = useMe();
  if (!me.data?.isAdmin)
    return (
      <div className={styles.page}>
        <div className={styles.denied} role="alert">
          <Icon name="alert" size={28} />
          <h1 className={`display ${styles.title}`}>Admins only</h1>
          <p className={styles.sub}>Your account isn’t listed as an administrator of this Atrapos instance.</p>
        </div>
      </div>
    );

  return (
    <div className={styles.page}>
      <nav aria-label="Admin" className={styles.subnav}>
        {sections.map((s) => (
          <NavLink key={s.to} to={s.to} end={s.end} className={({ isActive }) => (isActive ? styles.subnavActive : styles.subnavLink)}>
            {s.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
