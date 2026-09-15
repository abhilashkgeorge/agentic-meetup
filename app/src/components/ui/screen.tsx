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
          // Same rule for a screen that does not scroll and has no footer.
          marginBottom: !scroll && !footer && keyboard === 0 ? insets.bottom : 0,
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
        // THE TOP INSET BELONGS TO THE CONTENT, NOT TO THE FRAME -- when there is a
        // scroll view. Putting it here makes the scroll viewport START below the
        // status bar, which does two visible things on a tall inset: it leaves a band
        // of dead space at rest, and it gives the content a hard edge to be clipped
        // against as it scrolls, so text vanishes at that line instead of sliding
        // under the clock the way every other app behaves. On Android the inset is
        // about 24pt and it reads as slightly generous; on an iPhone with a Dynamic
        // Island it is nearer 59 and it reads as broken.
        //
        // A screen that does NOT scroll has nothing to slide under, so it keeps the
        // inset here -- otherwise its first line renders behind the clock.
        paddingTop: scroll ? 0 : insets.top,
        // The keyboard is not free space either. Lifting the whole screen keeps a
        // pinned footer -- which is where the text box usually is -- above it.
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
          // The inset rides on the CONTENT, so the first line clears the clock at rest
          // and passes underneath it on the way up.
          contentContainerStyle={{
            flexGrow: center ? 1 : undefined,
            paddingTop: insets.top + space.sm,
            // AND THE BOTTOM INSET, when nothing else is claiming it.
            //
            // The bottom inset was only ever applied inside the footer, so a screen
            // WITHOUT a footer got none at all and its last card ran under the home
            // indicator -- visible on an iPhone, where that bar is 34pt and sits on
            // top of the content, and invisible on Android's gesture nav. Settings
            // and the profile are both long, footerless screens; both ended flush
            // against the bar.
            //
            // Not added when the keyboard is up: the outer view has already lifted
            // the whole screen by its height, and the home indicator is not there to
            // avoid any more.
            //
            // On a TAB screen this is slack rather than necessity -- the tab bar sits
            // in normal flow and already carries the inset -- but it reads as breathing
            // room above the bar rather than as a gap, so it is not worth the
            // complexity of detecting which kind of screen this is.
            paddingBottom: footer || keyboard > 0 ? 0 : insets.bottom,
          }}
          // Content that scrolls under the status bar should not sit under the
          // scrollbar's idea of the top either.
          scrollIndicatorInsets={{ top: insets.top }}
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
