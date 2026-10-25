import { useEffect, useRef, useState } from 'react';
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
  google_not_configured: 'Google sign-in is not configured yet.',
  google_auth_failed: 'Google sign-in failed. Please try again.',
  not_allowed: "This account isn't allowed to use this app. Ask the owner to add it to the allowlist.",
};

const ROUTE =
  'M150,760 C210,730 250,690 310,665 S400,600 430,540 S510,485 570,470 S650,410 690,370 S740,290 760,222';

export function LoginPage() {
  const me = useMe();
  const [params] = useSearchParams();
  const error = params.get('error');
  const [opening, setOpening] = useState(false);
  const popupRef = useRef<Window | null>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const payload = event.data;
      if (!popupRef.current || event.source !== popupRef.current || !payload) return;
      if (payload.type !== 'rpm-suunto-auth' && payload.type !== 'rpm-google-auth') {
        return;
      }

      setOpening(false);
      if (payload.status === 'success') {
        if (payload.type === 'rpm-google-auth') window.location.reload();
        else window.location.assign(payload.redirect ?? '/');
      } else if (payload.type === 'rpm-google-auth') {
        window.location.assign(`/login?error=${encodeURIComponent(payload.error ?? 'google_auth_failed')}`);
      } else if (payload.redirect) {
        window.location.assign(payload.redirect);
      }
    };

    const handlePageShow = (e: PageTransitionEvent) => e.persisted && setOpening(false);
    window.addEventListener('message', handleMessage);
    window.addEventListener('pageshow', handlePageShow);

    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, []);

  useEffect(() => {
    if (!popupRef.current) return;
    const timer = window.setInterval(() => {
      if (popupRef.current?.closed) {
        setOpening(false);
        popupRef.current = null;
        window.clearInterval(timer);
      }
    }, 250);

    return () => window.clearInterval(timer);
  }, [opening]);

  const openSuuntoLogin = () => {
    const popup = window.open('/auth/login', 'suunto-login', 'width=520,height=720');
    if (!popup) {
      window.location.assign('/auth/login');
      return;
    }

    popupRef.current = popup;
    setOpening(true);
  };

  const openGoogleLogin = () => {
    const popup = window.open('/auth/google', 'google-login', 'width=520,height=720');
    if (!popup) {
      window.location.assign('/auth/google');
      return;
    }

    popupRef.current = popup;
    setOpening(true);
  };

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
            Sign in with Google for your own app account, or use your Suunto account to work with routes and POIs
            synced to your watch. These are separate accounts.
          </p>

          {error && (
            <div role="alert" className={styles.error}>
              <Icon name="alert" size={18} />
              <span>{errorMessages[error] ?? 'Sign-in failed. Please try again.'}</span>
            </div>
          )}

          <div className={styles.providers}>
            <button
              type="button"
              className={`btn ${styles.googleCta}`}
              aria-disabled={opening || undefined}
              disabled={opening}
              onClick={openGoogleLogin}
            >
              <span className={styles.googleMark} aria-hidden="true">G</span>
              {opening ? 'Opening Google…' : 'Sign in with Google'}
            </button>
            <span className={styles.providerDivider}>or</span>
            <button
              type="button"
              className={`btn btn-primary ${styles.cta}`}
              aria-disabled={opening || undefined}
              disabled={opening}
              onClick={openSuuntoLogin}
            >
              {opening ? <Spinner size={20} /> : <Icon name="watch" />}
              {opening ? 'Opening Suunto…' : 'Sign in with Suunto'}
            </button>
          </div>

          <ul className={styles.points}>
            <li>
              <Icon name="check" size={18} />
              Suunto sign-in uses Suunto's own page; this app never sees your Suunto password.
            </li>
            <li>
              <Icon name="check" size={18} />
              Google and Suunto sign-ins create separate app accounts.
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
          <path className={styles.routeCase} pathLength={1} d={ROUTE} />
          <path className={styles.route} pathLength={1} d={ROUTE} />
          <circle className={styles.start} cx="150" cy="760" r="12" />
          <circle className={`${styles.poi} ${styles.poi1}`} cx="430" cy="540" r="16" />
          <circle className={`${styles.poi} ${styles.poi2}`} cx="690" cy="370" r="16" />
          <circle className={`${styles.poi} ${styles.poi3}`} cx="760" cy="222" r="18" />
        </svg>
      </div>
    </div>
  );
}
