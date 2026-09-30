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
 * tick only when the last one has been taken: JS marks every tick taken as it starts it,
 * drawn or not, and a refresh that finds one still waiting sends nothing. So at most one
 * tick waits behind the frame being drawn, and a stall costs the refreshes it overran --
 * never a queue of ticks drawn back to back once JS is free (a six-second stall would
 * otherwise leave 360 of them).
 *
 * THE MARK IS SHARED MEMORY, not a message. It was a call back to the UI runtime, and
 * such a call is run at the UI thread's next frame -- after that frame's own check had
 * already found the tick still out, so about every other refresh was skipped: 77 fps on
 * the Seeker's 120 Hz screen, where r3f's own loop held 119 (measured 2026-09-30). A
 * Synchronizable is read by the UI thread directly, at once.
 *
 * ONE LOOP. A generation number on the UI runtime: starting bumps it, and a loop whose
 * number is not the current one stops at its next refresh, so a start while running, or a
 * Fast Refresh, never leaves two loops ticking.
 */
import { createSynchronizable, scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

type UiGlobals = { __townVsync?: number };

/** True from the UI thread sending a tick until JS takes it. Read by both threads directly. */
const tickOut = createSynchronizable(false);

let onFrame: ((nowMs: number) => void) | null = null;
let every = 1;
let count = 0;

/** Runs on the JS thread, once per tick the UI thread sent. Takes it first, then draws. */
export function tick(): void {
  tickOut.setBlocking(false);
  if (onFrame && ++count % every === 0) onFrame(performance.now());
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
    tickOut.setBlocking(false);
    const loop = () => {
      if (g.__townVsync !== mine) return;
      if (!tickOut.getDirty()) {
        tickOut.setBlocking(true);
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
