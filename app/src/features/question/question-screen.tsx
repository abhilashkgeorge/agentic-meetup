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
  Button, Card, Field, Header, Screen, ScreenTitle, Skeleton, space, type, usePalette,
} from '../../components/ui';
import { canSave, contactNote, tooShort } from '../stories/stories-state';
import { cardReason, questionReason, unusedNote } from './question-state';

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

  const load = useCallback(async () => {
    if (!token) return;
    const r = await getQuestionOfDay(token);
    if (!r) { setNote('Cannot reach the server.'); setQ(null); return; }
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
        {q === undefined ? (
          <Skeleton height={120} width="100%" />
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
            <Text style={[type.callout, { color: p.textSecondary }]}>{cardReason(q.count)}</Text>
            <Button label="Answer the card" variant="primary"
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
            <Button label="Save" variant="primary" loading={busy}
                    disabled={!canSave(draft, null, limits.min, limits.max)} onPress={() => void save()} />
            <Button label="Not now" variant="ghost" onPress={() => void skip()} />
          </Card>
        )}
        {note && <Text style={[type.callout, { color: p.danger }]}>{note}</Text>}
      </View>
    </Screen>
  );
}
