import type { RoutingProfile } from '../routes/api';

const CYCLING_ACTIVITY_IDS = new Set([2, 10, 52, 99, 105, 106, 109, 114]);
const FOOT_ACTIVITY_IDS = new Set([0, 1, 11, 22, 24, 59, 60, 65, 70, 83, 103, 115]);

export function preferredRoutingGroup(activityIds: number[]): string | null {
  if (activityIds.some((id) => CYCLING_ACTIVITY_IDS.has(id))) return 'Bike';
  if (activityIds.some((id) => FOOT_ACTIVITY_IDS.has(id))) return 'Foot';
  return null;
}

export function suggestedRoutingProfile(activityIds: number[]): string | null {
  if (activityIds.some((id) => id === 10 || id === 106)) return 'mtb';
  if (activityIds.some((id) => id === 99 || id === 114)) return 'gravel';
  if (activityIds.includes(2)) return 'fastbike';
  if (activityIds.some((id) => CYCLING_ACTIVITY_IDS.has(id))) return 'trekking';
  if (activityIds.some((id) => FOOT_ACTIVITY_IDS.has(id))) return 'hiking-mountain';
  return null;
}

export function prioritizeRoutingProfileGroups(
  groups: [string, RoutingProfile[]][],
  activityIds: number[],
): [string, RoutingProfile[]][] {
  const preferred = preferredRoutingGroup(activityIds);
  if (!preferred) return groups;
  return [...groups].sort(([left], [right]) => {
    if (left === preferred) return right === preferred ? 0 : -1;
    return right === preferred ? 1 : 0;
  });
}
