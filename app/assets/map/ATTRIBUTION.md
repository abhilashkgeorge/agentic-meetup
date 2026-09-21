# Map data

The miniature Bengaluru drawn on the Home screen is built from OpenStreetMap data:
the city outline (OSM relation/7902476), the main roads, the named lakes and the larger
parks, pulled on 2026-09-21 by `server/scripts/build-map.ts` and simplified into
`bangalore.json`. Neighbourhood tiles are the Voronoi cells of the thirty centres in
`shared/src/areas.ts`; buildings are not real footprints, only a density.

© OpenStreetMap contributors, Open Database License (ODbL) 1.0 — https://www.openstreetmap.org/copyright

The app shows "Map data © OpenStreetMap contributors" in Settings, as the licence asks.
During the build the BBMP ward boundaries published by DataMeet (CC BY-SA 2.5 IN) are
used only as a sanity check on the outline's extent; nothing from them is shipped.
