// Physics tuning. World units are yards; time is seconds.
// Gravity is deliberately stronger than real life so shots feel brisk.

export const DT = 1 / 120;
export const GRAVITY = 22;
export const AIR_DRAG = 0.08;
/** Acceleration applied per unit of wind speed while airborne. */
export const WIND_ACCEL = 0.55;
export const BALL_RADIUS = 0.2;
/** Cup is enlarged relative to the ball for arcade readability. */
export const CUP_RADIUS = 0.42;
/** Max rolling speed that still drops when the ball passes over the cup centre. */
export const CUP_CAPTURE_SPEED = 4.2;
/** Airborne balls landing right on the cup with less horizontal speed than this are holed. */
export const DUNK_MAX_SPEED = 16;
/** Normal speed below which a bounce turns into a roll. */
export const ROLL_THRESHOLD = 2.2;
export const MAX_SIM_TIME = 30;
/** A hole is picked up at this many strokes. */
export const MAX_STROKES = 10;

export const Surface = {
  OOB: 0,
  Rough: 1,
  Fairway: 2,
  Green: 3,
  Sand: 4,
  Water: 5,
  Tee: 6,
} as const;
export type SurfaceId = (typeof Surface)[keyof typeof Surface];

export interface SurfaceParams {
  name: string;
  /** Normal restitution on impact. */
  bounce: number;
  /** Fraction of tangential speed kept on the first impact (before club spin). */
  retain: number;
  /** Constant rolling resistance as a fraction of gravity. */
  rollFriction: number;
  /** Speed-proportional rolling drag (1/s). */
  rollDrag: number;
  /** A resting ball stays put while slope acceleration < staticFriction * g. */
  staticFriction: number;
}

export const SURFACES: SurfaceParams[] = [
  { name: 'Out of bounds', bounce: 0.18, retain: 0.22, rollFriction: 0.9, rollDrag: 0.8, staticFriction: 0.3 },
  { name: 'Rough', bounce: 0.18, retain: 0.22, rollFriction: 0.9, rollDrag: 0.8, staticFriction: 0.3 },
  { name: 'Fairway', bounce: 0.3, retain: 0.32, rollFriction: 0.38, rollDrag: 0.4, staticFriction: 0.16 },
  { name: 'Green', bounce: 0.24, retain: 0.3, rollFriction: 0.065, rollDrag: 0.12, staticFriction: 0.045 },
  { name: 'Sand', bounce: 0.03, retain: 0.05, rollFriction: 2.2, rollDrag: 1.5, staticFriction: 0.6 },
  { name: 'Water', bounce: 0, retain: 0, rollFriction: 3, rollDrag: 3, staticFriction: 1 },
  { name: 'Tee', bounce: 0.3, retain: 0.32, rollFriction: 0.38, rollDrag: 0.4, staticFriction: 0.16 },
];
