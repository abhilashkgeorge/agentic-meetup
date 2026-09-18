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
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { MIN_AGE, POOL_REQUIRED, isAdult } from '@clone/shared';
import { getPool, setEssential } from '../../lib/api';
import { cityFromDevice } from '../../lib/location';
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

export default function EssentialsScreen() {
  const p = usePalette();
  const token = useSession((s) => s.token);
  const [at, setAt] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [busy, setBusy] = useState(false);
  /**
   * WHERE THIS SCREEN GOES WHEN IT IS DONE, which depends on how it was reached.
   *
   * First-time setup arrives from the interview (no param) and flows forward into the
   * rest of onboarding -- voice, then photos. But "Finish setup" from the chat home,
   * the matches tab or the profile arrives with finish=1, and those people are already
   * set up; dropping them into the voice-import step would re-run the whole onboarding
   * tail to fix one field. They go back where they came from instead.
   */
  const { finish } = useLocalSearchParams<{ finish?: string }>();
  const fromFinish = finish === '1';
  const routeOnward = () => {
    // A "Finish setup" visitor goes back where they came from; if there is nothing to
    // go back to (a cold start on this route), the matches tab, never the onboarding
    // tail. Only genuine first-time setup flows forward into voice.
    if (fromFinish) {
      if (router.canGoBack()) router.back();
      else router.replace('/(tabs)/matches');
      return;
    }
    router.push('/onboarding/voice');
  };
  /**
   * ONLY WHAT IS STILL MISSING, not all six every time.
   *
   * This screen used to ask the whole list on every visit -- so the interview would
   * collect gender, seeking and intent, and then this screen asked for them AGAIN, and
   * "Finish setup" re-ran all six to fix the one thing that was actually missing. The
   * pool now reports exactly what to ask in `need` (the raw predicate keys: the missing
   * required fields, plus distance while it is still worth offering), so the wizard is
   * just a filter over that. `need` absent -- offline, or a server too old to send it
   * -- falls back to the full list rather than skipping setup entirely.
   */
  const [questions, setQuestions] = useState<Question[] | null>(null);
  useEffect(() => {
    // No token should not be reachable behind the auth gate, but returning here without
    // setting `questions` would leave the loading spinner up for ever, so fall through
    // to the full list rather than hang.
    if (!token) { setQuestions(ESSENTIAL_FIELDS); return; }
    let live = true;
    void (async () => {
      const pool = await getPool(token);
      if (!live) return;
      const need = pool && Array.isArray(pool.need) ? pool.need : null;
      if (!need) { setQuestions(ESSENTIAL_FIELDS); return; }
      // Consent is a pool requirement but not a field this screen can ask. Send them to
      // the one screen that can, instead of filtering it away and calling setup done.
      if (need.includes('consent')) { router.replace('/consent'); return; }
      const filtered = ESSENTIAL_FIELDS.filter((f) => need.includes(f.key));
      // Nothing this screen can ask -- the agent has what it needs. Go on rather than
      // show an empty wizard: back to the caller for a "Finish setup", forward for setup.
      if (filtered.length === 0) { routeOnward(); return; }
      setQuestions(filtered);
    })();
    return () => { live = false; };
  }, [token]);

  // While loading, and for the hook wiring below, fall back to the full list. The
  // loading screen is returned before any of it is rendered.
  const list = questions ?? ESSENTIAL_FIELDS;
  /**
   * Whatever needs saying under the card.
   *
   * Carries its own tone. "That did not save" is a failure and should look like one;
   * "no problem, type it instead" is not, and printing it in the danger colour tells
   * somebody they broke something by declining a permission, which they did not.
   */
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  /**
   * The position the phone worked out, if it was asked.
   *
   * Held beside the text rather than instead of it, because the field stays editable:
   * somebody can auto-fill "Bangalore" and then type "Mysore" over it. Cleared the
   * moment the text stops matching, so an edited city never ships yesterday's
   * coordinates.
   */
  const [fix, setFix] = useState<
    { city: string; lat: number; lon: number; precisionKm: number } | null
  >(null);
  const [locating, setLocating] = useState(false);

  const q = list[at]!;
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
        setNote({ text: `You need to be ${MIN_AGE} or older to use this.`, bad: true });
        return;
      }
    }

    setBusy(true);
    // A refusal is sent too. "Declined" and "never asked" must not look the same, or
    // the clone asks the same question every week for ever.
    const typed = String(answers[q.key] ?? '').trim();
    // Only when the text still says what the phone found. See `fix`.
    const place = q.key === 'lives_in' && fix && fix.city.toLowerCase() === typed.toLowerCase()
      ? fix
      : undefined;
    const ok = await setEssential(
      token, q.key, skipped ? null : (answers[q.key] ?? null), skipped ? undefined : place,
    );
    setBusy(false);
    if (!ok) { setNote({ text: 'That did not save. Check your connection and try again.', bad: true }); return; }
    if (at + 1 < list.length) setAt(at + 1);
    else routeOnward();
  }, [token, q.key, answers, at, fix, list.length]);

  const useMyLocation = async () => {
    setNote(null);
    setLocating(true);
    const r = await cityFromDevice();
    setLocating(false);

    if (!r.ok) {
      // Each of these is a different thing to do next, so each gets its own sentence.
      setNote({
        bad: r.reason === 'failed',
        text:
          r.reason === 'denied'
            ? 'No problem — type your city instead. You can turn location on later in Settings.'
            : r.reason === 'unavailable'
              ? 'This version of the app cannot read your location yet. Type your city instead.'
              : 'Could not work out where you are. Type your city instead.',
      });
      return;
    }

    setFix(r);
    setAnswers((a) => ({ ...a, lives_in: r.city }));
  };

  if (!questions) {
    return (
      <Screen center topInset={false}>
        <ActivityIndicator color={p.textTertiary} />
      </Screen>
    );
  }

  return (
    <Screen topInset={false}
      footer={
        <>
          <Button label={at + 1 === list.length ? 'Done' : 'Next'} variant="primary"
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
      <StepsLeft left={list.length - at} total={list.length} />

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
            key={q.key}
            value={value === undefined || value === null ? '' : String(value)}
            onChangeText={(t) => setAnswers((a) => ({ ...a, [q.key]: t }))}
            placeholder={q.kind === 'number' ? '1994' : 'Bangalore'}
            keyboardType={q.kind === 'number' ? 'number-pad' : 'default'}
            autoFocus
          />
        )}

        {/* AUTO-FILL, ON A TAP, NEVER ON ARRIVAL.
        
            The permission dialog is raised by this button and by nothing else. A
            location prompt that appears the moment a screen opens is the reason people
            say no to all of them -- asked when somebody has just read "Where are you
            now?" and reached for the keyboard, it is obviously about the thing in
            front of them.
        
            The field stays editable afterwards. This fills it in; it does not take it
            over. */}
        {q.key === 'lives_in' && (
          <Button
            label={locating ? 'Finding you…' : 'Use my location'}
            variant="secondary"
            loading={locating}
            disabled={locating}
            onPress={() => void useMyLocation()}
          />
        )}
      </Card>

      {note && (
        <Text style={[type.callout, { color: note.bad ? p.danger : p.textSecondary }]}>
          {note.text}
        </Text>
      )}

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
