/**
 * Who is connected, and getting a message to them now.
 *
 * A dating DM has exactly two participants, so the routing is: find the other person's
 * open sockets and push. No rooms, no presence service, no fan-out. In-process because
 * there is one replica -- and the seam is narrow enough that moving to Postgres
 * LISTEN/NOTIFY later is a change to two functions, not to the protocol.
 *
 * A person may be connected on more than one device, so a connection is a set per user
 * rather than a single socket. Missing that produces the bug where reading a message
 * on a laptop leaves it unread on a phone for ever.
 */
import type { WebSocket } from 'ws';
import { log } from '../log.js';

const sockets = new Map<string, Set<WebSocket>>();

export function join(userId: string, ws: WebSocket): void {
  const set = sockets.get(userId) ?? new Set();
  set.add(ws);
  sockets.set(userId, set);
}

export function leave(userId: string, ws: WebSocket): void {
  const set = sockets.get(userId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) sockets.delete(userId);
}

export const isOnline = (userId: string): boolean => (sockets.get(userId)?.size ?? 0) > 0;

/**
 * Push to every device a person has open. Returns whether anybody received it, which
 * is what decides between marking a message delivered and sending a push notification.
 */
export function pushTo(userId: string, payload: unknown): boolean {
  const set = sockets.get(userId);
  if (!set?.size) return false;

  const text = JSON.stringify(payload);
  let delivered = false;
  for (const ws of set) {
    // readyState 1 is OPEN. A socket that is closing still sits in the set until its
    // close event fires, and writing to it throws.
    if (ws.readyState !== 1) continue;
    try {
      ws.send(text);
      delivered = true;
    } catch (err) {
      log.warn({ err, userId }, 'push failed');
    }
  }
  return delivered;
}

/** Both sides of a conversation, for receipts and typing. */
export function pushToBoth(a: string, b: string, payload: unknown): void {
  pushTo(a, payload);
  pushTo(b, payload);
}
