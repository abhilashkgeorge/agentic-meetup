/**
 * The invite card's words. Plain, so they can be tested without a phone.
 *
 * Three people each, in all (server env INVITES_PER_USER, the founder's item 5): used
 * invites count, open ones count, and one that runs out unused comes back. The
 * reviewer has no limit -- the server says so with `remaining: null`.
 */
export function inviteCard(remaining: number | null, perPerson: number): {
  label: string; line: string; canMake: boolean;
} {
  if (remaining === null) {
    return { label: 'Invites', line: 'No limit for you. You are how the first people get in.', canMake: true };
  }
  return {
    label: `Invites · ${remaining} left`,
    line: `You can bring in ${perPerson} ${perPerson === 1 ? 'person' : 'people'}. An invite that runs out unused comes back.`,
    canMake: remaining > 0,
  };
}
