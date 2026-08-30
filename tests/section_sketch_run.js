// section_sketch_run.js -- the sketched-section lifecycle against a REAL
// document: open a bay, trace into it, capture, refresh, round-trip and
// reopen.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/section_sketch_run.js "$PWD"
//
// Prints "### SECTION SKETCH OK <n>" on success, "### SECTION SKETCH
// FAIL" plus the failed assertions otherwise.
//
// WHY THIS FILE EXISTS RATHER THAN MORE UNIT TESTS. CsSectionBay's
// maths are node-tested and none of them is where this feature can
// break. What can break is everything that only exists once there is an
// RDocument: a sweep measured against a STALE bounding box, a block
// whose entities are placed in world coordinates instead of block-local
// ones, tags that survive in memory and vanish through DXF, and a
// LOCKED layer that accepts a delete and keeps the entity anyway.
//
// TWO ASSERTIONS HERE WERE MUTATION-TESTED, and are the two this file
// is really for:
//
//   * "block-local about the ghost centre" (claim 3). Deleting the
//     `e.move(new RVector(-origin.x, -origin.y))` from
//     SectionCapture.capture turns it red with
//     "expected -3, got 27" -- a section landing a bay's width from
//     its own leader.
//   * "the bay is torn down" (claim 7). Deleting the frame's
//     `CsLayers.withLayerUnlocked` wrapper -- so the LOCKED
//     CTRL-SECTION-BOX layer refuses the delete in silence -- turns it
//     red with "the frame is gone from the drawing".
//
// WHY NOT isNull() FOR "THIS WAS DELETED". Probed, and the same finding
// tests/cross_section_run.js records: doc.queryEntity() on a deleted id
// does NOT return null here -- it returns the entity with
// isUndone()===true, which this suite's isNull() shim cannot see. Every
// absence claim below therefore goes through
// doc.queryAllEntities(false, true) (which EXCLUDES undone entities) or
// CalloutWrite.members(), which is built on it. An isNull()-based
// teardown check stays green with the teardown removed -- that is what
// the mutation test above measured.

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

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];

function loadRepoScript(rel) {
    var file = new QFile(repoRoot + "/" + rel);
    if (!file.open(QIODevice.ReadOnly | QIODevice.Text)) {
        throw new Error("cannot open " + rel);
    }
    var stream = new QTextStream(file);
    var source = String(stream.readAll());
    file.close();
    // Dependencies are loaded explicitly below; QCAD's own include()
    // would look in the installed script folders, not this checkout.
    source = source.replace(/^\s*include\(.*\);\s*$/mg, "");
    // Indirect eval, so definitions land in the GLOBAL scope.
    (0, eval)(source);
}

// EAction and simple.js come from the APPLICATION, by their real paths
// -- the three tool files under test build their prototypes from
// EAction at load time.
include("scripts/EAction.js");
include("scripts/simple.js");

// ---------------------------------------------------------------------
// The Core library, read out of CsAll.js rather than hand-listed.
//
// DELIBERATE DIVERGENCE from every other *_run.js in this suite, all of
// which carry their own hand-written CORE array. A file missing from
// such a list is `undefined` at runtime, and the deliberate try/catches
// in the tools under test (CsRevise.resolveAsDrawn, CsStore, the snap
// and zoom guards) turn that into a SILENT PASS -- the test would prove
// only that the catch block works. CsAll.js is already the single place
// a Core file is registered (test_addon.py enforces it), so reading the
// list from there means this file cannot drift out of date, and cannot
// pass by loading less than the tools actually use.
// ---------------------------------------------------------------------
(function() {
    var f = new QFile(repoRoot + "/scripts/CaveSurvey/Core/CsAll.js");
    if (!f.open(QIODevice.ReadOnly | QIODevice.Text)) {
        throw new Error("cannot open Core/CsAll.js");
    }
    var text = String(new QTextStream(f).readAll());
    f.close();
    var lines = text.split("\n");
    for (var i = 0; i < lines.length; i++) {
        var m = /include\(includeBasePath \+ "\/([^"]+)"\);/.exec(lines[i]);
        if (m !== null) {
            loadRepoScript("scripts/CaveSurvey/Core/" + m[1]);
        }
    }
})();

loadRepoScript("scripts/CaveSurvey/Callout/CalloutWrite.js");
loadRepoScript("scripts/CaveSurvey/SketchSection/SketchSection.js");
loadRepoScript("scripts/CaveSurvey/SketchSection/SectionCapture.js");
loadRepoScript("scripts/CaveSurvey/SketchSection/SectionEdit.js");

var failures = [];
var checks = 0;

function check(name, condition) {
    checks++;
    if (condition !== true) {
        failures.push(name);
    }
}

function checkClose(name, actual, expected, tol) {
    checks++;
    if (!(Math.abs(actual - expected) <= (tol === undefined ? 1e-6 : tol))) {
        failures.push(name + " -- expected " + expected + ", got " + actual);
    }
}

// ---------------------------------------------------------------------
// Sanity: the Core library really did load. Every claim below runs
// through code that catches its own exceptions, so a half-loaded
// library would otherwise read as a quiet, wrong pass.
// ---------------------------------------------------------------------
(function() {
    var needed = ["CsUuid", "CsUnits", "CsAngles", "CsModel", "CsFrontier",
        "CsTraverse", "CsNetwork", "CsAdjust", "CsLrud", "CsSectionCut",
        "CsTags", "CsStore", "CsLayers", "CsCallout", "CsSectionDraw",
        "CsSectionBay", "CsRevise", "CsStationOrder", "CsScanFrame",
        "CsDraw", "CsBind", "CsElevation", "CsProfile", "CsWarp"];
    var missing = [];
    for (var i = 0; i < needed.length; i++) {
        if (typeof this[needed[i]] === "undefined") {
            missing.push(needed[i]);
        }
    }
    check("every Core library the tools reach for is loaded" +
        (missing.length === 0 ? "" : " (missing " + missing.join(", ") + ")"),
        missing.length === 0);
    check("the three tools under test are loaded",
        typeof SketchSection === "function" &&
        typeof SectionCapture === "function" &&
        typeof SectionEdit === "function");
}).call(this);

// ---------------------------------------------------------------------
// A document with a survey, walls, and a real scan on disk.
//
// The tools reach for the CURRENT document through EAction.getDocument()
// (SketchSection.run, SectionEdit.run), which resolves through
// global.gDocumentInterface before it ever asks the main window -- and
// headless there IS no main window. So the fixture is installed there,
// exactly as tests/generate_profile_run.js reassigns getDocument/
// getDocumentInterface for the same reason.
//
// THE SURVEY IS DRAWN INTO THE DRAWING, not just held in memory.
// tests/cross_section_run.js hands CalloutWrite an already-computed cut
// and never needs plotted stations; these three tools do not work that
// way. SketchSection.run rebuilds the survey from the drawing's own
// tags (CsRevise.resolveAsDrawn) to compute the ghost, and
// SectionCapture.proposePosition finds the station through
// CsTags.collectStations(doc). A fixture with no plotted stations would
// produce a bay with no ghost and a capture with no proposal -- both of
// which the tools handle gracefully, so the test would pass having
// exercised none of it.
// ---------------------------------------------------------------------
var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
var di = new RDocumentInterface(doc);
global.gDocumentInterface = di;
getDocument = function() { return doc; };
getDocumentInterface = function() { return di; };
doc.setFileName(QDir.tempPath() + "/cs_section_sketch_run.dxf");

// Every "Sketch Section: ..." message, captured rather than shown -- a
// modal dialog in a headless run is a hang, and the messages are
// evidence in their own right (claim 1 asserts the bay opened WITHOUT
// the "no cuttable LRUD" complaint, which is how we know the ghost is
// a real computed outline and not a fallback box).
var said = [];
SketchSection.say = function(text) { said.push(String(text)); };

CsLayers.ensure(doc, di, CsLayers.CTRL_STATIONS);
CsLayers.ensure(doc, di, CsLayers.CTRL_SHOTS);
CsLayers.ensure(doc, di, CsLayers.WALLS_SURVEYED);
CsLayers.ensure(doc, di, CsLayers.SECTION_WALLS_SURVEYED);

/** A plotted station, tagged the way CsDraw.survey tags one: the tag
 *  set CsTags.surveyFromDocument actually reads back. LRUD rides on the
 *  station it ARRIVES at, which is the suite's own convention. */
function putStation(name, seq, x, y, lrud) {
    var p = new RPointEntity(doc, new RPointData(new RVector(x, y)));
    p.setLayerId(doc.getLayerId(CsLayers.CTRL_STATIONS));
    CsTags.set(p, "Station", name);
    CsTags.set(p, "Seq", seq);
    CsTags.set(p, "Elevation", 0);
    if (lrud !== undefined && lrud !== null) {
        CsTags.set(p, "Left", lrud.l);
        CsTags.set(p, "Right", lrud.r);
        CsTags.set(p, "Up", lrud.u);
        CsTags.set(p, "Down", lrud.d);
    }
    di.applyOperation(new RAddObjectOperation(p, false));
    return p;
}

function putLine(layerName, x1, y1, x2, y2) {
    var e = new RLineEntity(doc, new RLineData(
        new RVector(x1, y1), new RVector(x2, y2)));
    e.setLayerId(doc.getLayerId(layerName));
    di.applyOperation(new RAddObjectOperation(e, false));
    return e;
}

// FOUR stations, not three. LRUD rides on the station a shot ARRIVES
// at, so the first station in the chain never gets any -- and
// CsSectionCut.cut refuses a leg whose either end has fewer than
// MIN_POINTS measured wall points. A0 exists purely so that A1, the far
// end of the leg the cut at A2 is taken on, has an LRUD of its own.
// (Measured: with A1 first in the chain the cut is refused with
// "station A1 has fewer than 3 measured wall points" and the bay opens
// with no ghost at all -- which every claim below would then be
// measuring against the frame's centre instead.)
var LRUD = { l: 4, r: 4, u: 3, d: 2 };
putStation("A0", 0, -20, 0, LRUD);
putStation("A1", 1, -10, 0, LRUD);
putStation("A2", 2, 0, 0, LRUD);
putStation("A3", 3, 10, 0, LRUD);
putLine(CsLayers.CTRL_SHOTS, -20, 0, -10, 0);
putLine(CsLayers.CTRL_SHOTS, -10, 0, 0, 0);
putLine(CsLayers.CTRL_SHOTS, 0, 0, 10, 0);

// THE WALL THE MARCH HAS TO MARCH PAST. Two walls above the passage and
// one below it: CsSectionBay.clearerSide counts obstacles within its
// probe reach and takes the emptier side, so the section is sent DOWN
// (-Y) -- straight at the wall at y = -6, which is close enough to the
// station that no acceptable spot exists until the march has stepped
// clear past it. Without a wall there, the march clears the station
// point itself on its second step and this claim proves nothing.
putLine(CsLayers.WALLS_SURVEYED, -20, 5, 20, 5);
putLine(CsLayers.WALLS_SURVEYED, -20, 8, 20, 8);
var blocker = putLine(CsLayers.WALLS_SURVEYED, -20, -6, 20, -6);
blocker.update();
var blockerBox = {
    x1: blocker.getBoundingBox().getMinimum().x,
    y1: blocker.getBoundingBox().getMinimum().y,
    x2: blocker.getBoundingBox().getMaximum().x,
    y2: blocker.getBoundingBox().getMaximum().y
};

// A real raster the engine can actually read, so the scan is a real
// RImageEntity and not a silently skipped one -- the same trick
// tests/scan_reanchor_run.js uses.
var scanPath = repoRoot + "/scripts/CaveSurvey/SketchSection/SketchSection.svg";
check("fixture: the scan file this run underlays is readable",
    !(new QImage(scanPath)).isNull());

var asDrawn = CsRevise.resolveAsDrawn(doc);
check("fixture: the drawing's own tags rebuild the survey",
    asDrawn !== null && asDrawn.resolved.stations.A2 !== undefined);

// ---------------------------------------------------------------------
// CLAIM 1: a bay opens, is found again by its frame, and sweeps nothing
// while nothing is traced.
// ---------------------------------------------------------------------
var bayId = SketchSection.run(scanPath, "A2");
check("1: a bay opens", bayId !== null && bayId !== undefined);
check("1: and it opened with a real computed ghost, not the " +
    "no-cuttable-LRUD fallback", said.length === 0);

var bay0 = SectionCapture.findBay(doc);
check("1: the bay is found again by its frame", bay0 !== null);
check("1: the frame it was found by is the one just drawn",
    bay0 !== null && bay0.id === bayId);
check("1: with the station it was opened at",
    bay0 !== null && bay0.station === "A2");
check("1: it has a ghost", bay0 !== null && bay0.ghost !== null);
check("1: it has a scan", bay0 !== null && bay0.scan !== null);
check("1: and nothing is swept while nothing is traced",
    bay0 !== null && bay0.traced.length === 0);
check("1: the frame really is on the LOCKED CTRL-SECTION-BOX layer -- " +
    "which is what claim 7's teardown has to get past",
    bay0 !== null &&
    doc.getLayerName(bay0.frame.getLayerId()) === CsLayers.CTRL_SECTION_BOX &&
    CsLayers.LOCKED[CsLayers.CTRL_SECTION_BOX] === true);

// ---------------------------------------------------------------------
// CLAIM 2: what is traced inside the frame is swept -- and the frame,
// the ghost and the scan are NOT.
// ---------------------------------------------------------------------
var centre = SectionCapture.originOf(bay0);
var traced = new RLineEntity(doc, new RLineData(
    new RVector(centre.x - 3, centre.y - 3),
    new RVector(centre.x + 3, centre.y + 3)));
traced.setLayerId(doc.getLayerId(CsLayers.SECTION_WALLS_SURVEYED));
var traceOp = new RAddObjectsOperation();
traceOp.addObject(traced, false);
di.applyOperation(traceOp);
var tracedId = traced.getId();

var bay1 = SectionCapture.findBay(doc);
check("2: the tracing is swept",
    bay1 !== null && bay1.traced.length === 1);
check("2: and it is the tracing, by id",
    bay1 !== null && bay1.traced.length === 1 &&
    String(bay1.traced[0]) === String(tracedId));
// Named individually rather than inferred from the count: a sweep that
// took the frame and dropped the tracing would also have length 1.
var sweptIds = {};
if (bay1 !== null) {
    for (var si = 0; si < bay1.traced.length; si++) {
        sweptIds[String(bay1.traced[si])] = true;
    }
}
check("2: the frame is NOT swept",
    bay1 !== null && sweptIds[String(bay1.frame.getId())] !== true);
check("2: the ghost is NOT swept",
    bay1 !== null && bay1.ghost !== null &&
    sweptIds[String(bay1.ghost.getId())] !== true);
check("2: the scan is NOT swept",
    bay1 !== null && bay1.scan !== null &&
    sweptIds[String(bay1.scan.getId())] !== true);

// ---------------------------------------------------------------------
// CLAIM 6 (measured before the capture, which tears the bay down): the
// proposed spot clears every plan-frame obstacle by CsSectionBay.MARGIN,
// and the wall really was in the way.
// ---------------------------------------------------------------------
var origin = SectionCapture.originOf(bay1);
var localBox = SectionCapture.localBoxOf(doc, bay1, origin);
var obstacles = SectionCapture.obstaclesOf(doc, bay1);
var at = SectionCapture.proposePosition(doc, bay1);
check("6: a position is proposed", at !== null);

var stationAt = null;
var allStations = CsTags.collectStations(doc);
for (var qi = 0; qi < allStations.length; qi++) {
    if (allStations[qi].name === "A2") {
        stationAt = { x: allStations[qi].pos.x, y: allStations[qi].pos.y };
    }
}
check("6: fixture: the station the march starts from is found",
    stationAt !== null);

var worst = null;
if (at !== null) {
    var placedBox = CsSectionBay.boxAt(localBox, at);
    for (var oi = 0; oi < obstacles.length; oi++) {
        if (CsSectionBay.overlaps(placedBox, obstacles[oi],
                CsSectionBay.MARGIN)) {
            worst = obstacles[oi];
        }
    }
}
check("6: fixture: there are plan obstacles to clear at all",
    obstacles.length > 0);
check("6: the proposed spot clears EVERY plan obstacle by MARGIN" +
    (worst === null ? "" : " (hit " + JSON.stringify(worst) + ")"),
    at !== null && worst === null);

// THE MARCH ACTUALLY MARCHED. One step back toward the station, the
// wall -- and only the wall -- is what blocks: proof the section was
// pushed past a real obstacle rather than landing on the first step.
if (at !== null && stationAt !== null) {
    var dirY = (at.y < stationAt.y) ? 1 : -1;
    var oneStepBack = { x: at.x, y: at.y + dirY * CsSectionBay.STEP };
    var backBox = CsSectionBay.boxAt(localBox, oneStepBack);
    check("6: one step short of the proposal, the wall blocks it",
        CsSectionBay.overlaps(backBox, blockerBox, CsSectionBay.MARGIN));
    check("6: and the proposal itself clears that same wall",
        !CsSectionBay.overlaps(CsSectionBay.boxAt(localBox, at), blockerBox,
            CsSectionBay.MARGIN));
} else {
    check("6: one step short of the proposal, the wall blocks it", false);
    check("6: and the proposal itself clears that same wall", false);
}

// ---------------------------------------------------------------------
// CLAIM 3, 4, 5: capture.
// ---------------------------------------------------------------------
var frameId = bay1.frame.getId();
var ghostId = bay1.ghost.getId();
var scanId = bay1.scan.getId();
var storedScan = CsTags.get(bay1.scan, CsCallout.KEY.SECTION_SCAN);
var storedFit = CsTags.get(bay1.scan, CsCallout.KEY.SECTION_FIT);
check("4: fixture: the bay's scan carries the path it was placed from",
    storedScan === scanPath);
check("4: fixture: and the fit it was placed at", storedFit !== "");

var id = SectionCapture.capture(doc, di, bay1, at);
check("3: the section is captured", id !== null && id !== undefined);

var members = CalloutWrite.members(doc, id);
check("3: its content is a BLOCK, not text",
    members.block !== null && members.text === null);
var blockName = CsSectionDraw.blockName(id);
var blockId = doc.getBlockId(blockName);
check("3: and it is this section's own definition, CS_<CalloutId>",
    members.block !== null && blockId === members.block.getData()
        .getReferencedBlockId());

var inBlock = doc.queryBlockEntities(blockId);
check("3: the block holds the tracing, and only the tracing",
    inBlock.length === 1);
check("3: and it is the very entity that was traced, moved not copied",
    inBlock.length === 1 && String(inBlock[0]) === String(tracedId));

// BLOCK-LOCAL. The tracing ran from centre-3 to centre+3 in world
// coordinates, where centre is the GHOST's centre; inside the block it
// must run -3 to +3. Get this wrong and every section lands a bay's
// width away from its own leader -- which is a bay's width off the
// sheet, since the bay is parked clear of the whole drawing.
if (inBlock.length === 1) {
    var held = doc.queryEntity(inBlock[0]);
    held.update();
    var hb = held.getBoundingBox();
    checkClose("3: block-local about the ghost centre (min x)",
        hb.getMinimum().x, -3);
    checkClose("3: block-local about the ghost centre (min y)",
        hb.getMinimum().y, -3);
    checkClose("3: block-local about the ghost centre (max x)",
        hb.getMaximum().x, 3);
    checkClose("3: block-local about the ghost centre (max y)",
        hb.getMaximum().y, 3);
} else {
    check("3: block-local about the ghost centre", false);
}

// The reference sits exactly where the march proposed it.
var placedAt = members.block.getData().getPosition();
checkClose("3: the reference sits at the proposed spot (x)", placedAt.x, at.x);
checkClose("3: the reference sits at the proposed spot (y)", placedAt.y, at.y);

// ---- claim 4: the reference's own record --------------------------
check("4: tagged SectionSource=sketch",
    CsTags.get(members.block, CsCallout.KEY.SECTION_SOURCE) ===
        CsCallout.SOURCE_SKETCH);
check("4: carrying its station",
    CsTags.get(members.block, CsCallout.KEY.SECTION_STATION) === "A2");
check("4: carrying its scale",
    parseFloat(CsTags.get(members.block, CsCallout.KEY.SECTION_SCALE)) ===
        CsSectionDraw.scaleOf());
check("4: carrying the scan it was traced from",
    CsTags.get(members.block, CsCallout.KEY.SECTION_SCAN) === scanPath);
check("4: carrying the bay fit the scan was placed at",
    CsTags.get(members.block, CsCallout.KEY.SECTION_FIT) === storedFit);
check("4: and the fit reads back as a fit, not as a corrupt tag",
    CsSectionBay.parseFit(
        CsTags.get(members.block, CsCallout.KEY.SECTION_FIT)) !== null);
check("4: it is a section callout, by role and kind",
    CsTags.get(members.block, CsCallout.KEY.KIND) === CsCallout.KIND_SECTION &&
    CsTags.get(members.block, CsCallout.KEY.ROLE) === CsCallout.ROLE_BLOCK);

// ---- claim 5: the leader ------------------------------------------
check("5: exactly one leader", members.leaders.length === 1);
if (members.leaders.length === 1) {
    var ld = members.leaders[0].getData();
    var v0 = ld.getVertexAt(0);
    var v1 = ld.getVertexAt(1);
    checkClose("5: it starts AT the station (x)", v0.x, stationAt.x);
    checkClose("5: it starts AT the station (y)", v0.y, stationAt.y);
    checkClose("5: and it ends at the section (x)", v1.x, at.x);
    checkClose("5: and it ends at the section (y)", v1.y, at.y);
} else {
    check("5: it starts AT the station", false);
}

// ---------------------------------------------------------------------
// CLAIM 7: the bay is gone -- frame, ghost, scan and loose tracing.
//
// NOT ASSERTED WITH isNull(). See this file's header: queryEntity on a
// deleted id hands the entity back with isUndone()===true here, so an
// isNull() check would pass whether or not the delete landed.
// queryAllEntities(false, true) excludes undone entities and is the
// only reliable "it is gone" in this build.
// ---------------------------------------------------------------------
function liveIds() {
    var out = {};
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        out[String(ids[i])] = true;
    }
    return out;
}
function liveBayFurniture() {
    var found = [];
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        if (CsTags.get(e, SketchSection.TAG_BAY) !== "") {
            found.push(CsTags.get(e, "SectionBayRole") || "untagged-role");
        }
    }
    return found;
}

var live = liveIds();
check("7: the frame is gone from the drawing -- the LOCKED " +
    "CTRL-SECTION-BOX layer did not silently refuse its delete",
    live[String(frameId)] !== true);
check("7: the ghost is gone", live[String(ghostId)] !== true);
check("7: the scan is gone", live[String(scanId)] !== true);
var leftovers = liveBayFurniture();
check("7: no bay furniture of any kind survives" +
    (leftovers.length === 0 ? "" : " (found " + leftovers.join(", ") + ")"),
    leftovers.length === 0);
check("7: and there is no bay left to find", SectionCapture.findBay(doc) === null);
// The tracing is not "loose in the drawing" any more either: it lives
// in the block now. Same entity, different owner.
var tracedNow = doc.queryEntity(tracedId);
check("7: the tracing is no longer loose -- it belongs to the block",
    !isNull(tracedNow) && tracedNow.getBlockId() === blockId &&
    tracedNow.getBlockId() !== doc.getModelSpaceBlockId());

// ---------------------------------------------------------------------
// CLAIM 8: Draw counts it and leaves it alone.
// ---------------------------------------------------------------------
var beforeIds = doc.queryBlockEntities(blockId);
var beforeRefId = members.block.getId();
var beforePos = members.block.getData().getPosition();

var report = CalloutWrite.refreshSectionsFromDocument(doc, di);
check("8: a refresh counts it as sketched",
    report !== null && report.sketched === 1);
check("8: and never re-derives it", report !== null && report.updated === 0);

var afterIds = doc.queryBlockEntities(blockId);
check("8: the block still holds exactly what it held",
    afterIds.length === beforeIds.length && afterIds.length === 1);
// IDENTITY, not a count: a regenerate that deleted the tracing and drew
// an LRUD outline in its place would keep the count at 1.
check("8: and the SAME entity, never replaced",
    afterIds.length === 1 && String(afterIds[0]) === String(tracedId));

var m8 = CalloutWrite.members(doc, id);
check("8: the reference is the same entity, not rewritten",
    m8.block !== null && m8.block.getId() === beforeRefId);
checkClose("8: and it did not move (x)",
    m8.block.getData().getPosition().x, beforePos.x);
checkClose("8: and it did not move (y)",
    m8.block.getData().getPosition().y, beforePos.y);
check("8: a second pass counts it the same way",
    CalloutWrite.refreshSectionsFromDocument(doc, di).sketched === 1);

// ---------------------------------------------------------------------
// CLAIM 9: a DXF round trip preserves the block, the reference and
// every tag.
//
// The link between a section and its leader is XDATA and nothing else
// -- there is no side table in the drawing. If these tags do not
// survive a save, every sketched section decays into an unrelated block
// and a loose arrow the moment the file is reopened, and every
// in-memory claim above would still pass.
// ---------------------------------------------------------------------
(function() {
    var rtPath = QDir.tempPath() + "/cs_section_sketch_roundtrip.dxf";
    var rtFilter = "";
    var filters = RFileExporterRegistry.getFilterStrings();
    for (var f = 0; f < filters.length; f++) {
        if (String(filters[f]).indexOf("dxflib") >= 0) {
            rtFilter = String(filters[f]);
            break;
        }
    }
    check("9: the drawing with a sketched section in it exports",
        di.exportFile(rtPath, rtFilter, false) === true);

    var rtDoc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
    var rtDi = new RDocumentInterface(rtDoc);
    check("9: the file reads back",
        rtDi.importFile(rtPath, "", false) ===
            RDocumentInterface.IoErrorNoError);

    var rt = CalloutWrite.members(rtDoc, id);
    check("9: the reference is found again BY ITS TAG", rt.block !== null);
    check("9: and its leader with it", rt.leaders.length === 1);
    if (rt.block === null) {
        check("9: the block definition survives", false);
        return;
    }
    var rtBlockId = rt.block.getData().getReferencedBlockId();
    check("9: the block definition survives under its own name",
        rtDoc.getBlockId(blockName) === rtBlockId);
    check("9: holding the tracing", rtDoc.queryBlockEntities(rtBlockId).length === 1);
    checkClose("9: the reference is still where it was placed (x)",
        rt.block.getData().getPosition().x, at.x, 1e-4);
    checkClose("9: the reference is still where it was placed (y)",
        rt.block.getData().getPosition().y, at.y, 1e-4);

    var keys = [CsCallout.KEY.ID, CsCallout.KEY.ROLE, CsCallout.KEY.KIND,
        CsCallout.KEY.STYLE, CsCallout.KEY.SIDE, CsCallout.KEY.LEADER,
        CsCallout.KEY.SECTION_SOURCE, CsCallout.KEY.SECTION_STATION,
        CsCallout.KEY.SECTION_SCALE, CsCallout.KEY.SECTION_SCAN,
        CsCallout.KEY.SECTION_FIT];
    for (var k = 0; k < keys.length; k++) {
        var was = CsTags.get(members.block, keys[k]);
        var now = CsTags.get(rt.block, keys[k]);
        check("9: tag " + keys[k] + " survives the round trip " +
            "(was \"" + was + "\", now \"" + now + "\")",
            was !== "" && now === was);
    }
    check("9: the leader's own role tag survives",
        rt.leaders.length === 1 &&
        CsTags.get(rt.leaders[0], CsCallout.KEY.ROLE) ===
            CsCallout.ROLE_LEADER);
    check("9: and the fit still parses on the far side",
        CsSectionBay.parseFit(
            CsTags.get(rt.block, CsCallout.KEY.SECTION_FIT)) !== null);
})();

// ---------------------------------------------------------------------
// CLAIM 10: Edit Sketch reopens it.
// ---------------------------------------------------------------------
var refIdBeforeEdit = CalloutWrite.members(doc, id).block.getId();
var leaderIdBeforeEdit = CalloutWrite.members(doc, id).leaders[0].getId();
di.selectEntity(refIdBeforeEdit, true);
check("10: fixture: the section is selected for Edit Sketch",
    doc.hasSelection() && doc.querySelectedEntities().length >= 1);

said = [];
SectionEdit.run();
check("10: Edit Sketch reopened without complaint" +
    (said.length === 0 ? "" : " (said: " + said.join(" | ") + ")"),
    said.length === 0);

var reopened = SectionCapture.findBay(doc);
check("10: a bay is open again", reopened !== null);
check("10: at the same station",
    reopened !== null && reopened.station === "A2");
check("10: with the scan back under it", reopened !== null &&
    reopened.scan !== null &&
    CsTags.get(reopened.scan, CsCallout.KEY.SECTION_SCAN) === scanPath);
check("10: and the linework loose inside it, ready to trace over",
    reopened !== null && reopened.traced.length === 1 &&
    String(reopened.traced[0]) === String(tracedId));

var back = doc.queryEntity(tracedId);
check("10: the linework is out of the block and back in model space",
    !isNull(back) && back.getBlockId() === doc.getModelSpaceBlockId());

var m10 = CalloutWrite.members(doc, id);
check("10: the placed reference is gone", m10.block === null);
check("10: and its leaders with it", m10.leaders.length === 0);
var liveAfterEdit = liveIds();
check("10: the reference really left the drawing, by id",
    liveAfterEdit[String(refIdBeforeEdit)] !== true);
check("10: and so did the leader",
    liveAfterEdit[String(leaderIdBeforeEdit)] !== true);

var goneBlockId = doc.getBlockId(blockName);
check("10: the emptied block definition is gone, not left as dead weight",
    goneBlockId === RBlock.INVALID_ID || goneBlockId < 0 ||
    isNull(doc.queryBlock(goneBlockId)));

if (failures.length === 0) {
    print("### SECTION SKETCH OK " + checks);
} else {
    for (var fi = 0; fi < failures.length; fi++) {
        print("FAIL: " + failures[fi]);
    }
    print("### SECTION SKETCH FAIL " + failures.length + " of " + checks);
}
