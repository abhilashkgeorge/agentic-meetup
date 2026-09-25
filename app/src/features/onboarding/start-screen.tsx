/**
 * The first sixty seconds.
 *
 * One sentence in, and the clone writes a message as you. You say whether that is you.
 * That is the entire product delivered before anybody has agreed to anything — and it
 * is the only honest way to explain what this is, because describing it takes a
 * paragraph and showing it takes one line.
 *
 * Hinge can charge thirty questions before showing a single face, because the payoff is
 * real people. We cannot: at launch the other side is synthetic. So the payoff has to
 * be the clone itself, immediately.
 */
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { gradeSelfTest, nextSelfTest, tell, type SelfTestItem } from '../../lib/api';
import { useSession } from '../../store/session';
import {
  Animation, Bubble, Button, ButtonRow, Card, Field, Screen, space, type, usePalette,
} from '../../components/ui';

type Stage = 'ask' | 'thinking' | 'judge' | 'done';

const EXAMPLES = [
  'I live in Bangalore and I work at an ISP.',
  'I have two cats and I cannot cook.',
  'I moved cities in March and I am still finding my feet.',
];

export default function StartScreen() {
  const p = usePalette();
  const token = useSession((s) => s.token);
  const sessionId = useSession((s) => s.sessionId);
  const [stage, setStage] = useState<Stage>('ask');
  const [text, setText] = useState('');
  const [item, setItem] = useState<SelfTestItem | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const go = useCallback(async () => {
    if (!token || text.trim().length < 3) return;
    setStage('thinking');
    setNote(null);

    const learned = await tell(token, text.trim(), sessionId);
    if (!learned) { setNote('Could not reach the server.'); return setStage('ask'); }
    if (learned.learned === 0) { setNote(learned.message); return setStage('ask'); }

    const probe = await nextSelfTest(token);
    if (!probe) return setStage('done');
    setItem(probe);
    setStage('judge');
  }, [token, text, sessionId]);

  const judge = useCallback((verdict: 'me' | 'not_me') => {
    if (token && item) void gradeSelfTest(token, item.id, verdict);
    setStage('done');
  }, [token, item]);

  if (stage === 'thinking') {
    return (
      <Screen topInset={false} center>
        <View style={{ alignItems: 'center', gap: space.lg }}>
          <ActivityIndicator color={p.accent} size="large" />
          <Text style={[type.body, { color: p.textSecondary }]}>Learning that…</Text>
        </View>
      </Screen>
    );
  }

  if (stage === 'judge' && item) {
    return (
      <Screen topInset={false}
        footer={
          <>
            <ButtonRow>
              <Button label="That's me" variant="primary" onPress={() => judge('me')} style={{ flex: 1 }} />
              <Button label="Not even close" onPress={() => judge('not_me')} style={{ flex: 1 }} />
            </ButtonRow>
            <Text style={[type.callout, { color: p.textTertiary, textAlign: 'center' }]}>
              It knows one thing about you so far. It gets better fast.
            </Text>
          </>
        }
      >
        <Text style={[type.display, { color: p.text }]}>Now it's you</Text>
        <Card label="Someone asks you">
          <Text style={[type.body, { color: p.textSecondary }]}>{item.question}</Text>
          <Bubble text={item.answer} mine />
        </Card>
        <Text style={[type.heading, { color: p.text, textAlign: 'center' }]}>Is that you?</Text>
      </Screen>
    );
  }

  if (stage === 'done') {
    return (
      <Screen topInset={false}
        footer={
          <>
            <Button label="Start" variant="primary" onPress={() => router.push('/onboarding/interview')} />
          </>
        }
      >
        <Animation mood="orbit" height={160} opacity={0.5} />
        <Text style={[type.display, { color: p.text }]}>Now it asks you some things</Text>
        {/* It used to say "it will not make you fill in a form". Setup now asks the
            basics and five cards, each about you AND about who you would be fine
            with, and that is a form, however it is laid out. The copy says what it is,
            and never a number: a count is a promise the flow then has to keep. */}
        <Text style={[type.body, { color: p.textSecondary }]}>
          A few quick questions, one at a time. Some are about you, and some are about
          who you would be fine with.
        </Text>
        <Card label="Faster, if you want">
          <Text style={[type.body, { color: p.text }]}>
            Already use ChatGPT or Claude? Paste what it knows and skip ahead.
          </Text>
          <Text style={[type.callout, { color: p.textSecondary }]}>
            Optional. The questions work fine on their own.
          </Text>
          <Button label="Paste from another AI" onPress={() => router.push('/onboarding/paste')} />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen topInset={false}
      footer={
        <Button label="Go" variant="primary" onPress={() => void go()}
                disabled={text.trim().length < 3} />
      }
    >
      {/* A line that moves as though something were being said. The screen is a
          headline, a box and a lot of nothing without it. */}
      <Animation mood="speaking" height={150} opacity={0.5} />

      <View style={{ gap: space.sm }}>
        <Text style={[type.display, { color: p.text }]}>Tell it one true thing</Text>
        <Text style={[type.body, { color: p.textSecondary }]}>
          Anything about you. One sentence is enough to start.
        </Text>
      </View>

      {/* NO autoFocus. It opened the keyboard before the screen had been read, which
          scrolled the headline off the top and left a new person looking at the tail
          of a sentence -- the literal first words in the app were "start." with
          nothing before them. The examples below are tappable, so the box does not
          need to be the first thing in focus; it needs to be the first thing SEEN. */}
      <Field value={text} onChangeText={(t) => { setText(t); setNote(null); }}
             placeholder={EXAMPLES[0]} multiline minHeight={120}
             error={note} />

      {/* A blank box is where setup flows die, and "anything about you" is not
          actually a prompt. Tapping one fills it in. */}
      <View style={{ gap: space.sm }}>
        {EXAMPLES.map((e) => (
          <Pressable key={e} onPress={() => setText(e)} accessibilityRole="button"
                     style={{ minHeight: 36, justifyContent: 'center' }}>
            <Text style={[type.callout, { color: p.textTertiary }]}>“{e}”</Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}
