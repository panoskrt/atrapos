import { useEffect, useId, useRef, useState } from 'react';
import { NavLink, Navigate, Outlet, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../lib/theme';
import { useMe, useSignOut, type Me } from '../features/auth/useMe';
import { useSuuntoActivity } from '../lib/suuntoActivity';
import { ConfirmHost, confirmAction } from './ConfirmDialog';
import { Icon } from './Icon';
import { Spinner } from './Spinner';
import { toast, ToastHost } from './Toast';
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
  const suuntoActivity = useSuuntoActivity();
  const activity = me.suuntoConnected ? suuntoActivity : null;

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
        <NavLink to="/gpx-tools" className={({ isActive }) => (isActive ? styles.navActive : styles.navLink)}>
          GPX tools
        </NavLink>
      </nav>
      <div className={styles.spacer} />
      {/* Doubles as the app-wide indicator for calls to Suunto's servers, which can take a few seconds. */}
      <div
        className={activity ? `${styles.status} ${styles.statusBusy}` : styles.status}
        title={activity ?? (me.suuntoConnected && me.suuntoMode === 'Mock' ? 'Connected to the mock Suunto server' : undefined)}
        role="status"
      >
        {activity ? (
          <>
            <Spinner size={14} />
            <span className={styles.activityLabel}>{activity}</span>
          </>
        ) : (
          <>
            {me.googleAccount && (
              <>
                <span className={styles.dotGoogle} />
                <span className={styles.statusLabel}>Google account</span>
              </>
            )}
            {me.googleAccount && me.suuntoConnected && <span className={styles.statusLabel}>·</span>}
            {me.suuntoConnected && (
              <>
                <span className={styles.dot} />
                <span className={styles.statusLabel}>
                  {me.suuntoMode === 'Mock' ? 'Mock Suunto' : 'Suunto connected'}
                </span>
              </>
            )}
            {(me.googleAccount || me.suuntoConnected) && <span className={styles.statusLabel}>·</span>}
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
      <AccountMenu
        username={me.username}
        googleAccount={me.googleAccount}
        suuntoConnected={me.suuntoConnected}
      />
    </header>
  );
}

function AccountMenu({
  username,
  googleAccount,
  suuntoConnected,
}: {
  username: string;
  googleAccount: boolean;
  suuntoConnected: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const signOut = useSignOut();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const connectPopup = useRef<Window | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== connectPopup.current) return;
      const payload = event.data as { type?: unknown; status?: unknown; error?: unknown };
      if (payload?.type !== 'rpm-suunto-connect') return;
      connectPopup.current = null;
      if (payload.status === 'success') {
        void queryClient.invalidateQueries();
        toast('Suunto is connected to your Google account.');
      } else {
        toast(connectionErrorMessage(typeof payload.error === 'string' ? payload.error : ''), { tone: 'error' });
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [queryClient]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const error = url.searchParams.get('suunto_connect_error');
    if (!error) return;
    toast(connectionErrorMessage(error), { tone: 'error' });
    url.searchParams.delete('suunto_connect_error');
    window.history.replaceState(window.history.state, '', url);
  }, []);

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
        body: googleAccount
          ? 'This app loses access to your Suunto account until you connect again. You will stay signed in with Google.'
          : 'This app loses access to your Suunto account until you sign in again.',
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
    signOut.mutate(mode, {
      onSuccess: (result) => {
        if (mode === 'logout' || !result.sessionPreserved) navigate('/login', { replace: true });
        else toast('Suunto disconnected. You are still signed in with Google.');
      },
    });
  };

  const connectSuunto = async () => {
    setOpen(false);
    const confirmed = await confirmAction({
      title: 'Connect Suunto and merge account data?',
      body: 'If you have used Suunto login in this app before, that account’s routes, POIs, source files, and sync history will be merged into your Google account. When both accounts contain the same Suunto route or POI, the Suunto account’s record will be kept. This merge cannot be undone.',
      confirmLabel: 'Connect and merge',
      icon: 'pinPlus',
    });
    if (!confirmed) return;

    const popup = window.open('/auth/connect', 'suunto-connect', 'width=520,height=720');
    if (popup) connectPopup.current = popup;
    else window.location.assign('/auth/connect');
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
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            onClick={() => {
              setOpen(false);
              navigate('/profile');
            }}
          >
            <Icon name="user" size={18} />
            Profile
          </button>
          {googleAccount && !suuntoConnected && (
            <button type="button" role="menuitem" className={styles.menuItem} onClick={connectSuunto}>
              <Icon name="pinPlus" size={18} />
              Connect Suunto
            </button>
          )}
          {suuntoConnected && (
            <button type="button" role="menuitem" className={styles.menuItemDanger} onClick={() => run('disconnect')}>
              <Icon name="unlink" size={18} />
              Disconnect Suunto
            </button>
          )}
          <button type="button" role="menuitem" className={styles.menuItem} onClick={() => run('logout')}>
            <Icon name="logout" size={18} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function connectionErrorMessage(code: string) {
  if (code === 'suunto_linked_to_another_google_account')
    return 'This Suunto account is already associated with another Google account.';
  if (code === 'google_account_already_linked')
    return 'This Google account is already associated with a different Suunto account.';
  if (code === 'access_denied') return 'Suunto connection was cancelled.';
  return `Could not connect Suunto${code ? ` (${code})` : ''}.`;
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
