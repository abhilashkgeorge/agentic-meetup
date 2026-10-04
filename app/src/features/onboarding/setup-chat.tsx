/**
 * SETUP, AS A CONVERSATION WITH YOUR CLONE (setup-script.ts says why and what it says).
 *
 * Above, the conversation: the clone's lines and your answers, as bubbles. Below, where
 * the keyboard would be, the way to answer THIS step -- a box to type in, chips, a card's
 * two rows, the age boxes, the map, a button that opens the character builder. It is the
 * old screens' own controls, in a chat: one answer below the last, not a screen after a
 * screen. Each answer is saved by the call the old screen made, and said back as a bubble.
 *
 * `finish=1` is "Finish setup": an agent that cannot go out yet, back for what is
 * missing -- no hello, no stories, no character, and back where it came from at the end.
 */
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MIN_AGE, POOL_REQUIRED, firstName, isAdult } from '@clone/shared';
import {
  answerQuestion, getKnowledge, getMyPhotos, getNextQuestion, getPool, getStories, gradeSelfTest, nextSelfTest, saveStory,
  setEssential, setWhoFine, tell, type InterviewState, type SelfTestItem, type Story,
} from '../../lib/api';
import { useKeyboardHeight } from '../../lib/keyboard';
import { cityFromDevice } from '../../lib/location';
import { setOnboarded } from '../../lib/storage';
import { useSession } from '../../store/session';
import { essentialSteps, type Field as FieldDef } from '../profile/fields';
import { ageRangeDefault, parseAgeRange } from '../profile/age-range';
import { AgeRangeInput, type AgeRangeText } from '../profile/age-range-input';
import { DistanceStep, saveDistance, type DistanceChoice } from '../distance/distance-step';
import {
  allFine, cardAnswer, declineYou, emptyCard, isAllFine, isFine, pickYou, toggleFine, type CardState,
} from './core-card';
import { afterSentence, proposedWhoFine, toggleProposed, type ProposalState } from './sentence-proposal';
import { questionsOver } from './questions-end';
import { afterTell } from './start-state';
import {
  CHARACTER_ASK, DID_NOT_SAVE, ESSENTIALS_INTRO, FINISH_DONE, FINISH_HELLO, HELLO, PHOTOS_ASK, QUESTIONS_INTRO, RESUME_HELLO,
  SAMPLE_INTRO, SAMPLE_THANKS, STORIES_INTRO, STORIES_MAX, TELL_EXAMPLES, VOICE_ASK, askField, askQuestion, cardWords,
  distanceWords, doneLines, fieldWords, firstStage, pickedWords, stageAfter, toldBack, type Line, type Stage,
} from './setup-script';
import { takeVoiceLearned } from './chat-return';
import { Bubble, Button, Chip, ChipGroup, Field, space, type, usePalette } from '../../components/ui';

const pause = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));
/** A beat of "typing" before each of the clone's lines: longer lines, a little longer. */
const typingFor = (text: string) => Math.min(900, 300 + text.length * 6);

export default function SetupChat() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  const { height } = useWindowDimensions();
  const token = useSession((s) => s.token);
  const sessionId = useSession((s) => s.sessionId);
  const { finish } = useLocalSearchParams<{ finish?: string }>();
  const fromFinish = finish === '1';

  const [lines, setLines] = useState<Line[]>([]);
  const [typing, setTyping] = useState(false);
  /** The step being answered; null while the clone is talking or loading. */
  const [stage, setStage] = useState<Stage | null>(null);
  const [busy, setBusy] = useState(false);
  /** What a failed save, or a refused answer, says -- under the answer, which stays. */
  const [note, setNote] = useState<string | null>(null);

  // Each step's own state.
  const [draft, setDraft] = useState('');
  const [sample, setSample] = useState<SelfTestItem | null>(null);
  const [interview, setInterview] = useState<InterviewState | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [card, setCard] = useState<CardState>(emptyCard);
  const [proposal, setProposal] = useState<ProposalState | null>(null);
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [fieldAt, setFieldAt] = useState(0);
  const [answer, setAnswer] = useState<string | string[] | AgeRangeText | null>(null);
  const [fix, setFix] = useState<{ city: string; lat: number; lon: number; precisionKm: number } | null>(null);
  const [distance, setDistance] = useState<DistanceChoice | null>(null);
  const [knownYear, setKnownYear] = useState<number | null>(null);
  const [stories, setStories] = useState<Story[]>([]);
  const [storyAt, setStoryAt] = useState(0);
  const [storyLimits, setStoryLimits] = useState({ min: 12, max: 300 });
  /** The voice import, the builder or the photos opened from the chat: on coming back, the chat goes on. */
  const away = useRef<'voice' | 'character' | 'photos' | null>(null);

  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const next = useRef(0);
  const add = useCallback((from: Line['from'], text: string) => {
    if (!alive.current) return;
    setLines((ls) => [...ls, { id: next.current++, from, text }]);
  }, []);
  /** The clone says these, one after another, each after a beat of typing. */
  const say = useCallback(async (texts: readonly string[]) => {
    for (const t of texts) {
      if (!alive.current) return;
      setTyping(true);
      await pause(typingFor(t));
      setTyping(false);
      add('clone', t);
    }
  }, [add]);

  // ── the steps ─────────────────────────────────────────────────────────────

  const toDone = useCallback(async () => {
    if (fromFinish) {
      await say([FINISH_DONE]);
    } else {
      const known = token ? await getKnowledge(token) : null;
      const name = known?.knows.find((f) => f.predicate === 'first_name')?.value ?? null;
      await say(doneLines(name ? firstName(name) : null));
    }
    if (alive.current) setStage('done');
  }, [fromFinish, say, token]);

  const toPhotos = useCallback(async () => {
    await say([PHOTOS_ASK]);
    if (alive.current) setStage('photos');
  }, [say]);

  const toCharacter = useCallback(async () => {
    await say([CHARACTER_ASK]);
    if (alive.current) setStage('character');
  }, [say]);

  const toVoice = useCallback(async () => {
    await say(VOICE_ASK);
    if (alive.current) setStage('voice');
  }, [say]);

  const askStory = useCallback(async (list: Story[], at: number) => {
    const s = list[at]!;
    setDraft('');
    await say(s.hint ? [s.text, s.hint] : [s.text]);
    if (alive.current) setStage('stories');
  }, [say]);

  const toStories = useCallback(async () => {
    if (!token) return;
    const got = await getStories(token);
    // Unanswered ones only, a few: they are optional, and the chat is not a form.
    const open = (got?.stories ?? []).filter((s) => !s.answer && !s.forYou).slice(0, STORIES_MAX);
    if (!open.length) { await toVoice(); return; }
    setStories(open);
    setStoryAt(0);
    if (got) setStoryLimits({ min: got.min, max: got.max });
    await say([STORIES_INTRO]);
    await askStory(open, 0);
  }, [token, say, askStory, toVoice]);

  const afterEssentials = useCallback(async () => {
    const then = stageAfter('essentials', fromFinish);
    if (then === 'done') await toDone();
    else await toStories();
  }, [fromFinish, toDone, toStories]);

  const askFieldAt = useCallback(async (list: FieldDef[], at: number, year: number | null) => {
    const f = list[at]!;
    setNote(null);
    setFix(null);
    setDistance(null);
    // The age boxes open with a range from your own age, five either side, shown and
    // editable -- as on the old screen, so what is on screen is what Send sends.
    if (f.kind === 'range') {
      const r = ageRangeDefault(year);
      setAnswer(r ? { min: String(r.min), max: String(r.max) } : { min: '', max: '' });
    } else {
      setAnswer(f.kind === 'many' ? [] : null);
    }
    await say(askField(f));
    if (alive.current) setStage('essentials');
  }, [say]);

  const toEssentials = useCallback(async () => {
    if (!token) return;
    const [pool, known] = await Promise.all([getPool(token), getKnowledge(token)]);
    const facts = known?.knows ?? [];
    const year = Number(facts.find((f) => f.predicate === 'birth_date')?.value ?? NaN);
    const held = Number.isFinite(year) && year > 0 ? year : null;
    setKnownYear(held);
    const need = pool && Array.isArray(pool.need) ? pool.need : null;
    // Consent is the one thing the chat cannot ask: its own screen, then back here.
    if (need?.includes('consent')) { router.replace('/consent'); return; }
    const list = essentialSteps(need ?? POOL_REQUIRED, facts.some((f) => f.predicate === 'age_range_sought'));
    if (!list.length) { await afterEssentials(); return; }
    setFields(list);
    setFieldAt(0);
    // Not for "Finish setup": somebody adding their part of town is not being asked what
    // the agent needs to go out (the Pixel, 2026-10-04).
    if (!fromFinish) await say([ESSENTIALS_INTRO]);
    await askFieldAt(list, 0, held);
  }, [token, say, askFieldAt, afterEssentials, fromFinish]);

  /** The next interview question, or on to the essentials when there is none worth asking. */
  const askNext = useCallback(async (stopped = false) => {
    if (!token) return;
    setPicked([]);
    setCard(emptyCard());
    setDraft('');
    setProposal(null);
    setNote(null);
    const got = await getNextQuestion(token);
    if (!alive.current) return;
    if (!got) { add('note', 'Could not load the next question. Check your connection.'); setStage('questions'); setInterview(null); return; }
    if (questionsOver(got.question, stopped, fromFinish)) { await toEssentials(); return; }
    setInterview(got);
    await say(askQuestion(got.question!));
    if (alive.current) setStage('questions');
  }, [token, fromFinish, say, add, toEssentials]);

  // The start.
  useEffect(() => {
    void (async () => {
      if (fromFinish) {
        await say(FINISH_HELLO);
        await askNext();
        return;
      }
      // BACK IN THE MIDDLE OF SETUP (the app closed, a call came): what it heard stands,
      // so no hello and no "one true thing" again -- on with the questions.
      const known = token ? await getKnowledge(token) : null;
      if (known && known.knows.length > 0) {
        await say(RESUME_HELLO);
        await askNext();
        return;
      }
      await say(HELLO);
      if (alive.current) setStage(firstStage(false));
    })();
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Back from the builder or the photos: on with the chat.
  useFocusEffect(useCallback(() => {
    const was = away.current;
    if (!was) return;
    away.current = null;
    void (async () => {
      if (was === 'voice') {
        add('me', takeVoiceLearned() ? 'Done' : 'Later');
        await toCharacter();
        return;
      }
      if (was === 'character') {
        add('me', 'Done');
        await toPhotos();
        return;
      }
      // What happened on the photo screen, said as it was: "Done" for a skip read as if
      // there were photos (the Pixel, 2026-10-04).
      const mine = token ? await getMyPhotos(token) : null;
      const n = mine?.photos?.length ?? 0;
      add('me', n > 0 ? `${n} ${n === 1 ? 'photo' : 'photos'}` : 'Later');
      await toDone();
    })();
  }, [add, toCharacter, toPhotos, toDone, token]));

  // ── the answers ───────────────────────────────────────────────────────────

  const sendTell = useCallback(async () => {
    const text = draft.trim();
    if (!token || text.length < 3) return;
    add('me', text);
    setDraft('');
    setStage(null);
    setTyping(true);
    const r = await tell(token, text, sessionId);
    setTyping(false);
    const then = afterTell(r);
    if (then.next === 'retry') {
      await say([then.note, 'Try another line about you.']);
      if (alive.current) setStage('tell');
      return;
    }
    await say(toldBack(r!));
    if (then.next === 'sample') {
      setTyping(true);
      const item = await nextSelfTest(token);
      setTyping(false);
      if (item && item.question && item.answer) {
        setSample(item);
        await say([SAMPLE_INTRO, item.question, `“${item.answer}”`, 'Is that you?']);
        if (alive.current) setStage('judge');
        return;
      }
    }
    await say([QUESTIONS_INTRO]);
    await askNext();
  }, [token, draft, sessionId, add, say, askNext]);

  const judge = useCallback(async (verdict: 'me' | 'not_me') => {
    if (!token || !sample) return;
    add('me', verdict === 'me' ? "That's me" : 'Not even close');
    setStage(null);
    void gradeSelfTest(token, sample.id, verdict);
    await say([SAMPLE_THANKS[verdict], QUESTIONS_INTRO]);
    await askNext();
  }, [token, sample, add, say, askNext]);

  const answerQ = useCallback(async (words: string, values: string[], text?: string, whoFine?: Parameters<typeof answerQuestion>[4]) => {
    if (!token || !interview?.question) return;
    const q = interview.question;
    setBusy(true);
    setNote(null);
    const saved = await answerQuestion(token, q.id, values, text, whoFine);
    setBusy(false);
    // A failed save keeps what was tapped, as the old screen did.
    if (!saved) { setNote(DID_NOT_SAVE); return; }
    add('me', words);
    setStage(null);
    if (q.kind === 'free') {
      const then = afterSentence(saved.mapped);
      if (then.kind === 'confirm') {
        setProposal(then.proposal);
        await say([`That would change the card “${then.proposal.card}”. Nothing changes unless you keep it.`, then.proposal.text]);
        if (alive.current) setStage('questions');
        return;
      }
      if (then.kind === 'note') await say([then.text]);
    }
    await askNext();
  }, [token, interview, add, say, askNext]);

  const keepProposal = useCallback(async (keep: boolean) => {
    if (!token || !proposal) return;
    if (keep) {
      setBusy(true);
      const saved = await setWhoFine(token, proposal.questionId, proposedWhoFine(proposal));
      setBusy(false);
      if (!saved) { setNote(DID_NOT_SAVE); return; }
    }
    add('me', keep ? 'Keep this' : 'Leave it');
    setStage(null);
    await askNext();
  }, [token, proposal, add, askNext]);

  const answerField = useCallback(async (declined: boolean) => {
    if (!token) return;
    const f = fields[fieldAt];
    if (!f) return;
    setNote(null);
    let words: string;
    if (!declined && f.kind === 'distance') {
      if (!distance) return;
      setBusy(true);
      const ok = await saveDistance(token, distance);
      setBusy(false);
      if (!ok) { setNote(DID_NOT_SAVE); return; }
      words = distanceWords(distance);
    } else {
      // The same refusals as the old screen, said in the chat instead of a dead Send.
      if (!declined && f.key === 'birth_date' && !isAdult({ year: Number(answer ?? NaN), month: null })) {
        setNote(`You need to be ${MIN_AGE} or older to use this.`);
        return;
      }
      if (!declined && f.key === 'first_name' && !firstName(String(answer ?? ''))) {
        setNote('Just your first name, in letters.');
        return;
      }
      const range = f.kind === 'range' && answer && typeof answer === 'object' && !Array.isArray(answer)
        ? parseAgeRange(answer.min, answer.max) : null;
      if (!declined && f.kind === 'range' && !range) return;
      const typed = typeof answer === 'string' ? answer.trim() : '';
      const value = declined ? null : range ?? (Array.isArray(answer) ? answer : typed);
      const place = f.key === 'lives_in' && fix && fix.city.toLowerCase() === typed.toLowerCase() ? fix : undefined;
      setBusy(true);
      const ok = await setEssential(token, f.key, value, declined ? undefined : place);
      setBusy(false);
      if (!ok) { setNote(DID_NOT_SAVE); return; }
      words = fieldWords(f, value as Parameters<typeof fieldWords>[1]);
    }
    add('me', words);
    setStage(null);
    // The neighbourhood is for Bangalore; and the map may have answered it already.
    let list = fields;
    if (f.key === 'lives_in' && typeof answer === 'string' && !/bangalore|bengaluru/i.test(answer)) {
      list = list.filter((x) => x.key !== 'area');
    }
    if (f.kind === 'distance' && distance?.spot?.kind === 'area') {
      list = list.filter((x, i) => i <= fieldAt || x.key !== 'area');
    }
    setFields(list);
    const typedYear = f.key === 'birth_date' ? Number(answer ?? NaN) : NaN;
    const year = Number.isFinite(typedYear) && typedYear > 0 ? typedYear : knownYear;
    if (Number.isFinite(typedYear) && typedYear > 0) setKnownYear(typedYear);
    if (fieldAt + 1 < list.length) {
      setFieldAt(fieldAt + 1);
      await askFieldAt(list, fieldAt + 1, year);
    } else {
      await afterEssentials();
    }
  }, [token, fields, fieldAt, answer, distance, fix, knownYear, add, askFieldAt, afterEssentials]);

  const answerStory = useCallback(async (how: 'send' | 'skip' | 'enough') => {
    if (!token) return;
    const s = stories[storyAt];
    if (!s) return;
    setNote(null);
    if (how === 'send') {
      const text = draft.trim();
      if (text.length < storyLimits.min) { setNote('A little more than that, please: a sentence or two.'); return; }
      setBusy(true);
      const saved = await saveStory(token, s.id, text, true);
      setBusy(false);
      if (!saved) { setNote(DID_NOT_SAVE); return; }
      add('me', text);
    } else {
      add('me', how === 'skip' ? 'Skip' : "That's enough for now");
    }
    setStage(null);
    setDraft('');
    if (how !== 'enough' && storyAt + 1 < stories.length) {
      setStoryAt(storyAt + 1);
      await askStory(stories, storyAt + 1);
    } else {
      await toVoice();
    }
  }, [token, stories, storyAt, draft, storyLimits.min, add, askStory, toVoice]);

  const useMyLocation = useCallback(async () => {
    setNote(null);
    const r = await cityFromDevice();
    if (!r.ok) {
      setNote(r.reason === 'denied' ? 'No problem. Type your city instead.' : 'Could not find you. Type your city.');
      return;
    }
    setFix(r);
    setAnswer(r.city);
  }, []);

  const finishSetup = useCallback(async () => {
    if (fromFinish) {
      if (router.canGoBack()) router.back();
      else router.replace('/');
      return;
    }
    await setOnboarded();
    router.replace('/');
  }, [fromFinish]);

  // ── drawing ───────────────────────────────────────────────────────────────

  const transcript = useRef<ScrollView>(null);
  const q = interview?.question ?? null;
  const field = stage === 'essentials' ? fields[fieldAt] : undefined;

  /**
   * How to answer this step, under the conversation: what to pick or type (`body`, which
   * scrolls when it is long -- a card's two rows of chips, the faith card's eleven), and
   * what sends it (`actions`, pinned below it). The first version scrolled Send away under
   * the faith card's chips, out of sight (the Pixel, 2026-10-04).
   */
  const answerArea = (): { body?: React.ReactNode; actions?: React.ReactNode } | null => {
    switch (stage) {
      case 'tell':
        return {
          body: (
            <ChipGroup>
              {TELL_EXAMPLES.map((e) => <Chip key={e} label={e} selected={draft === e} onPress={() => setDraft(e)} />)}
            </ChipGroup>
          ),
          actions: (
            <Composer value={draft} onChange={setDraft} placeholder="Something true about you" onSend={() => void sendTell()}
                      ready={draft.trim().length >= 3} busy={busy} />
          ),
        };
      case 'judge':
        return {
          actions: (
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button label="That's me" variant="primary" onPress={() => void judge('me')} style={{ flex: 1 }} />
              <Button label="Not even close" onPress={() => void judge('not_me')} style={{ flex: 1 }} />
            </View>
          ),
        };
      case 'questions': {
        if (proposal) {
          return {
            body: (
              <ChipGroup>
                {proposal.options.map((o) => (
                  <Chip key={o.value} label={o.label} selected={proposal.accepted.includes(o.value)}
                        onPress={() => setProposal((s) => (s ? toggleProposed(s, o.value) : s))} />
                ))}
              </ChipGroup>
            ),
            actions: (
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <Button label="Keep this" variant="primary" loading={busy} onPress={() => void keepProposal(true)} style={{ flex: 1 }} />
                <Button label="Leave it" onPress={() => void keepProposal(false)} style={{ flex: 1 }} />
              </View>
            ),
          };
        }
        if (!q) return { actions: <Button label="Try again" variant="primary" onPress={() => void askNext()} /> };
        if (q.tier === 'core') {
          const fine = q.whoFine ?? { text: 'Which are okay for your partner?', options: q.options };
          const fineValues = fine.options.map((o) => o.value);
          const mine = card.you.kind === 'picked' ? card.you.values : [];
          const done = cardAnswer(card);
          return {
            body: (
              <>
                <Text style={[type.bodyStrong, { color: p.text }]}>You</Text>
                <ChipGroup>
                  {q.options.map((o) => (
                    <Chip key={o.value} label={o.label} selected={mine.includes(o.value)}
                          onPress={() => setCard((c) => pickYou(c, o.value, q.multi))} />
                  ))}
                  {q.declinable && (
                    <Chip label="Prefer not to say" selected={card.you.kind === 'declined'} onPress={() => setCard(declineYou)} />
                  )}
                </ChipGroup>
                <Text style={[type.bodyStrong, { color: p.text }]}>Your partner</Text>
                <Text style={[type.callout, { color: p.textSecondary }]}>{fine.text} Tap every one that is okay.</Text>
                <ChipGroup>
                  <Chip label="All are okay" selected={isAllFine(card, fineValues)} onPress={() => setCard((c) => allFine(c, fineValues))} />
                  {fine.options.map((o) => (
                    <Chip key={o.value} label={o.label} selected={isFine(card, o.value)}
                          onPress={() => setCard((c) => toggleFine(c, o.value, fineValues))} />
                  ))}
                </ChipGroup>
              </>
            ),
            actions: (
              <>
                <Button label="Send" variant="primary" disabled={!done} loading={busy}
                        onPress={() => done && void answerQ(cardWords(q, done), done.values, undefined, done.whoFine)} />
                {q.optional && <Button label="Skip this one" variant="ghost" onPress={() => void answerQ('Skip', [])} />}
              </>
            ),
          };
        }
        if (q.kind === 'free') {
          return {
            actions: (
              <>
                <Composer value={draft} onChange={setDraft} placeholder="Someone who…" onSend={() => void answerQ(draft.trim(), [], draft.trim())}
                          ready={draft.trim().length > 2} busy={busy} max={300} />
                {!q.required && <Button label="Skip this one" variant="ghost" onPress={() => void answerQ('Skip', [])} />}
              </>
            ),
          };
        }
        return {
          body: (
            <ChipGroup>
              {q.options.map((o) => (
                <Chip key={o.value} label={o.label} selected={picked.includes(o.value)}
                      onPress={() => {
                        if (q.multi) {
                          setPicked((was) => (was.includes(o.value) ? was.filter((v) => v !== o.value) : [...was, o.value]));
                        } else {
                          // One tap is the answer, as on the old screen.
                          setPicked([o.value]);
                          void answerQ(o.label, [o.value]);
                        }
                      }} />
              ))}
            </ChipGroup>
          ),
          actions: (
            <>
              {q.multi && (
                <Button label="Send" variant="primary" disabled={!picked.length} loading={busy}
                        onPress={() => void answerQ(pickedWords(q.options, picked), picked)} />
              )}
              <View style={{ flexDirection: 'row', gap: space.sm, justifyContent: 'center' }}>
                {!q.required && <Button label="Skip this one" variant="ghost" onPress={() => void answerQ('Skip', [])} />}
                {q.tier === 'optional' && (
                  <Button label="That's enough for now" variant="ghost"
                          onPress={() => { add('me', "That's enough for now"); setStage(null); void askNext(true); }} />
                )}
              </View>
            </>
          ),
        };
      }
      case 'essentials': {
        if (!field) return null;
        const optional = !POOL_REQUIRED.includes(field.key as (typeof POOL_REQUIRED)[number]) && field.kind !== 'range';
        const typed = field.kind === 'text' || field.kind === 'number';
        return {
          body: typed ? undefined : (
            <>
              {field.kind === 'distance' && <DistanceStep detect onChange={setDistance} />}
              {field.kind === 'range' && (
                <AgeRangeInput value={answer && typeof answer === 'object' && !Array.isArray(answer) ? answer : { min: '', max: '' }}
                               onChange={setAnswer} />
              )}
              {(field.kind === 'one' || field.kind === 'many') && (
                <ChipGroup>
                  {field.options!.map((o) => {
                    const on = Array.isArray(answer) ? answer.includes(o.value) : answer === o.value;
                    return (
                      <Chip key={o.value} label={o.label} selected={on}
                            onPress={() => setAnswer((a) => (field.kind === 'many'
                              ? (Array.isArray(a) ? (a.includes(o.value) ? a.filter((v) => v !== o.value) : [...a, o.value]) : [o.value])
                              : o.value))} />
                    );
                  })}
                </ChipGroup>
              )}
            </>
          ),
          actions: (
            <>
              {typed && (
                <Composer value={typeof answer === 'string' ? answer : ''} onChange={(t) => { setNote(null); setAnswer(t); }}
                          placeholder={field.placeholder ?? (field.kind === 'number' ? '1994' : '')} number={field.kind === 'number'}
                          onSend={() => void answerField(false)} ready={typeof answer === 'string' && answer.trim().length > 0} busy={busy} />
              )}
              {field.key === 'lives_in' && <Button label="Use my location" onPress={() => void useMyLocation()} />}
              {!typed && (
                <Button label="Send" variant="primary" loading={busy}
                        disabled={field.kind === 'distance' ? !distance
                          : field.kind === 'range' ? !(answer && typeof answer === 'object' && !Array.isArray(answer) && parseAgeRange(answer.min, answer.max))
                            : Array.isArray(answer) ? !answer.length : !answer}
                        onPress={() => void answerField(false)} />
              )}
              {optional && <Button label="Prefer not to say" variant="ghost" onPress={() => void answerField(true)} />}
            </>
          ),
        };
      }
      case 'stories':
        return {
          actions: (
            <>
              <Composer value={draft} onChange={(t) => { setNote(null); setDraft(t); }} placeholder="A sentence or two"
                        onSend={() => void answerStory('send')} ready={draft.trim().length > 0} busy={busy} max={storyLimits.max} />
              <View style={{ flexDirection: 'row', gap: space.sm, justifyContent: 'center' }}>
                <Button label="Skip" variant="ghost" onPress={() => void answerStory('skip')} />
                <Button label="That's enough for now" variant="ghost" onPress={() => void answerStory('enough')} />
              </View>
            </>
          ),
        };
      case 'voice':
        return {
          actions: (
            <>
              <Button label="Share a chat" variant="primary"
                      onPress={() => { away.current = 'voice'; router.push({ pathname: '/onboarding/voice', params: { from: 'chat' } }); }} />
              <Button label="Skip for now" variant="ghost" onPress={() => { add('me', 'Skip for now'); setStage(null); void toCharacter(); }} />
            </>
          ),
        };
      case 'character':
        return {
          actions: (
            <>
              <Button label="Make my character" variant="primary"
                      onPress={() => { away.current = 'character'; router.push({ pathname: '/onboarding/character', params: { from: 'chat' } }); }} />
              <Button label="Skip for now" variant="ghost" onPress={() => { add('me', 'Skip for now'); setStage(null); void toPhotos(); }} />
            </>
          ),
        };
      case 'photos':
        return {
          actions: (
            <>
              <Button label="Add photos" variant="primary"
                      onPress={() => { away.current = 'photos'; router.push({ pathname: '/onboarding/photos', params: { from: 'chat' } }); }} />
              <Button label="Skip for now" variant="ghost" onPress={() => { add('me', 'Skip for now'); setStage(null); void toDone(); }} />
            </>
          ),
        };
      case 'done':
        return { actions: <Button label={fromFinish ? 'Back' : 'Go to the town'} variant="primary" onPress={() => void finishSetup()} /> };
      default:
        return null;
    }
  };

  const area = answerArea();
  // The map and the core cards are tall: what to pick may take much of the screen, the
  // conversation scrolling above it -- always to its last line, which is the question.
  const maxBody = Math.round(height * (field?.kind === 'distance' ? 0.6 : 0.42));
  const toEnd = () => transcript.current?.scrollToEnd({ animated: true });
  return (
    <View style={{ flex: 1, backgroundColor: p.bg, paddingBottom: Math.max(keyboard, insets.bottom) + space.sm }}>
      <ScrollView
        ref={transcript}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: space.screen, paddingTop: space.md, paddingBottom: space.md }}
        onContentSizeChange={toEnd}
        onLayout={toEnd}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {lines.map((l) => l.from === 'note' ? (
          <Text key={l.id} style={[type.callout, { color: p.textSecondary, textAlign: 'center', paddingVertical: space.sm }]}>{l.text}</Text>
        ) : (
          <Bubble key={l.id} text={l.text} mine={l.from === 'me'} />
        ))}
        {typing && <Bubble text="…" mine={false} pending />}
      </ScrollView>
      {area !== null && (
        <View style={{ paddingHorizontal: space.screen, paddingTop: space.sm, gap: space.sm }}>
          {area.body !== undefined && (field?.kind === 'distance' ? (
            <View style={{ maxHeight: maxBody, gap: space.sm }}>{area.body}</View>
          ) : (
            <ScrollView style={{ maxHeight: maxBody }} keyboardShouldPersistTaps="handled"
                        contentContainerStyle={{ gap: space.sm, paddingTop: space.xs, paddingBottom: space.xs }}
                        showsVerticalScrollIndicator>
              {area.body}
            </ScrollView>
          ))}
          {note && <Text style={[type.callout, { color: p.danger }]}>{note}</Text>}
          {area.actions}
        </View>
      )}
    </View>
  );
}

/** A box to type in, and Send beside it. */
function Composer({
  value, onChange, placeholder, onSend, ready, busy, max, number,
}: {
  value: string; onChange: (t: string) => void; placeholder: string; onSend: () => void;
  ready: boolean; busy: boolean; max?: number; number?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-end' }}>
      <View style={{ flex: 1 }}>
        <Field value={value} onChangeText={onChange} placeholder={placeholder} multiline={!number} minHeight={24}
               maxLength={max} keyboardType={number ? 'number-pad' : 'default'} />
      </View>
      <Button label="Send" variant="primary" onPress={onSend} disabled={!ready} loading={busy}
              style={{ paddingHorizontal: space.lg }} />
    </View>
  );
}
