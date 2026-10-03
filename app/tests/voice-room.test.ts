/**
 * Voice comes back by itself after the voice server was lost (features/world/voice-room.ts).
 *
 * WHAT WAS WRONG (the Seeker, 2026-09-29, the phone taken off its cable in the park):
 * LiveKit tries to reconnect for about forty seconds and then gives up; nothing tried
 * again, so voice stayed dead -- and said nothing -- until you walked out of the park and
 * back in. And the old pass may have run out by then (they last two hours).
 *
 * WHAT IS PINNED, with LiveKit and the park's socket stood in by fakes (the code under
 * test is the real voice-room.ts):
 *   - lost, it says so ("failed") and asks the park for a FRESH pass, sooner first
 *     (RETRY_MS), again and again while it cannot connect -- never faster than the steps;
 *   - a fresh pass brings it back, "on", and the asking stops;
 *   - a disconnect it asked for itself (leaving, a new room) is not a loss;
 *   - stopped, it asks for nothing more -- and started again (a new sim, a hot reload),
 *     it takes the pass it has straight back up, rather than voice staying off until the
 *     next walk into the park (seen on the Seeker after a hot reload, 2026-09-29).
 *
 * And the mic (the Pixel, 2026-10-02): a publish cancelled by a reconnect is tried again,
 * not called "Mic not allowed"; only a refusal is; after MIC_TRIES it is simply off.
 *
 * And the loudspeaker (the Pixel, 2026-10-03): the mic on put the sound in the EARPIECE,
 * where it stayed until voice started afresh -- "the voice was not working unless I moved
 * to a different screen and came back". The earpiece is not allowed, and the output is
 * chosen again after joining and after the mic comes on.
 *
 * Negative controls, run by hand and recorded in the commit: retryLater() taken out of the
 * Disconnected handler -> "asks the park for a fresh pass" fails; stopping that forgets the
 * pass (left()) -> "takes the pass straight back up" fails; apply() setting micDenied on
 * any failure (as it did) -> "comes on after a publish cancelled" and "gives up" fail.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
  const RoomEvent = {
    TrackPublished: 'trackPublished', TrackSubscribed: 'trackSubscribed', ParticipantConnected: 'participantConnected',
    ActiveSpeakersChanged: 'activeSpeakersChanged', Reconnecting: 'reconnecting', Reconnected: 'reconnected', Disconnected: 'disconnected',
  };
  class FakeRoom {
    static made: FakeRoom[] = [];
    static unreachable = false;
    handlers = new Map<string, ((...a: unknown[]) => void)[]>();
    state = 'disconnected';
    remoteParticipants = new Map();
    localParticipant = { setTrackSubscriptionPermissions: () => {}, setMicrophoneEnabled: async (_on: boolean) => {} };
    constructor() { FakeRoom.made.push(this); }
    on(ev: string, fn: (...a: unknown[]) => void) { this.handlers.set(ev, [...(this.handlers.get(ev) ?? []), fn]); return this; }
    emit(ev: string) { for (const fn of this.handlers.get(ev) ?? []) fn([]); }
    async connect() { if (FakeRoom.unreachable) throw new Error('could not establish signal connection'); this.state = 'connected'; }
    async disconnect() { this.state = 'disconnected'; this.emit(RoomEvent.Disconnected); }
    /** The voice server gone: LiveKit's own reconnecting has given up. */
    lose() { this.state = 'disconnected'; this.emit(RoomEvent.Disconnected); }
  }
  /** What the code asked of the phone's audio, in order. */
  const audio = { calls: [] as string[], outputs: ['earpiece', 'speaker'] as string[], startsToTake: 1, starts: 0 };
  return { FakeRoom, RoomEvent, askAgain: { calls: 0, ok: true }, told: [] as boolean[], kept: [] as boolean[], audio };
});

vi.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
  LogBox: { ignoreLogs: () => {} },
  PermissionsAndroid: { PERMISSIONS: {}, RESULTS: {}, check: async () => true, request: async () => 'granted' },
  Platform: { OS: 'android' },
}));
vi.mock('@livekit/react-native', () => ({
  registerGlobals: () => {},
  AndroidAudioTypePresets: { communication: { audioMode: 'inCommunication' } },
  AudioSession: {
    configureAudio: async (c: { android?: { preferredOutputList?: string[] } }) => { fake.audio.calls.push(`configure:${c.android?.preferredOutputList?.join(',')}`); },
    startAudioSession: async () => { fake.audio.starts++; fake.audio.calls.push('start'); },
    stopAudioSession: async () => { fake.audio.calls.push('stop'); },
    // LiveKit lists no outputs while it has no audio switch: a start dropped behind a stop.
    getAudioOutputs: async () => (fake.audio.starts >= fake.audio.startsToTake ? fake.audio.outputs : []),
    selectAudioOutput: async (id: string) => { fake.audio.calls.push(`select:${id}`); },
  },
}));
vi.mock('livekit-client', () => ({ Room: fake.FakeRoom, RoomEvent: fake.RoomEvent, setLogLevel: () => {} }));
vi.mock('../src/lib/socket', () => ({
  parkVoiceAgain: () => { fake.askAgain.calls++; return fake.askAgain.ok; },
  parkVoiceOpen: (open: boolean) => { fake.told.push(open); return true; },
}));
vi.mock('../src/lib/storage', () => ({
  getParkMuted: async () => [], setParkMuted: async () => {},
  getParkVoiceOpen: async () => false, setParkVoiceOpen: async (open: boolean) => { fake.kept.push(open); },
}));

const { MIC_TRIES, NEVER_ON_TRIES, RETRY_MS, VOICE_UNREACHABLE, micRefused, outputFor, startVoice } = await import('../src/features/world/voice-room');
const { useParkVoice } = await import('../src/features/world/park-voice');

const sim = { get: () => ({ x: 0, z: 0 }) } as never;
const pass = (token: string) => ({
  url: 'ws://voice.test', room: 'park-cubbon', token, identity: 'me', bench: false, canTalk: true,
});
/** Let the awaited steps of a connect run, without moving the clock. */
const settle = () => vi.advanceTimersByTimeAsync(0);

describe('voice after the voice server was lost', () => {
  let stop: () => void = () => {};
  beforeEach(() => {
    vi.useFakeTimers();
    fake.FakeRoom.made = [];
    fake.FakeRoom.unreachable = false;
    fake.askAgain.calls = 0;
    fake.askAgain.ok = true;
    fake.told.length = 0;
    fake.kept.length = 0;
    fake.audio.calls.length = 0;
    fake.audio.outputs = ['earpiece', 'speaker'];
    fake.audio.startsToTake = 1;
    fake.audio.starts = 0;
    useParkVoice.setState({ pass: null, micOn: false, hearing: true, open: false, muted: [], speaking: new Set(), link: 'off', everOn: false, micDenied: false });
  });
  afterEach(() => { stop(); vi.useRealTimers(); });

  it('plays out of the loudspeaker, never the earpiece -- and goes back to it when the mic comes on', async () => {
    stop = startVoice(sim);
    useParkVoice.getState().gotPass(pass('t1'));
    await settle();
    expect(useParkVoice.getState().link).toBe('on');
    const configure = fake.audio.calls.findIndex((c) => c.startsWith('configure:'));
    expect(configure, 'the session started with the earpiece allowed').toBeGreaterThanOrEqual(0);
    expect(configure).toBeLessThan(fake.audio.calls.indexOf('start'));
    expect(fake.audio.calls[configure]).not.toContain('earpiece');
    expect(fake.audio.calls, 'joined without choosing the loudspeaker').toContain('select:speaker');
    // The mic on: Android moves the sound to the earpiece, and the code moves it back.
    fake.audio.calls.length = 0;
    useParkVoice.getState().setMic(true);
    await vi.advanceTimersByTimeAsync(300);
    expect(fake.audio.calls, 'left in the earpiece after the mic came on').toContain('select:speaker');
  });

  it('keeps the phone\'s audio session across a change of room, and stops it only when voice ends', async () => {
    // Stopped and started again for the bench's room, LiveKit dropped the start behind its
    // queued stop and the phone had no audio switch at all: the earpiece (2026-10-03).
    stop = startVoice(sim);
    useParkVoice.getState().gotPass(pass('t1'));
    await settle();
    // From here: the last test's own stop, finishing late, is not this one's.
    fake.audio.calls.length = 0;
    useParkVoice.getState().gotPass({ ...pass('t2'), room: 'bench-1', bench: true });
    await settle();
    expect(fake.FakeRoom.made).toHaveLength(2);
    expect(fake.audio.calls.filter((c) => c === 'stop'), 'stopped for a change of room').toHaveLength(0);
    useParkVoice.getState().left();
    await settle();
    expect(fake.audio.calls.filter((c) => c === 'stop'), 'not stopped when voice ended').toHaveLength(1);
  });

  it('starts the audio session again when the first start was dropped', async () => {
    fake.audio.startsToTake = 2;
    stop = startVoice(sim);
    useParkVoice.getState().gotPass(pass('t1'));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fake.audio.calls.filter((c) => c === 'start'), 'never started again').toHaveLength(2);
    expect(useParkVoice.getState().link).toBe('on');
    expect(fake.audio.calls, 'no loudspeaker once it had started').toContain('select:speaker');
  });

  it('prefers what is worn: bluetooth, then a headset, then the loudspeaker; never the earpiece', () => {
    expect(outputFor(['earpiece', 'speaker', 'bluetooth', 'headset'])).toBe('bluetooth');
    expect(outputFor(['earpiece', 'headset', 'speaker'])).toBe('headset');
    expect(outputFor(['earpiece', 'speaker'])).toBe('speaker');
    expect(outputFor(['earpiece'])).toBeNull();
  });

  it('tells the park, and keeps on this phone, "Talk with people nearby" as it changes', async () => {
    stop = startVoice(sim);
    useParkVoice.getState().setOpen(true);
    useParkVoice.getState().setOpen(false);
    await settle();
    expect(fake.told, 'the park was not told').toEqual([true, false]);
    expect(fake.kept, 'the phone did not keep it').toEqual([true, false]);
  });

  it('asks the park for a fresh pass, sooner first, and comes back on it', async () => {
    stop = startVoice(sim);
    useParkVoice.getState().gotPass(pass('t1'));
    await settle();
    expect(useParkVoice.getState().link).toBe('on');

    fake.FakeRoom.made.at(-1)!.lose();
    expect(useParkVoice.getState().link, 'a loss that says nothing').toBe('failed');
    await vi.advanceTimersByTimeAsync(RETRY_MS[0]! - 1);
    expect(fake.askAgain.calls, 'asked before the first step').toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.askAgain.calls, 'never asked the park for a fresh pass').toBe(1);

    // The fresh pass comes, and the voice server is back: on, and no more asking.
    useParkVoice.getState().gotPass(pass('t2'));
    await settle();
    expect(useParkVoice.getState().link).toBe('on');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fake.askAgain.calls).toBe(1);
  });

  it('keeps asking, further apart, while the voice server stays out of reach -- and says so', async () => {
    stop = startVoice(sim);
    useParkVoice.getState().gotPass(pass('t1'));
    await settle();
    fake.FakeRoom.unreachable = true;
    fake.FakeRoom.made.at(-1)!.lose();
    let at = 0;
    for (let i = 0; i < RETRY_MS.length + 1; i++) {
      const wait = RETRY_MS[Math.min(i, RETRY_MS.length - 1)]!;
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(fake.askAgain.calls, `asked early, try ${i + 1}`).toBe(i);
      await vi.advanceTimersByTimeAsync(1);
      at += wait;
      expect(fake.askAgain.calls, `not asked at ${at} ms`).toBe(i + 1);
      // Each ask brings a pass, whose connect fails: still "failed", on screen.
      useParkVoice.getState().gotPass(pass(`t${i + 2}`));
      await settle();
      expect(useParkVoice.getState().link).toBe('failed');
    }
  });

  // The founder's friend, on the release app over the internet (2026-09-30): the voice
  // server's address is the laptop's own, so her phone could never reach it, and "Voice
  // lost. Trying again..." sat over the park for good. Negative control, run by hand: the
  // give-up branch taken out of the failed connect -> this fails.
  // Two quiet tries (seven seconds) ended voice for the session on the Seeker after a
  // flaky start (2026-10-03). Negative control, run by hand: NEVER_ON_TRIES back at 2 ->
  // this fails.
  it('gives a slow start most of twenty seconds before giving voice up for the session', () => {
    const quiet = RETRY_MS.slice(0, NEVER_ON_TRIES - 1).reduce((a, b) => a + b, 0);
    expect(quiet).toBeGreaterThanOrEqual(15_000);
    expect(quiet).toBeLessThanOrEqual(20_000);
  });

  it('on a phone that never reached the voice server, tries quietly, then goes on with typing', async () => {
    stop = startVoice(sim);
    fake.FakeRoom.unreachable = true;
    useParkVoice.getState().gotPass(pass('t1'));
    await settle();
    expect(useParkVoice.getState().link, 'said "Voice lost" when nothing was lost').toBe('connecting');
    for (let i = 1; i < NEVER_ON_TRIES; i++) {
      await vi.advanceTimersByTimeAsync(RETRY_MS[i - 1]!);
      useParkVoice.getState().gotPass(pass(`t${i + 1}`));
      await settle();
    }
    expect(useParkVoice.getState().link, 'never gave up').toBe('unavailable');
    const asked = fake.askAgain.calls;
    const rooms = fake.FakeRoom.made.length;
    await vi.advanceTimersByTimeAsync(120_000);
    useParkVoice.getState().left();
    useParkVoice.getState().gotPass(pass('walked in again'));
    await settle();
    expect(fake.askAgain.calls, 'kept asking the park').toBe(asked);
    expect(fake.FakeRoom.made, 'tried again on the next pass').toHaveLength(rooms);
    expect(useParkVoice.getState().link).toBe('unavailable');
  });

  it('takes the pass straight back up when started again, rather than waiting for the next walk in', async () => {
    stop = startVoice(sim);
    useParkVoice.getState().gotPass(pass('t1'));
    await settle();
    stop();
    expect(fake.FakeRoom.made.at(-1)!.state, 'the room kept after stopping').toBe('disconnected');
    expect(useParkVoice.getState().link).toBe('off');
    stop = startVoice(sim);
    await settle();
    expect(fake.FakeRoom.made, 'no new connect on starting again').toHaveLength(2);
    expect(useParkVoice.getState().link).toBe('on');
  });

  it('does not count its own disconnects as a loss, and asks for nothing once stopped', async () => {
    stop = startVoice(sim);
    useParkVoice.getState().gotPass(pass('t1'));
    await settle();
    // Sitting down: a pass for another room -- the old room is let go on purpose.
    useParkVoice.getState().gotPass({ ...pass('t2'), room: 'bench-x', bench: true });
    await settle();
    expect(useParkVoice.getState().link).toBe('on');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fake.askAgain.calls).toBe(0);
    // Lost, then stopped (walking out) before the first try.
    fake.FakeRoom.made.at(-1)!.lose();
    stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fake.askAgain.calls).toBe(0);
  });
});

describe('the mic, switched on', () => {
  // The Pixel, 2026-10-02: allowing the mic put Android's box over the app, the voice link
  // reconnected under it, the first publish was cancelled, and the park said "Mic not
  // allowed" a second after the person had allowed it.
  let stop: () => void = () => {};
  beforeEach(() => {
    vi.useFakeTimers();
    fake.FakeRoom.made = [];
    fake.FakeRoom.unreachable = false;
    useParkVoice.setState({ pass: null, micOn: false, hearing: true, open: false, muted: [], speaking: new Set(), link: 'off', everOn: false, micDenied: false });
  });
  afterEach(() => { stop(); vi.useRealTimers(); });

  /** On, with the room's mic failing in the given ways, in order, and then working. */
  async function micWith(...fails: Error[]) {
    stop = startVoice(sim);
    useParkVoice.getState().gotPass(pass('t1'));
    await settle();
    const calls: boolean[] = [];
    const left = [...fails];
    fake.FakeRoom.made.at(-1)!.localParticipant.setMicrophoneEnabled = async (on: boolean) => {
      calls.push(on);
      const err = left.shift();
      if (err) throw err;
    };
    useParkVoice.getState().setMic(true);
    await vi.advanceTimersByTimeAsync(2_000);
    return calls;
  }
  const named = (name: string, message: string) => Object.assign(new Error(message), { name });

  it('comes on after a publish cancelled by a reconnect, and never says "not allowed"', async () => {
    const calls = await micWith(new Error('Cancelled publication by calling unpublish'));
    expect(useParkVoice.getState().micDenied, 'a cancelled publish was called a refusal').toBe(false);
    expect(useParkVoice.getState().micOn).toBe(true);
    expect(calls, 'it was not tried again').toEqual([true, true]);
  });

  it('says "not allowed" when the phone refused it', async () => {
    await micWith(named('NotAllowedError', 'Permission denied'));
    expect(useParkVoice.getState().micDenied).toBe(true);
    expect(micRefused(new Error('Permission denied by system'))).toBe(true);
    expect(micRefused(new Error('Cancelled publication by calling unpublish'))).toBe(false);
  });

  it('gives up after a few tries and is simply off, to be tapped again', async () => {
    const calls = await micWith(...Array.from({ length: 10 }, () => new Error('engine closed')));
    expect(calls.filter(Boolean).length, 'tries to switch it on').toBe(MIC_TRIES);
    expect(useParkVoice.getState().micOn).toBe(false);
    expect(useParkVoice.getState().micDenied).toBe(false);
  });
});

describe('the red boxes a debug build shows', () => {
  // As LogBox showed them on the Seeker (2026-09-29): the message, then LiveKit's context.
  const ctx = ' {"room":"park-cubbon","roomID":"RM_t7SFEQYbmMWa","participant":"429f363c96096f40465ec3e4"}';
  const ignored = (m: string) => VOICE_UNREACHABLE.some((r) => r.test(m));
  it('leave out LiveKit on a voice room, in every wording seen, park or bench', () => {
    for (const m of [
      `fetch failed: java.net.ConnectException: Failed to connect to localhost/127.0.0.1:7880${ctx}`,
      `fetch failed: java.io.IOException: unexpected end of stream on http://localhost:7880/...${ctx}`,
      `error reading from signal stream${ctx}`,
      `Received leave request while trying to (re)connect${ctx}`,
      'could not establish signal connection {"room":"bench-ae13a18429f1ffa4ab368f88","roomID":"RM_x"}',
      '[voice] could not connect could not establish signal connection: fetch failed',
    ]) expect(ignored(m), m).toBe(true);
  });
  it('keep the app\'s own failures, which name no voice room', () => {
    expect(ignored('fetch failed: java.net.ConnectException: Failed to connect to 0a70.ngrok-free.app')).toBe(false);
    expect(ignored('TypeError: undefined is not a function')).toBe(false);
  });
});
