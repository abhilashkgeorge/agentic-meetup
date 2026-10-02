/**
 * The plain Home: your clone's chat with the status cards behind it.
 *
 * This is what Home was before the town, and what it still is on a phone where the 3D
 * renderer cannot load or has crashed once (see features/world/world-screen.tsx). The
 * conversation itself lives in CloneChat; this file is the cards.
 */
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { CloneChat } from './clone-chat';
import { useSession } from '../../store/session';
import { getConfig, getKnowledge, getPool, type Config, type Knowledge } from '../../lib/api';
import { countLabel, isUnder20 } from '../../lib/counts';
import { label, setupRoute, missingLabel } from '../profile/fields';
import {
  Button, Card, Chip, ChipGroup, Crease, Screen, Skeleton, SkeletonGroup, space, type, usePalette,
} from '../../components/ui';

/** One tap instead of a blank box. */
const STARTERS = [
  'I moved recently',
  'I changed jobs',
  "What I'm looking for",
  'Something I care about',
  'A dealbreaker',
];

export default function ChatScreen() {
  const p = usePalette();
  const bubbles = useSession((s) => s.bubbles);
  const token = useSession((s) => s.token);
  const [config, setConfig] = useState<Config | null>(null);
  const [k, setK] = useState<Knowledge | null>(null);
  const [pool, setPool] = useState<{ total: number | null; inPool: boolean; missing: string[]; need: string[] } | null>(null);
  /** What it knows could not be had: said, rather than "Getting ready" breathing for good. */
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void (async () => {
      setConfig(await getConfig());
      if (!token) return;
      // The empty screen was the problem. A chat with no messages should still tell
      // somebody where they stand -- what it knows, what it is still missing, and
      // what happens next -- rather than being a void with a text box at the bottom.
      const [kk, po] = await Promise.all([getKnowledge(token), getPool(token)]);
      if (kk) { setK(kk); setFailed(false); } else setFailed(true);
      if (po) setPool({ total: po.total, inPool: po.inPool, missing: po.missing, need: po.need });
    })();
  }, [token, bubbles.length]);

  return (
    <Screen scroll={false} padded={false}>
      <CloneChat
        disclosure={config?.disclosure.perSession ?? 'This is an AI, not a person.'}
        renderEmpty={({ setDraft }) => (
          <>
            {/* Where the person actually stands, before they have said anything. */}
            <Card label={k ? `It knows ${k.knows.length} things about you` : 'Getting ready'}>
              {!k && failed ? (
                <Text style={[type.body, { color: p.textSecondary }]}>
                  Could not load what it knows. You can still talk to it.
                </Text>
              ) : !k ? (
                <SkeletonGroup label="Loading what it knows">
                  <Skeleton height={18} />
                  <Skeleton height={18} width="70%" />
                </SkeletonGroup>
              ) : k.knows.length === 0 ? (
                <Text style={[type.body, { color: p.textSecondary }]}>
                  Nothing yet. Say one true thing and it starts from there.
                </Text>
              ) : (
                <>
                  {k.knows.slice(0, 4).map((f, i) => (
                    <View key={f.id}>
                      {i > 0 && <Crease />}
                      <Text style={[type.label, { color: p.textTertiary }]}>{f.label.toUpperCase()}</Text>
                      <Text style={[type.body, { color: p.text }]}>{f.words ?? label(f.value)}</Text>
                    </View>
                  ))}
                  {k.knows.length > 4 && (
                    <Text style={[type.callout, { color: p.textTertiary }]}>and {k.knows.length - 4} more</Text>
                  )}
                </>
              )}
            </Card>

            {/* The refusals. The half of this product nobody else can print. */}
            {k && k.wontGuess.length > 0 && (
              <Card label="It won't guess">
                <Text style={[type.callout, { color: p.textSecondary }]}>It could have made these up. It didn't.</Text>
                {k.wontGuess.slice(0, 3).map((g, i) => (
                  <View key={g.id}>
                    {i > 0 && <Crease />}
                    <Text style={[type.body, { color: p.text }]}>{g.question}</Text>
                  </View>
                ))}
              </Card>
            )}

            {pool && (
              <Card label={pool.inPool ? 'Your agent is out there' : 'Not out there yet'}>
                {pool.inPool ? (
                  <>
                    <Text style={[type.display, { color: p.text }]}>{countLabel(pool.total)}</Text>
                    <Text style={[type.callout, { color: p.textSecondary }]}>people it can reach right now</Text>
                  </>
                ) : (
                  <>
                    {pool.missing.slice(0, 3).map((m) => (
                      <Text key={m} style={[type.callout, { color: p.textSecondary }]}>• {missingLabel(m)}</Text>
                    ))}
                    <Button label="Finish setup" variant="primary"
                            onPress={() => router.push({ pathname: setupRoute(pool.need), params: { finish: '1' } })} />
                  </>
                )}
              </Card>
            )}

            {/* A blank box is where conversations die. These are one tap. */}
            <Card label="Or just tell it">
              <ChipGroup>
                {STARTERS.map((sug) => (
                  <Chip key={sug} label={sug} selected={false} onPress={() => setDraft(sug)} />
                ))}
              </ChipGroup>
            </Card>
          </>
        )}
      />
    </Screen>
  );
}
