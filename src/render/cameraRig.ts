import * as THREE from 'three';

export interface ViewRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FrameOpts {
  padTop?: number;
  padBottom?: number;
  padSide?: number;
  /** Minimum visible world extent across the narrow axis of the rect. */
  minExtent?: number;
  maxScale?: number;
  /** Override the vertical anchor: fraction down the rect where the first point should sit. */
  anchorFirst?: number;
}

const PITCH = (54 * Math.PI) / 180;
const DIST = 1500;

/**
 * Elevated orthographic camera. State is (ground focus point, yaw, world-units-per-CSS-pixel).
 * Framing fits world points into the visible course rect so UI never covers them.
 */
export class CameraRig {
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
  // Current state.
  fx = 0;
  fy = 0;
  fz = 0;
  yaw = 0;
  scale = 0.2;
  // Target state.
  tfx = 0;
  tfy = 0;
  tfz = 0;
  tyaw = 0;
  tscale = 0.2;
  /** Canvas size in CSS px. */
  vw = 400;
  vh = 800;
  rect: ViewRect = { x: 0, y: 0, w: 400, h: 600 };
  /** Higher = snappier. */
  rate = 4;
  private r = new THREE.Vector3();
  private u = new THREE.Vector3();
  private f = new THREE.Vector3();

  private basis(yaw: number) {
    const cp = Math.cos(PITCH);
    const sp = Math.sin(PITCH);
    const dx = Math.sin(yaw);
    const dz = -Math.cos(yaw);
    this.f.set(dx * cp, -sp, dz * cp);
    this.r.set(Math.cos(yaw), 0, Math.sin(yaw));
    this.u.crossVectors(this.r, this.f);
  }

  /** Fit points (xyz triplets) into the course rect. */
  frame(points: ArrayLike<number>, count: number, yaw: number, opts: FrameOpts = {}) {
    this.basis(yaw);
    const { r, u } = this;
    let amin = Infinity;
    let amax = -Infinity;
    let bmin = Infinity;
    let bmax = -Infinity;
    let ysum = 0;
    for (let i = 0; i < count; i++) {
      const x = points[i * 3];
      const y = points[i * 3 + 1];
      const z = points[i * 3 + 2];
      const a = x * r.x + y * r.y + z * r.z;
      const b = x * u.x + y * u.y + z * u.z;
      if (a < amin) amin = a;
      if (a > amax) amax = a;
      if (b < bmin) bmin = b;
      if (b > bmax) bmax = b;
      ysum += y;
    }
    const rect = this.rect;
    const padT = opts.padTop ?? 40;
    const padB = opts.padBottom ?? 40;
    const padS = opts.padSide ?? 30;
    const aw = Math.max(40, rect.w - padS * 2);
    const ah = Math.max(40, rect.h - padT - padB);
    let s = Math.max((amax - amin) / aw, (bmax - bmin) / ah, (opts.minExtent ?? 20) / Math.min(aw, ah));
    if (opts.maxScale) s = Math.min(s, opts.maxScale);
    let ac = (amin + amax) / 2;
    let bc = (bmin + bmax) / 2;
    let cx = rect.x + padS + aw / 2;
    let cy = rect.y + padT + ah / 2;
    if (opts.anchorFirst !== undefined && count > 0) {
      // Pin the first point at a fixed height in the rect, keep it horizontally centred.
      const x = points[0];
      const y = points[1];
      const z = points[2];
      ac = x * r.x + y * r.y + z * r.z;
      bc = x * u.x + y * u.y + z * u.z;
      cy = rect.y + rect.h * opts.anchorFirst;
      cx = rect.x + rect.w / 2;
    }
    const a0 = ac - (cx - this.vw / 2) * s;
    const b0 = bc + (cy - this.vh / 2) * s;
    // Ground focus: the point on the central ray at the average height of the framed points.
    const refY = count ? ysum / count : 0;
    const ox = a0 * r.x + b0 * u.x;
    const oy = a0 * r.y + b0 * u.y;
    const oz = a0 * r.z + b0 * u.z;
    const t = (refY - oy) / this.f.y;
    this.tfx = ox + t * this.f.x;
    this.tfy = oy + t * this.f.y;
    this.tfz = oz + t * this.f.z;
    this.tyaw = yaw;
    this.tscale = s;
  }

  snap() {
    this.fx = this.tfx;
    this.fy = this.tfy;
    this.fz = this.tfz;
    this.yaw = this.tyaw;
    this.scale = this.tscale;
  }

  /** Returns true while still moving noticeably. */
  update(dt: number): boolean {
    const k = 1 - Math.exp(-this.rate * dt);
    let dy = this.tyaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const moving =
      Math.abs(dy) > 1e-4 ||
      Math.abs(this.tfx - this.fx) > 0.02 ||
      Math.abs(this.tfz - this.fz) > 0.02 ||
      Math.abs(Math.log(this.tscale / this.scale)) > 0.002;
    this.yaw += dy * k;
    this.fx += (this.tfx - this.fx) * k;
    this.fy += (this.tfy - this.fy) * k;
    this.fz += (this.tfz - this.fz) * k;
    this.scale = Math.exp(Math.log(this.scale) + (Math.log(this.tscale) - Math.log(this.scale)) * k);
    this.apply();
    return moving;
  }

  apply() {
    this.basis(this.yaw);
    const c = this.camera;
    c.position.set(this.fx - this.f.x * DIST, this.fy - this.f.y * DIST, this.fz - this.f.z * DIST);
    c.up.set(0, 1, 0);
    c.lookAt(this.fx, this.fy, this.fz);
    const hw = (this.vw / 2) * this.scale;
    const hh = (this.vh / 2) * this.scale;
    c.left = -hw;
    c.right = hw;
    c.top = hh;
    c.bottom = -hh;
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
  }

  // ---- free look (applied to current and target together, so it feels direct) ----
  /** Drag the ground with a finger: content follows the finger. */
  panPx(dx: number, dy: number) {
    const s = this.scale;
    const fwdX = Math.sin(this.yaw);
    const fwdZ = -Math.cos(this.yaw);
    const rX = Math.cos(this.yaw);
    const rZ = Math.sin(this.yaw);
    // Screen-vertical motion covers more ground because the view is tilted.
    const k = s / Math.sin(PITCH);
    this.fx += -dx * s * rX + dy * k * fwdX;
    this.fz += -dx * s * rZ + dy * k * fwdZ;
    this.tfx = this.fx;
    this.tfz = this.fz;
    this.apply();
  }

  zoomBy(f: number) {
    this.scale = Math.max(0.035, Math.min(2.5, this.scale * f));
    this.tscale = this.scale;
    this.apply();
  }

  rotateBy(a: number) {
    this.yaw += a;
    this.tyaw = this.yaw;
    this.apply();
  }

  private v = new THREE.Vector3();
  /** World → CSS px on the canvas. */
  project(x: number, y: number, z: number, out: { x: number; y: number }) {
    this.v.set(x, y, z).project(this.camera);
    out.x = (this.v.x * 0.5 + 0.5) * this.vw;
    out.y = (-this.v.y * 0.5 + 0.5) * this.vh;
    return out;
  }
}
