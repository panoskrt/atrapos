import { act, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { applyUserSettings, DEFAULT_FAVORITE_ACTIVITY_IDS } from '../../lib/userPreferences';
import { SectionAnalysis } from './SectionAnalysis';
import { cumulativeDistances, type Coord } from './geo';
import { useSectionStore } from './store';

const line: Coord[] = [100, 150, 200, 200, 140].map((e, i) => [24 + i * 0.02, 60, e]);
const cumulative = cumulativeDistances(line);

describe('SectionAnalysis', () => {
  afterEach(() => {
    act(() => useSectionStore.getState().clear());
    applyUserSettings({
      defaultMap: 'topo', units: 'metric', theme: 'dark', design: 'classic',
      favoriteActivityIds: DEFAULT_FAVORITE_ACTIVITY_IDS, defaultRoutingProfile: null,
    });
  });

  it('shows nothing until a section is chosen', () => {
    render(<SectionAnalysis line={line} cumulative={cumulative} pois={[]} />);
    expect(screen.queryByRole('region', { name: 'Section analysis' })).toBeNull();
  });

  it('reports the chosen part, its POIs, and clears', () => {
    const pois = [
      { id: 'a', name: 'In', alongM: cumulative[1]! },
      { id: 'b', name: 'Out', alongM: cumulative[4]! },
    ];
    render(<SectionAnalysis line={line} cumulative={cumulative} pois={pois} />);
    act(() => useSectionStore.getState().setRange(cumulative[2]!, 0));

    const card = screen.getByRole('region', { name: 'Section analysis' });
    const value = (label: string) => within(card).getByText(label).nextElementSibling!.textContent;
    expect(value('Distance')).toBe('2.2 km');
    expect(value('Ascent')).toBe('+100 m');
    expect(value('Descent')).toBe('−0 m');
    expect(value('Net change')).toBe('+100 m');
    expect(value('Highest')).toBe('200 m');
    expect(value('Lowest')).toBe('100 m');
    expect(value('POIs')).toBe('1');

    act(() => within(card).getByRole('button', { name: 'Clear section' }).click());
    expect(screen.queryByRole('region', { name: 'Section analysis' })).toBeNull();
  });

  it('uses the chosen unit system', () => {
    applyUserSettings({
      defaultMap: 'topo', units: 'imperial', theme: 'dark', design: 'classic',
      favoriteActivityIds: DEFAULT_FAVORITE_ACTIVITY_IDS, defaultRoutingProfile: null,
    });
    render(<SectionAnalysis line={line} cumulative={cumulative} pois={[]} />);
    act(() => useSectionStore.getState().setRange(0, cumulative[2]!));
    const card = screen.getByRole('region', { name: 'Section analysis' });
    expect(within(card).getByText('Ascent').nextElementSibling!.textContent).toBe('+328 ft');
  });
});
