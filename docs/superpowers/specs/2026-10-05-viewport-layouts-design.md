# Viewport layouts — design (branch `viewport`)

Status: DRAFT 2026-10-05. Research done, nothing built. Both `cavecad-src` and
`cavecad-tools` are on branch `viewport`; standard releases stay on
`cavecad` / `legacy-map`.

## Goal

Replace file-per-sheet plotting with AutoCAD-style **layouts and viewports**
inside the one cave drawing:

- Model space holds the cave, as now.
- Each **layout** is a named paper (A1, B2, Profile…) with its own title
  block, north arrow, scale bar and match lines in paper space.
- A **viewport** on a layout is a live window onto model space with its own
  scale, centre, twist and per-viewport layer visibility.
- One PDF set comes from all (or chosen) layouts.
- No `sheets/` folder, no derived copies, no stale sheets, no
  `CsSheetFile` edit-refusal, no clip-by-cutting geometry.

Product ambition: this is the future of CaveCAD sheet creation and map
publishing, not a side feature. It must also survive save/reload and be
openable in plain QCAD/AutoCAD as far as the DXF format allows.

## What the engine already has (verified in `cavecad-src`, 2026-10-05)

QCAD's open core ships most of the rendering half; the stripped parts are
UI, persistence and plot.

| Piece | State |
|---|---|
| `RViewportEntity` / `RViewportData` (`src/core/`) | Compiled, registered (`main.cpp: RViewportEntity::init()`), JS bindings generated (`REcmaViewport*`). |
| Fields | `position` (centre on paper), `width`, `height`, `scaleFactor`, `rotation` (twist), `viewCenter`, `viewTarget`, `overall`, `status` (Off), `viewportId`, frozen layer ids. |
| Rendering | `RViewportEntity::exportEntity`: draws frame, `exportClipRectangle`, `exportTransform` of a temporary model-space block ref (scale/rotate/offset), freezes the viewport's layers for the pass, exports model entities whose box intersects, hatch viewport context, linetype scaling. |
| Exporter plumbing | `blockRefViewportStack`, `getCurrentViewport()`, line-pattern counter-scale by viewport scale (`RExporter.cpp`). |
| Snap/pick through viewport | `RViewportData::getShapes/getDistanceTo/getEdges` written for it. |
| Active viewport | `RDocument::setCurrentViewport/getCurrentViewportId`, `RDocumentInterface::setCurrentViewport`; active viewport frame drawn thick dashed. |
| Layouts | `RLayout` object (paper size, margins, plot origin/window, custom scale, rotation, tab order); `RBlock::layoutId`; `RDocument` auto-creates `Layout1` + `*Paper_Space` (the viewport creation is commented out). |
| Print | `Print.js` already loops pages of ONE document with a `QPainter`; Qt PDF printer allows `newPage()`. |

## What is missing

1. **DXF persistence.** dxflib has no VIEWPORT entity. `RDxfImporter` only
   routes paper-space entities (group 67) into `*Paper_Space`; `RDxfExporter`
   writes empty `*Paper_Space`/`*Paper_Space0` blocks and no LAYOUT objects.
   Today a viewport would vanish on save. **This gates everything.**
2. **Layout UI.** No tab strip, no layout create/rename/delete/reorder, no
   paper canvas (white page on grey), no viewport tools, no "enter viewport"
   (MSPACE) interaction. All Pro-only upstream; we write it.
3. **Plot of a layout.** `Print.js` prints the current block with
   document-level scale/offset/paper variables; it must print a layout's
   paper-space block at 1:1 with the layout's own paper settings, many
   layouts into one PDF.
4. **Cave integration.** Sheet furniture, tiling maths and Sheet Setup panel
   are file-based; they become layout generators.

## Stages

Each stage ships/tests on its own and leaves the app usable.

### V0 — Spike (a day; decides the rest)
Script-only, no C++ edits. In a scratch drawing: add an `RViewportEntity` to
`*Paper_Space` via `RAddObjectOperation`, `setCurrentBlock("*Paper_Space")`,
look at it, then print it. Answers:
1. Does the view draw paper space and the viewport contents correctly
   (scene regenerate, clip, twist)? Does `Print` honour it?
2. Frame/clip behaviour at twist ≠ 0; hatches, text, linetypes, images
   (aerial basemap, scans) inside a viewport.
3. Cost: `exportEntity` walks **all** model entities per viewport per
   regenerate (box test only, no spatial index). Measure Truitt and the
   largest cave drawing with 4 viewports.
4. Scripting API coverage: can JS construct/modify viewports and layouts
   without new bindings? (If not, regenerate via `support/ecmagenerator`,
   rebuild **both** trees — see [[cavecad-two-build-trees]].)

Exit criterion: a go/no-go on rendering performance and the list of engine
patches V1+ must carry.

### V1 — Persistence (DXF + fallback)
- dxflib: parse/write `VIEWPORT` (10/20/30 centre, 40/41 size, 68 status,
  69 id, 12/22 view centre, 17/27/37 view target, 45 view height →
  `scale = height/viewHeight`, 51 twist, 331 frozen layer handles, 90 flags).
- Importer: map to `RViewportEntity` in the entity's paper-space block;
  frozen-layer handle → layer id; keep overall (id 1) viewport semantic.
- Importer/exporter: LAYOUT objects (name, tab order, plot paper size,
  margins, plot origin) ↔ `RLayout`; one paper-space block per layout
  (`*Paper_Space`, `*Paper_Space0`, `*Paper_Space1`, …).
- Round-trip tests in `tests/`: save → reload → compare layouts, viewports,
  frozen layers, paper-space entities.
- **Fallback if dxflib proves too brittle:** persist the layout set as a
  document blob (as the Layer Manager does) and keep DXF viewport output
  best-effort. Decide after V0/V1 first week. Watch the long-line trap in
  [[cavecad-dxf-long-line]] — a bad line silently drops the OBJECTS section.
- Datum: a viewport's `viewCenter` is an absolute model coordinate. Never
  default anything to 0 (see [[cave-survey-elevation-datum-trap]]).

### V2 — Layout UI (the AutoCAD feel)
- **Tab strip** under the drawing: `Model | A1 | A2 | Profile | +`.
  Switching = `setCurrentBlock(layout block)` + view fit to paper.
  Right-click: rename, move, duplicate, delete, page setup.
- **Paper canvas:** grey surround, white sheet, dashed printable margin,
  drawn by the view when the current block is a layout block.
- **Page setup dialog** per layout: paper (ISO/ANSI/custom), orientation,
  margins, units; stored in `RLayout`.
- **Viewport tools:** create (draw rectangle → viewport at default scale
  fitting the model extents), set scale (list + custom), set twist, lock,
  off, per-viewport layer freeze (dialog over `getFrozenLayerIds`), match
  viewport to another, clip to polyline (later).
- **Enter a viewport** (double-click inside; AutoCAD MSPACE): sets
  `setCurrentViewport`; pan/zoom edit `viewCenter`; drawing and snapping
  go through `getShapes`; double-click outside to leave. Scale lock honoured.
- **Selection rules:** paper-space tools never select model entities and
  vice versa unless a viewport is active.
- **Perf work from V0:** spatial-index query inside the viewport box
  (inverse-transform it, as `RViewportData::getShapes` already does) in
  place of the linear walk; cache per viewport.
- Cave tools: audit every tool for the assumption "current block = model
  space". In a layout they refuse or redirect with a message, as
  `CsSheetFile` does today. Tab-engine rules apply
  ([[cavecad-tab-engine-panels]]).

### V3 — Plot
- `Print.js` variant (or `PrintLayouts.js`): per layout, set the painter
  transform from the layout's paper size at 1:1, `paintEntities` for the
  layout block, `printer.newPage()`; mixed paper sizes across layouts.
- Print Preview shows one layout; "Export PDF set" runs chosen layouts into
  one file (what `SheetSetup.plotSet` does today, minus opening tabs).
- Clipping is the exporter's, so the white-prints-black trap
  ([[cave-sheet-tiling]]) cannot recur — no masks, no geometry cutting.

### V4 — Cave sheet generators on layouts
`CsSheetTile` maths (grid, overlap, numbering A1/B2, match lines) becomes a
generator that *writes layouts*:
- One layout per occupied tile, one viewport each (centre = tile core
  centre in model coordinates, scale from the plot-scale choice).
- Furniture (title block on the first sheet, scale bar and north arrow on
  all, "SHEET B2", match lines + "SEE SHEET …") as **derived paper-space
  entities** on suite-owned layers, regenerated by the generator; scale bar
  derives from the viewport scale, north arrow from its twist and the
  declination.
- Elevation/profile band: a viewport over the profile region of the plan
  drawing — closes the "elevation sheet not tiled" gap.
- Cross sections: a viewport per section.
- Sheet Setup panel keeps its familiar preview (`CsSheetView`) as the
  *authoring* surface; its output is layouts. Viewport edge dragging maps to
  `RViewportData` edits.
- Hand edits to a layout survive regeneration: derived entities carry a tag;
  everything else in paper space is the caver's and is left alone (the
  opposite of the current "sheets are demolition-dated" rule).
- Migration: legacy `sheets/` files and their records are read once to seed
  layouts, then retired. Remove `CsSheetFile` after the migration window.

### V5 — Polish / interop
Annotation scale for text/symbols per viewport, layer states per viewport,
viewport clip to polygon, sheet index table, title-block field attributes,
open-in-AutoCAD fidelity pass, handbook pages and translations
([[cavecad-i18n]]), live-restart and dock traps re-tested.

## Risks and open traps

- **DXF fidelity** (V1) is the largest unknown; the fallback is a blob.
- **Performance:** O(model entities × viewports) per regenerate until the
  spatial query lands. Measure in V0.
- **Rotated viewport contents:** frame is axis-aligned, content rotates;
  confirm clip rectangle stays correct (V0).
- **Listener-regenerated geometry** (Shaped Lines, Area Fill, linework warp)
  acts on model space; confirm no listener fires wrongly when the current
  block changes.
- **Two build trees:** header changes in shared engine classes need
  `qcadjsapi` rebuilt too, or heap corruption with no useful backtrace
  ([[cavecad-two-build-trees]]). Re-sign after deploy
  ([[cavecad-resign-after-deploy]]).
- **Test harness:** engine tests load Core by a hand-written list; new files
  must be added or they pass silently ([[cavecad-test-harness-traps]]).
- **Branch hygiene:** `viewport` must not be released until V3 passes; rebase
  onto `cavecad` / `legacy-map` periodically so it can merge cleanly.

## Decisions wanted from Nathan

1. DXF target: AutoCAD-compatible LAYOUT/VIEWPORT (more work, real
   interop) vs. best-effort only with the blob as source of truth?
2. Migration: convert existing `sheets/` tiles automatically, or start
   clean and keep legacy Sheet Setup for old caves for one release?
3. Paper canvas in the Model tab area (tabs at bottom like AutoCAD) vs. a
   separate "Sheets" dock listing layouts?
4. Is a paper-space-only user (no viewport entry, tiles auto-managed) the
   default, with MSPACE editing as the advanced path?
