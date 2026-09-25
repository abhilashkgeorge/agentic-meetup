/**
 * The inbox.
 *
 * A conversation appears here only once both people said yes, so there is no such
 * thing as a message request and no folder of them. Everything in this list is
 * somebody who chose to talk to you and whom you chose back.
 *
 * Instagram's DM list is the shape: avatar, name, one line of the last message, and
 * the unread state carried by weight rather than by a badge shouting a number.
 */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { getConversations, getMatches } from '../../lib/api';
import { PersonAvatar } from '../look/person-avatar';
import { ago } from '../../lib/ago';
import { useSession } from '../../store/session';
import { useDm } from '../../store/dm';
import {
  Crease, Empty, Row, Screen, ScreenTitle, Surface,
  radius, space, type, usePalette,
} from '../../components/ui';

export default function ConversationsScreen() {
  const p = usePalette();
  const token = useSession((s) => s.token);
  const conversations = useDm((s) => s.conversations);
  const setConversations = useDm((s) => s.setConversations);
  const setMe = useDm((s) => s.setMe);
  const [waiting, setWaiting] = useState(0);

  const load = useCallback(async () => {
    if (!token) return;
    const [list, matches] = await Promise.all([getConversations(token), getMatches(token)]);
    // Our own id, so a pushed message can be told apart from one of theirs. History
    // rows carry `mine`; live events carry only a sender.
    if (list?.me) setMe(list.me);
    setConversations(list?.conversations ?? []);
    setWaiting((matches?.matches ?? []).filter((m) => m.waitingOnYou).length);
  }, [token, setConversations, setMe]);

  // Re-read on every focus, not once on mount. Coming back from a conversation with
  // unread counts that have not moved is the classic stale-inbox bug.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <Screen onRefresh={() => void load()} padded={false}>
      <ScreenTitle title="Chats" />

      <View style={{ paddingHorizontal: space.screen, gap: space.lg }}>
        {waiting > 0 && (
          <Surface radius={radius.lg} style={{ padding: space.screen, gap: space.xs }}>
            <Text style={[type.label, { color: p.textSecondary }]}>WAITING ON YOU</Text>
            <Row
              title={waiting === 1 ? 'One person to look at' : `${waiting} people to look at`}
              // NOT "thinks it is worth it". No agent judges anybody (server
              // matching/brief.ts); it met them, and the card is theirs to read.
              subtitle={waiting === 1 ? 'Your agent met them. Their card is waiting.' : 'Your agent met them. Their cards are waiting.'}
              onPress={() => router.push('/(tabs)/matches')}
              last
            />
          </Surface>
        )}

        {conversations.length === 0 ? (
          <Empty
            title="No conversations yet"
            body="When you and someone else both say yes, the conversation opens here. Nobody can message you before that."
          />
        ) : (
          <Surface radius={radius.lg} style={{ padding: space.screen }}>
            {conversations.map((c, i) => (
              <View key={c.id}>
                {i > 0 && <Crease />}
                <Row
                  left={
                    <PersonAvatar
                      userId={c.otherId}
                      photoId={c.photoId}
                      look={c.look}
                      name={c.name || 'Someone'}
                      ring={c.unread > 0}
                    />
                  }
                  title={c.name || 'Someone'}
                  subtitle={
                    c.lastMessage
                      ? `${c.lastFromMe ? 'You: ' : ''}${c.lastMessage}`
                      : 'Say something'
                  }
                  value={ago(c.lastAt)}
                  onPress={() => router.push(`/dm/${c.id}`)}
                  last
                />
              </View>
            ))}
          </Surface>
        )}
      </View>
    </Screen>
  );
}
