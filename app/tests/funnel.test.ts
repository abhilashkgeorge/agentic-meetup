/**
 * The founder's Numbers page: the five steps in order, counts only, reviewer only.
 *
 * WHY (build list item 10): "matches -> both yes -> first message -> date proposed ->
 * met (check-in), real users only." The server counts (server tests/funnel.test.ts);
 * this pins the page's reading of it and that only the reviewer's Settings opens it.
 *
 * Negative controls, run 2026-09-25:
 *   - funnelRows dropping the date step                 -> "in order" fails
 *   - the Numbers row outside the reviewer check         -> "reviewer only" fails
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { funnelRows, gapRows } from '../src/features/admin/funnel';

describe('Numbers', () => {
  it('lists the five steps in order, as counts', () => {
    const rows = funnelRows({
      people: 11, expired: 2,
      steps: [
        { step: 'matches', n: 9 }, { step: 'both_yes', n: 4 }, { step: 'first_message', n: 3 },
        { step: 'date_proposed', n: 1 }, { step: 'met', n: 1 },
      ],
    });
    expect(rows).toEqual([
      { label: 'Matches', n: 9 }, { label: 'Both said yes', n: 4 }, { label: 'First message', n: 3 },
      { label: 'Date proposed', n: 1 }, { label: 'Met', n: 1 },
    ]);
  });

  it("opens only from the reviewer's Settings", () => {
    const src = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'settings', 'settings-screen.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const gate = src.indexOf('{admin && (');
    const push = src.indexOf("router.push('/funnel')");
    expect(push, 'the Numbers row is gone').toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(-1);
    expect(push).toBeGreaterThan(gate);
    // Inside that block: nothing closes it between the gate and the push.
    expect(src.slice(gate, push)).not.toMatch(/\n\s{10}\)\}\n/);
  });
});

describe('wants with no question yet', () => {
  it('lists topics first, then wants two or more people share -- never one person\u2019s want', () => {
    const rows = gapRows({
      topics: [{ word: 'theatre', people: 3 }, { word: 'comedy', people: 1 }],
      wants: [{ want: 'enjoys theatre', people: 2 }, { want: null, people: 1 }],
    });
    expect(rows).toEqual([
      { title: 'theatre', value: '3 people' },
      { title: 'comedy', value: '1 person' },
      { title: '“enjoys theatre”', value: '2 people' },
    ]);
  });
});
