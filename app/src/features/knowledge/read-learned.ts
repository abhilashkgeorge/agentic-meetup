/**
 * The learned list (learned.ts), read from the server's own call for it -- GET
 * /v1/me/learned, no model behind it -- less what was kept private on this phone, and
 * read once however many ask at the same time: the town asked three times as it opened
 * (its mount, its focus, its chat closed), each through "How you appear", which can build
 * the answer sheet -- three of a new person's ten turns (the Pixel, 2026-10-04).
 */
import { getLearned } from '../../lib/api';
import { getKeptPrivate } from '../../lib/storage';
import { stillToAsk, type Learned } from './learned';

/** The read in flight, shared by everyone who asks while it runs. */
let asking: Promise<Learned[] | null> | null = null;

/** The learned list, once for all who ask at the same time. Null when it could not be read. */
export function readLearned(token: string): Promise<Learned[] | null> {
  if (asking) return asking;
  asking = (async () => {
    const [seen, kept] = await Promise.all([getLearned(token), getKeptPrivate()]);
    return seen ? stillToAsk(seen.learned, kept) : null;
  })().finally(() => { asking = null; });
  return asking;
}
