/**
 * Your photos.
 *
 * The one screen in this app where the person is choosing how they LOOK rather than
 * telling their clone something. So it is direct manipulation and nothing else: a grid,
 * an add button, hold to remove, tap to make it the first one. No advice about what
 * makes a good picture, no score, no "your profile is 40% complete".
 *
 * The first photo is the one shown at the reveal, which is the only thing here worth
 * saying out loud -- so the screen says it.
 */
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import {
  deletePhoto, getMyPhotos, reorderPhotos, uploadPhoto, type Photo,
} from '../../lib/api';
import { Portrait } from './photo';
import { useSession } from '../../store/session';
import {
  Button, Card, Header, Screen, Surface, radius, space, sunk, type, usePalette,
} from '../../components/ui';

const COLUMNS = 3;

export default function PhotosScreen() {
  const p = usePalette();
  const token = useSession((s) => s.token);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [max, setMax] = useState(6);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const mine = await getMyPhotos(token);
    setPhotos(mine?.photos ?? []);
    setMax(mine?.max ?? 6);
    // The serving route is keyed on the owner as well as the photo, so even showing
    // your own pictures needs your own id. It comes back with the list.
    setMe(mine?.me ?? null);
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    if (!token || busy) return;
    setError(null);

    // NO PERMISSION PROMPT. The system photo picker hands back the one file the person
    // chose and nothing else, so there is nothing to ask for -- on Android it is the
    // OS picker, on iOS it is PHPicker. Asking anyway was worse than pointless: this
    // build's manifest predates READ_MEDIA_IMAGES, so on Android 13 and up the request
    // would have been refused and blocked a flow that needs no permission at all.
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [3, 4],
      // Resized and recompressed on the phone before it goes anywhere: a 12MP photo is
      // eight megabytes of someone's mobile data to upload a picture that will be
      // shown at 400 points wide.
      quality: 0.8,
      exif: false,
    });
    if (picked.canceled || !picked.assets[0]) return;


    setBusy(true);
    const result = await uploadPhoto(token, picked.assets[0].uri);
    setBusy(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }
    await load();
  };

  const remove = (photo: Photo) => {
    if (!token) return;
    Alert.alert('Remove this photo?', 'It is deleted from the server as well.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => { void deletePhoto(token, photo.id).then(load); },
      },
    ]);
  };

  const makeFirst = async (photo: Photo) => {
    if (!token || photo.slot === 0) return;
    const rest = photos.filter((x) => x.id !== photo.id).map((x) => x.id);
    setPhotos(await reorderPhotos(token, [photo.id, ...rest]).then((r) => r?.photos ?? photos));
  };

  const slots = Array.from({ length: max }, (_, i) => photos[i] ?? null);

  return (
    <Screen padded={false}>
      <Header title="Your photos" onBack={() => router.back()} />

      <View style={{ paddingHorizontal: space.screen, gap: space.lg }}>
        <Card label="Only people you have both said yes to">
          <Text style={[type.body, { color: p.text }]}>
            Your first photo is the one they see when they decide whether to meet you.
          </Text>
          <Text style={[type.callout, { color: p.textSecondary }]}>
            Your agent never sees these and never matches on them. Where a photo was
            taken is stripped off before it is stored.
          </Text>
        </Card>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {slots.map((photo, i) => (
            <Pressable
              key={photo?.id ?? `empty-${i}`}
              onPress={() => (photo ? void makeFirst(photo) : void add())}
              onLongPress={() => photo && remove(photo)}
              accessibilityRole="button"
              accessibilityLabel={
                photo
                  ? i === 0 ? 'First photo. Hold to remove.' : 'Tap to make first, hold to remove.'
                  : 'Add a photo'
              }
              style={{ width: `${100 / COLUMNS - 3}%`, aspectRatio: 3 / 4 }}
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
                  <Text style={{ color: p.textTertiary, fontSize: 26 }}>+</Text>
                )}
              </Surface>
              {/* OVERLAID, NOT STACKED. The tile has a fixed aspectRatio, so a label
                  placed after the Surface takes its height OUT of the image -- and
                  the first photo came out visibly shorter than the one beside it,
                  leaving the top row misaligned for the one tile that matters most.
                  Absolute keeps it out of the layout. */}
              {photo && i === 0 && (
                <View
                  pointerEvents="none"
                  style={{
                    position: 'absolute', left: 0, right: 0, bottom: 0,
                    paddingVertical: 4,
                    // A scrim, because this sits on whatever photograph somebody
                    // chose and the accent alone is not legible on a pale one.
                    backgroundColor: 'rgba(0,0,0,0.45)',
                    borderBottomLeftRadius: radius.md,
                    borderBottomRightRadius: radius.md,
                  }}
                >
                  <Text style={[type.label, { color: '#FFFFFF', textAlign: 'center' }]}>
                    FIRST
                  </Text>
                </View>
              )}
            </Pressable>
          ))}
        </View>

        {busy && (
          <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
            <ActivityIndicator color={p.accent} />
            <Text style={[type.callout, { color: p.textSecondary }]}>Uploading…</Text>
          </View>
        )}
        {error && <Text style={[type.callout, { color: p.danger }]}>{error}</Text>}

        <Button
          label={photos.length ? 'Add another' : 'Add your first photo'}
          variant="primary"
          disabled={busy || photos.length >= max}
          onPress={() => void add()}
        />
        <Text style={[type.callout, { color: p.textTertiary, textAlign: 'center' }]}>
          Tap one to make it first. Hold to remove.
        </Text>
      </View>
    </Screen>
  );
}
