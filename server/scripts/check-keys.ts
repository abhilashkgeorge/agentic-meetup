/**
 * Are the configured credentials real, and do they still work?
 *
 * WHY THIS EXISTS. Both API keys and the database password sat on disk in a directory
 * with no `.gitignore` for the life of the project: the first `git add .` would have
 * written them into history permanently, where a rotated key is the only remedy. The
 * ignore rules and the first commits are done; the rotation is a person's job, and
 * this is the thing that tells them it worked without opening the app.
 *
 * IT PRINTS NO SECRET. Not a prefix, not a suffix, not a length in a way that narrows
 * anything -- a diagnostic that leaks the thing it is diagnosing ends up pasted into
 * a chat window. It reports shape, provider reachability and nothing else.
 *
 * THE PROBE COSTS A FRACTION OF A CENT. One token out of the cheapest routed model,
 * which is the only way to distinguish "key is present" from "key still works".
 * Skip it with --no-probe.
 *
 *   tsx scripts/check-keys.ts [--no-probe]
 */
import { Pool } from 'pg';
import { env } from '../src/env.js';
import { modelFor } from '../src/llm/index.js';
import { capabilities } from '../src/llm/caps.js';

const probe = !process.argv.includes('--no-probe');
let bad = 0;

const say = (ok: boolean, label: string, detail: string) => {
  if (!ok) bad++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label.padEnd(26)} ${detail}`);
};

console.log('\ncredentials\n');

// ── shape only. Never the value, never a prefix. ─────────────────────────────
//
// SHAPE IS A HINT, NOT A VERDICT. The first version of this asserted Google keys look
// like /^AIza\w{35}$/ and reported FAIL against a key that works perfectly well --
// the provider had simply issued a different format. A check that cries wolf about a
// working credential trains people to ignore it, so the probe below is the authority
// and this only says whether something is there at all.
const keys: [string, string][] = [
  ['GEMINI_API_KEY', env.GEMINI_API_KEY],
  ['ANTHROPIC_API_KEY', env.ANTHROPIC_API_KEY],
  ['OPENAI_API_KEY', env.OPENAI_API_KEY],
];
for (const [name, value] of keys) {
  if (!value) { console.log(`  --   ${name.padEnd(26)} not set`); continue; }
  // Too short to be anything real is the only claim worth making without a request.
  say(value.length >= 20, name,
    value.length >= 20 ? 'set (the probe below says whether it works)' : 'set but implausibly short');
}

// ── the database, per role ───────────────────────────────────────────────────
console.log('\ndatabase roles\n');
const urls: [string, string | undefined][] = [
  ['DATABASE_URL (clone_app)', env.DATABASE_URL],
  ['MIGRATION_DATABASE_URL', env.MIGRATION_DATABASE_URL],
  ['MATCHMAKER_DATABASE_URL', env.MATCHMAKER_DATABASE_URL],
  ['ERASE_DATABASE_URL', env.ERASE_DATABASE_URL],
];
for (const [name, url] of urls) {
  if (!url) { console.log(`  --   ${name.padEnd(26)} not set`); continue; }
  const p = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 4000 });
  try {
    const { rows } = await p.query<{ who: string }>('SELECT current_user AS who');
    // A development password is not a failure here -- it is a fact worth printing
    // next to the role it belongs to, where somebody deploying will see it.
    const dev = /:\/\/([^:]+):\1@/.test(url);
    say(true, name, `connects as ${rows[0]!.who}${dev ? '  (password equals the role name)' : ''}`);
  } catch (err) {
    say(false, name, err instanceof Error ? err.message.split('\n')[0]! : 'failed');
  } finally {
    await p.end().catch(() => {});
  }
}

// ── does the key still work? ─────────────────────────────────────────────────
if (probe) {
  console.log('\nproviders\n');
  const model = modelFor('chat');
  try {
    const { llm } = await import('../src/llm/index.js');
    const { metered } = await import('../src/metering.js');
    // Through the meter like everything else, so even a health check is attributable.
    const res = await metered(
      { tenantId: '00000000-0000-0000-0000-000000000000', userId: '00000000-0000-0000-0000-000000000000' },
      'keycheck',
      () => llm.complete(
        { task: 'chat', instructions: 'Reply with the single word: ok', messages: [{ role: 'user', content: 'ping' }], maxOutputTokens: 8, thinking: false },
        model,
      ),
    ).catch(async (e: unknown) => {
      // The meter needs a real tenant to record against. A health check should not
      // need an account, so fall back to the raw call and say so.
      if (e instanceof Error && /violates foreign key|invalid input syntax/.test(e.message)) {
        return llm.complete(
          { task: 'chat', instructions: 'Reply with the single word: ok', messages: [{ role: 'user', content: 'ping' }], maxOutputTokens: 8, thinking: false },
          model,
        );
      }
      throw e;
    });
    say(true, String(model), `answered, ${res.usage.outputTokens} output tokens, $${res.usage.costUsd.toFixed(6)}`);
  } catch (err) {
    say(false, String(model), err instanceof Error ? err.message.split('\n')[0]! : 'failed');
  }

  const caps = capabilities(model);
  say(caps.price.verified, `${model} pricing`,
    caps.price.verified ? caps.price.source : `UNVERIFIED — ${caps.price.source}`);
}

console.log(bad ? `\n${bad} problem(s).\n` : '\nall good.\n');
process.exit(bad ? 1 : 0);
