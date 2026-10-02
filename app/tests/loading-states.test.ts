/**
 * Every screen while it loads (the founder, 2026-10-02: "can you fix the loading issues on
 * all the screens ... add a skeleton loading screen when something is loading please ...
 * even the maps").
 *
 * WHAT WAS WRONG, found by reading every screen (and seen on the Seeker with its requests
 * slowed to 1.4 s):
 *   - a bare spinner on an empty page: the town while its 3D engine started, setup's
 *     steps, the interview (for good when its question did not come), the 3D character;
 *   - a blank page: the town until its first frame, the consent screen, a map's tiles;
 *   - FALSE EMPTY STATES, shown before the data came: "No conversations yet", "Nothing
 *     waiting", the chat's opening "You both said yes", "No photos yet" on the reveal (with
 *     its two answers already working), six "+" photo wells, "Must have · 0 / None. Good.",
 *     "0 left" invites, "0 of 0 right", "No place yet" over a map of India, "Things to do
 *     0/5", the default character in the builder (one Save put it over the real one);
 *   - placeholders that stayed for good when the read failed (stories, appearance, the
 *     reveal, the home chat, the numbers), and failures shown as empty states ("Nothing for
 *     now", "Nothing to review").
 *
 * WHAT IS PINNED:
 *   - for real, with the API stood in by a fake: the town's store and the look store say
 *     when their first read failed (so the screen can say so instead of a placeholder for
 *     ever) and keep what they had when a refresh fails;
 *   - by reading the source (a navigator, a 3D view and a network wait do not run under
 *     vitest), comments stripped: no screen loads behind a bare spinner; each screen named
 *     above draws its placeholder while loading and has a way out when loading fails; the
 *     false empty states are only reached once the data is here; and the map's placeholder
 *     goes once every tile has arrived or been given up on.
 *
 * Negative control, run by hand and recorded in the commit: every screen file back to
 * HEAD (the shared pieces kept) -> the per-screen tests fail.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const SRC = join(import.meta.dirname, '..', 'src');
const strip = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + ' '.repeat(m.length - p1.length));
const src = (...p: string[]) => strip(readFileSync(join(SRC, ...p), 'utf8'));
const before = (text: string, a: string, b: string) => {
  const i = text.indexOf(a);
  const j = text.indexOf(b);
  expect(i, `${a} is missing`).toBeGreaterThan(-1);
  expect(j, `${b} is missing`).toBeGreaterThan(-1);
  return i < j;
};

const api = vi.hoisted(() => ({ world: null as unknown, look: null as unknown }));
vi.mock('../src/lib/api', () => ({
  getWorld: async () => api.world,
  getLook: async () => api.look,
  putLook: async () => null,
  buyItem: async () => null,
}));

describe('the stores behind the town and the character', () => {
  beforeEach(() => { vi.resetModules(); });

  it('the town says its first read failed, and keeps the square when a later one fails', async () => {
    const { useWorld } = await import('../src/features/world/store');
    api.world = null;
    await useWorld.getState().load('t');
    expect(useWorld.getState().failed, 'no square and no word of why: a placeholder for ever').toBe(true);
    const square = { square: { city: 'Bengaluru', area: 'koramangala' }, me: {}, agents: [] };
    api.world = square;
    await useWorld.getState().load('t');
    expect(useWorld.getState()).toMatchObject({ failed: false, world: square });
    api.world = null;
    await useWorld.getState().load('t');
    expect(useWorld.getState()).toMatchObject({ failed: false, world: square });
  });

  it('the builder knows when the saved character could not be had, and never takes the default for it', async () => {
    const { useLook } = await import('../src/features/look/store');
    api.look = null;
    await useLook.getState().load('t');
    expect(useLook.getState()).toMatchObject({ loaded: false, failed: true });
    const { STARTER } = await import('@clone/shared');
    api.look = { look: { ...STARTER, top: 2 }, saved: true, owned: [], balance: 5 };
    await useLook.getState().load('t');
    expect(useLook.getState()).toMatchObject({ loaded: true, failed: false, saved: true });
  });
});

describe('a placeholder looks like what it stands for', () => {
  it('the town is the map\'s own ground -- a tilted square of tiles -- not a row of bars', () => {
    // The first one was a skyline of bars of different heights; the founder saw a bar
    // chart before the map (2026-10-03). The map is a square of tiles seen from above.
    const town = src('features', 'world', 'town-loading.tsx');
    expect(town).not.toMatch(/SKYLINE|Skyline/);
    expect(town).toMatch(/transform: \[\{ scaleY: MAP_TILT \}, \{ rotate: '45deg' \}\]/);
    expect(town).toMatch(/Array\.from\(\{ length: MAP_TILES \* MAP_TILES \}/);
    expect(town).toContain('<MapGround />');
  });

  it('the town\'s first frame is its placeholder: the park is built a frame later, under it', () => {
    // Building Cubbon Park's layout in the town's first render kept the screen white for
    // the better part of eight seconds on the Pixel (its log, 2026-10-03).
    const world = src('features', 'world', 'world-screen.tsx');
    const outer = world.slice(world.indexOf('export default function WorldScreen()'), world.indexOf('function TownScreen()'));
    expect(outer).toContain('if (!ready) return <TownLoading />;');
    expect(outer).toContain('return <TownScreen />;');
    expect(outer, 'the park built before the first frame').not.toContain('venueGarden(');
    expect(world.indexOf('venueGarden(CUBBON_PARK)')).toBeGreaterThan(world.indexOf('function TownScreen()'));
  });

  it('opening the app shows the town\'s shape while it checks, not a blank page', () => {
    // The launch screen was held until the session check finished: a white page for nine
    // seconds and more on the Pixel over a slow connection (2026-10-03).
    const root = src('app', '_layout.tsx');
    expect(root).toMatch(/if \(fontsReady && themeLoaded\) void SplashScreen\.hideAsync\(\);/);
    expect(root).not.toMatch(/fontsReady && checked\) void SplashScreen/);
    expect(root).toMatch(/\{!checked && <View[^>]*><TownLoading \/><\/View>\}/);
  });
});

describe('no screen loads behind a bare spinner', () => {
  it('the town, setup\'s steps, the interview and the 3D character show their shape instead', () => {
    for (const f of [
      ['features', 'world', 'world-screen.tsx'],
      ['features', 'onboarding', 'essentials-screen.tsx'],
      ['features', 'onboarding', 'interview-screen.tsx'],
      ['features', 'world', 'character-canvas.tsx'],
    ]) {
      expect(src(...f), f.join('/')).not.toContain('ActivityIndicator');
    }
    expect(src('features', 'world', 'world-screen.tsx')).toContain('if (renderer === undefined) return <TownLoading />;');
    expect(src('features', 'world', 'world-screen.tsx')).toContain('{!drawn && <TownLoading overlay />}');
    expect(src('features', 'onboarding', 'essentials-screen.tsx')).toContain('<SkeletonQuestion />');
    expect(src('features', 'world', 'character-canvas.tsx')).toContain('<FigureSkeleton');
    expect(src('features', 'look', 'preview.tsx')).toContain('if (renderer === undefined) return <FigureSkeleton');
  });

  it('the interview\'s question that does not come is said, with a way to try again', () => {
    const s = src('features', 'onboarding', 'interview-screen.tsx');
    expect(s).toContain("if (!next) { setFailedLoad(true); return; }");
    expect(s).toContain('<LoadFailed what="the next question"');
    expect(s).toContain('if (!state || onward || late) {');
  });
});

/** Each screen: a placeholder while loading, a way out when it fails, and its empty state only once the data is here. */
const SCREENS: { file: string[]; placeholder: string; failure: string; emptyAfter?: [string, string] }[] = [
  { file: ['features', 'dm', 'conversations-screen.tsx'], placeholder: '<SkeletonRows count={4} avatar={52} />',
    failure: '<LoadFailed what="your chats"', emptyAfter: ["status === 'loading' ? (", 'title="No conversations yet"'] },
  { file: ['features', 'matches', 'matches-screen.tsx'], placeholder: 'label="Loading your matches"',
    failure: '<LoadFailed what="your matches"', emptyAfter: ["{status === 'ready' && (<>", 'title="Nothing waiting"'] },
  { file: ['features', 'profile', 'profile-screen.tsx'], placeholder: '<ProfileSkeleton />',
    failure: '<LoadFailed what="your profile"', emptyAfter: ["if (status !== 'ready') {", "value: String(k?.knows.length ?? 0)"] },
  { file: ['features', 'dm', 'thread-screen.tsx'], placeholder: '<SkeletonBubbles count={5} />',
    failure: '<LoadFailed what="this conversation"', emptyAfter: ["status !== 'ready' && messages.length === 0", 'You both said yes. Nobody else can message you here.'] },
  { file: ['features', 'matches', 'reveal-screen.tsx'], placeholder: 'label="Loading their profile"',
    failure: '<LoadFailed what="their profile"', emptyAfter: ["if (status !== 'ready') {", 'No photos yet'] },
  { file: ['features', 'photos', 'photos-screen.tsx'], placeholder: 'label="Loading your photos"',
    failure: '<LoadFailed what="your photos"', emptyAfter: ["{status === 'ready' && (<>", "'Add your first photo'"] },
  { file: ['features', 'onboarding', 'photos-step.tsx'], placeholder: 'label="Loading your photos"',
    failure: '<LoadFailed what="your photos"' },
  { file: ['features', 'preferences', 'preferences-screen.tsx'], placeholder: 'label="Loading what you are looking for"',
    failure: '<LoadFailed what="what you are looking for"', emptyAfter: ["{status === 'loading' ? (", 'None. Good.'] },
  { file: ['features', 'settings', 'settings-screen.tsx'], placeholder: 'label="Loading your invites"',
    failure: '<LoadFailed what="your invites"', emptyAfter: ["{invitesStatus === 'ready' ? (", 'inviteCard(remaining, perPerson).label'] },
  { file: ['features', 'knowledge', 'you-screen.tsx'], placeholder: 'label="Loading what it knows"',
    failure: '<LoadFailed what="what it knows"' },
  { file: ['features', 'appearance', 'appearance-screen.tsx'], placeholder: 'label="Loading your rules"',
    failure: '<LoadFailed what="how you appear"' },
  { file: ['features', 'consent', 'consent-screen.tsx'], placeholder: 'label="Loading the terms"',
    failure: '<LoadFailed what="the terms"' },
  { file: ['features', 'stories', 'stories-screen.tsx'], placeholder: 'label="Loading the questions"',
    failure: '<LoadFailed what="the questions"' },
  { file: ['features', 'question', 'question-screen.tsx'], placeholder: 'label="Loading today\'s question"',
    failure: '<LoadFailed what="today\'s question"', emptyAfter: ['failed && q === undefined', 'Nothing for now.'] },
  { file: ['features', 'profile', 'edit-basic.tsx'], placeholder: 'label="Loading your answer"',
    failure: '<LoadFailed what="your answer"' },
  { file: ['features', 'look', 'builder.tsx'], placeholder: 'label="Loading your character"',
    failure: '<LoadFailed what="your character"', emptyAfter: ['if (!loaded) {', 'label="Surprise me"'] },
  { file: ['features', 'distance', 'distance-step.tsx'], placeholder: 'label="Loading the map"',
    failure: '<LoadFailed what="where you are"', emptyAfter: ['if (!ready) {', "'No place yet'"] },
  { file: ['features', 'onboarding', 'self-test-screen.tsx'], placeholder: 'label="Loading how it did"',
    failure: 'Could not load how it has done so far.' },
  { file: ['features', 'chat', 'chat-screen.tsx'], placeholder: 'label="Loading what it knows"',
    failure: 'Could not load what it knows. You can still talk to it.' },
  { file: ['features', 'admin', 'reports-screen.tsx'], placeholder: 'label="Loading the reports"',
    failure: '<LoadFailed what="the reports"' },
  { file: ['features', 'admin', 'funnel-screen.tsx'], placeholder: 'label="Loading the numbers"',
    failure: '<LoadFailed what="the numbers"' },
];

describe('every screen while it loads', () => {
  for (const s of SCREENS) {
    it(`${s.file.at(-1)}: its shape while loading, a way out on failure${s.emptyAfter ? ', and its empty state only after' : ''}`, () => {
      const text = src(...s.file);
      expect(text, 'no placeholder').toContain(s.placeholder);
      expect(text, 'no way out when loading fails').toContain(s.failure);
      if (s.emptyAfter) {
        expect(before(text, s.emptyAfter[0], s.emptyAfter[1]),
          `"${s.emptyAfter[1]}" can be reached before the data is here`).toBe(true);
      }
    });
  }

  it('the reveal\'s answers are not on screen until who they are is', () => {
    const r = src('features', 'matches', 'reveal-screen.tsx');
    expect(before(r, "if (status !== 'ready') {", 'onPress={() => void answer(true)}')).toBe(true);
  });

  it('the town\'s bar, line and button are placeholders while the square is on its way, and a failure is said', () => {
    const h = src('features', 'world', 'hud.tsx');
    expect(h).toContain('<TownBarSkeleton />');
    expect(h).toContain("(failed ? 'Cannot reach the server. Trying again…' : '')");
    expect(h).not.toContain('Finding the square');
    expect(h).toMatch(/!world \? \(\s*<SkeletonBlock height=\{52\}/);
    expect(h).toContain('questsKnown ? (');
  });
});

describe('pictures while they load', () => {
  it('a photo, a face and a photo slot breathe while their picture is on its way, never for ever', () => {
    const photo = src('features', 'photos', 'photo.tsx');
    expect(photo).toContain('if (alive) setData(uri ?? null);');
    expect(photo).toContain('if (uri === undefined) return <SkeletonBlock height="100%" radius={0} />;');
    expect(photo).toContain('loading={Boolean(photoId) && uri === undefined}');
    const avatar = src('components', 'ui', 'avatar.tsx');
    expect(avatar.match(/\) : loading \? \(/g)?.length, 'Avatar and PhotoSlot').toBe(2);
    expect(src('features', 'profile', 'profile-screen.tsx')).toContain('loading={Boolean(photo) && uri === undefined}');
  });

  it('the map breathes until every tile in view has arrived or been given up on', () => {
    const tiles = src('features', 'distance', 'tiles.ts');
    expect(tiles).toContain('if (alive) setData(d ?? null);');
    const map = src('features', 'distance', 'distance-map.tsx');
    expect(map).toContain("const waiting = token !== null && (width === 0 || tiles.some((t) => !settled.has(t.key)));");
    expect(map).toContain('const settled = data !== undefined;');
    expect(map).toMatch(/\{waiting && \(\s*<SkeletonBlock height=\{height\}/);
  });
});
