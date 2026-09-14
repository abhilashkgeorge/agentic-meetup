import { Stack } from 'expo-router';
import { usePalette } from '../../components/ui';

/**
 * Two steps, headers on, back arrow live. Someone who reaches step two and wants to
 * redo step one must be able to walk back; a wizard that traps you is why people
 * abandon setup and never return.
 */
export default function OnboardingLayout() {
  const p = usePalette();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: p.bg },
        headerTintColor: p.text,
        headerShadowVisible: false,
        headerTitle: '',
        contentStyle: { backgroundColor: p.bg },
      }}
    >
      {/* No step numbers in the headers. The countdown strip on the screens that
          need one carries it, and "step 3 of 7" on a header is a promise about length
          that the flow then has to keep. */}
      <Stack.Screen name="index" />
      <Stack.Screen name="paste" />
      <Stack.Screen name="essentials" />
      <Stack.Screen name="voice" />
      <Stack.Screen name="test" />
      <Stack.Screen name="photos" />
    </Stack>
  );
}
