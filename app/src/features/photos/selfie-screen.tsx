/**
 * Check your photos: two selfies, compared to your photos on the founder's own
 * server, neither kept.
 *
 * The camera is loaded when the person taps "Take them", never at import -- a build
 * without the native module must still render every other screen
 * (tests/native-imports.test.ts). The first frame faces the camera; the second is
 * taken after a short count with the head turned, which is what stops a photo held
 * up to the lens. The words on the fail screen never say which photo or what score.
 */
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { finishSelfieCheck, getSelfieStatus, startSelfieCheck } from '../../lib/api';
import { useSession } from '../../store/session';
import { Button, Card, Header, Screen, radius, space, type, usePalette } from '../../components/ui';

type CameraModule = typeof import('expo-camera');
interface CamHandle { takePictureAsync(o: { quality?: number; exif?: boolean; skipProcessing?: boolean }): Promise<{ uri: string } | undefined> }
type Stage = 'intro' | 'denied' | 'front' | 'turn' | 'sending' | 'waiting' | 'result';

const SAID: Record<string, string> = {
  match: 'Photos checked. People who can see your photos will see that too.',
  no_match: 'Couldn’t match them. Good light, glasses off, face the camera first. Try again.',
  no_face: 'Couldn’t find one face. Good light, nobody else in frame, face the camera first. Try again.',
  not_live: 'Couldn’t match them. Face the camera for the first one, then turn your head for the second. Try again.',
  no_photos: 'Add a photo first, then check it.',
  error: 'Something went wrong on our side. Try again in a minute.',
};

export default function SelfieScreen() {
  const p = usePalette();
  const token = useSession((s) => s.token);
  const [stage, setStage] = useState<Stage>('intro');
  const [Cam, setCam] = useState<CameraModule | null>(null);
  const camRef = useRef<CamHandle | null>(null);
  const frontUri = useRef<string | null>(null);
  const [count, setCount] = useState(0);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const begin = async () => {
    setError(null);
    try {
      const mod = await import('expo-camera');
      const perm = await mod.Camera.requestCameraPermissionsAsync();
      if (!perm.granted) { setStage('denied'); return; }
      setCam(mod);
      setStage('front');
    } catch {
      setError('This version of the app cannot open the camera.');
    }
  };

  const snap = () => camRef.current?.takePictureAsync({ quality: 0.6, exif: false, skipProcessing: true });

  const takeFront = async () => {
    const pic = await snap();
    if (!pic) return;
    frontUri.current = pic.uri;
    setStage('turn');
    setCount(3);
  };

  // The second frame is taken on a short count, so the head has time to turn.
  useEffect(() => {
    if (stage !== 'turn') return;
    if (count > 0) {
      const t = setTimeout(() => setCount((c) => c - 1), 800);
      return () => clearTimeout(t);
    }
    void (async () => {
      const pic = await snap();
      if (!pic || !frontUri.current || !token) { setError('Could not take the second picture. Try again.'); setStage('intro'); return; }
      setStage('sending');
      const start = await startSelfieCheck(token, frontUri.current);
      if (!start.ok) { setError(start.message); setStage('intro'); return; }
      const fin = await finishSelfieCheck(token, start.checkId, pic.uri);
      if (!fin.ok) { setError(fin.message); setStage('intro'); return; }
      setStage('waiting');
    })();
  }, [stage, count, token]);

  // Poll for the verdict: every three seconds, for a minute and a half at most.
  useEffect(() => {
    if (stage !== 'waiting' || !token) return;
    let tries = 0;
    let live = true;
    const tick = async () => {
      const s = await getSelfieStatus(token);
      if (!live) return;
      if (s && (s.status === 'done' || s.status === 'failed')) { setResult(s.result ?? 'error'); setStage('result'); return; }
      if (++tries >= 30) { setResult('error'); setStage('result'); return; }
      timer = setTimeout(() => void tick(), 3_000);
    };
    let timer = setTimeout(() => void tick(), 2_000);
    return () => { live = false; clearTimeout(timer); };
  }, [stage, token]);

  const camera = Cam && (stage === 'front' || stage === 'turn') ? (
    <View style={{ width: '100%', aspectRatio: 3 / 4, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: p.sunken }}>
      <Cam.CameraView ref={camRef as never} facing="front" style={{ flex: 1 }} />
    </View>
  ) : null;

  return (
    <Screen scroll>
      <Header title="Check your photos" onBack={() => router.back()} />

      {stage === 'intro' && (
        <Card>
          <Text style={[type.body, { color: p.text }]}>
            Two quick selfies: one facing the camera, one with your head turned. They are
            compared to your photos on our own server and neither selfie is kept. If they
            match, people who can see your photos see “Photos checked”.
          </Text>
          {error && <Text style={[type.callout, { color: p.danger }]}>{error}</Text>}
          <Button label="Take them" variant="primary" onPress={() => void begin()} />
          <Button label="Not now" variant="ghost" onPress={() => router.back()} />
        </Card>
      )}

      {stage === 'denied' && (
        <Card>
          <Text style={[type.body, { color: p.text }]}>
            The camera is off for this app. Turn it on in your phone’s settings and come back.
          </Text>
          <Button label="Open settings" variant="secondary" onPress={() => void Linking.openSettings()} />
          <Button label="Not now" variant="ghost" onPress={() => router.back()} />
        </Card>
      )}

      {(stage === 'front' || stage === 'turn') && (
        <View style={{ gap: space.md }}>
          {camera}
          <Text style={[type.body, { color: p.text, textAlign: 'center' }]}>
            {stage === 'front' ? 'Face the camera, then tap.' : count > 0 ? `Now turn your head to the side… ${count}` : 'Hold it…'}
          </Text>
          {stage === 'front' && <Button label="Take the first one" variant="primary" onPress={() => void takeFront()} />}
        </View>
      )}

      {(stage === 'sending' || stage === 'waiting') && (
        <Card>
          <Text style={[type.body, { color: p.text, textAlign: 'center' }]}>
            {stage === 'sending' ? 'Sending…' : 'Checking… this takes a few seconds.'}
          </Text>
        </Card>
      )}

      {stage === 'result' && (
        <Card>
          <Text style={[type.body, { color: result === 'match' ? p.success : p.text }]}>{SAID[result ?? 'error'] ?? SAID.error}</Text>
          {result === 'match'
            ? <Button label="Done" variant="primary" onPress={() => router.back()} />
            : <Button label="Try again" variant="primary" onPress={() => { setResult(null); setStage('intro'); }} />}
          {result !== 'match' && <Button label="Not now" variant="ghost" onPress={() => router.back()} />}
        </Card>
      )}
    </Screen>
  );
}
