/**
 * A failed chat turn says why, and never blanks the reply before it (the founder,
 * 2026-09-29: "when chat hits the limit, say so clearly").
 *
 * WHAT WAS WRONG, found reading the socket: on any error the app "finished" lastSeenTurn
 * -- the last turn ALREADY answered -- with empty text, so the clone's previous reply
 * vanished from the screen, and the turn that failed just sat there with no answer and no
 * reason. The day's limit was the commonest way to get there.
 *
 * WHAT IS PINNED: the waiting turn's empty reply goes and a line says why -- the server's
 * own words for the day's limit, a plain retry for anything else; the reply before it is
 * untouched; the socket ends the turn it sent, not the last one answered.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - failTurn dropping every empty-or-not clone reply of the turn -> "untouched" fails;
 *   - the socket's old finishClone(lastSeenTurn, '')              -> "ends the turn it sent" fails;
 *   - a round's budget error back to "been out enough for today"  -> "the shared limit" fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({ randomUUID: () => `id-${Math.random()}` }));
const { useSession } = await import('../src/store/session');
const { SHARED_LIMIT, TURN_FAILED, noteFor } = await import('../src/features/chat/turn-note');

const LIMIT = "That's all for today. Chat, learning and your agent's rounds share 10 turns a day, and today's are used up. Your clone can talk again tomorrow.";

describe('a chat turn that fails', () => {
  it('says the day\'s limit in the server\'s words, and anything else as a retry', () => {
    expect(noteFor('budget_exceeded', LIMIT)).toBe(LIMIT);
    expect(noteFor('internal', 'stream reset')).toBe(TURN_FAILED);
    expect(TURN_FAILED).toBe("That didn't go through. Try again.");
  });

  it('ends the waiting turn with a line saying why, and leaves the reply before it untouched', () => {
    const s = useSession.getState();
    s.addUser('t1', 'hi');
    s.startClone('t1');
    s.finishClone('t1', 'Hello! What are you cooking?');
    s.addUser('t2', 'dal, again');
    s.startClone('t2');
    useSession.getState().failTurn('t2', LIMIT);

    expect(useSession.getState().bubbles.map((b) => [b.role, b.turnId, b.text])).toEqual([
      ['user', 't1', 'hi'],
      ['clone', 't1', 'Hello! What are you cooking?'],
      ['user', 't2', 'dal, again'],
      ['note', 't2', LIMIT],
    ]);
  });

  it('says the shared limit when a round meets it too, not "been out enough"', () => {
    const world = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'world', 'world-screen.tsx'), 'utf8');
    expect(world).toMatch(/budget_exceeded: SHARED_LIMIT,/);
    expect(world).toMatch(/r\.error === 'budget_exceeded' \? SHARED_LIMIT/);
    expect(SHARED_LIMIT).toMatch(/share one daily allowance/);
  });

  it('is ended by the socket for the turn it sent, never the last one answered', () => {
    const src = readFileSync(join(import.meta.dirname, '..', 'src', 'lib', 'socket.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    expect(src).not.toMatch(/finishClone\(lastSeenTurn/);
    expect(src).toMatch(/s\.failTurn\(pendingTurn, noteFor\(ev\.code, ev\.message\)\)/);
    expect(src).toMatch(/pendingTurn = turnId;\s*push\(\{ type: 'turn'/);
  });
});
