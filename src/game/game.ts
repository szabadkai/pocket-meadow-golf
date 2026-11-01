import { AudioEngine } from '../audio/audio';
import { HOLES } from '../course/holes';
import { Controls } from '../input/controls';
import { GameRenderer, type QualityLevel } from '../render/scene';
import { BallSim, BallState, SimEvent, type SimEventId } from '../sim/ball';
import { SwingMeter, type MeterResult } from '../sim/meter';
import { BALL_RADIUS, DT, MAX_STROKES, SURFACES, Surface, type SurfaceId } from '../sim/constants';
import { formatToPar, oobDrop, roundTotals, scoreName, waterDrop } from '../sim/rules';
import { toWorld } from '../sim/shapes';
import { clubById, launch, lieMultiplier, makePrediction, predict, puttingRead, yawTo, type ClubId } from '../sim/shot';
import { CourseWorld } from '../sim/world';
import { UI } from '../ui/ui';
import { FLIGHT_PITCH, PITCH } from '../render/cameraRig';
import { ACORN_HOLE, ITEMS, basketGuaranteeFor, basketHoles, offerItems, type ItemId } from '../sim/items';
import { CAPS, ErrandTracker, PROJECTS, SCARVES, errandsDone, holeStars, restoredSet, totalStars } from './club';
import { SaveStore, type SavedRound } from './save';

type Phase = 'title' | 'intro' | 'basket' | 'aim' | 'swing' | 'flight' | 'settle' | 'holed' | 'holeDone' | 'results';

const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const LINES = {
  great: ['Wowee!', 'What a shot!', 'Pip pip hooray!', 'The sheep are swooning!'],
  close: ['So close!', 'Tap-in time!', 'Snuggled up to the pin!'],
  drive: ['Lovely drive!', 'Right down the middle!', 'Off it goes!'],
  green: ['On the green!', 'Nice and safe.'],
  sand: ['Biscuit time!', 'Sandy toes!', 'Into the sandbox.'],
  rough: ['A bit grassy in there.', 'Long grass, no worries.'],
  water: ['Splash! The ducks say hi.', 'Glub glub…', 'The pond wanted it more.'],
  tree: ['Bonk! Sorry, tree.', 'The apples felt that one.', 'Leafy!'],
  oob: ['Whoops, out of bounds!', 'Over the stakes!'],
  lip: ['Ooh, lipped out!', 'Rattled the rim!'],
  thanks: ['Thank you!', 'You’re a star!', 'Hooray, thank you!'],
};

const WHO: Record<string, [string, string]> = {
  bunny: ['🐰', 'Bunny'],
  sheep: ['🐑', 'Sheep'],
  duck: ['🦆', 'Duck'],
  frog: ['🐸', 'Frog'],
  hedgehog: ['🦔', 'Hedgehog'],
  pip: ['🐦', 'Pip'],
};

export class Game {
  readonly store = new SaveStore();
  readonly audio = new AudioEngine();
  readonly ui: UI;
  readonly r: GameRenderer;
  readonly controls: Controls;
  private world!: CourseWorld;
  private sim!: BallSim;
  private scratch!: BallSim;
  private pred = makePrediction();
  private phase: Phase = 'title';
  private round: SavedRound | null = null;
  // Ball / shot state.
  private ballX = 0;
  private ballZ = 0;
  private prevX = 0;
  private prevZ = 0;
  private lie: SurfaceId = Surface.Tee;
  private club: ClubId = 'driver';
  private yaw = 0;
  private strokes = 0;
  private windX = 0;
  private windZ = 0;
  private windMph = 0;
  private windDir = 0;
  private pulling = false;
  private pullPower = 0;
  private overview = false;
  private predDirty = true;
  private puttPredictionKey = '';
  private puttPredictionWorld: CourseWorld | null = null;
  private puttPredictionAt = -Infinity;
  private shotYaw = 0;
  private shotClub: ClubId = 'driver';
  private shotPower = 0;
  private swingFrom = 0;
  private launched = false;
  private flightSteps = 0;
  private fastForward = false;
  private phaseT = 0;
  private time = 0;
  private acc = 0;
  private paused = false;
  private hidden = false;
  private activeUntil = 0;
  private lastFrame = 0;
  private idleAcc = 0;
  private frameTimes: number[] = [];
  private qualityCheckAt = 0;
  private shotStartX = 0;
  private shotStartZ = 0;
  private hitTree = false;
  private tutorialStep = -1;
  private practiceHole = 0;
  private rafId = 0;
  private titleYaw = 0;
  private lastSwingTick = 0;
  private aimSinceTutorial = 0;
  private meter = new SwingMeter();
  // Shot modifiers and the fun layer.
  private spin: -1 | 0 | 1 = 0;
  private heldItem: ItemId | null = null;
  private itemArmed = false;
  private shotItem: ItemId | null = null;
  private shotSpin: -1 | 0 | 1 = 0;
  private shotPerfect = false;
  private errand!: ErrandTracker;
  private hitStop = 0;
  private steerInput = 0;
  private waitingRescue = false;
  private hitTag: string | null = null;

  constructor(app: HTMLElement) {
    this.ui = new UI(app);
    this.r = new GameRenderer(
      this.ui.$('gl') as HTMLCanvasElement,
      () => this.onContextLost(),
      () => this.onContextRestored(),
    );
    this.controls = new Controls(this.controlHandlers(), {
      course: this.ui.$('course'),
      aimStrip: this.ui.$('aimStrip'),
      aimTicks: this.ui.$('aimTicks'),
      aimLeft: this.ui.$('aimLeft'),
      aimRight: this.ui.$('aimRight'),
      pad: this.ui.$('pad'),
      pMinus: this.ui.$('pMinus'),
      pPlus: this.ui.$('pPlus'),
      tapSwing: this.ui.$('tapSwing'),
      meterButton: this.ui.$('meterSwing'),
      meterCancel: this.ui.$('meterCancel'),
    });
    this.bindUI();
    this.applySettings();
  }

  /** Boot steps are separated so the loader can report real progress. */
  bootWorld(index: number) {
    this.world = new CourseWorld(HOLES[index], { restored: restoredSet(this.store.bests.stars), seed: this.round?.seed });
    this.sim = new BallSim(this.world);
    this.scratch = new BallSim(this.world);
    this.sim.listener = (e, s, surf, speed) => this.onSimEvent(e, s, surf, speed);
  }

  bootRender() {
    this.r.loadHole(this.world);
    this.layout();
  }

  start() {
    const relayout = () => requestAnimationFrame(() => this.layout());
    window.addEventListener('resize', relayout);
    window.addEventListener('orientationchange', relayout);
    window.visualViewport?.addEventListener('resize', relayout);
    new ResizeObserver(relayout).observe(this.ui.$('course'));
    document.addEventListener('visibilitychange', () => this.onVisibility());
    window.addEventListener('pagehide', () => this.saveNow());
    window.addEventListener('blur', () => this.controls.cancelAll());
    // iOS: stop pinch-zoom and double-tap gestures inside the game.
    for (const ev of ['gesturestart', 'gesturechange', 'dblclick', 'contextmenu']) {
      document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
    }
    document.addEventListener(
      'touchmove',
      (e) => {
        if (!(e.target as HTMLElement).closest('.card')) e.preventDefault();
      },
      { passive: false },
    );
    // Audio may only start after a user gesture.
    const unlock = () => {
      this.audio.unlock();
      this.audio.setVolumes(this.store.settings.sfxVol, this.store.settings.musicVol);
      this.audio.startMusic();
    };
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    this.showTitle();
    this.lastFrame = performance.now();
    this.rafId = requestAnimationFrame((t) => this.frame(t));
  }

  // ------------------------------------------------------------------ settings
  private applySettings() {
    const s = this.store.settings;
    document.documentElement.classList.toggle('reduced', s.reducedMotion);
    this.ui.setSwingMode(s.swingMode);
    this.audio.setVolumes(s.sfxVol, s.musicVol);
    const q: QualityLevel = s.quality === 'low' ? 0 : s.quality === 'medium' ? 1 : s.quality === 'high' ? 2 : this.autoQualityStart();
    if (q !== this.r.quality) this.r.setQuality(q);
    this.r.rig.rate = s.reducedMotion ? 9 : 4;
    this.ui.syncSettings(s, this.store.available);
    this.r.golfer.setCap((CAPS.find((c) => c.id === s.cap) ?? CAPS[0]).color);
    this.r.bird.setScarf((SCARVES.find((c) => c.id === s.scarf) ?? SCARVES[0]).color);
  }

  private autoQualityStart(): QualityLevel {
    const mobile = matchMedia('(pointer: coarse)').matches;
    const cores = navigator.hardwareConcurrency || 4;
    if (mobile && cores <= 4) return 0;
    return mobile ? 1 : 2;
  }

  // ------------------------------------------------------------------ UI binding
  private bindUI() {
    const ui = this.ui;
    ui.onClick('btnPlay', () => this.newRound());
    ui.onClick('btnContinue', () => this.continueRound());
    ui.onClick('btnPractice', () => ui.showPractice(this.store.bests, (i) => this.startPractice(i)));
    ui.onClick('btnSettings', () => ui.show('scrSettings'));
    ui.onClick('menuBtn', () => this.openPause());
    ui.onClick('pResume', () => this.closePause());
    ui.onClick('pCard', () => {
      ui.renderCard('cardTable', this.cardScores(), this.round?.holeIndex ?? 0);
      ui.show('scrCard', 'scrPause');
    });
    ui.onClick('pSettings', () => ui.show('scrSettings', 'scrPause'));
    ui.onClick('pRestart', () => {
      this.closePause();
      this.restartHole();
    });
    ui.onClick('pQuit', () => {
      this.saveNow();
      this.closePause();
      this.showTitle();
    });
    ui.onClick('overviewBtn', () => this.toggleOverview());
    ui.onClick('btnClub', () => this.openClub());
    ui.onClick('itemBtn', () => this.toggleItem());
    ui.onClick('spinBtn', () => this.cycleSpin());
    ui.onClick('zoomIn', () => this.lookZoom(0.75));
    ui.onClick('zoomOut', () => this.lookZoom(1.33));
    ui.onClick('btnNext', () => this.nextHole());
    ui.onClick('resAgain', () => this.newRound());
    ui.onClick('resTitle', () => this.showTitle());
    ui.onClick('pipNext', () => this.tutorialNext());
    ui.onClick('pipSkip', () => this.endTutorial());
    ui.onClick('setTutorial', () => {
      this.store.updateSettings({ tutorialDone: false });
      ui.toastMsg('Pip will show you around on hole 1.');
    });
    ui.clubButtons.forEach((b) =>
      b.addEventListener('click', () => {
        if (!this.canAim()) return;
        this.setClub(b.dataset.club as ClubId, true);
        this.audio.tap();
        if (this.tutorialStep === 1) this.tutorialNext();
      }),
    );
    ui.onSettings((p) => {
      this.store.updateSettings(p);
      this.applySettings();
      if (p.swingMode && this.phase === 'aim') this.refreshTapLabel();
      if (p.sfxVol !== undefined) this.audio.tap();
    });
    ui.onBack(() => {
      if (this.paused) ui.show('scrPause');
      else if (this.phase === 'title') ui.show('scrTitle');
      else ui.hideScreens();
    });
    ui.$('scrHole').addEventListener('pointerdown', (e) => {
      if (e.target === ui.$('scrHole')) this.nextHole();
    });
  }

  private controlHandlers() {
    return {
      canAim: () => this.canAim(),
      canSwing: () => this.canAim(),
      meterPress: () => this.meterPress(),
      meterRelease: () => this.meterRelease(),
      meterCancel: () => this.cancelMeter(),
      lookActive: () => this.overview && this.phase === 'aim',
      lookPan: (dx: number, dy: number) => {
        this.r.rig.panPx(dx, dy);
        this.clampLook();
        this.wake();
      },
      lookPinch: (ratio: number, dAngle: number) => {
        this.r.rig.zoomBy(ratio);
        this.r.rig.rotateBy(dAngle);
        this.wake();
      },
      lookZoom: (f: number) => this.lookZoom(f),
      aimFineness: () => (this.club === 'putter' ? 0.35 : 1),
      aimBy: (rad: number) => {
        this.yaw += rad;
        this.predDirty = true;
        this.aimSinceTutorial += Math.abs(rad);
        if (this.tutorialStep === 0 && this.aimSinceTutorial > 0.03) this.tutorialNext();
        this.wake();
      },
      aimDragActive: (a: boolean) => {
        if (!a) {
          this.frameAim(false);
          this.refreshTapLabel();
        }
      },
      swingStart: () => {
        this.pulling = true;
        this.pullPower = 0;
        this.lastSwingTick = 0;
        this.predDirty = true;
        this.wake();
      },
      swingUpdate: (p: number, cancel: boolean, x: number, _y: number, startY: number) => {
        this.pullPower = p;
        // Predict now so the bubble and the in-world marker always agree.
        this.computePrediction(false);
        this.predDirty = false;
        const tick = Math.floor(p * 4);
        if (tick !== this.lastSwingTick) {
          this.lastSwingTick = tick;
          if (tick > 0) {
            this.audio.tick(p);
            if (this.store.settings.haptics) navigator.vibrate?.(6);
          }
        }
        this.ui.showPower(x, startY - 18, p, this.carryLabel(p), cancel);
        this.r.golfer.setSwing(cancel ? 0 : -p);
        this.wake();
      },
      swingRelease: (p: number) => {
        this.ui.hidePower();
        this.pulling = false;
        this.beginSwing(p);
      },
      swingCancel: () => {
        this.ui.hidePower();
        this.pulling = false;
        this.pullPower = 0;
        this.predDirty = true;
        this.r.golfer.setSwing(0);
        this.wake();
      },
      tapPowerChanged: (p: number) => {
        this.pullPower = p;
        this.computePrediction(false);
        this.predDirty = false;
        this.ui.setTapPower(p, this.carryLabel(p));
        this.wake();
      },
      tapSwing: (p: number) => this.beginSwing(p),
      steerActive: () => this.phase === 'flight' && this.shotItem === 'bee' && this.sim.state === BallState.Air,
      steer: (v: number) => {
        this.steerInput = v;
      },
      courseTap: () => {
        if (this.phase === 'flight') this.fastForward = true;
        else if (this.phase === 'holed') this.phaseT = 99;
        else if (this.phase === 'intro') this.phaseT = 99;
      },
      interacted: () => this.wake(),
    };
  }

  private canAim(): boolean {
    return this.phase === 'aim' && !this.paused && !this.meter.active;
  }

  // ------------------------------------------------------------------ swing meter
  private meterPress() {
    if (this.phase !== 'aim' || this.paused || this.store.settings.swingMode !== 'meter') return;
    this.wake(3);
    if (!this.meter.active) {
      this.meter.start(this.club === 'putter');
      this.ui.setSwingLocked(true);
      this.pulling = true;
      this.pullPower = 0;
      this.ui.hideSpeech();
      this.audio.tap();
      if (this.tutorialStep >= 0 && this.tutorialStep <= 2) this.ui.hideSpeech();
      return;
    }
    const r = this.meter.tap();
    if (r) this.fireMeter(r);
  }

  private meterRelease() {
    const wasPower = this.meter.stage === 'power';
    this.meter.release();
    if (wasPower) {
      this.audio.tick(this.meter.power);
      if (this.store.settings.haptics) navigator.vibrate?.(8);
    }
    this.wake(3);
  }

  private cancelMeter() {
    if (!this.meter.active) return;
    this.meter.cancel();
    this.ui.setSwingLocked(false);
    this.pulling = false;
    this.pullPower = 0;
    this.predDirty = true;
    this.r.golfer.setSwing(0);
    this.ui.setMeter('idle', 0, 0, 'Hold for power', '');
    this.wake();
  }

  private fireMeter(r: MeterResult) {
    this.pulling = false;
    // Timing error turns the shot: visible and deterministic, never random.
    this.yaw += r.yawErr;
    const deg = Math.abs(r.degrees);
    const side = r.degrees < 0 ? 'left' : 'right';
    const msg =
      r.grade === 'perfect'
        ? 'Perfect!'
        : r.grade === 'good'
          ? 'Nice and straight.'
          : r.grade === 'mishit'
            ? `Mishit! ${Math.round(deg)}° ${side}`
            : `${r.grade === 'early' ? 'Early — pull' : 'Late — push'} · ${Math.round(deg)}° ${side}`;
    this.ui.setMeter('done', r.offset, this.meter.power, msg, '');
    const perfect = r.grade === 'perfect';
    // A perfect strike flies a little further: a visible reward, not a hidden roll.
    this.beginSwing(perfect ? r.power * 1.06 : r.power, perfect);
    if (perfect) {
      this.ui.stamp('PERFECT!');
      if (!this.store.settings.reducedMotion) this.ui.flash();
      this.audio.chirp();
    } else this.ui.say(msg, 1300);
  }

  private wake(sec = 2.5) {
    this.activeUntil = Math.max(this.activeUntil, this.time + sec);
  }

  // ------------------------------------------------------------------ flow
  private showTitle() {
    this.phase = 'title';
    this.overview = false;
    this.ui.setHud(false);
    this.ui.hideScreens();
    this.ui.show('scrTitle');
    if (this.world.def.number !== 1) {
      this.bootWorld(0);
      this.r.loadHole(this.world);
    }
    this.r.golfer.root.visible = false;
    this.r.bird.root.visible = false;
    this.r.effects.hideAim();
    this.r.effects.ball.visible = false;
    this.r.effects.ballShadow.visible = false;
    const saved = this.store.round;
    const info = saved && saved.mode === 'round' ? this.continueInfo(saved) : null;
    this.ui.setContinue(info);
    const b = this.store.bests;
    this.ui.setTitleBest(b.bestRound != null ? `Best round: ${b.bestRound} (${formatToPar(b.bestToPar ?? 0)})` : '');
    this.ui.setClubInfo(`★ ${totalStars(b.stars)} · ${errandsDone(b.stars)}/9 errands`);
    this.titleYaw = 0;
    this.layout();
    this.frameTitle(true);
  }

  private continueInfo(r: SavedRound): string {
    const t = roundTotals(r.scores, HOLES.map((h) => h.par));
    const hole = r.holeDone ? r.holeIndex + 2 : r.holeIndex + 1;
    return `Hole ${Math.min(9, hole)} · ${t.played ? formatToPar(t.toPar) : 'E'}`;
  }

  private makeWinds() {
    return HOLES.map((h) => ({
      mph: Math.round(h.wind[0] + Math.random() * (h.wind[1] - h.wind[0])),
      dir: Math.random() * Math.PI * 2,
    }));
  }

  private newRound() {
    this.round = {
      version: 1,
      mode: 'round',
      holeIndex: 0,
      scores: Array(9).fill(null),
      strokes: 0,
      ball: null,
      club: 'driver',
      yaw: null,
      winds: this.makeWinds(),
      holeDone: false,
      seed: Math.floor(Math.random() * 1e9),
      rescues: 0,
    };
    this.store.setRound(this.round);
    this.startHole(0, false);
  }

  private continueRound() {
    const r = this.store.round;
    if (!r) return this.newRound();
    this.round = JSON.parse(JSON.stringify(r)) as SavedRound;
    this.round.seed ??= Math.floor(Math.random() * 1e9);
    if (this.round.holeDone) {
      this.round.errand = undefined;
      if (this.round.holeIndex >= 8) return this.showResults();
      this.round.holeIndex++;
      this.round.holeDone = false;
      this.round.ball = null;
      this.round.strokes = 0;
    }
    this.startHole(this.round.holeIndex, true);
  }

  private startPractice(i: number) {
    this.practiceHole = i;
    this.round = {
      version: 1,
      mode: 'practice',
      holeIndex: i,
      scores: Array(9).fill(null),
      strokes: 0,
      ball: null,
      club: 'driver',
      yaw: null,
      winds: this.makeWinds(),
      holeDone: false,
      seed: Math.floor(Math.random() * 1e9),
      rescues: 0,
    };
    this.startHole(i, false);
  }

  /** Dev helper for automated checks (see main.ts). */
  devPractice(i: number, swing: number | null, putting = false) {
    this.startPractice(Math.max(0, Math.min(8, i)));
    if (putting) {
      this.ballX = this.world.cupX + 7;
      this.ballZ = this.world.cupZ + 8;
      this.sim.place(this.ballX, this.ballZ);
      this.prepareAim(null, 'putter');
    }
    if (swing == null) return;
    const wait = () => (this.phase === 'aim' ? this.beginSwing(swing) : window.setTimeout(wait, 100));
    wait();
  }

  private restartHole() {
    if (!this.round) return;
    this.round.ball = null;
    this.round.strokes = 0;
    this.round.yaw = null;
    this.round.errand = undefined;
    this.startHole(this.round.holeIndex, false);
  }

  private startHole(i: number, restore: boolean) {
    const round = this.round!;
    round.holeIndex = i;
    this.ui.hideScreens();
    // Rebuilt every hole: restoration progress and this round's mole hills change the course.
    this.bootWorld(i);
    this.r.loadHole(this.world);
    this.errand = new ErrandTracker(this.world.def.errand);
    if (restore) this.errand.restore(round.errand);
    else round.errand = undefined;
    round.basketHoles ??= basketHoles(round.seed ?? 1);
    round.basketSeen ??= [];
    this.heldItem = round.item ?? null;
    this.itemArmed = false;
    this.spin = 0;
    this.waitingRescue = false;
    this.refreshErrandChip();
    this.refreshMods();
    const w = round.winds[i];
    this.windMph = w.mph;
    this.windDir = w.dir;
    this.windX = Math.sin(w.dir) * w.mph;
    this.windZ = -Math.cos(w.dir) * w.mph;
    if (restore && round.ball) {
      this.ballX = round.ball.x;
      this.ballZ = round.ball.z;
      this.prevX = round.ball.px;
      this.prevZ = round.ball.pz;
      this.strokes = round.strokes;
    } else {
      this.ballX = this.world.teeX;
      this.ballZ = this.world.teeZ;
      this.prevX = this.ballX;
      this.prevZ = this.ballZ;
      this.strokes = 0;
      round.strokes = 0;
      round.ball = { x: this.ballX, z: this.ballZ, px: this.ballX, pz: this.ballZ };
    }
    this.sim.place(this.ballX, this.ballZ);
    this.r.effects.clearTrail();
    this.overview = false;
    this.ui.setOverview(false);
    this.ui.setHud(true);
    this.ui.setFlying(false);
    this.layout();
    this.prepareAim(restore && round.yaw != null ? round.yaw : null, restore ? round.club : null);
    // Hole intro: show the whole hole, then glide to the ball.
    this.phase = 'intro';
    this.phaseT = 0;
    this.frameOverview();
    this.r.rig.snap();
    this.ui.toastMsg(`Hole ${i + 1} · Par ${this.world.def.par}`, this.world.def.name + ' — ' + this.world.def.blurb, this.store.settings.reducedMotion ? 1300 : 2300);
    this.updateHud();
    this.saveNow();
    this.wake(4);
  }

  private prepareAim(yaw: number | null, club: ClubId | null) {
    this.lie = this.world.surfaceAt(this.ballX, this.ballZ);
    this.setClub(club ?? this.autoClub(), false);
    this.yaw = yaw ?? this.autoYaw();
    this.pullPower = 0;
    this.pulling = false;
    this.meter.cancel();
    this.ui.setSwingLocked(false);
    this.ui.setMeter('idle', 0, 0, 'Hold for power', '');
    this.r.golfer.setSwing(0);
    this.predDirty = true;
    this.r.effects.slopeVisible = this.lie === Surface.Green || this.club === 'putter';
    this.refreshTapLabel();
    this.updateHud();
  }

  private autoClub(): ClubId {
    const d = Math.hypot(this.world.cupX - this.ballX, this.world.cupZ - this.ballZ);
    if (this.lie === Surface.Green) return 'putter';
    if (d < 9 && this.lie !== Surface.Sand && this.lie !== Surface.Rough) return 'putter';
    const mult = (c: ClubId) => lieMultiplier(c, this.lie);
    if (d <= 65 * mult('wedge') + 4) return 'wedge';
    if (d <= 120 * mult('iron')) return 'iron';
    return 'driver';
  }

  private autoYaw(): number {
    const w = this.world;
    const dPin = Math.hypot(w.cupX - this.ballX, w.cupZ - this.ballZ);
    const reach = clubById(this.club).maxCarry * 1.25;
    if (dPin > reach) {
      for (const ap of w.def.aimPoints ?? []) {
        const [ax, az] = toWorld(ap);
        const dAp = Math.hypot(w.cupX - ax, w.cupZ - az);
        const dBall = Math.hypot(ax - this.ballX, az - this.ballZ);
        if (dAp < dPin - 15 && dBall > 25) return yawTo(this.ballX, this.ballZ, ax, az);
      }
    }
    return yawTo(this.ballX, this.ballZ, w.cupX, w.cupZ);
  }

  private setClub(c: ClubId, user: boolean) {
    this.club = c;
    this.ui.setClub(c);
    this.predDirty = true;
    this.refreshTapLabel();
    this.r.effects.slopeVisible = this.lie === Surface.Green || c === 'putter';
    this.ui.setSpin(this.spin, c !== 'putter');
    if (user) this.frameAim(false);
    this.updateHud();
  }

  private refreshTapLabel() {
    if (this.store.settings.swingMode !== 'tap') return;
    const p = this.controls.tapPower;
    this.pullPower = p;
    this.computePrediction(false);
    this.ui.setTapPower(p, this.carryLabel(p));
  }

  private carryLabel(p: number): string {
    const eff = p * lieMultiplier(this.club, this.lie);
    if (this.club === 'putter') return this.pred.valid && this.pred.kind === 'roll' ? `${this.pred.carry.toFixed(1)}y est. roll` : `${Math.round(eff * 30)}y flat roll`;
    // Use the live prediction when available (includes wind and slope).
    const tap = this.store.settings.swingMode === 'tap';
    if (this.pred.valid && (this.pulling || tap)) return `${Math.round(this.pred.carry)}y carry`;
    return `${Math.round(eff * clubById(this.club).maxCarry)}y carry`;
  }

  private beginSwing(power: number, perfect = false) {
    if (this.phase !== 'aim') return;
    this.shotPerfect = perfect;
    this.shotSpin = this.club === 'putter' ? 0 : this.spin;
    this.shotItem = this.itemArmed ? this.heldItem : null;
    this.shotPower = power;
    this.shotYaw = this.yaw;
    this.shotClub = this.club;
    this.phase = 'swing';
    this.phaseT = 0;
    this.swingFrom = this.store.settings.swingMode === 'tap' ? 0 : -power;
    this.launched = false;
    this.overview = false;
    this.ui.setOverview(false);
    this.ui.setFlying(true);
    this.ui.hideSpeech();
    // Final prediction at the exact shot power (also used to frame the flight).
    this.pullPower = power;
    this.computePrediction(false);
    this.audio.swing(power);
    this.wake(5);
  }

  private doLaunch() {
    this.launched = true;
    this.strokes++;
    this.shotStartX = this.ballX;
    this.shotStartZ = this.ballZ;
    this.hitTree = false;
    this.flightSteps = 0;
    this.fastForward = false;
    this.sim.place(this.ballX, this.ballZ);
    launch(this.sim, {
      club: this.shotClub,
      power: this.shotPower,
      yaw: this.shotYaw,
      lie: this.lie,
      windX: this.windX,
      windZ: this.windZ,
      spin: this.shotSpin,
      item: this.shotItem,
    });
    this.errand.shotStart(this.shotClub, this.lie);
    this.hitTag = null;
    this.steerInput = 0;
    if (this.shotItem) {
      // Basket items are single-use.
      this.heldItem = null;
      this.itemArmed = false;
      if (this.round) this.round.item = null;
      this.ui.say(`${ITEMS[this.shotItem].emoji} ${ITEMS[this.shotItem].name}!${this.shotItem === 'bee' ? ' Drag to steer!' : ''}`, 1600);
    }
    this.spin = 0;
    this.refreshMods();
    const reduced = this.store.settings.reducedMotion;
    const big = this.shotPerfect || (this.shotClub === 'driver' && this.shotPower > 0.85);
    // A beat of hit-stop and a little shake sell the impact.
    this.hitStop = reduced || this.shotClub === 'putter' ? 0 : big ? 0.09 : 0.05;
    if (!reduced && big) this.r.rig.shake(this.shotPerfect ? 7 : 4);
    this.r.effects.setTrailColor(this.shotPerfect ? 0xffd23a : 0xffffff);
    if (this.shotClub !== 'putter') this.audio.flightStart();
    this.audio.hit(this.shotClub, this.shotPower);
    if (this.store.settings.haptics) navigator.vibrate?.(14);
    const color = this.lie === Surface.Sand ? 0xf7e0a3 : 0xa6e386;
    const n = this.shotClub === 'putter' ? 0 : this.lie === Surface.Sand ? 14 : 6;
    if (n) this.r.effects.puff(this.ballX, this.sim.y, this.ballZ, color, n, this.lie === Surface.Sand ? 4 : 2.5);
    this.r.effects.clearTrail();
    this.r.effects.hideAim();
    this.ui.hideLanding();
    this.phase = 'flight';
    this.updateHud();
    // However the player got here, the next tip is about the overview.
    if (this.tutorialStep >= 0 && this.tutorialStep <= 2) this.tutorialStep = 3;
  }

  private onSimEvent(e: SimEventId, s: BallSim, surf: SurfaceId, speed: number) {
    const fx = this.r.effects;
    const ff = this.fastForward;
    if (this.errand.event(e, surf, s.lastHit)) this.errandComplete();
    if (e === SimEvent.Land || e === SimEvent.Water || e === SimEvent.OOB) this.audio.flightStop();
    switch (e) {
      case SimEvent.Land:
      case SimEvent.Bounce: {
        const name = surf === Surface.Sand ? 'sand' : surf === Surface.Green ? 'green' : surf === Surface.Rough ? 'rough' : 'fairway';
        if (!ff || e === SimEvent.Land) this.audio.land(name, speed);
        if (speed > 3) {
          const col = surf === Surface.Sand ? 0xf7e0a3 : surf === Surface.Green ? 0xc4f59c : 0x8fd67a;
          fx.puff(s.x, s.y - BALL_RADIUS, s.z, col, surf === Surface.Sand ? 12 : 5, Math.min(5, 1 + speed * 0.15));
        }
        break;
      }
      case SimEvent.Collide: {
        const tag = s.lastHit?.tag ?? 'tree';
        this.hitTag = tag;
        const scen = this.r.scenery;
        if (tag === 'sheep') {
          this.audio.boing();
          fx.puff(s.x, s.y, s.z, 0xfff4dc, 10, 3);
          const a = scen?.nearestAnimal(s.x, s.z, 6);
          if (a) scen?.reactOne(a, 'cheer');
        } else if (tag === 'mole') {
          this.audio.molePop();
          scen?.molePop(s.x, s.z);
          fx.puff(s.x, s.y, s.z, 0x8a5d3c, 8, 3);
        } else {
          this.hitTree = true;
          this.audio.tree();
          fx.puff(s.x, s.y, s.z, tag === 'apple' ? 0xff5a4e : tag === 'windmill' || tag === 'sails' ? 0xfff4dc : 0x5fbf6a, 8, 3);
          if (!this.store.settings.reducedMotion) this.r.rig.shake(3);
        }
        break;
      }
      case SimEvent.Skip:
        this.audio.skip();
        fx.puff(s.x, s.y, s.z, 0xe9fbff, 8, 3);
        this.r.scenery?.scatter(s.x, s.z);
        break;
      case SimEvent.Water:
        this.r.scenery?.scatter(s.x, s.z);
        this.audio.quack();
        this.audio.splash();
        fx.puff(s.x, s.y, s.z, 0xe9fbff, 16, 6);
        fx.puff(s.x, s.y, s.z, 0x63c3e6, 10, 4);
        break;
      case SimEvent.Lip:
        this.audio.lip();
        break;
      case SimEvent.Cup:
        this.audio.cup();
        break;
    }
  }

  private endOfShot() {
    const s = this.sim;
    const fx = this.r.effects;
    this.phase = 'settle';
    this.phaseT = 0;
    const scen = this.r.scenery;
    const w = this.world;
    if (s.state === BallState.Holed) {
      this.phase = 'holed';
      this.phaseT = 0;
      const scale = Math.max(1, this.r.rig.scale * 12);
      fx.celebrate(w.cupX, w.heightAt(w.cupX, w.cupZ), w.cupZ, scale, this.store.settings.reducedMotion);
      scen?.react('cheer');
      this.audio.cheer();
      if (this.errand.holed()) this.errandComplete();
      const name = scoreName(this.strokes, w.def.par);
      if (this.strokes === 1) {
        // Hole in one: the whole meadow goes wild.
        this.ui.stamp('HOLE IN ONE!', 2600);
        if (!this.store.settings.reducedMotion) {
          this.ui.flash();
          this.r.rig.shake(8);
          for (const d of [500, 1000]) window.setTimeout(() => fx.celebrate(w.cupX, w.heightAt(w.cupX, w.cupZ), w.cupZ, scale * 1.4, false), d);
        }
        this.audio.fanfare(true);
        this.phaseT = -1.2;
      } else if (this.strokes < w.def.par) this.ui.stamp(name);
      this.ui.say(name, 2400);
      this.ui.setSkipHint(true);
      this.r.effects.flag.visible = false;
      this.wake(4);
      return;
    }
    if (s.state === BallState.Water || s.state === BallState.OOB) {
      scen?.react('gasp', { x: s.x, z: s.z });
      this.audio.aww();
      const left = this.rescuesLeft();
      if (s.state === BallState.Water && left > 0) {
        // Pip offers to fly in and fetch it: a free retake, limited per round.
        this.waitingRescue = true;
        this.ui.choice(
          `Splash! I can fly in and fetch it: no penalty, replay from your last spot. (${left} left this round)`,
          'Fetch it, Pip!',
          'Take the drop',
          () => this.pipRescue(),
          () => {
            this.waitingRescue = false;
            this.phaseT = 99;
          },
        );
        return;
      }
      this.ui.say(pick(s.state === BallState.Water ? LINES.water : LINES.oob), 2200);
      return;
    }
    // Resting reactions.
    const d = Math.hypot(w.cupX - s.x, w.cupZ - s.z);
    const surf = w.surfaceAt(s.x, s.z);
    const travelled = Math.hypot(s.x - this.shotStartX, s.z - this.shotStartZ);
    if (this.errand.rest(s.x, s.z, surf)) this.errandComplete();
    const near = scen?.nearestAnimal(s.x, s.z, 4.5);
    if (near && near.kind !== 'duck') {
      // Boop!
      scen?.reactOne(near, 'cheer');
      this.audio.boop();
      this.ui.say(`Boop! The ${near.kind} says hi.`, 1600);
    } else if (this.hitTag === 'sheep') {
      this.ui.say('Boing! Woolly trampoline!', 1600);
    } else if (this.hitTag === 'mole') {
      this.ui.say('A mole popped it up!', 1600);
    } else if (this.hitTag === 'sails') {
      this.ui.say('Swatted by the windmill!', 1600);
    } else if (this.hitTree) {
      this.ui.say(pick(LINES.tree), 1800);
      scen?.react('gasp', { x: s.x, z: s.z });
    } else if (surf === Surface.Green && d < 2.5 && this.shotClub !== 'putter') {
      this.ui.say(pick(LINES.great), 1800);
      scen?.react('cheer');
      this.audio.cheer();
    } else if (surf === Surface.Green && d < 4) {
      this.ui.say(pick(LINES.close), 1600);
      if (this.shotClub === 'putter') this.audio.aww();
    } else if (surf === Surface.Sand) {
      this.ui.say(pick(LINES.sand), 1600);
      scen?.react('gasp', { x: s.x, z: s.z });
    } else if (surf === Surface.Green && this.shotClub !== 'putter') {
      this.ui.say(pick(LINES.green), 1400);
      if (travelled > 60) scen?.react('cheer', { x: s.x, z: s.z });
    } else if (this.shotClub === 'driver' && surf === Surface.Fairway && travelled > 160) {
      this.ui.say(pick(LINES.drive), 1400);
      this.audio.chirp();
    } else if (surf === Surface.Rough && this.shotClub !== 'putter') {
      this.ui.say(pick(LINES.rough), 1300);
    }
  }

  // ------------------------------------------------------------------ the fun layer
  private enterAim() {
    this.phase = 'aim';
    this.ui.hideScreens();
    this.frameAim(false);
    this.updateHud();
    this.maybeStartTutorial();
    this.pipRead();
    this.wake(3);
  }

  /** Twice a round (practice: only where the hole's errand needs a snack). */
  private basketDue(): boolean {
    const r = this.round;
    if (!r) return false;
    const i = r.holeIndex;
    if (r.basketSeen?.includes(i)) return false;
    if (r.mode === 'practice') return !!this.world.def.basketGuarantee && r.item !== this.world.def.basketGuarantee;
    return !!r.basketHoles?.includes(i);
  }

  private openBasket() {
    const round = this.round!;
    const i = round.holeIndex;
    this.phase = 'basket';
    round.basketSeen = [...(round.basketSeen ?? []), i];
    const guarantee = round.mode === 'practice' ? this.world.def.basketGuarantee : basketGuaranteeFor(round.basketHoles ?? [], i);
    const offer = offerItems(round.seed ?? 1, i, guarantee, this.heldItem);
    const held = this.heldItem ? ITEMS[this.heldItem] : null;
    const nth = round.mode === 'practice' ? '' : (round.basketHoles ?? []).indexOf(i) === 0 ? 'Basket 1 of 2 this round.' : 'Last basket this round!';
    this.ui.showBasket(
      offer.map((id) => ITEMS[id]),
      held ? `${nth} You’re still carrying ${held.emoji} ${held.name}: picking swaps it.` : nth,
      held ? `Keep ${held.emoji} ${held.name.split(' ')[0]}` : 'No thanks',
      (id) => {
        this.audio.tap();
        // "No thanks" keeps whatever you were carrying.
        if (id) round.item = id as ItemId;
        this.heldItem = round.item ?? null;
        this.itemArmed = false;
        this.refreshMods();
        this.saveNow();
        this.enterAim();
        if (id === 'acorn' && i < ACORN_HOLE) this.ui.say('🌰 Psst: the ducks on hole 7 love a skipping acorn. Maybe save it?', 3200);
        else if (id) this.ui.say(`${ITEMS[id as ItemId].emoji} Tap the basket button to use it on a shot. It keeps until you do.`, 2800);
      },
    );
  }

  private toggleItem() {
    if (!this.canAim() || !this.heldItem) return;
    this.itemArmed = !this.itemArmed;
    this.predDirty = true;
    this.audio.tap();
    this.refreshMods();
    if (this.itemArmed) this.ui.say(`${ITEMS[this.heldItem].emoji} ${ITEMS[this.heldItem].desc}`, 2200);
  }

  private cycleSpin() {
    if (!this.canAim() || this.club === 'putter') return;
    this.spin = this.spin === 0 ? 1 : this.spin === 1 ? -1 : 0;
    this.predDirty = true;
    this.audio.tap();
    this.refreshMods();
    this.ui.say(this.spin > 0 ? 'Topspin: it’ll run out after landing.' : this.spin < 0 ? 'Backspin: it’ll bite and check up.' : 'No spin.', 1500);
  }

  private refreshMods() {
    const it = this.heldItem ? ITEMS[this.heldItem] : null;
    this.ui.setItem(it ? it.emoji : null, it ? it.name.split(' ')[0] : '', this.itemArmed);
    this.ui.setSpin(this.spin, this.club !== 'putter');
  }

  private refreshErrandChip() {
    const e = this.world.def.errand;
    this.ui.setErrand(WHO[e.who][0], `${WHO[e.who][1]}: “${e.text}”`, this.errand.s.done, this.errand.s.failed);
  }

  private errandComplete() {
    const e = this.world.def.errand;
    this.ui.stamp('Errand done! ★', 1600);
    window.setTimeout(() => this.audio.unlockChime(), 250);
    const scen = this.r.scenery;
    const who = scen?.animals.find((a) => a.kind === e.who);
    if (who) scen?.reactOne(who, 'cheer');
    this.ui.say(`${WHO[e.who][0]} ${pick(LINES.thanks)}`, 1800);
    this.refreshErrandChip();
    if (this.round) this.round.errand = { ...this.errand.s };
  }

  private rescuesLeft(): number {
    const max = restoredSet(this.store.bests.stars).has('nest') ? 2 : 1;
    return Math.max(0, max - (this.round?.rescues ?? 0));
  }

  private pipRescue() {
    const round = this.round!;
    round.rescues = (round.rescues ?? 0) + 1;
    this.waitingRescue = false;
    // The splashed stroke doesn't count.
    this.strokes = Math.max(0, this.strokes - 1);
    this.ballX = this.shotStartX;
    this.ballZ = this.shotStartZ;
    this.sim.place(this.ballX, this.ballZ);
    this.audio.chirp();
    this.ui.toastMsg('Pip fetched it!', 'Free retake from your last spot.', 2200);
    this.phase = 'aim';
    this.ui.setFlying(false);
    this.prepareAim(this.shotYaw, this.shotClub);
    this.frameAim(false);
    this.saveNow();
    this.wake(3);
  }

  /** Pip reads the shot: wind and trouble on the calm-air line. */
  private pipRead() {
    if (this.tutorialStep >= 0 || this.club === 'putter' || this.phase !== 'aim') return;
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const cross = this.windX * cy + this.windZ * sy;
    const along = this.windX * sy - this.windZ * cy;
    predict(this.scratch, this.ballX, this.ballZ, { club: this.club, power: 1, yaw: this.yaw, lie: this.lie, windX: 0, windZ: 0 }, this.pred);
    this.predDirty = true;
    let msg = '';
    if (this.pred.valid && this.pred.surface === Surface.Water) msg = 'Careful: full power on this line finds the pond!';
    else if (this.pred.valid && this.pred.surface === Surface.OOB) msg = 'Full power on this line goes out of bounds!';
    else if (Math.abs(cross) >= 3) msg = `Wind’s pushing ${cross > 0 ? 'right' : 'left'}. Aim a touch ${cross > 0 ? 'left' : 'right'}.`;
    else if (along <= -3) msg = 'Into the wind: it’ll come up short. Club up!';
    else if (along >= 3) msg = 'Wind at your back: it’ll fly!';
    if (msg) this.ui.say(`🐦 ${msg}`, 2800);
  }

  private openClub() {
    const b = this.store.bests;
    const stars = totalStars(b.stars);
    const render = () =>
      this.ui.showClub({
        stars,
        maxStars: 27,
        errands: errandsDone(b.stars),
        projects: PROJECTS.map((p) => ({ name: p.name, effect: p.effect, hint: p.hint, done: p.unlocked(b.stars) })),
        caps: CAPS,
        scarves: SCARVES,
        cap: this.store.settings.cap,
        scarf: this.store.settings.scarf,
        onCap: (id) => {
          this.store.updateSettings({ cap: id });
          this.applySettings();
          this.audio.tap();
          render();
        },
        onScarf: (id) => {
          this.store.updateSettings({ scarf: id });
          this.applySettings();
          this.audio.tap();
          render();
        },
      });
    render();
    this.ui.show('scrClub', 'scrTitle');
  }

  /** Called after the settle pause: apply penalties, place the ball, save, next aim. */
  private resolveShot() {
    const s = this.sim;
    const w = this.world;
    let msg: [string, string] | null = null;
    if (s.state === BallState.Water) {
      this.strokes++;
      const drop = waterDrop(w, s.lastDryX, s.lastDryZ, this.shotStartX, this.shotStartZ);
      this.prevX = this.shotStartX;
      this.prevZ = this.shotStartZ;
      this.ballX = drop.x;
      this.ballZ = drop.z;
      msg = ['Penalty: +1 stroke', drop.kind === 'zone' ? 'Ball dropped in the drop zone.' : drop.kind === 'line' ? 'Dropped behind where it entered the water.' : 'Replaying from the last spot.'];
      this.audio.penalty();
    } else if (s.state === BallState.OOB) {
      this.strokes++;
      const drop = oobDrop(this.shotStartX, this.shotStartZ);
      this.ballX = drop.x;
      this.ballZ = drop.z;
      msg = ['Out of bounds: +1 stroke', 'Replaying from the last spot.'];
      this.audio.penalty();
    } else {
      this.prevX = this.shotStartX;
      this.prevZ = this.shotStartZ;
      this.ballX = s.x;
      this.ballZ = s.z;
    }
    this.sim.place(this.ballX, this.ballZ);
    if (this.strokes >= MAX_STROKES) {
      this.ui.toastMsg('Let’s pick that one up!', `${MAX_STROKES} strokes is the limit.`, 2200);
      this.finishHole();
      return;
    }
    if (msg) this.ui.toastMsg(msg[0], msg[1], 2600);
    this.phase = 'aim';
    this.ui.setFlying(false);
    this.prepareAim(null, null);
    this.frameAim(false);
    this.refreshErrandChip();
    this.saveNow();
    if (this.tutorialStep === 3 || (this.tutorialStep === 4 && this.lie === Surface.Green)) this.showTutorial();
    else if (!msg) window.setTimeout(() => this.pipRead(), 900);
  }

  private finishHole() {
    const round = this.round!;
    const i = round.holeIndex;
    round.scores[i] = this.strokes;
    round.holeDone = true;
    round.strokes = this.strokes;
    this.phase = 'holeDone';
    this.ui.setSkipHint(false);
    const par = this.world.def.par;
    if (round.mode === 'round') {
      this.store.updateBests((b) => {
        if (b.bestHole[i] == null || this.strokes < (b.bestHole[i] as number)) b.bestHole[i] = this.strokes;
      });
      this.store.setRound(round);
    }
    // Stars (practice counts too) and anything they unlock.
    const mask = holeStars(this.strokes, par, this.errand.s.done);
    const before = totalStars(this.store.bests.stars);
    const beforeProjects = restoredSet(this.store.bests.stars);
    this.store.updateBests((b) => {
      b.stars[i] = (b.stars[i] ?? 0) | mask;
    });
    const after = totalStars(this.store.bests.stars);
    const unlocks: string[] = [];
    for (const p of PROJECTS) if (p.unlocked(this.store.bests.stars) && !beforeProjects.has(p.id)) unlocks.push(`🔨 Club project done: ${p.name}! ${p.effect}`);
    for (const c of CAPS) if (c.need > before && c.need <= after) unlocks.push(`🧢 New cap: ${c.name}`);
    for (const c of SCARVES) if (c.need > before && c.need <= after) unlocks.push(`🧣 New scarf for Pip: ${c.name}`);
    this.ui.setHoleExtras(mask, this.world.def.errand.text, unlocks);
    if (unlocks.length) window.setTimeout(() => this.audio.unlockChime(), 600);
    const name = scoreName(this.strokes, par);
    const t = roundTotals(round.scores, HOLES.map((h) => h.par));
    this.ui.showHoleDone(
      name,
      `${this.strokes} stroke${this.strokes === 1 ? '' : 's'} · Par ${par}` + (round.mode === 'round' ? ` · Round ${formatToPar(t.toPar)}` : ''),
      this.cardScores(),
      i,
      round.mode === 'practice' ? 'Play it again' : i >= 8 ? 'See results' : 'Next hole',
    );
    this.audio.fanfare(this.strokes <= par);
    this.ui.setFlying(true);
    this.updateHud();
  }

  private nextHole() {
    if (this.phase !== 'holeDone' || !this.round) return;
    const round = this.round;
    if (round.mode === 'practice') {
      this.round.scores = Array(9).fill(null);
      this.round.holeDone = false;
      this.round.ball = null;
      this.round.basketSeen = [];
      this.startHole(this.practiceHole, false);
      return;
    }
    if (round.holeIndex >= 8) return this.showResults();
    round.holeIndex++;
    round.holeDone = false;
    round.ball = null;
    round.strokes = 0;
    round.yaw = null;
    round.errand = undefined;
    this.startHole(round.holeIndex, false);
  }

  private showResults() {
    const round = this.round ?? this.store.round;
    if (!round) return this.showTitle();
    this.phase = 'results';
    const pars = HOLES.map((h) => h.par);
    const t = roundTotals(round.scores, pars);
    let best = false;
    this.store.updateBests((b) => {
      b.roundsPlayed++;
      if (t.played === 9 && (b.bestRound == null || t.strokes < b.bestRound)) {
        b.bestRound = t.strokes;
        b.bestToPar = t.toPar;
        best = true;
      }
    });
    this.store.setRound(null);
    this.ui.showResults(t.strokes, formatToPar(t.toPar), best ? 'New best round! 🎉' : this.store.bests.bestRound != null ? `Best: ${this.store.bests.bestRound}` : '', round.scores);
    this.ui.setHud(false);
    this.layout();
  }

  private cardScores(): (number | null)[] {
    return this.round ? this.round.scores.slice() : Array(9).fill(null);
  }

  private saveNow() {
    const round = this.round;
    if (!round || round.mode !== 'round') return;
    if (this.phase === 'aim' || this.phase === 'intro') {
      round.ball = { x: this.ballX, z: this.ballZ, px: this.prevX, pz: this.prevZ };
      round.strokes = this.strokes;
      round.club = this.club;
      round.yaw = this.yaw;
    }
    // Mid-shot, the last resolved state (already in round) is what persists.
    if (this.errand) round.errand = { ...this.errand.s };
    this.store.setRound(round);
  }

  // ------------------------------------------------------------------ pause / visibility
  private openPause() {
    if (this.phase === 'title' || this.phase === 'results') return;
    this.controls.cancelAll();
    this.cancelMeter();
    this.paused = true;
    this.ui.$('pRestart').classList.toggle('hidden', this.round?.mode !== 'practice');
    this.ui.show('scrPause');
  }

  private closePause() {
    this.paused = false;
    this.ui.hideScreens();
    if (this.phase === 'holeDone') this.ui.show('scrHole');
    this.wake();
  }

  private onVisibility() {
    if (document.hidden) {
      this.hidden = true;
      this.controls.cancelAll();
      this.cancelMeter();
      this.saveNow();
      this.audio.suspend();
      cancelAnimationFrame(this.rafId);
    } else {
      this.hidden = false;
      this.audio.resume();
      this.lastFrame = performance.now();
      this.layout();
      this.wake(3);
      cancelAnimationFrame(this.rafId);
      this.rafId = requestAnimationFrame((t) => this.frame(t));
    }
  }

  private onContextLost() {
    this.controls.cancelAll();
    this.ui.show('scrLost');
  }

  private onContextRestored() {
    this.r.loadHole(this.world);
    this.r.effects.setHole(this.world);
    this.ui.$('scrLost').classList.add('hidden');
    if (this.phase === 'title') this.ui.show('scrTitle');
    this.wake(3);
  }

  // ------------------------------------------------------------------ camera
  layout() {
    // Resize and rotation interrupt uncommitted gestures without a stroke.
    this.controls.cancelAll();
    const vv = window.visualViewport;
    const h = vv ? vv.height : window.innerHeight;
    document.documentElement.style.setProperty('--app-h', `${Math.round(h)}px`);
    const app = this.ui.root;
    const ar = app.getBoundingClientRect();
    this.r.resize(ar.width, ar.height);
    if (this.ui.hudVisible) {
      const cr = this.ui.$('course').getBoundingClientRect();
      this.r.rig.rect = { x: cr.left - ar.left, y: cr.top - ar.top, w: cr.width, h: cr.height };
    } else {
      this.r.rig.rect = { x: 0, y: 0, w: ar.width, h: ar.height };
    }
    // Orientation may flip the meter between horizontal and upright.
    if (!this.meter.active) this.ui.setMeter('idle', 0, 0, 'Hold for power', '');
    this.reframe();
    this.r.rig.snap();
    this.r.rig.apply();
    this.wake();
  }

  private reframe() {
    if (this.phase === 'title' || this.phase === 'results') this.frameTitle(false);
    else if (this.overview || this.phase === 'intro') this.frameOverview();
    else if (this.phase === 'aim' || this.phase === 'swing') this.frameAim(false);
  }

  private framePts = new Float32Array(3 * 40);

  private frameTitle(snap: boolean) {
    const w = this.world;
    const pts = this.framePts;
    const tee = [w.teeX, w.heightAt(w.teeX, w.teeZ), w.teeZ];
    const pin = [w.cupX, w.heightAt(w.cupX, w.cupZ), w.cupZ];
    pts.set(tee, 0);
    pts.set(pin, 3);
    const baseYaw = yawTo(w.teeX, w.teeZ, w.cupX, w.cupZ);
    this.r.rig.frame(pts, 2, baseYaw + this.titleYaw, { padTop: this.r.rig.rect.h * 0.3, padBottom: this.r.rig.rect.h * 0.25, padSide: 10 });
    if (snap) this.r.rig.snap();
  }

  private frameOverview() {
    const w = this.world;
    const pts = this.framePts;
    let n = 0;
    const add = (x: number, z: number) => {
      if (n >= 40) return;
      pts[n * 3] = x;
      pts[n * 3 + 1] = w.heightAt(x, z);
      pts[n * 3 + 2] = z;
      n++;
    };
    add(w.teeX, w.teeZ);
    add(w.cupX, w.cupZ);
    add(this.ballX, this.ballZ);
    for (const f of [...w.fairways, w.green]) {
      add(f.minX, f.minZ);
      add(f.maxX, f.maxZ);
      add(f.minX, f.maxZ);
      add(f.maxX, f.minZ);
    }
    for (const b of w.water) add(b.shape.cx, b.shape.cz);
    const yaw = yawTo(w.teeX, w.teeZ, w.cupX, w.cupZ);
    this.r.rig.frame(pts, n, yaw, { padTop: 70, padBottom: 24, padSide: 14 });
  }

  /** Aim view: ball near the bottom of the course rect, landing context above it. */
  private frameAim(snap: boolean) {
    if (this.overview) return; // Free look: the player owns the camera.
    const w = this.world;
    const pts = this.framePts;
    const by = w.heightAt(this.ballX, this.ballZ);
    const dx = Math.sin(this.yaw);
    const dz = -Math.cos(this.yaw);
    let n = 0;
    const put = (x: number, y: number, z: number) => {
      pts[n * 3] = x;
      pts[n * 3 + 1] = y;
      pts[n * 3 + 2] = z;
      n++;
    };
    put(this.ballX, by, this.ballZ);
    put(this.ballX - dx * 3, by, this.ballZ - dz * 3);
    if (this.club === 'putter') {
      const dc = Math.hypot(w.cupX - this.ballX, w.cupZ - this.ballZ);
      const reach = Math.max(8, Math.min(34, dc + 4));
      put(this.ballX + dx * reach, by, this.ballZ + dz * reach);
      if (dc < 36) put(w.cupX, w.heightAt(w.cupX, w.cupZ), w.cupZ);
      this.computePrediction(!this.pulling && this.store.settings.swingMode !== 'tap');
      if (this.pred.valid) {
        const stride = Math.max(1, Math.ceil(this.pred.count / 12));
        for (let i = 0; i < this.pred.count; i += stride) put(this.pred.path[i * 3], this.pred.path[i * 3 + 1], this.pred.path[i * 3 + 2]);
        put(this.pred.x, this.pred.y, this.pred.z);
      }
      this.r.rig.frame(pts, n, this.yaw, { padTop: this.topPad(), padBottom: 96, padSide: 40, minExtent: 16, maxScale: 0.2 });
    } else {
      // Frame the full-power reach along the aim line, so the whole possible landing area is visible.
      const reach = clubById(this.club).maxCarry * lieMultiplier(this.club, this.lie) * 1.05;
      put(this.ballX + dx * reach, by, this.ballZ + dz * reach);
      const dc = Math.hypot(w.cupX - this.ballX, w.cupZ - this.ballZ);
      if (dc < reach * 1.15) put(w.cupX, w.heightAt(w.cupX, w.cupZ), w.cupZ);
      this.r.rig.frame(pts, n, this.yaw, { padTop: this.topPad(), padBottom: 36, padSide: 26, minExtent: 34, maxScale: 0.55 });
    }
    if (snap) this.r.rig.snap();
  }

  /** Keep framed content clear of the corner chips and of Pip's tutorial bubble. */
  private topPad(): number {
    return this.tutorialStep >= 0 ? Math.max(80, this.ui.speechBottom() + 24) : 80;
  }

  private frameFlight() {
    const s = this.sim;
    const w = this.world;
    const pts = this.framePts;
    let n = 0;
    const put = (x: number, y: number, z: number) => {
      pts[n * 3] = x;
      pts[n * 3 + 1] = y;
      pts[n * 3 + 2] = z;
      n++;
    };
    put(s.x, s.y, s.z);
    if (s.state === BallState.Air && !s.landed && this.pred.valid) put(this.pred.x, this.pred.y, this.pred.z);
    const dc = Math.hypot(w.cupX - s.x, w.cupZ - s.z);
    if (dc < 30) put(w.cupX, w.heightAt(w.cupX, w.cupZ), w.cupZ);
    const putt = this.shotClub === 'putter';
    // Swing round to a low side-on view so the arc reads; putts stay behind the ball.
    const side = !putt && !this.store.settings.reducedMotion;
    const yaw = side ? this.shotYaw + 0.55 : this.shotYaw;
    const pitch = side ? (s.state === BallState.Air ? FLIGHT_PITCH : FLIGHT_PITCH + 0.15) : PITCH;
    this.r.rig.frame(pts, n, yaw, { padTop: 70, padBottom: 60, padSide: 40, minExtent: putt ? 18 : 70, maxScale: 0.5, pitch });
  }

  private lookZoom(f: number) {
    if (!this.overview) return;
    this.r.rig.zoomBy(f);
    this.wake();
  }

  /** Keep the free camera over the course. */
  private clampLook() {
    const w = this.world;
    const rig = this.r.rig;
    rig.fx = rig.tfx = Math.max(w.minX + 20, Math.min(w.maxX - 20, rig.fx));
    rig.fz = rig.tfz = Math.max(w.minZ + 20, Math.min(w.maxZ - 20, rig.fz));
  }

  private toggleOverview() {
    if (!(this.phase === 'aim' || this.phase === 'intro')) return;
    if (this.phase === 'intro') {
      this.phaseT = 99;
      return;
    }
    this.overview = !this.overview;
    this.ui.setOverview(this.overview);
    this.audio.tap();
    if (this.overview) this.frameOverview();
    else this.frameAim(false);
    if (this.tutorialStep === 3) this.tutorialNext();
    this.wake(3);
  }

  // ------------------------------------------------------------------ prediction
  private previewPower(ghost: boolean): number {
    if (ghost && this.club === 'putter') {
      const toCup = Math.hypot(this.world.cupX - this.ballX, this.world.cupZ - this.ballZ);
      return Math.min(1, (toCup + 1.5) / clubById('putter').maxCarry);
    }
    return ghost ? 1 : this.store.settings.swingMode === 'tap' && !this.pulling && this.phase === 'aim' ? this.controls.tapPower : this.pullPower;
  }

  private computePrediction(ghost: boolean) {
    let power = this.previewPower(ghost);
    // The green read assumes a centred strike, including the existing perfect-strike bonus.
    // beginSwing has already applied that bonus, so never apply it twice.
    if (this.club === 'putter' && this.store.settings.swingMode === 'meter' && (this.phase === 'aim' || this.phase === 'intro')) power *= 1.06;
    const item = this.itemArmed ? this.heldItem : null;
    let key = '';
    if (this.club === 'putter') {
      key = `${this.ballX},${this.ballZ},${this.yaw},${power},${item}`;
      if (this.pred.kind === 'roll' && this.pred.valid && this.puttPredictionWorld === this.world) {
        if (key === this.puttPredictionKey) return;
        // Limit charging previews to 30 Hz on phones; release and aim changes resolve exactly.
        if (this.meter.stage === 'power' && this.time - this.puttPredictionAt < 1 / 30) return;
      }
    }
    // Airborne previews remain calm-air carry estimates; putting uses the real roll model.
    predict(
      this.scratch,
      this.ballX,
      this.ballZ,
      { club: this.club, power, yaw: this.yaw, lie: this.lie, windX: this.club === 'putter' ? this.windX : 0, windZ: this.club === 'putter' ? this.windZ : 0, spin: this.spin, item: this.itemArmed ? this.heldItem : null },
      this.pred,
    );
    if (this.club === 'putter') {
      this.puttPredictionKey = key;
      this.puttPredictionWorld = this.world;
      this.puttPredictionAt = this.time;
    }
  }

  private refreshAimVisuals() {
    const fx = this.r.effects;
    const s = this.r.rig.scale;
    const dot = s * 3;
    const tapMode = this.store.settings.swingMode === 'tap';
    const ghost = !this.pulling && !tapMode;
    if (this.club === 'putter') {
      if (this.predDirty) {
        this.computePrediction(ghost);
        this.predDirty = false;
      }
      fx.showPutt(this.pred, dot, ghost);
      if (this.pred.valid) {
        const read = puttingRead(this.pred);
        const power = this.previewPower(ghost);
        const mode = ghost ? 'Preview' : this.meter.stage === 'power' ? 'Charging' : this.meter.active ? 'Locked' : this.pulling ? 'Live' : 'Selected';
        const strike = this.store.settings.swingMode === 'meter' ? 'Perfect-strike estimate' : 'Straight-strike estimate';
        this.ui.showPuttingRead(read, `${mode} · ${Math.round(power * 100)}% power`, strike);
        if (this.overview) this.ui.hidePuttingRead();
        this.ui.showLanding(this.r.rig, this.pred.x, this.pred.y, this.pred.z, read.stop, ghost);
      } else {
        this.ui.hidePuttingRead();
        this.ui.hideLanding();
      }
      return;
    }
    this.ui.hidePuttingRead();
    if (this.predDirty) {
      this.computePrediction(ghost);
      this.predDirty = false;
    }
    fx.showAim(this.pred, dot, ghost);
    fx.hidePutt();
    if (this.pred.valid) {
      const label = ghost ? `max ${Math.round(this.pred.carry)}y` : `${Math.round(this.pred.carry)}y`;
      this.ui.showLanding(this.r.rig, this.pred.x, this.pred.y, this.pred.z, label + (this.pred.surface === Surface.Water ? ' 💧' : this.pred.surface === Surface.OOB ? ' OB' : ''), ghost);
    } else this.ui.hideLanding();
  }

  // ------------------------------------------------------------------ HUD
  private updateHud() {
    const w = this.world;
    const round = this.round;
    const t = round ? roundTotals(round.scores, HOLES.map((h) => h.par)) : null;
    const d = Math.hypot(w.cupX - this.ballX, w.cupZ - this.ballZ);
    const lieName = SURFACES[this.lie].name;
    const mult = lieMultiplier(this.club, this.lie);
    const lieTxt = mult < 1 ? `${lieName} · −${Math.round((1 - mult) * 100)}% power` : lieName;
    this.ui.setHudText({
      hole: `Hole ${w.def.number}`,
      name: w.def.name,
      par: `Par ${w.def.par}`,
      stroke: `Stroke ${Math.max(1, Math.min(MAX_STROKES, this.phase === 'flight' || this.phase === 'settle' || this.phase === 'holed' ? this.strokes : this.strokes + 1))}`,
      total: round?.mode === 'practice' ? 'Practice' : t && t.played ? formatToPar(t.toPar) : 'E',
      pin: `To pin ${Math.round(d)}y`,
      lie: lieTxt,
      lieBad: mult < 1,
      wind: this.windMph,
    });
  }

  // ------------------------------------------------------------------ tutorial
  private maybeStartTutorial() {
    if (this.store.settings.tutorialDone || this.round?.mode !== 'round' || this.round.holeIndex !== 0 || this.strokes > 0) return;
    this.tutorialStep = 0;
    this.aimSinceTutorial = 0;
    this.showTutorial();
  }

  private showTutorial() {
    const steps = [
      { t: 'Hi, I’m Pip, your caddie! Drag along the aim bar — or anywhere on the course — to point your shot.', btn: false },
      { t: 'The yellow dots show where the ball lands in calm air. The wind (top right) will push it, so allow for it! Clubs live down below.', btn: true },
      {
        t:
          this.store.settings.swingMode === 'meter'
            ? 'Hold SWING to build power, then release. Tap SWING again when the returning marker reaches the green mark. Early pulls left; late pushes right!'
            : this.store.settings.swingMode === 'tap'
              ? 'Set power with − and +, then press Swing!'
              : 'Now pull down on the green swing pad. Further = more power. Slide back up to cancel, let go to hit!',
        btn: false,
      },
      { t: 'Lovely! Tap Look any time to see the whole hole. Drag to look around, pinch to zoom, twist to turn.', btn: true },
      { t: 'The dotted putting line follows the slope. Pip’s green read shows the break and estimated stop. Watch it change as you hold for power!', btn: true },
    ];
    const s = steps[this.tutorialStep];
    if (!s) return this.endTutorial();
    if (this.tutorialStep === 4 && this.lie !== Surface.Green) return;
    this.ui.tutorial(s.t, s.btn);
    if (this.phase === 'aim') this.frameAim(false);
  }

  private tutorialNext() {
    if (this.tutorialStep < 0) return;
    this.tutorialStep++;
    if (this.tutorialStep > 4) return this.endTutorial();
    this.ui.hideSpeech();
    // Steps 3 and 4 wait for the right moment (after the first shot / on the green).
    if (this.tutorialStep === 3 && this.phase !== 'aim') return;
    if (this.tutorialStep === 4) {
      if (this.lie === Surface.Green) this.showTutorial();
      return;
    }
    this.showTutorial();
  }

  private endTutorial() {
    this.tutorialStep = -1;
    this.ui.hideSpeech();
    this.store.updateSettings({ tutorialDone: true });
    if (this.phase === 'aim') this.frameAim(false);
  }

  // ------------------------------------------------------------------ main loop
  private frame(now: number) {
    if (this.hidden) return;
    this.rafId = requestAnimationFrame((t) => this.frame(t));
    const rawDt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    const dt = Math.min(0.1, Math.max(0, rawDt));
    const busy = this.time < this.activeUntil || this.phase === 'flight' || this.phase === 'swing' || this.phase === 'holed' || this.phase === 'intro' || this.phase === 'settle';
    // Idle: throttle to ~20 fps to save battery (ambient animation only).
    if (!busy) {
      this.idleAcc += dt;
      if (this.idleAcc < 0.05) return;
    }
    const step = busy ? dt : Math.min(0.1, this.idleAcc);
    this.idleAcc = 0;
    if (!this.paused) this.update(step);
    else this.time += step;
    this.render(step);
    if (busy && this.store.settings.quality === 'auto') this.trackPerf(rawDt);
  }

  private trackPerf(dt: number) {
    if (dt <= 0 || dt > 0.25) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    const sorted = this.frameTimes.slice().sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    this.frameTimes.length = 0;
    if (this.time < this.qualityCheckAt) return;
    // Below ~40 fps: step down resolution/detail (physics and controls are unaffected).
    if (median > 1 / 40 && this.r.quality > 0) {
      this.r.setQuality((this.r.quality - 1) as QualityLevel);
      this.qualityCheckAt = this.time + 4;
    }
  }

  private update(dt: number) {
    this.time += dt;
    this.phaseT += dt;
    const reduced = this.store.settings.reducedMotion;
    switch (this.phase) {
      case 'title':
      case 'results':
        if (!reduced) {
          this.titleYaw = Math.sin(this.time * 0.08) * 0.35;
          this.frameTitle(false);
          this.wake(0.2);
        }
        break;
      case 'intro':
        if (this.phaseT > (reduced ? 1.0 : 2.2)) {
          if (this.basketDue()) {
            this.openBasket();
            break;
          }
          this.enterAim();
        }
        break;
      case 'aim':
        if (this.meter.active) {
          const r = this.meter.update(dt);
          const m = this.meter;
          this.pullPower = m.stage === 'power' ? Math.max(0, m.u) : m.power;
          this.predDirty = true;
          if (this.club === 'putter') { this.computePrediction(false); this.predDirty = false; }
          // Hold the backswing pose until the accuracy press commits the downswing.
          this.r.golfer.setSwing(-this.pullPower);
          if (m.active) {
            const label =
              m.stage === 'power'
                ? 'Release to lock power'
                : m.stage === 'pause'
                  ? 'Full power · get ready'
                  : m.armed
                    ? 'Tap on the green mark!'
                    : 'Release, then tap';
            this.ui.setMeter(
              m.stage,
              m.u,
              m.power,
              label,
              `${Math.round(this.pullPower * 100)}% · ${this.carryLabel(this.pullPower)}`,
              m.tolerance,
            );
          }
          if (r) this.fireMeter(r);
          this.wake(0.5);
        }
        break;
      case 'swing': {
        const tap = this.store.settings.swingMode === 'tap';
        const back = tap ? 0.28 : 0;
        // Accuracy is locked; now play the downswing into impact.
        const down = this.store.settings.swingMode === 'meter' ? 0.16 : 0.11;
        const t = this.phaseT;
        if (t < back) this.r.golfer.setSwing((-t / back) * this.shotPower);
        else if (t < back + down) {
          const k = (t - back) / down;
          const from = tap ? -this.shotPower : this.swingFrom;
          this.r.golfer.setSwing(from + (0 - from) * k);
        } else if (!this.launched) {
          this.doLaunch();
        }
        break;
      }
      case 'flight': {
        this.r.golfer.setSwing(Math.min(1, 0.2 + (this.phaseT / 0.35) * 0.8));
        if (this.hitStop > 0) {
          this.hitStop -= dt;
          this.frameFlight();
          break;
        }
        const sm = this.sim;
        let speedMul = this.fastForward ? 4 : 1;
        // Slow-motion as a rolling ball reaches the cup.
        if (!this.fastForward && !reduced && sm.state === BallState.Roll) {
          const dc = Math.hypot(this.world.cupX - sm.x, this.world.cupZ - sm.z);
          if (dc < 2.4 && Math.hypot(sm.vx, sm.vz) > 0.3) speedMul = 0.4;
        }
        if (this.shotItem === 'bee' && sm.state === BallState.Air) {
          sm.steerX = Math.cos(this.shotYaw) * this.steerInput * 9;
          sm.steerZ = Math.sin(this.shotYaw) * this.steerInput * 9;
        } else sm.steerX = sm.steerZ = 0;
        if (sm.state === BallState.Air) this.audio.flightUpdate(Math.hypot(sm.vx, sm.vy, sm.vz), sm.y - this.world.heightAt(sm.x, sm.z));
        this.acc += dt * speedMul;
        while (this.acc >= DT && this.sim.moving) {
          this.acc -= DT;
          this.sim.step(DT);
          this.flightSteps++;
          if (this.sim.state === BallState.Air && this.flightSteps % 3 === 0) this.r.effects.pushTrail(this.sim.x, this.sim.y, this.sim.z);
        }
        if (!this.sim.moving) {
          this.acc = 0;
          this.endOfShot();
        }
        this.frameFlight();
        break;
      }
      case 'settle': {
        if (this.waitingRescue) break;
        const wait = this.sim.state === BallState.Water || this.sim.state === BallState.OOB ? 1.3 : 0.75;
        if (this.phaseT > (reduced ? wait * 0.6 : wait)) this.resolveShot();
        break;
      }
      case 'holed':
        if (this.phaseT > 2.6) {
          this.r.effects.flag.visible = true;
          this.finishHole();
        }
        break;
    }
    // Camera.
    const moving = this.r.rig.update(dt);
    if (moving) this.wake(0.5);
  }

  private render(dt: number) {
    const fx = this.r.effects;
    const rig = this.r.rig;
    const s = rig.scale;
    const w = this.world;
    const reduced = this.store.settings.reducedMotion;
    const charScale = Math.max(1, Math.min(4.6, s / 0.06));
    const ballVis = Math.max(1, (4.6 * s) / BALL_RADIUS);
    const showBall = this.phase !== 'title' && this.phase !== 'results';
    if (showBall) {
      const bx = this.phase === 'flight' || this.phase === 'settle' || this.phase === 'holed' ? this.sim.x : this.ballX;
      const bz = this.phase === 'flight' || this.phase === 'settle' || this.phase === 'holed' ? this.sim.z : this.ballZ;
      const by = this.phase === 'flight' || this.phase === 'settle' || this.phase === 'holed' ? this.sim.y : w.heightAt(bx, bz) + BALL_RADIUS;
      const inCup = this.sim.state === BallState.Holed && (this.phase === 'holed' || this.phase === 'holeDone');
      const sunk = this.sim.state === BallState.Water && this.phase === 'settle';
      fx.setBall(bx, by, bz, w.heightAt(bx, bz), ballVis, inCup || sunk);
      // Golfer stays at the shot spot until the next aim.
      const atShot = this.phase === 'flight' || this.phase === 'settle' || this.phase === 'holed' || this.phase === 'swing';
      const gx = atShot ? this.shotStartX || this.ballX : this.ballX;
      const gz = atShot ? this.shotStartZ || this.ballZ : this.ballZ;
      const gyaw = this.phase === 'aim' || this.phase === 'intro' ? this.yaw : this.shotYaw;
      this.r.placeCharacters(w, this.phase === 'swing' ? this.ballX : gx, this.phase === 'swing' ? this.ballZ : gz, gyaw, charScale, this.phase !== 'holeDone');
    }
    // Bird hop + flap.
    const bird = this.r.bird;
    const happy = this.phase === 'holed' || this.ui.speaking;
    const hop = happy && !reduced ? Math.abs(Math.sin(this.time * 9)) * 0.5 : Math.max(0, Math.sin(this.time * 2.2)) * 0.06;
    bird.body.position.y = hop;
    const flap = happy ? Math.sin(this.time * 24) * 0.7 : Math.sin(this.time * 3) * 0.08;
    bird.wingL.rotation.z = -0.2 - flap;
    bird.wingR.rotation.z = 0.2 + flap;
    if (this.phase === 'aim') {
      this.refreshAimVisuals();
    } else if (this.phase !== 'swing') {
      this.ui.hidePuttingRead();
      fx.hideAim();
      if (this.phase !== 'intro') this.ui.hideLanding();
    }
    this.r.scenery?.update(this.time, dt, reduced);
    fx.update(this.time, dt, this.windDir, this.windMph / 6, s * 3, reduced);
    this.ui.setWindArrow(this.windDir - rig.yaw);
    this.r.render();
  }
}
