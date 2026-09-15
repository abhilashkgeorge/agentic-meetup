/**
 * The first screen. Your number.
 *
 * WHY THIS IS THE DOOR NOW. It used to be the invite code, and that made the account
 * the device: lose the phone and the clone went with it, add a second phone and you
 * got a second clone. A number is the thing that survives both. It is also the
 * cheapest real-world scarcity there is, which for a product where strangers meet is
 * the difference between removing somebody and inconveniencing them for a minute.
 *
 * The invite has not gone anywhere. It is the next screen, and only for numbers we
 * have never seen. Somebody coming back on a new handset skips it entirely, which is
 * the entire point of putting this first.
 *
 * WHAT THIS SCREEN PROMISES, and the server keeps: the number is used to text you a
 * code and is never stored. What is kept is a one-way hash of it. Nobody here can
 * read your number back, including us.
 */
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { SUPPORTED_COUNTRIES, normalisePhone } from '@clone/shared';
import { startPhone } from '../../lib/api';
import {
  Button, Card, Chip, ChipGroup, Field, Screen, space, type, usePalette,
} from '../../components/ui';

/** What each country code is called, for people who do not read in dialling codes. */
const LABEL: Record<string, string> = {
  '+91': '🇮🇳 +91',
  '+1': '🇺🇸 +1',
  '+44': '🇬🇧 +44',
};

export default function PhoneScreen() {
  const p = usePalette();
  const [country, setCountry] = useState('+91');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The SAME normaliser the server will use, so the button is alive exactly when the
  // request would succeed. Two different ideas of "valid" is how a person ends up
  // staring at a dead button with a number that is obviously fine.
  const e164 = useMemo(() => normalisePhone(phone, country), [phone, country]);

  const submit = useCallback(async () => {
    if (!e164) return;
    setBusy(true);
    setError(null);
    const r = await startPhone(e164, country);
    setBusy(false);

    if (r === null) return setError('Cannot reach the server. Check your connection.');
    if ('error' in r) return setError(r.error);

    router.push({
      pathname: '/verify',
      params: {
        challengeId: r.challengeId,
        sentTo: r.sentTo,
        // Carried so the next screen can offer "wrong number?" without asking again.
        phone: e164,
        // Carried so a resend uses the country that was actually chosen. Assuming
        // one here is how a number from anywhere else stops working on the second tap.
        country,
        ...(r.devCode ? { devCode: r.devCode } : {}),
      },
    });
  }, [e164, country]);

  return (
    <Screen
      center
      footer={
        <>
          <Button label="Text me a code" variant="primary" onPress={() => void submit()}
                  disabled={!e164} loading={busy} />
          <Text style={[type.callout, { color: p.textTertiary, textAlign: 'center' }]}>
            We text you once. Your number is never shown to anybody, and we keep only a
            scrambled version of it.
          </Text>
        </>
      }
    >
      <View style={{ gap: space.sm }}>
        <Text style={[type.display, { color: p.text }]}>What's your number?</Text>
        <Text style={[type.body, { color: p.textSecondary }]}>
          It is how you get back to your clone if you lose this phone, and how you use
          it on two.
        </Text>
      </View>

      <Card>
        <ChipGroup>
          {SUPPORTED_COUNTRIES.map((cc) => (
            <Chip key={cc} label={LABEL[cc] ?? cc} selected={country === cc}
                  onPress={() => { setCountry(cc); setError(null); }} />
          ))}
        </ChipGroup>

        <Field
          value={phone}
          onChangeText={(t) => { setPhone(t); setError(null); }}
          placeholder="98765 43210"
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          autoFocus
        />
      </Card>

      {error && <Text style={[type.callout, { color: p.danger }]}>{error}</Text>}
    </Screen>
  );
}
