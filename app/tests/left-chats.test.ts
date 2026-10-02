/**
 * "They left" in the chat list (the founder, 2026-09-29; server 0082).
 *
 * WHAT WAS WRONG: when the other person deleted their account, the chat vanished from
 * the list, which reads exactly like being blocked, and there was nothing left to report
 * them from. The server now holds the chat hidden for 30 days (0082) and lists it.
 *
 * WHAT IS PINNED: the list shows each held chat as "They left", under the name the person
 * knew; tapping it explains the 30 days and offers Report until it has been reported; the
 * report sheet for somebody who left reports only -- there is nobody to block -- and goes
 * to the held chat's route.
 *
 * WHY THE SOURCE, NOT THE SCREEN: no React Native renderer under vitest (safety.test.ts).
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - the list without its held chats            -> "shows each held chat" fails;
 *   - the Block button shown for somebody gone   -> "reports only" fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEFT_LINE, leftNotice } from '../src/features/dm/left';

const code = (f: string) => readFileSync(join(import.meta.dirname, '..', 'src', f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('a chat whose other person left', () => {
  const held = { id: 'h1', name: 'Ravi', leftAt: '2026-09-29T10:00:00Z', lastAt: null, reported: false };

  it('says they left, the 30 days, and offers a report until one is made', () => {
    expect(LEFT_LINE).toBe('They left');
    expect(leftNotice(held)).toEqual({
      title: 'Ravi left',
      body: 'They deleted their account. Your chat is kept hidden for 30 days, only in case you want to report something. Then it is deleted.',
      canReport: true,
    });
    expect(leftNotice({ ...held, reported: true }).canReport).toBe(false);
  });

  it('shows each held chat in the list, and tapping it opens the report', () => {
    const screen = code('features/dm/conversations-screen.tsx');
    // Read once the list is here (a failed read keeps what is on screen, since 2026-10-02).
    expect(screen).toMatch(/setLeft\(list\.left \?\? \[\]\)/);
    expect(screen).toMatch(/\{left\.map\(\(l, i\) => \(/);
    expect(screen).toMatch(/subtitle=\{LEFT_LINE\}/);
    expect(screen).toMatch(/onPress=\{\(\) => openLeft\(l\)\}/);
    expect(screen).toMatch(/target=\{\{ leftChatId: reporting\.id \}\}/);
    expect(code('lib/api.ts')).toMatch(/post<\{ ok: boolean \}>\(`\/v1\/left\/\$\{id\}\/report`/);
  });

  it('reports only: there is nobody left to block', () => {
    const sheet = code('features/safety/safety-sheet.tsx');
    expect(sheet).toMatch(/\{!gone && <Button label=\{`Block \$\{who\}`\}/);
    expect(sheet).toMatch(/ok = await reportLeftChat\(token, target\.leftChatId,/);
  });
});
