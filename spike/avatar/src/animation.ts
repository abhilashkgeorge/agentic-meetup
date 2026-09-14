/**
 * The four aliveness tracks. This is not benchmark scaffolding -- it is the code we
 * would ship, exercised at full cost so the measurement is honest.
 *
 * Everything here runs locally from local signals. No track requires a network call,
 * so the marginal cost of the avatar being alive is zero.
 */
import * as THREE from 'three';

export interface RigState {
  /** Model is generating. Drives gaze aversion, which is what makes latency read
   *  as thought rather than lag -- the single best UX trade in the feature. */
  thinking: boolean;
  /** TTS is producing audio. Drives the mouth. */
  speaking: boolean;
  /** 0..1 short-term audio envelope, if available. Drives jaw as a second channel. */
  amplitude: number;
}

/** ARKit-ish slots. On a real avatar these resolve by NAME from morphTargetDictionary. */
export interface MorphSlots {
  eyeBlinkLeft: number;
  eyeBlinkRight: number;
  jawOpen: number;
  /** Viseme morph indices, in mouth-shape order. */
  visemes: number[];
  browInnerUp: number;
  mouthSmile: number;
}

/**
 * Resolve slots by name on a real avatar, or fall back to positional indices on the
 * synthetic mesh. Real Avaturn / Ready Player Me rigs expose ARKit names plus Oculus
 * visemes, so the named path is what production uses.
 */
export function resolveSlots(dict: Record<string, number> | undefined, total: number): MorphSlots {
  const at = (name: string, fallback: number): number =>
    dict && name in dict ? (dict[name] as number) : Math.min(fallback, total - 1);

  const visemeNames = [
    'viseme_sil', 'viseme_PP', 'viseme_FF', 'viseme_TH', 'viseme_DD', 'viseme_kk',
    'viseme_CH', 'viseme_SS', 'viseme_nn', 'viseme_RR', 'viseme_aa', 'viseme_E',
    'viseme_I', 'viseme_O', 'viseme_U',
  ];
  const visemes = visemeNames.map((n, i) => at(n, (i + 6) % total));

  return {
    eyeBlinkLeft: at('eyeBlinkLeft', 0),
    eyeBlinkRight: at('eyeBlinkRight', 1),
    jawOpen: at('jawOpen', 2),
    browInnerUp: at('browInnerUp', 3),
    mouthSmile: at('mouthSmileLeft', 4),
    visemes,
  };
}

/** Crude grapheme -> viseme map. Replaced by real viseme events if we ever pay for
 *  cloud TTS; good enough when driven by platform TTS word-range callbacks. */
const GRAPHEME_VISEME: Record<string, number> = {
  a: 10, e: 11, i: 12, o: 13, u: 14,
  p: 1, b: 1, m: 1,
  f: 2, v: 2,
  t: 4, d: 4, n: 8, l: 8,
  k: 5, g: 5,
  c: 6, j: 6,
  s: 7, z: 7, x: 7,
  r: 9, w: 14, y: 12, h: 10, q: 5,
};

export class AliveRig {
  private t = 0;
  private nextBlinkAt = 1.5;
  private blinkPhase = -1;      // -1 = not blinking, else 0..1 progress
  private doubleBlink = false;

  private gazeTarget = new THREE.Vector2(0, 0);
  private gazeCurrent = new THREE.Vector2(0, 0);
  private nextSaccadeAt = 2;

  private visemeTarget = new Float32Array(16);
  private visemeCurrent = new Float32Array(16);
  private mouthQueue: { viseme: number; at: number }[] = [];

  constructor(
    private readonly mesh: THREE.SkinnedMesh,
    private readonly headBone: THREE.Bone,
    private readonly rootBone: THREE.Bone,
    private readonly slots: MorphSlots,
    /** Seeded so successive benchmark runs are comparable. */
    private seed = 7,
  ) {}

  private rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 0x100000000;
  }

  /**
   * Queue a spoken word. In production this is called from the platform TTS range
   * callback: iOS willSpeakRangeOfSpeechString, Android onRangeStart. Both give the
   * character range of the word about to be spoken, which is all we need -- and it
   * is free, unlike cloud TTS viseme events.
   */
  speakWord(word: string, startAt: number, durationSec: number): void {
    const letters = word.toLowerCase().replace(/[^a-z]/g, '');
    if (!letters.length) return;
    const step = durationSec / letters.length;
    for (let i = 0; i < letters.length; i++) {
      const v = GRAPHEME_VISEME[letters[i] as string];
      if (v !== undefined) this.mouthQueue.push({ viseme: v, at: startAt + i * step });
    }
  }

  update(dt: number, state: RigState): void {
    this.t += dt;
    const infl = this.mesh.morphTargetInfluences;
    if (!infl) return;

    // --- 1. BREATH. Always on. Perfect stillness is the single biggest tell that
    // something is dead, so this track never stops, not even mid-sentence.
    const breath = Math.sin(this.t * Math.PI * 2 * 0.25); // ~15 breaths/min
    this.rootBone.position.y = breath * 0.012;
    this.rootBone.scale.setScalar(1 + breath * 0.004);
    // Slow weight shift on a different period so the two never visibly sync up.
    this.rootBone.rotation.z = Math.sin(this.t * 0.13) * 0.02;

    // --- 2. BLINK. Stochastic 2-6s with occasional doubles. Cheapest large gain in
    // perceived life anywhere in this file.
    if (this.blinkPhase < 0 && this.t >= this.nextBlinkAt) {
      this.blinkPhase = 0;
      this.doubleBlink = this.rand() < 0.2;
    }
    if (this.blinkPhase >= 0) {
      this.blinkPhase += dt / 0.12; // 120ms close+open
      const p = this.blinkPhase;
      const v = p < 1 ? Math.sin(p * Math.PI) : 0;
      infl[this.slots.eyeBlinkLeft] = v;
      infl[this.slots.eyeBlinkRight] = v;
      if (p >= 1) {
        this.blinkPhase = -1;
        this.nextBlinkAt = this.t + (this.doubleBlink ? 0.18 : 2 + this.rand() * 4);
        this.doubleBlink = false;
      }
    }

    // --- 3. GAZE. Toward the viewer while speaking; away while thinking.
    // Aversion during generation is what turns model latency into characterisation.
    if (this.t >= this.nextSaccadeAt) {
      if (state.thinking) {
        // Look up and off to one side: the universal "working on it" tell.
        this.gazeTarget.set((this.rand() - 0.5) * 0.5, 0.12 + this.rand() * 0.18);
        this.nextSaccadeAt = this.t + 0.5 + this.rand() * 1.2;
      } else if (state.speaking) {
        // Small drift around the viewer, with brief breaks -- unbroken eye contact
        // reads as a stare, not attention.
        this.gazeTarget.set((this.rand() - 0.5) * 0.12, (this.rand() - 0.5) * 0.08);
        this.nextSaccadeAt = this.t + 1.5 + this.rand() * 2;
      } else {
        this.gazeTarget.set((this.rand() - 0.5) * 0.3, (this.rand() - 0.5) * 0.15);
        this.nextSaccadeAt = this.t + 2 + this.rand() * 3;
      }
    }
    // Saccades are fast, drift is slow: lerp hard toward the target.
    this.gazeCurrent.lerp(this.gazeTarget, Math.min(1, dt * 12));
    this.headBone.rotation.y = this.gazeCurrent.x;
    this.headBone.rotation.x = -this.gazeCurrent.y;
    infl[this.slots.browInnerUp] = state.thinking ? 0.25 : 0;

    // --- 4. VISEMES. The mouth.
    this.visemeTarget.fill(0);
    if (state.speaking) {
      // Consume any queued phoneme whose time has come; hold the most recent.
      let active = -1;
      while (this.mouthQueue.length && this.mouthQueue[0]!.at <= this.t) {
        active = this.mouthQueue.shift()!.viseme;
      }
      if (active >= 0) this.visemeTarget[active] = 1;
      // Amplitude as a second, independent channel: keeps the jaw moving between
      // phoneme events so the mouth never freezes mid-word.
      infl[this.slots.jawOpen] = Math.min(0.7, state.amplitude * 0.7);
    } else {
      infl[this.slots.jawOpen] = 0;
      this.mouthQueue.length = 0;
    }

    // Coarticulation: ease toward the target instead of snapping. Snapping is what
    // makes cheap lip sync look like a puppet.
    for (let i = 0; i < this.visemeTarget.length; i++) {
      const cur = this.visemeCurrent[i] as number;
      const tgt = this.visemeTarget[i] as number;
      const next = cur + (tgt - cur) * Math.min(1, dt * 18);
      this.visemeCurrent[i] = next;
      const slot = this.slots.visemes[i];
      if (slot !== undefined) infl[slot] = next;
    }
  }
}
