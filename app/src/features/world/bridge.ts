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
import type { AgreementWords, World, WorldAgent } from '../../lib/api';
import type { AgentKind } from './sim';

export interface AgentSpec { ref: string; kind: AgentKind; seed: number; ghost: boolean }

export const YOU = 'you';

/** The server's seed for a ref (server/src/api/world.ts seedOf): colour and gait. */
export const seedOf = (ref: string): number => parseInt(ref.slice(0, 8), 16);

/**
 * Somebody the town has not drawn yet, who is about to be met.
 *
 * A round names its three people the moment it chooses them, and only some of them
 * were in the square's sample of strangers. The rest have to exist before anybody
 * can walk over to them -- the first cut told the sim to meet a ref it did not hold,
 * which is a no-op, so the agent stayed at home for the whole round.
 */
export const metSpec = (ref: string, practice = false): AgentSpec =>
  ({ ref, kind: 'met', seed: seedOf(ref), ghost: practice });

/** Everybody the sim should hold, you first. */
export function fromRoster(world: World): AgentSpec[] {
  return [
    { ref: YOU, kind: 'you', seed: 7, ghost: false },
    ...world.agents.map((a) => ({ ref: a.ref, kind: a.kind, seed: a.seed, ghost: a.practice })),
  ];
}

export type Transition =
  /**
   * `theyCame`: their agent walked over to yours (a round somebody else sent out).
   * `practice`: not a real person, so drawn as a ghost if the square has to make them.
   */
  | { op: 'meet'; ref: string; theyCame?: boolean; practice?: boolean }
  | { op: 'verdict'; ref: string; words: AgreementWords }
  | { op: 'introduced'; ref: string }
  | { op: 'pass'; ref: string }
  | { op: 'settle'; ref: string }
  /** The round is over, however it ended: your agent comes home, visits queued or not. */
  | { op: 'recall' };

/** A transition about one agent -- everything but the recall, which is about the round. */
export type Motion = Exclude<Transition, { op: 'recall' }>;

/**
 * A live event from the socket, as motion. The socket is the cue and the roster is
 * the truth: every event also nudges a refetch, and the transition it returns is
 * recorded as already applied so the refetch does not replay it.
 */
export type TownEvent =
  | { type: 'round.queued'; roundId: string }
  | { type: 'round.met'; roundId: string | null; rendezvousId: string; agent: string; practice: boolean }
  | { type: 'round.talking'; roundId: string | null; rendezvousId: string; agent: string }
  | { type: 'round.decided'; roundId: string | null; rendezvousId: string; agent: string; agreement: AgreementWords }
  | { type: 'round.done'; roundId: string; met: number; skipped: string | null; error: string | null }
  | { type: 'match.turn'; rendezvousId: string; agent: string }
  | { type: 'match.introduced'; rendezvousId: string; agent: string };

export function eventTransitions(ev: TownEvent): Transition[] {
  switch (ev.type) {
    // A null roundId means it is somebody else's round: they came to me.
    case 'round.met': return [{
      op: 'meet', ref: ev.agent,
      ...(ev.roundId === null ? { theyCame: true } : {}),
      ...(ev.practice ? { practice: true } : {}),
    }];
    case 'round.decided': return [{ op: 'verdict', ref: ev.agent, words: ev.agreement }];
    case 'match.introduced': return [{ op: 'introduced', ref: ev.agent }];
    // Whatever it says -- met three, met nobody, the day's cap -- nobody else is
    // about to be visited. A failed round used to leave the agent talking for ever.
    case 'round.done': return [{ op: 'recall' }];
    default: return [];
  }
}

/** What the sim was told, as the roster would have said it -- so the next poll agrees. */
export const stateAfter = (t: Motion): WorldAgent['state'] =>
  t.op === 'meet' ? 'talking'
  : t.op === 'introduced' ? 'introduced'
  : t.op === 'pass' ? 'passed'
  : 'briefed';

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
): Motion[] {
  const out: Motion[] = [];
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

/**
 * Who the roster stopped listing since last time: a stranger the sample rotated
 * out, a released claim, a lapsed seat past its day. They leave the sim, or the
 * square fills with people who are not there.
 */
export function departed(
  applied: ReadonlyMap<string, WorldAgent['state']>,
  agents: readonly WorldAgent[],
): string[] {
  const now = new Set(agents.map((a) => a.ref));
  return [...applied.keys()].filter((ref) => !now.has(ref));
}

export const roundActive = (w: World | null): boolean =>
  w?.round?.status === 'queued' || w?.round?.status === 'running';
