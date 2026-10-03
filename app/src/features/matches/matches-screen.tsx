/**
 * People your agent found.
 *
 * Instagram's feed shape — a column of cards, one idea each, no chrome — but the card
 * is a BRIEF rather than a face. There is no swipe deck, no grid of photos, no score.
 *
 * NEVER A NUMBER, AND NEVER A VERDICT. Pre-date self-report predicts attraction badly
 * enough that any percentage shown here would be a lie with a decimal point -- and
 * words are no better: "Your agents got on" is the same number, rounded. Since
 * 2026-09-23 the card carries no agreement and no concern at all. The concern was an
 * assessor's reading of two agents talking, and it is how an invented "comedy writer"
 * reached a real person's card.
 *
 * WHAT IT SAYS INSTEAD, all written by code on the server (matching/brief.ts): their
 * intent, age and area; the same line on every card; the interests you both have;
 * up to two sentences they really typed; what the two agents asked each other, each
 * answering in its own person's words or with "I don't know" (matching/answer-sheet.ts);
 * and something to ask them about.
 *
 * NEVER THE TRANSCRIPT. It contains the other agent's characterisation of its human,
 * which is unverified — and reading it quietly turns a claim into a remembered fact
 * about somebody you have not met.
 */
import { router, useFocusEffect } from 'expo-router';
import { setupRoute } from '../profile/fields';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  decideMatch, getMatches, getPool, runRound, type MatchCard, type PoolStep, type RoundState, type Talk,
} from '../../lib/api';
import { FEW_ON_THE_APP, costLabel, countLabel, fewOnTheApp, isUnder20, rulesTakeSomebody } from '../../lib/counts';
import { roundNote } from './round-note';
import { useWorld } from '../world/store';
import { useSession } from '../../store/session';
import { registerForPush } from '../../lib/push';
import {
  Button, Card, Crease, Empty, LoadFailed, Loading, Screen, ScreenTitle, StatRow, Surface, radius, space,
  type, usePalette,
} from '../../components/ui';
import { CharacterAvatar } from '../look/character-avatar';
import { chatRows, exchangeRows, sayOnCard, sharedSaid, wantRowsView, type Said } from './exchange';
import { SafetySheet } from '../safety/safety-sheet';
import { fade } from './fade';
import { moreWaiting, soonestFirst } from './waiting';
import { recapLines } from './recap';
import { WORDS, turnOf } from './turn';

/**
 * What the agents said, on the card: the date idea first -- the one useful thing a
 * filter could never have made -- then what the two of you share, then the chat itself,
 * folded away until asked for.
 */
function TalkOnCard({ talk }: { talk: Talk }) {
  const p = usePalette();
  const [open, setOpen] = useState(false);
  const rows = chatRows(talk);
  return (
    <>
      {talk.date && (
        <>
          <Crease />
          <Text style={[type.label, { color: p.textSecondary }]}>DATE IDEA</Text>
          <Text style={[type.bodyStrong, { color: p.text }]}>{talk.date.idea}</Text>
          <Answer who="Them" said={sharedSaid(talk.date).them} />
          <Answer who="You" said={sharedSaid(talk.date).you} />
        </>
      )}
      {talk.shared.length > 0 && (
        <>
          <Crease />
          <Text style={[type.label, { color: p.textSecondary }]}>SOMETHING YOU SHARE</Text>
          {talk.shared.map((s, i) => (
            <View key={i} style={{ gap: space.xs }}>
              <Answer who="Them" said={sharedSaid(s).them} />
              <Answer who="You" said={sharedSaid(s).you} />
            </View>
          ))}
        </>
      )}
      {rows.length > 0 && (
        <>
          <Crease />
          <Button label={open ? 'Hide the chat' : 'Read what your agents said'} variant="ghost"
                  onPress={() => setOpen((o) => !o)} />
          {open && rows.map((r, i) => (
            <Text key={i} style={[type.body, { color: r.dim ? p.textTertiary : p.text }]}>
              <Text style={{ color: p.textSecondary }}>{r.speaker}  </Text>
              {r.text}
            </Text>
          ))}
        </>
      )}
    </>
  );
}

/** One side of one question: who, then their words, or "I don't know" set back. */
function Answer({ who, said }: { who: string; said: Said }) {
  const p = usePalette();
  return (
    <Text style={[type.body, { color: said.kind === 'dunno' ? p.textTertiary : p.text }]}>
      <Text style={{ color: p.textSecondary }}>{who}  </Text>
      {sayOnCard(said)}
    </Text>
  );
}

export default function MatchesScreen() {
  const p = usePalette();
  const token = useSession((s) => s.token);
  const [matches, setMatches] = useState<MatchCard[]>([]);
  const [round, setRound] = useState<RoundState | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  // How the last round went is news for that moment only: gone once the person leaves
  // the screen. Kept, "Nobody on the app fits what you asked for yet." was still here
  // after they had changed what they asked for (the two-phone test, 2026-10-02).
  useFocusEffect(useCallback(() => () => setSaid(null), []));
  // The round the person last asked for, so a "done" that was already on screen when
  // they arrived is not re-announced as news.
  const announced = useRef<string | null>(null);
  const [pool, setPool] = useState<{ total: number | null; steps: PoolStep[]; inPool: boolean; missing: string[]; need: string[] } | null>(null);
  // The card whose Block-or-report sheet is open. A card names the match, never a
  // person: the server works out who the other half is.
  const [safetyFor, setSafetyFor] = useState<string | null>(null);
  /**
   * Whether the cards and the pool are here. Before the first answer the screen said
   * "Nothing waiting" -- and "cannot go out yet, finish the bits above", with nothing
   * above -- to somebody whose card was on its way. Once here, a failed refresh keeps
   * what is on screen rather than emptying it.
   */
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');

  const load = useCallback(async () => {
    if (!token) return;
    const [m, po] = await Promise.all([getMatches(token), getPool(token)]);
    if (!m) { setStatus((s) => (s === 'ready' ? s : 'failed')); return; }
    setMatches(m.matches);
    setRound(m.round ?? null);
    if (po) setPool(po);
    setStatus('ready');
  }, [token]);

  // RE-READ ON EVERY FOCUS, not once on mount. A tab stays mounted, so the setup flow
  // -- which ends by landing here -- found the "still inside" card it left, with every
  // card it had just answered still listed as missing, and a button back into the
  // setup it had just finished (the founder, 2026-09-24: "it never finishes").
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // AND WHEN THE CARDS CHANGE: a card written by somebody else's round that came to this
  // person, a yes that makes it their turn, both saying yes -- all on the socket (store.ts
  // `cards`). Before, the tab showed none of it until the person left it and came back
  // (the two-phone test, 2026-10-02). Read a moment later, so a burst is one read.
  const cards = useWorld((s) => s.cards);
  useEffect(() => {
    if (!cards) return;
    const t = setTimeout(() => void load(), 600);
    return () => clearTimeout(t);
  }, [cards, load]);

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
            ? roundNote(round.skipped)
            // The recap card says what happened (item 11), in words and without a count.
            : round.recap
              ? null
              : round.met === 0
                ? 'It found nobody new to meet.'
                : 'Your agent found someone. Their card is below.',
    );
  }, [round, active]);

  /**
   * Asks for a round. Answers at once; the round runs on the server, and the poll
   * above brings the result back.
   */
  const go = useCallback(async () => {
    if (!token || active) return;
    setSaid(null);
    void registerForPush(token, { ask: true });   // as on the Home (lib/push.ts)
    const r = await runRound(token);
    if (!r) { setSaid('Cannot reach the server.'); return; }
    if ('error' in r) {
      // daily_rounds: one open round a day that met somebody (server world.ts
      // ROUNDS_PER_DAY). The same words as the old budget refusal, because to the
      // person it is the same thing.
      setSaid(r.error === 'budget_exceeded' || r.error === 'daily_rounds'
        ? 'Your agent has been out enough for today. Try again tomorrow.'
        : r.error === 'not_ready'
          ? 'Your agent needs a few more answers before it can go out.'
          : 'Could not send your agent out. Try again.');
      // Not ready (the server re-checks before it queues): reload, so the "still
      // inside" card appears with its "Finish setting it up" button.
      if (r.error === 'not_ready') await load();
      return;
    }
    announced.current = r.roundId;
    await load();
  }, [token, active, load]);

  /**
   * The first move: "Yes, share my profile with them". That yes is the permission for
   * THEIR eyes to see YOUR photos and name (consent first, 2026-09-28) -- it shows the
   * sharer nothing of the other person. The card stays, now saying the move is theirs.
   */
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const share = useCallback(
    async (id: string) => {
      if (!token) return;
      setFailedFor(null);
      const r = await decideMatch(token, id, true);
      if (!r) { setFailedFor(id); return; }
      await load();
    },
    [token, load],
  );

  /** A no is silent and final. The card goes and the other person is never told. */
  const pass = useCallback(
    async (id: string) => {
      if (!token) return;
      setMatches((ms) => ms.filter((m) => m.id !== id));
      await decideMatch(token, id, false);
    },
    [token],
  );

  // How many more wait behind the card in front (waiting.ts): none runs out unseen.
  const moreLine = moreWaiting(matches.filter((m) => m.waitingOnYou).length - 1);

  return (
    <Screen onRefresh={() => void load()} padded={false}>
      <ScreenTitle title="Matches" />

      <View style={{ paddingHorizontal: space.screen, gap: space.lg }}>
        {status === 'loading' && (
          // The shape of what is coming: the pool card, the button, a card.
          <Loading label="Loading your matches" orb="connecting" />
        )}
        {status === 'failed' && (
          <LoadFailed what="your matches" onRetry={() => { setStatus('loading'); void load(); }} />
        )}
        {status === 'ready' && (<>
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
            <Text style={[type.display, { color: p.text }]}>{countLabel(pool.total)}</Text>
            <Text style={[type.callout, { color: p.textSecondary }]}>
              people fit what you have asked for
            </Text>
            {/* The sum, only when a rule takes somebody: otherwise it is the big number
                again, twice (lib/counts.ts rulesTakeSomebody). */}
            {rulesTakeSomebody(pool.steps) && (<>
              <Crease />
              {/* WHERE THE NUMBER STARTED, first. Without it the list below is four
                  subtractions from nothing: "72 people" then "-2595" says neither what
                  was there before nor how the two are related. */}
              <StatRow
                label="everyone your agent could consider"
                value={countLabel(pool.steps.find((s) => s.step === 'everyone')?.remaining)}
              />
              {pool.steps.filter((s) => (s.cost ?? 0) > 0).map((s) => (
                <StatRow key={s.step} label={s.step} value={costLabel(s.cost ?? 0)} muted />
              ))}
              <Crease />
              <StatRow label="left to meet" value={countLabel(pool.total)} />
            </>)}
            {isUnder20(pool.total) && (
              <Text style={[type.callout, { color: p.warning }]}>
                {fewOnTheApp(pool.steps) ? FEW_ON_THE_APP
                  : 'Very few people fit. If something you asked for is strict, loosening it reaches more.'}
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

        {/* WHAT YOUR AGENT DID (item 11): after each round, in templates and the
            person's own shareable words -- no verdict, no count, nothing invented. */}
        {round?.status === 'done' && round.recap && (() => {
          const r = recapLines(round.recap);
          return (
            <Card label="WHAT YOUR AGENT DID">
              <Text style={[type.body, { color: p.text }]}>{r.went}</Text>
              {r.saidIntro && <Text style={[type.callout, { color: p.textSecondary }]}>{r.saidIntro}</Text>}
              {r.said.map((s) => (
                <Text key={s} style={[type.body, { color: p.text }]}>“{s}”</Text>
              ))}
              {r.topics && <Text style={[type.callout, { color: p.textSecondary }]}>{r.topics}</Text>}
              {r.unsure && <Text style={[type.callout, { color: p.textTertiary }]}>{r.unsure}</Text>}
            </Card>
          );
        })()}

        {matches.length === 0 ? (
          <Empty
            title="Nothing waiting"
            // NOT "your agent is out there". It is not: it goes out when the button
            // above is pressed and not otherwise, and telling somebody their agent is
            // working while nothing is happening is the kind of lie an app tells once
            // before nobody believes anything else on the screen.
            body={
              pool?.inPool
                ? 'Send it out when you are ready. It finds a few people who pass your rules, and brings back a card for each.'
                : 'Your agent cannot go out yet — finish the bits above first.'
            }
          />
        ) : (
          // ONE AT A TIME -- never by a score, because the head of a list ordered by a
          // score reads as "the one it liked most". The one in front is the one that
          // fades soonest (waiting.ts, 2026-09-29), so none runs out unseen, and under
          // it the screen says how many more wait. Saying not-for-me removes it and the
          // next is already here. Cards already answered and waiting on the other side
          // sit underneath, quietly.
          [...soonestFirst(matches.filter((m) => m.waitingOnYou)).slice(0, 1),
           ...matches.filter((m) => !m.waitingOnYou)].map((m, i) => (
            // THE CARD FADES toward the end of its three days (server 0069).
            <Surface key={m.id} radius={radius.lg}
                     style={{ padding: space.screen, gap: space.md, opacity: fade(m.fadesAt).opacity }}>
              {/* Their character: who this is before the reveal shows a photo. */}
              {m.look && <CharacterAvatar look={m.look} size={40} />}
              <Text style={[type.label, { color: p.textSecondary }]}>
                {m.waitingOnYou ? 'WAITING ON YOU' : 'WAITING ON THEM'}
              </Text>
              {i === 0 && m.waitingOnYou && moreLine && (
                <Text style={[type.callout, { color: p.accent }]}>{moreLine}</Text>
              )}
              {/* Intent, age, area -- the facts line. */}
              <Text style={[type.title, { color: p.text }]}>{m.headline}</Text>
              {/* The same words on every card, so the wording can never say anything
                  about this particular pair by changing. */}
              <Text style={[type.callout, { color: p.textSecondary }]}>{m.line}</Text>

              {/* Said on the card, not buried in a settings screen. Before there are
                  users the pool is invented, and a match that does not say so is a
                  match that lies by leaving it out. */}
              {m.practice && (
                <Text style={[type.callout, { color: p.textSecondary }]}>
                  Practice match — this one is not a real person.
                </Text>
              )}

              {m.shared.length > 0 && (
                <Text style={[type.body, { color: p.text }]}>You both like {m.shared.join(', ')}.</Text>
              )}
              {/* Said as work, not as a liking: two people in finance do not both
                  "like finance". */}
              {m.work && m.work.length > 0 && (
                <Text style={[type.body, { color: p.text }]}>You both work in {m.work.join(', ')}.</Text>
              )}

              {/* Their own words, checked on the server as something they typed. The
                  one thing here that is verifiably theirs rather than predicted. */}
              {m.quotes.length > 0 && <Crease />}
              {m.quotes.map((q, i) => (
                <View key={i} style={{ gap: space.xs }}>
                  <Text style={[type.callout, { color: p.textTertiary }]}>
                    {q.when ? `In their words, ${q.when}` : 'In their words'}
                  </Text>
                  <Text style={[type.body, { color: p.text }]}>“{q.text}”</Text>
                </View>
              ))}

              {/* What the agents said: their talk when they talked; otherwise what they
                  asked each other from the answer sheets -- each answered in its own
                  person's words or with "I don't know", never a guess. */}
              {m.talk ? <TalkOnCard talk={m.talk} /> : exchangeRows(m.qa).length > 0 && (
                <>
                  <Crease />
                  <Text style={[type.label, { color: p.textSecondary }]}>WHAT YOUR AGENTS ASKED EACH OTHER</Text>
                  {exchangeRows(m.qa).map((r) => (
                    <View key={r.label} style={{ gap: space.xs }}>
                      <Text style={[type.callout, { color: p.textTertiary }]}>{r.label}</Text>
                      <Answer who="Them" said={r.them} />
                      <Answer who="You" said={r.you} />
                    </View>
                  ))}
                </>
              )}

              {/* What you asked for, each beside their own words -- no verdict. You
                  read the two side by side and decide; the app never says "met". */}
              {wantRowsView(m.wants).length > 0 && (
                <>
                  <Crease />
                  <Text style={[type.label, { color: p.textSecondary }]}>WHAT YOU ASKED FOR</Text>
                  {wantRowsView(m.wants).map((w, i) => (
                    <View key={i} style={{ gap: space.xs }}>
                      <Text style={[type.callout, { color: p.textTertiary }]}>{w.label}</Text>
                      <Text style={[type.body, { color: p.text }]}>{w.want}</Text>
                      <Text style={[type.body, { color: w.dim ? p.textTertiary : p.text }]}>
                        {w.prefix && <Text style={{ color: p.textSecondary }}>{w.prefix}  </Text>}
                        {w.theirs}
                      </Text>
                    </View>
                  ))}
                </>
              )}

              {m.opener && (
                <>
                  <Crease />
                  <Text style={[type.callout, { color: p.textSecondary }]}>{m.opener}</Text>
                </>
              )}

              {fade(m.fadesAt).line && (
                <Text style={[type.callout, { color: p.textTertiary }]}>{fade(m.fadesAt).line}</Text>
              )}

              {/* CONSENT FIRST (2026-09-28). The first move is made on these words and
                  their character alone: a yes shares YOUR profile. The second move comes
                  after they shared theirs: see it, then share yours back or not. */}
              {turnOf(m) === 'share-first' && (
                <>
                  <Button label={m.practice ? WORDS.shareFirstPractice : WORDS.shareFirst}
                          variant="primary" onPress={() => void share(m.id)} />
                  {/* No is silent. Nobody is ever told they were passed on, so nobody
                      can compare notes about who said no to whom. */}
                  <Button label={WORDS.notThisOne} variant="ghost" onPress={() => void pass(m.id)} />
                  <Text style={[type.callout, { color: p.textTertiary }]}>
                    {m.practice ? WORDS.practiceNote : WORDS.shareFirstNote}
                  </Text>
                </>
              )}
              {turnOf(m) === 'share-back' && (
                <>
                  <Button label={m.practice ? WORDS.seeThemPractice : WORDS.seeThem}
                          variant="primary" onPress={() => router.push(`/match/${m.id}`)} />
                  <Button label={WORDS.notThisOne} variant="ghost" onPress={() => void pass(m.id)} />
                </>
              )}
              {(turnOf(m) === 'you-shared' || turnOf(m) === 'they-first') && (
                <Text style={[type.callout, { color: p.textTertiary }]}>
                  {turnOf(m) === 'they-first' ? WORDS.theyFirst
                    : m.practice ? WORDS.youSharedPractice : WORDS.youShared}
                </Text>
              )}
              {failedFor === m.id && (
                <Text style={[type.callout, { color: p.warning }]}>{WORDS.failed}</Text>
              )}

              {/* On every card, answered or not: somebody's own words can be the thing
                  that needs reporting, before anybody has said yes. */}
              <Pressable onPress={() => setSafetyFor(m.id)} accessibilityRole="button"
                         accessibilityLabel="Block or report" hitSlop={8}>
                <Text style={[type.callout, { color: p.textTertiary, textAlign: 'center' }]}>Block or report</Text>
              </Pressable>
            </Surface>
          ))
        )}
        </>)}
      </View>

      {safetyFor && (
        <SafetySheet target={{ rendezvousId: safetyFor }}
                     onClose={() => setSafetyFor(null)}
                     onDone={() => { setMatches((ms) => ms.filter((m) => m.id !== safetyFor)); void load(); }} />
      )}
    </Screen>
  );
}
