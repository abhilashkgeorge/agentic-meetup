/**
 * The want-check accuracy test: the set is sound, the scoring is right, and nothing is
 * sent to a model unless told to go.
 *
 * WHAT THE FOUNDER ASKED FOR (2026-09-26): a few hundred want/answer pairs marked by a
 * person; the check must agree with the marks at least 90% of the time -- and, his
 * choice, the tool is built but spends nothing until he says go.
 *
 * WHAT IS PINNED HERE:
 *   - the set: 300 pairs of invented sentences, every id unique, no want on a private
 *     topic (those skip sentences entirely) and no sentence the product would never let
 *     the check see -- so the number measures what the check actually does;
 *   - the marks file holds only real pair ids and real marks;
 *   - the plan counts one call per want, and agreement / the 90% line are computed right;
 *   - without --go the scorer sends nothing, and with nothing marked it refuses too;
 *   - the marking page words "could not be with" the other way round, refuses a mark
 *     that is not one, saves, and goes back one.
 *
 * The model is stubbed to throw: even a bug here could not spend.
 *
 * Negative controls, run by hand:
 *   - main() without the --go gate                   -> "sends nothing" fails
 *   - buttonsFor wording "not" wants like "wants"     -> "the other way round" fails
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const calls = vi.hoisted(() => ({ n: 0 }));
vi.mock('../src/llm/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/llm/index.js')>();
  return { ...real, decideModel: () => null,
    llm: { ...real.llm, complete: async () => { calls.n++; throw new Error('no model in this test'); },
           decide: async () => { throw new Error('no model'); } } };
});

// The page writes marks; this points it at a scratch file, never the real one.
const dir = mkdtempSync(join(tmpdir(), 'want-labels-'));
process.env.WANT_LABELS_PATH = join(dir, 'labels.json');
process.env.WANT_RESULTS_DIR = join(dir, 'results');
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.WANT_LABELS_PATH;
  delete process.env.WANT_RESULTS_DIR;
});

const { EVAL_PAIRS, EVAL_WANTS } = await import('../evals/wants/pairs.js');
const { agreement, plan, readLabels, TARGET } = await import('../evals/wants/accuracy.js');
const { main } = await import('../evals/wants/score.js');
const { buttonsFor, labelApp } = await import('../evals/wants/label.js');
const { mayRepeat, namesCoreValue } = await import('../src/matching/brief.js');

describe('the set', () => {
  it('is 300 invented pairs the check would really see', () => {
    expect(EVAL_PAIRS).toHaveLength(300);
    expect(new Set(EVAL_PAIRS.map((p) => p.id)).size).toBe(300);
    expect(EVAL_WANTS.filter((w) => w.kind === 'wants')).toHaveLength(20);
    expect(EVAL_WANTS.filter((w) => w.kind === 'not')).toHaveLength(10);
    for (const w of EVAL_WANTS) expect(namesCoreValue(w.text), `${w.id} is a private topic`).toBe(false);
    for (const p of EVAL_PAIRS) expect(mayRepeat(p.sentence), `${p.id} would never reach the check`).toBe(true);
  });

  it('keeps only real pair ids and real marks in the committed marks file', () => {
    const real = readLabels(join(import.meta.dirname, '..', 'evals', 'wants', 'labels.json'));
    const ids = new Set(EVAL_PAIRS.map((p) => p.id));
    for (const [id, mark] of Object.entries(real)) {
      expect(ids.has(id), id).toBe(true);
      expect(['met', 'not_met', 'unknown']).toContain(mark);
    }
  });
});

describe('scoring', () => {
  it('plans one call per marked want, and scores agreement against the 90% line', () => {
    const labels = { 'w01-s01': 'met', 'w01-s03': 'not_met', 'n01-s01': 'not_met' } as const;
    const p = plan(EVAL_PAIRS, labels);
    expect([p.marked, p.unmarked, p.calls]).toEqual([3, 297, 2]);
    const s = agreement([{ id: 'w01-s01', got: 'met' }, { id: 'w01-s03', got: 'unknown' }, { id: 'n01-s01', got: 'not_met' }], labels);
    expect(s).toMatchObject({ n: 3, agree: 2, meetsTarget: false });
    expect(s.misses).toEqual([{ id: 'w01-s03', marked: 'not_met', got: 'unknown' }]);
    expect(s.confusion.not_met).toEqual({ unknown: 1, not_met: 1 });
    expect(TARGET).toBe(0.9);
    const all = agreement(Array.from({ length: 10 }, (_, i) => ({ id: EVAL_PAIRS[i]!.id, got: i < 9 ? 'met' as const : 'unknown' as const })),
      Object.fromEntries(EVAL_PAIRS.slice(0, 10).map((x) => [x.id, 'met'])));
    expect(all.meetsTarget).toBe(true); // 9 of 10 is 90%: on the line counts
  });

  it('sends nothing without --go, and refuses with nothing marked', async () => {
    const lines: string[] = [];
    const dry = await main([], (l) => lines.push(l), { 'w01-s01': 'met' });
    expect(dry.sent).toBe(false);
    expect(lines.join('\n')).toMatch(/Nothing was sent/);
    const none = await main(['--go'], () => {}, {});
    expect(none.sent).toBe(false);
    expect(calls.n, 'a model was called').toBe(0);
  });
});

describe('the marking page', () => {
  it('words "could not be with" the other way round', () => {
    expect(buttonsFor('wants').map((b) => b.mark)).toEqual(['met', 'not_met', 'unknown']);
    expect(buttonsFor('not')[0]!.label).toMatch(/not like that/);
    expect(buttonsFor('not')[1]!.label).toMatch(/ARE like that/);
  });

  it('shows the next pair, refuses a mark that is not one, saves, and goes back one', async () => {
    const first = EVAL_PAIRS[0]!;
    expect(await (await labelApp.request('/')).text()).toContain(first.want.text);
    expect((await labelApp.request('/label', { method: 'POST', body: JSON.stringify({ id: first.id, label: 'maybe' }) })).status).toBe(400);
    expect((await labelApp.request('/label', { method: 'POST', body: JSON.stringify({ id: 'nope', label: 'met' }) })).status).toBe(400);
    expect((await labelApp.request('/label', { method: 'POST', body: JSON.stringify({ id: first.id, label: 'met' }) })).status).toBe(200);
    expect(JSON.parse(readFileSync(process.env.WANT_LABELS_PATH!, 'utf8'))).toEqual({ [first.id]: 'met' });
    expect(await (await labelApp.request('/')).text()).toContain(EVAL_PAIRS[1]!.sentence.replace(/’/g, '’'));
    await labelApp.request('/back', { method: 'POST' });
    expect(JSON.parse(readFileSync(process.env.WANT_LABELS_PATH!, 'utf8'))).toEqual({});
  });
});
