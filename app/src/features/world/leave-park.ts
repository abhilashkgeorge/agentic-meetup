/**
 * Leaving the park for another tab asks first, and says what happens: you stay in the
 * park PARK_AWAY_MS, then you are out of it (the founder, 2026-10-03: "show a dialog
 * showing you are exiting the park and will be exited from the park"). Not in the park,
 * or already away, the tab simply opens. The tab bar asks (app/(tabs)/_layout.tsx).
 */
import { PARK_AWAY_MS } from '@clone/shared';

export const LEAVE_PARK = {
  title: 'Leave Cubbon Park?',
  body: `People there will still see you for ${PARK_AWAY_MS / 1000} seconds. Come back before then and you carry on where you were. After that, you are out of the park.`,
  stay: 'Stay',
  leave: 'Leave',
} as const;

/** Whether opening another tab should ask first: only from inside the park. */
export function asksBeforeLeaving(park: { inPark: boolean; away: boolean }): boolean {
  return park.inPark && !park.away;
}
