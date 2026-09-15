/**
 * The one-way half of phone identity.
 *
 * Two hashes live here and they are not interchangeable:
 *
 *   phoneHmac(number)  a LOOKUP key. Deterministic, so the same number always finds
 *                      the same account and a removed person is still recognisable.
 *   codeHmac(id, code) a SECRET check. Bound to one challenge id, so a code stolen
 *                      from one row cannot be replayed into another.
 *
 * Both are HMAC rather than a bare hash, and the difference matters more than it
 * looks. A phone number has about ten digits of entropy inside a known country code.
 * A plain SHA-256 of every Indian mobile number is a weekend on one GPU, so a stolen
 * `phone_hmac` column with no secret in it IS the phone book. The pepper is what
 * makes the column worthless on its own, which is the entire security argument for
 * not storing the number.
 *
 * Deliberately not bcrypt/scrypt/argon2 on the number. A slow hash is the right
 * answer for passwords, where the attacker is offline and the user waits once. Here
 * the value is looked up on every sign-in and the keyspace is small enough that no
 * practical work factor saves it -- the secret does the work, not the slowness. The
 * code hash is a different case only in that the code dies in five minutes.
 */
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { OTP_LENGTH } from '@clone/shared';
import { env } from './env.js';

/**
 * A pepper distinct from the token-signing key.
 *
 * Separate because they leak differently and are rotated differently. AUTH_SECRET can
 * be rotated whenever you like: every device signs in again and that is the end of
 * it. Rotating THIS one orphans every stored `phone_hmac` in the database, which
 * silently detaches every account from its owner. Keeping them apart means the easy
 * rotation stays easy.
 *
 * Falls back to a value derived from AUTH_SECRET when unset, so that an existing
 * deployment keeps working -- but derived, never equal, so the two never appear in
 * the same place.
 */
const PEPPER =
  env.PHONE_PEPPER ??
  createHmac('sha256', env.AUTH_SECRET).update('phone-pepper.v1').digest('base64url');

/** The lookup key for an E.164 number. Stable for the life of the pepper. */
export function phoneHmac(e164: string): string {
  return createHmac('sha256', PEPPER).update(`phone.v1:${e164}`).digest('base64url');
}

/**
 * The stored form of a one-time code, bound to the challenge it belongs to.
 *
 * The id is inside the HMAC rather than beside it. Without that binding, two
 * challenges that happened to draw the same six digits would have the same hash, and
 * a code observed anywhere could be typed against any open challenge for that number.
 */
export function codeHmac(challengeId: string, code: string): string {
  return createHmac('sha256', PEPPER).update(`otp.v1:${challengeId}:${code}`).digest('base64url');
}

/**
 * Six digits from the system CSPRNG.
 *
 * `randomInt` rather than `Math.random()`, which is not seeded for this and is
 * predictable from a handful of outputs. Padded, because "012345" is a real code and
 * a number would lose the leading zero somewhere between here and the SMS.
 */
export function newCode(): string {
  const max = 10 ** OTP_LENGTH;
  return String(randomInt(0, max)).padStart(OTP_LENGTH, '0');
}

/**
 * Constant-time comparison of two hashes.
 *
 * Length is checked first because timingSafeEqual throws on a mismatch, and a thrown
 * error is itself a timing signal -- the same reasoning as tokens.ts.
 */
export function hashesMatch(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}
