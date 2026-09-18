/**
 * Does the town run on this phone?
 *
 * The avatar spike proved react-three-fiber on expo-gl holds 60 fps on an iPhone, in a
 * Release build, unplugged. It never ran on Android, and the founder's phone is an
 * Android. So before a single town screen is built, this measures the real scene --
 * instanced agents, bubbles, props -- at three sizes, two pixel ratios and a 30 fps
 * cap, on the device in hand, and says PASS, MARGINAL or FAIL by the same thresholds
 * the spike used. The plan's fallback ladder hangs off that word.
 *
 * Hidden: reached by tapping the version line in Settings five times. It draws its
 * own header, so it is registered with the stack header off, and it has a way back.
 */
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { loadWorldRenderer, rendererError, type WorldRenderer } from '../world/r3f';
import { WorldSim } from '../world/sim';
import type { WorldStats } from '../world/canvas';
import {
  Card, Chip, ChipGroup, Header, Screen, StatRow, space, type, usePalette,
} from '../../components/ui';

// 64 is the canvas's instance-slot cap (SLOTS in ../world/canvas.tsx); a bigger
// number here would measure 64 and say something larger.
const SIZES = [24, 48, 64] as const;

function verdict(s: WorldStats | null): { label: string; note: string; tone: 'ok' | 'warn' | 'bad' | 'none' } {
  if (!s || s.elapsed < 3) return { label: 'Measuring…', note: 'Give it a minute, unplugged.', tone: 'none' };
  const drop = s.earlyFps > 0 ? (s.earlyFps - s.lateFps) / s.earlyFps : 0;
  if (s.lateFps >= 55) {
    return drop > 0.15
      ? { label: 'PASS, throttling', note: `${Math.round(drop * 100)}% slower than at the start`, tone: 'warn' }
      : { label: 'PASS', note: 'Holds 60 fps.', tone: 'ok' };
  }
  if (s.lateFps >= 28) return { label: 'MARGINAL', note: 'Fine at 30 fps, not 60.', tone: 'warn' };
  return { label: 'FAIL', note: 'Under 30 fps. Use the 2D town on this phone.', tone: 'bad' };
}

export default function GlBenchScreen() {
  const p = usePalette();
  const [renderer, setRenderer] = useState<WorldRenderer | null | undefined>(undefined);
  const [size, setSize] = useState<(typeof SIZES)[number]>(48);
  const [cap30, setCap30] = useState(false);
  const [stats, setStats] = useState<WorldStats | null>(null);

  useEffect(() => { void loadWorldRenderer().then(setRenderer); }, []);

  // One town per configuration; remounting the canvas resets the clocks.
  const sim = useMemo(() => {
    const s = new WorldSim(20260918);
    s.populateBench(size);
    return s;
  }, [size]);
  const onStats = useCallback((s: WorldStats) => setStats(s), []);
  const v = verdict(stats);
  const tone = v.tone === 'ok' ? p.success : v.tone === 'warn' ? p.warning : v.tone === 'bad' ? p.danger : p.textTertiary;

  const colors = useMemo(() => ({
    bg: p.bg, ground: p.sunken, prop: p.dark, you: p.accent, stranger: p.textTertiary,
    met: p.textSecondary, practice: p.textTertiary, success: p.success, danger: p.danger,
    warning: p.warning, accent: p.accent,
  }), [p]);

  return (
    <Screen scroll={false} padded={false}>
      <Header title="3D check" onBack={() => router.back()} />
      <View style={{ height: '42%' }}>
        {renderer === undefined && (
          <Text style={[type.callout, { color: p.textTertiary, padding: space.screen }]}>Loading the renderer…</Text>
        )}
        {renderer === null && (
          <View style={{ padding: space.screen, gap: space.sm }}>
            <Text style={[type.body, { color: p.danger }]}>
              The 3D renderer could not load on this build. The town will use the plain Home.
            </Text>
            <Text style={[type.callout, { color: p.textTertiary }]} selectable>{rendererError ?? ''}</Text>
          </View>
        )}
        {renderer && (
          <renderer.WorldCanvas
            key={`${size}-${cap30 ? 30 : 60}`}
            sim={sim}
            colors={colors}
            cap30={cap30}
            onStats={onStats}
          />
        )}
      </View>

      <Screen padded>
        <Card label="Verdict">
          <Text style={[type.title, { color: tone }]}>{v.label}</Text>
          <Text style={[type.callout, { color: p.textSecondary }]}>{v.note}</Text>
          <StatRow label="fps now" value={stats ? stats.fps.toFixed(1) : '—'} />
          <StatRow label="fps first 5 s → recent" value={stats ? `${stats.earlyFps.toFixed(0)} → ${stats.lateFps.toFixed(0)}` : '—'} />
          <StatRow label="frame p50 / p95" value={stats ? `${stats.p50.toFixed(1)} / ${stats.p95.toFixed(1)} ms` : '—'} />
          <StatRow label="worst frame" value={stats ? `${stats.worst.toFixed(0)} ms` : '—'} />
          <StatRow label="draw calls / triangles" value={stats ? `${stats.drawCalls} / ${stats.triangles.toLocaleString()}` : '—'} />
          <StatRow label="elapsed" value={stats ? `${stats.elapsed.toFixed(0)} s` : '—'} muted />
        </Card>

        <Card label="Town size">
          <ChipGroup>
            {SIZES.map((n) => (
              <Chip key={n} label={`${n} agents`} selected={size === n}
                    onPress={() => { setStats(null); setSize(n); }} />
            ))}
          </ChipGroup>
        </Card>

        <Card label="Cost knobs">
          <ChipGroup>
            <Chip label="30 fps cap" selected={cap30} onPress={() => { setStats(null); setCap30((x) => !x); }} />
          </ChipGroup>
          <Text style={[type.callout, { color: p.textTertiary }]}>
            Run unplugged for at least a minute, then put the app in the background and bring it back twice.
          </Text>
        </Card>
      </Screen>
    </Screen>
  );
}
