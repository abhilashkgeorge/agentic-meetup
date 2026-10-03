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
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, FlatList, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardPad } from '../../lib/keyboard';
import { getDateIdea, getMessages, nudgeSeen, proposeDate, type Look } from '../../lib/api';
import * as Crypto from 'expo-crypto';
import { chatCard, type DateIdeaState } from './date-idea';
import { typingSignal } from './typing-signal';
import { SafetySheet } from '../safety/safety-sheet';
import { PersonAvatar } from '../look/person-avatar';
import { Checkin } from './checkin';
import { readDm, sendDm, sendTyping } from '../../lib/socket';
import { newestTheirs, readNow } from './read-on-arrival';
import { useSession } from '../../store/session';
import { useDm, type Dm } from '../../store/dm';
import {
  Bubble, Button, Field, Header, LoadFailed, Loading, Surface, radius, space, type, usePalette,
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
  const [who, setWho] = useState<{ id: string | null; name: string; photoId: string | null; look?: Look | null } | null>(null);
  const conversation = listed
    ?? (who ? { id: rendezvousId, otherId: who.id ?? '', name: who.name, photoId: who.photoId, look: who.look } : null);
  const setThread = useDm((s) => s.setThread);
  const prepend = useDm((s) => s.prepend);
  const clearUnread = useDm((s) => s.clearUnread);

  const [draft, setDraft] = useState('');
  /**
   * Whether the messages are here. Before the first page the list was empty, and an
   * empty list draws "You both said yes. Nobody else can message you here." -- the opening
   * of a conversation that already had messages in it. A thread kept from earlier counts
   * as here: it is shown at once and refreshed.
   */
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>(
    () => ((useDm.getState().threads[rendezvousId]?.length ?? 0) > 0 ? 'ready' : 'loading'));
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // This screen builds its own frame rather than using Screen, so it does not get the
  // safe-area padding for free -- and with the stack's own header now hidden, the back
  // button was sitting under the status bar.
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardPad();

  const loadThread = useCallback(async () => {
    if (!token) return;
    const page = await getMessages(token, rendezvousId);
    // A failed read keeps what is on screen; it used to replace the thread with nothing.
    if (!page) { setStatus((s) => (s === 'ready' ? s : 'failed')); return; }
    if (page.me) setMe(page.me);
    setWho({ id: page.otherId, name: page.name, photoId: page.photoId, look: page.look });
    setThread(
      rendezvousId,
      page.messages.map((m) => ({
        id: m.id,
        rendezvousId,
        text: m.text,
        mine: m.mine,
        seq: Number(m.seq),
        sentAt: m.sentAt,
        state: m.readAt ? 'read' : m.deliveredAt ? 'delivered' : 'sent',
      })),
    );
    setHasMore(page.hasMore ?? false);
    setStatus('ready');
    // Opening the conversation IS reading it. Doing this on scroll instead produces
    // the state where a message stays bold after you have plainly read it.
    readDm(rendezvousId);
    clearUnread(rendezvousId);
  }, [token, rendezvousId, setThread, clearUnread, setMe]);

  useEffect(() => { void loadThread(); }, [loadThread]);

  // And what arrives while it is open is read too -- on screen, the app in front
  // (read-on-arrival.ts). Only opening it used to count.
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  const [front, setFront] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => setFront(st === 'active'));
    return () => sub.remove();
  }, []);
  const theirs = newestTheirs(messages);
  useEffect(() => {
    if (!readNow(theirs, { focused, front, ready: status === 'ready' })) return;
    readDm(rendezvousId);
    clearUnread(rendezvousId);
  }, [theirs, focused, front, status, rendezvousId, clearUnread]);

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

  // Said when typing starts and when it stops, not on every keystroke (typing-signal.ts).
  const sayTyping = useMemo(() => typingSignal((t) => sendTyping(rendezvousId, t)), [rendezvousId]);

  const onType = (text: string) => {
    setDraft(text);
    sayTyping(text.length > 0);
    // Stops by itself. A typing indicator that sticks because somebody closed the app
    // mid-word is worse than none.
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => sayTyping(false), 4_000);
  };

  const submit = () => {
    if (!draft.trim()) return;
    sendDm(rendezvousId, draft);
    setDraft('');
    sayTyping(false);
  };

  // Block, or report with one of the fixed reasons: the same sheet as on every card
  // and profile (features/safety). A chat knows who the other person is.
  const [safety, setSafety] = useState(false);
  const other = conversation?.otherId || who?.id;
  const stop = () => { if (other && token) setSafety(true); };

  // THE AGENTS' DATE IDEA, and "Propose this date". Read once per visit; the server
  // re-checks the idea every time. The button sends a message from this person --
  // written by the server from the checked idea -- and the agent schedules nothing.
  const [dateIdea, setDateIdea] = useState<DateIdeaState>(null);
  const [proposing, setProposing] = useState(false);
  useEffect(() => {
    if (!token) return;
    void getDateIdea(token, rendezvousId).then(setDateIdea);
  }, [token, rendezvousId]);
  // The quiet nudge is shown once per match: the moment it is on screen, the server is
  // told, and it never comes back (server 0068).
  const card = chatCard(dateIdea);
  useEffect(() => {
    if (card?.nudge && token) void nudgeSeen(token, rendezvousId);
  }, [card?.nudge, token, rendezvousId]);
  const propose = async () => {
    if (!token || proposing) return;
    setProposing(true);
    const r = await proposeDate(token, rendezvousId, Crypto.randomUUID());
    setProposing(false);
    if (!r) return; // offline or refused: the button stays, nothing was sent
    useDm.getState().received(r.message);
    setDateIdea((d) => (d ? { ...d, proposed: true, quiet: false } : d));
  };

  // Newest at the bottom without measuring anything: render the list upside down and
  // feed it the messages in reverse.
  const data = [...messages].reverse();


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
          <PersonAvatar
            userId={conversation?.otherId}
            photoId={conversation?.photoId}
          look={conversation?.look}
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

      {/* "DID YOU TWO MEET?" -- and, after yes, the after-date check-in. Three days
          after both said yes, once. Hinge calls the first question "We Met" and it is
          the only label in the whole product that is a fact rather than a guess. Asked
          here because this is the screen the two of them are actually in. */}
      {token && (
        <Checkin token={token} rendezvousId={rendezvousId}
                 otherId={conversation?.otherId || who?.id || null}
                 otherName={conversation?.name ?? 'them'} />
      )}

      {card && (
        <Surface depth="sunken" radius={radius.lg}
                 style={{ marginHorizontal: space.screen, marginBottom: space.sm, padding: space.md, gap: space.sm }}>
          <Text style={[type.label, { color: p.textSecondary }]}>{card.title}</Text>
          <Text style={[type.body, { color: p.text }]}>{card.line}</Text>
          {card.propose && (
            <>
              <Button label="Propose this date" variant="primary" loading={proposing} onPress={() => void propose()} />
              <Text style={[type.callout, { color: p.textTertiary }]}>
                It goes as a message from you. You two pick the day.
              </Text>
            </>
          )}
        </Surface>
      )}

      {status !== 'ready' && messages.length === 0 ? (
        // Not the list's empty view: that one opens a conversation, and this one may
        // already have messages on their way.
        <View style={{ flex: 1, justifyContent: 'flex-end', padding: space.screen }}>
          {status === 'loading'
            ? <Loading label="Loading the conversation" orb="composing" />
            : <LoadFailed what="this conversation" onRetry={() => { setStatus('loading'); void loadThread(); }} />}
        </View>
      ) : (
      <FlatList
        inverted
        data={data}
        keyExtractor={(m) => m.id}
        onEndReached={() => void older()}
        onEndReachedThreshold={0.4}
        contentContainerStyle={{ padding: space.screen, paddingBottom: space.lg }}
        ListEmptyComponent={
          <View style={{ paddingVertical: space.xxl, alignItems: 'center', gap: space.sm }}>
            <PersonAvatar
              userId={conversation?.otherId}
              photoId={conversation?.photoId}
            look={conversation?.look}
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
      )}

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

      {safety && other && (
        <SafetySheet target={{ rendezvousId, userId: other }} name={conversation?.name}
                     onClose={() => setSafety(false)} onDone={() => router.back()} />
      )}
    </View>
  );
}
