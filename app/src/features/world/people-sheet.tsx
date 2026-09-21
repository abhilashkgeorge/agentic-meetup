/**
 * Everybody in the square, as a list.
 *
 * The town is a picture, and a picture is hard to hit with a thumb and impossible
 * with a screen reader. This is the same roster as rows: tap one and you get the
 * sheet the picture would have given you. It says exactly what the picture says --
 * a stranger is "someone in the square", a practice profile says so, a person you
 * met has their name only where the reveal already allows it.
 *
 * Grouped by neighbourhood: yours first, then the others nearest first, so the list
 * reads the way the map does. Somebody with no neighbourhood stands in the central
 * tile on the map and is listed there too.
 */
import { FlatList, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { WorldAgent } from '../../lib/api';
import { Button, Row, Surface, radius, space, type, usePalette } from '../../components/ui';
import { peopleRows } from './people';

export function PeopleSheet({ agents, myArea, onPick, onClose }: {
  agents: readonly WorldAgent[];
  /** Your neighbourhood, listed first. Null is the central tile. */
  myArea: string | null | undefined;
  onPick: (ref: string) => void;
  onClose: () => void;
}) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const rows = peopleRows(agents, myArea);

  return (
    <Pressable onPress={onClose} style={{ position: 'absolute', inset: 0 }} accessibilityLabel="Close">
      <Pressable onPress={() => {}} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '70%' }}>
        <Surface radius={radius.xl} style={{ padding: space.screen, paddingBottom: Math.max(insets.bottom, space.lg), gap: space.md,
                                              borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}>
          <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: p.dark }} />
          <Text style={[type.title, { color: p.text }]}>People here</Text>
          <FlatList
            data={rows}
            keyExtractor={(r) => r.ref}
            renderItem={({ item, index }) => item.kind === 'header'
              ? <Text style={[type.label, { color: p.textSecondary, paddingTop: space.md, paddingBottom: space.xs }]}>{item.title.toUpperCase()}</Text>
              : <Row title={item.title} subtitle={item.subtitle} last={index === rows.length - 1 || rows[index + 1]?.kind === 'header'}
                     onPress={() => onPick(item.ref)} />}
          />
          <Button label="Close" variant="ghost" onPress={onClose} />
        </Surface>
      </Pressable>
    </Pressable>
  );
}
