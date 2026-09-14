/**
 * Talking to your own clone.
 *
 * The connection itself lives in lib/socket.ts and is opened once by the root layout,
 * because the same socket also carries messages from people you matched with. This
 * used to open its own, which meant the socket died whenever you left the chat tab --
 * and, once DMs existed, that every clone turn arrived twice.
 */
import { sendTurn } from '../../lib/socket';
import { useSession } from '../../store/session';

export function useChat(): { send: (text: string) => void; connected: boolean } {
  const connected = useSession((s) => s.connected);
  return { send: sendTurn, connected };
}
