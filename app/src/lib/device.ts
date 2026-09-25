/**
 * Which phone this is, so a ban can hold against the handset (server 0065).
 *
 * A ban names the phone number AND the phone. A new SIM in the same phone is a new
 * number on the same handset, so the handset needs an id that a SIM does not change
 * and deleting the app does not reset:
 *   - Android: ANDROID_ID. Fixed per phone and app signing key since Android 8; it
 *     survives reinstalling and a new SIM. A factory reset makes a new one.
 *   - iPhone: a random id kept in the keychain, which -- unlike the vendor id --
 *     survives deleting the app. THIS_DEVICE_ONLY, so a backup restored onto another
 *     phone does not carry it there.
 * Sent only at the doors (phone verify, invite redeem, device signup, token upgrade)
 * as X-Device-Id. The server keeps a keyed hash of it, never the id.
 *
 * LOADED AT THE CALL, NEVER AT THE TOP. expo-application is native, and a build made
 * before it was added must still start (tests/native-imports.test.ts). Such a build
 * sends no id: a development server lets it in, a production one says "update the app".
 */
const KEY = 'clone.device';

let pending: Promise<string | null> | null = null;

/** This phone's id, read once per launch. Null when the build cannot say. */
export function deviceId(): Promise<string | null> {
  pending ??= read().catch(() => null);
  return pending;
}

async function read(): Promise<string | null> {
  const { Platform } = await import('react-native');
  if (Platform.OS === 'android') {
    const { getAndroidId } = await import('expo-application');
    return getAndroidId() || null;
  }
  if (Platform.OS !== 'ios') return null;
  const SecureStore = await import('expo-secure-store');
  const had = await SecureStore.getItemAsync(KEY);
  if (had) return had;
  const { randomUUID } = await import('expo-crypto');
  const made = randomUUID();
  await SecureStore.setItemAsync(KEY, made, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
  return made;
}

/** The header for a door, or none when this build cannot say which phone it is. */
export async function deviceHeader(): Promise<Record<string, string>> {
  const id = await deviceId();
  return id ? { 'X-Device-Id': id } : {};
}
