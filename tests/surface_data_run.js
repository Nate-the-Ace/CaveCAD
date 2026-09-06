// surface_data_run.js -- CsSurfaceData against real documents.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/surface_data_run.js "$PWD"
//
// Prints "### SURFACE DATA OK <n>" or "### SURFACE DATA FAIL".
//
// CsSurfaceData.run is the merge of two former menu entries -- Aerial
// Basemap and Surface Contours -- which asked the same "where is the
// ground?" question and failed in two separately worded ways when
// nobody had answered it. What only a real RDocument proves here: a
// drawing with no geo anchor at all is refused ONCE, before either
// pass would reach for the network, and the refusal says where to fix
// that; an anchored drawing with both passes switched off is accepted
// and reports both as skipped without touching the network either.
//
// Deliberately NOT tested here: an anchored drawing with imagery or
// contours actually switched ON. Both passes fetch from a real tile
// service over the network, and a test suite must not depend on one
// being reachable. CsSurfaceData.basemap/contours' own request math
// (ground windows, Mercator bboxes, pixel sizing) lives in
// Core/CsGeoProject.js and is covered headlessly there instead.

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

// ---------------------------------------------------------------------
// Assertion harness -- the shape every engine suite here uses.
// ---------------------------------------------------------------------

var passed = 0;
var failures = [];
function ok(condition, what) {
    if (condition) {
        passed++;
    } else {
        failures.push(what);
    }
}

function shotOf(from, to, d, az, inc) {
    var s = CsModel.newShot();
    s.from = from;
    s.to = to;
    s.distance = d;
    s.azimuth = az;
    s.inclination = inc || 0;
    return s;
}

// ---------------------------------------------------------------------
// Fixture 1: a drawing with no geo anchor at all -- no GeoLat/GeoLon on
// any station, and (deliberately) no station named A1 either, so
// CsSurfaceData.findAnchor's fallback chain has nothing to fall back
// to and the drawing really has "no location yet".
// ---------------------------------------------------------------------

var docBare = new RDocument(new RMemoryStorage(), createSpatialIndex());
var diBare = new RDocumentInterface(docBare);
getDocument = function() { return docBare; };
getDocumentInterface = function() { return diBare; };

var bareSurvey = CsModel.newSurvey();
bareSurvey.caveName = "SURFACE DATA BARE";
bareSurvey.distanceUnit = "ft";
bareSurvey.shots.push(shotOf("ENT", "B1", 20.0, 90.0, 0.0));
CsDraw.survey(bareSurvey, CsNetwork.resolve(bareSurvey, {}));

// A drawing with no geo anchor: one refusal, before either pass does
// any network work, naming where to fix it.
var bare = CsSurfaceData.run(docBare, diBare, {});
ok(bare.ok === false, "no anchor is refused");
ok(bare.lines.length === 1, "the refusal is one line");
ok(bare.lines[0].indexOf("Declination") !== -1,
    "the refusal names where to set a location (Survey Notebook > Declination)");
ok(bare.lines[0].indexOf("A1") !== -1,
    "the refusal also names the entrance-station convention");

// ---------------------------------------------------------------------
// Fixture 2: an anchored drawing -- station A1 carries GeoLat/GeoLon,
// written the same way the standalone tools always wrote it (CsTags.
// commit; see CsSurfaceData.run's own "not yet anchored" branch).
// ---------------------------------------------------------------------

var docAnchored = new RDocument(new RMemoryStorage(), createSpatialIndex());
var diAnchored = new RDocumentInterface(docAnchored);
getDocument = function() { return docAnchored; };
getDocumentInterface = function() { return diAnchored; };

var anchoredSurvey = CsModel.newSurvey();
anchoredSurvey.caveName = "SURFACE DATA ANCHORED";
anchoredSurvey.distanceUnit = "ft";
anchoredSurvey.shots.push(shotOf("ENT", "A1", 20.0, 90.0, 0.0));
CsDraw.survey(anchoredSurvey, CsNetwork.resolve(anchoredSurvey, {}));

var stations = CsTags.collectStations(docAnchored);
var a1 = null;
for (var i = 0; i < stations.length; i++) {
    if (stations[i].name === "A1") {
        a1 = stations[i].entity;
        break;
    }
}
ok(a1 !== null, "the fixture drawing has a station A1 to anchor on");
var a1Pos = a1.getPosition();
CsTags.commit(diAnchored, a1, {
    GeoLat: 37.0,
    GeoLon: -85.0,
    GeoStation: "A1",
    // pin WHERE the coordinate was declared, exactly as run() itself
    // does -- otherwise resolveMovedAnchor treats a pre-pin drawing as
    // needing its frame pinned "here" on every call.
    GeoDrawX: a1Pos.x,
    GeoDrawY: a1Pos.y
});

// Both passes off: reports both as skipped, and -- since the fixture
// truly is anchored -- reaches that report without ever touching
// CsLocationPick.ask (which would hang the headless engine waiting on
// a dialog it cannot show).
var skipped = CsSurfaceData.run(docAnchored, diAnchored,
    { imagery: false, contours: false });
ok(skipped.ok === true, "anchored drawing, both passes off, is accepted");
ok(skipped.lines.length === 2, "two passes, two report lines");
ok(skipped.lines.join(" ").split("skipped").length === 3,
    "both passes report skipped");

// ---------------------------------------------------------------------
// Fixture 3: both passes off on the BARE (unanchored) drawing -- since
// neither pass needs the network, the anchor is never even asked for,
// so this is accepted too rather than refused.
// ---------------------------------------------------------------------

getDocument = function() { return docBare; };
getDocumentInterface = function() { return diBare; };
var bothOffBare = CsSurfaceData.run(docBare, diBare,
    { imagery: false, contours: false });
ok(bothOffBare.ok === true,
    "an unanchored drawing with both passes off is accepted, not refused");
ok(bothOffBare.lines.join(" ").split("skipped").length === 3,
    "both passes report skipped on the unanchored drawing too");

var out;
if (failures.length === 0) {
    out = "### SURFACE DATA OK " + passed;
} else {
    out = "### SURFACE DATA FAIL " + failures.length + " of " +
        (passed + failures.length) + "\n";
    for (var k = 0; k < failures.length; k++) {
        out += "  FAIL: " + failures[k] + "\n";
    }
}
print(out);
