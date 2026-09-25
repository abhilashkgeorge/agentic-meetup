/**
 * The builder's preview: the character in 3D when the renderer is there, flat when
 * it is not. Colours are the palette's, as in the town, so the preview is the town.
 */
import { useMemo } from 'react';
import { usePalette } from '../../components/ui';
import { useRenderer } from '../world/use-renderer';
import { CharacterAvatar } from './character-avatar';
import { useLook } from './store';

export function Preview({ height }: { height?: number }) {
  const p = usePalette();
  const look = useLook((s) => s.look);
  const renderer = useRenderer();
  const colors = useMemo(() => ({
    bg: p.bg, ground: p.sunken, light: p.light, prop: p.dark, you: p.accent, stranger: p.textTertiary,
    met: p.textSecondary, practice: p.textTertiary, success: p.success, danger: p.danger,
    warning: p.warning, accent: p.accent, night: false,
  }), [p]);
  if (!renderer) return <CharacterAvatar look={look} size={200} />;
  return <renderer.CharacterCanvas look={look} colors={colors} height={height} />;
}
