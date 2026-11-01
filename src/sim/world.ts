import type { HoleDef, TreeKind } from '../course/types';
import { BALL_RADIUS, Surface, type SurfaceId } from './constants';
import { Shape, segDist, toWorld, type V2 } from './shapes';

export interface Collider {
  /** 0 = sphere (canopy), 1 = vertical cylinder (trunk, tower). */
  kind: 0 | 1;
  x: number;
  y: number;
  z: number;
  r: number;
  y0: number;
  y1: number;
  /** Fraction of speed kept after hitting (leaves soak up energy). */
  damp: number;
}

/** Ground queries used by the ball simulation. */
export interface GroundModel {
  heightAt(x: number, z: number): number;
  /** Writes the terrain gradient into gx/gz. */
  slopeAt(x: number, z: number): void;
  gx: number;
  gz: number;
  surfaceAt(x: number, z: number): SurfaceId;
  readonly colliders: readonly Collider[];
  readonly hasCup: boolean;
  readonly cupX: number;
  readonly cupZ: number;
}

export interface TreeInstance {
  x: number;
  y: number;
  z: number;
  kind: TreeKind;
  s: number;
  /** Rotation for variety. */
  rot: number;
  feature: boolean;
}

/** Tree dimensions at scale 1: trunk height, canopy radius. */
export const TREE_DIMS: Record<TreeKind, { trunk: number; canopy: number }> = {
  round: { trunk: 2.2, canopy: 3.2 },
  apple: { trunk: 1.7, canopy: 2.7 },
  tall: { trunk: 1.4, canopy: 2.6 },
  bush: { trunk: 0, canopy: 1.5 },
};

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (e0: number, e1: number, x: number): number => {
  let t = (x - e0) / (e1 - e0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export interface WaterBody {
  shape: Shape;
  level: number;
}

/** Compiled hole: baked heights, surfaces, colliders. Pure data, no rendering. */
export class CourseWorld implements GroundModel {
  readonly def: HoleDef;
  readonly fairways: Shape[];
  readonly green: Shape;
  readonly bunkers: Shape[];
  readonly water: WaterBody[];
  readonly islands: Shape[];
  readonly paths: Shape[];
  readonly tee: Shape;
  readonly playArea: Shape;
  readonly hasCup = true;
  readonly cupX: number;
  readonly cupZ: number;
  readonly teeX: number;
  readonly teeZ: number;
  /** World bounds of the baked grid (hole plus scenery margin). */
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
  readonly cell = 1;
  readonly nx: number;
  readonly nz: number;
  /** Physics heights (water surfaces are flat at their level). */
  readonly heights: Float32Array;
  /** Visual heights (pond beds dip below the water surface). */
  readonly bed: Float32Array;
  readonly colliders: Collider[] = [];
  readonly trees: TreeInstance[] = [];
  readonly greenX: number;
  readonly greenZ: number;
  readonly greenH: number;
  /** Green gradient in world axes. */
  readonly greenSX: number;
  readonly greenSZ: number;
  readonly dropZones: V2[];
  gx = 0;
  gz = 0;

  constructor(def: HoleDef) {
    this.def = def;
    this.fairways = def.fairways.map((d) => new Shape(d));
    this.green = new Shape(def.green);
    this.bunkers = (def.bunkers ?? []).map((d) => new Shape(d));
    this.islands = (def.islands ?? []).map((d) => new Shape(d));
    this.paths = (def.paths ?? []).map((d) => new Shape(d));
    this.tee = new Shape({ kind: 'ellipse', c: def.tee, r: [5, 4] });
    this.playArea = new Shape(def.playArea);
    [this.cupX, this.cupZ] = toWorld(def.pin);
    [this.teeX, this.teeZ] = toWorld(def.tee);
    this.dropZones = (def.dropZones ?? []).map(toWorld);

    const margin = 70;
    const pa = this.playArea;
    this.minX = Math.floor(pa.minX - margin);
    this.maxX = Math.ceil(pa.maxX + margin);
    this.minZ = Math.floor(pa.minZ - margin);
    this.maxZ = Math.ceil(pa.maxZ + margin);
    this.nx = Math.round((this.maxX - this.minX) / this.cell) + 1;
    this.nz = Math.round((this.maxZ - this.minZ) / this.cell) + 1;

    // Water level sits just below the lowest bank point.
    this.water = (def.water ?? []).map((d) => {
      const shape = new Shape(d);
      let low = Infinity;
      for (let i = 0; i < shape.poly.length; i += 2) low = Math.min(low, this.base(shape.poly[i], shape.poly[i + 1]));
      return { shape, level: low - 0.35 };
    });

    this.greenX = this.green.cx;
    this.greenZ = this.green.cz;
    this.greenSX = def.greenSlope[0];
    this.greenSZ = -def.greenSlope[1];
    this.greenH = this.base(this.greenX, this.greenZ) + (def.greenRaise ?? 0.3);

    this.heights = new Float32Array(this.nx * this.nz);
    this.bed = new Float32Array(this.nx * this.nz);
    for (let j = 0; j < this.nz; j++) {
      const z = this.minZ + j * this.cell;
      for (let i = 0; i < this.nx; i++) {
        const x = this.minX + i * this.cell;
        const k = j * this.nx + i;
        const [h, b] = this.compose(x, z);
        this.heights[k] = h;
        this.bed[k] = b;
      }
    }
    this.buildTrees();
    this.buildPropColliders();
  }

  /** Rolling hills. */
  base(x: number, z: number): number {
    let h = 0;
    for (const hill of this.def.hills ?? []) {
      const [hx, hz] = toWorld(hill.at);
      const dx = x - hx;
      const dz = z - hz;
      h += hill.h * Math.exp(-(dx * dx + dz * dz) / (hill.r * hill.r));
    }
    return h;
  }

  /** Returns [physics height, visual height]. */
  private compose(x: number, z: number): [number, number] {
    let h = this.base(x, z);
    // Tee box: flat and slightly raised.
    const teeH = this.base(this.teeX, this.teeZ) + 0.35;
    h = mix(h, teeH, smooth(3, 0, this.tee.sdf(x, z)));
    // Green: a tilted plane blended into the surroundings.
    const gsd = this.green.sdf(x, z);
    const blend = this.def.greenBlend ?? 7;
    if (gsd < blend) {
      const plane = this.greenH + this.greenSX * (x - this.greenX) + this.greenSZ * (z - this.greenZ);
      h = mix(h, plane, smooth(blend, -1, gsd));
    }
    let vis = h;
    for (const w of this.water) {
      let sd = w.shape.sdf(x, z);
      for (const is of this.islands) sd = Math.max(sd, -is.sdf(x, z));
      if (sd < 0) {
        h = w.level;
        vis = w.level - 1.6 * smooth(0, -3.5, sd) - 0.05;
      } else if (sd < 5) {
        const bank = mix(w.level + 0.3, h, smooth(0, 5, sd));
        if (bank < h) h = bank;
        vis = h;
      }
    }
    for (const b of this.bunkers) {
      const sd = b.sdf(x, z);
      if (sd < 1.5) {
        const d = 0.75 * smooth(1, -2.2, sd);
        h -= d;
        vis -= d;
      }
    }
    return [h, vis];
  }

  private idx(x: number, z: number): [number, number, number, number] {
    let fx = (x - this.minX) / this.cell;
    let fz = (z - this.minZ) / this.cell;
    if (fx < 0) fx = 0;
    if (fz < 0) fz = 0;
    if (fx > this.nx - 1.001) fx = this.nx - 1.001;
    if (fz > this.nz - 1.001) fz = this.nz - 1.001;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    return [ix, iz, fx - ix, fz - iz];
  }

  heightAt(x: number, z: number): number {
    return this.sample(this.heights, x, z);
  }

  bedAt(x: number, z: number): number {
    return this.sample(this.bed, x, z);
  }

  private sample(arr: Float32Array, x: number, z: number): number {
    const [ix, iz, tx, tz] = this.idx(x, z);
    const k = iz * this.nx + ix;
    const h00 = arr[k];
    const h10 = arr[k + 1];
    const h01 = arr[k + this.nx];
    const h11 = arr[k + this.nx + 1];
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }

  slopeAt(x: number, z: number): void {
    const [ix, iz, tx, tz] = this.idx(x, z);
    const a = this.heights;
    const k = iz * this.nx + ix;
    const h00 = a[k];
    const h10 = a[k + 1];
    const h01 = a[k + this.nx];
    const h11 = a[k + this.nx + 1];
    this.gx = ((h10 - h00) * (1 - tz) + (h11 - h01) * tz) / this.cell;
    this.gz = ((h01 - h00) * (1 - tx) + (h11 - h10) * tx) / this.cell;
  }

  inWater(x: number, z: number): boolean {
    for (const w of this.water) {
      if (w.shape.contains(x, z)) {
        let island = false;
        for (const is of this.islands) if (is.contains(x, z)) island = true;
        if (!island) return true;
      }
    }
    return false;
  }

  surfaceAt(x: number, z: number): SurfaceId {
    if (!this.playArea.contains(x, z)) return Surface.OOB;
    if (this.green.contains(x, z)) return Surface.Green;
    for (const b of this.bunkers) if (b.contains(x, z)) return Surface.Sand;
    if (this.inWater(x, z)) return Surface.Water;
    if (this.tee.contains(x, z)) return Surface.Tee;
    for (const f of this.fairways) if (f.contains(x, z)) return Surface.Fairway;
    return Surface.Rough;
  }

  /** Distance from (x,z) to the nearest playable feature or sightline; used for scatter. */
  private clearance(x: number, z: number): number {
    let d = Infinity;
    for (const f of this.fairways) d = Math.min(d, f.sdf(x, z) - 3);
    d = Math.min(d, this.green.sdf(x, z) - 9, this.tee.sdf(x, z) - 8);
    for (const b of this.bunkers) d = Math.min(d, b.sdf(x, z) - 3);
    for (const w of this.water) d = Math.min(d, w.shape.sdf(x, z) - 3);
    for (const p of this.paths) d = Math.min(d, p.sdf(x, z) - 2);
    const lines: V2[][] = [[this.def.tee, ...(this.def.aimPoints ?? []), this.def.pin], ...(this.def.clearLines ?? [])];
    for (const line of lines) {
      for (let i = 0; i + 1 < line.length; i++) {
        const [ax, az] = toWorld(line[i]);
        const [bx, bz] = toWorld(line[i + 1]);
        d = Math.min(d, segDist(x, z, ax, az, bx, bz) - 14);
      }
    }
    for (const p of this.def.props ?? []) {
      const [px, pz] = toWorld(p.at);
      const r = p.type === 'clubhouse' ? 22 : p.type === 'windmill' ? 9 : p.type === 'bridge' ? 8 : 4;
      d = Math.min(d, Math.hypot(x - px, z - pz) - r);
    }
    return d;
  }

  private addTree(x: number, z: number, kind: TreeKind, s: number, rot: number, feature: boolean) {
    const y = this.heightAt(x, z);
    this.trees.push({ x, y, z, kind, s, rot, feature });
    const dim = TREE_DIMS[kind];
    const cr = dim.canopy * s;
    if (kind === 'tall') {
      // Cone canopy approximated by two spheres.
      this.colliders.push({ kind: 0, x, y: y + dim.trunk * s + cr * 0.8, z, r: cr * 0.95, y0: 0, y1: 0, damp: 0.45 });
      this.colliders.push({ kind: 0, x, y: y + dim.trunk * s + cr * 2.1, z, r: cr * 0.6, y0: 0, y1: 0, damp: 0.45 });
    } else {
      const cy = y + dim.trunk * s + cr * 0.85;
      this.colliders.push({ kind: 0, x, y: cy, z, r: cr * 0.92, y0: 0, y1: 0, damp: 0.45 });
    }
    if (dim.trunk > 0) {
      this.colliders.push({ kind: 1, x, y: 0, z, r: 0.35 * s + 0.05, y0: y - 1, y1: y + dim.trunk * s + 0.5, damp: 0.6 });
    }
  }

  private buildTrees() {
    const rng = mulberry32(this.def.number * 7919 + 17);
    for (const t of this.def.trees ?? []) {
      const [x, z] = toWorld(t.at);
      this.addTree(x, z, t.kind, t.s ?? 1, rng() * Math.PI * 2, true);
    }
    const sc = this.def.scatter ?? { inside: 14, outside: 70 };
    const kinds: TreeKind[] = sc.kinds ?? ['round', 'round', 'tall', 'bush', 'round', 'tall'];
    const placed: [number, number][] = this.trees.map((t) => [t.x, t.z]);
    const tryPlace = (inside: boolean, count: number) => {
      let n = 0;
      for (let attempt = 0; attempt < count * 40 && n < count; attempt++) {
        const x = this.minX + 8 + rng() * (this.maxX - this.minX - 16);
        const z = this.minZ + 8 + rng() * (this.maxZ - this.minZ - 16);
        const inPlay = this.playArea.contains(x, z);
        if (inPlay !== inside) continue;
        const clear = this.clearance(x, z);
        if (clear < (inside ? 4 : 0)) continue;
        let ok = true;
        for (const [px, pz] of placed) {
          if ((px - x) ** 2 + (pz - z) ** 2 < 49) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        placed.push([x, z]);
        const kind = kinds[Math.floor(rng() * kinds.length)];
        const scale = inside ? 0.85 + rng() * 0.45 : 1.2 + rng() * 0.7;
        this.addTree(x, z, kind, scale, rng() * Math.PI * 2, false);
        n++;
      }
    };
    tryPlace(true, sc.inside);
    tryPlace(false, Math.round(sc.outside * 1.6));
  }

  private buildPropColliders() {
    for (const p of this.def.props ?? []) {
      const [x, z] = toWorld(p.at);
      const y = this.heightAt(x, z);
      const s = p.s ?? 1;
      if (p.type === 'windmill') {
        this.colliders.push({ kind: 1, x, y: 0, z, r: 4.2 * s, y0: y - 1, y1: y + 15 * s, damp: 0.5 });
      }
    }
  }

  /** True if a ball could reasonably be dropped here (dry, in bounds, not in a tree). */
  isDropValid(x: number, z: number): boolean {
    const s = this.surfaceAt(x, z);
    if (s !== Surface.Rough && s !== Surface.Fairway && s !== Surface.Tee && s !== Surface.Green) return false;
    for (const w of this.water) if (w.shape.sdf(x, z) < 1.5) return false;
    if (this.playArea.sdf(x, z) > -1.5) return false;
    for (const c of this.colliders) {
      if (c.kind === 1 && Math.hypot(x - c.x, z - c.z) < c.r + BALL_RADIUS + 0.8) return false;
    }
    this.slopeAt(x, z);
    return Math.hypot(this.gx, this.gz) < 0.12;
  }
}
