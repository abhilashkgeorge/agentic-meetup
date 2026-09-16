import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { WebSocketServer } from 'ws';
import { attachChat } from './api/chat.js';
import { authRoutes, inviteRoutes } from './api/auth.js';
import { configRoutes } from './api/config.js';
import { chatImportRoutes, importRoutes } from './api/import.js';
import { meRoutes } from './api/me.js';
import { knowledgeRoutes, profileRoutes } from './api/profile.js';
import { selfTestRoutes } from './api/selftest.js';
import { tellRoutes } from './api/tell.js';
import { statsRoutes } from './api/stats.js';
import { datingRoutes } from './api/dating.js';
import { roundWorkerTick } from './matching/rounds.js';
import { interviewRoutes } from './api/interview.js';
import { messageRoutes } from './api/messages.js';
import { photoRoutes } from './api/photos.js';
import { resolveCtx, Unauthorized } from './auth.js';
import { close, pool } from './db/client.js';
import { env } from './env.js';
import { validateRouting } from './llm/index.js';
import { embeddingsAvailable } from './llm/embeddings.js';
import { adminRoutes, hasReviewer } from './api/admin.js';
import { consentRoutes } from './api/consent.js';
import { log } from './log.js';
import { LIMITS, callerIp, take } from './ratelimit.js';
import { SESSION_IDLE_MS, sweepOnce } from './memory/session.js';
import { consolidateAll } from './memory/consolidate.js';

// Fail at boot, not at 3am on an invoice: refuses to start on a routed model with
// an unverified price or one inside 90 days of retirement.
validateRouting();

const app = new Hono();

app.get('/health', async (c) => {
  await pool.query('SELECT 1');
  return c.json({ ok: true });
});
app.route('/', authRoutes);
app.route('/', inviteRoutes);
app.route('/', configRoutes);
app.route('/', importRoutes);
app.route('/', chatImportRoutes);
app.route('/', profileRoutes);
app.route('/', knowledgeRoutes);
app.route('/', selfTestRoutes);
app.route('/', tellRoutes);
app.route('/', statsRoutes);
app.route('/', datingRoutes);
app.route('/', interviewRoutes);
app.route('/', messageRoutes);
app.route('/', photoRoutes);
app.route('/', meRoutes);
app.route('/', adminRoutes);
app.route('/', consentRoutes);

// serve() builds the http.Server AND attaches Hono as its request listener, then
// returns it. Handing it a pre-made bare server instead leaves it with no request
// handler, so every HTTP request hangs open while the socket stays alive.
const server = serve({ fetch: app.fetch, port: env.PORT });

// WebSocket, not SSE: expo/fetch streaming still carries unshipped iOS fixes
// (empty body on a 200, dropped chunks, AbortSignal hangs), while React Native's
// WebSocket is built in and stable.
// The token rides in the Sec-WebSocket-Protocol header rather than the query string.
// A query string is written to every access log, proxy log and crash report between
// here and the client; a header is not. `bearer` is echoed back as the accepted
// subprotocol, and the second entry -- the credential -- is never named in a response.
const wss = new WebSocketServer({
  noServer: true,
  handleProtocols: (protocols) => (protocols.has('bearer') ? 'bearer' : false),
});

server.on('upgrade', (req, socket, head) => {
  if (!req.url?.startsWith('/v1/chat')) {
    socket.destroy();
    return;
  }

  // The same counter the HTTP routes use, because an upgrade is not a Hono request
  // and cannot run Hono middleware -- and a client stuck in a reconnect loop is the
  // honest failure this catches, well before anybody malicious turns up.
  // The peer address comes from the socket itself here, which is the one source a
  // client cannot write. See callerIp.
  const ip = callerIp(req.headers, socket.remoteAddress);
  if (!take(`socket:${ip}`, LIMITS.socket).ok) {
    log.warn({ ip }, 'socket upgrade rate limited');
    socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
    socket.destroy();
    return;
  }
  // Preference order, most private first. The query string is accepted only while
  // legacy credentials are, so the two holes close together rather than one
  // outliving the other.
  const offered = String(req.headers['sec-websocket-protocol'] ?? '')
    .split(',')
    .map((p: string) => p.trim())
    .filter(Boolean);
  const fromProtocol = offered[0] === 'bearer' ? offered[1] : undefined;
  const fromQuery = env.ALLOW_LEGACY_TOKENS
    ? (new URL(req.url, 'http://localhost').searchParams.get('token') ?? undefined)
    : undefined;
  const bearer = req.headers.authorization ?? fromProtocol ?? fromQuery;

  resolveCtx(bearer)
    .then((ctx) => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        log.info({ userId: ctx.userId }, 'chat connected');
        attachChat(ws, ctx);
      });
    })
    .catch((err: unknown) => {
      if (!(err instanceof Unauthorized)) log.error({ err }, 'upgrade failed');
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
    });
});

// P1 sweeper. Sessions end by the user putting the phone down far more often than
// by any explicit signal, so inactivity is the real trigger. In-process for now;
// this moves to a separate worker when there is more than one replica, because two
// replicas sweeping the same session would extract it twice.
const sweeper = setInterval(() => {
  void sweepOnce().catch((err: unknown) => log.error({ err }, 'sweep failed'));
}, Math.min(SESSION_IDLE_MS, 60_000));
sweeper.unref();

// Rounds. A tap on "send my agent out" writes a row; this drains them one at a time
// with no HTTP request waiting. In-process for the same reason as the sweeper above,
// and it becomes a separate worker at the same moment. See matching/rounds.ts.
const rounds = setInterval(() => {
  void roundWorkerTick().catch((err: unknown) => log.error({ err }, 'round worker failed'));
}, 5_000);
rounds.unref();


if (!embeddingsAvailable()) {
  log.warn(
    'No embeddings provider: episodic recall is FULL-TEXT ONLY and episodes are not ' +
      'embedded. Anthropic has no embeddings endpoint, so an all-Anthropic routing ' +
      'lands here. Set GEMINI_API_KEY (cheapest) or OPENAI_API_KEY. Chat works; ' +
      'recall is weaker, and the G0 RAG control is degraded.',
  );
}

// P5. Hourly check, but each user is only consolidated when they have spoken since
// the last pass, so this is cheap and idempotent. Moves to a real scheduler when
// there is more than one replica -- two replicas consolidating the same user would
// double-merge.
const consolidator = setInterval(() => {
  void consolidateAll().catch((err: unknown) => log.error({ err }, 'consolidation sweep failed'));
}, 60 * 60 * 1000);
consolidator.unref();

log.info({ port: env.PORT }, 'clone-agent server listening');

// Said at boot, every boot, because the failure is silent otherwise: reports pile up,
// nobody is configured to read them, and the first anybody hears about it is when
// somebody asks why their complaint went nowhere.
if (!hasReviewer()) {
  log.warn(
    'NOBODY CAN REVIEW REPORTS. Set ADMIN_USER_IDS to a comma-separated list of user '
    + 'ids, or the report button writes rows that no human being will ever read.',
  );
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    log.info('shutting down');
    clearInterval(sweeper);
    clearInterval(consolidator);
    wss.close();
    server.close(() => void close().then(() => process.exit(0)));
  });
}
