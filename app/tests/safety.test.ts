/**
 * Block and report are on every card, profile and chat, with the server's reasons, and
 * the support address is in the app.
 *
 * WHAT THE FOUNDER ASKED FOR (build list item 3): "On every card, profile and chat:
 * Block, and Report with a few fixed reasons ... Add a support email inside the app
 * (Apple requires report, block, and contact info for apps where users talk to each
 * other)." Before this, only the chat had it, and its report sent the reason 'other'
 * whatever had happened.
 *
 * WHY THE SOURCE, NOT THE SCREEN. There is no React Native renderer under vitest, so
 * whether a screen draws the sheet cannot be observed here. What can be checked is that
 * each screen mounts it, with comments stripped -- the comments name it in passing.
 * FOUND BY WHAT THE SCREEN DOES, not a hand-picked list alone: any screen that decides a
 * match, opens a profile or reads a chat must mount the sheet, so a new one is covered
 * without anybody adding it here.
 *
 * Negative controls, run by hand:
 *   - drop <SafetySheet from reveal-screen.tsx          -> "every card, profile and
 *                                                          chat" fails, naming it
 *   - drop 'spam' from the app's REPORT_REASONS          -> "the server's reasons" fails
 *   - take the support row out of settings-screen.tsx    -> "a way to reach a person"
 *                                                          fails
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { REPORT_REASONS, SUPPORT_EMAIL, supportMailto } from '../src/features/safety/reasons';
import { contextLine, outcomeLabel, reasonLabel, reportedLabel } from '../src/features/admin/queue';
import type { AdminReport } from '../src/lib/api';

const SRC = join(import.meta.dirname, '..', 'src');
const SERVER = join(import.meta.dirname, '..', '..', 'server', 'src');

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + ' '.repeat(m.length - p1.length));
}
function sources(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(dir, e.name))
    : /\.tsx$/.test(e.name) ? [relative(SRC, join(dir, e.name))]
    : []);
}
const code = (file: string) => stripComments(readFileSync(join(SRC, file), 'utf8'));

describe('every card, profile and chat', () => {
  it('mounts the Block-or-report sheet', () => {
    // Screens that decide a match (a card), open a profile, or read a chat -- by the
    // call that makes them one.
    const found = sources().filter((f) => /\b(decideMatch|getReveal|getMessages)\(/.test(code(f)));
    // And the town's sheet for somebody you have met, which is a profile of a kind.
    const surfaces = [...new Set([...found, 'features/world/agent-sheet.tsx'])];
    expect(surfaces).toEqual(expect.arrayContaining([
      'features/matches/matches-screen.tsx', 'features/matches/reveal-screen.tsx', 'features/dm/thread-screen.tsx',
    ]));
    const missing = surfaces.filter((f) => !/<SafetySheet\b/.test(code(f)));
    expect(missing, `these show a card, a profile or a chat with no way to block or report:\n${missing.join('\n')}`)
      .toEqual([]);
  });

  it('reports with the server\'s reasons, and nothing freer in their place', () => {
    const server = readFileSync(join(SERVER, 'api', 'messages.ts'), 'utf8');
    const m = server.match(/export const REPORT_REASONS = \[([^\]]*)\]/);
    expect(m, 'server/src/api/messages.ts no longer exports REPORT_REASONS').not.toBeNull();
    const serverIds = [...m![1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(REPORT_REASONS.map((r) => r.id)).toEqual(serverIds);
    // The old chat sent 'other' whatever had happened. No screen picks a reason for the
    // person any more, except the check-in's "felt unsafe", which is what it asks.
    const fixed = sources().filter((f) => /reason:\s*'(?!felt_unsafe')[a-z_]+'/.test(code(f)));
    expect(fixed).toEqual([]);
  });

  it('gives a way to reach a person, on the sheet and in Settings', () => {
    expect(SUPPORT_EMAIL).toBe('abhilash@dabba.com');
    expect(supportMailto('Report')).toBe('mailto:abhilash@dabba.com?subject=Report');
    expect(code('features/safety/safety-sheet.tsx')).toMatch(/SUPPORT_EMAIL/);
    expect(code('features/settings/settings-screen.tsx')).toMatch(/supportMailto\(/);
  });
});

describe('the reviewer\'s queue', () => {
  const report = (over: Partial<AdminReport> = {}): AdminReport => ({
    id: 'r1', reason: 'fake_profile', detail: '', at: '2026-09-25T10:00:00Z', reportedId: 'u1',
    reporterKnown: true, reportedName: 'Asha', banned: false, reviewed: null, outcome: null, note: '',
    context: { reportsAgainstThem: 3, distinctReporters: 2, photos: 4, photosHidden: 1 }, ...over,
  });

  it('reads as words, not ids', () => {
    for (const r of REPORT_REASONS) expect(reasonLabel(r.id)).not.toMatch(/_/);
    expect(reasonLabel('fake_profile')).toBe('Fake profile');
    expect(contextLine(report())).toBe('3 reports from 2 people · 4 photos, 1 hidden');
    expect(contextLine(report({ context: { reportsAgainstThem: 1, distinctReporters: 1, photos: 0, photosHidden: 0 } })))
      .toBe('1 report from 1 person · no photos');
    expect(outcomeLabel('banned')).toBe('Banned');
    expect(reportedLabel(report({ banned: true }))).toBe('Asha (banned)');
    expect(reportedLabel(report({ reportedName: null }))).toBe('Someone without a profile');
  });

  it('is reachable only through the reviewer check', () => {
    // The row that opens it appears only once GET /v1/admin/me has answered; the
    // server's 404 to everybody else is the real gate (server tests/block-report-ban).
    const settings = code('features/settings/settings-screen.tsx');
    expect(settings).toMatch(/isAdmin\(token\)/);
    expect(settings).toMatch(/\{admin && \(\s*<Row title="Reports to review"/);
  });
});
