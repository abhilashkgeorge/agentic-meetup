/**
 * "Can't reach the server", then "Test and save" (store/launch.ts).
 *
 * The Pixel, 2026-10-02: off Wi-Fi overnight, the release app opened on "Can't reach the
 * server". Back on Wi-Fi, "Test and save" went straight to '/', the town -- but the launch
 * check had stopped at the server and never looked for an account, so the signed-out
 * phone sat on "Finding the square..." with no door to sign in by.
 *
 * WHAT IS PINNED. Where a finished check sends the app (launchTarget, a plain function),
 * and that the screen and the layout are wired to it: the screen asks for the check again
 * instead of going to '/', and the layout runs the check, and carries out its answer, once
 * per attempt. A root layout under expo-router does not render in this test runner, so
 * that wiring is read from the source, comments stripped.
 *
 * Negative control, run by hand and recorded in the commit: connect-screen.tsx back on
 * router.replace('/') -> "asks for the whole check again" fails; _layout.tsx with the
 * check run only at launch -> "runs the check again" fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { launchTarget } from '../src/store/launch';

const src = (...p: string[]) => stripComments(readFileSync(join(import.meta.dirname, '..', 'src', ...p), 'utf8'));

describe('where a launch check sends the app', () => {
  it('sends a phone with no account to the door, whether or not the server was found first', () => {
    expect(launchTarget('phone', 0)).toBe('/phone');
    expect(launchTarget('phone', 1)).toBe('/phone');
    expect(launchTarget('consent', 1)).toBe('/consent');
    expect(launchTarget('onboarding', 2)).toBe('/onboarding');
  });

  it('leaves a fully set-up person where the app opened, and takes them in after a retry', () => {
    expect(launchTarget(null, 0)).toBeNull();
    expect(launchTarget(null, 1)).toBe('/');
  });
});

describe('the wiring', () => {
  it('"Test and save" asks for the whole check again instead of going to the town', () => {
    const screen = src('features', 'settings', 'connect-screen.tsx');
    expect(screen).toContain('again();');
    expect(screen).not.toContain("router.replace('/')");
  });

  it('the layout runs the check again on each attempt, and carries out each answer once', () => {
    const layout = src('app', '_layout.tsx');
    expect(layout).toContain('}, [setToken, attempt]);');
    expect(layout).toContain('if (!checked || sent.current === attempt) return;');
    expect(layout).toContain('launchTarget(route, attempt)');
  });
});

function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + ' '.repeat(m.length - p1.length));
}
