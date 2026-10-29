import { Link } from 'react-router';
import { site } from '../lib/site';
import styles from './SiteFooter.module.css';

/** The bottom bar on every page: who built the app, its source code and the legal pages. */
export function SiteFooter({ className }: { className?: string }) {
  return (
    <footer className={className ? `${styles.footer} ${className}` : styles.footer}>
      <p className={styles.credit}>
        Developed by{' '}
        <a href={site.developerUrl} target="_blank" rel="noreferrer">
          {site.developer}
        </a>
      </p>
      <ul className={styles.links}>
        <li>
          <a href={site.sourceUrl} target="_blank" rel="noreferrer">
            Source code
          </a>
        </li>
        <li>
          <Link to="/privacy">Privacy and terms</Link>
        </li>
        <li>
          <Link to="/cookies">Cookies</Link>
        </li>
      </ul>
    </footer>
  );
}
