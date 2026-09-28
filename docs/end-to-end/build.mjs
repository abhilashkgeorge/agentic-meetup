#!/usr/bin/env node
/**
 * Builds docs/END-TO-END.md from the parts in this folder, and keeps its citations honest.
 *
 *   npm run docs            fix shifted line numbers in the parts, then write the doc
 *   npm run docs -- --check change nothing; fail if a citation is broken or the doc is stale
 *
 * A part cites code as  [path:LINE] `text copied from that line`.  The copied text is what
 * makes a citation checkable: it must still be on that line. When the code above it moves,
 * the text is found a few lines away (or elsewhere in the file) and the line number is
 * corrected here. When the text is gone, the claim may no longer be true: the build stops
 * and names it, and a person rereads the code and rewrites the sentence.
 *
 * In the built doc a citation is just `path:LINE`; the copied text stays in the parts.
 * {AI:name} becomes a link to that model call's entry in section 12.
 *
 * server/tests/end-to-end-doc.test.ts runs the --check mode, so a change that makes the doc
 * wrong or stale fails the server suite until someone runs `npm run docs`.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(ROOT, 'docs', 'END-TO-END.md');

const AI = {
  extract: 1, selftest: 2, dealbreaker: 3, paste: 4, voice: 5, chat: 6, embed: 7, resolve: 8,
  profile: 9, sheet: 10, talk: 11, wants: 12, converse: 13, decide: 14, face: 15,
};
const CITE = /\[([A-Za-z0-9_./()[\]@+-]+?\.[A-Za-z0-9]+):(\d+)\]\s*`([^`]+)`/g;
const squash = (s) => s.replace(/\s+/g, ' ').trim();

const cache = new Map();
function linesOf(path) {
  if (!cache.has(path)) {
    const full = join(ROOT, path);
    cache.set(path, existsSync(full) ? readFileSync(full, 'utf8').split('\n') : null);
  }
  return cache.get(path);
}

/** Where the text really is now: the cited line, a nearby one, or the closest anywhere. */
function locate(path, line, text) {
  const ls = linesOf(path);
  if (!ls) return { status: 'nofile' };
  const i = line - 1;
  if (ls[i]?.includes(text)) return { status: 'ok', line };
  const hits = [];
  ls.forEach((l, k) => { if (l.includes(text)) hits.push(k + 1); });
  if (!hits.length) {
    const want = squash(text);
    ls.forEach((l, k) => { if (want && squash(l).includes(want)) hits.push(k + 1); });
  }
  if (!hits.length) return { status: 'missing' };
  const best = hits.reduce((a, b) => (Math.abs(b - line) < Math.abs(a - line) ? b : a));
  return { status: 'moved', line: best };
}

export function build({ check = false } = {}) {
  const parts = readdirSync(HERE).filter((f) => /^\d\d-.*\.md$/.test(f)).sort();
  const broken = [];
  const moved = [];
  const fixed = [];
  for (const part of parts) {
    const file = join(HERE, part);
    const src = readFileSync(file, 'utf8');
    const out = src.replace(CITE, (whole, path, line, text) => {
      const at = locate(path, Number(line), text);
      if (at.status === 'ok') return whole;
      if (at.status === 'moved') {
        moved.push(`${part}: ${path}:${line} -> ${at.line}`);
        return `[${path}:${at.line}] \`${text}\``;
      }
      broken.push(`${part}: ${path}:${line} ${at.status === 'nofile' ? '(no such file)' : 'text is gone'}: \`${text.slice(0, 80)}\``);
      return whole;
    });
    fixed.push([file, src, out]);
  }
  if (broken.length) return { ok: false, broken, moved };

  if (!check) for (const [file, src, out] of fixed) if (out !== src) writeFileSync(file, out);

  const sources = fixed.map(([, , out]) => out.trim());
  let citations = 0;
  let doc = sources.join('\n\n---\n\n') + '\n';
  doc = doc.replace(CITE, (_, path, line) => { citations += 1; return `\`${path}:${line}\``; });
  doc = doc.replace(/\{AI:([a-z]+)\}/g, (_, name) => {
    if (!(name in AI)) throw new Error(`unknown model-call name {AI:${name}}`);
    return `[AI-${AI[name]}](#ai-${AI[name]})`;
  });
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  const stale = moved.length > 0 || doc !== current;
  if (!check) writeFileSync(OUT, doc);
  return { ok: true, broken, moved, stale, citations, parts: parts.length, words: doc.split(/\s+/).length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes('--check');
  const r = build({ check });
  if (!r.ok) {
    console.error(`${r.broken.length} citation(s) no longer match the code. Reread the code and fix these sentences:`);
    for (const b of r.broken) console.error(`  ${b}`);
    process.exit(1);
  }
  if (check) {
    if (r.stale) {
      console.error('docs/END-TO-END.md is out of date with the code. Run: npm run docs');
      for (const m of r.moved.slice(0, 20)) console.error(`  moved ${m}`);
      process.exit(1);
    }
    console.log(`docs/END-TO-END.md is current: ${r.citations} citations checked.`);
  } else {
    for (const m of r.moved) console.log(`  moved ${m}`);
    console.log(`docs/END-TO-END.md written: ${r.parts} parts, ${r.citations} citations, ${r.words} words.`);
  }
}
