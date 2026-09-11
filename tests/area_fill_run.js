// area_fill_run.js -- CsArea.build/clear write a real fill into a real
// document, and clean it back up by ownership, not by area.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/area_fill_run.js "$PWD"
//
// The claims: scatter elements land on the layer they were told to and
// carry their owner's tag; a filled pattern makes exactly one hatch
// entity (against a POLYLINE boundary and, separately, a closed SPLINE
// boundary -- CsArea.buildHatch takes two different paths through
// RHatchData.addBoundary depending on which); clearing one area's fill
// never touches its neighbour's; bedrock draws nothing and still
// reports success; the same seed rebuilds the same element count.
//
// scripts/simple.js gives the REAL isNull() -- the one that checks
// isNullWrapper(). A hand-rolled shim (typeof v.isNull==="function" ?
// v.isNull() : false) reports a MISSING block as present, because
// doc.queryBlock() of a name the document does not have comes back as a
// wrapped non-null object (typeof "object", getId() undefined) rather
// than JS null. CsArea.build's missing-block guard is real code under
// test here, not a fixture detail, so this file has to see it fail
// honestly -- same reasoning as tools/make_area_blocks.js, which hit
// this in Task 4.
include("scripts/simple.js");

createSpatialIndex = function() {
    return new RSpatialIndexNavel();
};

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];

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

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var di = new RDocumentInterface(doc);
CsLayers.ensureSurveyLayers(doc, di);

// The layers this run's patterns and boundaries need. ensureSurveyLayers
// only covers the CTRL_* layers every tool relies on -- CTRL-AREA-
// BOUNDARY, the fill layers and FLOOR are this suite's own business.
CsLayers.ensure(doc, di, "CTRL-AREA-BOUNDARY");
CsLayers.ensure(doc, di, CsArea.CATALOG.SAND.layer);
CsLayers.ensure(doc, di, CsArea.CATALOG.WATER.layer);
CsLayers.ensure(doc, di, CsArea.CATALOG.BEDROCK.layer);

// The AREA_* blocks live in the template (Task 4), not in a blank
// document -- CsSymbolStore.ensureBlock is Task 4's own answer for a
// drawing that lacks one, so this pulls the REAL AREA_STIPPLE block
// through the REAL import path rather than faking a stand-in. Chosen
// over CsSymbolStore.openOffscreen(templatePath) (working IN the
// template document) because it keeps the fixture a plain memory
// document like every other *_run.js test, and it is a fuller test of
// Task 4's contract: "ensureBlock imports into a drawing that lacks it."
var templatePath = repoRoot + "/templates/NSS_Cave_Template_PLAN.dxf";
var imported = CsSymbolStore.ensureBlock(doc, di, "AREA_STIPPLE",
    templatePath);
ok(imported.ok === true,
    "fixture: AREA_STIPPLE imports from the template (" +
    imported.error + ")");

/** A closed square boundary, drawn as a polyline like a caver's real
 *  freehand stroke would resolve to. */
function addBoundary(verts, layerName) {
    var op = new RAddObjectsOperation();
    var pl = new RPolyline();
    for (var i = 0; i < verts.length; i++) {
        pl.appendVertex(new RVector(verts[i].x, verts[i].y));
    }
    pl.setClosed(true);
    var e = new RPolylineEntity(doc, new RPolylineData(pl));
    e.setLayerId(doc.getLayerId(layerName));
    op.addObject(e, false);
    di.applyOperation(op);
    return e;
}

/** A closed SPLINE boundary -- the OTHER shape CsArea.buildHatch has to
 *  loop, and the one the plan flagged as the addBoundary soft spot.
 *  Periodic, not just first-equals-last, because that is how this
 *  suite's own tools (CsRevise) close one. */
function addSplineBoundary(verts, layerName) {
    // RSplineData, not RSpline wrapped afterward, and update() called
    // explicitly -- the exact idiom CsRevise.js uses to build a live
    // periodic spline. Skipping update() leaves the shape looking
    // empty: getPointCloud answers nothing and CsArea.vertsOf reports
    // "the boundary has no area" even though the control points are
    // all there.
    var data = new RSplineData();
    for (var i = 0; i < verts.length; i++) {
        data.appendControlPoint(new RVector(verts[i].x, verts[i].y));
    }
    data.setDegree(3);
    data.setPeriodic(true);
    data.update();
    var e = new RSplineEntity(doc, data);
    e.setLayerId(doc.getLayerId(layerName));
    var op = new RAddObjectsOperation();
    op.addObject(e, false);
    di.applyOperation(op);
    return e;
}

var squareA = [{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}];
var squareB = [{x:40,y:0},{x:50,y:0},{x:50,y:10},{x:40,y:10}];
var circleC = [{x:80,y:0},{x:88,y:8},{x:80,y:16},{x:72,y:8}];

var bA = addBoundary(squareA, "CTRL-AREA-BOUNDARY");
var bB = addBoundary(squareB, "CTRL-AREA-BOUNDARY");
var bC = addSplineBoundary(circleC, "CTRL-AREA-BOUNDARY");

ok(!isNull(doc.queryBlock("AREA_STIPPLE")),
    "fixture: AREA_STIPPLE really is in the document now");

var idA = "area-a", idB = "area-b";
function fill(boundary, id, key) {
    var op = new RAddObjectsOperation();
    var result = CsArea.build(doc, op, boundary, CsArea.CATALOG[key],
        { id: id, seed: 99, scale: 1.0, density: 1.0,
          layer: CsArea.CATALOG[key].layer });
    di.applyOperation(op);
    return result;
}

// ---------------------------------------------------------------------
// scatter: elements land, on the right layer, tagged with their owner
// ---------------------------------------------------------------------

var made = fill(bA, idA, "SAND");
ok(made.ok === true, "CsArea.build: sand reports success (" +
    made.reason + ")");
ok(made.count > 0, "CsArea.build: sand puts elements in the drawing");
fill(bB, idB, "SAND");

var before = CsArea.countOwned(doc, idA);
ok(before > 0, "CsArea.countOwned: the fill is findable by its owner tag");
eqs(before, made.count,
    "CsArea.countOwned: agrees with the count build() reported");

var wrongLayer = 0;
var sandIds = CsArea.ownedBy(doc, idA);
for (var si = 0; si < sandIds.length; si++) {
    var sref = doc.queryEntity(sandIds[si]);
    if (isNull(sref)) { continue; }
    if (doc.getLayerName(sref.getLayerId()) !== CsArea.CATALOG.SAND.layer) {
        wrongLayer++;
    }
}
eqs(wrongLayer, 0,
    "CsArea.build: every scattered element landed on opts.layer");

// ---------------------------------------------------------------------
// clear: only the named area's fill dies, the neighbour's survives
// ---------------------------------------------------------------------

var clearOp = new RDeleteObjectsOperation();
CsArea.clear(doc, clearOp, idA);
di.applyOperation(clearOp);
eqs(CsArea.countOwned(doc, idA), 0, "CsArea.clear: the area's fill is gone");
ok(CsArea.countOwned(doc, idB) > 0,
    "CsArea.clear: the NEIGHBOUR's fill is untouched");

// ---------------------------------------------------------------------
// rebuild: the same seed gives the same count
// ---------------------------------------------------------------------

fill(bA, idA, "SAND");
var again = CsArea.countOwned(doc, idA);
eqs(again, before,
    "CsArea: the same seed rebuilds the same number of elements");

// ---------------------------------------------------------------------
// filled: exactly one hatch entity, tagged -- polyline boundary
// ---------------------------------------------------------------------

var wOp = new RAddObjectsOperation();
var waterMade = CsArea.build(doc, wOp, bB, CsArea.CATALOG.WATER,
    { id: "area-w", seed: 7, scale: 1.0, density: 1.0,
      layer: CsArea.CATALOG.WATER.layer });
di.applyOperation(wOp);
ok(waterMade.ok === true,
    "CsArea.build: a filled pattern over a POLYLINE boundary succeeds (" +
    waterMade.reason + ")");
eqs(CsArea.countOwned(doc, "area-w"), 1,
    "CsArea.build: a filled pattern is exactly one hatch entity");
var waterIds = CsArea.ownedBy(doc, "area-w");
ok(waterIds.length === 1 &&
    !isNull(doc.queryEntity(waterIds[0])) &&
    doc.queryEntity(waterIds[0]).getType() === RS.EntityHatch,
    "CsArea.build: and it really is an RHatchEntity");

// ---------------------------------------------------------------------
// filled: the OTHER boundary shape -- a closed SPLINE -- also works.
// This is the soft spot the plan flagged: addBoundary may refuse a
// closed spline the way it refuses a whole polyline. It did not here;
// see CsArea.buildHatch's header comment for why the two shapes take
// different paths through RHatchData.
// ---------------------------------------------------------------------

var fOp = new RAddObjectsOperation();
var flowMade = CsArea.build(doc, fOp, bC, CsArea.CATALOG.FLOWSTONE,
    { id: "area-f", seed: 3, scale: 1.0, density: 1.0,
      layer: CsArea.CATALOG.FLOWSTONE.layer });
di.applyOperation(fOp);
ok(flowMade.ok === true,
    "CsArea.build: a filled pattern over a closed SPLINE boundary " +
    "succeeds (" + flowMade.reason + ")");
eqs(CsArea.countOwned(doc, "area-f"), 1,
    "CsArea.build: the spline boundary also makes exactly one hatch");

// ---------------------------------------------------------------------
// bedrock: nothing drawn, success reported
// ---------------------------------------------------------------------

var rOp = new RAddObjectsOperation();
var rock = CsArea.build(doc, rOp, bA, CsArea.CATALOG.BEDROCK,
    { id: "area-r", seed: 7, scale: 1.0, density: 1.0,
      layer: CsArea.CATALOG.BEDROCK.layer });
di.applyOperation(rOp);
eqs(rock.count, 0, "CsArea.build: bedrock draws no fill, only its boundary");
ok(rock.ok === true, "CsArea.build: and reports success doing so");

// ---------------------------------------------------------------------
// missing block: build refuses cleanly, and its op commits NOTHING --
// the case that would have caught a half-built op landing anyway. A
// scatter entry naming a block this document has never heard of must
// fail before a single reference is queued, not partway through.
// ---------------------------------------------------------------------

var GHOST = { name: "Ghost", engine: "scatter",
    layer: CsArea.CATALOG.SAND.layer, blocks: ["AREA_GHOST_NOPE"],
    density: 40, scaleMin: 0.8, scaleMax: 1.2, rotate: false };
var beforeGhost = doc.queryAllEntities(false, true).length;
var ghostOp = new RAddObjectsOperation();
var ghostMade = CsArea.build(doc, ghostOp, bA, GHOST,
    { id: "area-ghost", seed: 5, scale: 1.0, density: 1.0,
      layer: GHOST.layer });
ok(ghostMade.ok === false,
    "CsArea.build: an entry naming an absent block reports failure");
ok(ghostMade.reason.length > 0,
    "CsArea.build: ... with a reason a caller can show");
di.applyOperation(ghostOp);
eqs(CsArea.countOwned(doc, "area-ghost"), 0,
    "CsArea.build: nothing tagged for the failed area reached the drawing");
eqs(doc.queryAllEntities(false, true).length, beforeGhost,
    "CsArea.build: applying the failed op changed the document not at " +
    "all -- no half-built fill slipped through on a false ok");

var out;
if (failures.length === 0) {
    out = "### AREA FILL OK";
} else {
    out = "### AREA FILL FAIL " + failures.length + "\n";
    for (var fi = 0; fi < failures.length; fi++) {
        out += "  FAIL: " + failures[fi] + "\n";
    }
}
print(out);
