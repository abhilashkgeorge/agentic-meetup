/**
 * Text that gets silently cut off.
 *
 * THE BUG THIS EXISTS FOR, TWICE. A Text inside a flex row is a flex item, so a
 * sibling can squeeze it -- and Android then clips the words with no ellipsis, so it
 * reads as a sentence somebody forgot to finish rather than as a layout fault:
 *
 *   "A dealbreaker"      rendered as  "A"
 *   "the ages you want"  rendered as  "the ages you"
 *
 * Nothing catches it. The string is correct in the source, correct in the props,
 * correct in the accessibility tree -- the only place it is wrong is the pixels. Both
 * times it was found by a person looking at a phone.
 *
 * So: a row that puts a Text next to something else has to say which half gives way.
 * This reads the source and fails when neither does.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', 'src');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return name.endsWith('.tsx') ? [full] : [];
  });
}

describe('rows that hold text', () => {
  it('always say which side gives way', () => {
    const offenders: string[] = [];

    for (const file of sources(ROOT)) {
      const src = readFileSync(file, 'utf8');
      const lines = src.split('\n');

      lines.forEach((line, i) => {
        // A row laid out with space-between and no flex rule on its children is the
        // shape that clips. `StatRow` is the component written to do this correctly,
        // so its own definition is where the rule lives rather than a violation of it.
        if (!line.includes("justifyContent: 'space-between'")) return;
        if (file.endsWith('stat-row.tsx') || file.endsWith('header.tsx')) return;

        // Look at the rest of the element: does anything claim or yield space?
        const block = lines.slice(i, i + 12).join('\n');
        const decides = /flex:\s*1|flexShrink:\s*0|numberOfLines|<StatRow|<Row\b/.test(block);
        if (!decides) {
          offenders.push(`${file.replace(ROOT, 'src')}:${i + 1}`);
        }
      });
    }

    expect(
      offenders,
      `a Text here can be squeezed and clipped with no ellipsis. Use <StatRow>, or give `
      + `the label flex: 1 and the value flexShrink: 0:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
