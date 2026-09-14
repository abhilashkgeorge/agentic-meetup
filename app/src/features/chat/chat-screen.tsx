/**
 * Talking to your own clone.
 *
 * Instagram's DM screen, essentially: a thin top bar, messages filling everything,
 * and a composer pinned to the bottom. Nothing else on the screen, because there is
 * nothing else to do here.
 */
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useChat } from '../../features/chat/use-chat';
import { useSession } from '../../store/session';
import { getConfig, type Config } from '../../lib/api';
import { setupRoute } from '../profile/fields';
import {
  Bubble, Button, Card, Chip, ChipGroup, Crease, Disclosure, Field, Screen,
  Skeleton, space, type, usePalette,
} from '../../components/ui';
import { getKnowledge, getPool, type Knowledge } from '../../lib/api';

/** One tap instead of a blank box. */
const STARTERS = [
  'I moved recently',
  'I changed jobs',
  "What I'm looking for",
  'Something I care about',
  'A dealbreaker',
];

export default function ChatScreen() {
  const p = usePalette();
  const bubbles = useSession((s) => s.bubbles);
  const question = useSession((s) => s.question);
  const connected = useSession((s) => s.connected);
  const { send } = useChat();
  const [draft, setDraft] = useState('');
  const [config, setConfig] = useState<Config | null>(null);
  const [k, setK] = useState<Knowledge | null>(null);
  const [pool, setPool] = useState<{ total: number; inPool: boolean; missing: string[] } | null>(null);
  const token = useSession((s) => s.token);
  const list = useRef<FlatList>(null);

  useEffect(() => {
    void (async () => {
      setConfig(await getConfig());
      if (!token) return;
      // The empty screen was the problem. A chat with no messages should still tell
      // somebody where they stand -- what it knows, what it is still missing, and
      // what happens next -- rather than being a void with a text box at the bottom.
      const [kk, po] = await Promise.all([getKnowledge(token), getPool(token)]);
      setK(kk);
      setPool(po ? { total: po.total, inPool: po.inPool, missing: po.missing } : null);
    })();
  }, [token, bubbles.length]);

  const submit = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    send(text);
    setDraft('');
  }, [draft, send]);

  return (
    <Screen
      scroll={false}
      padded={false}
      footer={
        <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}>
            <Field
              value={draft}
              onChangeText={setDraft}
              placeholder="Say something"
              multiline
              minHeight={24}
              onSubmitEditing={submit}
            />
          </View>
          <Button label="Send" variant="primary" onPress={submit} disabled={!draft.trim()}
                  style={{ paddingHorizontal: space.lg }} />
        </View>
      }
    >
      {/* Required at the start of every session, and it is the first thing on screen
          rather than buried in a settings page. */}
      <Disclosure
        text={config?.disclosure.perSession ?? 'This is an AI, not a person.'}
      />

      {!connected && (
        <View style={{ paddingHorizontal: space.screen }}>
          <Text style={[type.callout, { color: p.warning, textAlign: 'center' }]}>
            Reconnecting…
          </Text>
        </View>
      )}

      <FlatList
        ref={list}
        data={bubbles}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: space.screen, paddingTop: space.sm, flexGrow: 1 }}
        keyExtractor={(b) => `${b.role}-${b.turnId}`}
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={{ flex: 1, justifyContent: 'center', gap: space.lg }}>
            {/* Where the person actually stands, before they have said anything. */}
            <Card label={k ? `It knows ${k.knows.length} things about you` : 'Getting ready'}>
              {!k ? (
                <>
                  <Skeleton height={18} />
                  <Skeleton height={18} width="70%" />
                </>
              ) : k.knows.length === 0 ? (
                <Text style={[type.body, { color: p.textSecondary }]}>
                  Nothing yet. Say one true thing and it starts from there.
                </Text>
              ) : (
                <>
                  {k.knows.slice(0, 4).map((f, i) => (
                    <View key={f.id}>
                      {i > 0 && <Crease />}
                      <Text style={[type.label, { color: p.textTertiary }]}>
                        {f.label.toUpperCase()}
                      </Text>
                      <Text style={[type.body, { color: p.text }]}>{f.value}</Text>
                    </View>
                  ))}
                  {k.knows.length > 4 && (
                    <Text style={[type.callout, { color: p.textTertiary }]}>
                      and {k.knows.length - 4} more
                    </Text>
                  )}
                </>
              )}
            </Card>

            {/* The refusals. The half of this product nobody else can print. */}
            {k && k.wontGuess.length > 0 && (
              <Card label="It won't guess">
                <Text style={[type.callout, { color: p.textSecondary }]}>
                  It could have made these up. It didn't.
                </Text>
                {k.wontGuess.slice(0, 3).map((g, i) => (
                  <View key={g.id}>
                    {i > 0 && <Crease />}
                    <Text style={[type.body, { color: p.text }]}>{g.question}</Text>
                  </View>
                ))}
              </Card>
            )}

            {pool && (
              <Card label={pool.inPool ? 'Your agent is out there' : 'Not out there yet'}>
                {pool.inPool ? (
                  <>
                    <Text style={[type.display, { color: p.text }]}>{pool.total}</Text>
                    <Text style={[type.callout, { color: p.textSecondary }]}>
                      people it can reach right now
                    </Text>
                  </>
                ) : (
                  <>
                    {pool.missing.slice(0, 3).map((m) => (
                      <Text key={m} style={[type.callout, { color: p.textSecondary }]}>• {m}</Text>
                    ))}
                    <Button label="Finish setup" variant="primary"
                            onPress={() => router.push(setupRoute(pool.missing))} />
                  </>
                )}
              </Card>
            )}

            {/* A blank box is where conversations die. These are one tap. */}
            <Card label="Or just tell it">
              <ChipGroup>
                {STARTERS.map((sug) => (
                  <Chip key={sug} label={sug} selected={false} onPress={() => setDraft(sug)} />
                ))}
              </ChipGroup>
            </Card>
          </View>
        }
        renderItem={({ item }) => (
          <Bubble text={item.text} mine={item.role === 'user'} pending={item.pending} />
        )}
      />

      {/* The clone's own question, when it has one. One at a time, never a list. */}
      {question && (
        <View style={{ paddingHorizontal: space.screen, paddingBottom: space.sm }}>
          <Card label="It wants to know">
            <Text style={[type.body, { color: p.text }]}>{question.text}</Text>
          </Card>
        </View>
      )}
    </Screen>
  );
}
