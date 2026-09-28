/**
 * The park's crowd test: 1000 walkers on demand, gone on demand, never mistaken for
 * people.
 *
 * WHAT THE FOUNDER ASKED FOR (2026-09-28): "can you put 1000 people in the park please
 * I want to see how well it renders". Development builds get a chip in the park ("Test:
 * add 1000 people"); the red meter over the world reads the frame rate while he walks.
 *
 * WHAT IS PINNED HERE:
 *   - addCrowd puts exactly that many walkers in the real park, every one standing
 *     somewhere a person can stand, a quarter of them see-through like practice
 *     profiles, and they walk rather than stand still;
 *   - removeCrowd takes all of them and nobody else;
 *   - the Home keeps them through roster polls, draws them all (slots only while the
 *     test is on), and offers the chip only in a development build (SOURCE SHAPE: the
 *     screen and the canvas need a phone to run).
 *
 * Negative controls, run 2026-09-28, each restored byte-identical:
 *   - removeCrowd clearing every agent          -> "takes all of them and nobody else" fails
 *   - the roster sync without its isCrowd check -> "keeps them through roster polls" fails
 *   - the canvas limit back on the fixed SLOTS   -> "draws them all" fails
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gardenSpots } from '../src/features/world/garden';
import { WorldSim, isCrowd } from '../src/features/world/sim';
import { CUBBON_PARK, venueGarden } from '../src/features/world/venue';

const park = () => {
  const s = new WorldSim(20260922);
  s.setMap(gardenSpots(venueGarden(CUBBON_PARK)));
  s.upsert([
    { ref: 'you', kind: 'you', seed: 7, area: CUBBON_PARK.id },
    { ref: 'a'.repeat(32), kind: 'stranger', seed: 1, area: CUBBON_PARK.id },
  ]);
  return s;
};

describe('the crowd in the park', () => {
  it('puts exactly that many walkers where people can stand, and they walk', () => {
    const s = park();
    s.addCrowd(1000, CUBBON_PARK.id);
    const crowd = s.agents().filter((a) => isCrowd(a.ref));
    expect(crowd).toHaveLength(1000);
    expect(s.agents()).toHaveLength(1002);
    // Where a person can stand -- almost all at once, and the rest walk out of the
    // bush or bench they were put in, as anybody does (sim.ts moveToward). Measured:
    // 9 of 1000 start inside something; 1 after thirteen seconds.
    const stuck = () => crowd.filter((a) => !s.standable(a.x, a.z)).length;
    expect(stuck()).toBeLessThanOrEqual(20);
    expect(crowd.filter((a) => a.ghost)).toHaveLength(250);
    const before = new Map(crowd.map((a) => [a.ref, [a.x, a.z]]));
    for (let i = 0; i < 30 * 12; i++) s.step(1 / 30);
    const moved = crowd.filter((a) => {
      const [x, z] = before.get(a.ref)!;
      return Math.hypot(a.x - x!, a.z - z!) > 0.5;
    });
    expect(moved.length, 'the crowd stood still').toBeGreaterThan(500);
    expect(stuck(), 'walkers left standing inside things').toBeLessThanOrEqual(5);
  });

  it('takes all of them and nobody else', () => {
    const s = park();
    s.addCrowd(1000, CUBBON_PARK.id);
    s.removeCrowd();
    expect(s.agents().map((a) => a.ref)).toEqual(['you', 'a'.repeat(32)]);
    expect(s.get('crowd-0')).toBeUndefined();
  });
});

describe('the Home, with the test on', () => {
  const code = (rel: string) => readFileSync(join(import.meta.dirname, '..', 'src', rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  it('keeps them through roster polls', () => {
    expect(code('features/world/world-screen.tsx'))
      .toContain('if (!localRefs.has(a.ref) && !isCrowd(a.ref)) venueSim.remove(a.ref);');
  });

  it('draws them all, with slots only while the test is on', () => {
    expect(code('features/world/world-screen.tsx')).toContain('slots={crowd ? crowd + 64 : undefined}');
    const canvas = code('features/world/canvas.tsx');
    expect(canvas).toContain('limit: slots,');
    expect(canvas).toContain('}, [slots]);');
  });

  it('offers the chip only in a development build', () => {
    expect(code('features/world/world-screen.tsx')).toContain('onCrowd={FPS_METER ? toggleCrowd : undefined}');
    expect(code('features/world/hud.tsx')).toContain("'Test: add 1000 people'");
  });
});
