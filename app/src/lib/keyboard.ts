/**
 * How much of the screen the keyboard is covering.
 *
 * WHY NOT KeyboardAvoidingView. Android draws edge to edge now, so the app's window no
 * longer shrinks when the keyboard opens -- `adjustResize` has nothing to resize and
 * `KeyboardAvoidingView` has nothing to react to. Every screen with a text box had the
 * same fault: tap the box, and the keyboard covers the box.
 *
 * WHY THE HEIGHT LIVES HERE AND NOT IN THE COMPONENT. A per-component listener only
 * learns the height from an event, and a screen that MOUNTS WHILE THE KEYBOARD IS
 * ALREADY UP never gets one -- the first step of onboarding focuses its field on
 * arrival, so the keyboard opens during the navigation and the event is long gone by
 * the time the new screen subscribes. `Keyboard.metrics()` would answer that question
 * on iOS; on Android it returns nothing. The result was a screen stuck at zero while
 * the screen underneath it, mounted earlier, had the correct value.
 *
 * So one subscription, started when this module loads, keeps the current height. A
 * screen mounting at any moment reads what is true right now.
 */
import { useEffect, useState } from 'react';
import { Dimensions, Keyboard, Platform } from 'react-native';

let current = 0;
const listeners = new Set<(h: number) => void>();

const set = (h: number): void => {
  if (h === current) return;
  current = h;
  for (const l of listeners) l(h);
};

// `will` on iOS so the screen moves WITH the keyboard rather than after it; Android
// only has `did`.
Keyboard.addListener(
  Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
  (e) => {
    // MEASURED FROM THE KEYBOARD'S TOP EDGE, not from its reported height.
    //
    // The two disagree. On this device the event reports 307.84, while the gap between
    // the keyboard and the bottom of the window is 361 -- the difference being the
    // navigation bar, which the keyboard also covers but the height does not count.
    // Padding by the reported height left the button sitting eleven pixels under the
    // keyboard: moved, and still hidden.
    //
    // `screenY` is where the keyboard actually starts. Everything below it is covered,
    // whatever the parts are called.
    const windowHeight = Dimensions.get('window').height;
    const fromTopEdge = windowHeight - e.endCoordinates.screenY;
    set(Math.max(fromTopEdge, e.endCoordinates.height));
  },
);
Keyboard.addListener(
  Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
  () => set(0),
);

export function useKeyboardHeight(): number {
  // Seeded from what is currently true, which is the whole point of the module-level
  // value: a screen that arrives late is not stuck at zero.
  const [height, setHeight] = useState(current);

  useEffect(() => {
    setHeight(current);
    listeners.add(setHeight);
    return () => { listeners.delete(setHeight); };
  }, []);

  return height;
}

/**
 * What to pad the bottom of a screen with so the keyboard does not sit on top of it.
 *
 * THE FULL HEIGHT, not the height minus the safe area. The reported keyboard height
 * already spans everything the keyboard covers, the navigation bar included -- so
 * subtracting the inset leaves the content short by exactly that much, which measured
 * as a button sitting 16 pixels under the keyboard's top edge: moved, and still
 * covered.
 *
 * The caller drops its own bottom inset while this is non-zero, since the keyboard is
 * now what occupies that space.
 */
export function useKeyboardPad(): number {
  return useKeyboardHeight();
}
