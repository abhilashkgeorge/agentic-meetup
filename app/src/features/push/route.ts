/**
 * Where a tapped notification opens.
 *
 * The server sends only the kind and the card's id (server push/index.ts) -- the lock
 * screen carries no name and no words -- and this decides the screen:
 *   turn, fades   the Matches tab, where the waiting card is
 *   shared        their profile, which they just shared with you
 *   introduced    the chat, now open
 *   message       the chat
 * Anything it does not recognise opens nothing. Pure, so it is tested without a phone.
 */
const ID = /^[0-9a-f-]{36}$/i;

export function routeForPush(data: Record<string, unknown> | null | undefined): string | null {
  const id = typeof data?.rendezvousId === 'string' && ID.test(data.rendezvousId) ? data.rendezvousId : null;
  switch (data?.kind) {
    case 'message':
    case 'introduced':
      return id ? `/dm/${id}` : '/(tabs)/chats';
    case 'shared':
      return id ? `/match/${id}` : '/(tabs)/matches';
    case 'turn':
    case 'fades':
      return '/(tabs)/matches';
    default:
      return null;
  }
}
