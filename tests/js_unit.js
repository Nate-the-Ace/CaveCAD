// js_unit.js -- unit tests for the Cave Survey Core library.
//
// The Core is pure ECMAScript, so the same tests run two ways:
//
//   inside CaveCAD's own engine (authoritative -- the engine the add-on
//   really runs in):
//     /Applications/CaveCAD.app/Contents/MacOS/CaveCAD \
//         -no-dock-icon -no-gui -allow-multiple-instances \
//         -autostart tests/js_unit.js "$PWD"
//
//   under node (developer convenience):
//     node tests/js_unit.js
//
// Prints "### UNIT OK <n> assertions" on success; any failure prints
// "### UNIT FAIL" plus details and (in QCAD) leaves that marker for
// run_all.sh to spot.

// ---------------------------------------------------------------------
// Environment shim: repo root, file reading, and an include() that
// resolves "scripts/..." paths against the repo checkout instead of
// QCAD's installed script folders.
// ---------------------------------------------------------------------

var IS_NODE = (typeof process !== "undefined" && process.versions &&
    process.versions.node !== undefined);

var repoRoot;
var readTextFile;

if (IS_NODE) {
    var nodeFs = require("fs");
    var nodePath = require("path");
    repoRoot = nodePath.resolve(__dirname, "..");
    readTextFile = function(path) {
        return nodeFs.readFileSync(path, "utf8");
    };
} else {
    var args = RSettings.getOriginalArguments();
    repoRoot = args[args.length - 1];
    readTextFile = function(path) {
        var file = new QFile(path);
        if (!file.open(QIODevice.ReadOnly | QIODevice.Text)) {
            throw new Error("cannot open " + path);
        }
        var stream = new QTextStream(file);
        var content = stream.readAll();
        file.close();
        return content;
    };
}

// Some builds' -autostart engines don't preload library.js:
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

var loaded = {};
// Core files include() each other with scripts/-rooted paths; loading
// here goes through the same door so the graph stays honest.
function loadRepoScript(scriptPath) {
    if (loaded[scriptPath]) {
        return;
    }
    loaded[scriptPath] = true;
    var source = readTextFile(repoRoot + "/" + scriptPath);
    // Strip include() lines -- we load dependencies explicitly below,
    // and QCAD's own include() would look in the wrong place.
    source = source.replace(/^\s*include\(.*\);\s*$/mg, "");
    // Indirect eval, so definitions land in the GLOBAL scope in both
    // engines rather than in this function's scope.
    (0, eval)(source);
}

// Load order: leaves first.
var CORE_FILES = [
    "scripts/CaveSurvey/Core/CsUnits.js",
    "scripts/CaveSurvey/Core/CsAngles.js",
    "scripts/CaveSurvey/Core/CsIgrfCoeffs.js",
    "scripts/CaveSurvey/Core/CsGeomag.js",
    "scripts/CaveSurvey/Core/CsModel.js",
    "scripts/CaveSurvey/Core/CsTraverse.js",
    "scripts/CaveSurvey/Core/CsNetwork.js",
    "scripts/CaveSurvey/Core/CsLrud.js",
    "scripts/CaveSurvey/Core/CsValidate.js",
    "scripts/CaveSurvey/Core/CsStats.js",
    "scripts/CaveSurvey/Core/CsGrade.js",
    "scripts/CaveSurvey/Core/Format/CsCompass.js",
    "scripts/CaveSurvey/Core/Format/CsWalls.js",
    "scripts/CaveSurvey/Core/Format/CsSurvex.js",
    "scripts/CaveSurvey/Core/Format/CsCsv.js",
    "scripts/CaveSurvey/Core/Format/CsRegistry.js",
    "scripts/CaveSurvey/Core/CsRevise.js"
];
for (var ci = 0; ci < CORE_FILES.length; ci++) {
    loadRepoScript(CORE_FILES[ci]);
}

// ---------------------------------------------------------------------
// Tiny assertion kit
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

function near(a, b, tol, what) {
    ok(Math.abs(a - b) <= tol,
        what + " (expected " + b + " +/- " + tol + ", got " + a + ")");
}

// ---------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------

ok(CsUnits.normalize("Feet") === "ft", "normalize Feet");
ok(CsUnits.normalize("metres") === "m", "normalize metres");
ok(CsUnits.normalize("cubits") === undefined, "normalize unknown");
near(CsUnits.convert(1.0, "m", "ft"), 3.280839895, 1e-9, "m to ft");
near(CsUnits.convert(3.280839895, "ft", "m"), 1.0, 1e-9, "ft to m");
near(CsUnits.convert(7.5, "ft", "ft"), 7.5, 0, "same unit passthrough");

// ---------------------------------------------------------------------
// Angles
// ---------------------------------------------------------------------

near(CsAngles.normalizeAzimuth(-90), 270, 1e-12, "normalize -90");
near(CsAngles.normalizeAzimuth(725), 5, 1e-12, "normalize 725");
near(CsAngles.azimuthDifference(350, 10), 20, 1e-12, "azimuth wraparound diff");
near(CsAngles.applyDeclination(358, 4), 2, 1e-12, "declination east across north");
near(CsAngles.gradsToDegrees(400), 360, 1e-12, "grads full circle");
near(CsAngles.parseQuadrant("N30E"), 30, 1e-12, "quadrant N30E");
near(CsAngles.parseQuadrant("S45W"), 225, 1e-12, "quadrant S45W");
near(CsAngles.parseQuadrant("s12.5e"), 167.5, 1e-12, "quadrant s12.5e");
ok(CsAngles.parseQuadrant("123") === undefined, "quadrant rejects plain number");

var dms = CsAngles.parseLatLon("39 41'45.8\"N 86 18'34.0\"W");
ok(dms !== null, "DMS parses");
near(dms.lat, 39.696056, 1e-4, "DMS latitude");
near(dms.lon, -86.309444, 1e-4, "DMS longitude");
var dec = CsAngles.parseLatLon("39.6961, -86.3094");
ok(dec !== null && Math.abs(dec.lat - 39.6961) < 1e-9, "decimal lat/lon parses");
ok(CsAngles.parseLatLon("hello") === null, "lat/lon rejects junk");

// ---------------------------------------------------------------------
// Geomag -- fixtures generated with ppigrf (same IGRF-14 generation);
// tolerance 0.01 deg, far tighter than any compass.
// ---------------------------------------------------------------------

var GEOMAG_CASES = [
    [39.696, -86.309, { year: 1962, month: 7, day: 14 }, 1.1905],
    [39.696, -86.309, { year: 2026, month: 8, day: 19 }, -4.8895],
    [36.13, -86.05, { year: 1975, month: 3, day: 1 }, 0.5240],
    [44.4, 6.6, { year: 2000, month: 1, day: 1 }, -0.1981],
    [-31.9, 116.0, { year: 1990, month: 6, day: 15 }, -2.8094],
    [64.8, -147.7, { year: 2010, month: 1, day: 1 }, 20.9519],
    [37.2, -80.4, { year: 1920, month: 5, day: 1 }, -2.3052]
];
for (var gi = 0; gi < GEOMAG_CASES.length; gi++) {
    var gc = GEOMAG_CASES[gi];
    var gr = CsGeomag.declination(gc[0], gc[1], gc[2]);
    near(gr.declination, gc[3], 0.01,
        "IGRF declination case " + (gi + 1));
}
ok(CsGeomag.declination(39, -86, { year: 1890, month: 1, day: 1 }) === null,
    "IGRF refuses pre-1900");

// ---------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------

ok(CsModel.nextStationName("A1") === "A2", "next name A1");
ok(CsModel.nextStationName("A09") === "A10", "next name zero padding");
ok(CsModel.nextStationName("") === "A1", "next name from nothing");
ok(CsModel.nextStationName("LEAD") === "LEAD1", "next name no digits");

// LRUD notes shorthand
var pe = CsModel.parseLrudEntry("P");
ok(pe.value === 0 && pe.all === null, "P parses as passage = 0");
pe = CsModel.parseLrudEntry("5/10");
ok(pe.value === 10, "5/10: primary is the outer wall (10)");
ok(pe.all !== null && pe.all.length === 2 && pe.all[0] === 5,
    "5/10: both readings kept");
pe = CsModel.parseLrudEntry("10/5");
ok(pe.value === 10, "10/5: primary still the larger");
pe = CsModel.parseLrudEntry("3.5");
ok(pe.value === 3.5 && pe.all === null, "single reading unchanged");
pe = CsModel.parseLrudEntry("p/4");
ok(pe.value === 4 && pe.all.length === 2 && pe.all[0] === 0,
    "p/4: passage plus reading");
pe = CsModel.parseLrudEntry("");
ok(pe.value === null, "blank = not measured");
pe = CsModel.parseLrudEntry("junk");
ok(pe.value === null, "junk = not measured");
ok(CsModel.lrudEntryText(10, [5, 10]) === "5/10", "entry text round-trips multi");
ok(CsModel.lrudEntryText(3.5, null) === "3.5", "entry text single");

// ---------------------------------------------------------------------
// Trips + revision serialization
// ---------------------------------------------------------------------

var tsv = CsModel.newSurvey();
tsv.date = "1998-07-04"; tsv.team = "NS/JB"; tsv.declination = -2.5;
CsModel.ensureTrips(tsv);
ok(tsv.trips.length === 1, "ensureTrips creates trip 0");
ok(tsv.trips[0].team === "NS/JB", "trip 0 mirrors team");
ok(CsModel.tripFingerprint(tsv.trips[0]) === "1998-07-04|-2.5000|NS/JB",
    "trip fingerprint format");
var t2 = CsModel.newTrip(); t2.date = "1998-07-04"; t2.team = "KL";
ok(CsModel.tripIdFor(tsv, t2) === 1, "different team = new trip id");
ok(CsModel.tripIdFor(tsv, tsv.trips[0]) === 0, "same fingerprint reuses id");
ok(tsv.trips.length === 2, "tripIdFor appended once");

var fsh = CsModel.newShot();
fsh.excludeFromPlot = true; fsh.noAdjust = true;
ok(CsModel.flagsText(fsh) === "PC", "flags text");
var fsh2 = CsModel.newShot();
CsModel.parseFlags("CP", fsh2);
ok(fsh2.excludeFromPlot && fsh2.noAdjust && !fsh2.excludeFromAll,
    "flags parse order-insensitive");

// splay flag S -- canonical write order is P/X/L/C/S (appended last);
// parse must still accept it in either position relative to the rest.
var fshS = CsModel.newShot();
fshS.excludeFromAll = true; fshS.splay = true;
ok(CsModel.flagsText(fshS) === "XS",
    "flags text: splay S appended after the Compass letters, got '" +
    CsModel.flagsText(fshS) + "'");
var fshS2 = CsModel.newShot();
CsModel.parseFlags("XS", fshS2);
ok(fshS2.excludeFromAll === true && fshS2.splay === true,
    "flags parse: canonical order XS");
var fshS3 = CsModel.newShot();
CsModel.parseFlags("SX", fshS3);
ok(fshS3.excludeFromAll === true && fshS3.splay === true,
    "flags parse: reversed order SX still parses");

var row = CsModel.newShot();
row.from = "A1"; row.to = "A2"; row.distance = 25.4; row.azimuth = 271.5;
row.inclination = -3; row.backAzimuth = 91.0; row.left = 2; row.leftAll = [2, 5];
row.excludeFromAll = true; row.notes = "line 1\nline 2";
var rowBack = CsModel.parseShotRow(CsModel.shotRowText(row));
ok(rowBack.from === "A1" && rowBack.to === "A2", "shot row endpoints");
near(rowBack.backAzimuth, 91.0, 1e-9, "shot row backsight");
ok(rowBack.backInclination === null, "shot row null backsight stays null");
ok(rowBack.leftAll.join("/") === "2/5", "shot row multi-reading LRUD");
ok(rowBack.excludeFromAll === true, "shot row flags");
ok(rowBack.notes === "line 1\nline 2", "shot row notes with newline");

// a note with BOTH a real newline and a backslash must survive
// shotRowText/parseShotRow exactly -- this is what makes a single row
// self-contained when several rows get "\n"-joined into one blob
// (ExcludedShots/UnplacedShots in CsDraw.js)
var rowEsc = CsModel.newShot();
rowEsc.from = "B1"; rowEsc.to = "B2"; rowEsc.distance = 12;
rowEsc.notes = "back\\slash and\nnewline";
var rowEscBack = CsModel.parseShotRow(CsModel.shotRowText(rowEsc));
ok(rowEscBack.notes === "back\\slash and\nnewline",
    "shot row notes with backslash and newline survive escaping, got '" +
    rowEscBack.notes + "'");

var slr = CsModel.startLrudText({left: 2, right: null, up: 1, down: 0,
    leftAll: [2, 5], rightAll: null, upAll: null, downAll: null});
var slrBack = CsModel.parseStartLrud(slr);
ok(slrBack.right === null && slrBack.down === 0, "startLrud null vs 0");
ok(slrBack.leftAll.join("/") === "2/5", "startLrud multi-reading");

// ensureTrips clobber: once trips exists, trips[0] is the authority --
// a direct top-level write is silently overwritten by the next call.
var clb = CsModel.newSurvey();
CsModel.ensureTrips(clb);
clb.team = "direct write";
CsModel.ensureTrips(clb);
ok(clb.team === clb.trips[0].team && clb.team !== "direct write",
    "ensureTrips: trips[0] is authority, top-level writes lose");

// tripFingerprint must survive a garbage (non-numeric) declination
// instead of throwing out of toFixed.
ok(CsModel.tripFingerprint({date: "", declination: "junk", team: ""}) === "|0.0000|",
    "fingerprint survives garbage declination");

// parseFlags ignores letters outside its P/X/L/C vocabulary.
var gf = CsModel.newShot();
CsModel.parseFlags("PZQ9", gf);
ok(gf.excludeFromPlot && !gf.excludeFromAll, "parseFlags ignores unknown letters");

// parseShotRow tolerates a row truncated to just from/to/distance --
// every field past what's present falls back to its neutral default.
var shortRow = CsModel.parseShotRow("A1\tA2\t10");
ok(shortRow.from === "A1" && shortRow.azimuth === 0.0 &&
    shortRow.backAzimuth === null && shortRow.notes === "",
    "parseShotRow tolerates truncated row");

// ---------------------------------------------------------------------
// Traverse -- the slope-distance fix.
// ---------------------------------------------------------------------

var steep = { distance: 10.0, azimuth: 90.0, inclination: 30.0 };
var o = CsTraverse.offset(steep, CsTraverse.SLOPE);
near(o.dx, 8.660254, 1e-5, "slope tape: plan projection at 30 deg");
near(o.dy, 0.0, 1e-9, "slope tape: no northing at az 90");
near(o.dz, 5.0, 1e-9, "slope tape: rise at 30 deg");
var oh = CsTraverse.offset(steep, CsTraverse.HORIZONTAL);
near(oh.dx, 10.0, 1e-9, "horizontal tape keeps full plan length");
near(oh.dz, 5.773503, 1e-5, "horizontal tape rise uses tan");
var rev = CsTraverse.reverseOffset(steep, CsTraverse.SLOPE);
near(rev.dx, -8.660254, 1e-5, "reverse offset negates");

// fs/bs correction
near(CsTraverse.effectiveAzimuth({ azimuth: 40, backAzimuth: 222 }),
    41, 1e-9, "fs/bs azimuth mean");
near(CsAngles.azimuthDifference(
    CsTraverse.effectiveAzimuth({ azimuth: 359, backAzimuth: 181 }), 0),
    0, 1e-9, "fs/bs circular mean across north");
near(CsTraverse.effectiveAzimuth({ azimuth: 40, backAzimuth: null }),
    40, 1e-9, "no backsight passthrough");
near(CsTraverse.effectiveInclination({ inclination: 10, backInclination: -12 }),
    11, 1e-9, "fs/bs inclination mean, sign flipped");
var bsShot = { distance: 10, azimuth: 90, inclination: 0,
    backAzimuth: 272, backInclination: null };
near(CsTraverse.offset(bsShot, CsTraverse.SLOPE).dx,
    10 * Math.sin(91 * Math.PI / 180), 1e-9,
    "offset uses corrected azimuth");

// ---------------------------------------------------------------------
// Network -- hand-computed square with a deliberate misclosure, plus
// an out-of-order shot and a branch.
// ---------------------------------------------------------------------

function shotOf(from, to, d, az, inc) {
    var s = CsModel.newShot();
    s.from = from;
    s.to = to;
    s.distance = d;
    s.azimuth = az;
    s.inclination = inc || 0;
    return s;
}

var sq = CsModel.newSurvey();
sq.shots.push(shotOf("A4", "A1", 10.5, 270)); // out of order + misclosure 0.5
sq.shots.push(shotOf("A1", "A2", 10, 0));
sq.shots.push(shotOf("A2", "A3", 10, 90));
sq.shots.push(shotOf("A3", "A4", 10, 180));
sq.shots.push(shotOf("A3", "B1", 5, 90));    // branch

var rsq = CsNetwork.resolve(sq, {});
// The first usable shot is A4->A1, so A4 anchors at the origin and
// everything else hangs off it -- assert geometry relative to A1.
var a1 = rsq.stations["A1"];
near(rsq.stations["A2"].x - a1.x, 0, 1e-9, "A2 east of A1");
near(rsq.stations["A2"].y - a1.y, 10, 1e-9, "A2 north of A1");
near(rsq.stations["A3"].x - a1.x, 10, 1e-9, "A3 east of A1");
near(rsq.stations["A4"].y - a1.y, 0, 1e-9, "A4 level with A1");
near(rsq.stations["B1"].x - a1.x, 15, 1e-9, "branch B1 east of A1");
ok(rsq.loops.length === 1, "one loop found");
if (rsq.loops.length === 1) {
    near(rsq.loops[0].error, 0.5, 1e-9, "loop misclosure distance");
    near(rsq.loops[0].traverseLength, 40.5, 1e-9, "loop traverse length");
    near(rsq.loops[0].percent, 0.5 / 40.5 * 100, 1e-6, "loop percent");
    ok(rsq.loops[0].path.length >= 4, "loop path walks the ring");
}
ok(rsq.unresolved.length === 0, "square fully resolves");

// resolving against a known TO (backwards)
var back = CsModel.newSurvey();
back.shots.push(shotOf("X2", "X1", 10, 0));
back.fixed["X1"] = { x: 100, y: 100, z: 0 };
var rback = CsNetwork.resolve(back, {});
near(rback.stations["X2"].y, 90, 1e-9, "backward resolution from fixed TO");

// disconnected components, each with a fixed point
var two = CsModel.newSurvey();
two.shots.push(shotOf("P1", "P2", 10, 90));
two.shots.push(shotOf("Q1", "Q2", 10, 90));
two.fixed["P1"] = { x: 0, y: 0, z: 0 };
two.fixed["Q1"] = { x: 1000, y: 0, z: 0 };
var rtwo = CsNetwork.resolve(two, {});
near(rtwo.stations["Q2"].x, 1010, 1e-9, "second component anchors on its own fix");
ok(rtwo.unresolved.length === 0, "both components resolve");

// explicit anchor wins
var ranch = CsNetwork.resolve(back, { anchor: { name: "X1", x: 5, y: 5, z: 0 } });
near(ranch.stations["X2"].y, -5, 1e-9, "explicit anchor overrides fixed");

// ---------------------------------------------------------------------
// LRUD walls
// ---------------------------------------------------------------------

var lsv = CsModel.newSurvey();
var l1 = shotOf("A1", "A2", 10, 0);
l1.left = 2;
l1.right = 3;
var l2 = shotOf("A2", "A3", 10, 0);
l2.left = 1;
l2.right = 0;   // wall AT the station on the right
var l3 = shotOf("A3", "A4", 10, 0);
l3.left = null; // unmeasured: breaks the run
lsv.shots.push(l1);
lsv.shots.push(l2);
lsv.shots.push(l3);
var rl = CsNetwork.resolve(lsv, {});
var runs = CsLrud.wallRuns(lsv, rl);
ok(runs.left.length === 1, "one left wall run");
if (runs.left.length === 1) {
    near(runs.left[0][0].x, -2, 1e-9, "left wall point offset west");
    near(runs.left[0][1].x, -1, 1e-9, "second left wall point");
}
ok(runs.right.length === 1, "one right wall run");
if (runs.right.length === 1) {
    near(runs.right[0][1].x, 0, 1e-9, "right 0 means wall at station");
}

var tick = CsLrud.tickEnd({ x: 0, y: 0 }, 0, "R", 2);
near(tick.x, 2, 1e-9, "right tick at az 0 points east");
ok(CsLrud.tickEnd({ x: 0, y: 0 }, 0, "L", null) === null, "null LRUD no tick");
ok(CsLrud.tickEnd({ x: 0, y: 0 }, 0, "L", 0) === null, "zero LRUD no tick");

// ---------------------------------------------------------------------
// Validate -- planted blunders.
// ---------------------------------------------------------------------

var bad = CsModel.newSurvey();
bad.shots.push(shotOf("A1", "A2", 10, 40));
var backAsFore = shotOf("A2", "A1", 10, 40); // should read ~220
bad.shots.push(backAsFore);
bad.shots.push(shotOf("A2", "A2", 5, 0));    // self loop
bad.shots.push(shotOf("A2", "Z9", -3, 0));   // bad distance
var findings = CsValidate.check(bad, null);
function hasFinding(code) {
    for (var i = 0; i < findings.length; i++) {
        if (findings[i].code === code) {
            return true;
        }
    }
    return false;
}
ok(hasFinding("backsight-as-foresight"), "backsight-as-foresight caught");
var bsBad = CsModel.newSurvey();
var bsb = shotOf("B1", "B2", 10, 40);
bsb.backAzimuth = 228; // reversed reads 48 vs fs 40: 8 deg apart
bsBad.shots.push(bsb);
var bsFindings = CsValidate.check(bsBad, null);
var foundBs = false;
for (var bi = 0; bi < bsFindings.length; bi++) {
    if (bsFindings[bi].code === "fsbs-azimuth-disagree") {
        foundBs = true;
    }
}
ok(foundBs, "fs/bs compass disagreement caught");
ok(hasFinding("self-loop"), "self loop caught");
ok(hasFinding("bad-distance"), "bad distance caught");

// an agreeing backsight pair stays silent
var good = CsModel.newSurvey();
good.shots.push(shotOf("A1", "A2", 10, 40));
good.shots.push(shotOf("A2", "A1", 10, 220));
var gFindings = CsValidate.check(good, null);
ok(gFindings.length === 0, "agreeing backsight pair not flagged, got " +
    gFindings.length);

// ---------------------------------------------------------------------
// Grade + Stats
// ---------------------------------------------------------------------

var gsv = CsModel.newSurvey();
var gs1 = shotOf("A1", "A2", 10, 0, 30);
gs1.left = 1; gs1.right = 1; gs1.up = 1; gs1.down = 1;
var gs2 = shotOf("A2", "A3", 10, 90);
gs2.left = 2; gs2.right = 2; gs2.up = 1; gs2.down = 0;
gsv.shots.push(gs1);
gsv.shots.push(gs2);
var rg = CsNetwork.resolve(gsv, {});
var st = CsStats.compute(gsv, rg, CsTraverse.SLOPE);
near(st.surveyedLength, 20, 1e-9, "surveyed length is tape length");
near(st.planLength, 10 * Math.cos(Math.PI / 6) + 10, 1e-6, "plan length projected");
near(st.depth, 5, 1e-9, "depth from 30 deg shot");
ok(st.stationCount === 3, "station count");
var grade = CsGrade.compute(gsv, rg, st);
ok(grade.detail === "c", "full LRUD coverage grades c, got " + grade.detail);
ok(grade.centreline === 3, "no loops caps centreline at 3");
ok(grade.uis === "UISv2 3-c", "UIS composite string");

// ---------------------------------------------------------------------
// Parsers against the shared fixtures.
// ---------------------------------------------------------------------

var datContent = readTextFile(repoRoot + "/testdata/TestCave_Compass.dat");
var dat = CsFormatCompass.parse(datContent);
ok(dat.distanceUnit === "ft", "Compass unit is always feet");
// survey.name mirrors trip 0's name, which comes from SURVEY NAME
// (the block label), not the file's first line (the cave name) --
// per-block trip parsing means the block label is what identifies a
// trip, so that's what the model keeps.
ok(dat.name === "A", "Compass survey name (trip 0, from SURVEY NAME), got '" +
    dat.name + "'");
// survey.caveName is the file's drawing-level line 1 -- distinct from
// survey.name/trip.name above, which is the SURVEY NAME: trip label.
ok(dat.caveName === "SECRET CAVE", "Compass cave name (file line 1), got '" +
    dat.caveName + "'");
ok(dat.date === "2024-07-10", "Compass survey date, got '" + dat.date + "'");
near(dat.declination, 2.5, 1e-9, "Compass declination recorded");
ok(dat.shots.length === 6, "Compass shot count, got " + dat.shots.length);
near(dat.shots[0].azimuth, 145.0, 1e-9, "Compass declination applied to bearing");
near(dat.shots[0].distance, 15.30, 1e-9, "Compass distance untouched");
// Compass LRUDs default to the FROM station (no FORMAT F/T char in
// the fixture): the first line's reading describes A1 -> startLrud,
// and a shot's LRUD comes from the line(s) LEAVING its TO station
// (the last one wins, like Survex passage data).
ok(dat.startLrud !== null, "Compass first line LRUD is startLrud");
near(dat.startLrud.left, 2.10, 1e-9, "Compass startLrud LEFT");
near(dat.startLrud.up, 0.50, 1e-9, "Compass startLrud UP");
near(dat.startLrud.down, 6.20, 1e-9, "Compass startLrud DOWN");
near(dat.startLrud.right, 4.00, 1e-9, "Compass startLrud RIGHT");
// A2's reading: lines A2-A3 then A2-B1 leave A2; the later one wins
near(dat.shots[0].left, 0.00, 1e-9, "Compass A2 LRUD left (later line wins)");
near(dat.shots[0].down, 4.00, 1e-9, "Compass A2 LRUD down");
near(dat.shots[0].right, 3.50, 1e-9, "Compass A2 LRUD right");
var flagged = dat.shots[5];
ok(flagged.excludeFromPlot === true, "Compass #|P# flag");
ok(flagged.excludeFromAll === false, "#|P# still positions");
ok(dat.shots[4].noAdjust === true, "Compass #|C# flag kept");
ok(dat.shots[0].notes === "Entrance drop", "Compass shot comment kept, got '" +
    dat.shots[0].notes + "'");
ok(dat.shots[5].notes.indexOf("Excluded from plotting") === 0,
    "Compass comment after flags kept");

// backsight columns (Azm2 Inc2 after the LRUDs), stored uncorrected;
// declination goes onto both sights. -999 marks a missing reading.
var bsDat = "BS CAVE\r\nSURVEY NAME: B\r\nSURVEY DATE: 1 1 2020\r\n" +
    "SURVEY TEAM:\r\n\r\nDECLINATION: 2.00 FORMAT: DDDDLRUDLADadBT " +
    "CORRECTIONS: 0.00 0.00 0.00\r\n\r\n" +
    "FROM TO LEN BEAR INC LEFT UP DOWN RIGHT AZM2 INC2 FLAGS COMMENTS\r\n\r\n" +
    "B1 B2 13.0 35.0 15.0 1.0 2.0 1.5 1.0 215.5 -15.2 Side Passage\r\n" +
    "B2 B3 10.0 90.0 0.0 1.0 1.0 1.0 1.0 -999 -999 #|C# no backsight here\r\n\f\r\n";
var bsD = CsFormatCompass.parse(bsDat);
ok(bsD.shots.length === 2, "Compass backsight file shot count");
near(bsD.shots[0].azimuth, 37.0, 1e-9, "Compass FS + declination");
near(bsD.shots[0].backAzimuth, 217.5, 1e-9, "Compass Azm2 + declination");
near(bsD.shots[0].backInclination, -15.2, 1e-9, "Compass Inc2 read");
ok(bsD.shots[0].notes === "Side Passage", "Compass comment after backsights");
ok(bsD.shots[1].backAzimuth === null, "Compass -999 backsight is null");
ok(bsD.shots[1].noAdjust === true, "Compass flags after backsights");
ok(bsD.shots[1].notes === "no backsight here", "Compass comment after flags+bs");

// FORMAT ...T: LRUDs stay on the TO shot, no shift
var tDat = "T CAVE\r\nSURVEY NAME: T\r\nSURVEY DATE: 1 1 2020\r\n" +
    "SURVEY TEAM:\r\n\r\nDECLINATION: 0.00 FORMAT: DDDDLRUDLADNT\r\n\r\n" +
    "FROM TO LEN BEAR INC LEFT UP DOWN RIGHT\r\n\r\n" +
    "T1 T2 10.0 0.0 0.0 1.0 2.0 3.0 4.0\r\n\f\r\n";
var tD = CsFormatCompass.parse(tDat);
near(tD.shots[0].left, 1.0, 1e-9, "Compass FORMAT T keeps LRUD on the shot");
ok(tD.startLrud === null, "Compass FORMAT T start has no reading");

// splay flag S
var sDat = "S CAVE\r\nSURVEY NAME: S\r\nSURVEY DATE: 1 1 2020\r\n" +
    "SURVEY TEAM:\r\n\r\nDECLINATION: 0.00 FORMAT: DDDDLRUDLADNT\r\n\r\n" +
    "FROM TO LEN BEAR INC LEFT UP DOWN RIGHT\r\n\r\n" +
    "S1 S1s1 3.0 45.0 0.0 -9.9 -9.9 -9.9 -9.9 #|S#\r\n\f\r\n";
var sD = CsFormatCompass.parse(sDat);
ok(sD.shots[0].splay === true, "Compass #|S# is a splay");

var srvContent = readTextFile(repoRoot + "/testdata/TestCave_Walls.srv");
var srv = CsFormatWalls.parse(srvContent);
ok(srv.distanceUnit === "ft", "Walls unit from #Units Feet");
near(srv.declination, 2.5, 1e-9, "Walls Decl= recorded");
ok(srv.fixed.hasOwnProperty("W1"), "Walls #Fix parsed");
near(srv.fixed["W1"].z, 100.0, 1e-9, "Walls #Fix elevation");
var splays = 0, wallsShots = 0;
for (var wi = 0; wi < srv.shots.length; wi++) {
    if (srv.shots[wi].splay) {
        splays++;
    } else {
        wallsShots++;
    }
}
ok(splays === 1, "Walls splay kept as splay");
ok(wallsShots === 6, "Walls non-splay shot count, got " + wallsShots);
near(srv.shots[0].azimuth, 92.5, 1e-9, "Walls declination applied");
// Walls LRUD defaults to the FROM station ("The default assumption is
// LRUD=F:LRUD"), so a line's reading belongs to its FROM station: the
// first line's LRUD is the start station's, and the reading beside
// the W5 W6 shot describes W5 -- it lands on the shot ARRIVING at W5.
ok(srv.startLrud !== null, "Walls first line LRUD is startLrud");
near(srv.startLrud.left, 2.0, 1e-9, "Walls startLrud left");
var wTo5 = null, w56 = null;
for (wi = 0; wi < srv.shots.length; wi++) {
    if (srv.shots[wi].to === "W5") {
        wTo5 = srv.shots[wi];
    }
    if (srv.shots[wi].from === "W5" && srv.shots[wi].to === "W6") {
        w56 = srv.shots[wi];
    }
}
ok(wTo5 !== null && wTo5.left === null, "Walls -- marker becomes null, not 0");
ok(wTo5 !== null && wTo5.right === 2.0, "Walls LRUD beside -- still real");
ok(w56 !== null && w56.left === null && w56.right === null,
    "Walls last station has no LRUD line, shot stays null");

// no #Units at all: Walls defaults to METERS ("The initial default in
// each case is meters"), not feet
var bareSrv = CsFormatWalls.parse("A1 A2 10.0 90.0 0.0\n");
ok(bareSrv.distanceUnit === "m", "Walls default unit is meters, got " +
    bareSrv.distanceUnit);

// LRUD=T declared: readings stay on the TO shot, no shift
var lrudT = CsFormatWalls.parse("#Units Meters Order=DAV LRUD=T\n" +
    "T1 T2 5.0 0.0 0.0 <1.0,2.0,3.0,0.5>\n");
near(lrudT.shots[0].left, 1.0, 1e-9, "Walls LRUD=T stays on the shot");
ok(lrudT.startLrud === null, "Walls LRUD=T start has no reading");

// backsights: FS/BS slash pairs; default TYPEAB/TYPEVB=N (reversed,
// uncorrected). Declination goes onto both sights.
var bsSrv = CsFormatWalls.parse("#Units Meters Order=DAV Decl=2.0\n" +
    "B1 B2 10.0 100/282 5/-5.2\nB2 B3 8.0 10/-- --/3\n");
near(bsSrv.shots[0].azimuth, 102.0, 1e-9, "Walls FS of pair + declination");
near(bsSrv.shots[0].backAzimuth, 284.0, 1e-9, "Walls BS of pair + declination");
near(bsSrv.shots[0].inclination, 5.0, 1e-9, "Walls clino FS of pair");
near(bsSrv.shots[0].backInclination, -5.2, 1e-9, "Walls clino BS of pair");
ok(bsSrv.shots[1].backAzimuth === null, "Walls -- backsight stays null");
near(bsSrv.shots[1].backInclination, 3.0, 1e-9, "Walls isolated back clino");

// corrected backsights: TYPEAB=C means the BS is recorded in the FS
// sense; the model stores the uncorrected (reversed) reading
var bsC = CsFormatWalls.parse("#Units Meters Order=DAV TypeAB=C TypeVB=C,2\n" +
    "C1 C2 10.0 100/102 5/4.8\n");
near(bsC.shots[0].backAzimuth, 282.0, 1e-9, "Walls TypeAB=C reversed into model");
near(bsC.shots[0].backInclination, -4.8, 1e-9, "Walls TypeVB=C sign-flipped");

// asterisk LRUD brackets with space delimiters, and a 5th facing value
var starSrv = CsFormatWalls.parse("#Units Meters Order=DAV LRUD=T\n" +
    "S1 S2 5.0 0.0 0.0 *1 3 1 0 275*\n");
near(starSrv.shots[0].left, 1.0, 1e-9, "Walls *...* LRUD brackets");
near(starSrv.shots[0].right, 3.0, 1e-9, "Walls space-delimited LRUD");

// station-only LRUD line (end-station reading with LRUD=F)
var soloSrv = CsFormatWalls.parse("#Units Meters Order=DAV\n" +
    "E1 E2 5.0 0.0 0.0\nE2 <0.5,1.5,2.0,0.1>\n");
near(soloSrv.shots[0].left, 0.5, 1e-9,
    "Walls station-only LRUD line reaches the arriving shot");

// splay with the dash on the FROM side is reversed into the model
var revSrv = CsFormatWalls.parse("#Units Meters Order=DAV\n" +
    "R1 R2 5.0 0.0 0.0\n- R2 2.0 45.0 10.0\n");
ok(revSrv.shots[1].splay === true, "Walls FROM-side dash is a splay");
ok(revSrv.shots[1].from === "R2", "Walls FROM-side splay anchored at the station");
near(revSrv.shots[1].azimuth, 225.0, 1e-9, "Walls FROM-side splay reversed az");
near(revSrv.shots[1].inclination, -10.0, 1e-9, "Walls FROM-side splay reversed inc");

// #S segment conventions: P = don't plot, L = length-exclude
var segSrv = CsFormatWalls.parse("#Units Meters Order=DAV\n" +
    "G1 G2 5.0 0.0 0.0 #S P\nG2 G3 5.0 0.0 0.0 #S L\nG3 G4 5.0 0.0 0.0 #S PL\n");
ok(segSrv.shots[0].excludeFromPlot === true, "Walls #S P excluded from plot");
ok(segSrv.shots[1].excludeFromLength === true, "Walls #S L excluded from length");
ok(segSrv.shots[2].excludeFromPlot && segSrv.shots[2].excludeFromLength,
    "Walls #S PL both");

// #[ ... #] block comments hold excluded shots
var blockSrv = CsFormatWalls.parse("#Units Meters Order=DAV\n" +
    "H1 H2 5.0 0.0 0.0\n#[ Excluded shots\nH2 H3 4.0 10.0 0.0\n#]\n" +
    "H3 H4 3.0 20.0 0.0\n");
ok(blockSrv.shots.length === 3, "Walls #[ #] shots kept, got " +
    blockSrv.shots.length);
ok(blockSrv.shots[1].excludeFromAll === true, "Walls #[ #] marks excludeFromAll");
ok(blockSrv.shots[2].excludeFromAll === false, "Walls #] ends the exclusion");

// per-value unit suffixes
var sufSrv = CsFormatWalls.parse("#Units Feet Order=DAV\n" +
    "U1 U2 3m 0.0 0.0\n");
near(sufSrv.shots[0].distance, 3.0 / 0.3048, 1e-6, "Walls 'm' suffix overrides feet");

// Walls round trip with backsights and startLrud
var wallsRt2 = CsFormatWalls.parse(CsFormatWalls.write(bsSrv));
near(wallsRt2.shots[0].backAzimuth, bsSrv.shots[0].backAzimuth, 1e-6,
    "Walls round trip backAzimuth");
near(wallsRt2.shots[0].backInclination, bsSrv.shots[0].backInclination, 1e-6,
    "Walls round trip backInclination");
var srvRtFull = CsFormatWalls.parse(CsFormatWalls.write(srv));
ok(srvRtFull.startLrud !== null &&
    Math.abs(srvRtFull.startLrud.left - srv.startLrud.left) < 1e-6,
    "Walls round trip startLrud");
shotsMatch(srv, srvRtFull, "Walls full round trip incl splay");

// Walls has exactly ONE file-wide Decl= (trip 0's) -- a survey with
// per-trip declinations must still round-trip every shot's TRUE
// azimuth losslessly, because the writer un-applies uniformly with
// that single header declination rather than each shot's own trip's
// (see the comment in CsFormatWalls.write). Build a 2-trip survey by
// hand: trip 0 (decl 3.0) carries shot A1->A2, a second trip (decl
// -7.0) carries shot A2->A3.
var mtSv = CsModel.newSurvey();
mtSv.distanceUnit = "m";
mtSv.date = "2020-01-01";
mtSv.team = "Alice";
mtSv.declination = 3.0;
mtSv.declinationSource = "test";
var mtShot1 = CsModel.newShot();
mtShot1.from = "A1";
mtShot1.to = "A2";
mtShot1.distance = 10.0;
mtShot1.azimuth = 45.0;
mtShot1.inclination = 5.0;
mtShot1.trip = 0;
mtSv.shots.push(mtShot1);
CsModel.ensureTrips(mtSv); // trips[0] now carries decl 3.0 from above

var mtTrip2 = CsModel.newTrip();
mtTrip2.date = "2020-02-02";
mtTrip2.team = "Bob";
mtTrip2.declination = -7.0;
var mtTrip2Id = CsModel.tripIdFor(mtSv, mtTrip2);
var mtShot2 = CsModel.newShot();
mtShot2.from = "A2";
mtShot2.to = "A3";
mtShot2.distance = 12.0;
mtShot2.azimuth = 200.0;
mtShot2.inclination = -3.0;
mtShot2.trip = mtTrip2Id;
mtSv.shots.push(mtShot2);

var mtRt = CsFormatWalls.parse(CsFormatWalls.write(mtSv));
near(CsAngles.azimuthDifference(mtRt.shots[0].azimuth, mtShot1.azimuth), 0, 1e-6,
    "Walls multi-trip round trip preserves trip 0 TRUE azimuth");
near(CsAngles.azimuthDifference(mtRt.shots[1].azimuth, mtShot2.azimuth), 0, 1e-6,
    "Walls multi-trip round trip preserves 2nd trip's TRUE azimuth " +
    "despite a differing declination not carried by the header");

var svxContent = readTextFile(repoRoot + "/testdata/TestCave_Survex.svx");
var svx = CsFormatSurvex.parse(svxContent);
ok(svx.distanceUnit === "m", "Survex default metres");
ok(svx.shots.length === 5, "Survex shot count, got " + svx.shots.length);
ok(svx.shots[0].from === "TestSurvey.S1", "Survex *begin prefix applied");
ok(svx.fixed.hasOwnProperty("TestSurvey.S1"), "Survex *fix prefixed");
var s23 = svx.shots[1];
near(s23.left, 0.4, 1e-9, "Survex passage LRUD attached to TO station");
near(s23.up, 1.2, 1e-9, "Survex passage UP");

// *calibrate declination is a ZERO ERROR: Survex SUBTRACTS it from
// compass readings ("Value = (Reading - ZeroError) * Scale"), so a
// file written for east declination d carries *calibrate declination
// -d. Model declination (east positive, added) is therefore -X.
var calSvx = "*begin C\n*calibrate declination -3.0\n" +
    "*data normal from to tape compass clino\nC1 C2 10.0 90.0 0.0\n*end C\n";
var cal = CsFormatSurvex.parse(calSvx);
near(cal.shots[0].azimuth, 93.0, 1e-9, "Survex *calibrate declination subtracted");
near(cal.declination, 3.0, 1e-9, "Survex *calibrate declination negated into model");

// modern *declination command uses the conventional sign (added)
var declSvx = "*declination 3.0 degrees\n" +
    "*data normal from to tape compass clino\nC1 C2 10.0 90.0 0.0\n";
var decl = CsFormatSurvex.parse(declSvx);
near(decl.shots[0].azimuth, 93.0, 1e-9, "Survex *declination added");

// grads
var gradSvx = "*units compass grads\n*data normal from to tape compass clino\n" +
    "G1 G2 10.0 200.0 0.0\n";
var grad = CsFormatSurvex.parse(gradSvx);
near(grad.shots[0].azimuth, 180.0, 1e-9, "Survex grads converted");

// plumbed legs: compass omitted with "-", clino as keyword
var plumbSvx = "*data normal from to tape compass clino\n" +
    "P1 P2 21.54 - UP\nP2 P3 8.00 - down\nP3 P4 7.36 17.0 LEVEL\n" +
    "P4 P5 5.00 10.0 +V\n";
var plumb = CsFormatSurvex.parse(plumbSvx);
ok(plumb.shots.length === 4, "Survex plumbed legs kept, got " + plumb.shots.length);
near(plumb.shots[0].inclination, 90.0, 1e-9, "Survex UP is +90");
near(plumb.shots[1].inclination, -90.0, 1e-9, "Survex down is -90");
near(plumb.shots[2].inclination, 0.0, 1e-9, "Survex LEVEL is 0");
near(plumb.shots[2].azimuth, 17.0, 1e-9, "Survex LEVEL keeps compass");
near(plumb.shots[3].inclination, 90.0, 1e-9, "Survex +V is +90");

// field-name aliases: length/bearing/gradient
var aliasSvx = "*data normal from to length bearing gradient\n" +
    "L1 L2 10.0 45.0 2.0\n";
var alias = CsFormatSurvex.parse(aliasSvx);
ok(alias.shots.length === 1, "Survex length/bearing/gradient aliases");
near(alias.shots[0].azimuth, 45.0, 1e-9, "Survex bearing alias read");

// backsights: uncorrected readings into backAzimuth/backInclination,
// declination applied so both sights share one frame
var bsSvx = "*calibrate declination -2.0\n" +
    "*data normal from to tape compass clino backcompass backclino\n" +
    "B1 B2 10.0 90.0 5.0 270.5 -5.2\nB2 B3 8.0 10.0 0.0 - -\n";
var bs = CsFormatSurvex.parse(bsSvx);
near(bs.shots[0].backAzimuth, 272.5, 1e-9, "Survex backcompass read + declination");
near(bs.shots[0].backInclination, -5.2, 1e-9, "Survex backclino read");
ok(bs.shots[1].backAzimuth === null, "Survex omitted backsight stays null");

// *flags splay, and anonymous stations
var flagSvx = "*data normal from to tape compass clino\n" +
    "*flags splay\nF1 F2 3.0 100.0 0.0\n*flags not splay\n" +
    "F1 F3 9.0 200.0 0.0\nF3 .. 2.0 50.0 0.0\nF3 . 2.5 60.0 0.0\n";
var flag = CsFormatSurvex.parse(flagSvx);
ok(flag.shots[0].splay === true, "Survex *flags splay honoured");
ok(flag.shots[1].splay === false, "Survex *flags not splay restores");
ok(flag.shots[2].splay === true && flag.shots[2].to === "",
    "Survex .. anonymous wall point is a splay");
ok(flag.shots[3].splay === true, "Survex . anonymous point is a splay");

// duplicate/surface flags map to the exclude fields
var dupSvx = "*data normal from to tape compass clino\n" +
    "*flags duplicate\nD1 D2 3.0 10.0 0.0\n*flags not duplicate surface\n" +
    "D2 D3 4.0 20.0 0.0\n";
var dup = CsFormatSurvex.parse(dupSvx);
ok(dup.shots[0].excludeFromLength === true, "Survex duplicate excluded from length");
ok(dup.shots[1].excludeFromPlot === true, "Survex surface excluded from plot");

// first-station passage record lands in startLrud
var startSvx = "*data normal from to tape compass clino\nS1 S2 5.0 90.0 0.0\n" +
    "*data passage station left right up down\nS1 1.0 2.0 3.0 0.5\nS2 - 0.4 - -\n";
var startP = CsFormatSurvex.parse(startSvx);
ok(startP.startLrud !== null, "Survex first-station passage kept");
near(startP.startLrud.left, 1.0, 1e-9, "Survex startLrud left");
ok(startP.shots[0].left === null && startP.shots[0].right === 0.4,
    "Survex passage '-' stays null");

// yards convert
var ydSvx = "*units length yards\n*data normal from to tape compass clino\n" +
    "Y1 Y2 10.0 0.0 0.0\n";
var yd = CsFormatSurvex.parse(ydSvx);
ok(yd.distanceUnit === "m", "Survex yards surveys store metres");
near(yd.shots[0].distance, 9.144, 1e-6, "Survex yards converted");

// CSV
var csvText = "from,to,distance,azimuth,inclination,left,right,up,down,notes\n" +
    "A1,A2,10.5,45,2,1,2,,0.5,first shot\n" +
    "A2,-,3.0,90,0\n";
var csv = CsFormatCsv.parse(csvText);
ok(csv.shots.length === 2, "CSV shot count");
ok(csv.shots[0].up === null, "CSV blank LRUD is null");
ok(csv.shots[0].notes === "first shot", "CSV notes");
ok(csv.shots[1].splay === true, "CSV dash TO is splay");

// metadata comment lines carry what the columns can't; the header row
// maps the columns, so extended files and legacy files both parse
var csvMeta = "# name: Deep Cave\n# date: 2026-02-03\n# team: A, B\n" +
    "# declination: 2.5\n# unit: m\n# fix: A1 100 200 5\n" +
    "# startlrud: 1/3,2,0.5,\n# startnote: entrance pit\n" +
    "from,to,distance,azimuth,inclination,left,right,up,down," +
    "backazimuth,backinclination,flags,notes\n" +
    "A1,A2,10.5,45,2,1,2,,0.5,225.5,-2.2,,first, shot\n" +
    "A2,A3,5,90,0,5/10,1,1,1,,,XC,\n";
var csvM = CsFormatCsv.parse(csvMeta);
ok(csvM.name === "Deep Cave", "CSV # name");
ok(csvM.date === "2026-02-03", "CSV # date");
ok(csvM.team === "A, B", "CSV # team");
near(csvM.declination, 2.5, 1e-9, "CSV # declination");
ok(csvM.distanceUnit === "m", "CSV # unit read -- meter surveys stay meters");
ok(csvM.fixed.hasOwnProperty("A1"), "CSV # fix");
near(csvM.fixed["A1"].y, 200, 1e-9, "CSV # fix northing");
ok(csvM.startLrud !== null && csvM.startLrud.left === 3, "CSV # startlrud, largest of 1/3");
ok(csvM.startNote === "entrance pit", "CSV # startnote");
near(csvM.shots[0].backAzimuth, 225.5, 1e-9, "CSV backazimuth column");
near(csvM.shots[0].backInclination, -2.2, 1e-9, "CSV backinclination column");
ok(csvM.shots[0].notes === "first, shot", "CSV notes keep commas, got '" +
    csvM.shots[0].notes + "'");
ok(csvM.shots[1].excludeFromAll === true && csvM.shots[1].noAdjust === true,
    "CSV flags column");
ok(csvM.shots[1].left === 10 && csvM.shots[1].leftAll !== null,
    "CSV 5/10 multi-reading LRUD, largest is primary");

// full round trip: unit, metadata, backsights, flags, multi readings
var csvMRt = CsFormatCsv.parse(CsFormatCsv.write(csvM));
ok(csvMRt.distanceUnit === "m", "CSV round trip unit");
ok(csvMRt.name === "Deep Cave", "CSV round trip name");
near(csvMRt.declination, 2.5, 1e-9, "CSV round trip declination");
ok(csvMRt.fixed.hasOwnProperty("A1"), "CSV round trip fix");
ok(csvMRt.startLrud !== null && csvMRt.startLrud.left === 3,
    "CSV round trip startLrud");
near(csvMRt.shots[0].backAzimuth, 225.5, 1e-9, "CSV round trip backsight");
ok(csvMRt.shots[1].excludeFromAll === true, "CSV round trip flags");
ok(csvMRt.shots[1].leftAll !== null && csvMRt.shots[1].leftAll.length === 2,
    "CSV round trip keeps both 5/10 readings");
ok(csvMRt.shots[0].notes === "first, shot", "CSV round trip notes with commas");
shotsMatch(csvM, csvMRt, "CSV metadata round trip");

// ---------------------------------------------------------------------
// Round trips: parse -> write -> parse preserves the survey.
// ---------------------------------------------------------------------

function shotsMatch(a, b, what) {
    ok(a.shots.length === b.shots.length, what + ": shot count " +
        a.shots.length + " vs " + b.shots.length);
    var n = Math.min(a.shots.length, b.shots.length);
    for (var i = 0; i < n; i++) {
        var x = a.shots[i], y = b.shots[i];
        ok(x.from === y.from && x.to === y.to, what + " shot " + i + " names");
        near(y.distance, x.distance, 0.01, what + " shot " + i + " distance");
        near(CsAngles.azimuthDifference(x.azimuth, y.azimuth), 0, 0.01,
            what + " shot " + i + " azimuth");
        near(y.inclination, x.inclination, 0.01, what + " shot " + i + " inclination");
    }
}

var datRt = CsFormatCompass.parse(CsFormatCompass.write(dat));
shotsMatch(dat, datRt, "Compass round trip");
near(datRt.declination, dat.declination, 1e-9, "Compass round trip declination");
ok(datRt.caveName === dat.caveName, "Compass round trip cave name, got '" +
    datRt.caveName + "' vs '" + dat.caveName + "'");
ok(datRt.startLrud !== null &&
    Math.abs(datRt.startLrud.left - dat.startLrud.left) < 0.01,
    "Compass round trip startLrud");
ok(datRt.shots[0].notes === dat.shots[0].notes, "Compass round trip notes");
ok(datRt.shots[4].noAdjust === true, "Compass round trip #|C#");
ok(datRt.shots[5].excludeFromPlot === true, "Compass round trip #|P#");
near(datRt.shots[0].left, dat.shots[0].left, 0.01, "Compass round trip LRUD");
// last/leaf station LRUD survives via a zero-length carrier shot
var leafDat = CsModel.newSurvey();
leafDat.distanceUnit = "ft";
var lfShot = shotOf("L1", "L2", 10, 0, 0);
lfShot.left = 1.0; lfShot.right = 2.0; lfShot.up = 3.0; lfShot.down = 0.5;
leafDat.shots.push(lfShot);
var leafRt = CsFormatCompass.parse(CsFormatCompass.write(leafDat));
ok(leafRt.shots.length === 1, "Compass LRUD carrier shot not re-imported, got " +
    leafRt.shots.length);
near(leafRt.shots[0].left, 1.0, 0.01, "Compass leaf-station LRUD survives");
// backsights survive a write/parse cycle
var bsDRt = CsFormatCompass.parse(CsFormatCompass.write(bsD));
near(bsDRt.shots[0].backAzimuth, bsD.shots[0].backAzimuth, 0.01,
    "Compass round trip backAzimuth");
near(bsDRt.shots[0].backInclination, bsD.shots[0].backInclination, 0.01,
    "Compass round trip backInclination");
ok(bsDRt.shots[1].backAzimuth === null, "Compass round trip missing backsight");
// splays survive
var sDRt = CsFormatCompass.parse(CsFormatCompass.write(sD));
ok(sDRt.shots.length === 1 && sDRt.shots[0].splay === true,
    "Compass round trip splay");

var srvNoSplay = CsModel.newSurvey();
srvNoSplay.distanceUnit = srv.distanceUnit;
srvNoSplay.declination = srv.declination;
srvNoSplay.fixed = srv.fixed;
for (wi = 0; wi < srv.shots.length; wi++) {
    srvNoSplay.shots.push(srv.shots[wi]);
}
var srvRt = CsFormatWalls.parse(CsFormatWalls.write(srvNoSplay));
shotsMatch(srvNoSplay, srvRt, "Walls round trip");
var rtW56 = null;
for (wi = 0; wi < srvRt.shots.length; wi++) {
    if (srvRt.shots[wi].from === "W5") {
        rtW56 = srvRt.shots[wi];
    }
}
ok(rtW56 !== null && rtW56.left === null, "Walls round trip keeps null LRUD");

var svxRt = CsFormatSurvex.parse(CsFormatSurvex.write(svx));
shotsMatch(svx, svxRt, "Survex round trip");

// declination sign survives a write/parse cycle
var calRt = CsFormatSurvex.parse(CsFormatSurvex.write(cal));
near(calRt.declination, cal.declination, 1e-9, "Survex round trip declination sign");
near(CsAngles.azimuthDifference(calRt.shots[0].azimuth, cal.shots[0].azimuth),
    0, 1e-6, "Survex round trip true azimuth with declination");

// backsights survive a write/parse cycle
var bsRt = CsFormatSurvex.parse(CsFormatSurvex.write(bs));
near(bsRt.shots[0].backAzimuth, bs.shots[0].backAzimuth, 1e-6,
    "Survex round trip backAzimuth");
near(bsRt.shots[0].backInclination, bs.shots[0].backInclination, 1e-6,
    "Survex round trip backInclination");
ok(bsRt.shots[1].backAzimuth === null, "Survex round trip missing backsight");

// splays are written as anonymous stations, never bare "-"
var splaySv = CsModel.newSurvey();
splaySv.distanceUnit = "m";
var spShot = shotOf("A1", "A2", 5, 0, 0);
var spSplay = shotOf("A1", "", 2, 90, 0);
spSplay.splay = true;
splaySv.shots.push(spShot);
splaySv.shots.push(spSplay);
var splayText = CsFormatSurvex.write(splaySv);
ok(!/\t-\t/.test(splayText), "Survex writer avoids bare '-' TO station");
var splayRt = CsFormatSurvex.parse(splayText);
ok(splayRt.shots[1].splay === true, "Survex round trip splay");

// startLrud round trips through a first-station passage record
var startRt = CsFormatSurvex.parse(CsFormatSurvex.write(startP));
ok(startRt.startLrud !== null && Math.abs(startRt.startLrud.left - 1.0) < 1e-6,
    "Survex round trip startLrud");

// plumb legs survive a write/parse cycle
var plumbRt = CsFormatSurvex.parse(CsFormatSurvex.write(plumb));
shotsMatch(plumb, plumbRt, "Survex round trip plumbs");

// team round trips
var teamSv = CsModel.newSurvey();
teamSv.distanceUnit = "m";
teamSv.team = "Nick Proctor, Anthony Day";
teamSv.shots.push(shotOf("T1", "T2", 5, 0, 0));
var teamRt = CsFormatSurvex.parse(CsFormatSurvex.write(teamSv));
ok(teamRt.team.indexOf("Nick Proctor") >= 0 &&
    teamRt.team.indexOf("Anthony Day") >= 0, "Survex round trip team, got '" +
    teamRt.team + "'");
ok(svxRt.shots[0].from === svx.shots[0].from,
    "Survex round trip keeps station names un-renamed");
near(svxRt.shots[1].left, 0.4, 1e-9, "Survex round trip passage LRUD");

var csvRt = CsFormatCsv.parse(CsFormatCsv.write(csv));
shotsMatch(csv, csvRt, "CSV round trip");

// ---------------------------------------------------------------------
// Registry detection.
// ---------------------------------------------------------------------

ok(CsFormatRegistry.detect("x.dat", datContent).id === "compass", "detect .dat");
ok(CsFormatRegistry.detect("x.srv", srvContent).id === "walls", "detect .srv");
ok(CsFormatRegistry.detect("x.svx", svxContent).id === "survex", "detect .svx");
ok(CsFormatRegistry.detect("", svxContent).id === "survex", "detect svx by content");
ok(CsFormatRegistry.detect("", datContent).id === "compass", "detect dat by content");
ok(CsFormatRegistry.detect("", srvContent).id === "walls", "detect srv by content");
ok(CsFormatRegistry.detect("renamed.dat", svxContent).id === "survex",
    "content overrules a lying extension");
ok(CsFormatRegistry.detect("x.csv", csvText).id === "csv", "detect csv");

// ---------------------------------------------------------------------
// Trip-aware parsing: every parser emits survey.trips[] keyed by
// fingerprint (date|declination|team), every shot gets shot.trip, and
// writers un-apply each shot's OWN trip's declination.
// ---------------------------------------------------------------------

// FIXTURE GATE: FingerprintCave.dat has 3 Compass blocks -- two on the
// same day but different teams (fingerprint separation keeps them
// apart), the third a different day/team AND a re-measured
// declination, tied back into a loop that only closes once trips 0
// and 1's declination gets revised.
var fpContent = readTextFile(repoRoot + "/testdata/FingerprintCave.dat");
var fp = CsFormatCompass.parse(fpContent);
// caveName is the drawing-level name (file line 1); trips[0].name is
// the trip designation (SURVEY NAME:) -- the two must stay distinct.
ok(fp.caveName === "FINGERPRINT CAVE", "FingerprintCave: cave name, got '" +
    fp.caveName + "'");
ok(fp.trips.length === 3, "FingerprintCave: 3 trips, got " + fp.trips.length);
if (fp.trips.length === 3) {
    ok(fp.trips[0].name === "ENT" && fp.trips[0].date === "1998-07-04" &&
        fp.trips[0].team === "N. Schonegg, J. Bender",
        "FingerprintCave trip 0 (ENT), got " + JSON.stringify(fp.trips[0]));
    near(fp.trips[0].declination, 0, 1e-9, "FingerprintCave trip 0 declination");
    ok(fp.trips[1].name === "MID" && fp.trips[1].date === "1998-07-04" &&
        fp.trips[1].team === "K. Lane, T. Ruiz",
        "FingerprintCave trip 1 (MID), got " + JSON.stringify(fp.trips[1]));
    near(fp.trips[1].declination, 0, 1e-9, "FingerprintCave trip 1 declination");
    ok(fp.trips[2].name === "LOOP" && fp.trips[2].date === "2003-08-15" &&
        fp.trips[2].team === "N. Schonegg, J. Bender",
        "FingerprintCave trip 2 (LOOP), got " + JSON.stringify(fp.trips[2]));
    near(fp.trips[2].declination, -3, 1e-9, "FingerprintCave trip 2 declination");
}
ok(fp.shots.length === 18, "FingerprintCave: 18 shots (LRUD carrier folded), got " +
    fp.shots.length);
var fpExpectTrip = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2];
var fpTripsOk = true;
for (var fpi = 0; fpi < fp.shots.length && fpi < fpExpectTrip.length; fpi++) {
    if ((fp.shots[fpi].trip || 0) !== fpExpectTrip[fpi]) {
        fpTripsOk = false;
    }
}
ok(fpTripsOk, "FingerprintCave: every shot's trip matches its block");
var fpSplays = 0, fpSplayTrip = -1;
var fpExcludeFromPlot = 0, fpExcludeFromPlotTrip = -1;
for (var fpj = 0; fpj < fp.shots.length; fpj++) {
    if (fp.shots[fpj].splay) {
        fpSplays++;
        fpSplayTrip = fp.shots[fpj].trip;
    }
    if (fp.shots[fpj].excludeFromPlot) {
        fpExcludeFromPlot++;
        fpExcludeFromPlotTrip = fp.shots[fpj].trip;
    }
}
ok(fpSplays === 1 && fpSplayTrip === 1, "FingerprintCave: 1 splay, trip 1, got " +
    fpSplays + " on trip " + fpSplayTrip);
ok(fpExcludeFromPlot === 1 && fpExcludeFromPlotTrip === 2,
    "FingerprintCave: 1 excludeFromPlot, trip 2, got " + fpExcludeFromPlot +
    " on trip " + fpExcludeFromPlotTrip);

var fpResolved = CsNetwork.resolve(fp, {});
ok(fpResolved.loops.length === 1, "FingerprintCave: one loop found, got " +
    fpResolved.loops.length);
if (fpResolved.loops.length === 1) {
    near(fpResolved.loops[0].error, 4.21, 0.05,
        "FingerprintCave: as-surveyed loop error ~4.21ft, got " +
        fpResolved.loops[0].error);
}

// Revise trips 0 and 1's declination (both were surveyed with the
// notebook's uncorrected 0.00 declination; -2.5 was the true value)
// by nudging every one of their shots' TRUE azimuth -- the loop should
// close much tighter.
for (var fpk = 0; fpk < fp.shots.length; fpk++) {
    var fpTripIdx = fp.shots[fpk].trip || 0;
    if (fpTripIdx === 0 || fpTripIdx === 1) {
        fp.shots[fpk].azimuth = CsAngles.normalizeAzimuth(
            fp.shots[fpk].azimuth - 2.5);
    }
}
var fpResolved2 = CsNetwork.resolve(fp, {});
ok(fpResolved2.loops.length === 1, "FingerprintCave revised: still one loop");
if (fpResolved2.loops.length === 1) {
    near(fpResolved2.loops[0].error, 0.74, 0.05,
        "FingerprintCave: revised loop error ~0.74ft, got " +
        fpResolved2.loops[0].error);
}

// Fingerprint MERGE: two Compass blocks sharing date/team/declination
// (but different SURVEY NAME labels, which aren't part of the
// fingerprint) collapse into ONE trip.
var mergeDat =
    "SURVEY NAME: X\r\nSURVEY DATE: 1 1 2020\r\nSURVEY TEAM:\r\n" +
    "A. One, B. Two\r\nDECLINATION: 1.00  FORMAT: DDDDLUDRLADN\r\n\r\n" +
    "FROM TO LENGTH BEARING INC LEFT UP DOWN RIGHT\r\n\r\n" +
    "A1 A2 10.0 0.0 0.0 1.0 1.0 1.0 1.0\r\n\f\r\n" +
    "SURVEY NAME: Y\r\nSURVEY DATE: 1 1 2020\r\nSURVEY TEAM:\r\n" +
    "A. One, B. Two\r\nDECLINATION: 1.00  FORMAT: DDDDLUDRLADN\r\n\r\n" +
    "FROM TO LENGTH BEARING INC LEFT UP DOWN RIGHT\r\n\r\n" +
    "B1 B2 10.0 0.0 0.0 1.0 1.0 1.0 1.0\r\n\f\r\n";
var merged = CsFormatCompass.parse(mergeDat);
ok(merged.trips.length === 1, "Compass fingerprint merge: 1 trip, got " +
    merged.trips.length);
ok(merged.shots.length === 2 && merged.shots[0].trip === 0 &&
    merged.shots[1].trip === 0, "Compass fingerprint merge: both shots trip 0");

// Round trip: write(parse(fixture)) then parse again preserves the
// trips (same fingerprints), the shot count, and the TRUE azimuths.
var fpWritten = CsFormatCompass.write(fp);
var fpRt = CsFormatCompass.parse(fpWritten);
ok(fpRt.caveName === fp.caveName, "FingerprintCave round trip: cave name, got '" +
    fpRt.caveName + "' vs '" + fp.caveName + "'");
ok(fpRt.trips.length === 3, "FingerprintCave round trip: 3 trips, got " +
    fpRt.trips.length);
if (fpRt.trips.length === 3) {
    for (var fpr = 0; fpr < 3; fpr++) {
        ok(CsModel.tripFingerprint(fpRt.trips[fpr]) ===
            CsModel.tripFingerprint(fp.trips[fpr]),
            "FingerprintCave round trip: trip " + fpr + " fingerprint, got " +
            CsModel.tripFingerprint(fpRt.trips[fpr]) + " vs " +
            CsModel.tripFingerprint(fp.trips[fpr]));
    }
}
ok(fpRt.shots.length === fp.shots.length,
    "FingerprintCave round trip: shot count, got " + fpRt.shots.length +
    " vs " + fp.shots.length);
for (var fps = 0; fps < Math.min(fp.shots.length, fpRt.shots.length); fps++) {
    near(CsAngles.azimuthDifference(fp.shots[fps].azimuth, fpRt.shots[fps].azimuth),
        0, 1e-6, "FingerprintCave round trip: shot " + fps + " TRUE azimuth");
}

// Walls and CSV are single-trip formats: ensureTrips still lands
// everything in trip 0, and the survey-level metadata each already
// tested above (declination, date, name, ...) is trip 0's.
ok(srv.trips !== undefined && srv.trips.length === 1,
    "Walls: single trip via ensureTrips, got " + (srv.trips && srv.trips.length));
if (srv.trips !== undefined && srv.trips.length === 1) {
    near(srv.trips[0].declination, srv.declination, 1e-9,
        "Walls trip 0 declination mirrors survey-level");
}
for (var wti = 0; wti < srv.shots.length; wti++) {
    ok((srv.shots[wti].trip || 0) === 0, "Walls: every shot trip 0");
}
ok(csvM.trips !== undefined && csvM.trips.length === 1,
    "CSV: single trip via ensureTrips, got " + (csvM.trips && csvM.trips.length));
if (csvM.trips !== undefined && csvM.trips.length === 1) {
    ok(csvM.trips[0].name === "Deep Cave", "CSV trip 0 name mirrors survey-level");
}
for (var cti = 0; cti < csvM.shots.length; cti++) {
    ok((csvM.shots[cti].trip || 0) === 0, "CSV: every shot trip 0");
}

// Survex per-leg trip attribution: a *date/*calibrate change mid-file
// starts a new trip, and each leg's declination un-apply on write
// uses ITS OWN trip, not a single survey-wide value.
var svxTripSrc = "*data normal from to tape compass clino\r\n" +
    "*date 2020-01-01\r\n*calibrate declination -2.0\r\n" +
    "T1 T2 10.0 90.0 0.0\r\n" +
    "*date 2021-06-15\r\n*calibrate declination 0.0\r\n" +
    "T2 T3 10.0 90.0 0.0\r\n";
var svxTrip = CsFormatSurvex.parse(svxTripSrc);
ok(svxTrip.trips.length === 2, "Survex: two *date/*calibrate tuples, two trips, got " +
    svxTrip.trips.length);
ok(svxTrip.shots[0].trip === 0 && svxTrip.shots[1].trip === 1,
    "Survex: each leg tagged with the tuple in force where it appears");
near(svxTrip.shots[0].azimuth, 92.0, 1e-9,
    "Survex: leg 1 true azimuth uses its own trip's declination");
near(svxTrip.shots[1].azimuth, 90.0, 1e-9,
    "Survex: leg 2 true azimuth uses its own (zero) declination");
var svxTripWritten = CsFormatSurvex.write(svxTrip);
var svxTripRt = CsFormatSurvex.parse(svxTripWritten);
ok(svxTripRt.trips.length === 2,
    "Survex round trip: still two trips, got " + svxTripRt.trips.length);
near(CsAngles.azimuthDifference(svxTripRt.shots[0].azimuth, svxTrip.shots[0].azimuth),
    0, 1e-6, "Survex round trip: leg 1 true azimuth preserved");
near(CsAngles.azimuthDifference(svxTripRt.shots[1].azimuth, svxTrip.shots[1].azimuth),
    0, 1e-6, "Survex round trip: leg 2 true azimuth preserved");

// Survex team boundary regression: *team is a running append with no
// block scoping, so without a reset at a *date boundary a second
// trip's crew would wrongly inherit the first trip's members too
// ("Alice, Bob, Carol" instead of "Carol"). teamDirty tracks whether
// a leg has been recorded against the current team; *date clears the
// team only when that's true, i.e. only when a new trip is actually
// starting.
var teamBoundarySrc = "*data normal from to tape compass clino\r\n" +
    "*date 2020.01.01\r\n" +
    "*team \"Alice\"\r\n" +
    "*team \"Bob\"\r\n" +
    "T1 T2 10.0 90.0 0.0\r\n" +
    "*date 2021.06.15\r\n" +
    "*team \"Carol\"\r\n" +
    "T2 T3 10.0 90.0 0.0\r\n";
var teamBoundary = CsFormatSurvex.parse(teamBoundarySrc);
ok(teamBoundary.trips.length === 2,
    "Survex team boundary: 2 trips, got " + teamBoundary.trips.length);
if (teamBoundary.trips.length === 2) {
    ok(teamBoundary.trips[0].team === "Alice, Bob",
        "Survex team boundary: trip 0 team, got '" +
        teamBoundary.trips[0].team + "'");
    ok(teamBoundary.trips[1].team === "Carol",
        "Survex team boundary: trip 1 team must not bleed from trip 0, got '" +
        teamBoundary.trips[1].team + "'");
}
ok(teamBoundary.shots.length === 2 && teamBoundary.shots[0].trip === 0 &&
    teamBoundary.shots[1].trip === 1,
    "Survex team boundary: shots tagged trip 0 and trip 1, got " +
    JSON.stringify([teamBoundary.shots[0].trip, teamBoundary.shots[1].trip]));

// writer round-trips the two distinct teams
var teamBoundaryWritten = CsFormatSurvex.write(teamBoundary);
var teamBoundaryRt = CsFormatSurvex.parse(teamBoundaryWritten);
ok(teamBoundaryRt.trips.length === 2,
    "Survex team boundary round trip: 2 trips, got " +
    teamBoundaryRt.trips.length);
if (teamBoundaryRt.trips.length === 2) {
    ok(teamBoundaryRt.trips[0].team === "Alice, Bob",
        "Survex team boundary round trip: trip 0 team, got '" +
        teamBoundaryRt.trips[0].team + "'");
    ok(teamBoundaryRt.trips[1].team === "Carol",
        "Survex team boundary round trip: trip 1 team, got '" +
        teamBoundaryRt.trips[1].team + "'");
}

// ---------------------------------------------------------------------
// Revision math (CsRevise) -- declination revision and the numeric
// rigid-change detector. Pure functions, so these run under node too.
// ---------------------------------------------------------------------

// --- reviseDeclination: per-trip rotation of stored azimuths --------
(function() {
    var sv = CsModel.newSurvey();
    var wrap = shotOf("R1", "R2", 10, 359);   // wraps past north
    wrap.backAzimuth = 179;
    sv.shots.push(wrap);
    var splay = shotOf("R2", "", 5, 10);
    splay.splay = true;
    sv.shots.push(splay);
    var excluded = shotOf("R2", "RX", 7, 45);
    excluded.excludeFromAll = true;
    sv.shots.push(excluded);
    CsModel.ensureTrips(sv);
    sv.trips[0].declination = 1.0;
    sv.trips.push(CsModel.newTrip());
    sv.trips[1].declination = 4.0;
    var other = shotOf("R2", "R3", 10, 90);
    other.trip = 1;
    sv.shots.push(other);

    var rd = CsRevise.reviseDeclination(sv, 0, 3.0, "igrf");
    near(rd.delta, 2.0, 1e-12, "reviseDeclination: delta = new - old");
    near(sv.shots[0].azimuth, 1.0, 1e-9,
        "reviseDeclination: azimuth wraps 359 + 2 -> 1");
    near(sv.shots[0].backAzimuth, 181.0, 1e-9,
        "reviseDeclination: backAzimuth co-rotates");
    near(sv.shots[1].azimuth, 12.0, 1e-9,
        "reviseDeclination: splay co-rotates");
    near(sv.shots[2].azimuth, 47.0, 1e-9,
        "reviseDeclination: excluded shot co-rotates too");
    near(sv.shots[3].azimuth, 90.0, 1e-9,
        "reviseDeclination: other trip's shot untouched");
    near(sv.trips[0].declination, 3.0, 1e-12,
        "reviseDeclination: trip record updated");
    ok(sv.trips[0].declinationSource === "igrf",
        "reviseDeclination: source recorded when provided");
    near(sv.declination, 3.0, 1e-12,
        "reviseDeclination: trip 0 re-mirrors to survey.declination");

    // revising trip 1 leaves trip 0 (and the top-level mirror) alone
    var rd1 = CsRevise.reviseDeclination(sv, 1, 6.0);
    near(rd1.delta, 2.0, 1e-12, "reviseDeclination: trip 1 delta");
    near(sv.shots[3].azimuth, 92.0, 1e-9,
        "reviseDeclination: trip 1 shot rotated");
    near(sv.shots[0].azimuth, 1.0, 1e-9,
        "reviseDeclination: trip 0 shot untouched by trip 1 revision");
    ok(sv.trips[1].declinationSource === "",
        "reviseDeclination: source kept when omitted");
    near(sv.declination, 3.0, 1e-12,
        "reviseDeclination: trip 1 revision leaves survey.declination");
})();

// --- similarityFit edges ---------------------------------------------
(function() {
    ok(CsRevise.similarityFit([]) === null, "similarityFit: 0 pairs -> null");
    var one = CsRevise.similarityFit([
        { old: { x: 1, y: 2 }, nu: { x: 4, y: 6 } }
    ]);
    near(one.theta, 0, 1e-12, "similarityFit: 1 pair theta 0");
    near(one.scale, 1, 1e-12, "similarityFit: 1 pair scale 1");
    near(one.tx, 3, 1e-12, "similarityFit: 1 pair tx");
    near(one.ty, 4, 1e-12, "similarityFit: 1 pair ty");
    near(one.maxResidual, 0, 1e-12, "similarityFit: 1 pair residual 0");

    // coincident old points: underdetermined, never certifiable rigid
    var degenerate = CsRevise.similarityFit([
        { old: { x: 5, y: 5 }, nu: { x: 6, y: 5 } },
        { old: { x: 5, y: 5 }, nu: { x: 6, y: 7 } }
    ]);
    ok(degenerate.maxResidual === Infinity,
        "similarityFit: coincident old points -> maxResidual Infinity");
})();

// --- rigid detection: declination revision rotates the plan as one
// body, and the fit's theta sign is proven by application, not by
// convention: transformed old stations must LAND ON the new ones.
(function() {
    var sv = CsModel.newSurvey();
    sv.shots.push(shotOf("G1", "G2", 10, 0));
    sv.shots.push(shotOf("G2", "G3", 10, 90));
    sv.shots.push(shotOf("G2", "G4", 8, 45, 10)); // branch, non-collinear
    CsModel.ensureTrips(sv);
    var oldR = CsNetwork.resolve(sv, {});
    CsRevise.reviseDeclination(sv, 0, sv.trips[0].declination + 5);
    var newR = CsNetwork.resolve(sv, {});
    var cc = CsRevise.classifyChange(oldR, newR, 30);

    ok(cc.rigid === true, "classifyChange: declination revision is rigid, " +
        "maxResidual " + cc.maxResidual);
    near(cc.scale, 1, 1e-9, "classifyChange: rigid fit scale 1");
    near(Math.abs(cc.theta), 5 * Math.PI / 180, 1e-9,
        "classifyChange: |theta| is the 5 deg delta in radians");
    // sign proof: apply the fit to old stations, must match new exactly
    var names = ["G2", "G3", "G4"];
    for (var i = 0; i < names.length; i++) {
        var t = CsRevise.applyFit(cc, oldR.stations[names[i]]);
        near(t.x, newR.stations[names[i]].x, 1e-9,
            "classifyChange: fit maps old " + names[i] + ".x onto new");
        near(t.y, newR.stations[names[i]].y, 1e-9,
            "classifyChange: fit maps old " + names[i] + ".y onto new");
    }
    // independent geometric check of the SIGN, derived from resolve
    // itself: azimuth +5 must turn the drawing CLOCKWISE, i.e. by
    // -5 deg in math (CCW-positive) coordinates about the G1 anchor.
    var mth = -5 * Math.PI / 180;
    var g3 = oldR.stations["G3"];
    near(Math.cos(mth) * g3.x - Math.sin(mth) * g3.y,
        newR.stations["G3"].x, 1e-9,
        "azimuth +5 deg rotates the plan clockwise (x)");
    near(Math.sin(mth) * g3.x + Math.cos(mth) * g3.y,
        newR.stations["G3"].y, 1e-9,
        "azimuth +5 deg rotates the plan clockwise (y)");
    near(cc.theta, mth, 1e-9,
        "classifyChange: theta = -delta * PI/180 (CCW-positive math frame)");
})();

// --- non-rigid: revising ONE trip of two bends the survey ------------
(function() {
    var sv = CsModel.newSurvey();
    sv.shots.push(shotOf("M1", "M2", 10, 0));
    sv.shots.push(shotOf("M2", "M3", 10, 90));
    CsModel.ensureTrips(sv);
    sv.trips.push(CsModel.newTrip());
    var s34 = shotOf("M3", "M4", 10, 0);
    s34.trip = 1;
    var s45 = shotOf("M4", "M5", 10, 90);
    s45.trip = 1;
    sv.shots.push(s34);
    sv.shots.push(s45);

    var oldR = CsNetwork.resolve(sv, {});
    CsRevise.reviseDeclination(sv, 1, 10.0);
    var newR = CsNetwork.resolve(sv, {});
    var cc = CsRevise.classifyChange(oldR, newR, 40);

    ok(cc.rigid === false, "classifyChange: one-of-two-trips revision is NOT rigid");
    ok(cc.moved.length === 5, "classifyChange: every shared station listed, got " +
        cc.moved.length);
    ok(cc.moved[0].name === "M4" || cc.moved[0].name === "M5",
        "classifyChange: top mover is a trip-1 station, got " + cc.moved[0].name);
    ok(cc.moved[0].dist > 0.1, "classifyChange: top mover really moved");
    for (var i = 0; i < cc.moved.length; i++) {
        if (cc.moved[i].name === "M1" || cc.moved[i].name === "M2" ||
                cc.moved[i].name === "M3") {
            near(cc.moved[i].dist, 0, 1e-9,
                "classifyChange: trip-0 station " + cc.moved[i].name +
                " does not move");
        }
    }
})();

// --- non-rigid: one edited shot moves exactly its downstream ---------
(function() {
    var sv = CsModel.newSurvey();
    sv.shots.push(shotOf("E1", "E2", 10, 0));
    sv.shots.push(shotOf("E2", "E3", 10, 90));
    sv.shots.push(shotOf("E3", "E4", 10, 0));
    sv.shots.push(shotOf("E4", "E5", 10, 90));
    CsModel.ensureTrips(sv);
    var oldR = CsNetwork.resolve(sv, {});
    sv.shots[1].azimuth += 20; // edit a MIDDLE shot directly
    var newR = CsNetwork.resolve(sv, {});
    var cc = CsRevise.classifyChange(oldR, newR, 40);

    ok(cc.rigid === false, "classifyChange: edited shot is NOT rigid");
    ok(cc.moved[0].name === "E3" || cc.moved[0].name === "E4" ||
        cc.moved[0].name === "E5",
        "classifyChange: top mover is downstream of the edit, got " +
        cc.moved[0].name);
    // E3 rotates about E2; E4/E5 translate with it -- all three shift
    // the same chord, everything upstream stays put
    var chord = 2 * 10 * Math.sin(10 * Math.PI / 180);
    for (var i = 0; i < cc.moved.length; i++) {
        var m = cc.moved[i];
        if (m.name === "E1" || m.name === "E2") {
            near(m.dist, 0, 1e-9,
                "classifyChange: upstream " + m.name + " does not move");
        } else {
            near(m.dist, chord, 1e-9,
                "classifyChange: downstream " + m.name + " shifts by the chord");
        }
    }
})();

// --- identical resolves are trivially rigid --------------------------
(function() {
    var sv = CsModel.newSurvey();
    sv.shots.push(shotOf("I1", "I2", 10, 0));
    sv.shots.push(shotOf("I2", "I3", 10, 90));
    CsModel.ensureTrips(sv);
    var r = CsNetwork.resolve(sv, {});
    var cc = CsRevise.classifyChange(r, r, 20);
    ok(cc.rigid === true, "classifyChange: identical resolves are rigid");
    near(cc.theta, 0, 1e-12, "classifyChange: identical resolves theta 0");
    near(cc.scale, 1, 1e-12, "classifyChange: identical resolves scale 1");
    near(cc.maxResidual, 0, 1e-12,
        "classifyChange: identical resolves residual 0");
})();

// ---------------------------------------------------------------------
// Drawing round-trip -- QCAD engine only (node has no R* classes).
// This is the test that would have caught the silent simple.js
// failures: draw into a real document, read layers and tags back.
// ---------------------------------------------------------------------

if (!IS_NODE) {
    (function() {
        loadRepoScript("scripts/CaveSurvey/Core/CsLayers.js");
        loadRepoScript("scripts/CaveSurvey/Core/CsStore.js");
        loadRepoScript("scripts/CaveSurvey/Core/CsTags.js");
        loadRepoScript("scripts/CaveSurvey/Core/CsDraw.js");

        var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var di = new RDocumentInterface(doc);
        // CsDraw reaches the document through these globals in GUI
        // context; provide them here.
        getDocument = function() { return doc; };
        getDocumentInterface = function() { return di; };

        var dsv = CsModel.newSurvey();
        dsv.startNote = "entrance drop, rig here";
        var d1 = shotOf("D1", "D2", 10, 0);
        d1.notes = "tight squeeze\nwatch the ceiling";
        d1.left = 2; d1.right = 3; d1.up = 1; d1.down = 0.5;
        var d2 = shotOf("D2", "D3", 10, 90);
        d2.left = 1; d2.right = 1;
        dsv.shots.push(d1);
        dsv.shots.push(d2);
        var dres = CsNetwork.resolve(dsv, {});
        var drawn = CsDraw.survey(dsv, dres);

        ok(drawn.stationsDrawn === 3, "draw: 3 stations drawn");
        ok(drawn.shotsDrawn === 2, "draw: 2 shots drawn");

        // layers really exist and really hold the entities
        ok(doc.hasLayer("CTRL-STATIONS"), "draw: stations layer created");
        ok(doc.hasLayer("CTRL-LRUD"), "draw: lrud layer created");
        var byLayer = {};
        var ids = doc.queryAllEntities(false, false);
        for (var i = 0; i < ids.length; i++) {
            var e = doc.queryEntity(ids[i]);
            var ln = doc.getLayerName(e.getLayerId());
            byLayer[ln] = (byLayer[ln] || 0) + 1;
        }
        ok(byLayer["CTRL-STATIONS"] === 3,
            "draw: 3 points ON CTRL-STATIONS, got " + byLayer["CTRL-STATIONS"]);
        ok(byLayer["CTRL-SHOTS"] === 2,
            "draw: 2 lines ON CTRL-SHOTS, got " + byLayer["CTRL-SHOTS"]);
        ok((byLayer["CTRL-LRUD"] || 0) >= 4,
            "draw: LRUD ticks+tips on CTRL-LRUD, got " + byLayer["CTRL-LRUD"]);

        // tags really persist
        var stations = CsTags.collectStations(doc);
        ok(stations.length === 3, "tags: 3 tagged stations read back");
        var namesBack = [];
        for (i = 0; i < stations.length; i++) {
            namesBack.push(stations[i].name);
        }
        ok(namesBack.join(",") === "D1,D2,D3",
            "tags: Seq order preserved, got " + namesBack.join(","));

        // the reconstructed survey drives walls
        var rebuilt = CsTags.surveyFromDocument(doc);
        ok(rebuilt.shots.length === 2, "tags: survey rebuilt from drawing");
        ok(rebuilt.startNote === "entrance drop, rig here",
            "notes: start station note recovered");
        ok(rebuilt.shots[0].notes === "tight squeeze\nwatch the ceiling",
            "notes: multiline note recovered, got '" + rebuilt.shots[0].notes + "'");
        near(rebuilt.shots[0].left, 2, 1e-9, "tags: LRUD readable from drawing");

        // multi-reading LRUD: "5/10" draws two tagged tips
        var msv = CsModel.newSurvey();
        var msh = shotOf("M1", "M2", 10, 0);
        msh.left = 10;
        msh.leftAll = [5, 10];
        msv.shots.push(msh);
        var mres = CsNetwork.resolve(msv, {});
        CsDraw.survey(msv, mres);
        CsStore.ensureLoaded(doc);
        var tipNames = [];
        var mids = doc.queryAllEntities(false, false);
        for (var mi = 0; mi < mids.length; mi++) {
            var me = doc.queryEntity(mids[mi]);
            var mn = CsTags.get(me, "LRUDName");
            if (mn.indexOf("M2.") === 0) {
                tipNames.push(mn);
            }
        }
        tipNames.sort();
        ok(tipNames.join(",") === "M2.L,M2.L2",
            "multi LRUD: outer wall is .L, inner ledge .L2, got " +
            tipNames.join(","));
        CsDraw.eraseStations(doc, ["M1", "M2"]);

        // THE PERSISTENCE TEST: this build never writes custom
        // properties to disk, so tags must come back through the
        // CsStore survey database after an export/import round trip.
        var tmpPath = "/tmp/cavesurvey_unit_roundtrip.dxf";
        ok(di.exportFile(tmpPath,
            "R27 [2013] DXF Drawing [OpenDesign] (*.dxf)") === true,
            "persist: export ok");
        var doc2 = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var di2 = new RDocumentInterface(doc2);
        ok(di2.importFile(tmpPath, "", false) ===
            RDocumentInterface.IoErrorNoError, "persist: reimport ok");
        // swap the globals CsDraw/CsTags reach through
        var oldDoc = doc, oldDi = di;
        getDocument = function() { return doc2; };
        getDocumentInterface = function() { return di2; };
        var stations2 = CsTags.collectStations(doc2);
        ok(stations2.length === 3,
            "persist: 3 stations recovered after reopen, got " +
            stations2.length);
        var rebuilt2 = CsTags.surveyFromDocument(doc2);
        ok(rebuilt2.shots.length === 2,
            "persist: survey rebuilt after reopen");
        if (rebuilt2.shots.length === 2) {
            ok(rebuilt2.shots[0].notes === "tight squeeze\nwatch the ceiling",
                "persist: multiline note survives reopen");
        }
        if (rebuilt2.shots.length === 2) {
            near(rebuilt2.shots[0].left, 2, 1e-9,
                "persist: LRUD recovered after reopen");
        }
        getDocument = function() { return oldDoc; };
        getDocumentInterface = function() { return oldDi; };

        // erase replaces cleanly
        var removed = CsDraw.eraseStations(doc, ["D1", "D2", "D3"]);
        ok(removed > 0, "erase: removed " + removed + " marks");
        ok(CsTags.collectStations(doc).length === 0,
            "erase: no tagged stations left");
    })();

    // -----------------------------------------------------------------
    // Tag schema v3: the drawing's tags alone reconstruct the whole
    // survey. One shot = one LEG LINE carrying the shot's full data
    // (the old station-point scheme collides on loop closures); trip
    // anchors carry per-trip metadata; excluded/unplaced shots
    // serialize as rows on the trip-0 anchor; excludeFromPlot legs
    // land on CTRL-HIDDEN (which is OFF -- the write must toggle it).
    // -----------------------------------------------------------------
    (function() {
        var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var di = new RDocumentInterface(doc);
        getDocument = function() { return doc; };
        getDocumentInterface = function() { return di; };

        var vsv = CsModel.newSurvey();
        vsv.caveName = "TEST CAVE";
        vsv.name = "ENT";
        vsv.date = "2020-01-01";
        vsv.team = "Alice";
        vsv.declination = 2.5;
        vsv.declinationSource = "user";
        vsv.distanceUnit = "ft";
        vsv.startNote = "rig here";
        vsv.startLrud = { left: 1, right: 2, up: 3, down: 4 };
        CsModel.ensureTrips(vsv);
        var vt1 = CsModel.newTrip();
        vt1.name = "UPPER";
        vt1.date = "2021-05-05";
        vt1.team = "Bob";
        vt1.declination = 3.0;
        vt1.declinationSource = "igrf";
        vt1.distanceUnit = "ft";
        vsv.trips.push(vt1);
        ok(CsModel.tripFingerprint(vsv.trips[0]) !==
            CsModel.tripFingerprint(vsv.trips[1]),
            "v3: the two test trips have distinct fingerprints");

        var v0 = shotOf("A1", "A2", 10, 0);        // trip 0, seq 0
        v0.left = 2; v0.right = 3;
        v0.backAzimuth = 180.5;                     // backsight pair
        v0.backInclination = -1;
        var v1 = shotOf("A2", "A3", 10, 90);       // trip 0, seq 1
        v1.notes = "muddy crawl";
        var v2 = shotOf("A3", "A4", 10, 180);      // trip 0, seq 2
        var v3 = shotOf("A4", "A1", 10.5, 270);    // trip 0, seq 3: closure
        var v4 = shotOf("A4", "A5", 8, 45);        // trip 1, seq 0
        v4.trip = 1;
        var v5 = shotOf("A5", "A6", 6, 100);       // trip 1, seq 1: hidden
        v5.trip = 1;
        v5.excludeFromPlot = true;
        var v6 = shotOf("X1", "X2", 7, 10);        // trip 0, seq 4: excluded
        v6.excludeFromAll = true;
        v6.notes = "bad shot";
        var v7 = shotOf("A2", "", 4, 120, -5);     // trip 0, seq 5: splay
        v7.splay = true;
        v7.notes = "to wall";
        var v8 = shotOf("Z1", "Z2", 9, 33);        // trip 0, seq 6: unplaced
        vsv.shots.push(v0); vsv.shots.push(v1); vsv.shots.push(v2);
        vsv.shots.push(v3); vsv.shots.push(v4); vsv.shots.push(v5);
        vsv.shots.push(v6); vsv.shots.push(v7); vsv.shots.push(v8);
        vsv.fixed["A1"] = { x: 100, y: 200, z: 5 };

        var vres = CsNetwork.resolve(vsv, {});
        CsDraw.survey(vsv, vres);

        // read RAW tags back off the entities
        var legByShot = {};
        var splayLine = null;
        var hiddenCount = 0;
        var stationPt = {};
        var vids = doc.queryAllEntities(false, false);
        for (var vi = 0; vi < vids.length; vi++) {
            var ve = doc.queryEntity(vids[vi]);
            if (isNull(ve)) {
                continue;
            }
            if (doc.getLayerName(ve.getLayerId()) === "CTRL-HIDDEN") {
                hiddenCount++;
            }
            var vShot = CsTags.get(ve, "Shot");
            if (vShot !== "") {
                legByShot[vShot] = ve;
            }
            if (CsTags.get(ve, "Splay") !== "") {
                splayLine = ve;
            }
            var vStation = CsTags.get(ve, "Station");
            if (vStation !== "") {
                stationPt[vStation] = ve;
            }
        }

        // the hidden leg actually LANDED despite CTRL-HIDDEN being OFF
        ok(hiddenCount >= 1,
            "v3: CTRL-HIDDEN really holds the plot-excluded leg, got " +
            hiddenCount);

        var lg = legByShot["A1->A2"];
        ok(lg !== undefined, "v3: A1->A2 leg found");
        ok(CsTags.get(lg, "From") === "A1" && CsTags.get(lg, "To") === "A2",
            "v3: leg From/To");
        ok(CsTags.get(lg, "Distance") === "10", "v3: leg Distance, got '" +
            CsTags.get(lg, "Distance") + "'");
        ok(CsTags.get(lg, "Azimuth") === "0", "v3: leg Azimuth, got '" +
            CsTags.get(lg, "Azimuth") + "'");
        ok(CsTags.get(lg, "Inclination") === "0", "v3: leg Inclination");
        ok(CsTags.get(lg, "Trip") === "0" && CsTags.get(lg, "ShotSeq") === "0",
            "v3: leg Trip/ShotSeq");
        ok(CsTags.get(lg, "BackAzimuth") === "180.5" &&
            CsTags.get(lg, "BackInclination") === "-1",
            "v3: leg backsight pair");
        ok(CsTags.get(lg, "Left") === "2" && CsTags.get(lg, "Right") === "3",
            "v3: leg LRUD");

        // the closure leg carries its OWN shot data -- the whole point
        // of moving shots onto legs (station tags collide at closures)
        var cl = legByShot["A4->A1"];
        ok(cl !== undefined, "v3: closure leg found");
        ok(cl !== undefined && CsTags.get(cl, "Azimuth") === "270" &&
            CsTags.get(cl, "Distance") === "10.5" &&
            CsTags.get(cl, "ShotSeq") === "3",
            "v3: closure leg carries its own azimuth/distance/seq, got az '" +
            CsTags.get(cl, "Azimuth") + "'");

        var t1leg = legByShot["A4->A5"];
        ok(t1leg !== undefined && CsTags.get(t1leg, "Trip") === "1" &&
            CsTags.get(t1leg, "ShotSeq") === "0",
            "v3: trip-1 leg Trip/ShotSeq restart per trip");

        var hid = legByShot["A5->A6"];
        ok(hid !== undefined, "v3: hidden leg drawn, not skipped");
        if (hid !== undefined) {
            ok(doc.getLayerName(hid.getLayerId()) === "CTRL-HIDDEN",
                "v3: hidden leg on CTRL-HIDDEN, got " +
                doc.getLayerName(hid.getLayerId()));
            ok(CsTags.get(hid, "Flags") === "P", "v3: hidden leg Flags P");
            ok(CsTags.get(hid, "Trip") === "1" &&
                CsTags.get(hid, "ShotSeq") === "1" &&
                CsTags.get(hid, "Distance") === "6",
                "v3: hidden leg full data");
        }
        // hidden leg's stations still drew as normal
        ok(stationPt["A6"] !== undefined,
            "v3: hidden leg's TO station still drawn");

        ok(legByShot["A2->A3"] !== undefined &&
            CsTags.get(legByShot["A2->A3"], "Note") === "muddy crawl",
            "v3: leg Note");

        // splay line carries its readings
        ok(splayLine !== null, "v3: splay line found");
        if (splayLine !== null) {
            ok(CsTags.get(splayLine, "Distance") === "4" &&
                CsTags.get(splayLine, "Azimuth") === "120" &&
                CsTags.get(splayLine, "Inclination") === "-5",
                "v3: splay reading tags");
            ok(CsTags.get(splayLine, "Trip") === "0" &&
                CsTags.get(splayLine, "ShotSeq") === "5",
                "v3: splay Trip/ShotSeq");
            ok(CsTags.get(splayLine, "Note") === "to wall", "v3: splay Note");
        }

        // trip anchors: trip 0 -> A1 (first station touched by a trip-0
        // shot), trip 1 -> A5
        var a0 = stationPt["A1"], a1 = stationPt["A5"];
        ok(a0 !== undefined && CsTags.get(a0, "Trip") === "0" &&
            CsTags.get(a0, "TripName") === "ENT" &&
            CsTags.get(a0, "TripDate") === "2020-01-01" &&
            CsTags.get(a0, "TripTeam") === "Alice",
            "v3: trip 0 anchor name/date/team");
        ok(a0 !== undefined && CsTags.get(a0, "TripDeclination") === "2.5" &&
            CsTags.get(a0, "TripDeclinationSource") === "user" &&
            CsTags.get(a0, "TripDistanceUnit") === "ft",
            "v3: trip 0 anchor declination/unit");
        ok(a0 !== undefined && CsTags.get(a0, "StartNote") === "rig here" &&
            CsTags.get(a0, "StartLrud") === "1,2,3,4",
            "v3: trip 0 anchor StartNote/StartLrud");
        ok(a0 !== undefined && CsTags.get(a0, "SurveyName") === "TEST CAVE" &&
            CsTags.get(a0, "SurveyDate") === "2020-01-01" &&
            CsTags.get(a0, "SurveyTeam") === "Alice",
            "v3: legacy survey block kept on trip 0 anchor");
        ok(a1 !== undefined && CsTags.get(a1, "Trip") === "1" &&
            CsTags.get(a1, "TripName") === "UPPER" &&
            CsTags.get(a1, "TripTeam") === "Bob" &&
            CsTags.get(a1, "TripDate") === "2021-05-05" &&
            CsTags.get(a1, "TripDeclination") === "3",
            "v3: trip 1 anchor metadata");

        // ExcludedShots round-trips through parseShotRow. Row format is
        // "tripId TAB shotSeq TAB shotRow" -- split properly instead of
        // a substring(2) hack, which would break once a trip id reaches
        // two digits.
        var exText = a0 !== undefined ? CsTags.get(a0, "ExcludedShots") : "";
        ok(exText !== "", "v3: ExcludedShots present");
        var exRows = exText.split("\n");
        ok(exRows.length === 1, "v3: one excluded row, got " + exRows.length);
        var exFields = exRows[0].split("\t");
        ok(exFields[0] === "0",
            "v3: excluded row trip-prefixed, got '" + exFields[0] + "'");
        ok(exFields[1] === "4",
            "v3: excluded row ShotSeq (trip-0 seq 4), got '" +
            exFields[1] + "'");
        var exShot = CsModel.parseShotRow(exFields.slice(2).join("\t"));
        ok(exShot.from === "X1" && exShot.to === "X2",
            "v3: excluded row from/to, got " + exShot.from + "->" + exShot.to);
        near(exShot.distance, 7, 1e-9, "v3: excluded row distance");
        near(exShot.azimuth, 10, 1e-9, "v3: excluded row azimuth");
        ok(exShot.excludeFromAll === true, "v3: excluded row X flag");
        ok(exShot.notes === "bad shot", "v3: excluded row note, got '" +
            exShot.notes + "'");

        // UnplacedShots too
        var unText = a0 !== undefined ? CsTags.get(a0, "UnplacedShots") : "";
        ok(unText !== "", "v3: UnplacedShots present");
        if (unText !== "") {
            var unFields = unText.split("\n")[0].split("\t");
            ok(unFields[1] === "6",
                "v3: unplaced row ShotSeq (trip-0 seq 6), got '" +
                unFields[1] + "'");
            var unShot = CsModel.parseShotRow(unFields.slice(2).join("\t"));
            ok(unShot.from === "Z1" && unShot.to === "Z2",
                "v3: unplaced row from/to");
            near(unShot.distance, 9, 1e-9, "v3: unplaced row distance");
        }

        // fixed station
        ok(a0 !== undefined && CsTags.get(a0, "Fixed") === "100,200,5",
            "v3: Fixed tag, got '" +
            (a0 !== undefined ? CsTags.get(a0, "Fixed") : "") + "'");

        // CTRL-HIDDEN itself ends the draw back OFF (withLayerOn restored it)
        var hidLayer = doc.queryLayer("CTRL-HIDDEN");
        ok(!isNull(hidLayer) && hidLayer.isOff() === true,
            "v3: CTRL-HIDDEN restored to OFF after the draw");
    })();

    // -----------------------------------------------------------------
    // A note's own embedded newline must not fool the ExcludedShots
    // blob's "\n"-joined row splitting: shotRowText/parseShotRow now
    // escape '\' and real newlines per row, so the blob still splits
    // into exactly one row per excluded shot.
    // -----------------------------------------------------------------
    (function() {
        var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var di = new RDocumentInterface(doc);
        getDocument = function() { return doc; };
        getDocumentInterface = function() { return di; };

        var msv = CsModel.newSurvey();
        // a normal, resolvable leg so a station exists to anchor the tags
        var mOk = shotOf("M0", "M1", 5, 0);          // trip 0, seq 0
        var m0 = shotOf("M1", "M2", 5, 0);           // trip 0, seq 1: excluded
        m0.excludeFromAll = true;
        m0.notes = "line one\nline two";
        var m1 = shotOf("M2", "M3", 6, 90);          // trip 0, seq 2: excluded
        m1.excludeFromAll = true;
        m1.notes = "single line";
        msv.shots.push(mOk); msv.shots.push(m0); msv.shots.push(m1);

        var mres = CsNetwork.resolve(msv, {});
        CsDraw.survey(msv, mres);

        var mids = doc.queryAllEntities(false, false);
        var manchor;
        for (var mi = 0; mi < mids.length; mi++) {
            var me = doc.queryEntity(mids[mi]);
            if (isNull(me)) {
                continue;
            }
            if (CsTags.get(me, "ExcludedShots") !== "") {
                manchor = me;
                break;
            }
        }
        ok(manchor !== undefined, "v3: multi-line-note anchor found");
        if (manchor !== undefined) {
            var mText = CsTags.get(manchor, "ExcludedShots");
            var mRows = mText.split("\n");
            ok(mRows.length === 2,
                "v3: ExcludedShots still splits into 2 rows when one " +
                "note has an embedded newline, got " + mRows.length);
            if (mRows.length === 2) {
                var mShot0 = CsModel.parseShotRow(
                    mRows[0].split("\t").slice(2).join("\t"));
                ok(mShot0.notes === "line one\nline two",
                    "v3: multi-line note survives row split, got '" +
                    mShot0.notes + "'");
                var mShot1 = CsModel.parseShotRow(
                    mRows[1].split("\t").slice(2).join("\t"));
                ok(mShot1.notes === "single line",
                    "v3: sibling row unaffected, got '" + mShot1.notes + "'");
            }
        }
    })();

    // -----------------------------------------------------------------
    // THE GATE of the revision framework: CsRevise.surveyFromDocument
    // (draw(S)) deep-equals S, field by field. A rich survey -- two
    // trips, branch, loop closure, backsight pair, hidden leg,
    // excluded shot with a multi-line note, splay (with backsight),
    // unplaced shot, fixed station, multi-reading LRUD side, notes --
    // drawn into a fresh doc and read back EXACTLY.
    // -----------------------------------------------------------------
    (function() {
        // --- deep-compare kit --------------------------------------
        var isArr = function(v) {
            return Object.prototype.toString.call(v) === "[object Array]";
        };
        // exp/got: null==undefined, numbers near 1e-9, arrays
        // element-wise, everything else exact
        var valEqual = function(exp, got, label) {
            var e = (exp === undefined) ? null : exp;
            var g = (got === undefined) ? null : got;
            if (e === null || g === null) {
                ok(e === g, label + ": expected " + e + ", got " + g);
            } else if (isArr(e) || isArr(g)) {
                if (!isArr(e) || !isArr(g) || e.length !== g.length) {
                    ok(false, label + ": array shape, expected " + e +
                        ", got " + g);
                } else {
                    var same = true;
                    for (var ai = 0; ai < e.length; ai++) {
                        if (Math.abs(e[ai] - g[ai]) > 1e-9) {
                            same = false;
                        }
                    }
                    ok(same, label + ": array elements, expected [" +
                        e.join(",") + "], got [" + g.join(",") + "]");
                }
            } else if (typeof e === "number" && typeof g === "number") {
                near(g, e, 1e-9, label);
            } else {
                ok(e === g, label + ": expected '" + e + "', got '" +
                    g + "'");
            }
        };
        // EVERY key of CsModel.newShot, one assertion each
        var shotsEqual = function(exp, got, label) {
            var proto = CsModel.newShot();
            for (var k in proto) {
                if (proto.hasOwnProperty(k)) {
                    valEqual(exp[k], got[k], label + "." + k);
                }
            }
        };
        var lrudEqual = function(exp, got, label) {
            var e = (exp === undefined) ? null : exp;
            var g = (got === undefined) ? null : got;
            if (e === null || g === null) {
                ok(e === g, label + ": null-ness, expected " + e +
                    ", got " + g);
                return;
            }
            var keys = ["left", "right", "up", "down",
                "leftAll", "rightAll", "upAll", "downAll"];
            for (var ki = 0; ki < keys.length; ki++) {
                valEqual(e[keys[ki]], g[keys[ki]], label + "." + keys[ki]);
            }
        };
        var tripsEqual = function(exp, got, label) {
            var proto = CsModel.newTrip();
            for (var k in proto) {
                if (proto.hasOwnProperty(k)) {
                    if (k === "startLrud") {
                        lrudEqual(exp[k], got[k], label + ".startLrud");
                    } else {
                        valEqual(exp[k], got[k], label + "." + k);
                    }
                }
            }
        };

        // --- the rich fixture survey S ------------------------------
        var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var di = new RDocumentInterface(doc);
        getDocument = function() { return doc; };
        getDocumentInterface = function() { return di; };

        var S = CsModel.newSurvey();
        S.caveName = "TEST CAVE";
        S.name = "ENT";
        S.date = "2020-01-01";
        S.team = "Alice";
        S.declination = 2.5;
        S.declinationSource = "user";
        S.distanceUnit = "ft";
        S.startNote = "rig here";
        S.startLrud = { left: 1, right: 2, up: 3, down: 4,
            leftAll: null, rightAll: null, upAll: null, downAll: null };
        CsModel.ensureTrips(S);
        var gt1 = CsModel.newTrip();
        gt1.name = "UPPER";
        gt1.date = "2021-05-05";
        gt1.team = "Bob";
        gt1.declination = 3.0;
        gt1.declinationSource = "igrf";
        gt1.distanceUnit = "ft";
        S.trips.push(gt1);
        ok(CsModel.tripFingerprint(S.trips[0]) !==
            CsModel.tripFingerprint(S.trips[1]),
            "gate: the two trips have distinct fingerprints");

        var g0 = shotOf("A1", "A2", 10, 0);        // trip 0, seq 0
        g0.left = 2; g0.right = 3; g0.up = 1; g0.down = 0.5;
        g0.backAzimuth = 180.5;                     // backsight pair
        g0.backInclination = -1;
        var g1 = shotOf("A2", "A3", 10, 90);       // trip 0, seq 1
        g1.notes = "muddy crawl";
        g1.left = 10;
        g1.leftAll = [5, 10];                       // multi-reading side
        var g2 = shotOf("A2", "B1", 8, 45);        // trip 0, seq 2: branch
        var g3 = shotOf("A3", "A4", 10, 180);      // trip 0, seq 3
        var g4 = shotOf("A4", "A1", 10.5, 270);    // trip 0, seq 4: closure
        var g5 = shotOf("X1", "X2", 7, 10);        // trip 0, seq 5: excluded
        g5.excludeFromAll = true;
        g5.notes = "bad shot\nsecond line";         // multi-line note
        var g6 = shotOf("A2", "", 4, 120, -5);     // trip 0, seq 6: splay
        g6.splay = true;
        g6.notes = "to wall";
        g6.backAzimuth = 300;                       // splay backsight
        var g7 = shotOf("Z1", "Z2", 9, 33);        // trip 0, seq 7: unplaced
        var g8 = shotOf("A4", "A5", 8, 45);        // trip 1, seq 0
        g8.trip = 1;
        var g9 = shotOf("A5", "A6", 6, 100);       // trip 1, seq 1: hidden
        g9.trip = 1;
        g9.excludeFromPlot = true;
        var g10 = shotOf("", "", 3, 0);            // trip 1, seq 2: blank
        g10.trip = 1;                               // -- documented loss
        S.shots.push(g0); S.shots.push(g1); S.shots.push(g2);
        S.shots.push(g3); S.shots.push(g4); S.shots.push(g5);
        S.shots.push(g6); S.shots.push(g7); S.shots.push(g8);
        S.shots.push(g9); S.shots.push(g10);
        S.fixed["A1"] = { x: 100, y: 200, z: 5 };

        var gres = CsNetwork.resolve(S, {});
        CsDraw.survey(S, gres);

        // --- reconstruct and deep-compare ---------------------------
        var res = CsRevise.surveyFromDocument(doc);
        ok(res.legacy === false, "gate: v3 reconstruction, not legacy");
        var R = res.survey;

        // documented, accepted loss: the blank-from+to shot vanishes;
        // everything else comes back in (trip, seq) order == S order
        var expected = [g0, g1, g2, g3, g4, g5, g6, g7, g8, g9];
        ok(R.shots.length === expected.length,
            "gate: shot count (blank shot vanished), expected " +
            expected.length + ", got " + R.shots.length);
        for (var gi2 = 0; gi2 < expected.length; gi2++) {
            if (gi2 < R.shots.length) {
                shotsEqual(expected[gi2], R.shots[gi2],
                    "gate shot[" + gi2 + "]");
            }
        }
        var blankBack = false;
        for (gi2 = 0; gi2 < R.shots.length; gi2++) {
            if (R.shots[gi2].from === "" && R.shots[gi2].to === "" &&
                    !R.shots[gi2].splay) {
                blankBack = true;
            }
        }
        ok(blankBack === false,
            "gate: blank from+to shot stays vanished (documented loss)");

        // every trip record, every field
        ok(R.trips.length === 2, "gate: 2 trips reconstructed, got " +
            R.trips.length);
        if (R.trips.length === 2) {
            tripsEqual(S.trips[0], R.trips[0], "gate trip[0]");
            tripsEqual(S.trips[1], R.trips[1], "gate trip[1]");
        }

        // survey.fixed deep equal (same key set, same coordinates)
        var fixedKeysS = [], fixedKeysR = [];
        var fk;
        for (fk in S.fixed) {
            if (S.fixed.hasOwnProperty(fk)) { fixedKeysS.push(fk); }
        }
        for (fk in R.fixed) {
            if (R.fixed.hasOwnProperty(fk)) { fixedKeysR.push(fk); }
        }
        fixedKeysS.sort(); fixedKeysR.sort();
        ok(fixedKeysS.join(",") === fixedKeysR.join(","),
            "gate: fixed key set, expected '" + fixedKeysS.join(",") +
            "', got '" + fixedKeysR.join(",") + "'");
        for (fk in S.fixed) {
            if (S.fixed.hasOwnProperty(fk) && R.fixed[fk] !== undefined) {
                near(R.fixed[fk].x, S.fixed[fk].x, 1e-9, "gate fixed." + fk + ".x");
                near(R.fixed[fk].y, S.fixed[fk].y, 1e-9, "gate fixed." + fk + ".y");
                near(R.fixed[fk].z, S.fixed[fk].z, 1e-9, "gate fixed." + fk + ".z");
            }
        }

        // start data + cave name
        ok(R.startNote === S.startNote, "gate: startNote, got '" +
            R.startNote + "'");
        lrudEqual(S.startLrud, R.startLrud, "gate startLrud");
        ok(R.caveName === S.caveName, "gate: caveName, expected '" +
            S.caveName + "', got '" + R.caveName + "'");

        // anchor = trip-0 anchor station, at its drawn position
        ok(res.anchorName === "A1", "gate: anchorName, got '" +
            res.anchorName + "'");
        ok(res.anchorPos !== null, "gate: anchorPos present");
        if (res.anchorPos !== null) {
            near(res.anchorPos.x, 100, 1e-9, "gate: anchorPos.x");
            near(res.anchorPos.y, 200, 1e-9, "gate: anchorPos.y");
        }
    })();

    // -----------------------------------------------------------------
    // Legacy fallback: a drawing with tagged station points but not a
    // single Distance-tagged leg is pre-v3 -- CsRevise hands it to the
    // legacy chain-guesser and flags it.
    // -----------------------------------------------------------------
    (function() {
        var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var di = new RDocumentInterface(doc);
        getDocument = function() { return doc; };
        getDocumentInterface = function() { return di; };

        CsLayers.ensureSurveyLayers(doc, di);
        var op = new RAddObjectsOperation();
        var p1 = CsDraw.addPoint(doc, op, CsLayers.STATIONS,
            new RVector(0, 0));
        CsTags.tagStation(p1, { name: "L1", seq: 0, azimuth: 0 });
        op.addObject(p1, false);
        var p2 = CsDraw.addPoint(doc, op, CsLayers.STATIONS,
            new RVector(0, 10));
        CsTags.tagStation(p2, { name: "L2", seq: 1, azimuth: 0 });
        op.addObject(p2, false);
        di.applyOperation(op);

        var res = CsRevise.surveyFromDocument(doc);
        ok(res.legacy === true, "legacy: flagged legacy:true");
        ok(res.survey.shots.length === 1,
            "legacy: chain reconstruction returned, got " +
            res.survey.shots.length + " shots");
        if (res.survey.shots.length === 1) {
            near(res.survey.shots[0].distance, 10, 1e-9,
                "legacy: chained shot distance from geometry");
            ok(res.survey.shots[0].from === "L1" &&
                res.survey.shots[0].to === "L2",
                "legacy: chained shot endpoints");
        }
        ok(res.anchorName === "L1", "legacy: anchor falls back to first " +
            "station, got '" + res.anchorName + "'");
        ok(res.anchorPos !== null && Math.abs(res.anchorPos.y) < 1e-9,
            "legacy: anchor position");
    })();
}

// ---------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------

var out;
if (failures.length === 0) {
    out = "### UNIT OK " + passed + " assertions";
} else {
    out = "### UNIT FAIL " + failures.length + " of " +
        (passed + failures.length) + "\n";
    for (var fi = 0; fi < failures.length; fi++) {
        out += "  FAIL: " + failures[fi] + "\n";
    }
}

if (IS_NODE) {
    console.log(out);
    process.exit(failures.length === 0 ? 0 : 1);
} else {
    print(out);
}
