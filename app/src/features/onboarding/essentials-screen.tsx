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
import { MIN_AGE, POOL_REQUIRED, isAdult } from '@clone/shared';
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
  const [note, setNote] = useState<string | null>(null);

  const q = QUESTIONS[at]!;
  const value = answers[q.key];
  const answered = useMemo(
    () => (Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== ''),
    [value],
  );

  const advance = useCallback(async (skipped: boolean) => {
    if (!token) return;
    setNote(null);

    // THE ONE ANSWER THAT CAN BE REFUSED OUTRIGHT. The server rejects an under-age
    // birth year in three places and will do so whatever this screen sends; checking
    // here as well is so the person reads a sentence instead of watching Next do
    // nothing. `isAdult` is the shared rule, so the two cannot drift apart.
    if (!skipped && q.key === 'birth_date') {
      const year = Number(answers[q.key] ?? NaN);
      if (!isAdult({ year, month: null })) {
        setNote(`You need to be ${MIN_AGE} or older to use this.`);
        return;
      }
    }

    setBusy(true);
    // A refusal is sent too. "Declined" and "never asked" must not look the same, or
    // the clone asks the same question every week for ever.
    const ok = await setEssential(token, q.key, skipped ? null : (answers[q.key] ?? null));
    setBusy(false);
    if (!ok) { setNote('That did not save. Check your connection and try again.'); return; }
    if (at + 1 < QUESTIONS.length) setAt(at + 1);
    else router.push('/onboarding/voice');
  }, [token, q.key, answers, at]);

  return (
    <Screen topInset={false}
      footer={
        <>
          <Button label={at + 1 === QUESTIONS.length ? 'Done' : 'Next'} variant="primary"
                  onPress={() => void advance(false)} disabled={!answered} loading={busy} />
          {/* OFFERED ONLY WHERE DECLINING IS ACTUALLY SURVIVABLE.
          
              Four of these five questions gate the pool server-side, and the app was
              offering "Prefer not to say" on all of them but the birth year. Somebody
              could decline their gender, be thanked and moved along, and then find
              their agent could never go out -- with nothing anywhere connecting the
              two. A question that cannot be skipped and a question that gates the
              pool have to be the same list, and now they are one list.
          
              How far you would travel is the only genuinely optional one: no answer
              means no distance filter, which costs nobody a match. */}
          {!POOL_REQUIRED.includes(q.key as (typeof POOL_REQUIRED)[number]) && (
            <Button label="Prefer not to say" variant="ghost" onPress={() => void advance(true)} />
          )}
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

      {note && <Text style={[type.callout, { color: p.danger }]}>{note}</Text>}

      {/* ONE NOTE, NOT TWO.
      
          The birth-year question used to carry both of these, and they overlap: one
          promises the birthday is "never shown to anybody", the other that "nothing
          here is shown on a profile". Saying it twice does not make it twice as
          reassuring, and four lines of small grey text pushed the Next button off the
          bottom of a small phone -- so the question with the most to explain was the
          one where the explanation could not be read.
      
          The specific note wins where there is one: it says everything the general one
          says, about the field actually on screen. */}
      <Text style={[type.callout, { color: p.textTertiary }]}>
        {q.key === 'birth_date'
          ? `You must be ${MIN_AGE} or older. Your birthday is never shown to anybody — only your age, and only once you have both said yes.`
          : 'Your agent cannot go out without these. It is not a form — nothing here is shown on a profile until you say so.'}
      </Text>
    </Screen>
  );
}
