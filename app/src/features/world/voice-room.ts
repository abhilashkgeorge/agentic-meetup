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
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import type { WorldSim } from './sim';
import { getParkMuted, setParkMuted } from '../../lib/storage';
import { useParkLive } from './park-live';
import { mayHearMe, speakingRefs, useParkVoice, voicesToHear, type VoicePass } from './park-voice';

type Lib = { rn: typeof import('@livekit/react-native'); lk: typeof import('livekit-client') };
type Room = import('livekit-client').Room;
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

  const apply = () => {
    const l = link;
    if (!l || l.room.state !== 'connected') return;
    const v = useParkVoice.getState();
    const live = useParkLive.getState();
    const me = venueSim.get('you');
    const hear = voicesToHear(l.pass, live.people, me ? { x: me.x, z: me.z } : null, new Set(v.muted), v.hearing);
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
    const mic = v.micOn && l.pass.canTalk;
    if (mic !== l.mic) {
      l.mic = mic;
      l.room.localParticipant.setMicrophoneEnabled(mic, { echoCancellation: true, noiseSuppression: true, autoGainControl: true })
        .catch((err: Error) => { console.warn('[voice] mic', err.message); useParkVoice.getState().setMicDenied(true); });
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
    const my = ++gen;
    const loaded = await load();
    if (!loaded) { useParkVoice.getState().setLink('unavailable'); return; }
    await leave();
    if (my !== gen || stopped) return;
    const { rn, lk } = loaded;
    useParkVoice.getState().setLink('connecting');
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
        if (link?.room !== room) return;
        link = null;
        useParkVoice.getState().setLink('off');
        useParkVoice.getState().setSpeaking(new Set());
      });
    try {
      await room.connect(pass.url, pass.token, { autoSubscribe: false });
    } catch (err) {
      console.warn('[voice] could not connect', (err as Error).message);
      if (my === gen) useParkVoice.getState().setLink('failed');
      return;
    }
    if (my !== gen || stopped) { await room.disconnect().catch(() => {}); return; }
    link = l;
    useParkVoice.getState().setLink('on');
    apply();
  };

  // A new pass: a new room, or the same room as somebody who may or may not speak. The
  // same pass again (a reconnect of the park socket) changes nothing.
  const onPass = (pass: VoicePass | null) => {
    if (!pass) { wanted = null; gen++; void leave().then(() => { if (!stopped) useParkVoice.getState().setSpeaking(new Set()); }); return; }
    if (wanted && wanted.room === pass.room && wanted.identity === pass.identity && wanted.canTalk === pass.canTalk && link) {
      wanted = pass;
      return;
    }
    wanted = pass;
    void join(pass);
  };
  onPass(useParkVoice.getState().pass);
  // Your mutes, as this phone kept them; kept again whenever they change.
  void getParkMuted().then((refs) => { if (!stopped && refs.length) useParkVoice.getState().setMuted(refs); });
  const unVoice = useParkVoice.subscribe((s, prev) => {
    if (s.muted !== prev.muted) void setParkMuted(s.muted);
    if (s.pass !== prev.pass) onPass(s.pass);
    else if (s.micOn !== prev.micOn || s.hearing !== prev.hearing || s.muted !== prev.muted) apply();
  });
  const unLive = useParkLive.subscribe((s, prev) => { if (s.people !== prev.people) apply(); });
  // Your own steps change how loud everybody is, between their frames.
  const tick = setInterval(apply, 250);
  // Put away, the mic goes with it: the park walks you out (park-presence.ts) and the
  // pass goes; back in front, a fresh pass comes with walking in again. The phone's own
  // "Allow the mic?" is not putting it away.
  const app = AppState.addEventListener('change', (state) => {
    if (state === 'background' && !askingForMic()) useParkVoice.getState().left();
  });

  return () => {
    stopped = true;
    gen++;
    unVoice(); unLive(); clearInterval(tick); app.remove();
    useParkVoice.getState().left();
    void leave();
  };
}
