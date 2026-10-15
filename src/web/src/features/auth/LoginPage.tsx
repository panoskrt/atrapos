import { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { Icon } from '../../components/Icon';
import { Spinner } from '../../components/Spinner';
import { useMe } from './useMe';
import styles from './LoginPage.module.css';

const errorMessages: Record<string, string> = {
  access_denied: 'Access was not approved on Suunto. Sign in again and choose Allow to connect.',
  state_mismatch: 'The sign-in link expired or was opened in another browser. Please try again.',
  token_exchange_failed: "Suunto didn't accept the sign-in. Please try again in a moment.",
  missing_code: "Suunto didn't return a sign-in code. Please try again.",
};

export function LoginPage() {
  const me = useMe();
  const [params] = useSearchParams();
  const error = params.get('error');
  const [opening, setOpening] = useState(false);

  // Coming back with the browser's Back button restores this page from cache, still "opening".
  useEffect(() => {
    const reset = (e: PageTransitionEvent) => e.persisted && setOpening(false);
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);

  if (me.data) return <Navigate to="/" replace />;

  return (
    <div className={styles.page}>
      <section className={styles.panel}>
        <div className={styles.brand}>
          <span className={styles.mark}>
            <Icon name="logo" size={22} />
          </span>
          <span className="display">Route &amp; POI Manager</span>
        </div>

        <div className={styles.body}>
          <h1 className={`display ${styles.title}`}>
            Plan the route.
            <br />
            Pin the POIs.
            <br />
            <span className={styles.titleAccent}>Sync to your watch.</span>
          </h1>
          <p className={styles.lede}>
            Import GPX or FIT files, draw routes along OpenStreetMap trails, mark points of interest, and push both to
            your Suunto app account.
          </p>

          {error && (
            <div role="alert" className={styles.error}>
              <Icon name="alert" size={18} />
              <span>{errorMessages[error] ?? 'Sign-in failed. Please try again.'}</span>
            </div>
          )}

          {/* A plain link: the backend redirects to Suunto's authorize page. */}
          <a
            className={`btn btn-primary ${styles.cta}`}
            href="/auth/login"
            aria-disabled={opening || undefined}
            onClick={(e) => (opening ? e.preventDefault() : setOpening(true))}
          >
            {opening ? <Spinner size={20} /> : <Icon name="watch" />}
            {opening ? 'Opening Suunto…' : 'Sign in with Suunto'}
          </a>

          <ul className={styles.points}>
            <li>
              <Icon name="check" size={18} />
              You approve access on Suunto's own sign-in page. This app never sees your password.
            </li>
            <li>
              <Icon name="check" size={18} />
              Routes and POIs are uploaded only when you press Push.
            </li>
            <li>
              <Icon name="check" size={18} />
              Disconnect any time from the account menu.
            </li>
          </ul>
        </div>

        <p className={styles.footer}>
          Independent tool, not affiliated with Suunto. Map data ©{' '}
          <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors.
        </p>
      </section>

      <div className={styles.art} aria-hidden="true">
        <svg viewBox="0 0 1000 900" preserveAspectRatio="xMidYMid slice">
          <path className={styles.forest} d="M0,420 C120,380 220,460 300,520 C380,580 360,700 280,780 C200,860 80,900 0,900 Z" />
          <path className={styles.forest} d="M640,620 C760,560 900,600 1000,660 L1000,900 L560,900 C560,780 580,680 640,620 Z" />
          <g className={styles.contours}>
            {[60, 130, 215, 310, 420, 540, 670].map((rx, i) => (
              <ellipse key={rx} cx={760 - i * 20} cy={220 + i * 25} rx={rx} ry={rx * 0.64} transform={`rotate(-16 ${760 - i * 20} ${220 + i * 25})`} />
            ))}
          </g>
          <path className={styles.water} d="M170,330 C220,270 350,280 380,340 C410,400 330,440 270,430 C200,420 140,390 170,330 Z" />
          <path className={styles.trail} d="M90,0 C150,180 120,400 190,560 C230,650 160,720 170,900" />
          <path className={styles.trail} d="M1000,380 C900,420 860,460 800,500 C740,540 700,610 620,660" />
          <path className={styles.routeCase} d="M150,760 C210,730 250,690 310,665 S400,600 430,540 S510,485 570,470 S650,410 690,370 S740,290 760,222" />
          <path className={styles.route} d="M150,760 C210,730 250,690 310,665 S400,600 430,540 S510,485 570,470 S650,410 690,370 S740,290 760,222" />
          <circle className={styles.start} cx="150" cy="760" r="12" />
          <circle className={styles.poi} cx="430" cy="540" r="16" />
          <circle className={styles.poi} cx="690" cy="370" r="16" />
          <circle className={styles.poi} cx="760" cy="222" r="18" />
        </svg>
      </div>
    </div>
  );
}
