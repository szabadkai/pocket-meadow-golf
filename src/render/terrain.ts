import * as THREE from 'three';
import type { Shape } from '../sim/shapes';
import { mulberry32, type CourseWorld } from '../sim/world';
import { PALETTE, toonGradient } from './materials';

const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;

/** Paints the hole layout (mown stripes, fringes, lips, shorelines) into a canvas texture. */
export function paintCourse(world: CourseWorld, maxTex: number): THREE.CanvasTexture {
  const W = world.maxX - world.minX;
  const H = world.maxZ - world.minZ;
  const ppu = Math.min(4, maxTex / Math.max(W, H));
  const cw = Math.round(W * ppu);
  const ch = Math.round(H * ppu);
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const g = canvas.getContext('2d')!;
  const X = (x: number) => (x - world.minX) * ppu;
  const Z = (z: number) => (z - world.minZ) * ppu;
  const trace = (s: Shape) => {
    g.beginPath();
    const p = s.poly;
    g.moveTo(X(p[0]), Z(p[1]));
    for (let i = 2; i < p.length; i += 2) g.lineTo(X(p[i]), Z(p[i + 1]));
    g.closePath();
  };
  const rng = mulberry32(world.def.number * 131 + 7);
  g.lineJoin = 'round';
  g.lineCap = 'round';

  // Out of bounds: deep meadow.
  g.fillStyle = css(PALETTE.deep);
  g.fillRect(0, 0, cw, ch);
  for (let i = 0; i < (W * H) / 25; i++) {
    g.fillStyle = rng() < 0.5 ? 'rgba(30,90,40,0.18)' : 'rgba(150,220,120,0.12)';
    g.fillRect(rng() * cw, rng() * ch, ppu * 0.6, ppu * 1.4);
  }
  // Rough inside the play area with tufts.
  trace(world.playArea);
  g.fillStyle = css(PALETTE.rough);
  g.fill();
  g.save();
  trace(world.playArea);
  g.clip();
  for (let i = 0; i < (W * H) / 14; i++) {
    const x = rng() * cw;
    const y = rng() * ch;
    g.fillStyle = rng() < 0.55 ? 'rgba(40,110,50,0.20)' : 'rgba(190,240,150,0.18)';
    g.beginPath();
    g.ellipse(x, y, ppu * 0.35, ppu * 0.9, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
  // Boundary line hint.
  trace(world.playArea);
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.lineWidth = ppu * 0.5;
  g.setLineDash([ppu * 2, ppu * 3]);
  g.stroke();
  g.setLineDash([]);

  // Cart paths.
  for (const p of world.paths) {
    trace(p);
    g.fillStyle = '#e9d8ad';
    g.fill();
    g.strokeStyle = '#d4bf8c';
    g.lineWidth = ppu * 0.4;
    g.stroke();
  }

  // Fairways: first cut, fill, stripes, outline.
  for (const f of world.fairways) {
    trace(f);
    g.strokeStyle = '#84cc6a';
    g.lineWidth = ppu * 3.5;
    g.stroke();
  }
  // Outline before fills so overlapping fairways only show their union edge.
  for (const f of world.fairways) {
    trace(f);
    g.strokeStyle = 'rgba(60,130,60,0.5)';
    g.lineWidth = ppu * 0.7;
    g.stroke();
  }
  for (const f of world.fairways) {
    trace(f);
    g.fillStyle = css(PALETTE.fairway);
    g.fill();
  }
  const ax = world.cupX - world.teeX;
  const az = world.cupZ - world.teeZ;
  const al = Math.hypot(ax, az) || 1;
  const dirX = ax / al;
  const dirZ = az / al;
  g.save();
  g.beginPath();
  for (const f of world.fairways) {
    const p = f.poly;
    g.moveTo(X(p[0]), Z(p[1]));
    for (let i = 2; i < p.length; i += 2) g.lineTo(X(p[i]), Z(p[i + 1]));
    g.closePath();
  }
  g.clip();
  g.fillStyle = css(PALETTE.fairwayLight);
  // Stripes perpendicular to the tee→pin axis, 9 yards wide.
  const perpX = -dirZ;
  const perpZ = dirX;
  for (let d = -40; d < al + 120; d += 18) {
    const cx = world.teeX + dirX * d;
    const cz = world.teeZ + dirZ * d;
    const L = 400;
    g.beginPath();
    g.moveTo(X(cx - perpX * L), Z(cz - perpZ * L));
    g.lineTo(X(cx + perpX * L), Z(cz + perpZ * L));
    g.lineTo(X(cx + perpX * L + dirX * 9), Z(cz + perpZ * L + dirZ * 9));
    g.lineTo(X(cx - perpX * L + dirX * 9), Z(cz - perpZ * L + dirZ * 9));
    g.closePath();
    g.fill();
  }
  g.restore();

  // Water: shoreline and bed.
  for (const w of world.water) {
    trace(w.shape);
    g.strokeStyle = '#e8dcae';
    g.lineWidth = ppu * 3.2;
    g.stroke();
    trace(w.shape);
    g.fillStyle = css(PALETTE.waterDeep);
    g.fill();
  }
  for (const is of world.islands) {
    trace(is);
    g.strokeStyle = '#e8dcae';
    g.lineWidth = ppu * 2.4;
    g.stroke();
    trace(is);
    g.fillStyle = css(PALETTE.rough);
    g.fill();
  }

  // Tee box.
  trace(world.tee);
  g.fillStyle = css(PALETTE.greenLight);
  g.fill();
  g.strokeStyle = 'rgba(60,130,60,0.6)';
  g.lineWidth = ppu * 0.4;
  g.stroke();

  // Green: fringe, fill, checker mowing, outline.
  trace(world.green);
  g.strokeStyle = '#9fdf7c';
  g.lineWidth = ppu * 4;
  g.stroke();
  trace(world.green);
  g.fillStyle = css(PALETTE.green);
  g.fill();
  g.save();
  trace(world.green);
  g.clip();
  g.fillStyle = 'rgba(255,255,255,0.10)';
  const gs = 4;
  for (let x = world.green.minX - gs; x < world.green.maxX + gs; x += gs) {
    for (let z = world.green.minZ - gs; z < world.green.maxZ + gs; z += gs) {
      if ((Math.floor(x / gs) + Math.floor(z / gs)) % 2 === 0) g.fillRect(X(x), Z(z), gs * ppu, gs * ppu);
    }
  }
  g.restore();
  trace(world.green);
  g.strokeStyle = 'rgba(50,120,60,0.5)';
  g.lineWidth = ppu * 0.35;
  g.stroke();

  // Bunkers: lip, sand, speckles (and biscuit docking holes on hole 4).
  for (const b of world.bunkers) {
    trace(b);
    g.strokeStyle = css(PALETTE.sandDark);
    g.lineWidth = ppu * 1.6;
    g.stroke();
    trace(b);
    g.fillStyle = css(PALETTE.sand);
    g.fill();
    g.save();
    trace(b);
    g.clip();
    for (let i = 0; i < ((b.maxX - b.minX) * (b.maxZ - b.minZ)) / 2; i++) {
      g.fillStyle = rng() < 0.5 ? 'rgba(200,160,90,0.35)' : 'rgba(255,255,255,0.4)';
      g.fillRect(X(b.minX + rng() * (b.maxX - b.minX)), Z(b.minZ + rng() * (b.maxZ - b.minZ)), ppu * 0.3, ppu * 0.3);
    }
    if (world.def.biscuits) {
      g.fillStyle = 'rgba(170,110,50,0.55)';
      const r = Math.min(b.maxX - b.minX, b.maxZ - b.minZ) * 0.5;
      for (let ring = 0; ring < 2; ring++) {
        const rr = r * (ring === 0 ? 0.3 : 0.62);
        const n = ring === 0 ? 3 : 7;
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2 + ring;
          g.beginPath();
          g.arc(X(b.cx + Math.cos(a) * rr), Z(b.cz + Math.sin(a) * rr), ppu * 0.42, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
    g.restore();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Heightfield mesh sampled from the visual (pond-bed) heights. */
export function buildTerrainMesh(world: CourseWorld, step: number, tex: THREE.Texture): THREE.Mesh {
  const W = world.maxX - world.minX;
  const H = world.maxZ - world.minZ;
  const nx = Math.floor(W / step) + 1;
  const nz = Math.floor(H / step) + 1;
  const pos = new Float32Array(nx * nz * 3);
  const uv = new Float32Array(nx * nz * 2);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = world.minX + Math.min(W, i * step);
      const z = world.minZ + Math.min(H, j * step);
      const k = j * nx + i;
      pos[k * 3] = x;
      pos[k * 3 + 1] = world.bedAt(x, z);
      pos[k * 3 + 2] = z;
      uv[k * 2] = (x - world.minX) / W;
      uv[k * 2 + 1] = 1 - (z - world.minZ) / H;
    }
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let o = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      idx[o++] = a;
      idx[o++] = c;
      idx[o++] = b;
      idx[o++] = b;
      idx[o++] = c;
      idx[o++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const mat = new THREE.MeshToonMaterial({ map: tex, gradientMap: toonGradient() });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/** Flat water surfaces with island holes. */
export function buildWater(world: CourseWorld): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshToonMaterial({ color: PALETTE.water, gradientMap: toonGradient() });
  const rimMat = new THREE.MeshBasicMaterial({ color: 0xe9fbff, transparent: true, opacity: 0.75 });
  for (const w of world.water) {
    const shape = new THREE.Shape();
    const p = w.shape.poly;
    shape.moveTo(p[0], -p[1]);
    for (let i = 2; i < p.length; i += 2) shape.lineTo(p[i], -p[i + 1]);
    shape.closePath();
    for (const is of world.islands) {
      const hole = new THREE.Path();
      const q = is.poly;
      hole.moveTo(q[0], -q[1]);
      for (let i = 2; i < q.length; i += 2) hole.lineTo(q[i], -q[i + 1]);
      hole.closePath();
      shape.holes.push(hole);
    }
    const geo = new THREE.ShapeGeometry(shape, 2);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = w.level;
    group.add(mesh);
    // Thin bright rim just inside the shore (ponds only; brooks stay plain).
    if (w.shape.isPath) continue;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < p.length; i += 2) {
      const dx = p[i] - w.shape.cx;
      const dz = p[i + 1] - w.shape.cz;
      const l = Math.hypot(dx, dz) || 1;
      pts.push(new THREE.Vector3(p[i] - (dx / l) * 0.5, w.level + 0.02, p[i + 1] - (dz / l) * 0.5));
    }
    pts.push(pts[0].clone());
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), pts.length * 2, 0.22, 3, true);
    group.add(new THREE.Mesh(tube, rimMat));
  }
  return group;
}
