/**
 * Store selectors must not build a new value every time they run.
 *
 * THE BUG THIS EXISTS FOR. `useDm((s) => s.threads[id] ?? [])` reads perfectly, passes
 * the type checker, and crashed the app the moment a conversation was opened:
 *
 *   E ReactNativeJS: The result of getSnapshot should be cached to avoid an infinite loop
 *   E ReactNativeJS: Maximum update depth exceeded ... at ThreadScreen(./dm/[id].tsx)
 *
 * A selector runs on every store change and its result is compared BY REFERENCE. A
 * fresh `[]` is a different reference each time, so the screen re-renders, selects
 * again, gets another new array, and never stops.
 *
 * Nothing else here can see it. TypeScript is happy, the store tests pass because they
 * never render, and the end-to-end run drives HTTP and sockets rather than React. So
 * this reads the source -- crude, and it would have turned a crash on a real phone into
 * a failing test on a laptop.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

/**
 * A selector body that allocates. Matched on the single line the hook opens, which is
 * how every one of these is written; a multi-line selector doing real work is a
 * different smell and is not what this is for.
 */
const ALLOCATING = /use[A-Z]\w*\(\s*\((?:\w+)\)\s*=>[^\n]*(\?\?\s*(\[\]|\{\})|\.(map|filter|slice|concat)\(|=>\s*(\[|\{\s*\w+:))/;

describe('store selectors', () => {
  it('never return a freshly built array or object', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(ROOT)) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (!ALLOCATING.test(line)) return;
        // `useState`, `useMemo`, `useCallback` and friends take a function and are
        // supposed to allocate. Only the store hooks compare by reference on every
        // change.
        if (!/use(Dm|Session)\(/.test(line)) return;
        offenders.push(`${file.replace(ROOT, 'src')}:${i + 1}  ${line.trim()}`);
      });
    }

    expect(
      offenders,
      `these re-render for ever; hold the empty value in a module constant instead:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
