# Aerial Basemap — design

Date: 2026-08-20
Status: approved (user, 2026-08-20)
Branch: `v2`

## Purpose

Give a cave map a real-world aerial photo underneath it, so the surveyed
passage can be read against surface features — sinkholes, road cuts, the
hillside the entrance sits in, the property line the cave runs under.

New tool folder `scripts/CaveSurvey/AerialBasemap/` following
[[qcad-plugin-conventions]]. One-shot `EAction`, no interactive state
machine.

## Imagery source

USGS NAIP via The National Map's ArcGIS ImageServer:

```
https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage
```

Chosen over Google Earth and Esri World Imagery. Google Earth imagery
cannot be pulled programmatically — no public tile/export API, and the
Earth/Maps terms forbid extracting imagery for offline reuse, which is
exactly what a DXF-embedded basemap is. Esri World Imagery (what the
LocationPick map picker displays) is worldwide and sharp but its terms
are a gray zone for extracted static exports and it wants attribution
text carried with the image. NAIP is US federal public domain: no key,
no quota, no attribution obligation, no ToS conflict. US-only coverage,
which covers the project's caves.

Service facts verified live 2026-08-20:

- `currentVersion` 11.3, capabilities `Image,Metadata,Catalog,Mensuration`
- native pixel size 0.3 m, 4-band natural color mosaic
- `maxImageWidth` / `maxImageHeight` = **4000**
- service spatial reference EPSG:3857 (Web Mercator)
- `exportImage?bbox=…&bboxSR=…&imageSR=…&size=W,H&format=png&f=image`
  returns a PNG; confirmed with an 800×640 request over Bloomington, IN

## Projection and pixel squareness

The naive request — bbox in lat/lon with `bboxSR=4326&imageSR=4326` —
produces a **stretched** image: degrees of longitude are shorter than
degrees of latitude by `cos(lat)`, so ground metres per pixel differ
between the axes. Measured on the verification fetch at latitude 39.16:
1.08 m/px across, 1.39 m/px down. A CAD image entity has one uniform
scale, so that image can never be placed correctly.

The tool therefore works in **EPSG:3857 Web Mercator** end to end:

1. Ground extent is computed in metres on a local tangent plane at the
   anchor latitude.
2. That extent is converted to Mercator metres by dividing by
   `cos(anchorLat)` (Mercator inflates distance by `1/cos(lat)`; over a
   cave-sized area the factor is effectively constant).
3. `bbox` is sent in 3857 with `bboxSR=3857&imageSR=3857`, and `size` is
   requested with the same aspect ratio as the Mercator bbox, so pixels
   are square in Mercator and therefore square on the ground.
4. Drawing scale is `mercatorMetresPerPixel * cos(anchorLat)`, converted
   into the drawing's units.

North-up, no rotation: the suite stores azimuths TRUE, and Mercator is
north-up, so grid north, true north and image up all coincide. Nothing
to rotate.

## Flow

1. **Find the anchor.** Scan point entities for `CaveSurvey/GeoLat` +
   `GeoLon` custom properties (written by the existing GeoReference
   tool). Found → use it.
2. **No anchor → acquire one, in place.** Same interaction GeoReference
   uses: require exactly one selected station point via `CsPick`, ask
   for the coordinate with `CsLocationPick.ask` (accepts Google Maps DMS
   or decimal, or a click on the browser map picker), commit
   `GeoLat`/`GeoLon`/`GeoStation` with `CsTags.commit`, then continue to
   the fetch. One tool run does the whole job; the user never has to
   know two tools exist.
3. **Compute extent.** Bounding box of the drawing's survey entities,
   expanded by 25% margin, expressed in ground metres via `CsUnits`
   (drawing may be feet or metres). A drawing with no extent or a
   degenerate one (single station) floors at a 150 m square.
4. **Choose resolution.** `px = clamp(round(groundMetres / 0.3), 256,
   4000)` per axis, preserving aspect. Large extents degrade resolution
   rather than failing; the 4000 cap is the service's own limit.
5. **Fetch.** `curl` through `QProcess`, synchronous, `--max-time 60`,
   `--fail`, `-o <path>`. Chosen over `QNetworkAccessManager` (async
   event-loop plumbing through the qtjsapi bridge is untested and the
   tool has nothing to do while waiting) and over the browser
   hand-download dance LocationPick uses for coordinates (clunky for a
   file). macOS ships curl; the target platform is the CaveCAD fork,
   where `QProcess` is available.
6. **Save beside the drawing** as `<dxfbasename>-aerial.png`. Neutral
   filename — no coordinates, no cave name beyond what the DXF already
   carries. Consistent with [[cave-location-privacy]]: the image and the
   DXF are both internal working files, and this adds no new export
   path. Requires a saved document; an unsaved drawing is refused with
   "save the drawing first" (the image entity needs a stable path
   relative to the DXF).
7. **Insert.** `RImageEntity` on layer `CTRL-AERIAL`, scale from step 4,
   positioned so the anchor station's drawing coordinate lands on the
   pixel of its own latitude/longitude. Sent to the back of the draw
   order so linework reads over it.
8. **Re-run replaces.** The image entity is tagged
   `CaveSurvey/AerialBasemap = "1"`. A second run erases any tagged
   image before inserting, the same replace-on-redraw pattern
   `CsDraw.eraseStations` uses. Survey grew → run again, get a wider
   photo.

## New layer

`CsLayers.AERIAL = "CTRL-AERIAL"`, defaults
`["gray", "CONTINUOUS", "Weight000"]`. Added to the registry, to
`CsLayers.DEFAULTS`, to `ensureSurveyLayers`, and hand-inserted into
`templates/NSS_Cave_Template_PLAN.dxf` — the structural test pins
registry layers to the PLAN template. Not added to `CsLayers.OFF`: the
whole point is that it plots on screen. It is a `CTRL-` layer, so Cave
Mode's existing show/hide treatment applies and the PDF deliverable
(plain linework) is unaffected.

## Menu wiring

`AerialBasemap.init`: title "Aerial Basemap", commands
`["aerialbasemap", "ab"]`, `setGroupSortOrder(450)`,
`setSortOrder(52)` — free slot immediately after Geo Reference (50), so
the two georeferencing tools sit together in the menu.
`setRequiresDocument(true)`. Icon `AerialBasemap.svg`.

## Pure math, separated

Static functions on the tool object, no document and no GUI dependency,
so the headless harness can eval the file and call them:

- `AerialBasemap.groundExtent(bboxDrawingUnits, unitFactor, marginFrac)`
  → ground metres, with the degenerate-extent floor applied
- `AerialBasemap.toMercator(lat, lon)` → `{x, y}` metres
- `AerialBasemap.computeBbox(anchorLatLon, groundExtentMetres, anchorOffsetMetres)`
  → `{xmin, ymin, xmax, ymax}` in 3857
- `AerialBasemap.pixelSize(bbox3857, nativeResolution, maxPx)` → `{w, h}`
- `AerialBasemap.drawingScale(bbox3857, pixelW, anchorLat, unitFactor)`
  → drawing units per pixel
- `AerialBasemap.buildUrl(bbox, size)` → the request string

`AerialBasemap.run()` holds everything that touches the document, the
dialogs, and `QProcess`.

## Error handling

Every failure leaves the drawing untouched and reports one line the
user can act on.

| Condition | Behavior |
|---|---|
| No active document | warning, return |
| Document never saved | warning: save first, so the image path resolves |
| Anchor missing and selection isn't exactly one point | the existing `CsPick` message |
| Coordinate dialog cancelled | silent return |
| Extent outside NAIP coverage (non-US) | warning naming the limit before fetching |
| curl missing / non-zero exit / HTTP error | warning quoting the shortest decisive stderr line |
| PNG written but zero-length or not a PNG | warning, delete the stub, no insert |
| `RImageEntity` unavailable in the bridge | warning naming the fork requirement |

## Testing

- **js_unit assertions** for every pure function: Mercator round-trip
  against known values, bbox aspect vs requested pixel aspect (the
  squareness invariant that the 4326 experiment violated), the 4000-px
  clamp, the degenerate-extent floor, feet-vs-metres unit handling, and
  URL construction. Runs under both node and `qcad -no-gui`.
- **Structural test** additions: the tool folder shape, `Cs`-prefix rule
  (no new Core file needed, but the layer registry gains an entry), the
  `CTRL-AERIAL` layer present in the PLAN template, unique
  `(groupSortOrder, sortOrder)`.
- **Network fetch and image placement are GUI-verified live only** — one
  run on a real drawing with a known entrance, checking that the photo
  lands under the survey at the right place and scale, and that a second
  run replaces rather than stacks. No network calls in the automated
  suite.

## Out of scope

Non-US imagery. Historical/date-selected NAIP vintages. Elevation or
contour derivation from 3DEP. Automatic re-fetch when the survey grows
(the user re-runs the tool). Tiling beyond a single 4000-px export.
