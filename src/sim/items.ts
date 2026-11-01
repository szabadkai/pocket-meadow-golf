// Picnic basket items: one-shot rule benders offered before each hole.
import { mulberry32 } from './world';

export type ItemId = 'jam' | 'balloon' | 'acorn' | 'bee' | 'snail';

export interface ItemDef {
  id: ItemId;
  name: string;
  emoji: string;
  desc: string;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  jam: { id: 'jam', name: 'Jam sandwich', emoji: '🥪', desc: 'Sticks right where it first lands.' },
  balloon: { id: 'balloon', name: 'Balloon', emoji: '🎈', desc: 'Floats far and drifts with the wind.' },
  acorn: { id: 'acorn', name: 'Acorn', emoji: '🌰', desc: 'Extra bouncy. Skips across water!' },
  bee: { id: 'bee', name: 'Bumblebee', emoji: '🐝', desc: 'Steer it in the air: drag on the course.' },
  snail: { id: 'snail', name: 'Snail', emoji: '🐌', desc: 'Rolls dead straight, ignoring slopes.' },
};

export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];

/** Physical modifiers a shot carries through the simulation. */
export interface ShotMods {
  gravityMul: number;
  windMul: number;
  bounceMul: number;
  sticky: boolean;
  skip: boolean;
  ignoreSlope: boolean;
  steer: boolean;
}

export const NO_MODS: Readonly<ShotMods> = {
  gravityMul: 1,
  windMul: 1,
  bounceMul: 1,
  sticky: false,
  skip: false,
  ignoreSlope: false,
  steer: false,
};

export function modsFor(item: ItemId | null | undefined): ShotMods {
  const m = { ...NO_MODS };
  switch (item) {
    case 'jam':
      m.sticky = true;
      break;
    case 'balloon':
      m.gravityMul = 0.7;
      m.windMul = 3;
      break;
    case 'acorn':
      m.bounceMul = 1.7;
      m.skip = true;
      break;
    case 'bee':
      m.steer = true;
      break;
    case 'snail':
      m.ignoreSlope = true;
      break;
  }
  return m;
}

/** Two distinct items for a hole, deterministic per round; `guarantee` is always one of them. */
export function offerItems(seed: number, hole: number, guarantee?: ItemId, exclude?: ItemId | null): [ItemId, ItemId] {
  const rng = mulberry32(seed * 31 + hole * 977 + 5);
  // Don't offer the snack you're already carrying (unless it's the guaranteed one).
  const pool = ITEM_IDS.filter((i) => i !== exclude || i === guarantee);
  const a = guarantee ?? pool.splice(Math.floor(rng() * pool.length), 1)[0];
  const rest = pool.filter((i) => i !== a);
  const b = rest[Math.floor(rng() * rest.length)];
  return rng() < 0.5 ? [a, b] : [b, a];
}

/** Hole index whose errand needs a skipping acorn (Duck Crossing). */
export const ACORN_HOLE = 6;

/**
 * The picnic basket comes out twice a round: once on holes 1–4 and once on holes 5–9.
 * Deterministic per round seed.
 */
export function basketHoles(seed: number): [number, number] {
  const rng = mulberry32(seed * 7 + 99);
  return [Math.floor(rng() * 4), 4 + Math.floor(rng() * 5)];
}

/**
 * The last basket at or before the duck pond always includes an acorn, so the ducks'
 * errand is always possible if you save it. Snacks carry over between holes.
 */
export function basketGuaranteeFor(holes: readonly number[], hole: number): ItemId | undefined {
  const before = holes.filter((h) => h <= ACORN_HOLE);
  return before.length && hole === Math.max(...before) ? 'acorn' : undefined;
}
