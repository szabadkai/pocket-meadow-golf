import { describe, expect, it } from 'vitest';
import { HOLES } from '../src/course/holes';
import { BallSim, BallState } from '../src/sim/ball';
import { DT, MAX_STROKES, Surface } from '../src/sim/constants';
import { oobDrop, waterDrop } from '../src/sim/rules';
import { CLUBS, launch, lieMultiplier, yawTo, type ClubId } from '../src/sim/shot';
import { CourseWorld } from '../src/sim/world';

/**
 * A simple bot that searches aim/power with the real simulation and plays each hole.
 * Proves every hole is completable and reasonably tuned for its par, with wind.
 */
function playHole(world: CourseWorld, windX: number, windZ: number) {
  const sim = new BallSim(world);
  let x = world.teeX;
  let z = world.teeZ;
  let strokes = 0;
  const log: string[] = [];
  while (strokes < MAX_STROKES) {
    const lie = world.surfaceAt(x, z);
    const dist = Math.hypot(world.cupX - x, world.cupZ - z);
    const clubs: ClubId[] = lie === Surface.Green ? ['putter'] : dist < 25 ? ['putter', 'wedge'] : ['driver', 'iron', 'wedge'];
    const baseYaw = yawTo(x, z, world.cupX, world.cupZ);
    const yaws: number[] = [];
    for (let d = -60; d <= 60; d += lie === Surface.Green ? 1 : 3) yaws.push(baseYaw + (d * Math.PI) / 180);
    for (const ap of world.def.aimPoints ?? []) yaws.push(yawTo(x, z, ap[0], -ap[1]));
    let best = { cost: Infinity, club: 'wedge' as ClubId, yaw: baseYaw, power: 0.5 };
    for (const club of clubs) {
      const powers: number[] = [];
      const step = club === 'putter' ? 0.02 : 0.05;
      for (let p = step; p <= 1.0001; p += step) powers.push(p);
      for (const yaw of yaws) {
        for (const power of powers) {
          sim.place(x, z);
          launch(sim, { club, power, yaw, lie, windX, windZ });
          let n = 0;
          while (sim.moving && n++ < 6000) sim.step(DT);
          let cost: number;
          if (sim.state === BallState.Holed) cost = 0;
          else if (sim.state === BallState.Water || sim.state === BallState.OOB) cost = 1000;
          else {
            const d = Math.hypot(world.cupX - sim.x, world.cupZ - sim.z);
            const s = world.surfaceAt(sim.x, sim.z);
            cost = d + (s === Surface.Sand ? 25 : s === Surface.Rough ? 8 : 0) + (s === Surface.Green ? 0 : 6);
          }
          if (cost < best.cost) best = { cost, club, yaw, power };
        }
      }
    }
    sim.place(x, z);
    launch(sim, { club: best.club, power: best.power, yaw: best.yaw, lie, windX, windZ });
    let n = 0;
    while (sim.moving && n++ < 6000) sim.step(DT);
    strokes++;
    log.push(`${best.club}@${best.power.toFixed(2)}→${['rest', '', '', 'holed', 'water', 'oob'][sim.state]} ${Math.hypot(world.cupX - sim.x, world.cupZ - sim.z).toFixed(1)}y`);
    if (sim.state === BallState.Holed) return { strokes, log };
    if (sim.state === BallState.Water) {
      strokes++;
      const d = waterDrop(world, sim.lastDryX, sim.lastDryZ, x, z);
      x = d.x;
      z = d.z;
    } else if (sim.state === BallState.OOB) {
      strokes++;
      const d = oobDrop(x, z);
      x = d.x;
      z = d.z;
    } else {
      x = sim.x;
      z = sim.z;
    }
  }
  return { strokes, log };
}

describe('every hole is completable by a careful player', () => {
  for (const hole of HOLES) {
    it(`hole ${hole.number} ${hole.name} (par ${hole.par})`, () => {
      const world = new CourseWorld(hole);
      const windMph = hole.wind[1];
      // Try a headwind and a crosswind at the hole's maximum wind.
      for (const [wx, wz] of [
        [0, windMph],
        [windMph, 0],
      ]) {
        const r = playHole(world, wx, wz);
        console.log(`H${hole.number} wind(${wx},${wz}): ${r.strokes} [${r.log.join(', ')}]`);
        expect(r.strokes).toBeLessThanOrEqual(hole.par + 1);
      }
    });
  }
});

/**
 * A straightforward player: default aim (pin or route hint), power = distance / club range,
 * no wind compensation, no search. Holes should not punish this style of play too hard.
 */
function playNaive(world: CourseWorld, windX: number, windZ: number) {
  const sim = new BallSim(world);
  let x = world.teeX;
  let z = world.teeZ;
  let strokes = 0;
  while (strokes < MAX_STROKES) {
    const lie = world.surfaceAt(x, z);
    const dPin = Math.hypot(world.cupX - x, world.cupZ - z);
    let club: ClubId = lie === Surface.Green || (dPin < 9 && lie !== Surface.Sand && lie !== Surface.Rough) ? 'putter' : dPin <= 69 ? 'wedge' : dPin <= 120 ? 'iron' : 'driver';
    if (lie === Surface.Sand && club === 'driver') club = 'iron';
    const carry = CLUBS.find((c) => c.id === club)!.maxCarry * lieMultiplier(club, lie);
    let tx = world.cupX;
    let tz = world.cupZ;
    if (dPin > carry * 1.25) {
      for (const ap of world.def.aimPoints ?? []) {
        const [ax, az] = [ap[0], -ap[1]];
        if (Math.hypot(world.cupX - ax, world.cupZ - az) < dPin - 15 && Math.hypot(ax - x, az - z) > 25) {
          tx = ax;
          tz = az;
          break;
        }
      }
    }
    const dist = Math.hypot(tx - x, tz - z);
    // Aim a little short of flags (to allow roll-out), putts slightly past.
    const want = club === 'putter' ? dist + 1 : tx === world.cupX ? dist * 0.92 : dist;
    const power = Math.min(1, want / (club === 'putter' ? 30 : carry));
    sim.place(x, z);
    launch(sim, { club, power, yaw: yawTo(x, z, tx, tz), lie, windX, windZ });
    let n = 0;
    while (sim.moving && n++ < 6000) sim.step(DT);
    strokes++;
    if (sim.state === BallState.Holed) return strokes;
    if (sim.state === BallState.Water) {
      strokes++;
      const d = waterDrop(world, sim.lastDryX, sim.lastDryZ, x, z);
      x = d.x;
      z = d.z;
    } else if (sim.state === BallState.OOB) {
      strokes++;
      x = oobDrop(x, z).x;
      z = oobDrop(x, z).z;
    } else {
      x = sim.x;
      z = sim.z;
    }
  }
  return strokes;
}

describe('holes are friendly to straightforward play (calm and breezy)', () => {
  for (const hole of HOLES) {
    it(`hole ${hole.number} ${hole.name}`, () => {
      const world = new CourseWorld(hole);
      const results = [
        [0, 0],
        [hole.wind[1] * 0.6, 0],
        [0, -hole.wind[1] * 0.6],
      ].map(([wx, wz]) => playNaive(world, wx, wz));
      console.log(`naive H${hole.number} par ${hole.par}: ${results.join(', ')}`);
      for (const r of results) expect(r).toBeLessThanOrEqual(hole.par + 3);
    });
  }
});
