/**
 * What your clone learned in chat and has not been told it may say (learned.ts), read
 * from the server's list of it (GET /v1/me/learned, no model call), less what you kept
 * private on this phone. Read again whenever `refresh` is called -- after a
 * conversation, or on coming back -- and asked once however many ask at the same time:
 * the town asked three times as it opened (its mount, its focus, its chat closed).
 */
import { useCallback, useEffect, useState } from 'react';
import { setQuoteHidden } from '../../lib/api';
import { keepPrivate } from '../../lib/storage';
import { useSession } from '../../store/session';
import type { Learned } from './learned';
import { readLearned } from './read-learned';

export function useLearned(): {
  items: Learned[];
  refresh: () => Promise<void>;
  share: (ids: readonly string[]) => Promise<boolean>;
  keep: (ids: readonly string[]) => Promise<void>;
} {
  const token = useSession((s) => s.token);
  const [items, setItems] = useState<Learned[]>([]);
  const refresh = useCallback(async () => {
    if (!token) return;
    const now = await readLearned(token);
    if (now) setItems(now);
  }, [token]);
  useEffect(() => { void refresh(); }, [refresh]);

  /** "OK to share": each made something your agent may say. False if any did not save. */
  const share = useCallback(async (ids: readonly string[]) => {
    if (!token) return false;
    let ok = true;
    for (const id of ids) {
      const r = await setQuoteHidden(token, id, false);
      if (!r?.ok) ok = false;
      else setItems((was) => was.filter((l) => l.factId !== id));
    }
    return ok;
  }, [token]);

  /** "Keep private": as it was, and not asked again. */
  const keep = useCallback(async (ids: readonly string[]) => {
    await keepPrivate(ids);
    setItems((was) => was.filter((l) => !ids.includes(l.factId)));
  }, []);

  return { items, refresh, share, keep };
}
