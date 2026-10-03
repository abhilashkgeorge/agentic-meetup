/**
 * Numbers: how far matches get, for the founder only.
 *
 * Reached from Settings only by a reviewer, and the server answers 404 to anybody
 * else -- the screen is not the gate. Real people only; counts, never names.
 */
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { getFunnel, getUnmatchedWants } from '../../lib/api';
import { useSession } from '../../store/session';
import {
  Card, Header, LoadFailed, Loading, Row, Screen, ScreenTitle, space, type, usePalette,
} from '../../components/ui';
import { funnelRows, gapRows, type Funnel } from './funnel';

export default function FunnelScreen() {
  const p = usePalette();
  const token = useSession((s) => s.token);
  const [f, setF] = useState<Funnel | null>(null);
  const [gaps, setGaps] = useState<Awaited<ReturnType<typeof getUnmatchedWants>>>(null);
  /** The numbers could not be had: said, not a placeholder for good. */
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    if (!token) return;
    setFailed(false);
    const [fu, ga] = await Promise.all([getFunnel(token), getUnmatchedWants(token)]);
    if (!fu) { setFailed(true); return; }
    setF(fu);
    setGaps(ga);
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  const rows = f ? funnelRows(f) : [];
  return (
    <Screen onRefresh={() => void load()} padded={false}>
      <Header title="" onBack={() => router.back()} />
      <ScreenTitle title="Numbers" subtitle="Real people only" />
      <View style={{ paddingHorizontal: space.screen, gap: space.lg }}>
        {!f && failed ? <LoadFailed what="the numbers" onRetry={() => void load()} /> : !f ? (
          <Loading label="Loading the numbers" orb="working" />
        ) : (
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
            {/* Which situation questions to add next (2026-09-28). */}
            {gaps && (
              <Card label="WANTS WITH NO QUESTION YET">
                {gapRows(gaps).length === 0 ? (
                  <Text style={[type.callout, { color: p.textTertiary }]}>Every want so far fits a question.</Text>
                ) : gapRows(gaps).map((r, i, all) => (
                  <Row key={r.title} title={r.title} value={r.value} last={i === all.length - 1} />
                ))}
                <Text style={[type.callout, { color: p.textTertiary }]}>
                  A want only one person has shows as its topic, never their words.
                </Text>
              </Card>
            )}
          </>
        )}
      </View>
    </Screen>
  );
}
