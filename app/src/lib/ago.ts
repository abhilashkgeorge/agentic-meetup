/**
 * The time beside a conversation: "now", "4m", "2h", "Tue", "12 Mar".
 *
 * Its own file rather than a helper inside the screen, so it can be tested without a
 * phone. It earned that: the server used to send the time the way Postgres prints it
 * -- "2026-09-12 23:53:52.900997+00" -- and every row in the chat list read "Invalid
 * Date". Node parses that string, so it looked right everywhere except on a device;
 * Hermes implements only what the spec requires, which is ISO 8601.
 */
export function ago(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  // A date that will not parse shows NOTHING, never the words "Invalid Date". The
  // server sends ISO now, and this is the second line of defence: the timestamp is
  // decoration on this row, and decoration must not put an error message where a
  // person expects a time.
  if (Number.isNaN(then)) return '';

  const mins = Math.floor((Date.now() - then) / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;

  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return new Date(then).toLocaleDateString('en-GB', { weekday: 'short' });
  return new Date(then).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
