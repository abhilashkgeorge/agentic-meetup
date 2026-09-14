/**
 * The page wrapper. Every screen starts here so that background, safe area, keyboard
 * behaviour and the 20pt margin are decided once.
 *
 * Instagram's screens have no visible frame — content runs to the edges and the
 * margin does the work. Here that matters more than usual: a container with its own
 * background would be a second grey, and in neumorphism there is only ever one.
 */
import { type ReactNode } from 'react';
import { RefreshControl, ScrollView, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardPad } from '../../lib/keyboard';
import { space, usePalette } from './theme';

export function Screen({
  children,
  scroll = true,
  onRefresh,
  center,
  padded = true,
  footer,
  style,
}: {
  children: ReactNode;
  scroll?: boolean;
  onRefresh?: () => void;
  /** Vertically centres the content. For short, decisive screens: the door, errors. */
  center?: boolean;
  padded?: boolean;
  /** Pinned to the bottom above the safe area. The one obvious next step. */
  footer?: ReactNode;
  style?: ViewStyle;
}) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  // Android draws edge to edge, so the window no longer shrinks for the keyboard and
  // KeyboardAvoidingView has nothing to react to. The height is read directly instead.
  const keyboard = useKeyboardPad();

  const body = (
    <View
      style={[
        {
          gap: space.lg,
          paddingHorizontal: padded ? space.screen : 0,
          paddingBottom: space.lg,
          // A non-scrolling screen has to FILL, or anything inside it asking for
          // flex:1 -- a message list, an empty state -- collapses to nothing and the
          // screen reads as a void.
          flex: !scroll ? 1 : undefined,
          flexGrow: center ? 1 : undefined,
          justifyContent: center ? 'center' : undefined,
        },
        style,
      ]}
    >
      {children}
    </View>
  );

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: p.bg,
        // The status bar is not free space. Without this the first line of every
        // screen renders behind the clock.
        paddingTop: insets.top,
        // And neither is the keyboard. Lifting the whole screen keeps a pinned footer
        // -- which is where the text box usually is -- above it.
        paddingBottom: keyboard,
      }}
    >
      {scroll ? (
        <ScrollView
          // flex: 1, so the list takes exactly the space left over and no more.
          //
          // Without it the ScrollView sizes to its CONTENT, which on a long screen is
          // taller than the screen -- and because React Native does not clip by
          // default, the footer underneath it was drawn outside the padded area, i.e.
          // underneath the keyboard. The padding was being applied correctly the whole
          // time; the children were simply ignoring it.
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: center ? 1 : undefined, paddingTop: space.sm }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={
            onRefresh ? (
              <RefreshControl refreshing={false} onRefresh={onRefresh} tintColor={p.textTertiary} />
            ) : undefined
          }
        >
          {body}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>{body}</View>
      )}

      {footer && (
        <View
          style={{
            paddingHorizontal: space.screen,
            paddingTop: space.md,
            // The keyboard is standing where the navigation bar was, so its inset is
            // not wanted on top of the lift.
            paddingBottom: keyboard > 0 ? space.lg : Math.max(insets.bottom, space.lg),
            gap: space.sm,
          }}
        >
          {footer}
        </View>
      )}
    </View>
  );
}
