/**
 * Everybody in the square, as a list.
 *
 * The town is a picture, and a picture is hard to hit with a thumb and impossible
 * with a screen reader. This is the same roster as rows: tap one and you get the
 * sheet the picture would have given you. It says exactly what the picture says --
 * a stranger is "someone in the square", a practice profile says so, a person you
 * met has their name only where the reveal already allows it.
 */
import { FlatList, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { WorldAgent } from '../../lib/api';
import { Button, Row, Surface, radius, space, type, usePalette } from '../../components/ui';
import { YOU } from './bridge';

const STATE: Record<WorldAgent['state'], string> = {
  idle: '',
  talking: 'Your agents are talking now',
  briefed: 'Your agent met them',
  waiting: 'Waiting on them',
  introduced: 'You both said yes',
  passed: 'You said not this one',
};

export function PeopleSheet({ agents, onPick, onClose }: {
  agents: readonly WorldAgent[];
  onPick: (ref: string) => void;
  onClose: () => void;
}) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  // You first, then people you have met, then everybody else -- the order a person
  // would ask about them in.
  const rows: Array<{ ref: string; title: string; subtitle?: string }> = [
    { ref: YOU, title: 'Your agent', subtitle: 'Tap to talk to it' },
    ...[...agents]
      .sort((a, b) => (a.kind === 'met' ? 0 : 1) - (b.kind === 'met' ? 0 : 1))
      .map((a) => ({
        ref: a.ref,
        title: a.kind === 'met' ? (a.name ?? 'Someone your agent met') : a.practice ? 'Practice match' : 'Someone in the square',
        subtitle: a.kind === 'met' ? (STATE[a.state] || undefined) : a.practice ? 'Not a real person' : undefined,
      })),
  ];

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
            renderItem={({ item, index }) => (
              <Row title={item.title} subtitle={item.subtitle} last={index === rows.length - 1}
                   onPress={() => onPick(item.ref)} />
            )}
          />
          <Button label="Close" variant="ghost" onPress={onClose} />
        </Surface>
      </Pressable>
    </Pressable>
  );
}
