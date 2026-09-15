/**
 * Getting six digits onto somebody's phone.
 *
 * Three senders behind one function, chosen by env:
 *
 *   console   writes the code to the server log and sends nothing. The default, and
 *             the only one that works with no account anywhere. This is how the
 *             founder tests the flow today.
 *   msg91     India. Cheapest per message by a wide margin for Indian numbers, and
 *             the OTP endpoint is a single GET.
 *   twilio    everywhere else. More expensive, no local paperwork.
 *
 * THE PART THAT IS NOT CODE. Transactional SMS to Indian numbers cannot be sent by
 * anybody who has not registered a sender id and a message template with the
 * operators first. That is a form-filling exercise measured in days, and no amount of
 * work in this file shortens it. `console` exists so that none of the rest of this
 * feature waits on that.
 *
 * A send failure is never fatal to the request that caused it. The challenge row is
 * already written, so a person who did not get the text can ask for another one; a
 * 500 here would instead tell them their number is broken.
 */
import { env } from './env.js';
import { log } from './log.js';

export interface SendResult {
  ok: boolean;
  /** For the log and for tests. Never shown to the person. */
  detail: string;
}

/** What each provider is handed. Deliberately tiny: a number and a code. */
interface Outbound {
  to: string;
  code: string;
}

/**
 * The message, in one place.
 *
 * "Do not share" earns its space: the single commonest way an OTP is defeated is
 * somebody ringing up and asking for it. No link, ever -- a link in a verification
 * text trains people to tap links in verification texts.
 */
export const smsBody = (code: string): string =>
  `${code} is your Clone code. It expires in 5 minutes. We will never ask you for it.`;

async function viaConsole({ to, code }: Outbound): Promise<SendResult> {
  // warn, not info: on a busy dev server an info line scrolls past and the founder
  // cannot find the code they are waiting for.
  log.warn({ to, code }, 'SMS (console sender) -- this is the code');
  return { ok: true, detail: 'console' };
}

async function viaMsg91({ to, code }: Outbound): Promise<SendResult> {
  if (!env.MSG91_AUTH_KEY || !env.MSG91_TEMPLATE_ID) {
    return { ok: false, detail: 'msg91 not configured' };
  }
  // MSG91 wants the number without the leading +.
  const url = new URL('https://control.msg91.com/api/v5/otp');
  url.searchParams.set('template_id', env.MSG91_TEMPLATE_ID);
  url.searchParams.set('mobile', to.replace(/^\+/, ''));
  url.searchParams.set('otp', code);
  url.searchParams.set('otp_expiry', '5');

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { authkey: env.MSG91_AUTH_KEY, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    const body = (await res.json().catch(() => ({}))) as { type?: string; message?: string };
    const ok = res.ok && body.type !== 'error';
    return { ok, detail: ok ? 'msg91' : `msg91: ${body.message ?? res.status}` };
  } catch (err) {
    return { ok: false, detail: `msg91: ${(err as Error).message}` };
  }
}

async function viaTwilio({ to, code }: Outbound): Promise<SendResult> {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM) {
    return { ok: false, detail: 'twilio not configured' };
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: env.TWILIO_FROM, Body: smsBody(code) }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return { ok: true, detail: 'twilio' };
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    return { ok: false, detail: `twilio: ${body.message ?? res.status}` };
  } catch (err) {
    return { ok: false, detail: `twilio: ${(err as Error).message}` };
  }
}

/**
 * Send, and say whether it went.
 *
 * NOTHING HERE LOGS THE CODE except the console sender, whose entire job is to. A
 * code in a production log is a credential in a log aggregator, read by everyone with
 * dashboard access and kept for as long as the retention policy says.
 */
export async function sendCode(to: string, code: string): Promise<SendResult> {
  const send =
    env.SMS_PROVIDER === 'msg91' ? viaMsg91
    : env.SMS_PROVIDER === 'twilio' ? viaTwilio
    : viaConsole;

  const r = await send({ to, code });
  if (!r.ok) log.error({ provider: env.SMS_PROVIDER, detail: r.detail }, 'SMS send failed');
  return r;
}
