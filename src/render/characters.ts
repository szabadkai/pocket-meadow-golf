import * as THREE from 'three';
import type { AnimalKind } from '../course/types';
import { assemble, GEO, type Part } from './build';
import { outlineMaterial, PALETTE, shadowMaterial, toon } from './materials';

const SKIN = 0xffd2ad;
const INK = 0x2d2420;

function withOutline(geo: THREE.BufferGeometry): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(geo, toon(0xffffff, { vertexColors: true }));
  const line = new THREE.Mesh(geo, outlineMaterial());
  g.add(line, body);
  return g;
}

function blobShadow(r: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), shadowMaterial());
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.04;
  m.renderOrder = -1;
  return m;
}

/**
 * The golfer: oversized cap, faces local +Z (toward the ball); the target is local +X.
 * swing.rotation.z: negative = backswing, positive = follow-through.
 */
export class Golfer {
  readonly root = new THREE.Group();
  readonly swing = new THREE.Group();
  private bodyGroup: THREE.Group;
  private capMat: THREE.MeshToonMaterial;

  setCap(color: number) {
    this.capMat.color.setHex(color);
  }

  constructor() {
    const body: Part[] = [
      { g: GEO.sphereLo, c: 0x6b4a3a, p: [0.26, 0.1, 0.05], s: [0.17, 0.11, 0.26] },
      { g: GEO.sphereLo, c: 0x6b4a3a, p: [-0.26, 0.1, 0.05], s: [0.17, 0.11, 0.26] },
      { g: GEO.cyl, c: 0x47609e, p: [0.22, 0.48, 0], s: [0.16, 0.72, 0.16] },
      { g: GEO.cyl, c: 0x47609e, p: [-0.22, 0.48, 0], s: [0.16, 0.72, 0.16] },
      { g: GEO.sphere, c: PALETTE.coral, p: [0, 1.2, 0], s: [0.52, 0.56, 0.44] },
      { g: GEO.sphere, c: 0xffffff, p: [0, 1.5, 0.28], s: [0.2, 0.1, 0.12] },
      { g: GEO.sphere, c: SKIN, p: [0, 1.98, 0.02], s: 0.42 },
      { g: GEO.sphereLo, c: 0xffb48f, p: [0, 1.93, 0.42], s: 0.08 },
      { g: GEO.sphereLo, c: INK, p: [0.14, 2.02, 0.36], s: [0.05, 0.07, 0.04] },
      { g: GEO.sphereLo, c: INK, p: [-0.14, 2.02, 0.36], s: [0.05, 0.07, 0.04] },
      { g: GEO.sphereLo, c: 0xff9e9e, p: [0.24, 1.9, 0.32], s: [0.07, 0.05, 0.03] },
      { g: GEO.sphereLo, c: 0xff9e9e, p: [-0.24, 1.9, 0.32], s: [0.07, 0.05, 0.03] },
      { g: GEO.sphereLo, c: PALETTE.coral, p: [0, 2.5, -0.02], s: 0.08 },
      { g: GEO.cyl, c: PALETTE.coral, p: [0, 2.12, -0.02], s: [0.505, 0.06, 0.505] },
    ];
    this.bodyGroup = withOutline(assemble(body));
    // The oversized cap is its own mesh so the wardrobe can recolour it.
    const capGeo = assemble([
      { g: GEO.halfSphere, c: 0xffffff, p: [0, 2.08, -0.02], s: [0.5, 0.42, 0.5] },
      { g: GEO.cyl, c: 0xffffff, p: [0, 2.1, 0.45], s: [0.42, 0.05, 0.5] },
    ]);
    this.capMat = new THREE.MeshToonMaterial({ color: PALETTE.butter, vertexColors: true, gradientMap: toon(0xffffff).gradientMap });
    this.bodyGroup.add(new THREE.Mesh(capGeo, outlineMaterial()), new THREE.Mesh(capGeo, this.capMat));
    this.root.add(this.bodyGroup);

    const rig: Part[] = [
      { g: GEO.cyl, c: PALETTE.coral, p: [0.18, -0.25, 0.14], r: [0.5, 0, 0.3], s: [0.11, 0.55, 0.11] },
      { g: GEO.cyl, c: PALETTE.coral, p: [-0.18, -0.25, 0.14], r: [0.5, 0, -0.3], s: [0.11, 0.55, 0.11] },
      { g: GEO.sphereLo, c: SKIN, p: [0, -0.52, 0.32], s: 0.14 },
      { g: GEO.cylLo, c: 0xcfd6dc, p: [0, -0.98, 0.52], r: [0.42, 0, 0], s: [0.035, 1.0, 0.035] },
      { g: GEO.box, c: 0x8a96a3, p: [0.06, -1.42, 0.72], r: [0.42, 0, 0], s: [0.26, 0.12, 0.1] },
    ];
    const rigMesh = withOutline(assemble(rig));
    this.swing.position.set(0, 1.45, 0.05);
    this.swing.add(rigMesh);
    this.root.add(this.swing);
    this.root.add(blobShadow(0.9));
  }

  /** t in [-1, 1]: -1 full backswing, 0 address, 1 full follow-through. */
  setSwing(t: number) {
    this.swing.rotation.z = t < 0 ? t * 2.3 : t * 2.5;
    // Body turn.
    this.bodyGroup.rotation.y = t * 0.35;
    this.swing.rotation.y = t * 0.35;
  }
}

/** Pip, the round bird caddie. */
export class BirdCaddie {
  readonly root = new THREE.Group();
  readonly body: THREE.Group;
  readonly wingL: THREE.Mesh;
  readonly wingR: THREE.Mesh;
  private scarfMat: THREE.MeshToonMaterial;

  setScarf(color: number) {
    this.scarfMat.color.setHex(color);
  }

  constructor() {
    const parts: Part[] = [
      { g: GEO.sphere, c: 0x7cc8f0, p: [0, 0.62, 0], s: [0.56, 0.54, 0.54] },
      { g: GEO.sphere, c: PALETTE.cream, p: [0, 0.55, 0.22], s: [0.4, 0.38, 0.34] },
      { g: GEO.cone, c: 0xffa53d, p: [0, 0.72, 0.58], r: [Math.PI / 2, 0, 0], s: [0.11, 0.24, 0.11] },
      { g: GEO.sphereLo, c: INK, p: [0.18, 0.85, 0.44], s: [0.06, 0.08, 0.05] },
      { g: GEO.sphereLo, c: INK, p: [-0.18, 0.85, 0.44], s: [0.06, 0.08, 0.05] },
      { g: GEO.sphereLo, c: 0xff9e9e, p: [0.3, 0.7, 0.4], s: [0.07, 0.05, 0.03] },
      { g: GEO.sphereLo, c: 0xff9e9e, p: [-0.3, 0.7, 0.4], s: [0.07, 0.05, 0.03] },
      { g: GEO.cone, c: 0x5aaedb, p: [0, 1.22, -0.05], r: [-0.4, 0, 0], s: [0.09, 0.26, 0.09] },
      { g: GEO.cyl, c: 0xffa53d, p: [0.15, 0.06, 0.05], s: [0.04, 0.14, 0.04] },
      { g: GEO.cyl, c: 0xffa53d, p: [-0.15, 0.06, 0.05], s: [0.04, 0.14, 0.04] },
    ];
    this.body = withOutline(assemble(parts));
    const scarfGeo = assemble([
      { g: GEO.cyl, c: 0xffffff, p: [0, 0.38, 0], s: [0.46, 0.1, 0.46] },
      { g: GEO.box, c: 0xffffff, p: [0.25, 0.25, -0.3], r: [0.3, 0.4, 0.3], s: [0.14, 0.26, 0.05] },
    ]);
    this.scarfMat = new THREE.MeshToonMaterial({ color: PALETTE.coral, vertexColors: true, gradientMap: toon(0xffffff).gradientMap });
    this.body.add(new THREE.Mesh(scarfGeo, this.scarfMat));
    const wingGeo = assemble([{ g: GEO.sphereLo, c: 0x5aaedb, s: [0.08, 0.26, 0.2] }]);
    const wm = toon(0xffffff, { vertexColors: true });
    this.wingL = new THREE.Mesh(wingGeo, wm);
    this.wingR = new THREE.Mesh(wingGeo, wm);
    this.wingL.position.set(0.54, 0.62, -0.02);
    this.wingR.position.set(-0.54, 0.62, -0.02);
    this.body.add(this.wingL, this.wingR);
    this.root.add(this.body);
    this.root.add(blobShadow(0.6));
  }
}

function animalParts(kind: AnimalKind): Part[] {
  switch (kind) {
    case 'bunny':
      return [
        { g: GEO.sphere, c: 0xfff8ee, p: [0, 0.5, -0.1], s: [0.45, 0.42, 0.5] },
        { g: GEO.sphere, c: 0xfff8ee, p: [0, 0.98, 0.25], s: 0.33 },
        { g: GEO.sphere, c: 0xfff8ee, p: [0.12, 1.5, 0.2], r: [-0.2, 0, -0.15], s: [0.09, 0.32, 0.06] },
        { g: GEO.sphere, c: 0xfff8ee, p: [-0.12, 1.5, 0.2], r: [-0.2, 0, 0.15], s: [0.09, 0.32, 0.06] },
        { g: GEO.sphereLo, c: 0xffb4b4, p: [0.12, 1.5, 0.25], r: [-0.2, 0, -0.15], s: [0.05, 0.24, 0.03] },
        { g: GEO.sphereLo, c: 0xffb4b4, p: [-0.12, 1.5, 0.25], r: [-0.2, 0, 0.15], s: [0.05, 0.24, 0.03] },
        { g: GEO.sphereLo, c: INK, p: [0.13, 1.03, 0.52], s: 0.05 },
        { g: GEO.sphereLo, c: INK, p: [-0.13, 1.03, 0.52], s: 0.05 },
        { g: GEO.sphereLo, c: 0xff9e9e, p: [0, 0.93, 0.57], s: 0.05 },
        { g: GEO.sphereLo, c: 0xffffff, p: [0, 0.45, -0.6], s: 0.16 },
      ];
    case 'sheep':
      return [
        { g: GEO.sphere, c: PALETTE.cream, p: [0, 0.85, 0], s: [0.6, 0.48, 0.75] },
        { g: GEO.sphere, c: PALETTE.cream, p: [0.3, 1.05, 0.25], s: 0.35 },
        { g: GEO.sphere, c: PALETTE.cream, p: [-0.3, 1.05, -0.2], s: 0.35 },
        { g: GEO.sphere, c: PALETTE.cream, p: [0, 1.15, -0.1], s: 0.38 },
        { g: GEO.sphere, c: 0x4a3b35, p: [0, 1.0, 0.82], s: [0.26, 0.3, 0.3] },
        { g: GEO.sphereLo, c: 0xffffff, p: [0.1, 1.08, 1.06], s: 0.06 },
        { g: GEO.sphereLo, c: 0xffffff, p: [-0.1, 1.08, 1.06], s: 0.06 },
        { g: GEO.sphere, c: 0x4a3b35, p: [0.28, 1.12, 0.78], s: [0.16, 0.06, 0.08] },
        { g: GEO.sphere, c: 0x4a3b35, p: [-0.28, 1.12, 0.78], s: [0.16, 0.06, 0.08] },
        { g: GEO.cyl, c: 0x4a3b35, p: [0.25, 0.25, 0.35], s: [0.08, 0.5, 0.08] },
        { g: GEO.cyl, c: 0x4a3b35, p: [-0.25, 0.25, 0.35], s: [0.08, 0.5, 0.08] },
        { g: GEO.cyl, c: 0x4a3b35, p: [0.25, 0.25, -0.35], s: [0.08, 0.5, 0.08] },
        { g: GEO.cyl, c: 0x4a3b35, p: [-0.25, 0.25, -0.35], s: [0.08, 0.5, 0.08] },
      ];
    case 'duck':
      return [
        { g: GEO.sphere, c: 0xffffff, p: [0, 0.3, 0], s: [0.38, 0.3, 0.55] },
        { g: GEO.sphere, c: 0xffffff, p: [0, 0.78, 0.32], s: 0.25 },
        { g: GEO.box, c: 0xffa53d, p: [0, 0.74, 0.6], s: [0.2, 0.07, 0.22] },
        { g: GEO.sphereLo, c: INK, p: [0.12, 0.85, 0.48], s: 0.04 },
        { g: GEO.sphereLo, c: INK, p: [-0.12, 0.85, 0.48], s: 0.04 },
        { g: GEO.cone, c: 0xffffff, p: [0, 0.45, -0.55], r: [-1.1, 0, 0], s: [0.14, 0.3, 0.1] },
      ];
    case 'frog':
      return [
        { g: GEO.sphere, c: 0x7bcf5a, p: [0, 0.35, 0], s: [0.5, 0.35, 0.45] },
        { g: GEO.sphere, c: 0x7bcf5a, p: [0.2, 0.68, 0.2], s: 0.16 },
        { g: GEO.sphere, c: 0x7bcf5a, p: [-0.2, 0.68, 0.2], s: 0.16 },
        { g: GEO.sphereLo, c: 0xffffff, p: [0.22, 0.72, 0.3], s: 0.1 },
        { g: GEO.sphereLo, c: 0xffffff, p: [-0.22, 0.72, 0.3], s: 0.1 },
        { g: GEO.sphereLo, c: INK, p: [0.23, 0.73, 0.38], s: 0.05 },
        { g: GEO.sphereLo, c: INK, p: [-0.23, 0.73, 0.38], s: 0.05 },
        { g: GEO.sphere, c: 0xd8f4a8, p: [0, 0.28, 0.2], s: [0.36, 0.2, 0.3] },
        { g: GEO.sphere, c: 0x5fb247, p: [0.42, 0.15, -0.1], s: [0.2, 0.12, 0.3] },
        { g: GEO.sphere, c: 0x5fb247, p: [-0.42, 0.15, -0.1], s: [0.2, 0.12, 0.3] },
      ];
    case 'hedgehog':
      return [
        { g: GEO.cone, c: 0x8a6046, p: [0, 0.4, -0.1], r: [-1.35, 0, 0], s: [0.5, 0.9, 0.45] },
        { g: GEO.sphere, c: 0x8a6046, p: [0, 0.38, -0.25], s: [0.5, 0.38, 0.5] },
        { g: GEO.sphere, c: 0xf2d6b3, p: [0, 0.3, 0.35], s: [0.26, 0.24, 0.3] },
        { g: GEO.sphereLo, c: INK, p: [0, 0.3, 0.66], s: 0.07 },
        { g: GEO.sphereLo, c: INK, p: [0.11, 0.42, 0.52], s: 0.04 },
        { g: GEO.sphereLo, c: INK, p: [-0.11, 0.42, 0.52], s: 0.04 },
      ];
  }
}

const animalGeoCache = new Map<AnimalKind, THREE.BufferGeometry>();

export function makeAnimal(kind: AnimalKind): THREE.Group {
  let geo = animalGeoCache.get(kind);
  if (!geo) {
    geo = assemble(animalParts(kind));
    animalGeoCache.set(kind, geo);
  }
  const root = new THREE.Group();
  const body = withOutline(geo);
  body.name = 'body';
  root.add(body);
  if (kind !== 'duck') root.add(blobShadow(kind === 'sheep' ? 0.9 : 0.6));
  return root;
}
