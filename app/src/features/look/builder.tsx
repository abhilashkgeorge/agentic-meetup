/**
 * The builder: eight parts, one preview, one Save.
 *
 * Shapes are chips; the three colour parts are round swatches -- sunken when chosen,
 * like every other chosen thing in the app, because a filled square would be the
 * only filled square. A locked item can be worn in the preview and says what it
 * costs; Save stays off until everything worn is owned, and the server says the same
 * (402), so nothing here is the last line.
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  HAIR_HEX, LOOK_LABELS, LOOK_PARTS, OUTFIT_HEX, SKIN_HEX, itemAt, lockedIn, starterLookFor,
  type Look, type LookPart,
} from '@clone/shared';
import { useSession } from '../../store/session';
import { Button, Chip, ChipGroup, raised, space, sunk, type, usePalette } from '../../components/ui';
import { CharacterAvatar } from './character-avatar';
import { useLook } from './store';

const TAB: Record<LookPart, string> = {
  skin: 'Skin', body: 'Body', hair: 'Hair', hairColor: 'Hair colour',
  face: 'Face', outfit: 'Outfit', outfitColor: 'Colour', accessory: 'Extra',
};
const SWATCHES: Partial<Record<LookPart, readonly string[]>> = { skin: SKIN_HEX, hairColor: HAIR_HEX, outfitColor: OUTFIT_HEX };

export function CharacterBuilder({
  onSaved,
  onSkip,
  preview,
}: {
  onSaved: (first: boolean) => void;
  /** Onboarding only: a way past without saving. */
  onSkip?: () => void;
  /** The 3D preview when the renderer is available; the flat avatar otherwise. */
  preview?: ReactNode;
}) {
  const p = usePalette();
  const token = useSession((s) => s.token);
  const look = useLook((s) => s.look);
  const owned = useLook((s) => s.owned);
  const balance = useLook((s) => s.balance);
  const setLook = useLook((s) => s.setLook);
  const save = useLook((s) => s.save);
  const buy = useLook((s) => s.buy);
  const [part, setPart] = useState<LookPart>('skin');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const locked = useMemo(() => lockedIn(look, owned), [look, owned]);
  const pick = useCallback((index: number) => { setNote(null); setLook({ ...look, [part]: index }); }, [look, part, setLook]);

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
  const wornLocked = locked.find((i) => i.part === part);

  return (
    <View style={{ gap: space.lg }}>
      <View style={{ alignItems: 'center' }}>
        {preview ?? <CharacterAvatar look={look} size={200} />}
      </View>

      <ChipGroup>
        {LOOK_PARTS.map((k) => (
          <Chip key={k} label={TAB[k]} selected={part === k} onPress={() => setPart(k)} />
        ))}
      </ChipGroup>

      {swatches ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
          {swatches.map((hex, i) => {
            const item = itemAt(part, i);
            const isLocked = item.cost > 0 && !owned.has(item.id);
            const selected = look[part] === i;
            return (
              <Pressable
                key={hex}
                onPress={() => pick(i)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`${item.label}${isLocked ? `, ${item.cost} points` : ''}`}
                style={{
                  width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: selected ? p.sunken : p.bg, boxShadow: selected ? sunk(p, 3) : raised(p, 4),
                }}
              >
                <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: hex, opacity: isLocked ? 0.45 : 1 }} />
                {isLocked && <Text style={[type.label, { position: 'absolute', bottom: -14, color: p.textTertiary }]}>{item.cost}</Text>}
              </Pressable>
            );
          })}
        </View>
      ) : (
        <ChipGroup>
          {labels.map((label, i) => {
            const item = itemAt(part, i);
            const isLocked = item.cost > 0 && !owned.has(item.id);
            return (
              <Chip key={item.id} label={isLocked ? `${label} · ${item.cost}` : label}
                    selected={look[part] === i} onPress={() => pick(i)} />
            );
          })}
        </ChipGroup>
      )}

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
