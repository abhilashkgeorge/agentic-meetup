/**
 * The one door into the 3D renderer.
 *
 * `expo-gl` and `@react-three/fiber/native` are JavaScript shims over native code, and
 * a static import of either is evaluated at startup: a build missing the native half
 * cannot render ANY screen, not just the town (the rule tests/native-imports.test.ts
 * enforces). So they are loaded here, on demand, inside a try -- the same shape as
 * lib/location.ts -- and the screen that asked gets either a renderer or null, and
 * draws the old Home in the null case. `./canvas` is the only file allowed to import
 * three and r3f at the top, because it is only ever reached through this function.
 */
import type { WorldCanvas as WorldCanvasType } from './canvas';

export interface WorldRenderer {
  WorldCanvas: typeof WorldCanvasType;
}

let cached: WorldRenderer | null | undefined;

export async function loadWorldRenderer(): Promise<WorldRenderer | null> {
  if (cached !== undefined) return cached;
  try {
    // Order matters: the GL view is what the fiber renderer stands on, so if this one
    // throws there is no point evaluating the rest.
    await import('expo-gl');
    await import('@react-three/fiber/native');
    const mod = await import('./canvas');
    cached = { WorldCanvas: mod.WorldCanvas };
  } catch {
    cached = null;
  }
  return cached;
}

/** For tests and the bench: forget the answer so the next call asks again. */
export function resetWorldRenderer(): void {
  cached = undefined;
}
