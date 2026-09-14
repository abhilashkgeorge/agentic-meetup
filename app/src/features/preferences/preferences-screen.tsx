/**
 * What you are looking for — and what each rule costs you.
 *
 * The screen that makes the central idea visible. Filters multiply down and reach
 * zero; points add up and never do. Without a live count that is invisible: the app
 * simply never matches anybody and nobody can see why.
 *
 * So every preference shows its strength, and the running pool is at the top,
 * updating as rules change. Somebody watching their pool fall from 340 to 31 to 2
 * makes an informed choice. Somebody who never sees it just thinks the app is broken.
 */
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { getPool, getPreferences, setPreferenceStrength, type PoolStep, type Preference } from '../../lib/api';
import { useSession } from '../../store/session';
import {
  Header,
  StatRow,
  Button, Card, Chip, ChipGroup, Crease, Row, Screen, ScreenTitle,
  Skeleton, space, type, usePalette,
} from '../../components/ui';

const STRENGTHS = [
  { value: 'dealbreaker', label: 'Must have' },
  { value: 'strong', label: 'Really want' },
  { value: 'mild', label: 'Nice to have' },
] as const;

export default function PreferencesScreen() {
  const p = usePalette();
  const token = useSession((s) => s.token);
  const [prefs, setPrefs] = useState<Preference[]>([]);
  const [pool, setPool] = useState<{ total: number; steps: PoolStep[]; inPool: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const [pr, po] = await Promise.all([getPreferences(token), getPool(token)]);
    setPrefs(pr?.preferences ?? []);
    setPool(po);
    setLoading(false);
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const change = useCallback(async (id: string, strength: string) => {
    if (!token) return;
    setBusy(id);
    await setPreferenceStrength(token, id, strength);
    setBusy(null);
    // Reloaded rather than patched locally, because the pool number is the point and
    // a stale count here would be worse than a moment of loading.
    void load();
  }, [token, load]);

  const dealbreakers = prefs.filter((x) => x.strength === 'dealbreaker');
  const wants = prefs.filter((x) => x.strength !== 'dealbreaker');

  return (
    <Screen onRefresh={() => void load()} padded={false}>
      <Header title="" onBack={() => router.back()} />
      <ScreenTitle title="Looking for" subtitle="Only must-haves remove anybody. Everything else just ranks." />

      <View style={{ paddingHorizontal: space.screen, gap: space.lg }}>
        <Card label="Who your agent can reach">
          {loading ? (
            <Skeleton height={40} width="50%" />
          ) : (
            <>
              <Text style={[type.display, { color: pool?.total === 0 ? p.warning : p.text }]}>
                {pool?.total ?? 0}
              </Text>
              <Text style={[type.callout, { color: p.textSecondary }]}>
                people fit everything you have asked for
              </Text>
              {/* What each rule cost. The line that turns an invisible failure into a
                  choice somebody can actually make. */}
              {(pool?.steps ?? []).filter((s) => s.cost > 0).map((s) => (
                <StatRow key={s.step} label={s.step} value={`−${s.cost}`} muted />
              ))}
              {/* THREE REASONS THE NUMBER IS ZERO, and they need different answers.
                  This told everybody to loosen a must-have -- while the card directly
                  below it said "Must have · 0". Advice to undo something you have not
                  done is worse than no advice: it implies the app has misread you. */}
              {pool?.total === 0 && (
                <Text style={[type.callout, { color: p.warning }]}>
                  {!pool.inPool
                    ? 'Your agent is not out there yet, so it cannot reach anybody. Finish setting it up first.'
                    : dealbreakers.length > 0
                      ? 'Nobody fits. Turn a must-have into a want and they will come back.'
                      : 'Nobody fits yet — not because of anything you asked for. There are simply no other agents in range.'}
                </Text>
              )}
            </>
          )}
        </Card>

        <Card label={`Must have · ${dealbreakers.length}`}>
          <Text style={[type.callout, { color: p.textSecondary }]}>
            These remove people. Each one costs you matches, so keep the list short.
          </Text>
          {dealbreakers.length === 0 ? (
            <Text style={[type.body, { color: p.textTertiary }]}>None. Good.</Text>
          ) : (
            dealbreakers.map((x, i) => (
              <View key={x.id}>
                {i > 0 && <Crease />}
                <Text style={[type.body, { color: p.text }]}>{x.label}</Text>
                {x.sourceQuote ? (
                  <Text style={[type.callout, { color: p.textTertiary, fontStyle: 'italic' }]}>
                    “{x.sourceQuote}”
                  </Text>
                ) : null}
                <ChipGroup>
                  {STRENGTHS.map((s) => (
                    <Chip key={s.value} label={s.label} selected={x.strength === s.value}
                          disabled={busy === x.id}
                          onPress={() => void change(x.id, s.value)} />
                  ))}
                </ChipGroup>
              </View>
            ))
          )}
        </Card>

        <Card label={`Want · ${wants.length}`}>
          <Text style={[type.callout, { color: p.textSecondary }]}>
            These never remove anybody. They move people up the list.
          </Text>
          {wants.length === 0 ? (
            <Text style={[type.body, { color: p.textTertiary }]}>
              Nothing yet. Tell your clone what you are after and it will fill this in.
            </Text>
          ) : (
            wants.map((x, i) => (
              <View key={x.id}>
                {i > 0 && <Crease />}
                <Text style={[type.body, { color: p.text }]}>{x.label}</Text>
                <ChipGroup>
                  {STRENGTHS.map((s) => (
                    <Chip key={s.value} label={s.label} selected={x.strength === s.value}
                          disabled={busy === x.id}
                          onPress={() => void change(x.id, s.value)} />
                  ))}
                </ChipGroup>
              </View>
            ))
          )}
        </Card>

        <Text style={[type.callout, { color: p.textTertiary }]}>
          Your clone adds to this as you talk. Mention something you cannot live with
          and it will appear here as a must-have.
        </Text>
      </View>
    </Screen>
  );
}
