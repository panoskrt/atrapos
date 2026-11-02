import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { Icon } from './Icon';
import styles from './ErrorPage.module.css';

/** Shown instead of a blank screen when rendering fails or a page doesn't exist. */
export function ErrorPage() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  if (error && !notFound) console.error(error);

  return <ErrorView notFound={notFound} />;
}

export function NotFoundPage() {
  return <ErrorView notFound />;
}

function ErrorView({ notFound }: { notFound: boolean }) {
  return (
    <main className={styles.page}>
      <div className={styles.icon} aria-hidden="true">
        <Icon name="alert" size={28} />
      </div>
      <h1 className={`display ${styles.title}`}>{notFound ? 'Page not found' : 'Something went wrong'}</h1>
      <p className={styles.text}>
        {notFound
          ? "There's nothing at this address."
          : 'The page hit an unexpected error. Your routes are saved; reloading usually helps.'}
      </p>
      <div className={styles.actions}>
        {!notFound && (
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        )}
        <Link to="/" className="btn">
          Go to the library
        </Link>
      </div>
    </main>
  );
}
