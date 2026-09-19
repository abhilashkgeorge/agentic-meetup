/**
 * The interview. One question, then the next.
 *
 * This is the spine of onboarding, not a step in it. The strongest known way to make a
 * clone answer like a particular person is a long structured interview — and what
 * actually predicts somebody is how they answer specific questions, not a profile.
 *
 * It feels like Akinator for a reason: the server never asks a question whose answer
 * tells it nothing. It picks whichever one most divides the people you could be
 * matched with, so the order feels like it is getting somewhere.
 *
 * NO PROGRESS BAR, and that is deliberate. The interview ends when there is nothing
 * left worth asking, which is not a number anybody can promise up front. What is shown
 * instead is the thing that actually matters: whether the agent can go out yet.
 */
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import {
  answerQuestion, getNextQuestion, type InterviewState,
} from '../../lib/api';
import { useSession } from '../../store/session';
import { missingLabel } from '../profile/fields';
import {
  Animation, Button, Card, Chip, ChipGroup, Field, Screen, space, type, usePalette,
} from '../../components/ui';

export default function InterviewScreen() {
  const p = usePalette();
  const token = useSession((s) => s.token);
  const [state, setState] = useState<InterviewState | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [sentence, setSentence] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setPicked([]);
    setSentence('');
    setState(await getNextQuestion(token));
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const submit = useCallback(async (values: string[], text?: string) => {
    if (!token || !state?.question) return;
    setBusy(true);
    await answerQuestion(token, state.question.id, values, text);
    setBusy(false);
    void load();
  }, [token, state, load]);

  if (!state) {
    return (
      <Screen topInset={false} center>
        <ActivityIndicator color={p.accent} size="large" />
      </Screen>
    );
  }

  // Nothing left worth asking.
  /**
   * The end of the questions, which is not quite the end of setup: the photo step is
   * last, and it is where `setOnboarded` is now recorded.
   *
   * That flag matters and used to be missing here. Only the self-test screen recorded
   * it, and this path skips the self-test -- so somebody who answered the questions was
   * sent to the app, found "setup not finished" still true, and was bounced back to the
   * first screen of onboarding, for ever, with no way in.
   */
  const done = (): void => {
    router.replace(state.ready ? '/onboarding/character' : '/onboarding/essentials');
  };

  if (!state.question) {
    return (
      <Screen topInset={false}
        center
        footer={
          <Button
            label={state.ready ? 'Let it go out' : 'Finish the basics'}
            variant="primary"
            onPress={done}
          />
        }
      >
        <Animation mood={state.ready ? 'sending' : 'orbit'} height={200} />
        <Text style={[type.display, { color: p.text }]}>
          {state.ready ? "That's enough to start" : 'A few things missing'}
        </Text>
        <Card>
          <Text style={[type.title, { color: p.text }]}>{state.answered}</Text>
          <Text style={[type.callout, { color: p.textSecondary }]}>questions answered</Text>
          {state.ready ? (
            <Text style={[type.body, { color: p.textSecondary }]}>
              Your agent can talk to other people's agents now. It keeps learning as you
              use it.
            </Text>
          ) : (
            state.missing.map((m) => (
              <Text key={m} style={[type.callout, { color: p.textSecondary }]}>• {missingLabel(m)}</Text>
            ))
          )}
        </Card>
      </Screen>
    );
  }

  const q = state.question;
  const ready = q.kind === 'free' ? sentence.trim().length > 2 : picked.length > 0;

  return (
    <Screen topInset={false}
      footer={
        <>
          <Button
            label={q.multi ? `Next${picked.length ? ` (${picked.length})` : ''}` : 'Next'}
            variant="primary"
            onPress={() => void (q.kind === 'free'
              ? submit([], sentence.trim())
              : submit(picked))}
            disabled={!ready}
            loading={busy}
          />
          {/* Skipping is a recorded answer, not a gap: a question somebody declined
              must never come back round.

              Except for the three that decide who the agent can reach at all. Skipping
              one of those produces an agent that cannot leave the building, and a
              person who was told setup was finished -- so the button is not there, and
              the server refuses the skip as well. */}
          {!q.required && (
            <Button label="Skip this one" variant="ghost" onPress={() => void submit([])} />
          )}
          {q.required && (
            <Text style={[type.callout, { color: p.textTertiary, textAlign: 'center' }]}>
              This one decides who your agent can reach.
            </Text>
          )}
        </>
      }
    >
      <View style={{ gap: space.xs }}>
        <Text style={[type.label, { color: p.textTertiary }]}>
          {state.answered > 0 ? `${state.answered} ANSWERED` : 'LET’S START'}
          {state.poolSize > 0 ? ` · ${state.poolSize} PEOPLE IN RANGE` : ''}
        </Text>
        <Text style={[type.display, { color: p.text }]}>{q.text}</Text>
        {q.why && <Text style={[type.body, { color: p.textSecondary }]}>{q.why}</Text>}
      </View>

      {/* A sentence, not a choice. The one question in the flow that asks for a real
          thought, and the only one whose answer could end up quoted to somebody else. */}
      {q.kind === 'free' ? (
        <Field
          value={sentence}
          onChangeText={setSentence}
          placeholder="Someone who…"
          multiline
          minHeight={110}
          autoFocus
          maxLength={300}
        />
      ) : (
      <Card>
        <ChipGroup>
          {q.options.map((o) => {
            const on = picked.includes(o.value);
            return (
              <Chip
                key={o.value}
                label={o.label}
                selected={on}
                onPress={() => {
                  if (q.multi) {
                    setPicked((prev) =>
                      prev.includes(o.value) ? prev.filter((v) => v !== o.value) : [...prev, o.value],
                    );
                  } else {
                    // Single-choice answers submit immediately. Tapping then tapping
                    // Next is two taps for one decision, and this screen runs twenty
                    // times.
                    setPicked([o.value]);
                    void submit([o.value]);
                  }
                }}
              />
            );
          })}
        </ChipGroup>
      </Card>
      )}

      {q.kind === 'free' && (
        <Animation mood="connecting" height={140} opacity={0.4} />
      )}

      {q.kind === 'preference' && (
        <Text style={[type.callout, { color: p.textTertiary }]}>
          This one is about them, not you. Only the strongest answer rules anybody out.
        </Text>
      )}
    </Screen>
  );
}
