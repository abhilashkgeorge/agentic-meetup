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
  useEffect(() => { if (token) void load(token); }, [token, load]);

  return (
    <Screen scroll>
      <Header title="Your character" onBack={() => router.back()} />
      <Text style={[type.body, { color: p.textSecondary }]}>
        This is you in the square, and what people see on your card until you have both said yes.
      </Text>
      <CharacterBuilder preview={<Preview />} onSaved={() => { if (router.canGoBack()) router.back(); else router.replace('/(tabs)/profile'); }} />
    </Screen>
  );
}
