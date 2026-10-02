/**
 * The distance map's tiles, fetched from our own server (server/src/api/tiles.ts) and
 * handed to <Image> as data -- the same way photos are, because the platform image loader
 * did not send the sign-in header on the phone (features/photos/photo.tsx says why).
 *
 * Kept in memory, oldest out first: a map tile is a picture of streets, the same for
 * everybody, so there is nothing to forget about it, only memory to bound.
 */
import { useEffect, useState } from 'react';
import { dataUriOf } from '../../lib/data-uri';
import { getApiBase } from '../../lib/env';

const cache = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();
/** About 300 tiles at ~25 KB each as text: a few megabytes. */
const KEPT = 300;

async function load(token: string, z: number, x: number, y: number): Promise<string | null> {
  const key = `${z}/${x}/${y}`;
  const have = cache.get(key);
  if (have) return have;
  const already = pending.get(key);
  if (already) return already;
  const work = (async () => {
    try {
      const res = await fetch(`${getApiBase()}/v1/tiles/${z}/${x}/${y}.png`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      const data = await dataUriOf(res, 'image/png');
      if (cache.size >= KEPT) {
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
 * One tile's picture: undefined while it is on its way, null if it could not be had (so
 * the map's placeholder stops breathing over a tile that is not coming -- offline, a
 * server error), the picture once it is here. A tile that failed is tried again the next
 * time it is shown.
 */
export function useTile(token: string | null, z: number, x: number, y: number): string | null | undefined {
  const key = `${z}/${x}/${y}`;
  const [data, setData] = useState<string | null | undefined>(() => cache.get(key));
  useEffect(() => {
    const now = cache.get(key);
    setData(now);
    if (now || !token) return;
    let alive = true;
    void load(token, z, x, y).then((d) => { if (alive) setData(d ?? null); });
    return () => { alive = false; };
  }, [token, key, z, x, y]);
  return data;
}
