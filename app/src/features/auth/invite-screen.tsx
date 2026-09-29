/**
 * The door. There is no other one.
 *
 * No email, no password, no "continue with". One code, and the account exists. The
 * screen is deliberately almost empty: it is the first thing anybody sees, and a
 * single sunken well with a single extruded button is this design language saying
 * one thing at a time.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import * as Device from 'expo-device';
import { redeemInvite } from '../../lib/api';
import { setToken as persistToken } from '../../lib/storage';
import { useSession } from '../../store/session';
import { Button, Card, Field, Screen, space, type, usePalette } from '../../components/ui';

export default function InviteScreen() {
  const p = usePalette();
  // Proof that the number on the previous screen was verified. The server refuses to
  // make an account without it, so arriving here without one means somebody reached
  // this route sideways -- and the error they get says exactly that.
  const { ticket } = useLocalSearchParams<{ ticket?: string }>();
  const setToken = useSession((s) => s.setToken);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const submit = useCallback(async () => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    const label = `${Device.deviceName ?? 'device'} (${Device.osName ?? 'unknown'})`.slice(0, 64);
    const r = await redeemInvite(trimmed, label, ticket);
    setBusy(false);

    if (r === null) return setError('Cannot reach the server. Check your connection.');
    if ('error' in r) return setError(r.error);

    await persistToken(r.token);
    setToken(r.token);
    // Somebody wrote something for this person. Let them read it before anything else
    // starts talking at them.
    if (r.note) setNote(r.note);
    else router.replace('/consent');
  }, [code, setToken, ticket]);

  if (note) {
    return (
      <Screen center footer={<Button label="Let's go" variant="primary" onPress={() => router.replace('/consent')} />}>
        <Text style={[type.label, { color: p.textSecondary }]}>THEY LEFT YOU A NOTE</Text>
        <Text style={[type.display, { color: p.text }]}>“{note}”</Text>
      </Screen>
    );
  }

  return (
    <Screen
      center
      footer={
        <>
          <Button label="Let me in" variant="primary" onPress={() => void submit()}
                  disabled={!code.trim()} loading={busy} />
          <Text style={[type.callout, { color: p.textTertiary, textAlign: 'center' }]}>
            We keep it small. Everyone here was vouched for.
          </Text>
          {/* A way back (the founder, 2026-09-29): this screen had none. Back is the phone
              screen; opened with no history, it is sent there. */}
          <Button label="Back" variant="ghost"
                  onPress={() => (router.canGoBack() ? router.back() : router.replace('/phone'))} />
        </>
      }
    >
      <View style={{ gap: space.sm }}>
        <Text style={[type.display, { color: p.text }]}>You need a code</Text>
        <Text style={[type.body, { color: p.textSecondary }]}>
          Your number is confirmed. Now someone has to let you in. If a friend sent you
          eight characters, put them here.
        </Text>
      </View>

      <Card>
        <Field
          value={code}
          onChangeText={(t) => { setCode(t); setError(null); }}
          placeholder="ABCD-1234"
          autoCapitalize="characters"
          maxLength={20}
          error={error}
          onSubmitEditing={() => void submit()}
          textStyle={{ ...type.title, textAlign: 'center', letterSpacing: 6, color: p.text }}
        />
      </Card>
    </Screen>
  );
}
