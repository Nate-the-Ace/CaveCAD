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

// The stroke action itself (Task 6). It loads EAction and re-includes
// CsAll.js on its own (include() dedupes by basename, so that second
// pass is a no-op) -- the same pattern tests/scatter_breakdown_run.js
// uses to load a real TOOL rather than faking its shape.
include("scripts/EAction.js");
includeBasePath = repoRoot + "/scripts/CaveSurvey/AreaFill";
include(includeBasePath + "/AreaFillRun.js");

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

// =======================================================================
// AreaFillRun.commit -- Task 6. One stroke, one closed boundary, one
// fill, ONE transaction, routed to the view the drag landed in.
// =======================================================================

// EAction.handleUserMessage/warning need a listener headlessly or a
// refusal that tries to talk to the (nonexistent) status bar throws
// and ends the run early looking like an unrelated failure -- same
// reasoning as tests/scatter_breakdown_run.js's own capture.
var messages = [];
warning = function(text) { messages.push("WARNING: " + text); };
EAction.handleUserMessage = function(text) { messages.push(text); };
getDocument = function() { return doc; };
getDocumentInterface = function() { return di; };

function shotOf(from, to, d, az, inc, u, dn) {
    var s = CsModel.newShot();
    s.from = from; s.to = to; s.distance = d; s.azimuth = az;
    s.inclination = inc || 0;
    s.up = (u === undefined) ? null : u;
    s.down = (dn === undefined) ? null : dn;
    return s;
}

/** A closed square stroke, first point repeated at the end -- the shape
 *  a caver's own drag (and this suite's other fixtures) resolves to,
 *  and the shape AreaFillRun.commit must handle without doubling a
 *  control point at the seam of the periodic spline it builds. */
function squareStroke(cx, cy, half) {
    return [
        { x: cx - half, y: cy - half }, { x: cx + half, y: cy - half },
        { x: cx + half, y: cy + half }, { x: cx - half, y: cy + half },
        { x: cx - half, y: cy - half }
    ];
}

// ---------------------------------------------------------------------
// A real profile, so a real band box exists on CTRL-PROFILE-BOX --
// exactly the fixture tests/scatter_breakdown_run.js builds for the
// identical routing claim ("where the drag lands picks the view").
// ---------------------------------------------------------------------

var afSurvey = CsModel.newSurvey();
afSurvey.shots = [
    shotOf("A1", "A2", 10, 0, 0, 4, 2),
    shotOf("A2", "A3", 10, 0, -10, 4, 2)
];
// TWO trips, not one -- so the trip AreaFillRun.commit derives for a
// stroke near A3 has to actually be READ off the drawing rather than
// happening to match the single-trip default every survey gets from
// CsModel.ensureTrips. A fixture with one trip could not tell a real
// nearest-station lookup apart from a hardcoded 0, which is exactly
// the elevation-datum trap family this criterion exists to catch.
afSurvey.trips = [CsModel.newTrip(), CsModel.newTrip()];
afSurvey.trips[0].name = "Trip A"; afSurvey.trips[0].date = "2026-01-01";
afSurvey.trips[0].team = "Alice";
afSurvey.trips[1].name = "Trip B"; afSurvey.trips[1].date = "2026-01-02";
afSurvey.trips[1].team = "Bob";
afSurvey.shots[1].trip = 1;

var afResolved = CsNetwork.resolve(afSurvey, {});
var afProfile = CsProfile.build(afSurvey, afResolved, {});

// The plan render itself -- CTRL-STATIONS points and CTRL-SHOTS lines,
// tagged with Station/From/To/Trip -- is what AreaFillRun.commit's
// call to CsTrace.tripFor actually reads to answer "which trip drew
// this". Without it there is no station in the whole document for
// nearestStation to find, and tripFor answers null forever, which
// would make the "never a bare 0" assertion below untestable rather
// than proven.
var afDrawnPlan = CsDraw.survey(afSurvey, afResolved, undefined, undefined,
    0, { doc: doc, di: di });
ok(afDrawnPlan.stationsDrawn > 0,
    "AreaFillRun fixture: the plan survey drew real stations for " +
    "tripFor's nearest-station lookup to find");
var afDrawn = CsProfileDraw.render(doc, di, afProfile, {});
ok(afDrawn.bandsDrawn >= 1,
    "AreaFillRun fixture: the profile drew at least one band");

var afBoxes = CsProfileBox.boxes(doc);
ok(afBoxes.length >= 1,
    "AreaFillRun fixture: the profile left at least one band box " +
    "behind for AreaFillRun to route against");

var afBand = afBoxes[0];
var afBandCx = (afBand.minX + afBand.maxX) / 2;
var afBandCy = (afBand.minY + afBand.maxY) / 2;
var afBandHalf = Math.min(afBand.maxX - afBand.minX,
    afBand.maxY - afBand.minY) / 8;
ok(afBandHalf > 1,
    "AreaFillRun fixture: the band box is roomy enough for a >1 sq " +
    "unit stroke to fit inside it (" + JSON.stringify(afBand) + ")");

// Far from the elevation and any band box: ordinary plan ground.
var afPlanRegion = CsTrace.profileRegion(doc);
var afPlanCx = isNull(afPlanRegion) ? 500 : (afPlanRegion.maxX + 500);
var afPlanCy = isNull(afPlanRegion) ? 500 : (afPlanRegion.maxY + 500);

// ---------------------------------------------------------------------
// Routing: two IDENTICAL strokes, one in the plan, one inside the
// band's box. Where the drag lands picks the view -- there is no plan
// button and no profile button.
// ---------------------------------------------------------------------

var afPlanStroke = squareStroke(afPlanCx, afPlanCy, 4);
var afBandStroke = squareStroke(afBandCx, afBandCy, afBandHalf);

var afPlanMade = AreaFillRun.commit(doc, di, afPlanStroke, "SAND",
    { scale: 1.0, density: 1.0 });
var afBandMade = AreaFillRun.commit(doc, di, afBandStroke, "SAND",
    { scale: 1.0, density: 1.0 });

ok(afPlanMade.ok === true,
    "AreaFillRun.commit: the plan stroke succeeds (" +
    afPlanMade.reason + ")");
eqs(afPlanMade.layer, "SEDIMENT-SAND-GRAVEL",
    "AreaFillRun.commit: a stroke in the plan fills on the plan layer");
ok(afPlanMade.count > 0,
    "AreaFillRun.commit: the plan stroke actually placed scatter");

ok(afBandMade.ok === true,
    "AreaFillRun.commit: the band stroke succeeds (" +
    afBandMade.reason + ")");
eqs(afBandMade.layer.indexOf("PROFILE-"), 0,
    "AreaFillRun.commit: the SAME stroke inside a band fills on the " +
    "profile twin, exactly as ScatterBreakdown routes -- got " +
    afBandMade.layer);
eqs(CsLayers.frameOf(afBandMade.boundaryLayer), "profile",
    "AreaFillRun.commit: ... and so does its boundary layer -- got " +
    afBandMade.boundaryLayer + " (CTRL-AREA-BOUNDARY's profile twin " +
    "keeps its CTRL- prefix, so this checks frameOf rather than a " +
    "literal \"PROFILE-\" string position)");
ok(afBandMade.count > 0,
    "AreaFillRun.commit: the band stroke actually placed scatter");

// ---------------------------------------------------------------------
// The boundary is a genuinely CLOSED spline -- proven, not assumed. It
// is sampled the same way CsArea.build itself would sample it
// (CsArea.vertsOf), which in a `-no-gui` run is the only sampling path
// that does not need a spline proxy plugin (see CsArea.vertsOf's own
// header). A boundary that merely LOOKS closed on screen while
// scattering its fill through an open seam would fail this, not the
// eyeball check.
// ---------------------------------------------------------------------

function afBoundaryFor(areaId) {
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (!isNull(e) && CsTags.get(e, CsArea.ID_KEY) === areaId) {
            return e;
        }
    }
    return null;
}

var afPlanBoundary = afBoundaryFor(afPlanMade.id);
ok(!isNull(afPlanBoundary),
    "AreaFillRun.commit: the plan boundary entity exists in the drawing");
var afPlanVerts = CsArea.vertsOf(afPlanBoundary);
ok(afPlanVerts.length > 3,
    "AreaFillRun.commit: the boundary samples to a real polygon, not " +
    "an empty or degenerate one");
ok(CsArea.polygonArea(afPlanVerts) > AreaFillRun.MIN_AREA,
    "AreaFillRun.commit: the SAMPLED boundary encloses a non-trivial " +
    "area (" + CsArea.polygonArea(afPlanVerts) + ")");
var afFirstPt = afPlanVerts[0];
var afLastPt = afPlanVerts[afPlanVerts.length - 1];
ok(CsTrace.distance(afFirstPt, afLastPt) < 0.01,
    "AreaFillRun.commit: the boundary is GENUINELY closed -- its " +
    "first and last sampled points coincide (" +
    CsTrace.distance(afFirstPt, afLastPt) + " apart), not merely " +
    "LOOKING closed while scattering its fill through a gap");

// ---------------------------------------------------------------------
// The trip stamp: a real trip, derived from the nearest station, never
// a silent 0 -- the elevation-datum trap family this suite keeps
// finding new doors for.
// ---------------------------------------------------------------------

ok(afPlanMade.tripId !== 0 && !isNull(afPlanMade.tripId),
    "AreaFillRun.commit: the boundary is stamped with a real trip, " +
    "never a bare 0");
eqs(CsTags.get(afPlanBoundary, CsTrace.TRIP_TAG), String(afPlanMade.tripId),
    "AreaFillRun.commit: ... and the tag actually on the entity agrees " +
    "with what commit() reported");

// ---------------------------------------------------------------------
// Refusals: too few points, and too little area -- and NOTHING is left
// behind by either.
// ---------------------------------------------------------------------

var afBeforeRefusal = doc.queryAllEntities(false, true).length;

var afTooFewPoints = AreaFillRun.commit(doc, di,
    [{x:0,y:0},{x:1,y:0},{x:1,y:1}], "SAND", { scale: 1.0, density: 1.0 });
ok(afTooFewPoints.ok === false,
    "AreaFillRun.commit: a 3-point stroke is refused");
ok(afTooFewPoints.reason.length > 0,
    "AreaFillRun.commit: ... with a plain-language reason");

var afTooSmall = AreaFillRun.commit(doc, di,
    [{x:300,y:300},{x:300.1,y:300},{x:300.1,y:300.1},{x:300,y:300.1},
     {x:300,y:300}], "SAND", { scale: 1.0, density: 1.0 });
ok(afTooSmall.ok === false,
    "AreaFillRun.commit: a stroke enclosing under one square drawing " +
    "unit is refused (" + afTooSmall.reason + ")");
ok(afTooSmall.reason.length > 0,
    "AreaFillRun.commit: ... with a plain-language reason");

eqs(doc.queryAllEntities(false, true).length, afBeforeRefusal,
    "AreaFillRun.commit: both refused strokes created NOTHING -- not a " +
    "boundary with no fill, not a half-built anything");
eqs(CsArea.countOwned(doc, afTooSmall.id), 0,
    "AreaFillRun.commit: nothing is findable under a refused stroke's " +
    "id, because there is no id to find anything under");

// ---------------------------------------------------------------------
// A locked target layer: a NAMED refusal, not a silent no-op, and
// still nothing left behind.
// ---------------------------------------------------------------------

var afSandLayer = doc.queryLayer(CsArea.CATALOG.SAND.layer);
afSandLayer.setLocked(true);
var afLockOp = new RModifyObjectsOperation();
afLockOp.addObject(afSandLayer, false);
di.applyOperation(afLockOp);

var afBeforeLock = doc.queryAllEntities(false, true).length;
var afLocked = AreaFillRun.commit(doc, di,
    squareStroke(afPlanCx + 200, afPlanCy, 4), "SAND",
    { scale: 1.0, density: 1.0 });

ok(afLocked.ok === false,
    "AreaFillRun.commit: a locked target layer is refused, not " +
    "silently skipped");
ok(afLocked.reason.indexOf(CsArea.CATALOG.SAND.layer) >= 0,
    "AreaFillRun.commit: the refusal NAMES the locked layer (" +
    afLocked.reason + ")");
ok(afLocked.reason.toUpperCase().indexOf("LOCKED") >= 0,
    "AreaFillRun.commit: ... and says it is LOCKED, not just \"refused\"");
eqs(doc.queryAllEntities(false, true).length, afBeforeLock,
    "AreaFillRun.commit: the locked-layer refusal created nothing at " +
    "all");

afSandLayer.setLocked(false);
var afUnlockOp = new RModifyObjectsOperation();
afUnlockOp.addObject(afSandLayer, false);
di.applyOperation(afUnlockOp);

// The OTHER layer an area touches: SAND unlocked but its BOUNDARY
// layer locked. refusalReason claims to read back every layer it is
// given, not just the first -- this is the case that would catch a
// regression that only ever checked the fill layer and let a locked
// boundary through silently.
var afBoundaryLayer = doc.queryLayer(CsArea.CATALOG.SAND.boundaryLayer);
afBoundaryLayer.setLocked(true);
var afLockBoundaryOp = new RModifyObjectsOperation();
afLockBoundaryOp.addObject(afBoundaryLayer, false);
di.applyOperation(afLockBoundaryOp);

var afBeforeLockBoundary = doc.queryAllEntities(false, true).length;
var afLockedBoundary = AreaFillRun.commit(doc, di,
    squareStroke(afPlanCx + 400, afPlanCy, 4), "SAND",
    { scale: 1.0, density: 1.0 });

ok(afLockedBoundary.ok === false,
    "AreaFillRun.commit: a locked BOUNDARY layer is refused too, not " +
    "just a locked fill layer");
ok(afLockedBoundary.reason.indexOf(CsArea.CATALOG.SAND.boundaryLayer) >= 0,
    "AreaFillRun.commit: the refusal NAMES the locked boundary layer (" +
    afLockedBoundary.reason + ")");
ok(afLockedBoundary.reason.toUpperCase().indexOf("LOCKED") >= 0,
    "AreaFillRun.commit: ... and says it is LOCKED");
eqs(doc.queryAllEntities(false, true).length, afBeforeLockBoundary,
    "AreaFillRun.commit: the locked-boundary refusal created nothing " +
    "at all either");

afBoundaryLayer.setLocked(false);
var afUnlockBoundaryOp = new RModifyObjectsOperation();
afUnlockBoundaryOp.addObject(afBoundaryLayer, false);
di.applyOperation(afUnlockBoundaryOp);

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
