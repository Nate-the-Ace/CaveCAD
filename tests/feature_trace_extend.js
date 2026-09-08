// feature_trace_extend.js -- one wall traced in three passes is ONE
// line, and the strokes that must NOT be joined are not joined.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/feature_trace_extend.js "$PWD"
//
// The claim, in a real document: a stroke that carries on from where
// the caver's own last stroke ended GROWS that entity -- same id, same
// XDATA, more geometry -- instead of adding a second one. A wall traced
// in six passes used to be six splines: six things to warp, six ends to
// leave a hairline gap between, six rows in a revision.
//
// And the three refusals that make the feature safe to leave on:
//   - a stroke starting at a line someone ELSE drew makes a new line,
//     because a plain drag joining any end within a foot would fuse two
//     walls meeting at a corner and round the corner off;
//   - a stroke on another layer never joins across;
//   - a target that is not a traced curve (a plain LINE) is left alone
//     and the stroke lands as its own line rather than being lost.
//
// Why headless-with-the-real-tool rather than a unit test: the join is
// four pieces agreeing -- extendTarget's rule, CsTrace.joinOrder's
// geometry, setShape-plus-modify actually landing in the document, and
// commit()'s fallback when it does not. Each passes alone while a wall
// still comes out in six pieces.

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

var failures = [];
var checks = 0;
function ok(condition, what) {
    checks++;
    if (!condition) {
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

// The panel is not built headlessly; commit() reads the armed feature
// off this and nothing else.
FeatureTrace.target = CsLayers.WALLS_SURVEYED;

/** Drives one drag through the real commit(), the way the mouse would.
 *  `shift` is what mousePressEvent would have recorded at the press. */
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

function pointsOn(id) {
    var pts = CsTrace.controlPointsOf(doc.queryEntity(id));
    return pts === null ? 0 : pts.length;
}

// ---------------------------------------------------------------------
// One wall, traced in three passes.
// ---------------------------------------------------------------------

trace(walk(0, 0, 20, 0, 20));
var walls = on(CsLayers.WALLS_SURVEYED);
eqs(walls.length, 1, "the first stroke drew one wall");
var wallId = walls[0];
var firstPoints = pointsOn(wallId);
ok(firstPoints >= 2, "and it is a traced curve with control points");

// Provenance the extension must not throw away. A section stamp is the
// real case; any XDATA proves the same thing -- that the entity itself
// survives rather than being replaced by a lookalike.
var stamped = doc.queryEntity(wallId);
CsTags.set(stamped, "TestProvenance", "trip-3");
var stampOp = new RModifyObjectsOperation();
stampOp.addObject(stamped, false);
di.applyOperation(stampOp);

// Pass two: sets off from where pass one stopped.
trace(walk(20.2, 0.1, 40, 0, 20));
eqs(on(CsLayers.WALLS_SURVEYED).length, 1,
    "the second stroke GREW the wall rather than adding a second one");
eqs(on(CsLayers.WALLS_SURVEYED)[0], wallId,
    "and it is the same entity, by id -- not a replacement");
ok(pointsOn(wallId) > firstPoints,
    "the wall carries the new stroke's geometry");
eqs(String(CsTags.get(doc.queryEntity(wallId), "TestProvenance")), "trip-3",
    "the entity's XDATA survived the extension, which delete-and-add " +
        "would have dropped silently");
var twoPassPoints = pointsOn(wallId);

// The far end reaches the far end of the second stroke.
var grown = doc.queryEntity(wallId);
var ends = [grown.getStartPoint(), grown.getEndPoint()];
var reach = Math.max(ends[0].x, ends[1].x);
ok(reach > 39, "the wall now reaches where the second stroke stopped " +
    "(got " + reach + ")");
var back = Math.min(ends[0].x, ends[1].x);
ok(Math.abs(back) < 1e-6, "and still starts where the first one did");

// Pass three: drawn BACKWARDS, arriving end-first at the wall's end.
// Same intent, so the same join.
trace(walk(60, 0, 40.3, 0, 20));
eqs(on(CsLayers.WALLS_SURVEYED).length, 1,
    "a stroke drawn back towards the wall joins it too");
ok(pointsOn(wallId) > twoPassPoints,
    "and the wall grew again");

// ---------------------------------------------------------------------
// What must NOT join.
// ---------------------------------------------------------------------

// A stroke starting well clear is a new line.
trace(walk(200, 200, 220, 200, 20));
eqs(on(CsLayers.WALLS_SURVEYED).length, 2,
    "a stroke starting well clear of everything is its own line");
var otherId = null;
var after = on(CsLayers.WALLS_SURVEYED);
for (var i = 0; i < after.length; i++) {
    if (after[i] !== wallId) {
        otherId = after[i];
    }
}

// THE CORNER CASE, which is why a plain drag only ever continues the
// caver's OWN LAST stroke: the wall at the origin still ends at 0,0,
// and a fresh stroke setting off from there is a different wall meeting
// it at a corner. Joining them would fit one curve through the corner
// and round it off.
trace(walk(0.1, 0.1, 0, 30, 20));
eqs(on(CsLayers.WALLS_SURVEYED).length, 3,
    "a stroke starting at a line the caver did not just draw makes a " +
        "NEW line -- two walls meeting at a corner stay two walls");

// Unless they say so: Shift at the press widens it to any end on the
// layer. The stroke below starts at the far end of the second wall.
var otherPoints = pointsOn(otherId);
trace(walk(220.2, 200, 240, 200, 20), true);
eqs(on(CsLayers.WALLS_SURVEYED).length, 3,
    "Shift at the press continues a line the caver did not just draw");
ok(pointsOn(otherId) > otherPoints,
    "and it is that line which grew");

// Never across layers: the same geometry, armed to a different feature.
FeatureTrace.target = CsLayers.CEILING;
trace(walk(240.2, 200, 260, 200, 20));
eqs(on(CsLayers.CEILING).length, 1,
    "a ceiling stroke starting at a wall's end draws a ceiling");
eqs(on(CsLayers.WALLS_SURVEYED).length, 3,
    "and leaves the wall alone -- extension never crosses layers");
FeatureTrace.target = CsLayers.WALLS_SURVEYED;

// ---------------------------------------------------------------------
// A refused extension must not cost the stroke.
// ---------------------------------------------------------------------
//
// A plain LINE on the feature layer -- drawn by any other tool, or
// imported -- is not a traced curve. Shift aims at it deliberately;
// controlPointsOf refuses, and commit() falls back to drawing the
// stroke as its own line.
var lineOp = new RAddObjectsOperation();
var plain = new RLineEntity(doc, new RLineData(
    new RVector(300, 300), new RVector(320, 300)));
plain.setLayerId(doc.getLayerId(CsLayers.WALLS_SURVEYED));
lineOp.addObject(plain, false);
di.applyOperation(lineOp);
var beforeFallback = on(CsLayers.WALLS_SURVEYED).length;

trace(walk(320.2, 300, 340, 300, 20), true);
eqs(on(CsLayers.WALLS_SURVEYED).length, beforeFallback + 1,
    "a stroke aimed at something that is not a traced curve still lands, " +
        "as its own line");

// ---------------------------------------------------------------------
// The caver is told which happened.
// ---------------------------------------------------------------------
var saidExtended = 0;
for (i = 0; i < messages.length; i++) {
    if (String(messages[i]).indexOf("extended") !== -1) {
        saidExtended++;
    }
}
ok(saidExtended >= 3, "the command line says when a stroke extended a " +
    "line rather than drawing one (got " + saidExtended + ")");

// ---------------------------------------------------------------------
if (failures.length === 0) {
    print("### FEATURE TRACE EXTEND OK " + checks + " assertions");
} else {
    print("### FEATURE TRACE EXTEND FAIL");
    for (i = 0; i < failures.length; i++) {
        print("  - " + failures[i]);
    }
    print("  messages: " + messages.join(" | "));
}
