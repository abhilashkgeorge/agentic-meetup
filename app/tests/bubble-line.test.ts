/**
 * A chat message is drawn whole (components/ui/bubble.tsx).
 *
 * WHAT WAS WRONG (the Seeker at 85% text size, 2026-10-02): the founder's own message
 * "Yes! Saturday 11am at Third Wave, Indiranagar?" showed as "Yes! Saturday 11am at Third
 * Wave," -- Android's default "highQuality" line breaking, with the app's own font,
 * measured it as one line and drew two, and the bubble was one line high. The stored text
 * was whole. The same fault as the button labels (button-label.test.ts).
 *
 * Layout only runs on a phone, so the prop is what is checked. Negative control, run by
 * hand and recorded in the commit: bubble.tsx without textBreakStrategy -> fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(join(import.meta.dirname, '..', 'src', 'components', 'ui', 'bubble.tsx'), 'utf8');

describe('a chat bubble', () => {
  it('breaks its lines the simple way, so a message that only just fits is not cut off', () => {
    expect(src).toMatch(/<Text style=\{\[type\.body, \{ color: mine \? p\.accentText : p\.text \}\]\} textBreakStrategy="simple">/);
  });
});
