/**
 * What you learn when you tap somebody in the square.
 *
 * Exactly what the roster carries, which is exactly what the reveal rule allows: a
 * stranger is "one of the people your agent could meet" and nothing else; a practice
 * profile says so first, in the same words the match card uses; a person you have met
 * gets their name where you were entitled to it, where things stand, and the way to
 * the card or the conversation. No photo, no age, no tags -- those are the reveal's
 * to give, on its own terms.
 *
 * NOT HOW THE AGENTS GOT ON. This sheet used to say "Your agents got on" or "did not
 * really click" -- a verdict on a person, in words, before either human had looked.
 * No agent judges anybody now (server/src/matching/brief.ts), and the roster carries
 * no agreement to show.
 */
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { WorldAgent } from '../../lib/api';
import { Button, Surface, radius, space, type, usePalette } from '../../components/ui';
import { areaName } from './map';

export function AgentSheet({ agent, onClose, visits, onSendOver }: {
  agent: WorldAgent;
  onClose: () => void;
  /** How many "send my agent over" taps are left today, and whether the agent is out. */
  visits: { left: number; busy: boolean };
  onSendOver: (ref: string) => void;
}) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const met = agent.kind === 'met';

  const title = met ? (agent.name ?? 'Someone your agent met') : 'Someone in the square';
  const line = !met
    ? 'One of the people your agent could meet.'
    : agent.state === 'talking' ? 'Your agent is with them now.'
    : agent.state === 'introduced' ? 'You both said yes.'
    : agent.state === 'passed' ? 'You said not this one. They were not told.'
    : agent.state === 'waiting' ? 'Waiting on them. They are never told what you chose.'
    : 'Your agent met them. Their card is waiting.';

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
          {/* Their neighbourhood: the one thing the square says about a stranger's
              whereabouts, an id from a public list of thirty and never a place. */}
          {agent.area && <Text style={[type.callout, { color: p.textTertiary }]}>Around {areaName(agent.area)}</Text>}
          <Text style={[type.body, { color: p.textSecondary }]}>{line}</Text>

          {/* SEND MY AGENT OVER. One stop of an open round, aimed at this person: no
              conversation and no cost, and still rationed the way the server rations
              it -- five a day, none while the agent is already out. The button says
              why when it cannot. */}
          {!met && (
            <>
              <Button
                label={visits.busy ? 'Your agent is out…' : visits.left > 0 ? 'Send my agent over' : 'No visits left today'}
                variant="primary"
                disabled={visits.busy || visits.left <= 0}
                onPress={() => onSendOver(agent.ref)}
              />
              <Text style={[type.callout, { color: p.textTertiary }]}>
                {visits.left > 0
                  ? `Your agent walks over and brings back a card. ${visits.left} ${visits.left === 1 ? 'visit' : 'visits'} left today.`
                  : 'Visits come back tomorrow. Your agent can still go out on its own.'}
              </Text>
            </>
          )}
          {met && agent.rendezvousId && agent.state === 'introduced' && (
            <Button label="Message" variant="primary"
                    onPress={() => { onClose(); router.push(`/dm/${agent.rendezvousId}`); }} />
          )}
          {met && agent.rendezvousId && agent.state !== 'introduced' && agent.state !== 'passed' && (
            <Button label={agent.yourTurn ? 'See the card' : 'See your matches'} variant="primary"
                    onPress={() => { onClose(); router.push('/matches'); }} />
          )}
          <Button label="Close" variant="ghost" onPress={onClose} />
        </Surface>
      </Pressable>
    </Pressable>
  );
}
