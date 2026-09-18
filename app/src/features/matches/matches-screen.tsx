/**
 * People your agent found.
 *
 * Instagram's feed shape — a column of cards, one idea each, no chrome — but the card
 * is a BRIEF rather than a face. There is no swipe deck, no grid of photos, no score.
 *
 * NEVER A NUMBER. Pre-date self-report predicts attraction badly enough that any
 * percentage shown here would be a lie with a decimal point. What can honestly be
 * shown is provenance: two people said nearly the same thing, months apart, unprompted.
 * That is a true statement, and a store that overwrites its facts cannot make it.
 *
 * NEVER THE TRANSCRIPT. It contains the other agent's characterisation of its human,
 * which is unverified — and reading it quietly turns a claim into a remembered fact
 * about somebody you have not met.
 */
import { router } from 'expo-router';
import { setupRoute } from '../profile/fields';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import {
  decideMatch, getMatches, getPool, runRound, type MatchCard, type PoolStep, type RoundState,
} from '../../lib/api';
import { useSession } from '../../store/session';
import {
  Button, Card, Crease, Empty, Screen, ScreenTitle, StatRow, Surface,
  radius, space, type, usePalette,
} from '../../components/ui';

export default function MatchesScreen() {
  const p = usePalette();
  const token = useSession((s) => s.token);
  const [matches, setMatches] = useState<MatchCard[]>([]);
  const [round, setRound] = useState<RoundState | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  // The round the person last asked for, so a "done" that was already on screen when
  // they arrived is not re-announced as news.
  const announced = useRef<string | null>(null);
  const [pool, setPool] = useState<{ total: number; steps: PoolStep[]; inPool: boolean; missing: string[]; need: string[] } | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const [m, po] = await Promise.all([getMatches(token), getPool(token)]);
    setMatches(m?.matches ?? []);
    setRound(m?.round ?? null);
    setPool(po);
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  // WHILE A ROUND IS OUT, ASK AGAIN. The round runs on the server with no request
  // waiting on it, so the only way to learn it finished is to look. Every eight
  // seconds is often enough for a thing that takes minutes, and it stops the moment
  // there is nothing to wait for.
  const active = round?.status === 'queued' || round?.status === 'running';
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void load(), 8_000);
    return () => clearInterval(t);
  }, [active, load]);

  // Say how it went, once, when a round the person asked for comes back.
  useEffect(() => {
    if (!round || active || announced.current !== round.id) return;
    announced.current = null;
    setSaid(
      round.error === 'budget_exceeded'
        ? 'Your agent has been out enough for today. Try again tomorrow.'
        : round.error
          ? 'Something went wrong while your agent was out. Try again.'
          : round.skipped
            ? round.skipped
            : round.met === 0
              ? 'It found nobody new to meet.'
              : round.met === 1
                ? 'Your agent met one person. Their card is below.'
                : `Your agent met ${round.met} people. The one it liked most is first.`,
    );
  }, [round, active]);

  /**
   * Asks for a round. Answers at once; the round itself is minutes of conversations
   * on the server, and the poll above brings the result back.
   */
  const go = useCallback(async () => {
    if (!token || active) return;
    setSaid(null);
    const r = await runRound(token);
    if (!r) { setSaid('Cannot reach the server.'); return; }
    if ('error' in r) {
      setSaid(r.error === 'budget_exceeded'
        ? 'Your agent has been out enough for today. Try again tomorrow.'
        : 'Could not send your agent out. Try again.');
      return;
    }
    announced.current = r.roundId;
    await load();
  }, [token, active, load]);

  /** A no is silent and final. The card goes and the other person is never told. */
  const pass = useCallback(
    async (id: string) => {
      if (!token) return;
      setMatches((ms) => ms.filter((m) => m.id !== id));
      await decideMatch(token, id, false);
    },
    [token],
  );

  return (
    <Screen onRefresh={() => void load()} padded={false}>
      <ScreenTitle title="Matches" />

      <View style={{ paddingHorizontal: space.screen, gap: space.lg }}>
        {/* The agent cannot go out until it can answer the five questions the
            candidate query asks. Four out of five is the same as none. */}
        {pool && !pool.inPool && (
          <Card label="Your agent is still inside">
            <Text style={[type.body, { color: p.text }]}>
              It needs a few more things before it can talk to anyone.
            </Text>
            {pool.missing.map((m) => (
              <Text key={m} style={[type.callout, { color: p.textSecondary }]}>• {m}</Text>
            ))}
            <Button label="Finish setting it up" variant="primary"
                    onPress={() => router.push({ pathname: setupRoute(pool.need), params: { finish: '1' } })} />
          </Card>
        )}

        {/* The live pool count, and what each rule costs. Over-filtering is otherwise
            invisible: the app simply never matches anybody and nobody can see why. */}
        {pool && pool.inPool && (
          <Card label="Who your agent can reach">
            <Text style={[type.display, { color: p.text }]}>{pool.total}</Text>
            <Text style={[type.callout, { color: p.textSecondary }]}>
              people fit what you have asked for
            </Text>
            <Crease />
            {/* WHERE THE NUMBER STARTED, first. Without it the list below is four
                subtractions from nothing: "72 people" then "-2595" says neither what
                was there before nor how the two are related. */}
            <StatRow
              label="everyone your agent could consider"
              value={String(pool.steps.find((s) => s.step === 'everyone')?.remaining ?? 0)}
            />
            {pool.steps.filter((s) => s.cost > 0).map((s) => (
              <StatRow key={s.step} label={s.step} value={`−${s.cost}`} muted />
            ))}
            <Crease />
            <StatRow label="left to meet" value={String(pool.total)} />
            {pool.total === 0 && (
              <Text style={[type.callout, { color: p.warning }]}>
                Nobody fits. Something you have asked for is too strict.
              </Text>
            )}
          </Card>
        )}

        {/* The button that makes the whole thing run. A weekly cadence is where this
            is going -- one match, at a fixed time, the way Ditto does it -- but a
            button that works today beats a scheduler that is not wired up. */}
        {pool?.inPool && (
          <Button
            label={active ? 'Your agent is out…' : 'Send my agent out'}
            variant="primary"
            disabled={active}
            loading={active}
            onPress={() => void go()}
          />
        )}
        {said && (
          <Text style={[type.callout, { color: p.textSecondary, textAlign: 'center' }]}>
            {said}
          </Text>
        )}

        {matches.length === 0 ? (
          <Empty
            title="Nothing waiting"
            // NOT "your agent is out there". It is not: it goes out when the button
            // above is pressed and not otherwise, and telling somebody their agent is
            // working while nothing is happening is the kind of lie an app tells once
            // before nobody believes anything else on the screen.
            body={
              pool?.inPool
                ? 'Send it out when you are ready. It meets a few people, and comes back with what it made of each of them.'
                : 'Your agent cannot go out yet — finish the bits above first.'
            }
          />
        ) : (
          // ONE AT A TIME. The list is ordered by how the agents got on, so the first
          // card the person can act on is the best one the round produced. Saying
          // not-for-me removes it and the next is already here -- the shape Hinge
          // ships as "Most Compatible", and the founder's own proposal. Cards already
          // answered and waiting on the other side sit underneath, quietly.
          [...matches.filter((m) => m.waitingOnYou).slice(0, 1),
           ...matches.filter((m) => !m.waitingOnYou)].map((m) => (
            <Surface key={m.id} radius={radius.lg} style={{ padding: space.screen, gap: space.md }}>
              <Text style={[type.label, { color: p.textSecondary }]}>
                {m.waitingOnYou ? 'WAITING ON YOU'
                  : m.waitingOnThem ? 'WAITING ON THEM'
                  : 'BOTH AGENTS SAID YES'}
              </Text>
              {/* HOW THE AGENTS GOT ON, IN WORDS. Never a number: a percentage here is
                  read as compatibility, and nothing measured before two people meet
                  predicts that. What can be said honestly is how often five
                  conversations ended with both agents wanting a sixth. */}
              <Text style={[type.callout, { color: p.textSecondary }]}>
                {m.agreement === null ? 'Your agents could not tell.'
                  : m.agreement >= 0.6 ? 'Your agents got on.'
                  : m.agreement >= 0.2 ? 'Your agents were not sure.'
                  : 'Your agents did not really click. You might see it differently.'}
              </Text>
              <Text style={[type.title, { color: p.text }]}>{m.headline}</Text>

              {/* Said on the card, not buried in a settings screen. Before there are
                  users the pool is invented, and a match that does not say so is a
                  match that lies by leaving it out. */}
              {m.practice && (
                <Text style={[type.callout, { color: p.textSecondary }]}>
                  Practice match — this one is not a real person. Your agent still went
                  out and this is really what it made of them.
                </Text>
              )}

              {/* Real quotes, with real dates, from both memories. The one thing here
                  that is verifiably true rather than predicted. */}
              {m.overlaps.slice(0, 3).map((o, i) => (
                <View key={i} style={{ gap: space.xs }}>
                  {i > 0 && <Crease />}
                  <Text style={[type.callout, { color: p.textTertiary }]}>You, {o.dateA}</Text>
                  <Text style={[type.body, { color: p.text }]}>“{o.quoteA}”</Text>
                  <Text style={[type.callout, { color: p.textTertiary }]}>Them, {o.dateB}</Text>
                  <Text style={[type.body, { color: p.text }]}>“{o.quoteB}”</Text>
                </View>
              ))}

              {/* Mandatory, and singular. A brief with nothing to worry about is a
                  brief that was written to please. */}
              <Crease />
              <Text style={[type.label, { color: p.textSecondary }]}>ONE THING I'D WANT TO KNOW</Text>
              <Text style={[type.body, { color: p.text }]}>{m.concern}</Text>

              {m.waitingOnYou ? (
                <>
                  <Button label={m.practice ? 'See the practice profile' : 'Show me who it is'}
                          variant="primary"
                          onPress={() => router.push(`/match/${m.id}`)} />
                  {/* No is silent. Nobody is ever told they were passed on, so nobody
                      can compare notes about who said no to whom. */}
                  <Button label="Not this one" variant="ghost"
                          onPress={() => void pass(m.id)} />
                </>
              ) : (
                <Text style={[type.callout, { color: p.textTertiary }]}>
                  {m.waitingOnYou === false && m.waitingOnThem
                    ? 'They are looking first. Whoever gets more matches decides first — it stops one side being buried.'
                    : 'You said yes. You will hear nothing either way until they look.'}
                </Text>
              )}
            </Surface>
          ))
        )}
      </View>
    </Screen>
  );
}
