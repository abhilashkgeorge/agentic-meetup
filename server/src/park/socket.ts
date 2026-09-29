/**
 * The park on the socket: frames in, the room's answers out.
 *
 * The park rides the one socket the app already keeps open (chat and messages), so it
 * needs no login, reconnect or heartbeat of its own. Its frames skip the 60-a-minute
 * message limit -- a walk is several frames a second -- and have limits of their own
 * instead: moves are dropped past a few a second, and saying things is capped at a
 * rate a person talks at.
 *
 * Four times a second every person in the park is sent the people near them
 * (ParkRoom.snapshot). A person's look goes with the first frame they appear in for a
 * viewer, and again only when it changes.
 */
import type { WebSocket } from 'ws';
import { ClientMessage, lookKey, parkDay, type ParkPerson, type ParkQuestId, type ServerEvent } from '@clone/shared';
import { matchSession, matchmakerSession, tenantSession, type TenantCtx } from '../db/client.js';
import { lookOf } from '../looks/store.js';
import { LIKED, tagWords } from '../matching/brief.js';
import { publicTags } from '../matching/rendezvous.js';
import { rank } from '../matching/score.js';
import { agentRef } from '../matching/world.js';
import * as hub from '../messaging/hub.js';
import { log } from '../log.js';
import { take } from '../ratelimit.js';
import { award, balance, type PointReason } from '../points/ledger.js';
import { ParkPairs } from './pairs.js';
import { ParkQuests, type Done } from './quests.js';
import { ParkRoom } from './room.js';

export const pairs = new ParkPairs();
export const park = new ParkRoom(agentRef, Date.now, pairs);
/** Things done together (quests.ts), and each person's tenant, to pay them in. */
export const quests = new ParkQuests();
const tenantOf = new Map<string, string>();

/** A walk is at most a few frames a second; anything faster is dropped, not answered. */
export const MOVE_LIMIT = { max: 30, windowMs: 3_000 };
/** A person talks at this rate at most; faster is told to slow down. */
export const SAY_LIMIT = { max: 8, windowMs: 30_000 };
/** Every other park frame (enter, leave): a reconnect loop is the failure this catches. */
export const OTHER_LIMIT = { max: 20, windowMs: 60_000 };
/** "Find someone" is a question to a stranger: a few a minute at most. */
export const FIND_LIMIT = { max: 6, windowMs: 60_000 };
/** Answering, parting, sitting and standing. */
export const PAIR_LIMIT = { max: 30, windowMs: 60_000 };

/** Cheap enough to run on every frame before parsing: the app writes `type` first. */
export const isParkFrame = (raw: string): boolean => raw.startsWith('{"type":"park.');

function send(ws: WebSocket, ev: ServerEvent): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(ev));
}

/** Handle one park frame. Anything malformed is dropped: the park is not worth an error. */
export async function handleParkFrame(ws: WebSocket, ctx: TenantCtx, raw: string): Promise<void> {
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return; }
  const parsed = ClientMessage.safeParse(json);
  if (!parsed.success) return;
  const msg = parsed.data;
  const me = ctx.userId;

  switch (msg.type) {
    case 'park.move':
      if (!take(`park-move:${me}`, MOVE_LIMIT).ok) return;
      if (!park.move(me, msg.x, msg.z, msg.facing, msg.moving, msg.riding === true)) send(ws, { type: 'park.refused', reason: 'not_in_park' });
      return;
    case 'park.say': {
      if (!take(`park-say:${me}`, SAY_LIMIT).ok) { send(ws, { type: 'park.refused', reason: 'too_fast' }); return; }
      const r = park.say(me, msg.text);
      if (!r.ok) { send(ws, { type: 'park.refused', reason: r.reason }); return; }
      const at = Date.now();
      const priv = r.private ? { private: true } : {};
      for (const { userId, ref } of r.to) hub.pushTo(userId, { type: 'park.said', ref, text: msg.text, at, ...priv } satisfies ServerEvent);
      // Said on a bench, to a partner: one more towards sitting and talking. Counted only.
      if (r.private) await pay(quests.said(me, pairs.partnerOf(me), true));
      return;
    }
    case 'park.find': {
      if (!take(`park-find:${me}`, FIND_LIMIT).ok) { send(ws, { type: 'park.refused', reason: 'too_fast' }); return; }
      if (!park.members.has(me)) { send(ws, { type: 'park.refused', reason: 'not_in_park' }); return; }
      if (pairs.busy(me)) { send(ws, { type: 'park.finding', status: 'busy' }); return; }
      const found = await findFor(me);
      // Asked for between the search and now by somebody quicker: nobody, this time.
      if (!found || !pairs.ask(me, found.to)) { send(ws, { type: 'park.finding', status: 'nobody' }); return; }
      const why = found.why ? { why: found.why } : {};
      hub.pushTo(found.to, { type: 'park.asked', ref: agentRef(found.to, me), ...why } satisfies ServerEvent);
      send(ws, { type: 'park.finding', status: 'asking', ref: agentRef(me, found.to), ...why });
      log.info({ userId: me }, 'park: asking someone');
      return;
    }
    case 'park.answer': {
      if (!take(`park-pair:${me}`, PAIR_LIMIT).ok) return;
      const from = pairs.answer(me, msg.yes);
      if (!from) { send(ws, { type: 'park.unasked' }); return; }
      if (!msg.yes) { hub.pushTo(from, { type: 'park.finding', status: 'declined' } satisfies ServerEvent); return; }
      const asker = park.members.get(from);
      const asked = park.members.get(me);
      if (!asker || !asked) { endPair(me); return; }
      // The one who asked rides over to the one who said yes (the app's car).
      hub.pushTo(from, { type: 'park.paired', ref: agentRef(from, me), x: asked.x, z: asked.z, asked: false } satisfies ServerEvent);
      send(ws, { type: 'park.paired', ref: agentRef(me, from), x: asker.x, z: asker.z, asked: true });
      log.info({ userId: me }, 'park: paired');
      // Both have met somebody here; and each is sent what there is to do together --
      // with the payment, or on its own if meeting somebody was already paid today.
      const done = quests.paired(from, me);
      await pay(done);
      for (const u of [from, me]) if (!done.some((d) => d.userId === u)) pushQuests(u);
      return;
    }
    case 'park.part': {
      if (!take(`park-pair:${me}`, PAIR_LIMIT).ok) return;
      const was = pairs.withdraw(me);
      if (was) { hub.pushTo(was, { type: 'park.unasked' } satisfies ServerEvent); send(ws, { type: 'park.finding', status: 'gone' }); }
      endPair(me);
      return;
    }
    case 'park.sit': {
      if (!take(`park-pair:${me}`, PAIR_LIMIT).ok) return;
      const other = pairs.sit(me, msg.bench);
      if (!other) { send(ws, { type: 'park.bench_taken', bench: msg.bench }); return; }
      for (const u of [me, other]) hub.pushTo(u, { type: 'park.sat', bench: msg.bench } satisfies ServerEvent);
      return;
    }
    case 'park.stand': {
      if (!take(`park-pair:${me}`, PAIR_LIMIT).ok) return;
      const other = pairs.stand(me);
      if (other) for (const u of [me, other]) hub.pushTo(u, { type: 'park.stood' } satisfies ServerEvent);
      return;
    }
    case 'park.enter': {
      if (!take(`park:${me}`, OTHER_LIMIT).ok) return;
      await enter(ctx);
      pushPeople(me);
      return;
    }
    case 'park.leave':
      if (!take(`park:${me}`, OTHER_LIMIT).ok) return;
      leavePark(me);
      return;
    default:
      return;
  }
}

/** Walk in: their look, and who here they are kept apart from, from the database. */
async function enter(ctx: TenantCtx): Promise<void> {
  const here = [...park.members.keys()].filter((id) => id !== ctx.userId);
  const { look, apart } = await matchSession(async (c) => {
    const look = await lookOf(c, ctx.userId);
    const { rows } = here.length
      ? await c.query<{ other: string }>(
        'SELECT other FROM unnest($2::uuid[]) AS other WHERE apart($1, other)', [ctx.userId, here])
      : { rows: [] };
    return { look, apart: rows.map((r) => r.other) };
  });
  park.enter(ctx.userId, look, apart);
  // What they have already been paid for today: the ledger's word, on their own session.
  tenantOf.set(ctx.userId, ctx.tenantId);
  const day = parkDay(Date.now());
  const { done, points } = await tenantSession(ctx, async (c) => {
    const { rows } = await c.query<{ reason: string }>(
      `SELECT reason FROM points_ledger WHERE user_id = $1 AND ref = $2 AND reason LIKE 'park\\_%'`, [ctx.userId, day]);
    return { done: rows.map((r) => r.reason.slice('park_'.length) as ParkQuestId), points: await balance(c, ctx.userId) };
  });
  quests.enter(ctx.userId, done);
  pushQuests(ctx.userId, undefined, points);
  log.info({ userId: ctx.userId, here: park.members.size }, 'park: entered');
}

/**
 * Pay whoever just did something together: once a day each, by the ledger's own
 * uniqueness (the ref is the day), on their own tenant session. Each is told what they
 * did, what it paid -- nothing, if it was already paid today -- and their balance.
 */
async function pay(done: readonly Done[]): Promise<void> {
  for (const { userId, quest } of done) {
    const tenantId = tenantOf.get(userId);
    if (!tenantId) continue;
    const who = { tenantId, userId };
    try {
      const { points, total } = await tenantSession(who, async (c) => {
        const points = await award(c, who, `park_${quest}` as PointReason, parkDay(Date.now()));
        return { points, total: await balance(c, userId) };
      });
      pushQuests(userId, { quest, points, balance: total });
      log.info({ userId, quest, points }, 'park: done together');
    } catch (err) {
      log.warn({ err, userId, quest }, 'park: could not pay');
    }
  }
}

/**
 * Somebody's quests, sent to them: what is done today, how far along the rest are, and
 * their points when they were just read (walking in, a payment).
 */
function pushQuests(userId: string, just?: { quest: ParkQuestId; points: number; balance: number }, points?: number): void {
  const state = quests.stateOf(userId, pairs.partnerOf(userId));
  if (!state) return;
  const total = just?.balance ?? points;
  hub.pushTo(userId, {
    type: 'park.quests', ...state, ...(just ? { just } : {}), ...(total !== undefined ? { balance: total } : {}),
  } satisfies ServerEvent);
}

export function leavePark(userId: string): void {
  if (!park.members.has(userId)) return;
  park.leave(userId);
  sentLooks.delete(userId);
  unpair(userId);
  quests.leave(userId);
  tenantOf.delete(userId);
  log.info({ userId, here: park.members.size }, 'park: left');
}

/** Everything of theirs ends when they go, and whoever it touched is told. */
function unpair(userId: string): void {
  const r = pairs.leave(userId);
  if (r.partner) { quests.parted(userId, r.partner); hub.pushTo(r.partner, { type: 'park.parted' } satisfies ServerEvent); }
  if (r.wasAsking) hub.pushTo(r.wasAsking, { type: 'park.unasked' } satisfies ServerEvent);
  if (r.wasAskedBy) hub.pushTo(r.wasAskedBy, { type: 'park.finding', status: 'gone' } satisfies ServerEvent);
}

function endPair(userId: string): void {
  const other = pairs.part(userId);
  if (!other) return;
  quests.parted(userId, other);
  for (const u of [userId, other]) hub.pushTo(u, { type: 'park.parted' } satisfies ServerEvent);
}

/**
 * The best free person here for `me` to talk to: first the square's own ranking, both
 * people's wants both ways (matching/score.ts rank); then how many of their tags they
 * share -- the ranker scores nothing for anybody who has stated no wants, which in a
 * park is most people -- then the nearest. And one thing they share, if both made it
 * public: never a word from a fact only matching may use (publicTags).
 */
async function findFor(me: string): Promise<{ to: string; why: string | null } | null> {
  const free = [...park.members.keys()].filter((id) => id !== me && !park.isApart(me, id) && pairs.mayAsk(me, id));
  if (!free.length) return null;
  const { ranked, tags } = await matchSession(async (c) => {
    const ranked = await rank(c, me, free, free.length);
    const { rows } = await c.query<{ user_id: string; attribute_tags: string[] }>(
      'SELECT user_id, attribute_tags FROM match_profile WHERE user_id = ANY($1::uuid[])', [[me, ...free]]);
    return { ranked, tags: new Map(rows.map((r) => [r.user_id, r.attribute_tags])) };
  });
  const score = new Map(ranked.map((r) => [r.userId, r.score]));
  const myTags = new Set(tags.get(me) ?? []);
  const shared = (id: string) => (tags.get(id) ?? []).filter((t) => myTags.has(t)).length;
  const mine = park.members.get(me)!;
  const dist = (id: string) => { const m = park.members.get(id)!; return Math.hypot(m.x - mine.x, m.z - mine.z); };
  const to = [...free].sort((a, b) =>
    (score.get(b) ?? 0) - (score.get(a) ?? 0) || shared(b) - shared(a) || dist(a) - dist(b))[0];
  if (!to) return null;
  const why = await matchmakerSession(async (c) => {
    const [a, b] = [tagWords(await publicTags(c, me), LIKED), tagWords(await publicTags(c, to), LIKED)];
    return a.find((w) => b.includes(w)) ?? null;
  });
  return { to, why };
}

/** A socket closed: if it was their last, they have left the park too. */
export function socketClosed(userId: string): void {
  if (!hub.isOnline(userId)) leavePark(userId);
}

/** Per viewer: whose look they have been sent, and which look it was. */
const sentLooks = new Map<string, Map<string, string>>();

function pushPeople(viewerId: string): void {
  const people = park.snapshot(viewerId);
  const sent = sentLooks.get(viewerId) ?? new Map<string, string>();
  sentLooks.set(viewerId, sent);
  const seen = new Set<string>();
  const out: ParkPerson[] = people.map((p) => {
    seen.add(p.ref);
    const key = p.look ? lookKey(p.look) : '';
    if (sent.get(p.ref) === key) return { ...p, look: undefined };
    sent.set(p.ref, key);
    return p;
  });
  // Somebody out of sight is forgotten, so their look goes again when they come back.
  for (const ref of sent.keys()) if (!seen.has(ref)) sent.delete(ref);
  hub.pushTo(viewerId, { type: 'park.people', people: out } satisfies ServerEvent);
}

/** Every person in the park, the people near them. And the silent ones leave. */
let ticks = 0;
export function tick(): void {
  for (const gone of park.sweep()) {
    sentLooks.delete(gone); unpair(gone); quests.leave(gone); tenantOf.delete(gone);
    log.info({ userId: gone }, 'park: timed out');
  }
  for (const { from, to } of pairs.expire()) {
    hub.pushTo(from, { type: 'park.finding', status: 'no_answer' } satisfies ServerEvent);
    hub.pushTo(to, { type: 'park.unasked' } satisfies ServerEvent);
  }
  for (const id of park.members.keys()) pushPeople(id);
  // Things done together, noticed as they happen; how far along, once a second, to
  // whoever is doing them with somebody.
  void pay(quests.step(TICK_MS / 1000, park.members, (u) => pairs.partnerOf(u)));
  if (++ticks % 4 === 0) for (const id of park.members.keys()) if (pairs.partnerOf(id)) pushQuests(id);
}

/** How often the park ticks. */
const TICK_MS = 250;

let loop: ReturnType<typeof setInterval> | null = null;
export function startPark(): void {
  loop ??= setInterval(tick, TICK_MS);
  loop.unref();
}
export function stopPark(): void {
  if (loop) clearInterval(loop);
  loop = null;
}
