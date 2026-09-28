/**
 * The name other people see is asked on a screen, and nowhere else.
 *
 * WHAT THE FOUNDER ASKED FOR (2026-09-28): "don't take a first name from chat (ask for
 * it on a screen instead)". No screen used to ask for a name; the one shown was the
 * first word of a full name the chat extractor heard. The server now takes a first name
 * only from setup and its editor (server/tests/reveal-privacy.test.ts). This holds the
 * app to asking it: a setup step, a row on the profile that opens its editor, a chip on
 * the Home for everybody who set up before the step existed -- and the profile's title
 * is that name, never one the clone heard.
 *
 * Negative controls, run 2026-09-28, each restored byte-identical:
 *   - the profile title back on preferred_name/full_name -> "the profile" fails
 *   - the Home chip removed                              -> "the Home" fails
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { firstName } from '@clone/shared';
import { FIELDS, essentialSteps, missingLabel, setupRoute } from '../src/features/profile/fields';

const APP = join(import.meta.dirname, '..');
/** What a person can read: the file with comments taken out. */
const said = (rel: string) => readFileSync(join(APP, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('the first-name step', () => {
  it('is asked first in setup, when the server says it is still open', () => {
    expect(FIELDS[0]).toMatchObject({ key: 'first_name', title: 'What should people call you?', kind: 'text', rowLabel: 'First name' });
    expect(FIELDS[0]!.note).toBe('People see it only after you share your profile with them.');
    expect(essentialSteps(['first_name', 'area'], true).map((f) => f.key)).toEqual(['first_name', 'area']);
    expect(essentialSteps(['area'], true).map((f) => f.key)).toEqual(['area']);
    expect(missingLabel('first_name')).toBe('Your first name');
    expect(setupRoute(['first_name'])).toBe('/onboarding/essentials');
  });

  it('takes one word of letters, in any script, and never a number or a handle', () => {
    expect(firstName('  Meera Rao ')).toBe('Meera');
    expect(firstName("O'Brien")).toBe("O'Brien");
    expect(firstName('अभिलाष')).toBe('अभिलाष');
    for (const bad of ['98450 12345', '@meera', 'm33ra', '', '   ']) expect(firstName(bad), bad).toBeNull();
  });
});

describe('where it is asked and shown', () => {
  it('the profile: its title is the typed name, and a row opens the editor', () => {
    const profile = said('src/features/profile/profile-screen.tsx');
    expect(profile).toContain("const name = valueOf(k, 'first_name');");
    expect(profile, 'a name the clone heard is shown as yours').not.toMatch(/valueOf\(k, '(?:preferred|full)_name'\)/);
    expect(profile).toContain("router.push('/edit/first_name')");
  });

  it('the Home: a chip asks it while the server lists it as needed', () => {
    const hud = said('src/features/world/hud.tsx');
    expect(hud).toContain("world?.me.need.includes('first_name')");
    expect(hud).toContain('label="Add your first name"');
    expect(said('src/features/world/world-screen.tsx')).toContain("setupRoute(['first_name'])");
  });
});
