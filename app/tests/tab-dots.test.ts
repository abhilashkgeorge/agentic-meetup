/**
 * A dot on Matches and on Chats when something waits for you there
 * (features/tabs/dots.ts, use-tab-dots.ts, pulse.ts; app/(tabs)/_layout.tsx).
 *
 * WHAT WAS WRONG (the two phones, 2026-10-04): Kavya, whose agent was met, got a card,
 * then Arjun's yes, then his first message -- and nothing outside the Matches and Chats
 * tabs said so. Push is not set up; the town says "Your agent met one person" only to
 * whoever sent theirs out.
 *
 * WHAT IS PINNED: a dot when a card waits on you or a chat has something unread, never a
 * number; read again when the app opens or comes back, when any tab is opened, and when
 * the socket brings a card decided, your turn, an introduction or a message; a screen
 * reader hears why. The React Native wiring is SOURCE SHAPE (no renderer in these tests).
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - the Chats tab without its dot -> "on the tab bar" fails;
 *   - a message not bumping the pulse -> "when something arrives" fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chatsWaiting, matchesWaiting, withDot } from '../src/features/tabs/dots';

const src = (...p: string[]) => readFileSync(join(import.meta.dirname, '..', 'src', ...p), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('what makes a dot', () => {
  it('Chats: something unread; Matches: a card waiting on you', () => {
    expect(chatsWaiting([])).toBe(false);
    expect(chatsWaiting([{ unread: 0 }, { unread: 0 }])).toBe(false);
    expect(chatsWaiting([{ unread: 0 }, { unread: 2 }])).toBe(true);
    expect(matchesWaiting([{ waitingOnYou: false }])).toBe(false);
    expect(matchesWaiting([{ waitingOnYou: false }, { waitingOnYou: true }])).toBe(true);
  });

  it('a screen reader hears why, and only when there is a dot', () => {
    expect(withDot('Your conversations', true, 'something new')).toBe('Your conversations, something new');
    expect(withDot('Your conversations', false, 'something new')).toBe('Your conversations');
  });
});

describe('where it shows and when it is read (SOURCE SHAPE: React Native)', () => {
  it('on the tab bar: Matches and Chats, a dot and never a number', () => {
    const tabs = src('app', '(tabs)', '_layout.tsx');
    expect(tabs).toContain('<TabIcon glyph="◈" focused={focused} label="MATCHES" dot={dots.matches} />');
    expect(tabs).toContain('<TabIcon glyph="◎" focused={focused} label="CHATS" dot={dots.chats} />');
    expect(tabs).toContain("withDot('Your conversations', dots.chats, 'something new')");
    expect(tabs).not.toContain('tabBarBadge');
    expect(tabs).toContain('screenListeners={{ focus: () => dots.refresh() }}');
  });

  it('read from the two lists, again when the app comes back and when something arrives', () => {
    const hook = src('features', 'tabs', 'use-tab-dots.ts');
    expect(hook).toContain('const [m, c] = await Promise.all([getMatches(token), getConversations(token)]);');
    expect(hook).toContain('useEffect(() => { refresh(); }, [refresh, pulse]);');
    expect(hook).toContain("if (s === 'active') refresh();");
    const socket = src('lib', 'socket.ts');
    expect(socket).toMatch(/case 'dm\.message':\s*d\.received\(ev\.message\);\s*outboxAgain\.reset\(\);\s*useTabPulse\.getState\(\)\.bump\(\);/);
    expect(socket).toMatch(/if \(ev\.type === 'round\.decided' \|\| ev\.type === 'round\.done' \|\| ev\.type === 'match\.turn'\s*\|\| ev\.type === 'match\.introduced'\) useTabPulse\.getState\(\)\.bump\(\);/);
  });
});
