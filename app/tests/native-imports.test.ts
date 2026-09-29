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
import { dirname, join } from 'node:path';

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
  'expo-location',
  // The handset id for bans that stick (lib/device.ts), added 2026-09-25: a build made
  // before it must still start.
  'expo-application',
  // The 3D renderer. The GL view and the fiber renderer on top of it are native shims
  // like the rest; a static import on the Home tab root would be exactly the eager
  // startup this file exists to prevent.
  'expo-gl',
  '@react-three/fiber',
  '@react-three/fiber/native',
  // The park's voice (features/world/voice-room.ts), added 2026-09-29: the WebRTC engine
  // and LiveKit over it. livekit-client itself is plain JavaScript, but it must come after
  // registerGlobals(), which is the native half's.
  '@livekit/react-native',
  '@livekit/react-native-webrtc',
  'livekit-client',
];

/**
 * Files that MAY import the packages above at the top, because nothing imports them
 * statically in turn: they are reached only through a dynamic `import()` behind a try
 * (features/world/r3f.ts). The second test below is what keeps that true.
 */
const LAZY_ONLY = [
  'features/world/canvas.tsx',
  'features/world/map-mesh.ts',
  'features/world/garden-mesh.ts',
  'features/world/character-mesh.ts',
  'features/world/venue-mesh.ts',
  'features/world/crowd-gpu.ts',
  'features/world/character-canvas.tsx',
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
      if (LAZY_ONLY.some((l) => file.endsWith(l))) continue;
      const src = readFileSync(file, 'utf8');
      src.split('\n').forEach((line, i) => {
        // A STATIC import only: `await import(...)` inside a function is the fix, not
        // the fault. It cannot match, because every pattern here demands whitespace
        // after the keyword and a dynamic import is written `import(`.
        //
        // THE `from` IS OPTIONAL, AND THAT WAS A HOLE. This matched only
        // `import X from 'pkg'`, so a bare side-effect `import 'pkg'` -- which is
        // evaluated at startup in exactly the same way and kills the app in exactly
        // the same way -- walked straight past the guard. Found by deliberately
        // re-breaking it: the planted import passed. A require() does the same thing
        // and is caught for the same reason.
        const m = /^\s*import\s+(?:[^(]*?\sfrom\s+)?'([^']+)'/.exec(line)
          ?? /\brequire\(\s*'([^']+)'\s*\)/.exec(line);
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

  it('are behind a dynamic import: nothing imports the lazy-only files statically', () => {
    const offenders: string[] = [];
    for (const file of sources(SRC)) {
      if (LAZY_ONLY.some((l) => file.endsWith(l))) continue;
      const src = readFileSync(file, 'utf8');
      src.split('\n').forEach((line, i) => {
        // Type-only imports are erased and evaluate nothing; r3f.ts uses one.
        if (/^\s*import\s+type\b/.test(line)) return;
        const m = /^\s*import\s+(?:[^(]*?\sfrom\s+)?'(\.[^']+)'/.exec(line);
        if (!m) return;
        const target = join(dirname(file), m[1]!).replace(/\.tsx?$/, '');
        if (LAZY_ONLY.some((l) => target.endsWith(l.replace(/\.tsx?$/, '')))) {
          offenders.push(`${file.replace(SRC, 'src')}:${i + 1}  ${m[1]}`);
        }
      });
    }
    expect(
      offenders,
      'these pull the 3D renderer in at startup. Go through loadWorldRenderer() in '
      + `features/world/r3f.ts instead:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('react-native itself is never imported whole: no import() and no import * of it', () => {
    // import('react-native') and `import * as X from 'react-native'` copy every export
    // into a namespace object, which reads every deprecated getter react-native still
    // carries -- five "has been deprecated / extracted" warnings in Metro's log on every
    // launch (2026-09-28, from lib/push.ts). A named import reads only what it names;
    // code that must load it lazily goes through lib/platform.ts.
    // Negative control, 2026-09-28: push.ts back on import('react-native') -> fails.
    const offenders: string[] = [];
    for (const file of sources(SRC)) {
      // Code only: the files that explain the rule quote the pattern in their comments.
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
      // `typeof import('react-native')` is a type, erased before anything runs.
      if (/(?<!typeof\s)\bimport\(\s*'react-native'\s*\)|import\s+\*\s+as\s+\w+\s+from\s+'react-native'/.test(code)) {
        offenders.push(file.replace(SRC, 'src'));
      }
    }
    expect(offenders, 'import react-native by name instead').toEqual([]);
  });
});
