/**
 * Every screen you can reach must be a screen you can leave.
 *
 * THE BUG THIS EXISTS FOR, TWICE. The navigator's own header is switched off across
 * this app -- each screen draws its own -- so a screen that forgets to draw one has no
 * way out at all except the system back gesture, which nobody finds halfway down a
 * scrolling list.
 *
 *   preferences, settings   shipped with no way back, found by a person on a phone
 *   "What it knows"         same thing, found by a person on a phone, months later
 *
 * The last one was missed because it LOOKS like a tab root: it opens with a big title
 * and a list, exactly like Matches or Chats. The difference is invisible in the file
 * and obvious on the device, which is the definition of something that needs a test.
 *
 * A tab root is exempt -- the tab bar is its way out. Everything else has to offer one.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const APP = join(import.meta.dirname, '..', 'src', 'app');
const SRC = join(import.meta.dirname, '..', 'src');

/** Route files under src/app, excluding layouts and the (tabs) group. */
function routes(dir: string, prefix = ''): { route: string; file: string }[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name.startsWith('(')) return [];
      return routes(full, `${prefix}${name}/`);
    }
    if (!name.endsWith('.tsx') || name === '_layout.tsx') return [];
    return [{ route: `${prefix}${name.replace(/\.tsx$/, '')}`, file: full }];
  });
}

/**
 * A route file is usually one line re-exporting the screen. Follow it, because the
 * header lives in the feature file and not in src/app.
 */
function screenSource(file: string): string {
  const src = readFileSync(file, 'utf8');
  const m = /from\s+'(\.\.\/[^']+)'/.exec(src);
  if (!m) return src;
  const target = join(file, '..', m[1]!);
  for (const ext of ['.tsx', '.ts', '/index.tsx']) {
    try { return readFileSync(target + ext, 'utf8'); } catch { /* try the next */ }
  }
  return src;
}

/**
 * Screens that are deliberately a one-way door.
 *
 * `consent` is a gate: it is shown before anything is set up and the only way past it
 * is to agree, which is why its Stack entry also disables the swipe gesture. Giving it
 * a back button would mean a back button to nowhere.
 */
const GATES = new Set(['consent', 'connect', 'invite', 'onboarding/index']);

/**
 * Whether the NAVIGATOR draws the header for this route, in which case it also draws
 * the back arrow and the screen does not need its own.
 *
 * The onboarding group does exactly this: its `_layout.tsx` leaves headers on, so all
 * six steps get a back arrow for free. Missing that distinction is how the first draft
 * of this test flagged six screens that are fine -- and a test that cries wolf about
 * working screens is one somebody deletes.
 */
function navigatorDrawsHeader(file: string): boolean {
  try {
    const layout = readFileSync(join(file, '..', '_layout.tsx'), 'utf8');
    return !/headerShown:\s*false/.test(layout);
  } catch {
    // No group layout: the root one turns headers off for every screen it names.
    return false;
  }
}

describe('screens you can reach', () => {
  it('are screens you can leave', () => {
    const stranded: string[] = [];

    for (const { route, file } of routes(APP)) {
      if (GATES.has(route)) continue;
      if (navigatorDrawsHeader(file)) continue;
      const src = screenSource(file);
      // Any of these is a way out: a drawn header with a back handler, an explicit
      // back button, or a footer button that navigates away.
      const hasWayBack = /onBack=|router\.back\(\)|label="Back/.test(src);
      if (!hasWayBack) stranded.push(`${route}  (${file.replace(SRC, 'src')})`);
    }

    expect(
      stranded,
      'these screens draw their own header and offer no way back. Add '
      + '<Header onBack={() => router.back()} />, or add the route to GATES if it is '
      + `deliberately one-way:\n${stranded.join('\n')}`,
    ).toEqual([]);
  });
});
