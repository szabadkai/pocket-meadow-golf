import { describe, expect, it } from 'vitest';
import { gradeOffset, METER, SwingMeter } from '../src/sim/meter';

const run = (m: SwingMeter, seconds: number) => {
  let r = null;
  for (let t = 0; t < seconds && !r; t += 1 / 120) r = m.update(1 / 120);
  return r;
};

describe('swing meter', () => {
  it('sets power where the second tap lands', () => {
    const m = new SwingMeter();
    m.start(false);
    run(m, 0.6 / METER.powerSpeed);
    m.tap();
    expect(m.power).toBeCloseTo(0.6, 1);
    expect(m.stage).toBe('accuracy');
  });

  it('a tap on the impact line is perfectly straight', () => {
    const m = new SwingMeter();
    m.start(false);
    run(m, 0.5 / METER.powerSpeed);
    m.tap();
    // Return to just about the line.
    while (m.u > 0.004) m.update(1 / 240);
    const r = m.tap()!;
    expect(r.grade).toBe('perfect');
    expect(r.yawErr).toBe(0);
    expect(r.power).toBeCloseTo(0.5, 1);
  });

  it('early taps pull left, late taps push right, by a growing amount', () => {
    const early = gradeOffset(0.04, false);
    const late = gradeOffset(-0.04, false);
    expect(early.yawErr).toBeLessThan(0);
    expect(late.yawErr).toBeGreaterThan(0);
    expect(Math.abs(gradeOffset(0.055, false).yawErr)).toBeGreaterThan(Math.abs(early.yawErr));
    expect(early.powerMul).toBe(1);
  });

  it('missing the zone is a mishit with lost power', () => {
    const g = gradeOffset(-0.12, false);
    expect(g.grade).toBe('mishit');
    expect(g.powerMul).toBeLessThan(1);
    expect(Math.abs(g.degrees)).toBeGreaterThan(METER.zoneDeg);
  });

  it('never tapping the second time gives full power; never tapping the third is a late mishit', () => {
    const m = new SwingMeter();
    m.start(false);
    const r = run(m, 5)!;
    expect(r).not.toBeNull();
    expect(r.grade).toBe('mishit');
    expect(r.yawErr).toBeGreaterThan(0);
    expect(r.power).toBeCloseTo(METER.missPower, 5);
  });

  it('putts are more forgiving', () => {
    expect(Math.abs(gradeOffset(0.05, true).degrees)).toBeLessThan(Math.abs(gradeOffset(0.05, false).degrees));
  });

  it('cancel resets the meter', () => {
    const m = new SwingMeter();
    m.start(false);
    run(m, 0.3);
    m.cancel();
    expect(m.stage).toBe('idle');
    expect(m.active).toBe(false);
  });
});
