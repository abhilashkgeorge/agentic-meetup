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
import { PARK_SAY_MAX } from '@clone/shared';
import { parkSay } from '../../lib/socket';
import { useKeyboardHeight } from '../../lib/keyboard';
import { Button, Surface, radius, raised, space, type, usePalette } from '../../components/ui';
import { SafetySheet } from '../safety/safety-sheet';
import type { WorldControl } from './camera';
import { BUBBLE_MS, REFUSAL_TEXT, bubbles, useParkLive, type Line } from './park-live';

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
export function ParkChat({ bottom }: { bottom: number }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  const lines = useParkLive((s) => s.lines);
  const refused = useParkLive((s) => s.refused);
  const clearRefused = useParkLive((s) => s.clearRefused);
  const count = useLiveCount();
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
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', right: space.screen, left: open ? space.screen : undefined, bottom: lift, gap: space.sm, alignItems: 'flex-end' }}>
      {recent.length > 0 && (
        <View pointerEvents="none" style={{ gap: 4, maxWidth: 300, alignSelf: open ? 'stretch' : 'flex-end' }}>
          {recent.map((l) => (
            <Text key={l.id} numberOfLines={2}
                  style={[type.callout, { color: p.text, backgroundColor: p.bg, opacity: 0.92, paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.sm, overflow: 'hidden' }]}>
              <Text style={{ fontFamily: type.bodyStrong.fontFamily }}>{l.ref === 'you' ? 'You: ' : 'Someone nearby: '}</Text>
              {l.text}
            </Text>
          ))}
        </View>
      )}
      {refused && (
        <Text style={[type.callout, { color: p.danger, backgroundColor: p.bg, paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.sm, overflow: 'hidden' }]}>
          {REFUSAL_TEXT[refused]}
        </Text>
      )}
      {open ? (
        <Surface radius={radius.pill} style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', paddingLeft: space.lg, paddingRight: 4, paddingVertical: 4, gap: space.sm }}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={count > 0 ? 'Say something to people near you' : 'Nobody is near enough to hear yet'}
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
