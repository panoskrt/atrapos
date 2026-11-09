import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LeafletMap } from '../../components/LeafletMap';
import { MapToolbar } from './MapToolbar';
import { useEditorStore } from './store';

beforeEach(() => useEditorStore.getState().startNew());

describe('MapToolbar', () => {
  it('starts collapsed and can be expanded and collapsed with the cog button', () => {
    render(
      <LeafletMap center={[50, 10]} zoom={4}>
        <MapToolbar onFit={vi.fn()} onLocate={vi.fn()} onReverse={vi.fn()} canFit={false} />
      </LeafletMap>,
    );

    expect(screen.getByRole('button', { name: 'Show map tools' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('toolbar', { name: 'Map tools' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show map tools' }));
    expect(screen.getByRole('button', { name: 'Hide map tools' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('toolbar', { name: 'Map tools' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Hide map tools' }));
    expect(screen.getByRole('button', { name: 'Show map tools' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('toolbar', { name: 'Map tools' })).not.toBeInTheDocument();
  });
});
