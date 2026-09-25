/**
 * "You both said yes", as a moment rather than a notice (build list item 12).
 *
 * DESIGN ONLY, NO NEW DATA: everything here is already on the phone -- their name, their
 * character (and first photo, which the reveal just loaded), and the person's own
 * character from the town. The two characters slide in from the edges and meet in the
 * middle, pop once together over the "connecting" animation, and then the words and
 * "Say hello" rise. Reduce-motion on: it is all simply there (moment.ts).
 *
 * The words are the same for everybody, and say nothing about how the two will get on.
 */
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Dimensions, Easing, Text, View } from 'react-native';
import type { Look } from '../../lib/api';
import { Animation, Button, space, type, usePalette } from '../../components/ui';
import { CharacterAvatar } from '../look/character-avatar';
import { MOMENT_TITLE, momentLine, momentPlan } from './moment';

const SIZE = 96;

export function BothYesMoment({ name, theirLook, myLook, onHello }: {
  name: string | null | undefined;
  theirLook: Look | null | undefined;
  /** From the town, if it has loaded. Without it, their character arrives alone. */
  myLook: Look | null | undefined;
  onHello: () => void;
}) {
  const p = usePalette();
  const width = Dimensions.get('window').width;
  const [ready, setReady] = useState(false);
  const slide = useRef(new Animated.Value(0)).current; // 0 = at the edges, 1 = met
  const pop = useRef(new Animated.Value(1)).current;
  const words = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().catch(() => false).then((reduce) => {
      if (cancelled) return;
      const plan = momentPlan(Boolean(reduce));
      setReady(true);
      if (plan.slideMs === 0) {
        slide.setValue(1); words.setValue(1);
        return;
      }
      Animated.sequence([
        Animated.timing(slide, { toValue: 1, duration: plan.slideMs, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.sequence([
          Animated.timing(pop, { toValue: 1.1, duration: plan.popMs / 2, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(pop, { toValue: 1, duration: plan.popMs / 2, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        ]),
        Animated.timing(words, { toValue: 1, duration: plan.textMs, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]).start();
    });
    return () => { cancelled = true; };
  }, [slide, pop, words]);

  const start = width * momentPlan(false).startShare;
  const both = Boolean(myLook && theirLook);
  // Met: side by side, just touching. Alone: their character comes to the middle.
  const meet = both ? SIZE / 2 - 6 : 0;
  const from = (side: -1 | 1) => slide.interpolate({ inputRange: [0, 1], outputRange: [side * start, side * meet] });

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xl, opacity: ready ? 1 : 0 }}>
      <View style={{ height: SIZE * 1.8, width: '100%', alignItems: 'center', justifyContent: 'center' }}>
        <Animation mood="connecting" height={SIZE * 1.8} opacity={0.35}
                   style={{ position: 'absolute', left: 0, right: 0 }} />
        {myLook && (
          <Animated.View style={{ position: 'absolute', transform: [{ translateX: from(-1) }, { scale: pop }] }}>
            <CharacterAvatar look={myLook} size={SIZE} />
          </Animated.View>
        )}
        {theirLook && (
          <Animated.View style={{ position: 'absolute', transform: [{ translateX: from(1) }, { scale: pop }] }}>
            <CharacterAvatar look={theirLook} size={SIZE} />
          </Animated.View>
        )}
        {!both && !theirLook && <View style={{ width: SIZE, height: SIZE }} />}
      </View>
      <Animated.View style={{
        alignItems: 'center', gap: space.sm, paddingHorizontal: space.screen, opacity: words,
        transform: [{ translateY: words.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
      }}>
        <Text style={[type.display, { color: p.text, textAlign: 'center' }]}>{MOMENT_TITLE}</Text>
        <Text style={[type.body, { color: p.textSecondary, textAlign: 'center' }]}>{momentLine(name)}</Text>
      </Animated.View>
      <Animated.View style={{ alignSelf: 'stretch', paddingHorizontal: space.screen, opacity: words }}>
        <Button label="Say hello" variant="primary" onPress={onHello} />
      </Animated.View>
    </View>
  );
}
