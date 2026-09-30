/**
 * The town's frame clock (src/features/world/vsync-clock.ts). The UI side is a worklet
 * and runs only on a phone; what JS does with a tick, and the UI loop's one rule, are
 * checked here.
 *
 * Negative controls, run by hand and recorded in the commit: tick() without answering the
 * UI thread -> "always answers" fails; the UI loop sending without checking the tick
 * still out -> "one tick in flight" fails; the canvas back on r3f's own loop -> "draws
 * the town" fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const worklets = vi.hoisted(() => ({ scheduleOnUI: vi.fn(), scheduleOnRN: vi.fn() }));
vi.mock('react-native-worklets', () => worklets);
const { startVsync, stopVsync, tick } = await import('../src/features/world/vsync-clock');

let now = 1000;
vi.spyOn(performance, 'now').mockImplementation(() => now);
beforeEach(() => worklets.scheduleOnUI.mockClear());
afterEach(() => stopVsync());

/** Ticks at the given times; the times a frame was drawn. */
function run(at: number[], everyOther = false): number[] {
  const drawn: number[] = [];
  startVsync((t) => drawn.push(t), everyOther);
  for (const t of at) { now = t; tick(); }
  return drawn;
}

describe('the town frame clock', () => {
  it('draws one frame per tick', () => {
    expect(run([2000, 2016.6, 2033.3, 2050])).toEqual([2000, 2016.6, 2033.3, 2050]);
  });

  it('draws every other tick with the 30 fps setting', () => {
    expect(run([4000, 4016.6, 4033.3, 4050, 4066.6], true)).toEqual([4016.6, 4050]);
  });

  it('always answers the UI thread, drawn, skipped or thrown', () => {
    startVsync(() => {}, true);
    worklets.scheduleOnUI.mockClear();
    tick(); tick(); // one skipped, one drawn
    expect(worklets.scheduleOnUI).toHaveBeenCalledTimes(2);
    stopVsync();
    worklets.scheduleOnUI.mockClear();
    tick(); // stopped
    expect(worklets.scheduleOnUI).toHaveBeenCalledTimes(1);
    startVsync(() => { throw new Error('a frame that fails'); });
    worklets.scheduleOnUI.mockClear();
    expect(() => tick()).toThrow('a frame that fails');
    expect(worklets.scheduleOnUI).toHaveBeenCalledTimes(1);
  });

  it('sends one tick in flight: the UI loop waits for the answer', () => {
    const src = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'world', 'vsync-clock.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src).toMatch(/if \(!g\.__townTickOut\) \{\s*g\.__townTickOut = true;\s*scheduleOnRN\(tick\);\s*\}/);
    expect(src).toMatch(/finally \{\s*scheduleOnUI\(tickBack\);\s*\}/);
  });

  it('draws the town: the canvas has no loop of its own, and the ticker advances it', () => {
    const canvas = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'world', 'canvas.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(canvas).toMatch(/<Canvas[^>]*frameloop="never"/);
    expect(canvas).toContain('<RefreshTicker active={active} cap30={cap30} />');
    expect(canvas).toMatch(/startVsync\(\(now\) => \{[\s\S]*?advance\(state\.clock\.elapsedTime \+ dt, true, state\);[\s\S]*?\}, cap30\);/);
  });
});
