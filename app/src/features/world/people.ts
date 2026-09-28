/**
 * The people list's rows -- the pure half of people-sheet.tsx, so the order can be
 * tested without react-native in the room.
 */
import { CENTRAL_AREA } from '@clone/shared';
import type { WorldAgent } from '../../lib/api';
import { YOU } from './bridge';
import { MAP, areaName } from './map';

export type PeopleRow =
  | { kind: 'row'; ref: string; title: string; subtitle?: string }
  | { kind: 'header'; ref: string; title: string };

const STATE: Record<WorldAgent['state'], string> = {
  idle: '',
  // No conversation is held any more; the same words as the agent sheet.
  talking: 'Your agent is with them now',
  briefed: 'Your agent met them',
  shared: 'You shared your profile',
  waiting: 'They decide first',
  introduced: 'You both said yes',
  passed: 'You said not this one',
};

/**
 * The rows, in the order a person would ask about them: you, then each neighbourhood
 * -- yours first, then by distance from yours -- with the people you have met before
 * the strangers inside each. Somebody with no neighbourhood stands in the central
 * tile on the map and is listed there too.
 */
export function peopleRows(agents: readonly WorldAgent[], myArea: string | null | undefined): PeopleRow[] {
  const mine = myArea ?? CENTRAL_AREA;
  const centre = (id: string) => MAP.areas.find((a) => a.id === id)?.centre ?? [0, 0];
  const [mx, mz] = centre(mine);
  const groups = new Map<string, WorldAgent[]>();
  for (const a of agents) {
    const id = a.area ?? CENTRAL_AREA;
    groups.set(id, [...(groups.get(id) ?? []), a]);
  }
  const order = [...groups.keys()].sort((a, b) => {
    if (a === mine) return -1; if (b === mine) return 1;
    const [ax, az] = centre(a); const [bx, bz] = centre(b);
    return Math.hypot(ax - mx, az - mz) - Math.hypot(bx - mx, bz - mz);
  });
  const rows: PeopleRow[] = [{ kind: 'row', ref: YOU, title: 'Your agent', subtitle: 'Tap to talk to it' }];
  for (const id of order) {
    rows.push({ kind: 'header', ref: `h:${id}`, title: id === mine ? `${areaName(id)} · yours` : areaName(id) });
    for (const a of [...groups.get(id)!].sort((a, b) => (a.kind === 'met' ? 0 : 1) - (b.kind === 'met' ? 0 : 1))) {
      rows.push({
        kind: 'row', ref: a.ref,
        title: a.kind === 'met' ? (a.name ?? 'Someone your agent met') : a.practice ? 'Practice match' : 'Someone in the square',
        subtitle: a.kind === 'met' ? (STATE[a.state] || undefined) : a.practice ? 'Not a real person' : undefined,
      });
    }
  }
  return rows;
}
