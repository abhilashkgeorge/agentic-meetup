/**
 * THE THINKING ORB, as numbers for the GPU: what the app shows while something loads (the
 * founder, 2026-10-03: "for the map loading animation and all the other animation for
 * loading https://github.com/Jakubantalik/thinking-orbs use this please").
 *
 * The geometry is the library's own (vendor/thinking-orbs: nine states, each a dotted 3D
 * figure, z-sorted and finished per instant). This file only turns one instant into
 * vertex data, by the rules of the library's 2D-canvas painter: lines first, then dots in
 * the order given; ink is `white` -- mirrored on a dark page so near dots read bright --
 * quantised to 8 bits, at the dot's alpha. orb-gl.tsx draws it. Pure, so it is tested
 * without a GPU (tests/orb.test.ts).
 */
import { MODE_FRAMES, resolvePreset, type OrbFrame, type OrbState } from '../../vendor/thinking-orbs';

export type { OrbState } from '../../vendor/thinking-orbs';

/**
 * The tuned design a size draws with. The library ships two -- for 64 px and for 20 px,
 * separate designs rather than one scaled -- and its geometry scales either to any size:
 * an orb from 40 dp up is the 64 design, a smaller one the 20.
 */
export const presetFor = (size: number): 64 | 20 => (size < 40 ? 20 : 64);

/** One instant of `state` drawn `size` dp across, `seconds` into the shared clock. */
export function orbFrame(state: OrbState, size: number, seconds: number, speed = 1): OrbFrame {
  const { mode, speed: tuned, opts } = resolvePreset(state, presetFor(size));
  return MODE_FRAMES[mode](size, seconds * tuned * speed, opts);
}

/** The ink of a mark, 0 black to 1 white: the painter's rule, mirrored on dark, 8-bit. */
export function ink(white: number, dark: boolean): number {
  const w = Math.min(1, Math.max(0, white));
  return Math.round((dark ? 1 - w : w) * 255) / 255;
}

/** Floats per dot: x, y (px from the top left), radius (px), ink, alpha. */
export const DOT_FLOATS = 5;
/** Floats per line vertex: x, y (px), across (px from the line's middle), half width (px), ink, alpha. */
export const LINE_FLOATS = 6;
/** Vertices per line: a quad as two triangles. */
export const LINE_VERTS = 6;

/**
 * The dots of `frame`, in draw order, into `out` (grown if short): positions and radii in
 * device pixels (`px` per dp). Returns the buffer and how many dots are in it.
 */
export function packDots(frame: OrbFrame, dark: boolean, px: number, out: Float32Array): { data: Float32Array; count: number } {
  const n = frame.dots.length;
  const data = out.length >= n * DOT_FLOATS ? out : new Float32Array(Math.ceil(n * 1.5) * DOT_FLOATS);
  for (let i = 0; i < n; i++) {
    const d = frame.dots[i]!;
    const at = i * DOT_FLOATS;
    data[at] = d.x * px;
    data[at + 1] = d.y * px;
    data[at + 2] = d.r * px;
    data[at + 3] = ink(d.white, dark);
    data[at + 4] = d.a ?? 1;
  }
  return { data, count: n };
}

/**
 * The lines of `frame` as quads, into `out` (grown if short): each a band `w` dp wide
 * along the segment, one pixel wider on each side for the soft edge the shader draws.
 * Returns the buffer and how many vertices are in it.
 */
export function packLines(frame: OrbFrame, dark: boolean, px: number, out: Float32Array): { data: Float32Array; count: number } {
  const n = frame.lines.length;
  const need = n * LINE_VERTS * LINE_FLOATS;
  const data = out.length >= need ? out : new Float32Array(Math.ceil(n * 1.5) * LINE_VERTS * LINE_FLOATS);
  let v = 0;
  for (let i = 0; i < n; i++) {
    const l = frame.lines[i]!;
    const x1 = l.x1 * px, y1 = l.y1 * px, x2 = l.x2 * px, y2 = l.y2 * px;
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    // Across the line, unit length.
    const nx = -(y2 - y1) / len, ny = (x2 - x1) / len;
    const half = (l.w * px) / 2;
    const reach = half + 1;
    const g = ink(l.white, dark), a = l.a ?? 1;
    const corner = (x: number, y: number, side: number) => {
      const at = v * LINE_FLOATS;
      data[at] = x + nx * reach * side;
      data[at + 1] = y + ny * reach * side;
      data[at + 2] = reach * side;
      data[at + 3] = half;
      data[at + 4] = g;
      data[at + 5] = a;
      v++;
    };
    corner(x1, y1, -1); corner(x2, y2, -1); corner(x1, y1, 1);
    corner(x1, y1, 1); corner(x2, y2, -1); corner(x2, y2, 1);
  }
  return { data, count: v };
}

/** What a screen reader hears for each state, while the orb turns. */
export const ORB_SAYS: Readonly<Record<OrbState, string>> = {
  working: 'Working', searching: 'Searching', solving: 'Solving', listening: 'Listening',
  connecting: 'Connecting', weaving: 'Weaving', composing: 'Composing', breathing: 'Loading', shaping: 'Shaping',
};

/** The instant shown, still, when the phone asks for less motion: the library's own. */
export const STILL_AT = 0.6;

/** Seconds on one clock for every orb on screen, so two shown together turn in step. */
export function orbClock(): number {
  const perf = (globalThis as { performance?: { now?: () => number } }).performance;
  return (typeof perf?.now === 'function' ? perf.now() : Date.now()) / 1000;
}
