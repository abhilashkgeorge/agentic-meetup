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
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Image, Pressable, Text, View } from 'react-native';
import {
  getKnowledge, getMyPhotos, getPool, getProfile, judgeFact,
  type Knowledge, type Photo, type Profile,
} from '../../lib/api';
import { countLabel } from '../../lib/counts';
import { usePhoto } from '../photos/photo';
import { Preview } from '../look/preview';
import { useLook } from '../look/store';
import { useSession } from '../../store/session';
import { ANYWHERE_KM, AREAS } from '@clone/shared';
import { PHOTO_SLOTS } from '../photos/photos-screen';
import { label, setupRoute } from './fields';
import { rangeFromText, rangeLabel } from './age-range';
import {
  Avatar, Button, Card, Chip, ChipGroup, Crease, LoadFailed, PhotoSlot, Row, Screen, ScreenTitle,
  Skeleton, SkeletonBlock, SkeletonGroup, SkeletonRows, SkeletonTitle, Stats, radius, space, sunk, type,
  usePalette,
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
  return <PhotoSlot onPress={onPress} large={large} source={uri ? { uri } : undefined}
                    loading={Boolean(photo) && uri === undefined} />;
}

/**
 * THE YOU TAB WHILE IT LOADS, in its own shape: the name, the three numbers, the photo
 * wells, the character, the basics. It used to draw the real page at once, wrong -- "You"
 * for a title, "—" for every number, empty photo wells saying "Add one", Points 0 and a
 * character "not built yet" -- and then correct itself.
 */
function ProfileSkeleton() {
  return (
    <SkeletonGroup label="Loading your profile" style={{ gap: space.lg }}>
      <View style={{ gap: space.sm }}>
        <SkeletonTitle width="45%" />
        <Skeleton height={14} width="35%" />
      </View>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ alignItems: 'center', gap: space.sm, width: '28%' }}>
              <Skeleton height={22} width="50%" />
              <Skeleton height={10} width="90%" />
            </View>
          ))}
        </View>
      </Card>
      <Card>
        <Skeleton height={12} width="25%" />
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <View style={{ flex: 2 }}><SkeletonBlock height={220} radius={radius.md} /></View>
          <View style={{ flex: 1, gap: space.sm }}>
            <SkeletonBlock height={106} radius={radius.md} />
            <SkeletonBlock height={106} radius={radius.md} />
          </View>
        </View>
      </Card>
      <Card>
        <Skeleton height={12} width="35%" />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <SkeletonBlock width={112} height={150} radius={20} />
          <View style={{ flex: 1, gap: space.sm }}>
            <Skeleton height={14} />
            <Skeleton height={14} width="80%" />
          </View>
        </View>
      </Card>
      <Card>
        <Skeleton height={12} width="30%" />
        <SkeletonRows count={5} />
      </Card>
    </SkeletonGroup>
  );
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
  const [pool, setPool] = useState<{ total: number | null; inPool: boolean; missing: string[]; need: string[] } | null>(null);
  const [pics, setPics] = useState<{ me: string | null; photos: Photo[] }>({ me: null, photos: [] });
  /**
   * Whether the page is here. Once it is, a refresh that fails keeps what is on screen:
   * it used to replace it with nulls, and every number read 0 and every basic "Not set".
   */
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [judging, setJudging] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    const [kk, pr, po, ph] = await Promise.all([
      getKnowledge(token), getProfile(token), getPool(token), getMyPhotos(token),
      useLook.getState().load(token),
    ]);
    if (!kk) { setStatus((s) => (s === 'ready' ? s : 'failed')); return; }
    if (ph) setPics({ me: ph.me ?? null, photos: ph.photos ?? [] });
    setK(kk);
    if (pr) setProfile(pr);
    // `missing` is kept because the Finish setup button routes on it: when the
    // missing thing is consent, the essentials flow is the wrong destination.
    if (po) setPool({ total: po.total, inPool: po.inPool, missing: po.missing, need: po.need });
    setStatus('ready');
  }, [token]);

  // Every focus, not once on mount: the tab stays mounted, and its Finish setup card
  // would otherwise outlive the setup it sends people to (as matches-screen.tsx).
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  // The character on the card moves only while this tab is in front: a GL canvas
  // animating behind another tab is battery spent on nothing.
  const [shown, setShown] = useState(false);
  useFocusEffect(useCallback(() => { setShown(true); return () => setShown(false); }, []));

  /**
   * Yes or No on something the agent heard in chat about a field you tapped. It waits
   * here, not on your card: a sentence never changes a card answer by itself
   * (server: TAPPED_PREDICATES). Asked where you already look, one at a time.
   */
  const judge = useCallback(async (verdict: 'yes' | 'no') => {
    if (!token || !k?.confirm) return;
    setJudging(true);
    const r = await judgeFact(token, k.confirm.factId, verdict);
    setJudging(false);
    // Words a card cannot read never replace its answer (server memory/card-guard.ts).
    if (r?.keptCard) Alert.alert('Your card answer stays', r.message);
    void load();
  }, [token, k, load]);

  const look = useLook((s) => s.look);
  const lookSaved = useLook((s) => s.saved);
  const points = useLook((s) => s.balance);
  // The name other people see, and only that: what was typed on "What should people
  // call you?". A name the clone heard in chat is never shown as yours (2026-09-28).
  const name = valueOf(k, 'first_name');
  const city = valueOf(k, 'lives_in');
  const work = valueOf(k, 'works_in') ?? valueOf(k, 'industry');
  const interests = allOf(k, 'interest');
  const prompts = (k?.knows ?? []).filter((f) => f.predicate === 'prompt_answer');

  if (status !== 'ready') {
    return (
      <Screen onRefresh={() => void load()}>
        {status === 'loading'
          ? <ProfileSkeleton />
          : <LoadFailed what="your profile" onRetry={() => { setStatus('loading'); void load(); }} />}
      </Screen>
    );
  }

  return (
    <Screen onRefresh={() => void load()} padded={false}>
      <ScreenTitle title={name ?? 'You'} subtitle={[city, work].filter(Boolean).join(' · ') || undefined} />

      <View style={{ paddingHorizontal: space.screen, gap: space.lg }}>
        {k?.confirm && (
          <Card label="Your agent heard something">
            <Text style={[type.bodyStrong, { color: p.text }]}>{k.confirm.claim}</Text>
            {k.confirm.from ? (
              <Text style={[type.callout, { color: p.textTertiary, fontStyle: 'italic' }]}>“{k.confirm.from}”</Text>
            ) : null}
            <Text style={[type.callout, { color: p.textSecondary }]}>
              Is that right? Nothing changes until you say so.
            </Text>
            <ChipGroup>
              <Chip label="Yes, that's right" selected={false} disabled={judging} onPress={() => void judge('yes')} />
              <Chip label="No" selected={false} disabled={judging} onPress={() => void judge('no')} />
            </ChipGroup>
          </Card>
        )}

        {/* The honest three. Not followers — what it knows, what it won't invent,
            and how many people it can actually reach. */}
        <Card>
          <Stats
            items={[
              // Said as what they count: "17 KNOWN" and "40 CAN REACH" left the reader to
              // guess known what, and reach whom (on the Pixel, 2026-09-30).
              { value: String(k?.knows.length ?? 0), label: 'Things known' },
              { value: String(k?.wontGuess.length ?? 0), label: "Won't guess" },
              { value: countLabel(pool?.total), label: 'People in reach' },
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
          {/* The three wells above are a PREVIEW, not the allowance -- the photos
              screen offers six. Left unsaid, three empty boxes read as the limit, and
              somebody stops at three. */}
          <Text style={[type.callout, { color: p.textTertiary }]}>
            {pics.photos.length
              ? `Shown only to people you share your profile with. Never used to match you. ${
                  pics.photos.length < PHOTO_SLOTS ? `Room for ${PHOTO_SLOTS} in all.` : ''
                }`.trim()
              : `Add one — it is what somebody sees once you share your profile with them. Room for ${PHOTO_SLOTS}.`}
          </Text>
        </Card>

        {/* The character: you in the square, and what people see of you on a card
            until you share your profile with them. Photos are what they see after.

            THE REAL ONE, standing in a well -- the same body the town draws. It was a
            flat drawing, a round head on a rounded block, and after building a whole
            character the founder came back to this card and found a capsule on it
            (2026-09-29). */}
        <Card label="Your character">
          <Pressable onPress={() => router.push('/character')} accessibilityRole="button"
                     accessibilityLabel="Your character"
                     style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View style={{ width: 112, height: 150, borderRadius: 20, overflow: 'hidden',
                           backgroundColor: p.sunken, boxShadow: sunk(p, 3) }}>
              <Preview height={150} focus="card" turnable={false} background={p.sunken} active={shown} />
            </View>
            <Text style={[type.body, { color: p.textSecondary, flex: 1 }]}>
              {lookSaved
                ? 'How you show up in the square, and on your card before your photos.'
                : 'Build the one people see before your photos. Skipping leaves you a plain one.'}
            </Text>
          </Pressable>
          <Button label={lookSaved ? 'Edit' : 'Build your character'} variant="secondary"
                  onPress={() => router.push('/character')} />
          {/* Owner-only, by the ledger's policy. Never on anybody else's screen. */}
          {/* Points come from the park too since 2026-09-29; "Earned by answering after your
              dates" had stopped being the whole story (on the Pixel, 2026-09-30). */}
          <Row title="Points" value={String(points)} subtitle="Only you see this. Earned after your dates and in Cubbon Park, spent on your character." last />
        </Card>

        {/* Three sentence-stems in the person's own words. The only free text another
            agent reasons over, and the only part of a profile that sounds human. */}
        <Card label="In your words">
          {prompts.length === 0 ? (
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
          <>
              {/* Every row here opens an editor. They used to be inert: Height and
                  Diet read "Not set" with nothing in the app able to set them. */}
              <Row title="First name" value={name ?? 'Not set'}
                   subtitle="Seen only by people you share your profile with."
                   onPress={() => router.push('/edit/first_name')} />
              <Row title="Age" value={age(valueOf(k, 'birth_date'))}
                   onPress={() => router.push('/edit/birth_date')} />
              <Row title="Lives in" value={city ?? 'Not set'}
                   onPress={() => router.push('/edit/lives_in')} />
              {/* Only for a city the map covers: the row would be a lie in Mumbai. */}
              {(city && /bangalore|bengaluru/i.test(city)) || valueOf(k, 'area') ? (
                <Row title="Part of town"
                     value={(() => { const v = valueOf(k, 'area'); return v ? (AREAS.find((a) => a.id === v)?.name ?? v) : 'Not set'; })()}
                     onPress={() => router.push('/edit/area')} />
              ) : null}
              <Row title="Here for"
                   value={(() => { const v = valueOf(k, 'relationship_intent'); return v ? label(v) : 'Not set'; })()}
                   onPress={() => router.push('/edit/relationship_intent')} />
              {/* Set once during setup from a pre-fill; this is where it is changed. */}
              <Row title="Ages you'd meet" value={rangeLabel(rangeFromText(valueOf(k, 'age_range_sought')))}
                   onPress={() => router.push('/edit/age_range_sought')} />
              {/* The distance map (2026-10-01): asked once in setup, and nowhere to change it
                  after until this row. */}
              <Row title="How far you'd go"
                   value={(() => { const v = Number(valueOf(k, 'max_distance_km') ?? NaN); return Number.isFinite(v) ? (v >= ANYWHERE_KM ? 'Anywhere' : `${v} km`) : 'Not set'; })()}
                   onPress={() => router.push('/edit/max_distance_km')} />
              <Row title="Height" value={valueOf(k, 'height_cm') ?? 'Not set'}
                   onPress={() => router.push('/edit/height_cm')} />
              <Row title="Diet"
                   value={(() => { const v = valueOf(k, 'diet'); return v ? label(v) : 'Not set'; })()} last
                   onPress={() => router.push('/edit/diet')} />
          </>
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
          <Row title="How you appear" subtitle="Your rules in words, and what others see"
               onPress={() => router.push('/appearance')} />
          <Row title="Things to talk about" subtitle="What your agent can say when it meets another agent"
               onPress={() => router.push('/stories')} />
          {/* The optional faith card (2026-09-25), for people set up before it existed:
              the interview asks whatever card is still unanswered, then sends them back. */}
          <Row title="Faith (optional)" subtitle="Only used to check who fits. Nobody ever sees it"
               onPress={() => router.push({ pathname: '/onboarding/interview', params: { finish: '1' } })} />
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
