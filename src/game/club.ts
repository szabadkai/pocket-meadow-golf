// Club progression: hole stars, errand tracking, restoration projects and wardrobe unlocks.
// Pure logic (no DOM, no Three.js) so it can be unit tested.
import type { ErrandDef, ProjectId } from '../course/types';
import { SimEvent, type SimEventId } from '../sim/ball';
import { Surface, type SurfaceId } from '../sim/constants';
import { toWorld } from '../sim/shapes';
import type { ClubId } from '../sim/shot';
import type { Collider } from '../sim/world';

export const STAR_PAR = 1;
export const STAR_BIRDIE = 2;
export const STAR_ERRAND = 4;

export function holeStars(strokes: number, par: number, errandDone: boolean): number {
  return (strokes <= par ? STAR_PAR : 0) | (strokes < par ? STAR_BIRDIE : 0) | (errandDone ? STAR_ERRAND : 0);
}

export const countBits = (m: number) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1);
export const totalStars = (stars: number[]) => stars.reduce((s, m) => s + countBits(m ?? 0), 0);
export const errandsDone = (stars: number[]) => stars.filter((m) => (m ?? 0) & STAR_ERRAND).length;

export interface ErrandState {
  done: boolean;
  failed: boolean;
  shots: number;
  putts: number;
}

/** Watches one hole's play and decides whether the animal's errand was completed. */
export class ErrandTracker {
  s: ErrandState = { done: false, failed: false, shots: 0, putts: 0 };
  private target: [number, number] | null;

  constructor(readonly def: ErrandDef) {
    this.target = def.kind === 'restNear' ? toWorld(def.at) : null;
  }

  restore(s: ErrandState | undefined) {
    if (s) this.s = { ...s };
  }

  /** Returns true the moment the errand completes. */
  private complete(): boolean {
    if (this.s.done || this.s.failed) return false;
    this.s.done = true;
    return true;
  }

  shotStart(club: ClubId, lie: SurfaceId) {
    this.s.shots++;
    if (club === 'putter' && lie === Surface.Green) this.s.putts++;
  }

  event(e: SimEventId, surface: SurfaceId, hit: Collider | null): boolean {
    const d = this.def;
    if (d.kind === 'hit' && e === SimEvent.Collide && hit) {
      if (hit.tag === d.tag || (d.tag === 'windmill' && hit.tag === 'sails')) return this.complete();
    }
    if (d.kind === 'skip' && e === SimEvent.Skip) return this.complete();
    if (d.kind === 'noSand' && (e === SimEvent.Land || e === SimEvent.Bounce || e === SimEvent.Rest) && surface === Surface.Sand) this.s.failed = true;
    return false;
  }

  rest(x: number, z: number, surface: SurfaceId): boolean {
    const d = this.def;
    if (d.kind === 'noSand' && surface === Surface.Sand) this.s.failed = true;
    if (d.kind === 'restNear' && this.target && Math.hypot(x - this.target[0], z - this.target[1]) <= d.r) return this.complete();
    if (d.kind === 'greenFromTee' && this.s.shots === 1 && surface === Surface.Green) return this.complete();
    return false;
  }

  holed(): boolean {
    const d = this.def;
    if (d.kind === 'greenFromTee' && this.s.shots === 1) return this.complete();
    if (d.kind === 'noSand') return this.complete();
    if (d.kind === 'onePutt' && this.s.putts <= 1) return this.complete();
    return false;
  }
}

export interface Project {
  id: ProjectId;
  name: string;
  effect: string;
  hint: string;
  unlocked(stars: number[]): boolean;
}

const errandOn = (stars: number[], hole: number) => !!((stars[hole] ?? 0) & STAR_ERRAND);

export const PROJECTS: Project[] = [
  {
    id: 'bridge',
    name: 'Mend the stone bridge',
    effect: 'Mows the picnic shortcut on hole 8.',
    hint: 'Help the ducks on hole 2.',
    unlocked: (s) => errandOn(s, 1),
  },
  {
    id: 'windmill',
    name: 'Get the windmill turning',
    effect: 'Its sails swat balls about on hole 5.',
    hint: 'Help the sheep on hole 5.',
    unlocked: (s) => errandOn(s, 4),
  },
  {
    id: 'flowers',
    name: 'Plant the flower beds',
    effect: 'Big blooms all over the course.',
    hint: 'Finish any 3 errands.',
    unlocked: (s) => errandsDone(s) >= 3,
  },
  {
    id: 'lanterns',
    name: 'Light the clubhouse lanterns',
    effect: 'A glowing finish on hole 9.',
    hint: 'Finish any 6 errands.',
    unlocked: (s) => errandsDone(s) >= 6,
  },
  {
    id: 'nest',
    name: 'Build Pip a cosy nest',
    effect: 'Pip can rescue two balls a round.',
    hint: 'Finish all 9 errands.',
    unlocked: (s) => errandsDone(s) >= 9,
  },
];

export function restoredSet(stars: number[]): Set<ProjectId> {
  return new Set(PROJECTS.filter((p) => p.unlocked(stars)).map((p) => p.id));
}

export interface Cosmetic {
  id: string;
  name: string;
  color: number;
  need: number;
}

export const CAPS: Cosmetic[] = [
  { id: 'butter', name: 'Butter', color: 0xffd86b, need: 0 },
  { id: 'coral', name: 'Coral', color: 0xff8a73, need: 3 },
  { id: 'mint', name: 'Mint', color: 0x9ee6b8, need: 6 },
  { id: 'sky', name: 'Sky', color: 0x8fd0f5, need: 9 },
  { id: 'lilac', name: 'Lilac', color: 0xc3a8ff, need: 13 },
  { id: 'berry', name: 'Berry', color: 0xe8577a, need: 17 },
  { id: 'gold', name: 'Gold', color: 0xffc23a, need: 22 },
];

export const SCARVES: Cosmetic[] = [
  { id: 'coral', name: 'Coral', color: 0xff8a73, need: 0 },
  { id: 'butter', name: 'Butter', color: 0xffd86b, need: 4 },
  { id: 'mint', name: 'Mint', color: 0x9ee6b8, need: 8 },
  { id: 'lilac', name: 'Lilac', color: 0xc3a8ff, need: 12 },
  { id: 'cream', name: 'Checks', color: 0xfff4dc, need: 16 },
  { id: 'gold', name: 'Gold', color: 0xffc23a, need: 27 },
];
