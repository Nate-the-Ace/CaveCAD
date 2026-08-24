# Trip Focus -- design

A standalone window that answers "who surveyed what, and how much of this
cave is theirs" -- and shows the answer as a drawing, not just a number.

Nathan's framing, 2026-08-23: *"The main idea of this tool would be to show
specific dates and teams contributions to a project, and later we may use
that data to highlight or color the specific trips."*

## What it is

One non-modal top-level window, opened from Cave Survey > Trip Focus
(`tripfocus` / `tf`). Two panes:

- **Left: the contributions list.** A `QTreeWidget` with four sections --
  **Trips** (by date), **Teams**, **People**, **Survey runs** -- each row
  carrying the distance that row surveyed and its percentage of the cave.
  Checkboxes select what is in focus.
- **Right: a live plan view.** A real CaveCAD drawing view -- pans, zooms,
  renders exactly like the main window -- showing only what is checked.

Footer: **All** (check everything), **Refresh** (re-read the drawing),
**Close**.

## The one architectural decision

**The window renders a PRIVATE COPY of the drawing. The user's drawing is
never touched.**

The alternative -- hiding entities in the real document and letting the main
window show the focus -- was designed first and rejected. Both approaches
need the same station-set arithmetic; the difference is entirely in what can
go wrong. Against the real document, four separate hazards appear, every one
of them silent in this build:

| Hazard | Why it bites |
|---|---|
| Restore silently refuses | `REntity::isEditable()` is false for an invisible entity, so a plain modify operation declines to un-hide it, with no error |
| Redraw while focused orphans and duplicates geometry | `CsDraw.eraseStations` cannot delete what it cannot edit, so the redraw draws a second copy beside the first -- the exact shape of the off-layer bug found on 2026-08-21 |
| The drawing goes dirty | `RMemoryStorage` marks the document modified on any object write, so merely looking at a trip prompts "save changes?" |
| Undo fills with view changes | every toggle is an operation on the user's document |

Against a private copy, all four stop existing: nothing is written to the
user's document at all. And the thing Nathan actually asked for next --
colour by trip -- becomes safe, because recolouring a scratch copy costs
nothing while recolouring the real drawing would overwrite the
cartographer's own colours with no way back.

## Verified engine facts this rests on

Read out of the fork's source, not from docs. Each of these is load-bearing.

- **A script can own a whole document, view and scene.**
  `new RDocument(new RMemoryStorage(), createSpatialIndex())`,
  `new RDocumentInterface(doc)`, `new RGraphicsSceneQt(di)`,
  `new RGraphicsViewQt(parent, false)`. Precedent:
  `scripts/Draw/Hatch/HatchDialog.js:56-72` (a dialog with a live drawing
  view in it) and `scripts/Widgets/AutoZoomView/AutoZoomView.js` (which
  subclasses `RGraphicsViewQt` from script).
- **`RGraphicsViewQt` brings its own navigation.** It implements
  `wheelEvent` and `mouseMoveEvent`, so the popup pans and zooms without any
  action plumbing.
- **~~A whole-document copy needs no selection.~~ CORRECTED 2026-08-24.** The
  claim below was read out of `cavecad-src` and is FALSE for the engine that
  actually runs: `RCopyOperation.setSelectionOnly` is `undefined` in
  `/Applications/CaveCAD.app` (binary Aug 19 22:50) while present in the source
  tree (HEAD Aug 21). The installed app is behind the source, so the source is
  documentation of a future build, not ground truth. `tests/run_all.sh`
  hard-codes that app, so it IS the target platform.
  **What `fillPreview` therefore does:** it saves the source document's
  selection, selects the model-space entities that are not individually hidden,
  runs the selection-based `RCopyOperation`, then clears and restores the
  original selection; individually hidden entities are rebuilt by hand, because
  `RCopyOperation` refuses them (and `setAllowInvisible`/`setAllowAll`, which do
  exist, do not change that). Model space is selected explicitly by
  `getBlockId() === getModelSpaceBlockId()` rather than trusting
  `queryAllEntities`, whose `allBlocks` default is false and would silently copy
  only whatever block the user is editing.
  **So "the user's document is never touched" carries one honest exception:** its
  SELECTION is changed for the duration of the copy and restored. Probed: that
  neither sets the modified flag nor adds a transaction, so nothing is written
  and no save prompt appears -- but a listener watching selection would see it.
- **~~(superseded)~~ A whole-document copy needs no selection.**
  `RCopyOperation(new RVector(0,0), sourceDoc)` defaults to
  `selectionOnly(true)` (`RCopyOperation.cpp:37`), and
  `setSelectionOnly(false)` is exposed to script
  (`REcmaCopyOperation.h:127`). With it off the operation copies
  `queryAllEntities()` (`RClipboardOperation.cpp:80-85`) and carries layers,
  linetypes and blocks across properly -- so the copy is faithful and the
  main window's selection is never disturbed.
- **The `Invisible` flag hides on screen and NOWHERE ELSE.**
  `RObject::Invisible` (`RObject.h:93`) is exposed as
  `setInvisible`/`isInvisible` (`REcmaObject.h:91-94`).
  `RExporter::exportEntity` skips invisible entities **only when
  `isVisualExporter()`** (`RExporter.cpp:765`), and the only visual exporter
  is `RGraphicsScene` (`RGraphicsScene.cpp:36`). So the flag hides in a
  view; a DXF write is not a visual exporter and keeps every entity. Nothing
  can be lost by hiding.
- **Non-undoable operations exist.** `new RModifyObjectsOperation(false)`
  (`RModifyObjectsOperation.h:38`); `RTransaction` only calls
  `beginTransaction()` when undoable (`RTransaction.cpp:161`).
- **~~Un-hiding needs permission.~~ CORRECTED 2026-08-23, by probe.** The
  claim above was that `op.setAllowInvisible(true)` makes an
  `RModifyObjectsOperation` able to un-hide an entity. It is worse than
  that: **`entity.setInvisible()` inside a modify operation does nothing at
  all for an ordinary entity, in either direction.** `RTransaction`'s modify
  path is a PROPERTY DIFF -- it walks `object->getPropertyTypeIds()`
  (`RTransaction.cpp:845,868`), and only calls `storage->saveObject()` when
  that diff reports a change (`:915,935`). `RObject::PropertyInvisible` is
  registered once against `RObject::getRtti()` (`RObject.cpp:75`), i.e.
  `ObjectUnknown`, and is re-registered per type only by `RAttributeEntity`
  and `RAttributeDefinitionEntity`. So for a line or a point the diff never
  sees `Invisible` change, `objectHasChanged` stays false, and the mutation
  is dropped in silence. `setAllowInvisible`/`setAllowAll` gate an earlier
  check that is never reached, which is why they looked load-bearing. This
  is also why `CsLayers.withLayerOn` works: `RLayer` DOES register its own
  off/frozen properties.
  **The mechanism that works** is `RChangePropertyOperation(RObject.PropertyInvisible,
  value, RS.EntityAll, false)` applied over the document's own selection --
  what QCAD's property editor itself uses. It hands the transaction an
  explicit one-property set instead of relying on the diff. In Trip Focus the
  selection used is the PREVIEW document's, cleared before
  `regenerateScenes()`, so the user's document neither gains a selection nor
  can see one.

## Where the numbers come from

Nothing new is measured. `CsRevise.surveyFromDocument(doc)` reconstructs the
survey from XDATA, which already carries everything:

| Row type | Source |
|---|---|
| Trip | `survey.trips[i]` -- `date`, `team`, `name`, `declination`; shots carry `shot.trip` (an index into `survey.trips`) |
| Team | distinct `trip.team` strings |
| Person | `trip.team` split on `,` `;` `/` `&` `+` and the word "and" |
| Survey run | `CsProfile.groupRuns(resolved)` -- the station-name prefix ("A", "B") |

**Distance counts the shots `CsStats.compute` counts** -- not splays, not
`excludeFromAll`, not shots missing an end. That rule is copied deliberately
so the sum of the rows equals the Length on the title block. It inherits
`CsStats`' known gap (`excludeFromLength` is not honoured); fixing that is a
`CsStats` change and belongs with the other one already spawned, not here.

**A person is credited with the whole trip, not a share of it.** Two people
on one trip are each credited its full distance, so the People percentages
can exceed 100%. That is the honest reading of "who was there for this" --
dividing 412 ft by a party of three invents a number nobody measured. The
window says so on the People section header rather than leaving the reader
to work it out.

## What focus means, entity by entity

Focus reduces to a **set of station names**. Every row type produces one:
a trip's stations come from `CsRevise.tripStationNames(survey)` (already
written, already used by linework binding), a team's or a person's is the
union over their trips, a run's is `grouped.runs[key].stations`.

An entity is then attributed to stations by the tag scan `CsDraw.eraseStations`
already defines -- `Station`, `StationLabel`, `LRUDName`, `LRUDLine`,
`LRUDNote`, `Splay`, `SplayName`, `SplayLabel`, `NoteLabel`, `NoteLeader`,
`Shot` (both ends), `WallRunStations` (any station), `RawStation`, `RawShot`,
plus `LineworkStations` for traced walls and `ProfileStation` for the
elevation band. Two rules keep this from rotting:

1. **An entity attributable to nothing stays visible.** Title block, border,
   sheet, basemap, symbols, untagged sketches. Same doctrine as the deleted
   Cave Mode's KEEP list: an unknown thing showing is clutter, an unknown
   thing vanishing is a support call.
2. **The tag list is pinned by a test against `CsDraw.js` itself.** The erase
   rules and the focus rules read the same tags; a tag added to one and not
   the other means geometry that a redraw replaces but a focus cannot see.
   The test reads the `eraseStations` body and fails on divergence.

**Plan only.** Nathan's decision: the profile band is out. Everything whose
layer's `CsLayers.frameOf` is `"profile"` is hidden in the preview
permanently, whatever is checked.

## Limits, accepted

- **The window is a snapshot.** Draw in the main window and the popup is
  stale until Refresh. A transaction listener could do better, but
  `transactionUpdated` is still unverified in this build, so Refresh is
  explicit rather than trusted.
- **It is a viewer, not a workspace.** No tracing in it. Working while
  focused needs the in-document version, which is the same station-set
  primitive plus one button -- available later, deliberately not now.
- **It costs a second copy of the drawing in memory.** Fine at cave scale;
  measure on the largest real survey before assuming.
- **Print or PDF from the popup plots the focus**, because print goes
  through a scene. That is a feature, not a caveat, but it is worth knowing.

## Decisions on record (Nathan, 2026-08-23)

1. Metric: **distance and percentage** per contributor.
2. **Viewer first, colour later.**
3. **Per team, and per person as well** -- per-person stats are wanted too.
4. **Plan only.**
