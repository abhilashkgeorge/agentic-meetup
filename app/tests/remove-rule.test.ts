/**
 * Any rule can be removed, a must-have too (the founder, 2026-09-29; server
 * tests/rule-clashes.test.ts pins the route).
 *
 * WHAT WAS WRONG: "Looking for" offered Must have / Really want / Nice to have on each
 * rule and nothing else, so a must-have could never go.
 *
 * WHY THE SOURCE, NOT THE SCREEN: no React Native renderer under vitest (safety.test.ts).
 *
 * Negative control, run by hand and recorded in the commit: the must-have list's Remove
 * chip removed -> "on every rule" fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const code = (f: string) => readFileSync(join(import.meta.dirname, '..', 'src', f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('a rule on "Looking for"', () => {
  it('has Remove on every rule, must-haves and wants alike, asked first', () => {
    const screen = code('features/preferences/preferences-screen.tsx');
    const chips = screen.match(/<Chip label="Remove" selected=\{false\} disabled=\{busy === x\.id\} onPress=\{\(\) => remove\(x\)\} \/>/g) ?? [];
    expect(chips, 'a list of rules has no Remove').toHaveLength(2);
    expect(screen).toMatch(/'Remove this rule\?'/);
    expect(screen).toMatch(/removePreference\(token, x\.id\)/);
    expect(code('lib/api.ts')).toMatch(/post<\{ ok: boolean; total: number \| null \}>\('\/v1\/preferences\/remove'/);
  });
});
