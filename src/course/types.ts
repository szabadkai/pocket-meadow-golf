import type { ShapeDef, V2 } from '../sim/shapes';

export type TreeKind = 'round' | 'apple' | 'tall' | 'bush';
export type AnimalKind = 'bunny' | 'sheep' | 'duck' | 'frog' | 'hedgehog';
export type PropKind =
  | 'windmill'
  | 'bridge'
  | 'umbrella'
  | 'blanket'
  | 'bench'
  | 'clubhouse'
  | 'flowers'
  | 'sign'
  | 'lilypads'
  | 'basket';

export type ProjectId = 'bridge' | 'windmill' | 'flowers' | 'lanterns' | 'nest';

/** An animal's request on a hole; completing it earns the hole's third star. */
export type ErrandDef = { who: AnimalKind | 'pip'; text: string } & (
  | { kind: 'restNear'; at: V2; r: number }
  | { kind: 'greenFromTee' }
  | { kind: 'hit'; tag: 'apple' | 'windmill' | 'sheep' }
  | { kind: 'noSand' }
  | { kind: 'skip' }
  | { kind: 'onePutt' }
);

export interface PropDef {
  type: PropKind;
  at: V2;
  /** Rotation in degrees (design space, 0 = facing the tee). */
  rot?: number;
  s?: number;
  /** Bridge span length, flower count, etc. */
  n?: number;
}

/**
 * One hole, in design coordinates: u = right, v = forward from the tee (yards).
 * Everything here is data; CourseWorld compiles it for physics and the renderer decorates it.
 */
export interface HoleDef {
  number: number;
  name: string;
  par: number;
  blurb: string;
  tee: V2;
  pin: V2;
  fairways: ShapeDef[];
  green: ShapeDef;
  /** Green gradient (rise per yard) along u and v. */
  greenSlope: V2;
  greenRaise?: number;
  /** How far the green flattening blends into surrounding terrain. */
  greenBlend?: number;
  bunkers?: ShapeDef[];
  water?: ShapeDef[];
  /** Dry land inside water shapes (e.g. an island green's apron). */
  islands?: ShapeDef[];
  /** Decorative cart paths (play as rough). */
  paths?: ShapeDef[];
  hills?: { at: V2; r: number; h: number }[];
  /** Outside this shape is out of bounds. */
  playArea: ShapeDef;
  /** Feature trees that shape play (all trees collide). */
  trees?: { at: V2; kind: TreeKind; s?: number }[];
  /** Random border/rough trees: count inside play area and outside. */
  scatter?: { inside: number; outside: number; kinds?: TreeKind[] };
  /** Keep scatter away from these segments (sightlines), in addition to tee→aim→pin. */
  clearLines?: V2[][];
  props?: PropDef[];
  animals?: { kind: AnimalKind; at: V2; rot?: number }[];
  /** Route hints for default aiming on doglegs. */
  aimPoints?: V2[];
  /** Designated water drop zones (used instead of back-on-the-line relief). */
  dropZones?: V2[];
  /** Wind range in mph. */
  wind: V2;
  sky?: 'day' | 'sunset';
  biscuits?: boolean;
  errand: ErrandDef;
  /** Fairways that only exist once a club project is restored. */
  bonusFairways?: { shape: ShapeDef; requires: ProjectId }[];
  /** Basket item always offered on this hole (e.g. the one its errand needs). */
  basketGuarantee?: 'jam' | 'balloon' | 'acorn' | 'bee' | 'snail';
}
