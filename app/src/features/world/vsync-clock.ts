/**
 * The town's frame clock: one frame per screen refresh, ticked by the UI thread.
 *
 * WHY NOT requestAnimationFrame. React Native's rAF is a zero-delay timer that native
 * fires on the first Choreographer frame whose time is past the moment the timer was
 * made (JavaTimerManager). On the Pixel 6a (2026-09-30) it settled, after about half of
 * the returns to the town, at every second or fourth refresh and stayed there: 30 or 15
 * fps with the JS thread two-thirds idle and a frame costing 10 ms. A bare rAF chain run
 * beside the renderer did the same, so it was never the scene. In the same state the UI
 * thread's own frame callback -- a worklet's rAF, on the UI runtime -- kept every refresh,
 * and a call from it into JS arrived every 16.6 ms. So the town asks the UI thread.
 *
 * ONE TICK IN FLIGHT. The UI thread refreshes whether or not JS kept up, so it sends a
 * tick only when the last one has come back: JS answers every tick, drawn or not, and a
 * refresh that finds one still out sends nothing. A slow frame costs the refreshes it
 * overran and no more -- never a queue of ticks drawn back to back once JS is free (a
 * six-second stall would otherwise leave 360 of them).
 *
 * ONE LOOP. A generation number on the UI runtime: starting bumps it, and a loop whose
 * number is not the current one stops at its next refresh, so a start while running, or a
 * Fast Refresh, never leaves two loops ticking.
 */
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

type UiGlobals = { __townVsync?: number; __townTickOut?: boolean };

let onFrame: ((nowMs: number) => void) | null = null;
let every = 1;
let count = 0;

/** On the UI runtime: the tick is back, the next refresh may send one. */
function tickBack(): void {
  'worklet';
  (globalThis as unknown as UiGlobals).__townTickOut = false;
}

/** Runs on the JS thread, once per tick the UI thread sent. Always answers it. */
export function tick(): void {
  try {
    if (onFrame && ++count % every === 0) onFrame(performance.now());
  } finally {
    scheduleOnUI(tickBack);
  }
}

/**
 * Tick `frame` once per refresh (`everyOther`: once per two, the "30 fps" setting) until
 * stopVsync. Replaces whatever was ticking before.
 */
export function startVsync(frame: (nowMs: number) => void, everyOther = false): void {
  onFrame = frame;
  every = everyOther ? 2 : 1;
  count = 0;
  scheduleOnUI(() => {
    'worklet';
    const g = globalThis as unknown as UiGlobals;
    const mine = (g.__townVsync ?? 0) + 1;
    g.__townVsync = mine;
    g.__townTickOut = false;
    const loop = () => {
      if (g.__townVsync !== mine) return;
      if (!g.__townTickOut) {
        g.__townTickOut = true;
        scheduleOnRN(tick);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
}

export function stopVsync(): void {
  onFrame = null;
  scheduleOnUI(() => {
    'worklet';
    const g = globalThis as unknown as UiGlobals;
    g.__townVsync = (g.__townVsync ?? 0) + 1;
  });
}
