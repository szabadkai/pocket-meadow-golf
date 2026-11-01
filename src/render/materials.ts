import * as THREE from 'three';

export const PALETTE = {
  cream: 0xfff4dc,
  mint: 0x9ee6b8,
  butter: 0xffd86b,
  coral: 0xff8a73,
  sky: 0x9ed8f5,
  rough: 0x6fbf5e,
  roughDark: 0x5aa850,
  deep: 0x4b9a4f,
  fairway: 0x96d977,
  fairwayLight: 0xa6e386,
  green: 0xb6ef8c,
  greenLight: 0xc4f59c,
  sand: 0xf7e0a3,
  sandDark: 0xe2c27a,
  water: 0x63c3e6,
  waterDeep: 0x3f9fca,
  trunk: 0x9a6b4a,
  leaf: 0x5fbf6a,
  leafDark: 0x48a65c,
  stone: 0xd9d2c2,
  wood: 0xc08a5a,
  ink: 0x3b2f2a,
  white: 0xffffff,
};

let gradient: THREE.DataTexture | null = null;

/** Three-band cel ramp. */
export function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  const data = new Uint8Array([150, 150, 150, 255, 210, 210, 210, 255, 255, 255, 255, 255]);
  gradient = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  return gradient;
}

const toonCache = new Map<string, THREE.MeshToonMaterial>();

export function toon(color: number, opts: { vertexColors?: boolean; transparent?: boolean; side?: THREE.Side } = {}): THREE.MeshToonMaterial {
  const key = `${color}-${opts.vertexColors ? 1 : 0}-${opts.transparent ? 1 : 0}-${opts.side ?? 0}`;
  let m = toonCache.get(key);
  if (!m) {
    m = new THREE.MeshToonMaterial({
      color,
      gradientMap: toonGradient(),
      vertexColors: !!opts.vertexColors,
      transparent: !!opts.transparent,
      side: opts.side ?? THREE.FrontSide,
    });
    toonCache.set(key, m);
  }
  return m;
}

/** Shared uniforms for screen-space outlines. */
export const outlineUniforms = {
  uOutlinePx: { value: 1.6 },
  uResolution: { value: new THREE.Vector2(400, 800) },
};

const outlineCache = new Map<number, THREE.MeshBasicMaterial>();

/**
 * Inverted-hull outline with a constant on-screen width, works with InstancedMesh.
 * Only used on rounded silhouettes (trees, characters, ball) where it reads well.
 */
export function outlineMaterial(color = 0x2f3a2a): THREE.MeshBasicMaterial {
  let m = outlineCache.get(color);
  if (m) return m;
  m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uOutlinePx = outlineUniforms.uOutlinePx;
    shader.uniforms.uResolution = outlineUniforms.uResolution;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uOutlinePx;\nuniform vec2 uResolution;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        #ifdef USE_INSTANCING
          vec3 oN = mat3(modelMatrix) * mat3(instanceMatrix) * normal;
        #else
          vec3 oN = mat3(modelMatrix) * normal;
        #endif
        vec4 nClip = projectionMatrix * viewMatrix * vec4(oN, 0.0);
        vec2 nDir = length(nClip.xy) > 1e-5 ? normalize(nClip.xy) : vec2(0.0);
        gl_Position.xy += nDir * uOutlinePx * 2.0 / uResolution * gl_Position.w;
        gl_Position.z += 0.0004 * gl_Position.w;`,
      );
  };
  m.customProgramCacheKey = () => 'outline-v1';
  outlineCache.set(color, m);
  return m;
}

/** Soft round blob texture for contact shadows and puffs. */
let blobTex: THREE.CanvasTexture | null = null;
export function blobTexture(): THREE.CanvasTexture {
  if (blobTex) return blobTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)');
  grd.addColorStop(0.6, 'rgba(0,0,0,0.35)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  blobTex = new THREE.CanvasTexture(c);
  return blobTex;
}

let shadowMat: THREE.MeshBasicMaterial | null = null;
export function shadowMaterial(): THREE.MeshBasicMaterial {
  if (!shadowMat) {
    shadowMat = new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, color: 0x1d4a2a });
    shadowMat.polygonOffset = true;
    shadowMat.polygonOffsetFactor = -2;
    shadowMat.polygonOffsetUnits = -2;
  }
  return shadowMat;
}

/** Paints vertex colours onto a geometry (non-indexed or indexed). */
export function paint(geo: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
