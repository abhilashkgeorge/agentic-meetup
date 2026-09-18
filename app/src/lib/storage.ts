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

export async function getGlFuse(): Promise<'trying' | 'off' | null> {
  try {
    const v = await SecureStore.getItemAsync(GL_FUSE_KEY);
    return v === 'trying' || v === 'off' ? v : null;
  } catch {
    return null;
  }
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
