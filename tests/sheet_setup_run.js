// sheet_setup_run.js -- Sheet Setup builds a sheet a plotter could
// print, and does not overwrite what a person typed.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/sheet_setup_run.js "$PWD"
//
// tests/js_unit.js pins the arithmetic -- what fits on what paper, how
// the bar divides, what the title block can be told. This proves the
// parts that only exist against a document:
//
//   1. The sheet lands AROUND the cave and at the right size, and a
//      second run measures the CAVE again rather than the first run's
//      border (otherwise the sheet grows every time it is run).
//   2. Text is drawn at the plot scale -- a title block line 7 ft tall
//      at 1" = 50 ft. Get this wrong and the map plots with text either
//      invisible or a foot high, which no unit test over numbers can
//      see happening to real entities.
//   3. A value a human typed is never replaced by a computed one.
//   4. The location line is left empty, always.

if (typeof isNull === "undefined") {
    isNull = function(v) {
        if (v === undefined || v === null) {
            return true;
        }
        try {
            if (typeof v.isNull === "function") {
                return v.isNull();
            }
        } catch (e) {
        }
        return false;
    };
}
if (typeof createSpatialIndex === "undefined") {
    createSpatialIndex = function() {
        return new RSpatialIndexNavel();
    };
}

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];

include("scripts/EAction.js");
include("scripts/simple.js");
includeBasePath = repoRoot + "/scripts/CaveSurvey/Core";
include(includeBasePath + "/CsAll.js");

var failures = [];
function ok(condition, what) {
    if (!condition) {
        failures.push(what);
    }
}
function eqs(a, b, what) {
    ok(a === b, what + " (expected " + JSON.stringify(b) +
        ", got " + JSON.stringify(a) + ")");
}
function near(a, b, tol, what) {
    ok(Math.abs(a - b) <= tol,
        what + " (expected " + b + " +/- " + tol + ", got " + a + ")");
}

var messages = [];
warning = function(text) { messages.push("WARNING: " + text); };
EAction.handleUserMessage = function(text) { messages.push(text); };

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var di = new RDocumentInterface(doc);
getDocument = function() { return doc; };
getDocumentInterface = function() { return di; };
getMainWindow = function() { return null; };

includeBasePath = repoRoot + "/scripts/CaveSurvey/SheetSetup";
include(includeBasePath + "/SheetSetup.js");

// NOT "addLine" -- scripts/simple.js owns that global; see
// tests/check_map_run.js.
function addSegment(layer, x1, y1, x2, y2) {
    CsLayers.ensure(doc, di, layer);
    var e = new RLineEntity(doc,
        new RLineData(new RVector(x1, y1), new RVector(x2, y2)));
    e.setLayerId(doc.getLayerId(layer));
    var op = new RAddObjectsOperation();
    op.addObject(e, false);
    di.applyOperation(op);
    return e;
}

// A cave 1000 ft by 400 ft.
addSegment(CsLayers.WALLS_SURVEYED, 0, 0, 1000, 0);
addSegment(CsLayers.WALLS_SURVEYED, 0, 400, 1000, 400);

// THE PLAN ONLY. The extended elevation is drawn below the plan in the
// same drawing; measuring both sized the sheet for a column of views
// and cost Truitt Cave a scale step (1" = 40 ft became 1" = 80).
addSegment(CsLayers.PROFILE_WALLS_SURVEYED, 0, -4000, 3000, -4000);

var caveBox = SheetSetup.caveBox(doc);
ok(!isNull(caveBox), "the cave's extents are readable");
near(caveBox.maxX - caveBox.minX, 1000, 0.01,
    "and are the PLAN's own -- a 3000 ft elevation band below it is " +
        "not part of the map the sheet is laid out around");
ok(caveBox.minY > -4000,
    "the elevation is left out of the height too");

var sheet = CsSheetSetup.sheetByName("ARCH D -- 36 x 24");
var scale = 50;
var said = SheetSetup.draw(doc, di, {
    elevation: false,
    caveBox: caveBox, sheet: sheet, scale: scale, turned: false,
    wants: { border: true, bar: true, north: true, title: true },
    filled: { caveName: "Test Cave",
        // Twenty-one names, as Truitt Cave actually has.
        surveyedBy: "JEANNE PARK, MATT LEWIS, TIM HARRIS, CRIS SEUELL, " +
            "ADRIA TOOLE, NATHAN SCHONEGG, ALEX TAUL, GRACE BOHNENKAMP, " +
            "MONICA GALVEZ, WARREN BRIGGS, LAURA DEMAREST, VALERIE " +
            "SCHUMMER, PETER THOMAS, IRIS SCHONEGG, FOREST GIFFORD, " +
            "MEGAN FLETCHER, JAMES FLETCHER, MATHEW RHULE, MIKE DRAKE, " +
            "RHONDA MATTESON, ADAM STANICH",
        date: "2024-04-06", length: "2154.0 ft", depth: "22.0 ft",
        surveyCode: "UISv2 3-c" },
    survey: null
});
ok(String(said).indexOf("Sheet Setup:") === 0, "it reports what it drew");

function pieces() {
    var out = [];
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (!isNull(e) && CsTags.get(e, "SheetPiece") !== "") {
            out.push(e);
        }
    }
    return out;
}

var drawn = pieces();
ok(drawn.length > 0, "the sheet drew something (" + messages.join(" | ") + ")");

var byLayer = {};
var textHeights = [];
var box = null;
for (var i = 0; i < drawn.length; i++) {
    var layer = CsBind.layerNameOf(doc, drawn[i]);
    byLayer[layer] = (byLayer[layer] || 0) + 1;
    if (drawn[i].getType() === RS.EntityText) {
        textHeights.push(drawn[i].getTextHeight());
    }
    var b = drawn[i].getBoundingBox();
    var mn = b.getMinimum(), mx = b.getMaximum();
    if (box === null) {
        box = { minX: mn.x, minY: mn.y, maxX: mx.x, maxY: mx.y };
    } else {
        box.minX = Math.min(box.minX, mn.x);
        box.minY = Math.min(box.minY, mn.y);
        box.maxX = Math.max(box.maxX, mx.x);
        box.maxY = Math.max(box.maxY, mx.y);
    }
}

ok(byLayer[CsLayers.BORDER] > 0, "a border was drawn");
ok(byLayer[CsLayers.SCALE_BAR] > 0, "a scale bar was drawn");
ok(byLayer[CsLayers.NORTH_ARROW] > 0, "a north arrow was drawn");
ok(byLayer[CsLayers.TITLE_BLOCK] > 0, "a title block was drawn");

// THE SHEET GOES AROUND THE CAVE.
ok(box.minX <= caveBox.minX && box.maxX >= caveBox.maxX,
    "the sheet encloses the cave left to right");
ok(box.minY <= caveBox.minY && box.maxY >= caveBox.maxY,
    "and top to bottom");
near(box.maxX - box.minX, 36 * scale, 1.0,
    "the border is the paper at the plot scale");

// TEXT IS DRAWN AT THE PLOT SCALE -- 0.14 inch is 7 ft at 1" = 50.
var body = false, name = false;
for (i = 0; i < textHeights.length; i++) {
    if (Math.abs(textHeights[i] - 0.14 * scale) < 0.001) {
        body = true;
    }
    if (Math.abs(textHeights[i] - 0.42 * scale) < 0.001) {
        name = true;
    }
}
ok(body, "title block lines are drawn at the printed body size " +
    "(heights seen: " + textHeights.join(", ") + ")");
ok(name, "and the cave's name at the printed heading size");

// THE LOCATION LINE IS EMPTY. This is the privacy rule, checked in the
// drawing rather than in the function that answers it.
var locationText = null;
for (i = 0; i < drawn.length; i++) {
    if (CsTags.get(drawn[i], CsSheet.TAG) === "location") {
        locationText = CsSheet.textOf(drawn[i]);
    }
}
ok(locationText !== null, "the location line is on the sheet to type into");
ok(locationText !== null && locationText.replace(/[^A-Z0-9]/gi, "") ===
    "LOCATION",
    "and holds nothing but its own label (" + locationText + ")");

// THE TITLE BLOCK STAYS INSIDE THE SHEET, and its lines do not sit on
// top of one another. A twenty-one name credit list unwrapped was one
// entity that wrapped inside itself and printed over the six fields
// below it -- seen on the first live run against Truitt Cave.
var titleRows = [];
for (i = 0; i < drawn.length; i++) {
    if (CsBind.layerNameOf(doc, drawn[i]) !== CsLayers.TITLE_BLOCK) {
        continue;
    }
    var tb = drawn[i].getBoundingBox();
    titleRows.push({ min: tb.getMinimum().y, max: tb.getMaximum().y,
        right: tb.getMaximum().x, text: CsSheet.textOf(drawn[i]) });
}
ok(titleRows.length > 0, "the title block has lines");
titleRows.sort(function(a, b) { return b.max - a.max; });
var overlaps = 0;
for (i = 1; i < titleRows.length; i++) {
    if (titleRows[i].max > titleRows[i - 1].min + 0.001) {
        overlaps += 1;
    }
}
eqs(overlaps, 0, "no title block line overlaps the one above it");

var below = 0, offRight = 0;
for (i = 0; i < titleRows.length; i++) {
    if (titleRows[i].min < box.minY) {
        below += 1;
    }
    if (titleRows[i].right > box.maxX) {
        offRight += 1;
    }
}
eqs(below, 0, "no title block line falls off the bottom of the sheet");
eqs(offRight, 0, "and none runs off the right-hand edge");

// THE FURNITURE DOES NOT PRINT OVER THE CAVE. Truitt Cave's title block
// is four inches tall and the margin under three, so the credits rose
// into the passage; the sheet now reserves the band instead.
var intoCave = 0;
for (i = 0; i < titleRows.length; i++) {
    if (titleRows[i].max > caveBox.minY) {
        intoCave += 1;
    }
}
eqs(intoCave, 0,
    "no title block line rises into the drawn cave (cave bottom " +
        caveBox.minY.toFixed(0) + ")");

// A SECOND RUN REPLACES, and measures the CAVE rather than the sheet.
var againBox = SheetSetup.caveBox(doc);
near(againBox.maxX - againBox.minX, 1000, 0.01,
    "a second run measures the cave, not the first run's border -- " +
        "otherwise the sheet grows every time");
SheetSetup.draw(doc, di, {
    caveBox: againBox, sheet: sheet, scale: scale, turned: false,
    wants: { border: true, bar: true, north: true, title: true },
    filled: {}, survey: null, elevation: false
});
eqs(pieces().length, drawn.length,
    "running it twice replaces the sheet rather than stacking one on it");

// A HUMAN'S WORDING SURVIVES a re-run with different computed values.
var typed = null;
for (i = 0; i < pieces().length; i++) {
    if (CsTags.get(pieces()[i], CsSheet.TAG) === "caveName") {
        typed = pieces()[i];
    }
}
ok(typed !== null && CsSheet.textOf(typed).indexOf("TEST CAVE") >= 0,
    "the name typed on the first run survived a second run that was " +
        "told nothing (" + (typed === null ? "no name line" :
            CsSheet.textOf(typed)) + ")");

// AND THE CREDIT LIST SURVIVED IN FULL. A field wrapped over four lines
// has only its first line under CsSheet's own tag, so reading that back
// let every re-run trim a few more surveyors off the end. Twenty-one
// names went in; twenty-one have to still be there.
var creditWhole = null;
var creditLines = 0;
var after = pieces();
for (i = 0; i < after.length; i++) {
    if (CsTags.get(after[i], CsSheet.TAG) === "surveyedBy") {
        creditWhole = CsTags.get(after[i], CsSheetSetup.TAG_FULL);
    }
    if (CsBind.layerNameOf(doc, after[i]) === CsLayers.TITLE_BLOCK &&
            CsSheet.textOf(after[i]).indexOf("STANICH") >= 0) {
        creditLines += 1;
    }
}
ok(creditWhole !== null && String(creditWhole).indexOf("ADAM STANICH") > 0,
    "the whole credit list round-trips through a re-run rather than " +
        "being trimmed to its first line (got: " +
        String(creditWhole).substring(0, 60) + ")");
eqs(creditLines, 1,
    "and the last surveyor is still printed on the sheet");

// ---------------------------------------------------------------------
// THE SECOND SHEET IS A SECOND FILE.
//
// The elevation is drawn at the PLAN's scale -- a map carrying two
// scales is a lie -- and a cave whose plan fills the paper has no room
// left beside it. But two sheets in ONE drawing is one enormous page as
// far as a plotter is concerned, so each sheet is its own file
// (Nathan, 2026-09-10: "it's not easy to print if they're combined").
//
// Here the PAGES are checked: the preview stacks them, and the layout
// arithmetic has to keep them apart and the same size. The FILES are
// checked further down, where there is a record on disk to build from.
// ---------------------------------------------------------------------

var planBox = CsSheetSetup.borderBox(caveBox, sheet, scale, false, 4.0);
var elevBox = CsSheetSetup.elevationSheetBox(planBox, scale);
ok(elevBox.maxY < planBox.minY,
    "the elevation page is stacked BELOW the plan's -- a dock is tall " +
        "and narrow, and two landscape pages side by side in it are " +
        "two postage stamps");
near(elevBox.maxX - elevBox.minX, planBox.width, 0.0001,
    "on the same paper");
near(elevBox.minX, planBox.minX, 0.0001,
    "with their left edges lined up");

// ---------------------------------------------------------------------
// THE RECORD IS NEVER WRITTEN TO.
//
// Laying out a sheet moves the elevation and draws a border round the
// cave. That is a decision about ONE presentation of the map at one
// scale on one size of paper, and the cave's own record should not
// carry it -- so the sheet is built in a copy and written to its own
// file (Nathan, 2026-09-10: "do NOT modify the layout of the original
// map file").
// ---------------------------------------------------------------------

var caveFolder = QDir.tempPath() + "/CaveCADSheetTest/TRUITT CAVE";
try {
    if ((new QDir(QDir.tempPath() + "/CaveCADSheetTest")).exists()) {
        (new QDir(QDir.tempPath() + "/CaveCADSheetTest")).removeRecursively();
    }
} catch (eWipe) {
}
ok((new QDir()).mkpath(caveFolder), "made a cave folder");

var recordPath = caveFolder + "/Truitt Cave.dxf";
// A scan in each frame, stored the way an aligned one is: an image on
// that frame's own scan layer. A sheet is plotted, and a scan is what
// you trace FROM -- so none of these may reach one.
function addScan(layer, x, y) {
    CsLayers.ensure(recordDoc, recordDi, layer);
    var img = new RImageEntity(recordDoc, new RImageData(
        repoRoot + "/testdata/Elevation_3DEP_64.tif",
        new RVector(x, y), new RVector(1, 0), new RVector(0, 1),
        64, 64, 0));
    img.setLayerId(recordDoc.getLayerId(layer));
    var op = new RAddObjectsOperation();
    op.addObject(img, false);
    recordDi.applyOperation(op);
}
var recordDi = new RDocumentInterface(
    new RDocument(new RMemoryStorage(), createSpatialIndex()));
var recordDoc = recordDi.getDocument();
CsLayers.ensure(recordDoc, recordDi, CsLayers.WALLS_SURVEYED);
var wall = new RLineEntity(recordDoc,
    new RLineData(new RVector(0, 0), new RVector(600, 300)));
wall.setLayerId(recordDoc.getLayerId(CsLayers.WALLS_SURVEYED));
var recOp = new RAddObjectsOperation();
recOp.addObject(wall, false);
recordDi.applyOperation(recOp);
// An elevation in the record, so there is something for a profile
// sheet to be about.
CsLayers.ensure(recordDoc, recordDi, CsLayers.PROFILE_WALLS_SURVEYED);
var band = new RLineEntity(recordDoc,
    new RLineData(new RVector(0, -900), new RVector(700, -900)));
band.setLayerId(recordDoc.getLayerId(CsLayers.PROFILE_WALLS_SURVEYED));
var bandOp = new RAddObjectsOperation();
bandOp.addObject(band, false);
recordDi.applyOperation(bandOp);

addScan(CsLayers.CTRL_SCAN, 10, 10);
addScan(CsLayers.CTRL_PROFILE_SCAN, 10, -900);
addScan(CsLayers.CTRL_SECTION_SCAN, 900, 10);
// AND ONE ON LAYER 0, which is where two of Truitt Cave's forty-two
// actually sit -- placed before the alignment tools existed, or
// dragged in by hand. A rule that trusts the layer lets those through.
addScan("0", 200, 200);
ok(recordDi.exportFile(recordPath, CsSanitize.dxfFilter()),
    "wrote a cave record to disk");

var beforeSize = (new QFileInfo(recordPath)).size();
var beforeStamp = String((new QFileInfo(recordPath)).lastModified()
    .toString());

var reported = SheetSetup.intoCopy(recordPath, {
    caveBox: { minX: 0, minY: 0, maxX: 600, maxY: 300 },
    sheet: sheet, scale: 50, turned: false,
    wants: { border: true, bar: true, north: true, title: true },
    filled: { caveName: "Truitt Cave" }, survey: null, elevation: true
});
ok(String(reported).indexOf("Sheet Setup:") === 0,
    "the copy path reports what it did (" + reported + ")");

var sheetPath = CsSheetSetup.sheetPathFor(caveFolder, "Truitt Cave",
    CsSheetSetup.PLAN_SHEET);
var profilePath = CsSheetSetup.sheetPathFor(caveFolder, "Truitt Cave",
    CsSheetSetup.ELEVATION_SHEET);
ok((new QFileInfo(sheetPath)).exists(),
    "the plan sheet was written to its own file at " + sheetPath);
ok((new QFileInfo(profilePath)).exists(),
    "and the profile sheet to a SECOND file -- two sheets in one " +
        "drawing is one enormous page as far as a plotter is concerned");
ok(sheetPath !== profilePath, "which are not the same file");

eqs((new QFileInfo(recordPath)).size(), beforeSize,
    "and the cave's own record is exactly the size it was");
eqs(String((new QFileInfo(recordPath)).lastModified().toString()),
    beforeStamp,
    "and was not written to at all");

// The record still has no sheet in it; the copy does.
var backDi = new RDocumentInterface(
    new RDocument(new RMemoryStorage(), createSpatialIndex()));
backDi.importFile(recordPath, "", false);
var backDoc = backDi.getDocument();
var inRecord = 0;
var recIds = backDoc.queryAllEntities(false, false);
for (i = 0; i < recIds.length; i++) {
    var re = backDoc.queryEntity(recIds[i]);
    if (!isNull(re) && CsTags.get(re, "SheetPiece") !== "") {
        inRecord += 1;
    }
}
eqs(inRecord, 0, "the record carries no sheet furniture");

var copyDi = new RDocumentInterface(
    new RDocument(new RMemoryStorage(), createSpatialIndex()));
copyDi.importFile(sheetPath, "", false);
var copyDoc = copyDi.getDocument();
var inCopy = 0, wallsInCopy = 0;
var copyIds = copyDoc.queryAllEntities(false, false);
for (i = 0; i < copyIds.length; i++) {
    var ce = copyDoc.queryEntity(copyIds[i]);
    if (isNull(ce)) { continue; }
    if (CsTags.get(ce, "SheetPiece") !== "") { inCopy += 1; }
    if (CsBind.layerNameOf(copyDoc, ce) === CsLayers.WALLS_SURVEYED) {
        wallsInCopy += 1;
    }
}
ok(inCopy > 0, "the copy carries the sheet");
ok(wallsInCopy > 0,
    "and the cave itself -- a sheet with no map on it is a border");

// EACH FILE KEEPS ONE VIEW. A plan sheet quietly carrying the elevation
// off the paper would plot it; a profile sheet carrying the plan would
// be a plan sheet with its border in the wrong place.
function frameCounts(path) {
    var fdi = new RDocumentInterface(
        new RDocument(new RMemoryStorage(), createSpatialIndex()));
    fdi.importFile(path, "", false);
    var fdoc = fdi.getDocument();
    var out = { plan: 0, profile: 0, north: 0, marked:
        CsSheetFile.isSheet(fdoc), images: 0 };
    var fids = fdoc.queryAllEntities(false, true);
    for (var f = 0; f < fids.length; f++) {
        var fe = fdoc.queryEntity(fids[f]);
        if (isNull(fe)) { continue; }
        if (fe.getType() === RS.EntityImage) { out.images += 1; }
        // The sheet's own furniture is not the VIEW, and neither is
        // the mark that says this is a sheet -- which lives on
        // CTRL-HIDDEN and so counts as plan-frame if you let it.
        if (CsBind.layerNameOf(fdoc, fe) === CsLayers.NORTH_ARROW) {
            out.north += 1;
        }
        if (CsTags.get(fe, "SheetPiece") !== "" ||
                CsTags.get(fe, CsSheetFile.TAG) !== "") {
            continue;
        }
        var fl = CsBind.layerNameOf(fdoc, fe);

        var fr = CsLayers.frameOf(fl);
        if (fr === "plan") { out.plan += 1; }
        if (fr === "profile") { out.profile += 1; }
    }
    return out;
}

var planFile = frameCounts(sheetPath);
var profileFile = frameCounts(profilePath);

ok(planFile.plan > 0, "the plan sheet has the plan on it");
eqs(planFile.profile, 0, "and no elevation at all");
ok(planFile.north > 0, "with a north arrow");

ok(profileFile.profile > 0, "the profile sheet has the elevation on it");
eqs(profileFile.plan, 0, "and no plan at all");
eqs(profileFile.north, 0,
    "and NO north arrow -- an elevation has no north, and an arrow " +
        "there would answer a question the drawing cannot be asked");

ok(planFile.marked && profileFile.marked,
    "both files are marked as sheets");
eqs(planFile.images + profileFile.images, 0,
    "and neither carries a raster of any kind");

// ---------------------------------------------------------------------
// A SHEET IS MARKED, AND AN UNTICKED ELEVATION IS GONE FROM IT.
// ---------------------------------------------------------------------

var markedDi = new RDocumentInterface(
    new RDocument(new RMemoryStorage(), createSpatialIndex()));
markedDi.importFile(sheetPath, "", false);
ok(CsSheetFile.isSheet(markedDi.getDocument()),
    "the sheet that was built is marked as a sheet");

// The MARK, not just the path: a sheet moved out of its folder is
// still a sheet, and the mark is the half that travels with the file.
var marks = 0;
var markIds = markedDi.getDocument().queryAllEntities(false, true);
for (i = 0; i < markIds.length; i++) {
    var me = markedDi.getDocument().queryEntity(markIds[i]);
    if (!isNull(me) && CsTags.get(me, CsSheetFile.TAG) !== "") {
        marks += 1;
    }
}
ok(marks >= 1,
    "and carries the mark inside it, so moving the file out of the " +
        "sheets folder does not make it editable again");

// UNTICKED MEANS GONE. The copy comes from the record, so the elevation
// is IN it -- a thousand feet below the plan, outside the border, on a
// drawing whose whole promise is that it is what gets plotted.
var elevDoc = new RDocumentInterface(
    new RDocument(new RMemoryStorage(), createSpatialIndex()));
elevDoc.importFile(sheetPath, "", false);
var profileLeft = 0;
var pIds = elevDoc.getDocument().queryAllEntities(false, true);
for (i = 0; i < pIds.length; i++) {
    var pe = elevDoc.getDocument().queryEntity(pIds[i]);
    if (isNull(pe)) { continue; }
    if (CsLayers.frameOf(CsBind.layerNameOf(elevDoc.getDocument(), pe)) ===
            "profile") {
        profileLeft += 1;
    }
}
eqs(profileLeft, 0,
    "with the elevation unticked, nothing profile-framed survives into " +
        "the sheet -- a sheet that quietly carries a view nobody asked " +
        "for is a sheet that plots one");

// INCLUDING THE BAND BOXES, which live on a LOCKED layer. Off, frozen
// and locked are three separate silent refusals, and clearing only the
// first two left sixteen invisible boxes in a real sheet -- enough for
// the next Generate Profile to think the elevation was still there.
var boxesLeft = 0;
for (i = 0; i < pIds.length; i++) {
    var be = elevDoc.getDocument().queryEntity(pIds[i]);
    if (!isNull(be) &&
            CsBind.layerNameOf(elevDoc.getDocument(), be) ===
                CsLayers.CTRL_PROFILE_BOX) {
        boxesLeft += 1;
    }
}
eqs(boxesLeft, 0, "the band boxes went too, locked layer and all");

// AND NO SKETCH SCANS, in any frame, whatever else was ticked. A
// scanned field book page is a tracing reference: it is under the
// drawing so a cartographer can follow it, and everything worth
// keeping off it has already been traced. On a sheet it is a
// photograph of somebody's handwriting printed under the map -- on
// Truitt Cave, forty-two of them.
var scansLeft = [];
for (i = 0; i < pIds.length; i++) {
    var se = elevDoc.getDocument().queryEntity(pIds[i]);
    if (isNull(se)) { continue; }
    var sl = CsBind.layerNameOf(elevDoc.getDocument(), se);
    if (sl === CsLayers.CTRL_SCAN || sl === CsLayers.CTRL_PROFILE_SCAN ||
            sl === CsLayers.CTRL_SECTION_SCAN) {
        scansLeft.push(sl);
    }
}
eqs(scansLeft.length, 0,
    "no sketch scan reaches a sheet, in any frame (" +
        scansLeft.join(", ") + ")");

// THE RULE IS THE ENTITY, not the layer: a sheet carries no raster at
// all, wherever somebody put it.
var rasters = 0;
for (i = 0; i < pIds.length; i++) {
    var ie = elevDoc.getDocument().queryEntity(pIds[i]);
    if (!isNull(ie) && ie.getType() === RS.EntityImage) {
        rasters += 1;
    }
}
eqs(rasters, 0,
    "and no image of any kind, on any layer -- including the one " +
        "sitting on layer 0");

// The record keeps its own, which is where they belong.
var recScans = 0;
var recCheck = new RDocumentInterface(
    new RDocument(new RMemoryStorage(), createSpatialIndex()));
recCheck.importFile(recordPath, "", false);
var recIds2 = recCheck.getDocument().queryAllEntities(false, true);
for (i = 0; i < recIds2.length; i++) {
    var rse = recCheck.getDocument().queryEntity(recIds2[i]);
    if (isNull(rse)) { continue; }
    var rsl = CsBind.layerNameOf(recCheck.getDocument(), rse);
    if (rsl === CsLayers.CTRL_SCAN ||
            rsl === CsLayers.CTRL_PROFILE_SCAN ||
            rsl === CsLayers.CTRL_SECTION_SCAN) {
        recScans += 1;
    }
}
eqs(recScans, 3,
    "and the cave's own drawing still has all three of the framed " +
        "ones, plus the stray on layer 0 -- the record keeps every " +
        "scan, which is where they belong");

try {
    (new QDir(QDir.tempPath() + "/CaveCADSheetTest")).removeRecursively();
} catch (eClean) {
}

if (failures.length === 0) {
    print("### SHEET SETUP OK " + drawn.length + " pieces");
} else {
    print("### SHEET SETUP FAIL " + failures.length);
    for (var f = 0; f < failures.length; f++) {
        print("  FAIL: " + failures[f]);
    }
}
