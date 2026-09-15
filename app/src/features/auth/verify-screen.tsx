/**
 * The six digits.
 *
 * Three different people arrive here and the screen cannot tell them apart until the
 * server answers, which is deliberate: asking "are you new?" before the number is
 * proved would be a way to ask the server who exists.
 *
 *   somebody new              sent on to the invite screen, carrying a ticket
 *   somebody with an account  signed straight in, on this handset, with everything
 *                             their clone already knows. No invite, no setup.
 *   somebody already signed
 *   in, adding their number   attached to the account in hand, token unchanged
 *
 * The middle one is the whole reason this feature exists, and it is the one nobody
 * sees in a demo because it only happens on a second device or after a reinstall.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import * as Device from 'expo-device';
import { OTP_LENGTH } from '@clone/shared';
import { startPhone, verifyPhone } from '../../lib/api';
import { setOnboarded, setToken as persistToken } from '../../lib/storage';
import { useSession } from '../../store/session';
import {
  Button, Card, Field, Screen, space, type, usePalette,
} from '../../components/ui';

/** Seconds before "Send it again" becomes tappable. Long enough to let the text land. */
const RESEND_AFTER = 30;

export default function VerifyScreen() {
  const p = usePalette();
  const params = useLocalSearchParams<{
    challengeId: string; sentTo: string; phone: string; country?: string; devCode?: string;
  }>();
  const token = useSession((s) => s.token);
  const setToken = useSession((s) => s.setToken);

  const [challengeId, setChallengeId] = useState(params.challengeId);
  // Prefilled ONLY when the server echoed it back, which it does only when an
  // operator has explicitly turned the protection off. See SMS_DEV_ECHO.
  const [code, setCode] = useState(params.devCode ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(RESEND_AFTER);

  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);

  const label = `${Device.deviceName ?? 'device'} (${Device.osName ?? 'unknown'})`;

  // GUARDS AGAINST A DOUBLE SUBMIT. The code is six characters and the field fires
  // submit the moment it is full, so a fast typist and an autofill can both land on
  // the same challenge twice -- and the second one spends an attempt on a code the
  // first has already consumed.
  const sending = useRef(false);

  const submit = useCallback(async (value: string) => {
    if (value.length < OTP_LENGTH || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    const r = await verifyPhone(challengeId, value, label, token ?? undefined);
    setBusy(false);
    sending.current = false;

    if (r === null) return setError('Cannot reach the server. Check your connection.');
    if ('error' in r) {
      setCode('');
      return setError(r.error);
    }

    if (r.status === 'signed_in') {
      // Everything they already had, on this phone. No setup, no invite.
      await persistToken(r.token);
      setToken(r.token);
      // THE ACCOUNT'S ANSWER, not this handset's. The "setup done" flag lives in the
      // keychain and a new phone has an empty one, so without this the app would walk
      // a returning person through setup again on their next launch -- asked their
      // birth year by an agent that has known it for weeks.
      if (r.onboarded) await setOnboarded();
      return router.replace('/');
    }
    if (r.status === 'linked') {
      // Already signed in; the number is now attached. Straight back to the app.
      return router.replace('/');
    }
    // New number. The invite is the next door, and the ticket is what opens it.
    router.replace({ pathname: '/invite', params: { ticket: r.ticket } });
  }, [challengeId, label, token, setToken]);

  const resend = useCallback(async () => {
    setBusy(true);
    setError(null);
    // The country the person picked, NOT a hardcoded one. `params.phone` is already
    // full E.164 so the default is only ever a fallback, but a wrong fallback here
    // would silently rewrite somebody's number on the second tap.
    const r = await startPhone(params.phone, params.country ?? '+91');
    setBusy(false);
    if (r === null) return setError('Cannot reach the server.');
    if ('error' in r) return setError(r.error);
    // A NEW CHALLENGE ID. The old code is dead the moment this one is issued, so
    // holding on to the previous id would make every subsequent guess fail for a
    // reason nobody could see.
    setChallengeId(r.challengeId);
    setCode(r.devCode ?? '');
    setLeft(RESEND_AFTER);
  }, [params.phone, params.country]);

  return (
    <Screen
      center
      footer={
        <>
          <Button label="Confirm" variant="primary" onPress={() => void submit(code)}
                  disabled={code.length < OTP_LENGTH} loading={busy} />
          <Button
            label={left > 0 ? `Send it again in ${left}s` : 'Send it again'}
            variant="ghost"
            disabled={left > 0 || busy}
            onPress={() => void resend()}
          />
        </>
      }
    >
      <View style={{ gap: space.sm }}>
        <Text style={[type.display, { color: p.text }]}>Check your texts</Text>
        <Text style={[type.body, { color: p.textSecondary }]}>
          We sent six digits to the number ending {params.sentTo?.replace(/^•+/, '')}.
        </Text>
      </View>

      <Card>
        <Field
          value={code}
          onChangeText={(t) => {
            const digits = t.replace(/\D/g, '').slice(0, OTP_LENGTH);
            setCode(digits);
            setError(null);
            // Submitted on the last digit. Nobody types six numbers and then looks
            // around for a button.
            if (digits.length === OTP_LENGTH) void submit(digits);
          }}
          placeholder="123456"
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          autoFocus
        />
      </Card>

      {error && <Text style={[type.callout, { color: p.danger }]}>{error}</Text>}

      {params.devCode && (
        <Text style={[type.callout, { color: p.danger, textAlign: 'center' }]}>
          The server is echoing codes back (SMS_DEV_ECHO). Turn that off before anyone
          else uses this.
        </Text>
      )}

      <Button label="Wrong number?" variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
