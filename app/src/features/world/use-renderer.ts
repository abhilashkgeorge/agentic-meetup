/**
 * The renderer, for screens that want a 3D preview but are not the town.
 *
 * Same door (`loadWorldRenderer`), same fuse as the Home screen: `off` means the
 * person or a crash turned 3D off, and this answers null so the caller draws the flat
 * character instead. It does not arm the `trying` fuse -- that is the town's job, and
 * a builder preview that failed to draw is not worth switching the whole town off
 * over.
 */
import { useEffect, useState } from 'react';
import { getGlFuse } from '../../lib/storage';
import { loadWorldRenderer, type WorldRenderer } from './r3f';

/**
 * Undefined while it is still being looked for (a preview shows the figure's shape then,
 * not a flat drawing that turns into the real one); null when there is none to have.
 */
export function useRenderer(): WorldRenderer | null | undefined {
  const [renderer, setRenderer] = useState<WorldRenderer | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void (async () => {
      if ((await getGlFuse()) === 'off') { if (live) setRenderer(null); return; }
      const r = await loadWorldRenderer();
      if (live) setRenderer(r ?? null);
    })();
    return () => { live = false; };
  }, []);
  return renderer;
}
