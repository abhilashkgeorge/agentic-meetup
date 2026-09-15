/**
 * A screen under a navigator header must not add the safe-area inset again.
 *
 * The onboarding stack draws its own header (`app/onboarding/_layout.tsx` leaves
 * `headerShown` on), which has already moved the content below the status bar. `Screen`
 * then added `insets.top` on top of that -- 44 more points on an iPhone, for nothing.
 *
 * It mattered because those points came out of the only part of the screen that has to
 * be usable. On an iPhone XS with the keyboard open, the birth-year field ended up half
 * underneath the Next button: the one element a person MUST reach, hidden by the
 * chrome above it.
 *
 * Every `<Screen>` in the onboarding folder therefore has to pass `topInset={false}`.
 * There are sixteen of them across seven files, several files holding three, so this is
 * exactly the kind of rule that is remembered for the first one and forgotten for the
 * rest -- the first pass at this change did precisely that, tagging one per file.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(import.meta.dirname, '..', 'src', 'features', 'onboarding');

/** The opening tag's text, brace-aware so `footer={<>…</>}` does not end it early. */
function openingTags(src: string, tag: string): { text: string; line: number }[] {
  const found: { text: string; line: number }[] = [];
  const re = new RegExp(`<${tag}(?=[\\s>])`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let j = m.index + m[0].length;
    let depth = 0;
    while (j < src.length) {
      const c = src[j];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
      j++;
    }
    found.push({
      text: src.slice(m.index, j),
      line: src.slice(0, m.index).split('\n').length,
    });
  }
  return found;
}

describe('onboarding screens', () => {
  it('every one opts out of the top inset the header already applied', () => {
    const offenders: string[] = [];

    for (const name of readdirSync(DIR)) {
      if (!name.endsWith('.tsx')) continue;
      const file = join(DIR, name);
      const src = readFileSync(file, 'utf8');
      for (const tag of openingTags(src, 'Screen')) {
        if (!/topInset=\{false\}/.test(tag.text)) {
          offenders.push(`src/features/onboarding/${name}:${tag.line}`);
        }
      }
    }

    expect(
      offenders,
      'these sit under the onboarding stack\'s header and would count the safe area '
      + `twice. Add topInset={false}:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('is actually checking something — the folder has screens in it', () => {
    // A path typo would make the loop above pass by finding nothing at all.
    const screens = readdirSync(DIR)
      .filter((n) => n.endsWith('.tsx'))
      .flatMap((n) => openingTags(readFileSync(join(DIR, n), 'utf8'), 'Screen'));
    expect(screens.length).toBeGreaterThan(10);
  });
});
