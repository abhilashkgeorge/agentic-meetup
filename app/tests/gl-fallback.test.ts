/**
 * When the 3D renderer cannot load, Home must still be a screen.
 *
 * `loadWorldRenderer()` is the one door to expo-gl and the fiber renderer. A build
 * without their native halves throws on import; the door has to turn that into a
 * null, cached, so the town falls back to the plain Home instead of a red box.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-gl', () => { throw new Error('native module missing'); });

describe('loadWorldRenderer', () => {
  it('resolves null, and says why, when the GL view is not there', async () => {
    const r3f = await import('../src/features/world/r3f');
    r3f.resetWorldRenderer();
    expect(await r3f.loadWorldRenderer()).toBeNull();
    expect(r3f.rendererError).toMatch(/^expo-gl: /);
    // A failure is not remembered: the next ask tries again (and fails again here).
    expect(await r3f.loadWorldRenderer()).toBeNull();
    expect(r3f.rendererError).toMatch(/^expo-gl: /);
  });
});
