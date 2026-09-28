/**
 * Getting a notification onto a closed phone: the transport, and nothing else.
 *
 * Three senders behind one function, chosen by PUSH_PROVIDER (env.ts), the same shape
 * as sms.ts:
 *
 *   console   one log line per push -- who and what kind, never a token -- and nothing
 *             sent. The default, and all that works until the app has an Expo project
 *             id and the Expo project has a Firebase key (see push/index.ts).
 *   expo      Expo's push service. Free, and no model is involved.
 *   off       nothing at all.
 *
 * Never throws and never waits long: a push is a courtesy on top of something that
 * already happened, and the person's own request must not fail or hang because a
 * notification could not be delivered.
 */
import { env } from '../env.js';
import { log } from '../log.js';

export interface Push {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
}

/** Per push, in order: sent, the token is dead (forget it), or it failed this time. */
export type Receipt = 'ok' | 'dead' | 'failed';

const EXPO_URL = 'https://exp.host/--/api/v2/push/send';

export async function deliver(pushes: readonly Push[], meta: { userId: string; kind: string }): Promise<Receipt[]> {
  if (!pushes.length || env.PUSH_PROVIDER === 'off') return pushes.map(() => 'ok');
  if (env.PUSH_PROVIDER === 'console') {
    log.info({ userId: meta.userId, kind: meta.kind, devices: pushes.length }, 'push (console sender) -- not sent');
    return pushes.map(() => 'ok');
  }
  try {
    const res = await fetch(EXPO_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {}),
      },
      body: JSON.stringify(pushes.map((p) => ({
        to: p.to, title: p.title, body: p.body, data: p.data,
        sound: 'default', priority: 'high', channelId: 'default',
      }))),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      log.warn({ status: res.status, kind: meta.kind }, 'push not sent');
      return pushes.map(() => 'failed');
    }
    const json = (await res.json()) as { data?: { status?: string; details?: { error?: string } }[] };
    return pushes.map((_, i) => {
      const ticket = json.data?.[i];
      if (ticket?.status === 'ok') return 'ok';
      return ticket?.details?.error === 'DeviceNotRegistered' ? 'dead' : 'failed';
    });
  } catch (err) {
    log.warn({ err: (err as Error).message, kind: meta.kind }, 'push not sent');
    return pushes.map(() => 'failed');
  }
}
