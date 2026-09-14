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
import { radius, raised, sunk, type, usePalette } from './theme';

export function Avatar({
  source,
  name,
  size = 52,
  ring,
}: {
  /** Carries the credential with it -- see PhotoSlot. */
  source?: { uri: string; headers?: Record<string, string> } | null;
  name?: string | null;
  size?: number;
  /** A coloured ring, Instagram-style: something is new here. */
  ring?: boolean;
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
      ) : (
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
}: {
  source?: { uri: string; headers?: Record<string, string> } | null;
  onPress: () => void;
  large?: boolean;
}) {
  const uri = source?.uri;
  const p = usePalette();
  return (
    <View
      style={{
        flex: large ? undefined : 1,
        aspectRatio: large ? 3 / 4 : 1,
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
      ) : (
        <Text style={{ color: p.textTertiary, fontSize: 26 }}>+</Text>
      )}
    </View>
  );
}
