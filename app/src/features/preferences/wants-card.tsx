/**
 * YOUR WANTS: each one beside the question the other person answers, and the answers
 * that are fine (build list, 2026-09-26). Ticking saves an ordinary rule, which then
 * shows below with Must have / Really want / Nice to have like every other.
 */
import { useState } from 'react';
import { Text, View } from 'react-native';
import { clearWantQuestion, setWantQuestion } from '../../lib/api';
import { useSession } from '../../store/session';
import { Button, Card, Chip, ChipGroup, Crease, type as t, space, usePalette } from '../../components/ui';
import { acceptsEverybody, canSave, startTicks, toggleTick, wantHeading, wantLine, type WantView } from './wants-state';

export function WantsCard({ wants, onSaved }: { wants: WantView[]; onSaved: () => void }) {
  const p = usePalette();
  if (!wants.length) return null;
  return (
    <Card label="Your wants">
      <Text style={[t.callout, { color: p.textSecondary }]}>
        What you told your clone you want. A want with a question is checked against the other person's answer.
      </Text>
      {wants.map((w, i) => (
        <View key={w.text} style={{ gap: space.sm }}>
          {i > 0 && <Crease />}
          <WantRow w={w} onSaved={onSaved} />
        </View>
      ))}
      <Text style={[t.callout, { color: p.textTertiary }]}>
        Nobody is told what you asked for, or that it was you.
      </Text>
    </Card>
  );
}

function WantRow({ w, onSaved }: { w: WantView; onSaved: () => void }) {
  const p = usePalette();
  const token = useSession((s) => s.token);
  const [ticks, setTicks] = useState<string[]>(startTicks(w));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const q = w.question;

  const save = async () => {
    if (!token || !q) return;
    setBusy(true);
    const ok = await setWantQuestion(token, w.text, q.id, ticks);
    setBusy(false);
    if (!ok) { setNote('That did not save. Try again.'); return; }
    setNote(null);
    onSaved();
  };
  const clear = async () => {
    if (!token) return;
    setBusy(true);
    await clearWantQuestion(token, w.text);
    setBusy(false);
    onSaved();
  };

  return (
    <>
      <Text style={[t.body, { color: p.text, fontStyle: 'italic' }]}>
        {wantHeading(w)}
      </Text>
      <Text style={[t.callout, { color: p.textTertiary }]}>{wantLine(w)}</Text>
      {q && (
        <>
          <Text style={[t.callout, { color: p.textSecondary }]}>We ask: “{q.text}”</Text>
          <ChipGroup>
            {q.options.map((o) => (
              <Chip key={o.value} label={o.label} selected={ticks.includes(o.value)}
                    onPress={() => setTicks((x) => toggleTick(x, o.value, q.options))} />
            ))}
          </ChipGroup>
          {acceptsEverybody(ticks, q.options) && (
            <Text style={[t.callout, { color: p.warning }]}>Every answer is fine, so this rules nobody out and ranks nobody.</Text>
          )}
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button label={w.accepted ? 'Save changes' : 'Use this question'} variant="primary"
                    disabled={!canSave(ticks)} loading={busy} onPress={() => void save()} style={{ flex: 1 }} />
            {w.accepted && <Button label="Stop checking" variant="ghost" onPress={() => void clear()} />}
          </View>
        </>
      )}
      {note && <Text style={[t.callout, { color: p.danger }]}>{note}</Text>}
    </>
  );
}
