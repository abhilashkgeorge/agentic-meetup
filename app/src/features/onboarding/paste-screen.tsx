/**
 * Bringing over what another AI already knows.
 *
 * The single highest-yield minute in the whole funnel. Somebody who has used ChatGPT
 * or Claude for years has a record of their work, interests, projects and constraints
 * that no form would ever extract.
 *
 * Two lines of setup copy do real work and are not decoration: a NEW chat is what
 * makes retrieval reach past the short rolling summary, and staying OUT of a Project
 * stops the search being scoped to that project's files.
 */
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { getImportPrompts, importPaste, type ImportPrompts } from '../../lib/api';
import { useSession } from '../../store/session';
import {
  Animation,
  Button, Card, Field, Screen, Surface, radius, space, type, usePalette,
} from '../../components/ui';

export default function PasteScreen() {
  const p = usePalette();
  const token = useSession((s) => s.token);
  const [prompts, setPrompts] = useState<ImportPrompts | null>(null);
  const [text, setText] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [done, setDone] = useState<{ staged: number; questions: number } | null>(null);

  useEffect(() => {
    void (async () => setPrompts(await getImportPrompts()))();
  }, []);

  const prompt = prompts?.assistantPrompt ?? 'Tell me everything you know about me.';

  const submit = useCallback(async () => {
    if (!token || !text.trim()) return;
    setBusy(true);
    // Which box they used decides provenance, and provenance decides how much the
    // server trusts it. Typed straight in without copying is self-description, which
    // is stronger evidence than a machine's summary, not weaker.
    const r = await importPaste(token, text.trim(), copied ? 'assistant' : 'self');
    setBusy(false);
    if (!r) return setNote('Could not reach the server.');
    setText('');
    setDone({ staged: r.staged, questions: r.questions ?? 0 });
  }, [token, text, copied]);

  if (done) {
    return (
      <Screen topInset={false}
        footer={<Button label="Next" variant="primary" onPress={() => router.push('/onboarding/interview')} />}
      >
        <Text style={[type.display, { color: p.text }]}>Got it</Text>
        <Card label="Held for checking">
          <Text style={[type.title, { color: p.text }]}>{done.staged}</Text>
          <Text style={[type.callout, { color: p.textSecondary }]}>
            Nothing is treated as true until you say so.
          </Text>
        </Card>
        {done.questions > 0 && (
          <Card label="It was guessing at these">
            <Text style={[type.title, { color: p.text }]}>{done.questions}</Text>
            <Text style={[type.callout, { color: p.textSecondary }]}>
              Your AI was not sure, so we kept none of them. It will ask you instead.
            </Text>
          </Card>
        )}
      </Screen>
    );
  }

  return (
    <Screen topInset={false}
      footer={
        <>
          <Button label="Next" variant="primary" onPress={() => void submit()}
                  disabled={!text.trim()} loading={busy} />
          <Button label="Skip — I'll type it myself later" variant="ghost"
                  onPress={() => router.push('/onboarding/interview')} />
        </>
      }
    >
      <View style={{ gap: space.sm }}>
        <Animation mood="orbit" height={150} opacity={0.5} />
        <Text style={[type.display, { color: p.text }]}>Bring what it knows</Text>
        <Text style={[type.body, { color: p.textSecondary }]}>
          Copy this into ChatGPT, Claude or Gemini. Paste the answer back.
        </Text>
      </View>

      <Card label="1 · Copy this">
        <Surface depth="sunken" radius={radius.md} style={{ padding: space.lg, maxHeight: 150 }}>
          <Text numberOfLines={7} style={[type.callout, { color: p.textSecondary }]}>{prompt}</Text>
        </Surface>
        <Button
          label={copied ? 'Copied ✓' : 'Copy the question'}
          variant={copied ? 'secondary' : 'primary'}
          onPress={() => void (async () => {
            // Lazily loaded: see the note in components/error-boundary.tsx. Copying
            // is a convenience and must not be able to stop the app from starting.
            try {
              const Clipboard = await import('expo-clipboard');
              await Clipboard.setStringAsync(prompt);
            } catch { /* the prompt is on screen and selectable */ }
            setCopied(true);
          })()}
        />
        <Text style={[type.callout, { color: p.textTertiary }]}>
          Start a new chat. Not inside a Project.
        </Text>
      </Card>

      <Card label="2 · Paste the answer">
        <Field value={text} onChangeText={(t) => { setText(t); setNote(null); }}
               placeholder="Paste it here, or just write about yourself"
               multiline minHeight={150} maxLength={prompts?.maxChars} error={note} />
      </Card>
    </Screen>
  );
}
