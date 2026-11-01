import { BallSim, BallState, type BallStateId } from './ball';
import { BALL_RADIUS, DT, MAX_SIM_TIME, Surface, type SurfaceId } from './constants';
import { modsFor, type ItemId } from './items';
import type { Collider, GroundModel } from './world';

export type ClubId = 'driver' | 'iron' | 'wedge' | 'putter';

export interface Club {
  id: ClubId;
  name: string;
  /** Carry at full power on flat ground with no wind (yards). Putter: flat-green roll. */
  maxCarry: number;
  launchDeg: number;
  /** Multiplier on tangential speed kept at the first bounce (backspin bite). */
  spin: number;
}

export const CLUBS: Club[] = [
  { id: 'driver', name: 'Driver', maxCarry: 160, launchDeg: 13, spin: 1 },
  { id: 'iron', name: 'Iron', maxCarry: 115, launchDeg: 25, spin: 0.55 },
  { id: 'wedge', name: 'Wedge', maxCarry: 65, launchDeg: 45, spin: 0.35 },
  { id: 'putter', name: 'Putter', maxCarry: 30, launchDeg: 0, spin: 1 },
];

export const clubById = (id: ClubId): Club => CLUBS.find((c) => c.id === id)!;

/** Deterministic lie penalty on power (shown in the HUD). */
export function lieMultiplier(club: ClubId, lie: SurfaceId): number {
  if (club === 'putter') return 1;
  if (lie === Surface.Rough) return club === 'wedge' ? 0.92 : 0.85;
  if (lie === Surface.Sand) return club === 'wedge' ? 0.85 : club === 'iron' ? 0.65 : 0.5;
  return 1;
}

class FlatGround implements GroundModel {
  gx = 0;
  gz = 0;
  readonly colliders: Collider[] = [];
  readonly hasCup = false;
  readonly cupX = 0;
  readonly cupZ = 0;
  constructor(public surface: SurfaceId) {}
  heightAt() {
    return 0;
  }
  slopeAt() {
    this.gx = this.gz = 0;
  }
  surfaceAt() {
    return this.surface;
  }
}

const TABLE_STEPS = 20;
/** speed tables: index = round(power * TABLE_STEPS). Built once. */
const tables = new Map<ClubId, Float32Array>();

function flatCarry(club: Club, speed: number, sim: BallSim): number {
  sim.place(0, 0);
  if (club.id === 'putter') {
    sim.launchRoll(0, -speed);
    for (let i = 0; i < 6000 && sim.state === BallState.Roll; i++) sim.step(DT);
    return Math.hypot(sim.x, sim.z);
  }
  const a = (club.launchDeg * Math.PI) / 180;
  sim.stopAtFirstContact = true;
  sim.launchAir(0, Math.sin(a) * speed, -Math.cos(a) * speed, club.spin);
  for (let i = 0; i < 6000 && sim.state === BallState.Air; i++) sim.step(DT);
  return Math.hypot(sim.landX, sim.landZ);
}

/** Calibrate launch speeds so that carry is linear in power: 50% power = half max carry. */
export function calibrate() {
  if (tables.size) return;
  const air = new BallSim(new FlatGround(Surface.Fairway));
  const roll = new BallSim(new FlatGround(Surface.Green));
  for (const club of CLUBS) {
    const sim = club.id === 'putter' ? roll : air;
    const t = new Float32Array(TABLE_STEPS + 1);
    for (let i = 1; i <= TABLE_STEPS; i++) {
      const target = (club.maxCarry * i) / TABLE_STEPS;
      let lo = 0;
      let hi = 250;
      for (let k = 0; k < 30; k++) {
        const m = (lo + hi) / 2;
        if (flatCarry(club, m, sim) < target) lo = m;
        else hi = m;
      }
      t[i] = (lo + hi) / 2;
    }
    tables.set(club.id, t);
  }
}

export function speedFor(club: ClubId, power: number): number {
  calibrate();
  const t = tables.get(club)!;
  // Above 100% (perfect strikes) extrapolate: carry grows roughly with speed squared.
  if (power > 1) return t[TABLE_STEPS] * Math.sqrt(power);
  const p = Math.max(0, Math.min(1, power)) * TABLE_STEPS;
  const i = Math.min(TABLE_STEPS - 1, Math.floor(p));
  const f = p - i;
  return t[i] * (1 - f) + t[i + 1] * f;
}

/** Direction for an aim yaw: 0 = world -z (forward), positive = to the right (+x). */
export function aimDir(yaw: number): [number, number] {
  return [Math.sin(yaw), -Math.cos(yaw)];
}

export function yawTo(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return Math.atan2(toX - fromX, -(toZ - fromZ));
}

export interface ShotParams {
  club: ClubId;
  power: number;
  yaw: number;
  lie: SurfaceId;
  windX: number;
  windZ: number;
  /** -1 backspin, 0 none, 1 topspin. */
  spin?: -1 | 0 | 1;
  item?: ItemId | null;
}

export const SPIN_NAMES = { '-1': 'Backspin', '0': 'No spin', '1': 'Topspin' } as const;

/** Launch a sim from rest. Identical for real shots and predictions. */
export function launch(sim: BallSim, p: ShotParams) {
  const club = clubById(p.club);
  const eff = Math.max(0, Math.min(1.1, p.power)) * lieMultiplier(p.club, p.lie);
  const speed = speedFor(p.club, eff);
  const [dx, dz] = aimDir(p.yaw);
  sim.windX = p.windX;
  sim.windZ = p.windZ;
  sim.mods = modsFor(p.item);
  const spin = p.club === 'putter' ? 0 : p.spin ?? 0;
  // Topspin keeps more speed on landing (rolls out); backspin bites and checks back.
  const spinMul = spin > 0 ? 1.9 : spin < 0 ? 0.3 : 1;
  sim.checkBack = spin < 0 ? 0.12 : 0;
  if (p.club === 'putter') {
    sim.launchRoll(dx * speed, dz * speed);
  } else {
    const a = ((club.launchDeg + (spin < 0 ? 3 : spin > 0 ? -2 : 0)) * Math.PI) / 180;
    sim.launchAir(dx * Math.cos(a) * speed, Math.sin(a) * speed, dz * Math.cos(a) * speed, club.spin * spinMul);
  }
}

export const MAX_PATH_POINTS = 64;

export interface Prediction {
  valid: boolean;
  x: number;
  y: number;
  z: number;
  carry: number;
  surface: SurfaceId;
  hitObstacle: boolean;
  kind: 'carry' | 'roll';
  /** Terminal rolling state; airborne predictions still stop at first contact. */
  outcome: BallStateId;
  /** Signed sideways break relative to the aim line (right positive), in yards. */
  breakYards: number;
  /** Height change over the predicted roll, in yards. */
  rise: number;
  /** Flight or rolling path samples (xyz triplets). */
  path: Float32Array;
  count: number;
}

export function makePrediction(): Prediction {
  return {
    valid: false,
    x: 0,
    y: 0,
    z: 0,
    carry: 0,
    surface: Surface.Rough,
    hitObstacle: false,
    kind: 'carry',
    outcome: BallState.Rest,
    breakYards: 0,
    rise: 0,
    path: new Float32Array(MAX_PATH_POINTS * 3),
    count: 0,
  };
}

/**
 * Predicts the first landing point using the real simulation.
 * Putts run to rest/cup/hazard using the same slopes, friction and items as play.
 */
export function predict(sim: BallSim, fromX: number, fromZ: number, p: ShotParams, out: Prediction): Prediction {
  sim.listener = null;
  sim.place(fromX, fromZ);
  out.kind = p.club === 'putter' ? 'roll' : 'carry';
  out.breakYards = out.rise = 0;
  out.outcome = BallState.Rest;
  if (p.club === 'putter') return predictRoll(sim, fromX, fromZ, p, out);
  sim.stopAtFirstContact = true;
  launch(sim, p);
  // Sample roughly evenly in time.
  const maxSteps = 2400;
  let n = 0;
  out.path[0] = sim.x;
  out.path[1] = sim.y;
  out.path[2] = sim.z;
  n = 1;
  for (let i = 0; i < maxSteps && sim.state === BallState.Air; i++) {
    sim.step(DT);
    if (i % 4 === 3 && n < MAX_PATH_POINTS - 1) {
      out.path[n * 3] = sim.x;
      out.path[n * 3 + 1] = sim.y;
      out.path[n * 3 + 2] = sim.z;
      n++;
    }
  }
  out.path[n * 3] = sim.x;
  out.path[n * 3 + 1] = sim.y;
  out.path[n * 3 + 2] = sim.z;
  out.count = n + 1;
  sim.stopAtFirstContact = false;
  out.valid = sim.landed;
  out.x = sim.landX;
  out.y = sim.landY;
  out.z = sim.landZ;
  out.surface = sim.landSurface;
  out.hitObstacle = sim.hitObstacle;
  out.carry = Math.hypot(sim.landX - fromX, sim.landZ - fromZ);
  return out;
}

/** Bounded, allocation-free roll sampling; compact the history if a slow putt runs long. */
function predictRoll(sim: BallSim, fromX: number, fromZ: number, p: ShotParams, out: Prediction): Prediction {
  sim.stopAtFirstContact = false;
  launch(sim, p);
  const startY = sim.ground.heightAt(fromX, fromZ);
  let count = 1;
  let stride = 4;
  let length = 0;
  out.path[0] = fromX;
  out.path[1] = startY + BALL_RADIUS;
  out.path[2] = fromZ;
  const maxSteps = Math.ceil(MAX_SIM_TIME / DT) + 2;
  for (let step = 1; step <= maxSteps && sim.moving; step++) {
    const x = sim.x, z = sim.z;
    sim.step(DT);
    length += Math.hypot(sim.x - x, sim.z - z);
    if (step % stride !== 0 || !sim.moving) continue;
    if (count === MAX_PATH_POINTS - 1) {
      let kept = 0;
      for (let i = 0; i < count; i += 2) {
        out.path[kept * 3] = out.path[i * 3];
        out.path[kept * 3 + 1] = out.path[i * 3 + 1];
        out.path[kept * 3 + 2] = out.path[i * 3 + 2];
        kept++;
      }
      count = kept;
      stride *= 2;
      if (step % stride !== 0) continue;
    }
    out.path[count * 3] = sim.x;
    out.path[count * 3 + 1] = sim.y;
    out.path[count * 3 + 2] = sim.z;
    count++;
  }
  // Keep the final dot on the surface, even when the simulated ball drops into the cup.
  const endY = sim.ground.heightAt(sim.x, sim.z) + BALL_RADIUS;
  out.path[count * 3] = sim.x;
  out.path[count * 3 + 1] = endY;
  out.path[count * 3 + 2] = sim.z;
  out.count = count + 1;
  out.valid = !sim.moving;
  out.x = sim.x;
  out.y = endY;
  out.z = sim.z;
  out.carry = length;
  out.surface = sim.ground.surfaceAt(sim.x, sim.z);
  out.hitObstacle = sim.hitObstacle;
  out.outcome = sim.state;
  out.breakYards = (sim.x - fromX) * Math.cos(p.yaw) + (sim.z - fromZ) * Math.sin(p.yaw);
  out.rise = endY - BALL_RADIUS - startY;
  return out;
}

/** Labels describe the estimate; timing and aim remain the player's decisions. */
export function puttingRead(pred: Prediction): { slope: string; break: string; stop: string; danger: boolean } {
  const grade = pred.carry > 0.1 ? pred.rise / pred.carry * 100 : 0;
  const slope = Math.abs(grade) < 0.5 ? 'Mostly level' : `${grade > 0 ? '↑ Uphill' : '↓ Downhill'} ${Math.abs(grade).toFixed(1)}%`;
  const bend = Math.abs(pred.breakYards);
  const breakText = bend < 0.15 ? 'Nearly straight' : `${pred.breakYards < 0 ? '← Left' : 'Right →'} ${bend.toFixed(1)}y`;
  const danger = pred.outcome === BallState.Water || pred.outcome === BallState.OOB;
  const stop = pred.outcome === BallState.Holed ? 'Cup on this line' : pred.outcome === BallState.Water ? 'Water on this line' : pred.outcome === BallState.OOB ? 'Out of bounds' : `Est. ${pred.carry.toFixed(1)}y roll`;
  return { slope, break: breakText, stop, danger };
}
