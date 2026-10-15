import { useEffect, useId, useRef, useState } from 'react';
import { NavLink, Navigate, Outlet, useNavigate } from 'react-router';
import { useTheme } from '../lib/theme';
import { useMe, useSignOut, type Me } from '../features/auth/useMe';
import { useSuuntoActivity } from '../lib/suuntoActivity';
import { ConfirmHost, confirmAction } from './ConfirmDialog';
import { Icon } from './Icon';
import { Spinner } from './Spinner';
import { ToastHost } from './Toast';
import styles from './AppShell.module.css';

/** Guards the signed-in area and renders the top bar around it. */
export function AppShell() {
  const me = useMe();

  if (me.isPending)
    return (
      <div className={styles.loading} role="status">
        <Spinner size={28} />
        Loading your account…
      </div>
    );
  if (me.isError) return <FatalError message={me.error.message} />;
  if (!me.data) return <Navigate to="/login" replace />;

  return (
    <div className={styles.shell}>
      <a href="#main" className={styles.skip}>
        Skip to content
      </a>
      <TopBar me={me.data} />
      <main id="main" tabIndex={-1} className={styles.main}>
        <Outlet />
      </main>
      <ConfirmHost />
      <ToastHost />
    </div>
  );
}

function TopBar({ me }: { me: Me }) {
  const { theme, toggle } = useTheme();
  const activity = useSuuntoActivity();

  return (
    <header className={styles.topbar}>
      {activity && <div className={styles.progress} role="progressbar" aria-label={activity} />}
      <NavLink to="/" className={styles.brand}>
        <span className={styles.mark}>
          <Icon name="logo" />
        </span>
        <span className="display">Route &amp; POI Manager</span>
      </NavLink>
      <nav aria-label="Main" className={styles.nav}>
        <NavLink to="/" end className={({ isActive }) => (isActive ? styles.navActive : styles.navLink)}>
          Library
        </NavLink>
        <NavLink to="/pois" className={({ isActive }) => (isActive ? styles.navActive : styles.navLink)}>
          All POIs
        </NavLink>
      </nav>
      <div className={styles.spacer} />
      {/* Doubles as the app-wide indicator for calls to Suunto's servers, which can take a few seconds. */}
      <div
        className={activity ? `${styles.status} ${styles.statusBusy}` : styles.status}
        title={activity ?? (me.suuntoMode === 'Mock' ? 'Connected to the mock Suunto server' : undefined)}
        role="status"
      >
        {activity ? (
          <>
            <Spinner size={14} />
            <span className={styles.activityLabel}>{activity}</span>
          </>
        ) : (
          <>
            <span className={styles.dot} />
            <span className={styles.statusLabel}>{me.suuntoMode === 'Mock' ? 'Mock Suunto' : 'Suunto connected'} ·</span>
            <strong>{me.username}</strong>
          </>
        )}
      </div>
      <button
        type="button"
        className="btn btn-icon"
        onClick={toggle}
        aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      >
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
      </button>
      <AccountMenu username={me.username} />
    </header>
  );
}

function AccountMenu({ username }: { username: string }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const signOut = useSignOut();
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const run = async (mode: 'logout' | 'disconnect') => {
    setOpen(false);
    if (
      mode === 'disconnect' &&
      !(await confirmAction({
        title: 'Disconnect Suunto?',
        body: 'This app loses access to your Suunto account until you sign in again.',
        facts: [
          ['Routes and POIs in this app', 'Kept'],
          ['What you already pushed', 'Stays in the Suunto app'],
          ["This app's access", 'Revoked', 'danger'],
        ],
        confirmLabel: 'Disconnect',
        tone: 'danger',
        icon: 'unlink',
      }))
    ) {
      return;
    }
    signOut.mutate(mode, { onSuccess: () => navigate('/login', { replace: true }) });
  };

  return (
    <div className={styles.account} ref={rootRef}>
      <button
        type="button"
        className={styles.avatar}
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
      >
        {username.slice(0, 2).toUpperCase()}
      </button>
      {open && (
        <div id={menuId} role="menu" className={styles.menu}>
          <button type="button" role="menuitem" className={styles.menuItem} onClick={() => run('logout')}>
            <Icon name="logout" size={18} />
            Sign out
          </button>
          <button type="button" role="menuitem" className={styles.menuItemDanger} onClick={() => run('disconnect')}>
            <Icon name="unlink" size={18} />
            Disconnect Suunto
          </button>
        </div>
      )}
    </div>
  );
}

function FatalError({ message }: { message: string }) {
  return (
    <div className={styles.fatal} role="alert">
      <Icon name="alert" size={28} />
      <p>Couldn't reach the server: {message}</p>
      <button type="button" className="btn" onClick={() => window.location.reload()}>
        Retry
      </button>
    </div>
  );
}
