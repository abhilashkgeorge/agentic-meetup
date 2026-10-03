/**
 * The app opening quickly, and the town's first move drawn smoothly.
 *
 * WHAT WAS WRONG (the founder, 2026-10-04): "why does it take 10 secs+ to load the
 * initial tabs and the map? what is happening here?" -- and "the map, when it loads
 * initially and moves to show my agent, happens at 1 fps". Read off the Pixel's log and
 * a screen recording of a cold start: the app's code ran 1.3 s after the tap, and the 3D
 * town began 10.8 s after that, the map on screen at about sixteen seconds. In between:
 *   - the town screen laid out ALL of Cubbon Park -- 62,000 tufts of grass, 700 trees,
 *     every path -- in its first render, and the canvas built the park's meshes, the
 *     city round it and its benches and lamps: about nine seconds of the Pixel's time,
 *     for a park you may never enter, with every tab waiting behind it;
 *   - once the map was drawn, the crowd's bodies were prepared in ten steps of about
 *     half a second -- each bag's straps found by testing every triangle of a top --
 *     and the camera's first move to you was drawn between them: a frame or two a second.
 *
 * WHAT IS GUARDED:
 *   - the park is built only when wanted -- under the "Entering the park" veil -- and
 *     the canvas builds nothing of it before;
 *   - the park, laid out faster, is the SAME park, to the last tuft (its fingerprint);
 *   - a bag's straps are found with three's own hit, by the quicker caster;
 *   - the town is shown once its people are in (or six seconds after its first frame),
 *     their preparation runs in batches between frames, and starts as soon as the
 *     renderer is loaded.
 *
 * Measured on the Pixel (release build, cold start, 2026-10-04): code start to town
 * shown 14 s -> 6.4 s; the crowd 6.6 s -> 3.3 s, its longest step 504 -> 142 ms.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - the park built in the town screen's first render again -> "built only when
 *     wanted" fails;
 *   - the inside-the-outline cells marked wrong (a crossed cell taken as inside) -> "the
 *     same park" fails;
 *   - the caster keeping the last hit, not the nearest -> "three's own hit" fails;
 *   - the town shown on its first frame again -> "shown once its people are in" fails.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeCubbon } from '../src/features/world/cubbon';
import { axisCaster, clothOf } from '../src/features/world/character-mesh';

const src = (...p: string[]) => readFileSync(join(import.meta.dirname, '..', 'src', ...p), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('the park is built when it is wanted', () => {
  it('not by the town screen as it opens, and not by the canvas before it has a layout (SOURCE SHAPE: React Native)', () => {
    const w = src('features', 'world', 'world-screen.tsx');
    expect(w).toContain('const [parkWanted, setParkWanted] = useState(false);');
    expect(w).toContain('const venueLayout = useMemo(() => (parkWanted ? venueGarden(CUBBON_PARK) : null), [parkWanted]);');
    expect(w, 'the park laid out as the town opens').not.toMatch(/useMemo\(\(\) => venueGarden\(CUBBON_PARK\), \[\]\)/);
    // Asked for under the veil, the first time in.
    expect(w).toMatch(/if \(realm\.phase === 'entering'\) \{\s*const t = setTimeout\(\(\) => \{\s*if \(!parkWanted\) \{ setParkWanted\(true\); return; \}/);
    const c = src('features', 'world', 'canvas.tsx');
    expect(c).toMatch(/const garden = useMemo\(\s*\(\) => \(layout\s*\? buildGarden\(/);
    expect(c).toMatch(/\(\) => \(layout && venue\.id === CUBBON_PARK\.id\s*\? buildCity\(/);
    expect(c).toMatch(/useEffect\(\(\) => \{\s*if \(!layout\) return;\s*let alive = true;\s*let made: BuiltVenueFurniture \| null = null;\s*loadVenueFurniture\(layout\)/);
    expect(c, 'the canvas laying the park out itself').not.toContain('venueGarden(venue)');
  });
});

describe('the park, laid out faster, is the same park', () => {
  it('to the last tuft of grass: its fingerprint, from before the speed-ups', () => {
    const park = makeCubbon();
    const print = createHash('sha256').update(JSON.stringify(park)).digest('hex');
    expect(park.tufts.length).toBe(62_000);
    expect(print.slice(0, 16)).toBe('2bfa5de86f740074');
  });
});

describe('a bag on its top', () => {
  it('finds each strap point where three\'s Raycaster does, to the bit', () => {
    // Tops of different shapes: a box-like coat and a rounded jumper, as clothOf welds them.
    const shapes = [
      new THREE.BoxGeometry(0.4, 0.5, 0.25, 6, 8, 4).translate(0, -0.12, 0),
      new THREE.SphereGeometry(0.22, 18, 14).scale(1, 1.4, 0.7).translate(0, -0.1, 0),
      new THREE.CylinderGeometry(0.18, 0.2, 0.45, 16, 6).translate(0.01, -0.15, -0.01),
    ];
    for (const shape of shapes) {
      const body = clothOf([{ geometry: shape, matrix: new THREE.Matrix4() }]);
      const cast = axisCaster(body);
      const cloth = new THREE.Mesh(body, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
      const ray = new THREE.Raycaster();
      let hits = 0;
      for (const [from, along] of rays()) {
        ray.set(from, along);
        const want = ray.intersectObject(cloth)[0]?.point ?? null;
        const got = cast(from, along);
        if (want) hits++;
        expect(got === null, `${from.toArray()} along ${along.toArray()}`).toBe(want === null);
        if (want && got) expect(got.toArray()).toEqual(want.toArray());
      }
      expect(hits, 'the rays missed the top altogether: nothing was compared').toBeGreaterThan(20);
    }
  });
});

/** The rays a bag casts: at the front and back across the chest, and down over the shoulders. */
function* rays(): Generator<[THREE.Vector3, THREE.Vector3]> {
  for (const x of [-0.19, -0.085, -0.03, 0, 0.04, 0.085, 0.15]) {
    for (const y of [-0.33, -0.25, -0.06, -0.04, 0, 0.04, 0.08]) {
      yield [new THREE.Vector3(x, y, 1), new THREE.Vector3(0, 0, -1)];
      yield [new THREE.Vector3(x, y, -1), new THREE.Vector3(0, 0, 1)];
    }
    for (const z of [-0.07, -0.02, 0, 0.03, 0.08]) yield [new THREE.Vector3(x, 1, z), new THREE.Vector3(0, -1, 0)];
  }
}

describe('the town is shown with its people in it', () => {
  it('once they are in, or six seconds after the first frame; prepared in batches, begun as the renderer loads (SOURCE SHAPE: GL)', () => {
    const c = src('features', 'world', 'canvas.tsx');
    expect(c).toContain('if (!drawn.current && (people.current || fallback || now - firstAt.current > SHOW_ANYWAY_MS)) {');
    expect(c).toMatch(/const SHOW_ANYWAY_MS = 6000;/);
    expect(c, 'the town shown on its first frame').not.toContain('if (!drawn.current) { drawn.current = true; onFirstFrame?.(); }');
    const g = src('features', 'world', 'crowd-gpu.ts');
    expect(g).toMatch(/if \(Date\.now\(\) - batch < STEP_BUDGET_MS\) continue;\s*await new Promise\(\(res\) => setTimeout\(res, 0\)\);/);
    expect(g).toMatch(/export const STEP_BUDGET_MS = 40;/);
    const r = src('features', 'world', 'r3f.ts');
    expect(r).toMatch(/cached = \{ WorldCanvas: mod\.WorldCanvas, CharacterCanvas: mod\.CharacterCanvas \};\s*mod\.warmGpuCrowd\(\);/);
  });
});
