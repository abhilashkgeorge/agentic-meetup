/**
 * The timestamp on a conversation row.
 *
 * THE BUG THIS EXISTS FOR. The server sent the time the way Postgres prints it --
 * "2026-09-12 23:53:52.900997+00" -- and every conversation in the list said
 * "Invalid Date". Node parses that string happily, so it looked right everywhere
 * except on a phone: Hermes implements only what the spec requires, which is ISO
 * 8601 with a T and a Z.
 *
 * Two things are pinned here. The server's format must parse, and ANY string that
 * does not parse must render as nothing at all -- a row can lose its timestamp, but it
 * must never show somebody the words "Invalid Date".
 */
import { describe, expect, it } from 'vitest';
import { ago } from '../src/lib/ago';

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

describe('the time beside a conversation', () => {
  it('never renders an error where a time should be', () => {
    for (const bad of [
      '2026-09-12 23:53:52.900997+00', // what Postgres prints, and what broke it
      'not a date',
      '',
      '0000-00-00',
    ]) {
      expect(ago(bad), bad || '(empty)').not.toContain('Invalid');
    }
  });

  it('says nothing at all when it cannot tell', () => {
    expect(ago('not a date')).toBe('');
    expect(ago(null)).toBe('');
  });

  it('reads the format the server actually sends', () => {
    expect(ago(iso(30_000))).toBe('now');
    expect(ago(iso(5 * 60_000))).toBe('5m');
    expect(ago(iso(3 * 3_600_000))).toBe('3h');
  });

  it('falls back to a day, then a date, as things get older', () => {
    const twoDays = ago(iso(2 * 86_400_000));
    expect(twoDays).toMatch(/^[A-Z][a-z]{2}$/);       // "Tue"

    const longAgo = ago(iso(40 * 86_400_000));
    expect(longAgo).toMatch(/\d/);                     // "12 Aug"
    expect(longAgo).not.toContain('Invalid');
  });
});
