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
}

export interface Line {
  id: number;
  /** The speaker's ref, or `you`. */
  ref: string;
  text: string;
  at: number;
}

/** How long something said stays over the speaker's head. */
export const BUBBLE_MS = 6500;
/** How many lines the chat keeps. */
export const LINES = 30;

export type Refusal = 'contact' | 'too_fast' | 'not_in_park';
export const REFUSAL_TEXT: Record<Refusal, string> = {
  contact: 'Not sent: numbers, handles and links are swapped after you both say yes.',
  too_fast: 'Not sent: slow down a little.',
  not_in_park: 'Not sent: you are not in the park.',
};

/** This frame's people, their looks carried over from the last. Nobody without a look yet. */
export function mergePeople(prev: ReadonlyMap<string, LivePerson>, frame: readonly ParkPerson[]): Map<string, LivePerson> {
  const out = new Map<string, LivePerson>();
  for (const p of frame) {
    const look = p.look ?? prev.get(p.ref)?.look;
    if (!look) continue;
    out.set(p.ref, { ref: p.ref, x: p.x, z: p.z, facing: p.facing, moving: p.moving, look });
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
  setIn: (on: boolean) => void;
  gotPeople: (frame: readonly ParkPerson[]) => void;
  gotLine: (ref: string, text: string, at: number) => void;
  gotRefused: (reason: Refusal) => void;
  clearRefused: () => void;
}

let nextId = 1;

export const useParkLive = create<ParkLive>((set, get) => ({
  inPark: false,
  people: new Map(),
  lines: [],
  refused: null,
  // Leaving forgets everybody: the next visit starts from what the server sends.
  setIn: (on) => set(on ? { inPark: true } : { inPark: false, people: new Map(), lines: [], refused: null }),
  gotPeople: (frame) => { if (get().inPark) set({ people: mergePeople(get().people, frame) }); },
  // Timed by the phone's own clock, not the server's: a bubble is how long something
  // stays on THIS screen, and the two clocks need not agree.
  gotLine: (ref, text) => set({ lines: [...get().lines, { id: nextId++, ref, text, at: Date.now() }].slice(-LINES) }),
  gotRefused: (reason) => set({ refused: reason }),
  clearRefused: () => set({ refused: null }),
}));
