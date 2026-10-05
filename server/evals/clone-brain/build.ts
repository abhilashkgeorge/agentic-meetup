/**
 * Write the test set to set.json, once.
 *
 *   npx tsx evals/clone-brain/build.ts            counts, and writes set.json if absent
 *   npx tsx evals/clone-brain/build.ts --force    rebuilds it (a new set: old baselines no longer compare)
 *   npx tsx evals/clone-brain/build.ts --show=12  prints a dozen situations as a model sees them
 *
 * No model, no database. Refuses to write a set that fails its own checks (set.ts problems).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { userMessage } from './contract.js';
import { buildSet, KINDS, problems, type EvalSet } from './set.js';
import { buildHard, HARD_KINDS, hardProblems } from './hard.js';

export const SET_PATH = (): string => process.env.CLONE_BRAIN_SET ?? join(import.meta.dirname, 'set.json');
/** The harder test (hard.ts), frozen the same way. */
export const HARD_PATH = (): string => process.env.CLONE_BRAIN_HARD ?? join(import.meta.dirname, 'set-hard.json');

export function readSet(path = SET_PATH()): EvalSet {
  return JSON.parse(readFileSync(path, 'utf8')) as EvalSet;
}

export function describe(set: EvalSet, kinds: readonly string[] = KINDS): string[] {
  const out: string[] = [];
  const by = (k: string) => set.situations.filter((s) => s.kind === k);
  out.push(`people      : ${set.people.length} (${['rich', 'practice', 'thin'].map((x) => `${set.people.filter((p) => p.source === x).length} ${x}`).join(', ')})`);
  out.push(`notes       : ${set.people.reduce((a, p) => a + p.notes.length, 0)}, of them ${['public', 'match_only', 'private'].map((x) => `${set.people.reduce((a, p) => a + p.notes.filter((n) => n.privacy === x).length, 0)} ${x}`).join(', ')}`);
  const turns = set.situations.reduce((n, s) => n + 1 + (s.turns?.length ?? 0), 0);
  out.push(`situations  : ${set.situations.length}${turns !== set.situations.length ? ` (${turns} model calls, counting every turn)` : ''}`);
  for (const k of kinds) {
    const xs = by(k);
    const acts = ['answer', 'dont_know', 'refuse'].map((a) => `${xs.filter((s) => s.expect === a).length} ${a}`).join(', ');
    out.push(`  ${k.padEnd(14)}${String(xs.length).padStart(4)}   ${acts}`);
  }
  const all = set.situations;
  out.push(`right move  : ${['answer', 'dont_know', 'refuse'].map((a) => `${all.filter((s) => s.expect === a).length} ${a}`).join(', ')}`);
  out.push(`held back   : ${all.filter((s) => s.held).length} where a note it may not say holds the answer`);
  out.push(`shared      : ${all.filter((s) => s.kind === 'shared').reduce((a, s) => a + (s.shared?.length ?? 0), 0)} real pairs, ${all.reduce((a, s) => a + (s.decoys?.length ?? 0), 0)} decoys`);
  return out;
}

async function main(args: readonly string[]): Promise<void> {
  const hard = args.includes('--hard');
  const set: EvalSet = hard ? buildHard() : buildSet();
  const bad = hard ? hardProblems(set) : problems(set);
  for (const line of describe(set, hard ? HARD_KINDS : KINDS)) console.log(line);
  const show = Number(args.find((a) => a.startsWith('--show='))?.slice(7) ?? 0);
  if (show) {
    const people = new Map(set.people.map((p) => [p.id, p]));
    const step = Math.max(1, Math.floor(set.situations.length / show));
    for (let i = 0; i < set.situations.length && i / step < show; i += step) {
      const s = set.situations[i]!;
      console.log(`\n── ${s.id}  expect ${s.expect}${s.accept ? ` (or ${s.accept.join(', ')})` : ''}${s.evidence ? `  evidence ${s.evidence.join(',')}` : ''}${s.held ? '  held' : ''}  -- ${s.why}`);
      console.log(userMessage(s, people.get(s.person)!).split('THE OTHER AGENT SAYS')[1]!.trim());
      if (s.traps?.length) console.log(`   traps: ${s.traps.join(', ')}`);
      if (s.shared) console.log(`   shared: ${JSON.stringify(s.shared)}  decoys: ${JSON.stringify(s.decoys ?? [])}`);
    }
  }
  if (bad.length) {
    console.log(`\n${bad.length} problems; nothing written:`);
    for (const b of bad.slice(0, 40)) console.log(`  ${b}`);
    process.exitCode = 1;
    return;
  }
  const path = hard ? HARD_PATH() : SET_PATH();
  if (existsSync(path) && !args.includes('--force')) {
    console.log(`\n${path} exists and is frozen. --force rebuilds it; every baseline scored on the old one stops comparing.`);
    return;
  }
  writeFileSync(path, `${JSON.stringify(set, null, 1)}\n`);
  console.log(`\nwrote ${path}`);
}

if (process.argv[1]?.endsWith('build.ts')) await main(process.argv.slice(2));
