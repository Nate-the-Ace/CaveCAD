// js_unit.js -- unit tests for the Cave Survey Core library.
//
// The Core is pure ECMAScript, so the same tests run two ways:
//
//   inside QCAD's own engine (authoritative -- the engine the add-on
//   really runs in):
//     /Applications/QCAD.app/Contents/Resources/qcad \
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
    "scripts/CaveSurvey/Core/Units.js",
    "scripts/CaveSurvey/Core/Angles.js",
    "scripts/CaveSurvey/Core/IgrfCoeffs.js",
    "scripts/CaveSurvey/Core/Geomag.js",
    "scripts/CaveSurvey/Core/Model.js",
    "scripts/CaveSurvey/Core/Traverse.js",
    "scripts/CaveSurvey/Core/Network.js",
    "scripts/CaveSurvey/Core/Lrud.js",
    "scripts/CaveSurvey/Core/Validate.js",
    "scripts/CaveSurvey/Core/Stats.js",
    "scripts/CaveSurvey/Core/Grade.js",
    "scripts/CaveSurvey/Core/Format/Compass.js",
    "scripts/CaveSurvey/Core/Format/Walls.js",
    "scripts/CaveSurvey/Core/Format/Survex.js",
    "scripts/CaveSurvey/Core/Format/Csv.js",
    "scripts/CaveSurvey/Core/Format/Registry.js"
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
ok(dat.name === "SECRET CAVE", "Compass cave name, got '" + dat.name + "'");
ok(dat.date === "2024-07-10", "Compass survey date, got '" + dat.date + "'");
near(dat.declination, 2.5, 1e-9, "Compass declination recorded");
ok(dat.shots.length === 6, "Compass shot count, got " + dat.shots.length);
near(dat.shots[0].azimuth, 145.0, 1e-9, "Compass declination applied to bearing");
near(dat.shots[0].distance, 15.30, 1e-9, "Compass distance untouched");
// fixture column order is L U D R
near(dat.shots[0].left, 2.10, 1e-9, "Compass LEFT column");
near(dat.shots[0].up, 0.50, 1e-9, "Compass UP column");
near(dat.shots[0].down, 6.20, 1e-9, "Compass DOWN column");
near(dat.shots[0].right, 4.00, 1e-9, "Compass RIGHT column");
var flagged = dat.shots[5];
ok(flagged.excludeFromPlot === true, "Compass #|P# flag");
ok(flagged.excludeFromAll === false, "#|P# still positions");

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
var w56 = null;
for (wi = 0; wi < srv.shots.length; wi++) {
    if (srv.shots[wi].from === "W5" && srv.shots[wi].to === "W6") {
        w56 = srv.shots[wi];
    }
}
ok(w56 !== null && w56.left === null, "Walls -- marker becomes null, not 0");
ok(w56 !== null && w56.right === 2.0, "Walls LRUD beside -- still real");

var svxContent = readTextFile(repoRoot + "/testdata/TestCave_Survex.svx");
var svx = CsFormatSurvex.parse(svxContent);
ok(svx.distanceUnit === "m", "Survex default metres");
ok(svx.shots.length === 5, "Survex shot count, got " + svx.shots.length);
ok(svx.shots[0].from === "TestSurvey.S1", "Survex *begin prefix applied");
ok(svx.fixed.hasOwnProperty("TestSurvey.S1"), "Survex *fix prefixed");
var s23 = svx.shots[1];
near(s23.left, 0.4, 1e-9, "Survex passage LRUD attached to TO station");
near(s23.up, 1.2, 1e-9, "Survex passage UP");

// *calibrate declination -- the defect the old importer shipped with
var calSvx = "*begin C\n*calibrate declination 3.0\n" +
    "*data normal from to tape compass clino\nC1 C2 10.0 90.0 0.0\n*end C\n";
var cal = CsFormatSurvex.parse(calSvx);
near(cal.shots[0].azimuth, 93.0, 1e-9, "Survex *calibrate declination applied");

// grads
var gradSvx = "*units compass grads\n*data normal from to tape compass clino\n" +
    "G1 G2 10.0 200.0 0.0\n";
var grad = CsFormatSurvex.parse(gradSvx);
near(grad.shots[0].azimuth, 180.0, 1e-9, "Survex grads converted");

// CSV
var csvText = "from,to,distance,azimuth,inclination,left,right,up,down,notes\n" +
    "A1,A2,10.5,45,2,1,2,,0.5,first shot\n" +
    "A2,-,3.0,90,0\n";
var csv = CsFormatCsv.parse(csvText);
ok(csv.shots.length === 2, "CSV shot count");
ok(csv.shots[0].up === null, "CSV blank LRUD is null");
ok(csv.shots[0].notes === "first shot", "CSV notes");
ok(csv.shots[1].splay === true, "CSV dash TO is splay");

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
