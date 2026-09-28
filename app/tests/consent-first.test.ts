/**
 * Consent first, as the person reads it: the buttons, the turns, and every promise.
 *
 * WHAT THE FOUNDER ASKED FOR (2026-09-28): nobody's photos or name reach anyone until
 * THAT person has said yes to them. The first mover sees the words card and the other's
 * character and taps "Yes, share my profile with them"; the second person then sees the
 * first mover's photos and card and taps "Yes, share mine back" or "Not for me"; only
 * then does the first mover see the second person's photos, and the chat opens. "Update
 * every promise (consent text, photo screens, the reveal's small print) to match exactly."
 *
 * The server enforces the rule (server/tests/consent-first-reveal.test.ts). This holds the
 * app to the same words: the card offers the right move for whose turn it is, and no
 * screen still promises the old rule ("after both said yes") or says something false
 * about a yes ("they are never told what you chose").
 *
 * Negative controls, run 2026-09-28, each restored byte-identical:
 *   - turnOf ignoring sharedWithYou                  -> "the second move" fails
 *   - the old consent line put back                  -> "no screen promises" fails
 *   - the reveal's old "Yes" button label put back   -> "the reveal" fails
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WORDS, turnOf } from '../src/features/matches/turn';

const APP = join(import.meta.dirname, '..');
const read = (rel: string) => readFileSync(join(APP, rel), 'utf8');
/** What a person can read: the file with comments taken out. */
const said = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('whose move it is', () => {
  it('the first move is made on the words card, and a yes shares YOUR profile', () => {
    expect(turnOf({ waitingOnYou: true, sharedWithYou: false, youShared: false })).toBe('share-first');
    expect(WORDS.shareFirst).toBe('Yes, share my profile with them');
    expect(WORDS.shareFirstNote).toBe('This shows them your photos and first name. Nothing is shared until you tap it.');
  });

  it('the second move comes after they shared: see them, then share yours back or not', () => {
    expect(turnOf({ waitingOnYou: true, sharedWithYou: true, youShared: false })).toBe('share-back');
    expect(WORDS.shareBack).toBe('Yes, share mine back');
    expect(WORDS.notForMe).toBe('Not for me');
  });

  it('says which wait it is: you shared, or they decide first', () => {
    expect(turnOf({ waitingOnYou: false, sharedWithYou: false, youShared: true })).toBe('you-shared');
    expect(turnOf({ waitingOnYou: false, sharedWithYou: false, youShared: false })).toBe('they-first');
    expect(WORDS.youShared).toBe('You shared your profile. If they share theirs back, you can talk.');
    expect(WORDS.theyFirst).toBe('They decide first. If they share their profile, you will see it here.');
  });

  it('the card and the reveal use these words and turns, not their own', () => {
    const card = said('src/features/matches/matches-screen.tsx');
    expect(card).toContain('turnOf(m)');
    expect(card).toContain('WORDS.shareFirst');
    expect(card, 'the old first move opened the reveal').not.toContain("'Show me who it is'");
    const reveal = said('src/features/matches/reveal-screen.tsx');
    expect(reveal).toContain('WORDS.shareBack');
    expect(reveal).toContain('WORDS.shareBackNote');
    expect(reveal, 'the old bare "Yes" is back on the reveal').not.toMatch(/\? 'I would say yes' : 'Yes'/);
  });
});

describe('no screen promises the old rule', () => {
  const SCREENS = [
    'src/features/consent/consent-screen.tsx', 'src/features/onboarding/photos-step.tsx',
    'src/features/photos/photos-screen.tsx', 'src/features/profile/profile-screen.tsx',
    'src/features/onboarding/essentials-screen.tsx', 'src/features/onboarding/character-step.tsx',
    'src/features/look/builder-screen.tsx', 'src/features/matches/reveal-screen.tsx',
    'src/features/matches/matches-screen.tsx', 'src/features/world/agent-sheet.tsx', 'app.json',
  ];

  it('nothing says photos wait for "both" yeses, or that a yes is never told', () => {
    for (const f of SCREENS) {
      const text = f.endsWith('.json') ? read(f) : said(f);
      for (const old of ['both said yes to', 'have both said yes', 'both agents have said yes',
                         'never told what you chose', 'before they say yes', 'one person at a time']) {
        expect(text, `${f} still says "${old}"`).not.toContain(old);
      }
    }
  });

  it('the consent, the photo screens and the phone permission say the new rule', () => {
    expect(said('src/features/consent/consent-screen.tsx'))
      .toContain('Your photos and first name are never public. A person sees them only after you say yes to sharing them with that person.');
    expect(said('src/features/onboarding/photos-step.tsx')).toContain('Nobody sees these until you share your profile with them.');
    expect(said('src/features/photos/photos-screen.tsx')).toContain('label="Only people you share your profile with"');
    expect(read('app.json')).toContain('Your photos are shown only to people you share your profile with.');
  });
});
