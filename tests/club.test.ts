import { describe, expect, it } from 'vitest';
import { HOLES } from '../src/course/holes';
import { ErrandTracker, holeStars, PROJECTS, restoredSet, STAR_ERRAND, totalStars } from '../src/game/club';
import { BallSim, BallState, SimEvent } from '../src/sim/ball';
import { DT, Surface } from '../src/sim/constants';
import { ACORN_HOLE, basketGuaranteeFor, basketHoles, modsFor, offerItems } from '../src/sim/items';
import { launch } from '../src/sim/shot';
import { CourseWorld, type Collider, type GroundModel } from '../src/sim/world';

class Flat implements GroundModel {
  gx = 0;
  gz = 0;
  colliders: Collider[] = [];
  hasCup = false;
  cupX = 0;
  cupZ = 0;
  surfaceFn: (x: number, z: number) => number = () => Surface.Fairway;
  heightAt() {
    return 0;
  }
  slopeAt() {}
  surfaceAt(x: number, z: number) {
    return this.surfaceFn(x, z) as never;
  }
}

const roll = (spin: -1 | 0 | 1) => {
  const sim = new BallSim(new Flat());
  sim.place(0, 0);
  launch(sim, { club: 'iron', power: 0.8, yaw: 0, lie: Surface.Fairway, windX: 0, windZ: 0, spin });
  while (sim.moving) sim.step(DT);
  return Math.hypot(sim.x - sim.landX, sim.z - sim.landZ) * Math.sign(sim.landZ - sim.z);
};

describe('spin', () => {
  it('topspin rolls out further, backspin stops quicker (and can check back)', () => {
    const none = roll(0);
    expect(roll(1)).toBeGreaterThan(none + 3);
    expect(roll(-1)).toBeLessThan(none - 3);
  });
});

describe('basket items', () => {
  const shot = (item: Parameters<typeof modsFor>[0], g = new Flat()) => {
    const sim = new BallSim(g);
    sim.place(0, 0);
    launch(sim, { club: 'iron', power: 0.7, yaw: 0, lie: Surface.Fairway, windX: 4, windZ: 0, item });
    const events: number[] = [];
    sim.listener = (e) => events.push(e);
    while (sim.moving) sim.step(DT);
    return { sim, events };
  };

  it('jam sticks where it first lands', () => {
    const { sim } = shot('jam');
    expect(Math.hypot(sim.x - sim.landX, sim.z - sim.landZ)).toBeLessThan(0.01);
    expect(sim.state).toBe(BallState.Rest);
  });

  it('a balloon carries further and drifts more with the wind', () => {
    const plain = shot(null).sim;
    const b = shot('balloon').sim;
    expect(-b.landZ).toBeGreaterThan(-plain.landZ + 15);
    expect(b.landX).toBeGreaterThan(plain.landX * 2);
  });

  it('an acorn skips over water', () => {
    const g = new Flat();
    g.surfaceFn = (_x, z) => (z < -40 && z > -75 ? Surface.Water : Surface.Fairway);
    const sim = new BallSim(g);
    sim.place(0, 0);
    launch(sim, { club: 'driver', power: 0.35, yaw: 0, lie: Surface.Fairway, windX: 0, windZ: 0, item: 'acorn' });
    const events: number[] = [];
    sim.listener = (e) => events.push(e);
    while (sim.moving) sim.step(DT);
    expect(events).toContain(SimEvent.Skip);
    expect(sim.state).not.toBe(BallState.Water);
  });

  it('snail ignores slopes while rolling', () => {
    const g = new Flat();
    g.slopeAt = function () {
      this.gx = 0.03;
      this.gz = 0;
    };
    const sim = new BallSim(g);
    sim.place(0, 0);
    launch(sim, { club: 'putter', power: 0.5, yaw: 0, lie: Surface.Green, windX: 0, windZ: 0, item: 'snail' });
    while (sim.moving) sim.step(DT);
    expect(Math.abs(sim.x)).toBeLessThan(0.01);
  });

  it('offers two different items and honours guarantees', () => {
    for (let seed = 0; seed < 30; seed++) {
      const [a, b] = offerItems(seed, 3);
      expect(a).not.toBe(b);
      expect(offerItems(seed, 6, 'acorn')).toContain('acorn');
      expect(offerItems(seed, 3, undefined, 'jam')).not.toContain('jam');
    }
  });
});

describe('critters', () => {
  it('woolly sheep bounce balls up', () => {
    const g = new Flat();
    g.colliders.push({ kind: 0, x: 0, y: 1.45, z: -20, r: 1.35, y0: 0, y1: 0, damp: 0.75, tag: 'sheep', boost: 7 });
    const sim = new BallSim(g);
    sim.place(0, 0);
    sim.launchAir(0, 6, -40, 1);
    let maxYAfter = 0;
    let hit = false;
    while (sim.moving) {
      sim.step(DT);
      if (sim.lastHit) hit = true;
      if (hit) maxYAfter = Math.max(maxYAfter, sim.y);
    }
    expect(hit).toBe(true);
    expect(maxYAfter).toBeGreaterThan(2.5);
  });

  it('mole hills pop a rolling ball into the air', () => {
    const g = new Flat();
    g.colliders.push({ kind: 0, x: 0, y: -0.5, z: -5, r: 1.3, y0: 0, y1: 0, damp: 0.8, tag: 'mole', boost: 6 });
    const sim = new BallSim(g);
    sim.place(0, 0);
    sim.launchRoll(0, -10);
    const events: number[] = [];
    sim.listener = (e) => events.push(e);
    while (sim.moving) sim.step(DT);
    expect(events).toContain(SimEvent.Collide);
    expect(sim.lastHit?.tag).toBe('mole');
  });

  it('moles appear per round seed, in the rough', () => {
    const w = new CourseWorld(HOLES[0], { seed: 42 });
    expect(w.moles.length).toBe(2);
    for (const m of w.moles) expect(w.surfaceAt(m.x, m.z)).toBe(Surface.Rough);
  });
});

describe('errands and stars', () => {
  it('scores stars for par, birdie and errand', () => {
    expect(holeStars(4, 4, false)).toBe(1);
    expect(holeStars(3, 4, true)).toBe(7);
    expect(holeStars(5, 4, true)).toBe(STAR_ERRAND);
    expect(totalStars([7, 1, 0, 4])).toBe(5);
  });

  it('restNear completes when the ball stops close by', () => {
    const t = new ErrandTracker(HOLES[0].errand);
    t.shotStart('driver', Surface.Tee);
    expect(t.rest(0, -100, Surface.Fairway)).toBe(false);
    expect(t.rest(-25, -236, Surface.Rough)).toBe(true);
    expect(t.s.done).toBe(true);
  });

  it('noSand fails on any sand and otherwise completes on holing out', () => {
    const t = new ErrandTracker(HOLES[3].errand);
    t.event(SimEvent.Land, Surface.Sand, null);
    expect(t.holed()).toBe(false);
    const ok = new ErrandTracker(HOLES[3].errand);
    expect(ok.holed()).toBe(true);
  });

  it('hit errands match the tag (the windmill counts its sails)', () => {
    const t = new ErrandTracker(HOLES[4].errand);
    const sails = { kind: 0, x: 0, y: 0, z: 0, r: 1, y0: 0, y1: 0, damp: 1, tag: 'sails' } as const;
    expect(t.event(SimEvent.Collide, Surface.Rough, { ...sails, tag: 'tree' })).toBe(false);
    expect(t.event(SimEvent.Collide, Surface.Rough, sails)).toBe(true);
  });

  it('onePutt counts putter strokes from the green only', () => {
    const t = new ErrandTracker(HOLES[8].errand);
    t.shotStart('driver', Surface.Tee);
    t.shotStart('putter', Surface.Fairway);
    t.shotStart('putter', Surface.Green);
    expect(t.holed()).toBe(true);
    const two = new ErrandTracker(HOLES[8].errand);
    two.shotStart('putter', Surface.Green);
    two.shotStart('putter', Surface.Green);
    expect(two.holed()).toBe(false);
  });

  it('projects unlock from errands and change the course', () => {
    const stars = Array(9).fill(0);
    expect(restoredSet(stars).size).toBe(0);
    stars[1] = STAR_ERRAND;
    expect(restoredSet(stars).has('bridge')).toBe(true);
    const before = new CourseWorld(HOLES[7]);
    const after = new CourseWorld(HOLES[7], { restored: restoredSet(stars) });
    expect(after.fairways.length).toBe(before.fairways.length + 1);
    expect(PROJECTS.every((p) => !p.unlocked(Array(9).fill(0)))).toBe(true);
  });

  it('every hole has an errand', () => {
    for (const h of HOLES) expect(h.errand.text.length).toBeGreaterThan(10);
  });
});

describe('basket schedule', () => {
  it('comes out exactly twice a round: once on holes 1–4, once on 5–9', () => {
    for (let seed = 0; seed < 200; seed++) {
      const [a, b] = basketHoles(seed);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(3);
      expect(b).toBeGreaterThanOrEqual(4);
      expect(b).toBeLessThanOrEqual(8);
    }
  });

  it('the last basket before the duck pond always offers an acorn', () => {
    for (let seed = 0; seed < 200; seed++) {
      const holes = basketHoles(seed);
      const withAcorn = holes.filter((h) => basketGuaranteeFor(holes, h) === 'acorn');
      expect(withAcorn).toHaveLength(1);
      expect(withAcorn[0]).toBeLessThanOrEqual(ACORN_HOLE);
      expect(offerItems(seed, withAcorn[0], 'acorn')).toContain('acorn');
    }
  });
});
