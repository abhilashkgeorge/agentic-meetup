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
 * Negative controls, run by hand and recorded in the commit: retryLater() taken out of the
 * Disconnected handler -> "asks the park for a fresh pass" fails; stopping that forgets the
 * pass (left()) -> "takes the pass straight back up" fails.
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
    localParticipant = { setTrackSubscriptionPermissions: () => {}, setMicrophoneEnabled: async () => {} };
    constructor() { FakeRoom.made.push(this); }
    on(ev: string, fn: (...a: unknown[]) => void) { this.handlers.set(ev, [...(this.handlers.get(ev) ?? []), fn]); return this; }
    emit(ev: string) { for (const fn of this.handlers.get(ev) ?? []) fn([]); }
    async connect() { if (FakeRoom.unreachable) throw new Error('could not establish signal connection'); this.state = 'connected'; }
    async disconnect() { this.state = 'disconnected'; this.emit(RoomEvent.Disconnected); }
    /** The voice server gone: LiveKit's own reconnecting has given up. */
    lose() { this.state = 'disconnected'; this.emit(RoomEvent.Disconnected); }
  }
  return { FakeRoom, RoomEvent, askAgain: { calls: 0, ok: true } };
});

vi.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
  LogBox: { ignoreLogs: () => {} },
  PermissionsAndroid: { PERMISSIONS: {}, RESULTS: {}, check: async () => true, request: async () => 'granted' },
  Platform: { OS: 'android' },
}));
vi.mock('@livekit/react-native', () => ({
  registerGlobals: () => {},
  AudioSession: { startAudioSession: async () => {}, stopAudioSession: async () => {} },
}));
vi.mock('livekit-client', () => ({ Room: fake.FakeRoom, RoomEvent: fake.RoomEvent, setLogLevel: () => {} }));
vi.mock('../src/lib/socket', () => ({ parkVoiceAgain: () => { fake.askAgain.calls++; return fake.askAgain.ok; } }));
vi.mock('../src/lib/storage', () => ({ getParkMuted: async () => [], setParkMuted: async () => {} }));

const { RETRY_MS, startVoice } = await import('../src/features/world/voice-room');
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
    useParkVoice.setState({ pass: null, micOn: false, hearing: true, muted: [], speaking: new Set(), link: 'off', micDenied: false });
  });
  afterEach(() => { stop(); vi.useRealTimers(); });

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
