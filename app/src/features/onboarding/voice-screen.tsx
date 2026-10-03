/**
 * Making it sound like you.
 *
 * Facts are the easy half. Without this the clone is correct and sounds like nobody,
 * and the first person who reads it knows in one line.
 *
 * The export is parsed ON THIS PHONE. It is mostly somebody else's words and they
 * never agreed to anything, so their half is dropped before anything crosses the
 * network.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { parseChatExport, type ParsedChat } from '@clone/shared';
import { getImportPrompts, importChat, type ImportPrompts, type VoiceResult } from '../../lib/api';
import { useSession } from '../../store/session';
import { noteVoiceLearned } from './chat-return';
import {
  Animation, Button, Card, Crease, Field, Loading, Orb, Screen, space, type, usePalette,
} from '../../components/ui';

/** Anything past this is an export WITH media, and reading it kills the app. */
const MAX_FILE_BYTES = 25_000_000;

const FALLBACK = {
  who: 'Pick a friend you talk to normally. Not your boss, not a group chat.',
  why: 'It learns your words, your length, your habits.',
  how: ['Open the chat in WhatsApp', 'Tap the name at the top', 'Scroll down, tap Export chat',
        'Choose Without media', 'Open it here'],
  privacy: 'Only your own messages are sent. The other person’s never leave this phone.',
};

export default function VoiceScreen() {
  const p = usePalette();
  const token = useSession((s) => s.token);
  // Opened from the setup chat: back to it, after the note or a skip -- not on to the
  // self-test, which the chat has already done.
  const { from } = useLocalSearchParams<{ from?: string }>();
  const fromChat = from === 'chat';
  const [guide, setGuide] = useState<ImportPrompts | null>(null);
  const [chat, setChat] = useState<ParsedChat | null>(null);
  const [text, setText] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [busy, setBusy] = useState<null | 'reading' | 'learning'>(null);
  const [note, setNote] = useState<string | null>(null);
  const [result, setResult] = useState<VoiceResult | null>(null);

  useEffect(() => {
    void (async () => setGuide(await getImportPrompts()))();
  }, []);

  const g = guide?.chatGuide ?? FALLBACK;

  const readChat = useCallback((raw: string) => {
    setNote(null);
    let parsed;
    try {
      parsed = parseChatExport(raw);
    } catch {
      setNote('Could not read that. It may not be a WhatsApp export.');
      return setShowPaste(true);
    }
    if (parsed.speakers.length < 2) {
      return setNote('That does not look like an export. Choose "Without media" and try again.');
    }
    setText('');
    setChat(parsed);
  }, []);

  const pickFile = useCallback(async () => {
    try {
      // Loaded on the tap, not at import: see the note in lib/api.ts. Picking a file
      // is one screen's feature and must not decide whether the app starts.
      const { File } = await import('expo-file-system');
      const picked = await File.pickFileAsync({ mimeTypes: ['text/plain', 'text/*'] });
      if (picked.canceled || !picked.result) return;
      // Checked BEFORE reading: .text() pulls the whole file into one string and the
      // OS kills the app rather than throwing something catchable.
      const size = picked.result.size ?? 0;
      if (size > MAX_FILE_BYTES) {
        return setNote(`That file is ${Math.round(size / 1_000_000)}MB. Export again with "Without media".`);
      }
      setBusy('reading');
      const raw = await picked.result.text();
      setBusy(null);
      readChat(raw);
    } catch {
      setBusy(null);
      setNote('Could not read that file. Paste the text instead.');
      setShowPaste(true);
    }
  }, [readChat]);

  const learn = useCallback(async (speaker: string) => {
    if (!token || !chat) return;
    // The moment the other person's half is discarded — before the network.
    const mine = chat.lines.filter((l) => l.speaker === speaker).map((l) => l.text);
    if (mine.length < 20) return setNote('Not enough of your own messages. Pick a longer chat.');
    setBusy('learning');
    const r = await importChat(token, mine.slice(-2000));
    setBusy(null);
    if (!r) return setNote('Could not learn from that chat.');
    if (fromChat) noteVoiceLearned();
    setChat(null);
    setResult(r);
  }, [token, chat, fromChat]);

  if (result) {
    return (
      <Screen topInset={false} footer={fromChat
        ? <Button label="Back to the chat" variant="primary" onPress={() => router.back()} />
        : <Button label="Now test it" variant="primary" onPress={() => router.push('/onboarding/test')} />}>
        <Text style={[type.display, { color: p.text }]}>That's you</Text>
        <Text style={[type.body, { color: p.textSecondary }]}>
          Read from {result.messagesUsed} of your messages.
        </Text>
        <Card>
          <Text style={[type.body, { color: p.text }]}>{result.style}</Text>
          {result.habits.map((h) => (
            <Text key={h} style={[type.callout, { color: p.textSecondary }]}>• {h}</Text>
          ))}
          {result.never.length > 0 && (
            <>
              <Crease />
              <Text style={[type.label, { color: p.textTertiary }]}>NEVER</Text>
              <Text style={[type.callout, { color: p.textSecondary }]}>{result.never.join(' · ')}</Text>
            </>
          )}
        </Card>
        <Text style={[type.callout, { color: p.textTertiary }]}>
          Only this note is kept. The chat was never stored.
        </Text>
      </Screen>
    );
  }

  if (chat) {
    return (
      <Screen topInset={false} footer={<Button label="Wrong chat" variant="ghost" onPress={() => setChat(null)} />}>
        <Animation mood="speaking" height={140} opacity={0.45} />
        <Text style={[type.display, { color: p.text }]}>Which one is you?</Text>
        {busy === 'learning' ? (
          <Loading label="Working out how you write" orb="composing" section />
        ) : (
          <Card>
            {chat.speakers.map((s, i) => (
              <View key={s.name}>
                {i > 0 && <Crease />}
                <Button label={`${s.name} · ${s.messages} messages`} onPress={() => void learn(s.name)} />
              </View>
            ))}
          </Card>
        )}
        {note && <Text style={[type.callout, { color: p.danger }]}>{note}</Text>}
      </Screen>
    );
  }

  return (
    <Screen topInset={false}
      footer={
        <>
          <Button label="Pick the exported file" variant="primary" onPress={() => void pickFile()} />
          <Button label={showPaste ? 'Hide the paste box' : 'Paste it instead'} variant="ghost"
                  onPress={() => setShowPaste((v) => !v)} />
          <Button label="Skip this for now" variant="ghost"
                  onPress={() => (fromChat ? router.back() : router.push('/onboarding/test'))} />
        </>
      }
    >
      <Animation mood="speaking" height={140} opacity={0.45} />

      <View style={{ gap: space.sm }}>
        <Text style={[type.display, { color: p.text }]}>Now, how you talk</Text>
        <Text style={[type.body, { color: p.textSecondary }]}>
          Knowing facts about you is not the same as sounding like you.
        </Text>
      </View>

      <Card label="Who to pick">
        <Text style={[type.body, { color: p.text }]}>{g.who}</Text>
        <Text style={[type.callout, { color: p.textSecondary }]}>{g.why}</Text>
        <Crease />
        <Text style={[type.label, { color: p.textTertiary }]}>HOW TO GET IT</Text>
        {g.how.map((step, i) => (
          <Text key={step} style={[type.callout, { color: p.textSecondary }]}>{i + 1}. {step}</Text>
        ))}
        <Crease />
        <Text style={[type.callout, { color: p.textTertiary }]}>{g.privacy}</Text>
      </Card>

      {busy === 'reading' && <Orb state="composing" size={20} label="Reading" style={{ alignSelf: 'center' }} />}

      {showPaste && (
        <Card>
          <Field value={text} onChangeText={setText} placeholder="Paste the whole chat"
                 multiline minHeight={140} />
          <Button label="Use this chat" onPress={() => readChat(text)}
                  disabled={text.trim().length < 200} />
        </Card>
      )}

      {note && <Text style={[type.callout, { color: p.danger }]}>{note}</Text>}
    </Screen>
  );
}
