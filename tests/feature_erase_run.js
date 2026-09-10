// feature_erase_run.js -- taking one stroke back without losing the
// four good ones after it.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/feature_erase_run.js "$PWD"
//
// Prints "### FEATURE ERASE OK <n>" or "### FEATURE ERASE FAIL".
//
// Undo is a stack and a bad stroke is not always the last one: trace
// five walls, notice the third wandered, and Ctrl+Z three times costs
// the two good ones that followed. Erase and Delete Last both remove
// ONE thing and leave the rest standing.
//
// What only a real RDocument can prove:
//
//   - a click erases the caver's own linework and CANNOT reach the
//     survey. This is the whole safety claim: the centerline, the
//     stations, the LRUD and the scans sit on CTRL- layers no panel
//     lists, and a click that lands on one of them must do NOTHING;
//   - a shaped line goes WHOLE -- spine and every piece of ornament,
//     from a click on either -- rather than leaving forty hachures
//     behind that no tool can name;
//   - a click that misses erases nothing at all, rather than taking
//     whatever happened to be nearest;
//   - Delete Last refuses a stroke that CONTINUED a line, because that
//     entity is the whole wall, every earlier stroke included;
//   - a hidden layer is not erasable: a delete nothing on screen can
//     show is a delete the caver cannot notice.

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
includeBasePath = repoRoot + "/scripts/CaveSurvey/FeatureTrace";
include(includeBasePath + "/FeatureTraceRun.js");
include(includeBasePath + "/FeatureTrace.js");
include(includeBasePath + "/FeatureEraseRun.js");
includeBasePath = repoRoot + "/scripts/CaveSurvey/ShapedLines";
include(includeBasePath + "/ShapedLinesRun.js");

var passed = 0;
var failures = [];
function ok(condition, what) {
    if (condition) {
        passed++;
    } else {
        failures.push(what);
    }
}
function eqs(a, b, what) {
    ok(a === b, what + " (expected " + JSON.stringify(b) +
        ", got " + JSON.stringify(a) + ")");
}

var messages = [];
warning = function(text) { messages.push("WARNING: " + text); };
EAction.handleUserMessage = function(text) { messages.push(text); };

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var di = new RDocumentInterface(doc);
getDocument = function() { return doc; };
getDocumentInterface = function() { return di; };

FeatureTrace.target = CsLayers.WALLS_SURVEYED;

function trace(points, shift) {
    var action = {
        getDocument: function() { return doc; },
        getDocumentInterface: function() { return di; },
        samples: points,
        region: null,
        bays: [],
        extendForced: (shift === true),
        refreshRegion: FeatureTraceRun.prototype.refreshRegion,
        extendTarget: FeatureTraceRun.prototype.extendTarget,
        stampSection: FeatureTraceRun.prototype.stampSection,
        warnUnclaimedProfile: FeatureTraceRun.prototype.warnUnclaimedProfile
    };
    action.refreshRegion();
    FeatureTraceRun.prototype.commit.call(action);
}

function walk(x0, y0, x1, y1, steps) {
    var out = [];
    for (var i = 0; i <= steps; i++) {
        var t = i / steps;
        out.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t });
    }
    return out;
}

function on(layerName) {
    if (!doc.hasLayer(layerName)) {
        return [];
    }
    return doc.queryLayerEntities(doc.getLayerId(layerName), true);
}

var TOL = FeatureEraseRun.tolerance(doc);
var LAYERS = FeatureEraseRun.layers();

// ---------------------------------------------------------------------
// The list a click may reach.
// ---------------------------------------------------------------------

function listed(name) {
    for (var i = 0; i < LAYERS.length; i++) {
        if (LAYERS[i] === name) {
            return true;
        }
    }
    return false;
}

ok(listed(CsLayers.WALLS_SURVEYED), "the panel's own plan layer is erasable");
ok(listed(CsLayers.PROFILE_FLOOR),
    "and its elevation twin -- erase works in every view the panel draws in");
ok(listed(CsLayers.SECTION_WALLS_SURVEYED), "and its section twin");
ok(!listed(CsLayers.CTRL_SHOTS),
    "the CENTERLINE is not erasable, which is the whole safety claim");
ok(!listed(CsLayers.CTRL_STATIONS), "nor are the stations");
ok(!listed(CsLayers.CTRL_LRUD), "nor the LRUD");
ok(!listed(CsLayers.CTRL_SCAN), "nor a scanned page under the drawing");

// ---------------------------------------------------------------------
// Four walls; the third one goes, and the fourth stays.
// ---------------------------------------------------------------------

trace(walk(0, 0, 20, 0, 20));
trace(walk(0, 40, 20, 40, 20));
trace(walk(0, 80, 20, 80, 20));
trace(walk(0, 120, 20, 120, 20));
eqs(on(CsLayers.WALLS_SURVEYED).length, 4, "four separate walls were traced");

var third = CsErase.eraseAt(doc, di, { x: 10, y: 80 }, LAYERS, TOL);
ok(third !== null, "a click on the third wall found it");
eqs(on(CsLayers.WALLS_SURVEYED).length, 3,
    "and erased it -- one line, not the stack of strokes after it");
var stillThere = 0;
var walls = on(CsLayers.WALLS_SURVEYED);
for (var wi = 0; wi < walls.length; wi++) {
    var end = doc.queryEntity(walls[wi]).getStartPoint();
    if (Math.abs(end.y - 120) < 1.0) {
        stillThere++;
    }
}
eqs(stillThere, 1, "the wall traced AFTER it is untouched, which undo " +
    "three times would have taken");

// ---------------------------------------------------------------------
// A miss erases nothing.
// ---------------------------------------------------------------------

var before = on(CsLayers.WALLS_SURVEYED).length;
var miss = CsErase.eraseAt(doc, di, { x: 10, y: 60 }, LAYERS, TOL);
eqs(miss, null, "a click twenty feet from every line answers null");
eqs(on(CsLayers.WALLS_SURVEYED).length, before,
    "and deletes nothing -- not the nearest line at any distance");

// ---------------------------------------------------------------------
// The survey is out of reach, even under the cursor.
// ---------------------------------------------------------------------

CsLayers.ensure(doc, di, CsLayers.CTRL_SHOTS);
var legOp = new RAddObjectsOperation();
var leg = new RLineEntity(doc, new RLineData(
    new RVector(0, 200), new RVector(20, 200)));
leg.setLayerId(doc.getLayerId(CsLayers.CTRL_SHOTS));
legOp.addObject(leg, false);
di.applyOperation(legOp);
eqs(on(CsLayers.CTRL_SHOTS).length, 1, "fixture: a survey leg is drawn");

var atLeg = CsErase.eraseAt(doc, di, { x: 10, y: 200 }, LAYERS, TOL);
eqs(atLeg, null, "a click right on the centerline erases nothing");
eqs(on(CsLayers.CTRL_SHOTS).length, 1, "and the leg is still there");

// ---------------------------------------------------------------------
// A hidden line cannot be erased.
// ---------------------------------------------------------------------

(function hiddenStaysPut() {
    trace(walk(300, 0, 320, 0, 20));
    var layerId = doc.getLayerId(CsLayers.WALLS_SURVEYED);
    var lay = doc.queryLayer(layerId);
    var was = on(CsLayers.WALLS_SURVEYED).length;
    lay.setFrozen(true);
    var freezeOp = new RModifyObjectsOperation();
    freezeOp.addObject(lay, false);
    di.applyOperation(freezeOp);

    var hit = CsErase.eraseAt(doc, di, { x: 310, y: 0 }, LAYERS, TOL);
    eqs(hit, null, "a click on a FROZEN layer's line erases nothing -- a " +
        "delete nothing on screen can show is one the caver cannot notice");
    eqs(on(CsLayers.WALLS_SURVEYED).length, was, "and it is still there");

    lay = doc.queryLayer(layerId);
    lay.setFrozen(false);
    var thawOp = new RModifyObjectsOperation();
    thawOp.addObject(lay, false);
    di.applyOperation(thawOp);
})();

// ---------------------------------------------------------------------
// A shaped line goes whole, from a click on its ornament.
// ---------------------------------------------------------------------

(function shapedGoesWhole() {
    var a = {
        styleKey: "floorledge",
        getDocument: function() { return doc; },
        getDocumentInterface: function() { return di; },
        samples: walk(500, 500, 540, 500, 20),
        spinePts: null, spineClosed: false, side: 1, pathFrame: null,
        region: null, bays: [], growId: null, extendForced: false,
        refreshFrames: ShapedLinesRun.prototype.refreshFrames,
        prepare: ShapedLinesRun.prototype.prepare,
        buildSpine: ShapedLinesRun.prototype.buildSpine,
        extendTarget: ShapedLinesRun.prototype.extendTarget,
        growExisting: ShapedLinesRun.prototype.growExisting,
        commit: ShapedLinesRun.prototype.commit
    };
    a.refreshFrames();
    ok(a.prepare(), "the ledge stroke was accepted");
    a.growId = a.extendTarget();
    a.commit();

    var spines = CsShapeLine.spines(doc);
    eqs(spines.length, 1, "one ledge was drawn");
    if (spines.length !== 1) {
        return;
    }
    var decor = CsShapeLine.decorOf(doc, spines[0].id);
    ok(decor.length > 0, "with ornament along it");

    // Click ON A HACHURE, which is what a caver aiming at a ledge hits
    // as often as the spine.
    var tick = decor[0].getStartPoint();
    var gone = CsErase.eraseAt(doc, di, { x: tick.x, y: tick.y },
        LAYERS, TOL);
    ok(gone !== null, "a click on the ornament found the feature");
    eqs(CsShapeLine.spines(doc).length, 0, "the SPINE went with it");
    eqs(CsShapeLine.decorOf(doc, spines[0].id).length, 0,
        "and so did every piece of ornament -- no hachures left standing " +
            "with nothing to belong to");
})();

// ---------------------------------------------------------------------
// The same, clicked on the SPINE -- the other way in.
// ---------------------------------------------------------------------

(function shapedFromTheSpine() {
    var a = {
        styleKey: "floorledge",
        getDocument: function() { return doc; },
        getDocumentInterface: function() { return di; },
        samples: walk(600, 600, 640, 600, 20),
        spinePts: null, spineClosed: false, side: 1, pathFrame: null,
        region: null, bays: [], growId: null, extendForced: false,
        refreshFrames: ShapedLinesRun.prototype.refreshFrames,
        prepare: ShapedLinesRun.prototype.prepare,
        buildSpine: ShapedLinesRun.prototype.buildSpine,
        extendTarget: ShapedLinesRun.prototype.extendTarget,
        growExisting: ShapedLinesRun.prototype.growExisting,
        commit: ShapedLinesRun.prototype.commit
    };
    a.refreshFrames();
    ok(a.prepare(), "the second ledge stroke was accepted");
    a.growId = a.extendTarget();
    a.commit();

    var spines = CsShapeLine.spines(doc);
    eqs(spines.length, 1, "one ledge stands");
    if (spines.length !== 1) {
        return;
    }
    var decorWas = CsShapeLine.decorOf(doc, spines[0].id).length;
    ok(decorWas > 0, "with ornament along it");
    var start = spines[0].entity.getStartPoint();
    var gone = CsErase.eraseAt(doc, di, { x: start.x, y: start.y },
        LAYERS, TOL);
    ok(gone !== null, "a click on the SPINE found the feature too");
    eqs(CsShapeLine.spines(doc).length, 0, "the spine went");
    eqs(CsShapeLine.decorOf(doc, spines[0].id).length, 0,
        "and its ornament with it -- the same feature either way in");
})();

// ---------------------------------------------------------------------
// Delete Last.
// ---------------------------------------------------------------------

CsErase.forget();
eqs(CsErase.deleteLast(doc, di).status, "nothing",
    "with no record, Delete Last says so rather than deleting something");

trace(walk(700, 0, 720, 0, 20));
var lastCount = on(CsLayers.WALLS_SURVEYED).length;
var res = CsErase.deleteLast(doc, di);
eqs(res.status, "deleted", "the wall just traced is deleted");
eqs(res.label, CsLayers.WALLS_SURVEYED, "and reported by its layer");
eqs(on(CsLayers.WALLS_SURVEYED).length, lastCount - 1, "one line fewer");
eqs(CsErase.deleteLast(doc, di).status, "nothing",
    "pressing it twice does not then delete the one before");

// An EXTENSION is refused, with the reason.
trace(walk(800, 0, 820, 0, 20));
var grownCount = on(CsLayers.WALLS_SURVEYED).length;
trace(walk(820.2, 0.1, 840, 0, 20));
eqs(on(CsLayers.WALLS_SURVEYED).length, grownCount,
    "fixture: the second stroke GREW that wall rather than adding one");
var ext = CsErase.deleteLast(doc, di);
eqs(ext.status, "extended",
    "Delete Last refuses a stroke that continued a line");
eqs(on(CsLayers.WALLS_SURVEYED).length, grownCount,
    "and deletes nothing: that entity is the whole wall, and taking it " +
        "would take every earlier stroke of it");

// ---------------------------------------------------------------------
// The palette's own list is a different list.
// ---------------------------------------------------------------------

var symbolLayers = FeatureEraseRun.symbolLayers();
var symbolListed = {};
for (var s = 0; s < symbolLayers.length; s++) {
    symbolListed[symbolLayers[s]] = true;
}
ok(symbolLayers.length > 0, "the palette has erasable layers of its own");
ok(symbolListed[CsLayers.WALLS_SURVEYED] !== true,
    "and erasing in the palette cannot take a traced WALL -- the caver " +
        "reaching for that button is looking at a symbol");
ok(symbolListed[CsLayers.CTRL_SHOTS] !== true,
    "nor the centerline, by the same rule as the other panel");

// ---------------------------------------------------------------------
if (failures.length === 0) {
    print("### FEATURE ERASE OK " + passed);
} else {
    for (var f = 0; f < failures.length; f++) {
        print("FAIL: " + failures[f]);
    }
    print("### FEATURE ERASE FAIL");
}
