/**
 * Whether Matches and Chats have something waiting (dots.ts), read from the same two
 * lists their screens read -- neither has a model call behind it -- when the app opens or
 * comes back, whenever a tab is opened, and when the socket says something arrived
 * (pulse.ts). One read at a time; one more after it if something arrived meanwhile.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { getConversations, getMatches } from '../../lib/api';
import { useDm } from '../../store/dm';
import { useSession } from '../../store/session';
import { chatsWaiting, matchesWaiting } from './dots';
import { useTabPulse } from './pulse';

export function useTabDots(): { matches: boolean; chats: boolean; refresh: () => void } {
  const token = useSession((s) => s.token);
  const pulse = useTabPulse((s) => s.n);
  // Chats from the store the inbox and the conversations share: opening one clears it.
  const chats = useDm((s) => chatsWaiting(s.conversations));
  const [matches, setMatches] = useState(false);
  const reading = useRef(false);
  const again = useRef(false);

  const refresh = useCallback(() => {
    if (!token) return;
    if (reading.current) { again.current = true; return; }
    reading.current = true;
    void (async () => {
      do {
        again.current = false;
        const [m, c] = await Promise.all([getMatches(token), getConversations(token)]);
        if (m) setMatches(matchesWaiting(m.matches));
        if (c) {
          if (c.me) useDm.getState().setMe(c.me);
          useDm.getState().setConversations(c.conversations);
        }
      } while (again.current);
      reading.current = false;
    })();
  }, [token]);

  useEffect(() => { refresh(); }, [refresh, pulse]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') refresh(); });
    return () => sub.remove();
  }, [refresh]);

  return { matches, chats, refresh };
}
