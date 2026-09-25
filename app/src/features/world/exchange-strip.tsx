/**
 * What the two agents just asked each other, played as speech over the town.
 *
 * WHY IT IS HERE. The founder's ask (2026-09-24): when your agent goes out -- "Send my
 * agent out", or one of the day's visits -- let the two agents ask each other the same
 * questions and answer only from what their person said. The meeting itself happens on
 * the server in a moment and calls no model; this plays it back, a bubble at a time,
 * from the card the round just wrote.
 *
 * NOTHING HERE IS MADE UP. Every bubble is one of the card's own lines
 * (features/matches/exchange.ts): a question from the fixed bank, a sentence the person
 * typed (drawn in quotation marks, the only thing that is), a fixed reaction, or "I
 * don't know" -- and at the end the agents' date idea, a suggestion the server checked
 * says nothing about anybody. The card comes from /v1/matches, so the reveal rule is
 * applied before anything reaches the town: a card this person may not read yet is
 * plain, and plays nothing.
 */
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { Look } from '@clone/shared';
import { Bubble, Button, Surface, radius, space, type, usePalette } from '../../components/ui';
import { CharacterAvatar } from '../look/character-avatar';
import { onScreen, type Bubble as Speech } from '../matches/exchange';

/** Long enough to read a sentence; the whole of three questions is under twenty seconds. */
export const BUBBLE_MS = 1_800;

export function ExchangeStrip({ bubbles, you, them, practice, talking, onSeeCard, onClose }: {
  bubbles: readonly Speech[];
  /** The agents talked (talk.ts); false when this is the answer-sheet exchange. */
  talking: boolean;
  /** Your character, beside your agent's bubbles. */
  you: Look;
  /** Theirs, from the card. Absent on an older server: no face, the bubbles still play. */
  them?: Look;
  /** An invented profile: said above the bubbles, before anybody reads them as a person. */
  practice: boolean;
  onSeeCard: () => void;
  onClose: () => void;
}) {
  const p = usePalette();
  const [shown, setShown] = useState(1);
  useEffect(() => { setShown(1); }, [bubbles]);
  useEffect(() => {
    if (shown >= bubbles.length) return;
    const t = setTimeout(() => setShown((n) => n + 1), BUBBLE_MS);
    return () => clearTimeout(t);
  }, [shown, bubbles.length]);
  const done = shown >= bubbles.length;

  return (
    <Surface radius={radius.lg} style={{ padding: space.md, gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={[type.label, { color: p.textSecondary, flex: 1 }]} numberOfLines={1}>
          {practice ? 'PRACTICE — NOT A REAL PERSON' : talking ? 'WHAT YOUR AGENTS SAID' : 'YOUR AGENTS ASKED EACH OTHER'}
        </Text>
        <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
          <Text style={[type.callout, { color: p.textTertiary }]}>Close</Text>
        </Pressable>
      </View>
      {onScreen(bubbles, shown).map((b, i) => {
        if (b.kind === 'date') {
          return (
            <View key={`${shown}-${i}`} style={{ alignItems: 'center', gap: space.xs, paddingVertical: space.xs }}>
              <Text style={[type.label, { color: p.textSecondary }]}>DATE IDEA</Text>
              <Text style={[type.bodyStrong, { color: p.text, textAlign: 'center' }]}>{b.text}</Text>
            </View>
          );
        }
        const look = b.who === 'you' ? you : them;
        // A person's own sentence is the one thing drawn as a quotation.
        const text = b.kind === 'words' ? `“${b.text}”` : b.text;
        return (
          <View key={`${shown}-${i}`}
                style={{ flexDirection: b.who === 'you' ? 'row-reverse' : 'row', alignItems: 'flex-end', gap: space.xs }}>
            {look ? <CharacterAvatar look={look} size={28} /> : null}
            <View style={{ flex: 1 }}>
              <Bubble text={text} mine={b.who === 'you'} />
            </View>
          </View>
        );
      })}
      {done && <Button label="See the card" variant="primary" onPress={onSeeCard} />}
    </Surface>
  );
}
