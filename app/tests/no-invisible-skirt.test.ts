/**
 * Nothing in the park is bigger to walk into than it is to look at.
 *
 * THE BUG THIS EXISTS FOR. Two paddings stacked on each other, neither visible. A
 * bush's collider was 0.16 when the bush is drawn at 0.15, and `FOOT` -- "how wide a
 * person is" -- was 0.09, which at 8.1 m to the unit is a person a metre and a half
 * across. Between them a bush ended 1.6 m before the thing that stopped you. The
 * founder stood between a tree and a bush with a metre of daylight on the screen and
 * could not walk through it (2026-09-23).
 *
 * The rule is one line: what stops you must be inside what you can see, give or take a
 * hand's width. Anything more is a force field, and a force field is unarguable from
 * the outside -- you cannot tell it from a bug in the stick, which is exactly what it
 * got blamed on.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - `FOOT = 0.09` -> the bush and the trunk both fail, by about 50 cm.
 *   - `BUSH_R = 0.16` -> the bush fails.
 *   - either one -> the "daylight" test finds pairs you cannot walk between.
 */
import { describe, expect, it } from 'vitest';
import { FOOT } from '../src/features/world/sim';
import { gardenSpots } from '../src/features/world/garden';
import { makeCubbon } from '../src/features/world/cubbon';

const M = 8.1;
/**
 * How much thin air is allowed between a thing and its collider. 25 cm: close enough
 * that stopping there reads as "I am touching it", far enough that nobody's shoulder
 * enters the mesh.
 */
const AIR = 0.25 / M;

/** What the renderer actually draws, from garden-mesh.ts. */
const DRAWN = {
  // CylinderGeometry(0.055, 0.085, ...) -- the wider end is the one at your knees.
  trunk: 0.085,
  // SphereGeometry(0.15) scaled (s, 0.72 s, 0.92 s), spun about y, so the radius you
  // meet is somewhere between 0.138 and 0.15. The smaller one is the fair test.
  bush: 0.138,
};

const park = makeCubbon();

/**
 * The collider the code actually builds at a given spot, looked up by position.
 *
 * NOT A COPY OF THE NUMBER. An earlier draft wrote `0.12 * scale` into the test, which
 * passed happily with the bug put back -- a test that restates the constant proves the
 * constant equals itself. This asks `gardenSpots` what it produced.
 */
const SOLIDS = gardenSpots(park).solids!;
const at = new Map<string, number>();
for (const s of SOLIDS) {
  const k = `${s.x.toFixed(4)},${s.z.toFixed(4)}`;
  at.set(k, Math.max(at.get(k) ?? 0, s.r));
}
const colliderAt = (x: number, z: number): number => {
  const r = at.get(`${x.toFixed(4)},${z.toFixed(4)}`);
  if (r === undefined) throw new Error(`nothing collides at ${x},${z}`);
  return r;
};

describe('what you see is what you walk into', () => {
  it('lets you touch the bark of the biggest and the smallest tree', () => {
    for (const t of [...park.trees].sort((a, b) => a.scale - b.scale).filter((_, i, a) => i === 0 || i === a.length - 1)) {
      const stop = colliderAt(t.x, t.z) + FOOT;
      const air = (stop - DRAWN.trunk * t.scale) * M;
      expect(air, `a tree at scale ${t.scale.toFixed(2)} stops you ${air.toFixed(2)} m off the bark`)
        .toBeLessThan(AIR * M);
    }
  });

  it('lets you touch the leaves of the biggest and the smallest bush', () => {
    for (const b of [...park.bushes].sort((x, y) => x.scale - y.scale).filter((_, i, a) => i === 0 || i === a.length - 1)) {
      const stop = colliderAt(b.x, b.z) + FOOT;
      const air = (stop - DRAWN.bush * b.scale) * M;
      expect(air, `a bush at scale ${b.scale.toFixed(2)} stops you ${air.toFixed(2)} m off the leaves`)
        .toBeLessThan(AIR * M);
    }
  });

  it('never shows daylight between a tree and a bush that you cannot walk through', () => {
    // The founder's exact scene, counted over the whole park rather than argued about.
    const cells = new Map<string, { x: number; z: number; scale: number }[]>();
    const key = (x: number, z: number) => `${Math.floor(x / 2)},${Math.floor(z / 2)}`;
    for (const b of park.bushes) {
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const k = `${Math.floor(b.x / 2) + dx},${Math.floor(b.z / 2) + dz}`;
        const at = cells.get(k) ?? [];
        at.push(b); cells.set(k, at);
      }
    }
    const shut: string[] = [];
    let looked = 0;
    for (const t of park.trees) {
      for (const b of cells.get(key(t.x, t.z)) ?? []) {
        const d = Math.hypot(t.x - b.x, t.z - b.z);
        if (d > 1.2) continue;
        // Half a metre of daylight is a gap a person reads as a way through.
        const seen = d - DRAWN.trunk * t.scale - DRAWN.bush * b.scale;
        if (seen * M < 0.5) continue;
        looked++;
        const walk = d - (colliderAt(t.x, t.z) + FOOT) - (colliderAt(b.x, b.z) + FOOT);
        if (walk <= 0) shut.push(`${(seen * M).toFixed(2)} m of daylight, ${(walk * M).toFixed(2)} m to walk`);
      }
    }
    expect(looked, 'no tree stands near a bush, so this proves nothing').toBeGreaterThan(100);
    expect(shut, `${shut.length} of ${looked} gaps are shut: ${shut.slice(0, 3).join('; ')}`).toHaveLength(0);
  });

  it('keeps a person the size of a person', () => {
    // 1.70 m tall, about 50 cm across. A radius over 40 cm is a person in a barrel.
    expect(FOOT * M).toBeLessThan(0.4);
    expect(FOOT * M).toBeGreaterThan(0.15);
  });

  it('still stops you at a building wall', () => {
    // The point is not to make everything walkable: a wall is a wall.
    const wall = SOLIDS.find((s) => s.r === 0.12 && s.h > 0.5);
    expect(wall, 'no building wall in the park').toBeTruthy();
    expect((wall!.r + FOOT) * M).toBeGreaterThan(1);
  });
});
