// All sound is synthesized with WebAudio: no audio files to download.

type Surf = 'fairway' | 'rough' | 'green' | 'sand';

const NOTE: Record<string, number> = {};
{
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  for (let o = 1; o < 8; o++) names.forEach((n, i) => (NOTE[`${n}${o}`] = 440 * Math.pow(2, (o * 12 + i - 57) / 12)));
}

// 16 bars of eighth notes. '-' holds, '.' rests.
const LEAD = [
  'E5 - G5 - A5 G5 E5 - ',
  'D5 - E5 G5 - - . . ',
  'C5 - E5 - G5 A5 G5 - ',
  'E5 - D5 - - - . . ',
  'E5 - G5 - A5 G5 E5 - ',
  'D5 - E5 G5 - - C6 - ',
  'A5 - G5 - E5 - D5 - ',
  'C5 - - - . . . . ',
  'A4 - C5 - D5 - E5 - ',
  'G5 - E5 - D5 - . . ',
  'A4 - C5 - D5 - E5 G5 ',
  'A5 - - - G5 - . . ',
  'E5 - G5 - C6 - B5 - ',
  'A5 - G5 - E5 - G5 - ',
  'D5 - E5 - G5 - D5 - ',
  'C5 - - - . . . . ',
].join('').trim().split(/\s+/);
const BASS = ['C3', 'G2', 'A2', 'F2', 'C3', 'G2', 'F2', 'C3', 'F2', 'C3', 'F2', 'G2', 'C3', 'A2', 'G2', 'C3'];

export class AudioEngine {
  ctx: AudioContext | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private pulse: PeriodicWave | null = null;
  sfxVol = 0.8;
  musicVol = 0.5;
  private musicOn = false;
  private timer = 0;
  private nextTime = 0;
  private step = 0;
  private readonly stepDur = 60 / 104 / 2;

  /** Must be called from a user gesture. Safe to call repeatedly. */
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.sfxGain = this.ctx.createGain();
        this.musicGain = this.ctx.createGain();
        this.sfxGain.connect(this.ctx.destination);
        this.musicGain.connect(this.ctx.destination);
        this.applyVolumes();
        const len = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        // 25% duty pulse wave for the lead.
        const n = 32;
        const re = new Float32Array(n);
        const im = new Float32Array(n);
        for (let k = 1; k < n; k++) im[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * 0.25);
        this.pulse = this.ctx.createPeriodicWave(re, im);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  setVolumes(sfx: number, music: number) {
    this.sfxVol = sfx;
    this.musicVol = music;
    this.applyVolumes();
  }

  private applyVolumes() {
    if (!this.ctx || !this.sfxGain || !this.musicGain) return;
    const t = this.ctx.currentTime;
    this.sfxGain.gain.setTargetAtTime(this.sfxVol * 0.9, t, 0.02);
    this.musicGain.gain.setTargetAtTime(this.musicVol * 0.16, t, 0.05);
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  // ---- building blocks ----
  private env(g: GainNode, t: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private tone(type: OscillatorType | 'pulse', f0: number, f1: number, t: number, dur: number, vol: number, out?: AudioNode) {
    const c = this.ctx!;
    const o = c.createOscillator();
    if (type === 'pulse' && this.pulse) o.setPeriodicWave(this.pulse);
    else o.type = type === 'pulse' ? 'square' : type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    this.env(g, t, 0.005, vol, dur);
    o.connect(g).connect(out ?? this.sfxGain!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noiseBurst(filter: BiquadFilterType, f0: number, f1: number, q: number, t: number, dur: number, vol: number) {
    const c = this.ctx!;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    this.env(g, t, 0.006, vol, dur);
    s.connect(f).connect(g).connect(this.sfxGain!);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
  }

  private ok(): boolean {
    return !!this.ctx && this.ctx.state === 'running' && this.sfxVol > 0;
  }

  // ---- sound effects ----
  swing(power: number) {
    if (!this.ok()) return;
    const t = this.ctx!.currentTime;
    this.noiseBurst('bandpass', 500, 2600, 1.2, t, 0.16 + power * 0.08, 0.12 + power * 0.18);
  }

  hit(club: string, power: number) {
    if (!this.ok()) return;
    const t = this.ctx!.currentTime;
    if (club === 'putter') {
      this.tone('sine', 1500, 1200, t, 0.06, 0.25 + power * 0.2);
      this.noiseBurst('highpass', 3000, 3000, 0.7, t, 0.025, 0.12);
      return;
    }
    const f = club === 'driver' ? 950 : club === 'iron' ? 1250 : 1500;
    this.tone('sine', f, f * 0.55, t, 0.09, 0.5 + power * 0.3);
    this.tone('triangle', f * 2.1, f * 1.4, t, 0.05, 0.18);
    this.noiseBurst('highpass', 2500, 2500, 0.8, t, 0.035, 0.35);
    if (club === 'driver') this.tone('sine', 160, 70, t, 0.12, 0.35 * power);
  }

  land(surface: Surf, speed: number) {
    if (!this.ok()) return;
    const t = this.ctx!.currentTime;
    const v = Math.min(1, speed / 25) * 0.6 + 0.12;
    switch (surface) {
      case 'sand':
        this.noiseBurst('bandpass', 2600, 1200, 0.9, t, 0.28, v * 0.9);
        break;
      case 'green':
        this.noiseBurst('lowpass', 1100, 400, 0.7, t, 0.08, v * 0.9);
        this.tone('sine', 220, 140, t, 0.07, v * 0.4);
        break;
      case 'rough':
        this.noiseBurst('lowpass', 700, 250, 0.7, t, 0.18, v);
        break;
      default:
        this.noiseBurst('lowpass', 900, 300, 0.7, t, 0.1, v);
        this.tone('sine', 180, 110, t, 0.08, v * 0.5);
    }
  }

  splash() {
    if (!this.ok()) return;
    const t = this.ctx!.currentTime;
    this.noiseBurst('lowpass', 4000, 300, 0.8, t, 0.55, 0.6);
    this.tone('sine', 500, 160, t + 0.05, 0.18, 0.35);
    this.tone('sine', 700, 300, t + 0.22, 0.1, 0.2);
  }

  tree() {
    if (!this.ok()) return;
    const t = this.ctx!.currentTime;
    this.noiseBurst('bandpass', 3500, 2000, 1.5, t, 0.3, 0.3);
    this.tone('triangle', 320, 200, t, 0.06, 0.25);
  }

  cup() {
    if (!this.ok()) return;
    const t = this.ctx!.currentTime;
    [0, 0.07, 0.12].forEach((d, i) => this.tone('sine', 1900 - i * 250, 1400 - i * 200, t + d, 0.05, 0.35));
    ['C6', 'E6', 'G6', 'C7'].forEach((n, i) => this.tone('triangle', NOTE[n], NOTE[n], t + 0.22 + i * 0.085, 0.22, 0.28));
  }

  lip() {
    if (!this.ok()) return;
    const t = this.ctx!.currentTime;
    this.tone('sine', 1700, 1300, t, 0.05, 0.3);
    this.tone('square', 520, 380, t + 0.12, 0.35, 0.06);
  }

  chirp() {
    if (!this.ok()) return;
    const t = this.ctx!.currentTime;
    this.tone('sine', 1900, 3100, t, 0.07, 0.18);
    this.tone('sine', 2100, 3400, t + 0.1, 0.07, 0.15);
  }

  cheer() {
    if (!this.ok()) return;
    const t = this.ctx!.currentTime;
    for (let i = 0; i < 7; i++) {
      const f = 700 + Math.random() * 900;
      this.tone('square', f, f * 1.4, t + i * 0.06 + Math.random() * 0.03, 0.09, 0.05);
    }
    this.chirp();
  }

  aww() {
    if (!this.ok()) return;
    const t = this.ctx!.currentTime;
    this.tone('square', 640, 320, t, 0.5, 0.05);
    this.tone('square', 520, 260, t + 0.05, 0.5, 0.04);
  }

  penalty() {
    if (!this.ok()) return;
    const t = this.ctx!.currentTime;
    this.tone('triangle', NOTE.E4, NOTE.E4, t, 0.14, 0.3);
    this.tone('triangle', NOTE.C4, NOTE.C4, t + 0.16, 0.25, 0.3);
  }

  fanfare(good: boolean) {
    if (!this.ok()) return;
    const t = this.ctx!.currentTime;
    const seq = good ? ['C5', 'E5', 'G5', 'C6', 'G5', 'C6'] : ['C5', 'E5', 'G5', 'E5'];
    seq.forEach((n, i) => this.tone('pulse', NOTE[n], NOTE[n], t + i * 0.1, i === seq.length - 1 ? 0.4 : 0.12, 0.2));
  }

  tap() {
    if (!this.ok()) return;
    this.tone('square', 880, 880, this.ctx!.currentTime, 0.035, 0.06);
  }

  tick(power: number) {
    if (!this.ok()) return;
    const f = 500 + power * 700;
    this.tone('triangle', f, f, this.ctx!.currentTime, 0.03, 0.08);
  }

  boing() {
    if (!this.ok()) return;
    const t = this.ctx!.currentTime;
    this.tone('sine', 180, 520, t, 0.25, 0.4);
    this.tone('triangle', 260, 700, t + 0.03, 0.2, 0.15);
  }

  boop() {
    if (!this.ok()) return;
    const t = this.ctx!.currentTime;
    this.tone('sine', 700, 420, t, 0.12, 0.3);
    this.tone('sine', 980, 980, t + 0.1, 0.08, 0.15);
  }

  quack() {
    if (!this.ok()) return;
    const t = this.ctx!.currentTime;
    for (let i = 0; i < 2; i++) {
      this.tone('sawtooth', 420, 300, t + i * 0.16, 0.1, 0.07);
      this.noiseBurst('bandpass', 1200, 900, 3, t + i * 0.16, 0.08, 0.08);
    }
  }

  molePop() {
    if (!this.ok()) return;
    const t = this.ctx!.currentTime;
    this.tone('sine', 300, 900, t, 0.08, 0.35);
    this.noiseBurst('lowpass', 600, 200, 0.7, t, 0.12, 0.3);
  }

  skip() {
    if (!this.ok()) return;
    const t = this.ctx!.currentTime;
    this.noiseBurst('bandpass', 3500, 1500, 1.2, t, 0.12, 0.35);
    this.tone('sine', 900, 1500, t, 0.07, 0.2);
  }

  unlockChime() {
    if (!this.ok()) return;
    const t = this.ctx!.currentTime;
    ['G5', 'C6', 'E6', 'G6', 'C7'].forEach((n, i) => this.tone('triangle', NOTE[n], NOTE[n], t + i * 0.07, 0.3, 0.2));
  }

  // ---- flight whistle (a soft tone that follows ball speed) ----
  private whistle: { o: OscillatorNode; g: GainNode } | null = null;

  flightStart() {
    if (!this.ok() || this.whistle) return;
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = 'sine';
    const g = c.createGain();
    g.gain.value = 0;
    o.connect(g).connect(this.sfxGain!);
    o.start();
    this.whistle = { o, g };
  }

  flightUpdate(speed: number, height: number) {
    if (!this.whistle || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.whistle.o.frequency.setTargetAtTime(600 + speed * 9 + height * 25, t, 0.05);
    this.whistle.g.gain.setTargetAtTime(Math.min(0.05, speed * 0.0006), t, 0.05);
  }

  flightStop() {
    if (!this.whistle || !this.ctx) return;
    const w = this.whistle;
    this.whistle = null;
    const t = this.ctx.currentTime;
    w.g.gain.setTargetAtTime(0, t, 0.04);
    w.o.stop(t + 0.3);
  }

  // ---- music ----
  startMusic() {
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 50);
  }

  stopMusic() {
    this.musicOn = false;
    window.clearInterval(this.timer);
  }

  private schedule() {
    const c = this.ctx;
    if (!c || !this.musicGain || c.state !== 'running') return;
    if (this.musicVol <= 0) {
      this.nextTime = c.currentTime + 0.1;
      return;
    }
    while (this.nextTime < c.currentTime + 0.25) {
      const i = this.step % LEAD.length;
      const n = LEAD[i];
      if (n !== '-' && n !== '.') {
        let len = 1;
        while (LEAD[(i + len) % LEAD.length] === '-') len++;
        this.tone('pulse', NOTE[n], NOTE[n], this.nextTime, len * this.stepDur * 0.9, 0.22, this.musicGain);
      }
      if (i % 2 === 0) {
        const bar = Math.floor(i / 8);
        const root = NOTE[BASS[bar % BASS.length]];
        const f = i % 4 === 0 ? root : root * 1.5;
        this.tone('triangle', f, f, this.nextTime, this.stepDur * 1.6, 0.35, this.musicGain);
      }
      if (i % 4 === 2) {
        // Soft hi-hat.
        const s = c.createBufferSource();
        s.buffer = this.noise;
        const f = c.createBiquadFilter();
        f.type = 'highpass';
        f.frequency.value = 7000;
        const g = c.createGain();
        this.env(g, this.nextTime, 0.003, 0.08, 0.04);
        s.connect(f).connect(g).connect(this.musicGain);
        s.start(this.nextTime, Math.random() * 0.5);
        s.stop(this.nextTime + 0.06);
      }
      this.nextTime += this.stepDur;
      this.step++;
    }
  }
}
