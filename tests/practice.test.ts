import { describe, expect, it, vi } from 'vitest';
import { PracticeReplay, REPLAY_POINTS, practiceMap, practiceOutcome, type PracticeSetup } from '../src/game/practice';
import { Game } from '../src/game/game';
import { ErrandTracker } from '../src/game/club';
import { BallSim, BallState } from '../src/sim/ball';
import { DT, Surface, type SurfaceId } from '../src/sim/constants';
import { launch } from '../src/sim/shot';
import type { Collider, GroundModel } from '../src/sim/world';

class Ground implements GroundModel {
  gx = 0; gz = 0; hasCup = false; cupX = 0; cupZ = -5;
  colliders: Collider[] = [];
  hazard: SurfaceId | null = null;
  heightAt() { return 0; }
  slopeAt() { this.gx = this.gz = 0; }
  surfaceAt(_x: number, z: number) { return this.hazard !== null && z < -3 ? this.hazard : Surface.Green; }
}

function setup(): PracticeSetup {
  return {
    round: {
      version: 1, mode: 'practice', holeIndex: 6, scores: Array(9).fill(null), strokes: 2,
      ball: { x: 0, z: 0, px: 12, pz: 30 }, club: 'putter', yaw: 0,
      winds: Array.from({ length: 9 }, () => ({ mph: 4, dir: 0.6 })), holeDone: false,
      seed: 42, item: 'acorn', basketHoles: [0, 6], basketSeen: [6], rescues: 0,
      errand: { done: false, failed: false, shots: 2, putts: 1 },
    },
    spin: -1, itemArmed: true, tapPower: 0.45,
  };
}

function shot(ground = new Ground(), power = 0.5, input = setup(), batch = 1) {
  const replay = new PracticeReplay();
  replay.begin(input, power, 'Perfect!');
  const sim = new BallSim(ground);
  sim.place(input.round.ball!.x, input.round.ball!.z);
  launch(sim, { club: input.round.club, power, yaw: input.round.yaw!, lie: Surface.Green, windX: 0, windZ: 0 });
  replay.sample(sim);
  while (sim.moving) {
    for (let i = 0; i < batch && sim.moving; i++) { sim.step(DT); replay.sample(sim); }
  }
  replay.finish(sim, ground.cupX, ground.cupZ);
  return { replay, sim };
}

describe('practice shot replay', () => {
  it('protects the full checkpoint from both live mutations and repeated rewind mutations', () => {
    const input = setup();
    const expected = structuredClone(input);
    const { replay } = shot(new Ground(), 0.5, input);
    input.round.item = null; input.round.rescues = 1; input.round.strokes = 9;
    input.round.ball!.x = 100; input.round.errand!.failed = true;
    input.round.winds[6].mph = 9; input.round.basketSeen!.push(7); input.round.scores[6] = 10;
    const first = replay.restore()!;
    expect(first).toEqual(expected);
    first.round.ball!.z = -400; first.round.errand!.done = true;
    first.round.holeDone = true; first.round.scores[6] = 3;
    expect(replay.restore()).toEqual(expected);
  });

  it('only exposes a rewind after a committed shot has finished, and clears it on a new hole', () => {
    const replay = new PracticeReplay();
    expect(replay.restore()).toBeNull();
    replay.begin(setup(), 0.4, 'Early — pull');
    expect(replay.restore()).toBeNull();
    const sim = new BallSim(new Ground()); sim.place(0, 0);
    replay.sample(sim); replay.finish(sim, 0, -5);
    expect(replay.result!.accuracy).toBe('Early — pull');
    replay.clear();
    expect(replay.restore()).toBeNull(); expect(replay.count).toBe(0);
  });

  it('records actual carry and finish independently of the preview, and leaves physics unchanged', () => {
    const input = setup(); input.round.club = 'wedge';
    const { replay, sim } = shot(new Ground(), 0.7, input);
    expect(replay.result!.carry).toBeCloseTo(Math.hypot(sim.landX, sim.landZ), 8);
    expect(replay.result!.distance).toBeCloseTo(Math.hypot(sim.x, sim.z), 8);
    expect(replay.result!.toPin).toBeCloseTo(Math.hypot(sim.x, sim.z + 5), 8);
    const plain = new BallSim(new Ground()); plain.place(0, 0);
    launch(plain, { club: 'wedge', power: 0.7, yaw: 0, lie: Surface.Green, windX: 0, windZ: 0 });
    while (plain.moving) plain.step(DT);
    expect([sim.x, sim.y, sim.z]).toEqual([plain.x, plain.y, plain.z]);
    const last = (replay.count - 1) * 3;
    expect(replay.path[last + 2]).toBeCloseTo(sim.z, 4);
  });

  it('has identical traces and results at ordinary and fast-forward frame batching', () => {
    const normal = shot(new Ground(), 0.9, setup(), 1).replay;
    const skipped = shot(new Ground(), 0.9, setup(), 12).replay;
    expect(normal.result).toEqual(skipped.result);
    expect(normal.path).toEqual(skipped.path);
  });

  it.each([Surface.Water, Surface.OOB])('retains the hazard endpoint before relief for surface %s', (hazard) => {
    const ground = new Ground(); ground.hazard = hazard;
    const { replay, sim } = shot(ground);
    const end = sim.z;
    sim.place(0, 0); // The game's penalty/drop handling happens after finish().
    expect(replay.path[(replay.count - 1) * 3 + 2]).toBeCloseTo(end, 5);
    expect(practiceOutcome(replay.result!)).toMatch(/Water|Out of bounds/);
    expect(replay.restore()!.round.strokes).toBe(2);
    expect(replay.restore()!.round.item).toBe('acorn');
  });

  it('records holed putts as zero remaining with no invented airborne carry', () => {
    const ground = new Ground(); ground.hasCup = true;
    const { replay } = shot(ground, 0.2);
    expect(replay.result!.outcome).toBe(BallState.Holed);
    expect(replay.result!.toPin).toBe(0);
    expect(replay.result!.carry).toBeNull();
    expect(practiceOutcome(replay.result!)).toBe('In the cup!');
  });

  it('bounds memory on long shots without losing either endpoint', () => {
    const replay = new PracticeReplay(); replay.begin(setup(), 1, 'Straight strike');
    for (let i = 0; i <= 20000; i++) replay.sample({ x: i / 100, y: Math.sin(i / 50), z: -i / 50 });
    const sim = new BallSim(new Ground()); sim.place(200, -400);
    replay.finish(sim, 0, -5);
    expect(replay.count).toBeLessThanOrEqual(REPLAY_POINTS);
    for (const p of replay.path.slice(0, 3)) expect(p).toBeCloseTo(0, 8);
    expect(replay.path[(replay.count - 1) * 3]).toBe(200);
    expect(replay.path[(replay.count - 1) * 3 + 2]).toBe(-400);
  });

  it('keeps every map point in view and excludes distant pins that would obscure a short shot', () => {
    const ground = new Ground(); ground.cupZ = -200;
    const { replay } = shot(ground, 0.05);
    const map = practiceMap(replay);
    expect(map.pin).toBeNull();
    for (const p of map.points) {
      expect(p.x).toBeGreaterThanOrEqual(24); expect(p.x).toBeLessThanOrEqual(296);
      expect(p.y).toBeGreaterThanOrEqual(24); expect(p.y).toBeLessThanOrEqual(156);
    }
    expect(practiceMap(shot().replay).pin).not.toBeNull();
  });
});

// Exercise the real rewind orchestration with renderer/DOM boundaries stubbed.
// This catches a restore that only fixes the displayed stroke but loses the item/errand/save.
function rewindGame(phase: 'aim' | 'holeDone' | 'flight' = 'aim', mode: 'practice' | 'round' = 'practice') {
  const input = setup();
  const { replay } = shot(new Ground(), 0.5, input);
  const noop = () => {};
  const game = Object.assign(Object.create(Game.prototype), {
    round: { ...input.round, mode, strokes: 8, item: null, rescues: 1, holeDone: phase === 'holeDone' },
    practiceReplay: replay, phase, paused: true, pulling: false, meter: { active: false },
    controls: { cancelAll: noop, tapPower: 1 },
    ui: new Proxy({}, { get: () => noop }), audio: { tap: noop },
    sim: new BallSim(new Ground()), r: { effects: { clearTrail: noop, flag: { visible: false } } },
    errand: new ErrandTracker({ kind: 'noSand', who: 'pip', text: 'Stay dry' }),
    prepareAim: vi.fn(), refreshMods: noop, refreshErrandChip: noop, frameAim: noop, wake: noop,
    store: { setRound: vi.fn(), updateBests: vi.fn() },
  });
  game.errand.s = { done: true, failed: true, shots: 8, putts: 4 };
  return { game, input };
}

describe('practice rewind integration', () => {
  it('captures the intended aim and selected power before meter error or perfect bonus', () => {
    const { game } = rewindGame();
    game.yaw = 0.8;
    game.meter.power = 0.6;
    game.beginSwing = vi.fn();
    game.fireMeter({ power: 0.51, yawErr: -0.2, grade: 'mishit', offset: 0.5, degrees: -12 });
    expect(game.yaw).toBeCloseTo(0.6);
    expect(game.beginSwing).toHaveBeenCalledWith(0.51, false, 0.8, 0.6, 'Mishit! 12° left');
    game.store.settings = { reducedMotion: true };
    game.audio.chirp = () => {};
    game.fireMeter({ power: 0.6, yawErr: 0, grade: 'perfect', offset: 0, degrees: 0 });
    expect(game.beginSwing.mock.calls[1][0]).toBeCloseTo(0.636);
    expect(game.beginSwing.mock.calls[1][3]).toBe(0.6);
  });

  it.each(['aim', 'holeDone'] as const)('rewinds from %s without overwriting the saved round or earned stars', (phase) => {
    const { game, input } = rewindGame(phase);
    game.retryPracticeShot();
    expect(game.strokes).toBe(2);
    expect([game.ballX, game.ballZ, game.prevX, game.prevZ]).toEqual([0, 0, 12, 30]);
    expect(game.round).toEqual(input.round);
    expect(game.heldItem).toBe('acorn'); expect(game.itemArmed).toBe(true); expect(game.spin).toBe(-1);
    expect(game.errand.s).toEqual(input.round.errand);
    expect(game.controls.tapPower).toBe(0.45);
    expect(game.prepareAim).toHaveBeenCalledWith(0, 'putter');
    expect(game.phase).toBe('aim'); expect(game.paused).toBe(false);
    expect(game.store.setRound).not.toHaveBeenCalled(); expect(game.store.updateBests).not.toHaveBeenCalled();
  });

  it('refuses to rewind a normal round or a ball still in flight', () => {
    const round = rewindGame('aim', 'round').game;
    round.retryPracticeShot(); expect(round.prepareAim).not.toHaveBeenCalled();
    const flight = rewindGame('flight').game;
    flight.retryPracticeShot(); expect(flight.prepareAim).not.toHaveBeenCalled();
  });
});
