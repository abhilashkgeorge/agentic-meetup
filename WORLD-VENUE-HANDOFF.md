# Modern map and Cubbon Park venue handoff

Status: implemented and verified locally on 2026-09-22; committed 2026-09-25.

This is the entry document for the next agent working on the 3D world. Read it before
changing the map, camera, venue, character or GL loading paths.

## What shipped

The Home world now has two explicit realms:

1. **Bengaluru overview** — the existing bundled OSM-derived city, rendered with a
   true orthographic camera. It answers “who is where?”
2. **Cubbon Park** — a venue-local world with a perspective third-person camera,
   bounded nearby roster and bundled CC0 park furniture. It answers “what is this
   place like to walk around?”

The city and venue do not share coordinates. Cubbon Park has a marker at
`[-0.54, -0.64]` on the city map and an independent local origin after entry.

Entry is visible and named:

`city → entering → venue → leaving → city`

The Home HUD has **Visit Cubbon Park**. The map marker can also be tapped. Entry flies
the city camera to the real park point, fades through “Entering the park…”, then
switches realm and camera. The venue HUD has **Back to Bengaluru** and **Directions**;
Directions opens a Google Maps search URL and uses no paid Places API.

## Runtime architecture

### Domain

`app/src/features/world/venue.ts` owns:

- `Venue` and the single `CUBBON_PARK` record;
- city portal coordinate versus venue-local layout;
- the pure realm transition table;
- `agentsForVenue()`;
- the free Maps directions URL.

`agentsForVenue()` always includes the user, admits only agents whose city area is
MG Road (where Cubbon Park sits), prefers met people, sorts deterministically and
caps the complete venue roster at 12. Every admitted agent receives
`area: 'cubbon-park'` before entering the local simulation.

### Simulation

`app/src/features/world/world-screen.tsx` owns two `WorldSim` instances:

- the module-level city sim uses `spotsFrom(MAP)`;
- the venue sim uses `gardenSpots(venueGarden(CUBBON_PARK))`.

Server roster state still drives the city sim. The venue sim receives only
`agentsForVenue()` and removes people who no longer qualify. Server round choreography
continues in the city sim; the venue is currently a visual/social walk, not a second
matching engine.

### Rendering

`app/src/features/world/canvas.tsx` owns two camera objects:

- `THREE.OrthographicCamera` for the city;
- `THREE.PerspectiveCamera` for the venue.

The Canvas has no `camera` prop. This is important: an earlier implementation declared
a perspective camera on Canvas and r3f reapplied it after a render, undoing camera
switches. `Town` now sets the active camera only when the realm changes.
`WorldCanvas.inVenue` is controlled by `WorldScreen`, so Android GL-context remounts
return to the active venue instead of silently resetting to the city.

Map zoom keeps the existing contract: one world unit is `zoom` pixels. The pure
`orthographicBounds()` helper in `camera.ts` is the tested bridge to Three’s camera.

`map-mesh.ts` keeps the efficient OSM geometry and adds:

- rough PBR materials instead of flat Lambert city surfaces;
- instanced roof caps;
- instanced fake contact shadows instead of a real-time shadow map;
- instanced tree trunks;
- subdued daytime windows and lit evening windows;
- a merged Cubbon Park marker;
- ACES tone mapping and subtle city fog from the canvas.

Measured map geometry:

- day: **17 draw calls, 41,972 triangles**;
- evening: **17 draw calls, 47,572 triangles**.

The walkable ground remains the deterministic garden system. For Cubbon Park,
procedural benches and lamps are suppressed and `venue-mesh.ts` adds textured GLB
furniture as four instanced mesh types: benches, lamps, bins and café tables.

Measured furniture cost:

- **4 draw calls**;
- **15,364 instanced triangles**.

The rigged-character work that was already in progress remains intact. The nearest
12 people can use one-draw-call animated bodies; farther people retain the instanced
fallback figures.

## Asset provenance and rebuild

Committed venue output:

- `app/assets/venues/cubbon-park/furniture.glb` — 752,140 bytes;
- `app/assets/venues/cubbon-park/manifest.json`;
- `app/assets/venues/cubbon-park/LICENCE.txt`.

Source: **Park Furnitures by loafbrr**, published under CC0 1.0:

- page: <https://opengameart.org/content/park-furniture>
- archive: <https://opengameart.org/sites/default/files/parkfurnitures.zip>

The exact source notice and CC0 link ship beside the GLB. Runtime never fetches from
OpenGameArt.

Rebuild from the repository:

```sh
cd app
node scripts/build-venue.mjs
node scripts/build-venue.mjs --offline
```

The first command downloads the source archive when absent. The second proves the
gitignored `.venue-cache/` is sufficient. The script extracts only the supplied GLB,
checks required mesh names, enforces 1 MB / 20,000 source-triangle limits, writes the
manifest and preserves the licence.

The runtime treats the GLB as a geometry library, not a scene. Do not render its root
directly: that would turn 45 source objects into 45 draw calls.

## Files added

- `app/src/features/world/venue.ts`
- `app/src/features/world/venue-mesh.ts`
- `app/scripts/build-venue.mjs`
- `app/assets/venues/cubbon-park/*`
- `app/tests/venue.test.ts`
- `app/tests/venue-asset.test.ts`
- `app/tests/venue-mesh.test.ts`

## Existing files changed for this slice

- `app/.gitignore`
- `app/src/features/world/camera.ts`
- `app/src/features/world/canvas.tsx`
- `app/src/features/world/garden-mesh.ts`
- `app/src/features/world/hud.tsx`
- `app/src/features/world/map-mesh.ts`
- `app/src/features/world/world-screen.tsx`
- `app/tests/garden.test.ts`
- `app/tests/map-mesh.test.ts`
- `app/tests/native-imports.test.ts`
- `app/tests/world-camera.test.ts`

There is separate, uncommitted character and movement work in the same working tree:

- `app/src/features/world/character.ts`
- `app/src/features/world/character-mesh.ts`
- `app/scripts/build-characters.mjs`
- `app/assets/characters/*`
- related character tests and changes in `canvas.tsx`, `sim.ts`, settings and package
  files.

Do not discard or replace those edits when changing venue code.

## Verification completed

Final positive checks:

- `cd app && npx vitest run` — **27 files, 148 tests passed**;
- `cd app && npx tsc --noEmit` — passed;
- root `npm run typecheck` — passed;
- `git diff --check` — passed;
- `cd app && npx expo export --platform android --output-dir dist/venue-slice-check`
  — passed, and the export listed both `people.glb` and
  `venues/cubbon-park/furniture.glb`.

Negative controls were run and then restored:

- admitting a Whitefield agent to Cubbon Park made `venue.test.ts` fail;
- skipping the `entering` phase made the realm transition test fail;
- breaking orthographic zoom made `world-camera.test.ts` fail;
- removing the named roof layer made `map-mesh.test.ts` fail;
- changing CC0 to an unknown licence made `venue-asset.test.ts` fail;
- lowering the furniture budget to three draws made `venue-mesh.test.ts` fail.

All affected tests passed again after restoration.

## Phone validation

Use a release build on each phone:

1. Open Home. Confirm the full city is framed between the HUD controls.
2. Pan and pinch. Confirm labels and taps still align with their neighbourhoods.
3. Find the purple Cubbon Park marker, or tap **Visit Cubbon Park**.
4. Confirm the named fade appears before the scene changes.
5. Walk with the stick. Confirm the third-person camera, collision, animated nearby
   characters, textured benches/lamps/tables and park fog.
6. Tap **Directions** and confirm Maps opens to Cubbon Park Bengaluru.
7. Tap **Back to Bengaluru** and confirm the fade returns to the park marker.
8. In Settings, tap the version five times. In **3D check**, run 64 agents unplugged
   for at least one minute, then background and restore twice. Record FPS, p95,
   draw calls, triangles and PASS/MARGINAL/FAIL for day and night.

The hidden 3D check currently measures the city scene, not the entered venue. The venue
walkthrough must still be observed manually on both phones.

## Deliberately not built yet

- No café, lakeside or rooftop venue yet.
- Cubbon Park is a curated interpretation, not an exact digital twin.
- No server-side venue presence or invitations; “who is in the park” is derived from
  the current area roster.
- No navmesh. Existing circle/polygon collision remains appropriate for this first
  open park.
- No live venue hours, ratings or business data.
- No paid Places API.

## Next safe extension

Add the next venue as another `Venue` record plus local layout/art, keeping the same
realm and coordinate contracts. Introduce a navmesh only when a venue has narrow
interiors or multi-room routing that the current collision system cannot represent.
Before raising the 12-rig or 4-furniture-draw limits, measure on the hidden phone
benchmark rather than changing them by eye.
