# Cross Section Sketching — design

2026-08-29. Nathan's ask, taken in session: "a Cross Section Sketching
widget that uses our scans/ folder — when I click go, it asks for the
station of the section, lets me sketch the outline and other features,
imports that into the plan view area of the active cave DXF, uses the
section leader function to identify the station, and places that block
outside the plan view cave walls."

Target 0.9.38.0.

## Problem

`CrossSection.js` draws a section that is **computed**: lofted from the
station's own LRUD and splays by `CsSectionCut`, block-local, on a
`KIND_SECTION` callout leader. That is the right answer where the splays
are dense and the wrong one everywhere else — a rough LRUD box says
nothing about the ledge, the breakdown floor or the keyhole, all of
which the surveyor drew in the field book and which is sitting in the
cave's `scans/` folder unused.

Sketch Scans already gets a scan onto the sheet as an aligned underlay,
but only for **plan** and **profile**. There is no path from a scanned
cross section to a placed section block.

## What already exists (verified in tree at 0.9.37.1)

Earlier notes had these listed as unbuilt prerequisites. They are built.

1. **Section layers** — `CsLayers` defines fourteen `CTRL-SECTION-*`
   control layers (including `CTRL_SECTION_SCAN`, `CTRL_SECTION_BOX` and
   `CTRL_SECTION_OUTLINE`) and twenty-two unprefixed `SECTION-*` draw
   layers (`SECTION-WALLS-SURVEYED`, `SECTION-CEILING`,
   `SECTION-BREAKDOWN`, the `SECTION-NOTES-*` family, and the Shaped
   Lines twins). `CsLayers.frameOf` answers `"section"` for both
   spellings, and `templates/NSS_Cave_Template_PLAN.dxf` already carries
   them — no template sync is owed.
2. **Frame-aware scans** — `Core/CsScanFrame.js` exists with
   `KINDS = ["plan", "profile", "section"]`, `layerFor`,
   `stationTagFor`, `runTagFor`, `labelFor`, `dedupePlaces`, `placesIn`.
   `SketchScans.insert()` already takes a frame and routes the layer and
   the `ScanFrame` tag by it.
3. **Section blocks and leaders** — `CsSectionDraw` defines one block per
   section, `CS_<CalloutId>`, block-local about the cut's centreline
   point, definition owned by the tool and reference owned by the caver.
   `CalloutWrite.createSection` / `addSectionLeaders` /
   `refreshSections` wire and refresh the leader.
4. **Station picking** — `CsTags.collectStations`, `CsStationOrder`
   (`walkOrder`, `nextUnassigned`), and the Align Image station box.

So this spec adds a workflow, not a foundation.

### The one dead end found while checking

`CsScanFrame.stationTagFor("section")` returns `"SectionStation"`.
**Nothing in the suite writes that tag**, so `placesIn(doc, "section")`
returns an empty list on every drawing that exists. It is not a bug in
`CsScanFrame` — it is a producer that was never built, and it would have
surfaced here as a station picker that silently offers nothing.

A cross section is cut at a **plan** station. This tool therefore reads
plan stations (`Station`, via `CsTags.collectStations`) and never
consults `stationTagFor("section")`. `CsScanFrame` is left alone;
`SectionStation` stays reserved for a future frame that genuinely plots
its own station points.

## Decisions

### D1 — Sketch in a staging bay inside the drawing

Not a custom paint canvas in the dock, and not a scratch document.

A canvas widget would need a script-constructible `QWidget` with paint
and mouse-move handling, which this bridge has repeatedly refused for
lesser widgets (`QTreeWidget`, `QListWidget`, `QTableWidget`), and would
throw away snap, arcs, undo, Feature Trace and the whole Shaped Lines
symbology — the caver would be tracing a cave with a mouse and nothing
else. A scratch document would cross the `RCopyOperation` path and sit
next to the freed-`RDocument` segfault.

The bay is a locked, named rectangle on `CTRL-SECTION-BOX`, parked clear
of the drawing's plan extents, holding the scan and the tracing. The
caver draws with the tools they already use every day.

### D2 — An LRUD ghost is the ruler

The bay is pre-loaded with the **computed** section for that station —
`CsSectionCut.polygonAt`, dashed, on `CTRL-SECTION-OUTLINE`, at
`CsSectionDraw.SCALE` (2.0), origin at the centreline point, up = up.

The caver scales, rotates and moves the *scan* to sit over that ghost,
then traces. One object does three jobs: scale calibration, orientation,
and a visible check of the tracing against the measurements. It is
deleted at Capture and never reaches the block.

Where the station has no usable LRUD, no ghost is drawn and the bay
falls back to a two-click distance calibration (pick two points on the
scan, type the real distance).

### D3 — Capture is geometric containment

Everything whose geometry falls inside the bay frame joins the block,
minus the scan image, the ghost and the frame itself. Not "everything on
the section layers" (a stray line from the previous section joins
silently) and not "the current selection" (one mis-click loses a traced
wall).

The frame is visible, so what is in and what is out can be seen before
committing.

### D4 — Auto-propose the placement, one click to override

March a ray outward from the station and drop the block at the first
clear spot. Show it as a live preview with the leader attached; Enter
accepts, moving the mouse and clicking places it elsewhere.

Automatic when the guess is good, one click when it is not. Fully
automatic with no prompt was rejected: a bad guess is cleanup after the
fact, and the preview costs nothing because `di.previewOperation`
already exists on this path.

### D5 — A sketched section is never regenerated, and is re-openable

`SectionSource=sketch` on the block reference is a hard gate:
`CalloutWrite.refreshSections` skips it, so no Draw, adjustment or
refresh ever overwrites hand tracing with LRUD geometry.

The leader tip still re-anchors to the station, so a sketched section
follows the survey exactly like a computed one.

Revision is by **reopening the bay**, not by editing the block in place:
the scan path and the bay fit are stored on the reference, so Edit
Sketch restores the scan at the same scale with the tracing back inside
the frame. Re-Capture redefines the block; the reference does not move.

This is the revision framework's own rule — the drawing is
reconstructible from what is stored on it.

### D6 — One scan browser

The Go button is a third action on the Sketch Scans shelf, beside Insert
and Insert & Align, enabled when the frame selector says Cross Section.
A second panel would duplicate the recursive tree, the collapse state,
the preview pane, the hover tooltips and the completed marks, and the
two copies would drift.

### D7 — The frame selector becomes a combo

`w.profileCheck` (a two-state `QCheckBox`) becomes a `QComboBox`:
Plan / Profile / Cross Section. A combo always has a value and can be
read off the widget, rather than being accumulated from click events
that may never fire.

### D8 — The bay parks beside the plan, and remembers

Default position is clear of `doc.getBoundingBox(true, true)` on the
side with the most empty space. Once the caver moves it, the position is
remembered per cave in settings, so a session of ten sections opens the
bay in the same place every time.

## Architecture

### New pure Core — `Core/CsSectionBay.js`

No `R*` or `Q*` symbols anywhere, so `tests/js_unit.js` exercises all of
it under node.

- `frameRectFor(planBox, size, remembered)` — where the bay goes.
- `contains(rect, box)` / `sweepOf(boxes, rect, excludeIds)` — the
  capture set, by containment.
- `fitTransform(scanBox, ghostBox)` — the initial scan placement over
  the ghost, and `serializeFit` / `parseFit` for the tag
  (`sx,sy,rot,tx,ty`, comma-joined, capped well under the dxflib
  1024-per-line rule).
- `marchOut(origin, direction, blockBox, obstacles, margin, cap)` — the
  placement search of D4, returning a point or null.
- `axisAt(resolved, stationName)` — the outward direction: perpendicular
  to the local leg tangent, sign toward the clearer side.

### New tool — `SketchSection/`

Per the add-on convention: own folder, own `.svg`, unique
`(groupSortOrder, sortOrder)`, `includeBasePath`-relative includes, `Cs`
prefix on every library file.

- `SketchSection.js` — opens the bay. Station prompt, scan insert, ghost,
  zoom, snap to free. Menu command `sketchsection` / `sks`.
- `SectionCapture.js` — the sweep, the block definition, the leader, the
  march, the preview, the teardown. Command `sectioncapture` / `skc`.
- `SectionEdit.js` — reopens the bay from a selected sketched block.
  Command `sectionedit` / `ske`.

### Changed

- `SketchScans/SketchScans.js` — checkbox to combo (D7), third action
  button (D6), `frameNow()` gains the section answer.
- `Callout/CalloutWrite.js` — `refreshSections` skips
  `SectionSource=sketch`, and **counts** what it skipped, the treatment
  `SectionFrozen` already gets: a skipped section is never silently
  stale.

## Flow

1. Shelf frame selector → Cross Section. Pick a scan. **Sketch Section**.
2. Station prompt: plan stations, `CsStationOrder.walkOrder` ordering,
   the box Align Image already uses.
3. Bay opens: frame drawn and locked, scan inserted on
   `CTRL-SECTION-SCAN` faded 50 at the back of the draw order, ghost on
   `CTRL-SECTION-OUTLINE`, view zoomed to the frame, snap switched to
   free through the snap `RGuiAction`.
4. Caver scales the scan onto the ghost and traces onto the `SECTION-*`
   layers with Feature Trace, Shaped Lines, arcs, whatever fits.
5. **Capture**: sweep, define `CS_<CalloutId>` block-local about the
   ghost origin, `CalloutWrite.createSection` for the leader,
   `CsSectionBay.marchOut` for the position, preview, accept.
6. Teardown: scan, ghost, frame and the loose tracing deleted.

Each phase is one transaction group, so each is one undo.

## Tags

On the block reference:

| tag | meaning |
|---|---|
| `SectionSource` | `sketch` — the regeneration gate (D5) |
| `SectionScan` | scan path relative to `scans/` |
| `SectionBayFit` | `sx,sy,rot,tx,ty` of the scan over the ghost |
| `SectionStationRef` | the plan station the section is cut at |
| `SectionScale` | drawing units per survey unit in the block |

Written through `CsTags.set`, cleared through `CsTags.remove` — `set`
returns early on empty and cannot unset.

## Error handling

- **No usable LRUD at the station** — no ghost, two-click calibration
  instead (D2), and the bay says so.
- **March finds nowhere clear** — capped; falls back to plain
  click-to-place rather than flinging the block into empty space.
- **Empty sweep** — Capture refuses and explains, rather than defining
  an empty block that renders as nothing.
- **Active drawing changed under the dock** — the shelf's existing
  guard (`CsCave.folderOf` comparison, rebuild on mismatch) covers the
  Sketch Section button too. Never hold `doc` across a bay session;
  re-resolve through `EAction.getDocument()`.
- **Scan missing on Edit Sketch** — reopens with the tracing and the
  ghost, no underlay, and says which file it could not find.

## Traps this design must respect

Every one of these has already produced a real defect in this suite.

- Sketch layers must stay **out of `CsBind` and `CsWarp`** — a
  plan-scoped warp would rubber-sheet a section sitting in plan
  coordinates. `frameOf` answers `section`; the sweeps must use it.
- `CTRL-SECTION-BOX` and `CTRL-SECTION-SCAN` may be **off**, and an off
  layer silently refuses adds, modifies and deletes. Every write goes
  through `CsLayers.withLayerOn`.
- **Bounding boxes are cached** and a modify does not invalidate them.
  `entity.update()` before any containment test that follows a move.
- **No fit-point splines** — Pro-only, fail silently, vanish on save.
  Control-point splines with the degree clamped to the point count, or
  short straight segments.
- **Never `RGuiAction.trigger()` from a widget event.** The shelf button
  hands off through `alignSoon()`'s zero-delay timer.
- **`di.setSnap()` takes ownership** — record the snap's class name and
  rebuild from a name→constructor table on teardown.
- **`queryAllEntities` is not insertion-ordered** — the sweep diffs the
  id set, never takes the last id.
- **A no-op write is still a transaction** and the callout listener will
  hear it. Do not rewrite unchanged geometry.

## Testing

**node (`tests/js_unit.js`)** — all of `CsSectionBay`: containment
including edge cases at the frame boundary, fit transform round-trip,
`serializeFit`/`parseFit` through the `\N` inner-escape nesting,
`marchOut` against synthetic obstacle sets (clear, boxed in, cap
reached), `axisAt` sign selection.

**Real engine (`tests/run_all.sh`, `/Applications/CaveCAD.app`)** —

- the bay opens, and its frame is locked;
- Capture on a known tracing yields a block whose bounding box matches
  the tracing's, block-local about the ghost origin;
- the leader anchors to the plan station and re-anchors when the station
  moves;
- a DXF round trip preserves the block, its reference and all five tags;
- `refreshSections` leaves a `SectionSource=sketch` block byte-identical
  and reports it as skipped.

**Mutation-tested assertions.** The "Draw does not clobber a sketch"
test and the containment test both get their code deliberately broken to
confirm they go red. Four tests in this suite have passed while the
thing they named was broken; a comparison is only evidence if the two
sides can disagree.

## Out of scope

- Sketching profiles or plan detail in a bay. The bay is section-only
  until this ships and is used.
- Any change to `CrossSection.js`'s computed sections. The two coexist:
  computed where splays are dense, sketched where the field book is
  better.
- A producer for `SectionStation`. Reserved, not built.
