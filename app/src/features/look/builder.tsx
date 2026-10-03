/**
 * The builder: your character at the top, and under it what you are changing, one
 * tab at a time.
 *
 * WHAT IT FIXES (the founder, 2026-09-29: "the UX looks confusing ... why do we have
 * an option called colour, how does the user know what it changes"). It was two rails
 * of round icons laid over the character -- eleven parts down the left, their choices
 * down the right, one of the parts called "Colour" -- and nothing said which part a
 * colour coloured or why picking a top changed the trousers. Now:
 *   - seven tabs in the order people dress (Body, Face, Hair, Top, Bottoms, Shoes,
 *     Extras), each a few titled rows;
 *   - every colour is a row right under what it colours, named for it ("Top colour");
 *   - the camera goes to what you are changing: the face for hair, the feet for shoes;
 *   - when a pick changes something else (a top brings its own trousers, `fitted`),
 *     a line says what changed and why;
 *   - the choice you make springs into place, the character bounces into its new
 *     clothes (character-canvas.tsx), and a tab's rows slide in.
 * What rows there are and what they offer is builder-model.ts, tested on its own.
 *
 * A locked item can be worn in the preview and says what it costs; Save waits until
 * everything worn is owned, and the server says the same (402), so nothing here is the
 * last line.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Pressable, ScrollView, Text, View } from 'react-native';
import { itemAt, lockedIn, starterLookFor, type Look, type LookPart } from '@clone/shared';
import { useSession } from '../../store/session';
import {
  Button, LoadFailed, Loading, radius, raised, space, sunk, type, usePalette,
} from '../../components/ui';
import type { Focus } from '../world/framing';
import { CharacterAvatar } from './character-avatar';
import { PieceThumb } from './piece-thumb';
import { choicesFor, labelOf, otherFigureFrom, pick, swatchOf, tabsFor, type Row, type Tab } from './builder-model';
import { isPictured } from './thumb-sheet';
import { useLook } from './store';

/** How tall the character stands when the page scrolls (onboarding). */
const STAGE = 340;
/** How tall the rows are when the character takes the rest of the screen. */
const PANEL = 250;
const PICTURE = 60;
const SWATCH = 36;

export function CharacterBuilder({
  onSaved,
  onSkip,
  preview,
  fill = false,
}: {
  onSaved: (first: boolean) => void;
  /** Onboarding only: a way past without saving. */
  onSkip?: () => void;
  /** The 3D preview, pointed at what is being changed; the flat avatar without one. */
  preview?: (focus: Focus) => ReactNode;
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
  const loaded = useLook((s) => s.loaded);
  const loadFailed = useLook((s) => s.failed);

  // The beard row comes and goes with the face, so the tabs follow the face.
  const tabs = useMemo(() => tabsFor(look), [look]);
  const [tabKey, setTabKey] = useState<Tab['key']>('body');
  const tab = tabs.find((t) => t.key === tabKey) ?? tabs[0]!;
  const [focus, setFocus] = useState<Focus>('body');
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = useMemo(() => lockedIn(look, owned), [look, owned]);

  // A tab's rows slide in from the side they come from.
  const slide = useRef(new Animated.Value(0)).current;
  const order = tabs.findIndex((t) => t.key === tabKey);
  const lastOrder = useRef(order);
  const openTab = useCallback((t: Tab) => {
    const from = tabs.findIndex((x) => x.key === t.key) >= lastOrder.current ? 1 : -1;
    lastOrder.current = tabs.findIndex((x) => x.key === t.key);
    setTabKey(t.key);
    setFocus(t.rows[0]!.focus);
    setNote(null);
    slide.setValue(from);
    Animated.timing(slide, { toValue: 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [tabs, slide]);

  const choose = useCallback((row: Row, index: number) => {
    setError(null);
    const r = pick(look, row.part, index);
    setLook(r.look);
    setNote(r.note);
    setFocus(row.focus);
  }, [look, setLook]);

  // A note says its piece and goes.
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 4500);
    return () => clearTimeout(t);
  }, [note]);

  const onSave = async () => {
    if (!token || busy) return;
    setBusy(true); setError(null);
    const r = await save(token);
    setBusy(false);
    if (!r.ok) {
      setError(r.error === 'offline' ? 'Cannot reach the server.'
        : r.error === 'locked' ? 'Something you are wearing is not unlocked yet.'
        : 'That did not save. Try again.');
      return;
    }
    onSaved(r.first);
  };

  const onUnlock = async (id: string) => {
    if (!token || busy) return;
    setBusy(true); setError(null);
    const r = await buy(token, id);
    setBusy(false);
    if (!r.ok) {
      setError(r.error === 'not_enough' ? 'Not enough points yet. They come from answering after your dates.'
        : r.error === 'offline' ? 'Cannot reach the server.' : 'That did not go through. Try again.');
    }
  };

  // NOT THE DEFAULT CHARACTER WHILE YOURS IS ON ITS WAY. The builder drew the starter look,
  // nothing owned and 0 points until the saved one arrived -- and Save in that moment put the
  // starter over the character somebody had built.
  if (!loaded) {
    return (
      <View style={[{ gap: space.md }, fill && { flex: 1 }]}>
        {loadFailed ? (
          <LoadFailed what="your character" onRetry={() => {
            useLook.setState({ failed: false });
            if (token) void useLook.getState().load(token);
          }} />
        ) : (
          <Loading label="Loading your character" orb="weaving" style={fill ? { flex: 1 } : undefined} />
        )}
      </View>
    );
  }

  const first = locked[0];
  const rows = (
    <Animated.View
      style={{
        gap: space.lg,
        opacity: slide.interpolate({ inputRange: [-1, 0, 1], outputRange: [0, 1, 0] }),
        transform: [{ translateX: slide.interpolate({ inputRange: [-1, 1], outputRange: [-28, 28] }) }],
      }}
    >
      {tab.rows.map((row) => (
        <ChoiceRow key={`${tab.key}:${row.part}`} row={row} look={look} owned={owned} onPick={choose} />
      ))}
    </Animated.View>
  );

  return (
    <View style={[{ gap: space.md }, fill && { flex: 1 }]}>
      <View style={fill ? { flex: 1, minHeight: 240 } : { height: STAGE }}>
        {preview ? preview(focus) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <CharacterAvatar look={look} size={200} />
          </View>
        )}
        <Note text={note} />
      </View>

      {/* ALL SEVEN IN VIEW, sharing the width. As a strip that scrolled, the last tab
          was cut off at the edge of the phone and nothing said there was more. */}
      <View style={{ flexDirection: 'row', gap: 4, paddingVertical: space.xs }}>
        {tabs.map((t) => (
          <TabPill key={t.key} label={t.label} on={t.key === tab.key} onPress={() => openTab(t)} />
        ))}
      </View>

      {fill ? (
        <ScrollView style={{ height: PANEL, flexGrow: 0 }} contentContainerStyle={{ paddingBottom: space.sm }}
                    showsVerticalScrollIndicator={false}>
          {rows}
        </ScrollView>
      ) : rows}

      {/* Wearing something not yet theirs: one line saying what and what it costs, and
          the Save button becomes the way to unlock it -- one button, in one place, so
          the character does not jump up the screen for a second one. */}
      {first && (
        <Text style={[type.callout, { color: p.textSecondary }]} numberOfLines={2}>
          {`${first.label} costs ${first.cost} points. You have ${balance}.${locked.length > 1 ? ` ${locked.length - 1} more to unlock after.` : ''}`}
        </Text>
      )}
      {error && <Text style={[type.callout, { color: p.danger }]}>{error}</Text>}

      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Button label="Surprise me" variant="ghost"
                  onPress={() => { setError(null); setNote(null); setLook(starterLookFor(Date.now() & 0x7fffffff)); }} />
        </View>
        {onSkip && (
          <View style={{ flex: 1 }}>
            <Button label="Skip for now" variant="ghost" onPress={onSkip} />
          </View>
        )}
        <View style={{ flex: 1.4 }}>
          {first ? (
            <Button label={balance >= first.cost ? `Unlock for ${first.cost}` : `${first.cost - balance} more points`}
                    variant="primary" disabled={balance < first.cost || busy} loading={busy}
                    onPress={() => void onUnlock(first.id)} />
          ) : (
            <Button label="Save" variant="primary" onPress={() => void onSave()} disabled={busy} loading={busy} />
          )}
        </View>
      </View>
    </View>
  );
}

/** One tab: sunken when open, like every chosen thing in the app, with a little give. */
function TabPill({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const p = usePalette();
  const press = useRef(new Animated.Value(1)).current;
  return (
    <Pressable
      style={{ flex: 1 }}
      onPress={onPress}
      onPressIn={() => Animated.spring(press, { toValue: 0.94, useNativeDriver: true, speed: 40 }).start()}
      onPressOut={() => Animated.spring(press, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 8 }).start()}
      accessibilityRole="tab"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
    >
      <Animated.View style={{
        transform: [{ scale: press }], alignItems: 'center',
        paddingHorizontal: 2, paddingVertical: space.sm, borderRadius: radius.pill,
        backgroundColor: on ? p.sunken : p.bg, boxShadow: on ? sunk(p, 3) : raised(p, 3),
      }}>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}
              style={[type.callout, { fontSize: 13, color: on ? p.accent : p.textSecondary, fontFamily: type.bodyStrong.fontFamily }]}>
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

/**
 * One row: its title, what is chosen now, and the choices -- pictures, swatches or
 * words -- in one line that scrolls sideways, opened at what they are wearing.
 */
const ChoiceRow = memo(function ChoiceRow({ row, look, owned, onPick }: {
  row: Row;
  look: Look;
  owned: ReadonlySet<string>;
  onPick: (row: Row, index: number) => void;
}) {
  const p = usePalette();
  const choices = choicesFor(row.part, look);
  const split = otherFigureFrom(row.part, look);
  const chosen = look[row.part];
  const scroller = useRef<ScrollView>(null);
  const placed = useRef(false);
  const onChosenLayout = (x: number) => {
    if (placed.current) return;
    placed.current = true;
    if (x > 200) scroller.current?.scrollTo({ x: x - 60, animated: false });
  };
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text style={[type.label, { color: p.textSecondary }]}>{row.title.toUpperCase()}</Text>
        <Text style={[type.callout, { color: p.text }]} numberOfLines={1}>{labelOf(row.part, chosen, look)}</Text>
      </View>
      <ScrollView ref={scroller} horizontal showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: space.sm, paddingVertical: space.xs, paddingHorizontal: 2, alignItems: 'center' }}>
        {choices.map((i, k) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}
                onLayout={i === chosen ? (e) => onChosenLayout(e.nativeEvent.layout.x) : undefined}>
            {split !== null && k === split && k > 0 && (
              <View style={{ width: 1, height: PICTURE * 0.6, backgroundColor: p.textTertiary, opacity: 0.4 }} />
            )}
            <Choice part={row.part} kind={row.kind} index={i} selected={i === chosen} label={labelOf(row.part, i, look)}
                    locked={!owned.has(itemAt(row.part, i).id) && itemAt(row.part, i).cost > 0}
                    onPress={() => onPick(row, i)} />
          </View>
        ))}
      </ScrollView>
    </View>
  );
});

/** One choice. It springs up when chosen; a locked one says its price. */
const Choice = memo(function Choice({ part, kind, index, selected, label, locked, onPress }: {
  part: LookPart;
  kind: Row['kind'];
  index: number;
  selected: boolean;
  label: string;
  locked: boolean;
  onPress: () => void;
}) {
  const p = usePalette();
  const on = useRef(new Animated.Value(selected ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(on, { toValue: selected ? 1 : 0, useNativeDriver: true, speed: 18, bounciness: 10 }).start();
  }, [selected, on]);
  const item = itemAt(part, index);
  const colour = kind === 'swatches' ? swatchOf(part, index) : null;
  // "None" of what is worn on top, and "As made" of a colour, are words: there is
  // nothing to draw.
  const picture = kind === 'pictures' && isPictured(part) && !(index === 0 && ['hat', 'glasses', 'earrings', 'neck', 'bag'].includes(part));
  const scale = on.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });

  const well = picture ? PICTURE : kind === 'swatches' && colour ? SWATCH : undefined;
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }}
               accessibilityLabel={`${label}${locked ? `, ${item.cost} points` : ''}`}>
      <Animated.View style={{ alignItems: 'center', gap: 3, transform: [{ scale }] }}>
        {well !== undefined ? (
          <View style={{
            width: well + 6, height: well + 6, borderRadius: (well + 6) / 2, alignItems: 'center', justifyContent: 'center',
            borderWidth: 2, borderColor: selected ? p.accent : 'transparent',
          }}>
            <View style={{
              width: well, height: well, borderRadius: well / 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
              backgroundColor: colour ?? (selected ? p.sunken : p.bg), boxShadow: colour ? undefined : selected ? sunk(p, 3) : raised(p, 3),
              opacity: locked ? 0.6 : 1,
            }}>
              {picture && <PieceThumb part={part as Parameters<typeof PieceThumb>[0]['part']} index={index} size={well} />}
            </View>
            {picture && locked && (
              <View style={{
                position: 'absolute', top: -2, right: -4, paddingHorizontal: 5, paddingVertical: 1, borderRadius: radius.pill,
                backgroundColor: p.bg, boxShadow: raised(p, 2),
              }}>
                <Text style={[type.label, { fontSize: 9, letterSpacing: 0.2, color: p.textSecondary }]}>{item.cost}</Text>
              </View>
            )}
          </View>
        ) : (
          <View style={{
            minHeight: 40, justifyContent: 'center', paddingHorizontal: space.md, borderRadius: radius.pill,
            backgroundColor: selected ? p.sunken : p.bg, boxShadow: selected ? sunk(p, 3) : raised(p, 3),
            borderWidth: 2, borderColor: selected ? p.accent : 'transparent', opacity: locked ? 0.6 : 1,
          }}>
            <Text style={[type.callout, { color: selected ? p.accent : p.textSecondary, fontFamily: type.bodyStrong.fontFamily }]}
                  numberOfLines={1}>
              {label}
            </Text>
          </View>
        )}
        {picture && (
          <Text style={[type.label, { fontSize: 10, letterSpacing: 0.3, color: selected ? p.accent : p.textTertiary, maxWidth: PICTURE + 6 }]}
                numberOfLines={1}>
            {label}
          </Text>
        )}
        {!picture && locked && (
          <Text style={[type.label, { fontSize: 10, letterSpacing: 0.3, color: p.textTertiary }]}>{`${item.cost} pts`}</Text>
        )}
      </Animated.View>
    </Pressable>
  );
});

/** What a pick changed besides itself, over the character, for a few seconds. */
function Note({ text }: { text: string | null }) {
  const p = usePalette();
  const shown = useRef(new Animated.Value(0)).current;
  const [last, setLast] = useState(text);
  useEffect(() => {
    if (text) setLast(text);
    Animated.timing(shown, { toValue: text ? 1 : 0, duration: 200, useNativeDriver: true }).start();
  }, [text, shown]);
  return (
    <Animated.View pointerEvents="none" style={{
      position: 'absolute', left: space.sm, right: space.sm, bottom: space.sm, alignItems: 'center',
      opacity: shown, transform: [{ translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
    }}>
      {last && (
        <View style={{ paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.md, backgroundColor: p.bg, boxShadow: raised(p, 4) }}>
          <Text style={[type.callout, { color: p.text, textAlign: 'center' }]}>{last}</Text>
        </View>
      )}
    </Animated.View>
  );
}
