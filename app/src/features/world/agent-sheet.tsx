/**
 * What you learn when you tap somebody in the square.
 *
 * Exactly what the roster carries, which is exactly what the reveal rule allows: a
 * stranger is "one of the people your agent could meet" and nothing else; a practice
 * profile says so first, in the same words the match card uses; a person you have met
 * gets their name where you were entitled to it, how the agents got on, and the way
 * to the card or the conversation. No photo, no age, no tags -- those are the reveal's
 * to give, on its own terms.
 */
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { WorldAgent } from '../../lib/api';
import { Button, Surface, radius, space, type, usePalette } from '../../components/ui';

const WORDS: Record<NonNullable<WorldAgent['agreement']>, string> = {
  got_on: 'Your agents got on.',
  unsure: 'Your agents were not sure.',
  did_not_click: 'Your agents did not really click. You might see it differently.',
  could_not_tell: 'Your agents could not tell.',
};

export function AgentSheet({ agent, onClose }: { agent: WorldAgent; onClose: () => void }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const met = agent.kind === 'met';

  const title = met ? (agent.name ?? 'Someone your agent met') : 'Someone in the square';
  const line = !met
    ? 'One of the people your agent could meet.'
    : agent.state === 'talking' ? 'Your agents are talking now.'
    : agent.state === 'introduced' ? 'You both said yes.'
    : agent.state === 'passed' ? 'You said not this one. They were not told.'
    : agent.state === 'waiting' ? 'Waiting on them. They are never told what you chose.'
    : agent.agreement ? WORDS[agent.agreement] : 'Your agent met them.';

  return (
    <Pressable onPress={onClose} style={{ position: 'absolute', inset: 0 }} accessibilityLabel="Close">
      <Pressable onPress={() => {}} style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
        <Surface radius={radius.xl} style={{ padding: space.screen, paddingBottom: Math.max(insets.bottom, space.lg), gap: space.md,
                                              borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}>
          <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: p.dark }} />
          {agent.practice && (
            <Text style={[type.callout, { color: p.textSecondary }]}>
              Practice match — this one is not a real person.
            </Text>
          )}
          <Text style={[type.title, { color: p.text }]}>{title}</Text>
          <Text style={[type.body, { color: p.textSecondary }]}>{line}</Text>

          {met && agent.rendezvousId && agent.state === 'introduced' && (
            <Button label="Message" variant="primary"
                    onPress={() => { onClose(); router.push(`/dm/${agent.rendezvousId}`); }} />
          )}
          {met && agent.rendezvousId && agent.state !== 'introduced' && agent.state !== 'passed' && (
            <Button label={agent.yourTurn ? 'See the card' : 'See what your agent made of them'} variant="primary"
                    onPress={() => { onClose(); router.push('/matches'); }} />
          )}
          <Button label="Close" variant="ghost" onPress={onClose} />
        </Surface>
      </Pressable>
    </Pressable>
  );
}
