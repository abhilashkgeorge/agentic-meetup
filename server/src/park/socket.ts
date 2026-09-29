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
import { ClientMessage, lookKey, type ParkPerson, type ServerEvent } from '@clone/shared';
import { matchSession, type TenantCtx } from '../db/client.js';
import { lookOf } from '../looks/store.js';
import { agentRef } from '../matching/world.js';
import * as hub from '../messaging/hub.js';
import { log } from '../log.js';
import { take } from '../ratelimit.js';
import { ParkRoom } from './room.js';

export const park = new ParkRoom(agentRef);

/** A walk is at most a few frames a second; anything faster is dropped, not answered. */
export const MOVE_LIMIT = { max: 30, windowMs: 3_000 };
/** A person talks at this rate at most; faster is told to slow down. */
export const SAY_LIMIT = { max: 8, windowMs: 30_000 };
/** Every other park frame (enter, leave): a reconnect loop is the failure this catches. */
export const OTHER_LIMIT = { max: 20, windowMs: 60_000 };

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
      if (!park.move(me, msg.x, msg.z, msg.facing, msg.moving)) send(ws, { type: 'park.refused', reason: 'not_in_park' });
      return;
    case 'park.say': {
      if (!take(`park-say:${me}`, SAY_LIMIT).ok) { send(ws, { type: 'park.refused', reason: 'too_fast' }); return; }
      const r = park.say(me, msg.text);
      if (!r.ok) { send(ws, { type: 'park.refused', reason: r.reason }); return; }
      const at = Date.now();
      for (const { userId, ref } of r.to) hub.pushTo(userId, { type: 'park.said', ref, text: msg.text, at } satisfies ServerEvent);
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
  log.info({ userId: ctx.userId, here: park.members.size }, 'park: entered');
}

export function leavePark(userId: string): void {
  if (!park.members.has(userId)) return;
  park.leave(userId);
  sentLooks.delete(userId);
  log.info({ userId, here: park.members.size }, 'park: left');
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
export function tick(): void {
  for (const gone of park.sweep()) { sentLooks.delete(gone); log.info({ userId: gone }, 'park: timed out'); }
  for (const id of park.members.keys()) pushPeople(id);
}

let loop: ReturnType<typeof setInterval> | null = null;
export function startPark(): void {
  loop ??= setInterval(tick, 250);
  loop.unref();
}
export function stopPark(): void {
  if (loop) clearInterval(loop);
  loop = null;
}
