/**
 * A long first message gets sent (the Pixel, 2026-10-02, release app): "is typing" went
 * out on every keystroke, the server's sixty frames a minute ran out mid-message, the
 * message was refused with "Slow down a moment", and it sat on "sending" for good --
 * nothing sends the outbox again but a reconnect. Server side: tests/typing-limit.test.ts.
 *
 * WHAT IS PINNED. "Is typing" is said when it starts and stops, not per keystroke
 * (typingSignal); a refused message is sent again soon, backing off, starting over once
 * one gets through (retrySoon); and the chat screen and the socket use them -- read from
 * the source, comments stripped, because the socket module opens a real WebSocket.
 *
 * And found the same evening on the Seeker: "typing..." stayed up for good when the
 * "stopped" never came (the store never let it go).
 *
 * Negative controls, run by hand and recorded in the commit: thread-screen.tsx back on
 * sendTyping per keystroke -> "the chat screen" fails; socket.ts without the retry ->
 * "the socket" fails; dm.ts setTyping without the timer -> "goes by itself" fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TYPING_RENEW_MS, typingSignal } from '../src/features/dm/typing-signal';
import { TYPING_SHOWN_MS, useDm } from '../src/store/dm';
import { RETRY_FIRST_MS, RETRY_MAX_MS, retryDelay, retrySoon } from '../src/lib/retry-soon';

const src = (...p: string[]) => stripComments(readFileSync(join(import.meta.dirname, '..', 'src', ...p), 'utf8'));

afterEach(() => { vi.useRealTimers(); });

describe('"is typing"', () => {
  it('is said when typing starts, again every few seconds while it goes on, and when it stops', () => {
    let clock = 0;
    const sent: boolean[] = [];
    const say = typingSignal((t) => sent.push(t), () => clock);
    for (let i = 0; i < 74; i++) { say(true); clock += 50; }   // 74 keystrokes in 3.7 s
    expect(sent, 'one frame for a burst of keystrokes').toEqual([true]);
    clock = TYPING_RENEW_MS;
    say(true);
    expect(sent, 'said again while typing goes on').toEqual([true, true]);
    say(false);
    say(false);
    expect(sent).toEqual([true, true, false]);
  });

  it('goes by itself on the other phone unless it is said again, and a stop clears it at once', () => {
    vi.useFakeTimers();
    const d = useDm.getState();
    d.setTyping('r1', true);
    expect(useDm.getState().typing.r1).toBe(true);
    vi.advanceTimersByTime(TYPING_SHOWN_MS - 1);
    expect(useDm.getState().typing.r1).toBe(true);
    vi.advanceTimersByTime(1);
    expect(useDm.getState().typing.r1, 'a "stopped" that never came left it up for good').toBe(false);

    d.setTyping('r2', true);
    vi.advanceTimersByTime(TYPING_RENEW_MS);
    d.setTyping('r2', true);
    vi.advanceTimersByTime(TYPING_SHOWN_MS - 1);
    expect(useDm.getState().typing.r2, 'said again, it stays').toBe(true);
    d.setTyping('r2', false);
    expect(useDm.getState().typing.r2).toBe(false);
    expect(TYPING_SHOWN_MS).toBeGreaterThan(TYPING_RENEW_MS);
  });
});

describe('a refused message', () => {
  it('is sent again soon, backing off, and only once at a time', () => {
    vi.useFakeTimers();
    let runs = 0;
    const again = retrySoon(() => { runs++; });
    again.soon();
    again.soon();
    vi.advanceTimersByTime(RETRY_FIRST_MS - 1);
    expect(runs).toBe(0);
    vi.advanceTimersByTime(1);
    expect(runs).toBe(1);
    again.soon();
    vi.advanceTimersByTime(RETRY_FIRST_MS);
    expect(runs, 'the second wait backs off').toBe(1);
    vi.advanceTimersByTime(RETRY_FIRST_MS);
    expect(runs).toBe(2);
    again.reset();
    again.soon();
    vi.advanceTimersByTime(RETRY_FIRST_MS);
    expect(runs, 'once one gets through, the wait starts over').toBe(3);
    expect(retryDelay(20)).toBe(RETRY_MAX_MS);
  });
});

describe('the wiring', () => {
  it('the chat screen says typing through the signal, never per keystroke', () => {
    const screen = src('features', 'dm', 'thread-screen.tsx');
    const onType = screen.slice(screen.indexOf('const onType'), screen.indexOf('const submit'));
    const submit = screen.slice(screen.indexOf('const submit'), screen.indexOf('const submit') + 300);
    expect(screen).toContain('typingSignal((t) => sendTyping(rendezvousId, t))');
    expect(onType).not.toContain('sendTyping(');
    expect(submit).not.toContain('sendTyping(');
  });

  it('the socket sends the outbox again after "Slow down a moment", and starts over on a message', () => {
    const socket = src('lib', 'socket.ts');
    expect(socket).toContain('const outboxAgain = retrySoon(() => flushOutbox());');
    expect(socket).toContain("if (ev.code === 'rate_limited') outboxAgain.soon();");
    expect(socket).toMatch(/case 'dm\.message':\s*d\.received\(ev\.message\);\s*outboxAgain\.reset\(\);/);
  });
});

function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + ' '.repeat(m.length - p1.length));
}
