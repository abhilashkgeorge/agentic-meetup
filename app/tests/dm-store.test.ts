/**
 * The message list on the phone.
 *
 * These are the rules that decide whether a chat feels solid or haunted, and every one
 * of them is a bug somebody has met in a real app: a message that vanishes because the
 * train went into a tunnel, two copies of the same line after a reconnect, a blue tick
 * that turns back into a grey one, a reply that lands above the message it answers.
 *
 * All pure state, so they run without a phone, a socket or a database.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { useDm } from '../src/store/dm';

const ME = 'me-0000';
const THEM = 'them-0000';
const CONV = 'conv-0000';

const server = (id: string, seq: number, from: string, text: string, over = {}) => ({
  id, rendezvousId: CONV, senderId: from, text,
  sentAt: new Date(1_700_000_000_000 + seq * 1000).toISOString(),
  seq: String(seq), deliveredAt: null, readAt: null, ...over,
});

beforeEach(() => {
  useDm.setState({ conversations: [], threads: {}, typing: {}, meId: ME });
});

describe('a message you typed', () => {
  it('appears before it is sent, and is not lost when it cannot be', () => {
    // The single most infuriating failure in a messaging app: what you typed is gone
    // because the signal went. It stays, greyed, and goes when the socket comes back.
    useDm.getState().queue(CONV, 'm1', 'hello');
    const [m] = useDm.getState().threads[CONV]!;
    expect(m!.text).toBe('hello');
    expect(m!.state).toBe('queued');
    expect(m!.seq).toBeNull();
  });

  it('is still there to retry after the send fails', () => {
    useDm.getState().queue(CONV, 'm1', 'hello');
    useDm.getState().markSending('m1');
    useDm.getState().failed('m1');
    expect(useDm.getState().threads[CONV]![0]!.state).toBe('failed');
    expect(useDm.getState().threads[CONV]).toHaveLength(1);
  });

  it('becomes one real message when the server echoes it back', () => {
    // Same id, so the optimistic bubble is REPLACED rather than joined by a twin.
    // This is what the client-generated id is for.
    useDm.getState().queue(CONV, 'm1', 'hello');
    useDm.getState().received(server('m1', 1, ME, 'hello'));
    const thread = useDm.getState().threads[CONV]!;
    expect(thread).toHaveLength(1);
    expect(thread[0]!.state).toBe('sent');
    expect(thread[0]!.seq).toBe(1);
    expect(thread[0]!.mine).toBe(true);
  });

  it('is not duplicated when the same message arrives twice', () => {
    useDm.getState().received(server('m1', 1, THEM, 'hi'));
    useDm.getState().received(server('m1', 1, THEM, 'hi'));
    expect(useDm.getState().threads[CONV]).toHaveLength(1);
  });
});

describe('order', () => {
  it('follows the server sequence, not the order things arrived', () => {
    // Out-of-order delivery is normal on a reconnect: the server replays what you
    // missed while a live message is already in flight.
    useDm.getState().received(server('m3', 3, THEM, 'third'));
    useDm.getState().received(server('m1', 1, ME, 'first'));
    useDm.getState().received(server('m2', 2, THEM, 'second'));
    expect(useDm.getState().threads[CONV]!.map((m) => m.text))
      .toEqual(['first', 'second', 'third']);
  });

  it('keeps an unsent message at the bottom where it was typed', () => {
    useDm.getState().received(server('m1', 1, THEM, 'hi'));
    useDm.getState().queue(CONV, 'mine', 'typed offline');
    useDm.getState().received(server('m2', 2, THEM, 'you there?'));
    expect(useDm.getState().threads[CONV]!.map((m) => m.text))
      .toEqual(['hi', 'you there?', 'typed offline']);
  });
});

describe('ticks', () => {
  it('go forwards only', () => {
    // A late `delivered` must never turn a read message back into an unread one.
    // Receipts arrive out of order all the time.
    useDm.getState().received(server('m1', 1, ME, 'hello'));
    useDm.getState().receipt(CONV, ['m1'], 'read');
    useDm.getState().receipt(CONV, ['m1'], 'delivered');
    expect(useDm.getState().threads[CONV]![0]!.state).toBe('read');
  });

  it('are taken from the message itself when history loads', () => {
    useDm.getState().received(
      server('m1', 1, ME, 'hello', { deliveredAt: 'x', readAt: 'y' }));
    expect(useDm.getState().threads[CONV]![0]!.state).toBe('read');
  });
});

describe('the inbox line', () => {
  it('updates on a pushed message without refetching', () => {
    useDm.setState({
      conversations: [{
        id: CONV, otherId: THEM, name: 'Someone',
        lastMessage: null, lastAt: null, lastFromMe: false, unread: 0,
      }],
    });
    useDm.getState().received(server('m1', 1, THEM, 'you up?'));
    const [c] = useDm.getState().conversations;
    expect(c!.lastMessage).toBe('you up?');
    expect(c!.unread).toBe(1);
  });

  it('does not count your own message as unread', () => {
    useDm.setState({
      conversations: [{
        id: CONV, otherId: THEM, name: 'Someone',
        lastMessage: null, lastAt: null, lastFromMe: false, unread: 0,
      }],
    });
    useDm.getState().received(server('m1', 1, ME, 'hello'));
    expect(useDm.getState().conversations[0]!.unread).toBe(0);
    expect(useDm.getState().conversations[0]!.lastFromMe).toBe(true);
  });
});

describe('the outbox', () => {
  it('holds everything unsent, oldest first, across conversations', () => {
    useDm.getState().queue(CONV, 'm1', 'one');
    useDm.getState().queue('other-conv', 'm2', 'two');
    useDm.getState().received(server('m1', 1, ME, 'one'));
    const waiting = useDm.getState().outbox();
    expect(waiting.map((m) => m.id)).toEqual(['m2']);
  });

  it('is empty once everything has landed', () => {
    useDm.getState().queue(CONV, 'm1', 'one');
    useDm.getState().received(server('m1', 1, ME, 'one'));
    expect(useDm.getState().outbox()).toHaveLength(0);
  });
});

describe('older messages', () => {
  it('load in front without duplicating what is already there', () => {
    useDm.getState().setThread(CONV, [
      { id: 'm5', rendezvousId: CONV, text: 'newer', mine: false, seq: 5, sentAt: null, state: 'sent' },
    ]);
    useDm.getState().prepend(CONV, [
      { id: 'm4', rendezvousId: CONV, text: 'older', mine: false, seq: 4, sentAt: null, state: 'sent' },
      { id: 'm5', rendezvousId: CONV, text: 'newer', mine: false, seq: 5, sentAt: null, state: 'sent' },
    ]);
    expect(useDm.getState().threads[CONV]!.map((m) => m.text)).toEqual(['older', 'newer']);
  });
});
