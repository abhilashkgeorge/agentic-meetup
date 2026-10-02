/**
 * The launch check (app/_layout.tsx), run again on request, and where its answer sends the
 * app.
 *
 * WHY AGAIN. When the server cannot be reached, the check stops at "Can't reach the
 * server" before it has looked for an account. Fixing the address there used to send the
 * app straight to '/', the town -- with no account loaded, so a signed-out phone sat on
 * "Finding the square..." with no way to sign in, and a signed-in one made its calls
 * without its credential (the Pixel, 2026-10-02, after a night off Wi-Fi). Now the screen
 * asks for the whole check again: account, consent, setup, in that order.
 */
import type { Href } from 'expo-router';
import { create } from 'zustand';

export type LaunchRoute = 'phone' | 'invite' | 'consent' | 'onboarding' | 'connect';

export const useLaunch = create<{ attempt: number; again: () => void }>((set) => ({
  /** How many times the check has been asked to run again since the app opened. */
  attempt: 0,
  again: () => set((s) => ({ attempt: s.attempt + 1 })),
}));

const PATHS: Record<LaunchRoute, Href> = {
  connect: '/connect', phone: '/phone', invite: '/invite', consent: '/consent', onboarding: '/onboarding',
};

/**
 * Where a finished check sends the app, or null to leave it where it is. Nothing to do on
 * the first check means the app opened where it should; nothing to do on a check run
 * again means the person is fully in, and is still on "Can't reach the server" -- so in
 * they go.
 */
export function launchTarget(route: LaunchRoute | null, attempt: number): Href | null {
  if (route) return PATHS[route];
  return attempt > 0 ? '/' : null;
}
