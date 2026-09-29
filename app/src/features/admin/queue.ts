/**
 * The reviewer's queue, in words. Plain functions, so the wording can be tested
 * without a phone.
 *
 * Counts are fine HERE and nowhere else a person looks: this desk is the founder's,
 * and "three people reported them" is the thing a ban turns on. The rule against a
 * number is about a number on a MATCH.
 */
import type { AdminReport, ReportChatLine } from '../../lib/api';
import { REPORT_REASONS } from '../safety/reasons';

/** A reason id as the person who reported chose it: "Fake profile", not "fake_profile". */
export const reasonLabel = (id: string): string =>
  REPORT_REASONS.find((r) => r.id === id)?.label ?? id.replace(/_/g, ' ');

const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** What the reviewer should know before deciding: how many, from how many, and photos. */
export function contextLine(r: AdminReport): string {
  const c = r.context;
  const reports = n(c.reportsAgainstThem, 'report', 'reports');
  const from = c.distinctReporters > 0 ? ` from ${n(c.distinctReporters, 'person', 'people')}` : '';
  const photos = c.photos === 0 ? 'no photos'
    : `${n(c.photos, 'photo', 'photos')}${c.photosHidden ? `, ${c.photosHidden} hidden` : ''}`;
  return `${reports}${from} · ${photos}`;
}

/** What was decided, for the reviewed list. */
export const outcomeLabel = (outcome: string | null): string =>
  outcome === 'no_action' ? 'No action'
  : outcome === 'photos_hidden' ? 'Photos hidden'
  : outcome === 'account_blocked' ? 'Account blocked'
  : outcome === 'banned' ? 'Banned'
  : 'Open';

/**
 * Who, in words. A report on somebody with no profile yet still names them somehow; one
 * on somebody who deleted their account says so (server 0079 keeps it), and says so
 * again, with their new name, if they came back under the same phone or handset.
 */
export const reportedLabel = (r: AdminReport): string =>
  r.reportedDeleted && !r.cameBack ? 'Deleted their account'
    : `${r.reportedName ?? 'Someone without a profile'}${r.cameBack ? ' (came back after deleting an account)' : ''}${r.banned ? ' (banned)' : ''}`;

/** The button that opens the chat kept with a report (server 0080), or null: none kept. */
export const chatButtonLabel = (r: AdminReport): string | null =>
  r.chatLines > 0 ? `Read their chat (${n(r.chatLines, 'message', 'messages')})` : null;

/**
 * One line of that chat: who said it, as the reviewer should read it -- "Them" is the
 * person reported -- and whether it was a date idea or deleted by whoever sent it.
 */
export const chatLineLabel = (l: ReportChatLine): string =>
  `${l.from === 'them' ? 'Them' : 'Reporter'}: ${l.park ? '(in the park) ' : ''}${l.dateIdea ? '(date idea) ' : ''}${l.text}${l.takenBack ? ' (deleted by the sender)' : ''}`;
