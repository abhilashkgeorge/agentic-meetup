/**
 * A practice person who walks in Cubbon Park live, for trying the park with one phone.
 *
 *     npx tsx scripts/park-bot.ts [minutes=10] [x=12] [z=-29] [--ask]
 *
 * It signs in as one of the practice profiles (a session row of its own, removed when
 * it goes), walks into the park at (x, z) -- by default a few steps from where you
 * arrive -- walks up to the nearest real person it can see, says hello, and answers
 * whatever is said near it from a short list. Asked to talk ("Find someone"), it says
 * yes and stands still for you to arrive; with --ask it asks you, a few seconds after
 * it walks in. NO MODEL: every line is written here. Development only: it refuses to
 * run with NODE_ENV=production.
 */
import { Pool } from 'pg';
import WebSocket from 'ws';
import { env } from '../src/env.js';
import { mintToken, newSessionId } from '../src/tokens.js';

if (process.env.NODE_ENV === 'production') throw new Error('park-bot is for development');

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const minutes = Number(args[0] ?? 10);
let x = Number(args[1] ?? 12);
let z = Number(args[2] ?? -29);
const ask = process.argv.includes('--ask');
let paired = false;

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
    WHERE m.is_synthetic ORDER BY m.user_id LIMIT 1`);
if (!rows[0]) throw new Error('no practice profiles in this database (npm run seed:synthetic)');
const { user_id: userId, tenant_id: tenantId } = rows[0];
const sessionId = newSessionId();
await owner.query(`INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
  VALUES ($1,$2,$3,'park-bot', now() + interval '1 day')`, [sessionId, tenantId, userId]);
const token = mintToken(sessionId);

const ws = new WebSocket(`ws://localhost:${env.PORT}/v1/chat`, ['bearer', token]);
const send = (m: object) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); };
let people: { ref: string; x: number; z: number }[] = [];
let greeted = false;
let replyAt = 0;
let reply = 0;

ws.on('open', () => {
  console.log(`park-bot: in as a practice profile at (${x}, ${z}) for ${minutes} min${ask ? ', and asking' : ''}`);
  send({ type: 'park.enter' });
  send({ type: 'park.move', x, z, facing: 0, moving: false });
  if (ask) setTimeout(() => send({ type: 'park.find' }), 5000);
});
ws.on('message', (data) => {
  const ev = JSON.parse(String(data)) as { type: string; people?: { ref: string; x: number; z: number }[]; ref?: string; text?: string; reason?: string };
  if (ev.type === 'park.people') people = ev.people ?? [];
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
  if (ev.type === 'park.paired') { paired = true; console.log('park-bot: talking with someone'); }
  if (ev.type === 'park.parted') { paired = false; console.log('park-bot: parted'); }
  if (ev.type === 'park.sat') console.log(`park-bot: on bench ${(ev as { bench?: number }).bench} -- private now`);
  if (ev.type === 'park.stood') console.log('park-bot: up off the bench');
});
ws.on('close', (code) => console.log(`park-bot: socket closed (${code})`));

const walk = setInterval(() => {
  // Talking with somebody: stand still, they come to it.
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
    }
  }
  send({ type: 'park.move', x, z, facing, moving });
  if (replyAt && Date.now() >= replyAt) {
    replyAt = 0;
    send({ type: 'park.say', text: REPLIES[reply++ % REPLIES.length] });
  }
}, 200);

async function done(): Promise<void> {
  clearInterval(walk);
  send({ type: 'park.leave' });
  ws.close();
  await owner.query('DELETE FROM device_sessions WHERE id = $1', [sessionId]);
  await owner.end();
  console.log('park-bot: left the park');
  process.exit(0);
}
setTimeout(() => void done(), minutes * 60_000);
process.on('SIGINT', () => void done());
process.on('SIGTERM', () => void done());
