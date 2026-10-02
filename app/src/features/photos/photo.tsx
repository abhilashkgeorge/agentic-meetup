/**
 * Loading a photo that needs a credential.
 *
 * WHY NOT JUST `<Image source={{ uri, headers }} />`. Because it did not work. The
 * server answered the same request from a laptop with a 200 and a JPEG, and on the
 * device the picture came back as an empty circle: React Native hands an image URL to
 * the platform loader, which is a different HTTP stack from `fetch` with its own
 * behaviour around headers, redirects and caching. Debugging whose fault that is
 * costs more than not depending on it.
 *
 * So the bytes are fetched the same way every other request in this app is fetched,
 * and handed to `Image` as data. One HTTP path, one set of rules.
 *
 * CACHED IN MEMORY, by photo id. A conversation list re-renders constantly and each
 * render must not re-download six faces. The cache is bounded and dies with the
 * process -- these are pictures of people, and writing them to disk would mean
 * deciding when to delete them again, which is the kind of promise this app should
 * only make where it can keep it.
 */
import { useEffect, useState } from 'react';
import { Image, type ImageStyle, type StyleProp } from 'react-native';
import { dataUriOf } from '../../lib/data-uri';
import { getApiBase } from '../../lib/env';
import { useSession } from '../../store/session';
import { Avatar, SkeletonBlock } from '../../components/ui';

/** Data URIs by `${photoId}:${size}`. Small: a thumb is a couple of kilobytes. */
const cache = new Map<string, string>();
/** In-flight requests, so ten rows asking for one face make one request. */
const pending = new Map<string, Promise<string | null>>();

const MAX_CACHED = 60;

async function load(
  token: string, userId: string, photoId: string, size: 'full' | 'thumb',
): Promise<string | null> {
  const key = `${photoId}:${size}`;
  const have = cache.get(key);
  if (have) return have;

  const already = pending.get(key);
  if (already) return already;

  const work = (async () => {
    try {
      const res = await fetch(
        `${getApiBase()}/v1/photos/${userId}/${photoId}?size=${size}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      // 404 is the honest answer for "not yours to see yet" as well as "no such
      // photo", so there is nothing to report and nothing to retry.
      if (!res.ok) return null;

      const data = await dataUriOf(res, 'image/jpeg');

      // Oldest out first. A Map iterates in insertion order, which is all the
      // eviction policy a list of faces needs.
      if (cache.size >= MAX_CACHED) {
        const oldest = cache.keys().next().value;
        if (oldest) cache.delete(oldest);
      }
      cache.set(key, data);
      return data;
    } catch {
      return null;
    } finally {
      pending.delete(key);
    }
  })();

  pending.set(key, work);
  return work;
}

/**
 * The photo as something `Image` will render: the data once it is here, undefined while
 * it is on its way (so the screen can show a placeholder breathing where it will be),
 * null when there is no photo to load or it could not be had -- never a placeholder
 * breathing for ever over a photo that is not coming.
 */
export function usePhoto(
  userId: string | null | undefined,
  photoId: string | null | undefined,
  size: 'full' | 'thumb' = 'thumb',
): string | null | undefined {
  const token = useSession((s) => s.token);
  const key = photoId ? `${photoId}:${size}` : '';
  const [data, setData] = useState<string | null | undefined>(() => (photoId ? cache.get(key) : null));

  useEffect(() => {
    // A different photo starts from what is known of IT, not from the last one's picture.
    setData(photoId ? cache.get(key) : null);
    if (!token || !userId || !photoId) return;
    let alive = true;
    void load(token, userId, photoId, size).then((uri) => {
      if (alive) setData(uri ?? null);
    });
    return () => { alive = false; };
  }, [token, userId, photoId, size, key]);

  return data;
}

/** A face in a list row. Falls back to initials, which is a shape rather than a hole. */
export function PhotoAvatar({
  userId, photoId, name, size = 52, ring,
}: {
  userId: string | null | undefined;
  photoId: string | null | undefined;
  name?: string | null;
  size?: number;
  ring?: boolean;
}) {
  const uri = usePhoto(userId, photoId, 'thumb');
  return <Avatar name={name} size={size} ring={ring} source={uri ? { uri } : undefined}
                 loading={Boolean(photoId) && uri === undefined} />;
}

/** A photo at full size, for the reveal. */
export function Portrait({
  userId, photoId, style, size = 'full', label,
}: {
  userId: string | null | undefined;
  photoId: string | null | undefined;
  style?: StyleProp<ImageStyle>;
  size?: 'full' | 'thumb';
  label?: string;
}) {
  const uri = usePhoto(userId, photoId, size);
  // On its way: a placeholder breathing where it will be. It used to be nothing at all,
  // an empty well on the reveal and the photos screen.
  if (uri === undefined) return <SkeletonBlock height="100%" radius={0} />;
  if (!uri) return null;
  return (
    <Image source={{ uri }} style={style} resizeMode="cover" accessibilityLabel={label} />
  );
}
