/**
 * What your clone learned in chat and has not been told it may say (learned.ts), read
 * from the server's "How you appear" list, less what you kept private on this phone.
 * Read again whenever `refresh` is called -- after a conversation, or on coming back.
 */
import { useCallback, useEffect, useState } from 'react';
import { getAppearance, setQuoteHidden } from '../../lib/api';
import { getKeptPrivate, keepPrivate } from '../../lib/storage';
import { useSession } from '../../store/session';
import { stillToAsk, type Learned } from './learned';

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
    const [seen, kept] = await Promise.all([getAppearance(token), getKeptPrivate()]);
    if (seen) setItems(stillToAsk(seen.learned, kept));
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
