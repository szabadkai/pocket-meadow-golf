// Touch-first input. The aim region and the swing pad are separate elements, so an
// aiming drag can never fire a shot. Each region tracks a single pointer with capture.

export interface ControlHandlers {
  canAim(): boolean;
  canSwing(): boolean;
  /** Fine aiming multiplier (e.g. smaller on the green). */
  aimFineness(): number;
  aimBy(rad: number): void;
  aimDragActive(active: boolean): void;
  swingStart(): void;
  swingUpdate(power: number, cancel: boolean, x: number, y: number, startY: number): void;
  swingRelease(power: number): void;
  swingCancel(): void;
  tapPowerChanged(power: number): void;
  tapSwing(power: number): void;
  /** Hold/release builds power; a fresh press on the return sets accuracy. */
  meterPress(): void;
  meterRelease(): void;
  meterCancel(): void;
  /** Free-look camera mode is on: course drags move the camera instead of aiming. */
  lookActive(): boolean;
  lookPan(dx: number, dy: number): void;
  lookPinch(scale: number, dAngle: number): void;
  lookZoom(f: number): void;
  /** Bumblebee: the ball can be steered right now. */
  steerActive(): boolean;
  /** Steering input in [-1, 1] (left/right of the shot line). */
  steer(v: number): void;
  /** Any tap on the course while the ball is moving (fast-forward / skip). */
  courseTap(): void;
  interacted(): void;
}

const DEG = Math.PI / 180;

export class Controls {
  private aimPointer = -1;
  private steerPointer = -1;
  private steerStartX = 0;
  private aimLastX = 0;
  private aimLastT = 0;
  private aimMoved = 0;
  private swingPointer = -1;
  private meterPointer = -1;
  private meterKeyHeld = false;
  private swingStartX = 0;
  private swingStartY = 0;
  private swingPower = 0;
  private swingCancelState = false;
  private repeatTimer = 0;
  private tickOffset = 0;
  tapPower = 0.6;

  constructor(
    private h: ControlHandlers,
    private els: {
      course: HTMLElement;
      aimStrip: HTMLElement;
      aimTicks: HTMLElement;
      aimLeft: HTMLElement;
      aimRight: HTMLElement;
      pad: HTMLElement;
      pMinus: HTMLElement;
      pPlus: HTMLElement;
      tapSwing: HTMLElement;
      meterButton: HTMLElement;
      meterCancel: HTMLElement;
    },
  ) {
    // Look must be bound before aim on the course so it can claim gestures first.
    this.bindLook(els.course);
    this.bindAim(els.aimStrip, 1);
    this.bindMeter(els.meterButton, els.meterCancel);
    this.bindAim(els.course, 1);
    this.bindNudge(els.aimLeft, -1);
    this.bindNudge(els.aimRight, 1);
    this.bindSwing(els.pad);
    this.bindPowerButton(els.pMinus, -0.05);
    this.bindPowerButton(els.pPlus, 0.05);
    els.tapSwing.addEventListener('click', () => {
      h.interacted();
      if (h.canSwing()) h.tapSwing(this.tapPower);
    });
    // Desktop conveniences (never required).
    window.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' && h.canAim()) h.aimBy(-0.5 * DEG * h.aimFineness());
      if (e.key === 'ArrowRight' && h.canAim()) h.aimBy(0.5 * DEG * h.aimFineness());
      if (e.code === 'Space' && !e.repeat && !this.meterKeyHeld && this.meterPointer === -1) {
        if ((e.target as HTMLElement).closest('input, select, textarea, button') && e.target !== els.meterButton) return;
        e.preventDefault();
        this.meterKeyHeld = true;
        h.meterPress();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code !== 'Space' || !this.meterKeyHeld) return;
      e.preventDefault();
      this.meterKeyHeld = false;
      h.meterRelease();
    });
  }

  private bindAim(el: HTMLElement, sens: number) {
    el.addEventListener('pointerdown', (e) => {
      this.h.interacted();
      if (e.target !== el && (e.target as HTMLElement).closest('button')) return;
      if (!this.h.canAim()) {
        if (el !== this.els.course) return;
        if (this.h.steerActive() && this.steerPointer === -1) {
          this.steerPointer = e.pointerId;
          this.steerStartX = e.clientX;
          try {
            el.setPointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
          e.preventDefault();
        } else this.h.courseTap();
        return;
      }
      if (this.aimPointer !== -1) return;
      this.aimPointer = e.pointerId;
      this.aimLastX = e.clientX;
      this.aimLastT = e.timeStamp;
      this.aimMoved = 0;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      this.els.aimStrip.classList.add('dragging');
      this.h.aimDragActive(true);
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.steerPointer) {
        this.h.steer(Math.max(-1, Math.min(1, (e.clientX - this.steerStartX) / 70)));
        return;
      }
      if (e.pointerId !== this.aimPointer) return;
      const dx = e.clientX - this.aimLastX;
      const dt = Math.max(1, e.timeStamp - this.aimLastT);
      this.aimLastX = e.clientX;
      this.aimLastT = e.timeStamp;
      if (!this.h.canAim()) return;
      // Slow drags are precise; quick flicks turn further.
      const speed = Math.abs(dx) / dt;
      const degPerPx = (0.09 + Math.min(0.45, speed * 0.22)) * sens * this.h.aimFineness();
      this.aimMoved += Math.abs(dx);
      this.h.aimBy(dx * degPerPx * DEG);
      this.tickOffset += dx;
      this.els.aimTicks.style.backgroundPositionX = `${this.tickOffset}px`;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === this.steerPointer) {
        this.steerPointer = -1;
        this.h.steer(0);
        return;
      }
      if (e.pointerId !== this.aimPointer) return;
      this.aimPointer = -1;
      this.els.aimStrip.classList.remove('dragging');
      this.h.aimDragActive(false);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
  }

  /** Pointer-down commits accuracy; clicks are never used for swing input. */
  private bindMeter(el: HTMLElement, cancel: HTMLElement) {
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.meterPointer !== -1 || this.meterKeyHeld) return;
      e.preventDefault();
      this.h.interacted();
      this.meterPointer = e.pointerId;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* unsupported capture */
      }
      this.h.meterPress();
    });
    el.addEventListener('pointerup', (e) => {
      if (e.pointerId !== this.meterPointer) return;
      e.preventDefault();
      this.meterPointer = -1;
      this.h.meterRelease();
    });
    const abort = (e: PointerEvent) => {
      if (e.pointerId !== this.meterPointer) return;
      this.meterPointer = -1;
      this.h.meterCancel();
    };
    el.addEventListener('pointercancel', abort);
    el.addEventListener('lostpointercapture', abort);
    cancel.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.meterPointer = -1;
      this.meterKeyHeld = false;
      this.h.meterCancel();
    });
    // Preserve keyboard access to the separate Cancel button.
    cancel.addEventListener('click', () => this.h.meterCancel());
  }

  private lookPts = new Map<number, { x: number; y: number }>();
  private pinchPrev: { d: number; a: number; mx: number; my: number } | null = null;

  private bindLook(el: HTMLElement) {
    el.addEventListener('pointerdown', (e) => {
      if (!this.h.lookActive() || (e.target as HTMLElement).closest('button')) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      this.h.interacted();
      this.lookPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.pinchPrev = null;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    });
    el.addEventListener('pointermove', (e) => {
      const p = this.lookPts.get(e.pointerId);
      if (!p) return;
      e.stopImmediatePropagation();
      if (this.lookPts.size === 1) {
        this.h.lookPan(e.clientX - p.x, e.clientY - p.y);
        p.x = e.clientX;
        p.y = e.clientY;
        return;
      }
      p.x = e.clientX;
      p.y = e.clientY;
      const [a, b] = Array.from(this.lookPts.values());
      const d = Math.max(10, Math.hypot(b.x - a.x, b.y - a.y));
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      if (this.pinchPrev) {
        let da = ang - this.pinchPrev.a;
        if (da > Math.PI) da -= Math.PI * 2;
        if (da < -Math.PI) da += Math.PI * 2;
        this.h.lookPinch(this.pinchPrev.d / d, -da);
        this.h.lookPan(mx - this.pinchPrev.mx, my - this.pinchPrev.my);
      }
      this.pinchPrev = { d, a: ang, mx, my };
    });
    const end = (e: PointerEvent) => {
      if (!this.lookPts.delete(e.pointerId)) return;
      this.pinchPrev = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
    el.addEventListener(
      'wheel',
      (e) => {
        if (!this.h.lookActive()) return;
        e.preventDefault();
        this.h.lookZoom(Math.exp(e.deltaY * 0.0015));
      },
      { passive: false },
    );
  }

  private bindNudge(el: HTMLElement, dir: number) {
    const stop = () => {
      window.clearTimeout(this.repeatTimer);
      this.repeatTimer = 0;
    };
    el.addEventListener('pointerdown', (e) => {
      this.h.interacted();
      e.preventDefault();
      if (!this.h.canAim()) return;
      stop();
      let n = 0;
      const tick = () => {
        if (!this.h.canAim()) return stop();
        const step = (n < 6 ? 0.25 : n < 16 ? 0.5 : 1.2) * DEG * this.h.aimFineness();
        this.h.aimBy(step * dir);
        this.tickOffset += dir * 4;
        this.els.aimTicks.style.backgroundPositionX = `${this.tickOffset}px`;
        n++;
        this.repeatTimer = window.setTimeout(tick, n === 1 ? 380 : 70);
      };
      tick();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    });
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointercancel', stop);
    el.addEventListener('lostpointercapture', stop);
  }

  /** Comfortable thumb travel for full power. */
  private travel(): number {
    return Math.max(95, Math.min(150, Math.min(window.innerHeight, window.innerWidth) * 0.3));
  }

  private bindSwing(el: HTMLElement) {
    el.addEventListener('pointerdown', (e) => {
      this.h.interacted();
      if (!this.h.canSwing() || this.swingPointer !== -1) return;
      this.swingPointer = e.pointerId;
      this.swingStartX = e.clientX;
      this.swingStartY = e.clientY;
      this.swingPower = 0;
      this.swingCancelState = false;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      el.classList.add('active');
      this.h.swingStart();
      this.h.swingUpdate(0, false, e.clientX, e.clientY, this.swingStartY);
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.swingPointer) return;
      const dx = e.clientX - this.swingStartX;
      const dy = e.clientY - this.swingStartY;
      // Pull down (diagonals count, so a touch near the screen edge still has room).
      const pull = dy > 0 ? Math.hypot(dy, dx * 0.6) : 0;
      this.swingPower = Math.min(1, pull / this.travel());
      // Sliding back up above the start point cancels.
      this.swingCancelState = dy < -18;
      el.classList.toggle('cancel', this.swingCancelState);
      this.h.swingUpdate(this.swingPower, this.swingCancelState, e.clientX, e.clientY, this.swingStartY);
    });
    const finish = (e: PointerEvent, released: boolean) => {
      if (e.pointerId !== this.swingPointer) return;
      this.swingPointer = -1;
      el.classList.remove('active', 'cancel');
      if (released && !this.swingCancelState && this.swingPower >= 0.03 && this.h.canSwing()) this.h.swingRelease(this.swingPower);
      else this.h.swingCancel();
    };
    el.addEventListener('pointerup', (e) => finish(e, true));
    el.addEventListener('pointercancel', (e) => finish(e, false));
    el.addEventListener('lostpointercapture', (e) => finish(e, false));
  }

  private bindPowerButton(el: HTMLElement, step: number) {
    let timer = 0;
    const stop = () => window.clearTimeout(timer);
    el.addEventListener('pointerdown', (e) => {
      this.h.interacted();
      e.preventDefault();
      stop();
      let n = 0;
      const tick = () => {
        this.tapPower = Math.round(Math.max(0.05, Math.min(1, this.tapPower + step)) * 100) / 100;
        this.h.tapPowerChanged(this.tapPower);
        n++;
        timer = window.setTimeout(tick, n === 1 ? 380 : 90);
      };
      tick();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    });
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointercancel', stop);
    el.addEventListener('lostpointercapture', stop);
  }

  /** Abort any gesture in progress (tab hidden, menu opened, etc.). */
  cancelAll() {
    this.meterPointer = -1;
    this.meterKeyHeld = false;
    this.h.meterCancel();
    this.lookPts.clear();
    if (this.steerPointer !== -1) {
      this.steerPointer = -1;
      this.h.steer(0);
    }
    this.pinchPrev = null;
    if (this.swingPointer !== -1) {
      this.swingPointer = -1;
      this.els.pad.classList.remove('active', 'cancel');
      this.h.swingCancel();
    }
    if (this.aimPointer !== -1) {
      this.aimPointer = -1;
      this.els.aimStrip.classList.remove('dragging');
      this.h.aimDragActive(false);
    }
    window.clearTimeout(this.repeatTimer);
  }

  get swinging(): boolean {
    return this.swingPointer !== -1;
  }

  get aimDragDistance(): number {
    return this.aimMoved;
  }
}
