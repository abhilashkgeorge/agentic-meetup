/**
 * The loading placeholders' one shared pulse (components/ui/skeleton.tsx).
 *
 * WHY (the founder, 2026-10-02: "add a skeleton loading screen when something is loading
 * please ... even the maps"): the old placeholder was a still grey bar. Now every bar on
 * screen breathes together off ONE animation on the native driver. What could go wrong is
 * cost and stickiness: a loop per bar (forty loops on a list), a loop left running after
 * the last bar went, or motion for someone who turned on Reduce Motion.
 *
 * WHAT IS PINNED, with React Native's Animated stood in by a fake that counts loops started
 * and stopped (the code under test is the real skeleton.tsx):
 *   - the first placeholder starts one loop; more placeholders start no more;
 *   - letting go twice counts once; the last one to go stops the loop;
 *   - under Reduce Motion nothing starts, and turning it off with bars up starts it;
 *   - the animation runs on the native driver.
 *
 * Negative control, run by hand and recorded in the commit: holdPulse() starting a loop on
 * every call -> "one loop for any number" fails.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ started: 0, stopped: 0, native: [] as boolean[] }));

vi.mock('react-native', () => {
  class Value { v: number; constructor(v: number) { this.v = v; } setValue(v: number) { this.v = v; } }
  const anim = () => ({ start: () => { fake.started++; }, stop: () => { fake.stopped++; } });
  return {
    Animated: {
      Value,
      View: 'Animated.View',
      timing: (_v: unknown, cfg: { useNativeDriver: boolean }) => { fake.native.push(cfg.useNativeDriver); return anim(); },
      sequence: () => anim(),
      loop: () => anim(),
    },
    Easing: { inOut: () => () => 0, quad: () => 0 },
    AccessibilityInfo: { isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove() {} }) },
    View: 'View',
    useColorScheme: () => 'light',
  };
});

// The palette's theme store reaches the phone's storage, which a test has none of.
vi.mock('../src/store/theme', () => ({ useTheme: (pick: (s: { choice: string }) => unknown) => pick({ choice: 'system' }) }));

const { holdPulse, pulseState, setStill } = await import('../src/components/ui/skeleton');

describe('the placeholders\' pulse', () => {
  beforeEach(() => {
    setStill(false);
    // Nothing held from the test before.
    expect(pulseState().users).toBe(0);
    fake.started = 0;
    fake.stopped = 0;
  });

  it('is one loop for any number of placeholders, stopped when the last one goes', () => {
    const lets = Array.from({ length: 40 }, () => holdPulse());
    expect(fake.started, 'one loop for any number').toBe(1);
    expect(pulseState()).toEqual({ users: 40, running: true });
    for (const go of lets.slice(0, 39)) go();
    expect(pulseState().running, 'stopped while a placeholder was still up').toBe(true);
    lets[0]!();
    expect(pulseState().users, 'letting go twice counted twice').toBe(1);
    lets[39]!();
    expect(pulseState()).toEqual({ users: 0, running: false });
    expect(fake.stopped).toBe(1);
  });

  it('does not move under Reduce Motion, and starts when it is turned off with bars up', () => {
    setStill(true);
    const go = holdPulse();
    expect(fake.started).toBe(0);
    expect(pulseState().running).toBe(false);
    setStill(false);
    expect(fake.started).toBe(1);
    setStill(true);
    expect(pulseState().running).toBe(false);
    go();
    setStill(false);
    expect(fake.started, 'started with nothing on screen').toBe(1);
  });

  it('runs on the native driver', () => {
    const go = holdPulse();
    go();
    expect(fake.native.length).toBeGreaterThan(0);
    expect(fake.native.every(Boolean)).toBe(true);
  });
});
