/**
 * In the chat with your clone: what it learned, and may it say so (learned.ts). One or
 * two, each with "OK to share" and "Keep private"; more, one card that opens them all.
 */
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { Button, Card, space, type, usePalette } from '../../components/ui';
import { cardsFor } from './learned';
import { useLearned } from './use-learned';

export function LearnedCards({ refreshKey }: { refreshKey?: unknown }) {
  const p = usePalette();
  const { items, refresh, share, keep } = useLearned();
  useEffect(() => { void refresh(); }, [refresh, refreshKey]);
  const cards = cardsFor(items);
  if (cards.kind === 'none') return null;
  if (cards.kind === 'review') {
    return (
      <Card label="It learned about you">
        <Text style={[type.body, { color: p.text }]}>
          {cards.count} things from your chats. Nobody hears them until you say so.
        </Text>
        <Button label="See them" variant="primary" onPress={() => router.push('/learned')} />
      </Card>
    );
  }
  return (
    <View style={{ gap: space.sm }}>
      {cards.items.map((l) => (
        <Card key={l.factId} label="It learned this">
          <Text style={[type.body, { color: p.text }]}>{l.text}</Text>
          <Text style={[type.callout, { color: p.textSecondary }]}>Your agent may say it to people it meets?</Text>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button label="OK to share" variant="primary" onPress={() => void share([l.factId])} style={{ flex: 1 }} />
            <Button label="Keep private" onPress={() => void keep([l.factId])} style={{ flex: 1 }} />
          </View>
        </Card>
      ))}
    </View>
  );
}
