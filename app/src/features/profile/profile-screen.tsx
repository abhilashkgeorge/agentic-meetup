/**
 * Your profile — the screen the other person will see, shown to you as they will see it.
 *
 * This did not exist, which is most of why the app read as a wireframe: a dating app
 * without a profile screen is a settings menu. It is also the only place that answers
 * the question everybody actually has, which is "what does this thing say about me".
 *
 * Instagram's own profile is the model: photo grid, a short bio in the person's own
 * words, three numbers, then everything else behind rows. Here the numbers are the
 * honest ones — what it knows, what it refuses to guess, how many people it can reach.
 */
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import {
  getKnowledge, getMyPhotos, getPool, getProfile,
  type Knowledge, type Photo, type Profile,
} from '../../lib/api';
import { usePhoto } from '../photos/photo';
import { CharacterAvatar } from '../look/character-avatar';
import { useLook } from '../look/store';
import { useSession } from '../../store/session';
import { label, setupRoute } from './fields';
import {
  Avatar, Button, Card, Chip, ChipGroup, Crease, PhotoSlot, Row, Screen, ScreenTitle,
  Skeleton, SkeletonCard, Stats, space, type, usePalette,
} from '../../components/ui';

/**
 * The row says Age, so it must show an age. It was showing the birth YEAR -- "Age
 * 1999" -- which is the stored value rather than the answer to the question.
 */
const age = (birthYear: string | null): string => {
  const year = Number(birthYear);
  if (!year || year < 1900) return 'Not set';
  return String(new Date().getUTCFullYear() - year);
};

/**
 * One slot on the profile grid. A component rather than a helper because loading a
 * photo needs a hook, and a hook cannot be called from inside a map.
 */
function Slot({
  pics, n, large, onPress,
}: {
  pics: { me: string | null; photos: Photo[] };
  n: number;
  large?: boolean;
  onPress: () => void;
}) {
  const photo = pics.photos[n];
  const uri = usePhoto(pics.me, photo?.id, 'thumb');
  return <PhotoSlot onPress={onPress} large={large} source={uri ? { uri } : undefined} />;
}

/** Reads a single value out of the knowledge list, so the layout can stay declarative. */
const valueOf = (k: Knowledge | null, predicate: string): string | null =>
  k?.knows.find((f) => f.predicate === predicate)?.value ?? null;

const allOf = (k: Knowledge | null, predicate: string): string[] =>
  (k?.knows ?? []).filter((f) => f.predicate === predicate).map((f) => f.value);

export default function ProfileScreen() {
  const p = usePalette();
  const token = useSession((s) => s.token);
  const [k, setK] = useState<Knowledge | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [pool, setPool] = useState<{ total: number; inPool: boolean; missing: string[]; need: string[] } | null>(null);
  const [pics, setPics] = useState<{ me: string | null; photos: Photo[] }>({ me: null, photos: [] });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!token) return;
    const [kk, pr, po, ph] = await Promise.all([
      getKnowledge(token), getProfile(token), getPool(token), getMyPhotos(token),
      useLook.getState().load(token),
    ]);
    setPics({ me: ph?.me ?? null, photos: ph?.photos ?? [] });
    setK(kk);
    setProfile(pr);
    // `missing` is kept because the Finish setup button routes on it: when the
    // missing thing is consent, the essentials flow is the wrong destination.
    setPool(po ? { total: po.total, inPool: po.inPool, missing: po.missing, need: po.need } : null);
    setLoading(false);
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const look = useLook((s) => s.look);
  const lookSaved = useLook((s) => s.saved);
  const points = useLook((s) => s.balance);
  const name = valueOf(k, 'preferred_name') ?? valueOf(k, 'full_name');
  const city = valueOf(k, 'lives_in');
  const work = valueOf(k, 'works_in') ?? valueOf(k, 'industry');
  const interests = allOf(k, 'interest');
  const prompts = (k?.knows ?? []).filter((f) => f.predicate === 'prompt_answer');

  return (
    <Screen onRefresh={() => void load()} padded={false}>
      <ScreenTitle title={name ?? 'You'} subtitle={[city, work].filter(Boolean).join(' · ') || undefined} />

      <View style={{ paddingHorizontal: space.screen, gap: space.lg }}>
        {/* The honest three. Not followers — what it knows, what it won't invent,
            and how many people it can actually reach. */}
        <Card>
          <Stats
            items={[
              { value: loading ? '—' : String(k?.knows.length ?? 0), label: 'Known' },
              { value: loading ? '—' : String(k?.wontGuess.length ?? 0), label: "Won't guess" },
              { value: loading ? '—' : String(pool?.total ?? 0), label: 'Can reach' },
            ]}
          />
        </Card>

        {/* Photos. They appear only here and on the reveal, and are never used for
            matching — the app keeps no opinion about how anybody looks. */}
        <Card label="Photos">
          <Pressable onPress={() => router.push('/photos')} accessibilityRole="button"
                     accessibilityLabel="Your photos">
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <View style={{ flex: 2 }}>
                <Slot pics={pics} n={0} large onPress={() => router.push('/photos')} />
              </View>
              <View style={{ flex: 1, gap: space.sm }}>
                <Slot pics={pics} n={1} onPress={() => router.push('/photos')} />
                <Slot pics={pics} n={2} onPress={() => router.push('/photos')} />
              </View>
            </View>
          </Pressable>
          <Text style={[type.callout, { color: p.textTertiary }]}>
            {pics.photos.length
              ? 'Shown only after you have both said yes. Never used to match you.'
              : 'Add one — it is what somebody sees when they decide whether to meet you.'}
          </Text>
        </Card>

        {/* The character: you in the square, and what people see of you on a card
            until you have both said yes. Photos are what they see after. */}
        <Card label="Your character">
          <Pressable onPress={() => router.push('/character')} accessibilityRole="button"
                     accessibilityLabel="Your character"
                     style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <CharacterAvatar look={look} size={72} />
            <Text style={[type.body, { color: p.textSecondary, flex: 1 }]}>
              {lookSaved
                ? 'How you show up in the square, and on your card before your photos.'
                : 'Build the one people see before your photos. Skipping leaves you a plain one.'}
            </Text>
          </Pressable>
          <Button label={lookSaved ? 'Edit' : 'Build your character'} variant="secondary"
                  onPress={() => router.push('/character')} />
          {/* Owner-only, by the ledger's policy. Never on anybody else's screen. */}
          <Row title="Points" value={String(points)} subtitle="Only you see this. Earned by answering after your dates." last />
        </Card>

        {/* Three sentence-stems in the person's own words. The only free text another
            agent reasons over, and the only part of a profile that sounds human. */}
        <Card label="In your words">
          {loading ? (
            <SkeletonCard />
          ) : prompts.length === 0 ? (
            <>
              <Text style={[type.body, { color: p.textSecondary }]}>
                Three short answers. Your clone drafts them from things you have actually
                said, and you fix whatever is off.
              </Text>
              <Button label="Write them" variant="primary" onPress={() => router.push('/onboarding/paste')} />
            </>
          ) : (
            prompts.map((q, i) => (
              <View key={q.id} style={{ gap: 2 }}>
                {i > 0 && <Crease />}
                <Text style={[type.body, { color: p.text }]}>{q.value}</Text>
              </View>
            ))
          )}
        </Card>

        <Card label="The basics">
          {loading ? (
            <>
              <Skeleton height={18} />
              <Skeleton height={18} width="70%" />
            </>
          ) : (
            <>
              {/* Every row here opens an editor. They used to be inert: Height and
                  Diet read "Not set" with nothing in the app able to set them. */}
              <Row title="Age" value={age(valueOf(k, 'birth_date'))}
                   onPress={() => router.push('/edit/birth_date')} />
              <Row title="Lives in" value={city ?? 'Not set'}
                   onPress={() => router.push('/edit/lives_in')} />
              <Row title="Here for"
                   value={(() => { const v = valueOf(k, 'relationship_intent'); return v ? label(v) : 'Not set'; })()}
                   onPress={() => router.push('/edit/relationship_intent')} />
              <Row title="Height" value={valueOf(k, 'height_cm') ?? 'Not set'}
                   onPress={() => router.push('/edit/height_cm')} />
              <Row title="Diet"
                   value={(() => { const v = valueOf(k, 'diet'); return v ? label(v) : 'Not set'; })()} last
                   onPress={() => router.push('/edit/diet')} />
            </>
          )}
        </Card>

        {interests.length > 0 && (
          <Card label="Into">
            <ChipGroup>
              {interests.slice(0, 12).map((i) => (
                <Chip key={i} label={i} selected={false} onPress={() => {}} />
              ))}
            </ChipGroup>
          </Card>
        )}

        <Card label="Manage">
          <Row title="What it knows about you" subtitle="Every fact, and where it came from"
               onPress={() => router.push('/you')} />
          <Row title="What you're looking for" subtitle="Your filters, and what each one costs"
               onPress={() => router.push('/preferences')} />
          <Row title="Settings" onPress={() => router.push('/settings')} last />
        </Card>

        {pool && !pool.inPool && (
          <Card label="Not out there yet">
            <Text style={[type.body, { color: p.text }]}>
              {pool.need.includes('consent')
                ? 'Your agent still needs your consent before it can talk to anyone.'
                : 'Your agent still needs a few answers before it can talk to anyone.'}
            </Text>
            <Button label="Finish setup" variant="primary"
                    onPress={() => router.push({ pathname: setupRoute(pool.need), params: { finish: '1' } })} />
          </Card>
        )}
      </View>
    </Screen>
  );
}
