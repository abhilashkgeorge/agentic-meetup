/**
 * A box must not derive its width from its height.
 *
 * THE BUG THIS EXISTS FOR. The profile's photo grid is one tall hero beside a column
 * of two smaller slots. The small ones carried `flex: 1` AND `aspectRatio: 1` at the
 * same time, inside a column whose height is set by the hero:
 *
 *     flex: 1        -> height = half the row
 *     aspectRatio: 1 -> width  = that height
 *     nothing        -> width from the column it actually sits in
 *
 * At a 2:1 split the column is a third of the row, but the slots came out about
 * (8/9)/2 of the row wide -- a third wider than their own column. They spilled past
 * the card and off the right edge of the phone. Reported as "the boxes out of the
 * screen".
 *
 * React Native does not clip by default and there is no layout error, so this is
 * invisible in a diff, invisible in a type check, and invisible on any screen wide
 * enough to absorb it. Only a narrow phone shows it.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dirname, '..', 'src');

/**
 * The code with its comments removed.
 *
 * Without this the scan reads its own explanation: the note in avatar.tsx describing
 * the bug contains the words `aspectRatio: 1`, and the first version of this test
 * duly reported the comment as the defect. A checker that cannot tell code from prose
 * about code is worse than none.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + ' '.repeat(m.length - p1.length));
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

describe('a flex child with a fixed aspect ratio', () => {
  it('never lets both dimensions be decided by something other than its parent width', () => {
    const offenders: string[] = [];

    for (const file of sources(SRC)) {
      const src = stripComments(readFileSync(file, 'utf8'));
      const lines = src.split('\n');

      lines.forEach((line, i) => {
        if (!/aspectRatio:/.test(line)) return;
        // The window around it: a style object is short, and both properties have to
        // be in the same one to collide.
        const block = lines.slice(Math.max(0, i - 6), i + 7).join('\n');

        // `flex: 1` sizes the MAIN axis; an aspect ratio then derives the cross axis
        // from it, and the parent's width never enters into either.
        //
        // Both properties are usually written as ternaries -- `flex: large ? undefined
        // : 1` beside `aspectRatio: large ? 3 / 4 : 1` -- so matching a literal
        // `flex: 1` finds nothing. The first version of this test did exactly that and
        // passed against the bug it was written for.
        const flexes = /flex:[^,\n]*\b1\b/.test(block);
        if (!flexes) return;

        // The aspect ratio has to actually apply in the flexing case. `large ? 3 / 4 :
        // undefined` is the fix, not the fault: the branch that flexes has no ratio.
        const ratio = /aspectRatio:([^,\n]*)/.exec(block)?.[1] ?? '';
        const ratioAppliesWhenFlexing = !/undefined\s*$/.test(ratio.trim());
        if (!ratioAppliesWhenFlexing) return;

        // Something has to pin the width, or it is derived from the height.
        const widthPinned = /\bwidth:|\bmaxWidth:/.test(block);
        if (!widthPinned) offenders.push(`${file.replace(SRC, 'src')}:${i + 1}`);
      });
    }

    expect(
      offenders,
      'flex:1 sets the height, aspectRatio then sets the width from it, and the '
      + 'parent column never gets a say -- so the box can end up wider than the '
      + 'space it is in and spill off the screen. Pin the width, or drop the aspect '
      + `ratio on the flexing axis:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
