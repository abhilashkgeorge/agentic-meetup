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
import { useParkLive } from '../features/world/park-live';
import { useParkVoice } from '../features/world/park-voice';

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
    // Back in the park after a dropped connection: the server let us go when the old
    // socket closed, so walk in again -- and whatever we were doing with somebody is
    // over, because the server ended it then (and could not tell this socket). Kept,
    // it was a pair on this phone that the server had forgotten: "End" sent a part
    // for a pair the server no longer had, nothing came back, and nothing ended.
    if (useParkLive.getState().inPark) {
      // The old voice id went with the old socket: walking in brings a new pass.
      useParkVoice.getState().left();
      useParkLive.getState().rejoined();
      push({ type: 'park.enter' });
    }
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

      // ── the park, live ────────────────────────────────────────────────
      case 'park.people':
        useParkLive.getState().gotPeople(ev.people);
        break;
      case 'park.said':
        useParkLive.getState().gotLine(ev.ref, ev.text, ev.at, ev.private);
        break;
      case 'park.refused':
        useParkLive.getState().gotRefused(ev.reason);
        break;
      case 'park.finding':
        useParkLive.getState().setFinding({ status: ev.status, ...(ev.ref ? { ref: ev.ref } : {}), ...(ev.why ? { why: ev.why } : {}) });
        break;
      case 'park.asked':
        useParkLive.getState().gotAsked(ev.ref, ev.why);
        break;
      case 'park.unasked':
        useParkLive.getState().gotUnasked();
        break;
      case 'park.paired':
        // The one who asked rides over (the car); the one who said yes stays put.
        useParkLive.getState().gotPaired(ev.ref, ev.asked ? null : [ev.x, ev.z]);
        break;
      case 'park.parted':
        useParkLive.getState().gotParted();
        break;
      case 'park.sat':
        useParkLive.getState().gotBench(ev.bench);
        break;
      case 'park.stood':
        useParkLive.getState().gotBench(null);
        break;
      case 'park.quests':
        useParkLive.getState().gotQuests({ day: ev.day, done: ev.done, progress: ev.progress, sights: ev.sights }, ev.just, ev.balance);
        break;
      case 'park.bench_taken':
        useParkLive.getState().gotRefused('bench_taken');
        break;
      case 'park.voice': {
        const { type: _type, ...pass } = ev;
        useParkVoice.getState().gotPass(pass);
        break;
      }

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

/**
 * The park, live. Walking in and out, where you are (a few times a second while in),
 * and what you say to the people near you. Nothing is queued while the socket is
 * down: where you were a minute ago is worth nothing, and a line said into a dead
 * connection is better not said late.
 */
export function parkEnter(): void {
  useParkLive.getState().setIn(true);
  push({ type: 'park.enter' });
}

/**
 * Ask for a fresh voice pass: the phone lost the voice server and LiveKit's own retries
 * gave up (features/world/voice-room.ts). False when the park's socket is down too --
 * its reconnect walks back in, which brings a pass anyway.
 */
export function parkVoiceAgain(): boolean {
  return push({ type: 'park.voice_again' });
}

export function parkLeave(): void {
  if (!useParkLive.getState().inPark) return;
  useParkLive.getState().setIn(false);
  useParkVoice.getState().left();
  push({ type: 'park.leave' });
}

export function parkMove(x: number, z: number, facing: number, moving: boolean, riding = false): void {
  push({ type: 'park.move', x, z, facing, moving, ...(riding ? { riding: true } : {}) });
}

/** Find someone free to talk to: the server picks and asks them. */
export function parkFind(): void {
  useParkLive.getState().setFinding({ status: 'searching' });
  if (!push({ type: 'park.find' })) useParkLive.getState().setFinding(null);
}

export function parkAnswer(yes: boolean): void {
  useParkLive.getState().gotUnasked();
  push({ type: 'park.answer', yes });
}

/**
 * Stop asking, or stop talking. Over on this phone at once, whatever the server says:
 * "End" that waits for an answer does nothing when there is none to wait for.
 */
export function parkPart(): void {
  useParkLive.getState().setFinding(null);
  useParkLive.getState().gotParted();
  push({ type: 'park.part' });
}

export function parkSit(bench: number): void {
  push({ type: 'park.sit', bench });
}

/** Up off the bench: here at once, as with parting; the server tells the other. */
export function parkStand(): void {
  useParkLive.getState().gotBench(null);
  push({ type: 'park.stand' });
}

export function parkSay(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return push({ type: 'park.say', text: trimmed.slice(0, 200) });
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
