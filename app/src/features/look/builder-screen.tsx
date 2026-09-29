/**
 * Your character, from the You tab. Draws its own header (registered with
 * headerShown:false in app/_layout.tsx); saving goes back to where you came from.
 */
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Text } from 'react-native';
import { useSession } from '../../store/session';
import { Header, Screen, type, usePalette } from '../../components/ui';
import { CharacterBuilder } from './builder';
import { Preview } from './preview';
import { useLook } from './store';

export default function BuilderScreen() {
  const p = usePalette();
  const token = useSession((s) => s.token);
  const load = useLook((s) => s.load);
  const discard = useLook((s) => s.discard);
  useEffect(() => { if (token) void load(token); }, [token, load]);
  // Leaving without saving leaves nothing behind: the You tab's card shows the draft,
  // and it showed a half-made character nobody had saved.
  useEffect(() => discard, [discard]);

  // NOT A SCROLLING PAGE. It was, and the builder is shorter than a phone, so the
  // bottom third of the screen was empty grey while the character stood in a letterbox
  // at the top. Now the character takes whatever height is left over; the only things
  // that scroll are the rows of choices.
  return (
    <Screen scroll={false}>
      <Header title="Your character" onBack={() => router.back()} />
      <Text style={[type.body, { color: p.textSecondary }]}>
        This is you in the square, and what people see on your card until you share your profile with them.
      </Text>
      <CharacterBuilder fill preview={(focus) => <Preview focus={focus} />}
                        onSaved={() => { if (router.canGoBack()) router.back(); else router.replace("/(tabs)/profile"); }} />
    </Screen>
  );
}
