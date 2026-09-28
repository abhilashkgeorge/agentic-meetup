/**
 * docs/END-TO-END.md stays true to the code it cites.
 *
 * WHAT THE FOUNDER ASKED FOR (2026-09-28): "update the doc whenever a change affecting the
 * doc is made so that we don't have to recreate the doc every time we need an updated doc."
 *
 * The doc is built from docs/end-to-end/*.md, where every citation carries the text of the
 * line it cites. This runs the build in --check mode, which changes nothing:
 *   - a citation whose text is no longer in the file fails it -- the sentence beside it may
 *     no longer be true, so a person has to reread the code and rewrite it;
 *   - a doc not rebuilt after cited lines moved fails it, with "Run: npm run docs", which
 *     corrects the line numbers by itself.
 *
 * Negative controls, run 2026-09-28, each restored byte-identical:
 *   - one cited line's text changed in the code      -> fails, naming the citation
 *   - a blank line added above cited lines, no rebuild -> fails with "out of date"
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');

describe('docs/END-TO-END.md', () => {
  it('cites only lines that still say what it quotes, and was rebuilt after the code moved', () => {
    const r = spawnSync(process.execPath, [join(ROOT, 'docs', 'end-to-end', 'build.mjs'), '--check'],
      { encoding: 'utf8', cwd: ROOT });
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
  });
});
