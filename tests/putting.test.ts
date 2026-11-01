import { describe, expect, it } from 'vitest';
import { BallSim, BallState } from '../src/sim/ball';
import { BALL_RADIUS, DT, Surface, type SurfaceId } from '../src/sim/constants';
import { launch, makePrediction, MAX_PATH_POINTS, predict, puttingRead, type ShotParams } from '../src/sim/shot';
import type { Collider, GroundModel } from '../src/sim/world';
import { CourseWorld } from '../src/sim/world';
import { HOLES } from '../src/course/holes';

class Green implements GroundModel {
  gx = 0; gz = 0;
  slopeX = 0; slopeZ = 0;
  hasCup = false; cupX = 0; cupZ = -5;
  colliders: Collider[] = [];
  surface: SurfaceId = Surface.Green;
  surfaceFn: ((x: number, z: number) => SurfaceId) | null = null;
  heightAt(x: number, z: number) { return x * this.slopeX + z * this.slopeZ; }
  slopeAt() { this.gx = this.slopeX; this.gz = this.slopeZ; }
  surfaceAt(x: number, z: number) { return this.surfaceFn ? this.surfaceFn(x, z) : this.surface; }
}

function compare(ground: GroundModel, power = 0.6, extra: Partial<ShotParams> = {}, x = 0, z = 0) {
  const params: ShotParams = { club: 'putter', power, yaw: 0, lie: ground.surfaceAt(x, z), windX: 0, windZ: 0, ...extra };
  const scratch = new BallSim(ground);
  const pred = predict(scratch, x, z, params, makePrediction());
  const real = new BallSim(ground);
  real.place(x, z); launch(real, params);
  let length = 0;
  for (let i = 0; real.moving && i < 4000; i++) {
    const px = real.x, pz = real.z;
    real.step(DT);
    length += Math.hypot(real.x - px, real.z - pz);
  }
  expect(pred.valid).toBe(true);
  expect(pred.kind).toBe('roll');
  expect(pred.x).toBeCloseTo(real.x, 9);
  expect(pred.z).toBeCloseTo(real.z, 9);
  expect(pred.carry).toBeCloseTo(length, 9);
  expect(pred.outcome).toBe(real.state);
  expect(pred.count).toBeGreaterThanOrEqual(2);
  expect(pred.count).toBeLessThanOrEqual(MAX_PATH_POINTS);
  expect(pred.path[(pred.count - 1) * 3]).toBeCloseTo(pred.x, 4);
  expect(pred.path[(pred.count - 1) * 3 + 2]).toBeCloseTo(pred.z, 4);
  return pred;
}

describe('slope-aware putting guide', () => {
  it('matches actual flat-green putts, including the perfect-strike bonus range', () => {
    for (const power of [0.02, 0.2, 0.5, 1, 1.06]) {
      const pred = compare(new Green(), power);
      expect(pred.breakYards).toBeCloseTo(0, 10);
      expect(puttingRead(pred).break).toBe('Nearly straight');
    }
  });

  it('curves downhill and reports break relative to the aiming direction', () => {
    const green = new Green();
    green.slopeX = 0.025;
    const forward = compare(green);
    expect(forward.breakYards).toBeLessThan(-0.15);
    expect(puttingRead(forward).break).toContain('Left');
    const reverse = compare(green, 0.6, { yaw: Math.PI });
    expect(reverse.breakYards).toBeGreaterThan(0.15);
    expect(puttingRead(reverse).break).toContain('Right');
    // The samples curve: successive segment headings change as pace drops.
    const firstHeading = Math.atan2(forward.path[3], -forward.path[5]);
    const finalHeading = Math.atan2(forward.x, -forward.z);
    expect(Math.abs(firstHeading - finalHeading)).toBeGreaterThan(0.01);
  });

  it('shows less roll uphill and more roll downhill', () => {
    const green = new Green();
    const flat = compare(green).carry;
    green.slopeZ = -0.025;
    const uphill = compare(green);
    green.slopeZ = 0.025;
    const downhill = compare(green);
    expect(uphill.carry).toBeLessThan(flat);
    expect(downhill.carry).toBeGreaterThan(flat);
    expect(puttingRead(uphill).slope).toContain('Uphill');
    expect(puttingRead(downhill).slope).toContain('Downhill');
  });

  it('accounts for the fringe and rough instead of showing a flat-green distance', () => {
    const green = new Green();
    green.surfaceFn = (_x, z) => z < -5 ? Surface.Rough : Surface.Green;
    const pred = compare(green);
    expect(pred.surface).toBe(Surface.Rough);
    expect(pred.carry).toBeLessThan(10);
  });

  it('predicts cup capture and fast lip-outs with the same simulation', () => {
    const green = new Green(); green.hasCup = true;
    const gentle = compare(green, 0.2);
    expect(gentle.outcome).toBe(BallState.Holed);
    expect(puttingRead(gentle).stop).toBe('Cup on this line');
    expect(gentle.y).toBe(green.heightAt(gentle.x, gentle.z) + BALL_RADIUS);
    const fast = compare(green, 0.9);
    expect(fast.outcome).not.toBe(BallState.Holed);
  });

  it.each([Surface.Water, Surface.OOB])('warns when the putt rolls into hazard %s', (hazard) => {
    const green = new Green();
    green.surfaceFn = (_x, z) => z < -3 ? hazard : Surface.Green;
    const pred = compare(green, 0.5);
    expect(puttingRead(pred).danger).toBe(true);
    expect(puttingRead(pred).stop).toMatch(/Water|Out of bounds/);
  });

  it('honors the snail item and resets all prediction metadata between clubs', () => {
    const green = new Green(); green.slopeX = 0.025;
    expect(compare(green, 0.6, { item: 'snail' }).breakYards).toBeCloseTo(0, 8);
    const scratch = new BallSim(green), pred = makePrediction();
    const params: ShotParams = { club: 'putter', power: 0.6, yaw: 0, lie: Surface.Green, windX: 0, windZ: 0 };
    predict(scratch, 0, 0, params, pred);
    expect(pred.breakYards).not.toBe(0);
    predict(scratch, 0, 0, { ...params, club: 'wedge' }, pred);
    expect(pred.kind).toBe('carry');
    expect(pred.breakYards).toBe(0);
    expect(pred.rise).toBe(0);
    expect(pred.valid).toBe(true);
  });

  it('keeps a bounded path and terminates on steep long-running slopes', () => {
    const green = new Green(); green.slopeZ = 0.1;
    const pred = compare(green, 1);
    expect(pred.count).toBeLessThanOrEqual(MAX_PATH_POINTS);
    expect(pred.path[0]).toBe(0);
    expect(pred.path[2]).toBe(0);
  });

  it('matches real putts on all nine authored greens', () => {
    for (const hole of HOLES) {
      const world = new CourseWorld(hole);
      for (const power of [0.25, 0.55]) {
        compare(world, power, { yaw: -Math.PI / 4 }, world.cupX + 7, world.cupZ + 8);
      }
    }
  });
});
