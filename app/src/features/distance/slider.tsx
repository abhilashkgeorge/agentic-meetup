/**
 * A slider: a track and a thumb, dragged or tapped, 0..1. Plain React Native -- the app has
 * no slider module, and a native one would mean a new build for one control.
 *
 * It holds a drag it starts: inside a scrolling screen a sideways drag would otherwise be
 * taken by the scroll view half way, and the thumb would stop under the finger.
 */
import { useMemo, useRef, useState } from 'react';
import { PanResponder, View, type LayoutChangeEvent } from 'react-native';
import { raised, usePalette } from '../../components/ui';

const THUMB = 28;

export function Slider({ value, onChange, onDone, disabled, label, valueText, step = 0.05 }: {
  /** 0..1. */
  value: number;
  onChange: (v: number) => void;
  /** When the finger lifts: where to save, or zoom the map to. */
  onDone?: (v: number) => void;
  disabled?: boolean;
  /** Spoken name, and the value said as words ("25 km"). */
  label: string;
  valueText: string;
  /** How far one "increase" from a screen reader moves it. */
  step?: number;
}) {
  const p = usePalette();
  const [width, setWidth] = useState(0);
  const start = useRef(0);
  const last = useRef(value);
  last.current = value;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !disabled,
    onStartShouldSetPanResponderCapture: () => !disabled,
    onMoveShouldSetPanResponderCapture: () => !disabled,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => {
      if (!width) return;
      start.current = clamp((e.nativeEvent.locationX - THUMB / 2) / Math.max(1, width - THUMB));
      onChange(start.current);
    },
    onPanResponderMove: (_e, g) => {
      if (!width) return;
      onChange(clamp(start.current + g.dx / Math.max(1, width - THUMB)));
    },
    onPanResponderRelease: () => onDone?.(last.current),
    onPanResponderTerminate: () => onDone?.(last.current),
  }), [width, disabled, onChange, onDone]);

  const left = clamp(value) * Math.max(0, width - THUMB);
  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: valueText }}
      accessibilityState={{ disabled: !!disabled }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        const next = clamp(value + (e.nativeEvent.actionName === 'increment' ? step : -step));
        onChange(next);
        onDone?.(next);
      }}
      style={{ height: 44, justifyContent: 'center', opacity: disabled ? 0.4 : 1 }}
      {...responder.panHandlers}
    >
      <View style={{ height: 6, borderRadius: 3, backgroundColor: p.sunken, marginHorizontal: THUMB / 2 }}>
        <View style={{ width: left, height: 6, borderRadius: 3, backgroundColor: p.accent }} />
      </View>
      <View pointerEvents="none" style={{
        position: 'absolute', left, width: THUMB, height: THUMB, borderRadius: THUMB / 2,
        backgroundColor: p.bg, borderWidth: 3, borderColor: p.accent, boxShadow: raised(p, 3),
      }} />
    </View>
  );
}
