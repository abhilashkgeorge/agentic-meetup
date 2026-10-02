/**
 * A ceiling on how often one caller may knock.
 *
 * WHY IT EXISTS, AND WHY THE BUDGET CAP IS NOT ENOUGH. Every expensive path already
 * refuses to spend past a per-user daily cap. That cap is per USER, which is exactly
 * the wrong shape for the attack it has to survive: a script that creates a thousand
 * accounts gets a thousand caps. Device signup is unauthenticated by design -- an app
 * on a new phone provisions itself -- so the account-creation route is the one place
 * where "who is this" has no answer yet, and it is the route that manufactures new
 * budgets. It has to be limited by something other than identity.
 *
 * A FIXED WINDOW, not a token bucket. The bucket is the better algorithm and the
 * difference does not matter at the volumes this will see for a year: what matters is
 * that the thing exists at all and is easy to reason about when it fires. Rounder
 * numbers, plainer failure.
 *
 * IN MEMORY, and therefore PER PROCESS. This is honest for a single-replica server
 * and dishonest the moment there are two -- an attacker then gets one allowance per
 * replica. The WebSocket hub is already single-process for the same reason, so the
 * whole server moves to a shared store at once, and this note is where that decision
 * is recorded rather than discovered.
 *
 * NOT A SECURITY BOUNDARY BY ITSELF. An IP is shared by everybody behind one carrier
 * NAT and changed by anybody with a phone in aeroplane mode. It raises the cost of a
 * loop from nothing to something, which is the whole claim.
 */
import type { Context, Next } from 'hono';
import { isIP } from 'node:net';
import { env } from './env.js';
import { log } from './log.js';

interface Window {
  /** When this window opened, in epoch ms. */
  since: number;
  hits: number;
  /**
   * How long this key's window lasts.
   *
   * Carried per entry because the sweeper below used a flat ten minutes for
   * everything, and a limit with a longer window than that had its counter deleted
   * out from under it -- silently turning one limit into several. The OTP limits are
   * fifteen minutes and the hourly ones are sixty, so the flat sweep gave an attacker
   * six hourly budgets per hour.
   */
  windowMs: number;
}

const windows = new Map<string, Window>();

/**
 * Dropped periodically rather than on a timer per key: a key is a string and a
 * timer is an object, and at a thousand distinct callers the difference is the
 * whole memory profile. Unref'd, so it never holds the process open.
 */
/**
 * A hard ceiling on how many distinct callers are tracked.
 *
 * Every key is attacker-influenced, so without this the map is an unbounded
 * allocation driven by whoever is attacking. When it is hit the OLDEST windows go
 * first, which is the right way round: the entry about to expire anyway is the one
 * worth least, and shedding the newest would let a flood push itself out of its own
 * counter.
 */
const MAX_KEYS = 50_000;

const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, w] of windows) {
    if (now - w.since > w.windowMs) windows.delete(key);
  }
  if (windows.size > MAX_KEYS) {
    const oldest = [...windows.entries()].sort((a, b) => a[1].since - b[1].since);
    for (const [key] of oldest.slice(0, windows.size - MAX_KEYS)) windows.delete(key);
    log.warn({ size: windows.size }, 'rate limiter shed keys');
  }
}, 60_000);
sweeper.unref();

export interface Limit {
  /** How many requests are allowed in one window. */
  max: number;
  /** How long a window lasts, in milliseconds. */
  windowMs: number;
}

/** Exported so a test can start from a clean slate rather than from its neighbours. */
export function resetLimits(): void {
  windows.clear();
}

/**
 * Whether this caller may proceed, and what to tell them if not.
 *
 * Separate from the middleware so the WebSocket upgrade -- which is not a Hono
 * request and cannot run Hono middleware -- uses the same counter and the same
 * numbers as everything else.
 */
export function take(key: string, limit: Limit): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const w = windows.get(key);

  if (!w || now - w.since >= limit.windowMs) {
    windows.set(key, { since: now, hits: 1, windowMs: limit.windowMs });
    return { ok: true, retryAfterSec: 0 };
  }

  w.hits += 1;
  if (w.hits > limit.max) {
    return { ok: false, retryAfterSec: Math.ceil((limit.windowMs - (now - w.since)) / 1000) };
  }
  return { ok: true, retryAfterSec: 0 };
}

/**
 * The caller's address, as well as it can be known.
 *
 * THE OLD VERSION TOOK THE FIRST `x-forwarded-for` ENTRY UNCONDITIONALLY, and its own
 * comment said that was fine because a proxy would be added later. It was not fine,
 * because the header is set by the CLIENT when there is no proxy stripping it: a
 * different value on every request gives a fresh counter every request, so every
 * per-IP limit in the system was decoration. That includes the one standing between a
 * script and our SMS bill.
 *
 * It is now trusted only when `TRUSTED_PROXY_HOPS` says how many proxies are in front
 * of this server, and then only the entry that many hops from the right -- the
 * left-most entry is the one the client wrote, and taking it is the classic version
 * of this mistake. Unset means no proxy, so the header is ignored entirely and the
 * socket's own peer address is used.
 *
 * The value is validated as an IP and otherwise discarded. It is a Map key and a
 * database column, so an attacker who can put an arbitrary string here can grow both
 * without limit.
 */
// A `Headers` (what Hono hands over) or a plain object (what Node's http gives, and
// what the tests pass). The union is spelled out because `Headers` has no index
// signature, so the object shape alone silently rejected the real caller.
export function callerIp(
  headers: Headers | Record<string, unknown>,
  /** The socket's own peer address, when the caller can supply it. Never forgeable. */
  peer?: string,
): string {
  const read = (k: string): string | undefined => {
    const get = (headers as { get?: (k: string) => string | null | undefined }).get;
    if (typeof get === 'function') return get.call(headers, k) ?? undefined;
    const v = (headers as Record<string, unknown>)[k];
    return typeof v === 'string' ? v : Array.isArray(v) ? String(v[0]) : undefined;
  };

  const hops = env.TRUSTED_PROXY_HOPS;
  if (hops > 0) {
    const chain = (read('x-forwarded-for') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    // Counting from the RIGHT. Each trusted proxy appends the address it saw, so the
    // right-most entries are the ones our own infrastructure wrote and the left-most
    // is whatever the client sent. `hops` of 1 means the last entry, and so on.
    const candidate = chain[chain.length - hops];
    if (candidate && isIP(candidate)) return candidate;
  }

  if (peer && isIP(peer)) return peer;
  return 'unknown';
}

/** Hono middleware form. `name` keeps separate routes on separate counters. */
export function rateLimit(name: string, limit: Limit) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    // The socket address under @hono/node-server, which no client can set.
    const peer = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)
      ?.incoming?.socket?.remoteAddress;
    const ip = callerIp(c.req.raw.headers, peer);
    const { ok, retryAfterSec } = take(`${name}:${ip}`, limit);
    if (!ok) {
      log.warn({ name, ip }, 'rate limited');
      return c.json(
        { error: 'too_many_requests', message: 'Too many tries. Wait a moment.' },
        429,
        { 'Retry-After': String(retryAfterSec) },
      );
    }
    await next();
  };
}

/**
 * The numbers, in one place so they can be argued about in one place.
 *
 * Generous for a person and useless for a loop, which is the only property that
 * matters. A human redeeming an invite types it once and maybe mistypes it twice.
 */
export const LIMITS = {
  /** Account creation. The route that manufactures new daily budgets. */
  signup: { max: 5, windowMs: 60 * 60_000 },
  /** Invite redemption -- also the guess-a-code route. */
  redeem: { max: 10, windowMs: 60 * 60_000 },
  /** Everything else unauthenticated. */
  auth: { max: 30, windowMs: 60 * 60_000 },
  /**
   * Asking for a one-time code, counted per IP.
   *
   * Every one of these costs real money the moment a provider is wired up, so this
   * limit is a spend cap as much as a security control. Paired with a tighter
   * per-NUMBER limit at the route, because one IP is a whole office and one number
   * is one person.
   */
  otpSend: { max: 10, windowMs: 15 * 60_000 },
  /** Asking for a code for ONE number. A person who did not get it tries twice. */
  otpSendPerPhone: { max: 3, windowMs: 15 * 60_000 },
  /**
   * Typing a code in. Low, because six digits is a million guesses and the per-row
   * attempt counter only stops a brute force against ONE challenge -- this is what
   * stops somebody opening a thousand challenges and guessing once at each.
   */
  otpVerify: { max: 20, windowMs: 15 * 60_000 },
  /** WebSocket upgrades. A reconnect loop is the honest failure this catches. */
  socket: { max: 60, windowMs: 5 * 60_000 },
  /** Messages pushed down one socket. */
  message: { max: 60, windowMs: 60_000 },
  /**
   * "Is typing", counted apart from the above so it can never use up a real message's
   * allowance (api/chat.ts). The app says it when typing starts and stops; an older app
   * said it on every keystroke, and this is two keystrokes a second of that.
   */
  typing: { max: 120, windowMs: 60_000 },
} as const;
