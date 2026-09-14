/**
 * The reveal, and the one decision the agent never makes.
 *
 * Attraction is the single thing a matcher genuinely cannot predict, and pretending
 * otherwise is where these products get creepy. So the app never learns, stores or
 * ranks on what somebody finds attractive. It shows a real person and the human
 * decides.
 *
 * The order is deliberate and asymmetric: whichever side receives more matches sees
 * the other's profile FIRST and decides alone. Only then is their profile shared back.
 * Dating apps run heavily one-sided; an app that does not solve the flood becomes a
 * one-gender app. Both sides must still say yes, so it is a gate, not an assignment.
 *
 * A no is SILENT in both directions. Nobody is told they were passed on.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Dimensions, ScrollView, Text, View } from 'react-native';
import { decideMatch, getPhotosOf, getReveal, type Photo, type Reveal } from '../../lib/api';
import { Portrait } from '../photos/photo';
import { useSession } from '../../store/session';
import {
  Button, ButtonRow, Card, Chip, ChipGroup, Crease, Header, Screen, Skeleton, Surface,
  radius, space, type, usePalette,
} from '../../components/ui';

/** A photo fills the screen, less the margins on both sides. */
const CARD_W = Dimensions.get('window').width - space.screen * 2;

export default function RevealScreen() {
  const p = usePalette();
  const { id } = useLocalSearchParams<{ id: string }>();
  const token = useSession((s) => s.token);
  const [decided, setDecided] = useState<'yes' | 'no' | null>(null);
  const [them, setThem] = useState<Reveal | null>(null);
  const [pics, setPics] = useState<Photo[]>([]);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [introduced, setIntroduced] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      if (!token || !id) return;
      const reveal = await getReveal(token, String(id));
      setThem(reveal);
      if (reveal && !reveal.waiting && reveal.userId) {
        setOwnerId(reveal.userId);
        const theirs = await getPhotosOf(token, reveal.userId);
        setPics(theirs?.photos ?? []);
      }
    })();
  }, [token, id]);

  const answer = useCallback(
    async (yes: boolean) => {
      if (!token || !id || busy) return;
      setBusy(true);
      const r = await decideMatch(token, String(id), yes);
      setIntroduced(Boolean(r?.introduced));
      setDecided(yes ? 'yes' : 'no');
      setBusy(false);
    },
    [token, id, busy],
  );

  if (decided === 'no') {
    return (
      <Screen center footer={<Button label="Back" onPress={() => router.back()} />}>
        <Text style={[type.display, { color: p.text, textAlign: 'center' }]}>Done</Text>
        <Text style={[type.body, { color: p.textSecondary, textAlign: 'center' }]}>
          They are not told anything. Your agent keeps looking.
        </Text>
      </Screen>
    );
  }

  if (decided === 'yes') {
    // Both said yes. The conversation exists NOW -- the person is taken to it rather
    // than told about it, because a match nobody opens is the failure mode of every
    // dating app there has ever been.
    if (introduced) {
      return (
        <Screen
          center
          footer={
            <Button label="Say hello" variant="primary"
                    onPress={() => router.replace(`/dm/${String(id)}`)} />
          }
        >
          <Text style={[type.display, { color: p.text, textAlign: 'center' }]}>
            You both said yes
          </Text>
          <Text style={[type.body, { color: p.textSecondary, textAlign: 'center' }]}>
            {them?.name ?? 'They'} can message you now, and nobody else can.
          </Text>
        </Screen>
      );
    }
    return (
      <Screen center footer={<Button label="Back to matches" onPress={() => router.back()} />}>
        <Text style={[type.display, { color: p.text, textAlign: 'center' }]}>Sent</Text>
        <Text style={[type.body, { color: p.textSecondary, textAlign: 'center' }]}>
          They see your profile now. If they say yes too, you will both get an
          introduction. If not, neither of you hears anything.
        </Text>
      </Screen>
    );
  }

  // The other side is looking first. Said plainly, because an empty profile card with
  // no explanation reads as a bug.
  if (them?.waiting) {
    return (
      <Screen center footer={<Button label="Back" onPress={() => router.back()} />}>
        <Text style={[type.title, { color: p.text, textAlign: 'center' }]}>Not yet</Text>
        <Text style={[type.body, { color: p.textSecondary, textAlign: 'center' }]}>
          {them.message ?? 'They are looking at your profile first.'}
        </Text>
        <Text style={[type.callout, { color: p.textTertiary, textAlign: 'center' }]}>
          Whoever gets more matches decides first. It stops one side being buried.
        </Text>
      </Screen>
    );
  }

  return (
    <Screen
      padded={false}
      footer={
        <>
          <ButtonRow>
            <Button label="Yes" variant="primary" disabled={busy}
                    onPress={() => void answer(true)} style={{ flex: 1 }} />
            <Button label="Not for me" disabled={busy}
                    onPress={() => void answer(false)} style={{ flex: 1 }} />
          </ButtonRow>
          <Text style={[type.callout, { color: p.textTertiary, textAlign: 'center' }]}>
            Either way, they are never told what you chose.
          </Text>
        </>
      }
    >
      <Header onBack={() => router.back()} />

      <View style={{ paddingHorizontal: space.screen, gap: space.lg }}>
        {/* Photos live HERE and nowhere else. The agent never saw them, never matched
            on them, and the app stores no preference about how anybody looks. This is
            the one moment a face is part of the decision, and the decision is the
            person's. */}
        {pics.length > 0 && ownerId ? (
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            style={{ marginHorizontal: -space.screen }}
            contentContainerStyle={{ paddingHorizontal: space.screen, gap: space.sm }}
          >
            {pics.map((photo) => (
              <Surface key={photo.id} depth="raised" radius={radius.xl}
                       style={{ width: CARD_W, height: CARD_W * 4 / 3, overflow: 'hidden' }}>
                <Portrait
                  userId={ownerId}
                  photoId={photo.id}
                  style={{ width: '100%', height: '100%' }}
                  label={`Photo of ${them?.name ?? 'them'}`}
                />
              </Surface>
            ))}
          </ScrollView>
        ) : (
          <Surface depth="sunken" radius={radius.xl}
                   style={{ height: 300, alignItems: 'center', justifyContent: 'center', gap: space.sm }}>
            <Text style={[type.body, { color: p.textSecondary }]}>No photos yet</Text>
            <Text style={[type.callout, { color: p.textTertiary, textAlign: 'center', paddingHorizontal: space.xl }]}>
              They have not added any. You can still say yes — you would be deciding on
              what they said rather than how they look.
            </Text>
          </Surface>
        )}

        {!them ? (
          <Skeleton height={120} />
        ) : (
          <Card label="Who they are">
            <Text style={[type.title, { color: p.text }]}>
              {them.name}{them.age ? `, ${them.age}` : ''}
            </Text>
            {them.livesIn && (
              <Text style={[type.callout, { color: p.textSecondary }]}>{them.livesIn}</Text>
            )}
            {Boolean(them.tags?.length) && (
              <>
                <Crease />
                {/* Tags, not sentences. What they have actually SAID is on the brief,
                    with the date they said it -- quoted rather than summarised. */}
                <ChipGroup>
                  {them.tags!.map((t) => (
                    <Chip key={t} label={t} selected={false} onPress={() => {}} disabled />
                  ))}
                </ChipGroup>
              </>
            )}
          </Card>
        )}

        <Text style={[type.callout, { color: p.textTertiary }]}>
          Your agent never decided whether you would find them attractive. It has no
          opinion about that and does not keep one.
        </Text>
      </View>
    </Screen>
  );
}
