/**
 * The nine thinking orbs drawn offline at any size and density, to judge how they read
 * big on a phone (components/ui/orb-frame.ts draws the same frames with GL).
 *
 *     npx tsx scripts/render-orbs.mts <out.png> [size=280] [density=1] [t=1.7]
 *
 * One row of the nine states on the light page, one on the dark. `density` multiplies the
 * library's dot counts (its scaleCounts), as orb-frame.ts does for big orbs.
 */
import { writeFileSync } from 'node:fs';
import { MODE_FRAMES, resolvePreset, type OrbState } from '../src/vendor/thinking-orbs';
import { scaleCounts } from '../src/vendor/thinking-orbs/profiles';
import { ink } from '../src/components/ui/orb-frame';
import { png } from './raster.mts';

const out = process.argv[2] ?? 'orbs.png';
const SIZE = Number(process.argv[3] ?? 280);
const DENSITY = Number(process.argv[4] ?? 1);
const T = Number(process.argv[5] ?? 1.7);
const STATES: OrbState[] = ['working', 'searching', 'solving', 'listening', 'connecting', 'weaving', 'composing', 'breathing', 'shaping'];
const PAGES: { bg: [number, number, number]; dark: boolean }[] = [
  { bg: [0.92, 0.93, 0.95], dark: false },
  { bg: [0.08, 0.09, 0.11], dark: true },
];
const PX = 2; // device pixels per dp, about a phone's

const W = SIZE * PX, sheetW = W * STATES.length, sheetH = W * PAGES.length;
const px = new Float32Array(sheetW * sheetH * 4);
function blend(x: number, y: number, g: number, a: number): void {
  if (x < 0 || y < 0 || x >= sheetW || y >= sheetH || a <= 0) return;
  const i = (y * sheetW + x) * 4;
  for (let k = 0; k < 3; k++) px[i + k] = px[i + k]! * (1 - a) + g * a;
  px[i + 3] = 1;
}
PAGES.forEach((page, row) => {
  for (let y = row * W; y < (row + 1) * W; y++) for (let x = 0; x < sheetW; x++) px.set([...page.bg, 1], (y * sheetW + x) * 4);
  STATES.forEach((state, col) => {
    const { mode, speed, opts } = resolvePreset(state, 64);
    const f = MODE_FRAMES[mode](SIZE, T * speed, DENSITY === 1 ? opts : scaleCounts(opts, DENSITY));
    const ox = col * W, oy = row * W;
    for (const l of f.lines) {
      const g = ink(l.white, page.dark), a = l.a ?? 1;
      const n = Math.ceil(Math.hypot(l.x2 - l.x1, l.y2 - l.y1) * PX * 2);
      for (let s = 0; s <= n; s++) {
        const x = (l.x1 + ((l.x2 - l.x1) * s) / n) * PX, y = (l.y1 + ((l.y2 - l.y1) * s) / n) * PX;
        blend(Math.round(ox + x), Math.round(oy + y), g, a * Math.min(1, l.w * PX) * 0.5);
      }
    }
    for (const d of f.dots) {
      const g = ink(d.white, page.dark), a = d.a ?? 1;
      const cx = ox + d.x * PX, cy = oy + d.y * PX, r = Math.max(0.5, d.r * PX);
      for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
        for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
          const cover = Math.min(1, Math.max(0, r + 0.5 - Math.hypot(x + 0.5 - cx, y + 0.5 - cy)));
          blend(x, y, g, a * cover * (d.r * PX < 0.5 ? (d.r * PX / 0.5) ** 2 : 1));
        }
      }
    }
  });
});
writeFileSync(out, png(sheetW, sheetH, px));
console.log(`wrote ${out}: ${STATES.length} states at ${SIZE} dp, density ${DENSITY}`);
