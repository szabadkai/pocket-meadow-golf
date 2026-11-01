// Hold for power, release to lock, then press on the returning accuracy mark.
// This state machine owns timing; input adapters only forward press/release/cancel.
export type MeterStage = 'idle' | 'power' | 'pause' | 'accuracy' | 'done';
export type MeterGrade = 'perfect' | 'good' | 'early' | 'late' | 'mishit';

export const METER = {
  start: -0.16,
  perfect: 0.035,
  softPerfect: 0.07,
  putterPerfect: 0.085,
  zone: 0.14,
  powerSpeed: 0.48,
  returnSpeed: 0.46,
  fullPause: 0.32,
  zoneDeg: 4,
  maxDeg: 12,
  missPower: 0.85,
  putterSpeed: 0.8,
  putterScale: 0.35,
};

export function accuracyWindow(power: number, putter: boolean): number {
  return putter ? METER.putterPerfect : METER.softPerfect + (METER.perfect - METER.softPerfect) * Math.max(0, Math.min(1, power));
}

export interface MeterResult {
  power: number;
  /** Negative = left (early), positive = right (late). */
  yawErr: number;
  grade: MeterGrade;
  /** Signed timing offset from the impact line (positive = early). */
  offset: number;
  degrees: number;
}

export function gradeOffset(
  offset: number,
  putter: boolean,
  power = 1,
): { yawErr: number; powerMul: number; grade: MeterGrade; degrees: number } {
  const a = Math.abs(offset);
  const side = offset > 0 ? -1 : 1;
  const perfect = accuracyWindow(power, putter);
  let deg = 0;
  let powerMul = 1;
  let grade: MeterGrade = 'perfect';
  if (a > perfect && a <= METER.zone) {
    deg = (METER.zoneDeg * (a - perfect)) / (METER.zone - perfect);
    grade = offset > 0 ? 'early' : 'late';
  } else if (a > METER.zone) {
    const t = Math.min(1, (a - METER.zone) / 0.2);
    deg = METER.zoneDeg + (METER.maxDeg - METER.zoneDeg) * t;
    powerMul = 1 - (1 - METER.missPower) * t;
    grade = 'mishit';
  }
  if (putter) deg *= METER.putterScale;
  const degrees = deg === 0 ? 0 : side * deg;
  return { yawErr: (degrees * Math.PI) / 180, powerMul, grade, degrees };
}

export class SwingMeter {
  stage: MeterStage = 'idle';
  /** 0 = accuracy mark, 1 = full power / start of the accuracy pass. */
  u = 0;
  power = 0;
  result: MeterResult | null = null;
  held = false;
  armed = false;
  private putter = false;
  private pauseLeft = 0;

  get active(): boolean {
    return this.stage === 'power' || this.stage === 'pause' || this.stage === 'accuracy';
  }
  get tolerance(): number {
    return accuracyWindow(this.stage === 'power' ? this.u : this.power, this.putter);
  }

  start(putter: boolean) {
    if (this.active) return;
    this.stage = 'power';
    this.putter = putter;
    this.u = 0;
    this.power = 0;
    this.result = null;
    this.held = true;
    this.armed = false;
    this.pauseLeft = 0;
  }

  /** A release only locks power or arms a fresh accuracy press. It never hits. */
  release() {
    if (!this.held) return;
    this.held = false;
    if (this.stage === 'power') {
      this.power = Math.max(0.02, Math.min(1, this.u));
      this.beginReturn();
    } else if (this.stage === 'accuracy') this.armed = true;
  }

  tap(): MeterResult | null {
    if (this.stage !== 'accuracy' || !this.armed || this.held) return null;
    return this.finish(this.u);
  }

  /** Returns one capped mishit if the player misses the pass, even while holding. */
  update(dt: number): MeterResult | null {
    if (!Number.isFinite(dt) || dt <= 0) return null;
    const speed = METER.powerSpeed * (this.putter ? METER.putterSpeed : 1);
    if (this.stage === 'power') {
      const toFull = (1 - this.u) / speed;
      if (dt < toFull) {
        this.u += speed * dt;
        return null;
      }
      this.u = this.power = 1;
      this.stage = 'pause';
      this.pauseLeft = METER.fullPause;
      dt -= toFull;
    }
    if (this.stage === 'pause') {
      if (dt < this.pauseLeft) {
        this.pauseLeft -= dt;
        return null;
      }
      dt -= this.pauseLeft;
      this.pauseLeft = 0;
      this.beginReturn();
    }
    if (this.stage === 'accuracy') {
      this.u -= METER.returnSpeed * dt;
      if (this.u <= METER.start) {
        this.u = METER.start;
        // Timeout is explicitly a full, bounded mishit, independent of tolerance.
        return this.finish(-0.34);
      }
    }
    return null;
  }

  cancel() {
    this.stage = 'idle';
    this.u = this.power = this.pauseLeft = 0;
    this.held = this.armed = false;
    this.result = null;
  }

  private beginReturn() {
    this.stage = 'accuracy';
    // A separate full-length pass gives even a tiny putt 2.17 seconds to the mark.
    this.u = 1;
    this.armed = !this.held;
  }

  private finish(offset: number): MeterResult {
    const g = gradeOffset(offset, this.putter, this.power);
    this.stage = 'done';
    this.armed = false;
    this.result = { power: this.power * g.powerMul, yawErr: g.yawErr, grade: g.grade, offset, degrees: g.degrees };
    return this.result;
  }
}
