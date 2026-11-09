import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ElevationProfile } from './ElevationProfile';

beforeEach(() => localStorage.clear());

describe('ElevationProfile', () => {
  it('collapses to its header and remembers it', () => {
    const { unmount } = render(<ElevationProfile line={[]} cumulative={[]} pending={false} pois={[]} />);
    expect(screen.getByText('Add at least two points to see the elevation profile.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Hide elevation profile' }));
    expect(screen.queryByText('Add at least two points to see the elevation profile.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show elevation profile' })).toHaveAttribute('aria-expanded', 'false');

    unmount();
    render(<ElevationProfile line={[]} cumulative={[]} pending={false} pois={[]} />);
    expect(screen.getByRole('button', { name: 'Show elevation profile' })).toBeInTheDocument();
  });
});
