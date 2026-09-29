/**
 * The one screen that has to exist before anybody else uses this.
 *
 * NOTHING EVER AGREED TO ANYTHING. There was no terms screen, no privacy notice and
 * no age attestation anywhere in this app. The database enforces eighteen; this is
 * where the person actually says it, and the saying is the part you need later.
 *
 * THREE SEPARATE THINGS, NOT ONE TICKBOX, and that is not legal theatre. They are
 * versioned independently server-side, so somebody can have accepted last year's
 * privacy notice and not this year's -- a real state a single boolean cannot
 * represent. Showing them separately is also more honest: a person who does not want
 * to agree to one of them should be able to see which one.
 *
 * NO SMALL PRINT AND NO SCROLL TRAP. The text is short enough to read, in the words
 * somebody would use. A wall nobody reads, with a button that enables only once you
 * have scrolled past it, produces consent worth exactly nothing.
 */
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { acceptConsent, getConsent, type ConsentDoc } from '../../lib/api';
import { isOnboarded } from '../../lib/storage';
import { useSession } from '../../store/session';
import {
  Animation, Button, Card, Crease, Screen, space, type, usePalette,
} from '../../components/ui';

/**
 * What each document actually says, in plain words.
 *
 * Keyed by the server's document name. A document the server asks for that this map
 * does not know still renders -- with its server-supplied title and nothing else --
 * because failing to show somebody a screen is worse than showing them a thin one.
 */
const SAYS: Record<string, string[]> = {
  age: [
    'You have to be 18 or older to use this.',
    'We keep the year you were born. Other people only ever see your age.',
  ],
  terms: [
    'Be a person. No harassment, no pretending to be somebody else, no pictures that are not of you.',
    'Your agent talks to other agents for you. You always make the final call about who you meet — it never decides that.',
    'We can take photos down, or remove an account, if somebody reports it and we agree with them.',
  ],
  // What the code does, said plainly (the founder's (f, h), 2026-09-29; server consent.ts
  // privacy v2). The first version promised "Only things marked public ever leave your
  // account" and that you could "change" everything -- neither was true.
  privacy: [
    'Your clone uses what you tell it to represent you to other agents.',
    'Someone your agent meets sees what you mark public, your age, your part of town and what you are here for, and whether you fit what they asked for about work, exercise, sleep or moving cities.',
    'Your answers to private questions, like faith, drinking or kids, help decide who you meet. They are never shown.',
    'Your photos and first name reach a person only after you say yes to sharing your profile with them.',
    'In Settings you can read everything it knows about you, say what is wrong, and delete the whole account.',
    // Server 0082, privacy v3: a deleted account's chats are held, hidden, for a report.
    'If you delete your account, your chats are kept hidden for 30 days so the people you talked to can still report you. Only a reviewer reads them, and only after a report. Then they are deleted.',
    'What you type and your messages go to AI providers, to run your clone and to search what it remembers. We do not sell anything to anybody.',
  ],
};

export default function ConsentScreen() {
  const p = usePalette();
  const token = useSession((s) => s.token);
  const [docs, setDocs] = useState<ConsentDoc[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const state = await getConsent(token);
    if (!state) { setNote('Could not reach the server.'); return; }
    // Already settled -- somebody arrived here by navigating, not by being sent.
    if (state.settled) { router.replace('/'); return; }
    setDocs(state.outstanding);
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const agree = async () => {
    if (!token || !docs) return;
    setBusy(true);
    const r = await acceptConsent(token, docs);
    setBusy(false);
    if (!r) { setNote('Could not reach the server. Try again.'); return; }
    // SETUP NEXT, IF IT HAS NOT BEEN DONE. This used to go straight to the app, which
    // was fine while consent was only ever reached on a LATER launch -- the root
    // layout had already decided setup was finished. Now that a new account is sent
    // here the moment its invite is redeemed, that assumption is gone: agreeing would
    // drop somebody into an empty clone, and they would only be offered setup on the
    // next cold start.
    router.replace((await isOnboarded()) ? '/' : '/onboarding');
  };

  return (
    <Screen
      footer={
        <>
          <Button label="I agree" variant="primary" onPress={() => void agree()}
                  disabled={!docs || busy} loading={busy} />
          {/* No decline button, and no pretending there is a choice inside the app:
              the only way not to agree is not to use it. Saying so plainly beats a
              button that drops somebody on a dead end. */}
          <Text style={[type.callout, { color: p.textTertiary, textAlign: 'center' }]}>
            If you would rather not, close the app — nothing has been set up yet.
          </Text>
        </>
      }
    >
      <View style={{ gap: space.sm }}>
        <Animation mood="alive" height={120} opacity={0.4} />
        <Text style={[type.display, { color: p.text }]}>Before we start</Text>
        <Text style={[type.body, { color: p.textSecondary }]}>
          Three things, in plain words. They are short on purpose.
        </Text>
      </View>

      {(docs ?? []).map((d, i) => (
        <Card key={`${d.document}@${d.version}`}>
          <View style={{ gap: space.sm }}>
            {i > 0 && <Crease />}
            <Text style={[type.label, { color: p.textSecondary }]}>
              {d.title.toUpperCase()}
            </Text>
            {(SAYS[d.document] ?? []).map((line, j) => (
              <Text key={j} style={[type.body, { color: p.text }]}>{line}</Text>
            ))}
          </View>
        </Card>
      ))}

      {note && <Text style={[type.callout, { color: p.danger }]}>{note}</Text>}
    </Screen>
  );
}
