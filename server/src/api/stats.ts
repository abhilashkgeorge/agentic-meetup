/**
 * The public numbers, including the zeroes.
 *
 * For a founder seeding people he knows personally, smallness DISCOVERED is
 * humiliating and smallness DECLARED is credibility. Rendezvous shipped everything
 * else right and has two participants; the thing that would have cost them nothing
 * was saying so before somebody found out at a dinner.
 *
 * Counts only. No names, no content, nothing that identifies anybody. It reads
 * through the owner pool because there is no user to be, and it selects nothing but
 * aggregates -- there is no row here that belongs to a person.
 */
import { Hono } from 'hono';
import { html, raw } from 'hono/html';
import { discoverySession } from '../db/client.js';
import { env } from '../env.js';

interface Stats {
  people: number;
  testsGraded: number;
  soundedRight: number;
}

export const statsRoutes = new Hono().get('/stats', async (c) => {
  const s = await discoverySession(async (db) => {
    const { rows } = await db.query<Stats>(`
      SELECT
        -- Synthetic profiles exist to exercise matching and are not people. Counting
        -- them here would make the one page in this product whose entire purpose is
        -- honesty about how small it is into the least honest thing in it.
        (SELECT count(*) FROM app_users u JOIN tenants t ON t.id = u.tenant_id
          WHERE t.name <> '__synthetic__')                               AS people,
        (SELECT count(*) FROM self_tests WHERE verdict IS NOT NULL)     AS "testsGraded",
        (SELECT count(*) FROM self_tests WHERE verdict = 'me')          AS "soundedRight"
    `);
    return rows[0]!;
  });

  const pct =
    Number(s.testsGraded) > 0
      ? Math.round((Number(s.soundedRight) / Number(s.testsGraded)) * 100)
      : null;

  const rows = [
    ['People here', s.people],
    ['Answers judged, ever', s.testsGraded],
  ] as const;

  return c.html(html`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>How small this is</title>
<style>
  :root{color-scheme:light dark;--bg:#fff;--text:#101018;--dim:#55555f;--border:#d8d8e0}
  @media(prefers-color-scheme:dark){:root{--bg:#0b0b0f;--text:#f2f2f7;--dim:#a9a9ba;--border:#2e2e3a}}
  body{margin:0;background:var(--bg);color:var(--text);padding:24px;max-width:34rem;
    margin-inline:auto;font:17px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  h1{font-size:28px;margin:0 0 4px}
  .dim{color:var(--dim);font-size:15px}
  table{width:100%;border-collapse:collapse;margin:24px 0}
  td{padding:12px 0;border-bottom:1px solid var(--border)}
  td:last-child{text-align:right;font-weight:600;font-variant-numeric:tabular-nums}
  .big{font-size:44px;font-weight:700;margin:8px 0 0}
</style></head><body>
  <h1>How small this is</h1>
  <p class="dim">Updated live. We would rather you knew than found out.</p>
  <table>${raw(rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join(''))}</table>
  ${pct === null
    ? raw('<p class="dim">Nobody has graded their clone yet.</p>')
    : raw(`<p class="dim">Clones sounded right</p>
      <p class="big">${pct}%</p>
      <p class="dim">${
        pct >= 95
          ? 'That is too high to be interesting. If it is never wrong, there is no game — we would rather this number came down.'
          : pct <= 50
            ? 'That is bad, and we are not hiding it.'
            : 'Somewhere between 60 and 80 is the honest range. Higher means the questions are too easy.'
      }</p>
      <p class="dim">Judged by the people they belong to, nobody else.</p>`)}
  <p class="dim">Nothing on this page is about any particular person. It is counts.</p>
  <p class="dim">${env.PUBLIC_BASE_URL}</p>
</body></html>`);
});
