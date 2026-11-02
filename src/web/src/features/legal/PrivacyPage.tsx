import { Link } from 'react-router';
import { site } from '../../lib/site';
import { ExternalLink, LegalLayout } from './LegalLayout';
import styles from './Legal.module.css';

export function PrivacyPage() {
  return (
    <LegalLayout title="Privacy and terms" updated="2026-10-29">
      <p className={styles.lede}>
        What Atrapos stores about you, who else sees your data, and the terms for using the site.
      </p>
      <nav aria-label="On this page" className={styles.contents}>
        <a href="#privacy">Privacy</a>
        <a href="#terms">Terms</a>
        <Link to="/cookies">Cookies</Link>
      </nav>

      <h2 id="privacy">Privacy</h2>

      <h3>Who runs this site</h3>
      <p>
        This site is run by {site.developer}, the developer of Atrapos. For questions about your data, or to have your
        account deleted, get in touch through <ExternalLink href={site.developerUrl}>GitHub</ExternalLink>.
      </p>

      <h3>Signing in</h3>
      <ul>
        <li>
          With Google, the database stores only Google's id for your account. Your Google name and email address are
          kept only inside your encrypted sign-in cookie.
        </li>
        <li>
          With Suunto, it stores your Suunto username, and Suunto's access and refresh tokens encrypted with ASP.NET
          Data Protection. The encryption keys are kept in the database.
        </li>
        <li>You sign in to Suunto on Suunto's own page, so Atrapos never sees your Suunto password.</li>
      </ul>

      <h3>What is stored for your account</h3>
      <ul>
        <li>Your settings: default map, units, theme and design.</li>
        <li>
          Routes: name, description, the line with its elevation, control points, distance and climb, and their sync
          status with Suunto.
        </li>
        <li>POIs: name, description, type, location and elevation.</li>
        <li>The GPX and FIT files you upload.</li>
        <li>A log of your sync operations with Suunto.</li>
        <li>
          An error log. When something fails, it records the time, your user id and username, what you were doing, the
          error message and stack trace, and the HTTP status. These entries aren't tied to your account, so they are
          kept after it is deleted.
        </li>
      </ul>
      <p>Neither log is cleared automatically.</p>

      <h3>Deleting your data</h3>
      <ul>
        <li>
          A POI you delete is kept hidden, so undo and sync still work. It is removed for good when you delete its
          route or your account.
        </li>
        <li>
          The app can't delete your account yet, so ask through the contact above. You can download any route as GPX
          first.
        </li>
        <li>
          Suunto has no way to delete through its API, so deleting here deletes nothing in your Suunto account. Remove
          it in the Suunto app if you want it gone there too.
        </li>
      </ul>

      <h3>Suunto</h3>
      <p>
        Nothing goes to Suunto until you press Push, and Atrapos reads from Suunto only when you click Refresh from
        Suunto.
      </p>

      <h3>Services the site uses</h3>
      <p>The server calls these with coordinates only, never who you are:</p>
      <ul>
        <li>
          <ExternalLink href="https://brouter.de">BRouter</ExternalLink>, to snap routes to trails.
        </li>
        <li>
          <ExternalLink href="https://www.opentopodata.org">Open Topo Data</ExternalLink>, for elevation.
        </li>
        <li>
          <ExternalLink href="https://open-meteo.com">Open-Meteo</ExternalLink>, for the weather at the start,
          midpoint and end of a route.
        </li>
      </ul>
      <p>
        It also calls Google and Suunto when you sign in, and Suunto's Route and POI APIs when you push or refresh.
      </p>
      <p>Your browser loads these directly, so they see your IP address like any website does:</p>
      <ul>
        <li>
          Map tiles from <ExternalLink href="https://www.openstreetmap.org">OpenStreetMap</ExternalLink>,{' '}
          <ExternalLink href="https://opentopomap.org">OpenTopoMap</ExternalLink> and{' '}
          <ExternalLink href="https://www.cyclosm.org">CyclOSM</ExternalLink>.
        </li>
        <li>
          Place search from <ExternalLink href="https://nominatim.openstreetmap.org">OpenStreetMap Nominatim</ExternalLink>,
          which receives what you type.
        </li>
        <li>
          Fonts from <ExternalLink href="https://fonts.google.com">Google Fonts</ExternalLink>.
        </li>
      </ul>

      <h3>Logs</h3>
      <ul>
        <li>The server logs each request's method, path, status and duration.</li>
        <li>Signing in with Suunto logs your Suunto username.</li>
        <li>Rate limiting counts requests per IP address in the server's memory.</li>
      </ul>

      <h3>Tracking</h3>
      <p>
        Atrapos has no analytics, ads or tracking. <Link to="/cookies">Cookies</Link> lists what it keeps in your
        browser.
      </p>

      <h2 id="terms">Terms</h2>
      <ul>
        <li>
          Atrapos is free, open-source software under the{' '}
          <ExternalLink href={site.licenseUrl}>GNU Affero General Public License v3</ExternalLink>, and you can read its{' '}
          <ExternalLink href={site.sourceUrl}>source code</ExternalLink>. It is provided as is, in the hope that it will
          be useful, but without any warranty; without even the implied warranty of merchantability or fitness for a
          particular purpose.
        </li>
        <li>
          Atrapos works with Suunto but is not affiliated with or endorsed by Suunto. Suunto is a trademark of its
          owner. Your Suunto and Google accounts stay under Suunto's and Google's own terms.
        </li>
        <li>
          Your routes and POIs stay yours. The site stores and processes them only to provide the service, and sends
          them to Suunto when you push.
        </li>
        <li>
          Routing, elevation, map tiles and place search come from free public services with fair-use policies
          (BRouter, Open Topo Data, OpenStreetMap tiles and Nominatim). Please use them fairly; rate limits apply.
        </li>
        <li>
          Routes, elevation and weather are estimates. Check the conditions before you go out; you are responsible for
          your own safety.
        </li>
        <li>The service may change or stop. Keep your own copies by downloading your routes as GPX.</li>
        <li>
          Map data © <ExternalLink href="https://www.openstreetmap.org/copyright">OpenStreetMap</ExternalLink>{' '}
          contributors. Weather data by <ExternalLink href="https://open-meteo.com">Open-Meteo</ExternalLink>, under{' '}
          <ExternalLink href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</ExternalLink>.
        </li>
      </ul>
    </LegalLayout>
  );
}
