# Avatar spike

**Question:** can react-three-fiber on expo-gl render a rigged, blendshape-driven
talking head at a sustained frame rate on a real phone — and how much headroom is
there before it falls over?

This is a go/no-go for the 3D clone on the home screen. It is throwaway code except
for `src/animation.ts`, which is the real aliveness rig and ships as-is.

## Run it

Needs a **development build** — Expo Go cannot load `expo-gl`'s native code.

```bash
npm install
npx expo run:ios --device      # or: npx expo run:android --device
```

**Physical device, unplugged, at least 60 seconds.** The simulator does not share the
phone's GPU or its thermal behaviour, and thermal throttling is the failure mode that
actually matters here: the avatar is on screen for the whole session, not for a
5-second benchmark.

## RESULT (2026-09-08, iPhone / iOS 18.7.9, Release build)

**PASS — holds 60fps sustained at `high` (51k triangles, 52 morph targets).**

No thermal collapse observed over the run. `med` and `high` both carry 52 morphs by
design — the real ARKit set — and differ only in triangle budget, so passing at `high`
is the honest proxy for a shipped `med` avatar once hair, eyes, teeth and PBR maps are
added on top.

**Verdict: build the 3D avatar.** The renderer is not the constraint.

Measured in a RELEASE build, deliberately. A Debug build carries dev-mode overhead and
would have understated fps -- risking a confidently wrong "too slow" conclusion.

Still unmeasured: worst-frame spikes over a long session, and battery drain over 10+
minutes of sustained animation. Worth capturing during real app development rather
than re-running the spike.

## What to report back

The panel shows a verdict plus the numbers behind it. Tell me:

1. **fps first 5s → recent**, on `med` and on `high`. The gap is throttling.
2. Does `med` hold ≥55 sustained? `med` is 52 morph targets, which is the real ARKit
   count, at roughly a realistic head's triangle budget.
3. **worst frame** — a spike over ~100ms is a visible hitch, and on a face people
   notice hitches they would never notice on a scrolling list.
4. Whether the phone gets hot, and roughly what battery drains over 10 minutes.
5. Turn tracks off one at a time. If `visemes` is the expensive one, morph influence
   upload is the bottleneck and the fix is fewer, better-chosen blendshapes rather
   than a different renderer.

## What this does and does not prove

**Proven already, without hardware:** the toolchain builds. r3f 9.7 + three 0.185 +
expo-gl 57 on RN 0.86.3 with the new architecture bundles clean (630 modules).

**Still unproven:** that `expo-gl` initialises and renders correctly under the new
architecture at runtime, and sustained on-device performance. Bundling is not running.

**The mesh is synthetic** — parametrised so we can find the cliff rather than measure
one arbitrary avatar. It reproduces the real per-frame cost drivers: GPU skinning,
N morph targets with influences changing every frame, a textured PBR material. It does
**not** reproduce hair with alpha blending (overdraw), multiple draw calls for eyes and
teeth, or full PBR map sets. Expect a real avatar to cost somewhat more at equal
triangle count, so treat `high` as the honest proxy for a shipped `med` avatar.

## Presets

| preset | triangles (approx) | morphs | stands for |
|---|---|---|---|
| low | ~4.6k | 16 | stylised, visemes only |
| med | ~18k | 52 | full ARKit set, realistic head budget |
| high | ~51k | 52 | detailed avatar, or a proxy for med-with-hair |
| ultra | ~115k | 67 | ARKit + Oculus visemes, deliberately past the point |

## If it fails

In order of preference:
1. **Fewer blendshapes.** 52 is the ARKit set; a talking head needs maybe 20 (visemes,
   blink, brows, a smile). Morph influence upload scales with the count.
2. **Lower the triangle budget** and lean on normal maps.
3. **Drop to 30fps deliberately** and spend the headroom on smoothness. A face at a
   steady 30 reads better than one oscillating between 45 and 60.
4. **`react-native-filament`** — a different renderer (Google Filament) with a native
   RN binding, rather than WebGL through expo-gl. Bigger change, better ceiling.
5. Static portrait with a subtle 2D parallax/blink layer. Cheap, and still far better
   than a still photo.
