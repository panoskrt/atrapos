export type DefaultMapId = 'osm' | 'topo' | 'cyclosm';
export type UnitSystem = 'metric' | 'imperial';
export type ThemePreference = 'dark' | 'light';
export type DesignId = 'classic' | 'alpine' | 'soft';
export type MenuPositionId = 'left' | 'top';

export const DEFAULT_FAVORITE_ACTIVITY_IDS = [11, 22, 1, 70, 10, 2, 0, 99, 31, 3];

export interface UserSettings {
  defaultMap: DefaultMapId;
  units: UnitSystem;
  theme: ThemePreference;
  design: DesignId;
  favoriteActivityIds: number[];
  defaultRoutingProfile: string | null;
  /** Where the main navigation sits on wider screens (left when unset). Phones always use the bottom tab bar. */
  menuPosition?: MenuPositionId;
}

const defaults: UserSettings = {
  defaultMap: 'topo',
  units: 'metric',
  theme: 'dark',
  design: 'classic',
  favoriteActivityIds: DEFAULT_FAVORITE_ACTIVITY_IDS,
  defaultRoutingProfile: null,
  menuPosition: 'left',
};
let activeSettings = defaults;

export function applyUserSettings(settings: UserSettings) {
  activeSettings = settings;
}

export function currentUserSettings(): UserSettings {
  return activeSettings;
}
