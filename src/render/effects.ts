import * as THREE from 'three';
import { BALL_RADIUS, CUP_RADIUS } from '../sim/constants';
import type { Prediction } from '../sim/shot';
import { MAX_PATH_POINTS } from '../sim/shot';
import type { CourseWorld } from '../sim/world';
import { assemble, GEO } from './build';
import { outlineMaterial, PALETTE, shadowMaterial, toon } from './materials';

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const tmpC = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const tmpE = new THREE.Euler();

const TRAIL = 26;
const PUFFS = 48;
const CONFETTI = 90;

/** Ball, trail, aim guide, landing marker, flag, particles, slope arrows. */
export class Effects {
  readonly group = new THREE.Group();
  readonly ball: THREE.Group;
  readonly ballShadow: THREE.Mesh;
  private trail: THREE.InstancedMesh;
  private trailPts = new Float32Array(TRAIL * 3);
  private trailHead = 0;
  private trailCount = 0;
  private trailFade = 0;
  private trailPushed = false;
  private aimDots: THREE.InstancedMesh;
  private aimDotsShadow: THREE.InstancedMesh;
  readonly marker: THREE.Group;
  private markerRing: THREE.Mesh;
  private markerMat: THREE.MeshBasicMaterial;
  readonly flag: THREE.Group;
  private flagCloth: THREE.Mesh;
  private cup: THREE.Group;
  private puffs: THREE.InstancedMesh;
  private puffState = new Float32Array(PUFFS * 8); // x y z vx vy vz life size
  private confetti: THREE.InstancedMesh;
  private confState = new Float32Array(CONFETTI * 8);
  private confActive = false;
  private slope: THREE.InstancedMesh;
  private slopeData: Float32Array = new Float32Array(0);
  private slopeCount = 0;
  slopeVisible = false;
  private puttDots: THREE.InstancedMesh;
  private puttDotsShadow: THREE.InstancedMesh;

  constructor() {
    const ballGeo = GEO.sphere;
    this.ball = new THREE.Group();
    this.ball.add(new THREE.Mesh(ballGeo, outlineMaterial(0x30302c)));
    this.ball.add(new THREE.Mesh(ballGeo, toon(0xffffff)));
    this.group.add(this.ball);
    this.ballShadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), shadowMaterial());
    this.ballShadow.renderOrder = -1;
    this.group.add(this.ballShadow);

    const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false });
    this.trail = new THREE.InstancedMesh(GEO.sphereLo, dotMat, TRAIL);
    this.trail.count = 0;
    this.trail.frustumCulled = false;
    this.group.add(this.trail);

    this.aimDots = new THREE.InstancedMesh(GEO.sphereLo, new THREE.MeshBasicMaterial({ color: PALETTE.butter }), MAX_PATH_POINTS);
    this.aimDots.frustumCulled = false;
    this.aimDots.count = 0;
    this.aimDotsShadow = new THREE.InstancedMesh(GEO.sphereLo, new THREE.MeshBasicMaterial({ color: 0x5b4a20, side: THREE.BackSide }), MAX_PATH_POINTS);
    this.aimDotsShadow.frustumCulled = false;
    this.aimDotsShadow.count = 0;
    this.group.add(this.aimDotsShadow, this.aimDots);

    this.puttDots = new THREE.InstancedMesh(GEO.sphereLo, new THREE.MeshBasicMaterial({ color: 0xffffff }), MAX_PATH_POINTS);
    this.puttDots.frustumCulled = false;
    this.puttDots.count = 0;
    this.puttDotsShadow = new THREE.InstancedMesh(GEO.sphereLo, new THREE.MeshBasicMaterial({ color: 0x244c35, side: THREE.BackSide }), MAX_PATH_POINTS);
    this.puttDotsShadow.frustumCulled = false;
    this.puttDotsShadow.count = 0;
    this.group.add(this.puttDotsShadow, this.puttDots);

    this.marker = new THREE.Group();
    this.markerMat = new THREE.MeshBasicMaterial({ color: PALETTE.coral, transparent: true, opacity: 0.95, depthWrite: false });
    this.markerRing = new THREE.Mesh(new THREE.RingGeometry(0.72, 1, 28).rotateX(-Math.PI / 2), this.markerMat);
    const inner = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.42, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }));
    const back = new THREE.Mesh(new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }));
    back.position.y = -0.01;
    this.marker.add(back, this.markerRing, inner);
    this.marker.renderOrder = 2;
    this.group.add(this.marker);

    // Cup and flag.
    this.cup = new THREE.Group();
    const hole = new THREE.Mesh(new THREE.CircleGeometry(CUP_RADIUS, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x24301f }));
    const rim = new THREE.Mesh(new THREE.RingGeometry(CUP_RADIUS, CUP_RADIUS + 0.12, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    hole.position.y = 0.03;
    rim.position.y = 0.03;
    this.cup.add(hole, rim);
    this.group.add(this.cup);
    this.flag = new THREE.Group();
    const poleGeo = assemble([
      { g: GEO.cylLo, c: 0xffffff, p: [0, 2.6, 0], s: [0.07, 5.2, 0.07] },
      { g: GEO.sphereLo, c: PALETTE.butter, p: [0, 5.25, 0], s: 0.16 },
    ]);
    this.flag.add(new THREE.Mesh(poleGeo, toon(0xffffff, { vertexColors: true })));
    const cloth = new THREE.BufferGeometry();
    cloth.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 5.1, 0, 0, 3.9, 0, 2.2, 4.5, 0]), 3));
    cloth.computeVertexNormals();
    this.flagCloth = new THREE.Mesh(cloth, new THREE.MeshBasicMaterial({ color: PALETTE.coral, side: THREE.DoubleSide }));
    this.flag.add(this.flagCloth);
    this.group.add(this.flag);

    this.puffs = new THREE.InstancedMesh(GEO.sphereLo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }), PUFFS);
    this.puffs.frustumCulled = false;
    this.puffs.count = PUFFS;
    for (let i = 0; i < PUFFS; i++) {
      this.puffs.setColorAt(i, tmpC.setHex(0xffffff));
      this.puffs.setMatrixAt(i, tmpM.makeScale(0, 0, 0));
    }
    this.group.add(this.puffs);

    this.confetti = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.5, 0.3), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), CONFETTI);
    this.confetti.frustumCulled = false;
    this.confetti.count = 0;
    const cc = [PALETTE.coral, PALETTE.butter, PALETTE.sky, PALETTE.mint, 0xffffff, 0xffa8c8];
    for (let i = 0; i < CONFETTI; i++) this.confetti.setColorAt(i, tmpC.setHex(cc[i % cc.length]));
    this.group.add(this.confetti);

    const chevron = new THREE.Shape();
    chevron.moveTo(-0.5, -0.35);
    chevron.lineTo(0, 0.35);
    chevron.lineTo(0.5, -0.35);
    chevron.lineTo(0.3, -0.35);
    chevron.lineTo(0, 0.05);
    chevron.lineTo(-0.3, -0.35);
    chevron.closePath();
    const chevGeo = new THREE.ShapeGeometry(chevron).rotateX(-Math.PI / 2);
    this.slope = new THREE.InstancedMesh(chevGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.42, depthWrite: false }), 400);
    this.slope.frustumCulled = false;
    this.slope.count = 0;
    this.group.add(this.slope);
  }

  setHole(world: CourseWorld) {
    const y = world.heightAt(world.cupX, world.cupZ);
    world.slopeAt(world.cupX, world.cupZ);
    this.cup.position.set(world.cupX, y, world.cupZ);
    // Tilt the cup disc to the green plane.
    const n = new THREE.Vector3(-world.gx, 1, -world.gz).normalize();
    this.cup.quaternion.setFromUnitVectors(UP, n);
    this.flag.position.set(world.cupX, y, world.cupZ);
    this.flag.visible = true;
    // Slope arrows on a grid over the green.
    const g = world.green;
    const pts: number[] = [];
    const sp = 3.4;
    for (let x = g.minX; x <= g.maxX; x += sp) {
      for (let z = g.minZ; z <= g.maxZ; z += sp) {
        const ox = x + ((Math.round(z / sp) % 2) * sp) / 2;
        if (g.sdf(ox, z) > -1.2) continue;
        if (Math.hypot(ox - world.cupX, z - world.cupZ) < 1.5) continue;
        world.slopeAt(ox, z);
        const mag = Math.hypot(world.gx, world.gz);
        if (mag < 0.003) continue;
        pts.push(ox, world.heightAt(ox, z) + 0.06, z, -world.gx / mag, -world.gz / mag, mag);
      }
    }
    this.slopeData = new Float32Array(pts);
    this.slopeCount = Math.min(400, pts.length / 6);
    this.clearTrail();
  }

  setBall(x: number, y: number, z: number, groundY: number, visScale: number, inCup: boolean) {
    const r = BALL_RADIUS * visScale;
    this.ball.position.set(x, inCup ? y : y - BALL_RADIUS + r, z);
    this.ball.scale.setScalar(r);
    this.ball.visible = !inCup;
    const h = Math.max(0, y - BALL_RADIUS - groundY);
    const s = r * 2.6 * (1 + Math.min(h, 20) * 0.03);
    this.ballShadow.position.set(x, groundY + 0.05, z);
    this.ballShadow.scale.set(s, 1, s);
    this.ballShadow.visible = !inCup;
    (this.ballShadow.material as THREE.MeshBasicMaterial).opacity = 1;
  }

  /** Gold trail for perfect strikes, white otherwise. */
  setTrailColor(hex: number) {
    (this.trail.material as THREE.MeshBasicMaterial).color.setHex(hex);
  }

  pushTrail(x: number, y: number, z: number) {
    this.trailPts[this.trailHead * 3] = x;
    this.trailPts[this.trailHead * 3 + 1] = y;
    this.trailPts[this.trailHead * 3 + 2] = z;
    this.trailHead = (this.trailHead + 1) % TRAIL;
    this.trailCount = Math.min(TRAIL, this.trailCount + 1);
    this.trailFade = 1;
    this.trailPushed = true;
  }

  clearTrail() {
    this.trailCount = 0;
    this.trail.count = 0;
  }

  showAim(pred: Prediction | null, dotScale: number, ghost: boolean) {
    if (!pred || !pred.valid || pred.count < 2) {
      this.aimDots.count = 0;
      this.aimDotsShadow.count = 0;
      this.marker.visible = !!pred?.valid;
      if (pred?.valid) this.placeMarker(pred, dotScale, ghost);
      return;
    }
    // Evenly spaced dots along the predicted arc.
    const p = pred.path;
    let total = 0;
    for (let i = 1; i < pred.count; i++) total += Math.hypot(p[i * 3] - p[i * 3 - 3], p[i * 3 + 1] - p[i * 3 - 2], p[i * 3 + 2] - p[i * 3 - 1]);
    const n = Math.min(MAX_PATH_POINTS, Math.max(4, Math.round(total / (dotScale * 7))));
    let seg = 1;
    let acc = 0;
    let segLen = Math.hypot(p[3] - p[0], p[4] - p[1], p[5] - p[2]);
    let k = 0;
    const r = dotScale * 0.9;
    for (let i = 1; i < n; i++) {
      const target = (i / n) * total;
      while (acc + segLen < target && seg < pred.count - 1) {
        acc += segLen;
        seg++;
        segLen = Math.hypot(p[seg * 3] - p[seg * 3 - 3], p[seg * 3 + 1] - p[seg * 3 - 2], p[seg * 3 + 2] - p[seg * 3 - 1]);
      }
      const t = segLen > 0 ? (target - acc) / segLen : 0;
      const x = p[seg * 3 - 3] + (p[seg * 3] - p[seg * 3 - 3]) * t;
      const y = p[seg * 3 - 2] + (p[seg * 3 + 1] - p[seg * 3 - 2]) * t;
      const z = p[seg * 3 - 1] + (p[seg * 3 + 2] - p[seg * 3 - 1]) * t;
      const sc = ghost ? r * 0.7 : r;
      tmpM.compose(tmpP.set(x, y, z), tmpQ.identity(), tmpS.set(sc, sc, sc));
      this.aimDots.setMatrixAt(k, tmpM);
      tmpM.compose(tmpP.set(x, y, z), tmpQ.identity(), tmpS.set(sc * 1.45, sc * 1.45, sc * 1.45));
      this.aimDotsShadow.setMatrixAt(k, tmpM);
      k++;
    }
    this.aimDots.count = k;
    this.aimDotsShadow.count = k;
    this.aimDots.instanceMatrix.needsUpdate = true;
    this.aimDotsShadow.instanceMatrix.needsUpdate = true;
    (this.aimDots.material as THREE.MeshBasicMaterial).color.setHex(ghost ? 0xfff2c4 : PALETTE.butter);
    this.placeMarker(pred, dotScale, ghost);
  }

  private placeMarker(pred: Prediction, dotScale: number, ghost: boolean) {
    this.marker.visible = true;
    this.marker.position.set(pred.x, pred.y - BALL_RADIUS + 0.08, pred.z);
    const s = dotScale * 5.5;
    this.marker.scale.set(s, 1, s);
    const bad = pred.surface === 5 || pred.surface === 0;
    this.markerMat.color.setHex(bad ? 0x4a7cff : pred.surface === 4 ? 0xe0a040 : PALETTE.coral);
    this.markerMat.opacity = ghost ? 0.55 : 0.95;
  }

  /** Follow the real curved roll, resampling the bounded path into evenly spaced beads. */
  showPutt(pred: Prediction, dotScale: number, ghost: boolean) {
    this.showAim(null, dotScale, ghost);
    if (!pred.valid || pred.count < 2) { this.hidePutt(); return; }
    const p = pred.path;
    let total = 0;
    for (let i = 1; i < pred.count; i++) total += Math.hypot(p[i * 3] - p[i * 3 - 3], p[i * 3 + 2] - p[i * 3 - 1]);
    const n = Math.min(MAX_PATH_POINTS, Math.max(3, Math.round(total / Math.max(0.35, dotScale * 4))));
    let seg = 1, distance = 0;
    let len = Math.hypot(p[3] - p[0], p[5] - p[2]);
    for (let i = 1; i <= n; i++) {
      const at = total * i / n;
      while (distance + len < at && seg < pred.count - 1) {
        distance += len;
        seg++;
        len = Math.hypot(p[seg * 3] - p[seg * 3 - 3], p[seg * 3 + 2] - p[seg * 3 - 1]);
      }
      const t = len > 0 ? Math.min(1, (at - distance) / len) : 0;
      const x = p[seg * 3 - 3] + (p[seg * 3] - p[seg * 3 - 3]) * t;
      const y = p[seg * 3 - 2] + (p[seg * 3 + 1] - p[seg * 3 - 2]) * t;
      const z = p[seg * 3 - 1] + (p[seg * 3 + 2] - p[seg * 3 - 1]) * t;
      const size = dotScale * (ghost ? 0.7 : 0.8);
      tmpM.compose(tmpP.set(x, y, z), tmpQ.identity(), tmpS.set(size, size * 0.5, size));
      this.puttDots.setMatrixAt(i - 1, tmpM);
      tmpM.compose(tmpP, tmpQ, tmpS.set(size * 1.5, size * 0.85, size * 1.5));
      this.puttDotsShadow.setMatrixAt(i - 1, tmpM);
    }
    this.puttDots.count = this.puttDotsShadow.count = n;
    this.puttDots.instanceMatrix.needsUpdate = this.puttDotsShadow.instanceMatrix.needsUpdate = true;
    (this.puttDots.material as THREE.MeshBasicMaterial).color.setHex(pred.surface === 5 || pred.surface === 0 ? PALETTE.coral : PALETTE.butter);
    this.placeMarker(pred, dotScale, ghost);
  }

  hidePutt() {
    this.puttDots.count = this.puttDotsShadow.count = 0;
  }

  hideAim() {
    this.aimDots.count = 0;
    this.aimDotsShadow.count = 0;
    this.puttDots.count = this.puttDotsShadow.count = 0;
    this.marker.visible = false;
  }

  puff(x: number, y: number, z: number, color: number, count: number, power: number) {
    let spawned = 0;
    for (let i = 0; i < PUFFS && spawned < count; i++) {
      const o = i * 8;
      if (this.puffState[o + 6] > 0) continue;
      const a = Math.random() * Math.PI * 2;
      const sp = (0.5 + Math.random()) * power;
      this.puffState[o] = x;
      this.puffState[o + 1] = y + 0.2;
      this.puffState[o + 2] = z;
      this.puffState[o + 3] = Math.cos(a) * sp;
      this.puffState[o + 4] = (1 + Math.random()) * power * 0.9;
      this.puffState[o + 5] = Math.sin(a) * sp;
      this.puffState[o + 6] = 0.5 + Math.random() * 0.3;
      this.puffState[o + 7] = 0.25 + Math.random() * 0.25;
      this.puffs.setColorAt(i, tmpC.setHex(color));
      spawned++;
    }
    if (this.puffs.instanceColor) this.puffs.instanceColor.needsUpdate = true;
  }

  celebrate(x: number, y: number, z: number, scale: number, reduced: boolean) {
    const n = reduced ? 30 : CONFETTI;
    for (let i = 0; i < n; i++) {
      const o = i * 8;
      const a = Math.random() * Math.PI * 2;
      const sp = (2 + Math.random() * 5) * scale;
      this.confState[o] = x;
      this.confState[o + 1] = y + 1 * scale;
      this.confState[o + 2] = z;
      this.confState[o + 3] = Math.cos(a) * sp;
      this.confState[o + 4] = (8 + Math.random() * 8) * scale;
      this.confState[o + 5] = Math.sin(a) * sp;
      this.confState[o + 6] = 2.2 + Math.random();
      this.confState[o + 7] = Math.random() * 6;
    }
    this.confetti.count = n;
    this.confActive = true;
  }

  update(t: number, dt: number, windYaw: number, windStrength: number, dotScale: number, reduced: boolean) {
    // Flag points downwind and flutters.
    this.flag.rotation.y = -windYaw + Math.PI / 2 + Math.sin(t * 5) * 0.12 * (0.3 + windStrength);
    this.flagCloth.scale.x = 1 + Math.sin(t * 7) * 0.05;
    this.flag.scale.setScalar(Math.max(1, Math.min(4, dotScale * 1.6)));

    // Trail.
    if (this.trailCount > 0) {
      // Fade out once the ball stops adding points (after landing).
      if (!this.trailPushed) this.trailFade = Math.max(0, this.trailFade - dt * 1.4);
      this.trailPushed = false;
      if (this.trailFade === 0) this.trailCount = 0;
      for (let i = 0; i < this.trailCount; i++) {
        const idx = (this.trailHead - 1 - i + TRAIL) % TRAIL;
        const f = 1 - i / this.trailCount;
        const s = dotScale * 0.8 * (0.35 + 0.65 * f) * this.trailFade;
        tmpM.compose(tmpP.set(this.trailPts[idx * 3], this.trailPts[idx * 3 + 1], this.trailPts[idx * 3 + 2]), tmpQ.identity(), tmpS.set(s, s, s));
        this.trail.setMatrixAt(i, tmpM);
      }
      this.trail.count = this.trailFade > 0 ? this.trailCount : 0;
      this.trail.instanceMatrix.needsUpdate = true;
    }

    // Puffs.
    let anyPuff = false;
    for (let i = 0; i < PUFFS; i++) {
      const o = i * 8;
      const life = this.puffState[o + 6];
      if (life <= 0) continue;
      anyPuff = true;
      this.puffState[o + 6] = life - dt;
      this.puffState[o + 4] -= 6 * dt;
      this.puffState[o] += this.puffState[o + 3] * dt;
      this.puffState[o + 1] += this.puffState[o + 4] * dt;
      this.puffState[o + 2] += this.puffState[o + 5] * dt;
      const s = life > 0 ? this.puffState[o + 7] * Math.max(1, dotScale) * (0.6 + life) : 0;
      tmpM.compose(tmpP.set(this.puffState[o], this.puffState[o + 1], this.puffState[o + 2]), tmpQ.identity(), tmpS.set(s, s, s));
      this.puffs.setMatrixAt(i, life - dt > 0 ? tmpM : tmpM.makeScale(0, 0, 0));
    }
    if (anyPuff) this.puffs.instanceMatrix.needsUpdate = true;

    if (this.confActive) {
      let alive = 0;
      for (let i = 0; i < this.confetti.count; i++) {
        const o = i * 8;
        if (this.confState[o + 6] <= 0) {
          this.confetti.setMatrixAt(i, tmpM.makeScale(0, 0, 0));
          continue;
        }
        alive++;
        this.confState[o + 6] -= dt;
        this.confState[o + 4] -= 14 * dt;
        this.confState[o + 3] *= 1 - dt * 1.5;
        this.confState[o + 5] *= 1 - dt * 1.5;
        if (this.confState[o + 4] < -3) this.confState[o + 4] = -3;
        this.confState[o] += this.confState[o + 3] * dt;
        this.confState[o + 1] += this.confState[o + 4] * dt;
        this.confState[o + 2] += this.confState[o + 5] * dt;
        const spin = this.confState[o + 7] + t * 6;
        const s = Math.max(1, dotScale) * 1.4;
        tmpQ.setFromEuler(tmpE.set(spin, spin * 0.7, 0));
        tmpM.compose(tmpP.set(this.confState[o], this.confState[o + 1], this.confState[o + 2]), tmpQ, tmpS.set(s, s, s));
        this.confetti.setMatrixAt(i, tmpM);
      }
      this.confetti.instanceMatrix.needsUpdate = true;
      if (!alive) {
        this.confActive = false;
        this.confetti.count = 0;
      }
    }

    // Slope arrows drift downhill.
    if (this.slopeVisible && this.slopeCount) {
      const d = this.slopeData;
      for (let i = 0; i < this.slopeCount; i++) {
        const o = i * 6;
        const mag = d[o + 5];
        const shift = reduced ? 0 : ((t * 0.6 + i * 0.37) % 1) * 1.2 - 0.6;
        const s = 0.4 + Math.min(1, mag / 0.03) * 0.55;
        tmpQ.setFromAxisAngle(UP, Math.atan2(d[o + 3], d[o + 4]) + Math.PI);
        tmpM.compose(tmpP.set(d[o] + d[o + 3] * shift, d[o + 1], d[o + 2] + d[o + 4] * shift), tmpQ, tmpS.set(s, 1, s));
        this.slope.setMatrixAt(i, tmpM);
      }
      this.slope.count = this.slopeCount;
      this.slope.instanceMatrix.needsUpdate = true;
    } else {
      this.slope.count = 0;
    }
    const ringPulse = reduced ? 1 : 1 + Math.sin(t * 6) * 0.06;
    this.markerRing.scale.set(ringPulse, 1, ringPulse);
  }
}
