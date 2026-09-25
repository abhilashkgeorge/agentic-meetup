/**
 * What a report can say, and where to write to a person.
 *
 * FIXED REASONS (the founder, build list item 3): a report gives one of a few reasons
 * and nothing freer, so the reviewer's queue reads the same every time. The ids are the
 * server's (api/messages.ts REPORT_REASONS) -- tests/safety.test.ts reads that file and
 * fails if the two lists drift apart.
 *
 * THE SUPPORT ADDRESS is in the app because Apple requires, for apps where people talk
 * to each other, a way to report, a way to block, and a way to reach a person. It lives
 * in shared, so the server's "account closed" answer names the same one.
 */
import { SUPPORT_EMAIL } from '@clone/shared';

export { SUPPORT_EMAIL };
export const REPORT_REASONS = [
  { id: 'harassment', label: 'Harassment or threats' },
  { id: 'inappropriate', label: 'Inappropriate messages or photos' },
  { id: 'fake_profile', label: 'Fake profile' },
  { id: 'underage', label: 'Seems under 18' },
  { id: 'spam', label: 'Spam or a scam' },
  { id: 'felt_unsafe', label: 'Made me feel unsafe' },
  { id: 'other', label: 'Something else' },
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number]['id'];

/** A mailto link with a subject, for the support line. */
export const supportMailto = (subject = 'Help with the app'): string =>
  `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;
