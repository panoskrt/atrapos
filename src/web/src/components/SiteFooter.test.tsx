import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { site } from '../lib/site';
import { SiteFooter } from './SiteFooter';

function renderFooter() {
  const router = createMemoryRouter([{ path: '/', element: <SiteFooter /> }]);
  render(<RouterProvider router={router} />);
}

describe('SiteFooter', () => {
  it('credits the developer in a new tab', () => {
    renderFooter();
    const link = screen.getByRole('link', { name: site.developer });

    expect(screen.getByRole('contentinfo')).toHaveTextContent(`Developed by ${site.developer}`);
    expect(link).toHaveAttribute('href', site.developerUrl);
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('links to the source code in a new tab', () => {
    renderFooter();
    const link = screen.getByRole('link', { name: 'Source code' });

    expect(link).toHaveAttribute('href', site.sourceUrl);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  it('links to the privacy and cookie pages inside the app', () => {
    renderFooter();

    expect(screen.getByRole('link', { name: 'Privacy and terms' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: 'Cookies' })).toHaveAttribute('href', '/cookies');
    expect(screen.getByRole('link', { name: 'Cookies' })).not.toHaveAttribute('target');
  });
});
