/**
 * What a park frame must not do again: the three things that took the Seeker from about
 * 84 fps to 44 with the thousand-person test crowd on (the founder, 2026-09-29: "the
 * frame rate has dropped to under 50 after the recent change").
 *
 * HOW IT WAS FOUND. The frame's own log ([perf], canvas.tsx) on the phone: a 22.6 ms
 * frame, of which moving the walkers was 11.3 ms and the city's traffic most of 4.5.
 * Timed in node against the morning's code (321e51a), 1000 walkers: 0.16 ms a step
 * then, 0.34 now, and 0.157 with the park's fence taken out -- the fence check was the
 * whole of it. Walkers near the fence asked whether they were inside by walking the
 * park's whole 69-corner ring, for every heading they tried, every frame.
 *
 * SOURCE SHAPE, because a test's timing on a laptop says nothing about a phone's, and
 * the cost is the kind of thing only a timer sees:
 *   - the fence check asks a dense grid, and near the fence only the cell's own edges
 *     -- never the whole ring;
 *   - the traffic's step sorts nothing and places only what is near, the rest every
 *     few steps;
 *   - the city's tick parses no colour and searches for no mesh per vehicle.
 *
 * Negative controls, run by hand and recorded in the commit: put back the whole-ring
 * test in outOfBounds; the per-step sort; the per-vehicle colour parse. Each fails its
 * line here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const code = (file: string) => readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'world', file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
/** The body of the method or function named, up to its closing brace at its own depth. */
function body(src: string, head: string): string {
  const at = src.indexOf(head);
  expect(at, `no ${head}`).toBeGreaterThanOrEqual(0);
  // The body's brace, not a brace in the parameters' types: the first "{" after the
  // signature's closing ") ... {".
  const sig = /\)(\s*:\s*[\w<>[\]| ]+)?\s*\{/g;
  sig.lastIndex = at;
  let i = sig.exec(src)!.index, depth = 0;
  i = src.indexOf('{', i);
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    if (src[j] === '}' && --depth === 0) return src.slice(i, j + 1);
  }
  return src.slice(i);
}

describe('a park frame', () => {
  it('asks the fence a grid cell, and near it only that cell\'s edges, never the whole ring', () => {
    const src = code('sim.ts');
    const check = body(src, 'private outOfBounds(');
    expect(check).not.toContain('pointInPolygon');
    expect(check).toContain('this.boundCells[k]');
    expect(check).not.toMatch(/\.get\(/);
  });

  it('steps the traffic without sorting it or placing what nobody sees', () => {
    const step = body(code('traffic.ts'), 'step(dt: number, near?:');
    expect(step).not.toContain('.sort(');
    expect(step).not.toMatch(/\.map\(/);
    expect(step).toContain('PLACE_EVERY');
  });

  it('draws the traffic without parsing a colour or finding a mesh per vehicle', () => {
    const tick = body(code('city-mesh.ts'), 'tick(dt, x, z)');
    expect(tick).not.toMatch(/\.set\(\s*(colours|LIVERIES)/);
    expect(tick).not.toContain('.find(');
    expect(tick).toContain('meshOf[k]');
  });
});
