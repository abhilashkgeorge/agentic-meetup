/**
 * The bundler finds the copies LiveKit keeps for itself (metro.config.js ownCopy).
 *
 * WHAT WAS WRONG (the park's voice on the Seeker, 2026-09-29): Metro runs with
 * hierarchical lookup off, so it looks only in app/node_modules and the root's, never
 * in a package's own node_modules. @livekit/react-native keeps @livekit/components-react
 * (none at the root) and web-streams-polyfill 4 (the root has 3) there; the phone said
 * "Unable to resolve module @livekit/components-react" and the park had no voice.
 *
 * WHAT IS PINNED, with the real config and the resolver it hands to Metro (Metro's own
 * resolver stood in by one that records where it was told to look):
 *   - from inside a LiveKit package, every package it keeps for itself is looked for in
 *     its own node_modules first;
 *   - React is never, and nothing outside LiveKit changes where it looks.
 *
 * Negative control, run by hand and recorded in the commit: the redirect taken out of
 * resolveRequest -> "finds every copy LiveKit keeps" fails.
 */
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = join(import.meta.dirname, '..');
const ROOT_NM = join(APP, '..', 'node_modules');
const require = createRequire(import.meta.url);
const config = require(join(APP, 'metro.config.js')) as {
  resolver: { resolveRequest: (ctx: object, name: string, platform: string) => unknown };
};

const BASE = [join(APP, 'node_modules'), ROOT_NM];
/** Where the resolver told Metro to look, for `name` asked from `origin`. */
function looksIn(origin: string, name: string): readonly string[] {
  let seen: readonly string[] = [];
  const ctx = {
    originModulePath: origin,
    nodeModulesPaths: BASE,
    resolveRequest: (c: { nodeModulesPaths: readonly string[] }) => { seen = c.nodeModulesPaths; return { type: 'empty' }; },
  };
  config.resolver.resolveRequest(ctx, name, 'android');
  return seen;
}

/** Every package a LiveKit package keeps in its own node_modules, and who keeps it. */
function kept(): { owner: string; name: string; dir: string }[] {
  const out: { owner: string; name: string; dir: string }[] = [];
  const lk = join(ROOT_NM, '@livekit');
  for (const owner of readdirSync(lk)) {
    const nm = join(lk, owner, 'node_modules');
    if (!existsSync(nm)) continue;
    for (const entry of readdirSync(nm)) {
      if (entry.startsWith('.')) continue;
      const names = entry.startsWith('@') ? readdirSync(join(nm, entry)).map((n) => `${entry}/${n}`) : [entry];
      for (const name of names) if (existsSync(join(nm, name, 'package.json'))) out.push({ owner, name, dir: nm });
    }
  }
  return out;
}

describe('the bundler and LiveKit', () => {
  it('finds every copy LiveKit keeps for itself, from inside the package that keeps it', () => {
    const copies = kept().filter((c) => !c.owner.startsWith('rtc-'));   // rtc-node is the laptop bot's, never bundled
    expect(copies.map((c) => c.name), 'the case that broke the phone').toContain('@livekit/components-react');
    for (const c of copies) {
      const origin = join(ROOT_NM, '@livekit', c.owner, 'src', 'index.ts');
      expect(looksIn(origin, c.name)[0], `${c.name} from @livekit/${c.owner}`).toBe(c.dir);
      expect(looksIn(origin, `${c.name}/some/file`)[0]).toBe(c.dir);
    }
  });

  it('never splits React, and changes nothing outside LiveKit', () => {
    const origin = join(ROOT_NM, '@livekit', 'react-native', 'src', 'index.tsx');
    for (const name of ['react', 'react/jsx-runtime', 'react-native', 'react-dom']) expect(looksIn(origin, name)).toEqual(BASE);
    expect(looksIn(join(APP, 'src', 'features', 'world', 'voice-room.ts'), '@livekit/components-react')).toEqual(BASE);
    expect(looksIn(join(ROOT_NM, 'expo', 'src', 'index.ts'), 'web-streams-polyfill')).toEqual(BASE);
    expect(looksIn(origin, './relative')).toEqual(BASE);
  });
});
