/**
 * A chat message.
 *
 * Instagram's own bubbles are the reference: the sender's are filled and right, the
 * other side's are plain and left, with nothing else on the row. Here the clone's
 * bubble is extruded from the surface and yours is filled with the accent — so "this
 * is you" and "this is it" are told apart by depth as well as by side.
 */
import { Text, View } from 'react-native';
import { radius, raised, space, type, usePalette } from './theme';

export function Bubble({
  text,
  mine,
  pending,
}: {
  text: string;
  mine: boolean;
  pending?: boolean;
}) {
  const p = usePalette();
  return (
    <View
      style={{
        alignSelf: mine ? 'flex-end' : 'flex-start',
        maxWidth: '84%',
        marginBottom: space.sm,
      }}
    >
      <View
        style={{
          backgroundColor: mine ? p.accent : p.bg,
          borderRadius: radius.xl,
          // The sender's own bubble is flat and filled; the clone's is moulded out of
          // the page. Depth carries the distinction, so colour does not have to.
          borderBottomRightRadius: mine ? radius.sm : radius.xl,
          borderBottomLeftRadius: mine ? radius.xl : radius.sm,
          paddingHorizontal: space.lg,
          paddingVertical: space.md,
          boxShadow: mine ? undefined : raised(p, 4),
          opacity: pending ? 0.7 : 1,
        }}
      >
        <Text style={[type.body, { color: mine ? p.accentText : p.text }]}>
          {text || (pending ? '…' : '')}
        </Text>
      </View>
    </View>
  );
}

/** The AI disclosure line. Required at the start of every session, so it is a component. */
export function Disclosure({ text }: { text: string }) {
  const p = usePalette();
  return (
    <Text
      style={[
        type.callout,
        { color: p.textTertiary, textAlign: 'center', paddingHorizontal: space.xl, paddingVertical: space.md },
      ]}
    >
      {text}
    </Text>
  );
}
