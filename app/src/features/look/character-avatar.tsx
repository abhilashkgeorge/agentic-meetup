/**
 * The character, drawn flat.
 *
 * Every list in the app -- cards, the inbox, a chat header, the You tab -- shows a
 * character somewhere, and none of them should have to start a GL context to do it.
 * This is the look as plain Views: a head, a body, hair, two eyes, one extra, in the
 * same colours the 3D town uses (shared/look.ts), inside the same sunken well the
 * photo Avatar falls back to. It is deliberately simple; the town is where the
 * character moves.
 */
import { memo } from 'react';
import { View } from 'react-native';
import { HAIR_HEX, OUTFIT_HEX, SKIN_HEX, lookKey, type Look } from '@clone/shared';
import { raised, sunk, usePalette } from '../../components/ui';

/** Eye spacing and size per face preset, as a fraction of the well. */
const FACE: readonly { gap: number; eye: number; y: number }[] = [
  { gap: 0.16, eye: 0.06, y: 0.36 },   // Calm
  { gap: 0.18, eye: 0.07, y: 0.35 },   // Bright
  { gap: 0.16, eye: 0.045, y: 0.37 },  // Sleepy
  { gap: 0.2, eye: 0.08, y: 0.35 },    // Wide-eyed
  { gap: 0.15, eye: 0.06, y: 0.36 },   // Wry
  { gap: 0.16, eye: 0.05, y: 0.37 },   // Serious
];
const BODY_W = [0.36, 0.44, 0.54];

function darker(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.round(v * f).toString(16).padStart(2, '0');
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

export const CharacterAvatar = memo(function CharacterAvatar({ look, size = 52, ring }: {
  look: Look;
  size?: number;
  ring?: boolean;
}) {
  const p = usePalette();
  const skin = SKIN_HEX[look.skin] ?? SKIN_HEX[3];
  const hair = HAIR_HEX[look.hairColor] ?? HAIR_HEX[0];
  const outfit = OUTFIT_HEX[look.outfitColor] ?? OUTFIT_HEX[2];
  const face = FACE[look.face] ?? FACE[0]!;
  const head = size * 0.42;
  const headTop = size * 0.2;
  const cx = size / 2;
  const bodyW = size * (BODY_W[look.body] ?? 0.44);
  const eyeY = size * face.y;
  const gap = size * face.gap;
  const eye = size * face.eye;
  const abs = { position: 'absolute' as const };

  return (
    <View
      accessibilityLabel="Character"
      style={{
        width: size, height: size, borderRadius: size / 2, overflow: 'hidden',
        backgroundColor: p.sunken, boxShadow: ring ? raised(p, 3) : sunk(p, 3),
        borderWidth: ring ? 2 : 0, borderColor: ring ? p.accent : 'transparent',
      }}
    >
      {/* body: a rounded block rising from the bottom of the well */}
      <View style={{ ...abs, left: cx - bodyW / 2, top: size * 0.62, width: bodyW, height: size * 0.5,
                     borderTopLeftRadius: bodyW * 0.45, borderTopRightRadius: bodyW * 0.45, backgroundColor: outfit }} />
      {/* outfit details: a collar for hoodie/kurta/jacket/suit, a sash for the sari */}
      {(look.outfit === 1 || look.outfit === 2 || look.outfit === 5 || look.outfit === 6) && (
        <View style={{ ...abs, left: cx - bodyW * 0.18, top: size * 0.62, width: bodyW * 0.36, height: size * 0.12,
                       borderBottomLeftRadius: bodyW * 0.18, borderBottomRightRadius: bodyW * 0.18, backgroundColor: darker(outfit, 0.72) }} />
      )}
      {look.outfit === 4 && (
        <View style={{ ...abs, left: cx - bodyW * 0.5, top: size * 0.66, width: bodyW, height: size * 0.07,
                       backgroundColor: darker(outfit, 0.72), transform: [{ rotate: '-24deg' }] }} />
      )}
      {look.outfit === 7 && (
        <View style={{ ...abs, left: cx - bodyW * 0.5, top: size * 0.74, width: bodyW, height: size * 0.05, backgroundColor: p.bg }} />
      )}
      {/* long hair hangs behind the head */}
      {(look.hair === 3 || look.hair === 5) && (
        <View style={{ ...abs, left: cx - head * 0.56, top: headTop + head * 0.3, width: head * 1.12, height: head * 0.95,
                       borderBottomLeftRadius: head * 0.3, borderBottomRightRadius: head * 0.3, backgroundColor: hair }} />
      )}
      {/* head */}
      <View style={{ ...abs, left: cx - head / 2, top: headTop, width: head, height: head, borderRadius: head / 2, backgroundColor: skin }} />
      {/* hair on top */}
      {look.hair !== 7 && (
        <View style={{
          ...abs, left: cx - head / 2, top: headTop - head * (look.hair === 2 ? 0.1 : 0.02), width: head,
          height: head * (look.hair === 1 ? 0.3 : look.hair === 2 ? 0.62 : 0.48),
          borderTopLeftRadius: head / 2, borderTopRightRadius: head / 2,
          borderBottomLeftRadius: look.hair === 2 ? head * 0.2 : 0, borderBottomRightRadius: look.hair === 2 ? head * 0.2 : 0,
          backgroundColor: hair,
        }} />
      )}
      {look.hair === 4 && <View style={{ ...abs, left: cx - head * 0.18, top: headTop - head * 0.28, width: head * 0.36, height: head * 0.36, borderRadius: head * 0.18, backgroundColor: hair }} />}
      {look.hair === 5 && <View style={{ ...abs, left: cx + head * 0.36, top: headTop + head * 0.25, width: head * 0.24, height: head * 0.7, borderRadius: head * 0.12, backgroundColor: hair }} />}
      {look.hair === 6 && <View style={{ ...abs, left: cx - head * 0.1, top: headTop - head * 0.34, width: head * 0.2, height: head * 0.5, borderRadius: head * 0.06, backgroundColor: hair }} />}
      {/* eyes */}
      <View style={{ ...abs, left: cx - gap / 2 - eye / 2, top: eyeY, width: eye, height: eye, borderRadius: eye / 2, backgroundColor: '#262626' }} />
      <View style={{ ...abs, left: cx + gap / 2 - eye / 2, top: eyeY, width: eye, height: eye, borderRadius: eye / 2, backgroundColor: '#262626' }} />
      {/* extras */}
      {look.accessory === 1 && (
        <>
          <View style={{ ...abs, left: cx - gap / 2 - eye, top: eyeY - eye / 2, width: eye * 2, height: eye * 2, borderRadius: eye, borderWidth: 1.5, borderColor: p.text }} />
          <View style={{ ...abs, left: cx + gap / 2 - eye, top: eyeY - eye / 2, width: eye * 2, height: eye * 2, borderRadius: eye, borderWidth: 1.5, borderColor: p.text }} />
        </>
      )}
      {look.accessory === 2 && (
        <View style={{ ...abs, left: cx - head * 0.56, top: headTop - head * 0.06, width: head * 1.12, height: head * 0.22,
                       borderRadius: head * 0.08, backgroundColor: darker(outfit, 0.8) }} />
      )}
      {look.accessory === 3 && (
        <>
          <View style={{ ...abs, left: cx - head / 2 - eye * 0.3, top: headTop + head * 0.62, width: eye, height: eye, borderRadius: eye / 2, backgroundColor: p.warning }} />
          <View style={{ ...abs, left: cx + head / 2 - eye * 0.7, top: headTop + head * 0.62, width: eye, height: eye, borderRadius: eye / 2, backgroundColor: p.warning }} />
        </>
      )}
      {look.accessory === 4 && (
        <View style={{ ...abs, left: cx - bodyW * 0.5, top: size * 0.6, width: bodyW, height: size * 0.08, borderRadius: size * 0.04, backgroundColor: p.accent }} />
      )}
    </View>
  );
}, (a, b) => a.size === b.size && a.ring === b.ring && lookKey(a.look) === lookKey(b.look));
