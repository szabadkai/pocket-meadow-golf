import type { ClubId } from '../sim/shot';

export interface Settings {
  sfxVol: number;
  musicVol: number;
  swingMode: 'meter' | 'drag' | 'tap';
  reducedMotion: boolean;
  quality: 'auto' | 'low' | 'medium' | 'high';
  tutorialDone: boolean;
  haptics: boolean;
  /** Settings schema version (2 introduced the swing meter as the default). */
  v?: number;
}

export interface SavedBall {
  x: number;
  z: number;
  /** Previous resting spot (for stroke-and-distance). */
  px: number;
  pz: number;
}

export interface SavedRound {
  version: 1;
  mode: 'round' | 'practice';
  holeIndex: number;
  scores: (number | null)[];
  strokes: number;
  ball: SavedBall | null;
  club: ClubId;
  yaw: number | null;
  /** Wind per hole, mph and direction (radians), fixed at round start. */
  winds: { mph: number; dir: number }[];
  /** True once the current hole is finished but the next hasn't started. */
  holeDone: boolean;
}

export interface Bests {
  bestRound: number | null;
  bestToPar: number | null;
  bestHole: (number | null)[];
  roundsPlayed: number;
}

const KEY = 'pocketMeadowGolf.v1';

interface SaveFile {
  settings: Settings;
  round: SavedRound | null;
  bests: Bests;
}

export const defaultSettings = (): Settings => ({
  sfxVol: 0.8,
  musicVol: 0.5,
  swingMode: 'meter',
  reducedMotion: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  quality: 'auto',
  tutorialDone: false,
  haptics: true,
  v: 2,
});

const defaultBests = (): Bests => ({ bestRound: null, bestToPar: null, bestHole: Array(9).fill(null), roundsPlayed: 0 });

/** localStorage wrapper that degrades to in-memory storage (private mode, blocked storage). */
export class SaveStore {
  available = true;
  private data: SaveFile;

  constructor() {
    this.data = { settings: defaultSettings(), round: null, bests: defaultBests() };
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SaveFile>;
        this.data.settings = { ...this.data.settings, ...(parsed.settings ?? {}) };
        // Saves from before the swing meter existed adopt it once.
        if (parsed.settings && (parsed.settings.v ?? 1) < 2) this.data.settings = { ...this.data.settings, swingMode: 'meter', v: 2 };
        this.data.bests = { ...this.data.bests, ...(parsed.bests ?? {}) };
        if (parsed.round && parsed.round.version === 1 && Array.isArray(parsed.round.scores)) this.data.round = parsed.round;
      }
      // Probe writability (Safari private mode throws on setItem).
      window.localStorage.setItem(KEY + '.probe', '1');
      window.localStorage.removeItem(KEY + '.probe');
    } catch {
      this.available = false;
    }
  }

  get settings(): Settings {
    return this.data.settings;
  }
  get round(): SavedRound | null {
    return this.data.round;
  }
  get bests(): Bests {
    return this.data.bests;
  }

  setRound(r: SavedRound | null) {
    this.data.round = r ? JSON.parse(JSON.stringify(r)) : null;
    this.flush();
  }

  updateSettings(p: Partial<Settings>) {
    Object.assign(this.data.settings, p);
    this.flush();
  }

  updateBests(fn: (b: Bests) => void) {
    fn(this.data.bests);
    this.flush();
  }

  flush() {
    if (!this.available) return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      this.available = false;
    }
  }
}
