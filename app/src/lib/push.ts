/**
 * Push notifications: this phone's token to the server, and a tap to the right screen.
 *
 * WHAT WAS MISSING (the founder, 2026-09-28): nothing reached a phone that was not open.
 * The server now wakes a phone for a new card that waits on you, for "they shared their
 * profile", for "you can talk now", for a message, and for "a card fades today" (server
 * push/index.ts). This file is the phone's half.
 *
 * ASKED WHEN IT MEANS SOMETHING, NOT AT LAUNCH. A permission prompt on the first screen
 * is the one people refuse. At launch the token is only sent if notifications are
 * already allowed; the question itself comes when the person first sends their agent
 * out -- the moment a card is about to wait on them (`ask: true`).
 *
 * LOADED AT THE CALL, NEVER AT THE TOP. expo-notifications is native, and a build made
 * before it was added must still start (tests/native-imports.test.ts). Such a build, or
 * one with no Expo project id yet (`eas init`), simply registers nothing.
 */
import { getApiBase } from './env';

let registered: string | null = null;

export type PushSetup = 'ok' | 'denied' | 'not_asked' | 'no_project' | 'unavailable' | 'failed';

export async function registerForPush(token: string, opts: { ask: boolean }): Promise<PushSetup> {
  try {
    const Notifications = await import('expo-notifications');
    const { Platform } = await import('react-native');
    const Constants = (await import('expo-constants')).default;
    // While the app is open the socket already shows what happened; no banner on top.
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false,
      }),
    });
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Matches and messages', importance: Notifications.AndroidImportance.HIGH,
      });
    }
    const projectId: string | undefined =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return 'no_project';
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      if (!opts.ask) return 'not_asked';
      ({ status } = await Notifications.requestPermissionsAsync());
    }
    if (status !== 'granted') return 'denied';
    const device = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    if (device === registered) return 'ok';
    const res = await fetch(`${getApiBase()}/v1/push/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ token: device, platform: Platform.OS === 'ios' ? 'ios' : 'android' }),
    });
    if (!res.ok) return 'failed';
    registered = device;
    return 'ok';
  } catch (err) {
    console.warn('[push]', err instanceof Error ? err.message : String(err));
    return 'unavailable';
  }
}

/** At sign-out: this phone must not keep waking the previous person's matches. */
export async function unregisterPush(token: string): Promise<void> {
  const device = registered;
  registered = null;
  if (!device) return;
  try {
    await fetch(`${getApiBase()}/v1/push/token`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ token: device }),
    });
  } catch {
    // Best effort, like sign-out itself: the next account on this phone takes the token.
  }
}

/**
 * Open the screen a tapped notification points at: now, for a tap while the app runs
 * or sits in the background, and once for the tap that launched it. Returns a stop.
 */
export async function listenForTaps(go: (route: string) => void): Promise<() => void> {
  try {
    const Notifications = await import('expo-notifications');
    const { routeForPush } = await import('../features/push/route');
    const open = (data: Record<string, unknown> | undefined) => {
      const to = routeForPush(data);
      if (to) go(to);
    };
    const last = await Notifications.getLastNotificationResponseAsync();
    if (last) {
      open(last.notification.request.content.data);
      await Notifications.clearLastNotificationResponseAsync();
    }
    const sub = Notifications.addNotificationResponseReceivedListener((r) => open(r.notification.request.content.data));
    return () => sub.remove();
  } catch {
    return () => {};
  }
}
