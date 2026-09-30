/**
 * The people list is grouped the way the map is drawn: your neighbourhood first, the
 * nearest next, people you met before strangers inside each, and no neighbourhood
 * means the central tile.
 */
import { describe, expect, it } from 'vitest';
import { lookFor } from '@clone/shared';
import type { WorldAgent } from '../src/lib/api';
import { YOU } from '../src/features/world/bridge';
import { areaName, cityTitle } from '../src/features/world/map';
import { peopleRows } from '../src/features/world/people';

const agent = (ref: string, area: string | undefined, kind: WorldAgent['kind'] = 'stranger', name?: string): WorldAgent =>
  ({ ref, kind, practice: kind === 'practice', seed: 1, state: kind === 'met' ? 'briefed' : 'idle', look: lookFor(1), ...(area ? { area } : {}), ...(name ? { name } : {}) });

describe('peopleRows', () => {
  it('lists you, then your neighbourhood, then the rest nearest first, met before strangers', () => {
    const rows = peopleRows([
      agent('w', 'whitefield'), agent('k1', 'koramangala'), agent('h', 'hsr-layout', 'met', 'Priya'),
      agent('k2', 'koramangala', 'met', 'Arjun'), agent('none', undefined), agent('p', 'hsr-layout', 'practice'),
    ], 'koramangala');
    expect(rows.map((r) => (r.kind === 'header' ? `# ${r.title}` : r.ref))).toEqual([
      YOU,
      '# Koramangala · yours', 'k2', 'k1',
      '# HSR Layout', 'h', 'p',          // 3 km away, before...
      '# MG Road', 'none',               // ...the centre (no area), before...
      '# Whitefield', 'w',               // ...the far east.
    ]);
    expect(rows.find((r) => r.kind === 'row' && r.ref === 'k2')).toMatchObject({ title: 'Arjun', subtitle: 'Your agent met them' });
    expect(rows.find((r) => r.kind === 'row' && r.ref === 'p')).toMatchObject({ title: 'Practice match', subtitle: 'Not a real person' });
  });

  // The founder, 2026-09-30: the list said "Practice match / Not a real person" on every
  // row, with nothing to tell them apart. Each row carries the character the map draws.
  // Negative controls, run by hand and recorded in the commit: rows without `look` ->
  // this fails; the sheet's list without flexShrink -> "keeps Close on screen" fails.
  it('gives every row the character the map draws, yours beside "Your agent"', () => {
    const mine = lookFor(7);
    const rows = peopleRows([agent('p1', 'koramangala', 'practice'), { ...agent('p2', 'koramangala', 'practice'), look: lookFor(3) }], 'koramangala', mine);
    const row = (ref: string) => rows.find((r) => r.kind === 'row' && r.ref === ref) as { look?: unknown };
    expect(row(YOU).look).toEqual(mine);
    expect(row('p1').look).toEqual(lookFor(1));
    expect(row('p2').look).toEqual(lookFor(3));
  });

  // Both links of the chain: the panel shrinks to the sheet's 70%, and the list inside the
  // panel. With the list alone (the first fix, be3de79) this passed while the panel still
  // grew past 70% and Close sat under the tab bar -- seen on the Pixel, not in the test.
  // Negative control, run by hand: the panel without flexShrink -> this fails.
  it('keeps Close on screen: the panel and the list both give way inside the sheet', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const sheet = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'world', 'people-sheet.tsx'), 'utf8');
    expect(sheet).toMatch(/maxHeight: '70%' \}\}>\s*(\{\/\*[\s\S]*?\*\/\}\s*)?<Surface radius=\{radius\.xl\} style=\{\{ flexShrink: 1,/);
    expect(sheet).toMatch(/<FlatList\s+style=\{\{ flexShrink: 1 \}\}/);
    expect(sheet).toMatch(/left=\{item\.look \? <CharacterAvatar look=\{item\.look\} size=\{40\} \/> : undefined\}/);
  });

  it('puts you in the central tile when you have not said', () => {
    const rows = peopleRows([agent('a', 'hebbal'), agent('b', undefined)], null);
    expect(rows.map((r) => (r.kind === 'header' ? `# ${r.title}` : r.ref))).toEqual([YOU, '# MG Road · yours', 'b', '# Hebbal', 'a']);
    expect(areaName(null)).toBe('MG Road');
    expect(areaName('hsr-layout')).toBe('HSR Layout');
  });

  it('names the city', () => {
    expect(cityTitle('Bangalore')).toBe('Bengaluru');
    expect(cityTitle('Bengaluru')).toBe('Bengaluru');
    expect(cityTitle('Mumbai')).toBe('Mumbai square');
    expect(cityTitle(null)).toBe('The square');
  });
});

describe('placeLabels', () => {
  it('lets the bigger tile keep its name and silences a neighbour that would cross it', async () => {
    const { placeLabels } = await import('../src/features/world/camera');
    const out = placeLabels([
      { name: 'SMALL', radius: 2, at: [100, 100] },
      { name: 'BIG', radius: 9, at: [110, 104] },
      { name: 'FAR AWAY', radius: 1, at: [400, 400] },
    ]);
    expect(out.map((l) => l.name)).toEqual(['BIG', 'FAR AWAY']);
  });
});
