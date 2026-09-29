import type { ImportPromptsResponse, Look } from '@clone/shared';
import { getApiBase } from './env';
import { deviceHeader } from './device';

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

/**
 * WHAT TO DO WHEN THE SERVER SAYS "NOT YOU".
 *
 * A session is revoked, or expires (thirty days for a test device, six months for a
 * phone), or the keys are rotated -- ROTATION.md says so in as many words. Until now
 * nothing in the app noticed: every call quietly returned null, so the town sat on
 * "Finding the square…" for ever, the profile stayed blank, and there was nothing on
 * any screen to say the words "sign in again". It cost most of an afternoon on the
 * test phone (2026-09-22) before the tunnel's own log gave it away as a 401.
 *
 * So one place decides. The app clears the credential and whoever set this up sends
 * the person to sign in. It fires once -- a dead token means several screens are
 * polling, and they should not race each other to sign out.
 */
type Rejected = () => void;
let onRejected: Rejected | null = null;
let rejecting = false;
export function onTokenRejected(fn: Rejected | null): void {
  onRejected = fn;
  if (fn) rejecting = false;
}
function rejected(status: number): void {
  if (status !== 401 || rejecting || !onRejected) return;
  rejecting = true;
  onRejected();
}

export interface Profile {
  knowsYou: { band: string; score: number };
  coverage: { essentials: string; texture: string; details: number };
  askNext: string | null;
  confirm: { factId: string; claim: string; from: string } | null;
  awaitingConfirmation: number;
}

export interface Config {
  aiProviders: string[];
  disclosure: { perSession: string };
}

async function get<T>(path: string, token?: string): Promise<T | null> {
  try {
    const res = await fetch(`${getApiBase()}${path}`, {
      headers: token ? { ...BASE_HEADERS, Authorization: `Bearer ${token}` } : { ...BASE_HEADERS },
    });
    if (!res.ok) { if (token) rejected(res.status); return null; }
    return (await res.json()) as T;
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
      headers: {
        ...BASE_HEADERS, ...(await deviceHeader()), 'Content-Type': 'application/json', Authorization: `Bearer ${legacy}`,
      },
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
      // Which phone this is: a ban holds against the handset as well as the number.
      headers: { ...BASE_HEADERS, ...(await deviceHeader()), 'Content-Type': 'application/json' },
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
        ...(await deviceHeader()),
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
/**
 * How "Delete everything" went -- as far as the phone can tell, and no further
 * (features/settings/delete-outcome.ts says each in words). It used to be a yes or a no,
 * and every no was told "Nothing was removed", which after a half-finished erasure, or a
 * connection lost mid-way, was not true.
 */
export type EraseOutcome = 'deleted' | 'partial' | 'refused' | 'signed_out' | 'unknown';

export async function eraseAccount(token: string): Promise<EraseOutcome> {
  try {
    const res = await fetch(`${getApiBase()}/v1/me?confirm=delete-everything`, {
      method: 'DELETE',
      headers: { ...BASE_HEADERS, Authorization: `Bearer ${token}` },
    });
    if (res.ok) return 'deleted';
    // Refused before anything was touched (server api/me.ts: the confirmation).
    if (res.status === 400) return 'refused';
    // No session: the account may be gone already, or the session just ended.
    if (res.status === 401) return 'signed_out';
    // The erasure ran and could not prove itself complete (memory/erasure.ts verified).
    const body = (await res.json().catch(() => null)) as { verified?: boolean } | null;
    return body?.verified === false ? 'partial' : 'unknown';
  } catch {
    return 'unknown';
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

/** `remaining` is null for the reviewer, who has no limit. */
export const getInvites = (token: string) =>
  get<{ invites: Invite[]; remaining: number | null; perPerson?: number }>('/v1/invites', token);

export async function createInvite(token: string, note: string) {
  return post<{ code: string; expiresInDays: number }>('/v1/invites', token, { note });
}

/** First launch: the app registers itself and keeps the credential in the keychain. */
export async function provisionDevice(label: string): Promise<string | null> {
  try {
    const res = await fetch(`${getApiBase()}/v1/auth/device`, {
      method: 'POST',
      headers: { ...BASE_HEADERS, ...(await deviceHeader()), 'Content-Type': 'application/json' },
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


/**
 * Like `post`, but a refusal keeps its reason. Most calls fold every non-2xx into
 * null because "offline" is the only thing the screen can do anything about; a few
 * -- saving a character that wears something unpaid, sending the agent to somebody
 * -- refuse for reasons the person needs to read.
 */
async function send<T>(method: 'POST' | 'PUT', path: string, token: string, body: unknown):
  Promise<T | { error: string; items?: string[] } | null> {
  try {
    const res = await fetch(`${getApiBase()}${path}`, {
      method,
      headers: { ...BASE_HEADERS, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      rejected(res.status);
      return { error: typeof parsed.error === 'string' ? parsed.error : `http_${res.status}`,
               ...(Array.isArray(parsed.items) ? { items: parsed.items as string[] } : {}) };
    }
    return parsed as T;
  } catch {
    return null;
  }
}

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

/**
 * "How you appear": exactly what a card about you shows somebody else -- built by the
 * same code a brief is. Every sentence that could reach a card is listed, the two on a
 * card now marked `shown`, and any you hid marked `hidden` so it can be undone.
 */
export interface Appearance {
  headline: string;
  line: string;
  /** Interests that show on a card when the other person shares them. */
  tags: string[];
  /**
   * `names`: the sentence names a company, a college or a building (server, shared
   * identifying.ts). The screen asks "Hide this?"; nothing is hidden for you.
   */
  quotes: { factId: string; text: string; hidden: boolean; shown: boolean; names?: NamedPlace | null }[];
  /**
   * What your agent says when another agent asks it something: every question in the
   * bank, in order, with the sentence of yours it answers with -- or null, which it says
   * as "I don't know". Optional only so an older server's screen still draws.
   */
  sheet?: SheetEntry[];
  /** Sentences of yours the sheet could use that you hid, each with its own Show. */
  hidden?: { factId: string; text: string }[];
  /**
   * What your clone learned in chat and nobody hears yet: your agent uses it for
   * matching, but it is quoted nowhere until you tap "OK to share".
   */
  learned?: { factId: string; text: string }[];
}
export interface SheetEntry {
  id: string;
  /** The question as the other agent asks it. */
  ask: string;
  /** Its label on a card: "Weekends". */
  short: string;
  answer: { factId: string; text: string; names?: NamedPlace | null } | null;
}
export type NamedPlace = 'company' | 'college' | 'building';
export const getAppearance = (token: string) => get<Appearance>('/v1/me/appearance', token);

/** Your wants, each with the question the other person answers (server api/wants.ts). */
export const getWants = (token: string) =>
  get<{ wants: import('../features/preferences/wants-state').WantView[] }>('/v1/me/wants', token);
/** Tie a want to its question: the answers that are fine. */
export const setWantQuestion = (token: string, want: string, questionId: string, accepted: string[]) =>
  post<{ ok: boolean }>('/v1/me/wants/question', token, { want, questionId, accepted });
/** Stop checking a want against its question. */
export const clearWantQuestion = (token: string, want: string) =>
  post<{ ok: boolean }>('/v1/me/wants/question/clear', token, { want });

/** Your own rules, read back in words. A template over what you tapped, not a model. */
export interface Readback { lines: string[]; footer: string; sentence: string }
export const getReadback = (token: string) => get<Readback>('/v1/me/readback', token);

/** Hide one of your own sentences from every card, or show it again. */
export const setQuoteHidden = (token: string, factId: string, hidden: boolean) =>
  post<{ ok: boolean }>(`/v1/facts/${factId}/disclosure`, token, { hidden });

/** One of the open questions that give your agent something true to say. */
export interface Story {
  id: string;
  text: string;
  hint: string | null;
  /** A want: only you and your agent see it; it is never repeated to anybody. */
  forYou?: boolean;
  /**
   * Your answer. `private` when it names one of the five cards, `contact` when it holds
   * a phone number, email, handle, link or address: kept, and never repeated.
   */
  answer: { factId: string; text: string; private: boolean; contact?: boolean } | null;
}
export const getStories = (token: string) =>
  get<{ stories: Story[]; min: number; max: number }>('/v1/stories', token);
export const saveStory = (token: string, id: string, text: string) =>
  post<{ ok: boolean; factId: string }>('/v1/stories', token, { id, text });

/**
 * The question of the day (server matching/unknowns.ts): something other agents asked
 * yours that it could not answer. `count` is how many times lately -- never who asked.
 */
export interface DailyQuestion {
  id: string;
  ask: string;
  count: number;
  /**
   * On a card topic (drinking, kids, faith...): the card to open instead of a text box,
   * so the answer is a card value -- checked, never said.
   */
  card?: { id: string; topic: string };
}
export const getQuestionOfDay = (token: string) =>
  get<{ question: DailyQuestion | null; min: number; max: number }>('/v1/question-of-day', token);
/** Saved either way; `usable` false means no agent will ever say it, and `reason` says why. */
export const answerQuestionOfDay = (token: string, id: string, text: string) =>
  post<{ ok: boolean; factId: string; usable?: boolean; reason?: 'contact' | 'private' | null }>(
    '/v1/question-of-day', token, { id, text });
export const skipQuestionOfDay = (token: string, id: string) =>
  post<{ ok: boolean }>('/v1/question-of-day/skip', token, { id });
/** A card question, answered through the card itself: record that it was. */
export const markQuestionDone = (token: string, id: string) =>
  post<{ ok: boolean }>('/v1/question-of-day/done', token, { id });

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
  post<TellResult>('/v1/tell', token, { text, sessionId });

/** What "tell" heard: live facts, and facts on tapped fields held for the person's Yes. */
export interface TellResult {
  learned: number;
  toConfirm: number;
  facts: { label: string; value: string }[];
  message: string;
}

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

/** Rounded to ten, or null for "under 20" -- see lib/counts.ts. */
export interface PoolStep { step: string; remaining: number | null; cost: number | null }

/**
 * What each filter costs. Makes over-filtering visible instead of silent.
 *
 * `missing` is the friendly sentences the cards print; `need` is the raw predicate
 * keys, so the setup wizard can ask only what is still missing.
 */
export const getPool = (token: string) =>
  get<{ total: number | null; steps: PoolStep[]; inPool: boolean; missing: string[]; need: string[] }>(
    '/v1/pool', token,
  );

/**
 * The town's roster. What GET /v1/world may say about other people, which is very
 * little on purpose: a stranger is a ref, a kind, a seed and one practice bit. A name
 * arrives only for a met person the reveal would already name.
 */
export interface WorldAgent {
  ref: string;
  kind: 'stranger' | 'practice' | 'met';
  practice: boolean;
  seed: number;
  /** Their character: how the square draws them. The same to every viewer. */
  look: Look;
  /** Their neighbourhood, an id from shared/areas.ts; absent means the central tile. */
  area?: string;
  /** `shared`: you shared your profile, their move. `waiting`: they decide first. */
  state: 'idle' | 'talking' | 'briefed' | 'shared' | 'waiting' | 'introduced' | 'passed';
  rendezvousId?: string;
  name?: string;
  // No `agreement`: the square no longer says how the agents got on. See
  // server/src/api/world.ts.
  yourTurn?: boolean;
}
export interface World {
  square: { city: string | null; area?: string };
  me: { inPool: boolean; knows: number; missing: string[]; need: string[]; look: Look; area?: string | null };
  /** Rounded to ten, or null for "under 20". */
  pool: { total: number | null };
  round: RoundState | null;
  targetsLeftToday: number;
  agents: WorldAgent[];
}
export const getWorld = (token: string) => get<World>('/v1/world', token);

/**
 * One question the two agents asked each other, and what each could answer: that
 * person's own words, or null for "I don't know". The question is from a fixed bank on
 * the server (matching/answer-sheet.ts); no model writes any of it.
 */
export interface QaLine {
  /** Its label: "Weekends". */
  q: string;
  /** The question as one agent asks it: "What do you do on weekends?". */
  ask: string;
  theirs: string | null;
  mine: string | null;
  /** Their answer is a practice profile's template, not a person's words. */
  practice?: boolean;
}

/**
 * One line of the agents' talk (server/src/matching/talk.ts). `say` is a sentence the
 * speaker's person typed, verbatim; `ask` a question from a fixed bank; `react` one of a
 * fixed few; `dunno` is "I don't know." The model only chose which; it wrote none.
 */
export interface TalkLine {
  who: 'you' | 'them';
  kind: 'ask' | 'say' | 'dunno' | 'react';
  text: string;
  /** On an ask: the question's label, "Weekends". */
  q?: string;
  /** A practice profile's template line, not a person's words. */
  practice?: boolean;
}

/** The agents' talk as you see it: the lines, what you share, and a first-date idea. */
export interface Talk {
  lines: TalkLine[];
  /** One sentence of each of you that shows something you share. */
  shared: { mine: string; theirs: string; practice?: boolean }[];
  /** The one thing a model wrote -- a suggestion, checked to say nothing about anybody. */
  date: { idea: string; mine: string; theirs: string; practice?: boolean } | null;
}

/**
 * A brief, as the server writes it: code, never a model (server/src/matching/brief.ts).
 *
 * No concern, no verdict, no agreement, no number. Every field is either the same on
 * every card (`line`), a fact the other person gave (`headline`: intent, age, area),
 * something both carry (`shared`), or their own words, checked as theirs (`quotes`).
 */
export interface MatchCard {
  id: string;
  /**
   * When this card fades out if you do not answer: three days on your turn (server
   * 0069). Null when it is not your turn. Optional only so an older server's card draws.
   */
  fadesAt?: string | null;
  /** Intent, age, area. "Your agent met someone" when there is nothing to say. */
  headline: string;
  /** The same words on every card: "Passes your rules both ways, on everything they've answered". */
  line: string;
  /** Interests and tastes you both carry, as words: "You both like ...". */
  shared: string[];
  /**
   * The field you both work in, as words: "You both work in ...". Kept apart from
   * `shared` because "You both like finance" is not true of two people in finance.
   * Optional only so an older server's card still draws.
   */
  work?: string[];
  /** Up to two of their own sentences, each found word for word in something they typed. */
  quotes: { text: string; when: string }[];
  /** "Ask them about: ..." around a shared tag or a quote, or nothing. */
  opener: string | null;
  /**
   * What the two agents asked each other. Empty on the plain card -- the second mover
   * sees nothing about the first until they have said yes. Optional only so an older
   * server's card still draws.
   */
  qa?: QaLine[];
  /**
   * What the two agents said to each other, or null when they did not talk -- and on
   * the plain card, which the second mover gets until the first says yes.
   */
  talk?: Talk | null;
  /**
   * What you asked for, each beside the sentence of theirs that bears on it -- or null
   * when nothing they said does (server matching/wants.ts). Never a verdict: the server
   * keeps whether it was met to itself, and you judge from their words.
   */
  wants?: {
    want: string; kind: 'wants' | 'not'; theirs: string | null;
    /**
     * Only for a want about a private topic (kids, drinking, faith...), checked against a
     * card and never quoted: matches or not. And for any want nothing could check yet.
     */
    check?: 'matches' | 'doesnt_match' | 'cant_check' | 'private';
    practice?: boolean;
  }[];
  waitingOnYou: boolean;
  /** Not your move: you shared and they have not answered, or they decide first. */
  waitingOnThem?: boolean;
  /**
   * CONSENT FIRST (server, 2026-09-28): they said yes to you, which shares their profile.
   * On your turn this is the second move: see who they are, then share yours back.
   */
  sharedWithYou?: boolean;
  /** You said yes: your profile is shared with them, and the next move is theirs. */
  youShared?: boolean;
  /**
   * The other side is an invented profile, not a person.
   *
   * The pool is synthetic until there are users. The card is built the same way as
   * any other -- but there is nobody on the far side to answer, and the screen has to
   * say so before anybody spends a feeling on it.
   */
  practice?: boolean;
  /** Their character, shown on the card until the reveal shows a photo. */
  look?: Look;
}

/** How the last round went, or is going. See matching/rounds.ts on the server. */
export interface RoundState {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  skipped: string | null;
  met: number;
  error: string | null;
  /** What the agent did, once the round is done: templates and your own words (server recap.ts). */
  recap?: import('../features/matches/recap').Recap | null;
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
  /**
   * Whether "Must have" is offered: only on an answer people tap (server questions.ts
   * mustHaveAllowed). Optional only so an older server's list still draws.
   */
  mustHave?: boolean;
}

export const getPreferences = (token: string) =>
  get<{ preferences: Preference[] }>('/v1/preferences', token);

/** Moving something between must-have and want is the main lever on pool size. */
export async function setPreferenceStrength(
  token: string, id: string, strength: string,
): Promise<{ ok: true; total: number | null } | { ok: false; message: string } | null> {
  try {
    const res = await fetch(`${getApiBase()}/v1/preferences/strength`, {
      method: 'POST',
      headers: { ...BASE_HEADERS, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id, strength }),
    });
    const body = (await res.json()) as { total?: number | null; message?: string };
    // A refusal says why -- "only on a tapped answer" -- instead of doing nothing.
    return res.ok ? { ok: true, total: body.total ?? null } : { ok: false, message: body.message ?? 'That did not change.' };
  } catch {
    return null;
  }
}

/**
 * The second row of a core card: who you would be fine with.
 *
 * `anyone` writes no rule, but it IS stored, as a choice -- "anyone is fine" and
 * "never answered" are different things and the server keeps them apart. `only` lists
 * the options you accept; everything you left out becomes a hard rule, and it applies
 * both ways. People who have not answered the card themselves still pass it.
 */
export type WhoFine = { anyone: true } | { only: string[] };

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
  /**
   * Where the question sits in the interview, which the server now asks in a FIXED
   * order: the basics (gender, who you want to meet, what you are after), then the
   * five core cards -- kids, one person or open, smoking, drinking, food -- then the
   * optional sentence, then optional chips. A `core` card is the only kind drawn with
   * two rows, and the agent cannot go out until all five have an answer.
   */
  tier: 'basics' | 'core' | 'optional' | 'free';
  /** Offers "Prefer not to say" on the You row. Declining is an answer, not a gap. */
  declinable: boolean;
  /**
   * Core cards only: the "Who's fine" row, over the same values as the card. Nothing
   * in it is pre-ticked -- see features/onboarding/core-card.ts for why.
   */
  whoFine?: { text: string; options: { value: string; label: string }[] };
  /** Core cards only: the short title of the card's screen ("Smoking"). */
  topic?: string;
  /** A card that may be skipped whole (faith): "Skip this one" is offered. */
  optional?: boolean;
}

export interface InterviewState {
  question: InterviewQuestion | null;
  answered: number;
  remaining: number;
  /** Can the agent go out yet. The only thing the person actually wants to know. */
  ready: boolean;
  missing: string[];
  /** Rounded to ten, or null for "under 20". */
  poolSize: number | null;
}

/** The next question -- or, with `card`, that one card, opened again (the question of the day). */
export const getNextQuestion = (token: string, card?: string) =>
  get<InterviewState>(`/v1/interview/next${card ? `?card=${encodeURIComponent(card)}` : ''}`, token);

/** An empty `values` array means skipped, which is recorded rather than inferred. */
/** `text` carries the answer to a free question; `values` carries chip answers. */
/**
 * `whoFine` is REQUIRED for a core card -- the server answers 400 `who_fine_required`
 * without it -- and absent for everything else. On a core card an empty `values` means
 * "Prefer not to say" for the You row only; the Who's-fine choice still applies.
 */
/**
 * What a mapped sentence would change on one of the five cards, for the person to
 * confirm. The server writes nothing until they do (setWhoFine).
 */
export interface SentenceProposal {
  questionId: string;
  /** The card's own question, e.g. "Do you smoke?". */
  card: string;
  /** The Who's-fine row's wording. */
  text: string;
  options: { value: string; label: string }[];
  /** The options the card would keep, in card order. */
  accept: string[];
}

export const answerQuestion = (
  token: string, questionId: string, values: string[], text?: string, whoFine?: WhoFine,
) =>
  post<{
    ok: boolean; ready: boolean; missing: string[];
    mapped: { predicate: string | null; excludes?: string[]; proposal?: SentenceProposal | null } | null;
  }>(
    '/v1/interview/answer', token, { questionId, values, text, ...(whoFine ? { whoFine } : {}) },
  );

/**
 * Change who's fine on a card already answered, and nothing else. How a proposal from
 * the sentence becomes a rule -- the only way it ever does.
 */
export const setWhoFine = (token: string, questionId: string, whoFine: WhoFine) =>
  post<{ ok: boolean; ready: boolean; missing: string[] }>(
    '/v1/interview/who-fine', token, { questionId, whoFine },
  );

// ── people you matched with ─────────────────────────────────────────────────

export interface ConversationRow {
  id: string;
  otherId: string;
  name: string;
  /** Their first photo, when you are allowed it. Null is a perfectly normal answer. */
  photoId: string | null;
  look?: Look;
  lastMessage: string | null;
  lastAt: string | null;
  lastFromMe: boolean;
  unread: number;
  /** The one gentle nudge is due: quiet for two days since the match (server 0068). */
  quiet?: boolean;
}

/**
 * A chat whose other person deleted their account (server 0082): held hidden for 30 days
 * so you can still report them. Never the words -- only that they left.
 */
export interface LeftChatRow {
  id: string;
  /** The name you knew them by. */
  name: string;
  leftAt: string;
  lastAt: string | null;
  /** You reported it already; once is all. */
  reported: boolean;
}

export const getConversations = (token: string) =>
  get<{ me: string; conversations: ConversationRow[]; left?: LeftChatRow[] }>('/v1/conversations', token);

/** Report somebody who left, from the chat held for you (server 0082). Once, within 30 days. */
export const reportLeftChat = (token: string, id: string, args: { reason: string; detail?: string }) =>
  post<{ ok: boolean }>(`/v1/left/${id}/report`, token, args);

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
    me: string; otherId: string | null; name: string; photoId: string | null; look?: Look | null;
    messages: HistoryMessage[]; hasMore: boolean;
  }>(`/v1/conversations/${id}/messages${before ? `?before=${before}` : ''}`, token);

/** Silent and immediate. The other person is never told. */
export const blockUser = (token: string, userId: string) =>
  post<{ ok: boolean }>('/v1/block', token, { userId });

export const reportUser = (
  token: string,
  args: { userId: string; rendezvousId?: string; reason: string; detail?: string },
) => post<{ ok: boolean }>('/v1/report', token, args);

/**
 * The date idea the two agents came back with, for a conversation -- checked again by
 * the server each time -- and whether either of you has proposed it yet.
 */
export const getDateIdea = (token: string, rendezvousId: string) =>
  get<{ idea: string | null; proposed: boolean; quiet?: boolean }>(`/v1/conversations/${rendezvousId}/date`, token);

/** The quiet nudge was on screen: the server never shows it again for this match. */
export const nudgeSeen = (token: string, rendezvousId: string) =>
  post<{ ok: boolean }>(`/v1/conversations/${rendezvousId}/nudge`, token, {});

/**
 * "Propose this date". Sends only the message's own id: the server writes the words,
 * from the checked idea, so nothing typed here -- and nothing the agent might add --
 * can ride along. What comes back is the message, from you, like any other.
 */
export const proposeDate = (token: string, rendezvousId: string, messageId: string) =>
  post<{ message: {
    id: string; rendezvousId: string; senderId: string; text: string;
    sentAt: string; seq: string; deliveredAt: string | null; readAt: string | null;
  } }>(`/v1/conversations/${rendezvousId}/date`, token, { messageId });

/**
 * Block or report from a card or a profile: by MATCH, since neither carries anybody's
 * id -- the server works out the other half, and only of a match you are half of.
 */
/**
 * Somebody met in the park, who is only a ref: the server looks them up among the
 * people there now (api/park.ts). 404 `not_here` once they have left.
 */
export const blockInPark = (token: string, ref: string) =>
  post<{ ok: boolean }>('/v1/park/block', token, { ref });
export const reportInPark = (token: string, args: { ref: string; reason: string; detail?: string; voice?: boolean }) =>
  post<{ ok: boolean }>('/v1/park/report', token, args);

export const blockMatch = (token: string, rendezvousId: string) =>
  post<{ ok: boolean }>('/v1/block', token, { rendezvousId });
export const reportMatch = (token: string, args: { rendezvousId: string; reason: string; detail?: string }) =>
  post<{ ok: boolean }>('/v1/report', token, args);

/** The reviewer's desk. `isAdmin` is null for everybody who is not the reviewer. */
export interface AdminReport {
  /**
   * Who it is about today (server 0079): their account, or -- they deleted it -- the one
   * they came back as; null when they deleted it and have not come back.
   */
  id: string; reason: string; detail: string; at: string; reportedId: string | null; reporterKnown: boolean;
  reportedDeleted: boolean; cameBack: boolean;
  reportedName: string | null; banned: boolean;
  reviewed: string | null; outcome: string | null; note: string;
  /** Messages of their chat kept with the report (server 0080); 0 when they never chatted. */
  chatLines: number;
  context: { reportsAgainstThem: number; distinctReporters: number; photos: number; photosHidden: number };
}
/** A line of the chat a report is about, as it stood when the report was made. */
export interface ReportChatLine {
  /** Said by the person reported ("them") or by the one who reported them. */
  from: 'them' | 'reporter';
  text: string;
  dateIdea: boolean;
  /** Typed in the park, not in their chat (server park/lines.ts). */
  park?: boolean;
  at: string;
  /** They took it back ("delete for everyone") before the report; the words were kept. */
  takenBack: boolean;
}
export const isAdmin = (token: string) => get<{ admin: boolean }>('/v1/admin/me', token);
/** The founder's funnel: counts between real people (server 0070). Null for non-reviewers. */
/** Wants no question fits, most people first: which situation questions to add next. */
export const getUnmatchedWants = (token: string) =>
  get<{ wants: { want: string | null; topic: string[]; people: number }[]; topics: { word: string; people: number }[] }>(
    '/v1/admin/unmatched-wants', token);
export const getFunnel = (token: string) =>
  get<import('../features/admin/funnel').Funnel>('/v1/admin/funnel', token);
export const getAdminReports = (token: string, all = false) =>
  get<{ open: number; reports: AdminReport[] }>(`/v1/admin/reports${all ? '?all=1' : ''}`, token);
export const getReportChat = (token: string, id: string) =>
  get<{ lines: ReportChatLine[] }>(`/v1/admin/reports/${id}/chat`, token);
export const decideReport = (token: string, id: string, outcome: 'no_action' | 'photos_hidden' | 'banned', note = '') =>
  post<{ ok: boolean }>(`/v1/admin/reports/${id}`, token, { outcome, note });

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
  look?: Look;
  /** How many dates said the basics were true. Zero is shown as nothing. */
  confirmedBy?: number;
  /** Their selfies matched their photos, and every photo you can see was in that check. */
  photosChecked?: boolean;
  /** Both have shared: nothing left to decide here, only to say hello. */
  introduced?: boolean;
  /** You have already answered this one. */
  youAnswered?: boolean;
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
  post<{ ok: boolean; awarded?: number }>(`/v1/matches/${id}/met`, token, { yes });

// ── the after-date check-in ─────────────────────────────────────────────────
export interface CheckinQuestion { key: string; text: string; identity: boolean }
export interface CheckinState {
  /** not_yet: too soon. ask_met: "did you two meet" is due. ask: the questions are ready. done. */
  state: 'not_yet' | 'ask_met' | 'ask' | 'done';
  met: boolean | null;
  practice: boolean;
  questions: CheckinQuestion[];
  whyNot: string[];
  /** Both said they would see each other again. The one bit that crosses. */
  again: boolean;
}
export const getCheckin = (token: string, id: string) => get<CheckinState>(`/v1/matches/${id}/checkin`, token);

export type CheckinAnswers =
  | { answers: Record<string, 'yes' | 'no' | 'unsure'>; feltSafe: boolean; seeAgain: boolean | null }
  | { whyNot?: string };
export const postCheckin = (token: string, id: string, body: CheckinAnswers) =>
  send<{ ok: true; awarded: number; again: boolean }>('POST', `/v1/matches/${id}/checkin`, token, body);

/**
 * Your answer. On the first move a yes shares your profile with them; on the second it
 * shares yours back and introduces you. The server takes answers only in turn (409
 * otherwise). Null means it did not go through -- say so, never "Sent".
 */
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

// ── your character ──────────────────────────────────────────────────────────
export type { Look } from '@clone/shared';

export interface LookState {
  look: Look;
  /** False until the person has saved one; the look is then the seeded free one. */
  saved: boolean;
  /** Catalog ids bought so far. */
  owned: string[];
  balance: number;
}

export const getLook = (token: string) => get<LookState>('/v1/look', token);

/** 402 `locked` carries the items that would have to be bought first. */
export const putLook = (token: string, look: Look) =>
  send<{ look: Look; first: boolean; awarded: number; balance: number }>('PUT', '/v1/look', token, { look });

/** 409 `not_enough` carries the balance; 404 for a starter or unknown item. */
export const buyItem = (token: string, item: string) =>
  send<{ ok: true; balance: number; owned: string[] }>('POST', '/v1/look/buy', token, { item });

export const getPoints = (token: string) =>
  get<{ balance: number; ledger: { reason: string; amount: number; at: string }[] }>('/v1/points', token);

// ── the photo check ─────────────────────────────────────────────────────────
//
// Two frames, sent as raw bytes like uploadPhoto, because the phone cannot build
// multipart. Neither frame is kept by the server; the app forgets the uris too.

export interface SelfieStatus {
  status: 'unavailable' | 'none' | 'pending' | 'queued' | 'running' | 'done' | 'failed';
  result?: 'match' | 'no_match' | 'no_face' | 'not_live' | 'no_photos' | 'error' | null;
  /** Every photo you have now was in the last pass. False the moment you add one. */
  covers?: boolean;
  checkedAt?: string | null;
}

export const getSelfieStatus = (token: string) => get<SelfieStatus>('/v1/photos/verify', token);

async function sendFrame(path: string, token: string, uri: string): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; message: string }> {
  try {
    const { File } = await import('expo-file-system');
    const bytes = await new File(uri).arrayBuffer();
    const res = await fetch(`${getApiBase()}${path}`, {
      method: 'POST',
      headers: { ...BASE_HEADERS, authorization: `Bearer ${token}`, 'content-type': 'image/jpeg' },
      body: bytes,
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, message: res.status === 409 ? 'A check is already running. Give it a minute.'
        : res.status === 503 ? 'Photo checks are not on right now.'
        : (typeof body.message === 'string' ? body.message : 'That did not go through. Try again.') };
    }
    return { ok: true, body };
  } catch {
    return { ok: false, message: 'Could not reach the server.' };
  }
}

export async function startSelfieCheck(token: string, uri: string): Promise<{ ok: true; checkId: string } | { ok: false; message: string }> {
  const r = await sendFrame('/v1/photos/verify', token, uri);
  if (!r.ok) return r;
  return typeof r.body.checkId === 'string' ? { ok: true, checkId: r.body.checkId } : { ok: false, message: 'That did not go through. Try again.' };
}

export const finishSelfieCheck = (token: string, checkId: string, uri: string) =>
  sendFrame(`/v1/photos/verify/${checkId}`, token, uri);
