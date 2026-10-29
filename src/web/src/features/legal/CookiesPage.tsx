import { Link } from 'react-router';
import { LegalLayout } from './LegalLayout';
import styles from './Legal.module.css';

export function CookiesPage() {
  return (
    <LegalLayout title="Cookies" updated="2026-10-29">
      <p className={styles.lede}>
        Atrapos uses only essential cookies, to keep you signed in and to protect signing in. None of them track you,
        so there is no consent banner.
      </p>

      <h2>Cookies the site sets</h2>
      <dl className={styles.entries}>
        <div className={styles.entry}>
          <dt>
            <code>rpm.session</code>
          </dt>
          <dd>
            Keeps you signed in. It is HttpOnly, so scripts can't read it, and SameSite=Lax, so other sites can't use
            it in the background. Your sign-in is checked again every 5 minutes.
          </dd>
          <dd className={styles.lasts}>60 days by default, renewed as you use the app. Removed when you sign out.</dd>
        </div>
        <div className={styles.entry}>
          <dt>
            <code>rpm.oauth_state</code>
          </dt>
          <dd>Protects signing in with Suunto against forged sign-in replies. Sent only to <code>/auth</code>.</dd>
          <dd className={styles.lasts}>10 minutes. Deleted once Suunto replies.</dd>
        </div>
        <div className={styles.entry}>
          <dt>
            <code>rpm.oauth_connect</code>
          </dt>
          <dd>
            While you connect Suunto to a Google account, remembers which account. Sent only to <code>/auth</code>.
          </dd>
          <dd className={styles.lasts}>10 minutes.</dd>
        </div>
        <div className={styles.entry}>
          <dt>
            <code>.AspNetCore.Correlation.*</code>
          </dt>
          <dd>Set by the Google sign-in to protect it in the same way.</dd>
          <dd className={styles.lasts}>Removed when the Google sign-in finishes.</dd>
        </div>
      </dl>

      <h2>Stored in your browser</h2>
      <p>
        These stay in your browser's local storage and are never sent to the server. Your account preferences are
        saved to your account, not here.
      </p>
      <dl className={styles.entries}>
        <div className={styles.entry}>
          <dt>
            <code>rpm.theme</code>, <code>rpm.design</code>
          </dt>
          <dd>Your appearance, so pages look right before your settings load.</dd>
        </div>
        <div className={styles.entry}>
          <dt>
            <code>rpm.mapView</code>
          </dt>
          <dd>Where the map was last, and its zoom.</dd>
        </div>
        <div className={styles.entry}>
          <dt>
            <code>rpm.library.view</code>, <code>rpm.library.sort</code>, <code>rpm.pois.view</code>
          </dt>
          <dd>How you last viewed and sorted the library and the POI list.</dd>
        </div>
        <div className={styles.entry}>
          <dt>
            <code>gpxTools.shrinkToleranceM</code>
          </dt>
          <dd>The tolerance you last used to shrink a file in the GPX tools.</dd>
        </div>
      </dl>

      <h2>Removing them</h2>
      <p>
        Sign out to remove the sign-in cookie, or clear this site's data in your browser to remove everything. For
        what the site stores on its server, see <Link to="/privacy">Privacy and terms</Link>.
      </p>
    </LegalLayout>
  );
}
