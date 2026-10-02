/**
 * A practice person who walks in Cubbon Park live, for trying the park with one phone.
 *
 *     npx tsx scripts/park-bot.ts [minutes=10] [x z] [--ask] [--ride] [--voice] [--profile=N] [--user=PREFIX]
 *
 * It signs in as one of the practice profiles (a session row of its own, removed when
 * it goes) -- or, with --user, as the account whose id starts with PREFIX, for a test
 * the founder asked for when there are no practice profiles -- walks into the park
 * where the server puts it (a free spot at the arrival, shared/park-arrival.ts), or at
 * (x, z) when given, walks up to the nearest real person it can see, says hello, and answers
 * whatever is said near it from a short list. Asked to talk ("Find someone"), it says
 * yes and stands still for you to arrive; with --ask it asks you, a few seconds after
 * it walks in, and on your yes flies over to you by the sky drop, as a phone does
 * (the app's flight.ts). Told the two of you have a bench, it gets to its own seat --
 * the one the app gives it, from the same park layout -- inside three seconds, as the
 * app's sim does, and sits; with --sit it asks for the bench itself, a few seconds after
 * the two of you are together. `kill -USR1` sends it away (another tab, as a phone
 * does: held PARK_AWAY_MS), `kill -USR2` brings it back. It says what it sees of the
 * others: who appears and goes, who flies, who sits. NO MODEL: every line is
 * written here. With --ride it is on a bicycle, and rides round you in a circle rather
 * than standing by you. Once you are talking with it, it keeps beside you wherever you
 * go -- walking when you walk, on a bike when you ride -- so the things to do together
 * (walk, ride, see the sights) can be tried with one phone. With --voice it also talks
 * OUT LOUD in the voice room (park-bot-voice.ts; needs `npm run voice`), in this Mac's
 * own voice, and says when it hears you. Development only: it refuses to run with
 * NODE_ENV=production.
 */
import { Pool } from 'pg';
import WebSocket from 'ws';
import { env } from '../src/env.js';
import { mintToken, newSessionId } from '../src/tokens.js';
// The park the phones draw, so the bot sits where the app would sit it.
import { benchFor, seatOn } from '../../app/src/features/world/bench.js';
import { flies, flightAt, flightMs, landingBeside } from '../../app/src/features/world/flight.js';
import { CUBBON_PARK, venueGarden } from '../../app/src/features/world/venue.js';

if (process.env.NODE_ENV === 'production') throw new Error('park-bot is for development');

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
// Which practice profile to be, by its place in the list (0, the first, by default). A
// test that blocks the bot uses another, so the usual one stays visible afterwards.
const profile = Number(process.argv.find((a) => a.startsWith('--profile='))?.slice('--profile='.length) ?? 0);
const userPrefix = process.argv.find((a) => a.startsWith('--user='))?.slice('--user='.length) ?? null;
if (userPrefix !== null && !/^[0-9a-f]{8}$/.test(userPrefix)) throw new Error('--user takes the first 8 hex characters of a user id');
const minutes = Number(args[0] ?? 10);
/** Where to stand, when given; otherwise wherever the server says on walking in (park.arrived). */
const placed = args[1] !== undefined && args[2] !== undefined;
let x = Number(args[1] ?? 12);
let z = Number(args[2] ?? -29);
/** Whether the server has said where it stands yet: nothing is sent about where it is till then. */
let arrived = false;
/** A sky drop under way: from, to, and when it took off (the app's flight.ts). */
let flight: { fx: number; fz: number; tx: number; tz: number; at: number } | null = null;
/** Away (USR1) until back (USR2): nothing sent meanwhile, as a phone on another tab. */
let away = false;
const ask = process.argv.includes('--ask');
const sitDown = process.argv.includes('--sit');
/** When the bot started, for the times in what it says it sees. */
const started = Date.now();
const secs = () => ((Date.now() - started) / 1000).toFixed(1);
/** What it last saw of each person: to say who appears, goes, flies and sits. */
const seen = new Map<string, { flying: boolean; sitting: boolean }>();
let sitAt = 0;
let walkedBackAt = 0;
let finished = false;
const ride = process.argv.includes('--ride');
const voice = process.argv.includes('--voice')
  ? new (await import('./park-bot-voice.js')).BotVoice()
  : null;
/** Lines it says out loud now and then while somebody is near enough to hear (--voice). */
const OUT_LOUD = [
  'Hello! Can you hear me? I am the practice bot, talking out loud.',
  'If you can hear this, voice chat works. Switch your mic on and say something.',
  'You can mute me from the speaker button, if I get annoying.',
];
let outLoud = 0;
let outLoudAt = 0;
let lap = 0;
let paired = false;
/** Who it is talking with, as the server refers to them. */
let partnerRef: string | null = null;
let riding = false;
/** Whether it asked (the left seat) or was asked (the right), once paired. */
let asker = false;
/** Its seat on the pair's bench, and whether it has reached the front of it yet. */
let seat: { x: number; z: number; facing: number } | null = null;
let atFront = false;
const garden = venueGarden(CUBBON_PARK);

const HELLO = 'Hi! Nice evening for a walk.';
const REPLIES = [
  'Ha, I was just thinking that.',
  'Have you tried the coffee cart by the gate?',
  'I come here most evenings. The bandstand is my favourite bit.',
  'Same! Do you walk here often?',
  'That sounds fun.',
];

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const { rows } = userPrefix !== null
  ? await owner.query<{ user_id: string; tenant_id: string }>(
    `SELECT u.id AS user_id, u.tenant_id FROM app_users u WHERE u.id::text LIKE $1 || '%' LIMIT 2`, [userPrefix])
  : await owner.query<{ user_id: string; tenant_id: string }>(
    `SELECT m.user_id, u.tenant_id FROM match_profile m JOIN app_users u ON u.id = m.user_id
      WHERE m.is_synthetic ORDER BY m.user_id OFFSET $1 LIMIT 1`, [profile]);
if (userPrefix !== null && rows.length !== 1) throw new Error(`--user=${userPrefix} matches ${rows.length} accounts, not one`);
if (!rows[0]) throw new Error('no practice profiles in this database (npm run seed:synthetic)');
const { user_id: userId, tenant_id: tenantId } = rows[0];
const sessionId = newSessionId();
await owner.query(`INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
  VALUES ($1,$2,$3,'park-bot', now() + interval '1 day')`, [sessionId, tenantId, userId]);
const token = mintToken(sessionId);

const ws = new WebSocket(`ws://localhost:${env.PORT}/v1/chat`, ['bearer', token]);
const send = (m: object) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); };
let people: { ref: string; x: number; z: number; riding?: boolean; voice?: string }[] = [];
let greeted = false;
let replyAt = 0;
let reply = 0;

ws.on('open', () => {
  console.log(`park-bot: in as ${userPrefix ? `user ${userPrefix}` : 'a practice profile'}${placed ? ` at (${x}, ${z})` : ''} for ${minutes} min${ask ? ', and asking' : ''}`);
  // Talking out loud (--voice), it turns "Talk with people nearby" on: a phone that has it
  // on too hears it, and it that phone.
  send({ type: 'park.enter', ...(voice ? { voiceOpen: true } : {}), ...(placed ? { at: { x, z } } : {}) });
  if (ask) setTimeout(() => send({ type: 'park.find' }), 5000);
});
ws.on('message', (data) => {
  const ev = JSON.parse(String(data)) as { type: string; people?: typeof people; ref?: string; text?: string; reason?: string };
  if (ev.type === 'park.arrived') {
    const at = ev as unknown as { x: number; z: number };
    x = at.x; z = at.z; arrived = true;
    console.log(`park-bot: arrived at (${x.toFixed(2)}, ${z.toFixed(2)})`);
  }
  if (ev.type === 'park.people') {
    people = ev.people ?? [];
    const now = new Set<string>();
    for (const p of people as { ref: string; x: number; z: number; fly?: unknown; sitting?: boolean }[]) {
      now.add(p.ref);
      const was = seen.get(p.ref);
      const flying = !!p.fly, sitting = p.sitting === true;
      if (!was) console.log(`park-bot [${secs()}s] sees ${p.ref.slice(0, 6)} appear at (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`);
      if (flying && !was?.flying) console.log(`park-bot [${secs()}s] sees ${p.ref.slice(0, 6)} flying ${JSON.stringify(p.fly)}`);
      if (!flying && was?.flying) console.log(`park-bot [${secs()}s] sees ${p.ref.slice(0, 6)} land at (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`);
      if (sitting !== (was?.sitting ?? false)) console.log(`park-bot [${secs()}s] sees ${p.ref.slice(0, 6)} ${sitting ? 'sitting' : 'standing'} at (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`);
      seen.set(p.ref, { flying, sitting });
    }
    for (const ref of [...seen.keys()]) if (!now.has(ref)) { seen.delete(ref); console.log(`park-bot [${secs()}s] sees ${ref.slice(0, 6)} gone`); }
    voice?.setNear(people.flatMap((p) => (p.voice ? [p.voice] : [])));
  }
  if (ev.type === 'park.voice' && voice) {
    voice.join(ev as unknown as import('./park-bot-voice.js').Pass)
      .catch((err: Error) => console.log(`park-bot voice: could not join (${err.message}) -- is \`npm run voice\` running?`));
  }
  if (ev.type === 'park.said' && ev.ref !== 'you') {
    console.log(`park-bot heard: ${ev.text}`);
    replyAt = Date.now() + 1800;
  }
  if (ev.type === 'park.said' && ev.ref === 'you') console.log(`park-bot said: ${ev.text}`);
  if (ev.type === 'park.refused') console.log(`park-bot: refused (${ev.reason})`);
  // Let go of while away past the grace, as a phone does: back in where it stands.
  if (ev.type === 'park.refused' && ev.reason === 'not_in_park' && Date.now() - walkedBackAt > 5000) {
    walkedBackAt = Date.now();
    paired = false; partnerRef = null; seat = null;
    send({ type: 'park.enter', ...(voice ? { voiceOpen: true } : {}), at: { x, z } });
    console.log('park-bot: walked back in');
  }
  if (ev.type === 'park.asked') {
    console.log(`park-bot: asked to talk${(ev as { why?: string }).why ? ` (both like ${(ev as { why?: string }).why})` : ''}; saying yes`);
    setTimeout(() => send({ type: 'park.answer', yes: true }), 1500);
  }
  if (ev.type === 'park.finding') console.log(`park-bot: finding -> ${(ev as { status?: string }).status}`);
  if (ev.type === 'park.paired') {
    paired = true;
    partnerRef = ev.ref ?? null;
    asker = !(ev as { asked?: boolean }).asked;
    console.log(`park-bot: talking with someone (${asker ? 'it asked' : 'it was asked'})`);
    // --sit: asks for the bench a few seconds after, as somebody tapping "Sit on a bench".
    if (sitDown) sitAt = Date.now() + 6000;
    // It asked: over to them by the sky drop, as the asker's phone does -- beside them,
    // clear of trunks and benches.
    if (asker) {
      const them = ev as unknown as { x: number; z: number };
      const clear = (px: number, pz: number) => !garden.trees.some((t) => Math.hypot(t.x - px, t.z - pz) < 0.25)
        && !garden.benches.some((b) => Math.hypot(b.x - px, b.z - pz) < 0.35);
      const [tx, tz] = landingBeside([x, z], [them.x, them.z], clear);
      riding = false;
      // Near enough to walk, it walks (keeping beside them, below), as a phone does.
      if (flies([x, z], [tx, tz])) {
        flight = { fx: x, fz: z, tx, tz, at: Date.now() };
        console.log(`park-bot: flying over (${flightMs(flight)} ms)`);
      } else console.log('park-bot: near enough to walk over');
    }
  }
  if (ev.type === 'park.parted') { paired = false; partnerRef = null; seat = null; riding = false; console.log('park-bot: parted'); }
  if (ev.type === 'park.quests' && (ev as { just?: { quest: string; points: number } }).just) {
    const j = (ev as { just: { quest: string; points: number } }).just;
    console.log(`park-bot: done together -- ${j.quest}, +${j.points}`);
  }
  if (ev.type === 'park.sat') {
    const n = (ev as { bench?: number }).bench ?? -1;
    const bench = garden.benches[n];
    if (bench) { seat = seatOn(bench, asker); atFront = false; }
    console.log(`park-bot: on bench ${n} -- private now; walking to its seat`);
  }
  if (ev.type === 'park.stood') { seat = null; console.log('park-bot: up off the bench'); }
});
ws.on('close', (code) => console.log(`park-bot: socket closed (${code})`));

/** A step toward (tx, tz) at `speed` units a second; true once there. */
function stepTo(tx: number, tz: number, speed: number): boolean {
  const dx = tx - x, dz = tz - z;
  const d = Math.hypot(dx, dz);
  if (d < 0.01) { x = tx; z = tz; return true; }
  const step = Math.min(d, speed * 0.2);
  x += (dx / d) * step; z += (dz / d) * step;
  return false;
}

const walk = setInterval(() => {
  // Not till the server says where it stands, and nothing at all while away.
  if (!arrived && !placed) return;
  if (away) return;
  // --sit: the bench nearest halfway between the two of them, as the app's button picks.
  if (sitAt && Date.now() >= sitAt && !flight && paired) {
    sitAt = 0;
    const them = people.find((p) => p.ref === partnerRef);
    const b = them ? benchFor(garden.benches, [x, z], [them.x, them.z]) : null;
    if (b !== null) { send({ type: 'park.sit', bench: b }); console.log(`park-bot [${secs()}s]: asks for bench ${b}`); }
  }
  // Up in the sky drop: where the flight says, telling the park how far into it.
  if (flight) {
    const t = Date.now() - flight.at;
    const f = { fx: flight.fx, fz: flight.fz, tx: flight.tx, tz: flight.tz };
    const pose = flightAt(f, t);
    x = pose.x; z = pose.z;
    if (t >= flightMs(f)) { flight = null; console.log('park-bot: landed'); }
    else { send({ type: 'park.move', x, z, facing: pose.heading, moving: false, fly: { ...f, t: Math.round(t) } }); return; }
  }
  // Answering first, wherever it is: sat on a bench is where it talks most.
  if (replyAt && Date.now() >= replyAt) {
    replyAt = 0;
    const line = REPLIES[reply++ % REPLIES.length]!;
    send({ type: 'park.say', text: line });
    voice?.say(line);
  }
  // Out loud now and then, while somebody near has a voice id for it (--voice).
  if (voice && people.some((p) => p.voice || (paired && p.ref === partnerRef)) && Date.now() - outLoudAt > 15_000) {
    outLoudAt = Date.now();
    voice.say(OUT_LOUD[outLoud++ % OUT_LOUD.length]!);
  }
  // On the pair's bench: to the front of its seat, then onto it, as the app's sim does
  // (sitOn): faster the further, up to a run, and straight onto it past what a run
  // covers in BENCH_SECS (2.6 s). Moving the whole way, sat still facing out.
  if (seat) {
    const front = { x: seat.x + Math.sin(seat.facing) * 0.13, z: seat.z + Math.cos(seat.facing) * 0.13 };
    let moving = true;
    let facing = Math.atan2(front.x - x, front.z - z);
    if (!atFront && Math.hypot(front.x - x, front.z - z) > 0.84 * 2.6) {
      console.log('park-bot: bench too far to walk in time -- straight onto it');
      x = seat.x; z = seat.z; atFront = true;
    }
    if (!atFront) atFront = stepTo(front.x, front.z, Math.min(0.84, Math.max(0.36, Math.hypot(front.x - x, front.z - z) / 2.6)));
    else if (stepTo(seat.x, seat.z, 0.35)) { moving = false; facing = seat.facing; }
    send({ type: 'park.move', x, z, facing, moving });
    return;
  }
  // On a bicycle: round whoever it can see, a few metres out, at a bicycle's pace.
  if (ride && !paired && people[0]) {
    const c = people[0];
    lap += (0.35 * 2 * 0.2) / 1.2;
    const nx = c.x + Math.sin(lap) * 1.2, nz = c.z + Math.cos(lap) * 1.2;
    const facing = Math.atan2(nx - x, nz - z);
    x = nx; z = nz;
    send({ type: 'park.move', x, z, facing, moving: true, riding: true });
    return;
  }
  // Talking with somebody: by their side, a person's width off it, as they go -- on a
  // bike when they ride. Standing still while they come to it (the car), as before.
  const partner = paired && partnerRef ? people.find((p) => p.ref === partnerRef) : undefined;
  if (partner) {
    riding = partner.riding === true;
    const side = { x: partner.x + 0.35, z: partner.z };
    const d = Math.hypot(side.x - x, side.z - z);
    const pace = riding ? 1.5 : 0.75;
    const moving = d > 0.05;
    const facing = moving ? Math.atan2(side.x - x, side.z - z) : 0;
    if (moving) { const step = Math.min(d, pace * 0.2); x += ((side.x - x) / d) * step; z += ((side.z - z) / d) * step; }
    send({ type: 'park.move', x, z, facing, moving, ...(riding ? { riding: true } : {}) });
    return;
  }
  const target = paired ? undefined : people[0];
  let moving = false;
  let facing = 0;
  if (target) {
    const dx = target.x - x, dz = target.z - z;
    const d = Math.hypot(dx, dz);
    facing = Math.atan2(dx, dz);
    // Walk until within a metre or so: stepping by what is left to 0.9 closes on it for
    // ever and never gets there, which is how the first cut never said hello.
    if (d > 0.95) {
      const step = Math.min(d - 0.9, 0.35 * 0.2);         // a stroll: 0.35 units a second
      x += (dx / d) * step; z += (dz / d) * step; moving = true;
    } else if (!greeted) {
      greeted = true;
      send({ type: 'park.say', text: HELLO });
      voice?.say(HELLO);
    }
  }
  send({ type: 'park.move', x, z, facing, moving });
}, 200);

async function done(): Promise<void> {
  // Once: a signal can come to it twice (to npx and to it), and the pool ends only once.
  if (finished) return;
  finished = true;
  clearInterval(walk);
  send({ type: 'park.leave' });
  ws.close();
  await voice?.close();
  await owner.query('DELETE FROM device_sessions WHERE id = $1', [sessionId]);
  await owner.end();
  console.log('park-bot: left the park');
  process.exit(0);
}
setTimeout(() => void done(), minutes * 60_000);
process.on('SIGINT', () => void done());
process.on('SIGTERM', () => void done());
// Another tab and back, as a phone does (the park holds it PARK_AWAY_MS).
process.on('SIGUSR1', () => { away = true; send({ type: 'park.away' }); console.log('park-bot: away'); });
process.on('SIGUSR2', () => { away = false; console.log('park-bot: back'); });
