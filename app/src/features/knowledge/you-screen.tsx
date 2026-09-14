/**
 * "What it knows" — the trust surface, and the screen this product is actually sold on.
 *
 * The ORDER is the argument. Anybody can list what they know about you; a system that
 * guesses produces a longer list. So the refusals come first.
 *
 *   IT WON'T GUESS       questions it is holding instead of inventing answers
 *   IS THIS RIGHT?       one expensive claim at a time
 *   IT PICKED UP N       the cheap pile, kept with one tap
 *   IT CHANGED ITS MIND  what used to be true
 *   IT KNOWS             beliefs, each with where it came from
 *
 * The first and fourth are the ones nobody else can render. A store that overwrites
 * does not know a value ever differed; one that fills gaps by inference has no gaps.
 */
import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import {
  getKnowledge, getHistory, judgeFact, importPaste, reviewFacts,
  type Knowledge, type HistoryEntry,
} from '../../lib/api';
import { useSession } from '../../store/session';
import {
  Button, ButtonRow, Card, Crease, Empty, Field, Header, Screen, ScreenTitle,
  Surface, HIT, radius, space, type, usePalette,
} from '../../components/ui';

export default function YouScreen() {
  const p = usePalette();
  const token = useSession((s) => s.token);
  const [k, setK] = useState<Knowledge | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [struck, setStruck] = useState<Set<string>>(new Set());
  const [paste, setPaste] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [lineage, setLineage] = useState<{ label: string; entries: HistoryEntry[] } | null>(null);

  const load = useCallback(async () => {
    if (token) setK(await getKnowledge(token));
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const judge = useCallback(async (verdict: 'yes' | 'no') => {
    if (!token || !k?.confirm) return;
    setBusy(true);
    const r = await judgeFact(token, k.confirm.factId, verdict);
    setBusy(false);
    setNote(r?.message ?? 'Could not reach the server.');
    void load();
  }, [token, k, load]);

  const keepRest = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    const r = await reviewFacts(token, [...struck]);
    setBusy(false);
    setNote(r?.message ?? null);
    setStruck(new Set());
    void load();
  }, [token, struck, load]);

  const submitPaste = useCallback(async () => {
    if (!token || !paste.trim()) return;
    setBusy(true);
    const r = await importPaste(token, paste.trim(), 'assistant');
    setBusy(false);
    setNote(r?.message ?? 'Could not reach the server.');
    if (r) { setPaste(''); setPasteOpen(false); }
    void load();
  }, [token, paste, load]);

  if (!token) {
    return <Screen center><Empty title="Not connected" body="Check the server is running." /></Screen>;
  }

  return (
    <>
      <Screen onRefresh={() => void load()} padded={false}>
        <ScreenTitle title="What it knows" />

        <View style={{ paddingHorizontal: space.screen, gap: space.lg }}>
          {/* FIRST, deliberately. Every rival's version of this screen opens with what
              it knows, because a long list looks like competence. The refusals are the
              only half that cannot be faked by guessing harder. */}
          {k && k.wontGuess.length > 0 && (
            <Card label="It won't guess">
              <Text style={[type.callout, { color: p.textSecondary }]}>
                It could have made these up. It didn't.
              </Text>
              {k.wontGuess.map((g, i) => (
                <View key={g.id}>
                  {i > 0 && <Crease />}
                  <Text style={[type.body, { color: p.text }]}>{g.question}</Text>
                </View>
              ))}
            </Card>
          )}

          {k?.confirm && (
            <Card label="Is this right?">
              <Text style={[type.bodyStrong, { color: p.text }]}>{k.confirm.claim}</Text>
              <Text style={[type.callout, { color: p.textTertiary, fontStyle: 'italic' }]}>
                “{k.confirm.from}”
              </Text>
              <ButtonRow>
                <Button label="Yes" variant="primary" onPress={() => void judge('yes')}
                        disabled={busy} style={{ flex: 1 }} />
                <Button label="No" onPress={() => void judge('no')} disabled={busy} style={{ flex: 1 }} />
              </ButtonRow>
            </Card>
          )}

          {/* The pile, not a queue. Tap the wrong ones; keep the rest with one press. */}
          {k && k.review.length > 0 && (
            <Card label={`It picked up ${k.review.length} things`}>
              <Text style={[type.callout, { color: p.textSecondary }]}>
                Tap anything that is wrong.
              </Text>
              {k.review.map((r, i) => {
                const off = struck.has(r.factId);
                return (
                  <View key={r.factId}>
                    {i > 0 && <Crease />}
                    <Pressable
                      onPress={() => setStruck((prev) => {
                        const next = new Set(prev);
                        next.has(r.factId) ? next.delete(r.factId) : next.add(r.factId);
                        return next;
                      })}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: !off }}
                      accessibilityLabel={`${r.label}: ${r.value}`}
                      style={{ minHeight: HIT, justifyContent: 'center' }}
                    >
                      <Text style={[type.label, { color: p.textTertiary }]}>{r.label.toUpperCase()}</Text>
                      <Text style={[type.body, {
                        color: off ? p.textTertiary : p.text,
                        textDecorationLine: off ? 'line-through' : 'none',
                      }]}>
                        {r.value}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
              <Button
                variant="primary"
                label={struck.size ? `Keep the other ${k.review.length - struck.size}` : 'These are all right'}
                onPress={() => void keepRest()}
                loading={busy}
              />
            </Card>
          )}

          {/* The demo. A store that overwrites cannot produce this section at all. */}
          {k && k.changedMind.length > 0 && (
            <Card label="It changed its mind">
              {k.changedMind.map((ch, i) => (
                <View key={`${ch.label}-${i}`} style={{ gap: 2 }}>
                  {i > 0 && <Crease />}
                  <Text style={[type.label, { color: p.textTertiary }]}>{ch.label.toUpperCase()}</Text>
                  <Text style={[type.body, { color: p.text }]}>
                    <Text style={{ textDecorationLine: 'line-through', color: p.textTertiary }}>
                      {ch.was}
                    </Text>
                    {'   ' + ch.now}
                  </Text>
                </View>
              ))}
              <Text style={[type.callout, { color: p.textTertiary }]}>
                It keeps the old answer. It just stops saying it.
              </Text>
            </Card>
          )}

          <Card label="It knows">
            {k && k.knows.length === 0 && (
              <Text style={[type.body, { color: p.textSecondary }]}>
                Nothing yet. Talk to it and it will start.
              </Text>
            )}
            {k?.knows.map((f, i) => (
              <View key={f.id}>
                {i > 0 && <Crease />}
                <Pressable
                  onPress={() => void (async () => {
                    if (token) setLineage(await getHistory(token, f.predicate));
                  })()}
                  accessibilityRole="button"
                  accessibilityLabel={`${f.label}: ${f.value}. Tap for history.`}
                  style={{ minHeight: HIT, justifyContent: 'center' }}
                >
                  <Text style={[type.label, { color: p.textTertiary }]}>{f.label.toUpperCase()}</Text>
                  <Text style={[type.body, { color: p.text }]}>{f.value}</Text>
                  <Text style={[type.callout, { color: p.textTertiary }]}>{f.because}</Text>
                </Pressable>
              </View>
            ))}
          </Card>

          <Card label="Catch it up fast">
            {!pasteOpen ? (
              <>
                <Text style={[type.callout, { color: p.textSecondary }]}>
                  Ask ChatGPT or Claude what it knows about you, and paste the answer here.
                </Text>
                <Button label="Paste from another AI" onPress={() => setPasteOpen(true)} />
              </>
            ) : (
              <>
                <Field value={paste} onChangeText={setPaste} placeholder="Paste it here"
                       multiline autoFocus minHeight={130} />
                <Button label="Add this" variant="primary" onPress={() => void submitPaste()}
                        disabled={!paste.trim()} loading={busy} />
                <Button label="Cancel" variant="ghost"
                        onPress={() => { setPasteOpen(false); setPaste(''); }} />
              </>
            )}
          </Card>

          {note && (
            <Text style={[type.callout, { color: p.textSecondary, textAlign: 'center' }]}>{note}</Text>
          )}
          <Text style={[type.callout, { color: p.textTertiary, textAlign: 'center' }]}>
            Nobody else sees any of this.
          </Text>
        </View>
      </Screen>

      <Modal visible={!!lineage} animationType="slide" onRequestClose={() => setLineage(null)}>
        <Screen footer={<Button label="Close" onPress={() => setLineage(null)} />}>
          <Header title={lineage?.label} onBack={() => setLineage(null)} />
          {lineage?.entries.map((e, i) => (
            <Surface key={i} depth={e.current ? 'raised' : 'whisper'}
                     radius={radius.md} style={{ padding: space.lg, gap: 2 }}>
              <Text style={[type.body, { color: e.current ? p.text : p.textSecondary }]}>
                {e.value}
              </Text>
              <Text style={[type.callout, { color: p.textTertiary }]}>
                {e.current ? 'Now' : `Until ${new Date(e.stoppedAt ?? e.recordedAt).toDateString()}`}
              </Text>
            </Surface>
          ))}
        </Screen>
      </Modal>
    </>
  );
}
