import type { ImportPromptsResponse } from '@clone/shared';
import { getApiBase } from './env';

export type ChatGuide = ImportPromptsResponse['chatGuide'];

/**
 * Sent on every request.
 *
 * ngrok's free tier answers browser-shaped requests with its own interstitial page
 * instead of ours, unless this header is present. Our own calls can always set it, so
 * the app is unaffected either way; the header is harmless on any other host.
 *
 * It does NOT help the grader page, which is opened by other people in a real browser
 * that will never send it. That surface needs a host without an interstitial before
 * links go out to anybody.
 */
const BASE_HEADERS = { 'ngrok-skip-browser-warning': '1' } as const;

export interface Profile {
  knowsYou: { band: string; score: number };
  coverage: { essentials: string; texture: string; details: number };
  askNext: string | null;
  confirm: { factId: string; claim: string; from: string } | null;
  awaitingConfirmation: number;
}

export interface Config {
  aiProviders: string[];
  disclosure: { perSession: string; privacyUrl: string; safetyProtocolUrl: string };
}

async function get<T>(path: string, token?: string): Promise<T | null> {
  try {
    const res = await fetch(`${getApiBase()}${path}`, {
      headers: token ? { ...BASE_HEADERS, Authorization: `Bearer ${token}` } : { ...BASE_HEADERS },
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null; // offline is a normal state, not an error to shout about
  }
}

/**
 * A credential the server issued looks like `<uuid>.<signature>`. The pre-invite one
 * was a bare uuid. Anything without a dot is therefore the old kind and must be
 * traded in, or the device stops working the day legacy tokens are switched off.
 */
export const isLegacyToken = (token: string): boolean => !token.includes('.');

/** Trade an old token for a signed session, keeping the same account behind it. */
export async function upgradeToken(legacy: string): Promise<string | null> {
  try {
    const res = await fetch(`${getApiBase()}/v1/auth/upgrade`, {
      method: 'POST',
      headers: { ...BASE_HEADERS, 'Content-Type': 'application/json', Authorization: `Bearer ${legacy}` },
    });
    if (!res.ok) return null;
    return ((await res.json()) as { token?: string }).token ?? null;
  } catch {
    return null;
  }
}

/** Redeem an invite code. The only way to make a new account. */
export async function redeemInvite(
  code: string,
  label: string,
  /** Proof that the number was verified, from verifyPhone. The server insists. */
  ticket?: string,
): Promise<{ token: string; note: string } | { error: string } | null> {
  try {
    const res = await fetch(`${getApiBase()}/v1/auth/redeem`, {
      method: 'POST',
      headers: { ...BASE_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, label, ...(ticket ? { ticket } : {}) }),
    });
    const body = (await res.json()) as { token?: string; note?: string; message?: string };
    if (!res.ok || !body.token) return { error: body.message ?? 'That code does not work.' };
    return { token: body.token, note: body.note ?? '' };
  } catch {
    return null; // offline, which is not the same as a bad code
  }
}

/**
 * Ask for a one-time code.
 *
 * `sentTo` is a mask the SERVER built, not something the app guessed, so the two can
 * never disagree about which number was actually texted.
 */
export interface StartedOtp {
  challengeId: string;
  expiresInSec: number;
  sentTo: string;
  /** Present only when the operator turned SMS_DEV_ECHO on. Shown, never hidden. */
  devCode?: string;
  devEchoIsOn?: boolean;
}

export async function startPhone(
  phone: string,
  country: string,
): Promise<StartedOtp | { error: string } | null> {
  try {
    const res = await fetch(`${getApiBase()}/v1/auth/phone/start`, {
      method: 'POST',
      headers: { ...BASE_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, country }),
    });
    const body = (await res.json()) as StartedOtp & { message?: string };
    if (!res.ok || !body.challengeId) {
      return { error: body.message ?? 'That number did not work.' };
    }
    return body;
  } catch {
    return null; // offline, which is not the same as a bad number
  }
}

/**
 * Hand the code back.
 *
 * Three shapes out, because there are three genuinely different next steps: carry on
 * with the account you already had, land in one you already have on another phone, or
 * go and type an invite. Modelling them as one "success" and a flag is how a caller
 * ends up sending a brand-new person to the wrong screen.
 */
export type VerifiedPhone =
  | { status: 'linked' }
  | { status: 'signed_in'; token: string; onboarded: boolean }
  | { status: 'needs_invite'; ticket: string };

export async function verifyPhone(
  challengeId: string,
  code: string,
  label: string,
  /** Present when a signed-in device is attaching a number to the account it has. */
  token?: string,
): Promise<VerifiedPhone | { error: string; attemptsLeft?: number } | null> {
  try {
    const res = await fetch(`${getApiBase()}/v1/auth/phone/verify`, {
      method: 'POST',
      headers: {
        ...BASE_HEADERS,
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ challengeId, code, label }),
    });
    const body = (await res.json()) as VerifiedPhone & {
      message?: string; attemptsLeft?: number;
    };
    if (!res.ok || !('status' in body)) {
      return { error: body.message ?? 'That code did not work.', attemptsLeft: body.attemptsLeft };
    }
    return body;
  } catch {
    return null;
  }
}

/**
 * Tell the server to revoke this session before the keychain forgets the token.
 *
 * Best effort by design. If it fails the device still signs out locally, because a
 * person who taps sign out on a train has asked for something the network cannot be
 * allowed to veto -- and the token they are dropping expires on its own eventually.
 */
/**
 * Whether this account can be recovered at all.
 *
 * An account with no number attached is reachable only from the one device holding
 * its token. Lose that and it is gone, and rotating the signing key takes it too.
 */
export const phoneLinked = (token: string) =>
  get<{ linked: boolean }>('/v1/auth/phone', token);

export async function logout(token: string): Promise<boolean> {
  try {
    const res = await fetch(`${getApiBase()}/v1/auth/logout`, {
      method: 'POST',
      headers: { ...BASE_HEADERS, Authorization: `Bearer ${token}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Erase the account, for good.
 *
 * THE BUTTON FOR THIS EXISTED AND DID NOTHING. Settings drew a "Delete everything"
 * row, opened a confirmation alert, and the Delete button in that alert carried no
 * handler at all -- so the most serious action in the product was a piece of set
 * dressing, on a dating app, while the server endpoint behind it worked perfectly.
 *
 * The confirmation string is required by the server as well as by the alert. Two
 * deliberate acts for something with no undo.
 */
export async function eraseAccount(token: string): Promise<boolean> {
  try {
    const res = await fetch(`${getApiBase()}/v1/me?confirm=delete-everything`, {
      method: 'DELETE',
      headers: { ...BASE_HEADERS, Authorization: `Bearer ${token}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Everything the clone knows, as JSON.
 *
 * Returned as text rather than parsed: this is handed straight to the share sheet,
 * and re-serialising somebody's export to display it would be a lot of work to end
 * up with the same bytes.
 */
export async function exportAccount(token: string): Promise<string | null> {
  try {
    const res = await fetch(`${getApiBase()}/v1/me/export`, {
      headers: { ...BASE_HEADERS, Authorization: `Bearer ${token}` },
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

export interface Invite { code: string; note: string; used: boolean; expires_at: string }

export const getInvites = (token: string) =>
  get<{ invites: Invite[]; remaining: number }>('/v1/invites', token);

export async function createInvite(token: string, note: string) {
  return post<{ code: string; expiresInDays: number }>('/v1/invites', token, { note });
}

/** First launch: the app registers itself and keeps the credential in the keychain. */
export async function provisionDevice(label: string): Promise<string | null> {
  try {
    const res = await fetch(`${getApiBase()}/v1/auth/device`, {
      method: 'POST',
      headers: { ...BASE_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ label }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { token?: string };
    return body.token ?? null;
  } catch {
    return null;
  }
}

export const getProfile = (token: string) => get<Profile>('/v1/profile', token);
export const getConfig = () => get<Config>('/v1/config');

export async function importPaste(
  token: string,
  text: string,
  source: 'assistant' | 'self',
): Promise<{ staged: number; questions: number; message: string } | null> {
  try {
    const res = await fetch(`${getApiBase()}/v1/import/paste`, {
      method: 'POST',
      headers: { ...BASE_HEADERS, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text, source }),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/**
 * The shape of /v1/import/prompt.
 *
 * `chatGuide` is typed FROM the constant the server actually sends, not hand-written
 * here. It was declared as `string` and it is an object -- {who, why, how[], privacy}
 * -- so the app rendered an object as a React child and the screen died with
 * "Objects are not valid as a React child". TypeScript raised nothing, because a
 * hand-written interface over an untyped `res.json()` is an assertion, not a check:
 * it describes what someone believed the server sends.
 *
 * Importing the real type makes the compiler check the belief.
 */
export type ImportPrompts = ImportPromptsResponse;

/** Served, not compiled in, so the wording can change without a store release. */
export const getImportPrompts = () => get<ImportPrompts>('/v1/import/prompt');


async function post<T>(path: string, token: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${getApiBase()}${path}`, {
      method: 'POST',
      headers: { ...BASE_HEADERS, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}



export interface VoiceResult {
  style: string;
  habits: string[];
  never: string[];
  messagesUsed: number;
}

/**
 * Only the user's OWN messages go over the wire. The export is parsed on the device
 * and the other person's half is dropped before this is called -- they never agreed
 * to anything, so their words do not leave the phone.
 */
export const importChat = (token: string, messages: string[]) =>
  post<VoiceResult>('/v1/import/chat', token, { messages });

export interface Known { id: string; predicate: string; label: string; value: string; because: string }
export interface Gap { id: string; question: string }
export interface Changed { label: string; was: string; now: string; when: string }

export interface ReviewItem { factId: string; label: string; value: string }

export interface Knowledge {
  knows: Known[];
  wontGuess: Gap[];
  changedMind: Changed[];
  /** One at a time, and only for things that are expensive to get wrong. */
  confirm: { factId: string; claim: string; from: string } | null;
  /** The cheap pile. Reviewed as a list, rejected by exception. */
  review: ReviewItem[];
}

export const getKnowledge = (token: string) => get<Knowledge>('/v1/knowledge', token);

export interface HistoryEntry {
  value: string;
  status: string;
  current: boolean;
  recordedAt: string;
  stoppedAt: string | null;
}

export const getHistory = (token: string, predicate: string) =>
  get<{ label: string; entries: HistoryEntry[] }>(`/v1/knowledge/${predicate}/history`, token);

/** Yes / No on a staged claim. The highest-quality signal the system can collect. */
export const judgeFact = (token: string, factId: string, verdict: 'yes' | 'no') =>
  post<{ ok: boolean; message: string }>('/v1/knowledge/confirm', token, { factId, verdict });

export interface SelfTestItem { id: string; question: string; answer: string }
export interface Readiness {
  ready: boolean;
  passed: number;
  graded: number;
  missing: string[];
  passMark: number;
  testSize: number;
}

export const getReadiness = (token: string) => get<Readiness>('/v1/selftest', token);

export const nextSelfTest = (token: string) =>
  post<SelfTestItem & { message?: string }>('/v1/selftest/next', token, {});

export const gradeSelfTest = (
  token: string,
  id: string,
  verdict: 'me' | 'not_me',
  correction?: string,
) => post<Readiness>('/v1/selftest/grade', token, { id, verdict, correction });

/** One sentence about yourself, learned immediately. The first sixty seconds. */
export const tell = (token: string, text: string, sessionId: string) =>
  post<{ learned: number; facts: { label: string; value: string }[]; message: string }>(
    '/v1/tell', token, { text, sessionId },
  );

/** Keep everything in the reviewed pile except the ids listed. */
export const reviewFacts = (token: string, reject: string[]) =>
  post<{ kept: number; dropped: number; message: string }>(
    '/v1/knowledge/review', token, { reject },
  );

/**
 * One of the six structural answers, or a refusal.
 *
 * `null` means "prefer not to say" and is RECORDED. A declined field and a
 * never-asked field must not look the same, or the clone asks again every week.
 */
export const setEssential = (
  token: string,
  predicate: string,
  value: unknown,
  /**
   * A position the phone worked out, for `lives_in` only.
   *
   * Sent because the server can otherwise only place a city it already lists, and
   * there are 46 of those. Already coarsened to about a kilometre by lib/location.ts
   * before it reaches here -- the answer is a city, and a street is nobody's business.
   */
  place?: { city: string; lat: number; lon: number; precisionKm: number },
) =>
  post<{ ok: boolean; inPool: boolean; missing: string[] }>(
    '/v1/essentials', token, { predicate, value, ...(place ? { place } : {}) },
  );

export interface PoolStep { step: string; remaining: number; cost: number }

/**
 * What each filter costs. Makes over-filtering visible instead of silent.
 *
 * `missing` is the friendly sentences the cards print; `need` is the raw predicate
 * keys, so the setup wizard can ask only what is still missing.
 */
export const getPool = (token: string) =>
  get<{ total: number; steps: PoolStep[]; inPool: boolean; missing: string[]; need: string[] }>(
    '/v1/pool', token,
  );

/**
 * The town's roster. What GET /v1/world may say about other people, which is very
 * little on purpose: a stranger is a ref, a kind, a seed and one practice bit. A name
 * arrives only for a met person the reveal would already name.
 */
export type AgreementWords = 'got_on' | 'unsure' | 'did_not_click' | 'could_not_tell';
export interface WorldAgent {
  ref: string;
  kind: 'stranger' | 'practice' | 'met';
  practice: boolean;
  seed: number;
  state: 'idle' | 'talking' | 'briefed' | 'waiting' | 'introduced' | 'passed';
  rendezvousId?: string;
  name?: string;
  agreement?: AgreementWords;
  yourTurn?: boolean;
}
export interface World {
  square: { city: string | null };
  me: { inPool: boolean; knows: number; missing: string[]; need: string[] };
  pool: { total: number };
  round: RoundState | null;
  targetsLeftToday: number;
  agents: WorldAgent[];
}
export const getWorld = (token: string) => get<World>('/v1/world', token);

export interface MatchCard {
  id: string;
  headline: string;
  overlaps: { quoteA: string; dateA: string; quoteB: string; dateB: string; shared?: string }[];
  concern: string;
  questions: string[];
  waitingOnYou: boolean;
  /** You said yes and they have not looked yet. Never a hint about what they will say. */
  waitingOnThem?: boolean;
  /**
   * The other side is an invented profile, not a person.
   *
   * The pool is synthetic until there are users. The agents really did meet and the
   * brief is really what they made of each other -- but there is nobody on the far
   * side to answer, and the screen has to say so before anybody spends a feeling on
   * it.
   */
  practice?: boolean;
  /**
   * How the agents got on: the share of conversations that ended in a mutual yes.
   * Rendered as WORDS, never as a percentage -- a number here reads as compatibility,
   * and pre-date self-report predicts attraction badly enough that it would be a lie
   * with a decimal point. null when no conversation was conclusive.
   */
  agreement: number | null;
}

/** How the last round went, or is going. See matching/rounds.ts on the server. */
export interface RoundState {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  skipped: string | null;
  met: number;
  error: string | null;
}

export const getMatches = (token: string) =>
  get<{ matches: MatchCard[]; round: RoundState | null }>('/v1/matches', token);

export interface Preference {
  id: string;
  predicate: string;
  /** Said the way a person would say it, e.g. "works in AI". */
  label: string;
  strength: 'dealbreaker' | 'strong' | 'mild';
  sourceQuote: string;
}

export const getPreferences = (token: string) =>
  get<{ preferences: Preference[] }>('/v1/preferences', token);

/** Moving something between must-have and want is the main lever on pool size. */
export const setPreferenceStrength = (token: string, id: string, strength: string) =>
  post<{ ok: boolean; total: number }>('/v1/preferences/strength', token, { id, strength });

export interface InterviewQuestion {
  id: string;
  text: string;
  why: string | null;
  options: { value: string; label: string }[];
  multi: boolean;
  /** `free` is answered with a sentence rather than a chip. */
  kind: 'fact' | 'preference' | 'free';
  /** Cannot be skipped: the agent cannot go out without it. */
  required?: boolean;
}

export interface InterviewState {
  question: InterviewQuestion | null;
  answered: number;
  remaining: number;
  /** Can the agent go out yet. The only thing the person actually wants to know. */
  ready: boolean;
  missing: string[];
  poolSize: number;
}

export const getNextQuestion = (token: string) =>
  get<InterviewState>('/v1/interview/next', token);

/** An empty `values` array means skipped, which is recorded rather than inferred. */
/** `text` carries the answer to a free question; `values` carries chip answers. */
export const answerQuestion = (
  token: string, questionId: string, values: string[], text?: string,
) =>
  post<{ ok: boolean; ready: boolean; missing: string[]; mapped: { predicate: string | null } | null }>(
    '/v1/interview/answer', token, { questionId, values, text },
  );

// ── people you matched with ─────────────────────────────────────────────────

export interface ConversationRow {
  id: string;
  otherId: string;
  name: string;
  /** Their first photo, when you are allowed it. Null is a perfectly normal answer. */
  photoId: string | null;
  lastMessage: string | null;
  lastAt: string | null;
  lastFromMe: boolean;
  unread: number;
}

export const getConversations = (token: string) =>
  get<{ me: string; conversations: ConversationRow[] }>('/v1/conversations', token);

export interface HistoryMessage {
  id: string;
  senderId: string;
  text: string;
  sentAt: string;
  seq: string;
  deliveredAt: string | null;
  readAt: string | null;
  mine: boolean;
}

/** Oldest-first. `before` is a sequence number, not a timestamp. */
export const getMessages = (token: string, id: string, before?: string) =>
  get<{
    me: string; otherId: string | null; name: string; photoId: string | null;
    messages: HistoryMessage[]; hasMore: boolean;
  }>(`/v1/conversations/${id}/messages${before ? `?before=${before}` : ''}`, token);

/** Silent and immediate. The other person is never told. */
export const blockUser = (token: string, userId: string) =>
  post<{ ok: boolean }>('/v1/block', token, { userId });

export const reportUser = (
  token: string,
  args: { userId: string; rendezvousId?: string; reason: string; detail?: string },
) => post<{ ok: boolean }>('/v1/report', token, args);

/** Who they are. Only once it is this person's turn to look. */
export interface Reveal {
  waiting: boolean;
  message?: string;
  /** Who they are, for fetching their photos. Absent while it is not your turn. */
  userId?: string;
  name?: string;
  age?: number | null;
  tags?: string[];
  livesIn?: string | null;
  /** An invented profile. See MatchCard.practice. */
  practice?: boolean;
}

export const getReveal = (token: string, id: string) =>
  get<Reveal>(`/v1/matches/${id}`, token);

/** A no is silent in both directions, and final. */
/**
 * "Did you two actually meet?" Asked once, three days after both said yes. The only
 * outcome label that means anything: a yes on a card is a guess, a date is a fact.
 * Never shown to the other person.
 */
export const matchMet = (token: string, id: string) =>
  get<{ askDue: boolean; met: boolean | null }>(`/v1/matches/${id}/met`, token);

export const reportMet = (token: string, id: string, yes: boolean) =>
  post<{ ok: boolean }>(`/v1/matches/${id}/met`, token, { yes });

export const decideMatch = (token: string, id: string, yes: boolean) =>
  post<{ ok: boolean; introduced: boolean }>(`/v1/matches/${id}/decide`, token, { yes });

export interface RoundResult {
  considered: number;
  met: string | null;
  bothYes: number;
  runs: number;
  passed: boolean;
  costUsd: number;
  skipped?: string;
}

/** Sends the agent out once. Minutes, not seconds -- it is five conversations. */
/**
 * Ask for a round. Answers at once with a queued round; the matches list carries its
 * state from then on. It used to await the whole thing -- several minutes of model
 * calls inside one request -- and show the eventual timeout as a rejection.
 */
export async function runRound(
  token: string,
  /**
   * One person's ref from the square: "send my agent over". Without it, the agent
   * goes out to whoever the ranking picks.
   */
  target?: string,
): Promise<{ roundId: string; status: RoundState['status'] } | { error: string } | null> {
  // Not `post`: a refusal here has a reason the person needs to read -- five visits
  // a day, the day's budget, "that person has moved on" -- and `post` folds every
  // non-2xx into null, which reads as offline.
  try {
    const res = await fetch(`${getApiBase()}/v1/matches/run`, {
      method: 'POST',
      headers: { ...BASE_HEADERS, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(target ? { target } : {}),
    });
    const body = (await res.json().catch(() => ({}))) as { roundId?: string; status?: RoundState['status']; error?: string };
    if (!res.ok || !body.roundId || !body.status) return { error: body.error ?? `http_${res.status}` };
    return { roundId: body.roundId, status: body.status };
  } catch {
    return null;
  }
}

// ── photos ──────────────────────────────────────────────────────────────────
//
// The bytes are never at a public address. Every request for a picture carries the
// credential, and the server asks the same question the reveal asks before answering:
// is it this person's turn to see them yet.

export interface Photo {
  id: string;
  slot: number;
  width: number;
  height: number;
}

export const getMyPhotos = (token: string) =>
  get<{ me: string; photos: Photo[]; max: number }>('/v1/photos', token);

/** Empty both for "they have none" and for "not yet" — deliberately the same answer. */
export const getPhotosOf = (token: string, userId: string) =>
  get<{ photos: Photo[] }>(`/v1/photos/of/${userId}`, token);

/**
 * A URL the Image component can load, WITH the credential in a header.
 *
 * Returned as a source object rather than a string precisely so the token cannot end
 * up in a query string, where it would be written to every proxy log on the way.
 */
export const photoSource = (
  token: string, userId: string, photoId: string, size: 'full' | 'thumb' = 'full',
) => ({
  uri: `${getApiBase()}/v1/photos/${userId}/${photoId}?size=${size}`,
  headers: { authorization: `Bearer ${token}` },
});

/**
 * The raw bytes, not a multipart form.
 *
 * The obvious version -- FormData with React Native's `{uri, name, type}` file object --
 * fails on the device with "Unsupported FormDataPart implementation". That object is a
 * React Native convention, and the fetch in current Expo follows the web standard,
 * which wants a real Blob. Rather than pick a side, this sends the file as the body
 * with its content type on the header: there is no multipart to disagree about, and
 * one fewer layer between the picture and the disk.
 */
export async function uploadPhoto(
  token: string, uri: string,
): Promise<{ ok: true; photo: Photo } | { ok: false; message: string }> {
  try {
    // LOADED HERE, NOT AT THE TOP. This module is imported by nearly every screen,
    // so a top-level import of a native module makes a build that lacks it unable to
    // render anything at all -- the app dies at startup over a photo upload nobody
    // asked for yet.
    const { File } = await import('expo-file-system');
    const bytes = await new File(uri).arrayBuffer();

    const res = await fetch(`${getApiBase()}/v1/photos`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'image/jpeg' },
      body: bytes,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, message: body?.message ?? 'That picture would not upload.' };
    }
    return { ok: true, photo: body as Photo };
  } catch (err) {
    // The reason goes to the log. "Could not reach the server" on screen is honest for
    // a person and useless for anybody trying to fix it.
    console.warn('[photo upload]', err instanceof Error ? err.message : String(err));
    return { ok: false, message: 'Could not reach the server.' };
  }
}

export async function deletePhoto(token: string, photoId: string): Promise<boolean> {
  const res = await fetch(`${getApiBase()}/v1/photos/${photoId}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  }).catch(() => null);
  return Boolean(res?.ok);
}

export const reorderPhotos = (token: string, ids: string[]) =>
  post<{ photos: Photo[] }>('/v1/photos/order', token, { ids });

/** One document somebody has to agree to, as the server defines it. */
export interface ConsentDoc { document: string; version: string; title: string }

export interface ConsentState {
  required: ConsentDoc[];
  accepted: { document: string; version: string; at: string }[];
  outstanding: ConsentDoc[];
  settled: boolean;
}

/**
 * What this person still has to agree to.
 *
 * The list comes from the server rather than the app so the two cannot drift: bumping
 * a version server-side makes everybody re-accept that one document, and a client
 * that hardcoded the list would go on showing the old one for ever.
 */
export const getConsent = (token: string) => get<ConsentState>('/v1/consent', token);

export const acceptConsent = (token: string, docs: ConsentDoc[]) =>
  post<{ ok: boolean; settled: boolean }>('/v1/consent', token, {
    accept: docs.map((d) => ({ document: d.document, version: d.version })),
  });
