/**
 * Waking a closed phone for the moments that cannot wait (the founder, 2026-09-28:
 * push for "your turn", "introduced", a new message, and "fades today").
 *
 *   turn        a new card, and you decide first
 *   shared      the first mover shared their profile with you: your turn to look
 *   introduced  they shared theirs back: you can talk
 *   message     a new message, while no app of yours is open
 *   fades       a card waiting on you fades within the day
 *
 * THE LOCK SCREEN IS PUBLIC. Whoever picks the phone up reads these, so they carry no
 * name, no word anybody wrote and nothing about who -- only what kind of thing happened.
 * The data is the kind and the card's id, for the app to open the right screen
 * (app/src/features/push/route.ts).
 *
 * BEFORE IT REACHES A PHONE: the app needs an Expo project id (`eas init`), the Expo
 * project needs the Firebase key for Android, the server needs PUSH_PROVIDER=expo, and
 * the app is rebuilt. Until then PUSH_PROVIDER=console logs each push instead.
 *
 * Fired after the change it reports has been written, never inside the transaction
 * that writes it, and never awaited by a request: a push is a courtesy, and a slow
 * push service must not slow the tap that caused it.
 */
import { adminSession, matchmakerSession } from '../db/client.js';
import { log } from '../log.js';
import { deliver } from './send.js';

export type PushKind = 'turn' | 'shared' | 'introduced' | 'message' | 'fades';

export const PUSH_WORDS: Record<PushKind, { title: string; body: string }> = {
  turn: { title: 'Your agent met someone', body: 'You decide first. The card is waiting.' },
  shared: { title: 'They shared their profile with you', body: 'Your turn: see who it is.' },
  introduced: { title: 'You can talk now', body: 'They shared theirs back. Say hello.' },
  message: { title: 'New message', body: 'Open the app to read it.' },
  fades: { title: 'A card fades today', body: 'Answer it before it is gone.' },
};

/** One message push per conversation per two minutes: a burst of messages is one buzz. */
const MESSAGE_QUIET_MS = 2 * 60_000;
const lastMessagePush = new Map<string, number>();

/**
 * Wake every device this person has signed in on. Resolves when done, never throws;
 * callers `void` it. Tokens are read through push_tokens_for (0076) on the app role
 * with no person's context -- the one reader there is -- and a token Expo reports dead
 * is forgotten.
 */
export async function wake(userId: string, kind: PushKind, rendezvousId: string): Promise<void> {
  try {
    if (kind === 'message') {
      const key = `${userId}:${rendezvousId}`;
      const at = lastMessagePush.get(key) ?? 0;
      if (Date.now() - at < MESSAGE_QUIET_MS) return;
      lastMessagePush.set(key, Date.now());
    }
    const tokens = await adminSession(async (c) =>
      (await c.query<{ token: string }>('SELECT token FROM push_tokens_for($1)', [userId])).rows.map((r) => r.token));
    if (!tokens.length) return;
    const words = PUSH_WORDS[kind];
    const receipts = await deliver(
      tokens.map((to) => ({ to, ...words, data: { kind, rendezvousId } })), { userId, kind });
    const dead = tokens.filter((_, i) => receipts[i] === 'dead');
    if (dead.length) {
      await adminSession(async (c) => { for (const t of dead) await c.query('SELECT forget_push_token($1)', [t]); });
    }
  } catch (err) {
    log.warn({ err: (err as Error).message, kind }, 'push failed');
  }
}

/**
 * "A card fades today", once per card per person: every open card whose three days end
 * within the next day and whose turn is this person's -- the first mover's, or the other
 * person's once the first mover has shared. Marked before it is sent (fade_warned_at),
 * so a crash between the two costs one warning, never a second one. Practice profiles
 * are never warned. Run as the matchmaker, beside the expiry timer (index.ts).
 */
export async function warnFading(): Promise<number> {
  const due = await matchmakerSession(async (c) => (await c.query<{ for_user: string; id: string }>(
    `UPDATE rendezvous_briefs b SET fade_warned_at = now()
       FROM rendezvous r
      WHERE b.rendezvous_id = r.id AND r.status = 'decided'
        AND b.human_says_yes IS NULL AND b.fade_warned_at IS NULL
        AND r.answer_by > now() AND r.answer_by <= now() + interval '1 day'
        AND (r.first_mover = b.for_user OR r.first_mover IS NULL
             OR EXISTS (SELECT 1 FROM rendezvous_briefs o
                         WHERE o.rendezvous_id = r.id AND o.for_user <> b.for_user AND o.human_says_yes))
        AND NOT EXISTS (SELECT 1 FROM match_profile m WHERE m.user_id = b.for_user AND m.is_synthetic)
      RETURNING b.for_user, r.id`)).rows);
  for (const d of due) await wake(d.for_user, 'fades', d.id);
  if (due.length) log.info({ warned: due.length }, 'cards fading today: people warned');
  return due.length;
}
