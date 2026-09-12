// wall_edging_run.js -- the Wall Edging switch, against a real drawing.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/wall_edging_run.js "$PWD"
//
// The side geometry itself is unit-tested in js_unit.js. What can only
// be asked of a real document is here: that the switch dresses the
// right walls and no others, that turning it off puts the drawing back,
// and that turning it on again reproduces the SAME glyphs rather than
// reshuffling a wall the caver has been looking at.

if (typeof createSpatialIndex === "undefined") {
    createSpatialIndex = function() { return new RSpatialIndexNavel(); };
}
var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];

include("scripts/EAction.js");
include("scripts/simple.js");
includeBasePath = repoRoot + "/scripts/CaveSurvey/Core";
include(includeBasePath + "/CsAll.js");
includeBasePath = repoRoot + "/scripts/CaveSurvey/ShapedLines";
include(includeBasePath + "/WallEdging.js");

// THE NATIVE isNull CANNOT SEE THIS BUILD'S PROXY WRAPPER, so a test
// that asks whether a block exists gets the wrong answer. library.js's
// own algorithm does check, and it is copied EXACTLY here -- a
// simplified version is worse than none: an approximation that drops
// the `v.data` guard answers true for objects whose isNull() means
// something else, and the GENERATED api wrappers use isNull for
// overload dispatch, so queryAllEntities(false, true) quietly returned
// 0 entities instead of 3 (measured 2026-09-12, and it cost an hour).
isNull = function(v) {
    if (v === undefined || v === null) { return true; }
    try {
        if (RSettings.getQtVersion() >= 0x060000 &&
                v.hasOwnProperty("__PROXY__")) {
            return isNull(v.__PROXY__);
        }
    } catch (eProxy) {}
    try {
        if (typeof v.isNullWrapper === "function" &&
                v.isNullWrapper() === true) { return true; }
    } catch (eWrap) {}
    try {
        if (typeof v.data === "function" && typeof v.isNull === "function" &&
                v.isNull() === true) { return true; }
    } catch (eData) {}
    return false;
};

var failures = [];
function ok(c, w) { if (!c) { failures.push(w); } }
function eqs(a, b, w) {
    ok(a === b, w + " (expected " + JSON.stringify(b) + ", got " +
        JSON.stringify(a) + ")");
}

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var di = new RDocumentInterface(doc);
CsLayers.ensureSurveyLayers(doc, di);
// ensureSurveyLayers does not make these in a bare document -- ask for
// them by name, or everything lands on layer -1 and the adds vanish.
CsLayers.ensure(doc, di, CsLayers.WALLS_SURVEYED);
CsLayers.ensure(doc, di, CsLayers.WALLS_INFERRED);
CsLayers.ensure(doc, di, CsLayers.CTRL_STATIONS);
CsLayers.ensure(doc, di, CsLayers.CTRL_SHAPE_SPINE);
CsLayers.ensure(doc, di, CsLayers.WALL_GLYPHS);

// the glyph block must exist for decoration to place anything
var tmplPath = CsSymbolStore.templatePath();
ok(!isNull(tmplPath), "the template is findable");
if (!isNull(tmplPath)) {
    CsSymbolStore.ensureBlock(doc, di, "SYM_BREAKDOWN", tmplPath);
}
ok(!isNull(doc.queryBlock("SYM_BREAKDOWN")),
    "the stone glyph block is in the drawing");

function addStation(x, y, name) {
    // THROUGH withLayerOn: CTRL-STATIONS ships hidden, and this build
    // refuses an add to a hidden layer without saying so -- the fixture
    // looked fine and had no survey in it at all, which made every wall
    // fall back to its default side and hid the fin test entirely.
    CsLayers.withLayerOn(doc, di, CsLayers.CTRL_STATIONS, function() {
        var op = new RAddObjectsOperation();
        var p = new RPointEntity(doc, new RPointData(new RVector(x, y)));
        p.setLayerId(doc.getLayerId(CsLayers.CTRL_STATIONS));
        CsTags.set(p, "Station", name);
        op.addObject(p, false);
        di.applyOperation(op);
    });
}

function addWall(pts, layerName) {
    var made = null;
    CsLayers.withLayerOn(doc, di, layerName, function() {
    var op = new RAddObjectsOperation();
    var pl = new RPolyline();
    for (var i = 0; i < pts.length; i++) {
        pl.appendVertex(new RVector(pts[i].x, pts[i].y));
    }
    var e = new RPolylineEntity(doc, new RPolylineData(pl));
    e.setLayerId(doc.getLayerId(layerName));
    op.addObject(e, false);
    di.applyOperation(op);
    made = e.getId();
    });
    return made;
}

// A passage running east, stations down its middle; walls north and
// south of it. Plus a fin: a second passage just north of the north
// wall, so that wall has cave on both faces.
var s;
for (s = 0; s <= 80; s += 10) { addStation(s, 0, "A" + s); }
for (s = 0; s <= 40; s += 10) { addStation(s, 24, "B" + s); }

var southId = addWall([{x:0,y:-10},{x:20,y:-10},{x:40,y:-10},
                       {x:60,y:-10},{x:80,y:-10}], CsLayers.WALLS_SURVEYED);
var northId = addWall([{x:0,y:12},{x:20,y:12},{x:40,y:12},
                       {x:60,y:12},{x:80,y:12}], CsLayers.WALLS_SURVEYED);
var inferredId = addWall([{x:0,y:-14},{x:40,y:-14},{x:80,y:-14}],
    CsLayers.WALLS_INFERRED);

// ---- ON ---------------------------------------------------------------

eqs(WallEdging.isOn(doc), false, "the switch starts off");
var r1 = WallEdging.applySwitch(doc, di, true, doc.getTransactionGroup() + 1);
eqs(WallEdging.isOn(doc), true, "and the switch reads on afterwards");
ok(r1.dressed >= 2, "both surveyed walls were dressed (got " +
    r1.dressed + ")");

var inferred = doc.queryEntity(inferredId);
eqs(CsTags.get(inferred, CsShapeLine.KEY.STYLE), "",
    "WALLS-INFERRED is never edged -- it is the unmeasured stretch");

function glyphsOf(id) {
    var sp = doc.queryEntity(id);
    var sid = CsTags.get(sp, CsShapeLine.KEY.ID);
    if (sid === "") { return []; }
    var out = [];
    // decorOf hands back ENTITIES, not ids -- re-querying them as ids
    // returns nothing and reports a bare wall while its glyphs sit in
    // the drawing.
    var found = CsShapeLine.decorOf(doc, sid);
    for (var i = 0; i < found.length; i++) {
        var e = found[i];
        if (isNull(e)) {
            continue;
        }
        // BOUNDING BOX CENTRE, not getPosition: a block reference in
        // this build does not answer getPosition through the wrapper,
        // and a helper that skips what it cannot read reported an
        // empty wall while ten glyphs sat in the drawing.
        try {
            var c = e.getBoundingBox().getCenter();
            out.push({ x: c.x, y: c.y });
        } catch (eBox) {
        }
    }
    out.sort(function(A, B) { return A.x - B.x || A.y - B.y; });
    return out;
}

var southGlyphs = glyphsOf(southId);
var northGlyphs = glyphsOf(northId);
ok(southGlyphs.length > 0, "the south wall got glyphs (" +
    southGlyphs.length + ")");

// OUTSIDE: the passage is at y=0 and the south wall at y=-10, so its
// glyphs must sit BELOW it, further from the survey, not above.
var wrongSide = 0;
for (var g = 0; g < southGlyphs.length; g++) {
    if (southGlyphs[g].y > -10) { wrongSide++; }
}
eqs(wrongSide, 0, "every south-wall glyph sits on the far side from the " +
    "survey -- outside the cave, not in it");

// THE FIN: the north wall has passage at y=0 and y=24, so much of it
// has no outside and must be left barer than the open south wall.
ok(northGlyphs.length < southGlyphs.length,
    "the wall with passage on both faces gets fewer glyphs than the " +
    "open one (north " + northGlyphs.length + " vs south " +
    southGlyphs.length + ")");

// ---- OFF --------------------------------------------------------------

var southBefore = doc.queryEntity(southId).getBoundingBox();
var r2 = WallEdging.applySwitch(doc, di, false, doc.getTransactionGroup() + 1);
eqs(WallEdging.isOn(doc), false, "the switch reads off again");
ok(r2.removed >= 2, "both walls were cleared (got " + r2.removed + ")");
eqs(glyphsOf(southId).length, 0, "and the glyphs are gone");

var southAfter = doc.queryEntity(southId).getBoundingBox();
ok(Math.abs(southBefore.getWidth() - southAfter.getWidth()) < 1e-9 &&
   Math.abs(southBefore.getHeight() - southAfter.getHeight()) < 1e-9,
    "the wall itself is untouched -- edging adds and removes ornament, " +
    "never geometry");

var seedKept = CsTags.get(doc.queryEntity(southId), CsShapeLine.KEY.SEED);
ok(seedKept !== "", "the SEED survives being switched off -- that is " +
    "what makes on/off/on reproduce the same wall");

// ---- ON AGAIN, and it must look the same ------------------------------

WallEdging.applySwitch(doc, di, true, doc.getTransactionGroup() + 1);
var southAgain = glyphsOf(southId);
eqs(southAgain.length, southGlyphs.length,
    "switching back on puts the same NUMBER of glyphs back");
var drift = 0;
for (var q = 0; q < Math.min(southAgain.length, southGlyphs.length); q++) {
    drift += Math.abs(southAgain[q].x - southGlyphs[q].x) +
        Math.abs(southAgain[q].y - southGlyphs[q].y);
}
ok(drift < 1e-6, "and in the SAME PLACES -- a toggle must not reshuffle " +
    "a wall the caver has been looking at (drift " + drift + ")");

// ---- the switch survives a save and reopen ---------------------------

var tmp = repoRoot + "/tests/.wall_edging.dxf";
var saved = false;
try { saved = di.exportFile(tmp, "DXF 2013"); } catch (eE) { saved = false; }
ok(saved === true, "the drawing exports");
if (saved) {
    var back = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var bdi = new RDocumentInterface(back);
    var read = false;
    try {
        read = (bdi.importFile(tmp, "") === RDocumentInterface.IoErrorNoError);
    } catch (eI) { read = false; }
    ok(read === true, "and reads back");
    if (read) {
        eqs(WallEdging.isOn(back), true,
            "the switch is still on after save and reopen -- it rides " +
            "the drawing, not a setting");
    }
    try { new QFile(tmp).remove(); } catch (eR) {}
}

if (failures.length > 0) {
    print("### WALL EDGING FAIL " + failures.length);
    for (var f = 0; f < failures.length; f++) { print("  FAIL: " + failures[f]); }
    QCoreApplication.exit(1);
} else {
    print("### WALL EDGING OK");
    QCoreApplication.exit(0);
}
