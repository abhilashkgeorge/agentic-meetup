import { contactDetail } from '@clone/shared';

/**
 * The stories screen's rules, without a phone: when an answer may be saved, and what to
 * say about one that holds a contact detail.
 *
 * A story is only worth saving if the server can quote it: at least `min` characters
 * (a quote shorter than that is not a sentence anybody can be quoted by -- the server
 * refuses it too, server/src/api/stories.ts), at most `max`, and different from what is
 * already saved, so a Save that changes nothing never sends anything.
 */
export function canSave(draft: string, saved: string | null, min: number, max: number): boolean {
  const t = draft.trim();
  return t.length >= min && t.length <= max && t !== (saved ?? '').trim();
}

/** What to say under a draft that is started but too short, or nothing. */
export function tooShort(draft: string, min: number): string | null {
  const n = draft.trim().length;
  return n > 0 && n < min ? 'A little more — a whole sentence.' : null;
}

/**
 * Said the moment a draft holds a phone number, email, handle, link or address. The
 * server keeps such an answer but never repeats it (shared/src/contact.ts); saying so
 * while they type beats a sentence that silently never shows up anywhere.
 */
export const CONTACT_NOTE =
  'Your agent never repeats phone numbers, emails, handles, links or addresses. Swap those in chat after you both say yes.';

export function contactNote(draft: string): string | null {
  return contactDetail(draft) ? CONTACT_NOTE : null;
}
