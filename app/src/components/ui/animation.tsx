/**
 * The moving part of a screen.
 *
 * Onboarding screens are mostly a headline, a box and a lot of nothing -- a tall phone
 * leaves half the screen empty, and empty reads as unfinished. These fill it with
 * something that belongs to the page rather than decorating it.
 *
 * RECOLOURED, NOT JUST DROPPED IN. Every animation here was remapped into the app's own
 * accent before it was saved (see assets/animations). A marketplace Lottie arrives in
 * whatever colours its author chose, and on a surface built from one accent and two
 * greys, a five-colour illustration reads as clip art no matter how good it is.
 *
 * QUIET BY DEFAULT. Low opacity, behind the content, and never in the way of a button.
 * A setup flow is a place somebody is trying to get through; motion should say the app
 * is alive, not ask to be watched.
 */
import LottieView from 'lottie-react-native';
import { View, type ViewStyle } from 'react-native';
import { useKeyboardHeight } from '../../lib/keyboard';

/** Named so a screen asks for a mood rather than remembering a filename. */
const SOURCES = {
  /** A line that moves as though something were being said. */
  speaking: require('../../../assets/animations/wave.json'),
  /** A slow pulse: something present, waiting. */
  alive: require('../../../assets/animations/pulse.json'),
  /** Points finding each other. For anything about two people meeting. */
  connecting: require('../../../assets/animations/network.json'),
  /** Something leaving. For the moment the agent goes out. */
  sending: require('../../../assets/animations/send.json'),
  /** A shutter opening. For photos. */
  camera: require('../../../assets/animations/camera.json'),
  /** A circle going round. For waiting. */
  orbit: require('../../../assets/animations/orbit.json'),
} as const;

export type Mood = keyof typeof SOURCES;

export function Animation({
  mood,
  height = 180,
  opacity = 0.55,
  loop = true,
  style,
}: {
  mood: Mood;
  height?: number;
  /** Deliberately under 1. It sits behind the words, not in front of them. */
  opacity?: number;
  loop?: boolean;
  style?: ViewStyle;
}) {
  // DECORATION YIELDS TO THE KEYBOARD.
  //
  // These are 130 to 200 points of pure atmosphere sitting directly above the thing
  // somebody has to type into. With the keyboard open on a small phone there is not
  // enough height for both, and the loser was the input: on an iPhone XS the birth-year
  // field ended up half underneath the Next button, which is the one element on the
  // screen that must be reachable.
  //
  // Hiding it is the right trade rather than a compromise. The animation exists to
  // make a waiting screen feel alive; a screen with the keyboard up is a screen
  // somebody is already busy with.
  const keyboard = useKeyboardHeight();
  if (keyboard > 0) return null;

  return (
    <View
      // Not touchable: a decoration that swallows taps is a decoration that breaks the
      // screen it was added to.
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ height, alignItems: 'center', justifyContent: 'center', opacity }, style]}
    >
      <LottieView
        source={SOURCES[mood]}
        autoPlay
        loop={loop}
        resizeMode="contain"
        style={{ width: '100%', height: '100%' }}
      />
    </View>
  );
}
