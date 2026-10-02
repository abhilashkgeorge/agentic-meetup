import { Stack, useRouter, useSegments, type Href } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { useEffect, useRef, useState } from 'react';
import {
  clearToken, getToken, setToken as persistToken, isOnboarded, getServerUrl, setServerUrl,
} from '../lib/storage';
import { getConsent, isLegacyToken, onTokenRejected, upgradeToken } from '../lib/api';
import { defaultBase, getApiBase, pingServer, setApiBase } from '../lib/env';
import { useSession } from '../store/session';
import { launchTarget, useLaunch, type LaunchRoute } from '../store/launch';
import { startSocket } from '../lib/socket';
import { listenForTaps, registerForPush } from '../lib/push';
import {
  SourceSans3_400Regular, SourceSans3_600SemiBold, SourceSans3_700Bold, useFonts,
} from '@expo-google-fonts/source-sans-3';
import * as SplashScreen from 'expo-splash-screen';
import { usePalette, useIsDark } from '../components/ui';
import { useTheme } from '../store/theme';
import { ErrorBoundary } from '../components/error-boundary';
import { TownLoading } from '../features/world/town-loading';

/**
 * Root stack. The tabs are one screen inside it; onboarding is another, so it can be
 * full-screen with no tab bar. Onboarding is a route rather than a modal because it
 * has two steps and the person may leave and come back to it.
 */
export default function RootLayout() {
  const setToken = useSession((s) => s.setToken);
  const p = usePalette();
  const isDark = useIsDark();

  // Read the stored light/dark choice before anything paints, so a person who chose
  // light does not get a dark frame for the first few hundred milliseconds.
  const loadTheme = useTheme((s) => s.load);
  const themeLoaded = useTheme((s) => s.loaded);
  useEffect(() => { void loadTheme(); }, [loadTheme]);
  const router = useRouter();
  const segments = useSegments();
  // The typeface the design spec names. Held behind the splash rather than swapped in
  // after first paint -- a font that arrives late reflows every screen at once.
  const [fontsReady] = useFonts({
    SourceSans3_400Regular, SourceSans3_600SemiBold, SourceSans3_700Bold,
  });
  const [checked, setChecked] = useState(false);
  const [route, setRoute] = useState<LaunchRoute | null>(null);
  // Bumped by "Can't reach the server" once the address works: the check runs again
  // from the top (store/launch.ts says why).
  const attempt = useLaunch((s) => s.attempt);

  // Accounts come from invite codes now. No self-signup, so a device with no
  // credential goes to the door rather than quietly minting a tenant.
  useEffect(() => {
    if (attempt > 0) setChecked(false);
    void (async () => {
      // The address the person saved, if they ever had to set one. Applied before any
      // request is made, or the first call goes to the wrong place and the app decides
      // it is offline.
      const saved = await getServerUrl();
      if (saved) setApiBase(saved);

      // Reachability is checked FIRST and separately from auth. Conflating them is
      // how "the server is on a laptop that went to sleep" became "your account is
      // broken" -- two very different problems with one useless message.
      let reachable = await pingServer(getApiBase());

      // A SAVED address that has stopped working must not be sticky.
      //
      // Development tunnels get a new hostname every restart, so an address typed in
      // last week is dead this week -- and because saved beats built-in, the app kept
      // dialling the dead one forever and made somebody retype it every time. Falling
      // back to what the build knows costs one request and fixes the common case
      // silently.
      if (!reachable && saved) {
        const built = defaultBase();
        if (built !== getApiBase() && (await pingServer(built))) {
          setApiBase(built);
          await setServerUrl(built);
          reachable = true;
        }
      }

      if (!reachable) {
        setRoute('connect');
        setChecked(true);
        return;
      }

      const existing = await getToken();

      if (!existing) {
        // THE NUMBER, NOT THE CODE, IS THE FIRST DOOR NOW.
        //
        // It used to be the invite screen, which made the account the device: a lost
        // phone was a lost clone and a second phone was a second clone. Starting here
        // means somebody returning on new hardware types their number, gets a code
        // and lands back in the account they already had, and never sees an invite at
        // all. The invite is still the gate for people nobody has met -- it is simply
        // the second screen rather than the first.
        setRoute('phone');
        setChecked(true);
        return;
      }

      // A device holding the old unsigned credential trades it in silently. Without
      // this, closing signup would strand every device that already has one --
      // including the founder's, which carries all the dogfooding data.
      let token = existing;
      if (isLegacyToken(token)) {
        const upgraded = await upgradeToken(token);
        if (upgraded) {
          await persistToken(upgraded);
          token = upgraded;
        }
        // If the upgrade fails we keep the old token and try again next launch. The
        // server still accepts it today; losing the account would be worse than
        // running one more day on the weaker credential.
      }

      setToken(token);

      // A session that the server no longer accepts -- revoked, expired, or the keys
      // rotated -- is a dead end unless somebody acts on it. Before this, every call
      // just returned null and the app waited for ever on a spinner. Forget the
      // credential and send them back to the door.
      onTokenRejected(() => {
        void (async () => {
          await clearToken();
          setToken(null);
          // The phone-number door, the same one a device with no token starts at:
          // typing the number lands back in the account that already exists.
          router.replace('/phone');
        })();
      });

      // CONSENT BEFORE SETUP, and before anything else this account can do. The
      // server refuses to put an agent in the pool without it (0039), so a person who
      // skipped it would finish onboarding, tap "send my agent out" and be told no,
      // with nothing on screen explaining why. Asked first, it is three short
      // paragraphs; asked last, it is a dead end.
      //
      // A server that cannot be reached here is treated as "not yet asked" rather
      // than "already agreed": the failure then shows up as this screen again next
      // launch, instead of as a record of consent nobody gave.
      //
      // THE CODE DID THE OPPOSITE OF WHAT THAT PARAGRAPH SAYS. `getConsent` returns
      // null for every failure -- offline, a 500, an expired token -- and the old
      // condition was `consent && !consent.settled`, so null fell straight through to
      // the app. The gate opened when the check failed. Reachability is already
      // established a few lines above, so a null here is a genuine fault and the only
      // safe reading of a fault is "we do not know that they agreed".
      const consent = await getConsent(token);
      if (!consent || !consent.settled) {
        setRoute('consent');
        setChecked(true);
        return;
      }

      setRoute((await isOnboarded()) ? null : 'onboarding');
      setChecked(true);
    })();
  }, [setToken, attempt]);

  // Redirect ONCE per check, after it. Reading state first avoids the flash of the chat
  // screen that a render-time redirect would produce.
  //
  // The `sent` ref is what makes "once" true: it holds the check whose answer was carried
  // out. Without it this fires again every time the route changes, so finishing
  // onboarding and navigating to the app immediately bounced back here -- the decision
  // was made at launch and then enforced for ever, against a person who had since done
  // the thing it was waiting for. A check run again is a new decision, carried out once.
  const sent = useRef(-1);
  useEffect(() => {
    if (!checked || sent.current === attempt) return;
    if (route && segments[0] === route) return;
    sent.current = attempt;
    const to = launchTarget(route, attempt);
    if (to) router.replace(to);
  }, [checked, route, segments, router, attempt]);

  // The launch screen goes as soon as the type is in; the check that follows can take
  // seconds over a slow connection, and it was a blank white page all that time (the
  // Pixel, 2026-10-03: nine seconds and more). The town's own shape stands there instead,
  // since the town is where nearly every launch lands (town-loading.tsx).
  useEffect(() => {
    if (fontsReady && themeLoaded) void SplashScreen.hideAsync();
  }, [fontsReady, themeLoaded]);

  // ONE socket for the whole app, opened here rather than by whichever screen happens
  // to need it. A socket owned by a screen closes when you navigate away from it --
  // which is exactly when a message from the other person is most likely to arrive.
  const token = useSession((s) => s.token);
  const sessionId = useSession((s) => s.sessionId);
  useEffect(() => startSocket(token, sessionId), [token, sessionId]);

  // PUSH, once the person is fully in (lib/push.ts): send this phone's token if
  // notifications are already allowed -- the question itself is asked when they first
  // send their agent out -- and open the screen a tapped notification points at.
  const signedIn = checked && route === null && token !== null;
  useEffect(() => {
    if (!signedIn || !token) return;
    void registerForPush(token, { ask: false });
    let stop = () => {};
    void listenForTaps((to) => router.push(to as Href)).then((s) => { stop = s; });
    return () => stop();
  }, [signedIn, token, router]);

  if (!fontsReady || !themeLoaded) return null;

  return (
    <ErrorBoundary>
      {/* The clock and battery have to be legible on whichever ground is behind
          them, so this follows the choice rather than the system. */}
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: p.bg },
          headerTintColor: p.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: p.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        {/* Both doors are gates, so neither can be swiped past. The verify screen is
            the one exception: going back from it means "wrong number", which is a
            thing people genuinely need to do. */}
        <Stack.Screen name="phone" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="verify" options={{ headerShown: false }} />
        <Stack.Screen name="invite" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="connect" options={{ headerShown: false }} />
        {/* gestureEnabled false, like the invite door: this is a gate, and a gate you
            can swipe past is decoration. */}
        <Stack.Screen name="consent" options={{ headerShown: false, gestureEnabled: false }} />
        {/* These draw their own header. Without this the stack puts its own bar on top
            of it, showing the route pattern -- "dm/[id]" -- above the person's name. */}
        <Stack.Screen name="dm/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="photos" options={{ headerShown: false }} />
        <Stack.Screen name="edit/[predicate]" options={{ headerShown: false }} />
        <Stack.Screen name="match/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="you" options={{ headerShown: false }} />
        <Stack.Screen name="preferences" options={{ headerShown: false }} />
        <Stack.Screen name="appearance" options={{ headerShown: false }} />
        <Stack.Screen name="stories" options={{ headerShown: false }} />
        <Stack.Screen name="question" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ headerShown: false }} />
        <Stack.Screen name="admin" options={{ headerShown: false }} />
        <Stack.Screen name="funnel" options={{ headerShown: false }} />
        <Stack.Screen name="character" options={{ headerShown: false }} />
        <Stack.Screen name="selfie" options={{ headerShown: false }} />
        {/* Hidden: the 3D frame-rate check, reached from Settings. Draws its own header. */}
        <Stack.Screen name="dev/gl" options={{ headerShown: false }} />
      </Stack>
      {/* Over everything until the launch check has decided where to go: the town's
          shape, not a white page, and not a screen the check may be about to leave. */}
      {!checked && <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}><TownLoading /></View>}
    </ErrorBoundary>
  );
}
