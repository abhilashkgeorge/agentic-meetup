/**
 * The park's crowd test: 1000 walkers on demand, gone on demand, never mistaken for
 * people.
 *
 * WHAT THE FOUNDER ASKED FOR (2026-09-28): "can you put 1000 people in the park please
 * I want to see how well it renders". Development builds get a chip in the park ("Test:
 * add 1000 people"); the red meter over the world reads the frame rate while he walks.
 * And the next day, of the city: "can you try adding 1000 agents over there too" --
 * the same chip on the city's card, the walkers spread over all thirty neighbourhoods.
 *
 * WHAT IS PINNED HERE:
 *   - addCrowd puts exactly that many walkers in the real park, every one standing
 *     somewhere a person can stand, a quarter of them see-through like practice
 *     profiles, and they walk rather than stand still;
 *   - removeCrowd takes all of them and nobody else;
 *   - the city's test spreads them evenly over every neighbourhood;
 *   - the Home keeps them through roster polls, draws them all (slots only while the
 *     test is on, and a far level big enough for all of them at once), and offers the
 *     chips only in a development build (SOURCE SHAPE: the screen and the canvas need a
 *     phone to run).
 *
 * Negative controls, run 2026-09-28, each restored byte-identical:
 *   - removeCrowd clearing every agent          -> "takes all of them and nobody else" fails
 *   - the roster sync without its isCrowd check -> "keeps them through roster polls" fails
 *   - the canvas limit back on the fixed SLOTS   -> "draws them all" fails
 *   - addCrowd putting everybody in the first area (2026-09-29) -> "spreads them" fails
 *   - the far level back at 512 (2026-09-29)     -> "draws them all" fails
 *   - the tiny level at 512 (2026-09-29)         -> "draws them all" fails
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gardenSpots } from '../src/features/world/garden';
import { CROWD_TEST, WorldSim, isCrowd } from '../src/features/world/sim';
import { MAP, spotsFrom } from '../src/features/world/map';
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

  it('spreads the city\'s test over every neighbourhood, evenly', () => {
    const s = new WorldSim(20260918);
    s.setMap(spotsFrom(MAP));
    s.upsert([{ ref: 'you', kind: 'you', seed: 7, area: null }]);
    const areas = MAP.areas.map((a) => a.id);
    s.addCrowd(CROWD_TEST, areas);
    const per = new Map<string | null, number>();
    for (const a of s.agents()) if (isCrowd(a.ref)) per.set(a.area, (per.get(a.area) ?? 0) + 1);
    expect([...per.keys()].sort()).toEqual([...areas].sort());
    const counts = [...per.values()];
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    s.removeCrowd();
    expect(s.agents().map((a) => a.ref)).toEqual(['you']);
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

  it('keeps them through roster polls, and the people here in person too', () => {
    expect(code('features/world/world-screen.tsx'))
      .toContain("if (!localRefs.has(a.ref) && !isCrowd(a.ref) && a.kind !== 'live') venueSim.remove(a.ref);");
  });

  it('draws them all, with slots only while the test is on', async () => {
    expect(code('features/world/world-screen.tsx'))
      .toContain('slots={crowd + cityCrowd ? crowd + cityCrowd + 64 : undefined}');
    // Zoomed out over the city every one of them is on screen at once, all at one of
    // the last two levels: each must hold them all, or the rest blink out as the order
    // shifts.
    const { LEVELS } = await import('../src/features/world/crowd-gpu');
    for (const l of LEVELS.slice(2)) expect(l.max, l.name).toBeGreaterThanOrEqual(CROWD_TEST + 64);
    const canvas = code('features/world/canvas.tsx');
    expect(canvas).toContain('limit: slots,');
    expect(canvas).toContain('}, [slots, fallback]);');
  });

  it('offers the chips only in a development build', () => {
    const screen = code('features/world/world-screen.tsx');
    expect(screen).toContain('onCrowd={FPS_METER ? toggleCrowd : undefined}');
    expect(screen).toContain('onCityCrowd={FPS_METER ? toggleCityCrowd : undefined}');
    expect(screen).toContain('sim.addCrowd(CROWD_TEST, MAP.areas.map((a) => a.id));');
    const hud = code('features/world/hud.tsx');
    expect(hud.match(/'Test: add 1000 people'/g)).toHaveLength(2);
    expect(hud).toContain('{onCityCrowd && (');
  });
});
