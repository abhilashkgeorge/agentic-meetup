import * as SecureStore from 'expo-secure-store';

/**
 * The bearer token is a credential, so it belongs in the keychain, not in
 * AsyncStorage. W6 replaces the dev token with a real JWT plus device revocation;
 * this interface does not change when that happens.
 */
const TOKEN_KEY = 'clone.token';

export async function getToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function setToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
  await SecureStore.deleteItemAsync('clone.onboarded').catch(() => {});
}

/**
 * Whether the two setup steps have been seen. Not a credential, but SecureStore is
 * already here and one store beats two. Cleared with the token, so a reset really
 * resets: a fresh credential with a stale "done" flag would strand someone on an
 * empty clone with no way back to setup.
 */
const ONBOARDED_KEY = 'clone.onboarded';

export async function isOnboarded(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(ONBOARDED_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function setOnboarded(): Promise<void> {
  await SecureStore.setItemAsync(ONBOARDED_KEY, '1').catch(() => {});
}

/**
 * The server address, when the person has had to set it by hand.
 *
 * Not a credential, but it lives here because one store is better than two and
 * because it must survive a restart -- the whole point is that you fix the address
 * once rather than every time you open the app.
 *
 * Deliberately NOT cleared with the token: someone signing out on a laptop tunnel
 * still wants the app pointed at that tunnel afterwards.
 */
const SERVER_KEY = 'clone.server';

export async function getServerUrl(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(SERVER_KEY);
  } catch {
    return null;
  }
}

export async function setServerUrl(url: string): Promise<void> {
  await SecureStore.setItemAsync(SERVER_KEY, url).catch(() => {});
}

export async function clearServerUrl(): Promise<void> {
  await SecureStore.deleteItemAsync(SERVER_KEY).catch(() => {});
}

/**
 * Light, dark, or whatever the phone says.
 *
 * Alongside the server address rather than with the credential: not a secret, but it
 * must survive a restart, and one store beats two. Deliberately NOT cleared on sign
 * out -- somebody who picked dark still wants dark on the door screen.
 */
const THEME_KEY = 'clone.theme';

export async function getTheme(): Promise<'system' | 'light' | 'dark' | null> {
  try {
    const v = await SecureStore.getItemAsync(THEME_KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : null;
  } catch {
    return null;
  }
}

export async function setTheme(choice: 'system' | 'light' | 'dark'): Promise<void> {
  await SecureStore.setItemAsync(THEME_KEY, choice).catch(() => {});
}

/**
 * The 3D fuse.
 *
 * A GL context that takes the process down leaves no error to catch -- the app is
 * simply gone. So the town writes `trying` here before it mounts the renderer and
 * clears it after the first frame; a leftover `trying` on the next launch means the
 * last attempt never drew, and Home falls back to the plain screen until the person
 * asks for 3D again from Settings.
 */
const GL_FUSE_KEY = 'clone.gl';

/**
 * ONE STRIKE IS NOT A CRASH.
 *
 * The fuse is written before the canvas mounts and cleared on its first frame, so a
 * leftover "trying" means the app went down in between -- which is what a GL context
 * that takes the process with it looks like. It is also what a force-stop, a Metro
 * reload and a swipe-away look like, and in a day of development that happens far
 * more often than a crash: the town turned itself off four times in an afternoon and
 * each time had to be switched back on by hand in Settings (2026-09-22).
 *
 * So it counts. One unexplained exit is forgiven and the town is tried again; two in
 * a row is a real crash loop and it falls back, which is the case the fuse exists for.
 * `strike` reports how many have been forgiven so far, for the row in Settings.
 */
export async function getGlFuse(): Promise<'trying' | 'off' | null> {
  try {
    const v = await SecureStore.getItemAsync(GL_FUSE_KEY);
    if (v === 'off') return 'off';
    if (v === 'trying') return 'trying';
    if (v === 'trying2') return 'off';
    return null;
  } catch {
    return null;
  }
}

/** A "trying" that survived a launch becomes the second strike; a third is "off". */
export async function strikeGlFuse(): Promise<void> {
  await SecureStore.setItemAsync(GL_FUSE_KEY, 'trying2').catch(() => {});
}

export async function setGlFuse(state: 'trying' | 'off' | null): Promise<void> {
  if (state === null) await SecureStore.deleteItemAsync(GL_FUSE_KEY).catch(() => {});
  else await SecureStore.setItemAsync(GL_FUSE_KEY, state).catch(() => {});
}

/**
 * "Easier on the battery": draw the town at 30 frames a second instead of the
 * phone's full rate. A preference, not a fuse -- nothing sets it but the person.
 */
const FPS30_KEY = 'clone.fps30';

export async function getFps30(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(FPS30_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function setFps30(on: boolean): Promise<void> {
  if (on) await SecureStore.setItemAsync(FPS30_KEY, '1').catch(() => {});
  else await SecureStore.deleteItemAsync(FPS30_KEY).catch(() => {});
}

/**
 * Whom you muted in the park (features/world/park-voice.ts): the refs the park gives
 * them to you, which are the same every visit. Not a credential; kept here for the same
 * reason as the server address, and not cleared with the token -- a muted nuisance
 * stays muted after signing in again. At most MUTED_MAX, which fits one stored value.
 */
const PARK_MUTED_KEY = 'clone.park-muted';

export async function getParkMuted(): Promise<string[]> {
  try {
    const raw = await SecureStore.getItemAsync(PARK_MUTED_KEY);
    const refs: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(refs) ? refs.filter((r): r is string => typeof r === 'string') : [];
  } catch {
    return [];
  }
}

export async function setParkMuted(refs: readonly string[]): Promise<void> {
  await SecureStore.setItemAsync(PARK_MUTED_KEY, JSON.stringify(refs)).catch(() => {});
}
