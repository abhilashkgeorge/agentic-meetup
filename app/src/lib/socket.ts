/**
 * One socket, two jobs.
 *
 * Talking to your own clone and talking to a person you matched with run over the SAME
 * authenticated connection, because opening a second one would mean two heartbeats,
 * two reconnect loops and two sets of credentials on the same phone -- and the server
 * would push every clone turn twice, once to each.
 *
 * So the connection lives here rather than inside a hook. A hook's socket belongs to
 * whichever screen mounted it: navigate away from the chat tab and the socket closes,
 * which is precisely when a message is most likely to arrive.
 */
import * as Crypto from 'expo-crypto';
import { HEARTBEAT_MS, ServerEvent, type ClientMessage } from '@clone/shared';
import { getWsBase } from './env';
import { useSession } from '../store/session';
import { useDm } from '../store/dm';
import { useWorld } from '../features/world/store';

/** Two missed heartbeats and we assume the socket is dead, whatever it claims. */
const DEAD_AFTER_MS = HEARTBEAT_MS * 2 + 5_000;

let ws: WebSocket | null = null;
let token: string | null = null;
let sessionId = '';
let lastSeenTurn: string | null = null;
let retry = 0;
let deadTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let closedByUs = false;

const armDeadTimer = (): void => {
  if (deadTimer) clearTimeout(deadTimer);
  deadTimer = setTimeout(() => ws?.close(), DEAD_AFTER_MS);
};

const open = (): boolean => ws?.readyState === WebSocket.OPEN;

function push(msg: ClientMessage): boolean {
  if (!open()) return false;
  ws!.send(JSON.stringify(msg));
  return true;
}

function connect(): void {
  if (!token) return;
  // The credential rides in the subprotocol header, not the query string: a URL is
  // written to every proxy log, access log and crash report on the way.
  const socket = new WebSocket(`${getWsBase()}/v1/chat`, ['bearer', token]);
  ws = socket;

  socket.onopen = () => {
    retry = 0;
    useSession.getState().setConnected(true);
    armDeadTimer();
    push({ type: 'hello', sessionId, lastSeenTurnId: lastSeenTurn });
    // Anything typed while the connection was down goes now. Every message carries the
    // id the phone generated, so a message that actually did arrive before the socket
    // dropped is recognised and not written twice.
    flushOutbox();
  };

  socket.onmessage = (e) => {
    armDeadTimer();
    const parsed = ServerEvent.safeParse(JSON.parse(String(e.data)));
    if (!parsed.success) return;
    const ev = parsed.data;
    const s = useSession.getState();
    const d = useDm.getState();

    switch (ev.type) {
      // ── your own clone ────────────────────────────────────────────────
      case 'turn.accepted':
        s.startClone(ev.turnId);
        break;
      case 'text.delta':
        s.appendClone(ev.turnId, ev.text);
        break;
      case 'turn.replayed':
        s.startClone(ev.turnId);
        s.finishClone(ev.turnId, ev.text);
        lastSeenTurn = ev.turnId;
        break;
      case 'turn.done':
        s.finishClone(ev.turnId, ev.text);
        lastSeenTurn = ev.turnId;
        break;
      case 'conflict.question':
        s.setQuestion({ conflictId: ev.conflictId, text: ev.question });
        break;

      // ── a person ──────────────────────────────────────────────────────
      case 'dm.message':
        d.received(ev.message);
        break;
      case 'dm.receipt':
        d.receipt(ev.rendezvousId, ev.messageIds, ev.state);
        break;
      case 'dm.typing':
        d.setTyping(ev.rendezvousId, ev.typing);
        break;
      case 'dm.rejected':
        // The send was refused and the reason is deliberately thin. Shown as failed
        // on the message itself rather than as an alert: an alert about a blocked
        // conversation is a notification that somebody blocked you.
        d.failed(ev.messageId);
        break;

      // ── the town ──────────────────────────────────────────────────────
      case 'round.queued':
      case 'round.met':
      case 'round.talking':
      case 'round.decided':
      case 'round.done':
      case 'match.turn':
      case 'match.introduced':
        // Dev builds say so in logcat (ReactNativeJS), so a demo on a phone can show
        // whether the cue arrived at all -- the difference between "the socket was
        // down" and "the town drew nothing", which look the same on screen.
        if (__DEV__) console.log(`[town] ${ev.type}`);
        useWorld.getState().apply(ev);
        break;

      case 'photos.checked':
        // The selfie screen polls for the verdict; this is only the log line.
        if (__DEV__) console.log(`[photos] checked: ${ev.result}`);
        break;

      case 'heartbeat':
        break;
      case 'error':
        s.finishClone(lastSeenTurn ?? '', '');
        s.setQuestion(null);
        console.warn(`[socket] ${ev.code}: ${ev.message}`);
        break;
    }
  };

  socket.onclose = () => {
    useSession.getState().setConnected(false);
    if (deadTimer) clearTimeout(deadTimer);
    if (closedByUs) return;
    // Exponential backoff, capped. Mobile networks drop constantly; a tight reconnect
    // loop drains the battery faster than it recovers the socket.
    const delay = Math.min(30_000, 500 * 2 ** retry++);
    reconnectTimer = setTimeout(connect, delay);
  };

  socket.onerror = () => socket.close();
}

/** Called once, from the root layout, whenever the credential changes. */
export function startSocket(newToken: string | null, session: string): () => void {
  token = newToken;
  sessionId = session;
  closedByUs = false;
  if (token) connect();

  return () => {
    closedByUs = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (deadTimer) clearTimeout(deadTimer);
    ws?.close();
    ws = null;
  };
}

export function sendTurn(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  // The client generates turnId. That is what makes the whole turn idempotent: a
  // resend after a flaky reconnect can never produce a second LLM call.
  const turnId = Crypto.randomUUID();
  useSession.getState().addUser(turnId, trimmed);
  push({ type: 'turn', turnId, sessionId, text: trimmed, source: 'text' });
}

/**
 * Send a message to a person.
 *
 * The message is put on screen BEFORE it is sent and stays there if the socket is
 * down. A chat that erases what you typed because the train went into a tunnel is the
 * single most infuriating failure in a messaging app, and the id generated here is
 * what makes retrying it free.
 */
export function sendDm(rendezvousId: string, text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  const messageId = Crypto.randomUUID();
  useDm.getState().queue(rendezvousId, messageId, trimmed);
  if (push({ type: 'dm.send', messageId, rendezvousId, text: trimmed })) {
    useDm.getState().markSending(messageId);
  }
}

export function readDm(rendezvousId: string): void {
  push({ type: 'dm.read', rendezvousId });
}

export function sendTyping(rendezvousId: string, typing: boolean): void {
  push({ type: 'dm.typing', rendezvousId, typing });
}

/** Everything typed offline, in the order it was typed. */
export function flushOutbox(): void {
  for (const m of useDm.getState().outbox()) {
    if (push({ type: 'dm.send', messageId: m.id, rendezvousId: m.rendezvousId, text: m.text })) {
      useDm.getState().markSending(m.id);
    }
  }
}

export const socketOpen = open;
