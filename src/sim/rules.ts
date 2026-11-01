import type { CourseWorld } from './world';

export function scoreName(strokes: number, par: number): string {
  if (strokes === 1) return 'Hole in one!';
  const d = strokes - par;
  switch (d) {
    case -3:
      return 'Albatross!';
    case -2:
      return 'Eagle!';
    case -1:
      return 'Birdie!';
    case 0:
      return 'Par';
    case 1:
      return 'Bogey';
    case 2:
      return 'Double bogey';
    case 3:
      return 'Triple bogey';
    default:
      return d < 0 ? `${-d} under` : `+${d}`;
  }
}

export function formatToPar(n: number): string {
  if (n === 0) return 'E';
  return n > 0 ? `+${n}` : `${n}`;
}

export interface RoundTotals {
  strokes: number;
  par: number;
  toPar: number;
  played: number;
}

export function roundTotals(scores: (number | null)[], pars: number[]): RoundTotals {
  let strokes = 0;
  let par = 0;
  let played = 0;
  scores.forEach((s, i) => {
    if (s != null) {
      strokes += s;
      par += pars[i];
      played++;
    }
  });
  return { strokes, par, toPar: strokes - par, played };
}

export interface DropResult {
  x: number;
  z: number;
  /** How the drop was chosen, for the toast message. */
  kind: 'zone' | 'line' | 'previous';
}

/**
 * Water relief (one penalty stroke): a designated drop zone if the hole has one,
 * otherwise back-on-the-line: keep the entry point between the hole and the drop,
 * moving back from the hazard until the ground is dry and playable.
 * Falls back to the previous spot (stroke and distance) if nothing is valid.
 */
export function waterDrop(world: CourseWorld, entryX: number, entryZ: number, prevX: number, prevZ: number): DropResult {
  if (world.dropZones.length) {
    let best = world.dropZones[0];
    let bd = Infinity;
    for (const z of world.dropZones) {
      const d = Math.hypot(z[0] - entryX, z[1] - entryZ);
      if (d < bd) {
        bd = d;
        best = z;
      }
    }
    return { x: best[0], z: best[1], kind: 'zone' };
  }
  let dx = entryX - world.cupX;
  let dz = entryZ - world.cupZ;
  const l = Math.hypot(dx, dz) || 1;
  dx /= l;
  dz /= l;
  for (let d = 2; d <= 80; d += 0.5) {
    const x = entryX + dx * d;
    const z = entryZ + dz * d;
    if (world.isDropValid(x, z)) return { x, z, kind: 'line' };
  }
  return { x: prevX, z: prevZ, kind: 'previous' };
}

/** Out of bounds: stroke and distance, replay from the previous spot. */
export function oobDrop(prevX: number, prevZ: number): DropResult {
  return { x: prevX, z: prevZ, kind: 'previous' };
}
