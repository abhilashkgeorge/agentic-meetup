/**
 * Which phone OS this is, for code that must load react-native lazily.
 *
 * WHY A FILE OF ITS OWN. lib/device.ts and lib/push.ts cannot import react-native at the
 * top (tests load lib/api.ts, which imports device.ts, under node, where react-native does
 * not load), and `await import('react-native')` copies every export of react-native into
 * a namespace -- reading each deprecated getter on the way, which printed five warnings
 * (ProgressBarAndroid, SafeAreaView, Clipboard, InteractionManager, PushNotificationIOS)
 * on every launch (Metro's log, 2026-09-28). A lazy import of THIS file copies only what
 * it exports; the named import below reads only Platform.
 */
import { Platform } from 'react-native';

export const platformOS = (): string => Platform.OS;
