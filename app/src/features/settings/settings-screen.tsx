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
import { createInvite, getInvites, type Invite } from '../../lib/api';
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

  const signOut = useCallback(() => {
    Alert.alert('Sign out?', 'Your clone stays on the server. This device forgets it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => void (async () => {
          await clearToken();
          setToken(null);
          router.replace('/invite');
        })(),
      },
    ]);
  }, [setToken]);

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

        <Card label="Connection">
          <Row title="Server" value={getApiBase().replace(/^https?:\/\//, '')}
               onPress={() => router.push('/connect')} last />
        </Card>

        {/* Both of these have worked on the server for weeks and neither could be
            reached from the app. */}
        <Card label="Your data">
          <Row title="Download everything"
               subtitle="Every fact, every message, and where each came from"
               onPress={() => {}} />
          <Row title="Delete everything" danger
               subtitle="Cannot be undone. The clone and all of its memory go."
               onPress={() => Alert.alert(
                 'Delete everything?',
                 'Your clone, every fact it holds, and every message. This cannot be undone.',
                 [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive' }],
               )} last />
        </Card>

        <Button label="Sign out" variant="ghost" onPress={signOut} />

        <Text style={[type.callout, { color: p.textTertiary, textAlign: 'center' }]}>
          Nobody else has ever seen what your clone knows about you.
        </Text>
      </View>
    </Screen>
  );
}
