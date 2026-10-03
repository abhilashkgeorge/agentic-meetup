/**
 * The photo step, at the end of setup.
 *
 * WHY IT BELONGS IN ONBOARDING. Somebody who finishes setup with no photo has an agent
 * that can go out and a profile nobody can say yes to -- the reveal is the one moment
 * where a person decides for themselves, and with nothing to look at they are deciding
 * on prose. It was missing entirely: you finished the questions and landed in the app
 * with six empty boxes on a tab you had no reason to open.
 *
 * WHY IT IS SKIPPABLE ANYWAY. A hard requirement here turns the last screen of setup
 * into a wall for anybody who does not have a picture they like to hand, and they do
 * not come back. The screen says plainly what happens without one.
 *
 * The prompts under each slot are the good idea from every dating app that does this
 * well: six empty squares ask a question nobody knows the answer to, while "with
 * friends" and "caught off guard" are answerable without thinking.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { getMyPhotos, uploadPhoto, type Photo } from '../../lib/api';
import { Portrait } from '../photos/photo';
import { useSession } from '../../store/session';
import { setOnboarded } from '../../lib/storage';
import {
  Animation, Button, LoadFailed, Loading, Orb, Screen, Surface, radius, space, type, usePalette,
} from '../../components/ui';

/**
 * One prompt per slot. Not rules -- a person can put anything anywhere -- but a blank
 * grid asks "what makes a good photo of me", which is a question that stops people.
 */
const PROMPTS = [
  'Just you',
  'Head to toe',
  'Something you do',
  'With friends',
  'Off guard',
  'Your view',
];

export default function PhotosStep() {
  const p = usePalette();
  const token = useSession((s) => s.token);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Whether the photos are here. Before they were, six empty wells, "Add a photo" and "Your
   * agent can do everything except this" said there were none, and the button below
   * switched to "Done" a moment later.
   */
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const load = useCallback(async () => {
    if (!token) return;
    const mine = await getMyPhotos(token);
    if (!mine) { setStatus((s) => (s === 'ready' ? s : 'failed')); return; }
    setPhotos(mine.photos ?? []);
    setMe(mine.me ?? null);
    setStatus('ready');
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    if (!token || busy) return;
    setError(null);
    // No permission prompt: the system picker returns the one file the person chose
    // and nothing else, so there is nothing to ask for.
    // LOADED AT THE CALL SITE, NOT AT THE TOP OF THE FILE.
    //
    // expo-router imports every route eagerly, so a top-level import of a native
    // module means a build that lacks it cannot render ANY screen -- the whole app
    // dies at startup over a feature nobody navigated to. A partial or stale native
    // build should cost the feature, not the product.
    let ImagePicker;
    try {
      ImagePicker = await import('expo-image-picker');
    } catch {
      setError('Adding photos needs a newer version of the app.');
      return;
    }

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [3, 4],
      quality: 0.8,
      exif: false,
    });
    if (picked.canceled || !picked.assets[0]) return;

    setBusy(true);
    const result = await uploadPhoto(token, picked.assets[0].uri);
    setBusy(false);
    if (!result.ok) { setError(result.message); return; }
    await load();
  };

  // Opened from the setup chat: back to the chat, which ends setup itself.
  const { from } = useLocalSearchParams<{ from?: string }>();
  const finish = async (): Promise<void> => {
    if (from === 'chat') { router.back(); return; }
    await setOnboarded();
    router.replace('/');
  };

  const slots = Array.from({ length: 6 }, (_, i) => photos[i] ?? null);
  const has = photos.length > 0;

  return (
    <Screen topInset={false}
      footer={
        <>
          <Button
            label={has ? 'Done' : 'Add a photo'}
            variant="primary"
            onPress={() => void (has ? finish() : add())}
            disabled={busy || status !== 'ready'}
          />
          {/* Skippable, and honest about the cost rather than nagging. */}
          {!has && (
            <Button label="I'll do it later" variant="ghost" onPress={() => void finish()} />
          )}
        </>
      }
    >
      <View style={{ gap: space.xs }}>
        <Text style={[type.display, { color: p.text }]}>One last thing</Text>
        <Text style={[type.body, { color: p.textSecondary }]}>
          {has
            ? 'Your first photo is the one they see once you share your profile with them.'
            : 'Your agent can do everything except this. When you share your profile with someone, these are what they see.'}
        </Text>
      </View>

      {status === 'ready' && !has && <Animation mood="camera" height={130} opacity={0.45} />}

      {status === 'loading' && (
        <Loading label="Loading your photos" orb="working" section />
      )}
      {status === 'failed' && (
        <LoadFailed what="your photos" onRetry={() => { setStatus('loading'); void load(); }} />
      )}
      {status === 'ready' && (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {slots.map((photo, i) => (
          <Pressable
            key={photo?.id ?? `slot-${i}`}
            onPress={() => void add()}
            accessibilityRole="button"
            accessibilityLabel={photo ? `Photo ${i + 1}` : `Add a photo: ${PROMPTS[i]}`}
            style={{ width: '31%', aspectRatio: 3 / 4 }}
          >
            <Surface
              depth={photo ? 'raised' : 'sunken'}
              radius={radius.md}
              style={{ flex: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}
            >
              {photo && me ? (
                <Portrait userId={me} photoId={photo.id} size="thumb"
                          style={{ width: '100%', height: '100%' }} />
              ) : (
                <Text style={[type.label, {
                  color: p.textTertiary, textAlign: 'center', paddingHorizontal: space.xs,
                }]}>
                  {PROMPTS[i]?.toUpperCase()}
                </Text>
              )}
            </Surface>
          </Pressable>
        ))}
      </View>
      )}

      {busy && (
        <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
          <Orb state="breathing" size={20} label="Uploading" />
          <Text style={[type.callout, { color: p.textSecondary }]}>Uploading…</Text>
        </View>
      )}
      {error && <Text style={[type.callout, { color: p.danger }]}>{error}</Text>}

      <Text style={[type.callout, { color: p.textTertiary }]}>
        Nobody sees these until you share your profile with them. Your agent never does,
        and never matches on them. Where a photo was taken is removed before it is stored.
      </Text>
    </Screen>
  );
}
