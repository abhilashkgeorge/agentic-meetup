/**
 * The reveal, and the one decision the agent never makes.
 *
 * Attraction is the single thing a matcher genuinely cannot predict, and pretending
 * otherwise is where these products get creepy. So the app never learns, stores or
 * ranks on what somebody finds attractive. It shows a real person and the human
 * decides.
 *
 * CONSENT FIRST (the founder, 2026-09-28): nobody's photos or name reach anyone until
 * THAT person has said yes to them. Whichever side receives more matches decides FIRST,
 * on the words card alone (matches-screen.tsx), and their yes shares their profile.
 * This screen is the second move: the other person sees who shared with them and
 * answers "Yes, share mine back" or "Not for me". Only that second yes shows their
 * photos to the first, and opens the chat. The server enforces the order and the
 * photo rule (api/dating.ts, migration 0073); turn.ts holds every word.
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
  Button, Card, Chip, ChipGroup, Crease, Header, LoadFailed, Loading, Screen, Surface, radius, space,
  type, usePalette,
} from '../../components/ui';
import { CharacterAvatar } from '../look/character-avatar';
import { SafetySheet } from '../safety/safety-sheet';
import { BothYesMoment } from './both-yes-moment';
import { useWorld } from '../world/store';
import { WORDS } from './turn';

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
  const [safety, setSafety] = useState(false);
  const [failed, setFailed] = useState(false);
  // The person's own character, if the town has loaded it: for the moment below.
  const myLook = useWorld((s) => s.world?.me.look ?? null);

  /**
   * Whether who they are -- and their photos -- are here. Until they were, this screen
   * said "No photos yet / They have not added any" over a photo well, and its two answers
   * already worked: somebody could share their profile, or turn somebody down, before
   * seeing who it was. A photo read that fails is a failed load, not "no photos": the
   * decision is made on what is shown here.
   */
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const load = useCallback(async () => {
    if (!token || !id) return;
    const reveal = await getReveal(token, String(id));
    if (!reveal) { setStatus('failed'); return; }
    if (!reveal.waiting && reveal.userId) {
      const theirs = await getPhotosOf(token, reveal.userId);
      if (!theirs) { setStatus('failed'); return; }
      setOwnerId(reveal.userId);
      setPics(theirs.photos ?? []);
    }
    setThem(reveal);
    setStatus('ready');
  }, [token, id]);
  useEffect(() => { void load(); }, [load]);

  const answer = useCallback(
    async (yes: boolean) => {
      if (!token || !id || busy) return;
      setBusy(true);
      setFailed(false);
      const r = await decideMatch(token, String(id), yes);
      setBusy(false);
      // Did not go through (offline, expired, not their turn): say so. Saying "Done" or
      // "Sent" here used to confirm a decision the server never took.
      if (!r) { setFailed(true); return; }
      setIntroduced(Boolean(r.introduced));
      setDecided(yes ? 'yes' : 'no');
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
    if (them?.practice) {
      return (
        <Screen center footer={<Button label="Back to matches" onPress={() => router.back()} />}>
          <Text style={[type.display, { color: p.text, textAlign: 'center' }]}>Noted</Text>
          <Text style={[type.body, { color: p.textSecondary, textAlign: 'center' }]}>
            That was a practice profile, so there is no conversation to open. Your agent
            keeps going out — when real people join, these become real.
          </Text>
        </Screen>
      );
    }
    if (introduced) {
      // A MOMENT, NOT A NOTICE (item 12): the two characters meet, then the words. No
      // new data -- their look and name from the reveal, the person's own from the town.
      return (
        <Screen center>
          <BothYesMoment name={them?.name} theirLook={them?.look} myLook={myLook}
                         onHello={() => router.replace(`/dm/${String(id)}`)} />
        </Screen>
      );
    }
    return (
      <Screen center footer={<Button label="Back to matches" onPress={() => router.back()} />}>
        <Text style={[type.display, { color: p.text, textAlign: 'center' }]}>Shared</Text>
        <Text style={[type.body, { color: p.textSecondary, textAlign: 'center' }]}>{WORDS.youShared}</Text>
      </Screen>
    );
  }

  // Loading: the shape of a profile, and no answers to give until it is here.
  if (status !== 'ready') {
    return (
      <Screen padded={false}>
        <Header onBack={() => router.back()} />
        <View style={{ paddingHorizontal: space.screen, gap: space.lg }}>
          {status === 'loading' ? (
            <Loading label="Loading their profile" orb="connecting" />
          ) : (
            <LoadFailed what="their profile" onRetry={() => { setStatus('loading'); void load(); }} />
          )}
        </View>
      </Screen>
    );
  }

  // Nothing of theirs is shared with this person yet. Said plainly, in the server's
  // words for where they stand, because an empty profile with no reason reads as a bug.
  if (them?.waiting) {
    return (
      <Screen center footer={<Button label="Back" onPress={() => router.back()} />}>
        <Text style={[type.title, { color: p.text, textAlign: 'center' }]}>Not yet</Text>
        <Text style={[type.body, { color: p.textSecondary, textAlign: 'center' }]}>
          {them.message ?? WORDS.theyFirst}
        </Text>
      </Screen>
    );
  }

  return (
    <Screen
      padded={false}
      footer={
        them?.introduced ? (
          // Both have shared: nothing left to decide, only to say hello.
          <Button label="Message" variant="primary" onPress={() => router.replace(`/dm/${String(id)}`)} />
        ) : them?.youAnswered ? undefined : (
          <>
            {/* ONE ABOVE THE OTHER, each the full width. Side by side, "Yes, share mine
                back" had half the row and was cut to "Yes, share mine b..." on the Pixel at its
                larger display size (2026-10-02) -- the one button this screen is for. "Not for
                me" stays a full button, not a faint one: both answers weigh the same. */}
            <Button label={them?.practice ? WORDS.shareBackPractice : WORDS.shareBack} variant="primary"
                    disabled={busy} onPress={() => void answer(true)} />
            <Button label={WORDS.notForMe} disabled={busy} onPress={() => void answer(false)} />
            {failed && <Text style={[type.callout, { color: p.warning, textAlign: 'center' }]}>{WORDS.failed}</Text>}
            <Text style={[type.callout, { color: p.textTertiary, textAlign: 'center' }]}>
              {them?.practice ? WORDS.practiceNote : WORDS.shareBackNote}
            </Text>
          </>
        )
      }
    >
      {/* Always in reach on a profile, the same as in a chat. */}
      <Header onBack={() => router.back()}
              right={{ glyph: '⋯', label: 'Block or report', onPress: () => setSafety(true) }} />
      {safety && id && (
        <SafetySheet target={{ rendezvousId: String(id) }} name={them?.name ?? undefined}
                     onClose={() => setSafety(false)} onDone={() => router.back()} />
      )}

      <View style={{ paddingHorizontal: space.screen, gap: space.lg }}>
        {/* THE FIRST THING ON THE SCREEN, above the face. A person deciding whether to
            meet somebody is owed the fact that there is no somebody, at the moment
            they decide and not after. */}
        {them?.practice && (
          <Surface depth="sunken" radius={radius.lg} style={{ padding: space.md, gap: space.xs }}>
            <Text style={[type.label, { color: p.textSecondary }]}>PRACTICE PROFILE</Text>
            <Text style={[type.body, { color: p.text }]}>
              This is not a real person. The pool is invented until enough people have
              joined, so your agent has somebody to go and meet.
            </Text>
            <Text style={[type.callout, { color: p.textTertiary }]}>
              Sharing yours will not start a conversation — there is nobody to answer.
            </Text>
          </Surface>
        )}
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
            {them?.look && <CharacterAvatar look={them.look} size={150} />}
            <Text style={[type.body, { color: p.textSecondary }]}>No photos yet</Text>
            <Text style={[type.callout, { color: p.textTertiary, textAlign: 'center', paddingHorizontal: space.xl }]}>
              {them?.look
                ? 'This is how they show up in the square. You can still share yours back — you would be deciding on what they said rather than how they look.'
                : 'They have not added any. You can still share yours back — you would be deciding on what they said rather than how they look.'}
            </Text>
          </Surface>
        )}

        {!them ? null : (
          <Card label="Who they are">
            <Text style={[type.title, { color: p.text }]}>
              {them.name}{them.age ? `, ${them.age}` : ''}
            </Text>
            {them.livesIn && (
              <Text style={[type.callout, { color: p.textSecondary }]}>{them.livesIn}</Text>
            )}
            {them.photosChecked && (
              <Text style={[type.callout, { color: p.success }]}>✓ Photos checked</Text>
            )}
            {/* Text, not a badge: people who met them said the basics were true. */}
            {Boolean(them.confirmedBy) && (
              <Text style={[type.callout, { color: p.success }]}>
                {`Confirmed by ${them.confirmedBy} ${them.confirmedBy === 1 ? 'person' : 'people'} who met them`}
              </Text>
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
