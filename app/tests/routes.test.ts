/**
 * Every screen that draws its own header must have the navigator's one turned off.
 *
 * Forget it and the stack puts its own bar on top, showing the route PATTERN as the
 * title -- "dm/[id]" above a person's name, "edit/[predicate]" above "How do you eat?".
 * It has happened twice; this is cheaper than a third time.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const APP = join(import.meta.dirname, '..', 'src', 'app');
const layout = readFileSync(join(APP, '_layout.tsx'), 'utf8');

/** Route files under src/app, as expo-router names them. */
function routes(dir: string, prefix = ''): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      // Groups like (tabs) are their own layout's business.
      if (name.startsWith('(')) return [];
      return routes(full, `${prefix}${name}/`);
    }
    if (!name.endsWith('.tsx') || name === '_layout.tsx') return [];
    return [`${prefix}${name.replace(/\.tsx$/, '')}`];
  });
}

describe('screens that draw their own header', () => {
  it('are registered with the stack header hidden', () => {
    const missing: string[] = [];

    for (const route of routes(APP)) {
      // Onboarding has its own layout and its own rules.
      if (route.startsWith('onboarding/')) continue;

      const file = join(APP, `${route}.tsx`);
      const src = readFileSync(file, 'utf8');
      // The route file re-exports a feature screen; follow it to see if that draws a
      // header of its own.
      const m = src.match(/from '(\.\.\/)+features\/([^']+)'/);
      if (!m) continue;
      const feature = join(APP, '..', 'features', `${m[2]}.tsx`);
      let body = '';
      try { body = readFileSync(feature, 'utf8'); } catch { continue; }
      if (!/<Header\b/.test(body)) continue;

      if (!layout.includes(`name="${route}"`)) missing.push(route);
    }

    expect(
      missing,
      `these draw their own header, so the stack will stack a second one showing the `
      + `route pattern. Register them in src/app/_layout.tsx with headerShown: false:\n`
      + missing.join('\n'),
    ).toEqual([]);
  });
});
