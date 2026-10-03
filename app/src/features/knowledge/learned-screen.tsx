/**
 * EVERYTHING YOUR CLONE LEARNED IN CHAT, ON ONE SCREEN, AND "OKAY TO SHARE ALL" (the
 * founder, 2026-10-04; learned.ts says why). Each line can be shared or kept private on
 * its own; the big button shares every one not kept private.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Card, Header, Screen, space, type, usePalette } from '../../components/ui';
import { useLearned } from './use-learned';

export default function LearnedScreen() {
  const p = usePalette();
  const { items, share, keep } = useLearned();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const all = async () => {
    setBusy(true);
    setNote(null);
    const ok = await share(items.map((l) => l.factId));
    setBusy(false);
    if (!ok) { setNote('Some did not save. Check your connection and try again.'); return; }
    if (router.canGoBack()) router.back();
  };
  return (
    <Screen
      footer={items.length > 0 ? (
        <>
          <Button label="Okay to share all" variant="primary" loading={busy} onPress={() => void all()} />
          {note && <Text style={[type.callout, { color: p.danger, textAlign: 'center' }]}>{note}</Text>}
        </>
      ) : undefined}
    >
      <Header title="" onBack={() => router.back()} />
      <Text style={[type.display, { color: p.text }]}>What it learned</Text>
      <Text style={[type.body, { color: p.textSecondary }]}>
        From your chats with your clone. It uses these to find people for you, and says none of
        them to anybody until you say it may.
      </Text>
      {items.length === 0 && (
        <Text style={[type.body, { color: p.text }]}>Nothing new. Talk to your clone and it will learn more.</Text>
      )}
      <View style={{ gap: space.sm }}>
        {items.map((l) => (
          <Card key={l.factId}>
            <Text style={[type.body, { color: p.text }]}>{l.text}</Text>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button label="OK to share" onPress={() => void share([l.factId])} style={{ flex: 1 }} />
              <Button label="Keep private" variant="ghost" onPress={() => void keep([l.factId])} style={{ flex: 1 }} />
            </View>
          </Card>
        ))}
      </View>
    </Screen>
  );
}
