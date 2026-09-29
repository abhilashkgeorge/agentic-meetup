/**
 * The character, drawn flat.
 *
 * Every list in the app -- cards, the inbox, a chat header, the You tab -- shows a
 * character somewhere, and none of them should have to start a GL context to do it.
 * This is the look as plain Views: a head, a body, hair, two eyes and what they wear
 * on top, in the same colours the 3D town uses (shared/look.ts), inside the same
 * sunken well the
 * photo Avatar falls back to. It is deliberately simple; the town is where the
 * character moves.
 */
import { memo } from 'react';
import { View } from 'react-native';
import { EYE_HEX, HAIR_HEX, OUTFIT_HEX, SKIN_HEX, lookKey, type Look } from '@clone/shared';
import { beardOf, hairOf, skirtOf, topOf } from './silhouette';
import { raised, sunk, usePalette } from '../../components/ui';

/**
 * Eye spacing and size, as a fraction of the well. One face: the catalog used to offer
 * six expressions and they did nothing at all on the rigged body, so they are gone.
 * This is the old "Calm", which is what everybody started with.
 */
const FACE = { gap: 0.16, eye: 0.06, y: 0.36 } as const;
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
  const face = FACE;
  // Under a hat the hair is pulled in under it, as it is in the town: nothing of it
  // stands up out of the crown.
  const worn = hairOf(look);
  const hairKind = look.hat > 0 && (worn === 'mohawk' || worn === 'curly' || worn === 'bun') ? 'short' : worn;
  const eyeColour = EYE_HEX[look.eyes] ?? EYE_HEX[0];
  const n = OUTFIT_HEX.length;
  const wheel = (off: number) => OUTFIT_HEX[(look.outfitColor + off) % n] ?? OUTFIT_HEX[0];
  const beard = beardOf(look);
  const top = topOf(look);
  const skirt = skirtOf(look);
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
      {/* a skirt, when the legs they picked are one */}
      {skirt && (
        <View style={{ ...abs, left: cx - bodyW * 0.62, top: size * 0.86, width: bodyW * 1.24, height: size * 0.24,
                       borderTopLeftRadius: bodyW * 0.2, borderTopRightRadius: bodyW * 0.2, backgroundColor: darker(outfit, 0.88) }} />
      )}
      {/* what the top has at the neck */}
      {top === 'collar' && (
        <View style={{ ...abs, left: cx - bodyW * 0.18, top: size * 0.62, width: bodyW * 0.36, height: size * 0.12,
                       borderBottomLeftRadius: bodyW * 0.18, borderBottomRightRadius: bodyW * 0.18, backgroundColor: darker(outfit, 0.72) }} />
      )}
      {top === 'straps' && (
        <View style={{ ...abs, left: cx - bodyW * 0.5, top: size * 0.66, width: bodyW, height: size * 0.07,
                       backgroundColor: darker(outfit, 0.72), transform: [{ rotate: '-24deg' }] }} />
      )}
      {top === 'open' && (
        <View style={{ ...abs, left: cx - bodyW * 0.06, top: size * 0.62, width: bodyW * 0.12, height: size * 0.5, backgroundColor: darker(outfit, 0.6) }} />
      )}
      {/* long hair hangs behind the head */}
      {(hairKind === 'long' || hairKind === 'ponytail' || hairKind === 'bob') && (
        <View style={{ ...abs, left: cx - head * 0.56, top: headTop + head * 0.3, width: head * 1.12,
                       height: head * (hairKind === 'bob' ? 0.6 : 0.95),
                       borderBottomLeftRadius: head * 0.3, borderBottomRightRadius: head * 0.3, backgroundColor: hair }} />
      )}
      {/* head */}
      <View style={{ ...abs, left: cx - head / 2, top: headTop, width: head, height: head, borderRadius: head / 2, backgroundColor: skin }} />
      {/* hair on top */}
      {hairKind !== 'bald' && (
        <View style={{
          ...abs, left: cx - head / 2, top: headTop - head * (hairKind === 'curly' ? 0.1 : 0.02), width: head,
          height: head * (hairKind === 'buzz' ? 0.3 : hairKind === 'curly' ? 0.62 : 0.48),
          borderTopLeftRadius: head / 2, borderTopRightRadius: head / 2,
          borderBottomLeftRadius: hairKind === 'curly' ? head * 0.2 : 0, borderBottomRightRadius: hairKind === 'curly' ? head * 0.2 : 0,
          backgroundColor: hair,
        }} />
      )}
      {hairKind === 'bun' && <View style={{ ...abs, left: cx - head * 0.18, top: headTop - head * 0.28, width: head * 0.36, height: head * 0.36, borderRadius: head * 0.18, backgroundColor: hair }} />}
      {hairKind === 'ponytail' && <View style={{ ...abs, left: cx + head * 0.36, top: headTop + head * 0.25, width: head * 0.24, height: head * 0.7, borderRadius: head * 0.12, backgroundColor: hair }} />}
      {hairKind === 'mohawk' && <View style={{ ...abs, left: cx - head * 0.1, top: headTop - head * 0.34, width: head * 0.2, height: head * 0.5, borderRadius: head * 0.06, backgroundColor: hair }} />}
      {/* facial hair: how much of the lower face is covered, and nothing finer --
          this is a 52-point circle. */}
      {beard !== 'none' && (
        <View style={{
          ...abs,
          left: cx - head * (beard === 'moustache' ? 0.16 : beard === 'goatee' ? 0.14 : 0.36),
          top: headTop + head * (beard === 'moustache' ? 0.56 : beard === 'goatee' ? 0.66 : 0.52),
          width: head * (beard === 'moustache' ? 0.32 : beard === 'goatee' ? 0.28 : 0.72),
          height: head * (beard === 'moustache' ? 0.1 : beard === 'goatee' ? 0.24 : beard === 'jaw' ? 0.3 : 0.4),
          borderBottomLeftRadius: head * 0.3,
          borderBottomRightRadius: head * 0.3,
          borderTopLeftRadius: beard === 'moustache' ? head * 0.05 : 0,
          borderTopRightRadius: beard === 'moustache' ? head * 0.05 : 0,
          backgroundColor: hair,
        }} />
      )}
      {/* eyes */}
      <View style={{ ...abs, left: cx - gap / 2 - eye / 2, top: eyeY, width: eye, height: eye, borderRadius: eye / 2, backgroundColor: eyeColour }} />
      <View style={{ ...abs, left: cx + gap / 2 - eye / 2, top: eyeY, width: eye, height: eye, borderRadius: eye / 2, backgroundColor: eyeColour }} />
      {/* what they wear on top: one simple shape each, in the town's colours */}
      {look.glasses > 0 && (
        <>
          <View style={{ ...abs, left: cx - gap / 2 - eye, top: eyeY - eye / 2, width: eye * 2, height: eye * 2,
                         borderRadius: look.glasses === 3 ? eye * 0.3 : eye, borderWidth: 1.5, borderColor: '#2f333a',
                         backgroundColor: look.glasses === 2 ? '#1c1f24' : 'transparent' }} />
          <View style={{ ...abs, left: cx + gap / 2 - eye, top: eyeY - eye / 2, width: eye * 2, height: eye * 2,
                         borderRadius: look.glasses === 3 ? eye * 0.3 : eye, borderWidth: 1.5, borderColor: '#2f333a',
                         backgroundColor: look.glasses === 2 ? '#1c1f24' : 'transparent' }} />
        </>
      )}
      {look.hat === 5 && (
        <View style={{ ...abs, left: cx - head * 0.6, top: headTop - head * 0.08, width: head * 1.2, height: head * 0.26,
                       borderRadius: head * 0.13, backgroundColor: wheel(5), transform: [{ rotate: '-8deg' }] }} />
      )}
      {look.hat > 0 && look.hat !== 5 && (
        <View style={{ ...abs, left: cx - head * (look.hat === 3 ? 0.66 : 0.56), top: headTop - head * 0.1, width: head * (look.hat === 3 ? 1.32 : 1.12),
                       height: head * (look.hat === 2 ? 0.42 : 0.3),
                       borderTopLeftRadius: head * 0.5, borderTopRightRadius: head * 0.5, borderRadius: head * 0.08,
                       backgroundColor: look.hat === 4 ? '#e3b23c' : wheel(3) }} />
      )}
      {look.earrings > 0 && (
        <>
          <View style={{ ...abs, left: cx - head / 2 - eye * 0.3, top: headTop + head * 0.62, width: eye, height: eye, borderRadius: eye / 2,
                         backgroundColor: look.earrings === 1 ? '#d9a441' : 'transparent', borderWidth: look.earrings === 2 ? 1.5 : 0, borderColor: '#d9a441' }} />
          <View style={{ ...abs, left: cx + head / 2 - eye * 0.7, top: headTop + head * 0.62, width: eye, height: eye, borderRadius: eye / 2,
                         backgroundColor: look.earrings === 1 ? '#d9a441' : 'transparent', borderWidth: look.earrings === 2 ? 1.5 : 0, borderColor: '#d9a441' }} />
        </>
      )}
      {look.neck === 1 && (
        <View style={{ ...abs, left: cx - bodyW * 0.5, top: size * 0.6, width: bodyW, height: size * 0.08, borderRadius: size * 0.04, backgroundColor: wheel(6) }} />
      )}
      {look.neck === 2 && (
        <View style={{ ...abs, left: cx - bodyW * 0.22, top: size * 0.6, width: bodyW * 0.44, height: size * 0.1,
                       borderBottomLeftRadius: bodyW * 0.22, borderBottomRightRadius: bodyW * 0.22, borderWidth: 1, borderTopWidth: 0, borderColor: '#d9a441' }} />
      )}
      {look.neck === 3 && (
        <View style={{ ...abs, left: cx - size * 0.06, top: size * 0.62, width: size * 0.12, height: size * 0.05, borderRadius: size * 0.01, backgroundColor: wheel(9) }} />
      )}
      {look.bag > 0 && (
        <View style={{ ...abs, left: cx - bodyW * 0.3, top: size * 0.64, width: size * 0.035, height: size * 0.4,
                       backgroundColor: look.bag === 1 ? wheel(4) : '#6b4a32', transform: [{ rotate: '-28deg' }] }} />
      )}
    </View>
  );
}, (a, b) => a.size === b.size && a.ring === b.ring && lookKey(a.look) === lookKey(b.look));
