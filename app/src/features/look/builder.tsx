/**
 * The builder: your character in the middle, what you are changing down the left,
 * what you could change it to down the right.
 *
 * IT USED TO BE A WALL OF WORDS. Eleven rows of chips reading "Punk", "Overalls",
 * "Trouser suit" -- and nobody knows what "Overalls" is in this pack until they tap it
 * and look at themselves. Worse, every rail looked the same, so there was no way to
 * see at a glance what you already had on. Now the left rail SHOWS what you are
 * wearing in each slot and the right rail SHOWS what you would be wearing instead,
 * both as real pictures of the real meshes -- `scripts/build-thumbs.mjs` draws them
 * once into one 100 KB sheet, so the whole picker costs one image and no GL.
 *
 * The three colour parts stay round swatches -- sunken when chosen, like every other
 * chosen thing in the app, because a filled box would be the only filled box. A locked
 * item can be worn in the preview and says what it costs; Save stays off until
 * everything worn is owned, and the server says the same (402), so nothing here is the
 * last line.
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  BALD, HAIR_HEX, LOOK_LABELS, LOOK_PARTS, OUTFIT_HEX, SKIN_HEX, forFigure, isSlot, itemAt, lockedIn,
  offeredFor, starterLookFor, type Look, type LookPart,
} from '@clone/shared';
import { useSession } from '../../store/session';
import { Button, raised, space, sunk, type, usePalette } from '../../components/ui';
import { CharacterAvatar } from './character-avatar';
import { PieceThumb } from './piece-thumb';
import { useLook } from './store';

const TAB: Record<LookPart, string> = {
  figure: 'You', skin: 'Skin', body: 'Build', head: 'Head', hairColor: 'Hair', beard: 'Beard',
  top: 'Top', legs: 'Legs', feet: 'Shoes', outfitColor: 'Colour', accessory: 'Extra',
};

/**
 * Facial hair is cut out of the men's face (see `buildBeards` in the build script),
 * so it is only offered to them. A woman who had one loses it when she says so --
 * `forFigure` does that, and the server would refuse the look otherwise.
 */
const hasPictures = (part: LookPart) => isSlot(part) || part === 'beard';
const railFor = (look: Look) => LOOK_PARTS.filter((k) => k !== 'beard' || look.figure === 0);
const SWATCHES: Partial<Record<LookPart, readonly string[]>> = { skin: SKIN_HEX, hairColor: HAIR_HEX, outfitColor: OUTFIT_HEX };

/** How tall the character stands when the screen cannot give it the whole height. */
const STAGE = 430;
const RAIL = 60;
const PICK = 68;
/** How far the hard edge of a scrolling rail is softened at the top and bottom. */
const FADE = 22;

export function CharacterBuilder({
  onSaved,
  onSkip,
  preview,
  fill = false,
}: {
  onSaved: (first: boolean) => void;
  /** Onboarding only: a way past without saving. */
  onSkip?: () => void;
  /** The 3D preview when the renderer is available; the flat avatar otherwise. */
  preview?: ReactNode;
  /** Take all the height there is, rather than a fixed stage. */
  fill?: boolean;
}) {
  const p = usePalette();
  const token = useSession((s) => s.token);
  const look = useLook((s) => s.look);
  const owned = useLook((s) => s.owned);
  const balance = useLook((s) => s.balance);
  const setLook = useLook((s) => s.setLook);
  const save = useLook((s) => s.save);
  const buy = useLook((s) => s.buy);
  // The first question, because it decides what every other rail offers.
  const [part, setPart] = useState<LookPart>('figure');
  const [showAll, setShowAll] = useState(false);
  // Opening another rail starts it on your own figure again: "show everything" is a
  // thing you asked of ONE rail, and leaving it on across all four means every rail
  // you open is ten pieces whether you wanted that or not.
  const openTab = useCallback((k: LookPart) => { setPart(k); setShowAll(false); }, []);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const locked = useMemo(() => lockedIn(look, owned), [look, owned]);
  const pick = useCallback((index: number) => {
    setNote(null);
    // Answering "which figure" moves the clothes with it, or somebody who picks Woman
    // last is left standing in a man's suit wondering what the question did.
    setLook(part === 'figure' ? forFigure(look, index) : { ...look, [part]: index });
  }, [look, part, setLook]);

  const onSave = async () => {
    if (!token || busy) return;
    setBusy(true); setNote(null);
    const r = await save(token);
    setBusy(false);
    if (!r.ok) {
      setNote(r.error === 'offline' ? 'Cannot reach the server.'
        : r.error === 'locked' ? 'Something you are wearing is not unlocked yet.'
        : 'That did not save. Try again.');
      return;
    }
    onSaved(r.first);
  };

  const onUnlock = async (id: string) => {
    if (!token || busy) return;
    setBusy(true); setNote(null);
    const r = await buy(token, id);
    setBusy(false);
    if (!r.ok) {
      setNote(r.error === 'not_enough' ? 'Not enough points yet. They come from answering after your dates.'
        : r.error === 'offline' ? 'Cannot reach the server.' : 'That did not go through. Try again.');
    }
  };

  const swatches = SWATCHES[part];
  const labels = LOOK_LABELS[part];
  const shown = !isSlot(part)
    ? labels.map((_, i) => i)
    : showAll
      // Everything, bar the one thing that is a rule rather than a preference: Bald
      // is the men's, so "show everything" does not smuggle it onto a woman's rail.
      ? labels.map((_, i) => i).filter((i) => part !== 'head' || i !== BALD || look.figure === 0)
      // What they are wearing stays on the rail even when it is off the other one, so
      // nothing they chose can vanish from under them.
      : [...new Set([...offeredFor(part, look.figure), look[part]])].sort((a, b) => a - b);
  const wornLocked = locked.find((i) => i.part === part);

  /** One round well: sunken when it is the chosen thing, raised when it is not. */
  const well = (selected: boolean, size: number) => ({
    width: size,
    height: size,
    borderRadius: size / 2,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    overflow: 'hidden' as const,
    backgroundColor: selected ? p.sunken : p.bg,
    boxShadow: selected ? sunk(p, 3) : raised(p, 4),
  });

  /**
   * A soft edge on a scrolling rail.
   *
   * A rail taller than the stage cuts its first and last well in half with a hard
   * straight line, which reads as a rendering fault rather than as "there is more".
   * React Native has no gradient without a package, so this is ten slices of the page
   * colour stepping from opaque to clear -- 22 points of it, which is enough to read
   * as a fade and small enough that nothing you need is ever hidden behind it. Six
   * slices were visibly striped across a colour swatch; ten are not.
   */
  const Fade = ({ at }: { at: 'top' | 'bottom' }) => (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', left: 0, right: 0, [at]: 0, height: FADE }}
    >
      {Array.from({ length: 10 }, (_, i) => (
        <View key={i} style={{ flex: 1, backgroundColor: p.bg, opacity: at === 'top' ? 1 - i / 10 : (i + 1) / 10 }} />
      ))}
    </View>
  );

  return (
    <View style={[{ gap: space.lg }, fill && { flex: 1 }]}>
      {/* THE RAILS FLOAT OVER THE CHARACTER, they do not stand beside it. Laid out
          side by side, the preview was a third of the screen wide and the figure's
          own arms went out of frame every time it turned. Now the canvas has the
          whole width and the two rails sit on top of it, down the edges, where an
          arm almost never reaches. */}
      <View style={[fill ? { flex: 1 } : { height: STAGE }, { position: 'relative' }]}>
        <View style={StyleSheet.absoluteFill}>
          {preview ?? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <CharacterAvatar look={look} size={200} />
            </View>
          )}
        </View>
        {/* WHAT YOU ARE CHANGING. Each one shows what you have on right now, so the
            rail doubles as the answer to "what am I wearing?" without tapping. */}
        <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: RAIL }}>
        <ScrollView
          contentContainerStyle={{ gap: space.sm, paddingVertical: FADE, alignItems: 'center' }}
          showsVerticalScrollIndicator={false}
        >
          {railFor(look).map((k) => {
            const on = part === k;
            const colours = SWATCHES[k];
            return (
              <Pressable
                key={k}
                onPress={() => openTab(k)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={TAB[k]}
                style={{ alignItems: 'center', gap: 2 }}
              >
                <View style={well(on, 44)}>
                  {hasPictures(k) ? (
                    <PieceThumb slot={k} set={look[k]} figure={look.figure} size={44} />
                  ) : colours ? (
                    <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: colours[look[k]] ?? colours[0] }} />
                  ) : (
                    <Text style={[type.label, { color: on ? p.accent : p.textSecondary, fontSize: 9, textAlign: 'center' }]}
                          numberOfLines={2}>
                      {LOOK_LABELS[k][look[k]] ?? ''}
                    </Text>
                  )}
                </View>
                <Text style={[type.label, { color: on ? p.accent : p.textTertiary, fontSize: 9 }]} numberOfLines={1}>
                  {TAB[k]}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Fade at="top" />
        <Fade at="bottom" />
        </View>

        {/* WHAT YOU COULD CHANGE IT TO. Pictures for anything the build could draw,
            swatches for the colours, words for the handful that are neither. */}
        <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: PICK }}>
        <ScrollView
          contentContainerStyle={{ gap: space.sm, paddingVertical: FADE, alignItems: 'center' }}
          showsVerticalScrollIndicator={false}
        >
          {(swatches ? swatches.map((_, i) => i) : shown).map((i) => {
            const item = itemAt(part, i);
            const isLocked = item.cost > 0 && !owned.has(item.id);
            const selected = look[part] === i;
            const label = labels[i] ?? item.label;
            return (
              <Pressable
                key={item.id}
                onPress={() => pick(i)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`${label}${isLocked ? `, ${item.cost} points` : ''}`}
                style={{ alignItems: 'center', gap: 2 }}
              >
                <View style={[well(selected, 52), { opacity: isLocked ? 0.55 : 1 }]}>
                  {hasPictures(part) ? (
                    <PieceThumb slot={part} set={i} figure={look.figure} size={52} />
                  ) : swatches ? (
                    <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: swatches[i] }} />
                  ) : (
                    <Text style={[type.label, { color: selected ? p.accent : p.textSecondary, textAlign: 'center', fontSize: 9 }]}
                          numberOfLines={2}>
                      {label}
                    </Text>
                  )}
                </View>
                <Text
                  style={[type.label, {
                    fontSize: 9,
                    color: isLocked ? p.textTertiary : selected ? p.accent : p.textSecondary,
                  }]}
                  numberOfLines={1}
                >
                  {isLocked ? `· ${item.cost} ·` : label.length > 9 ? `${label.slice(0, 8)}…` : label}
                </Text>
              </Pressable>
            );
          })}
          {/* A rail shows your own figure's pieces, because that is what most people
              want and ten of everything is a lot of scrolling. Nothing is off limits:
              every piece is rigged to the same skeleton, so any of it fits anybody. */}
          {isSlot(part) && (
            <Pressable onPress={() => setShowAll((v) => !v)} accessibilityRole="button"
                       style={{ paddingVertical: space.xs }}>
              <Text style={[type.label, { color: p.accent, textAlign: 'center', fontSize: 9 }]}>
                {showAll ? 'Just mine' : 'Show all'}
              </Text>
            </Pressable>
          )}
        </ScrollView>
        <Fade at="top" />
        <Fade at="bottom" />
        </View>
      </View>

      {wornLocked && (
        <View style={{ gap: space.sm }}>
          <Text style={[type.callout, { color: p.textSecondary }]}>
            {`${wornLocked.label} costs ${wornLocked.cost} points. You have ${balance}.`}
          </Text>
          <Button label={balance >= wornLocked.cost ? `Unlock for ${wornLocked.cost}` : `Unlock for ${wornLocked.cost} · not yet`}
                  variant="secondary" disabled={balance < wornLocked.cost || busy}
                  onPress={() => void onUnlock(wornLocked.id)} />
        </View>
      )}
      {note && <Text style={[type.callout, { color: p.danger }]}>{note}</Text>}

      <Button label={locked.length ? 'Unlock what you are wearing to save' : 'Save'} variant="primary"
              onPress={() => void onSave()} disabled={locked.length > 0 || busy} loading={busy} />
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Button label="Surprise me" variant="ghost"
                  onPress={() => { setNote(null); setLook(starterLookFor(Date.now() & 0x7fffffff)); }} />
        </View>
        {onSkip && (
          <View style={{ flex: 1 }}>
            <Button label="Skip for now" variant="ghost" onPress={onSkip} />
          </View>
        )}
      </View>
    </View>
  );
}
