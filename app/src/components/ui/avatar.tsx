/**
 * The visual anchor every list row needs.
 *
 * A screen of grey cards with no faces reads as a wireframe no matter how well the
 * type is set. Instagram's list rows are carried by the circle on the left, and the
 * ring around it is how it shows state without adding a badge.
 *
 * Falls back to initials on a sunken well, so a person with no photo still gets a
 * shape rather than a hole.
 */
import { Image, Text, View } from 'react-native';
import { Orb } from './orb';
import { radius, raised, sunk, type, usePalette } from './theme';

export function Avatar({
  source,
  name,
  size = 52,
  ring,
  loading,
}: {
  /** Carries the credential with it -- see PhotoSlot. */
  source?: { uri: string; headers?: Record<string, string> } | null;
  name?: string | null;
  size?: number;
  /** A coloured ring, Instagram-style: something is new here. */
  ring?: boolean;
  /** Their photo is on its way: a breathing circle, not initials that then turn into a face. */
  loading?: boolean;
}) {
  const uri = source?.uri;
  const p = usePalette();
  const initials = (name ?? '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: uri ? p.bg : p.sunken,
        boxShadow: ring ? raised(p, 3) : uri ? raised(p, 3) : sunk(p, 3),
        borderWidth: ring ? 2 : 0,
        borderColor: ring ? p.accent : 'transparent',
        overflow: 'hidden',
      }}
    >
      {source ? (
        <Image source={source} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
      ) : loading ? null : (
        <Text style={[type.bodyStrong, { color: p.textTertiary, fontSize: size * 0.34 }]}>
          {initials}
        </Text>
      )}
    </View>
  );
}

/**
 * The photo grid on a profile. Empty slots are wells rather than dashed boxes —
 * "something goes here" said in the same language as everything else.
 */
/**
 * `source` rather than a bare uri, because a photo in this app is fetched WITH a
 * credential -- the bytes are never at a public address, so the header is not optional.
 * Passing the token in the URL instead would write somebody's face and their session
 * into every proxy log between here and the server.
 */
export function PhotoSlot({
  source,
  onPress,
  large,
  loading,
}: {
  source?: { uri: string; headers?: Record<string, string> } | null;
  onPress: () => void;
  /** A photo is on its way into this slot: a breathing block, not the "+" of an empty one. */
  loading?: boolean;
  /**
   * The hero slot: sets the height of the row, and the others divide it.
   *
   * THE SMALL SLOTS USED TO BE SQUARE, AND THAT IS WHY THEY FELL OFF THE SCREEN.
   * They carried `flex: 1` AND `aspectRatio: 1` inside a column whose height comes
   * from this one. `flex: 1` sets the HEIGHT, the aspect ratio then derives the WIDTH
   * from it, and nothing anywhere derives the width from the column they sit in --
   * so at a 2:1 split they came out about a third wider than their own column and
   * spilled past the card and off the right edge of the phone.
   *
   * The fix is to stop asking for a square. A slot that fills its share of the row
   * takes its width from the column and its height from the flex, which is the one
   * arrangement where neither dimension can run away.
   */
  large?: boolean;
}) {
  const uri = source?.uri;
  const p = usePalette();
  return (
    <View
      style={{
        flex: large ? undefined : 1,
        // Only the hero fixes its shape. See the note above.
        aspectRatio: large ? 3 / 4 : undefined,
        width: large ? undefined : '100%',
        borderRadius: radius.lg,
        backgroundColor: uri ? p.bg : p.sunken,
        boxShadow: uri ? raised(p, 4) : sunk(p, 4),
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {source ? (
        <Image source={source} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
      ) : loading ? (
        <Orb state="breathing" size={40} label="Loading the photo" />
      ) : (
        <Text style={{ color: p.textTertiary, fontSize: 26 }}>+</Text>
      )}
    </View>
  );
}
