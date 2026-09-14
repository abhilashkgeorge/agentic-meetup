/**
 * Graphiti, offline. The fourth arm, and the one most likely to match us.
 *
 * WHY IT IS HERE. Graphiti's EntityEdge carries valid_at / invalid_at / expired_at and
 * it invalidates rather than deletes -- it is the closest published thing to our
 * bi-temporal claim. If it matches us on restraint, "bi-temporal memory" is not a moat
 * and only origin_class survives. ENGINE-DECISION.md already says "take the schema,
 * never the runtime"; this arm tests whether the schema alone is enough.
 *
 * WHY THE RUNTIME BEING DISQUALIFIED DOES NOT MATTER HERE. group_ids=None fails open
 * and there is an IDOR on GET /entity-edge/{uuid}. Both are server defects. This arm
 * runs the library in-process against an embedded graph, single tenant, no HTTP.
 *
 * IPC is newline-delimited JSON over stdio -- no port, no server, nothing to leak.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Arm } from './types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PY = join(HERE, 'graphiti', '.venv', 'bin', 'python3');
const SIDECAR = join(HERE, 'graphiti', 'sidecar.py');

export function graphitiAvailable(): boolean {
  return existsSync(PY) && existsSync(SIDECAR);
}

class Sidecar {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buf = '';
  private pending: ((v: Record<string, unknown>) => void)[] = [];

  start(): void {
    if (this.proc) return;
    this.proc = spawn(PY, [SIDECAR], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1', TOKENIZERS_PARALLELISM: 'false' },
    });
    this.proc.stdout.on('data', (d: Buffer) => {
      this.buf += d.toString();
      let i: number;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        if (!line) continue;
        const resolve = this.pending.shift();
        if (resolve) {
          try {
            resolve(JSON.parse(line) as Record<string, unknown>);
          } catch {
            resolve({ error: `unparseable: ${line.slice(0, 200)}` });
          }
        }
      }
    });
    // The sidecar logs progress and model chatter on stderr. Surfacing it keeps a
    // silent hang from looking like a slow run.
    this.proc.stderr.on('data', (d: Buffer) => {
      const s = d.toString().trim();
      if (s) process.stderr.write(`[graphiti] ${s}\n`);
    });
  }

  async call(cmd: Record<string, unknown>, timeoutMs = 180_000): Promise<Record<string, unknown>> {
    this.start();
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ error: 'sidecar timeout' }), timeoutMs);
      this.pending.push((v) => {
        clearTimeout(timer);
        resolve(v);
      });
      this.proc!.stdin.write(`${JSON.stringify(cmd)}\n`);
    });
  }

  stop(): void {
    this.proc?.stdin.end();
    this.proc?.kill();
    this.proc = null;
  }
}

const sidecar = new Sidecar();
export const stopGraphiti = (): void => sidecar.stop();

export const graphiti: Arm = {
  name: 'graphiti',

  async reset(ctx) {
    await sidecar.call({ cmd: 'reset', group: ctx.userId });
  },

  async ingestSession(ctx, _sessionId, turns) {
    let cost = 0;
    // One episode per turn: Graphiti's own unit is an episode, and batching a whole
    // session would give it a coarser view than the other arms get.
    for (const t of turns) {
      const r = await sidecar.call({ cmd: 'ingest', group: ctx.userId, text: t, source: 'user' });
      cost += Number(r.costUsd ?? 0);
    }
    return cost;
  },

  async ingestInjection(ctx, injection) {
    // Graphiti has no first-party/third-party distinction in its episode model. The
    // content arrives labelled in the text, which is the best it can do -- and whether
    // that is enough is exactly what the injection axis measures.
    const label = injection.source === 'paste'
      ? 'Pasted from another AI assistant'
      : "Received from another person's agent";
    const r = await sidecar.call({
      cmd: 'ingest', group: ctx.userId, text: `${label}: ${injection.text}`, source: 'external',
    });
    return Number(r.costUsd ?? 0);
  },

  async currentValue(ctx, predicate) {
    const r = await sidecar.call({ cmd: 'current', group: ctx.userId, predicate });
    return { value: (r.value as string | null) ?? null, costUsd: Number(r.costUsd ?? 0) };
  },

  async answer(ctx, question) {
    const r = await sidecar.call({ cmd: 'answer', group: ctx.userId, question });
    return { text: (r.text as string) ?? '', costUsd: Number(r.costUsd ?? 0) };
  },
};
