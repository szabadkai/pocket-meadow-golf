import { afterEach, describe, expect, it, vi } from 'vitest';
import { Controls, type ControlHandlers } from '../src/input/controls';
import { SwingMeter } from '../src/sim/meter';

// Exercise real event handlers without a browser or a second DOM dependency.
class ElementStub extends EventTarget {
  classList = { add() {}, remove() {}, toggle() {} };
  style = { backgroundPositionX: '' };
  setPointerCapture() {}
  closest() {
    return null;
  }
}
function dispatch(el: EventTarget, type: string, props: Record<string, unknown> = {}) {
  const e = new Event(type, { cancelable: true });
  Object.assign(e, props);
  el.dispatchEvent(e);
}
function setup() {
  const windowStub = new ElementStub();
  Object.assign(windowStub, { clearTimeout, setTimeout });
  vi.stubGlobal('window', windowStub);
  const meter = new SwingMeter();
  let shots = 0;
  const h: ControlHandlers = {
    canAim: () => !meter.active,
    canSwing: () => !meter.active,
    aimFineness: () => 1,
    aimBy() {},
    aimDragActive() {},
    swingStart() {},
    swingUpdate() {},
    swingRelease() {},
    swingCancel() {},
    tapPowerChanged() {},
    tapSwing() {},
    meterPress: () => {
      if (!meter.active) meter.start(false);
      else if (meter.tap()) shots++;
    },
    meterRelease: () => meter.release(),
    meterCancel: () => meter.cancel(),
    lookActive: () => false,
    lookPan() {},
    lookPinch() {},
    lookZoom() {},
    steerActive: () => false,
    steer() {},
    courseTap() {},
    interacted() {},
  };
  const keys = [
    'course',
    'aimStrip',
    'aimTicks',
    'aimLeft',
    'aimRight',
    'pad',
    'pMinus',
    'pPlus',
    'tapSwing',
    'meterButton',
    'meterCancel',
  ] as const;
  const els = Object.fromEntries(keys.map((key) => [key, new ElementStub()])) as unknown as ConstructorParameters<typeof Controls>[1];
  const controls = new Controls(h, els);
  const pointer = (type: string, pointerId = 1, button = 0) => dispatch(els.meterButton, type, { pointerId, button });
  return { meter, controls, els, pointer, windowStub, shots: () => shots };
}
afterEach(() => vi.unstubAllGlobals());

describe('one-thumb pointer routing', () => {
  it('routes hold/release/press, ignoring secondary touches and synthetic clicks', () => {
    const t = setup();
    t.pointer('pointerdown');
    t.meter.update(1);
    t.pointer('pointerdown', 2);
    t.pointer('pointerup', 2);
    expect(t.meter.stage).toBe('power');
    t.pointer('pointerup');
    t.pointer('lostpointercapture');
    dispatch(t.els.meterButton, 'click');
    expect(t.meter.stage).toBe('accuracy');
    expect(t.shots()).toBe(0);
    t.pointer('pointerdown');
    dispatch(t.els.meterButton, 'click');
    expect(t.shots()).toBe(1);
  });

  it.each(['pointercancel', 'lostpointercapture'])('cancels on %s without a shot', (type) => {
    const t = setup();
    t.pointer('pointerdown');
    t.meter.update(1);
    t.pointer(type);
    t.pointer('pointerup');
    expect(t.meter.stage).toBe('idle');
    expect(t.shots()).toBe(0);
  });

  it('cancels the return pass on app/viewport interruption even after releasing', () => {
    const t = setup();
    t.pointer('pointerdown');
    t.pointer('pointerup');
    t.controls.cancelAll();
    expect(t.meter.stage).toBe('idle');
    expect(t.shots()).toBe(0);
    t.pointer('pointerdown');
    expect(t.meter.stage).toBe('power');
  });

  it('ignores right-click and uses the same sequence with Space', () => {
    const t = setup();
    t.pointer('pointerdown', 1, 2);
    expect(t.meter.stage).toBe('idle');
    dispatch(t.windowStub, 'keydown', { code: 'Space', key: ' ', repeat: false });
    dispatch(t.windowStub, 'keydown', { code: 'Space', key: ' ', repeat: true });
    expect(t.meter.stage).toBe('power');
    dispatch(t.windowStub, 'keyup', { code: 'Space', key: ' ' });
    expect(t.meter.stage).toBe('accuracy');
    dispatch(t.windowStub, 'keydown', { code: 'Space', key: ' ', repeat: false });
    expect(t.shots()).toBe(1);
  });
});
