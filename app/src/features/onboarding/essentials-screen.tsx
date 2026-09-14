/**
 * The six an AI export can never give you.
 *
 * Claude's memory system carries an absolute never-store list: age, gender, sexual
 * orientation, religion, politics, health. ChatGPT is looser but skews heavily to work
 * and tooling. So six of the fields the matcher actually runs on come back empty BY
 * POLICY, not by accident — which makes this the guaranteed path, not the fallback.
 *
 * A run of six questions is survivable only if the end is visible, so the strip counts
 * DOWN. Hinge does this deliberately: "three left" is fine, "step four of nine" is
 * where people quit.
 *
 * Every question has a "prefer not to say", and choosing it is a RECORDED ANSWER, not
 * a gap. Otherwise the question queue asks again forever.
 */
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import {
} from '@clone/shared';
import { setEssential } from '../../lib/api';
import { useSession } from '../../store/session';
import { ESSENTIAL_FIELDS } from '../profile/fields';
import {
  Animation,
  Button, Card, Chip, ChipGroup, Field, Screen, StepsLeft, space, type, usePalette,
} from '../../components/ui';

type Answer = string | string[] | number | null;

interface Question {
  key: string;
  title: string;
  hint?: string;
  kind: 'one' | 'many' | 'number' | 'text';
  options?: { value: string; label: string }[];
}

/**
 * The six, from the shared list.
 *
 * It used to be declared here, which is why Height and Diet could be shown on the
 * profile and set by nothing: this file was the only writer in the app, and anything
 * absent from it was unreachable.
 */
const QUESTIONS: Question[] = ESSENTIAL_FIELDS;

export default function EssentialsScreen() {
  const p = usePalette();
  const token = useSession((s) => s.token);
  const [at, setAt] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [busy, setBusy] = useState(false);

  const q = QUESTIONS[at]!;
  const value = answers[q.key];
  const answered = useMemo(
    () => (Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== ''),
    [value],
  );

  const advance = useCallback(async (skipped: boolean) => {
    if (!token) return;
    setBusy(true);
    // A refusal is sent too. "Declined" and "never asked" must not look the same, or
    // the clone asks the same question every week for ever.
    await setEssential(token, q.key, skipped ? null : (answers[q.key] ?? null));
    setBusy(false);
    if (at + 1 < QUESTIONS.length) setAt(at + 1);
    else router.push('/onboarding/voice');
  }, [token, q.key, answers, at]);

  return (
    <Screen
      footer={
        <>
          <Button label={at + 1 === QUESTIONS.length ? 'Done' : 'Next'} variant="primary"
                  onPress={() => void advance(false)} disabled={!answered} loading={busy} />
          <Button label="Prefer not to say" variant="ghost" onPress={() => void advance(true)} />
        </>
      }
    >
      <StepsLeft left={QUESTIONS.length - at} total={QUESTIONS.length} />

      <View style={{ gap: space.sm }}>
        <Animation mood="connecting" height={130} opacity={0.4} />
        <Text style={[type.display, { color: p.text }]}>{q.title}</Text>
        {q.hint && <Text style={[type.body, { color: p.textSecondary }]}>{q.hint}</Text>}
      </View>

      <Card>
        {q.kind === 'one' && (
          <ChipGroup>
            {q.options!.map((o) => (
              <Chip key={o.value} label={o.label} selected={value === o.value}
                    onPress={() => setAnswers((a) => ({ ...a, [q.key]: o.value }))} />
            ))}
          </ChipGroup>
        )}

        {q.kind === 'many' && (
          <ChipGroup>
            {q.options!.map((o) => {
              const list = Array.isArray(value) ? value : [];
              return (
                <Chip key={o.value} label={o.label} selected={list.includes(o.value)}
                      onPress={() => setAnswers((a) => ({
                        ...a,
                        [q.key]: list.includes(o.value)
                          ? list.filter((v) => v !== o.value)
                          : [...list, o.value],
                      }))} />
              );
            })}
          </ChipGroup>
        )}

        {(q.kind === 'number' || q.kind === 'text') && (
          <Field
            value={value === undefined || value === null ? '' : String(value)}
            onChangeText={(t) => setAnswers((a) => ({ ...a, [q.key]: t }))}
            placeholder={q.kind === 'number' ? '1994' : 'Bangalore'}
            keyboardType={q.kind === 'number' ? 'number-pad' : 'default'}
            autoFocus
          />
        )}
      </Card>

      <Text style={[type.callout, { color: p.textTertiary }]}>
        Your agent cannot go out without these. It is not a form — nothing here is shown
        on a profile until you say so.
      </Text>
    </Screen>
  );
}
