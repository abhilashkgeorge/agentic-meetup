/**
 * What the app promises about privacy is what the code does (the founder's (f, h),
 * 2026-09-29; docs/END-TO-END.md 15.2 item 8).
 *
 * WHAT WAS WRONG: the consent screen said "Only things marked public ever leave your
 * account" and that you could "change" everything the clone knows; Settings said "Nobody
 * else has ever seen what your clone knows about you". But a card shows your age, your
 * part of town and what you are here for before anybody says yes; wants about work,
 * exercise, sleep and moving say whether you fit; what you type goes to AI providers;
 * and there is no editing a fact, only saying it is wrong.
 *
 * WHAT IS PINNED: the old promises are gone from the screens; the new words say what a
 * card shows before a yes, that private answers are never shown, that photos and first
 * name wait for your yes, and that messages go to AI providers for search as well.
 *
 * Negative control, run by hand and recorded in the commit: the consent screen's first
 * privacy line put back -> "the old promises are gone" fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (f: string) => readFileSync(join(import.meta.dirname, '..', 'src', f), 'utf8');

describe('the privacy words', () => {
  const consent = read('features/consent/consent-screen.tsx');
  const settings = read('features/settings/settings-screen.tsx');

  it('the old promises are gone', () => {
    for (const [where, src] of [['consent', consent], ['settings', settings]] as const) {
      expect(src, where).not.toMatch(/Only things marked public ever leave your account/);
      expect(src, where).not.toMatch(/Nobody else has ever seen what your clone knows/);
      expect(src, where).not.toMatch(/know[s]? about you, change it/);
    }
  });

  it('say what a card shows before a yes, and what waits for one', () => {
    expect(consent).toMatch(/your age, your part of town and what you are here for/);
    expect(consent).toMatch(/Your photos and first name reach a person only after you say yes/);
    expect(consent).toMatch(/private questions, like faith, drinking or kids, help decide who you meet\. They are never shown\./);
    expect(settings).toMatch(/Nobody sees your photos or first name until you say yes to them\./);
  });

  // Server 0082 (the founder, 2026-09-29): a deleted account's chats are held hidden for
  // thirty days for a report. Said where a person agrees, and where they delete.
  it('say that a deleted account\'s chats are held hidden for 30 days, for a report only', () => {
    expect(consent).toMatch(/If you delete your account, your chats are kept hidden for 30 days so the people you talked to can still report you\. Only a reviewer reads them, and only after a report\. Then they are deleted\./);
    expect(settings).toMatch(/Your chats are kept hidden for 30 days in case someone reports them, then deleted\./);
    expect(read('../../server/migrations/0082_left_chats_held.sql')).toMatch(/expires_at\s+timestamptz NOT NULL DEFAULT now\(\) \+ interval '30 days'/);
  });

  it('say that messages go to AI providers for search as well as chat', () => {
    expect(consent).toMatch(/go to AI providers, to run your clone and to search what it remembers/);
  });
});
