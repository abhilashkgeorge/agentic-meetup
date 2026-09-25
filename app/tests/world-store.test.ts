/**
 * The bridge from roster to motion is pure, so it is tested with no renderer and no
 * network: what the sim is told, and -- the part that matters -- what it is NOT told
 * again on the next poll.
 */
import { describe, expect, it } from 'vitest';
import { YOU, departed, eventTransitions, fromRoster, metSpec, planTransitions, seedOf, stateAfter } from '../src/features/world/bridge';
import { STARTER, lookFor } from '@clone/shared';
import type { World, WorldAgent } from '../src/lib/api';

const agent = (ref: string, state: WorldAgent['state'], kind: WorldAgent['kind'] = 'stranger'): WorldAgent =>
  ({ ref, kind, practice: kind === 'practice', seed: 1, state, look: lookFor(ref.charCodeAt(0)) });

const world = (agents: WorldAgent[]): World => ({
  square: { city: 'Bangalore' }, me: { inPool: true, knows: 3, missing: [], need: [], look: STARTER },
  pool: { total: 10 }, round: null, targetsLeftToday: 5, agents,
});

describe('fromRoster', () => {
  it('puts you first, then everybody by ref, keeping their kind', () => {
    const specs = fromRoster(world([agent('a', 'idle'), agent('b', 'briefed', 'met'), agent('c', 'idle', 'practice')]));
    expect(specs.map((s) => s.ref)).toEqual([YOU, 'a', 'b', 'c']);
    expect(specs.map((s) => s.kind)).toEqual(['you', 'stranger', 'met', 'practice']);
    expect(specs.map((s) => s.ghost)).toEqual([false, false, false, true]);
    // Everybody arrives with their character, you with yours.
    expect(specs[0]!.look).toEqual(STARTER);
    expect(specs.slice(1).map((s) => s.look)).toEqual(['a', 'b', 'c'].map((r) => lookFor(r.charCodeAt(0))));
    // No neighbourhood said: the central tile, for you and for them.
    expect(specs.map((s) => s.area)).toEqual([null, null, null, null]);
  });

  it('carries each person\'s neighbourhood, yours included', () => {
    const w = world([{ ...agent('a', 'idle'), area: 'whitefield' }, agent('b', 'idle')]);
    w.me.area = 'koramangala';
    const specs = fromRoster(w);
    expect(specs.map((s) => [s.ref, s.area])).toEqual([[YOU, 'koramangala'], ['a', 'whitefield'], ['b', null]]);
    expect(metSpec('c').area).toBeNull();
  });
});

describe('planTransitions', () => {
  it('starts a walk-over once, and not again on the next poll', () => {
    const roster = [agent('a', 'talking', 'met')];
    const first = planTransitions(new Map(), roster);
    expect(first).toEqual([{ op: 'meet', ref: 'a' }]);
    const again = planTransitions(new Map([['a', 'talking']]), roster);
    expect(again).toEqual([]);
  });

  it('turns each state change into exactly one instruction', () => {
    const before = new Map<string, WorldAgent['state']>([['a', 'talking'], ['b', 'briefed'], ['c', 'idle']]);
    const now = [agent('a', 'briefed', 'met'), agent('b', 'introduced', 'met'), agent('c', 'passed', 'met')];
    expect(planTransitions(before, now)).toEqual([
      { op: 'settle', ref: 'a' },          // stopped talking, no verdict shown by the roster
      { op: 'introduced', ref: 'b' },
      { op: 'pass', ref: 'c' },
    ]);
  });

  it('says nothing about people standing around', () => {
    expect(planTransitions(new Map(), [agent('a', 'idle'), agent('b', 'waiting', 'met')])).toEqual([]);
  });
});

describe('eventTransitions', () => {
  it('turns a live event into the one motion it means', () => {
    expect(eventTransitions({ type: 'round.met', roundId: 'r', rendezvousId: 'z', agent: 'a', practice: false }))
      .toEqual([{ op: 'meet', ref: 'a' }]);
    expect(eventTransitions({ type: 'round.decided', roundId: 'r', rendezvousId: 'z', agent: 'a' }))
      .toEqual([{ op: 'parted', ref: 'a' }]);
    expect(eventTransitions({ type: 'match.introduced', rendezvousId: 'z', agent: 'a' }))
      .toEqual([{ op: 'introduced', ref: 'a' }]);
  });

  /**
   * "They met" is the whole of it. The event used to carry how the agents got on and
   * the square drew it as a tick or a cross; now there is nothing to carry, and even
   * a server old enough to send it has it dropped here rather than drawn.
   *
   * Negative control: pass `words: ev.agreement` through again -> this fails.
   */
  it('turns "they met" into the same motion for every pair, whatever else arrives with it', () => {
    const old = { type: 'round.decided', roundId: 'r', rendezvousId: 'z', agent: 'a', agreement: 'did_not_click' };
    const t = eventTransitions(old as Parameters<typeof eventTransitions>[0]);
    expect(t).toEqual([{ op: 'parted', ref: 'a' }]);
    expect(JSON.stringify(t)).not.toMatch(/got_on|unsure|did_not_click|could_not_tell|words/);
  });

  it('carries "practice" so a ghost the square has to make is drawn as one', () => {
    expect(eventTransitions({ type: 'round.met', roundId: 'r', rendezvousId: 'z', agent: 'a', practice: true }))
      .toEqual([{ op: 'meet', ref: 'a', practice: true }]);
  });

  it('knows whose round it was: theirs means they walked over to me', () => {
    expect(eventTransitions({ type: 'round.met', roundId: null, rendezvousId: 'z', agent: 'a', practice: false }))
      .toEqual([{ op: 'meet', ref: 'a', theyCame: true }]);
    // Mine carries no flag at all, so the plain shape above stays the plain shape.
    expect(eventTransitions({ type: 'round.met', roundId: 'r', rendezvousId: 'z', agent: 'a', practice: false })[0])
      .not.toHaveProperty('theyCame');
  });

  it('draws nothing for the events that only mean "look again"', () => {
    expect(eventTransitions({ type: 'round.queued', roundId: 'r' })).toEqual([]);
    expect(eventTransitions({ type: 'round.talking', roundId: 'r', rendezvousId: 'z', agent: 'a' })).toEqual([]);
    expect(eventTransitions({ type: 'match.turn', rendezvousId: 'z', agent: 'a' })).toEqual([]);
  });

  it('brings the agent home when the round is over, however it ended', () => {
    expect(eventTransitions({ type: 'round.done', roundId: 'r', met: 3, skipped: null, error: null })).toEqual([{ op: 'recall' }]);
    expect(eventTransitions({ type: 'round.done', roundId: 'r', met: 0, skipped: null, error: 'budget_exceeded' })).toEqual([{ op: 'recall' }]);
  });

  it('records what the roster will say, so the next poll does not replay the motion', () => {
    expect(stateAfter({ op: 'meet', ref: 'a' })).toBe('talking');
    expect(stateAfter({ op: 'parted', ref: 'a' })).toBe('briefed');
    expect(planTransitions(new Map([['a', stateAfter({ op: 'meet', ref: 'a' })]]), [
      { ref: 'a', kind: 'met', practice: false, seed: 1, state: 'talking', look: STARTER },
    ])).toEqual([]);
  });
});

describe('metSpec', () => {
  it('makes the agent the roster would have made, so the next poll finds it in place', () => {
    const ref = 'a3f2c19e0000ffff0000ffff0000ffff';
    expect(metSpec(ref)).toEqual({ ref, kind: 'met', seed: parseInt('a3f2c19e', 16), ghost: false, look: lookFor(parseInt('a3f2c19e', 16)), area: null });
    expect(metSpec(ref, true).ghost, 'a practice profile is a ghost even once met').toBe(true);
    expect(seedOf(ref)).toBe(0xa3f2c19e);
  });
});

describe('departed', () => {
  it('names whoever the roster stopped listing, and nobody else', () => {
    const before = new Map<string, WorldAgent['state']>([['a', 'idle'], ['b', 'talking'], ['c', 'idle']]);
    expect(departed(before, [agent('a', 'idle'), agent('c', 'idle')])).toEqual(['b']);
    expect(departed(new Map(), [agent('a', 'idle')])).toEqual([]);
  });
});
