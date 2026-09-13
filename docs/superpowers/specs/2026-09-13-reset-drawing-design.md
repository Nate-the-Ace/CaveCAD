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

FULL, and full means full. Nothing in the drawing survives:

  * the survey -- stations, legs, splays, LRUD, trip metadata;
  * the drawn map -- traced linework, shaped lines, symbols, area
    fills, callouts, notes, profile bands, cross sections;
  * the PLACED IMAGES -- every sketch scan and the aerial basemap;
  * the georeference, which rides an entity and goes with it.

The first design of this tool kept the images and carried the
georeference across on a marked point. That was wrong, and the reason it
was wrong is the reason the tool exists: placing a scan, fitting it,
trimming it and fetching the aerial are each a tool a student is here to
learn, exactly as importing the survey is. A reset that left them
standing would skip those lessons as surely as one that left the
stations behind would skip the first.

Then the layer table is brought back to the current template
(CsRestyle.ensureAndApply), so a class does not start on the previous
student's stray layers.

## What is NOT touched

The cave's FOLDER. scans/, images/, lidar/, PDF/ and backup/ come
through exactly as they were, so every page, photograph, capture and
plotted map is still there to be placed again. This tool empties a
DRAWING and never a folder; Teaching Cave (CsTeach) is the one that
resets a folder, from a pristine master.

That distinction is what makes the reset survivable. The expensive part
of a cave project is the material on disk, not the placement of it.

## Why not just make a new drawing

Because a cave project is a folder whose drawing has a name, a backup
history, a shelf entry, and a path that every scan is stored relative
to. A new drawing is a new file somewhere else. The reset keeps all of
that and empties what is inside it.

It also works IN PLACE for a second reason: a drawing that changes
folders loses the relative paths its scans are stored against.

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

Body, in order: what goes, counted in three numbers -- survey, drawn,
and PLACED IMAGES counted apart, because somebody who has just spent an
evening fitting forty-seven scans deserves to see that number before
agreeing rather than a total that hides it; the line saying the location
goes too and comes back from Set Cave Location; what is NOT touched (the
folder, and everything on disk in it); the backup path just written;
and, where the drawing is modified, the line about unsaved changes.

Confirmation is typed: a line edit, and OK stays disabled until the
text matches the cave's name, trimmed and case-insensitive. Default
button is Cancel. A reset in front of a class must not be one stray
Return away.

Afterwards the drawing is left open and dirty. The tool saves nothing;
the student decides.

## Structure

`Core/CsReset.js` -- pure, node-testable:

  * `keepsEntity(info)` -- false, always. It exists so the rule is
    written down in one place with its reason attached, rather than
    being the absence of a filter in the middle of the walk, and so the
    walk and the count cannot drift apart if it ever changes.
  * `countKind(info)` -- "image" for a placed image wherever it sits,
    else "survey" for a CTRL- layer and "drawn" for the rest.
  * `tally(infos)` -- {total, survey, drawn, images}.
  * `planReset(state)` -> `{can, reason, warning}`, the shape
    CsTeach.planReset already uses: a refusal comes back as words a
    student can act on, never as a throw.
  * `summaryText`, `doneText`, `matchesName`, `groupNumber`.

`ResetDrawing/ResetDrawing.js` -- presenter and document work:

  * `classify(doc)` -- walks model space (not block definitions: a
    symbol's DEFINITION is not drawing content, and emptying those
    would empty the symbol library), splits ids from counts.
  * `withEveryLayerEditable` -- clears off, frozen AND locked on every
    layer for the delete, and puts each back. Locked is deliberately
    cleared here where CsLayers.withLayersOn will not: a locked layer
    refuses a delete in SILENCE, so the drawing would come back looking
    emptied while whatever was protected quietly survived.
  * `buildConfirm` / `confirm` -- split so the dialog can be built and
    inspected without a modal exec blocking the application.
  * `deleteAll`, `caveFolderOf`, `init(basePath)`.

Nothing outside these two files changes.

## Not doing

Block purging and sheet-layout clearing. Sheets are separate files
(CsSheetFile) so there are no layouts to clear, and purging blocks
would take symbol definitions the palette expects to find.

A "keep the survey, wipe the drawn work" mode, and a "keep the images"
mode. Asked and answered: the reset is full.

## Testing

Unit tests in tests/js_unit.js over the pure half: keepsEntity over
images and non-images alike, countKind's three-way split, the tally,
planReset through each refusal and the go case, matchesName, and every
line the dialog promises -- the image count, the location line, and the
sentence saying the folder is not touched.

CsReset.js must be added to the harness's hand-written Core file list.
A Core file missing from that list does not fail -- it passes silently
through the harness's deliberate catches, and every test that needed it
is quietly skipped.

Engine test tests/reset_drawing_run.js (stage 11/44): a real document
with a survey, two placed images, a georeferenced anchor station, a wall
on a LOCKED layer and an aerial on an OFF one. After the reset: not one
entity left, no image, no anchor, the scanned page still on disk, the
template's layers back, and the locked and off layers restored to how
they were. A second run finds nothing and the tool refuses.

Live GUI check on a teaching copy: reset, confirm the drawing is empty
and the cave folder is not.
