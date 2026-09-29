import { create } from 'zustand';
import * as Crypto from 'expo-crypto';

export interface Bubble {
  turnId: string;
  /** 'note': a line from the app itself -- why a turn failed -- never the clone's words. */
  role: 'user' | 'clone' | 'note';
  text: string;
  /** Streaming in. The clone bubble grows as deltas arrive. */
  pending: boolean;
}

interface SessionState {
  token: string | null;
  /** One conversation session. Session END is what triggers fact extraction
   *  server-side, so this is not cosmetic -- it decides what gets learned together. */
  sessionId: string;
  bubbles: Bubble[];
  connected: boolean;
  /** The clone's own clarifying question, surfaced from the conflicts queue. */
  question: { conflictId: string; text: string } | null;

  setToken: (t: string | null) => void;
  setConnected: (c: boolean) => void;
  newSession: () => void;
  addUser: (turnId: string, text: string) => void;
  startClone: (turnId: string) => void;
  appendClone: (turnId: string, delta: string) => void;
  finishClone: (turnId: string, text: string) => void;
  /**
   * The waiting turn failed: its empty reply goes, and `note` says why. Never touches
   * another turn's reply.
   */
  failTurn: (turnId: string | null, note: string) => void;
  setQuestion: (q: SessionState['question']) => void;
}

export const useSession = create<SessionState>((set) => ({
  token: null,
  sessionId: Crypto.randomUUID(),
  bubbles: [],
  connected: false,
  question: null,

  setToken: (token) => set({ token }),
  setConnected: (connected) => set({ connected }),
  newSession: () => set({ sessionId: Crypto.randomUUID(), bubbles: [], question: null }),

  addUser: (turnId, text) =>
    set((s) => ({ bubbles: [...s.bubbles, { turnId, role: 'user', text, pending: false }] })),

  // The clone's reply is keyed by the SAME turnId as the user's message, so a
  // reconnect that replays the turn updates the existing bubble instead of
  // appending a duplicate.
  startClone: (turnId) =>
    set((s) =>
      s.bubbles.some((b) => b.role === 'clone' && b.turnId === turnId)
        ? s
        : { bubbles: [...s.bubbles, { turnId, role: 'clone', text: '', pending: true }] },
    ),

  appendClone: (turnId, delta) =>
    set((s) => ({
      bubbles: s.bubbles.map((b) =>
        b.role === 'clone' && b.turnId === turnId ? { ...b, text: b.text + delta } : b,
      ),
    })),

  finishClone: (turnId, text) =>
    set((s) => ({
      bubbles: s.bubbles.map((b) =>
        b.role === 'clone' && b.turnId === turnId ? { ...b, text, pending: false } : b,
      ),
    })),

  failTurn: (turnId, note) =>
    set((s) => ({
      bubbles: [
        ...s.bubbles.filter((b) => !(b.role === 'clone' && b.turnId === turnId && !b.text)),
        { turnId: turnId ?? Crypto.randomUUID(), role: 'note', text: note, pending: false },
      ],
    })),

  setQuestion: (question) => set({ question }),
}));
