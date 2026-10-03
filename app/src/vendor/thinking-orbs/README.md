# thinking-orbs (geometry only)

The dotted thought-orbs the app shows while something loads, from
[thinking-orbs](https://github.com/Jakubantalik/thinking-orbs) by Jakub Antalik,
MIT licence (`LICENSE`, kept as shipped). Copied from commit `de85557` (npm 0.3.2),
`src/engine/*` and `src/presets.ts`, on 2026-10-03, at the founder's request.

What was left out: the 2D-canvas painters (`paint`, `paintLines`, `paintFrame`,
`MODE_DRAWS`, `ModeDraw`) and the web React component -- the app draws the frames
itself with GL (`components/ui/orb-gl.tsx`), as the package's own React Native port
does with Skia. Nothing in the geometry was changed; `presets.ts` defines `OrbState`
and `OrbSize` itself instead of importing the web component's types.

Why copied, not installed: the package's React Native port is unpublished and needs
Skia, a ~2 GB native install the laptop had no room for; the geometry is 26 KB of math.
To update, copy the same files from a newer commit and run the app's orb tests.
