import { describe, expect, it } from 'vitest';
import { BallSim, BallState, SimEvent } from '../src/sim/ball';
import { CUP_CAPTURE_SPEED, CUP_RADIUS, DT, Surface, type SurfaceId } from '../src/sim/constants';
import { CLUBS, launch, makePrediction, predict, type ShotParams } from '../src/sim/shot';
import type { Collider, GroundModel } from '../src/sim/world';

class TestGround implements GroundModel {
  gx = 0;
  gz = 0;
  colliders: Collider[] = [];
  hasCup = false;
  cupX = 0;
  cupZ = 0;
  slopeX = 0;
  slopeZ = 0;
  surface: SurfaceId = Surface.Fairway;
  surfaceFn: ((x: number, z: number) => SurfaceId) | null = null;
  heightAt(x: number, z: number) {
    return this.slopeX * x + this.slopeZ * z;
  }
  slopeAt() {
    this.gx = this.slopeX;
    this.gz = this.slopeZ;
  }
  surfaceAt(x: number, z: number) {
    return this.surfaceFn ? this.surfaceFn(x, z) : this.surface;
  }
}

function runToRest(sim: BallSim, maxSteps = 20000) {
  let n = 0;
  while (sim.moving && n < maxSteps) {
    sim.step(DT);
    n++;
  }
  return n;
}

const shot = (club: ShotParams['club'], power: number, extra: Partial<ShotParams> = {}): ShotParams => ({
  club,
  power,
  yaw: 0,
  lie: Surface.Fairway,
  windX: 0,
  windZ: 0,
  ...extra,
});

describe('ball flight', () => {
  it('full-power carry matches each club rating on flat ground', () => {
    for (const club of CLUBS.filter((c) => c.id !== 'putter')) {
      const g = new TestGround();
      const sim = new BallSim(g);
      sim.place(0, 0);
      launch(sim, shot(club.id, 1));
      runToRest(sim);
      const carry = Math.hypot(sim.landX, sim.landZ);
      expect(carry).toBeCloseTo(club.maxCarry, 0);
    }
  });

  it('carry scales linearly with power', () => {
    const g = new TestGround();
    const sim = new BallSim(g);
    for (const p of [0.25, 0.5, 0.75]) {
      sim.place(0, 0);
      launch(sim, shot('iron', p));
      runToRest(sim);
      expect(Math.hypot(sim.landX, sim.landZ)).toBeCloseTo(115 * p, 0);
    }
  });

  it('prediction matches the real first landing exactly (same model)', () => {
    const g = new TestGround();
    g.slopeX = 0.03;
    g.slopeZ = -0.02;
    const sim = new BallSim(g);
    const scratch = new BallSim(g);
    const params = shot('driver', 0.83, { yaw: 0.3, windX: 3, windZ: -2 });
    const pred = predict(scratch, 5, 5, params, makePrediction());
    sim.place(5, 5);
    launch(sim, params);
    runToRest(sim);
    expect(pred.valid).toBe(true);
    expect(sim.landX).toBeCloseTo(pred.x, 6);
    expect(sim.landZ).toBeCloseTo(pred.z, 6);
  });

  it('tailwind carries further, headwind shorter, crosswind drifts', () => {
    const carryWith = (wx: number, wz: number) => {
      const sim = new BallSim(new TestGround());
      sim.place(0, 0);
      launch(sim, shot('driver', 1, { windX: wx, windZ: wz }));
      runToRest(sim);
      return { carry: -sim.landZ, side: sim.landX };
    };
    const calm = carryWith(0, 0);
    // Forward is -z, so a tailwind has negative z.
    expect(carryWith(0, -5).carry).toBeGreaterThan(calm.carry + 3);
    expect(carryWith(0, 5).carry).toBeLessThan(calm.carry - 3);
    expect(carryWith(5, 0).side).toBeGreaterThan(3);
  });

  it('a fast ball cannot tunnel through a steep ridge', () => {
    const g = new TestGround();
    // A wall 30 units ahead.
    g.heightAt = (_x: number, z: number) => (z < -30 && z > -31 ? 50 : 0);
    const sim = new BallSim(g);
    sim.place(0, 0);
    sim.launchAir(0, 0.5, -200, 1);
    runToRest(sim);
    expect(sim.landZ).toBeGreaterThan(-31.01);
  });

  it('tree canopies deflect and slow the ball', () => {
    const g = new TestGround();
    g.colliders.push({ kind: 0, x: 0, y: 6, z: -40, r: 3, y0: 0, y1: 0, damp: 0.45 });
    const sim = new BallSim(g);
    sim.place(0, 0);
    launch(sim, shot('driver', 1));
    runToRest(sim);
    expect(sim.hitObstacle).toBe(true);
    expect(-sim.z).toBeLessThan(120);
  });
});

describe('rolling and surfaces', () => {
  it('comes to rest on a flat fairway', () => {
    const sim = new BallSim(new TestGround());
    sim.place(0, 0);
    sim.launchRoll(0, -10);
    runToRest(sim);
    expect(sim.state).toBe(BallState.Rest);
    expect(sim.z).toBeLessThan(-1);
  });

  it('sand stops the ball much sooner than fairway, green rolls furthest', () => {
    const roll = (s: SurfaceId) => {
      const g = new TestGround();
      g.surface = s;
      const sim = new BallSim(g);
      sim.place(0, 0);
      sim.launchRoll(0, -10);
      runToRest(sim);
      return -sim.z;
    };
    expect(roll(Surface.Sand)).toBeLessThan(roll(Surface.Fairway) * 0.5);
    expect(roll(Surface.Rough)).toBeLessThan(roll(Surface.Fairway));
    expect(roll(Surface.Green)).toBeGreaterThan(roll(Surface.Fairway) * 1.5);
  });

  it('putts break with the green slope', () => {
    const g = new TestGround();
    g.surface = Surface.Green;
    g.slopeX = 0.02; // uphill to the right, so the ball breaks left (-x)
    const sim = new BallSim(g);
    sim.place(0, 0);
    launch(sim, shot('putter', 0.6));
    runToRest(sim);
    expect(sim.x).toBeLessThan(-0.5);
  });

  it('balls hold on gentle green slopes', () => {
    const g = new TestGround();
    g.surface = Surface.Green;
    g.slopeZ = 0.03;
    const sim = new BallSim(g);
    sim.place(0, 0);
    sim.launchRoll(0, -1);
    runToRest(sim, 4000);
    expect(sim.state).toBe(BallState.Rest);
  });

  it('putter full power rolls its rated distance on a flat green', () => {
    const g = new TestGround();
    g.surface = Surface.Green;
    const sim = new BallSim(g);
    sim.place(0, 0);
    launch(sim, shot('putter', 1));
    runToRest(sim);
    expect(-sim.z).toBeCloseTo(30, 0);
  });
});

describe('cup capture', () => {
  const putAt = (speed: number, offset: number) => {
    const g = new TestGround();
    g.surface = Surface.Green;
    g.hasCup = true;
    g.cupX = offset;
    g.cupZ = -1.2;
    const sim = new BallSim(g);
    const events: number[] = [];
    sim.listener = (e) => events.push(e);
    sim.place(0, 0);
    // Give it a start speed such that it reaches the cup at about `speed`.
    sim.launchRoll(0, -speed);
    runToRest(sim);
    return { sim, events };
  };

  it('slow ball over the centre drops', () => {
    const { sim, events } = putAt(3, 0);
    expect(sim.state).toBe(BallState.Holed);
    expect(events).toContain(SimEvent.Cup);
  });

  it('fast ball rolls across the hole', () => {
    const { sim, events } = putAt(CUP_CAPTURE_SPEED * 3, 0);
    expect(sim.state).not.toBe(BallState.Holed);
    expect(events).toContain(SimEvent.Lip);
  });

  it('a ball skimming the edge needs to be slower to drop', () => {
    expect(putAt(3.8, 0).sim.state).toBe(BallState.Holed);
    expect(putAt(5.5, CUP_RADIUS * 0.85).sim.state).not.toBe(BallState.Holed);
  });

  it('a step longer than the cup cannot skip over it', () => {
    const g = new TestGround();
    g.surface = Surface.Green;
    g.hasCup = true;
    g.cupX = 0;
    g.cupZ = -0.1;
    const sim = new BallSim(g);
    sim.place(0, 0.5);
    sim.launchRoll(0, -4);
    // One big step jumps right past the cup centre.
    sim.step(0.35);
    expect(sim.state).toBe(BallState.Holed);
  });

  it('a gentle chip landing on the cup is a dunk', () => {
    const g = new TestGround();
    const sim = new BallSim(g);
    sim.place(0, 0);
    sim.launchAir(0, 7, -6.2, 0.35);
    runToRest(sim);
    // Put the cup exactly where that chip first lands, then replay it.
    g.hasCup = true;
    g.cupX = sim.landX;
    g.cupZ = sim.landZ;
    sim.place(0, 0);
    sim.launchAir(0, 7, -6.2, 0.35);
    runToRest(sim);
    expect(sim.state).toBe(BallState.Holed);
  });
});

describe('hazards', () => {
  it('landing in water stops the ball in the water state', () => {
    const g = new TestGround();
    g.surfaceFn = (_x, z) => (z < -50 && z > -90 ? Surface.Water : Surface.Fairway);
    const sim = new BallSim(g);
    sim.place(0, 0);
    launch(sim, shot('iron', 0.6));
    runToRest(sim);
    expect(sim.state).toBe(BallState.Water);
    // Entry point recorded near the hazard edge.
    expect(sim.lastDryZ).toBeGreaterThan(-51);
  });

  it('rolling out of bounds is detected', () => {
    const g = new TestGround();
    g.surfaceFn = (x) => (x > 5 ? Surface.OOB : Surface.Fairway);
    const sim = new BallSim(g);
    sim.place(0, 0);
    sim.launchRoll(15, 0);
    runToRest(sim);
    expect(sim.state).toBe(BallState.OOB);
  });
});
