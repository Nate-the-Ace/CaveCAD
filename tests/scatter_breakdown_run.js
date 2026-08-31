// scatter_breakdown_run.js -- Scatter Breakdown decides its VIEW by
// where the zone is, not by the layer the boundary was drawn on.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/scatter_breakdown_run.js "$PWD"
//
// The claim: two identical boundaries on the SAME plan layer, one out
// in the plan and one sitting inside an elevation band's box, must fill
// with breakdown on BREAKDOWN and PROFILE-BREAKDOWN respectively. That
// is the whole point of the band boxes -- one button set, no profile
// twin of the button, no layer for the caver to remember.
//
// Why headless-with-the-real-tool rather than a pure unit test: the
// routing is three separate pieces agreeing (CsProfileBox.frameAt off
// real box entities, CsLayers.twinFor, and the retarget of the block
// reference CsSymbols.insert hands back on its CATALOG layer). A unit
// test of any one of them passes while the tool still puts every
// boulder in the plan.

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

// The real include(), for the reason tests/generate_profile_run.js
// states at length: this file loads a TOOL, whose own first lines are
// include() calls that have to run for real.
include("scripts/EAction.js");
include("scripts/simple.js");
includeBasePath = repoRoot + "/scripts/CaveSurvey/Core";
include(includeBasePath + "/CsAll.js");
includeBasePath = repoRoot + "/scripts/CaveSurvey/ScatterBreakdown";
include(includeBasePath + "/ScatterBreakdown.js");

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

function shotOf(from, to, d, az, inc, u, dn) {
    var s = CsModel.newShot();
    s.from = from; s.to = to; s.distance = d; s.azimuth = az;
    s.inclination = inc || 0;
    s.up = (u === undefined) ? null : u;
    s.down = (dn === undefined) ? null : dn;
    return s;
}

// The tool talks to the user; headlessly nobody is listening, and
// EAction.handleUserMessage needs a main window. Captured instead, so a
// warning that ENDS the run early is visible in the failure list rather
// than looking like a silent pass.
var messages = [];
warning = function(text) { messages.push("WARNING: " + text); };
EAction.handleUserMessage = function(text) { messages.push(text); };

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var di = new RDocumentInterface(doc);
getDocument = function() { return doc; };
getDocumentInterface = function() { return di; };

// ---------------------------------------------------------------------
// Fixture: a real profile, so real band boxes exist on CTRL-PROFILE-BOX.
// ---------------------------------------------------------------------

var sv = CsModel.newSurvey();
sv.shots = [
    shotOf("A1", "A2", 10, 0, 0, 4, 2),
    shotOf("A2", "A3", 10, 0, -10, 4, 2)
];
var resolved = CsNetwork.resolve(sv, {});
var profile = CsProfile.build(sv, resolved, {});
var drawn = CsProfileDraw.render(doc, di, profile, {});
ok(drawn.bandsDrawn >= 1, "the fixture profile drew at least one band");

var boxes = CsProfileBox.boxes(doc);
ok(boxes.length >= 1, "the profile left at least one band box behind " +
    "(without one there is nothing for this test to aim at)");

// The blocks the catalog places. A memory document has none, and
// CsSymbols.insert answers null without them -- which the tool reports
// as "start from the NSS template", i.e. a clean skip that would make
// this whole file pass while placing nothing.
var blockOp = new RAddObjectsOperation();
var wantBlocks = ["SYM_BREAKDOWN", "SYM_BREAKDOWN_B", "SYM_BREAKDOWN_C"];
for (var bi = 0; bi < wantBlocks.length; bi++) {
    blockOp.addObject(new RBlock(doc, wantBlocks[bi], new RVector(0, 0)),
        false);
}
di.applyOperation(blockOp);
// A block with NO geometry has a NaN bounding box, and every reference
// to it is then dropped on its way into the spatial index -- the run
// reports boulders placed and the document holds none. One real line
// each is enough to make the fixture behave like the template's blocks.
var shapeOp = new RAddObjectsOperation();
for (bi = 0; bi < wantBlocks.length; bi++) {
    var blk = doc.queryBlock(wantBlocks[bi]);
    if (isNull(blk)) { continue; }
    var seg = new RLineEntity(doc,
        new RLineData(new RVector(-0.5, -0.25), new RVector(0.5, 0.25)));
    seg.setBlockId(blk.getId());
    shapeOp.addObject(seg, false);
}
di.applyOperation(shapeOp);
for (bi = 0; bi < wantBlocks.length; bi++) {
    ok(!isNull(doc.queryBlock(wantBlocks[bi])),
        wantBlocks[bi] + " exists in the fixture document");
}

/** A closed square boundary centred on (cx, cy), on the PLAN boundary
 *  layer whichever view it lands in -- that is the point. */
function addBoundary(cx, cy, half) {
    CsLayers.ensure(doc, di, CsLayers.BREAKDOWN_BOUNDARY);
    var pl = new RPolylineEntity(doc, new RPolylineData());
    pl.appendVertex(new RVector(cx - half, cy - half));
    pl.appendVertex(new RVector(cx + half, cy - half));
    pl.appendVertex(new RVector(cx + half, cy + half));
    pl.appendVertex(new RVector(cx - half, cy + half));
    pl.setClosed(true);
    pl.setLayerId(doc.getLayerId(CsLayers.BREAKDOWN_BOUNDARY));
    var op = new RAddObjectsOperation();
    op.addObject(pl, false);
    di.applyOperation(op);
    return pl.getId();
}

// Inside the first band's box, well clear of its edges.
var box = boxes[0];
var profileCx = (box.minX + box.maxX) / 2;
var profileCy = (box.minY + box.maxY) / 2;
var inProfile = addBoundary(profileCx, profileCy,
    Math.min(box.maxX - box.minX, box.maxY - box.minY) / 8);

// Far from the elevation and from any bay: ordinary plan ground.
var region = CsTrace.profileRegion(doc);
var planX = isNull(region) ? 500 : (region.maxX + 500);
var planY = isNull(region) ? 500 : (region.maxY + 500);
var inPlan = addBoundary(planX, planY, 3);

eqs(CsProfileBox.frameAt(doc, region, new RVector(profileCx, profileCy), []),
    "profile",
    "the fixture's profile zone really is inside a band box");
eqs(CsProfileBox.frameAt(doc, region, new RVector(planX, planY), []), "plan",
    "the fixture's plan zone really is out in the plan");

// ---------------------------------------------------------------------
// Run the tool for real.
// ---------------------------------------------------------------------

scatterBreakdownRun();

/** Every block reference owned by a boundary, grouped by layer name. */
function placedLayers(boundaryId) {
    var seen = {};
    var ids = doc.queryAllEntities(false, false, RS.EntityBlockRef);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) { continue; }
        if (CsTags.get(e, "BoundaryId") !== String(boundaryId)) { continue; }
        var lname = doc.getLayerName(e.getLayerId());
        seen[lname] = (seen[lname] || 0) + 1;
    }
    return seen;
}

var planPlaced = placedLayers(inPlan);
var profilePlaced = placedLayers(inProfile);

ok((planPlaced[CsLayers.BREAKDOWN] || 0) > 0,
    "the plan zone filled on " + CsLayers.BREAKDOWN + ", got " +
    JSON.stringify(planPlaced) + " (messages: " + messages.join(" | ") + ")");
eqs(planPlaced[CsLayers.PROFILE_BREAKDOWN], undefined,
    "nothing from the plan zone leaked into the elevation");

ok((profilePlaced[CsLayers.PROFILE_BREAKDOWN] || 0) > 0,
    "the profile zone filled on " + CsLayers.PROFILE_BREAKDOWN +
    " even though its boundary is on the PLAN boundary layer, got " +
    JSON.stringify(profilePlaced));
eqs(profilePlaced[CsLayers.BREAKDOWN], undefined,
    "and none of it landed in the plan -- the layer the boundary was " +
    "drawn on decides nothing");

// ---------------------------------------------------------------------
// Re-running still clears only the boundaries it processes, now that
// the clearing sweep has to look at more than one target layer.
// ---------------------------------------------------------------------

var beforeRerun = 0;
var allRefs = doc.queryAllEntities(false, false, RS.EntityBlockRef);
for (var ri = 0; ri < allRefs.length; ri++) {
    if (!isNull(doc.queryEntity(allRefs[ri]))) { beforeRerun++; }
}
ok(beforeRerun > 0, "there are boulders to re-scatter");

scatterBreakdownRun();

var afterProfile = placedLayers(inProfile);
var afterPlan = placedLayers(inPlan);
eqs(afterProfile[CsLayers.BREAKDOWN], undefined,
    "after a re-run the profile zone is still profile-only");
ok((afterProfile[CsLayers.PROFILE_BREAKDOWN] || 0) > 0,
    "and still filled");
ok((afterPlan[CsLayers.BREAKDOWN] || 0) > 0,
    "the plan zone survived the re-run");

// The old scatter must be GONE, not doubled -- the same claim the tool
// has always made, re-checked because the sweep that clears it now
// matches on a SET of target layers rather than one id.
var doubled = false;
var counted = {};
allRefs = doc.queryAllEntities(false, false, RS.EntityBlockRef);
for (ri = 0; ri < allRefs.length; ri++) {
    var ent = doc.queryEntity(allRefs[ri]);
    if (isNull(ent)) { continue; }
    var owner = CsTags.get(ent, "BoundaryId");
    if (owner === "") { continue; }
    counted[owner] = (counted[owner] || 0) + 1;
}
ok(!doubled, "no doubling sentinel");
ok(counted[String(inProfile)] > 0 && counted[String(inPlan)] > 0,
    "both zones still own boulders after the re-run");

var out;
if (failures.length === 0) {
    out = "### SCATTER BREAKDOWN OK";
} else {
    out = "### SCATTER BREAKDOWN FAIL " + failures.length + "\n";
    for (var fi = 0; fi < failures.length; fi++) {
        out += "  FAIL: " + failures[fi] + "\n";
    }
}
print(out);
