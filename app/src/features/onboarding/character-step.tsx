/**
 * Build your character -- the step before photos.
 *
 * Photos wait for both yeses; this is what somebody sees of you before that, and it
 * is what walks around the square as your agent. Skippable: the server gives an
 * unsaved person a free one from a seed, so skipping leaves a character, not a hole.
 * No Header here -- the onboarding stack draws its own.
 */
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { useSession } from '../../store/session';
import { Screen, StepsLeft, space, type, usePalette } from '../../components/ui';
import { CharacterBuilder } from '../look/builder';
import { Preview } from '../look/preview';
import { useLook } from '../look/store';

export default function CharacterStep() {
  const p = usePalette();
  const token = useSession((s) => s.token);
  const load = useLook((s) => s.load);
  useEffect(() => { if (token) void load(token); }, [token, load]);
  const next = () => router.replace('/onboarding/photos');

  return (
    <Screen scroll topInset={false}>
      <StepsLeft left={2} total={2} />
      <View style={{ gap: space.xs }}>
        <Text style={[type.display, { color: p.text }]}>Make your character</Text>
        <Text style={[type.body, { color: p.textSecondary }]}>
          This is you in the square, and all anyone sees of you until you share your profile with them. Photos come next.
        </Text>
      </View>
      <CharacterBuilder preview={(focus) => <Preview height={340} focus={focus} />} onSaved={next} onSkip={next} />
    </Screen>
  );
}
