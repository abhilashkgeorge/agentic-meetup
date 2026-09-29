/**
 * A practice person who walks in Cubbon Park live, for trying the park with one phone.
 *
 *     npx tsx scripts/park-bot.ts [minutes=10] [x=12] [z=-29] [--ask] [--ride] [--voice] [--profile=N]
 *
 * It signs in as one of the practice profiles (a session row of its own, removed when
 * it goes), walks into the park at (x, z) -- by default a few steps from where you
 * arrive -- walks up to the nearest real person it can see, says hello, and answers
 * whatever is said near it from a short list. Asked to talk ("Find someone"), it says
 * yes and stands still for you to arrive; with --ask it asks you, a few seconds after
 * it walks in. Told the two of you have a bench, it walks to its own seat -- the one
 * the app gives it, from the same park layout -- and sits. NO MODEL: every line is
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
import { seatOn } from '../../app/src/features/world/ride.js';
import { CUBBON_PARK, venueGarden } from '../../app/src/features/world/venue.js';

if (process.env.NODE_ENV === 'production') throw new Error('park-bot is for development');

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
// Which practice profile to be, by its place in the list (0, the first, by default). A
// test that blocks the bot uses another, so the usual one stays visible afterwards.
const profile = Number(process.argv.find((a) => a.startsWith('--profile='))?.slice('--profile='.length) ?? 0);
const minutes = Number(args[0] ?? 10);
let x = Number(args[1] ?? 12);
let z = Number(args[2] ?? -29);
const ask = process.argv.includes('--ask');
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
const { rows } = await owner.query<{ user_id: string; tenant_id: string }>(
  `SELECT m.user_id, u.tenant_id FROM match_profile m JOIN app_users u ON u.id = m.user_id
    WHERE m.is_synthetic ORDER BY m.user_id OFFSET $1 LIMIT 1`, [profile]);
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
  console.log(`park-bot: in as a practice profile at (${x}, ${z}) for ${minutes} min${ask ? ', and asking' : ''}`);
  // Talking out loud (--voice), it turns "Talk with people nearby" on: a phone that has it
  // on too hears it, and it that phone.
  send({ type: 'park.enter', ...(voice ? { voiceOpen: true } : {}) });
  send({ type: 'park.move', x, z, facing: 0, moving: false });
  if (ask) setTimeout(() => send({ type: 'park.find' }), 5000);
});
ws.on('message', (data) => {
  const ev = JSON.parse(String(data)) as { type: string; people?: typeof people; ref?: string; text?: string; reason?: string };
  if (ev.type === 'park.people') {
    people = ev.people ?? [];
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
  // On the pair's bench: to the front of its seat at a brisk walk, then onto it, as
  // the app's sim does (sitOn), and sat still facing out.
  if (seat) {
    const front = { x: seat.x + Math.sin(seat.facing) * 0.13, z: seat.z + Math.cos(seat.facing) * 0.13 };
    let moving = true;
    let facing = Math.atan2(front.x - x, front.z - z);
    if (!atFront) atFront = stepTo(front.x, front.z, 0.35 * 1.8);
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
