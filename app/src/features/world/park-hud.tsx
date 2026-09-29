/**
 * The park's own parts of the screen, when people are really here: what they say, over
 * their heads and in a short log; a bar to say something yourself; how many people are
 * here in person; and, tapping one of them, a way to block or report them.
 *
 * WHAT IS SAID stays on screen for a few seconds (BUBBLE_MS) over the speaker and in
 * the log, and goes nowhere else: the server keeps no copy (server park/room.ts). Lines
 * are anonymous -- "Someone nearby" -- because a stranger in the park is only a ref.
 */
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Animated, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PARK_QUESTS, PARK_SAY_MAX, PARK_SIGHTS, type ParkQuestId } from '@clone/shared';
import { parkAnswer, parkFind, parkPart, parkSay, parkSit, parkStand } from '../../lib/socket';
import { useKeyboardHeight } from '../../lib/keyboard';
import { Button, Surface, radius, raised, space, type, usePalette } from '../../components/ui';
import { SafetySheet } from '../safety/safety-sheet';
import type { WorldControl } from './camera';
import { BUBBLE_MS, FIND_TEXT, REFUSAL_TEXT, bubbles, nextQuest, questProgress, useParkLive, type Line } from './park-live';
import { STICK_RING } from './stick';
import { benchFor } from './ride';
import type { WorldSim } from './sim';

/** How wide the right-hand column is: clear of the stick, which has the bottom left. */
const DOCK_W = 228;

/** How many people are here in person, you not counted. */
export function useLiveCount(): number {
  return useParkLive((s) => s.people.size);
}

/**
 * What was just said, over the head of whoever said it. The canvas says where each
 * head is on screen (WorldControl.headOnScreen); the bubbles follow it every frame
 * through Animated values, so a walk moves no React state.
 */
export function SpeechBubbles({ control }: { control: MutableRefObject<WorldControl | null> }) {
  const lines = useParkLive((s) => s.lines);
  const [now, setNow] = useState(Date.now());
  // Bubbles come off when their time is up: a tick while any are showing.
  const shown = useMemo(() => bubbles(lines, now), [lines, now]);
  useEffect(() => {
    if (!shown.length) return;
    const t = setTimeout(() => setNow(Date.now()), 500);
    return () => clearTimeout(t);
  }, [shown, now]);
  useEffect(() => setNow(Date.now()), [lines]);
  return (
    <View pointerEvents="none" style={{ position: 'absolute', inset: 0 }}>
      {shown.map((l) => <SpeechBubble key={l.id} line={l} control={control} />)}
    </View>
  );
}

function SpeechBubble({ line, control }: { line: Line; control: MutableRefObject<WorldControl | null> }) {
  const p = usePalette();
  const at = useRef(new Animated.ValueXY({ x: -1000, y: -1000 })).current;
  const fade = useRef(new Animated.Value(0)).current;
  const [width, setWidth] = useState(0);
  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 160, useNativeDriver: true }).start();
    const out = setTimeout(
      () => Animated.timing(fade, { toValue: 0, duration: 300, useNativeDriver: true }).start(),
      Math.max(0, BUBBLE_MS - 400),
    );
    let raf = 0;
    const follow = () => {
      const pt = control.current?.headOnScreen(line.ref);
      if (pt) at.setValue({ x: pt[0] - width / 2, y: pt[1] - 12 });
      else at.setValue({ x: -1000, y: -1000 });
      raf = requestAnimationFrame(follow);
    };
    raf = requestAnimationFrame(follow);
    return () => { cancelAnimationFrame(raf); clearTimeout(out); };
  }, [line, control, at, fade, width]);
  return (
    <Animated.View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{
        position: 'absolute', left: 0, top: 0, maxWidth: 220, opacity: fade,
        transform: [{ translateX: at.x }, { translateY: at.y }, { translateY: -40 }],
      }}
    >
      <View style={{
        paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.md,
        backgroundColor: line.ref === 'you' ? p.accent : p.bg, boxShadow: raised(p, 3),
      }}>
        <Text style={[type.callout, { color: line.ref === 'you' ? p.accentText : p.text }]} numberOfLines={3}>
          {line.text}
        </Text>
      </View>
    </Animated.View>
  );
}

/**
 * Saying something to the people near you: a button that opens a line to type in,
 * the last few things said above it, and why a line was not sent when it was not.
 */
export function ParkChat({ bottom, children }: {
  bottom: number;
  /** What sits between the log and the chat button: finding, the pair, the bench. */
  children?: React.ReactNode;
}) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  const lines = useParkLive((s) => s.lines);
  const refused = useParkLive((s) => s.refused);
  const clearRefused = useParkLive((s) => s.clearRefused);
  const count = useLiveCount();
  const onBench = useParkLive((s) => s.bench !== null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!refused) return;
    const t = setTimeout(clearRefused, 5000);
    return () => clearTimeout(t);
  }, [refused, clearRefused]);
  // The log keeps the last three lines for twice as long as a bubble, then clears.
  const recent = lines.filter((l) => now - l.at < BUBBLE_MS * 2).slice(-3);
  useEffect(() => {
    if (!recent.length) return;
    const t = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(t);
  }, [recent.length, now]);
  useEffect(() => setNow(Date.now()), [lines]);

  const send = () => {
    if (parkSay(text)) setText('');
  };

  const lift = keyboard > 0 ? keyboard + space.sm : bottom;
  // ONE COLUMN on the right, bottom up: the chat button, what you are doing with
  // somebody, what was just said. Kept narrower than the screen less the stick, which
  // has the bottom left; typing, the line takes the whole width over the keyboard.
  return (
    // Open with no keyboard, the line to type in stays right of the stick: full width it
    // lay over the bottom of the stick (on the phone, 2026-09-29). Typing, the keyboard
    // has the bottom of the screen and the line takes the whole width above it.
    <View pointerEvents="box-none" style={{
      position: 'absolute', right: space.screen, bottom: lift, gap: space.sm, alignItems: 'flex-end',
      left: open ? (keyboard > 0 ? space.screen : space.screen + STICK_RING + space.sm) : undefined,
    }}>
      {recent.length > 0 && (
        <View pointerEvents="none" style={{ gap: 4, maxWidth: open ? undefined : DOCK_W, alignSelf: open ? 'stretch' : 'flex-end' }}>
          {recent.map((l) => (
            <Text key={l.id} numberOfLines={2}
                  style={[type.callout, { color: p.text, backgroundColor: p.bg, opacity: 0.92, paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.sm, overflow: 'hidden' }]}>
              <Text style={{ fontFamily: type.bodyStrong.fontFamily }}>
                {l.ref === 'you' ? 'You: ' : l.private ? 'Them: ' : 'Someone nearby: '}
              </Text>
              {l.text}
            </Text>
          ))}
        </View>
      )}
      {refused && (
        <Text style={[type.callout, { color: p.danger, backgroundColor: p.bg, paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.sm, overflow: 'hidden', maxWidth: open ? undefined : DOCK_W }]}>
          {REFUSAL_TEXT[refused]}
        </Text>
      )}
      {keyboard === 0 && children}
      {open ? (
        <Surface radius={radius.pill} style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', paddingLeft: space.lg, paddingRight: 4, paddingVertical: 4, gap: space.sm }}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={onBench ? 'Just the two of you: nobody else can hear'
              : count > 0 ? 'Say something to people near you' : 'Nobody is near enough to hear yet'}
            placeholderTextColor={p.textTertiary}
            style={[type.body, { flex: 1, color: p.text, paddingVertical: 8 }]}
            maxLength={PARK_SAY_MAX}
            autoFocus
            returnKeyType="send"
            onSubmitEditing={send}
            blurOnSubmit={false}
          />
          <Pressable onPress={send} accessibilityRole="button" accessibilityLabel="Send"
                     style={{ paddingHorizontal: space.md, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: text.trim() ? p.accent : p.sunken }}>
            <Text style={[type.callout, { color: text.trim() ? p.accentText : p.textTertiary, fontFamily: type.bodyStrong.fontFamily }]}>Send</Text>
          </Pressable>
          <Pressable onPress={() => { setOpen(false); setText(''); }} accessibilityRole="button" accessibilityLabel="Close chat" hitSlop={8}
                     style={{ paddingHorizontal: space.sm, paddingVertical: 8 }}>
            <Text style={[type.callout, { color: p.textSecondary }]}>✕</Text>
          </Pressable>
        </Surface>
      ) : (
        <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel="Say something"
                   style={{ paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.pill, backgroundColor: p.bg, boxShadow: raised(p, 4), marginBottom: insets.bottom > 0 ? 0 : space.xs }}>
          <Text style={[type.callout, { color: p.text, fontFamily: type.bodyStrong.fontFamily }]}>Say something</Text>
        </Pressable>
      )}
    </View>
  );
}

/**
 * Somebody here in person, tapped: that they are really here, what they just said, and
 * the way to block or report them -- which from the park is by the ref it gave you.
 */
export function LiveSheet({ parkRef, onClose }: { parkRef: string; onClose: () => void }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  // Selected whole and filtered here: a selector that builds a new array each time is
  // a new answer each time, and the store would re-render this for ever.
  const all = useParkLive((s) => s.lines);
  const lines = useMemo(() => all.filter((l) => l.ref === parkRef).slice(-3), [all, parkRef]);
  const here = useParkLive((s) => s.people.has(parkRef));
  const [safety, setSafety] = useState(false);
  return (
    <Pressable onPress={onClose} style={{ position: 'absolute', inset: 0 }} accessibilityLabel="Close">
      <Pressable onPress={() => {}} style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
        <Surface radius={radius.xl} style={{ padding: space.screen, paddingBottom: Math.max(insets.bottom, space.lg), gap: space.md,
                                              borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}>
          <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: p.dark }} />
          <Text style={[type.title, { color: p.text }]}>Someone here in the park</Text>
          <Text style={[type.body, { color: p.textSecondary }]}>
            {here ? 'A real person, walking here right now. Say something and they will hear it if they are close.'
              : 'They have left the park.'}
          </Text>
          {lines.map((l) => (
            <Text key={l.id} style={[type.body, { color: p.text }]}>“{l.text}”</Text>
          ))}
          <Pressable onPress={() => setSafety(true)} accessibilityRole="button" accessibilityLabel="Block or report" hitSlop={8}>
            <Text style={[type.callout, { color: p.textTertiary, textAlign: 'center' }]}>Block or report</Text>
          </Pressable>
          <Button label="Close" variant="ghost" onPress={onClose} />
        </Surface>
      </Pressable>
      {safety && (
        <SafetySheet target={{ parkRef }} onClose={() => setSafety(false)} onDone={onClose} />
      )}
    </Pressable>
  );
}

/**
 * Finding somebody to talk to, and being with them: "Find someone to talk to" while you
 * are free, how the asking is going while it goes, and once somebody says yes, a bar
 * with the bench and the way out.
 */
export function ParkActions({ venueSim, benches }: {
  venueSim: WorldSim;
  benches: readonly { x: number; z: number; rot: number }[];
}) {
  const p = usePalette();
  const finding = useParkLive((s) => s.finding);
  const partner = useParkLive((s) => s.partner);
  const bench = useParkLive((s) => s.bench);
  const people = useParkLive((s) => s.people);
  const setFinding = useParkLive((s) => s.setFinding);
  const [taken] = useState(() => new Set<number>());
  const refused = useParkLive((s) => s.refused);
  // A bench somebody else took is remembered for the next try.
  const lastAsked = useRef<number | null>(null);
  useEffect(() => { if (refused === 'bench_taken' && lastAsked.current !== null) taken.add(lastAsked.current); }, [refused, taken]);
  // An outcome is said for a few seconds, then the button is back.
  useEffect(() => {
    if (!finding || finding.status === 'searching' || finding.status === 'asking') return;
    const t = setTimeout(() => setFinding(null), 4500);
    return () => clearTimeout(t);
  }, [finding, setFinding]);

  const sit = () => {
    const me = venueSim.get('you');
    const them = partner ? people.get(partner.ref) : undefined;
    if (!me || !them) return;
    const b = benchFor(benches, [me.x, me.z], [them.x, them.z], taken);
    if (b === null) return;
    lastAsked.current = b;
    parkSit(b);
  };

  const quests = useParkLive((s) => s.quests);
  const riding = useParkLive((s) => s.riding);
  const next = nextQuest(quests, { bench: bench !== null, riding });
  const card = { paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.lg, backgroundColor: p.bg, boxShadow: raised(p, 4), gap: space.sm, maxWidth: DOCK_W };
  return (
    <View pointerEvents="box-none" style={{ alignItems: 'flex-end', gap: space.sm }}>
      {partner ? (
        <View style={card}>
          {/* SHORT, because it sits over the park beside you: who you are with, the next
              thing to do together, and the buttons. Who can hear you is said where you
              type (the line's own placeholder). */}
          <Text style={[type.bodyStrong, { color: p.text }]}>
            {partner.rideTo ? 'On your way to them…' : bench !== null ? 'On a bench, just you two' : 'Talking with someone'}
          </Text>
          {next && !partner.rideTo && (
            <Text style={[type.callout, { color: p.accent }]} numberOfLines={2}>
              {`Next: ${next.title} · +${next.points}`}
              {(quests?.progress[next.id] ?? 0) > 0 ? ` · ${questProgress(next.id, quests!.progress[next.id]!)}` : ''}
            </Text>
          )}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {bench === null ? (
              <Pill label="Sit on a bench" primary onPress={sit} disabled={!!partner.rideTo} />
            ) : (
              <Pill label="Get up" onPress={parkStand} />
            )}
            <Pill label="End" onPress={parkPart} />
          </View>
        </View>
      ) : finding ? (
        <View style={card}>
          <Text style={[type.callout, { color: p.text }]}>
            {finding.status === 'asking' && finding.why ? `Asking someone who also likes ${finding.why}…` : FIND_TEXT[finding.status]}
          </Text>
          {(finding.status === 'searching' || finding.status === 'asking') && <Pill label="Stop" onPress={parkPart} />}
        </View>
      ) : (
        <Pill label="Find someone to talk to" primary onPress={parkFind} />
      )}
    </View>
  );
}

/**
 * Get on a bicycle, or off it (the founder, 2026-09-29: "bicycles should also be used
 * for travel around the park"). Above the stick, where the thumb already is. Gone while
 * you sit on a bench or a car is taking you: you get off to do either.
 */
export function BikeButton({ bottom, left }: { bottom: number; left: number }) {
  const p = usePalette();
  const riding = useParkLive((s) => s.riding);
  const hidden = useParkLive((s) => s.bench !== null || !!s.partner?.rideTo);
  const setRiding = useParkLive((s) => s.setRiding);
  const pop = useRef(new Animated.Value(1)).current;
  const toggle = () => {
    setRiding(!riding);
    pop.setValue(0.86);
    Animated.spring(pop, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 10 }).start();
  };
  if (hidden) return null;
  return (
    <Animated.View style={{ position: 'absolute', left, bottom, transform: [{ scale: pop }] }}>
      <Pressable onPress={toggle} accessibilityRole="button" accessibilityLabel={riding ? 'Get off the bike' : 'Ride a bike'}
                 style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.lg, paddingVertical: space.sm + 2,
                          borderRadius: radius.pill, backgroundColor: riding ? p.accent : p.bg, boxShadow: raised(p, 4) }}>
        <Text style={{ fontSize: 18 }}>🚲</Text>
        <Text style={[type.callout, { color: riding ? p.accentText : p.text, fontFamily: type.bodyStrong.fontFamily }]}>
          {riding ? 'Get off the bike' : 'Ride a bike'}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

function Pill({ label, onPress, primary, disabled }: { label: string; onPress: () => void; primary?: boolean; disabled?: boolean }) {
  const p = usePalette();
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label}
               style={{ paddingHorizontal: space.lg, paddingVertical: space.sm + 2, borderRadius: radius.pill,
                        backgroundColor: primary ? p.accent : p.bg, boxShadow: primary ? undefined : raised(p, 3), opacity: disabled ? 0.5 : 1 }}>
      <Text style={[type.callout, { color: primary ? p.accentText : p.text, fontFamily: type.bodyStrong.fontFamily }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Somebody here would like to talk: what you share, if you share something you both
 * made public, and yes or not now. Not now is not told as a no to anybody but them,
 * and they are not asked again by the same person for a while (server pairs.ts).
 */
export function InviteCard() {
  const p = usePalette();
  const asked = useParkLive((s) => s.asked);
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(rise, { toValue: asked ? 1 : 0, useNativeDriver: true, speed: 14, bounciness: 6 }).start();
  }, [asked, rise]);
  if (!asked) return null;
  return (
    <Animated.View style={{
      position: 'absolute', left: space.screen, right: space.screen, top: '32%',
      opacity: rise, transform: [{ scale: rise.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }],
    }}>
      <Surface radius={radius.xl} style={{ padding: space.screen, gap: space.md }}>
        <Text style={[type.title, { color: p.text }]}>Someone here would like to talk</Text>
        <Text style={[type.body, { color: p.textSecondary }]}>
          {asked.why ? `You both like ${asked.why}. ` : ''}Are you free? If you say yes, they come over to you.
        </Text>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <View style={{ flex: 1 }}><Button label="Not now" variant="ghost" onPress={() => parkAnswer(false)} /></View>
          <View style={{ flex: 1.3 }}><Button label="Yes, let's talk" variant="primary" onPress={() => parkAnswer(true)} /></View>
        </View>
      </Surface>
    </Animated.View>
  );
}


const QUEST_ICON: Record<ParkQuestId, string> = { hello: '👋', walk: '🚶', ride: '🚲', talk: '🪑', sights: '🗿' };

/**
 * Things to do together in the park today (shared/park-quests.ts): each, how to do it,
 * how far along you are, and the points it pays -- once a day, to both of you. The
 * server decides when each is done (park/quests.ts); this only shows it.
 */
export function QuestsSheet({ onClose }: { onClose: () => void }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const quests = useParkLive((s) => s.quests);
  const partner = useParkLive((s) => s.partner);
  const balance = useParkLive((s) => s.balance);
  const done = new Set(quests?.done ?? []);
  return (
    <Pressable onPress={onClose} style={{ position: 'absolute', inset: 0 }} accessibilityLabel="Close">
      <Pressable onPress={() => {}} style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
        <Surface radius={radius.xl} style={{ padding: space.screen, paddingBottom: Math.max(insets.bottom, space.lg), gap: space.md,
                                              borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}>
          <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: p.dark }} />
          <Text style={[type.title, { color: p.text }]}>Things to do together</Text>
          <Text style={[type.body, { color: p.textSecondary }]}>
            {partner ? 'Do these with the person you are talking to. ' : 'Find someone to talk to first, then do these together. '}
            Each pays you both points once a day, to spend on your look.
            {balance !== null ? ` You have ${balance} points.` : ''}
          </Text>
          {PARK_QUESTS.map((q) => {
            const n = quests?.progress[q.id] ?? 0;
            const finished = done.has(q.id);
            const sights = q.id === 'sights' && quests?.sights.length
              ? PARK_SIGHTS.filter((s) => quests.sights.includes(s.id)).map((s) => s.name).join(', ') : '';
            return (
              <View key={q.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                <Text style={{ fontSize: 22, opacity: finished ? 0.5 : 1 }}>{QUEST_ICON[q.id]}</Text>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={[type.bodyStrong, { color: finished ? p.textSecondary : p.text }]}>{q.title}</Text>
                  <Text style={[type.callout, { color: p.textSecondary }]}>
                    {finished ? 'Done today.' : q.how}{sights ? ` Seen: ${sights}.` : ''}
                  </Text>
                  {!finished && n > 0 && (
                    <View style={{ height: 6, borderRadius: 3, backgroundColor: p.sunken, overflow: 'hidden' }}>
                      <View style={{ width: `${Math.min(100, (n / q.goal) * 100)}%`, height: 6, backgroundColor: p.accent }} />
                    </View>
                  )}
                  {!finished && n > 0 && <Text style={[type.label, { color: p.textTertiary }]}>{questProgress(q.id, n)}</Text>}
                </View>
                <Text style={[type.bodyStrong, { color: finished ? p.success : p.accent }]}>{finished ? '✓' : `+${q.points}`}</Text>
              </View>
            );
          })}
          <Button label="Close" variant="ghost" onPress={onClose} />
        </Surface>
      </Pressable>
    </Pressable>
  );
}

/** How many of today's things to do are done, of how many. */
export function useQuestsDone(): [number, number] {
  const done = useParkLive((s) => s.quests?.done.length ?? 0);
  return [done, PARK_QUESTS.length];
}

const CHEER: Record<ParkQuestId, string> = {
  hello: 'You met someone here',
  walk: 'You walked together',
  ride: 'You rode together',
  talk: 'You sat and talked',
  sights: 'You saw the sights together',
};

/** Something just done together, and what it paid: a moment at the top of the screen. */
export function CheerToast({ top }: { top: number }) {
  const p = usePalette();
  const cheer = useParkLive((s) => s.cheer);
  const clear = useParkLive((s) => s.clearCheer);
  const drop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!cheer) return;
    drop.setValue(0);
    Animated.spring(drop, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 8 }).start();
    const t = setTimeout(() => Animated.timing(drop, { toValue: 0, duration: 260, useNativeDriver: true }).start(() => clear()), 3200);
    return () => clearTimeout(t);
  }, [cheer, drop, clear]);
  if (!cheer) return null;
  return (
    <Animated.View pointerEvents="none" style={{
      position: 'absolute', top, left: space.screen, right: space.screen, alignItems: 'center', opacity: drop,
      transform: [{ translateY: drop.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) }, { scale: drop.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }],
    }}>
      {/* ONE line of text, the mark in it: as an emoji beside a bold line, Android sized
          the pill for less than the line and the last word -- "points" -- went missing
          (on the phone, 2026-09-29). */}
      <View style={{ paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.pill, backgroundColor: p.accent, boxShadow: raised(p, 6) }}>
        <Text style={[type.bodyStrong, { color: p.accentText, textAlign: 'center' }]}>
          {`${QUEST_ICON[cheer.quest]}  ${CHEER[cheer.quest]} · +${cheer.points} points`}
        </Text>
      </View>
    </Animated.View>
  );
}
