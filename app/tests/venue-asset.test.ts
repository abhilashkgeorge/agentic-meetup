/**
 * The venue ships as a small, attributable offline asset.
 *
 * Negative controls: remove a required mesh from the runtime manifest, raise the
 * recorded byte count, or replace CC0 in the notice; the corresponding assertion
 * fails before a broken or legally ambiguous bundle reaches a phone.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'assets', 'venues', 'cubbon-park');
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as {
  license: string;
  source: string;
  file: string;
  bytes: number;
  sourceMeshes: number;
  sourceTriangles: number;
  runtime: { meshes: string[]; maxDrawCalls: number; maxTriangles: number };
};

describe('the Cubbon Park art bundle', () => {
  it('is committed, offline and inside the mobile budget', () => {
    const glb = join(dir, manifest.file);
    expect(existsSync(glb)).toBe(true);
    expect(statSync(glb).size).toBe(manifest.bytes);
    expect(manifest.bytes).toBeLessThanOrEqual(1_000_000);
    expect(manifest.sourceTriangles).toBeLessThanOrEqual(20_000);
    expect(manifest.runtime.maxDrawCalls).toBeLessThanOrEqual(4);
    expect(manifest.runtime.meshes).toEqual(expect.arrayContaining([
      'ParkFurn_Bench_A', 'ParkFurn_Lamp_A', 'ParkFurn_TrashCan_C', 'ParkFurn_Table_I',
    ]));
  });

  it('keeps the source and exact licence beside what ships', () => {
    const notice = readFileSync(join(dir, 'LICENCE.txt'), 'utf8');
    expect(manifest.license).toBe('CC0-1.0');
    expect(manifest.source).toMatch(/^https:\/\//);
    expect(notice).toContain('Park Furnitures by loafbrr');
    expect(notice).toContain('CC0 1.0 Universal');
    expect(notice).toContain('creativecommons.org/publicdomain/zero/1.0');
  });

  it('records a real reusable source library, not an empty placeholder', () => {
    expect(manifest.sourceMeshes).toBeGreaterThan(40);
    expect(manifest.sourceTriangles).toBeGreaterThan(10_000);
  });
});
