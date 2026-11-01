import { BallState, type BallSim, type BallStateId } from '../sim/ball';
import { SURFACES, type SurfaceId } from '../sim/constants';
import type { SavedRound } from './save';

export const REPLAY_POINTS = 160;

export interface PracticeSetup {
  round: SavedRound;
  spin: -1 | 0 | 1;
  itemArmed: boolean;
  tapPower: number;
}

export interface PracticeResult {
  power: number;
  accuracy: string;
  carry: number | null;
  distance: number;
  toPin: number;
  outcome: BallStateId;
  surface: SurfaceId;
  cupX: number;
  cupZ: number;
}

const copy = (s: PracticeSetup): PracticeSetup => JSON.parse(JSON.stringify(s));

/** One committed practice shot. Rewinding never touches the player's saved round. */
export class PracticeReplay {
  readonly path = new Float32Array(REPLAY_POINTS * 3);
  count = 0;
  result: PracticeResult | null = null;
  private saved: PracticeSetup | null = null;
  private steps = 0;
  private stride = 4;
  private power = 0;
  private accuracy = '';

  clear() {
    this.saved = null;
    this.result = null;
    this.count = 0;
  }

  begin(setup: PracticeSetup, power: number, accuracy: string) {
    this.clear();
    this.saved = copy(setup);
    this.steps = 0;
    this.stride = 4;
    this.power = power;
    this.accuracy = accuracy;
  }

  /** Call once at launch and after each fixed physics step, including fast-forward. */
  sample(s: Pick<BallSim, 'x' | 'y' | 'z'>) {
    if (!this.saved || this.result || this.steps++ % this.stride !== 0) return;
    this.append(s);
  }

  private append(s: Pick<BallSim, 'x' | 'y' | 'z'>) {
    if (this.count === REPLAY_POINTS) {
      for (let i = 0; i < REPLAY_POINTS / 2; i++) {
        this.path.copyWithin(i * 3, i * 6, i * 6 + 3);
      }
      this.count = REPLAY_POINTS / 2;
      this.stride *= 2;
    }
    const at = this.count++ * 3;
    this.path[at] = s.x; this.path[at + 1] = s.y; this.path[at + 2] = s.z;
  }

  finish(s: BallSim, cupX: number, cupZ: number) {
    const ball = this.saved?.round.ball;
    if (!ball || this.result) return;
    this.append(s); // Never lose the exact final position when thinning the trace.
    this.result = {
      power: this.power,
      accuracy: this.accuracy,
      carry: this.saved!.round.club === 'putter' || !s.landed ? null : Math.hypot(s.landX - ball.x, s.landZ - ball.z),
      distance: Math.hypot(s.x - ball.x, s.z - ball.z),
      toPin: s.state === BallState.Holed ? 0 : Math.hypot(cupX - s.x, cupZ - s.z),
      outcome: s.state,
      surface: s.ground.surfaceAt(s.x, s.z),
      cupX, cupZ,
    };
  }

  /** A new copy every time: repeating or completing a hole cannot mutate the checkpoint. */
  restore(): PracticeSetup | null {
    return this.result && this.saved ? copy(this.saved) : null;
  }
}

export function practiceOutcome(r: PracticeResult): string {
  return r.outcome === BallState.Holed ? 'In the cup!' : r.outcome === BallState.Water ? 'Water · before drop' : r.outcome === BallState.OOB ? 'Out of bounds' : SURFACES[r.surface].name;
}

/** A north-up map of the recorded shot, with a nearby pin included at the same scale. */
export function practiceMap(replay: PracticeReplay) {
  const r = replay.result!;
  const p = replay.path;
  let minX = p[0], maxX = p[0], minZ = p[2], maxZ = p[2];
  for (let i = 1; i < replay.count; i++) {
    minX = Math.min(minX, p[i * 3]); maxX = Math.max(maxX, p[i * 3]);
    minZ = Math.min(minZ, p[i * 3 + 2]); maxZ = Math.max(maxZ, p[i * 3 + 2]);
  }
  const pinVisible = Math.hypot(r.cupX - p[0], r.cupZ - p[2]) <= Math.max(25, Math.hypot(maxX - minX, maxZ - minZ) * 1.4);
  if (pinVisible) {
    minX = Math.min(minX, r.cupX); maxX = Math.max(maxX, r.cupX);
    minZ = Math.min(minZ, r.cupZ); maxZ = Math.max(maxZ, r.cupZ);
  }
  const scale = Math.min(272 / Math.max(12, maxX - minX), 132 / Math.max(12, maxZ - minZ));
  const project = (x: number, z: number) => ({ x: 160 + (x - (minX + maxX) / 2) * scale, y: 90 + (z - (minZ + maxZ) / 2) * scale });
  const points = Array.from({ length: replay.count }, (_, i) => project(p[i * 3], p[i * 3 + 2]));
  return { points, start: points[0], end: points[points.length - 1], pin: pinVisible ? project(r.cupX, r.cupZ) : null };
}
