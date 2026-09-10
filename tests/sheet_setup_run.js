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
// THE SECOND SHEET.
//
// The elevation is drawn at the PLAN's scale -- a map carrying two
// scales is a lie -- and a cave whose plan fills the paper has no room
// left beside it, so the elevation gets its own sheet rather than a
// scale step nobody asked for.
// ---------------------------------------------------------------------

var planBox = CsSheetSetup.borderBox(caveBox, sheet, scale, false, 4.0);
var elevBox = CsSheetSetup.elevationSheetBox(planBox, scale);
ok(elevBox.minX > planBox.maxX,
    "the elevation sheet sits clear to the right of the plan's");
near(elevBox.maxX - elevBox.minX, planBox.width, 0.0001,
    "on the same paper");
near(elevBox.minY, planBox.minY, 0.0001,
    "with their feet lined up, the way two sheets on a table are");

var withElevation = SheetSetup.draw(doc, di, {
    caveBox: caveBox, sheet: sheet, scale: scale, turned: false,
    wants: { border: true, bar: true, north: true, title: true },
    filled: { caveName: "Test Cave" }, survey: null, elevation: true
});
ok(String(withElevation).indexOf("elevation sheet") > 0,
    "it reports drawing one (" + withElevation + ")");

var elevPieces = 0, northOnElevation = 0, elevBorder = null;
var after2 = pieces();
for (i = 0; i < after2.length; i++) {
    if (CsTags.get(after2[i], "SheetPiece") !==
            CsSheetSetup.ELEVATION_SHEET) {
        continue;
    }
    elevPieces += 1;
    if (CsBind.layerNameOf(doc, after2[i]) === CsLayers.NORTH_ARROW) {
        northOnElevation += 1;
    }
    var eb = after2[i].getBoundingBox();
    var emn = eb.getMinimum(), emx = eb.getMaximum();
    if (elevBorder === null) {
        elevBorder = { minX: emn.x, maxX: emx.x };
    } else {
        elevBorder.minX = Math.min(elevBorder.minX, emn.x);
        elevBorder.maxX = Math.max(elevBorder.maxX, emx.x);
    }
}
ok(elevPieces > 0, "the elevation sheet has pieces on it");
eqs(northOnElevation, 0,
    "and NO north arrow -- an elevation has no north, and an arrow " +
        "there would be answering a question the drawing cannot be asked");
ok(elevBorder !== null && elevBorder.minX > planBox.maxX,
    "everything on it is clear of the plan sheet");

// THE SHEET IS FOUND BY ITS BORDER, which is how CsProfileDraw learns
// where to put the elevation region on the next regenerate. A stored
// coordinate would go stale the first time the cave grew.
var read = CsSheetSetup.sheetBoxOn(doc, CsSheetSetup.ELEVATION_SHEET);
ok(read !== null, "the elevation sheet can be found again by its tag");
ok(read.minX > planBox.maxX,
    "and it is the one to the right, not the plan's");

if (failures.length === 0) {
    print("### SHEET SETUP OK " + drawn.length + " pieces");
} else {
    print("### SHEET SETUP FAIL " + failures.length);
    for (var f = 0; f < failures.length; f++) {
        print("  FAIL: " + failures[f]);
    }
}
