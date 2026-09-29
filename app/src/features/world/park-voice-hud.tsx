/**
 * The park's voice on screen, the way games lay it out (the founder, 2026-09-29: "look
 * into how games like PUBG do it"): a big mic button where the thumb is, a speaker
 * button beside it, a keyboard for typing; a mark over whoever is talking; and a list of
 * the voices near you, each to mute or report.
 *
 *   - THE MIC starts off. Tap: on, and a ring pulses while you talk. Tap: off. Banned
 *     for voice (server park/voice.ts), it stays off and says until when.
 *   - THE SPEAKER opens "Voices near you": hear nobody at all, or mute one person -- the
 *     one marked as talking, found by the colour they wear -- or report them.
 *   - THE KEYBOARD opens the line to type in (park-hud.tsx ParkChat), as before.
 *
 * What decides who hears whom is park-voice.ts; what talks to the voice server is
 * voice-room.ts. This only shows it.
 */
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Animated, Linking, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LOOK_LABELS, OUTFIT_HEX } from '@clone/shared';
import { Button, Surface, radius, raised, space, type, usePalette } from '../../components/ui';
import { SafetySheet } from '../safety/safety-sheet';
import type { WorldControl } from './camera';
import { dockWidth, useParkLive, type LivePerson } from './park-live';
import { banEnds, mayHearMe, micState, useParkVoice } from './park-voice';
import type { WorldSim } from './sim';
import { askForMic } from './voice-room';

/** Whether voice is here at all: a pass from a server with a voice server, in a build with it. */
export function useVoiceHere(): boolean {
  return useParkVoice((s) => s.pass !== null && s.link !== 'unavailable');
}

/** "Someone in coral": the colour they wear is how you find them in a crowd. */
export function wearing(person: LivePerson | undefined): string {
  const name = person ? LOOK_LABELS.outfitColor[person.look.outfitColor] : undefined;
  return name ? `Someone in ${name.toLowerCase()}` : 'Someone nearby';
}

/**
 * The three round buttons, keyboard, speaker, mic, right to left from the mic -- and
 * one line above them saying who can hear you, or why the mic is off.
 */
export function VoiceButtons({ onType, onVoices }: { onType: () => void; onVoices: () => void }) {
  const p = usePalette();
  const pass = useParkVoice((s) => s.pass);
  const state = useParkVoice(micState);
  const hearing = useParkVoice((s) => s.hearing);
  const talking = useParkVoice((s) => s.speaking.has('you'));
  const people = useParkLive((s) => s.people);
  const onBench = useParkLive((s) => s.bench !== null);
  const link = useParkVoice((s) => s.link);
  const dock = dockWidth(useWindowDimensions().width);
  const [hint, setHint] = useState<string | null>(null);
  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(null), 5000);
    return () => clearTimeout(t);
  }, [hint]);

  const listeners = useMemo(() => {
    const allowed = mayHearMe(pass, people);
    return allowed === 'all' ? 1 : allowed.length;
  }, [pass, people]);

  const tapMic = async () => {
    const v = useParkVoice.getState();
    if (state === 'banned') {
      setHint(`Your mic is off until ${banEnds(v.pass?.until)}: people near you reported your voice. You can still type.`);
      return;
    }
    if (state === 'on' || state === 'connecting') { v.setMic(false); return; }
    if (!(await askForMic())) {
      v.setMicDenied(true);
      setHint('The phone said no to the mic. Allow it for Clone in Settings to talk out loud.');
      return;
    }
    v.setMicDenied(false);
    v.setMic(true);
  };

  // A ring that pulses while you are heard talking.
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!talking || state !== 'on') { pulse.stopAnimation(); pulse.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 450, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 450, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [talking, state, pulse]);

  const status = state === 'banned' ? `Mic off until ${banEnds(pass?.until)}`
    : state === 'denied' ? 'Mic not allowed'
      // Lost the voice server: voice-room.ts is trying again by itself.
      : link === 'failed' ? 'Voice lost. Trying again…'
      : onBench ? (state === 'off' ? 'Tap the mic: only they will hear you' : 'Just the two of you can hear this')
        : state === 'on' ? (listeners > 0 ? `Mic on · ${listeners} near enough to hear` : 'Mic on · nobody near enough yet')
          : state === 'connecting' ? 'Connecting your mic…' : null;
  const on = state === 'on' || state === 'connecting';
  const round = (size: number) => ({ width: size, height: size, borderRadius: size / 2, alignItems: 'center' as const, justifyContent: 'center' as const });
  return (
    <View pointerEvents="box-none" style={{ alignItems: 'flex-end', gap: space.xs }}>
      {(hint || status) && (
        <Text numberOfLines={3} style={[type.callout, {
          color: hint || state === 'banned' || state === 'denied' ? p.danger : p.text, backgroundColor: p.bg, opacity: 0.94,
          paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.sm, overflow: 'hidden', maxWidth: dock,
        }]}>
          {hint ?? status}
        </Text>
      )}
      {hint && state === 'denied' && (
        <Pressable onPress={() => void Linking.openSettings()} accessibilityRole="button" accessibilityLabel="Open settings" hitSlop={6}>
          <Text style={[type.callout, { color: p.accent, fontFamily: type.bodyStrong.fontFamily }]}>Open Settings</Text>
        </Pressable>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Pressable onPress={onType} accessibilityRole="button" accessibilityLabel="Type something"
                   style={[round(44), { backgroundColor: p.bg, boxShadow: raised(p, 4) }]}>
          <Text style={{ fontSize: 18 }}>⌨️</Text>
        </Pressable>
        <Pressable onPress={onVoices} accessibilityRole="button" accessibilityLabel={hearing ? 'Voices near you' : 'Voices near you, all silenced'}
                   style={[round(44), { backgroundColor: hearing ? p.bg : p.sunken, boxShadow: raised(p, 4) }]}>
          <Text style={{ fontSize: 18 }}>{hearing ? '🔊' : '🔇'}</Text>
        </Pressable>
        <View style={round(64)}>
          <Animated.View pointerEvents="none" style={[round(64), {
            position: 'absolute', borderWidth: 3, borderColor: p.accent,
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0, 0.9] }),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.22] }) }],
          }]} />
          <Pressable onPress={() => void tapMic()} accessibilityRole="button"
                     accessibilityLabel={on ? 'Mic on. Tap to switch off' : state === 'banned' ? 'Mic off: reported' : 'Mic off. Tap to talk'}
                     style={[round(60), {
                       backgroundColor: on ? p.accent : state === 'banned' || state === 'denied' ? p.sunken : p.bg,
                       boxShadow: raised(p, 5), opacity: state === 'connecting' ? 0.7 : 1,
                     }]}>
            <Text style={{ fontSize: 26 }}>🎙️</Text>
            {!on && (
              // Off: struck through, as a muted mic is drawn everywhere.
              <View pointerEvents="none" style={{ position: 'absolute', width: 40, height: 3, borderRadius: 2, backgroundColor: p.danger, transform: [{ rotate: '-45deg' }] }} />
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/**
 * Over the head of whoever is talking, a speaker that pulses; over whoever you muted, a
 * struck-out one that does not. They follow the heads as the speech bubbles do.
 */
export function VoiceMarks({ control }: { control: MutableRefObject<WorldControl | null> }) {
  const speaking = useParkVoice((s) => s.speaking);
  const muted = useParkVoice((s) => s.muted);
  const people = useParkLive((s) => s.people);
  const marks = useMemo(() => {
    const out: { ref: string; muted: boolean }[] = [];
    for (const ref of people.keys()) {
      if (muted.includes(ref)) out.push({ ref, muted: true });
      else if (speaking.has(ref)) out.push({ ref, muted: false });
    }
    // Your partner, on the bench, is not among the people near (the bench is private).
    for (const ref of speaking) if (ref !== 'you' && !people.has(ref) && !muted.includes(ref)) out.push({ ref, muted: false });
    return out;
  }, [speaking, muted, people]);
  return (
    <View pointerEvents="none" style={{ position: 'absolute', inset: 0 }}>
      {marks.map((m) => <VoiceMark key={m.ref} parkRef={m.ref} muted={m.muted} control={control} />)}
    </View>
  );
}

function VoiceMark({ parkRef, muted, control }: { parkRef: string; muted: boolean; control: MutableRefObject<WorldControl | null> }) {
  const p = usePalette();
  const at = useRef(new Animated.ValueXY({ x: -1000, y: -1000 })).current;
  const beat = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    let raf = 0;
    const follow = () => {
      const pt = control.current?.headOnScreen(parkRef);
      at.setValue(pt ? { x: pt[0] + 8, y: pt[1] - 34 } : { x: -1000, y: -1000 });
      raf = requestAnimationFrame(follow);
    };
    raf = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(raf);
  }, [parkRef, control, at]);
  useEffect(() => {
    if (muted) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(beat, { toValue: 1.25, duration: 300, useNativeDriver: true }),
      Animated.timing(beat, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [muted, beat]);
  return (
    <Animated.View style={{
      position: 'absolute', left: 0, top: 0, width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
      backgroundColor: muted ? p.sunken : p.accent, boxShadow: raised(p, 3),
      transform: [{ translateX: at.x }, { translateY: at.y }, { scale: beat }],
    }}>
      <Text style={{ fontSize: 13 }}>{muted ? '🔇' : '🔊'}</Text>
    </Animated.View>
  );
}

/**
 * Voices near you: hear nobody, or mute or report one person. Talking now first, then
 * the nearest. Muting is yours alone -- they are not told; a report blocks them too.
 */
export function VoicesSheet({ venueSim, onClose }: { venueSim: WorldSim; onClose: () => void }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const hearing = useParkVoice((s) => s.hearing);
  const setHearing = useParkVoice((s) => s.setHearing);
  const muted = useParkVoice((s) => s.muted);
  const toggleMute = useParkVoice((s) => s.toggleMute);
  const speaking = useParkVoice((s) => s.speaking);
  const people = useParkLive((s) => s.people);
  const onBench = useParkLive((s) => s.bench !== null);
  const [reporting, setReporting] = useState<string | null>(null);
  const rows = useMemo(() => {
    const me = venueSim.get('you');
    return [...people.values()]
      .filter((x) => x.voice || muted.includes(x.ref))
      .map((x) => ({ person: x, metres: me ? Math.round((Math.hypot(x.x - me.x, x.z - me.z) * 8.1) / 5) * 5 : null }))
      .sort((a, b) => Number(speaking.has(b.person.ref)) - Number(speaking.has(a.person.ref)) || (a.metres ?? 0) - (b.metres ?? 0))
      .slice(0, 8);
  }, [people, muted, speaking, venueSim]);
  return (
    <Pressable onPress={onClose} style={{ position: 'absolute', inset: 0 }} accessibilityLabel="Close">
      <Pressable onPress={() => {}} style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
        <Surface radius={radius.xl} style={{ padding: space.screen, paddingBottom: Math.max(insets.bottom, space.lg), gap: space.md,
                                              borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}>
          <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: p.dark }} />
          <Text style={[type.title, { color: p.text }]}>Voices near you</Text>
          <Pressable onPress={() => setHearing(!hearing)} accessibilityRole="switch" accessibilityState={{ checked: hearing }}
                     style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space.xs }}>
            <Text style={[type.body, { color: p.text, flex: 1 }]} numberOfLines={1}>{hearing ? '🔊 Hearing people near you' : '🔇 Hearing nobody'}</Text>
            <View style={{ width: 48, height: 28, borderRadius: 14, padding: 3, flexShrink: 0, backgroundColor: hearing ? p.accent : p.sunken, alignItems: hearing ? 'flex-end' : 'flex-start' }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: p.bg }} />
            </View>
          </Pressable>
          {onBench ? (
            <Text style={[type.body, { color: p.textSecondary }]}>
              On the bench it is just the two of you: nobody else can hear you, or you them.
            </Text>
          ) : rows.length === 0 ? (
            <Text style={[type.body, { color: p.textSecondary }]}>Nobody is near enough to hear.</Text>
          ) : rows.map(({ person, metres }) => {
            const isMuted = muted.includes(person.ref);
            const talking = speaking.has(person.ref) && !isMuted;
            return (
              <View key={person.ref} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: OUTFIT_HEX[person.look.outfitColor] ?? p.dark }} />
                <View style={{ flex: 1 }}>
                  <Text style={[type.body, { color: p.text }]} numberOfLines={1}>{wearing(person)}</Text>
                  <Text style={[type.callout, { color: talking ? p.accent : p.textTertiary }]}>
                    {[metres !== null ? `${metres} m` : null, talking ? 'talking now' : isMuted ? 'muted' : null].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Pressable onPress={() => toggleMute(person.ref)} accessibilityRole="button" accessibilityLabel={isMuted ? 'Unmute' : 'Mute'}
                           style={{ paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: isMuted ? p.accent : p.bg, boxShadow: raised(p, 2) }}>
                  <Text style={[type.callout, { color: isMuted ? p.accentText : p.text, fontFamily: type.bodyStrong.fontFamily }]}>{isMuted ? 'Unmute' : 'Mute'}</Text>
                </Pressable>
                <Pressable onPress={() => setReporting(person.ref)} accessibilityRole="button" accessibilityLabel="Report" hitSlop={6}
                           style={{ paddingHorizontal: space.sm, paddingVertical: 6 }}>
                  <Text style={[type.callout, { color: p.danger }]}>Report</Text>
                </Pressable>
              </View>
            );
          })}
          <Text style={[type.callout, { color: p.textTertiary }]}>
            Muting is just for you: they are not told. Reporting blocks them too.
          </Text>
          <Button label="Close" variant="ghost" onPress={onClose} />
        </Surface>
      </Pressable>
      {reporting && (
        <SafetySheet target={{ parkRef: reporting }} aboutVoice onClose={() => setReporting(null)} onDone={() => setReporting(null)} />
      )}
    </Pressable>
  );
}
