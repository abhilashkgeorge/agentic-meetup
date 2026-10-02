/**
 * How you appear: what your agent looks for, and what somebody else sees about you.
 *
 * Two halves, and both used to be invisible.
 *
 * WHAT IT BRINGS YOU. An agent that filters people is doing something nobody can see:
 * you never meet the people it ruled out, so you never notice a rule stricter than you
 * meant. So the rules are read back in plain words -- built by the server from what
 * you tapped, no model -- with the half people are most surprised by said out loud:
 * anybody who has not answered a card still passes it.
 *
 * WHAT THEY SEE. A card about you carries a line of basics, the line every card
 * carries, interests you share with the reader, and up to two of your own sentences --
 * each checked word for word against something you actually typed. This lists every
 * sentence that could ever reach a card, marks the two that do, and lets you hide any
 * of them. Nothing here is guessed: if it is not on this screen, it cannot be on
 * anybody's card.
 *
 * WHAT YOUR AGENT SAYS WHEN ASKED. When two agents meet they ask each other the same
 * everyday questions, and each answers only with a sentence its person typed, or "I
 * don't know" (server/src/matching/answer-sheet.ts). This is that sheet, exactly as a
 * stranger's agent would hear it, with a Hide on every answer -- read here first,
 * before anybody else can.
 */
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import {
  getAppearance, getReadback, setQuoteHidden, type Appearance, type Readback,
} from '../../lib/api';
import { useSession } from '../../store/session';
import {
  Button, Card, Chip, ChipGroup, Crease, Header, LoadFailed, Screen, ScreenTitle, Skeleton,
  SkeletonChips, SkeletonGroup, space, type, usePalette,
} from '../../components/ui';
import { everyCardSays, hideAsk, sheetView, withHidden, withShared } from './appearance-state';

export default function AppearanceScreen() {
  const p = usePalette();
  const token = useSession((s) => s.token);
  const [look, setLook] = useState<Appearance | null>(null);
  const [rules, setRules] = useState<Readback | null>(null);
  /**
   * Whether the page is here. A failed read used to end "loading" with nothing to show,
   * and "What someone sees about you" kept its placeholder for good.
   */
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const loading = status === 'loading';
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const [a, r] = await Promise.all([getAppearance(token), getReadback(token)]);
    if (!a) { setStatus((s) => (s === 'ready' ? s : 'failed')); return; }
    setLook(a);
    if (r) setRules(r);
    setStatus('ready');
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const toggle = useCallback(async (factId: string, hidden: boolean) => {
    if (!token || !look) return;
    const before = look;
    setBusy(factId);
    setNote(null);
    setLook(withHidden(look, factId, hidden));
    const ok = await setQuoteHidden(token, factId, hidden);
    setBusy(null);
    // Put it back rather than show a card that is not what strangers see.
    if (!ok) { setLook(before); setNote('That did not save. Check your connection and try again.'); return; }
    void load();
  }, [token, look, load]);

  /** "OK to share": one learned sentence becomes something your agent may say. */
  const share = useCallback(async (factId: string) => {
    if (!token || !look) return;
    const before = look;
    setBusy(factId);
    setNote(null);
    setLook(withShared(look, factId));
    const ok = await setQuoteHidden(token, factId, false);
    setBusy(null);
    if (!ok) { setLook(before); setNote('That did not save. Check your connection and try again.'); return; }
    void load();
  }, [token, look, load]);

  return (
    <Screen onRefresh={() => void load()} padded={false}>
      <Header title="" onBack={() => router.back()} />
      <ScreenTitle title="How you appear" subtitle="What your agent looks for, and what others see." />

      <View style={{ paddingHorizontal: space.screen, gap: space.lg }}>
        {status === 'failed' ? (
          <LoadFailed what="how you appear" onRetry={() => { setStatus('loading'); void load(); }} />
        ) : (<>
        <Card label="Your agent only brings you people who">
          {loading ? (
            <SkeletonGroup label="Loading your rules">
              <Skeleton height={14} width="85%" />
              <Skeleton height={14} width="70%" />
              <Skeleton height={14} width="60%" />
            </SkeletonGroup>
          ) : rules && rules.lines.length ? (
            <>
              {rules.lines.map((l) => (
                <Text key={l} style={[type.body, { color: p.text }]}>• {l}</Text>
              ))}
              <Text style={[type.callout, { color: p.textSecondary }]}>{rules.footer}</Text>
            </>
          ) : (
            <Text style={[type.body, { color: p.textSecondary }]}>
              {rules?.sentence ?? 'Nothing set yet.'}
            </Text>
          )}
          <Button label="Change a rule" variant="ghost" onPress={() => router.push('/preferences')} />
        </Card>

        <Card label="What someone sees about you">
          {loading || !look ? (
            <SkeletonGroup label="Loading what others see">
              <Skeleton height={18} width="75%" />
              <Skeleton height={14} width="90%" />
              <SkeletonChips count={3} />
            </SkeletonGroup>
          ) : (
            <>
              <Text style={[type.bodyStrong, { color: p.text }]}>{look.headline}</Text>
              <Text style={[type.callout, { color: p.textSecondary }]}>{everyCardSays(look.line)}</Text>
              {look.tags.length > 0 && (
                <>
                  <Crease />
                  <Text style={[type.callout, { color: p.textSecondary }]}>
                    Shown when they share it with you:
                  </Text>
                  <ChipGroup>
                    {look.tags.map((t) => <Chip key={t} label={t} selected={false} onPress={() => {}} disabled />)}
                  </ChipGroup>
                </>
              )}
              <Crease />
              {look.quotes.length === 0 ? (
                <Text style={[type.callout, { color: p.textTertiary }]}>
                  No sentences of yours yet. Talk to your clone and the ones you type can show here.
                </Text>
              ) : (
                <>
                  <Text style={[type.callout, { color: p.textSecondary }]}>
                    Up to two of these go on a card. Hide any you would rather keep to yourself.
                  </Text>
                  {look.quotes.map((q) => (
                    <View key={q.factId} style={{ gap: space.xs }}>
                      <Text style={[type.body, { color: q.hidden ? p.textTertiary : p.text, fontStyle: 'italic' }]}>
                        “{q.text}”
                      </Text>
                      {/* Names where they work, studied or live (item 14): ask, never hide for them. */}
                      {!q.hidden && hideAsk(q.names) && (
                        <Text style={[type.callout, { color: p.textSecondary }]}>{hideAsk(q.names)}</Text>
                      )}
                      <ChipGroup>
                        <Chip
                          label={q.hidden ? 'Hidden' : q.shown ? 'On your card' : 'Not on a card now'}
                          selected={q.shown}
                          onPress={() => {}}
                          disabled
                        />
                        <Chip
                          label={q.hidden ? 'Show' : 'Hide'}
                          selected={false}
                          disabled={busy === q.factId}
                          onPress={() => void toggle(q.factId, !q.hidden)}
                        />
                      </ChipGroup>
                    </View>
                  ))}
                </>
              )}
            </>
          )}
        </Card>

        {/* An older server sends no sheet; the card is simply not drawn. */}
        {(loading || look?.sheet) && (
          <Card label="When another agent asks yours">
            {loading || !look ? (
              <SkeletonGroup label="Loading what others see">
                <Skeleton height={18} width="75%" />
                <Skeleton height={14} width="90%" />
                <SkeletonChips count={3} />
              </SkeletonGroup>
            ) : (
              <SheetAnswers look={look} busy={busy} onToggle={(id, hidden) => void toggle(id, hidden)} />
            )}
          </Card>
        )}

        {/* LEARNED IN CHAT, NOT SHARED (2026-09-25): used for matching, said nowhere
            until the person says so, one sentence at a time. */}
        {look && (look.learned ?? []).length > 0 && (
          <Card label="Learned in chat">
            <Text style={[type.callout, { color: p.textSecondary }]}>
              Only you see these. Your agent uses them to find people, but never says them until you tap OK to share.
            </Text>
            {(look.learned ?? []).map((l) => (
              <View key={l.factId} style={{ gap: space.xs }}>
                <Text style={[type.body, { color: p.text, fontStyle: 'italic' }]}>“{l.text}”</Text>
                <ChipGroup>
                  <Chip label="OK to share" selected={false} disabled={busy === l.factId}
                        onPress={() => void share(l.factId)} />
                </ChipGroup>
              </View>
            ))}
          </Card>
        )}

        {note && <Text style={[type.callout, { color: p.danger }]}>{note}</Text>}
        </>)}
      </View>
    </Screen>
  );
}

/** The sheet: what your agent answers, what it says "I don't know" to, and what you hid. */
function SheetAnswers({ look, busy, onToggle }: {
  look: Appearance;
  busy: string | null;
  onToggle: (factId: string, hidden: boolean) => void;
}) {
  const p = usePalette();
  const { answered, unknown } = sheetView(look.sheet);
  const hidden = look.hidden ?? [];
  return (
    <>
      <Text style={[type.callout, { color: p.textSecondary }]}>
        It answers only in your own words, and says “I don't know” to anything you never said.
        Hiding an answer takes it off your card too.
      </Text>
      {answered.map((q) => (
        <View key={q.id} style={{ gap: space.xs }}>
          <Text style={[type.callout, { color: p.textTertiary }]}>{q.ask}</Text>
          <Text style={[type.body, { color: p.text, fontStyle: 'italic' }]}>“{q.answer.text}”</Text>
          {hideAsk(q.answer.names) && (
            <Text style={[type.callout, { color: p.textSecondary }]}>{hideAsk(q.answer.names)}</Text>
          )}
          <ChipGroup>
            <Chip label="Hide" selected={false} disabled={busy === q.answer.factId}
                  onPress={() => onToggle(q.answer.factId, true)} />
          </ChipGroup>
        </View>
      ))}
      {unknown.length > 0 && (
        <>
          {answered.length > 0 && <Crease />}
          <Text style={[type.callout, { color: p.textSecondary }]}>
            Says “I don't know” to: {unknown.join(', ')}. Tell your agent about these in chat and it can answer them.
          </Text>
          <Button label="Give it more to talk about" variant="ghost" onPress={() => router.push('/stories')} />
        </>
      )}
      {hidden.length > 0 && (
        <>
          <Crease />
          <Text style={[type.callout, { color: p.textSecondary }]}>Hidden. Your agent never says these:</Text>
          {hidden.map((h) => (
            <View key={h.factId} style={{ gap: space.xs }}>
              <Text style={[type.body, { color: p.textTertiary, fontStyle: 'italic' }]}>“{h.text}”</Text>
              <ChipGroup>
                <Chip label="Show" selected={false} disabled={busy === h.factId}
                      onPress={() => onToggle(h.factId, false)} />
              </ChipGroup>
            </View>
          ))}
        </>
      )}
    </>
  );
}
