/**
 * The interview. One question, then the next.
 *
 * This is the spine of onboarding, not a step in it. The strongest known way to make a
 * clone answer like a particular person is a long structured interview — and what
 * actually predicts somebody is how they answer specific questions, not a profile.
 *
 * THE ORDER IS FIXED, AND IT USED TO BE AKINATOR. The server picked whichever question
 * most divided the people you could be matched with -- but during setup that pool is
 * empty, every option scores zero, and the "best" question was whichever came first in
 * a list. It now asks, in this order: the basics (what you are, who you want to meet,
 * what you are after), then five core cards -- kids, one person or open, smoking,
 * drinking, food -- then an optional sentence, then optional chips.
 *
 * A CORE CARD IS TWO BOXES ON ONE SCREEN: "You", and "Your partner", each headed with
 * whose it is and asking its own question under the card's short title ("Smoking").
 * The partner box shows the same options as yours, none ticked; it is where a rule
 * comes from. core-card.ts says why it opens empty and holds the state, so the rule is
 * tested without a phone. The agent cannot go out until all five cards have an answer
 * -- "Prefer not to say" counts as one.
 *
 * THE OPTIONAL TAIL CAN BE LEFT. After the core, every question is optional and there
 * are a dozen of them. The start screen promises a few quick questions, so on those the
 * screen offers "That's enough for now", and a "Finish setup" visitor -- who came back
 * for the cards and nothing else -- is not shown them at all.
 *
 * NO PROGRESS BAR, and that is deliberate. The interview ends when there is nothing
 * left worth asking, which is not a number anybody can promise up front. What is shown
 * instead is the thing that actually matters: whether the agent can go out yet.
 */
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import {
  answerQuestion, getNextQuestion, markQuestionDone, setWhoFine, skipQuestionOfDay,
  type InterviewState, type WhoFine,
} from '../../lib/api';
import { useSession } from '../../store/session';
import {
  allFine, cardAnswer, declineYou, emptyCard, isAllFine, isFine, pickYou, toggleFine,
  type CardState,
} from './core-card';
import {
  afterSentence, proposedWhoFine, toggleProposed, type ProposalState,
} from './sentence-proposal';
import { questionsOver, straightOn } from './questions-end';
import {
  Animation, Button, Card, Chip, ChipGroup, Field, Screen, space, type, usePalette,
} from '../../components/ui';

export default function InterviewScreen() {
  const p = usePalette();
  const token = useSession((s) => s.token);
  /**
   * finish=1 is a person who is already set up, sent back from "Finish setting it up"
   * for the core cards. When those are done they go on to anything else still missing
   * and then back where they came from -- never into the onboarding tail, and never
   * through a dozen optional chips they did not come for.
   */
  const { finish, card: one, qotd } = useLocalSearchParams<{ finish?: string; card?: string; qotd?: string }>();
  const fromFinish = finish === '1';
  const [state, setState] = useState<InterviewState | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [card, setCard] = useState<CardState>(emptyCard);
  const [sentence, setSentence] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /** "That's enough for now", on an optional question. */
  const [stopped, setStopped] = useState(false);
  /**
   * After the sentence: what it would change on a card, waiting for a tap. The model
   * only proposes; nothing filters anybody until "Keep this" (sentence-proposal.ts).
   */
  const [proposal, setProposal] = useState<ProposalState | null>(null);
  /** After the sentence, when there is nothing to confirm: said, then Next. */
  const [told, setTold] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setPicked([]);
    // Every card opens empty, both rows. Carrying the last card's Who's-fine choice
    // over would be exactly the pre-ticked row this screen exists not to have.
    setCard(emptyCard());
    setSentence('');
    setNote(null);
    setProposal(null);
    setTold(null);
    // ONE CARD (the question of the day): that card, opened again, then back.
    setState(await getNextQuestion(token, one));
  }, [token, one]);

  useEffect(() => { void load(); }, [load]);

  const submit = useCallback(async (values: string[], text?: string, whoFine?: WhoFine) => {
    if (!token || !state?.question) return;
    setBusy(true);
    setNote(null);
    const saved = await answerQuestion(token, state.question.id, values, text, whoFine);
    setBusy(false);
    // A failed save keeps what was tapped and says so. Reloading instead brought the
    // same question back blank, which on a core card threw away three taps and looked
    // like the app had ignored them.
    if (!saved) { setNote('That did not save. Check your connection and try again.'); return; }
    // The sentence is the one answer that may come back with something to decide.
    if (state.question.kind === 'free') {
      const then = afterSentence(saved.mapped);
      if (then.kind === 'confirm') { setProposal(then.proposal); return; }
      if (then.kind === 'note') { setTold(then.text); return; }
    }
    // Opened for one card: say the question of the day is done -- or, when an optional
    // card was skipped whole, that it was skipped -- and go back where they came from.
    if (one) {
      if (qotd) await (values.length === 0 && !whoFine ? skipQuestionOfDay(token, qotd) : markQuestionDone(token, qotd));
      router.back();
      return;
    }
    void load();
  }, [token, state, load, one, qotd]);

  /** "Keep this": the proposal becomes the card's rule. The only way it ever does. */
  const keep = useCallback(async () => {
    if (!token || !proposal) return;
    setBusy(true);
    setNote(null);
    const saved = await setWhoFine(token, proposal.questionId, proposedWhoFine(proposal));
    setBusy(false);
    if (!saved) { setNote('That did not save. Check your connection and try again.'); return; }
    void load();
  }, [token, proposal, load]);

  // The end of the questions, decided before any screen is drawn: when the essentials
  // are still to come, straight on to them (questions-end.ts says why).
  const over = state !== null && !proposal && !told && questionsOver(state.question, stopped, fromFinish);
  const onward = straightOn(over, state?.ready ?? false, fromFinish);
  useEffect(() => {
    if (onward) router.replace(onward as Href);
  }, [onward]);

  if (!state || onward) {
    return (
      <Screen topInset={false} center>
        <ActivityIndicator color={p.accent} size="large" />
      </Screen>
    );
  }

  const q = state.question;

  // What the sentence would change on a card. Shown before anything else, because the
  // person has just written it and nothing has been changed yet.
  if (proposal) {
    return (
      <Screen topInset={false}
        footer={
          <>
            <Button label="Keep this" variant="primary" onPress={() => void keep()} loading={busy} />
            <Button label="Leave it" variant="ghost" onPress={() => void load()} />
          </>
        }
      >
        <View style={{ gap: space.xs }}>
          <Text style={[type.label, { color: p.textTertiary }]}>FROM WHAT YOU WROTE</Text>
          <Text style={[type.display, { color: p.text }]}>Change this card?</Text>
          <Text style={[type.body, { color: p.textSecondary }]}>
            Your agent read your answer as this. Nothing changes unless you keep it.
          </Text>
        </View>
        <Card label={proposal.card}>
          <Text style={[type.bodyStrong, { color: p.text }]}>{proposal.text}</Text>
          <Text style={[type.callout, { color: p.textSecondary }]}>
            Unticked means they never show up. People who have not said still pass.
          </Text>
          <ChipGroup>
            {proposal.options.map((o) => (
              <Chip
                key={o.value}
                label={o.label}
                selected={proposal.accepted.includes(o.value)}
                onPress={() => setProposal((s) => (s ? toggleProposed(s, o.value) : s))}
              />
            ))}
          </ChipGroup>
        </Card>
        {note && <Text style={[type.callout, { color: p.danger }]}>{note}</Text>}
      </Screen>
    );
  }

  // Read, and nothing to change: say which, then go on.
  if (told) {
    return (
      <Screen topInset={false} center
        footer={<Button label="Next" variant="primary" onPress={() => void load()} />}
      >
        <Text style={[type.title, { color: p.text, textAlign: 'center' }]}>{told}</Text>
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
   *
   * A "Finish setup" visitor goes to the essentials wizard with finish=1 instead: it
   * asks only what is still missing (and the age range, if they set up before it
   * existed), then goes back to where they started. With nothing to ask it goes back
   * at once.
   */
  const done = (): void => {
    if (fromFinish) {
      router.replace({ pathname: '/onboarding/essentials', params: { finish: '1' } });
      return;
    }
    // Ready: the stories next -- what the agent will have to talk about -- then the
    // character. Their Next goes on to the character, and every answer is optional.
    router.replace(state.ready ? '/onboarding/stories' : '/onboarding/essentials');
  };

  // Only ever ready here: an end with the essentials still to come went straight on.
  // (`!q` is already part of `over`; said again so the code below knows there is one.)
  if (over || !q) {
    return (
      <Screen topInset={false}
        center
        footer={<Button label="Let it go out" variant="primary" onPress={done} />}
      >
        <Animation mood="sending" height={200} />
        <Text style={[type.display, { color: p.text }]}>That's enough to start</Text>
        <Card>
          <Text style={[type.title, { color: p.text }]}>{state.answered}</Text>
          <Text style={[type.callout, { color: p.textSecondary }]}>questions answered</Text>
          <Text style={[type.body, { color: p.textSecondary }]}>
            Your agent can go out and meet people for you now. It keeps learning as
            you use it.
          </Text>
        </Card>
      </Screen>
    );
  }

  const core = q.tier === 'core';
  // The server sends the Who's-fine row with the card, over the same values. Should it
  // ever arrive without one, the card's own options are the same list -- a core card
  // with no second row could not be answered at all, since the server refuses it.
  const fine = q.whoFine ?? { text: 'Which are okay for your partner?', options: q.options };
  const fineValues = fine.options.map((o) => o.value);
  const mine = card.you.kind === 'picked' ? card.you.values : [];
  // Null until BOTH rows are answered, explicitly. This is what keeps Next dead.
  const answer = core ? cardAnswer(card) : null;
  const ready = core
    ? answer !== null
    : q.kind === 'free' ? sentence.trim().length > 2 : picked.length > 0;

  return (
    <Screen topInset={false}
      footer={
        <>
          <Button
            label={!core && q.multi ? `Next${picked.length ? ` (${picked.length})` : ''}` : 'Next'}
            variant="primary"
            onPress={() => void (core
              ? answer && submit(answer.values, undefined, answer.whoFine)
              : q.kind === 'free'
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
              the server refuses the skip as well.

              And except for a core card, where the way to decline is "Prefer not to
              say" on the You row: the Who's-fine half still has to be chosen, because
              it is about other people and applies whatever you said about yourself. */}
          {/* An optional card (faith) is skipped whole: nothing on either row. */}
          {!q.required && (!core || q.optional) && (
            <Button label="Skip this one" variant="ghost" onPress={() => void submit([])} />
          )}
          {q.tier === 'optional' && (
            <Button label="That's enough for now" variant="ghost" onPress={() => setStopped(true)} />
          )}
          {(q.required || core) && !q.optional && (
            <Text style={[type.callout, { color: p.textTertiary, textAlign: 'center' }]}>
              This one decides who your agent can reach.
            </Text>
          )}
        </>
      }
    >
      <View style={{ gap: space.xs }}>
        <Text style={[type.label, { color: p.textTertiary }]}>
          {core
            ? 'A FEW QUICK QUESTIONS'
            : state.answered > 0 ? `${state.answered} ANSWERED` : 'LET’S START'}
          {/* Only a real number: "under 20" (null) says nothing worth a header. */}
          {!core && state.poolSize !== null ? ` · ${state.poolSize.toLocaleString()} PEOPLE IN RANGE` : ''}
        </Text>
        {/* A card is titled by its topic; its question sits in the You box. */}
        <Text style={[type.display, { color: p.text }]}>{core ? (q.topic ?? q.text) : q.text}</Text>
        {q.why && <Text style={[type.body, { color: p.textSecondary }]}>{q.why}</Text>}
      </View>

      {/* A core card: two boxes, and nothing submits until both are answered. The
          single-choice shortcut below (tap = submit) is NOT used here -- one tap in the
          You box would send the card before the partner box was ever seen. */}
      {core ? (
        <>
          {/* WHOSE BOX IS WHICH, said in words big enough to read. The first version
              had a small "You" and "Who's fine" over a title asking "Do you smoke?", and
              the founder: "A normal user cannot understand what the two boxes are". */}
          <Card>
            <Text style={[type.title, { color: p.text }]}>You</Text>
            <Text style={[type.bodyStrong, { color: p.textSecondary }]}>{q.text}</Text>
            <ChipGroup>
              {q.options.map((o) => (
                <Chip
                  key={o.value}
                  label={o.label}
                  selected={mine.includes(o.value)}
                  onPress={() => setCard((c) => pickYou(c, o.value, q.multi))}
                />
              ))}
              {q.declinable && (
                <Chip
                  label="Prefer not to say"
                  selected={card.you.kind === 'declined'}
                  onPress={() => setCard(declineYou)}
                />
              )}
            </ChipGroup>
          </Card>

          {/* The same options as yours, from the start, none ticked: tap every one
              that is okay. It used to hide them behind "Let me choose" ("why is it in
              the partner the options shown only after I click let me choose"). */}
          <Card>
            <Text style={[type.title, { color: p.text }]}>Your partner</Text>
            <Text style={[type.bodyStrong, { color: p.textSecondary }]}>{fine.text}</Text>
            {/* "Or haven't said" is the honest half of every rule: somebody who never
                answered the card passes it. Said here, where the rule is made. */}
            <Text style={[type.callout, { color: p.textTertiary }]}>
              Tap every one that is okay. People who have not said still pass.
            </Text>
            <ChipGroup>
              <Chip
                label="All are okay"
                selected={isAllFine(card, fineValues)}
                onPress={() => setCard((c) => allFine(c, fineValues))}
              />
              {fine.options.map((o) => (
                <Chip
                  key={o.value}
                  label={o.label}
                  selected={isFine(card, o.value)}
                  onPress={() => setCard((c) => toggleFine(c, o.value, fineValues))}
                />
              ))}
            </ChipGroup>
          </Card>
        </>
      ) : q.kind === 'free' ? (
        /* A sentence, not a choice. The one question in the flow that asks for a real
           thought, and the only one whose answer could end up quoted to somebody else. */
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

      {note && <Text style={[type.callout, { color: p.danger }]}>{note}</Text>}

      {!core && q.kind === 'free' && (
        <Animation mood="connecting" height={140} opacity={0.4} />
      )}

      {/* Only "about them". It used to add "Only the strongest answer rules anybody
          out", from when four "same as me" questions could write a dealbreaker. The one
          preference question left writes a want that only moves people up the list,
          and its own `why` line above says so; the two lines contradicted each other. */}
      {!core && q.kind === 'preference' && (
        <Text style={[type.callout, { color: p.textTertiary }]}>
          This one is about them, not you.
        </Text>
      )}
    </Screen>
  );
}
