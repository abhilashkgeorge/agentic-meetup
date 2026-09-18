/**
 * What the town knows, and how a roster becomes motion -- the pure half.
 *
 * The roster from /v1/world is the truth; the simulation is a picture of it. These
 * functions are the bridge, written with no runtime imports so they run under vitest
 * with no renderer, no network and no react-native in the room: `fromRoster` turns a
 * roster into the agents the sim should hold, and `planTransitions` compares the
 * states the sim was last told with the states the roster now reports and returns
 * only what CHANGED -- so a poll every eight seconds does not restart a walk-over
 * that is already under way.
 */
import type { World, WorldAgent } from '../../lib/api';
import type { AgentKind } from './sim';

export interface AgentSpec { ref: string; kind: AgentKind; seed: number }

export const YOU = 'you';

/** Everybody the sim should hold, you first. */
export function fromRoster(world: World): AgentSpec[] {
  return [
    { ref: YOU, kind: 'you', seed: 7 },
    ...world.agents.map((a) => ({ ref: a.ref, kind: a.kind, seed: a.seed })),
  ];
}

export type Transition =
  | { op: 'meet'; ref: string }
  | { op: 'introduced'; ref: string }
  | { op: 'pass'; ref: string }
  | { op: 'settle'; ref: string };

/**
 * What to tell the sim, given what it was told before.
 *
 * `talking` starts a walk-over once; `introduced` lights the ring once; `passed`
 * sends them off once; the rest (`briefed`, `waiting`, `idle`) is standing around,
 * which needs no instruction unless they were mid-something -- then `settle`.
 */
export function planTransitions(
  applied: ReadonlyMap<string, WorldAgent['state']>,
  agents: readonly WorldAgent[],
): Transition[] {
  const out: Transition[] = [];
  for (const a of agents) {
    const before = applied.get(a.ref);
    if (before === a.state) continue;
    switch (a.state) {
      case 'talking': out.push({ op: 'meet', ref: a.ref }); break;
      case 'introduced': out.push({ op: 'introduced', ref: a.ref }); break;
      case 'passed': out.push({ op: 'pass', ref: a.ref }); break;
      default:
        if (before === 'talking') out.push({ op: 'settle', ref: a.ref });
    }
  }
  return out;
}

export const roundActive = (w: World | null): boolean =>
  w?.round?.status === 'queued' || w?.round?.status === 'running';
