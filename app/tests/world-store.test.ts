/**
 * The bridge from roster to motion is pure, so it is tested with no renderer and no
 * network: what the sim is told, and -- the part that matters -- what it is NOT told
 * again on the next poll.
 */
import { describe, expect, it } from 'vitest';
import { YOU, fromRoster, planTransitions } from '../src/features/world/bridge';
import type { World, WorldAgent } from '../src/lib/api';

const agent = (ref: string, state: WorldAgent['state'], kind: WorldAgent['kind'] = 'stranger'): WorldAgent =>
  ({ ref, kind, practice: kind === 'practice', seed: 1, state });

const world = (agents: WorldAgent[]): World => ({
  square: { city: 'Bangalore' }, me: { inPool: true, knows: 3, missing: [], need: [] },
  pool: { total: 10 }, round: null, targetsLeftToday: 5, agents,
});

describe('fromRoster', () => {
  it('puts you first, then everybody by ref, keeping their kind', () => {
    const specs = fromRoster(world([agent('a', 'idle'), agent('b', 'briefed', 'met'), agent('c', 'idle', 'practice')]));
    expect(specs.map((s) => s.ref)).toEqual([YOU, 'a', 'b', 'c']);
    expect(specs.map((s) => s.kind)).toEqual(['you', 'stranger', 'met', 'practice']);
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
