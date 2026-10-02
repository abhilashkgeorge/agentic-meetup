import type { Look } from '@clone/shared';
/**
 * Conversations with people, on the phone.
 *
 * THE STATES A MESSAGE GOES THROUGH, and why each exists:
 *
 *   queued    typed while the socket was down. On screen, greyed, never lost.
 *   sending   handed to the socket, no answer yet.
 *   sent      the server wrote it and told us its sequence number.
 *   delivered their phone has it.
 *   read      they opened the conversation.
 *   failed    refused. Shown on the message, never as an alert.
 *
 * Collapsing queued and sending is what produces the bug where a message typed in a
 * tunnel vanishes: the UI thinks it was sent, nothing ever confirms it, and there is
 * no record left to retry.
 *
 * ORDER COMES FROM THE SERVER, not from arrival. Each message carries a per-
 * conversation sequence number, and anything still waiting for one sorts last -- so
 * your own unsent message sits at the bottom where you left it, and slots into place
 * when it lands.
 */
import { create } from 'zustand';

/** How long "typing..." stays up without being said again. Longer than TYPING_RENEW_MS. */
export const TYPING_SHOWN_MS = 7_000;
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

export type DmState = 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface Dm {
  id: string;
  rendezvousId: string;
  text: string;
  mine: boolean;
  /** Null until the server has written it. Null sorts last. */
  seq: number | null;
  sentAt: string | null;
  state: DmState;
}

export interface Conversation {
  id: string;
  otherId: string;
  name: string;
  photoId?: string | null;
  look?: Look | null;
  lastMessage: string | null;
  lastAt: string | null;
  lastFromMe: boolean;
  unread: number;
  /** Quiet for two days since the match: the list says so, once (server 0068). */
  quiet?: boolean;
}

interface DmStore {
  conversations: Conversation[];
  /** Keyed by rendezvous id. One conversation's messages, oldest first. */
  threads: Record<string, Dm[]>;
  typing: Record<string, boolean>;

  setConversations: (c: Conversation[]) => void;
  setThread: (id: string, messages: Dm[]) => void;
  prepend: (id: string, messages: Dm[]) => void;

  queue: (rendezvousId: string, messageId: string, text: string) => void;
  markSending: (messageId: string) => void;
  failed: (messageId: string) => void;
  received: (m: {
    id: string; rendezvousId: string; senderId: string; text: string;
    sentAt: string; seq: string; deliveredAt: string | null; readAt: string | null;
  }) => void;
  receipt: (rendezvousId: string, ids: string[], state: 'delivered' | 'read') => void;
  setTyping: (rendezvousId: string, typing: boolean) => void;
  clearUnread: (rendezvousId: string) => void;
  outbox: () => Dm[];
  meId: string | null;
  setMe: (id: string) => void;
}

const bySeq = (a: Dm, b: Dm): number => {
  if (a.seq === null && b.seq === null) return 0;
  if (a.seq === null) return 1;   // still unsent: keep it at the bottom
  if (b.seq === null) return -1;
  return a.seq - b.seq;
};

/** Receipts only ever move forward. A late `delivered` must not undo a `read`. */
const RANK: Record<DmState, number> = {
  failed: -1, queued: 0, sending: 1, sent: 2, delivered: 3, read: 4,
};

export const useDm = create<DmStore>((set, get) => ({
  conversations: [],
  threads: {},
  typing: {},
  meId: null,

  setMe: (meId) => set({ meId }),
  setConversations: (conversations) => set({ conversations }),
  setThread: (id, messages) =>
    set((s) => ({ threads: { ...s.threads, [id]: [...messages].sort(bySeq) } })),

  prepend: (id, messages) =>
    set((s) => {
      const have = new Set((s.threads[id] ?? []).map((m) => m.id));
      const older = messages.filter((m) => !have.has(m.id));
      return { threads: { ...s.threads, [id]: [...older, ...(s.threads[id] ?? [])].sort(bySeq) } };
    }),

  queue: (rendezvousId, messageId, text) =>
    set((s) => ({
      threads: {
        ...s.threads,
        [rendezvousId]: [
          ...(s.threads[rendezvousId] ?? []),
          {
            id: messageId, rendezvousId, text, mine: true,
            seq: null, sentAt: null, state: 'queued',
          },
        ],
      },
    })),

  markSending: (messageId) =>
    set((s) => ({ threads: mapMessage(s.threads, messageId, (m) =>
      m.state === 'queued' ? { ...m, state: 'sending' } : m) })),

  failed: (messageId) =>
    set((s) => ({ threads: mapMessage(s.threads, messageId, (m) => ({ ...m, state: 'failed' })) })),

  /**
   * A message from the server. This is also the echo of your OWN send, which is how
   * a queued message becomes a real one: same id, now with a sequence number.
   */
  received: (m) =>
    set((s) => {
      const mine = m.senderId === s.meId;
      const existing = s.threads[m.rendezvousId] ?? [];
      const next: Dm = {
        id: m.id,
        rendezvousId: m.rendezvousId,
        text: m.text,
        mine,
        seq: Number(m.seq),
        sentAt: m.sentAt,
        state: m.readAt ? 'read' : m.deliveredAt ? 'delivered' : 'sent',
      };
      const merged = existing.some((x) => x.id === m.id)
        ? existing.map((x) => (x.id === m.id ? { ...next, state: best(x.state, next.state) } : x))
        : [...existing, next];

      // The inbox line, updated without a refetch. A list that only changes when you
      // pull to refresh is how a chat app feels dead.
      const conversations = s.conversations.map((c) =>
        c.id === m.rendezvousId
          ? {
              ...c,
              lastMessage: m.text,
              lastAt: m.sentAt,
              lastFromMe: mine,
              unread: mine ? c.unread : c.unread + 1,
            }
          : c,
      );

      return { threads: { ...s.threads, [m.rendezvousId]: merged.sort(bySeq) }, conversations };
    }),

  receipt: (rendezvousId, ids, state) =>
    set((s) => {
      const want = new Set(ids);
      const thread = (s.threads[rendezvousId] ?? []).map((m) =>
        want.has(m.id) ? { ...m, state: best(m.state, state) } : m);
      return { threads: { ...s.threads, [rendezvousId]: thread } };
    }),

  setTyping: (rendezvousId, typing) => {
    // "typing..." GOES BY ITSELF, unless it is said again (features/dm/typing-signal.ts
    // says it every TYPING_RENEW_MS while typing goes on). It used to stay until a "stopped"
    // came, and one that never came -- refused by the server, or a phone closed mid-word --
    // left it up for good (the Seeker, 2026-10-02).
    const had = typingTimers.get(rendezvousId);
    if (had) clearTimeout(had);
    typingTimers.delete(rendezvousId);
    if (typing) {
      typingTimers.set(rendezvousId, setTimeout(() => {
        typingTimers.delete(rendezvousId);
        set((s) => ({ typing: { ...s.typing, [rendezvousId]: false } }));
      }, TYPING_SHOWN_MS));
    }
    set((s) => ({ typing: { ...s.typing, [rendezvousId]: typing } }));
  },

  clearUnread: (rendezvousId) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === rendezvousId ? { ...c, unread: 0 } : c),
    })),

  outbox: () =>
    Object.values(get().threads)
      .flat()
      .filter((m) => m.state === 'queued' || m.state === 'sending')
      .sort((a, b) => (a.sentAt ?? '').localeCompare(b.sentAt ?? '')),
}));

const best = (a: DmState, b: DmState): DmState => (RANK[b] > RANK[a] ? b : a);

function mapMessage(
  threads: Record<string, Dm[]>,
  id: string,
  fn: (m: Dm) => Dm,
): Record<string, Dm[]> {
  const out: Record<string, Dm[]> = {};
  for (const [k, v] of Object.entries(threads)) {
    out[k] = v.map((m) => (m.id === id ? fn(m) : m));
  }
  return out;
}
