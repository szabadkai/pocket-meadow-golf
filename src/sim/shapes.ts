// 2D shapes on the ground plane (world x/z) with signed distance queries.

export type V2 = [number, number];

/** Shape definitions use hole design coordinates: u = right, v = forward from the tee. */
export type ShapeDef =
  | { kind: 'ellipse'; c: V2; r: V2; rot?: number }
  | { kind: 'blob'; pts: V2[] }
  | { kind: 'path'; pts: V2[]; w: number };

/** Design (u, v) to world (x, z). Forward is world -z. */
export const toWorld = (p: V2): V2 => [p[0], -p[1]];

export class Shape {
  /** Closed outline in world x/z pairs (used for drawing, meshes and polygon distance). */
  readonly poly: Float64Array;
  readonly isPath: boolean;
  /** Path centreline in world coords (paths only). */
  readonly line: Float64Array;
  readonly halfW: number;
  minX = Infinity;
  maxX = -Infinity;
  minZ = Infinity;
  maxZ = -Infinity;
  cx = 0;
  cz = 0;

  constructor(def: ShapeDef) {
    this.isPath = def.kind === 'path';
    this.halfW = def.kind === 'path' ? def.w / 2 : 0;
    let outline: V2[];
    if (def.kind === 'ellipse') {
      outline = ellipsePoints(def.c, def.r, def.rot ?? 0, 40);
      this.line = new Float64Array(0);
    } else if (def.kind === 'blob') {
      outline = catmullClosed(def.pts, 8);
      this.line = new Float64Array(0);
    } else {
      const smooth = def.pts.length > 2 ? catmullOpen(def.pts, 6) : def.pts;
      this.line = flatten(smooth.map(toWorldPt));
      outline = pathOutline(smooth, def.w / 2);
    }
    const w = outline.map(toWorldPt);
    this.poly = flatten(w);
    for (const [x, z] of w) {
      if (x < this.minX) this.minX = x;
      if (x > this.maxX) this.maxX = x;
      if (z < this.minZ) this.minZ = z;
      if (z > this.maxZ) this.maxZ = z;
    }
    let sx = 0;
    let sz = 0;
    for (const [x, z] of w) {
      sx += x;
      sz += z;
    }
    this.cx = sx / w.length;
    this.cz = sz / w.length;
  }

  contains(x: number, z: number): boolean {
    if (x < this.minX || x > this.maxX || z < this.minZ || z > this.maxZ) return false;
    if (this.isPath) return this.pathDist(x, z) < 0;
    return pointInPoly(this.poly, x, z);
  }

  /** Signed distance: negative inside. Exact within ~12 units, a lower bound beyond. */
  sdf(x: number, z: number): number {
    const dx = Math.max(this.minX - x, 0, x - this.maxX);
    const dz = Math.max(this.minZ - z, 0, z - this.maxZ);
    const boxD = Math.sqrt(dx * dx + dz * dz);
    if (boxD > 12) return boxD;
    if (this.isPath) return this.pathDist(x, z);
    const d = polyEdgeDist(this.poly, x, z);
    return pointInPoly(this.poly, x, z) ? -d : d;
  }

  private pathDist(x: number, z: number): number {
    const l = this.line;
    let best = Infinity;
    for (let i = 0; i + 3 < l.length; i += 2) {
      const d = segDist(x, z, l[i], l[i + 1], l[i + 2], l[i + 3]);
      if (d < best) best = d;
    }
    return best - this.halfW;
  }
}

const toWorldPt = (p: V2): V2 => [p[0], -p[1]];

function flatten(pts: V2[]): Float64Array {
  const out = new Float64Array(pts.length * 2);
  pts.forEach((p, i) => {
    out[i * 2] = p[0];
    out[i * 2 + 1] = p[1];
  });
  return out;
}

export function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const abx = bx - ax;
  const abz = bz - az;
  const len2 = abx * abx + abz * abz;
  let t = len2 > 0 ? ((px - ax) * abx + (pz - az) * abz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + abx * t - px;
  const qz = az + abz * t - pz;
  return Math.sqrt(qx * qx + qz * qz);
}

function pointInPoly(p: Float64Array, x: number, z: number): boolean {
  let inside = false;
  const n = p.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = p[i * 2];
    const zi = p[i * 2 + 1];
    const xj = p[j * 2];
    const zj = p[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function polyEdgeDist(p: Float64Array, x: number, z: number): number {
  const n = p.length / 2;
  let best = Infinity;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const d = segDist(x, z, p[j * 2], p[j * 2 + 1], p[i * 2], p[i * 2 + 1]);
    if (d < best) best = d;
  }
  return best;
}

function ellipsePoints(c: V2, r: V2, rot: number, n: number): V2[] {
  const out: V2[] = [];
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a) * r[0];
    const y = Math.sin(a) * r[1];
    out.push([c[0] + x * cr - y * sr, c[1] + x * sr + y * cr]);
  }
  return out;
}

function cr(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function catmullClosed(pts: V2[], per: number): V2[] {
  const n = pts.length;
  const out: V2[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    for (let s = 0; s < per; s++) {
      const t = s / per;
      out.push([cr(p0[0], p1[0], p2[0], p3[0], t), cr(p0[1], p1[1], p2[1], p3[1], t)]);
    }
  }
  return out;
}

function catmullOpen(pts: V2[], per: number): V2[] {
  const n = pts.length;
  const out: V2[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(n - 1, i + 2)];
    for (let s = 0; s < per; s++) {
      const t = s / per;
      out.push([cr(p0[0], p1[0], p2[0], p3[0], t), cr(p0[1], p1[1], p2[1], p3[1], t)]);
    }
  }
  out.push(pts[n - 1]);
  return out;
}

/** Closed outline around a polyline with round caps (in design coords). */
function pathOutline(pts: V2[], hw: number): V2[] {
  const n = pts.length;
  const left: V2[] = [];
  const right: V2[] = [];
  const normals: V2[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
    normals.push([-dy, dx]);
  }
  for (let i = 0; i < n; i++) {
    const [nx, ny] = normals[i];
    left.push([pts[i][0] + nx * hw, pts[i][1] + ny * hw]);
    right.push([pts[i][0] - nx * hw, pts[i][1] - ny * hw]);
  }
  const cap = (c: V2, nrm: V2, startAngleSign: number): V2[] => {
    const out: V2[] = [];
    const base = Math.atan2(nrm[1], nrm[0]);
    for (let k = 1; k < 8; k++) {
      const a = base + startAngleSign * (k / 8) * Math.PI;
      out.push([c[0] + Math.cos(a) * hw, c[1] + Math.sin(a) * hw]);
    }
    return out;
  };
  const endCap = cap(pts[n - 1], normals[n - 1], -1);
  const startN: V2 = [-normals[0][0], -normals[0][1]];
  const startCap = cap(pts[0], startN, -1);
  return [...left, ...endCap, ...right.reverse(), ...startCap];
}
