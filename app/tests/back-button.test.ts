/**
 * Android's Back on the town screen (src/features/world/back.ts; world-screen.tsx).
 *
 * WHAT WAS WRONG (the Pixel 6a, 2026-09-30): nothing on the screen listened for Back, so
 * with a sheet open -- talking to your agent, the people list, a stranger's card, the
 * park's "Things to do" -- Back closed the whole app, and from inside Cubbon Park it did the
 * same instead of going back to Bengaluru. Seen after the fix: Back closed the agent chat,
 * then the people list, then "Things to do", then left the park for the city; the app
 * stayed open throughout.
 *
 * Negative controls, run by hand and recorded in the commit: backStep answering null for
 * everything -> "closes what is open" fails; the screen without its BackHandler -> "is
 * listened for" fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { backStep, type BackState } from '../src/features/world/back';

const none: BackState = {
  chat: false, live: false, agent: false, quests: false, voices: false, people: false,
  exchange: false, inPark: false, moving: false,
};

describe('Back on the town screen', () => {
  it('closes what is open, topmost first, then leaves the park, and only then the app', () => {
    expect(backStep({ ...none, people: true, chat: true, inPark: true })).toBe('chat');
    expect(backStep({ ...none, agent: true, people: true })).toBe('agent');
    expect(backStep({ ...none, quests: true, inPark: true })).toBe('quests');
    expect(backStep({ ...none, exchange: true })).toBe('exchange');
    expect(backStep({ ...none, inPark: true })).toBe('inPark');
    expect(backStep(none)).toBeNull();
  });

  it('waits while entering or leaving the park rather than quitting halfway', () => {
    expect(backStep({ ...none, moving: true })).toBe('wait');
  });

  it('is listened for, and closes each thing it names', () => {
    const screen = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'world', 'world-screen.tsx'), 'utf8');
    expect(screen).toMatch(/BackHandler\.addEventListener\('hardwareBackPress', \(\) => \{\s*const step = backStep\(/);
    for (const [step, close] of [['chat', 'setChatOpen(false)'], ['live', 'setLiveSelected(null)'], ['agent', 'setSelected(null)'],
      ['quests', 'setQuestsOpen(false)'], ['voices', 'setVoicesOpen(false)'], ['people', 'setPeopleOpen(false)'],
      ['exchange', 'setExchange(null)'], ['inPark', 'leaveVenue()']]) {
      expect(screen).toContain(`step === '${step}') ${close}`);
    }
    expect(screen).toContain('return step !== null;');
  });
});
