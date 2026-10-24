import { Navigate } from 'react-router';
import { Spinner } from '../../components/Spinner';
import { useMe } from '../auth/useMe';
import { useUpdateUserSettings, useUserSettings } from './userSettings';
import { baseLayers } from '../editor/baseLayers';
import { useTheme } from '../../lib/theme';
import styles from './ProfilePage.module.css';

export function ProfilePage() {
  const me = useMe();
  const settings = useUserSettings();
  const updateSettings = useUpdateUserSettings();
  const { setTheme } = useTheme();

  if (me.isPending)
    return (
      <div className={styles.loading} role="status">
        <Spinner size={24} />
        Loading your profile…
      </div>
    );
  if (me.isError) return <p className={styles.error} role="alert">Couldn’t load your profile: {me.error.message}</p>;
  if (!me.data) return <Navigate to="/login" replace />;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Your profile</h1>
        <p className={styles.sub}>Account details and connected services.</p>
      </header>
      <section className={`${styles.card} ${styles.preferencesCard}`} aria-labelledby="preferences-heading">
        <div className={styles.cardHeader}>
          <div>
            <h2 id="preferences-heading" className={styles.cardTitle}>Preferences</h2>
            <p className={styles.cardDescription}>Saved to your account and used throughout the app.</p>
          </div>
        </div>
        {settings.isError ? (
          <p className={styles.error} role="alert">Couldn’t load preferences: {settings.error.message}</p>
        ) : (
          <div className={styles.preferences}>
            <label>
              Default map
              <select
                value={settings.data?.defaultMap ?? 'topo'}
                disabled={!settings.data || updateSettings.isPending}
                onChange={(event) => {
                  const defaultMap = baseLayers.find((layer) => layer.id === event.target.value)?.id;
                  if (settings.data && defaultMap) {
                    updateSettings.mutate({ ...settings.data, defaultMap });
                  }
                }}
              >
                {baseLayers.map((layer) => <option key={layer.id} value={layer.id}>{layer.label}</option>)}
              </select>
            </label>
            <label>
              Units
              <select
                value={settings.data?.units ?? 'metric'}
                disabled={!settings.data || updateSettings.isPending}
                onChange={(event) => {
                  const units = event.target.value;
                  if (settings.data && (units === 'metric' || units === 'imperial')) {
                    updateSettings.mutate({ ...settings.data, units });
                  }
                }}
              >
                <option value="metric">Metric (km, m, °C)</option>
                <option value="imperial">Imperial (mi, ft, °F)</option>
              </select>
            </label>
            <label>
              Appearance
              <select
                value={settings.data?.theme ?? 'dark'}
                disabled={!settings.data || updateSettings.isPending}
                onChange={(event) => {
                  const theme = event.target.value;
                  if (settings.data && (theme === 'dark' || theme === 'light')) {
                    const previousTheme = settings.data.theme;
                    setTheme(theme);
                    updateSettings.mutate(
                      { ...settings.data, theme },
                      { onError: () => setTheme(previousTheme) },
                    );
                  }
                }}
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </label>
            {updateSettings.isError && (
              <p className={styles.error} role="alert">Couldn’t save preferences: {updateSettings.error.message}</p>
            )}
          </div>
        )}
      </section>
      <div className={styles.accounts}>
        <section className={styles.card} aria-labelledby="google-account-heading">
          <div className={styles.cardHeader}>
            <div className={styles.cardIdentity}>
              <GoogleLogo />
              <div>
                <h2 id="google-account-heading" className={styles.cardTitle}>Google account</h2>
                <p className={styles.cardDescription}>Used to sign in to Route &amp; POI Manager.</p>
              </div>
            </div>
            <span className={me.data.googleAccount ? styles.connected : styles.disconnected}>
              {me.data.googleAccount ? 'Connected' : 'Not connected'}
            </span>
          </div>
          {me.data.googleAccount && (
            <dl className={styles.details}>
              <div>
                <dt>Name</dt>
                <dd>{me.data.username}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{me.data.googleEmail ?? 'Not available'}</dd>
              </div>
            </dl>
          )}
        </section>

        <section className={styles.card} aria-labelledby="suunto-account-heading">
          <div className={styles.cardHeader}>
            <div className={styles.cardIdentity}>
              <img className={styles.suuntoLogo} src="/suunto-logo.svg" alt="" />
              <div>
                <h2 id="suunto-account-heading" className={styles.cardTitle}>Suunto account</h2>
                <p className={styles.cardDescription}>Used to sync routes and POIs with Suunto.</p>
              </div>
            </div>
            <span className={me.data.suuntoConnected ? styles.connected : styles.disconnected}>
              {me.data.suuntoConnected ? 'Connected' : 'Not connected'}
            </span>
          </div>
          {me.data.suuntoConnected && (
            <dl className={styles.details}>
              <div>
                <dt>Username</dt>
                <dd>{me.data.suuntoUsername ?? 'Not available'}</dd>
              </div>
              <div>
                <dt>Connection</dt>
                <dd>{me.data.suuntoMode === 'Mock' ? 'Mock Suunto' : 'Live Suunto'}</dd>
              </div>
            </dl>
          )}
        </section>
      </div>
    </div>
  );
}

function GoogleLogo() {
  return (
    <svg className={styles.googleLogo} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.91 3.28-4.73 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.15v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.43.34-2.1V7.06H2.15A11 11 0 0 0 1 12c0 1.78.43 3.46 1.15 4.94l3.69-2.84z" />
      <path fill="#EA4335" d="M12 5.37c1.62 0 3.06.56 4.21 1.64l3.16-3.16C17.45 2.09 14.97 1 12 1a11 11 0 0 0-9.85 6.06L5.84 9.9C6.71 7.3 9.14 5.37 12 5.37z" />
    </svg>
  );
}
