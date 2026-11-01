import {
  AIR_DRAG,
  BALL_RADIUS,
  CUP_CAPTURE_SPEED,
  CUP_RADIUS,
  DUNK_MAX_SPEED,
  GRAVITY,
  MAX_SIM_TIME,
  ROLL_THRESHOLD,
  SURFACES,
  Surface,
  WIND_ACCEL,
  type SurfaceId,
} from './constants';
import type { GroundModel } from './world';

export const BallState = { Rest: 0, Air: 1, Roll: 2, Holed: 3, Water: 4, OOB: 5 } as const;
export type BallStateId = (typeof BallState)[keyof typeof BallState];

export const SimEvent = {
  Land: 0,
  Bounce: 1,
  Collide: 2,
  Water: 3,
  OOB: 4,
  Cup: 5,
  Lip: 6,
  Rest: 7,
} as const;
export type SimEventId = (typeof SimEvent)[keyof typeof SimEvent];

export type SimListener = (type: SimEventId, sim: BallSim, surface: SurfaceId, speed: number) => void;

/**
 * Fixed-step ball simulation shared by real shots and aim predictions.
 * No allocations in step().
 */
export class BallSim {
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  state: BallStateId = BallState.Rest;
  time = 0;
  bounces = 0;
  /** Club spin factor applied to the first impact. */
  spin = 1;
  windX = 0;
  windZ = 0;
  /** Last ground-track point not over water (for hazard relief). */
  lastDryX = 0;
  lastDryZ = 0;
  landed = false;
  landX = 0;
  landY = 0;
  landZ = 0;
  landSurface: SurfaceId = Surface.Rough;
  hitObstacle = false;
  /** Prediction mode: stop at the first ground contact. */
  stopAtFirstContact = false;
  listener: SimListener | null = null;
  private inCupZone = false;

  constructor(public ground: GroundModel) {}

  place(x: number, z: number) {
    this.x = x;
    this.z = z;
    this.y = this.ground.heightAt(x, z) + BALL_RADIUS;
    this.vx = this.vy = this.vz = 0;
    this.state = BallState.Rest;
    this.lastDryX = x;
    this.lastDryZ = z;
  }

  private resetFlight() {
    this.time = 0;
    this.bounces = 0;
    this.landed = false;
    this.hitObstacle = false;
    this.inCupZone = false;
    this.lastDryX = this.x;
    this.lastDryZ = this.z;
  }

  launchAir(vx: number, vy: number, vz: number, spin: number) {
    this.resetFlight();
    this.vx = vx;
    this.vy = vy;
    this.vz = vz;
    this.spin = spin;
    this.state = BallState.Air;
  }

  launchRoll(vx: number, vz: number) {
    this.resetFlight();
    this.vx = vx;
    this.vy = 0;
    this.vz = vz;
    this.spin = 1;
    this.landed = true;
    this.landX = this.x;
    this.landY = this.y;
    this.landZ = this.z;
    this.state = BallState.Roll;
  }

  get moving(): boolean {
    return this.state === BallState.Air || this.state === BallState.Roll;
  }

  step(dt: number) {
    if (this.state === BallState.Air) this.stepAir(dt);
    else if (this.state === BallState.Roll) this.stepRoll(dt);
    else return;
    this.time += dt;
    if (this.time > MAX_SIM_TIME && this.moving) {
      this.vx = this.vy = this.vz = 0;
      this.y = this.ground.heightAt(this.x, this.z) + BALL_RADIUS;
      this.finish(BallState.Rest, SimEvent.Rest);
    }
  }

  private emit(type: SimEventId, surface: SurfaceId, speed: number) {
    if (this.listener) this.listener(type, this, surface, speed);
  }

  private finish(state: BallStateId, ev: SimEventId) {
    this.state = state;
    const s = this.ground.surfaceAt(this.x, this.z);
    this.emit(ev, s, 0);
  }

  private stepAir(dt: number) {
    const g = this.ground;
    this.vx += (-AIR_DRAG * this.vx + WIND_ACCEL * this.windX) * dt;
    this.vz += (-AIR_DRAG * this.vz + WIND_ACCEL * this.windZ) * dt;
    this.vy += (-GRAVITY - AIR_DRAG * this.vy) * dt;
    let nx = this.x + this.vx * dt;
    let ny = this.y + this.vy * dt;
    let nz = this.z + this.vz * dt;

    // Obstacles (tree canopies, trunks, towers).
    const cols = g.colliders;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (c.kind === 0) {
        const dx = nx - c.x;
        const dy = ny - c.y;
        const dz = nz - c.z;
        const rr = c.r + BALL_RADIUS;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < rr * rr) {
          const d = Math.sqrt(d2) || 1;
          const nX = dx / d;
          const nY = dy / d;
          const nZ = dz / d;
          const vn = this.vx * nX + this.vy * nY + this.vz * nZ;
          if (vn < 0) {
            this.vx -= 1.3 * vn * nX;
            this.vy -= 1.3 * vn * nY;
            this.vz -= 1.3 * vn * nZ;
          }
          this.vx *= c.damp;
          this.vy *= c.damp;
          this.vz *= c.damp;
          nx = c.x + nX * rr;
          ny = c.y + nY * rr;
          nz = c.z + nZ * rr;
          this.hitObstacle = true;
          this.emit(SimEvent.Collide, Surface.Rough, Math.abs(vn));
        }
      } else if (ny > c.y0 && ny < c.y1) {
        const dx = nx - c.x;
        const dz = nz - c.z;
        const rr = c.r + BALL_RADIUS;
        const d2 = dx * dx + dz * dz;
        if (d2 < rr * rr) {
          const d = Math.sqrt(d2) || 1;
          const nX = dx / d;
          const nZ = dz / d;
          const vn = this.vx * nX + this.vz * nZ;
          if (vn < 0) {
            this.vx -= 1.4 * vn * nX;
            this.vz -= 1.4 * vn * nZ;
          }
          this.vx *= c.damp;
          this.vz *= c.damp;
          nx = c.x + nX * rr;
          nz = c.z + nZ * rr;
          this.hitObstacle = true;
          this.emit(SimEvent.Collide, Surface.Rough, Math.abs(vn));
        }
      }
    }

    // Ground: sample along the step so fast balls cannot tunnel through ridges.
    const len = Math.hypot(nx - this.x, nz - this.z);
    const samples = Math.max(1, Math.ceil(len / 0.5));
    let hitT = -1;
    let prevT = 0;
    for (let s = 1; s <= samples; s++) {
      const t = s / samples;
      const sx = this.x + (nx - this.x) * t;
      const sy = this.y + (ny - this.y) * t;
      const sz = this.z + (nz - this.z) * t;
      if (sy <= g.heightAt(sx, sz) + BALL_RADIUS) {
        hitT = t;
        break;
      }
      prevT = t;
    }
    if (hitT < 0) {
      this.x = nx;
      this.y = ny;
      this.z = nz;
      if (!this.inWaterTrack()) {
        this.lastDryX = nx;
        this.lastDryZ = nz;
      }
      return;
    }
    // Refine the contact point by bisection.
    let lo = prevT;
    let hi = hitT;
    for (let k = 0; k < 8; k++) {
      const m = (lo + hi) * 0.5;
      const sx = this.x + (nx - this.x) * m;
      const sy = this.y + (ny - this.y) * m;
      const sz = this.z + (nz - this.z) * m;
      if (sy <= g.heightAt(sx, sz) + BALL_RADIUS) hi = m;
      else lo = m;
    }
    const cx = this.x + (nx - this.x) * hi;
    const cz = this.z + (nz - this.z) * hi;
    this.x = cx;
    this.z = cz;
    this.y = g.heightAt(cx, cz) + BALL_RADIUS;
    this.impact();
  }

  private inWaterTrack(): boolean {
    return this.ground.surfaceAt(this.x, this.z) === Surface.Water;
  }

  private impact() {
    const g = this.ground;
    const surface = g.surfaceAt(this.x, this.z);
    const hs = Math.hypot(this.vx, this.vz);
    const firstContact = !this.landed;
    if (firstContact) {
      this.landed = true;
      this.landX = this.x;
      this.landY = this.y;
      this.landZ = this.z;
      this.landSurface = surface;
    }
    if (this.stopAtFirstContact) {
      this.state = BallState.Rest;
      return;
    }
    if (surface === Surface.Water) {
      this.vx = this.vy = this.vz = 0;
      this.state = BallState.Water;
      this.emit(SimEvent.Water, surface, hs);
      return;
    }
    if (surface === Surface.OOB) {
      this.vx = this.vy = this.vz = 0;
      this.state = BallState.OOB;
      this.emit(SimEvent.OOB, surface, hs);
      return;
    }
    if (g.hasCup) {
      const dx = this.x - g.cupX;
      const dz = this.z - g.cupZ;
      if (dx * dx + dz * dz < CUP_RADIUS * CUP_RADIUS * 0.72 && hs < DUNK_MAX_SPEED) {
        this.holeOut();
        return;
      }
    }
    g.slopeAt(this.x, this.z);
    const gx = g.gx;
    const gz = g.gz;
    const nl = Math.sqrt(gx * gx + 1 + gz * gz);
    const nX = -gx / nl;
    const nY = 1 / nl;
    const nZ = -gz / nl;
    const vn = this.vx * nX + this.vy * nY + this.vz * nZ;
    let tx = this.vx - vn * nX;
    let ty = this.vy - vn * nY;
    let tz = this.vz - vn * nZ;
    const p = SURFACES[surface];
    const retain = this.bounces === 0 ? p.retain * this.spin : 1 - (1 - p.retain) * 0.35;
    tx *= retain;
    ty *= retain;
    tz *= retain;
    const out = -vn * p.bounce;
    this.bounces++;
    this.emit(firstContact ? SimEvent.Land : SimEvent.Bounce, surface, Math.abs(vn));
    if (out < ROLL_THRESHOLD) {
      this.vx = tx;
      this.vy = 0;
      this.vz = tz;
      this.state = BallState.Roll;
    } else {
      this.vx = tx + nX * out;
      this.vy = ty + nY * out;
      this.vz = tz + nZ * out;
      this.y += 0.01;
    }
  }

  private holeOut() {
    const g = this.ground;
    this.x = g.cupX;
    this.z = g.cupZ;
    this.y = g.heightAt(g.cupX, g.cupZ) - 0.25;
    this.vx = this.vy = this.vz = 0;
    this.state = BallState.Holed;
    this.emit(SimEvent.Cup, Surface.Green, 0);
  }

  private stepRoll(dt: number) {
    const g = this.ground;
    const surface = g.surfaceAt(this.x, this.z);
    if (surface === Surface.Water) {
      this.vx = this.vz = 0;
      this.state = BallState.Water;
      this.emit(SimEvent.Water, surface, 0);
      return;
    }
    if (surface === Surface.OOB) {
      this.vx = this.vz = 0;
      this.state = BallState.OOB;
      this.emit(SimEvent.OOB, surface, 0);
      return;
    }
    const p = SURFACES[surface];
    g.slopeAt(this.x, this.z);
    const k = 1 / (1 + g.gx * g.gx + g.gz * g.gz);
    const ax = -GRAVITY * g.gx * k;
    const az = -GRAVITY * g.gz * k;
    this.vx += ax * dt;
    this.vz += az * dt;
    let sp = Math.hypot(this.vx, this.vz);
    const dec = (p.rollFriction * GRAVITY + p.rollDrag * sp) * dt;
    if (sp <= dec) {
      this.vx = this.vz = 0;
      sp = 0;
    } else {
      const f = (sp - dec) / sp;
      this.vx *= f;
      this.vz *= f;
      sp -= dec;
    }
    if (sp < 0.15 && Math.hypot(ax, az) < p.staticFriction * GRAVITY) {
      this.vx = this.vz = 0;
      this.y = g.heightAt(this.x, this.z) + BALL_RADIUS;
      this.state = BallState.Rest;
      this.emit(SimEvent.Rest, surface, 0);
      return;
    }
    let nx = this.x + this.vx * dt;
    let nz = this.z + this.vz * dt;

    // Trunks and towers.
    const cols = g.colliders;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (c.kind !== 1) continue;
      const dx = nx - c.x;
      const dz = nz - c.z;
      const rr = c.r + BALL_RADIUS;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) || 1;
        const nX = dx / d;
        const nZ = dz / d;
        const vn = this.vx * nX + this.vz * nZ;
        if (vn < 0) {
          this.vx -= 1.4 * vn * nX;
          this.vz -= 1.4 * vn * nZ;
        }
        nx = c.x + nX * rr;
        nz = c.z + nZ * rr;
        this.emit(SimEvent.Collide, surface, Math.abs(vn));
      }
    }

    // Cup: test the whole step segment so fast balls cannot skip over it.
    if (g.hasCup) {
      const sx = nx - this.x;
      const sz = nz - this.z;
      const l2 = sx * sx + sz * sz;
      let t = l2 > 0 ? ((g.cupX - this.x) * sx + (g.cupZ - this.z) * sz) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = this.x + sx * t - g.cupX;
      const qz = this.z + sz * t - g.cupZ;
      const d = Math.sqrt(qx * qx + qz * qz);
      if (d < CUP_RADIUS) {
        if (!this.inCupZone) {
          this.inCupZone = true;
          // How centred the ball's line is: perpendicular offset of the cup from the path.
          const off = sp > 1e-6 ? Math.abs((g.cupX - this.x) * this.vz - (g.cupZ - this.z) * this.vx) / sp : d;
          const r = Math.min(1, off / CUP_RADIUS);
          const maxV = CUP_CAPTURE_SPEED * Math.sqrt(Math.max(0, 1 - r * r)) + 0.6;
          if (sp <= maxV) {
            this.holeOut();
            return;
          }
          // Lip: deflect away from the centre and lose some pace.
          const cross = this.vx * qz - this.vz * qx;
          const sign = cross >= 0 ? 1 : -1;
          const ang = sign * (0.55 * (1 - r) + 0.05);
          const ca = Math.cos(ang);
          const sa = Math.sin(ang);
          const vx = this.vx * ca - this.vz * sa;
          const vz = this.vx * sa + this.vz * ca;
          this.vx = vx * 0.8;
          this.vz = vz * 0.8;
          this.emit(SimEvent.Lip, surface, sp);
        }
      } else {
        this.inCupZone = false;
      }
    }

    this.x = nx;
    this.z = nz;
    this.y = g.heightAt(nx, nz) + BALL_RADIUS;
    if (g.surfaceAt(nx, nz) !== Surface.Water) {
      this.lastDryX = nx;
      this.lastDryZ = nz;
    }
  }
}
