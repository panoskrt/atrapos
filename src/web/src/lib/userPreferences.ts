export type DefaultMapId = 'osm' | 'topo' | 'cyclosm';
export type UnitSystem = 'metric' | 'imperial';
export type ThemePreference = 'dark' | 'light';
export type DesignId = 'classic' | 'alpine' | 'soft';

export interface UserSettings {
  defaultMap: DefaultMapId;
  units: UnitSystem;
  theme: ThemePreference;
  design: DesignId;
}

const defaults: UserSettings = { defaultMap: 'topo', units: 'metric', theme: 'dark', design: 'classic' };
let activeSettings = defaults;

export function applyUserSettings(settings: UserSettings) {
  activeSettings = settings;
}

export function currentUserSettings(): UserSettings {
  return activeSettings;
}
