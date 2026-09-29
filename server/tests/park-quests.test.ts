/**
 * Things two people do together in the park, on their own: what counts, what does not,
 * and that each is done once a day.
 *
 * WHAT THE FOUNDER ASKED (2026-09-29): "add more tasks couples can do in the park.
 * gameify it."
 *
 * WHAT IS PINNED (park/quests.ts, pure):
 *   - meeting somebody: both, when they pair, once;
 *   - a walk counts while both move within a few metres of each other, not apart, not
 *     standing, and never faster than a walk -- a phone that jumps across the park has
 *     walked no further for it; a ride only while both ride;
 *   - sitting and talking needs both to say three things on the bench; one talking
 *     alone, or off the bench, is not it -- and only the count is ever given;
 *   - a sight counts when both stand at it; three sights is seeing the sights;
 *   - whatever the ledger says was paid today is done; a new day starts afresh;
 *   - the points each pays are the points the phone shows (the ledger's POINTS).
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - count the walk without the speed cap          -> "jumps across the park" fails
 *   - count the walk however far apart they are     -> "apart is not together" fails
 *   - finish sitting and talking on one person's count -> "one talking alone" fails
 *   - a sight counted for whoever stands at it       -> "both stand at it" fails
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PARK_QUESTS, PARK_SIGHTS, parkDay } from '@clone/shared';
import { POINTS } from '../src/points/ledger.js';
import { ParkQuests, type Whereabouts } from '../src/park/quests.js';

function clock(start = Date.UTC(2026, 8, 29, 6, 0)) {
  let t = start;
  return { now: () => t, later: (ms: number) => { t += ms; } };
}
const goal = (id: string) => PARK_QUESTS.find((q) => q.id === id)!.goal;
const at = (x: number, z: number, moving = true, riding = false): Whereabouts => ({ x, z, moving, riding });
const pairOf = (a: string, b: string) => (u: string) => (u === a ? b : u === b ? a : null);

function paired() {
  const c = clock();
  const q = new ParkQuests(c.now);
  q.enter('a', []); q.enter('b', []);
  return { c, q, done: q.paired('a', 'b') };
}

/** Walk the pair along x at `speed` units a second for `secs`, `gap` apart, ticking at 4 Hz. */
function go(q: ParkQuests, secs: number, speed: number, gap: number, riding = false, from = 0) {
  const done: { userId: string; quest: string }[] = [];
  for (let k = 0; k <= secs * 4; k++) {
    const x = from + (speed * k) / 4;
    const where = new Map([['a', at(x, 0, true, riding)], ['b', at(x, gap, true, riding)]]);
    done.push(...q.step(0.25, where, pairOf('a', 'b')));
  }
  return done;
}

describe('things to do together in the park', () => {
  it('meeting somebody: both, when they pair, and once', () => {
    const { q, done } = paired();
    expect(done).toEqual([{ userId: 'a', quest: 'hello' }, { userId: 'b', quest: 'hello' }]);
    q.parted('a', 'b');
    expect(q.paired('a', 'b'), 'paid twice for meeting').toEqual([]);
  });

  it('a walk side by side counts, and is done at its length, for both', () => {
    const { q } = paired();
    // A walk is 0.57 units a second: the goal in a little under a minute.
    const done = go(q, goal('walk') / 0.57 + 2, 0.57, 0.3);
    expect(done).toEqual([{ userId: 'a', quest: 'walk' }, { userId: 'b', quest: 'walk' }]);
    expect(q.stateOf('a', 'b')!.progress.walk).toBe(goal('walk'));
  });

  it('apart is not together, standing is not walking, and a jump across the park is no walk', () => {
    let { q } = paired();
    expect(go(q, 30, 0.57, 3), 'apart is not together').toEqual([]);
    expect(q.stateOf('a', 'b')!.progress.walk).toBe(0);
    ({ q } = paired());
    for (let k = 0; k < 400; k++) q.step(0.25, new Map([['a', at(0, 0, false)], ['b', at(0, 0.3, false)]]), pairOf('a', 'b'));
    expect(q.stateOf('a', 'b')!.progress.walk, 'standing is walking').toBe(0);
    ({ q } = paired());
    // 20 units a second -- a phone that says it is somewhere else -- counts at a walk's pace.
    go(q, 2, 20, 0.3);
    expect(q.stateOf('a', 'b')!.progress.walk, 'jumps across the park counted').toBeLessThanOrEqual(Math.ceil(0.8 * 2) + 1);
  });

  it('a ride counts only while both ride', () => {
    let { q } = paired();
    const done = go(q, goal('ride') / 1.14 + 2, 1.14, 0.5, true);
    expect(done.map((d) => d.quest)).toEqual(['ride', 'ride']);
    expect(q.stateOf('a', 'b')!.progress.walk, 'a ride counted as a walk').toBe(0);
    ({ q } = paired());
    // One on a bike, one walking beside it: neither a ride nor a walk.
    for (let k = 0; k < 200; k++) {
      const x = (0.57 * k) / 4;
      q.step(0.25, new Map([['a', at(x, 0, true, true)], ['b', at(x, 0.3, true, false)]]), pairOf('a', 'b'));
    }
    expect(q.stateOf('a', 'b')!.progress).toMatchObject({ walk: 0, ride: 0 });
  });

  it('sitting and talking: both say three things on the bench; one talking alone is not it', () => {
    const { q } = paired();
    for (let k = 0; k < 5; k++) expect(q.said('a', 'b', true), 'one talking alone').toEqual([]);
    expect(q.said('b', 'a', false), 'said off the bench counted').toEqual([]);
    q.said('b', 'a', true); q.said('b', 'a', true);
    expect(q.said('b', 'a', true)).toEqual([{ userId: 'b', quest: 'talk' }, { userId: 'a', quest: 'talk' }]);
    // Only a count crosses into here: nothing it is given is words.
    const src = readFileSync(join(import.meta.dirname, '..', 'src', 'park', 'quests.ts'), 'utf8');
    expect(src).toMatch(/said\(userId: string, partner: string \| null, onBench: boolean\): Done\[\]/);
  });

  it('a sight counts when both stand at it, and three is seeing the sights', () => {
    const { q } = paired();
    const [s1, s2, s3] = PARK_SIGHTS;
    // One at the sight, the other not: not seen.
    q.step(0.25, new Map([['a', at(s1!.x, s1!.z, false)], ['b', at(s1!.x + 10, s1!.z, false)]]), pairOf('a', 'b'));
    expect(q.stateOf('a', 'b')!.sights, 'counted for one standing at it').toEqual([]);
    const done = [s1!, s2!, s3!].flatMap((s) =>
      q.step(0.25, new Map([['a', at(s.x, s.z, false)], ['b', at(s.x + 0.4, s.z, false)]]), pairOf('a', 'b')));
    expect(done).toEqual([{ userId: 'a', quest: 'sights' }, { userId: 'b', quest: 'sights' }]);
    expect(q.stateOf('b', 'a')!.sights).toEqual([s1!.id, s2!.id, s3!.id]);
  });

  it('takes the ledger\'s word for what was paid today, and starts afresh tomorrow', () => {
    const c = clock();
    const q = new ParkQuests(c.now);
    q.enter('a', ['hello', 'walk']); q.enter('b', []);
    expect(q.paired('a', 'b'), 'paid again for what the ledger says was paid').toEqual([{ userId: 'b', quest: 'hello' }]);
    expect(q.stateOf('a', 'b')!.done).toEqual(['hello', 'walk']);
    c.later(24 * 3_600_000);
    expect(q.stateOf('a', 'b')!.done, 'yesterday is still done').toEqual([]);
    expect(q.stateOf('a', 'b')!.day).toBe(parkDay(c.now()));
  });

  it('pays the points the phone shows', () => {
    for (const quest of PARK_QUESTS) {
      expect(POINTS[`park_${quest.id}` as keyof typeof POINTS], quest.id).toBe(quest.points);
    }
  });
});
