/**
 * Scoring the want check against hand marks. Pure, except `runChecks`, which is the
 * one place the model is called -- and only when the caller was told to go.
 *
 * THE NUMBER (the founder, 2026-09-26): the per-want check has to agree with a person's
 * marks at least 90% of the time. Agreement is counted over the pairs a person marked:
 * the check's met / not met / unknown against theirs. It measures the check on SENTENCES
 * only -- a want tied to a tapped question is compared by code (want-questions.ts
 * checkAsked) and is right by construction, so it has no place in this number.
 */
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { TenantCtx } from '../../src/db/client.js';
import type { Want, WantStatus } from '../../src/matching/wants.js';
import type { EvalWant } from './pairs.js';

export type Mark = 'met' | 'not_met' | 'unknown';
export const MARKS: readonly Mark[] = ['met', 'not_met', 'unknown'];
export const TARGET = 0.9;

/** Where the marks live. A test points this elsewhere, so it never writes the real ones. */
export const labelsPath = (): string => process.env.WANT_LABELS_PATH ?? join(import.meta.dirname, 'labels.json');

/** The marks made so far, by pair id. A file that is missing or broken is no marks. */
export function readLabels(path = labelsPath()): Record<string, Mark> {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => MARKS.includes(v as Mark))) as Record<string, Mark>;
  } catch {
    return {};
  }
}

/** Write the marks whole, through a temporary file: a crash never leaves half a file. */
export function writeLabels(labels: Record<string, Mark>, path = labelsPath()): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(labels, null, 2)}\n`);
  renameSync(tmp, path);
}

interface Pair { id: string; want: EvalWant; sentence: string }

/** What a run would do: how many marked, and how many model calls (one per want). */
export function plan(pairs: readonly Pair[], labels: Readonly<Record<string, Mark>>) {
  const marked = pairs.filter((p) => labels[p.id]);
  const wants = new Map<string, Pair[]>();
  for (const p of marked) wants.set(p.want.id, [...(wants.get(p.want.id) ?? []), p]);
  // What goes in: the check's instructions, the want, and each sentence -- a rough
  // four characters to a token, and some fifty tokens out for each person.
  const INSTRUCTIONS_CHARS = 2400;
  const inputTokens = [...wants.values()].reduce((n, ps) =>
    n + Math.ceil((INSTRUCTIONS_CHARS + ps[0]!.want.text.length + ps.reduce((m, p) => m + p.sentence.length + 16, 0)) / 4), 0);
  return {
    pairs: pairs.length, marked: marked.length, unmarked: pairs.length - marked.length,
    calls: wants.size, inputTokens, outputTokens: marked.length * 50, byWant: wants,
  };
}

/** How far the check agreed with the marks. Pure. */
export function agreement(results: readonly { id: string; got: WantStatus }[], labels: Readonly<Record<string, Mark>>) {
  const confusion: Record<Mark, Record<string, number>> = { met: {}, not_met: {}, unknown: {} };
  const misses: { id: string; marked: Mark; got: WantStatus }[] = [];
  let n = 0;
  let agree = 0;
  for (const r of results) {
    const mark = labels[r.id];
    if (!mark) continue;
    n++;
    confusion[mark][r.got] = (confusion[mark][r.got] ?? 0) + 1;
    if (r.got === mark) agree++;
    else misses.push({ id: r.id, marked: mark, got: r.got });
  }
  return { n, agree, rate: n ? agree / n : null, confusion, misses, meetsTarget: n > 0 && agree / n >= TARGET };
}

/**
 * THE ONE PLACE THE MODEL IS CALLED: the real check, one call per want, each marked
 * sentence as one person's only sentence. The caller must have been told to go.
 */
export async function runChecks(
  ctx: TenantCtx,
  byWant: ReadonlyMap<string, readonly Pair[]>,
  check: (who: TenantCtx, wants: readonly Want[], people: readonly (readonly { text: string }[])[]) =>
    Promise<{ results: { status: WantStatus }[][]; costUsd: number } | null>,
): Promise<{ results: { id: string; got: WantStatus }[]; costUsd: number; failed: string[] }> {
  const results: { id: string; got: WantStatus }[] = [];
  const failed: string[] = [];
  let costUsd = 0;
  for (const [wantId, pairs] of byWant) {
    const w = pairs[0]!.want;
    const r = await check(ctx, [{ text: w.text, kind: w.kind, private: false }], pairs.map((p) => [{ text: p.sentence }]));
    if (!r) { failed.push(wantId); continue; }
    costUsd += r.costUsd;
    pairs.forEach((p, i) => results.push({ id: p.id, got: r.results[i]![0]!.status }));
  }
  return { results, costUsd, failed };
}
