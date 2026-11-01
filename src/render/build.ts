import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { paint } from './materials';

export type Vec3 = [number, number, number];

export interface Part {
  g: THREE.BufferGeometry;
  c: number;
  p?: Vec3;
  r?: Vec3;
  s?: Vec3 | number;
}

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const v = new THREE.Vector3();
const sv = new THREE.Vector3();

/** Merges coloured primitive parts into one vertex-coloured geometry (one draw call). */
export function assemble(parts: Part[]): THREE.BufferGeometry {
  const geos = parts.map((pt) => {
    let g = pt.g.clone();
    if (g.index) g = g.toNonIndexed();
    if (g.attributes.uv) g.deleteAttribute('uv');
    const s = pt.s ?? 1;
    m4.compose(
      v.set(...(pt.p ?? [0, 0, 0])),
      q.setFromEuler(e.set(...(pt.r ?? [0, 0, 0]))),
      typeof s === 'number' ? sv.set(s, s, s) : sv.set(...s),
    );
    g.applyMatrix4(m4);
    paint(g, pt.c);
    return g;
  });
  const merged = mergeGeometries(geos, false)!;
  geos.forEach((g) => g.dispose());
  merged.computeBoundingSphere();
  return merged;
}

// Shared primitive geometries (low poly, smooth normals for clean toon bands).
export const GEO = {
  sphere: new THREE.SphereGeometry(1, 12, 9),
  sphereLo: new THREE.SphereGeometry(1, 8, 6),
  ico: new THREE.IcosahedronGeometry(1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
  cylLo: new THREE.CylinderGeometry(1, 1, 1, 6),
  cone: new THREE.ConeGeometry(1, 1, 8),
  box: new THREE.BoxGeometry(1, 1, 1),
  halfSphere: new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
};
