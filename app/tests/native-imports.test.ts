/**
 * A native module must never be imported at the top of a file.
 *
 * WHY. expo-router imports every route eagerly, and `lib/api.ts` is imported by almost
 * every screen. A top-level `import * as ImagePicker from 'expo-image-picker'` is
 * therefore evaluated at startup -- and if the native side is missing from the build,
 * it throws before anything renders:
 *
 *     Uncaught Error: Cannot find native module 'ExpoClipboard'
 *       at error-boundary.tsx:15
 *     Uncaught Error: Cannot find native module 'ExponentImagePicker'
 *       at photos-screen.tsx:13
 *
 * Both of those took down the WHOLE app -- one of them from inside the error boundary,
 * the component whose entire job is to be the thing still standing. Neither feature
 * was in use; neither screen had been opened.
 *
 * This happens for real whenever the JavaScript is ahead of the native build: a
 * dependency added without a rebuild, a simulator running yesterday's binary, a
 * TestFlight build from before the last `expo prebuild`. A partial native build should
 * cost the feature, not the product -- so these are loaded at the call site, inside a
 * try, where failing means one button does nothing.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dirname, '..', 'src');

/**
 * Packages whose JavaScript is a thin shim over a native module, so importing them
 * throws rather than degrading when the native half is absent.
 *
 * expo-router, expo-constants and friends are deliberately absent: they are part of
 * the app's own bootstrap, so there is no meaningful "later" to defer them to.
 */
const NATIVE = [
  'expo-clipboard',
  'expo-image-picker',
  'expo-document-picker',
  'expo-file-system',
  'expo-av',
  'expo-camera',
  'expo-haptics',
  'expo-notifications',
  'expo-speech',
  'expo-sharing',
  'expo-media-library',
];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

describe('native modules', () => {
  it('are loaded at the call site, never at the top of a file', () => {
    const offenders: string[] = [];

    for (const file of sources(SRC)) {
      const src = readFileSync(file, 'utf8');
      src.split('\n').forEach((line, i) => {
        // A STATIC import only: `await import(...)` inside a function is the fix, not
        // the fault, and it does not match this.
        const m = /^\s*import\s[^(]*?from\s+'([^']+)'/.exec(line);
        if (!m) return;
        if (!NATIVE.includes(m[1]!)) return;
        offenders.push(`${file.replace(SRC, 'src')}:${i + 1}  ${m[1]}`);
      });
    }

    expect(
      offenders,
      'these are evaluated at startup, so a build missing the native half cannot '
      + 'render ANY screen. Load them inside the function that uses them:\n'
      + '  const Mod = await import(\'…\');\n'
      + `and handle the throw.\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
