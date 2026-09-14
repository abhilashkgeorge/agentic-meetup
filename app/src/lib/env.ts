/**
 * Where the server is.
 *
 * This was a build-time constant derived from Metro's host, and it broke every time
 * something outside the app changed: Metro not running (the derivation returns
 * nothing and it silently falls back to localhost, so the phone talks to itself), the
 * Mac's DHCP lease moving, a router with client isolation, a different WiFi. Each one
 * produced the same dead end -- "could not reach the server" with no way to see what
 * it tried or to tell it otherwise.
 *
 * So the address is now RUNTIME STATE with three layers:
 *
 *   1. a URL the person saved, which beats everything and survives restarts
 *   2. EXPO_PUBLIC_API_URL, baked in at build time -- how a real build ships
 *   3. Metro's host, which is only ever a dev convenience
 *
 * And when none of them work, the app says which address it tried and offers a box to
 * change it. An unreachable server should cost thirty seconds, not an evening.
 */
import Constants from 'expo-constants';

function fromMetro(): string | null {
  const uri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost;
  const host = uri?.split(':')[0];
  if (!host || host === 'localhost' || host === '127.0.0.1') return null;
  return `http://${host}:${process.env.EXPO_PUBLIC_API_PORT ?? '8000'}`;
}

/** What we would use with nothing saved. Shown on the connect screen as the default. */
export function defaultBase(): string {
  return process.env.EXPO_PUBLIC_API_URL ?? fromMetro() ?? 'http://localhost:8000';
}

let base = defaultBase();

export const getApiBase = (): string => base;

export const getWsBase = (): string =>
  base.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');

/** Set at launch from storage, and by the connect screen. */
export function setApiBase(url: string): void {
  base = url.trim().replace(/\/+$/, '');
}

/** Accepts what a person types: bare host, host:port, or a full URL. */
export function normaliseBase(input: string): string {
  const t = input.trim().replace(/\/+$/, '');
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t;
  // A bare host with no port almost always means a tunnel, which is https on 443.
  return t.includes(':') ? `http://${t}` : `https://${t}`;
}

/** Is anything answering there? The connect screen will not save an address blindly. */
export async function pingServer(url: string, ms = 4000): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/health`, {
      signal: ctrl.signal,
      // Same reason as api.ts: without this an ngrok host answers with its own
      // interstitial and the ping "succeeds" against a page that is not our server.
      headers: { 'ngrok-skip-browser-warning': '1' },
    });
    if (!res.ok) return false;
    // A 200 is not enough -- an interstitial is also a 200. The body must be ours.
    const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    return body?.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
