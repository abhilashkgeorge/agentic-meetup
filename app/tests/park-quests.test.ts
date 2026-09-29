/**
 * Things to do together in the park, on the phone: the sights are where the park draws
 * them, each can be stood at, the phone says how far along you are, cheers what paid,
 * and rings the one you are with.
 *
 * WHAT THE FOUNDER ASKED (2026-09-29): "add more tasks couples can do in the park.
 * gameify it." The server decides what is done (server park/quests.ts, tested there);
 * the sights' places are shared, so they are held here to the park the app draws.
 *
 * WHAT IS PINNED:
 *   - every sight is at a landmark the park draws, by name, inside the park, and two
 *     people can stand at it together -- no sight is inside a statue's plinth, a
 *     building or a pond;
 *   - how far along reads in metres, things said and sights seen, and the next thing
 *     to do is the first not done;
 *   - a payment is cheered, a payment of nothing (already done today) is not, and
 *     walking out forgets it all;
 *   - the one you are talking with, and only they, wears a ring at their feet;
 *   - the line to type in stays clear of the stick (SOURCE SHAPE: a layout).
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - move a sight 10 units off its statue            -> "at a landmark" fails
 *   - cheer every park.quests, paid or not             -> "a payment of nothing" fails
 *   - ring everybody live                              -> "only they" fails
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PARK_QUESTS, PARK_SIGHTS, STARTER, pointInPolygon, type Look, type ParkPerson } from '@clone/shared';
import { gardenSpots } from '../src/features/world/garden';
import { livePeople, mergePeople, nextQuest, questProgress, useParkLive } from '../src/features/world/park-live';
import { WorldSim } from '../src/features/world/sim';
import { CUBBON_PARK, venueGarden } from '../src/features/world/venue';

const park = venueGarden(CUBBON_PARK);

describe('the park\'s sights', () => {
  it('are at the landmarks the park draws, by name, inside the park', () => {
    for (const s of PARK_SIGHTS) {
      const words = s.name.toLowerCase().split(/\W+/).filter((w) => w.length > 3 && !['statue', 'sight', 'gate'].includes(w))
        .map((w) => w.replace(/s$/, ''));
      const marks = park.landmarks.filter((l) => words.some((w) => l.name.toLowerCase().includes(w)));
      expect(marks.length, `no landmark called anything like ${s.name}`).toBeGreaterThan(0);
      // Where the landmark is -- two lions, one sight between them.
      const mx = marks.reduce((n, l) => n + l.x, 0) / marks.length, mz = marks.reduce((n, l) => n + l.z, 0) / marks.length;
      expect(Math.hypot(mx - s.x, mz - s.z), `${s.name} is not at its landmark`).toBeLessThan(0.5);
      expect(pointInPolygon([s.x, s.z], park.outline), `${s.name} is outside the park`).toBe(true);
    }
  });

  it('can each be stood at by two people together', () => {
    const sim = new WorldSim(1);
    sim.setMap(gardenSpots(park));
    for (const s of PARK_SIGHTS) {
      // Somewhere within reach of it, two places a person apart, both standable.
      let found = false;
      for (let k = 0; k < 64 && !found; k++) {
        const a = (k / 64) * Math.PI * 2, d = s.r * 0.6;
        const p = [s.x + Math.sin(a) * d, s.z + Math.cos(a) * d] as const;
        const q = [p[0] + Math.cos(a) * 0.1, p[1] - Math.sin(a) * 0.1] as const;
        found = sim.standable(p[0], p[1]) && sim.standable(q[0], q[1]);
      }
      expect(found, `nowhere to stand together at ${s.name}`).toBe(true);
    }
  });
});

describe('things to do, on the phone', () => {
  it('says how far along in metres, things said and sights seen, and what is next', () => {
    expect(questProgress('walk', 12)).toBe('100 of 250 m');
    expect(questProgress('ride', 62)).toBe('500 of 500 m');
    expect(questProgress('talk', 2)).toBe('2 of 3 each');
    expect(questProgress('sights', 1)).toBe('1 of 3');
    expect(nextQuest(null)!.id).toBe('walk');
    expect(nextQuest({ day: 'd', done: ['hello', 'walk'], progress: {}, sights: [] })!.id).toBe('ride');
    expect(nextQuest({ day: 'd', done: PARK_QUESTS.map((q) => q.id), progress: {}, sights: [] })).toBeNull();
  });

  it('cheers what paid, not a payment of nothing, and forgets it all on walking out', () => {
    const s = useParkLive.getState();
    s.setIn(true);
    const q = { day: '2026-09-29', done: ['hello' as const], progress: { hello: 1 }, sights: [] };
    s.gotQuests(q, { quest: 'hello', points: 0, balance: 40 });
    expect(useParkLive.getState().cheer, 'cheered a payment of nothing').toBeNull();
    s.gotQuests(q, { quest: 'hello', points: 10, balance: 50 });
    expect(useParkLive.getState().cheer).toMatchObject({ quest: 'hello', points: 10, balance: 50 });
    s.gotQuests(q);
    expect(useParkLive.getState().cheer, 'a state without a payment took the cheer away').not.toBeNull();
    expect(useParkLive.getState().quests!.done).toEqual(['hello']);
    s.setIn(false);
    expect(useParkLive.getState()).toMatchObject({ quests: null, cheer: null });
  });

  it('rings the one you are talking with, and only they', () => {
    const look: Look = { ...STARTER };
    const REF = (n: number) => n.toString(16).padStart(32, '0');
    const at = (ref: string, x: number): ParkPerson => ({ ref, x, z: 0, facing: 0, moving: false, look });
    const people = mergePeople(new Map(), [at(REF(1), 1), at(REF(2), 2)]);
    const sim = new WorldSim(3);
    livePeople(sim, people, REF(2));
    expect([sim.get(REF(1))!.ring, sim.get(REF(2))!.ring]).toEqual([false, true]);
    livePeople(sim, people, null);
    expect([sim.get(REF(1))!.ring, sim.get(REF(2))!.ring], 'still ringed after parting').toEqual([false, false]);
  });

  it('keeps the line to type in clear of the stick (SOURCE SHAPE: a layout)', () => {
    const src = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'world', 'park-hud.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src).toContain('left: open ? (keyboard > 0 ? space.screen : space.screen + STICK_RING + space.sm) : undefined');
  });
});
