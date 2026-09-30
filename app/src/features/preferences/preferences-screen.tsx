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
import { Alert, Text, View } from 'react-native';
import { getPool, getPreferences, getWants, removePreference, setPreferenceStrength, type PoolStep, type Preference } from '../../lib/api';
import { WantsCard } from './wants-card';
import { NOT_A_MUST_HAVE, STRENGTHS, strengthsFor } from './strengths';
import type { WantView } from './wants-state';
import { countLabel, isUnder20 } from '../../lib/counts';
import { useSession } from '../../store/session';
import {
  Header,
  StatRow,
  Button, Card, Chip, ChipGroup, Crease, Row, Screen, ScreenTitle,
  Skeleton, space, type, usePalette,
} from '../../components/ui';


export default function PreferencesScreen() {
  const p = usePalette();
  const token = useSession((s) => s.token);
  const [prefs, setPrefs] = useState<Preference[]>([]);
  const [pool, setPool] = useState<{ total: number | null; steps: PoolStep[]; inPool: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [myWants, setMyWants] = useState<WantView[]>([]);

  const load = useCallback(async () => {
    if (!token) return;
    const [pr, po, wa] = await Promise.all([getPreferences(token), getPool(token), getWants(token)]);
    setPrefs(pr?.preferences ?? []);
    setPool(po);
    setMyWants(wa?.wants ?? []);
    setLoading(false);
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  // Why a change was refused, shown under that rule (a must-have on a field chat fills).
  const [refused, setRefused] = useState<{ id: string; message: string } | null>(null);
  const change = useCallback(async (id: string, strength: string) => {
    if (!token) return;
    setBusy(id);
    const r = await setPreferenceStrength(token, id, strength);
    setBusy(null);
    setRefused(r && !r.ok ? { id, message: r.message } : null);
    // Reloaded rather than patched locally, because the pool number is the point and
    // a stale count here would be worse than a moment of loading.
    void load();
  }, [token, load]);

  // Any rule can go, a must-have too (the founder, 2026-09-29). Asked first: a must-have
  // removed widens who the agent can reach at once.
  const remove = useCallback((x: Preference) => Alert.alert(
    'Remove this rule?',
    x.strength === 'dealbreaker' ? 'People it hid can be met again.' : 'It stops moving people up the list.',
    [{ text: 'Cancel', style: 'cancel' },
     { text: 'Remove', style: 'destructive', onPress: () => {
       if (!token) return;
       setBusy(x.id);
       void removePreference(token, x.id).then(() => { setBusy(null); void load(); });
     } }],
  ), [token, load]);

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
              <Text style={[type.display, { color: pool && isUnder20(pool.total) ? p.warning : p.text }]}>
                {countLabel(pool?.total)}
              </Text>
              <Text style={[type.callout, { color: p.textSecondary }]}>
                people fit everything you have asked for
              </Text>
              {/* What each rule cost. The line that turns an invisible failure into a
                  choice somebody can actually make. Said what it is: bare, "who you want to
                  meet  -2600" left the number to be guessed at (on the Pixel, 2026-09-30). */}
              {(pool?.steps ?? []).some((s) => (s.cost ?? 0) > 0) && (
                <Text style={[type.callout, { color: p.textSecondary, marginTop: space.sm }]}>Each rule leaves out:</Text>
              )}
              {(pool?.steps ?? []).filter((s) => (s.cost ?? 0) > 0).map((s) => (
                <StatRow key={s.step} label={s.step} value={`−${s.cost}`} muted />
              ))}
              {/* THREE REASONS THE NUMBER IS ZERO, and they need different answers.
                  This told everybody to loosen a must-have -- while the card directly
                  below it said "Must have · 0". Advice to undo something you have not
                  done is worse than no advice: it implies the app has misread you. */}
              {/* "Under 20" and not "nobody": below twenty the server sends no number
                  at all (lib/counts.ts), so the honest words are the small-pool ones. */}
              {pool && isUnder20(pool.total) && (
                <Text style={[type.callout, { color: p.warning }]}>
                  {!pool.inPool
                    ? 'Your agent is not out there yet, so it cannot reach anybody. Finish setting it up first.'
                    : dealbreakers.length > 0
                      ? 'Very few people fit. Turn a must-have into a want to reach more.'
                      : 'Very few people are in range yet — not because of anything you asked for.'}
                </Text>
              )}
            </>
          )}
        </Card>

        {/* Each want beside the question the other person answers (2026-09-26). A
            key per text and answers, so a reload opens each box on what it now holds. */}
        <WantsCard key={myWants.map((w) => `${w.text}:${(w.accepted ?? []).join(',')}`).join('|')}
                   wants={myWants} onSaved={() => void load()} />

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
                  <Chip label="Remove" selected={false} disabled={busy === x.id} onPress={() => remove(x)} />
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
              Nothing yet. These come from the optional questions.
            </Text>
          ) : (
            wants.map((x, i) => (
              <View key={x.id}>
                {i > 0 && <Crease />}
                <Text style={[type.body, { color: p.text }]}>{x.label}</Text>
                <ChipGroup>
                  {strengthsFor(x).map((s) => (
                    <Chip key={s.value} label={s.label} selected={x.strength === s.value}
                          disabled={busy === x.id}
                          onPress={() => void change(x.id, s.value)} />
                  ))}
                  <Chip label="Remove" selected={false} disabled={busy === x.id} onPress={() => remove(x)} />
                </ChipGroup>
                {x.mustHave === false && (
                  <Text style={[type.callout, { color: p.textTertiary }]}>{NOT_A_MUST_HAVE}</Text>
                )}
                {refused?.id === x.id && (
                  <Text style={[type.callout, { color: p.warning }]}>{refused.message}</Text>
                )}
              </View>
            ))
          )}
        </Card>

        <Text style={[type.callout, { color: p.textTertiary }]}>
          Must-haves come from your cards. Your agent never adds one by itself: what you
          say in chat is checked with you first.
        </Text>
      </View>
    </Screen>
  );
}
