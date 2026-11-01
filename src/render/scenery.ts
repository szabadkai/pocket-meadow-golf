import * as THREE from 'three';
import type { AnimalKind, PropDef } from '../course/types';
import { toWorld } from '../sim/shapes';
import { mulberry32, TREE_DIMS, type CourseWorld, type TreeInstance } from '../sim/world';
import { assemble, GEO, type Part } from './build';
import { makeAnimal } from './characters';
import { outlineMaterial, PALETTE, shadowMaterial, toon } from './materials';

const LEAF_COLORS = [0x5fbf6a, 0x6fcf72, 0x4fae62, 0x7fd47a, 0x58b866];
const PETALS = [PALETTE.coral, PALETTE.butter, 0xffffff, 0xffa8c8, 0xb9a4ff, PALETTE.sky];

let treeGeos: Record<string, THREE.BufferGeometry> | null = null;
function getTreeGeos() {
  if (treeGeos) return treeGeos;
  const canopyRound = assemble([
    { g: GEO.ico, c: 0xffffff, s: [1, 0.92, 1] },
    { g: GEO.ico, c: 0xffffff, p: [0.45, 0.35, 0.1], s: 0.62 },
    { g: GEO.ico, c: 0xffffff, p: [-0.4, 0.3, -0.2], s: 0.6 },
  ]);
  const canopyTall = assemble([
    { g: GEO.cone, c: 0xffffff, p: [0, 0.7, 0], s: [1, 1.5, 1] },
    { g: GEO.cone, c: 0xffffff, p: [0, 1.6, 0], s: [0.75, 1.3, 0.75] },
  ]);
  const apples: Part[] = [];
  const rng = mulberry32(5);
  for (let i = 0; i < 9; i++) {
    const a = rng() * Math.PI * 2;
    const y = -0.3 + rng() * 0.9;
    const r = Math.sqrt(1 - y * y) * 0.98;
    apples.push({ g: GEO.sphereLo, c: 0xff5a4e, p: [Math.cos(a) * r, y, Math.sin(a) * r], s: 0.13 });
  }
  const appleDots = assemble(apples);
  const trunk = assemble([{ g: GEO.cylLo, c: PALETTE.trunk, p: [0, 0.5, 0], s: [0.3, 1, 0.38] }]);
  const bush = assemble([
    { g: GEO.ico, c: 0xffffff, p: [0, 0.6, 0], s: [1, 0.75, 1] },
    { g: GEO.ico, c: 0xffffff, p: [0.6, 0.45, 0.2], s: 0.6 },
    { g: GEO.ico, c: 0xffffff, p: [-0.55, 0.4, -0.1], s: 0.55 },
  ]);
  const flowerHead = assemble(
    [0, 1, 2, 3, 4].map((k) => {
      const a = (k / 5) * Math.PI * 2;
      return { g: GEO.sphereLo, c: 0xffffff, p: [Math.cos(a) * 0.32, 0, Math.sin(a) * 0.32], s: [0.26, 0.09, 0.2], r: [0, -a, 0] } as Part;
    }),
  );
  const flowerCenter = assemble([
    { g: GEO.sphereLo, c: 0xffcf4a, p: [0, 0.04, 0], s: [0.16, 0.1, 0.16] },
    { g: GEO.cylLo, c: 0x58b05a, p: [0, -0.6, 0], s: [0.05, 1.2, 0.05] },
    { g: GEO.sphereLo, c: 0x58b05a, p: [0.14, -0.7, 0], r: [0, 0, 0.6], s: [0.16, 0.05, 0.08] },
  ]);
  const stake = assemble([
    { g: GEO.box, c: 0xffffff, p: [0, 0.6, 0], s: [0.22, 1.2, 0.22] },
    { g: GEO.box, c: PALETTE.coral, p: [0, 1.25, 0], s: [0.26, 0.16, 0.26] },
  ]);
  treeGeos = { canopyRound, canopyTall, appleDots, trunk, bush, flowerHead, flowerCenter, stake };
  return treeGeos;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const tmpC = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, n: number): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
  m.count = n;
  m.frustumCulled = false;
  return m;
}

export interface AnimalActor {
  kind: AnimalKind;
  root: THREE.Group;
  body: THREE.Object3D;
  baseY: number;
  phase: number;
  react: number;
  reactKind: 'cheer' | 'gasp';
  baseRot: number;
}

export class Scenery {
  readonly group = new THREE.Group();
  readonly animals: AnimalActor[] = [];
  private blades: THREE.Object3D[] = [];
  private flags: THREE.Object3D[] = [];
  private lily: THREE.Object3D[] = [];

  constructor(world: CourseWorld, quality: number) {
    this.buildTrees(world.trees);
    this.buildFlowers(world, quality);
    this.buildStakes(world);
    for (const p of world.def.props ?? []) this.buildProp(world, p);
    for (const a of world.def.animals ?? []) {
      const [x, z] = toWorld(a.at);
      const root = makeAnimal(a.kind);
      const onWater = world.inWater(x, z);
      const y = onWater ? world.heightAt(x, z) - 0.15 : world.heightAt(x, z);
      root.position.set(x, y, z);
      const rot = (((a.rot ?? 0) + 180) * Math.PI) / 180;
      root.rotation.y = rot;
      root.scale.setScalar(1.6);
      this.group.add(root);
      this.animals.push({ kind: a.kind, root, body: root.getObjectByName('body')!, baseY: y, phase: Math.random() * 10, react: 0, reactKind: 'cheer', baseRot: rot });
    }
  }

  private buildTrees(trees: TreeInstance[]) {
    const G = getTreeGeos();
    const leafMat = toon(0xffffff);
    const ol = outlineMaterial(0x2c4a2c);
    const kinds = {
      round: trees.filter((t) => t.kind === 'round' || t.kind === 'apple'),
      tall: trees.filter((t) => t.kind === 'tall'),
      bush: trees.filter((t) => t.kind === 'bush'),
    };
    const add = (geo: THREE.BufferGeometry, list: TreeInstance[], place: (t: TreeInstance) => void, colorFn?: (t: TreeInstance, i: number) => number, outline = true) => {
      if (!list.length) return;
      const mesh = instanced(geo, colorFn ? leafMat : toon(0xffffff, { vertexColors: true }), list.length);
      const line = outline ? instanced(geo, ol, list.length) : null;
      list.forEach((t, i) => {
        place(t);
        mesh.setMatrixAt(i, tmpM);
        line?.setMatrixAt(i, tmpM);
        if (colorFn) mesh.setColorAt(i, tmpC.setHex(colorFn(t, i)));
      });
      if (line) this.group.add(line);
      this.group.add(mesh);
    };
    const leaf = (_t: TreeInstance, i: number) => LEAF_COLORS[i % LEAF_COLORS.length];
    add(G.canopyRound, kinds.round, (t) => {
      const d = TREE_DIMS[t.kind];
      const s = d.canopy * t.s;
      tmpM.compose(tmpP.set(t.x, t.y + d.trunk * t.s + s * 0.85, t.z), tmpQ.setFromAxisAngle(UP, t.rot), tmpS.set(s, s, s));
    }, (t, i) => (t.kind === 'apple' ? 0x6cc864 : leaf(t, i)));
    const applesList = trees.filter((t) => t.kind === 'apple');
    add(G.appleDots, applesList, (t) => {
      const d = TREE_DIMS[t.kind];
      const s = d.canopy * t.s;
      tmpM.compose(tmpP.set(t.x, t.y + d.trunk * t.s + s * 0.85, t.z), tmpQ.setFromAxisAngle(UP, t.rot), tmpS.set(s, s, s));
    }, undefined, false);
    add(G.canopyTall, kinds.tall, (t) => {
      const d = TREE_DIMS.tall;
      const s = d.canopy * t.s;
      tmpM.compose(tmpP.set(t.x, t.y + d.trunk * t.s, t.z), tmpQ.setFromAxisAngle(UP, t.rot), tmpS.set(s, s * 1.15, s));
    }, (_t, i) => [0x4fa860, 0x5cb86a, 0x469c5a][i % 3]);
    add(G.bush, kinds.bush, (t) => {
      const s = TREE_DIMS.bush.canopy * t.s;
      tmpM.compose(tmpP.set(t.x, t.y - 0.2, t.z), tmpQ.setFromAxisAngle(UP, t.rot), tmpS.set(s, s, s));
    }, (_t, i) => [0x6fcf72, 0x7fd47a][i % 2]);
    const trunks = trees.filter((t) => t.kind !== 'bush');
    add(G.trunk, trunks, (t) => {
      const d = TREE_DIMS[t.kind];
      tmpM.compose(tmpP.set(t.x, t.y - 0.3, t.z), tmpQ.identity(), tmpS.set(t.s, d.trunk * t.s + 0.6 + (t.kind === 'tall' ? 0.5 : 0), t.s));
    }, undefined, false);
    // Contact shadows under trees.
    const sh = instanced(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), shadowMaterial(), trees.length);
    trees.forEach((t, i) => {
      const r = TREE_DIMS[t.kind].canopy * t.s * 2.3;
      tmpM.compose(tmpP.set(t.x, t.y + 0.06, t.z), tmpQ.identity(), tmpS.set(r, 1, r));
      sh.setMatrixAt(i, tmpM);
    });
    sh.renderOrder = -1;
    this.group.add(sh);
  }

  private buildFlowers(world: CourseWorld, quality: number) {
    const G = getTreeGeos();
    const rng = mulberry32(world.def.number * 977);
    const spots: [number, number][] = [];
    for (const p of world.def.props ?? []) {
      if (p.type !== 'flowers') continue;
      const [cx, cz] = toWorld(p.at);
      const n = p.n ?? 6;
      for (let i = 0; i < n; i++) {
        const a = rng() * Math.PI * 2;
        const r = Math.sqrt(rng()) * 4.5;
        spots.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
      }
    }
    // Scattered wildflowers well away from play, scaled by quality.
    const extra = Math.round(40 * quality);
    for (let i = 0, tries = 0; i < extra && tries < extra * 30; tries++) {
      const x = world.minX + rng() * (world.maxX - world.minX);
      const z = world.minZ + rng() * (world.maxZ - world.minZ);
      const s = world.surfaceAt(x, z);
      if (s !== 1 && s !== 0) continue;
      let near = false;
      for (const f of world.fairways) if (f.sdf(x, z) < 6) near = true;
      if (world.green.sdf(x, z) < 10 || world.inWater(x, z)) near = true;
      for (const w of world.water) if (w.shape.sdf(x, z) < 3) near = true;
      if (near) continue;
      spots.push([x, z]);
      i++;
    }
    const heads = instanced(G.flowerHead, toon(0xffffff), spots.length);
    const centers = instanced(G.flowerCenter, toon(0xffffff, { vertexColors: true }), spots.length);
    spots.forEach(([x, z], i) => {
      const s = 1.1 + rng() * 0.7;
      const y = world.heightAt(x, z) + 1.25 * s;
      tmpM.compose(tmpP.set(x, y, z), tmpQ.setFromAxisAngle(UP, rng() * 6), tmpS.set(s * 1.5, s * 1.5, s * 1.5));
      heads.setMatrixAt(i, tmpM);
      tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(s * 1.5, s, s * 1.5));
      centers.setMatrixAt(i, tmpM);
      heads.setColorAt(i, tmpC.setHex(PETALS[Math.floor(rng() * PETALS.length)]));
    });
    this.group.add(heads, centers);
  }

  /** White OOB stakes along the play-area boundary. */
  private buildStakes(world: CourseWorld) {
    const G = getTreeGeos();
    const p = world.playArea.poly;
    const pts: [number, number][] = [];
    let acc = 0;
    for (let i = 0; i < p.length; i += 2) {
      const j = (i + 2) % p.length;
      const ax = p[i];
      const az = p[i + 1];
      const bx = p[j];
      const bz = p[j + 1];
      const l = Math.hypot(bx - ax, bz - az);
      while (acc < l) {
        const t = acc / l;
        pts.push([ax + (bx - ax) * t, az + (bz - az) * t]);
        acc += 9;
      }
      acc -= l;
    }
    const m = instanced(G.stake, toon(0xffffff, { vertexColors: true }), pts.length);
    pts.forEach(([x, z], i) => {
      tmpM.compose(tmpP.set(x, world.heightAt(x, z) - 0.1, z), tmpQ.identity(), tmpS.set(1.3, 1.3, 1.3));
      m.setMatrixAt(i, tmpM);
    });
    this.group.add(m);
  }

  private buildProp(world: CourseWorld, p: PropDef) {
    const [x, z] = toWorld(p.at);
    const y = world.heightAt(x, z);
    const rot = ((p.rot ?? 0) * Math.PI) / 180;
    const s = p.s ?? 1;
    const vc = toon(0xffffff, { vertexColors: true });
    const place = (o: THREE.Object3D, yy = y) => {
      o.position.set(x, yy, z);
      o.rotation.y = rot;
      o.scale.setScalar(s);
      this.group.add(o);
      return o;
    };
    switch (p.type) {
      case 'flowers':
        return;
      case 'umbrella': {
        const g = new THREE.Group();
        const canopy = new THREE.ConeGeometry(2.6, 1.3, 10, 1, true).toNonIndexed();
        const cols = new Float32Array(canopy.attributes.position.count * 3);
        const a = new THREE.Color(PALETTE.coral);
        const b = new THREE.Color(PALETTE.cream);
        for (let i = 0; i < canopy.attributes.position.count; i++) {
          const seg = Math.floor(i / 3);
          const c = seg % 2 === 0 ? a : b;
          cols.set([c.r, c.g, c.b], i * 3);
        }
        canopy.setAttribute('color', new THREE.BufferAttribute(cols, 3));
        canopy.computeVertexNormals();
        const cm = new THREE.Mesh(canopy, toon(0xffffff, { vertexColors: true, side: THREE.DoubleSide }));
        cm.position.y = 4.1;
        g.add(cm);
        g.add(new THREE.Mesh(assemble([
          { g: GEO.cylLo, c: 0xf2efe6, p: [0, 2.2, 0], s: [0.1, 4.4, 0.1] },
          { g: GEO.sphereLo, c: PALETTE.coral, p: [0, 4.85, 0], s: 0.18 },
        ]), vc));
        const sh = new THREE.Mesh(new THREE.PlaneGeometry(6, 6).rotateX(-Math.PI / 2), shadowMaterial());
        sh.position.y = 0.06;
        g.add(sh);
        place(g);
        return;
      }
      case 'blanket': {
        const c = document.createElement('canvas');
        c.width = c.height = 32;
        const g2 = c.getContext('2d')!;
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
          g2.fillStyle = (i + j) % 2 ? '#ff8a73' : '#fff4dc';
          g2.fillRect(i * 8, j * 8, 8, 8);
        }
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.magFilter = THREE.NearestFilter;
        const m = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 3.5).rotateX(-Math.PI / 2), new THREE.MeshToonMaterial({ map: tex }));
        place(m, y + 0.08);
        return;
      }
      case 'basket': {
        place(new THREE.Mesh(assemble([
          { g: GEO.box, c: 0xc98e55, p: [0, 0.45, 0], s: [1.3, 0.9, 0.9] },
          { g: GEO.box, c: 0xff8a73, p: [0, 0.92, 0], s: [1.34, 0.12, 0.94] },
          { g: GEO.cyl, c: 0xa8703e, p: [0, 1.25, 0], r: [Math.PI / 2, 0, 0], s: [0.5, 0.08, 0.5] },
        ]), vc));
        return;
      }
      case 'bench': {
        place(new THREE.Mesh(assemble([
          { g: GEO.box, c: PALETTE.wood, p: [0, 0.8, 0], s: [3.2, 0.18, 0.9] },
          { g: GEO.box, c: PALETTE.wood, p: [0, 1.45, -0.42], s: [3.2, 0.7, 0.14] },
          { g: GEO.box, c: 0x8a5d3c, p: [1.3, 0.4, 0], s: [0.18, 0.8, 0.8] },
          { g: GEO.box, c: 0x8a5d3c, p: [-1.3, 0.4, 0], s: [0.18, 0.8, 0.8] },
        ]), vc));
        return;
      }
      case 'sign': {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(assemble([
          { g: GEO.box, c: 0x8a5d3c, p: [0, 1.2, 0], s: [0.3, 2.4, 0.3] },
          { g: GEO.box, c: PALETTE.wood, p: [0, 2.6, 0], s: [3.4, 1.9, 0.3] },
        ]), vc));
        const c = document.createElement('canvas');
        c.width = 256;
        c.height = 144;
        const g2 = c.getContext('2d')!;
        g2.fillStyle = '#fff4dc';
        g2.beginPath();
        g2.roundRect(8, 8, 240, 128, 18);
        g2.fill();
        g2.fillStyle = '#5b3d2a';
        g2.textAlign = 'center';
        g2.font = '800 64px ui-rounded, "Arial Rounded MT Bold", system-ui, sans-serif';
        g2.fillText(`${world.def.number}`, 128, 76);
        g2.font = '800 34px ui-rounded, "Arial Rounded MT Bold", system-ui, sans-serif';
        g2.fillText(`PAR ${world.def.par}`, 128, 120);
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        const face = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 1.65), new THREE.MeshBasicMaterial({ map: tex }));
        face.position.set(0, 2.6, 0.17);
        g.add(face);
        // Face the tee player: the sign looks back down the hole (+z).
        place(g);
        g.rotation.y = rot + 0.5;
        return;
      }
      case 'lilypads': {
        const n = p.n ?? 5;
        const rng = mulberry32(Math.round(x * 13 + z * 7));
        const geo = new THREE.CylinderGeometry(0.9, 0.9, 0.08, 10, 1, false, 0.4, Math.PI * 1.75);
        const mat = toon(0x6fcf72);
        const pinkMat = toon(0xffa8c8);
        for (let i = 0; i < n; i++) {
          const a = rng() * Math.PI * 2;
          const r = rng() * 6;
          const lx = x + Math.cos(a) * r;
          const lz = z + Math.sin(a) * r;
          if (!world.inWater(lx, lz)) continue;
          const m = new THREE.Mesh(geo, mat);
          m.position.set(lx, world.heightAt(lx, lz) + 0.04, lz);
          m.rotation.y = rng() * 6;
          m.scale.setScalar(0.8 + rng() * 0.8);
          if (rng() < 0.4) {
            const f = new THREE.Mesh(GEO.sphereLo, pinkMat);
            f.scale.set(0.3, 0.2, 0.3);
            f.position.y = 0.15;
            m.add(f);
          }
          this.group.add(m);
          this.lily.push(m);
        }
        return;
      }
      case 'bridge': {
        const n = p.n ?? 12;
        const parts: Part[] = [];
        const segs = 9;
        for (let i = 0; i < segs; i++) {
          const t = (i + 0.5) / segs;
          const zz = (t - 0.5) * n;
          const yy = Math.sin(t * Math.PI) * 1.6 + 0.3;
          const ang = Math.cos(t * Math.PI) * 0.45;
          const c = i % 2 ? PALETTE.stone : 0xcbc3b0;
          parts.push({ g: GEO.box, c, p: [0, yy, zz], r: [ang, 0, 0], s: [3.6, 0.6, n / segs + 0.15] });
          parts.push({ g: GEO.box, c: 0xbdb39d, p: [1.75, yy + 0.55, zz], r: [ang, 0, 0], s: [0.45, 0.7, n / segs + 0.1] });
          parts.push({ g: GEO.box, c: 0xbdb39d, p: [-1.75, yy + 0.55, zz], r: [ang, 0, 0], s: [0.45, 0.7, n / segs + 0.1] });
        }
        parts.push({ g: GEO.box, c: 0xbdb39d, p: [0, -0.2, n / 2], s: [4, 1, 1.4] });
        parts.push({ g: GEO.box, c: 0xbdb39d, p: [0, -0.2, -n / 2], s: [4, 1, 1.4] });
        const surfY = Math.max(world.heightAt(x, z), y);
        place(new THREE.Mesh(assemble(parts), vc), surfY);
        return;
      }
      case 'windmill': {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(assemble([
          { g: new THREE.CylinderGeometry(2.6, 3.6, 10, 8), c: PALETTE.cream, p: [0, 5, 0] },
          { g: new THREE.CylinderGeometry(2.75, 2.75, 0.5, 8), c: PALETTE.coral, p: [0, 3.2, 0] },
          { g: new THREE.ConeGeometry(3.3, 3.4, 8), c: PALETTE.coral, p: [0, 11.7, 0] },
          { g: GEO.box, c: 0x8a5d3c, p: [0, 1.3, 3.3], s: [1.6, 2.6, 0.4] },
          { g: GEO.box, c: PALETTE.sky, p: [0, 6.5, 3.0], s: [1.1, 1.1, 0.3] },
          { g: GEO.box, c: PALETTE.sky, p: [2.8, 6.5, 0], s: [0.3, 1.1, 1.1] },
          { g: GEO.box, c: PALETTE.sky, p: [-2.8, 6.5, 0], s: [0.3, 1.1, 1.1] },
          { g: GEO.cyl, c: 0x8a5d3c, p: [0, 10, 3.0], r: [Math.PI / 2, 0, 0], s: [0.5, 1.4, 0.5] },
        ]), vc));
        const blades = new THREE.Group();
        const bladeGeo = assemble([
          { g: GEO.box, c: 0x8a5d3c, p: [0, 3.2, 0], s: [0.35, 6.4, 0.2] },
          { g: GEO.box, c: 0xfffaf0, p: [0.7, 3.8, 0], s: [1.2, 4.6, 0.1] },
        ]);
        for (let i = 0; i < 4; i++) {
          const b = new THREE.Mesh(bladeGeo, vc);
          b.rotation.z = (i * Math.PI) / 2;
          blades.add(b);
        }
        blades.position.set(0, 10, 3.8);
        g.add(blades);
        const sh = new THREE.Mesh(new THREE.PlaneGeometry(12, 12).rotateX(-Math.PI / 2), shadowMaterial());
        sh.position.y = 0.06;
        g.add(sh);
        place(g);
        this.blades.push(blades);
        return;
      }
      case 'clubhouse': {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(assemble([
          { g: GEO.box, c: 0xcbb79a, p: [0, 0.5, 0], s: [26, 1, 18] },
          { g: GEO.box, c: PALETTE.cream, p: [0, 4.5, -2], s: [22, 7, 12] },
          { g: new THREE.CylinderGeometry(0.01, 13.5, 6, 4, 1), c: PALETTE.coral, p: [0, 11, -2], r: [0, Math.PI / 4, 0], s: [1.15, 1, 0.68] },
          { g: GEO.box, c: 0x8a5d3c, p: [0, 2.7, 4.05], s: [2.4, 4.2, 0.3] },
          { g: GEO.box, c: 0xffe39a, p: [-6.5, 4.8, 4.05], s: [3, 2.4, 0.3] },
          { g: GEO.box, c: 0xffe39a, p: [6.5, 4.8, 4.05], s: [3, 2.4, 0.3] },
          { g: GEO.box, c: 0xffffff, p: [-6.5, 4.8, 4.15], s: [0.2, 2.4, 0.2] },
          { g: GEO.box, c: 0xffffff, p: [6.5, 4.8, 4.15], s: [0.2, 2.4, 0.2] },
          { g: GEO.box, c: PALETTE.wood, p: [0, 1.2, 6.5], s: [24, 0.3, 5] },
          { g: GEO.box, c: PALETTE.cream, p: [-11.5, 4, 8.8], s: [0.6, 6, 0.6] },
          { g: GEO.box, c: PALETTE.cream, p: [11.5, 4, 8.8], s: [0.6, 6, 0.6] },
          { g: GEO.box, c: PALETTE.cream, p: [0, 4, 8.8], s: [0.6, 6, 0.6] },
          { g: GEO.box, c: PALETTE.butter, p: [0, 7.2, 7.2], r: [0.35, 0, 0], s: [25, 0.4, 4.6] },
          { g: GEO.box, c: 0xdcd2c0, p: [7, 13, -4], s: [2, 4, 2] },
          { g: GEO.cylLo, c: 0xffffff, p: [-9, 15, -2], s: [0.12, 8, 0.12] },
        ]), vc));
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.8), toon(PALETTE.coral, { side: THREE.DoubleSide }));
        flag.geometry.translate(1.5, 0, 0);
        flag.position.set(-9, 18, -2);
        g.add(flag);
        this.flags.push(flag);
        const sh = new THREE.Mesh(new THREE.PlaneGeometry(34, 26).rotateX(-Math.PI / 2), shadowMaterial());
        sh.position.y = 0.06;
        g.add(sh);
        place(g);
        return;
      }
    }
  }

  update(t: number, dt: number, reducedMotion: boolean) {
    const speed = reducedMotion ? 0.15 : 0.6;
    for (const b of this.blades) b.rotation.z += dt * speed;
    for (const f of this.flags) f.rotation.y = Math.sin(t * 1.7) * 0.25;
    for (const a of this.animals) {
      const ph = t * 1.5 + a.phase;
      let y = a.baseY;
      let sq = 1;
      let rotY = a.baseRot;
      if (a.react > 0) {
        a.react = Math.max(0, a.react - dt);
        const k = a.react;
        if (a.reactKind === 'cheer') {
          y += Math.abs(Math.sin(k * 11)) * (reducedMotion ? 0.3 : 1.2);
          rotY += Math.sin(k * 9) * 0.3;
        } else {
          sq = 1 - Math.abs(Math.sin(k * 14)) * 0.18;
          rotY += Math.sin(k * 30) * 0.15;
        }
      } else if (a.kind === 'duck') {
        y += Math.sin(ph) * 0.06;
        rotY += Math.sin(ph * 0.3) * 0.4;
      } else {
        y += Math.max(0, Math.sin(ph * 0.7)) * 0.05;
      }
      a.root.position.y = y;
      a.root.rotation.y = rotY;
      a.body.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
    }
    for (let i = 0; i < this.lily.length; i++) this.lily[i].rotation.y += dt * 0.05 * (i % 2 ? 1 : -1);
  }

  react(kind: 'cheer' | 'gasp', near?: { x: number; z: number }) {
    for (const a of this.animals) {
      if (near && Math.hypot(a.root.position.x - near.x, a.root.position.z - near.z) > 90) continue;
      a.reactKind = kind;
      a.react = kind === 'cheer' ? 1.6 : 1.0;
    }
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry && !Object.values(GEO).includes(m.geometry as never)) {
        // Shared geometries (trees, animals) are cached; only dispose one-offs.
        const cached = treeGeos && Object.values(treeGeos).includes(m.geometry);
        if (!cached && !(m.geometry.userData.shared)) m.geometry.dispose();
      }
    });
  }
}
