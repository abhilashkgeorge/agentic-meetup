/**
 * Your clone's chat, slid up over the town.
 *
 * The town is Home now, so tapping your own agent is how you talk to it. The
 * conversation is the same component the plain Home uses; only the frame is new.
 */
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CloneChat } from '../chat/clone-chat';
import { getConfig } from '../../lib/api';
import { useKeyboardPad } from '../../lib/keyboard';
import { Surface, radius, space, type, usePalette } from '../../components/ui';

export function CloneSheet({ onClose }: { onClose: () => void }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardPad();
  const [disclosure, setDisclosure] = useState('This is an AI, not a person.');
  useEffect(() => {
    void getConfig().then((c) => { if (c) setDisclosure(c.disclosure.perSession); });
  }, []);

  return (
    <Pressable onPress={onClose} style={{ position: 'absolute', inset: 0 }} accessibilityLabel="Close">
      <Pressable onPress={() => {}} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '82%' }}>
        <Surface radius={radius.xl} style={{ flex: 1, paddingTop: space.md,
                                              paddingBottom: keyboard > 0 ? keyboard : insets.bottom,
                                              borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}>
          <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: p.dark, marginBottom: space.sm }} />
          <CloneChat
            disclosure={disclosure}
            renderEmpty={() => (
              <Text style={[type.body, { color: p.textSecondary, textAlign: 'center' }]}>
                Tell it something true, or ask it what it thinks. It learns from every line.
              </Text>
            )}
          />
        </Surface>
      </Pressable>
    </Pressable>
  );
}
