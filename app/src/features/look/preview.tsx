/**
 * The character in 3D when the renderer is there, flat when it is not -- or when the
 * model cannot be read, which the canvas says once. The body is the town's own
 * (world/character-canvas.tsx), so what you see here is what walks about.
 */
import { useState } from 'react';
import { usePalette } from '../../components/ui';
import { useRenderer } from '../world/use-renderer';
import type { Focus } from '../world/framing';
import { CharacterAvatar } from './character-avatar';
import { FigureSkeleton } from './figure-skeleton';
import { useLook } from './store';

export function Preview({ height, focus = 'body', turnable = true, background, active = true }: {
  height?: number;
  /** The part being chosen: the camera goes to it. */
  focus?: Focus;
  turnable?: boolean;
  /** Behind them; the page colour unless the caller sits them in a well. */
  background?: string;
  active?: boolean;
}) {
  const p = usePalette();
  const look = useLook((s) => s.look);
  const renderer = useRenderer();
  const [failed, setFailed] = useState(false);
  // While the 3D engine starts: the figure's shape, not a flat drawing that then turns
  // into the real one. Without 3D at all: the drawing, sized to its box -- at 200 it was
  // cut off in the You tab's 112 x 150 well.
  if (renderer === undefined) return <FigureSkeleton height={height ?? 240} />;
  if (!renderer || failed) return <CharacterAvatar look={look} size={Math.min(200, Math.round((height ?? 266) * 0.75))} />;
  return (
    <renderer.CharacterCanvas look={look} background={background ?? p.bg} height={height} focus={focus}
                              turnable={turnable} active={active} onFail={() => setFailed(true)} />
  );
}
