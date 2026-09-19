/**
 * Somebody's face in a list: their photo if you are allowed it, their character if
 * not, their initial if there is neither. One component so the inbox, the thread and
 * the cards all fall back the same way, and none of them has to know the rule.
 */
import type { Look } from '@clone/shared';
import { PhotoAvatar } from '../photos/photo';
import { CharacterAvatar } from './character-avatar';

export function PersonAvatar({ userId, photoId, look, name, size = 52, ring }: {
  userId?: string | null;
  photoId?: string | null;
  look?: Look | null;
  name?: string | null;
  size?: number;
  ring?: boolean;
}) {
  if (photoId && userId) return <PhotoAvatar userId={userId} photoId={photoId} name={name ?? 'Someone'} size={size} ring={ring} />;
  if (look) return <CharacterAvatar look={look} size={size} ring={ring} />;
  return <PhotoAvatar userId={userId ?? undefined} photoId={null} name={name ?? 'Someone'} size={size} ring={ring} />;
}
