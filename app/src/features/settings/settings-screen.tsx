/**
 * Settings.
 *
 * Every real app has one and its absence is felt immediately — there is nowhere to
 * see who you are signed in as, nowhere to hand out an invite, nowhere to leave.
 *
 * The two rows that matter are at the bottom: export everything, and delete
 * everything. Both already work server-side and neither was reachable from the app,
 * which is the same failure as the confirm buttons that called router.push('/').
 */
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Share, Text, View } from 'react-native';
import {
  createInvite, eraseAccount, exportAccount, getInvites, type Invite, logout, phoneLinked,
} from '../../lib/api';
import { clearToken } from '../../lib/storage';
import { useSession } from '../../store/session';
import { useTheme } from '../../store/theme';
import { getApiBase } from '../../lib/env';
import {
  Chip, ChipGroup,
  Header,
  Button, Card, Row, Screen, ScreenTitle, space, type, usePalette,
} from '../../components/ui';

export default function SettingsScreen() {
  const p = usePalette();
  const token = useSession((s) => s.token);
  const setToken = useSession((s) => s.setToken);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [remaining, setRemaining] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    const r = await getInvites(token);
    setInvites(r?.invites ?? []);
    setRemaining(r?.remaining ?? 0);
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const invite = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    const r = await createInvite(token, '');
    setBusy(false);
    if (!r) return;
    void load();
    await Share.share({ message: `Here's a code for Clone: ${r.code}` });
  }, [token, load]);

  /**
   * The two rows that did nothing.
   *
   * "Download everything" had an empty function for a handler and "Delete everything"
   * opened an alert whose Delete button carried none at all -- so on a dating app,
   * the row that says "cannot be undone. The clone and all of its memory go" was a
   * picture of a button. Both server endpoints have worked the whole time.
   */
  /**
   * Whether this account has a number on it.
   *
   * Asked because phone sign-in only ever appears to a device with NO token, so an
   * account made before it existed can never attach one -- and an account with no
   * number is reachable from exactly one handset for ever. That is the trap the
   * whole feature was built to remove, and without this row the oldest accounts,
   * which hold the most, are the ones still in it.
   */
  const [linked, setLinked] = useState<boolean | null>(null);
  useEffect(() => {
    if (!token) return;
    void phoneLinked(token).then((r) => setLinked(r?.linked ?? null));
  }, [token]);

  const downloadAll = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    const data = await exportAccount(token);
    setBusy(false);
    if (!data) {
      Alert.alert('Could not download', 'We could not reach the server. Try again.');
      return;
    }
    // The share sheet, not a file write: it is the one route to "put this somewhere
    // I choose" that works on both platforms without asking for storage permission.
    await Share.share({ message: data });
  }, [token]);

  const deleteAll = useCallback(() => {
    Alert.alert(
      'Delete everything?',
      'Your clone, every fact it holds, and every message. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => void (async () => {
            if (!token) return;
            setBusy(true);
            const ok = await eraseAccount(token);
            setBusy(false);
            if (!ok) {
              Alert.alert('Not deleted', 'We could not reach the server. Nothing was removed.');
              return;
            }
            // The account is gone, so the token is meaningless. No logout call: there
            // is no session left to revoke and the request would only 401.
            await clearToken();
            setToken(null);
            router.replace('/phone');
          })(),
        },
      ],
    );
  }, [token, setToken]);

  const signOut = useCallback(() => {
    Alert.alert('Sign out?', 'Your clone stays on the server. This device forgets it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => void (async () => {
          // TELL THE SERVER FIRST, while the token still works.
          //
          // Clearing the keychain was previously the whole of "sign out", which meant
          // the credential being thrown away stayed valid for anyone holding a copy
          // until it expired on its own, months later. Best effort on purpose: if the
          // network is down the device still signs out, because somebody who taps this
          // has asked for something a dead connection must not be able to refuse.
          if (token) await logout(token);
          await clearToken();
          setToken(null);
          router.replace('/phone');
        })(),
      },
    ]);
  }, [setToken, token]);

  const themeChoice = useTheme((t) => t.choice);
  const chooseTheme = useTheme((t) => t.choose);

  return (
    <Screen onRefresh={() => void load()} padded={false}>
      <Header title="" onBack={() => router.back()} />
      <ScreenTitle title="Settings" />

      <View style={{ paddingHorizontal: space.screen, gap: space.lg }}>
        <Card label={`Invites · ${remaining} left`}>
          <Text style={[type.callout, { color: p.textSecondary }]}>
            We keep it small. You can have a few out at a time.
          </Text>
          {invites.map((i) => (
            <Row key={i.code} title={i.code}
                 subtitle={i.used ? 'Used' : 'Waiting to be used'}
                 value={i.used ? '✓' : ''} />
          ))}
          <Button label="Make an invite" variant="primary" onPress={() => void invite()}
                  disabled={remaining === 0} loading={busy} />
        </Card>

        {/* Appearance first: it is the setting people come here to change, and it is
            the only one whose effect is visible the instant it is chosen. */}
        <Card label="Appearance">
          <ChipGroup>
            {([
              { value: 'system', label: 'Match my phone' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ] as const).map((o) => (
              <Chip
                key={o.value}
                label={o.label}
                selected={themeChoice === o.value}
                onPress={() => void chooseTheme(o.value)}
              />
            ))}
          </ChipGroup>
          <Text style={[type.callout, { color: p.textTertiary }]}>
            {themeChoice === 'system'
              ? 'Follows your phone, including when it changes at sunset.'
              : 'Stays this way whatever your phone does.'}
          </Text>
        </Card>

        <Card label="Your clone">
          <Row title="What it knows" onPress={() => router.push('/you')} />
          <Row title="What you're looking for" onPress={() => router.push('/preferences')} />
          <Row title="Test it again" subtitle="See if it still sounds like you"
               onPress={() => router.push('/onboarding/test')} last />
        </Card>

        {/* ONLY WHILE THERE IS NOTHING ATTACHED. A row offering to add a number to an
            account that has one is a row inviting somebody to change their number,
            which is a different and more dangerous action than this is. */}
        {linked === false && (
          <Card label="Account recovery">
            <Row
              title="Add your phone number"
              subtitle="Without it this clone lives on this phone only. Lose it and it is gone."
              onPress={() => router.push('/phone')}
              last
            />
          </Card>
        )}

        <Card label="Connection">
          <Row title="Server" value={getApiBase().replace(/^https?:\/\//, '')}
               onPress={() => router.push('/connect')} last />
        </Card>

        {/* Both of these have worked on the server for weeks and neither could be
            reached from the app. */}
        <Card label="Your data">
          <Row title="Download everything"
               subtitle="Every fact, every message, and where each came from"
               onPress={() => void downloadAll()} />
          <Row title="Delete everything" danger
               subtitle="Cannot be undone. The clone and all of its memory go."
               onPress={deleteAll} last />
        </Card>

        <Button label="Sign out" variant="ghost" onPress={signOut} />

        <Text style={[type.callout, { color: p.textTertiary, textAlign: 'center' }]}>
          Nobody else has ever seen what your clone knows about you.
        </Text>
      </View>
    </Screen>
  );
}
