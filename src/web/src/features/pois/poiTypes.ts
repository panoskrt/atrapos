/** Suunto POI types (POI API PoiType) with a category glyph for our UI. The watch draws its own icon per type;
 *  these glyphs only need to say "what kind of place". 16×16 stroke paths. */

const glyphs = {
  pin: 'M8 15s-5-4.5-5-8.5a5 5 0 0 1 10 0C13 10.5 8 15 8 15zM8 8a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  house: 'M2 8l6-5 6 5M4 7v6h8V7',
  car: 'M2 11V8l2-4h8l2 4v3zM2 11v2M14 11v2M4.5 9h.01M11.5 9h.01',
  parking: 'M5 13V3h3.5a3 3 0 0 1 0 6H5',
  tent: 'M2 13h12M3 13L8 4l5 9M8 9l-2 4M8 9l2 4',
  food: 'M4 2v5a2 2 0 0 0 4 0V2M6 7v7M11 2c-1.5 1-2 3-2 5h2v7',
  cafe: 'M2 6h9v3a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4zM11 7h1.5a1.5 1.5 0 0 1 0 3H11M5 2v2M8 2v2',
  bed: 'M1 12V4M1 9h14v3M15 9V7a2 2 0 0 0-2-2H7v4M4 7.5h.01',
  drop: 'M8 2C8 2 3.5 7 3.5 10a4.5 4.5 0 0 0 9 0C12.5 7 8 2 8 2z',
  waves: 'M1 6c2-2 3 2 5 0s3 2 5 0 3 2 4 0M1 11c2-2 3 2 5 0s3 2 5 0 3 2 4 0',
  mountain: 'M1 13l5-8 3 4 2-3 4 7z',
  tree: 'M8 1l5 7H3zM8 5l5 7H3zM8 12v3',
  signpost: 'M8 15V1M3 3h9l2 2-2 2H3zM13 9H4l-2 2 2 2h9',
  eye: 'M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5zM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  flag: 'M3 15V2M3 2h9l-2 3 2 3H3',
  finish: 'M3 15V2M3 2h10v6H3M3 5h10M8 2v6',
  box: 'M2 5l6-3 6 3v6l-6 3-6-3zM2 5l6 3 6-3M8 8v6',
  cave: 'M1 14c0-6 3-11 7-11s7 5 7 11zM5 14c0-3 1.5-5 3-5s3 2 3 5',
  cross: 'M6 2h4v4h4v4h-4v4H6v-4H2V6h4z',
  info: 'M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14zM8 7v5M8 4.5h.01',
  danger: 'M8 1.5l7 13H1zM8 6v4M8 12.5h.01',
  target: 'M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14zM8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8 8h.01',
  fish: 'M1 8c3-4 8-4 11 0-3 4-8 4-11 0zM12 8l3-3v6zM5 7.5h.01',
  bird: 'M1 6c3 0 5 2 6 5 1-4 4-7 8-7-3 1-5 4-5 7H7',
  anchor: 'M8 4v11M5 7h6M2 10a6 6 0 0 0 12 0M8 4a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  mushroom: 'M2 8a6 6 0 0 1 12 0zM6 8v5a2 2 0 0 0 4 0V8',
  flame: 'M8 15c3 0 5-2 5-5 0-4-5-5-4-9-3 1-6 5-6 9 0 3 2 5 5 5zM8 15c-1 0-2-1-2-2.5S8 10 8 10s2 1 2 2.5S9 15 8 15z',
} as const;

type Glyph = keyof typeof glyphs;

const glyphByType: Record<number, Glyph> = {
  [-1]: 'pin', 0: 'house', 1: 'house', 2: 'car', 3: 'parking', 4: 'tent', 5: 'tent', 6: 'food', 7: 'food', 8: 'cafe',
  9: 'bed', 10: 'bed', 11: 'bed', 12: 'drop', 13: 'waves', 14: 'waves', 15: 'waves', 16: 'mountain', 17: 'mountain',
  18: 'mountain', 19: 'mountain', 20: 'tree', 21: 'signpost', 22: 'eye', 23: 'flag', 24: 'finish', 25: 'box', 26: 'pin',
  27: 'signpost', 28: 'signpost', 29: 'mountain', 30: 'tree', 31: 'cave', 32: 'cross', 33: 'info', 34: 'mountain',
  35: 'waves', 36: 'fish', 37: 'bed', 38: 'target', 39: 'target', 40: 'target', 41: 'target', 42: 'target', 43: 'target',
  44: 'target', 45: 'bird', 46: 'target', 47: 'fish', 64: 'fish', 65: 'waves', 66: 'waves', 67: 'fish', 68: 'waves',
  69: 'waves', 70: 'anchor', 71: 'waves', 72: 'danger', 73: 'danger', 74: 'cross', 75: 'drop', 76: 'mushroom', 77: 'flame',
};

export const POI_TYPE_DEFAULT = 26;

export function poiGlyph(type: number): string {
  return glyphs[glyphByType[type] ?? 'pin'];
}

/** "FishingSpot" → "Fishing spot", "POI" stays "POI". */
export function humanizeType(name: string): string {
  if (name === 'POI') return 'Generic POI';
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()).replace(/ (\w)/g, (_, c: string) => ` ${c.toLowerCase()}`);
}

/** Shown first in the type picker; the rest follow alphabetically. */
export const COMMON_POI_TYPES = [26, 12, 75, 34, 4, 3, 22, 33, 73, 74, 6, 8, 9, 35, 32];
