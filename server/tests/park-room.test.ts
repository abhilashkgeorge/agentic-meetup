/**
 * The live park's rules, on their own: who is sent to whom, who hears what, who is
 * kept apart, and who has left.
 *
 * WHAT IS GUARDED (the founder, 2026-09-29: real people in the park who can see each
 * other and talk -- and privacy for whoever wants it):
 *   - you are sent only the people within the mist, nearest first, under YOUR ref for
 *     each of them, and never yourself;
 *   - people kept apart (blocked either way, banned) never see or hear each other;
 *   - what you say reaches earshot and no further, and a phone number, handle or link
 *     is not sent at all;
 *   - somebody silent for half a minute has left.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - drop the apart check in `near` -> "never shows two people kept apart" fails;
 *   - drop the contact check in `say` -> "refuses contact details" fails;
 *   - hear at PARK_VIEW instead of PARK_EARSHOT -> "reaches earshot and no further" fails;
 *   - leave `riding` out of the snapshot -> "on a bicycle riding it" fails.
 */
import { describe, expect, it } from 'vitest';
import { PARK_EARSHOT, PARK_VIEW, STARTER } from '@clone/shared';
import { ParkRoom, STALE_MS } from '../src/park/room.js';

const ref = (viewer: string, other: string) => `${viewer}>${other}`.padEnd(32, '0').slice(0, 32);
function room() {
  let t = 1_000_000;
  const r = new ParkRoom(ref, () => t);
  return { r, later: (ms: number) => { t += ms; } };
}
const look = STARTER;

describe('the park, live', () => {
  it('sends you the people within the mist, nearest first, as your refs for them', () => {
    const { r } = room();
    r.enter('a', look, []); r.move('a', 0, 0, 0, false);
    r.enter('b', look, []); r.move('b', 10, 0, 0, true);
    r.enter('c', look, []); r.move('c', 3, 4, 0, false);            // 5 away
    r.enter('d', look, []); r.move('d', PARK_VIEW + 1, 0, 0, false); // past the mist
    const seen = r.snapshot('a');
    expect(seen.map((p) => p.ref)).toEqual([ref('a', 'c'), ref('a', 'b')]);
    expect(seen[1]).toMatchObject({ x: 10, z: 0, moving: true, look });
    // Somebody else's view has its own refs.
    expect(r.snapshot('b').map((p) => p.ref)).toContain(ref('b', 'a'));
    // Nobody is sent themselves.
    expect(r.snapshot('a').some((p) => p.ref === ref('a', 'a'))).toBe(false);
    // Nobody not in the park sees anything.
    expect(r.snapshot('zz')).toEqual([]);
  });

  it('shows somebody on a bicycle riding it, and stops when they get off', () => {
    // The founder, 2026-09-29: "bicycles should also be used for travel around the
    // park". Whoever is near sees you on one; nothing else about you changes.
    const { r } = room();
    r.enter('a', look, []); r.move('a', 0, 0, 0, false);
    r.enter('b', look, []); r.move('b', 2, 0, 0.5, true, true);
    expect(r.snapshot('a')[0]).toMatchObject({ x: 2, moving: true, riding: true });
    r.move('b', 2.5, 0, 0.5, false);
    expect(r.snapshot('a')[0]!.riding).toBeUndefined();
    // Not a thing anybody is sent for somebody walking.
    r.move('b', 3, 0, 0.5, true);
    expect('riding' in r.snapshot('a')[0]!).toBe(false);
  });

  it('never shows two people kept apart, either way, and hides them the moment one blocks', () => {
    const { r } = room();
    r.enter('a', look, []);
    r.enter('b', look, ['a']);          // b walks in, and the database says a and b are apart
    r.enter('c', look, []);
    expect(r.snapshot('a').map((p) => p.ref)).toEqual([ref('a', 'c')]);
    expect(r.snapshot('b').map((p) => p.ref)).toEqual([ref('b', 'c')]);
    expect(r.resolve('a', ref('a', 'b'))).toBeNull();
    // A block in the park: from now on.
    expect(r.resolve('a', ref('a', 'c'))).toBe('c');
    r.keepApart('a', 'c');
    expect(r.snapshot('a')).toEqual([]);
    expect(r.snapshot('c').map((p) => p.ref)).toEqual([ref('c', 'b')]);
    // ...and neither hears the other.
    const said = r.say('c', 'hello');
    expect(said.ok && said.to.map((t) => t.userId).sort()).toEqual(['b', 'c']);
  });

  it('reaches earshot and no further, each under the listener\'s own ref', () => {
    const { r } = room();
    r.enter('a', look, []); r.move('a', 0, 0, 0, false);
    r.enter('near', look, []); r.move('near', PARK_EARSHOT - 0.1, 0, 0, false);
    r.enter('far', look, []); r.move('far', PARK_EARSHOT + 0.1, 0, 0, false);
    const said = r.say('a', 'nice day for it');
    expect(said.ok).toBe(true);
    if (!said.ok) return;
    expect(said.to).toEqual([{ userId: 'a', ref: 'you' }, { userId: 'near', ref: ref('near', 'a') }]);
  });

  it('refuses contact details, and anybody not in the park', () => {
    const { r } = room();
    r.enter('a', look, []);
    for (const text of ['call me on 98450 12345', 'my insta is @someone', 'see www.example.com']) {
      expect(r.say('a', text), text).toEqual({ ok: false, reason: 'contact' });
    }
    expect(r.say('a', 'is the bandstand open today?').ok).toBe(true);
    expect(r.say('nobody', 'hello')).toEqual({ ok: false, reason: 'not_in_park' });
  });

  it('lets people go who have gone quiet, and keeps the ones still walking', () => {
    const { r, later } = room();
    r.enter('a', look, []); r.enter('b', look, []);
    later(STALE_MS - 1000);
    r.move('b', 1, 1, 0, true);
    later(2000);
    expect(r.sweep()).toEqual(['a']);
    expect([...r.members.keys()]).toEqual(['b']);
    // Speaking counts as being there.
    later(STALE_MS - 1000);
    r.say('b', 'still here');
    later(2000);
    expect(r.sweep()).toEqual([]);
  });

  it('comes back where it was when it walks in again, and a move outside the park is refused', () => {
    const { r } = room();
    r.enter('a', look, []);
    expect(r.move('a', 5, 6, 1, true)).toBe(true);
    r.enter('a', look, []);
    expect(r.members.get('a')).toMatchObject({ x: 5, z: 6 });
    r.leave('a');
    expect(r.move('a', 1, 1, 0, false)).toBe(false);
  });
});
