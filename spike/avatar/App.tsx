import { Canvas } from '@react-three/fiber/native';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Scene, type Stats } from './src/Scene';
import { PRESETS, type Preset } from './src/synthetic';

const VERDICT = (s: Stats | null): { label: string; colour: string; note: string } => {
  if (!s || s.elapsed < 3) return { label: 'measuring…', colour: '#888', note: '' };
  const drop = s.earlyFps > 0 ? (s.earlyFps - s.lateFps) / s.earlyFps : 0;
  if (s.lateFps >= 55) {
    return drop > 0.15
      ? { label: 'PASS, throttling', colour: '#d9a441', note: `${Math.round(drop * 100)}% fps lost since start` }
      : { label: 'PASS', colour: '#4ac07a', note: 'holds 60fps sustained' };
  }
  if (s.lateFps >= 28) {
    return { label: 'MARGINAL', colour: '#d9a441', note: 'ok at 30fps, not 60' };
  }
  return { label: 'FAIL', colour: '#e0575b', note: 'below 30fps — not shippable at this budget' };
};

export default function App() {
  const [preset, setPreset] = useState<Preset>(PRESETS[1] as Preset);
  const [stats, setStats] = useState<Stats | null>(null);
  const [speaking, setSpeaking] = useState(true);
  const [thinking, setThinking] = useState(false);
  const [tracks, setTracks] = useState({ breath: true, blink: true, gaze: true, visemes: true });

  const onStats = useCallback((s: Stats) => setStats(s), []);
  const v = VERDICT(stats);

  return (
    <View style={s.root}>
      <StatusBar style="light" />
      <View style={s.canvas}>
        <Canvas
          key={preset.name}
          camera={{ position: [0, 0, 3.2], fov: 45 }}
          gl={{ antialias: false }}
        >
          <Scene
            preset={preset}
            state={{ speaking, thinking, amplitude: 0 }}
            tracks={tracks}
            onStats={onStats}
          />
        </Canvas>
      </View>

      <ScrollView style={s.panel} contentContainerStyle={{ paddingBottom: 24 }}>
        <View style={[s.verdict, { borderColor: v.colour }]}>
          <Text style={[s.verdictText, { color: v.colour }]}>{v.label}</Text>
          {!!v.note && <Text style={s.verdictNote}>{v.note}</Text>}
        </View>

        <Row k="fps (now)" val={stats ? stats.fps.toFixed(1) : '—'} />
        <Row k="fps first 5s → recent" val={stats ? `${stats.earlyFps.toFixed(0)} → ${stats.lateFps.toFixed(0)}` : '—'} />
        <Row k="frame p50 / p95" val={stats ? `${stats.p50.toFixed(1)} / ${stats.p95.toFixed(1)} ms` : '—'} />
        <Row k="worst frame" val={stats ? `${stats.worst.toFixed(0)} ms` : '—'} />
        <Row k="triangles" val={stats ? stats.triangles.toLocaleString() : '—'} />
        <Row k="vertices × morphs" val={stats ? `${stats.vertices.toLocaleString()} × ${stats.morphs}` : '—'} />
        <Row k="draw calls" val={stats ? String(stats.drawCalls) : '—'} />
        <Row k="elapsed" val={stats ? `${stats.elapsed.toFixed(0)}s` : '—'} />

        <Text style={s.h}>budget</Text>
        <View style={s.row}>
          {PRESETS.map((p) => (
            <Chip key={p.name} on={preset.name === p.name} label={`${p.name}\n${p.morphs} morphs`}
              onPress={() => { setStats(null); setPreset(p); }} />
          ))}
        </View>

        <Text style={s.h}>state</Text>
        <View style={s.row}>
          <Chip on={speaking} label="speaking" onPress={() => setSpeaking((x) => !x)} />
          <Chip on={thinking} label="thinking" onPress={() => setThinking((x) => !x)} />
        </View>

        <Text style={s.h}>tracks — turn off to find the expensive one</Text>
        <View style={s.row}>
          {(['breath', 'blink', 'gaze', 'visemes'] as const).map((t) => (
            <Chip key={t} on={tracks[t]} label={t}
              onPress={() => setTracks((x) => ({ ...x, [t]: !x[t] }))} />
          ))}
        </View>

        <Text style={s.foot}>
          Run on a PHYSICAL device, unplugged, for at least 60s. The simulator does not
          share the phone&apos;s GPU or thermal behaviour, and thermal throttling is the
          failure mode that matters for a face that is on screen all session.
        </Text>
      </ScrollView>
    </View>
  );
}

function Row({ k, val }: { k: string; val: string }) {
  return (
    <View style={s.statRow}>
      <Text style={s.k}>{k}</Text>
      <Text style={s.v}>{val}</Text>
    </View>
  );
}

function Chip({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, on && s.chipOn]}>
      <Text style={[s.chipText, on && s.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0b0f' },
  canvas: { height: '46%' },
  panel: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
  verdict: { borderWidth: 1.5, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, marginBottom: 14 },
  verdictText: { fontSize: 20, fontWeight: '700', letterSpacing: 0.5 },
  verdictNote: { color: '#9a9aa8', fontSize: 13, marginTop: 2 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  k: { color: '#8b8b99', fontSize: 13 },
  v: { color: '#e8e8f0', fontSize: 13, fontVariant: ['tabular-nums'], fontWeight: '600' },
  h: { color: '#6f6f80', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginTop: 18, marginBottom: 6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#2a2a36', borderRadius: 8, paddingVertical: 7, paddingHorizontal: 12 },
  chipOn: { backgroundColor: '#2d5bd7', borderColor: '#2d5bd7' },
  chipText: { color: '#8b8b99', fontSize: 12 },
  chipTextOn: { color: '#fff', fontWeight: '600' },
  foot: { color: '#5c5c68', fontSize: 11, lineHeight: 16, marginTop: 20 },
});
