/**
 * A message that arrives while the conversation is open is read (dm/read-on-arrival.ts).
 *
 * WHAT WAS WRONG (the two-phone test, 2026-10-02): only opening a conversation said it was
 * read, so a message that came in while it was open stayed "Delivered" on the other phone.
 *
 * WHAT IS GUARDED: the newest message of theirs is what reading covers; it is read only
 * while the conversation is on top, the app in front and the thread loaded; and the thread
 * screen says so whenever any of those changes (SOURCE SHAPE: React Native screen).
 *
 * Negative controls, run by hand and recorded in the commit: readNow ignoring `front` ->
 * "a locked phone reads nothing" fails; the screen without the effect -> "the screen
 * reads on arrival" fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { newestTheirs, readNow } from '../src/features/dm/read-on-arrival';

const msgs = (...mine: boolean[]) => mine.map((m, i) => ({ id: `m${i}`, mine: m }));
const open = { focused: true, front: true, ready: true };

describe('reading what arrives while the conversation is open', () => {
  it('covers the newest message of theirs, whatever of mine came after', () => {
    expect(newestTheirs(msgs(false, true, false, true))).toBe('m2');
    expect(newestTheirs(msgs(true, true))).toBeNull();
    expect(newestTheirs([])).toBeNull();
  });

  it('reads when it is on top, the app in front, the thread loaded', () => {
    expect(readNow('m2', open)).toBe(true);
    expect(readNow(null, open)).toBe(false);
  });

  it('a locked phone, another screen on top, or a thread still loading reads nothing', () => {
    expect(readNow('m2', { ...open, front: false })).toBe(false);
    expect(readNow('m2', { ...open, focused: false })).toBe(false);
    expect(readNow('m2', { ...open, ready: false })).toBe(false);
  });

  it('the screen reads on arrival, and again when it comes back on top or to the front', () => {
    const src = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'dm', 'thread-screen.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    expect(src).toContain('const theirs = newestTheirs(messages);');
    expect(src).toMatch(/if \(!readNow\(theirs, \{ focused, front, ready: status === 'ready' \}\)\) return;\s*readDm\(rendezvousId\);/);
    expect(src).toContain('}, [theirs, focused, front, status, rendezvousId, clearUnread]);');
  });
});
