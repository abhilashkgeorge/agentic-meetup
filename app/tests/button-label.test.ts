/**
 * A button's label is one line, broken the simple way (components/ui/button.tsx).
 *
 * WHAT WAS WRONG (the release app on the Pixel 6a, 2026-09-30, testing a new account end to
 * end): the photos screen's button read only "Add" where it should say "Add another".
 * Android measured the label a hair narrower than it drew it (its default "highQuality"
 * line breaking, with the app's own font), wrapped "another" onto a second line, and the
 * button's height hid it. It happened every time the screen opened, not only when the
 * label changed. Seen after the fix, same phone: "Add another" whole and centred, and
 * "Send my agent out" unchanged.
 *
 * Layout only runs on a phone, so the props are what is checked. Negative control, run by
 * hand and recorded in the commit: the label without textBreakStrategy="simple" -> fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(join(import.meta.dirname, '..', 'src', 'components', 'ui', 'button.tsx'), 'utf8');

describe('a button label', () => {
  it('is one line with simple breaking, in both kinds of button', () => {
    const labels = [...src.matchAll(/<Text\s+([^>]*?)style=\{\[\s*type\.bodyStrong/g)].map((m) => m[1]!);
    expect(labels, 'the two label Texts were not found').toHaveLength(2);
    for (const props of labels) {
      expect(props).toContain('numberOfLines={1}');
      expect(props).toContain('textBreakStrategy="simple"');
    }
  });
});
