/**
 * "Where is the server?"
 *
 * Exists because an unreachable server used to be a dead end: the app derived its
 * address from Metro's host, fell back to localhost without saying so, and on a phone
 * that means calling itself. The only symptom was "could not reach the server".
 *
 * Two rules: always show the address it actually tried, and never save one without
 * testing it — otherwise this screen just moves the dead end one step along.
 */
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { defaultBase, getApiBase, normaliseBase, pingServer, setApiBase } from '../../lib/env';
import { clearServerUrl, setServerUrl } from '../../lib/storage';
import { useLaunch } from '../../store/launch';
import { Button, Card, Field, Screen, space, type, usePalette } from '../../components/ui';

export default function ConnectScreen() {
  const p = usePalette();
  const again = useLaunch((s) => s.again);
  const [url, setUrl] = useState('');
  const [tried] = useState(getApiBase());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => { setUrl(getApiBase()); }, []);

  const save = useCallback(async () => {
    const candidate = normaliseBase(url);
    if (!candidate) return;
    setBusy(true);
    setNote(`Trying ${candidate}…`);
    const ok = await pingServer(candidate);
    setBusy(false);
    if (!ok) return setNote(`Nothing answered at ${candidate}.`);
    setApiBase(candidate);
    await setServerUrl(candidate);
    // The whole launch check again, not '/': reached at launch, this screen came before
    // the account was even looked for (store/launch.ts).
    again();
  }, [url, again]);

  return (
    <Screen
      center
      footer={
        <>
          <Button label="Test and save" variant="primary" onPress={() => void save()}
                  disabled={!url.trim()} loading={busy} />
          <Button label="Use the default again" variant="ghost" onPress={() => void (async () => {
            await clearServerUrl();
            const d = defaultBase();
            setApiBase(d);
            setUrl(d);
            setNote(`Back to ${d}`);
          })()} />
        </>
      }
    >
      <View style={{ gap: space.sm }}>
        <Text style={[type.display, { color: p.text }]}>Can't reach the server</Text>
        <Text style={[type.body, { color: p.textSecondary }]}>
          It tried this and nothing answered:
        </Text>
        <Text style={[type.bodyStrong, { color: p.text }]}>{tried}</Text>
        {/* The single most useful line on the screen. "localhost" on a phone means
            the phone, which is a two-second diagnosis once somebody can see it. */}
        {tried.includes('localhost') && (
          <Text style={[type.callout, { color: p.warning }]}>
            That address means this phone, not your Mac.
          </Text>
        )}
      </View>

      <Card label="Server address">
        {/* MULTILINE so the whole address is on screen. A tunnel address is longer
            than the box, and a single-line input scrolls to the END of its value --
            which showed `/0a70-....ngrok-free.app`, a leading slash and no scheme,
            reading exactly like a malformed address somebody needed to repair. The
            value was always correct; only the view of it was not. */}
        <Field
          value={url}
          onChangeText={(t) => { setUrl(t); setNote(null); }}
          placeholder="192.168.1.20:8000 or your-tunnel.ngrok-free.app"
          autoCapitalize="none"
          keyboardType="url"
          multiline
          hint={note ?? undefined}
          onSubmitEditing={() => void save()}
        />
      </Card>
    </Screen>
  );
}
