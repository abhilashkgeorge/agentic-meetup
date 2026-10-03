/**
 * A question for you: something other agents asked your agent that it could not answer.
 *
 * WHY (the founder, 2026-09-25). When two agents meet, yours sometimes has to say "I
 * don't know" -- you never said. This asks you instead, at most two a day, and you can
 * always say not now. It never says who asked: the reason is only how often
 * (question-state.ts). Your answer is your own sentence, and your agent uses it the next
 * time it is asked (server matching/unknowns.ts).
 */
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import {
  answerQuestionOfDay, getQuestionOfDay, skipQuestionOfDay, type DailyQuestion,
} from '../../lib/api';
import { useSession } from '../../store/session';
import {
  Button, Card, Field, Header, LoadFailed, Loading, Screen, ScreenTitle, radius, space, type, usePalette,
} from '../../components/ui';
import { canSave, contactNote, tooShort } from '../stories/stories-state';
import { askReason, cardReason, isAskQuestion, questionReason, unusedNote } from './question-state';

export default function QuestionScreen() {
  const p = usePalette();
  const token = useSession((s) => s.token);
  const [q, setQ] = useState<DailyQuestion | null | undefined>(undefined);
  const [limits, setLimits] = useState({ min: 12, max: 300 });
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Saved, but never to be repeated: said, and the form stays shut.
  const [unused, setUnused] = useState<string | null>(null);

  /**
   * The question could not be had. It used to set "no question", and the screen said
   * "Nothing for now" under "Cannot reach the server" -- an empty state for a failure.
   */
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    if (!token) return;
    setFailed(false);
    const r = await getQuestionOfDay(token);
    if (!r) { setFailed(true); return; }
    setQ(r.question);
    setLimits({ min: r.min, max: r.max });
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async () => {
    if (!token || !q) return;
    setBusy(true);
    setNote(null);
    const ok = await answerQuestionOfDay(token, q.id, draft);
    setBusy(false);
    if (!ok) { setNote('That did not save. Check your connection and try again.'); return; }
    const why = unusedNote(ok.usable === false ? ok.reason : null);
    if (why) { setUnused(why); return; }
    router.back();
  }, [token, q, draft]);

  const skip = useCallback(async () => {
    if (!token || !q) return;
    await skipQuestionOfDay(token, q.id);
    router.back();
  }, [token, q]);

  const short = tooShort(draft, limits.min);
  const contact = contactNote(draft);

  return (
    <Screen padded={false}>
      <Header title="" onBack={() => router.back()} />
      <ScreenTitle title="A question for you" />
      <View style={{ paddingHorizontal: space.screen, gap: space.lg }}>
        {failed && q === undefined ? (
          <LoadFailed what="today's question" onRetry={() => void load()} />
        ) : q === undefined ? (
          <Loading label="Loading today's question" orb="solving" />
        ) : unused ? (
          <Card>
            <Text style={[type.body, { color: p.text }]}>{unused}</Text>
            <Button label="Done" variant="primary" onPress={() => router.back()} />
          </Card>
        ) : q?.card ? (
          // A CARD TOPIC OPENS THE CARD (the founder, 2026-09-25): both rows, the answer
          // read by code and never said -- not a sentence in a box.
          <Card>
            <Text style={[type.label, { color: p.textSecondary }]}>{q.card.topic.toUpperCase()}</Text>
            <Text style={[type.title, { color: p.text }]}>{q.ask}</Text>
            <Text style={[type.callout, { color: p.textSecondary }]}>
              {isAskQuestion(q.id) ? askReason(q.count) : cardReason(q.count)}
            </Text>
            <Button label={isAskQuestion(q.id) ? 'Answer it' : 'Answer the card'} variant="primary"
                    onPress={() => router.replace({ pathname: '/onboarding/interview', params: { card: q.card!.id, qotd: q.id } })} />
            <Button label="Not now" variant="ghost" onPress={() => void skip()} />
          </Card>
        ) : q === null ? (
          <Text style={[type.body, { color: p.textSecondary }]}>
            Nothing for now. When other agents ask yours something it cannot answer, it will show up here.
          </Text>
        ) : (
          <Card>
            <Text style={[type.title, { color: p.text }]}>{q.ask}</Text>
            <Text style={[type.callout, { color: p.textSecondary }]}>{questionReason(q.count)}</Text>
            <Field value={draft} onChangeText={setDraft} placeholder="In your own words…"
                   multiline minHeight={90} maxLength={limits.max} />
            {short && <Text style={[type.callout, { color: p.textTertiary }]}>{short}</Text>}
            {contact && <Text style={[type.callout, { color: p.warning }]}>{contact}</Text>}
            {/* Saving here IS the "OK to share": this answer is written for other
                agents to hear, and the button says so. */}
            <Button label="Save and share" variant="primary" loading={busy}
                    disabled={!canSave(draft, null, limits.min, limits.max)} onPress={() => void save()} />
            <Button label="Not now" variant="ghost" onPress={() => void skip()} />
          </Card>
        )}
        {note && <Text style={[type.callout, { color: p.danger }]}>{note}</Text>}
      </View>
    </Screen>
  );
}
