import './style.css';

// Tiny entry: shows real boot progress while the engine chunk downloads and the world is built.
const fill = document.getElementById('bootFill') as HTMLElement | null;
const text = document.getElementById('bootText') as HTMLElement | null;
const progress = (p: number, msg: string) => {
  if (fill) fill.style.width = `${Math.round(p * 100)}%`;
  if (text) text.textContent = msg;
};
// Yield so the progress bar can paint; never wait on rAF (it pauses in background tabs).
const nextFrame = () =>
  new Promise<void>((r) => {
    let done = false;
    const go = () => {
      if (!done) {
        done = true;
        r();
      }
    };
    requestAnimationFrame(() => setTimeout(go, 0));
    setTimeout(go, 60);
  });

async function boot() {
  progress(0.15, 'Loading the clubhouse…');
  const [{ Game }, { calibrate }] = await Promise.all([import('./game/game'), import('./sim/shot')]);
  progress(0.55, 'Tuning the clubs…');
  await nextFrame();
  calibrate();
  progress(0.65, 'Mowing the fairways…');
  await nextFrame();
  const app = document.getElementById('app')!;
  let game: InstanceType<typeof Game>;
  try {
    game = new Game(app);
  } catch (e) {
    progress(1, 'Sorry — this browser could not start WebGL.');
    console.error(e);
    return;
  }
  game.bootWorld(0);
  progress(0.8, 'Planting trees and waking the sheep…');
  await nextFrame();
  game.bootRender();
  progress(0.95, 'Polishing the ball…');
  await nextFrame();
  game.start();
  progress(1, 'Ready!');
  document.getElementById('boot')?.remove();
  if (import.meta.env.DEV) {
    // Dev-only test hooks: ?hole=3 opens a practice hole, &swing=0.8 takes one shot.
    (window as unknown as { __game: unknown }).__game = game;
    const q = new URLSearchParams(location.search);
    if (q.has('hole')) game.devPractice(Number(q.get('hole')) - 1, q.has('swing') ? Number(q.get('swing')) : null);
  }
}

void boot();
