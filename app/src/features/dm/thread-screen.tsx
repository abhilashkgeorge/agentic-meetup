/**
 * A conversation with a person.
 *
 * THE THINGS THAT MAKE CHAT FEEL BROKEN WHEN THEY ARE MISSING, and where each is:
 *
 *   the message appears instantly            `queue()` before the socket is touched
 *   it survives losing signal                the outbox, replayed on reconnect
 *   it is never sent twice                   the id is generated here
 *   one tick, two ticks, read                `state` on the message
 *   older messages load when you scroll up   `onEndReached` on an inverted list
 *   they are typing                          not persisted, expires by itself
 *   you can make somebody stop               block and report, in reach, always
 *
 * THE COMPOSER IS PINNED AND THE LIST IS INVERTED. An inverted FlatList keeps the
 * newest message at the bottom without measuring anything, which is the only way this
 * behaves when the keyboard opens.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardPad } from '../../lib/keyboard';
import { blockUser, getMessages, matchMet, reportMet, reportUser } from '../../lib/api';
import { PhotoAvatar } from '../photos/photo';
import { readDm, sendDm, sendTyping } from '../../lib/socket';
import { useSession } from '../../store/session';
import { useDm, type Dm } from '../../store/dm';
import {
  Bubble, Button, Field, Header, space, type, usePalette,
} from '../../components/ui';

/** Sent, delivered, read — shown only on your own messages, like every other app. */
function Ticks({ state }: { state: Dm['state'] }) {
  const p = usePalette();
  const label =
    state === 'queued' ? 'waiting to send'
    : state === 'sending' ? 'sending'
    : state === 'failed' ? 'not sent'
    : state === 'read' ? 'Read'
    : state === 'delivered' ? 'Delivered'
    : 'Sent';
  return (
    <Text
      style={[
        type.label,
        {
          color: state === 'failed' ? p.danger : p.textTertiary,
          textAlign: 'right',
          marginTop: -space.xs,
          marginBottom: space.md,
          marginRight: space.sm,
        },
      ]}
    >
      {label}
    </Text>
  );
}

/** One shared empty array, so "this conversation has no messages" is a stable value. */
const EMPTY: Dm[] = [];

export default function ThreadScreen() {
  const p = usePalette();
  const { id } = useLocalSearchParams<{ id: string }>();
  const rendezvousId = String(id);
  const token = useSession((s) => s.token);
  const connected = useSession((s) => s.connected);

  // `?? EMPTY`, never `?? []`.
  //
  // A store selector runs on every change and its result is compared BY REFERENCE. A
  // fresh `[]` is a new reference every time, so the screen decided it had changed,
  // re-rendered, selected again, got another new array, and so on -- "Maximum update
  // depth exceeded" the instant the conversation opened. One shared empty array fixes
  // it, and nothing in TypeScript or in a store test can see the difference.
  const messages = useDm((s) => s.threads[rendezvousId] ?? EMPTY);
  const typing = useDm((s) => s.typing[rendezvousId] ?? false);
  const listed = useDm((s) => s.conversations.find((c) => c.id === rendezvousId));
  const setMe = useDm((s) => s.setMe);
  // The thread can be opened straight from the reveal, before the inbox has ever
  // loaded, so who this is comes back with the messages rather than from the list.
  const [who, setWho] = useState<{ id: string | null; name: string; photoId: string | null } | null>(null);
  const conversation = listed
    ?? (who ? { id: rendezvousId, otherId: who.id ?? '', name: who.name, photoId: who.photoId } : null);
  const setThread = useDm((s) => s.setThread);
  const prepend = useDm((s) => s.prepend);
  const clearUnread = useDm((s) => s.clearUnread);

  const [draft, setDraft] = useState('');
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // This screen builds its own frame rather than using Screen, so it does not get the
  // safe-area padding for free -- and with the stack's own header now hidden, the back
  // button was sitting under the status bar.
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardPad();

  useEffect(() => {
    void (async () => {
      if (!token) return;
      const page = await getMessages(token, rendezvousId);
      if (page?.me) setMe(page.me);
      if (page) setWho({ id: page.otherId, name: page.name, photoId: page.photoId });
      setThread(
        rendezvousId,
        (page?.messages ?? []).map((m) => ({
          id: m.id,
          rendezvousId,
          text: m.text,
          mine: m.mine,
          seq: Number(m.seq),
          sentAt: m.sentAt,
          state: m.readAt ? 'read' : m.deliveredAt ? 'delivered' : 'sent',
        })),
      );
      setHasMore(page?.hasMore ?? false);
      // Opening the conversation IS reading it. Doing this on scroll instead produces
      // the state where a message stays bold after you have plainly read it.
      readDm(rendezvousId);
      clearUnread(rendezvousId);
    })();
  }, [token, rendezvousId, setThread, clearUnread, setMe]);

  const older = useCallback(async () => {
    if (!token || !hasMore || loadingOlder || !messages.length) return;
    const oldest = messages.find((m) => m.seq !== null);
    if (!oldest?.seq) return;
    setLoadingOlder(true);
    const page = await getMessages(token, rendezvousId, String(oldest.seq));
    prepend(
      rendezvousId,
      (page?.messages ?? []).map((m) => ({
        id: m.id, rendezvousId, text: m.text, mine: m.mine,
        seq: Number(m.seq), sentAt: m.sentAt,
        state: m.readAt ? 'read' : m.deliveredAt ? 'delivered' : 'sent',
      })),
    );
    setHasMore(page?.hasMore ?? false);
    setLoadingOlder(false);
  }, [token, hasMore, loadingOlder, messages, rendezvousId, prepend]);

  const onType = (text: string) => {
    setDraft(text);
    sendTyping(rendezvousId, text.length > 0);
    // Stops by itself. A typing indicator that sticks because somebody closed the app
    // mid-word is worse than none.
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => sendTyping(rendezvousId, false), 4_000);
  };

  const submit = () => {
    if (!draft.trim()) return;
    sendDm(rendezvousId, draft);
    setDraft('');
    sendTyping(rendezvousId, false);
  };

  const stop = () => {
    const other = conversation?.otherId || who?.id;
    if (!other || !token) return;
    Alert.alert(
      `Stop hearing from ${conversation?.name ?? 'them'}?`,
      'They are never told. Their messages stop arriving and this conversation disappears for both of you.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: () => { void blockUser(token, other).then(() => router.back()); },
        },
        {
          text: 'Block and report',
          style: 'destructive',
          onPress: () => {
            void reportUser(token, { userId: other, rendezvousId, reason: 'other' })
              .then(() => router.back());
          },
        },
      ],
    );
  };

  // Newest at the bottom without measuring anything: render the list upside down and
  // feed it the messages in reverse.
  const data = [...messages].reverse();

  // "DID YOU TWO MEET?" Three days after both said yes, once, one tap. Hinge calls it
  // "We Met" and it is the only label in the whole product that is a fact rather than
  // a guess -- every scorer is eventually judged against it. Asked here because this
  // is the screen the two of them are actually in.
  const [askMet, setAskMet] = useState(false);
  useEffect(() => {
    if (!token || !id) return;
    void matchMet(token, String(id)).then((r) => setAskMet(Boolean(r?.askDue)));
  }, [token, id]);
  const answerMet = useCallback(async (yes: boolean) => {
    if (!token || !id) return;
    setAskMet(false);
    await reportMet(token, String(id), yes);
  }, [token, id]);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: p.bg,
        paddingTop: insets.top,
        // The composer is the bottom of this screen, so the keyboard would otherwise
        // sit exactly on top of the box being typed into. The keyboard stands where the
        // navigation bar was, so it replaces that inset rather than adding to it.
        paddingBottom: keyboard > 0 ? keyboard : insets.bottom,
      }}
    >
      <Header
        onBack={() => router.back()}
        title={conversation?.name ?? 'Chat'}
        avatar={
          <PhotoAvatar
            userId={conversation?.otherId}
            photoId={conversation?.photoId}
            name={conversation?.name ?? 'Someone'}
            size={32}
          />
        }
        // Always in reach, never buried in a settings screen. Somebody who needs it
        // needs it now.
        right={{ glyph: '⋯', label: 'Block or report', onPress: stop }}
      />

      {!connected && (
        <Text style={[type.label, { color: p.textTertiary, textAlign: 'center', paddingBottom: space.xs }]}>
          Offline — anything you send waits here and goes when you are back
        </Text>
      )}

      {askMet && (
        <View style={{ paddingHorizontal: space.screen, paddingBottom: space.sm, gap: space.xs }}>
          <Text style={[type.callout, { color: p.textSecondary, textAlign: 'center' }]}>
            Did you two meet up? They are not told what you say.
          </Text>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Button label="Yes" variant="secondary" onPress={() => void answerMet(true)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Not yet" variant="ghost" onPress={() => void answerMet(false)} />
            </View>
          </View>
        </View>
      )}

      <FlatList
        inverted
        data={data}
        keyExtractor={(m) => m.id}
        onEndReached={() => void older()}
        onEndReachedThreshold={0.4}
        contentContainerStyle={{ padding: space.screen, paddingBottom: space.lg }}
        ListEmptyComponent={
          <View style={{ paddingVertical: space.xxl, alignItems: 'center', gap: space.sm }}>
            <PhotoAvatar
              userId={conversation?.otherId}
              photoId={conversation?.photoId}
              name={conversation?.name ?? 'Someone'}
              size={96}
            />
            <Text style={[type.body, { color: p.textSecondary, textAlign: 'center' }]}>
              You both said yes. Nobody else can message you here.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View>
            <Bubble text={item.text} mine={item.mine} pending={item.state === 'queued'} />
            {/* Under the bubble, where every messaging app puts it. Inverting the LIST
                reverses the order of the rows; it does not reverse what is inside one,
                which is what put "Sent" above the message on the first run. */}
            {item.mine && <Ticks state={item.state} />}
          </View>
        )}
      />

      {typing && (
        <Text style={[type.label, { color: p.textTertiary, paddingHorizontal: space.screen }]}>
          typing…
        </Text>
      )}

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: space.sm,
          padding: space.screen,
          paddingTop: space.sm,
        }}
      >
        <View style={{ flex: 1 }}>
          <Field
            value={draft}
            onChangeText={onType}
            placeholder="Message"
            onSubmitEditing={submit}
            autoCapitalize="sentences"
          />
        </View>
        {/* Enabled even when offline. What you type is kept and sent when the signal
            comes back, so there is no reason to stop somebody typing it. */}
        <Button label="Send" variant="primary" onPress={submit} disabled={!draft.trim()} />
      </View>
    </View>
  );
}
