/**
 * Things to talk about: a few open questions, answered in your own words.
 *
 * WHY. When two agents meet they talk (server/src/matching/talk.ts), and an agent may
 * only ever repeat a sentence its person typed. An agent with little to repeat has
 * little to say -- and agents that had nothing real to say are the ones that made
 * things up (the founder, 2026-09-24: "Agents make things up when they have nothing
 * real to say"). So this asks for material: a perfect Sunday, what you could talk
 * about for hours, a trip, what you are into, a first date you would love. The last one
 * is what the agents' date idea is built from.
 *
 * Reached from onboarding (after the questions, before the character) and from the
 * You tab and "How you appear". Every answer is optional, and each is saved on its own.
 */
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { getStories, saveStory, type Story } from '../../lib/api';
import { useSession } from '../../store/session';
import {
  Button, Card, Field, Header, LoadFailed, Loading, Screen, ScreenTitle, radius, space, type, usePalette,
} from '../../components/ui';
import { canSave, contactNote, tooShort } from './stories-state';

export default function StoriesScreen({ onboarding = false }: { onboarding?: boolean }) {
  const p = usePalette();
  const token = useSession((s) => s.token);
  const [stories, setStories] = useState<Story[] | null>(null);
  const [limits, setLimits] = useState({ min: 12, max: 300 });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /** The questions could not be had: said with a way to try again, never a placeholder for good. */
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setFailed(false);
    const r = await getStories(token);
    if (!r) { setFailed(true); return; }
    setStories(r.stories);
    setLimits({ min: r.min, max: r.max });
    // A draft already typed survives a reload; an untouched one shows what is saved.
    setDrafts((d) => Object.fromEntries(r.stories.map((s) => [s.id, d[s.id] ?? s.answer?.text ?? ''])));
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async (id: string) => {
    if (!token) return;
    setBusy(id);
    setNote(null);
    const ok = await saveStory(token, id, drafts[id] ?? '');
    setBusy(null);
    if (!ok) { setNote('That did not save. Check your connection and try again.'); return; }
    await load();
  }, [token, drafts, load]);

  return (
    <Screen padded={false}
      footer={onboarding ? (
        <Button label="Next" variant="primary" onPress={() => router.replace('/onboarding/character')} />
      ) : undefined}
    >
      {!onboarding && <Header title="" onBack={() => router.back()} />}
      <ScreenTitle title="Things to talk about"
                   subtitle="When your agent meets another agent, it only repeats what you write here. Nothing made up." />

      <View style={{ paddingHorizontal: space.screen, gap: space.lg }}>
        <Text style={[type.callout, { color: p.textSecondary }]}>
          Answer any you like. Tip: tap the mic on your keyboard to talk instead of type.
        </Text>

        {!stories && failed ? (
          <LoadFailed what="the questions" onRetry={() => void load()} />
        ) : !stories ? (
          // The shape of what is coming: a few question cards, each a box to write in.
          <Loading label="Loading the questions" orb="solving" />
        ) : stories.map((s) => {
          const draft = drafts[s.id] ?? '';
          const saved = s.answer?.text ?? null;
          const short = tooShort(draft, limits.min);
          const contact = contactNote(draft);
          return (
            <Card key={s.id} {...(s.forYou ? { label: 'Only for your agent' } : {})}>
              <Text style={[type.bodyStrong, { color: p.text }]}>{s.text}</Text>
              {s.hint && <Text style={[type.callout, { color: p.textSecondary }]}>{s.hint}</Text>}
              <Field
                value={draft}
                onChangeText={(t) => setDrafts((d) => ({ ...d, [s.id]: t }))}
                placeholder={s.forYou ? 'Must love dogs. Someone who reads.' : 'In your own words…'}
                multiline
                minHeight={80}
                maxLength={limits.max}
              />
              {short && <Text style={[type.callout, { color: p.textTertiary }]}>{short}</Text>}
              {contact && <Text style={[type.callout, { color: p.warning }]}>{contact}</Text>}
              {s.answer?.private && draft.trim() === saved && (
                <Text style={[type.callout, { color: p.textTertiary }]}>
                  This one mentions something private, like kids or drinking, so your agent will not repeat it.
                </Text>
              )}
              {canSave(draft, saved, limits.min, limits.max) ? (
                <Button label="Save" variant="secondary" loading={busy === s.id} onPress={() => void save(s.id)} />
              ) : saved !== null && draft.trim() === saved ? (
                <Text style={[type.callout, { color: p.textTertiary }]}>Saved. Your agent can use this.</Text>
              ) : null}
            </Card>
          );
        })}

        {note && <Text style={[type.callout, { color: p.danger }]}>{note}</Text>}
      </View>
    </Screen>
  );
}
