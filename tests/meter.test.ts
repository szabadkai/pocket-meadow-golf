import { describe, expect, it } from 'vitest';
import { accuracyWindow, gradeOffset, METER, SwingMeter } from '../src/sim/meter';

function charged(power = 0.6, putter = false) {
  const m = new SwingMeter();
  m.start(putter);
  m.update(power / (METER.powerSpeed * (putter ? METER.putterSpeed : 1)));
  m.release();
  return m;
}

describe('hold-release-tap swing', () => {
  it('locks chosen power on release, never on a press or click', () => {
    const m = new SwingMeter();
    m.start(false);
    m.update(0.6 / METER.powerSpeed);
    expect(m.tap()).toBeNull();
    expect(m.stage).toBe('power');
    m.release();
    expect(m.power).toBeCloseTo(0.6, 10);
    expect(m.stage).toBe('accuracy');
    expect(m.result).toBeNull();
  });

  it('gives short putts and full drives the same readable return time', () => {
    for (const power of [0.02, 0.4, 0.99]) {
      for (const putter of [false, true]) {
        const m = charged(power, putter);
        expect(m.u).toBe(1);
        m.update(1 / METER.returnSpeed);
        expect(m.u).toBeCloseTo(0, 8);
        expect(m.power).toBeCloseTo(power, 8);
        expect(m.tap()!.yawErr).toBe(0);
      }
    }
  });

  it('accepts a fresh press at the mark exactly once', () => {
    const m = charged();
    m.update(1 / METER.returnSpeed);
    const r = m.tap()!;
    expect(r.grade).toBe('perfect');
    expect(r.power).toBeCloseTo(0.6, 8);
    expect(m.tap()).toBeNull();
    expect(m.update(20)).toBeNull();
    m.release();
    expect(m.result).toBe(r);
  });

  it('pauses at maximum power and requires release before accuracy', () => {
    const m = new SwingMeter();
    m.start(false);
    m.update(1 / METER.powerSpeed);
    expect(m.stage).toBe('pause');
    expect(m.power).toBe(1);
    m.update(METER.fullPause / 2);
    expect(m.stage).toBe('pause');
    m.update(METER.fullPause / 2);
    expect(m.stage).toBe('accuracy');
    expect(m.armed).toBe(false);
    expect(m.tap()).toBeNull();
    m.release();
    expect(m.armed).toBe(true);
    expect(m.result).toBeNull();
    m.update(1 / METER.returnSpeed);
    expect(m.tap()!.grade).toBe('perfect');
  });

  it('also permits releasing during the full-power pause', () => {
    const m = new SwingMeter();
    m.start(false);
    m.update(1 / METER.powerSpeed);
    m.release();
    expect(m.stage).toBe('pause');
    m.update(METER.fullPause);
    expect(m.armed).toBe(true);
  });

  it('keeps return speed constant across frames and release', () => {
    const m = new SwingMeter();
    m.start(false);
    m.update(1 / METER.powerSpeed + METER.fullPause);
    m.update(0.2);
    const before = m.u;
    m.release();
    m.update(0.2);
    expect(before - m.u).toBeCloseTo(0.2 * METER.returnSpeed, 10);
  });

  it('times out to one bounded mishit, even if the thumb never lifts', () => {
    const m = new SwingMeter();
    m.start(false);
    const r = m.update(10)!;
    expect(r.grade).toBe('mishit');
    expect(r.degrees).toBe(METER.maxDeg);
    expect(r.power).toBeCloseTo(METER.missPower, 8);
    expect(m.update(1)).toBeNull();
    m.release();
    expect(m.tap()).toBeNull();
  });

  it('widens the straight zone for lighter shots and putts', () => {
    expect(accuracyWindow(0.2, false)).toBeGreaterThan(accuracyWindow(1, false));
    expect(accuracyWindow(1, true)).toBeGreaterThan(accuracyWindow(0.2, false));
    expect(gradeOffset(0.055, false, 0.2).yawErr).toBe(0);
    expect(gradeOffset(0.055, false, 1).yawErr).toBeLessThan(0);
    expect(gradeOffset(-0.08, true).yawErr).toBe(0);
  });

  it('smoothly pulls early left and pushes late right with no random spread', () => {
    let prev = 0;
    for (let offset = 0; offset <= 1; offset += 0.005) {
      const early = gradeOffset(offset, false);
      const late = gradeOffset(-offset, false);
      expect(Math.abs(early.degrees)).toBeGreaterThanOrEqual(prev);
      expect(Math.abs(early.degrees) - prev).toBeLessThan(0.3);
      expect(early.yawErr).toBeLessThanOrEqual(0);
      expect(late.yawErr).toBeGreaterThanOrEqual(0);
      expect(Math.abs(late.degrees)).toBe(Math.abs(early.degrees));
      expect(gradeOffset(offset, false)).toEqual(early);
      prev = Math.abs(early.degrees);
    }
    expect(Math.abs(gradeOffset(0.2, true).degrees)).toBeLessThan(Math.abs(gradeOffset(0.2, false).degrees));
  });

  it('cancels cleanly from every pending stage', () => {
    for (const elapsed of [0.3, 1 / METER.powerSpeed, 1 / METER.powerSpeed + METER.fullPause + 0.2]) {
      const m = new SwingMeter();
      m.start(false);
      m.update(elapsed);
      m.cancel();
      m.release();
      expect(m.tap()).toBeNull();
      expect(m.update(10)).toBeNull();
      expect(m.active).toBe(false);
      expect(m.result).toBeNull();
      expect(m.power).toBe(0);
      expect(m.held).toBe(false);
      expect(m.armed).toBe(false);
      m.start(false);
      expect(m.stage).toBe('power');
    }
  });

  it('ignores duplicate starts and invalid clock deltas', () => {
    const m = new SwingMeter();
    m.start(false);
    m.update(0.5);
    const u = m.u;
    m.start(true);
    m.update(-2);
    m.update(NaN);
    m.update(Infinity);
    expect(m.u).toBe(u);
  });
});
