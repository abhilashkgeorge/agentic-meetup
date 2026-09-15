/**
 * Turning what somebody types into one canonical phone number.
 *
 * WHY THIS IS SHARED. The app has to show the number back and decide whether the
 * "Send code" button is alive; the server has to look the number up. If those two
 * disagree by so much as a space, the same person is two people: they verify
 * "+91 98765 43210" on one phone and "9876543210" on the other, and the second
 * device quietly builds a second clone. One normaliser, used on both sides, is what
 * makes "the same number" mean the same thing twice.
 *
 * DELIBERATELY NOT libphonenumber. That library is ~500KB and knows every numbering
 * plan on earth, which is worth it when you serve everyone. Here the job is narrower:
 * accept E.164, accept a local number when we know the country, reject obvious
 * rubbish, and never silently invent a country code. What it does NOT do is claim a
 * number is reachable -- only the code we text to it can prove that.
 */

/** The canonical form: `+` then country code then subscriber number, no spaces. */
export type E164 = string;

/**
 * Countries we can complete a local number for.
 *
 * A short list on purpose. Adding one means committing to its national trunk prefix
 * and its subscriber length, and guessing either of those wrong turns a valid number
 * into an undeliverable one. Everyone else types the `+` themselves, which is what
 * the placeholder asks for.
 */
const NATIONAL: Record<string, { trunk: string; digits: number[] }> = {
  // India: ten digits, first is 6-9. Trunk prefix 0, as printed on every landline ad.
  '+91': { trunk: '0', digits: [10] },
  // United States and Canada share +1 and a flat ten-digit plan. Trunk prefix 1.
  '+1': { trunk: '1', digits: [10] },
  // United Kingdom: nine or ten after the 0, which is why both lengths are listed.
  '+44': { trunk: '0', digits: [9, 10] },
};

export const SUPPORTED_COUNTRIES = Object.keys(NATIONAL);

/** Everything a person might type between the digits, and nothing else. */
const PUNCTUATION = /[\s\-(). ‐-―]/g;

/**
 * The canonical number, or null.
 *
 * `null` means "this is not a number I can send to", never "this number is wrong for
 * you" -- the caller decides what to say about it.
 *
 * @param raw          what the person typed
 * @param defaultCc    country to assume for a local number, e.g. '+91'. Pass nothing
 *                     and a number without a `+` is refused rather than guessed at.
 */
export function normalisePhone(raw: string, defaultCc?: string): E164 | null {
  if (typeof raw !== 'string') return null;
  let s = raw.replace(PUNCTUATION, '');
  if (!s) return null;

  // 00 is the other way to write +, and it is how most of the world dials out.
  if (s.startsWith('00')) s = `+${s.slice(2)}`;

  if (s.startsWith('+')) return validE164(s) ? s : null;

  // No plus. Everything left must be digits, or it is not a number at all.
  if (!/^\d+$/.test(s)) return null;

  if (!defaultCc) return null;
  const plan = NATIONAL[defaultCc];
  if (!plan) return null;

  // A LEADING TRUNK PREFIX IS NOT PART OF THE NUMBER. "09876543210" is the same
  // Indian number as "9876543210"; keeping the 0 makes it eleven digits and
  // undeliverable. Stripped only when what remains is the right length, so a genuine
  // number that happens to start with the trunk digit is not mangled.
  if (s.length > 1 && s.startsWith(plan.trunk)) {
    const without = s.slice(plan.trunk.length);
    if (plan.digits.includes(without.length)) s = without;
  }

  if (!plan.digits.includes(s.length)) return null;
  const full = `${defaultCc}${s}`;
  return validE164(full) ? full : null;
}

/**
 * The shape E.164 actually specifies: a leading digit that is not zero, and at most
 * fifteen digits in total. Deliberately loose about what is a real allocation --
 * that is the SMS provider's problem, and being strict here rejects new ranges the
 * day they are issued.
 */
export function validE164(s: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(s);
}

/**
 * What to print back at somebody: the last two digits, nothing else.
 *
 * Used in "we sent a code to the number ending 10". Never log or display more than
 * this once the number has been stored -- a full number on a support screen is a
 * full number in a screenshot.
 */
export function maskPhone(e164: string): string {
  const digits = e164.replace(/\D/g, '');
  return digits.length < 2 ? '••' : `••${digits.slice(-2)}`;
}

/** Six digits, as a string, because a leading zero is real and a number loses it. */
export const OTP_LENGTH = 6;

/** How long a code is worth typing. Short enough to matter, long enough to arrive. */
export const OTP_TTL_SEC = 300;

/**
 * How long a verified number stays spendable before the invite must be typed.
 *
 * Longer than the code's own life on purpose: somebody who has just proved the number
 * is theirs should not have to prove it again because they went to find the invite
 * their friend sent them on another app.
 */
export const TICKET_TTL_SEC = 900;

/** Wrong guesses allowed before the code is burned and a new one must be sent. */
export const OTP_MAX_ATTEMPTS = 5;
