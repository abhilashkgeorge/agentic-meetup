/**
 * "Is this you?" — the gate, and the best twenty seconds in the product.
 *
 * The clone writes a message as its owner. The owner says whether that is them. It is
 * the whole product in miniature: a clone speaks in somebody's place and the one person
 * who cannot be fooled about the answer judges it.
 *
 * It runs before anyone else can see the clone for a reason that is not technical. The
 * first outbound act of a new clone is to represent somebody to a stranger, and a clone
 * with two facts and no voice fails that in public.
 *
 * Every "not me" plus a correction is also an eval case. The corpus fills as a
 * by-product of a screen people want to use rather than as a project nobody starts.
 */
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import {
  getReadiness, gradeSelfTest, nextSelfTest, type Readiness, type SelfTestItem,
} from '../../lib/api';
import { useSession } from '../../store/session';
import {
  Animation,
  Bubble, Button, ButtonRow, Card, Field, Meter, Screen, space, type, usePalette,
} from '../../components/ui';

export default function SelfTestScreen() {
  const p = usePalette();
  const token = useSession((s) => s.token);
  const [ready, setReady] = useState<Readiness | null>(null);
  const [item, setItem] = useState<SelfTestItem | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const [correction, setCorrection] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (token) setReady(await getReadiness(token));
  }, [token]);

  useEffect(() => { void refresh(); }, [refresh]);

  const ask = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    setNote(null);
    const r = await nextSelfTest(token);
    setBusy(false);
    if (!r) return setNote('Could not reach the server, or it has nothing to go on yet.');
    setItem(r);
    setCorrecting(false);
    setCorrection('');
  }, [token]);

  const grade = useCallback(async (verdict: 'me' | 'not_me') => {
    if (!token || !item) return;
    // "Not me" opens the correction box rather than grading straight away. A verdict
    // says something is wrong; a correction says what is right, and only one of those
    // teaches anything.
    if (verdict === 'not_me' && !correcting) return setCorrecting(true);
    setBusy(true);
    const r = await gradeSelfTest(token, item.id, verdict, correction.trim() || undefined);
    setBusy(false);
    if (r) setReady(r);
    setItem(null);
    setCorrecting(false);
    setCorrection('');
  }, [token, item, correcting, correction]);

  const finish = useCallback(async () => {
    // "THINGS TO TALK ABOUT" NEXT, then the character, then photos last. Setup used to go
    // straight to the character, so a new person never saw the stories -- and those are
    // the only sentences their agent may repeat when it meets another (talk.ts): the
    // first agents to meet, two new accounts, had nothing to say at all (the two-phone
    // test, 2026-10-02: no talk, no answer sheet, an empty card). Every answer there is
    // optional; Next goes on to the character.
    router.replace('/onboarding/stories');
  }, []);

  const passed = ready?.passed ?? 0;
  const size = ready?.testSize ?? 5;

  if (item) {
    return (
      <Screen topInset={false}
        footer={
          correcting ? (
            <>
              <Button label="That's better" variant="primary" onPress={() => void grade('not_me')} loading={busy} />
              <Button label="Skip the correction" variant="ghost" onPress={() => void grade('not_me')} />
            </>
          ) : (
            <ButtonRow>
              <Button label="That's me" variant="primary" onPress={() => void grade('me')}
                      disabled={busy} style={{ flex: 1 }} />
              <Button label="Not me" onPress={() => void grade('not_me')} disabled={busy} style={{ flex: 1 }} />
            </ButtonRow>
          )
        }
      >
        <Animation mood="alive" height={130} opacity={0.45} />
        <Text style={[type.display, { color: p.text }]}>Is this you?</Text>
        <Card label="Someone asks you">
          <Text style={[type.body, { color: p.textSecondary }]}>{item.question}</Text>
          <Bubble text={item.answer} mine />
        </Card>
        {correcting && (
          <Card label="What would you have said?">
            <Field value={correction} onChangeText={setCorrection} multiline autoFocus
                   placeholder="Type it the way you'd really write it" minHeight={100} />
          </Card>
        )}
      </Screen>
    );
  }

  return (
    <Screen topInset={false}
      footer={
        <>
          <Button label={ready?.graded ? 'Test it again' : 'Test it'} variant="primary"
                  onPress={() => void ask()} loading={busy} />
          <Button label={ready?.ready ? 'Done' : 'Finish later'}
                  variant={ready?.ready ? 'secondary' : 'ghost'} onPress={() => void finish()} />
        </>
      }
    >
      <Animation mood="alive" height={140} opacity={0.45} />

      <View style={{ gap: space.sm }}>
        <Text style={[type.display, { color: p.text }]}>Is this you?</Text>
        <Text style={[type.body, { color: p.textSecondary }]}>
          Your clone writes a message as you. You say whether it sounds right. Nobody
          else sees this.
        </Text>
      </View>

      <Card label="So far">
        <Text style={[type.title, { color: p.text }]}>
          {passed} of {ready?.graded ?? 0} right
        </Text>
        <Meter value={size ? passed / size : 0} />
        {/* Named, never scored. A percentage turns this into a form to max out. */}
        {ready?.missing.map((m) => (
          <Text key={m} style={[type.callout, { color: p.textSecondary }]}>• {m}</Text>
        ))}
        {ready?.ready && (
          <Text style={[type.bodyStrong, { color: p.accent }]}>
            It's ready. It can go out and meet people for you.
          </Text>
        )}
      </Card>

      {note && <Text style={[type.callout, { color: p.danger }]}>{note}</Text>}
    </Screen>
  );
}
