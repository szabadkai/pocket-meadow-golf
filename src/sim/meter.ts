// Classic three-tap swing meter: tap to start, tap to set power, tap on the impact line
// as the marker returns. Timing error becomes a visible, deterministic hook or push.

export type MeterStage = 'idle' | 'power' | 'accuracy' | 'done';
export type MeterGrade = 'perfect' | 'good' | 'early' | 'late' | 'mishit';

export const METER = {
  /** Far end of the return travel (left of the impact line). */
  start: -0.14,
  /** Half-width of the dead-straight window around the impact line. */
  perfect: 0.012,
  /** Half-width of the accuracy zone drawn on the bar. */
  zone: 0.06,
  /** Bar units per second on the way up (0 → 100% power). */
  powerSpeed: 0.85,
  /** Bar units per second on the way back. */
  returnSpeed: 1.15,
  /** Direction error at the edge of the zone, and the worst case beyond it. */
  zoneDeg: 4,
  maxDeg: 12,
  /** Power kept on a mishit outside the zone. */
  missPower: 0.85,
  /** Putts are gentler: slower marker and smaller direction errors. */
  putterSpeed: 0.7,
  putterScale: 0.35,
};

export interface MeterResult {
  power: number;
  /** Added to the aim yaw: negative = left (early), positive = right (late). */
  yawErr: number;
  grade: MeterGrade;
  /** Signed timing offset from the impact line (positive = early). */
  offset: number;
  degrees: number;
}

export function gradeOffset(offset: number, putter: boolean): { yawErr: number; powerMul: number; grade: MeterGrade; degrees: number } {
  const a = Math.abs(offset);
  const side = offset > 0 ? -1 : 1;
  let deg = 0;
  let powerMul = 1;
  let grade: MeterGrade = 'perfect';
  if (a > METER.perfect && a <= METER.zone) {
    deg = (METER.zoneDeg * (a - METER.perfect)) / (METER.zone - METER.perfect);
    grade = deg < 1.5 ? 'good' : offset > 0 ? 'early' : 'late';
  } else if (a > METER.zone) {
    const t = Math.min(1, (a - METER.zone) / (Math.abs(METER.start) - METER.zone));
    deg = METER.zoneDeg + (METER.maxDeg - METER.zoneDeg) * t;
    powerMul = METER.missPower;
    grade = 'mishit';
  }
  if (putter) deg *= METER.putterScale;
  return { yawErr: (side * deg * Math.PI) / 180, powerMul, grade, degrees: side * deg };
}

export class SwingMeter {
  stage: MeterStage = 'idle';
  /** Marker position: 0 = impact line, 1 = full power. */
  u = 0;
  power = 0;
  result: MeterResult | null = null;
  private putter = false;

  get active(): boolean {
    return this.stage === 'power' || this.stage === 'accuracy';
  }

  start(putter: boolean) {
    this.stage = 'power';
    this.putter = putter;
    this.u = 0;
    this.power = 0;
    this.result = null;
  }

  /** Returns the result on the final tap, otherwise null. */
  tap(): MeterResult | null {
    if (this.stage === 'power') {
      this.power = Math.max(0.02, Math.min(1, this.u));
      this.stage = 'accuracy';
      return null;
    }
    if (this.stage === 'accuracy') return this.finish(this.u);
    return null;
  }

  /** Advances the marker. Returns a result if the marker ran out (automatic mishit). */
  update(dt: number): MeterResult | null {
    const k = this.putter ? METER.putterSpeed : 1;
    if (this.stage === 'power') {
      this.u += METER.powerSpeed * k * dt;
      if (this.u >= 1) {
        // Not stopped in time: full power, and the marker heads back.
        this.u = 1;
        this.power = 1;
        this.stage = 'accuracy';
      }
    } else if (this.stage === 'accuracy') {
      this.u -= METER.returnSpeed * k * dt;
      if (this.u <= METER.start) return this.finish(METER.start);
    }
    return null;
  }

  cancel() {
    this.stage = 'idle';
    this.u = 0;
    this.power = 0;
  }

  private finish(offset: number): MeterResult {
    const g = gradeOffset(offset, this.putter);
    this.stage = 'done';
    this.result = { power: this.power * g.powerMul, yawErr: g.yawErr, grade: g.grade, offset, degrees: g.degrees };
    return this.result;
  }
}
