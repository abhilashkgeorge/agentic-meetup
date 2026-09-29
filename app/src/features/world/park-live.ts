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
import type { Look, ParkPerson } from '@clone/shared';

export interface LivePerson {
  ref: string;
  x: number;
  z: number;
  facing: number;
  moving: boolean;
  look: Look;
  sitting: boolean;
  riding: boolean;
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

/** This frame's people, their looks carried over from the last. Nobody without a look yet. */
export function mergePeople(prev: ReadonlyMap<string, LivePerson>, frame: readonly ParkPerson[]): Map<string, LivePerson> {
  const out = new Map<string, LivePerson>();
  for (const p of frame) {
    const look = p.look ?? prev.get(p.ref)?.look;
    if (!look) continue;
    out.set(p.ref, { ref: p.ref, x: p.x, z: p.z, facing: p.facing, moving: p.moving, look, sitting: p.sitting === true, riding: p.riding === true });
  }
  return out;
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
  people: ReadonlyMap<string, LivePerson>;
  lines: readonly Line[];
  refused: Refusal | null;
  /** Your "Find someone": where it is, and who and what you share once asking. */
  finding: { status: FindStatus; ref?: string; why?: string } | null;
  /** Somebody asking you: who, what you share, and when they asked. */
  asked: { ref: string; why?: string; at: number } | null;
  /**
   * Who you are talking with: `rideTo` is where to be taken (beside them) when you were
   * the one who asked -- the car -- and null when they are coming to you.
   */
  partner: { ref: string; rideTo: readonly [number, number] | null; asker: boolean } | null;
  /** The bench the two of you took, while you sit on it. */
  bench: number | null;
  /** On a bicycle (bike.ts): faster, and seen on one by everybody near. */
  riding: boolean;
  setIn: (on: boolean) => void;
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
}

let nextId = 1;

export const useParkLive = create<ParkLive>((set, get) => ({
  inPark: false,
  people: new Map(),
  lines: [],
  refused: null,
  finding: null,
  asked: null,
  partner: null,
  bench: null,
  riding: false,
  // Leaving forgets everybody -- and ends whatever you were in the middle of, which the
  // server ends too: the next visit starts from what it sends.
  setIn: (on) => set(on ? { inPark: true } : {
    inPark: false, people: new Map(), lines: [], refused: null, finding: null, asked: null, partner: null, bench: null,
    riding: false,
  }),
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
  // The car takes the one who asked: off the bike for it.
  gotPaired: (ref, rideTo) => set({
    partner: { ref, rideTo, asker: rideTo !== null }, finding: null, asked: null, ...(rideTo ? { riding: false } : {}),
  }),
  rode: () => { const p = get().partner; if (p) set({ partner: { ...p, rideTo: null } }); },
  gotParted: () => set({ partner: null, bench: null }),
  // Sitting down gets you off the bike: nobody sits on a bench astride one.
  gotBench: (bench) => set(bench !== null ? { bench, riding: false } : { bench }),
  rejoined: () => set({ partner: null, bench: null, finding: null, asked: null, people: new Map() }),
  setRiding: (on) => {
    const s = get();
    if (on && (s.bench !== null || s.partner?.rideTo)) return;
    set({ riding: on });
  },
}));
