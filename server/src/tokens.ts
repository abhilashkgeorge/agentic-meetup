/**
 * Bearer tokens: `<sessionId>.<hmac>`.
 *
 * The signature is not there to carry claims -- the database is still consulted on
 * every request, so a revoked session dies immediately rather than at expiry. It is
 * there so that a forged or truncated token is rejected in microseconds without a
 * query, which is what stops an unauthenticated flood from becoming a database
 * flood.
 *
 * Deliberately not a JWT. A JWT here would mean carrying an algorithm field an
 * attacker can set to "none", a library that has had that CVE more than once, and a
 * claims model we do not use. This is one HMAC over one uuid.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { env } from './env.js';

const sign = (sessionId: string): string =>
  createHmac('sha256', env.AUTH_SECRET).update(sessionId).digest('base64url');

export function mintToken(sessionId: string): string {
  return `${sessionId}.${sign(sessionId)}`;
}

/** The session id if the signature holds, else null. No exceptions on a bad token:
 *  an unauthenticated caller controls this input entirely. */
export function verifyToken(token: string): string | null {
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const sessionId = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return null;

  const expected = Buffer.from(sign(sessionId));
  const given = Buffer.from(mac);
  // Length must match before timingSafeEqual, which throws on a length mismatch --
  // and a thrown error is itself a timing signal.
  if (expected.length !== given.length) return null;
  return timingSafeEqual(expected, given) ? sessionId : null;
}

/**
 * Invite codes are typed by humans and read aloud over the phone, so the alphabet
 * excludes every pair that looks alike in a sans-serif font: 0/O, 1/I/L, 5/S, 2/Z,
 * 8/B. What is left is unambiguous spoken and printed.
 */
const ALPHABET = 'ACDEFGHJKMNPQRTUVWXY34679';

export function mintInviteCode(): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  const raw = Array.from(b, (n) => ALPHABET[n % ALPHABET.length]).join('');
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/** Accepts what a person actually types: lowercase, spaces, missing dash. */
export function normaliseInviteCode(input: string): string {
  const bare = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return bare.length === 8 ? `${bare.slice(0, 4)}-${bare.slice(4)}` : bare;
}

export const newSessionId = randomUUID;
