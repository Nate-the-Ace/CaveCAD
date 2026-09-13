# Reset Drawing -- design

Date: 2026-09-13
Status: approved, ready to plan

## The problem

Teaching a class on the suite means handing every student the same
starting point, repeatedly: a cave folder whose images are already in
place -- the georeferenced aerial under the map, the sketch scans
trimmed, warped and anchored where the caver drew them -- and whose
drawing is otherwise empty, so the lesson can start at "import the
survey" and run through to a finished map.

Testing wants the same thing for the same reason: a project to wipe and
re-run a tool against, without re-fetching an aerial or re-fitting
forty-seven scans every time.

Nothing does this today. Teaching Cave resets a whole FOLDER from a
pristine master (CsTeach), which is the right tool for handing out a
cave and the wrong one for emptying the drawing you already have open.

## What a reset is

FULL. Survey data goes with everything else: a class starts by
importing the survey, so leaving stations behind would skip the first
lesson.

Kept:

  * IMAGE entities -- the sketch scans (plan, profile, section) and the
    aerial basemap.
  * The georeference: GeoLat / GeoLon / GeoStation, and the
    GeoDrawX / GeoDrawY position they were pinned at.

Deleted: everything else. Stations, legs, splays, LRUD, traced
linework, shaped lines, symbols, area fills, callouts, profile bands,
cross sections, text, dimensions, and any legacy survey data store.

Then the layer table is brought back to the current template
(CsRestyle.ensureAndApply), so a class does not start on the previous
student's stray layers.

The result is a drawing that looks new and happens to have images and a
location in it.

## Why the images can survive untouched

A placed scan is an IMAGE entity whose file pointer lives in the DXF's
IMAGEDEF, and that pointer is the fragile part of the system -- Truitt
Cave lost all forty-seven of them at once (see CsScanRelink). The
reset never touches an image entity, never moves the drawing to another
path, and never rebuilds an IMAGEDEF. Trim box, warp and placement ride
through because nothing asks them to.

This is why the reset works IN PLACE rather than writing a fresh file
beside the original: a drawing that changes folders loses its scan
paths.

## Why the georeference needs a carrier

The geo tags ride an ENTITY -- normally the anchor station -- and a full
wipe takes that station with everything else. CsRevise hits the same
problem on its non-rigid path and solves it by reading the anchor before
the redraw and recommitting it after.

The reset does the same, onto a carrier: a POINT on CTRL-AERIAL holding
GeoLat / GeoLon / GeoStation / GeoDrawX / GeoDrawY plus a GeoCarrier
marker, placed at the pinned position.

Position matters. CsLocationPick compares the anchor entity's position
against GeoDrawX/GeoDrawY and, past MOVE_EPS, asks whether the station
has moved and the coordinate should be recomputed. A carrier at the
pinned position keeps that question unasked. On a drawing georeferenced
before those tags existed pinX/pinY are null, and the carrier goes at
the old anchor entity's own position.

This works at all because CsLocationPick.anchorRecord scans ANY entity
for GeoLat/GeoLon -- it is not station-specific.

The carrier must not outlive its purpose. After the next import the
drawing would carry the geo tags twice, on the carrier and on the new
anchor station, and anchorRecord returns whichever it finds first. So
CsDraw.survey deletes any GeoCarrier entity when it commits a real
anchor.

## Guards, in order

1. No document, or a drawing that has never been saved -- refuse.
   There is no folder to back up into.
2. Not inside a cave project folder (CsCave.folderOf) -- refuse.
3. A sheet file -- refuse (CsSheetFile.blocks), as every drawing tool
   in the suite does.
4. Nothing to delete -- say the drawing is already clear, and stop.
5. Backup. CsBackup.copyPrevious must return true. NO BACKUP, NO WIPE:
   this ordering, not the dialog, is the actual safety property.

The backup copies the file ON DISK, so unsaved changes in the open
drawing are not in it. The dialog says so rather than silently
implying otherwise.

## The dialog

Title: `Reset Drawing -- <Cave>`.

Body, in order: what goes, counted by kind ("412 stations, 1,830 traced
entities, 96 symbols, 3 profile bands, 2 cross sections"); what stays
("47 images kept, geo anchor kept"); the backup path just written; and,
where the drawing is modified, the line about unsaved changes.

Confirmation is typed: a line edit, and OK stays disabled until the
text matches the cave's name, trimmed and case-insensitive. Default
button is Cancel. A reset in front of a class must not be one stray
Return away.

Afterwards the drawing is left open and dirty. The tool saves nothing;
the student decides.

## Structure

`Core/CsReset.js` -- pure, node-testable:

  * `KEEP_LAYERS` -- CTRL-SCAN, CTRL-PROFILE-SCAN, CTRL-SECTION-SCAN,
    CTRL-AERIAL.
  * `keepsEntity({type, layer, tags})` -- true for an IMAGE on a keep
    layer or carrying SketchScan / SectionScan. Type AND layer, so a
    stray line drawn on CTRL-SCAN still goes.
  * `planReset(state)` -> `{can, reason, warning, counts}`, the shape
    CsTeach.planReset already uses: a refusal comes back as words a
    student can act on, never as a throw.
  * `carrierFrom(anchorRecord)` -> `{x, y, tags}` or null.
  * `summaryText(counts)`, `doneText(caveName, counts)`.
  * `countKind(layer, tags)` -- which counted kind an entity falls in.

`ResetDrawing/ResetDrawing.js` -- presenter and document work:

  * `classify(doc)` -- walks queryAllEntities, splits keep from delete,
    counts the deletions by kind.
  * the dialog.
  * `apply(doc, di, plan)` -- read anchorRecord, one
    RDeleteObjectsOperation, commit the carrier, CsRestyle.ensureAndApply.
  * `init(basePath)` -- the standard add-on wiring, without which the
    tool never appears in the menu. Group 450, sorted beside Teaching
    Cave; command `resetdrawing`. Icon pair, light and inverse.

One edit outside the new files: CsDraw.survey deletes a GeoCarrier
entity when it commits a real anchor.

## Not doing

Block purging and sheet-layout clearing. Sheets are separate files
(CsSheetFile) so there are no layouts to clear, and purging blocks
would take symbol definitions the palette expects to find.

A "keep the survey, wipe the drawn work" mode. Asked and answered: the
reset is full.

## Testing

Unit tests in tests/js_unit.js over the pure half: keepsEntity across
image/non-image and keep/other layers, planReset through each refusal
and the go case, carrierFrom with and without pin tags, countKind, and
the summary text.

CsReset.js must be added to the harness's hand-written Core file list.
A Core file missing from that list does not fail -- it passes silently
through the harness's deliberate catches, and every test that needed it
is quietly skipped.

Live GUI check on the Pitfall Cave fixture and on a Truitt copy: reset,
confirm the images are still drawn and still linked to their files,
confirm the geo anchor still answers, import a survey, confirm the
carrier is gone and exactly one anchor remains.
