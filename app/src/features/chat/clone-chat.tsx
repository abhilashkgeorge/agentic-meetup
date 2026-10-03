/**
 * The conversation with your own clone, as a component.
 *
 * Extracted from the old Home so it can be two things: the fallback Home when the
 * town cannot draw, and a sheet that slides up over the town when you tap your own
 * agent. The socket is not opened here -- it belongs to the root layout, because it
 * also carries messages from people you matched with.
 *
 * `renderEmpty` is what fills the space before anybody has said anything: the old
 * Home puts its status cards there; the sheet puts a single line.
 */
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useChat } from './use-chat';
import { LearnedCards } from '../knowledge/learned-cards';
import { useSession } from '../../store/session';
import {
  Bubble, Button, Card, Disclosure, Field, space, type, usePalette,
} from '../../components/ui';

export function CloneChat({
  disclosure,
  renderEmpty,
}: {
  disclosure: string;
  renderEmpty?: (api: { setDraft: (text: string) => void }) => ReactNode;
}) {
  const p = usePalette();
  const bubbles = useSession((s) => s.bubbles);
  const newSession = useSession((s) => s.newSession);
  const question = useSession((s) => s.question);
  const connected = useSession((s) => s.connected);
  const { send } = useChat();
  const [draft, setDraft] = useState('');
  const list = useRef<FlatList>(null);

  const submit = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    send(text);
    setDraft('');
  }, [draft, send]);

  return (
    <View style={{ flex: 1 }}>
      {/* A WAY OUT OF THE CONVERSATION, once there is one to leave. `newSession` clears
          the transcript and mints a new session id, which also tells the server this
          conversation ended and its facts can be extracted. Nothing is lost. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.screen, gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Disclosure text={disclosure} />
        </View>
        {bubbles.length > 0 && (
          <Pressable
            onPress={() => newSession()}
            accessibilityRole="button"
            accessibilityLabel="End this conversation and go back"
            hitSlop={12}
            style={{ paddingVertical: space.xs }}
          >
            <Text style={[type.callout, { color: p.accent }]}>Done</Text>
          </Pressable>
        )}
      </View>

      {!connected && (
        <View style={{ paddingHorizontal: space.screen }}>
          <Text style={[type.callout, { color: p.warning, textAlign: 'center' }]}>Reconnecting…</Text>
        </View>
      )}

      <FlatList
        ref={list}
        data={bubbles}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: space.screen, paddingTop: space.sm, flexGrow: 1 }}
        keyExtractor={(b) => `${b.role}-${b.turnId}`}
        // WHAT IT LEARNED, AND MAY IT SAY SO (knowledge/learned.ts): first thing in the
        // conversation, so opening it is where you see them.
        ListHeaderComponent={<LearnedCards />}
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={{ flex: 1, justifyContent: 'center', gap: space.lg }}>
            {renderEmpty?.({ setDraft })}
          </View>
        }
        renderItem={({ item }) => item.role === 'note' ? (
          // Why a turn failed (turn-note.ts): the app speaking, not the clone.
          <Text style={[type.callout, { color: p.textSecondary, textAlign: 'center', paddingVertical: space.sm }]}>
            {item.text}
          </Text>
        ) : (
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

      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-end',
                     paddingHorizontal: space.screen, paddingTop: space.md, paddingBottom: space.lg }}>
        <View style={{ flex: 1 }}>
          <Field value={draft} onChangeText={setDraft} placeholder="Say something"
                 multiline minHeight={24} onSubmitEditing={submit} />
        </View>
        <Button label="Send" variant="primary" onPress={submit} disabled={!draft.trim()}
                style={{ paddingHorizontal: space.lg }} />
      </View>
    </View>
  );
}
