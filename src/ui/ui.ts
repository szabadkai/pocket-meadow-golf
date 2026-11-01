import { HOLES } from '../course/holes';
import type { Bests, Settings } from '../game/save';
import type { CameraRig } from '../render/cameraRig';
import type { ClubId } from '../sim/shot';
import { METER, type MeterStage } from '../sim/meter';
import { HUD_HTML } from './markup';

const SCREENS = ['scrTitle', 'scrPractice', 'scrSettings', 'scrPause', 'scrCard', 'scrHole', 'scrResults', 'scrLost'];

/** Thin DOM layer: no game rules here, just showing state and forwarding taps. */
export class UI {
  readonly root: HTMLElement;
  readonly clubButtons: HTMLButtonElement[];
  hudVisible = false;
  speaking = false;
  private els = new Map<string, HTMLElement>();
  private speechTimer = 0;
  private toastTimer = 0;
  private backHandler: () => void = () => {};
  private settingsHandler: (p: Partial<Settings>) => void = () => {};
  private returnTo: string | null = null;
  private tutorialActive = false;
  private tmp = { x: 0, y: 0 };

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = HUD_HTML;
    this.clubButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('.club'));
    root.querySelectorAll('[data-back]').forEach((b) =>
      b.addEventListener('click', () => {
        const to = this.returnTo;
        this.returnTo = null;
        if (to) this.show(to);
        else this.backHandler();
      }),
    );
    this.bindSettings();
    this.layoutMeter();
  }

  /** Bar position (%) for a meter value: impact line at 0, full power at 1. */
  private meterX(u: number): number {
    return ((u - METER.start) / (1 - METER.start)) * 100;
  }

  /** In landscape the meter stands upright in the tall side column. */
  private verticalMq = window.matchMedia('(orientation: landscape) and (max-height: 600px)');
  private meterVertical: boolean | null = null;
  private get pos() {
    return this.meterVertical ? 'bottom' : 'left';
  }
  private get len() {
    return this.meterVertical ? 'height' : 'width';
  }

  private layoutMeter() {
    const v = this.verticalMq.matches;
    if (v === this.meterVertical) return;
    this.meterVertical = v;
    this.$('meterPad').classList.toggle('vertical', v);
    for (const id of ['meterZone', 'meterImpact', 'meterFill', 'meterSet', 'meterCursor']) this.$(id).removeAttribute('style');
    const z = this.$('meterZone');
    z.style[this.pos] = `${this.meterX(-METER.zone)}%`;
    z.style[this.len] = `${this.meterX(METER.zone) - this.meterX(-METER.zone)}%`;
    this.$('meterImpact').style[this.pos] = `${this.meterX(0)}%`;
    const ticks = this.$('meterTicks');
    ticks.innerHTML = [0.25, 0.5, 0.75, 1].map((t) => `<i style="${this.pos}:${this.meterX(t)}%"><span>${Math.round(t * 100)}</span></i>`).join('');
  }

  setMeter(stage: MeterStage, u: number, power: number, label: string, carry: string) {
    this.layoutMeter();
    const active = stage === 'power' || stage === 'accuracy';
    this.$('meterPad').classList.toggle('active', active);
    this.$('meterCancel').classList.toggle('hidden', !active);
    const cur = this.$('meterCursor');
    cur.style[this.pos] = `${this.meterX(stage === 'idle' ? 0 : u)}%`;
    cur.classList.toggle('hidden', stage === 'idle');
    const fill = this.$('meterFill');
    const top = stage === 'power' ? Math.max(0, u) : stage === 'idle' ? 0 : power;
    fill.style[this.pos] = `${this.meterX(0)}%`;
    fill.style[this.len] = `${this.meterX(top) - this.meterX(0)}%`;
    const set = this.$('meterSet');
    set.classList.toggle('hidden', stage !== 'accuracy' && stage !== 'done');
    set.style[this.pos] = `${this.meterX(power)}%`;
    const l = this.$('meterLabel');
    if (l.textContent !== label) l.textContent = label;
    const c = this.$('meterCarry');
    if (c.textContent !== carry) c.textContent = carry;
  }

  $(id: string): HTMLElement {
    let e = this.els.get(id);
    if (!e) {
      e = this.root.querySelector<HTMLElement>('#' + id)!;
      if (!e) throw new Error('missing #' + id);
      this.els.set(id, e);
    }
    return e;
  }

  onClick(id: string, fn: () => void) {
    this.$(id).addEventListener('click', fn);
  }

  onBack(fn: () => void) {
    this.backHandler = fn;
  }

  onSettings(fn: (p: Partial<Settings>) => void) {
    this.settingsHandler = fn;
  }

  show(id: string, returnTo?: string) {
    for (const s of SCREENS) this.$(s).classList.toggle('hidden', s !== id);
    this.returnTo = returnTo ?? null;
  }

  hideScreens() {
    for (const s of SCREENS) this.$(s).classList.add('hidden');
  }

  setHud(v: boolean) {
    this.hudVisible = v;
    this.$('hud').classList.toggle('hidden', !v);
    if (!v) {
      this.hidePower();
      this.hideLanding();
      this.hideSpeech();
    }
  }

  setFlying(v: boolean) {
    this.$('hud').classList.toggle('flying', v);
    this.$('pad').classList.toggle('disabled', v);
    this.$('meterPad').classList.toggle('disabled', v);
  }

  setSwingMode(mode: 'meter' | 'drag' | 'tap') {
    this.$('meterPad').classList.toggle('hidden', mode !== 'meter');
    this.$('pad').classList.toggle('hidden', mode !== 'drag');
    this.$('tapPad').classList.toggle('hidden', mode !== 'tap');
  }

  setOverview(on: boolean) {
    const b = this.$('overviewBtn');
    b.classList.toggle('active', on);
    b.querySelector('span')!.textContent = on ? 'Back' : 'Look';
    this.$('lookTools').classList.toggle('hidden', !on);
    this.$('lookHint').classList.toggle('hidden', !on);
  }

  setClub(c: ClubId) {
    for (const b of this.clubButtons) b.setAttribute('aria-checked', String(b.dataset.club === c));
  }

  setHudText(t: { hole: string; name: string; par: string; stroke: string; total: string; pin: string; lie: string; lieBad: boolean; wind: number }) {
    this.$('hudHole').textContent = t.hole;
    this.$('hudName').textContent = t.name;
    this.$('hudPar').textContent = t.par;
    this.$('hudStroke').textContent = t.stroke;
    this.$('hudTotal').textContent = t.total;
    this.$('chipPin').textContent = t.pin;
    const lie = this.$('chipLie');
    lie.textContent = t.lie;
    lie.classList.toggle('bad', t.lieBad);
    const calm = t.wind === 0;
    this.$('windSpeed').textContent = calm ? '–' : String(t.wind);
    this.$('windArrow').style.visibility = calm ? 'hidden' : 'visible';
    this.$('wind').querySelector('small')!.textContent = calm ? 'calm' : 'mph';
  }

  private lastWindDeg = NaN;
  setWindArrow(rad: number) {
    const deg = Math.round((rad * 180) / Math.PI);
    if (deg === this.lastWindDeg) return;
    this.lastWindDeg = deg;
    this.$('windArrow').style.transform = `rotate(${deg}deg)`;
  }

  showPower(x: number, y: number, p: number, carry: string, cancel: boolean) {
    const el = this.$('power');
    el.classList.remove('hidden');
    el.classList.toggle('cancel', cancel);
    const w = window.innerWidth;
    const cx = Math.max(60, Math.min(w - 60, x));
    // Keep the bubble above the finger and fully on screen.
    const cy = Math.max(70, y - 30);
    el.style.transform = `translate(${cx}px, ${cy}px) translate(-50%, -100%)`;
    el.style.left = '0';
    el.style.top = '0';
    this.$('powerPct').textContent = cancel ? 'Cancel' : `${Math.round(p * 100)}%`;
    this.$('powerCarry').textContent = cancel ? 'release to cancel' : p < 0.03 ? 'pull down' : carry;
    (this.$('padFill') as HTMLElement).style.height = `${cancel ? 0 : p * 100}%`;
    this.$('padLabel').textContent = cancel ? 'Release to cancel' : 'Release to hit!';
  }

  hidePower() {
    this.$('power').classList.add('hidden');
    this.$('padFill').style.height = '0%';
    this.$('padLabel').textContent = 'Pull down to swing';
  }

  setTapPower(p: number, carry: string) {
    this.$('tapFill').style.width = `${p * 100}%`;
    this.$('tapPct').textContent = `${Math.round(p * 100)}% · ${carry}`;
  }

  showLanding(rig: CameraRig, x: number, y: number, z: number, text: string, ghost: boolean) {
    const el = this.$('landLabel');
    const p = rig.project(x, y, z, this.tmp);
    const r = rig.rect;
    const lx = p.x - r.x;
    const ly = p.y - r.y;
    if (lx < -40 || ly < -10 || lx > r.w + 40 || ly > r.h + 30) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    el.classList.toggle('ghost', ghost);
    if (el.textContent !== text) el.textContent = text;
    el.style.transform = `translate(${Math.round(Math.max(30, Math.min(r.w - 30, lx)))}px, ${Math.round(Math.max(26, ly))}px) translate(-50%, -150%)`;
  }

  hideLanding() {
    this.$('landLabel').classList.add('hidden');
  }

  say(text: string, ms = 1800) {
    if (this.tutorialActive) return;
    this.$('pipText').textContent = text;
    this.$('pipBtns').classList.add('hidden');
    this.$('pip').classList.remove('hidden');
    this.speaking = true;
    window.clearTimeout(this.speechTimer);
    this.speechTimer = window.setTimeout(() => this.hideSpeech(), ms);
  }

  tutorial(text: string, withButton: boolean) {
    window.clearTimeout(this.speechTimer);
    this.tutorialActive = true;
    this.$('pipText').textContent = text;
    this.$('pipBtns').classList.remove('hidden');
    this.$('pipNext').classList.toggle('hidden', !withButton);
    this.$('pip').classList.remove('hidden');
    this.speaking = true;
  }

  /** Bottom edge of the speech bubble relative to the course area (0 if hidden). */
  speechBottom(): number {
    const pip = this.$('pip');
    if (pip.classList.contains('hidden')) return 0;
    return pip.getBoundingClientRect().bottom - this.$('course').getBoundingClientRect().top;
  }

  hideSpeech() {
    this.tutorialActive = false;
    this.speaking = false;
    this.$('pip').classList.add('hidden');
  }

  toastMsg(title: string, sub = '', ms = 2000) {
    const t = this.$('toast');
    t.innerHTML = '';
    t.append(document.createTextNode(title));
    if (sub) {
      const s = document.createElement('small');
      s.textContent = sub;
      t.append(s);
    }
    t.classList.remove('hidden');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.add('hidden'), ms);
  }

  setSkipHint(v: boolean) {
    this.$('skipHint').classList.toggle('hidden', !v);
  }

  setContinue(info: string | null) {
    this.$('btnContinue').classList.toggle('hidden', !info);
    this.$('continueInfo').textContent = info ?? '';
    this.$('btnPlay').classList.toggle('primary', !info);
    this.$('btnPlay').firstChild!.textContent = info ? 'New Round' : 'Play 9 Holes';
  }

  setTitleBest(t: string) {
    this.$('titleBest').textContent = t;
  }

  showPractice(bests: Bests, onPick: (i: number) => void) {
    const grid = this.$('practiceGrid');
    grid.innerHTML = '';
    HOLES.forEach((h, i) => {
      const b = document.createElement('button');
      b.className = 'holeCard';
      const best = bests.bestHole[i];
      b.innerHTML = `<b>${h.number}</b><span></span><small>Par ${h.par}${best != null ? ` · best ${best}` : ''}</small>`;
      b.querySelector('span')!.textContent = h.name;
      b.addEventListener('click', () => onPick(i));
      grid.append(b);
    });
    this.show('scrPractice');
  }

  renderCard(targetId: string, scores: (number | null)[], current: number) {
    const pars = HOLES.map((h) => h.par);
    let tot = 0;
    let parTot = 0;
    const cells = scores.map((s, i) => {
      if (s != null) {
        tot += s;
        parTot += pars[i];
      }
      const cls = [i === current ? 'cur' : '', s != null && s < pars[i] ? 'under' : ''].join(' ');
      return `<td class="${cls}">${s ?? '·'}</td>`;
    });
    const diff = tot - parTot;
    this.$(targetId).innerHTML = `<table class="sc">
      <tr><th>Hole</th>${pars.map((_, i) => `<th>${i + 1}</th>`).join('')}<th>Tot</th></tr>
      <tr><th>Par</th>${pars.map((p) => `<td>${p}</td>`).join('')}<td class="tot">${pars.reduce((a, b) => a + b, 0)}</td></tr>
      <tr><th>You</th>${cells.join('')}<td class="tot">${tot || '·'}${tot ? `<br><small>${diff === 0 ? 'E' : diff > 0 ? '+' + diff : diff}</small>` : ''}</td></tr>
    </table>`;
  }

  showHoleDone(name: string, sub: string, scores: (number | null)[], current: number, nextLabel: string) {
    this.$('holeScoreName').textContent = name;
    this.$('holeScoreSub').textContent = sub;
    this.renderCard('holeCard', scores, current);
    this.$('btnNext').textContent = nextLabel;
    this.show('scrHole');
  }

  showResults(strokes: number, toPar: string, bestLine: string, scores: (number | null)[]) {
    this.$('resTotal').textContent = `${strokes} strokes · ${toPar}`;
    this.$('resBest').textContent = bestLine;
    this.renderCard('resTable', scores, -1);
    this.show('scrResults');
  }

  // ---- settings ----
  private bindSettings() {
    const sfx = this.$('setSfx') as HTMLInputElement;
    const music = this.$('setMusic') as HTMLInputElement;
    sfx.addEventListener('input', () => this.settingsHandler({ sfxVol: Number(sfx.value) }));
    music.addEventListener('input', () => this.settingsHandler({ musicVol: Number(music.value) }));
    (this.$('setMotion') as HTMLInputElement).addEventListener('change', (e) => this.settingsHandler({ reducedMotion: (e.target as HTMLInputElement).checked }));
    (this.$('setHaptics') as HTMLInputElement).addEventListener('change', (e) => this.settingsHandler({ haptics: (e.target as HTMLInputElement).checked }));
    this.$('setSwing').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => this.settingsHandler({ swingMode: b.dataset.v as Settings['swingMode'] })));
    this.$('setQuality').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => this.settingsHandler({ quality: b.dataset.v as Settings['quality'] })));
  }

  syncSettings(s: Settings, storageOk: boolean) {
    (this.$('setSfx') as HTMLInputElement).value = String(s.sfxVol);
    (this.$('setMusic') as HTMLInputElement).value = String(s.musicVol);
    (this.$('setMotion') as HTMLInputElement).checked = s.reducedMotion;
    (this.$('setHaptics') as HTMLInputElement).checked = s.haptics;
    this.$('setSwing').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === s.swingMode));
    this.$('setQuality').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === s.quality));
    this.$('storageNote').classList.toggle('hidden', storageOk);
  }
}
