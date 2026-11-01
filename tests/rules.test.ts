import { describe, expect, it } from 'vitest';
import { HOLES } from '../src/course/holes';
import { Surface } from '../src/sim/constants';
import { formatToPar, oobDrop, roundTotals, scoreName, waterDrop } from '../src/sim/rules';
import { CourseWorld } from '../src/sim/world';

describe('scoring', () => {
  it('names scores relative to par', () => {
    expect(scoreName(1, 3)).toBe('Hole in one!');
    expect(scoreName(3, 5)).toBe('Eagle!');
    expect(scoreName(3, 4)).toBe('Birdie!');
    expect(scoreName(4, 4)).toBe('Par');
    expect(scoreName(5, 4)).toBe('Bogey');
    expect(scoreName(6, 4)).toBe('Double bogey');
    expect(scoreName(9, 4)).toBe('+5');
  });

  it('totals only played holes', () => {
    const t = roundTotals([4, 3, null, null], [4, 3, 4, 3]);
    expect(t).toEqual({ strokes: 7, par: 7, toPar: 0, played: 2 });
    expect(formatToPar(0)).toBe('E');
    expect(formatToPar(2)).toBe('+2');
    expect(formatToPar(-1)).toBe('-1');
  });
});

describe('penalty relief', () => {
  it('out of bounds replays from the previous spot', () => {
    expect(oobDrop(3, 4)).toEqual({ x: 3, z: 4, kind: 'previous' });
  });

  it('water relief is dry, playable, and not nearer the hole', () => {
    const world = new CourseWorld(HOLES[1]); // Puddle Jumper
    // Ball entered the pond on the tee side.
    const entryX = -5;
    const entryZ = -24;
    expect(world.surfaceAt(entryX, entryZ - 3)).toBe(Surface.Water);
    const drop = waterDrop(world, entryX, entryZ, 0, 0);
    expect(drop.kind).toBe('line');
    expect(world.inWater(drop.x, drop.z)).toBe(false);
    expect(world.isDropValid(drop.x, drop.z)).toBe(true);
    const dEntry = Math.hypot(entryX - world.cupX, entryZ - world.cupZ);
    const dDrop = Math.hypot(drop.x - world.cupX, drop.z - world.cupZ);
    expect(dDrop).toBeGreaterThanOrEqual(dEntry);
  });

  it('island green uses its designated drop zone', () => {
    const world = new CourseWorld(HOLES[6]); // Duck Crossing
    const drop = waterDrop(world, 10, -90, 0, 0);
    expect(drop.kind).toBe('zone');
    expect(world.isDropValid(drop.x, drop.z)).toBe(true);
  });
});

describe('course data', () => {
  it('has nine holes with a mix of pars', () => {
    expect(HOLES).toHaveLength(9);
    const pars = new Set(HOLES.map((h) => h.par));
    expect(pars).toEqual(new Set([3, 4, 5]));
  });

  for (const hole of HOLES) {
    it(`hole ${hole.number} has a playable tee, green and pin`, () => {
      const w = new CourseWorld(hole);
      expect(w.surfaceAt(w.teeX, w.teeZ)).toBe(Surface.Tee);
      expect(w.surfaceAt(w.cupX, w.cupZ)).toBe(Surface.Green);
      // Pin at least 3 yards inside the green edge.
      expect(w.green.sdf(w.cupX, w.cupZ)).toBeLessThan(-3);
      // Green slope gentle enough that a ball can stop anywhere near the cup.
      w.slopeAt(w.cupX, w.cupZ);
      expect(Math.hypot(w.gx, w.gz)).toBeLessThan(0.04);
      for (const z of w.dropZones) expect(w.isDropValid(z[0], z[1])).toBe(true);
    });
  }
});
