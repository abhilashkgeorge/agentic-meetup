/**
 * The thinking orbs: every loading animation in the app (the founder, 2026-10-03: "for
 * the map loading animation and all the other animation for loading
 * https://github.com/Jakubantalik/thinking-orbs use this please").
 *
 * WHAT IS GUARDED:
 *   - THE GEOMETRY IS THE LIBRARY'S. The copy in vendor/thinking-orbs reproduces the
 *     library's own reference frames (its spec/orbs-golden.json, cut to two instants: 36
 *     cases, every dot and line of each) -- the check its React Native port runs;
 *   - a frame becomes GPU data by the rules of the library's painter: ink mirrored on a
 *     dark page and 8-bit, alpha as given, lines first, positions in device pixels;
 *   - THE TOWN'S GLOBE, on the native driver, draws the library's "searching" globe: at
 *     instants where the two agree on the tilt, every dot of the library's frame has a dot
 *     of the tables in the same place, the same size and the same ink;
 *   - the globe turns on the native driver (it must, to keep moving while the city is
 *     built on the JavaScript thread), the GL orb is only ever loaded on demand, and the
 *     loading screens use them, the park's entry and exit included (SOURCE SHAPE: React
 *     Native and GL do not run here).
 *
 * Negative controls, run by hand and recorded in the commit: a constant of the copied
 * engine changed (the globe's spin 0.5 -> 0.51) -> "reproduces the library's frames"
 * fails; the globe tables' tilt 0.4 -> 0.45 -> "draws the library's globe" fails; ink not
 * mirrored on dark -> "the painter's rules" fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODE_FRAMES, resolvePreset, type OrbFrame, type OrbState } from '../src/vendor/thinking-orbs';
import { DOT_FLOATS, LINE_FLOATS, LINE_VERTS, ink, orbFrame, packDots, packLines, presetFor } from '../src/components/ui/orb-frame';
import { GLOBE_TILT, globeDensity, globePhases, globePoint, globeTables, sampleAt } from '../src/components/ui/globe-tables';
import { densityFor } from '../src/components/ui/orb-frame';
import { readFileSync as read } from 'node:fs';

const SRC = join(import.meta.dirname, '..', 'src');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const src = (...p: string[]) => strip(readFileSync(join(SRC, ...p), 'utf8'));

interface Golden {
  tolerance: number;
  cases: { key: string; state: OrbState; size: 64 | 20; mode: string; t: number; dotCount: number; lineCount: number; dots: number[]; lines: number[] }[];
}
const golden = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'orbs-golden.json'), 'utf8')) as Golden;

describe('the geometry is the library\'s', () => {
  it('reproduces the library\'s reference frames, every dot and line, for all nine states at both sizes', () => {
    expect(golden.cases.length).toBe(36);
    const tol = golden.tolerance;
    let checked = 0;
    for (const c of golden.cases) {
      const { mode, opts } = resolvePreset(c.state, c.size);
      expect(mode, c.key).toBe(c.mode);
      const f = MODE_FRAMES[mode](c.size, c.t, opts);
      expect([f.dots.length, f.lines.length], c.key).toEqual([c.dotCount, c.lineCount]);
      f.dots.forEach((d, i) => {
        const g = c.dots.slice(i * 6, i * 6 + 6);
        [d.x, d.y, d.z, d.r, d.white, d.a ?? 1].forEach((v, k) => {
          if (Math.abs(v - g[k]!) > tol) expect.fail(`${c.key} dot ${i} field ${k}: ${v} vs ${g[k]}`);
          checked++;
        });
      });
      f.lines.forEach((l, i) => {
        const g = c.lines.slice(i * 7, i * 7 + 7);
        [l.x1, l.y1, l.x2, l.y2, l.white, l.a ?? 1, l.w].forEach((v, k) => {
          if (Math.abs(v - g[k]!) > tol) expect.fail(`${c.key} line ${i} field ${k}: ${v} vs ${g[k]}`);
          checked++;
        });
      });
    }
    expect(checked).toBeGreaterThan(20_000);
  });
});

describe('a frame for the GPU, by the painter\'s rules', () => {
  const frame: OrbFrame = {
    dots: [{ x: 10, y: 20, z: 0, r: 1.5, white: 0.08, a: 0.5 }, { x: 30, y: 40, z: 1, r: 2, white: 0.62 }],
    lines: [{ x1: 0, y1: 0, x2: 10, y2: 0, white: 0.3, a: 0.7, w: 1 }],
  };

  it('ink: the near dots dark on a light page and bright on a dark one, in 8-bit steps; alpha as given', () => {
    expect(ink(0.08, false)).toBe(Math.round(0.08 * 255) / 255);
    expect(ink(0.08, true)).toBe(Math.round(0.92 * 255) / 255);
    expect(ink(-1, false)).toBe(0);
    expect(ink(2, true)).toBe(0);
    const { data, count } = packDots(frame, true, 3, new Float32Array(0));
    expect(count).toBe(2);
    expect(Array.from(data.slice(0, DOT_FLOATS))).toEqual([30, 60, 4.5, Math.fround(ink(0.08, true)), 0.5]);
    expect(data[DOT_FLOATS + 4]).toBe(1); // no alpha given: solid
  });

  it('a line is a quad along it, its edge a pixel past each side for the soft border', () => {
    const { data, count } = packLines(frame, false, 2, new Float32Array(0));
    expect(count).toBe(LINE_VERTS);
    const v = (i: number) => Array.from(data.slice(i * LINE_FLOATS, i * LINE_FLOATS + LINE_FLOATS));
    // Along x from (0,0) to (20,0) in pixels, 2 px wide: half 1, reaching 2 either side.
    expect(v(0)).toEqual([0, -2, -2, 1, Math.fround(ink(0.3, false)), Math.fround(0.7)]);
    expect(v(5)).toEqual([20, 2, 2, 1, Math.fround(ink(0.3, false)), Math.fround(0.7)]);
  });

  it('the 20 design below 40 dp, the 64 from there; a frame is the library\'s at the preset\'s pace', () => {
    expect([presetFor(20), presetFor(39), presetFor(40), presetFor(120)]).toEqual([20, 20, 64, 64]);
    const { mode, speed, opts } = resolvePreset('searching', 64);
    expect(orbFrame('searching', 120, 2, 1)).toEqual(MODE_FRAMES[mode](120, 2 * speed, opts));
  });
});

describe('the town\'s globe draws the library\'s "searching" globe', () => {
  const SIZE = 120;
  const g = globeTables(SIZE);
  const lib = resolvePreset('searching', 64);

  it('every dot of the library\'s frame has its twin in the tables: place, size and ink', () => {
    // The library rocks the tilt as 0.4 + 0.06 sin(0.35 t); these are instants it is 0.4.
    for (const t of [0, Math.PI / 0.35, (2 * Math.PI) / 0.35]) {
      const f = MODE_FRAMES[lib.mode](SIZE, t, lib.opts);
      const { turn, sweep } = globePhases(t);
      const ours = g.dots.map((d) => {
        const lift = sampleAt(d.scan, sweep) * sampleAt(d.front, turn);
        return {
          x: sampleAt(d.x, turn), y: sampleAt(d.y, turn),
          r: Math.max(g.rMin, sampleAt(d.r, turn) + g.rLift * lift),
          // What the painter puts down: alpha times ink strength (see globe-tables.ts).
          strength: (g.dimBase + (1 - g.dimBase) * lift) * sampleAt(d.ink, turn),
        };
      });
      expect(ours.length, `t ${t}`).toBe(f.dots.length);
      const used = new Set<number>();
      for (const d of f.dots) {
        const want = (d.a ?? 1) * (1 - d.white);
        let best = -1, err = Infinity;
        ours.forEach((o, i) => {
          if (used.has(i)) return;
          const e = Math.hypot(o.x - d.x, o.y - d.y) + Math.abs(o.r - d.r) + Math.abs(o.strength - want);
          if (e < err) { err = e; best = i; }
        });
        used.add(best);
        const o = ours[best]!;
        expect(Math.hypot(o.x - d.x, o.y - d.y), `place at t ${t}`).toBeLessThan(0.3);
        expect(Math.abs(o.r - d.r), `size at t ${t}`).toBeLessThan(0.05);
        expect(Math.abs(o.strength - want), `ink at t ${t}`).toBeLessThan(0.04);
      }
    }
  });

  it('each table goes once round and closes on itself, so the loop has no seam', () => {
    for (const d of g.dots) {
      for (const table of [d.x, d.y, d.r, d.front, d.ink, d.scan]) expect(table.at(-1)).toBeCloseTo(table[0]!, 9);
    }
    expect(globePoint(0, 0, 0, SIZE)[2]).toBeCloseTo(Math.cos(GLOBE_TILT) * 0, 9);
  });
});

describe('where the orbs are drawn (SOURCE SHAPE)', () => {
  it('the globe turns on the native driver, both of its loops', () => {
    const globe = src('components', 'ui', 'globe-orb.tsx');
    expect(globe.match(/useNativeDriver: true/g)?.length).toBe(2);
    expect(globe).toContain('Animated.loop(Animated.timing(turn,');
    expect(globe).toContain('Animated.loop(Animated.timing(sweep,');
  });

  it('the GL orb is loaded on demand, never imported at the top of a screen', () => {
    const orb = src('components', 'ui', 'orb.tsx');
    expect(orb).toContain("import('./orb-gl')");
    expect(orb).not.toMatch(/^import (?!type )[^;]*from '\.\/orb-gl';/m);
    expect(orb).toMatch(/^import type \{ OrbGLProps \} from '\.\/orb-gl';/m);
  });

  it('the town, at launch and while it builds, is the globe; every other wait is an orb', () => {
    expect(src('features', 'world', 'town-loading.tsx')).toContain('<GlobeOrb size={screenOrb(width, height)} label="Loading the town" />');
    expect(src('components', 'ui', 'loading.tsx')).toContain('<Orb state={orb} size={size} label={label} />');
    expect(src('features', 'distance', 'distance-map.tsx')).toContain('<Orb state="searching" size={Math.round(height * 0.62)} label="Loading the map" />');
  });

  it('going into the park and back, the veil turns the globe -- and only while it shows', () => {
    // "Cubbon Park / Entering the park…" was words alone over an empty page (seen on the
    // Pixel, 2026-10-03), while the park was built on the JavaScript thread.
    const world = src('features', 'world', 'world-screen.tsx');
    expect(world).toContain("{transitioning && <GlobeOrb size={screenOrb(winW, winH)} label={realm.phase === 'leaving' ? 'Returning to the city map' : 'Entering the park'} />}");
  });
});

// The founder (2026-10-04): "the loading animations looks not well thought out. it is very
// small. use an appropriate loading animation and cover the screen with it". Negative
// controls, run by hand and recorded in the commit: screenOrb back to 64 -> "most of the
// screen's width" fails; densityFor always 1 -> "more dots when big" fails.
describe('a waiting screen is the orb', () => {
  it('most of the screen\'s width, on a phone; never wider than ORB_MAX', async () => {
    const { screenOrb, ORB_MAX } = await import('../src/components/ui/loading-size');
    expect(screenOrb(412, 915)).toBeGreaterThanOrEqual(300);   // the Pixel 6a
    expect(screenOrb(412, 915) / 412).toBeGreaterThan(0.7);
    expect(screenOrb(900, 1800)).toBe(ORB_MAX);                // a tablet
    expect(screenOrb(412, 500)).toBeLessThanOrEqual(500 * 0.45); // a short window
  });

  it('more dots when big, as the library\'s counts allow: the 64 design was a few specks across a phone', () => {
    expect(densityFor(64)).toBe(1);
    expect(densityFor(120)).toBe(1);
    expect(densityFor(320)).toBe(3);
    expect(densityFor(600)).toBe(3);
    expect(globeDensity(320)).toBe(2);
    expect(globeTables(320).dots.length).toBeGreaterThan(globeTables(120).dots.length * 1.6);
  });

  it('says what is coming under the orb, and a section inside a card stays in its card', () => {
    const loading = read(join(SRC, 'components', 'ui', 'loading.tsx'), 'utf8');
    expect(loading).toMatch(/\{!section && \(\s*<Text[^>]*>\{`\$\{label\}…`\}<\/Text>/);
    expect(loading).toContain('const size = section ? SECTION_ORB : screenOrb(width, height);');
  });
});
