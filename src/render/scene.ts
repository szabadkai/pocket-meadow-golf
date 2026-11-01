import * as THREE from 'three';
import type { CourseWorld } from '../sim/world';
import { CameraRig } from './cameraRig';
import { BirdCaddie, Golfer } from './characters';
import { Effects } from './effects';
import { outlineUniforms, PALETTE } from './materials';
import { Scenery } from './scenery';
import { buildTerrainMesh, buildWater, paintCourse } from './terrain';

export type QualityLevel = 0 | 1 | 2;

const QUALITY = [
  { dpr: 1, maxPixels: 0.65e6, step: 3, tex: 1024, flowers: 0.4 },
  { dpr: 1.5, maxPixels: 1.3e6, step: 2, tex: 1536, flowers: 0.8 },
  { dpr: 2, maxPixels: 2.4e6, step: 2, tex: 2048, flowers: 1 },
];

const SKIES = {
  day: { bg: 0xbfe8f7, sun: 0xfff6e8, ambient: 0xffffff, sunI: 2.1, ambI: 1.1 },
  sunset: { bg: 0xffc59a, sun: 0xffb070, ambient: 0xffd2b8, sunI: 2.15, ambI: 1.0 },
};

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig = new CameraRig();
  readonly effects = new Effects();
  readonly golfer = new Golfer();
  readonly bird = new BirdCaddie();
  scenery: Scenery | null = null;
  quality: QualityLevel = 1;
  contextLost = false;
  private holeGroup = new THREE.Group();
  private sun: THREE.DirectionalLight;
  private ambient: THREE.AmbientLight;
  private ground: THREE.Mesh;
  private cssW = 1;
  private cssH = 1;

  constructor(readonly canvas: HTMLCanvasElement, onLost: () => void, onRestored: () => void) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'default', alpha: false, stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color(SKIES.day.bg);
    this.ambient = new THREE.AmbientLight(0xffffff, SKIES.day.ambI);
    this.sun = new THREE.DirectionalLight(0xfff6e8, SKIES.day.sunI);
    this.sun.position.set(-40, 100, 30);
    this.scene.add(this.ambient, this.sun);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x5aa850 }));
    this.ground.position.y = -1.2;
    this.scene.add(this.ground, this.holeGroup, this.effects.group, this.golfer.root, this.bird.root);
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      onLost();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      onRestored();
    });
  }

  setQuality(q: QualityLevel) {
    this.quality = q;
    this.resize(this.cssW, this.cssH);
  }

  resize(w: number, h: number) {
    this.cssW = Math.max(1, w);
    this.cssH = Math.max(1, h);
    const q = QUALITY[this.quality];
    // Cap the backing store by both a DPR ceiling and a total pixel budget.
    let pr = Math.min(window.devicePixelRatio || 1, q.dpr);
    const px = this.cssW * this.cssH * pr * pr;
    if (px > q.maxPixels) pr = Math.sqrt(q.maxPixels / (this.cssW * this.cssH));
    this.renderer.setPixelRatio(Math.max(0.6, pr));
    this.renderer.setSize(this.cssW, this.cssH, false);
    this.rig.vw = this.cssW;
    this.rig.vh = this.cssH;
    outlineUniforms.uResolution.value.set(this.cssW, this.cssH);
    this.rig.apply();
  }

  loadHole(world: CourseWorld) {
    this.disposeHole();
    const q = QUALITY[this.quality];
    const tex = paintCourse(world, q.tex);
    const terrain = buildTerrainMesh(world, q.step, tex);
    this.holeGroup.add(terrain);
    this.holeGroup.add(buildWater(world));
    this.scenery = new Scenery(world, q.flowers);
    this.holeGroup.add(this.scenery.group);
    this.effects.setHole(world);
    const sky = SKIES[world.def.sky ?? 'day'];
    (this.scene.background as THREE.Color).setHex(sky.bg);
    this.sun.color.setHex(sky.sun);
    this.sun.intensity = sky.sunI;
    this.ambient.color.setHex(sky.ambient);
    this.ambient.intensity = sky.ambI;
    (this.ground.material as THREE.MeshBasicMaterial).color.setHex(world.def.sky === 'sunset' ? 0x5f9f4a : PALETTE.deep);
    this.ground.position.y = Math.min(-1.2, world.bedAt(world.minX, world.minZ) - 0.6);
    document.documentElement.classList.toggle('sunset', world.def.sky === 'sunset');
  }

  private disposeHole() {
    this.scenery?.dispose();
    this.scenery = null;
    this.holeGroup.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.MeshToonMaterial;
      if (mat.map && mat.map instanceof THREE.CanvasTexture) mat.map.dispose();
    });
    this.holeGroup.clear();
  }

  /** Place golfer and caddie beside the ball for an aim yaw. */
  placeCharacters(world: CourseWorld, x: number, z: number, yaw: number, charScale: number, visible: boolean) {
    const dx = Math.sin(yaw);
    const dz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = Math.sin(yaw);
    const g = this.golfer.root;
    g.visible = visible;
    g.scale.setScalar(charScale);
    const gx = x - rx * 1.0 * charScale;
    const gz = z - rz * 1.0 * charScale;
    g.position.set(gx, world.heightAt(gx, gz) - 0.05, gz);
    g.rotation.y = Math.PI / 2 - yaw;
    const b = this.bird.root;
    b.visible = visible;
    b.scale.setScalar(charScale);
    const bx = x - rx * 2.4 * charScale - dx * 1.6 * charScale;
    const bz = z - rz * 2.4 * charScale - dz * 1.6 * charScale;
    b.position.set(bx, world.heightAt(bx, bz) - 0.05, bz);
    b.rotation.y = Math.PI / 2 - yaw + 0.7;
  }

  render() {
    if (this.contextLost) return;
    this.renderer.render(this.scene, this.rig.camera);
  }
}
