/**
 * Numbers: how far matches get, for the founder only.
 *
 * Reached from Settings only by a reviewer, and the server answers 404 to anybody
 * else -- the screen is not the gate. Real people only; counts, never names.
 */
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { getFunnel } from '../../lib/api';
import { useSession } from '../../store/session';
import { Card, Header, Row, Screen, ScreenTitle, Skeleton, space, type, usePalette } from '../../components/ui';
import { funnelRows, type Funnel } from './funnel';

export default function FunnelScreen() {
  const p = usePalette();
  const token = useSession((s) => s.token);
  const [f, setF] = useState<Funnel | null>(null);
  const load = useCallback(async () => {
    if (token) setF(await getFunnel(token));
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  const rows = f ? funnelRows(f) : [];
  return (
    <Screen onRefresh={() => void load()} padded={false}>
      <Header title="" onBack={() => router.back()} />
      <ScreenTitle title="Numbers" subtitle="Real people only" />
      <View style={{ paddingHorizontal: space.screen, gap: space.lg }}>
        {!f ? <Skeleton height={240} /> : (
          <>
            <Card label="HOW FAR MATCHES GET">
              {rows.map((r, i) => (
                <Row key={r.label} title={r.label} value={String(r.n)} last={i === rows.length - 1} />
              ))}
            </Card>
            <Card>
              <Row title="People" value={String(f.people)} />
              <Row title="Expired, nobody answered" value={String(f.expired)} last />
            </Card>
            <Text style={[type.callout, { color: p.textTertiary }]}>
              Invented people, test accounts and anybody who never signed in on a phone are left out.
              Met counts either check-in.
            </Text>
          </>
        )}
      </View>
    </Screen>
  );
}
