import { describe, expect, it } from 'vitest';
import type { RouteSummary } from '../routes/api';
import { activityOptions, filterAndSort, formatChanged, isRouteSort, nextSort, summarize } from './dashboard';

const route = (over: Partial<RouteSummary>): RouteSummary => ({
  id: over.name ?? 'r',
  name: 'Route',
  distanceM: 1000,
  ascentM: 10,
  activityIds: [11],
  source: 'drawn',
  syncState: 'synced',
  poiCount: 0,
  poisPending: 0,
  localModifiedAt: '2026-10-01T10:00:00Z',
  preview: [],
  ...over,
});

const routes = [
  route({ name: 'Péfki loop', distanceM: 12_000, ascentM: 600, localModifiedAt: '2026-10-03T10:00:00Z' }),
  route({ name: 'Ridge 2', distanceM: 5_000, syncState: 'localOnly', localModifiedAt: '2026-10-05T10:00:00Z' }),
  route({ name: 'Ridge 10', distanceM: 8_000, poiCount: 3, poisPending: 1, localModifiedAt: '2026-10-01T10:00:00Z' }),
  route({ name: 'Coast', distanceM: 20_000, syncState: 'conflict', activityIds: [22, 11], localModifiedAt: '2026-10-04T10:00:00Z' }),
];
const names = (rs: RouteSummary[]) => rs.map((r) => r.name);

describe('filterAndSort', () => {
  it('sorts newest first by default and names naturally', () => {
    expect(names(filterAndSort(routes, { query: '', filter: 'all', sort: { key: 'modified', dir: 'desc' } }))).toEqual([
      'Ridge 2',
      'Coast',
      'Péfki loop',
      'Ridge 10',
    ]);
    expect(names(filterAndSort(routes, { query: '', filter: 'all', sort: { key: 'name', dir: 'asc' } }))).toEqual([
      'Coast',
      'Péfki loop',
      'Ridge 2',
      'Ridge 10',
    ]);
  });

  it('puts the most urgent status first', () => {
    const sorted = filterAndSort(routes, { query: '', filter: 'all', sort: { key: 'status', dir: 'desc' } });
    expect(names(sorted).slice(0, 2)).toEqual(['Coast', 'Ridge 2']);
  });

  it('searches ignoring case and accents', () => {
    expect(names(filterAndSort(routes, { query: ' PEFKI ', filter: 'all', sort: { key: 'name', dir: 'asc' } }))).toEqual([
      'Péfki loop',
    ]);
  });

  it('filters by what still needs pushing, including pending POIs', () => {
    const sort = { key: 'name', dir: 'asc' } as const;
    expect(names(filterAndSort(routes, { query: '', filter: 'toPush', sort }))).toEqual(['Ridge 2', 'Ridge 10']);
    expect(names(filterAndSort(routes, { query: '', filter: 'synced', sort }))).toEqual(['Péfki loop']);
    expect(names(filterAndSort(routes, { query: '', filter: 'attention', sort }))).toEqual(['Coast']);
  });
});

describe('activity filter', () => {
  const nameOf = (id: number) => ({ 11: 'Hiking', 22: 'Trail running' })[id];

  it('keeps routes tagged with the activity, among others', () => {
    const sort = { key: 'name', dir: 'asc' } as const;
    expect(names(filterAndSort(routes, { query: '', filter: 'all', sort, activity: 22 }))).toEqual(['Coast']);
    expect(filterAndSort(routes, { query: '', filter: 'all', sort, activity: 11 })).toHaveLength(4);
    expect(filterAndSort(routes, { query: '', filter: 'all', sort, activity: 1 })).toHaveLength(0);
    expect(names(filterAndSort(routes, { query: '', filter: 'attention', sort, activity: 11 }))).toEqual(['Coast']);
  });

  it('offers only the activities in use, A–Z, with route counts', () => {
    expect(activityOptions(routes, nameOf)).toEqual([
      { id: 11, name: 'Hiking', count: 4 },
      { id: 22, name: 'Trail running', count: 1 },
    ]);
    expect(activityOptions([route({ activityIds: [99, 99] })], nameOf)).toEqual([{ id: 99, name: 'Activity 99', count: 1 }]);
  });
});

describe('summarize', () => {
  it('totals the library', () => {
    expect(summarize(routes)).toEqual({ routes: 4, distanceM: 45_000, ascentM: 630, pois: 3, toPush: 2, attention: 1 });
  });
});

describe('sorting controls', () => {
  it('flips the current column and starts others in their natural direction', () => {
    expect(nextSort({ key: 'name', dir: 'asc' }, 'name')).toEqual({ key: 'name', dir: 'desc' });
    expect(nextSort({ key: 'name', dir: 'asc' }, 'distance')).toEqual({ key: 'distance', dir: 'desc' });
    expect(nextSort({ key: 'distance', dir: 'desc' }, 'name')).toEqual({ key: 'name', dir: 'asc' });
  });

  it('only accepts a stored sort it understands', () => {
    expect(isRouteSort({ key: 'ascent', dir: 'asc' })).toBe(true);
    expect(isRouteSort({ key: 'toString', dir: 'asc' })).toBe(false);
    expect(isRouteSort({ key: 'name', dir: 'up' })).toBe(false);
    expect(isRouteSort(null)).toBe(false);
  });
});

describe('formatChanged', () => {
  const now = new Date(2026, 9, 15, 18, 0);
  it('shows the time today, the date otherwise, and the year only when it differs', () => {
    expect(formatChanged(new Date(2026, 9, 15, 9, 5).toISOString(), now)).toMatch(/09.05/);
    expect(formatChanged(new Date(2026, 9, 3).toISOString(), now)).not.toMatch(/2026/);
    expect(formatChanged(new Date(2025, 9, 3).toISOString(), now)).toMatch(/2025/);
  });
});
