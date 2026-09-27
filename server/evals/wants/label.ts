/**
 * Mark the want pairs by hand: one at a time, three big buttons.
 *
 *   npm run wants:label      then open http://localhost:8788 in a browser
 *
 * A person reads a want and one sentence and says whether the sentence shows the want
 * is met, shows it is not, or says nothing about it. Saved at once to labels.json. The
 * page calls no model and reads no database: the pairs are in pairs.ts, the marks in a
 * file. Keys: 1, 2, 3 to mark, 0 to go back one.
 *
 * BLIND, ALWAYS (the founder, 2026-09-28: "the labeling page must not show the app's own
 * answer"). This page reads the pairs and the person's own marks and nothing else -- never
 * a results file, never the scorer, never the check -- and shows no score while marking.
 * A mark made after seeing what the app said would measure how persuadable the marker
 * is, not how right the app is. tests/want-accuracy.test.ts plants the app's answers
 * where a run would leave them and checks none reaches the page.
 */
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { EVAL_PAIRS } from './pairs.js';
import { MARKS, readLabels, writeLabels, type Mark } from './accuracy.js';

const PORT = Number(process.env.LABEL_PORT ?? 8788);

/** The buttons, worded for the kind of want -- "could not be with" reads the other way. */
export function buttonsFor(kind: 'wants' | 'not'): { mark: Mark; label: string }[] {
  return kind === 'wants'
    ? [{ mark: 'met', label: 'Yes, this shows it' }, { mark: 'not_met', label: 'No, this shows the opposite' }, { mark: 'unknown', label: "Doesn't say" }]
    : [{ mark: 'met', label: "Fine: they're not like that" }, { mark: 'not_met', label: 'They ARE like that' }, { mark: 'unknown', label: "Doesn't say" }];
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function page(): string {
  const labels = readLabels();
  const next = EVAL_PAIRS.find((p) => !labels[p.id]);
  const done = EVAL_PAIRS.filter((p) => labels[p.id]).length;
  const body = next
    ? `<p class="dim">${done} of ${EVAL_PAIRS.length} marked</p>
       <p class="label">${next.want.kind === 'wants' ? 'THEY WANT' : 'THEY COULD NOT BE WITH'}</p>
       <p class="want">${esc(next.want.text)}</p>
       <p class="label">SOMEBODY WROTE</p>
       <p class="said">“${esc(next.sentence)}”</p>
       ${buttonsFor(next.want.kind).map((b, i) =>
         `<button onclick="mark('${next.id}','${b.mark}')">${i + 1}. ${esc(b.label)}</button>`).join('')}
       <button class="ghost" onclick="back()">0. Back one</button>`
    : `<p class="want">All ${EVAL_PAIRS.length} marked. Thank you.</p><p class="dim">Tell Claude: the pairs are marked.</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Mark the pairs</title>
<style>
  :root{color-scheme:light dark;--bg:#fff;--text:#101018;--dim:#55555f;--btn:#ececf2}
  @media(prefers-color-scheme:dark){:root{--bg:#0b0b0f;--text:#f2f2f7;--dim:#a9a9ba;--btn:#23232c}}
  body{margin:0;background:var(--bg);color:var(--text);padding:24px 16px;max-width:34rem;margin-inline:auto;
       font:18px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  .label{font-size:13px;letter-spacing:.08em;color:var(--dim);margin:20px 0 4px}
  .want{font-size:24px;font-weight:700;margin:0}.said{font-size:21px;margin:0 0 20px}.dim{color:var(--dim)}
  button{display:block;width:100%;padding:16px;margin:10px 0;font-size:18px;border:0;border-radius:14px;
         background:var(--btn);color:var(--text);text-align:left;cursor:pointer}
  button.ghost{background:transparent;color:var(--dim)}
</style></head><body>${body}
<script>
  async function mark(id, label){ await fetch('/label',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,label})}); location.reload(); }
  async function back(){ await fetch('/back',{method:'POST'}); location.reload(); }
  document.addEventListener('keydown', (e) => {
    const b = [...document.querySelectorAll('button')];
    if (e.key === '0') back(); else if (b[Number(e.key) - 1]) b[Number(e.key) - 1].click();
  });
</script></body></html>`;
}

/** The page and its two writes. Exported for the test; nothing starts on import. */
export const labelApp = new Hono()
  .get('/', (c) => c.html(page()))
  .post('/label', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { id?: string; label?: string } | null;
    if (!body?.id || !EVAL_PAIRS.some((p) => p.id === body.id) || !MARKS.includes(body.label as Mark)) {
      return c.json({ error: 'bad request' }, 400);
    }
    writeLabels({ ...readLabels(), [body.id]: body.label as Mark });
    return c.json({ ok: true });
  })
  .post('/back', (c) => {
    // Undo the last pair marked, in pair order: the one just before the next unmarked.
    const labels = readLabels();
    const last = [...EVAL_PAIRS].reverse().find((p) => labels[p.id]);
    if (last) { delete labels[last.id]; writeLabels(labels); }
    return c.json({ ok: true });
  });

if (process.argv[1] && process.argv[1].endsWith('label.ts')) {
  serve({ fetch: labelApp.fetch, port: PORT });
  console.log(`Open http://localhost:${PORT} to mark the pairs. Ctrl+C to stop; marks are saved as you go.`);
}
