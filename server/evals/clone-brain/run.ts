/**
 * Run a model on the clone-brain set and score it.
 *
 *   npx tsx evals/clone-brain/run.ts                       what a run would send and cost. Sends nothing.
 *   npx tsx evals/clone-brain/run.ts --go                  runs today's model (the one the agents' talk uses)
 *   npx tsx evals/clone-brain/run.ts --go --model=anthropic:claude-sonnet-5
 *   npx tsx evals/clone-brain/run.ts --go --limit=20       a smoke run on the first 20
 *   npx tsx evals/clone-brain/run.ts --rescore=results/x.jsonl   scores saved replies again. Free.
 *
 * THE FOUNDER'S RULES. No model credits on anything but the app, unless he says so -- so
 * nothing is sent without --go. A run is capped: the eval account's daily cap is set to
 * --budget (default $3) before the first call, and the app's own meter (metering.ts)
 * refuses the call that would go over. Every call is metered like any other
 * (eval:clone-brain), under one eval account that is kept, so the spend stays on the
 * ledger. Replies are written to disk as they arrive: a crash never loses what was paid for.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { INSTRUCTIONS, INSTRUCTIONS_V2, Turn, userMessage, type Suggested } from './contract.js';
import { HARD_PATH, readSet } from './build.js';
import { HARD_KINDS } from './hard.js';
import {
  reward, scoreFree, scoreOne, stepsOf, summarize, summarizeHard, type HardSummary, type Summary, type Verdict,
} from './score.js';
import type { EvalSet, Situation } from './set.js';

/** Rough, and on the high side: English runs nearer four characters a token. */
const CHARS_PER_TOKEN = 3.5;
/** What a reply costs in tokens: the JSON and a sentence or two. */
const OUTPUT_TOKENS = 110;

export interface Plan { calls: number; inputTokens: number; outputTokens: number }

/**
 * WHAT A RUN SENDS. `v1` is the contract every baseline was scored on. The others are
 * the cheap fixes tried for shared things (2026-09-28): `v2` rewrites that one paragraph
 * of the instructions (contract.ts INSTRUCTIONS_V2); `pairs` adds pairs suggested by
 * meaning to each shared question (pairs.ts); `v2+pairs` does both.
 */
export const VARIANTS = ['v1', 'v2', 'pairs', 'v2+pairs'] as const;
export type Variant = (typeof VARIANTS)[number];
const instructionsOf = (v: Variant) => (v === 'v2' || v === 'v2+pairs' ? INSTRUCTIONS_V2 : INSTRUCTIONS);
const suggests = (v: Variant) => v === 'pairs' || v === 'v2+pairs';
/** About what a suggestion list adds to a shared question, for the estimate. */
const SUGGESTION_CHARS = 450;

/** What one earlier turn adds to every later one in a conversation: their message and the reply. */
const TURN_CHARS = 350;

export function plan(set: EvalSet, limit?: number, variant: Variant = 'v1', items?: readonly Situation[]): Plan {
  const people = new Map(set.people.map((p) => [p.id, p]));
  const todo = items ?? set.situations.slice(0, limit ?? set.situations.length);
  let calls = 0;
  const chars = todo.reduce((n, s) => {
    const steps = 1 + (s.turns?.length ?? 0);
    calls += steps;
    const one = instructionsOf(variant).length + userMessage(s, people.get(s.person)!).length
      + (suggests(variant) && s.kind === 'shared' ? SUGGESTION_CHARS : 0);
    return n + steps * one + TURN_CHARS * (steps * (steps - 1)) / 2;
  }, 0);
  return { calls, inputTokens: Math.ceil(chars / CHARS_PER_TOKEN), outputTokens: calls * OUTPUT_TOKENS };
}

const arg = (args: readonly string[], name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const pct = (x: number | null) => (x === null ? '-' : `${(x * 100).toFixed(1)}%`);

/** The report a person reads. Short: the four numbers first, then where they came from. */
export function report(sum: Summary, model: string, cost: number | null): string[] {
  const out: string[] = [];
  out.push(`model              : ${model}`);
  out.push(`situations         : ${sum.n}${sum.invalid ? `  (${sum.invalid} replies unreadable or failed)` : ''}`);
  out.push(`right behaviour    : ${sum.right.n}   ${pct(sum.right.rate)}`);
  out.push('');
  out.push(`1 made-up facts    : ${sum.madeUp.n} replies   ${pct(sum.madeUp.rate)}`);
  out.push(`2 "I don't know"   : said ${sum.dontKnow.said} of ${sum.dontKnow.expected} times it should   ${pct(sum.dontKnow.rate)};  wrongly ${sum.dontKnow.wrongly} of ${sum.dontKnow.answerable} answerable   ${pct(sum.dontKnow.wrongRate)}`);
  out.push(`3 leaks            : ${sum.leaks.n} replies   ${pct(sum.leaks.rate)}`);
  out.push(`4 shared things    : found ${sum.shared.found} of ${sum.shared.real} real   ${pct(sum.shared.recall)};  claimed ${sum.shared.invented} that are not   (precision ${pct(sum.shared.precision)}, ${sum.shared.decoys} decoys taken)`);
  out.push('');
  out.push(`refused            : ${sum.refusals.said} of ${sum.refusals.expected} it should   ${pct(sum.refusals.rate)};  refused ${sum.refusals.wrongly} fair questions`);
  out.push(`stretched          : ${sum.stretched} answered from a note that only touches the question`);
  out.push(`off topic          : ${sum.offTopic} answered from notes that do not answer it`);
  out.push(`added words        : ${sum.added.withAdded} of ${sum.added.answers} answers use words their notes do not have (read, not scored): ${sum.added.top.slice(0, 10).map(([w, n]) => `${w} ${n}`).join(', ')}`);
  out.push('');
  out.push('by kind            :     n  right  made-up  leaks');
  for (const [k, v] of Object.entries(sum.byKind)) {
    out.push(`  ${k.padEnd(17)}${String(v.n).padStart(5)}${String(v.right).padStart(7)}${String(v.madeUp).padStart(9)}${String(v.leaks).padStart(7)}`);
  }
  if (cost !== null) out.push(`\nspent              : $${cost.toFixed(4)}`);
  return out;
}

export interface Reply {
  id: string;
  ok: boolean;
  output?: unknown;
  error?: string;
  usage?: { inputTokens: number; outputTokens: number; reasoningTokens: number; costUsd: number; latencyMs: number; provider: string; modelId: string };
}

/** Score saved replies. Free: no model, no database. A conversation is scored turn by turn. */
export function scoreReplies(set: EvalSet, replies: readonly Reply[]): { verdicts: Verdict[]; summary: Summary; hard: HardSummary } {
  const people = new Map(set.people.map((p) => [p.id, p]));
  const steps = set.situations.flatMap(stepsOf);
  const byId = new Map(steps.map((s) => [s.id, s]));
  const verdicts = replies.filter((r) => byId.has(r.id)).map((r) => {
    const s = byId.get(r.id)!;
    const out = r.ok ? r.output : null;
    return s.free ? scoreFree(s, people.get(s.person)!, out) : scoreOne(s, people.get(s.person)!, out);
  });
  const scored = new Set(verdicts.map((v) => v.id));
  const kinds = set.situations.some((s) => HARD_KINDS.includes(s.kind)) ? HARD_KINDS : undefined;
  return {
    verdicts, summary: summarize(verdicts, steps.filter((s) => scored.has(s.id)), kinds), hard: summarizeHard(verdicts),
  };
}

/** What only the harder test reports. */
export function reportHard(h: HardSummary): string[] {
  const out: string[] = [];
  out.push(`conversations      : ${h.conversations.n}; no leak or invention in any turn: ${h.conversations.clean}; every turn right: ${h.conversations.allRight}`);
  const slips = Object.entries(h.conversations.firstSlip).sort().map(([k, v]) => `${k} ${v}`).join(', ');
  if (slips) out.push(`  first slip at     : ${slips}`);
  out.push(`overtaken notes    : ${h.stale} answers rested only on a note a later one took back`);
  out.push(`disagreements      : ${h.sided} answers took one side of notes that disagree`);
  out.push(`free talk          : ${h.free.pass} of ${h.free.n} pass the guard;  leaked ${h.free.leaks}, invented ${h.free.madeUp}, verdicts ${h.free.verdicts}, words no note has ${h.free.ungrounded}`);
  if (h.free.top.length) out.push(`  words no note has: ${h.free.top.map(([w, n]) => `${w} ${n}`).join(', ')}`);
  return out;
}

/**
 * Every reply the scorer flagged, with the question and the reply, for a person to read
 * before a number is reported -- the scorer is code, and code misreads. Plain text.
 */
export function flagsText(set: EvalSet, replies: readonly Reply[], verdicts: readonly Verdict[]): string {
  const people = new Map(set.people.map((p) => [p.id, p]));
  const byId = new Map(set.situations.flatMap(stepsOf).map((s) => [s.id, s]));
  const reply = new Map(replies.map((r) => [r.id, r]));
  const out: string[] = [];
  const groups: [string, (v: Verdict) => boolean][] = [
    ['MADE UP', (v) => v.madeUp.length > 0], ['LEAK', (v) => v.leaks.length > 0],
    ['STRETCHED', (v) => v.stretched], ['OFF TOPIC', (v) => v.offTopic],
    ['WRONG "I DON\'T KNOW" OR REFUSAL', (v) => v.dunno === 'wrongly' || v.refused === 'wrongly'],
    ['MISSED "I DON\'T KNOW" OR REFUSAL', (v) => v.dunno === 'missed' || v.refused === 'missed'],
    ['SHARED, NOT ALL FOUND', (v) => Boolean(v.shared && v.shared.found < v.shared.real)],
    ['ONE SIDE OF A DISAGREEMENT', (v) => Boolean(v.sided)],
    ['FREE TALK THE GUARD STOPS', (v) => Boolean(v.free && !v.free.pass)],
    ['UNREADABLE', (v) => v.act === 'invalid'],
  ];
  for (const [title, hit] of groups) {
    const vs = verdicts.filter(hit);
    out.push(`\n== ${title}: ${vs.length}`);
    for (const v of vs) {
      const s = byId.get(v.id)!;
      const p = people.get(s.person)!;
      const r = reply.get(v.id);
      const o = (r?.output ?? {}) as { notes?: number[]; reply?: string; shared?: unknown[] };
      out.push(`\n${v.id}  expect ${s.expect}${s.accept ? ` (or ${s.accept.join(', ')})` : ''}  got ${v.act}  cited ${(o.notes ?? []).map((n) => `${n}[${p.notes[n - 1]?.privacy ?? '?'}]`).join(',') || '-'}`);
      out.push(`  Q: ${s.says}`);
      out.push(`  A: ${o.reply ?? r?.error ?? ''}`);
      if (s.kind === 'shared') out.push(`  pairs ${JSON.stringify(o.shared ?? [])}  real ${JSON.stringify(s.shared ?? [])}  decoys ${JSON.stringify(s.decoys ?? [])}`);
      out.push(`  flags: ${[...v.madeUp, ...v.leaks].join(' ') || '-'}${v.free?.ungrounded.length ? `  words no note has: ${v.free.ungrounded.join(', ')}` : ''}`);
    }
  }
  return `${out.join('\n').trim()}\n`;
}

/**
 * The spend, from the provider's own token counts. Thinking tokens are billed as output;
 * the Gemini adapter does not add them to its cost, so they are added here -- a run is
 * never reported cheaper than it was.
 */
async function trueCost(replies: readonly Reply[]): Promise<number> {
  const { capabilities } = await import('../../src/llm/caps.js');
  let cost = 0;
  for (const r of replies) {
    if (!r.usage) continue;
    cost += r.usage.costUsd;
    if (r.usage.provider === 'google' && r.usage.reasoningTokens) {
      const caps = capabilities(`google:${r.usage.modelId}` as `google:${string}`);
      cost += (r.usage.reasoningTokens * caps.price.output) / 1_000_000;
    }
  }
  return cost;
}

async function send(set: EvalSet, model: string, items: readonly Situation[], budget: number, file: string, concurrency: number,
  out: (l: string) => void, variant: Variant = 'v1', suggested: ReadonlyMap<string, Suggested[]> = new Map()): Promise<Reply[]> {
  const { env } = await import('../../src/env.js');
  const { Pool } = await import('pg');
  const { metered, BudgetExceeded } = await import('../../src/metering.js');
  const { llm } = await import('../../src/llm/index.js');
  const { closeMatchPool, close } = await import('../../src/db/client.js');
  const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
  const people = new Map(set.people.map((p) => [p.id, p]));
  const replies: Reply[] = [];
  try {
    // ONE EVAL ACCOUNT, KEPT: deleting it would take its spend off the ledger.
    const name = '__eval_clone_brain__';
    let t = await owner.query<{ id: string }>('SELECT id FROM tenants WHERE name = $1 ORDER BY id LIMIT 1', [name]);
    if (!t.rows[0]) t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [name]);
    const tenantId = t.rows[0]!.id;
    let u = await owner.query<{ id: string }>('SELECT id FROM app_users WHERE tenant_id = $1 ORDER BY id LIMIT 1', [tenantId]);
    if (!u.rows[0]) u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id', [tenantId, 'clone-brain@eval.test']);
    const ctx = { tenantId, userId: u.rows[0]!.id };
    // The cap is the app's own: the meter refuses the call that would go over it.
    await owner.query(
      `INSERT INTO tenant_budget (tenant_id, user_id, day, turn_cap, daily_cost_cap)
       VALUES ($1,$2,CURRENT_DATE,100000,$3)
       ON CONFLICT (tenant_id, user_id, day) DO UPDATE SET turn_cap = 100000, daily_cost_cap = $3`,
      [tenantId, ctx.userId, budget]);

    const queue = [...items];
    let stop: string | null = null;
    type Msg = { role: 'user' | 'assistant'; content: string };
    const call = async (id: string, messages: Msg[]): Promise<Reply> => {
      for (let attempt = 1; ; attempt++) {
        try {
          const res = await metered(ctx, 'eval:clone-brain', () => llm.complete({
            task: 'extract', instructions: instructionsOf(variant), messages,
            tenantId: ctx.tenantId, userId: ctx.userId,
            outputSchema: Turn, outputSchemaName: 'clone_turn', maxOutputTokens: 600, thinking: false,
          }, model as never));
          const u = res.usage;
          return { id, ok: true, output: res.parsed,
            usage: { inputTokens: u.inputTokens + u.cachedReadTokens, outputTokens: u.outputTokens, reasoningTokens: u.reasoningTokens,
              costUsd: u.costUsd, latencyMs: u.latencyMs, provider: u.provider, modelId: u.modelId } };
        } catch (err) {
          if (err instanceof BudgetExceeded) { stop = err.message; return { id, ok: false, error: err.message }; }
          const msg = err instanceof Error ? err.message : String(err);
          if (attempt < 3 && /429|503|overload|RESOURCE_EXHAUSTED|UNAVAILABLE|ECONNRESET|timeout/i.test(msg)) {
            await new Promise((r) => setTimeout(r, 2000 * attempt));
            continue;
          }
          return { id, ok: false, error: msg.slice(0, 300) };
        }
      }
    };
    /**
     * One situation, or one conversation turn by turn: each later turn sees the model's
     * OWN earlier replies, as the other agent would. A failed turn ends the conversation.
     */
    const one = async (s: Situation): Promise<Reply[]> => {
      const p = people.get(s.person)!;
      if (!s.turns?.length) return [await call(s.id, [{ role: 'user', content: userMessage(s, p, suggested.get(s.id)) }])];
      const history: Msg[] = [];
      const got: Reply[] = [];
      const steps = [s, ...s.turns];
      for (let k = 0; k < steps.length; k++) {
        const content = k === 0 ? userMessage(s, p) : `THE OTHER AGENT SAYS\n${steps[k]!.says}`;
        const r = await call(`${s.id}#${k + 1}`, [...history, { role: 'user', content }]);
        got.push(r);
        if (!r.ok) break;
        history.push({ role: 'user', content }, { role: 'assistant', content: JSON.stringify(r.output) });
      }
      return got;
    };
    const worker = async () => {
      while (queue.length && !stop) {
        const s = queue.shift()!;
        for (const r of await one(s)) {
          if (stop && !r.ok) break;
          replies.push(r);
          appendFileSync(file, `${JSON.stringify(r)}\n`);
          if (replies.length % 50 === 0) out(`  ${replies.length} replies`);
        }
        // A run that fails from the start is a configuration problem, not data: stop paying.
        if (replies.length >= 8 && replies.slice(0, 8).every((x) => !x.ok)) stop = `the first 8 calls all failed: ${replies[0]!.error}`;
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    if (stop) out(`stopped: ${stop}`);
    return replies;
  } finally {
    await owner.end();
    await closeMatchPool();
    await close();
  }
}

export async function main(args: readonly string[], out: (l: string) => void = console.log): Promise<{ sent: boolean }> {
  const hard = arg(args, 'set') === 'hard';
  const set = readSet(hard ? HARD_PATH() : undefined);
  const dir = process.env.CLONE_BRAIN_RESULTS ?? join(import.meta.dirname, 'results');

  const rescore = arg(args, 'rescore');
  if (rescore) {
    const replies = readFileSync(rescore, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Reply);
    const { verdicts, summary, hard: h } = scoreReplies(set, replies);
    const used = replies.find((r) => r.usage)?.usage;
    const model = used ? `${used.provider}:${used.modelId}` : basename(rescore);
    const cost = await trueCost(replies);
    for (const l of report(summary, model, cost)) out(l);
    if (hard) for (const l of reportHard(h)) out(l);
    if (rescore.endsWith('.jsonl')) save(rescore, set, model, cost, replies, verdicts, summary);
    return { sent: false };
  }

  const { modelFor } = await import('../../src/llm/index.js');
  const { capabilities } = await import('../../src/llm/caps.js');
  const { computeCost } = await import('../../src/llm/port.js');
  const model = arg(args, 'model') ?? modelFor('extract');
  const caps = capabilities(model as never);
  const limit = arg(args, 'limit') ? Number(arg(args, 'limit')) : undefined;
  const budget = Number(arg(args, 'budget') ?? 3);
  const variant = (arg(args, 'variant') ?? 'v1') as Variant;
  if (!VARIANTS.includes(variant)) throw new Error(`--variant must be one of ${VARIANTS.join(', ')}`);
  const kinds = arg(args, 'kinds')?.split(',');
  const items = set.situations.filter((s) => !kinds || kinds.includes(s.kind)).slice(0, limit ?? set.situations.length);
  const p = plan(set, limit, variant, items);
  const estimate = computeCost(caps, { inputTokens: p.inputTokens, cachedReadTokens: 0, cacheWriteTokens: 0, outputTokens: p.outputTokens });

  out(`set              : ${set.situations.length} situations, ${set.people.length} people (built ${set.built})${kinds ? `; running only ${kinds.join(', ')}: ${items.length}` : ''}`);
  if (variant !== 'v1') out(`variant          : ${variant}${suggests(variant) ? '   (plus embeddings for the suggestions: about $0.002, unmetered like every embedding in the app)' : ''}`);
  out(`model            : ${model}${arg(args, 'model') ? '' : `   (today's: the agents' talk and answer sheets use modelFor('extract'); chat uses ${modelFor('chat')})`}`);
  out(`a run would make : ${p.calls} calls, about ${Math.round(p.inputTokens / 1000)}k tokens in and ${Math.round(p.outputTokens / 1000)}k out`);
  out(`estimated cost   : $${estimate.toFixed(2)}   (cap for the run: $${budget.toFixed(2)})`);
  if (!args.includes('--go')) {
    out('');
    out(`Nothing was sent. To run it:  npx tsx evals/clone-brain/run.ts ${hard ? '--set=hard ' : ''}--go`);
    return { sent: false };
  }

  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const tag = `${hard ? '-hard' : ''}${variant === 'v1' ? '' : `-${variant.replace('+', '-')}`}${kinds ? `-${kinds.join('-')}` : ''}`;
  const file = join(dir, `${stamp}-${model.replace(/[:/]/g, '_')}${tag}.jsonl`);
  writeFileSync(file, '');
  const concurrency = Number(arg(args, 'concurrency') ?? 4);
  const suggested = new Map<string, Suggested[]>();
  if (suggests(variant)) {
    const { embed } = await import('../../src/llm/embeddings.js');
    const { suggest } = await import('./pairs.js');
    const people = new Map(set.people.map((x) => [x.id, x]));
    const cache = new Map<string, number[]>();
    let chars = 0;
    for (const s of items) {
      if (s.kind !== 'shared' || !s.theirs) continue;
      const r = await suggest(people.get(s.person)!, s.theirs, cache, embed);
      suggested.set(s.id, r.suggested);
      chars += r.chars;
    }
    out(`suggested pairs  : ${[...suggested.values()].reduce((n, x) => n + x.length, 0)} for ${suggested.size} shared questions (${Math.round(chars / 4)} tokens embedded)`);
    writeFileSync(file.replace(/\.jsonl$/, '.suggested.json'), `${JSON.stringify(Object.fromEntries(suggested), null, 1)}\n`);
  }
  out(`\nsending to ${model}, ${concurrency} at a time; replies go to ${file}`);
  const replies = await send(set, model, items, budget, file, concurrency, out, variant, suggested);
  const { verdicts, summary, hard: h } = scoreReplies(set, replies);
  const cost = await trueCost(replies);
  out('');
  for (const l of report(summary, `${model}${variant === 'v1' ? '' : ` (${variant})`}`, cost)) out(l);
  if (hard) for (const l of reportHard(h)) out(l);
  save(file, set, `${model}${variant === 'v1' ? '' : ` (${variant})`}`, cost, replies, verdicts, summary);
  out(`report           : ${file.replace(/\.jsonl$/, '.json')}  (flagged replies to read: .flags.txt)`);
  return { sent: true };
}

/** The scored run beside its replies: numbers and verdicts (.json), and the flags to read (.flags.txt). */
function save(file: string, set: EvalSet, model: string, cost: number, replies: readonly Reply[],
  verdicts: readonly Verdict[], summary: Summary): void {
  writeFileSync(file.replace(/\.jsonl$/, '.json'), `${JSON.stringify({
    model, set: { built: set.built, situations: set.situations.length }, scored: new Date().toISOString(),
    costUsd: cost, summary, verdicts: verdicts.map((v) => ({ ...v, reward: reward(v) })),
  }, null, 1)}\n`);
  writeFileSync(file.replace(/\.jsonl$/, '.flags.txt'), flagsText(set, replies, verdicts));
}

// Run from the command line; imported by the test, it does nothing by itself.
if (process.argv[1]?.endsWith('run.ts')) {
  await main(process.argv.slice(2));
  process.exit(0);
}
