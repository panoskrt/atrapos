import { useLayoutEffect, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { Icon } from '../../components/Icon';
import { SiteFooter } from '../../components/SiteFooter';
import styles from './Legal.module.css';

/** The frame of the privacy and cookie pages, which signed-out visitors can read too. */
export function LegalLayout({
  title,
  updated,
  children,
}: {
  title: string;
  /** ISO date, shown as "Last updated". */
  updated: string;
  children: ReactNode;
}) {
  const { hash } = useLocation();

  // The router keeps the window's scroll position, and the footer links that lead here sit at the bottom of the page.
  useLayoutEffect(() => {
    const target = hash && document.getElementById(decodeURIComponent(hash.slice(1)));
    if (target) target.scrollIntoView();
    else window.scrollTo(0, 0);
    // Only on arrival: in-page links scroll by themselves.
  }, []);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link to="/" className={styles.brand}>
          <span className={styles.mark}>
            <Icon name="logo" size={20} />
          </span>
          <span className="display">Atrapos</span>
        </Link>
      </header>
      <main className={styles.main}>
        <article className={styles.article}>
          <h1 className={`display ${styles.title}`}>{title}</h1>
          <p className={styles.updated}>
            Last updated <time dateTime={updated}>{formatDate(updated)}</time>
          </p>
          {children}
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}

/** An outside link, in a new tab like the rest of the app's outside links. */
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
