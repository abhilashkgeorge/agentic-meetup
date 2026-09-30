/**
 * The town's frame clock (src/features/world/vsync-clock.ts). The UI side is a worklet
 * and runs only on a phone; what JS does with a tick, and the UI loop's one rule, are
 * checked here.
 *
 * Negative controls, run by hand and recorded in the commit: tick() without taking the
 * tick -> "takes every tick" fails; the UI loop sending without checking the tick still
 * out -> "one tick in flight" fails; the flag back to a message to the UI runtime ->
 * "shared memory" fails; the canvas back on r3f's own loop -> "draws the town" fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const worklets = vi.hoisted(() => {
  const flag = { value: false, sets: [] as boolean[] };
  return {
    flag,
    scheduleOnUI: vi.fn(),
    scheduleOnRN: vi.fn(),
    createSynchronizable: vi.fn(() => ({
      getDirty: () => flag.value,
      setBlocking: (v: boolean) => { flag.value = v; flag.sets.push(v); },
    })),
  };
});
vi.mock('react-native-worklets', () => worklets);
const { startVsync, stopVsync, tick } = await import('../src/features/world/vsync-clock');

let now = 1000;
vi.spyOn(performance, 'now').mockImplementation(() => now);
afterEach(() => stopVsync());

/** Ticks at the given times; the times a frame was drawn. */
function run(at: number[], everyOther = false): number[] {
  const drawn: number[] = [];
  startVsync((t) => drawn.push(t), everyOther);
  for (const t of at) { now = t; tick(); }
  return drawn;
}
const source = (...p: string[]) => readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'world', ...p), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('the town frame clock', () => {
  it('draws one frame per tick', () => {
    expect(run([2000, 2016.6, 2033.3, 2050])).toEqual([2000, 2016.6, 2033.3, 2050]);
  });

  it('draws every other tick with the 30 fps setting', () => {
    expect(run([4000, 4016.6, 4033.3, 4050, 4066.6], true)).toEqual([4016.6, 4050]);
  });

  it('takes every tick before drawing it, drawn, skipped or thrown', () => {
    startVsync(() => { expect(worklets.flag.value, 'drew before taking the tick').toBe(false); }, true);
    worklets.flag.sets.length = 0;
    worklets.flag.value = true; tick(); // skipped (every other)
    worklets.flag.value = true; tick(); // drawn
    expect(worklets.flag.sets).toEqual([false, false]);
    startVsync(() => { throw new Error('a frame that fails'); });
    worklets.flag.value = true;
    expect(() => tick()).toThrow('a frame that fails');
    expect(worklets.flag.value, 'a frame that threw left its tick out for ever').toBe(false);
  });

  it('sends one tick in flight: the UI loop waits until the last is taken', () => {
    expect(source('vsync-clock.ts')).toMatch(/if \(!tickOut\.getDirty\(\)\) \{\s*tickOut\.setBlocking\(true\);\s*scheduleOnRN\(tick\);\s*\}/);
  });

  it('keeps the flag in shared memory, not in a message to the UI runtime', () => {
    const src = source('vsync-clock.ts');
    expect(src).toContain('const tickOut = createSynchronizable(false);');
    expect(src).toMatch(/export function tick\(\): void \{\s*tickOut\.setBlocking\(false\);/);
  });

  it('draws the town: the canvas has no loop of its own, and the ticker advances it', () => {
    const canvas = source('canvas.tsx');
    expect(canvas).toMatch(/<Canvas[^>]*frameloop="never"/);
    expect(canvas).toContain('<RefreshTicker active={active} cap30={cap30} />');
    expect(canvas).toMatch(/startVsync\(\(now\) => \{[\s\S]*?advance\(state\.clock\.elapsedTime \+ dt, true, state\);[\s\S]*?\}, cap30\);/);
  });
});
