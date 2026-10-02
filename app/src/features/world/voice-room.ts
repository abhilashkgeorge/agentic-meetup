/**
 * The park's voice on the voice server (LiveKit): into the room a pass is for, the mic
 * on and off, whom to listen to and how loud, who may listen -- as park-voice.ts decides.
 *
 * LOADED LATE. The LiveKit packages are a native module and the WebRTC engine under it;
 * they are imported the first time there is a pass, inside a try (tests/native-imports):
 * a build made before voice was added loses voice, and keeps the park and its typing.
 *
 * FOLLOWS THE STORES. A new pass (walking in, sitting, getting up, a voice ban) moves the
 * phone to its room; the people frame (four a second), your switches and your mutes are
 * applied as they change, and your distance to everybody every quarter second.
 */
import { AppState, LogBox, PermissionsAndroid, Platform } from 'react-native';
import type { WorldSim } from './sim';
import { parkVoiceAgain, parkVoiceOpen } from '../../lib/socket';
import { getParkMuted, getParkVoiceOpen, setParkMuted, setParkVoiceOpen } from '../../lib/storage';
import { useParkLive } from './park-live';
import { mayHearMe, speakingRefs, useParkVoice, voicesToHear, type VoicePass } from './park-voice';

type Lib = { rn: typeof import('@livekit/react-native'); lk: typeof import('livekit-client') };
type Room = import('livekit-client').Room;

/**
 * What LiveKit, and this file, say when the voice server is out of reach -- a phone off
 * its cable, off the Wi-Fi, the server restarting. It is handled below (a fresh pass,
 * again and again) and said on screen ("Voice lost. Trying again…"), so a debug build
 * need not also turn each into a red box. LiveKit words it many ways (four seen on the
 * Seeker in one afternoon), but always names the voice room it was in; so its messages
 * about a park or bench room are kept off the screen -- they still print in the bundler's
 * log -- and the app's own errors, which name no voice room, still show.
 */
export const VOICE_UNREACHABLE: RegExp[] = [
  /"room":"(park-|bench-)/,
  /^\[voice\] could not connect/,
];

/** How long to wait before each fresh try after losing the voice server; the last repeats. */
export const RETRY_MS = [2_000, 5_000, 10_000, 20_000, 30_000];

/**
 * How many times a phone that has NEVER reached the voice server tries, quietly, before it
 * goes on with typing for the rest of the session. The voice server's address is handed
 * out as the laptop's own (ws://localhost:7880, down the USB cable): a phone on the
 * internet -- the founder's friend, on the release app, 2026-09-30 -- can never reach it,
 * and "Voice lost. Trying again..." stayed over the park for good. Lost after it was on,
 * it still says so and keeps trying (RETRY_MS).
 */
export const NEVER_ON_TRIES = 2;

/**
 * WHY THE MIC DID NOT COME ON: the phone refused it, or something passing. Allowing the
 * mic puts Android's box over the app, the voice link reconnects under it, and the first
 * publish is cancelled -- "Cancelled publication by calling unpublish" -- which was shown
 * as "Mic not allowed" a second after the person had allowed it (the Pixel, 2026-10-02).
 * Only a refusal says that now. Anything else is tried again on the next tick, up to
 * MIC_TRIES times, and then the mic is simply off, to be tapped again.
 */
export const MIC_TRIES = 3;
export function micRefused(err: { name?: string; message?: string }): boolean {
  return err.name === 'NotAllowedError' || err.name === 'SecurityError'
    || /permission|not allowed/i.test(err.message ?? '');
}
/**
 * THE LOUDSPEAKER, NEVER THE EARPIECE.
 *
 * WHAT WAS WRONG (the Pixel, 2026-10-03, read off Android's own audio log): turning the mic
 * on puts the phone in call mode, and Android moved the sound to the EARPIECE -- the tiny
 * speaker you hold to your ear -- at 04:05:38, and left it there. Held in front of you,
 * the other person was as good as silent. Leaving the park's screen and coming back
 * started voice afresh, on the loudspeaker: the founder's "the voice was not working
 * unless I moved to a different screen and came back" (yesterday's log: earpiece, then
 * loudspeaker at 23:06:53, when he came back).
 *
 * NOW: the earpiece is not on the list LiveKit chooses from, and the output is chosen
 * again by hand whenever the mic comes on or a room is joined: a headset or bluetooth if
 * one is connected, else the loudspeaker (`outputFor`).
 */
export const OUTPUTS = ['bluetooth', 'headset', 'speaker'] as const;
export function outputFor(available: readonly string[]): string | null {
  return OUTPUTS.find((o) => available.includes(o)) ?? null;
}

let lib: Promise<Lib | null> | null = null;

function load(): Promise<Lib | null> {
  return lib ??= (async () => {
    try {
      const rn = await import('@livekit/react-native');
      // Before livekit-client is touched: WebRTC's globals, the phone's audio session.
      rn.registerGlobals();
      const lk = await import('livekit-client');
      // At its default, "info", it prints the connection's statistics every half minute,
      // forty lines at a time (seen on the Seeker, 2026-09-29): warnings and errors only.
      lk.setLogLevel('warn');
      LogBox.ignoreLogs(VOICE_UNREACHABLE);
      return { rn, lk };
    } catch (err) {
      console.warn('[voice] not in this build', (err as Error).message);
      return null;
    }
  })();
}

let asking = false;

/**
 * Whether the phone's "Allow the mic?" is up. On Android it pauses the app, and React
 * Native calls a pause "background": without this, asking for the mic walked you out of
 * the park (park-presence.ts), and out of whatever you were doing with somebody.
 */
export function askingForMic(): boolean {
  return asking;
}

/**
 * Ask for the mic, on Android, the first time it is switched on: true if allowed. iOS
 * asks by itself the first time the mic opens (app.json says why).
 */
export async function askForMic(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const mic = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
  if (await PermissionsAndroid.check(mic)) return true;
  asking = true;
  try {
    const r = await PermissionsAndroid.request(mic, {
      title: 'Talk out loud in the park',
      message: 'Only while your mic button is on. Nothing you say is recorded.',
      buttonPositive: 'Allow',
      buttonNegative: 'Not now',
    });
    return r === PermissionsAndroid.RESULTS.GRANTED;
  } finally {
    // The app comes back to the front a moment after the answer: still asking till then.
    setTimeout(() => { asking = false; }, 1500);
  }
}

/** Out of the loudspeaker (or what is worn), never the earpiece: see OUTPUTS. Android only. */
async function toSpeaker(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const loaded = await load();
  if (!loaded) return;
  try {
    const pick = outputFor(await loaded.rn.AudioSession.getAudioOutputs());
    if (pick) await loaded.rn.AudioSession.selectAudioOutput(pick);
  } catch (err) {
    console.warn('[voice] output', (err as Error).message);
  }
}

/** What voice-room keeps between calls: the room, which pass it is for, what was applied. */
interface Link {
  room: Room;
  pass: VoicePass;
  allowed: string;
  mic: boolean;
  /** The volume each voice was last set to: set again only when it moves. */
  volumes: Map<string, number>;
}

/**
 * Voice in the park while `inPark`: joins and leaves with the passes, applies the
 * switches. Returns the way to stop it all.
 */
export function startVoice(venueSim: WorldSim): () => void {
  let link: Link | null = null;
  let wanted: VoicePass | null = null;
  // Each connect is numbered: a pass that came while one was connecting wins.
  let gen = 0;
  let stopped = false;
  // Lost the voice server (LiveKit's own reconnecting gave up, or a connect failed): ask
  // the park for a fresh pass -- the old one may have run out -- sooner first, then every
  // half minute, for as long as there is a pass to be had.
  let retries = 0;
  let neverOnFails = 0;
  /** Mic switches that failed in a row, for something other than a refusal (MIC_TRIES). */
  let micFails = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const retryLater = () => {
    if (stopped || !wanted || retryTimer) return;
    const wait = RETRY_MS[Math.min(retries, RETRY_MS.length - 1)]!;
    retries++;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (stopped || !wanted || link) return;
      if (!parkVoiceAgain()) retryLater();
    }, wait);
  };
  const noRetry = () => {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    retries = 0;
  };

  const apply = () => {
    const l = link;
    if (!l || l.room.state !== 'connected') return;
    const v = useParkVoice.getState();
    const live = useParkLive.getState();
    const me = venueSim.get('you');
    // AWAY (another tab, within the grace: park-presence.ts) you neither hear nor are
    // heard: the park is not on your screen, so nobody should be talking into your
    // pocket, nor you into theirs. Back, both come back as they were.
    const hear = live.away ? new Map<string, number>()
      : voicesToHear(l.pass, live.people, me ? { x: me.x, z: me.z } : null, new Set(v.muted), v.hearing, live.partner?.ref ?? null);
    for (const p of l.room.remoteParticipants.values()) {
      const volume = hear === 'all' ? 1 : hear.get(p.identity) ?? 0;
      for (const pub of p.audioTrackPublications.values()) {
        if (pub.isDesired !== volume > 0) pub.setSubscribed(volume > 0);
      }
      const was = l.volumes.get(p.identity) ?? -1;
      if (volume > 0 && Math.abs(volume - was) > 0.02) { p.setVolume(volume); l.volumes.set(p.identity, volume); }
      if (volume === 0) l.volumes.delete(p.identity);
    }
    const allow = mayHearMe(l.pass, live.people);
    const key = allow === 'all' ? '*' : allow.join(',');
    if (key !== l.allowed) {
      l.allowed = key;
      l.room.localParticipant.setTrackSubscriptionPermissions(
        allow === 'all',
        allow === 'all' ? [] : allow.map((participantIdentity) => ({ participantIdentity, allowAll: true })),
      );
    }
    const mic = v.micOn && l.pass.canTalk && !live.away;
    if (mic !== l.mic) {
      l.mic = mic;
      l.room.localParticipant.setMicrophoneEnabled(mic, { echoCancellation: true, noiseSuppression: true, autoGainControl: true })
        // The mic on is the moment Android moves the sound to the earpiece: back out.
        .then(() => { micFails = 0; if (mic) void toSpeaker(); })
        .catch((err: Error) => {
          console.warn('[voice] mic', err.message);
          if (micRefused(err)) { micFails = 0; useParkVoice.getState().setMicDenied(true); return; }
          if (++micFails >= MIC_TRIES) { micFails = 0; useParkVoice.getState().setMic(false); return; }
          // Not applied after all: the next tick (a quarter second) tries again.
          if (link === l) l.mic = !mic;
        });
    }
  };

  const leave = async () => {
    const l = link;
    link = null;
    if (!l) return;
    await l.room.disconnect().catch(() => {});
    const loaded = await load();
    await loaded?.rn.AudioSession.stopAudioSession().catch(() => {});
  };

  const join = async (pass: VoicePass) => {
    // Given up on this session (never reached), or a build with no voice: typing only.
    if (useParkVoice.getState().link === 'unavailable') return;
    const my = ++gen;
    const loaded = await load();
    if (!loaded) { useParkVoice.getState().setLink('unavailable'); return; }
    await leave();
    if (my !== gen || stopped) return;
    const { rn, lk } = loaded;
    // Lost and trying again, it stays "failed" -- and says so -- until it is back.
    if (useParkVoice.getState().link !== 'failed') useParkVoice.getState().setLink('connecting');
    // The earpiece is not an output the park may choose (OUTPUTS); set before the session starts.
    if (Platform.OS === 'android') {
      await rn.AudioSession.configureAudio({
        android: { preferredOutputList: [...OUTPUTS], audioTypeOptions: rn.AndroidAudioTypePresets.communication },
      }).catch(() => {});
    }
    await rn.AudioSession.startAudioSession().catch(() => {});
    const room = new lk.Room({ adaptiveStream: false, dynacast: false, disconnectOnPageLeave: false });
    const l: Link = { room, pass, allowed: '', mic: false, volumes: new Map() };
    room
      // Somebody new publishes a voice, or a track arrives: whether to take it, how loud.
      .on(lk.RoomEvent.TrackPublished, apply)
      .on(lk.RoomEvent.TrackSubscribed, apply)
      .on(lk.RoomEvent.ParticipantConnected, apply)
      .on(lk.RoomEvent.ActiveSpeakersChanged, (speakers) => {
        const live = useParkLive.getState();
        useParkVoice.getState().setSpeaking(speakingRefs(speakers.map((s) => s.identity), pass, live.people, live.partner?.ref ?? null));
      })
      .on(lk.RoomEvent.Reconnecting, () => useParkVoice.getState().setLink('connecting'))
      .on(lk.RoomEvent.Reconnected, () => { useParkVoice.getState().setLink('on'); l.allowed = ''; l.volumes.clear(); apply(); })
      .on(lk.RoomEvent.Disconnected, () => {
        // Not one this code asked for (leave() lets go of the link first): lost.
        if (link?.room !== room) return;
        link = null;
        useParkVoice.getState().setLink('failed');
        useParkVoice.getState().setSpeaking(new Set());
        retryLater();
      });
    try {
      await room.connect(pass.url, pass.token, { autoSubscribe: false });
    } catch (err) {
      console.warn('[voice] could not connect', (err as Error).message);
      if (my !== gen) return;
      const v = useParkVoice.getState();
      if (!v.everOn && ++neverOnFails >= NEVER_ON_TRIES) { noRetry(); v.setLink('unavailable'); return; }
      // Never on yet: still "connecting", not "Voice lost" -- nothing was lost.
      v.setLink(v.everOn ? 'failed' : 'connecting');
      retryLater();
      return;
    }
    if (my !== gen || stopped) { await room.disconnect().catch(() => {}); return; }
    link = l;
    noRetry();
    useParkVoice.getState().setLink('on');
    void toSpeaker();
    apply();
  };

  // A new pass: a new room, or the same room as somebody who may or may not speak. The
  // same pass again (a reconnect of the park socket) changes nothing.
  const onPass = (pass: VoicePass | null) => {
    if (!pass) { wanted = null; gen++; noRetry(); void leave().then(() => { if (!stopped) useParkVoice.getState().setSpeaking(new Set()); }); return; }
    if (wanted && wanted.room === pass.room && wanted.identity === pass.identity && wanted.canTalk === pass.canTalk && link) {
      wanted = pass;
      return;
    }
    wanted = pass;
    void join(pass);
  };
  onPass(useParkVoice.getState().pass);
  // Your mutes and "Talk with people nearby", as this phone kept them; kept again, and the
  // choice told to the park, whenever they change.
  void getParkMuted().then((refs) => { if (!stopped && refs.length) useParkVoice.getState().setMuted(refs); });
  void getParkVoiceOpen().then((open) => { if (!stopped && open) useParkVoice.getState().setOpen(true); });
  const unVoice = useParkVoice.subscribe((s, prev) => {
    if (s.muted !== prev.muted) void setParkMuted(s.muted);
    if (s.open !== prev.open) { void setParkVoiceOpen(s.open); parkVoiceOpen(s.open); }
    if (s.pass !== prev.pass) onPass(s.pass);
    else if (s.micOn !== prev.micOn || s.hearing !== prev.hearing || s.muted !== prev.muted) apply();
  });
  const unLive = useParkLive.subscribe((s, prev) => { if (s.people !== prev.people || s.away !== prev.away) apply(); });
  // Your own steps change how loud everybody is, between their frames.
  const tick = setInterval(apply, 250);
  // Put away, the mic goes with it: the park walks you out (park-presence.ts) and the
  // pass goes; back in front, a fresh pass comes with walking in again. The phone's own
  // "Allow the mic?" is not putting it away.
  const app = AppState.addEventListener('change', (state) => {
    if (state === 'background' && !askingForMic()) useParkVoice.getState().left();
  });

  // Stopping lets go of this room, and only that. Walking out of the park (parkLeave) and
  // putting the phone away (above) are what forget the pass: a restart of this -- a new
  // sim, a hot reload while developing -- takes it straight back up rather than leaving
  // voice off until the next walk in.
  return () => {
    stopped = true;
    gen++;
    noRetry();
    unVoice(); unLive(); clearInterval(tick); app.remove();
    const v = useParkVoice.getState();
    v.setSpeaking(new Set());
    if (v.link !== 'unavailable') v.setLink('off');
    void leave();
  };
}
