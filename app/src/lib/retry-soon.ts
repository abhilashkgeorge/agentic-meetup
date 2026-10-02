/**
 * Run something again a little later, backing off, and only once at a time.
 *
 * For the message outbox (lib/socket.ts): when the server says "Slow down a moment"
 * (rate_limited), the message it refused stays "sending" -- and the only thing that sent
 * the outbox again was a reconnect, which a working connection never does. So a refused
 * message sat on "sending" for good (the Pixel, 2026-10-02). Now the outbox goes again in
 * two seconds, then four, eight..., and the count starts over once a message gets through.
 * Sending again is safe: every message carries the id the phone made, and the server
 * stores each id once.
 */
export const RETRY_FIRST_MS = 2_000;
export const RETRY_MAX_MS = 30_000;

export const retryDelay = (attempt: number): number => Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * 2 ** attempt);

export function retrySoon(run: () => void): { soon: () => void; reset: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  return {
    soon() {
      if (timer) return;
      timer = setTimeout(() => { timer = null; run(); }, retryDelay(attempt++));
    },
    reset() { attempt = 0; },
  };
}
