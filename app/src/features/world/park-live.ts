/**
 * The park, live, on the phone: who is here right now, and what was just said.
 *
 * The server decides everything -- who you may see, who hears you (park/room.ts); this
 * keeps the last word it sent. A person arrives with their look the first time you are
 * sent them and without it after (it is the same look), so the look is carried over
 * from the frame before; somebody out of sight is dropped, and their look with them,
 * because the server forgets it too and sends it again when they come back.
 *
 * NO REACT NATIVE HERE: tests/park-live.test.ts holds the merging and the bubbles.
 */
import { create } from 'zustand';
import { PARK_QUESTS, PARK_SIGHTS, type Look, type ParkFly, type ParkPerson, type ParkQuestId, type ParkSight } from '@clone/shared';
import { flightEffects } from './park-effects';
import { sameFlight, type WorldSim } from './sim';

export interface LivePerson {
  ref: string;
  x: number;
  z: number;
  facing: number;
  moving: boolean;
  look: Look;
  sitting: boolean;
  riding: boolean;
  /** Within earshot: who they are to the voice server (park-voice.ts). */
  voice: string | null;
  /** Mid sky drop (flight.ts): their x and z are the sky's until they land. */
  fly?: ParkFly;
}

export interface Line {
  id: number;
  /** The speaker's ref, or `you`. */
  ref: string;
  text: string;
  at: number;
  /** Said on a bench, to the two of you only. */
  private?: boolean;
}

/** How "Find someone" is going (server park/socket.ts). */
export type FindStatus = 'searching' | 'asking' | 'nobody' | 'declined' | 'no_answer' | 'busy' | 'gone';
export const FIND_TEXT: Record<FindStatus, string> = {
  searching: 'Looking for someone free…',
  asking: 'Asking someone if they are free to talk…',
  nobody: 'Nobody here is free to talk right now. Try again in a bit.',
  declined: 'They are not free right now. Try someone else in a moment.',
  no_answer: 'No answer. They may have put their phone down.',
  busy: 'You are already talking with someone.',
  gone: 'They left the park.',
};

/** The screen's side margin (components/ui space.screen). */
const EDGE = 20;
/** Half a person's width on screen at the walking camera, and a little over, in dp. */
export const PLAYER_CLEAR = 18;

/**
 * How wide the park's right-hand column may be -- what was just said, the card of what you
 * are doing with somebody, the voice line: never across the middle of the screen, where
 * the walking camera keeps you. At a fixed 228 it covered your own character on the Seeker
 * (470 dp wide), the card over your head as you walked (2026-09-29).
 */
export function dockWidth(screenWidth: number): number {
  return Math.max(120, Math.min(228, Math.floor(screenWidth / 2 - PLAYER_CLEAR - EDGE)));
}

/** How long something said stays over the speaker's head. */
export const BUBBLE_MS = 6500;
/** How many lines the chat keeps. */
export const LINES = 30;

export type Refusal = 'contact' | 'too_fast' | 'not_in_park' | 'bench_taken';
export const REFUSAL_TEXT: Record<Refusal, string> = {
  contact: 'Not sent: numbers, handles and links are swapped after you both say yes.',
  too_fast: 'Not sent: slow down a little.',
  not_in_park: 'Not sent: you are not in the park.',
  bench_taken: 'Somebody just took that bench. Try again for another.',
};

/** What you have done together in the park today, as the server last said. */
export interface Quests {
  day: string;
  done: ParkQuestId[];
  progress: Partial<Record<ParkQuestId, number>>;
  sights: string[];
}

/**
 * How far along a thing to do is, in words: metres walked or ridden, things said,
 * sights seen. A park unit is 8.1 m (cubbon.ts).
 */
export function questProgress(id: ParkQuestId, n: number): string {
  const q = PARK_QUESTS.find((x) => x.id === id)!;
  if (id === 'walk' || id === 'ride') return `${Math.round((n * 8.1) / 10) * 10} of ${Math.round((q.goal * 8.1) / 10) * 10} m`;
  if (id === 'talk') return `${n} of ${q.goal} each`;
  if (id === 'sights') return `${n} of ${q.goal}`;
  return '';
}

/**
 * The next thing to do together: what fits where you are -- sitting and talking on a
 * bench, riding together on a bike -- if it is not done yet, else the first not done
 * today, after meeting somebody.
 */
export function nextQuest(quests: Quests | null, now: { bench?: boolean; riding?: boolean } = {}): (typeof PARK_QUESTS)[number] | null {
  const open = PARK_QUESTS.filter((q) => q.id !== 'hello' && !(quests?.done ?? []).includes(q.id));
  const fits = now.bench ? open.find((q) => q.id === 'talk') : now.riding ? open.find((q) => q.id === 'ride') : undefined;
  return fits ?? open[0] ?? null;
}

/**
 * The sights still to see together, to mark in the park: while the two of you are
 * talking and have not seen three today, every sight you have not stood at yet.
 */
export function sightsToMark(quests: Quests | null, paired: boolean): readonly ParkSight[] {
  if (!paired || (quests?.done ?? []).includes('sights')) return [];
  return PARK_SIGHTS.filter((s) => !(quests?.sights ?? []).includes(s.id));
}

/** The nearest of them, and how far, in whole tens of metres (a park unit is 8.1 m). */
export function nearestSight(sights: readonly ParkSight[], x: number, z: number): { sight: ParkSight; metres: number } | null {
  let best: { sight: ParkSight; metres: number } | null = null;
  for (const s of sights) {
    const metres = Math.round((Math.hypot(s.x - x, s.z - z) * 8.1) / 10) * 10;
    if (!best || metres < best.metres) best = { sight: s, metres };
  }
  return best;
}

/**
 * In the park, and away from it: in while the park is on screen, and for PARK_AWAY_MS
 * after it leaves (`held`, park-presence.ts) -- away, all that time.
 */
export function parkPresence(inVenue: boolean, onScreen: boolean, held: boolean): { inPark: boolean; away: boolean } {
  const inPark = inVenue && (onScreen || held);
  return { inPark, away: inPark && !onScreen };
}

/**
 * MOVING IS MOVING, however it happens: the stick, or the walk to a bench -- not the
 * sky drop, which every phone plays from its own numbers.
 *
 * It was the stick alone, so a walk to a bench went out as standing still; the server,
 * seeing somebody with a bench who was not moving, sent them as sitting, and everybody
 * else saw them sit down in the middle of the path and slide to the bench seated (the
 * founder, 2026-10-03: "the users sometimes sit in an invisible bench").
 */
export function movingNow(me: { state: string; fly?: unknown }, driven: boolean): boolean {
  return !me.fly && (driven || me.state === 'walking');
}

/**
 * THE BENCH BUTTON HOLDS STILL UNDER A FINGER.
 *
 * WHAT WAS WRONG. "Sit on a bench" and "Get up" are one button in one place, and it
 * swapped the instant the bench changed -- so the second tap of a double tap, or a tap
 * on a slow walk to a bench, landed on the other one. In the founder's own session
 * (2026-10-02, the voice server's log) the two of them sat and stood five times in
 * twenty seconds, and every time both voices left one room and joined another: "the
 * voice was not working unless I moved to a different screen and came back" -- which
 * walked them in again with no bench, and it held.
 *
 * NOW: tapped, it says "Sitting down…" and does nothing more until the server answers;
 * and for BENCH_SWAP_LOCK_MS after the bench changes, either way, it does nothing.
 *
 * `locked` IS STATE, SET AND CLEARED BY A TIMER -- never worked out from the clock while
 * drawing. The app builds with the React Compiler, which keeps what a component worked
 * out until its inputs change; the clock is not an input, so the first version, which
 * compared Date.now() with when the bench changed, stayed locked for good: "Sit on a
 * bench" greyed out on both phones, and tapping it did nothing (2026-10-03).
 */
export const BENCH_SWAP_LOCK_MS = 1_200;
export function benchPill(
  bench: number | null, asking: boolean, locked: boolean,
): { label: string; action: 'sit' | 'stand' | null } {
  if (asking && bench === null) return { label: 'Sitting down…', action: null };
  return bench === null
    ? { label: 'Sit on a bench', action: locked ? null : 'sit' }
    : { label: 'Get up', action: locked ? null : 'stand' };
}

/** This frame's people, their looks carried over from the last. Nobody without a look yet. */
export function mergePeople(prev: ReadonlyMap<string, LivePerson>, frame: readonly ParkPerson[]): Map<string, LivePerson> {
  const out = new Map<string, LivePerson>();
  for (const p of frame) {
    const look = p.look ?? prev.get(p.ref)?.look;
    if (!look) continue;
    out.set(p.ref, {
      ref: p.ref, x: p.x, z: p.z, facing: p.facing, moving: p.moving, look,
      sitting: p.sitting === true, riding: p.riding === true, voice: p.voice ?? null,
      ...(p.fly ? { fly: p.fly } : {}),
    });
  }
  return out;
}

/**
 * Whoever is here, into the sim, and whoever has gone, out of it. The one you are
 * talking with wears a ring at their feet, so you can find them in a crowd -- the sim's
 * own ring, which the canvas already draws -- and nobody else does.
 */
export function livePeople(sim: WorldSim, people: ReadonlyMap<string, LivePerson>, partner: string | null): void {
  for (const p of people.values()) {
    // A flight this phone has not seen yet: its beams and its smoke, timed from when it
    // really took off (park-effects.ts).
    const was = sim.get(p.ref);
    if (p.fly && !sameFlight(was?.fly?.f, p.fly) && !sameFlight(was?.flown, p.fly)) flightEffects(p.fly, Date.now() - p.fly.t);
    sim.live(p.ref, p.look, p.x, p.z, p.facing, p.moving, p.sitting, p.riding, p.fly);
    const a = sim.get(p.ref);
    if (a) a.ring = p.ref === partner;
  }
  for (const a of sim.agents()) if (a.kind === 'live' && !people.has(a.ref)) sim.unlive(a.ref);
}

/** What floats over each head now: the latest line of each speaker, while it lasts. */
export function bubbles(lines: readonly Line[], now: number): Line[] {
  const latest = new Map<string, Line>();
  for (const l of lines) if (now - l.at < BUBBLE_MS) latest.set(l.ref, l);
  return [...latest.values()];
}

interface ParkLive {
  /** In the park and sending where you are. */
  inPark: boolean;
  /**
   * In the park, but the park is not on screen: another tab, the phone put away. The
   * server holds you, standing, for AWAY_MS (server park/room.ts) before you leave.
   */
  away: boolean;
  /**
   * Where the server said you stand, the last time it did (park.arrived); `n` counts
   * them. Null from walking in until it says: nothing is sent about where you are till then.
   */
  arrived: { x: number; z: number; n: number } | null;
  people: ReadonlyMap<string, LivePerson>;
  lines: readonly Line[];
  refused: Refusal | null;
  /** Your "Find someone": where it is, and who and what you share once asking. */
  finding: { status: FindStatus; ref?: string; why?: string } | null;
  /** Somebody asking you: who, what you share, and when they asked. */
  asked: { ref: string; why?: string; at: number } | null;
  /**
   * Who you are talking with: `rideTo` is where to be taken (beside them) when you were
   * the one who asked -- the sky drop, flight.ts -- and null when they are coming to you.
   */
  partner: { ref: string; rideTo: readonly [number, number] | null; asker: boolean } | null;
  /** The bench the two of you took, while you sit on it. */
  bench: number | null;
  /** On a bicycle (bike.ts): faster, and seen on one by everybody near. */
  riding: boolean;
  /** Things to do together today, and the one just done, for a moment on screen. */
  quests: Quests | null;
  cheer: { quest: ParkQuestId; points: number; balance: number; at: number } | null;
  /** Your points, as of the last payment: shown with the things to do. */
  balance: number | null;
  setIn: (on: boolean) => void;
  setAway: (away: boolean) => void;
  gotArrived: (x: number, z: number) => void;
  gotPeople: (frame: readonly ParkPerson[]) => void;
  gotLine: (ref: string, text: string, at: number, priv?: boolean) => void;
  gotRefused: (reason: Refusal) => void;
  clearRefused: () => void;
  setFinding: (f: ParkLive['finding']) => void;
  gotAsked: (ref: string, why?: string) => void;
  gotUnasked: () => void;
  gotPaired: (ref: string, rideTo: readonly [number, number] | null) => void;
  /** The ride is over: nothing left to drive to. */
  rode: () => void;
  gotParted: () => void;
  gotBench: (bench: number | null) => void;
  /** Back after a dropped connection: the server ended any pair, asking or bench then. */
  rejoined: () => void;
  /** Get on a bicycle, or off it. Not while on a bench, or while a car is taking you. */
  setRiding: (on: boolean) => void;
  gotQuests: (q: Quests, just?: { quest: ParkQuestId; points: number; balance: number }, balance?: number) => void;
  clearCheer: () => void;
}

let nextId = 1;

export const useParkLive = create<ParkLive>((set, get) => ({
  inPark: false,
  away: false,
  arrived: null,
  people: new Map(),
  lines: [],
  refused: null,
  finding: null,
  asked: null,
  partner: null,
  bench: null,
  riding: false,
  quests: null,
  cheer: null,
  balance: null,
  // Leaving forgets everybody -- and ends whatever you were in the middle of, which the
  // server ends too: the next visit starts from what it sends.
  setIn: (on) => set(on ? { inPark: true, away: false, arrived: null } : {
    inPark: false, away: false, arrived: null,
    people: new Map(), lines: [], refused: null, finding: null, asked: null, partner: null, bench: null,
    riding: false, quests: null, cheer: null,
  }),
  setAway: (away) => set({ away }),
  gotArrived: (x, z) => set({ arrived: { x, z, n: (get().arrived?.n ?? 0) + 1 } }),
  gotPeople: (frame) => { if (get().inPark) set({ people: mergePeople(get().people, frame) }); },
  // Timed by the phone's own clock, not the server's: a bubble is how long something
  // stays on THIS screen, and the two clocks need not agree.
  gotLine: (ref, text, _at, priv) => set({
    lines: [...get().lines, { id: nextId++, ref, text, at: Date.now(), ...(priv ? { private: true } : {}) }].slice(-LINES),
  }),
  gotRefused: (reason) => set({ refused: reason }),
  clearRefused: () => set({ refused: null }),
  setFinding: (finding) => set({ finding }),
  gotAsked: (ref, why) => set({ asked: { ref, ...(why ? { why } : {}), at: Date.now() } }),
  gotUnasked: () => set({ asked: null }),
  // The sky drop takes the one who asked: off the bike for it.
  gotPaired: (ref, rideTo) => set({
    partner: { ref, rideTo, asker: rideTo !== null }, finding: null, asked: null, ...(rideTo ? { riding: false } : {}),
  }),
  rode: () => { const p = get().partner; if (p) set({ partner: { ...p, rideTo: null } }); },
  gotParted: () => set({ partner: null, bench: null }),
  // Sitting down gets you off the bike: nobody sits on a bench astride one.
  gotBench: (bench) => set(bench !== null ? { bench, riding: false } : { bench }),
  rejoined: () => set({ partner: null, bench: null, finding: null, asked: null, people: new Map(), arrived: null }),
  // A payment is cheered; one that paid nothing (already done today) is not.
  gotQuests: (quests, just, balance) => set({
    quests,
    ...(just ? { balance: just.balance } : balance !== undefined ? { balance } : {}),
    ...(just && just.points > 0 ? { cheer: { ...just, at: Date.now() } } : {}),
  }),
  clearCheer: () => set({ cheer: null }),
  setRiding: (on) => {
    const s = get();
    if (on && (s.bench !== null || s.partner?.rideTo)) return;
    set({ riding: on });
  },
}));
