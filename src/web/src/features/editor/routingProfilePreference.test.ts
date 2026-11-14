import { describe, expect, it } from 'vitest';
import type { RoutingProfile } from '../routes/api';
import {
  preferredRoutingGroup,
  prioritizeRoutingProfileGroups,
  suggestedRoutingProfile,
} from './routingProfilePreference';

const groups: [string, RoutingProfile[]][] = [
  ['Foot', [{ id: 'hiking-mountain', label: 'Hiking (mountain)', group: 'Foot' }]],
  ['Bike', [{ id: 'fastbike', label: 'Road bike', group: 'Bike' }]],
];

describe('routing profile preference', () => {
  it('prioritizes cycling over foot activities when both are selected', () => {
    expect(preferredRoutingGroup([11, 2])).toBe('Bike');
    expect(prioritizeRoutingProfileGroups(groups, [11, 2]).map(([group]) => group)).toEqual(['Bike', 'Foot']);
    expect(suggestedRoutingProfile([11, 2])).toBe('fastbike');
  });

  it('selects a profile that matches the specific cycling sport', () => {
    expect(suggestedRoutingProfile([10])).toBe('mtb');
    expect(suggestedRoutingProfile([99])).toBe('gravel');
    expect(suggestedRoutingProfile([2])).toBe('fastbike');
    expect(suggestedRoutingProfile([105])).toBe('trekking');
  });

  it('prioritizes foot profiles for foot activities and leaves unrelated sports unchanged', () => {
    expect(prioritizeRoutingProfileGroups(groups, [11]).map(([group]) => group)).toEqual(['Foot', 'Bike']);
    expect(prioritizeRoutingProfileGroups(groups, [21])).toEqual(groups);
  });
});
