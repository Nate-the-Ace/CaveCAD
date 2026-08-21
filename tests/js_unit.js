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
    "scripts/CaveSurvey/Core/CsProc.js",
    "scripts/CaveSurvey/Core/CsGit.js",
    "scripts/CaveSurvey/Core/CsHub.js",
    "scripts/CaveSurvey/Core/CsSetup.js",
    "scripts/CaveSurvey/Core/CsGeoProject.js",
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
    "scripts/CaveSurvey/Core/CsRevise.js",
    // after CsRevise: CsBind's layer gate consults
    // CsRevise.isWorldFixedLayer when it is loaded
    "scripts/CaveSurvey/Core/CsBind.js",
    "scripts/CaveSurvey/Core/CsReport.js"
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

var dms = CsAngles.parseLatLon("40 30'15.0\"N 90 15'30.0\"W");
ok(dms !== null, "DMS parses");
near(dms.lat, 40.504167, 1e-4, "DMS latitude");
near(dms.lon, -90.258333, 1e-4, "DMS longitude");
var dec = CsAngles.parseLatLon("40.5042, -90.2583");
ok(dec !== null && Math.abs(dec.lat - 40.5042) < 1e-9, "decimal lat/lon parses");
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
ok(CsModel.tripFingerprint(tsv.trips[0]) === "1998-07-04|NS/JB",
    "trip fingerprint format, got '" + CsModel.tripFingerprint(tsv.trips[0]) + "'");
var t2 = CsModel.newTrip(); t2.date = "1998-07-04"; t2.team = "KL";
ok(CsModel.tripIdFor(tsv, t2) === 1, "different team = new trip id");
ok(CsModel.tripIdFor(tsv, tsv.trips[0]) === 0, "same fingerprint reuses id");
ok(tsv.trips.length === 2, "tripIdFor appended once");

// Declination is REVISABLE, so it is not identity: the same party on
// the same day with a re-measured declination is the SAME trip, and
// the new value takes precedence (Nathan's rule). Nothing is reported,
// because nothing is lost: shots record the declination they were
// computed with, so the merged trip revises exactly (proven for real
// parsed shots in the Compass and Survex merge blocks below).
var tDecl = CsModel.newTrip();
tDecl.date = "1998-07-04"; tDecl.team = "NS/JB"; tDecl.declination = -1.25;
ok(CsModel.tripIdFor(tsv, tDecl) === 0,
    "re-measured declination is the same trip, not a new one");
ok(tsv.trips.length === 2, "tripIdFor did not append for a declination change");
near(tsv.trips[0].declination, -1.25, 1e-12,
    "merged trip records the LAST declination read");
ok(CsModel.parseFindings(tsv).length === 0,
    "a merged declination is no longer a finding, got " +
    JSON.stringify(CsModel.parseFindings(tsv)));

// The parse-findings mechanism itself, which no parser currently feeds
// (see CsModel's header): a recorded finding is deduped by code +
// message, handed out as a copy, and reaches CsValidate.check.
CsModel.addParseFinding(tsv, "warning", "test-finding", "noticed once");
CsModel.addParseFinding(tsv, "warning", "test-finding", "noticed once");
var tFind = CsModel.parseFindings(tsv);
ok(tFind.length === 1 && tFind[0].code === "test-finding" &&
    tFind[0].shotIndex === -1,
    "an identical finding is recorded once, survey-wide, got " +
    JSON.stringify(tFind));
// The findings list a caller gets is a copy: appending to it must not
// grow the survey's own record.
tFind.push({ code: "scribble" });
ok(CsModel.parseFindings(tsv).length === 1,
    "parseFindings hands out a copy");
// CsValidate is the path these reach the import summary by.
var tChecked = CsValidate.check(tsv, null);
var tSeen = false;
for (var tci = 0; tci < tChecked.length; tci++) {
    if (tChecked[tci].code === "test-finding") {
        tSeen = true;
    }
}
ok(tSeen, "parse findings reach CsValidate.check's findings");
CsValidate.check(tsv, null);
ok(CsModel.parseFindings(tsv).length === 1,
    "repeated checks do not accumulate onto the survey's parse findings");

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

// Declination cannot reach the fingerprint at all, so even a garbage
// (non-numeric) one from a bad parse leaves identity intact -- and a
// half-built record with no date or team still fingerprints.
ok(CsModel.tripFingerprint({date: "", declination: "junk", team: ""}) === "|",
    "fingerprint of an empty trip, got '" +
    CsModel.tripFingerprint({date: "", declination: "junk", team: ""}) + "'");
ok(CsModel.tripFingerprint({date: "2020-01-01", declination: "junk",
        team: "Alice"}) ===
    CsModel.tripFingerprint({date: "2020-01-01", declination: -7.5,
        team: "Alice"}),
    "declination -- garbage or good -- cannot change trip identity");
ok(CsModel.tripFingerprint({}) === "|",
    "fingerprint of a record with no fields at all");

// ---------------------------------------------------------------------
// The blank trip 0 ensureTrips has to invent, and who gets to have it.
//
// ensureTrips cannot leave trips empty -- the whole suite reads
// trips[0] -- so a survey with no metadata and no shots gets a blank
// record standing in for a trip nobody has entered yet. That slot is
// the ABSENCE of a trip, and tripIdFor must OCCUPY it rather than
// number past it: a drawing numbered from 1 has no trip-0 anchor, and
// the RevisionLog lives on the trip-0 anchor by schema, so such a
// drawing could never carry a revision history at all.
// ---------------------------------------------------------------------
var ph = CsModel.newSurvey();
CsModel.ensureTrips(ph);
ok(ph.trips.length === 1 && CsModel.tripFingerprint(ph.trips[0]) === "|",
    "placeholder: an empty survey's invented trip 0 fingerprints blank");
ok(CsModel.isPlaceholderTrip(ph, 0) === true,
    "placeholder: blank fingerprint and no shot claiming it = placeholder");
var phPage = CsModel.newTrip();
phPage.date = "2026-08-21"; phPage.team = "NS"; phPage.declination = -3.5;
phPage.declinationSource = "user";
ok(CsModel.tripIdFor(ph, phPage) === 0,
    "placeholder: the first real trip TAKES slot 0, it does not append");
ok(ph.trips.length === 1 && ph.trips[0] === phPage,
    "placeholder: and the slot now holds that very record, got " +
    ph.trips.length + " trips");
// ensureTrips mirrors trips[0] up to the top-level fields, and it ran
// against the placeholder on the way in -- so occupying the slot has
// to re-mirror or survey.date/team keep describing the empty slot.
ok(ph.date === "2026-08-21" && ph.team === "NS" &&
        ph.declination === -3.5,
    "placeholder: the top-level mirror describes the real trip, not " +
    "the slot it replaced -- got '" + ph.date + "|" + ph.team + "'");
ok(CsModel.isPlaceholderTrip(ph, 0) === false,
    "placeholder: an occupied slot is no longer a placeholder");
var phSecond = CsModel.newTrip();
phSecond.date = "2026-08-22"; phSecond.team = "JB";
ok(CsModel.tripIdFor(ph, phSecond) === 1,
    "placeholder: the NEXT different trip appends as 1, as always");

// A real trip may legitimately have no date and no team -- an undated
// page, an unattributed block -- and its slot is NOT up for grabs.
// Shots claiming it are what tells the two apart; stealing it would
// merge two different parties' work under one record.
var phReal = CsModel.newSurvey();
phReal.shots.push(shotOf("N1", "N2", 10, 45));
CsModel.ensureTrips(phReal);
ok(CsModel.tripFingerprint(phReal.trips[0]) === "|" &&
        phReal.shots[0].trip === 0,
    "placeholder: a nameless trip WITH shots still fingerprints blank");
ok(CsModel.isPlaceholderTrip(phReal, 0) === false,
    "placeholder: shots claiming the slot make it a real trip");
var phRealTrip0 = phReal.trips[0];
var phIntruder = CsModel.newTrip();
phIntruder.date = "2026-08-21"; phIntruder.team = "NS";
ok(CsModel.tripIdFor(phReal, phIntruder) === 1,
    "placeholder: a new page cannot displace a nameless trip that has " +
    "shots -- it appends");
ok(phReal.trips[0] === phRealTrip0 && phReal.shots[0].trip === 0,
    "placeholder: the nameless trip keeps its slot and its shots");
// and an equally nameless incoming record still MATCHES it by
// fingerprint, which is the existing identity rule untouched
ok(CsModel.tripIdFor(phReal, CsModel.newTrip()) === 0,
    "placeholder: a blank incoming record is still the blank trip");
ok(CsModel.isPlaceholderTrip(phReal, 7) === false,
    "placeholder: a trip index that does not exist is not a placeholder");

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
// fingerprint (date|team), every shot gets shot.trip, and writers
// un-apply each shot's OWN trip's declination.
// ---------------------------------------------------------------------

// FIXTURE GATE: FingerprintCave.dat has 3 Compass blocks and must
// still read as 3 trips under date|team identity -- ENT and MID share
// 1998-07-04 and are kept apart by TEAM alone, LOOP is a different
// DATE. (Its re-measured declination no longer separates anything, so
// team and date are carrying the whole gate.) The three tie back into
// a loop that only closes once trips 0 and 1's declination is revised.
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

// Fingerprint MERGE: two Compass blocks sharing date and team (but
// different SURVEY NAME labels, which aren't part of the fingerprint)
// collapse into ONE trip.
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
ok(CsModel.parseFindings(merged).length === 0,
    "Compass fingerprint merge: nothing to report when the declinations agree");

// MIXED merge: the same two blocks a declination apart. Still one trip
// (date and team are identity), each shot carrying the TRUE azimuth its
// OWN block's declination produced AND recording that declination, the
// trip recording the LAST one read. Nothing is reported because
// nothing is lost -- proven below by revising the merged trip and
// finding every shot exact.
var lossyDat =
    "SURVEY NAME: X\r\nSURVEY DATE: 1 1 2020\r\nSURVEY TEAM:\r\n" +
    "A. One, B. Two\r\nDECLINATION: 1.00  FORMAT: DDDDLUDRLADN\r\n\r\n" +
    "FROM TO LENGTH BEARING INC LEFT UP DOWN RIGHT\r\n\r\n" +
    "A1 A2 10.0 0.0 0.0 1.0 1.0 1.0 1.0\r\n\f\r\n" +
    "SURVEY NAME: Y\r\nSURVEY DATE: 1 1 2020\r\nSURVEY TEAM:\r\n" +
    "A. One, B. Two\r\nDECLINATION: 4.00  FORMAT: DDDDLUDRLADN\r\n\r\n" +
    "FROM TO LENGTH BEARING INC LEFT UP DOWN RIGHT\r\n\r\n" +
    "B1 B2 10.0 0.0 0.0 1.0 1.0 1.0 1.0\r\n\f\r\n";
var lossy = CsFormatCompass.parse(lossyDat);
ok(lossy.trips.length === 1, "Compass lossy merge: 1 trip, got " +
    lossy.trips.length);
near(lossy.shots[0].azimuth, 1.0, 1e-9,
    "Compass lossy merge: block 1's shot keeps its own declination's true azimuth");
near(lossy.shots[1].azimuth, 4.0, 1e-9,
    "Compass lossy merge: block 2's shot keeps its own declination's true azimuth");
near(lossy.trips[0].declination, 4.0, 1e-9,
    "Compass lossy merge: trip records the last declination read");
near(lossy.declination, 4.0, 1e-9,
    "Compass lossy merge: top level mirrors the merged trip");
// Each shot's PROVENANCE: the declination the parser actually added to
// its magnetic reading, kept per shot so the merge costs nothing.
near(lossy.shots[0].declination, 1.0, 1e-9,
    "Compass mixed merge: shot 1 records block 1's declination");
near(lossy.shots[1].declination, 4.0, 1e-9,
    "Compass mixed merge: shot 2 records block 2's declination");
ok(CsModel.parseFindings(lossy).length === 0,
    "Compass mixed merge: nothing to report -- the merge is lossless, got " +
    JSON.stringify(CsModel.parseFindings(lossy)));

// The proof: revise the merged trip to a THIRD value. Both blocks read
// 0.00 magnetic, so every true azimuth must land on the new
// declination exactly -- the case that was provably off by 3 deg for
// block 1's shot when only the trip remembered a declination.
var lossyRev = CsFormatCompass.parse(lossyDat);
var lossyRd = CsRevise.reviseDeclination(lossyRev, 0, -1.5, "igrf");
near(lossyRev.shots[0].azimuth, 358.5, 1e-9,
    "Compass mixed merge revised: shot 1 exact (magnetic 0 + -1.5)");
near(lossyRev.shots[1].azimuth, 358.5, 1e-9,
    "Compass mixed merge revised: shot 2 exact (magnetic 0 + -1.5)");
near(lossyRev.shots[0].declination, -1.5, 1e-9,
    "Compass mixed merge revised: shot 1 provenance is the new value");
near(lossyRev.shots[1].declination, -1.5, 1e-9,
    "Compass mixed merge revised: shot 2 provenance is the new value");
ok(lossyRd.mixed === true && lossyRd.diverged === 1,
    "Compass mixed merge revised: the return says one shot diverged, got " +
    JSON.stringify(lossyRd));

// A merged trip writes back out as the two blocks it came in as -- one
// DECLINATION per block is all Compass can declare, so each group gets
// its own -- and re-reading reproduces every TRUE azimuth AND its
// provenance.
var lossyWritten = CsFormatCompass.write(lossy);
ok(lossyWritten.split("\f").length - 1 === 2,
    "Compass mixed merge write: two blocks, got " +
    (lossyWritten.split("\f").length - 1));
ok(/DECLINATION: 1\.00/.test(lossyWritten) &&
    /DECLINATION: 4\.00/.test(lossyWritten),
    "Compass mixed merge write: both declinations declared");
var lossyRt = CsFormatCompass.parse(lossyWritten);
ok(lossyRt.trips.length === 1, "Compass mixed merge round trip: still 1 trip");
near(CsAngles.azimuthDifference(lossyRt.shots[0].azimuth, 1.0), 0, 1e-6,
    "Compass mixed merge round trip: shot 1 TRUE azimuth preserved");
near(CsAngles.azimuthDifference(lossyRt.shots[1].azimuth, 4.0), 0, 1e-6,
    "Compass mixed merge round trip: shot 2 TRUE azimuth preserved");
near(lossyRt.shots[0].declination, 1.0, 1e-9,
    "Compass mixed merge round trip: shot 1 provenance preserved");
near(lossyRt.shots[1].declination, 4.0, 1e-9,
    "Compass mixed merge round trip: shot 2 provenance preserved");

// Team, not declination, is what keeps two same-day blocks apart now.
var teamSplitDat =
    "SURVEY NAME: X\r\nSURVEY DATE: 1 1 2020\r\nSURVEY TEAM:\r\n" +
    "A. One\r\nDECLINATION: 1.00  FORMAT: DDDDLUDRLADN\r\n\r\n" +
    "FROM TO LENGTH BEARING INC LEFT UP DOWN RIGHT\r\n\r\n" +
    "A1 A2 10.0 0.0 0.0 1.0 1.0 1.0 1.0\r\n\f\r\n" +
    "SURVEY NAME: Y\r\nSURVEY DATE: 1 1 2020\r\nSURVEY TEAM:\r\n" +
    "B. Two\r\nDECLINATION: 1.00  FORMAT: DDDDLUDRLADN\r\n\r\n" +
    "FROM TO LENGTH BEARING INC LEFT UP DOWN RIGHT\r\n\r\n" +
    "B1 B2 10.0 0.0 0.0 1.0 1.0 1.0 1.0\r\n\f\r\n";
var teamSplit = CsFormatCompass.parse(teamSplitDat);
ok(teamSplit.trips.length === 2, "Compass: differing team = 2 trips, got " +
    teamSplit.trips.length);
ok(teamSplit.shots[0].trip === 0 && teamSplit.shots[1].trip === 1,
    "Compass: each team's shot on its own trip");

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

// Survex per-leg trip attribution: a *date change mid-file starts a
// new trip (the *calibrate beside it does not -- declination is not
// identity), and each leg's declination un-apply on write uses ITS OWN
// trip, not a single survey-wide value.
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

// A bare *declination change -- no *date, no *team -- is a correction
// to one trip, not a second trip: the legs merge, each keeping the
// true azimuth it was read under and recording the declination in
// force where it appeared, so the merge is lossless and silent.
var svxDeclOnlySrc =
    "*data normal from to tape compass clino\r\n" +
    "*date 2020-01-01\r\n*declination 2.0\r\n" +
    "D1 D2 10.0 90.0 0.0\r\n" +
    "*declination 5.0\r\n" +
    "D2 D3 10.0 90.0 0.0\r\n" +
    "D3 D4 10.0 90.0 0.0\r\n";
var svxDeclOnly = CsFormatSurvex.parse(svxDeclOnlySrc);
ok(svxDeclOnly.trips.length === 1,
    "Survex: a declination change alone does not fork a trip, got " +
    svxDeclOnly.trips.length);
near(svxDeclOnly.shots[0].azimuth, 92.0, 1e-9,
    "Survex declination-only merge: leg 1 keeps its own true azimuth");
near(svxDeclOnly.shots[2].azimuth, 95.0, 1e-9,
    "Survex declination-only merge: leg 3 keeps its own true azimuth");
near(svxDeclOnly.shots[0].declination, 2.0, 1e-9,
    "Survex declination-only merge: leg 1 records the value in force at it");
near(svxDeclOnly.shots[2].declination, 5.0, 1e-9,
    "Survex declination-only merge: leg 3 records the later value");
near(svxDeclOnly.trips[0].declination, 5.0, 1e-9,
    "Survex declination-only merge: trip records the last value read");
ok(CsModel.parseFindings(svxDeclOnly).length === 0,
    "Survex declination-only merge: nothing to report, got " +
    CsModel.parseFindings(svxDeclOnly).length);
// Revising that one trip is exact for both groups: every leg read 90.0
// magnetic, so every true azimuth lands on 90 + the new value.
var svxDeclRev = CsFormatSurvex.parse(svxDeclOnlySrc);
var svxDeclRd = CsRevise.reviseDeclination(svxDeclRev, 0, -1.0, "user");
near(svxDeclRev.shots[0].azimuth, 89.0, 1e-9,
    "Survex mixed trip revised: leg 1 exact (magnetic 90 + -1)");
near(svxDeclRev.shots[2].azimuth, 89.0, 1e-9,
    "Survex mixed trip revised: leg 3 exact (magnetic 90 + -1)");
ok(svxDeclRd.diverged === 1,
    "Survex mixed trip revised: one leg diverged from the trip's value, got " +
    svxDeclRd.diverged);
// and it goes back out declaring both values where they change
var svxDeclWritten = CsFormatSurvex.write(svxDeclOnly);
ok(/\*declination 2\.00 degrees/.test(svxDeclWritten) &&
    /\*declination 5\.00 degrees/.test(svxDeclWritten),
    "Survex mixed trip write: both declinations declared mid-trip");
var svxDeclRt = CsFormatSurvex.parse(svxDeclWritten);
near(svxDeclRt.shots[0].azimuth, 92.0, 1e-9,
    "Survex mixed trip round trip: leg 1 TRUE azimuth preserved");
near(svxDeclRt.shots[2].azimuth, 95.0, 1e-9,
    "Survex mixed trip round trip: leg 3 TRUE azimuth preserved");
near(svxDeclRt.shots[0].declination, 2.0, 1e-9,
    "Survex mixed trip round trip: leg 1 provenance preserved");

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
    ok(rd.mixed === false && rd.diverged === 0,
        "reviseDeclination: no shot recorded its own value, nothing diverged");
    ok(sv.shots[0].declination === 3.0 && sv.shots[1].declination === 3.0,
        "reviseDeclination: every revised shot now records the new value");
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

    // a shot carrying its own DIFFERENT declination is revised off
    // THAT, while the ones already at the trip's value move by the
    // trip delta -- one revision, two deltas, both exact
    var own = shotOf("R3", "R4", 10, 100);
    own.declination = -2.0;         // trip 0 now records 3.0
    own.trip = 0;
    sv.shots.push(own);
    var rdMixed = CsRevise.reviseDeclination(sv, 0, 5.0);
    near(sv.shots[4].azimuth, 107.0, 1e-9,
        "reviseDeclination: own-declination shot moves by 5 - (-2)");
    near(sv.shots[0].azimuth, 3.0, 1e-9,
        "reviseDeclination: null-declination shot still moves by 5 - 3");
    ok(rdMixed.mixed === true && rdMixed.diverged === 1,
        "reviseDeclination: the return names the one divergent shot, got " +
        JSON.stringify(rdMixed));
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

// --- revision summary: the plain-language report of an applied revision
(function() {
    var rigidText = CsReport.revisionSummary({
        rigid: true,
        moved: [{ name: "A5", dist: 1.234 }, { name: "A4", dist: 0.9 }],
        stationsChanged: 2,
        loopsBefore: [{ from: "A4", to: "A1", error: 0.52, percent: 1.3 }],
        loopsAfter: [{ from: "A4", to: "A1", error: 0.31, percent: 0.77 }]
    });
    ok(rigidText.indexOf("rigid") >= 0,
        "revisionSummary: rigid wording, got '" + rigidText + "'");
    ok(rigidText.indexOf("Stations moved: 2") >= 0,
        "revisionSummary: stations-moved count");
    ok(rigidText.indexOf("A5: 1.23") >= 0,
        "revisionSummary: top mover with 2dp distance");
    ok(rigidText.indexOf("0.52 -> 0.31") >= 0,
        "revisionSummary: loop error before -> after");
    ok(rigidText.indexOf("WARNING") < 0,
        "revisionSummary: no re-trace warning on a rigid move");

    var manyMoved = [];
    for (var i = 0; i < 6; i++) {
        manyMoved.push({ name: "F" + (i + 1), dist: 6 - i });
    }
    var redrawText = CsReport.revisionSummary({
        rigid: false,
        moved: manyMoved,
        stationsChanged: 6,
        loopsBefore: [],
        loopsAfter: []
    });
    ok(redrawText.indexOf("erased and redrawn") >= 0,
        "revisionSummary: redraw wording");
    ok(redrawText.indexOf("WARNING") >= 0 &&
        redrawText.indexOf("re-trace") >= 0,
        "revisionSummary: redraw warns about hand-drawn linework");
    ok(redrawText.indexOf("F5") >= 0 && redrawText.indexOf("F6") < 0,
        "revisionSummary: top 5 movers listed, the 6th not");
    // an older caller's report has no linework fields at all: the
    // summary must still read as it always did, not print "undefined"
    ok(redrawText.indexOf("undefined") < 0,
        "revisionSummary: a report without linework fields prints no " +
        "'undefined', got '" + redrawText + "'");
    ok(redrawText.indexOf("Traced linework moved with its stations: 0") >= 0,
        "revisionSummary: missing linework fields count as nothing bound");

    // BOTH halves get stated: what followed the survey, and what did not
    var lwUnmoved = [];
    for (i = 0; i < CsReport.UNMOVED_SHOWN + 3; i++) {
        lwUnmoved.push("WALLS-SURVEYED #" + (100 + i));
    }
    var lwText = CsReport.revisionSummary({
        rigid: false,
        moved: [{ name: "G1", dist: 2 }],
        stationsChanged: 1,
        loopsBefore: [], loopsAfter: [],
        lineworkMoved: 7,
        lineworkUnmoved: lwUnmoved
    });
    ok(lwText.indexOf("Traced linework moved with its stations: 7") >= 0,
        "revisionSummary: states how much linework followed its stations");
    ok(lwText.indexOf("3 more") >= 0,
        "revisionSummary: the unmoved list is capped for display, got '" +
        lwText + "'");
    ok(lwText.indexOf("WALLS-SURVEYED #100") >= 0 &&
        lwText.indexOf("WALLS-SURVEYED #" +
            (100 + CsReport.UNMOVED_SHOWN)) < 0,
        "revisionSummary: names the first UNMOVED_SHOWN unmoved items only");
    ok(lwText.indexOf("re-trace") >= 0,
        "revisionSummary: unmoved linework still gets the re-trace advice");
    // ... and with everything moved there is nothing left to warn about
    var lwAllText = CsReport.revisionSummary({
        rigid: false,
        moved: [{ name: "G1", dist: 2 }],
        stationsChanged: 1,
        loopsBefore: [], loopsAfter: [],
        lineworkMoved: 4,
        lineworkUnmoved: []
    });
    ok(lwAllText.indexOf("Traced linework moved with its stations: 4") >= 0,
        "revisionSummary: all-moved count stated");
    ok(lwAllText.indexOf("re-trace") < 0,
        "revisionSummary: no re-trace warning when all linework followed, " +
        "got '" + lwAllText + "'");
    // the singular reads as English
    var lwOneText = CsReport.revisionSummary({
        rigid: false, moved: [], stationsChanged: 0,
        loopsBefore: [], loopsAfter: [],
        lineworkMoved: 1, lineworkUnmoved: ["BREAKDOWN #9"]
    });
    ok(lwOneText.indexOf("1 traced item had") >= 0,
        "revisionSummary: one unmoved item is singular, got '" +
        lwOneText + "'");
})();

// --- ONE vocabulary for the linework outcome, two callers ------------
// CsRevise.apply reports through CsReport.revisionSummary; the Survey
// Notebook's Draw has no report object to hand and reports through
// CsRevise.lineworkSummary. The user must not be able to tell which
// path moved their walls, so the two say it in the same words -- and
// this asserts that, so a drift in either one fails the build rather
// than shipping two dialects of the same fact.
(function() {
    var cases = [[0, []], [3, []], [1, ["WALLS-SURVEYED #12"]],
        [2, ["A #1", "B #2", "C #3", "D #4", "E #5", "F #6", "G #7",
            "H #8", "I #9", "J #10"]]];
    for (var ci = 0; ci < cases.length; ci++) {
        var lines = CsRevise.lineworkSummary(cases[ci][0], cases[ci][1]);
        var full = CsReport.revisionSummary({
            rigid: false, moved: [], stationsChanged: 0,
            loopsBefore: [], loopsAfter: [],
            lineworkMoved: cases[ci][0], lineworkUnmoved: cases[ci][1]
        });
        ok(full.indexOf(lines.join("\n")) >= 0,
            "lineworkSummary: case " + ci + " reads word for word as " +
            "revisionSummary's, got '" + lines.join(" / ") + "'");
    }
    // absent counts as nothing bound, same as revisionSummary treats it
    ok(CsRevise.lineworkSummary(null, null).join("\n").indexOf(
        "not bound") >= 0,
        "lineworkSummary: missing fields read as nothing bound");
})();

// --- ONE shape for the RevisionLog, two writers ----------------------
// CsRevise.apply and the Survey Notebook's Draw both append to the same
// log on the same anchor. The rules asserted here are what make a mixed
// history readable months later: entries are separated by exactly one
// newline, the earlier log is carried over VERBATIM, and nothing to say
// leaves the value untouched -- which is also how a caller signals "no
// op" to itself, since the value it would commit simply does not differ.
(function() {
    ok(CsRevise.appendLog("", ["a"]) === "a",
        "appendLog: the first entry has nothing to sit under, got '" +
        CsRevise.appendLog("", ["a"]) + "'");
    ok(CsRevise.appendLog("a", ["b"]) === "a\nb",
        "appendLog: one newline between entries, got '" +
        CsRevise.appendLog("a", ["b"]) + "'");
    ok(CsRevise.appendLog("a\nb", ["c", "  d"]) === "a\nb\nc\n  d",
        "appendLog: several new lines land in order under the old ones");
    // append-only: history can be added to, never edited
    var old = "trip 0 declination 2 -> 6 (igrf)\ntrip 1 was here";
    ok(CsRevise.appendLog(old, ["new"]).indexOf(old) === 0,
        "appendLog: the existing log is preserved byte for byte, never " +
        "replaced, got '" + CsRevise.appendLog(old, ["new"]) + "'");
    // nothing to say -> nothing changes, so there is nothing to commit
    ok(CsRevise.appendLog(old, []) === old,
        "appendLog: no lines returns the old log unchanged (a no-op Draw " +
        "writes nothing)");
    ok(CsRevise.appendLog("", []) === "",
        "appendLog: no history and no lines is still no log");
    ok(CsRevise.appendLog(null, null) === "",
        "appendLog: missing arguments are not a reason to throw");
})();

// --- the argument prep moveLinework's two callers share --------------
(function() {
    near(CsRevise.positionsExtent({ A: { x: 0, y: 0, z: 0 },
        B: { x: 3, y: 4, z: 12 } }), 13, 1e-12,
        "positionsExtent: 3D bounding-box diagonal");
    near(CsRevise.positionsExtent({ A: { x: 0, y: 0 },
        B: { x: 3, y: 4 } }), 5, 1e-12,
        "positionsExtent: a map without z measures in plan");
    ok(CsRevise.positionsExtent({}) === 0.0,
        "positionsExtent: nothing to measure -> 0");

    // the notebook's gate: did the redraw actually move anything?
    var was = { A: { x: 0, y: 0 }, B: { x: 100, y: 0 },
        C: { x: 0, y: 100 } };
    var now = { A: { x: 0, y: 0 }, B: { x: 100.5, y: 0 },
        D: { x: 7, y: 7 } };
    ok(CsRevise.positionsMoved(was, now, 100) === 1,
        "positionsMoved: only stations in BOTH frames count, and only " +
        "the ones that moved");
    ok(CsRevise.positionsMoved(was, was, 100) === 0,
        "positionsMoved: an untouched frame moved nothing");
    // eps scales with the drawing, so feet and metres decide alike
    var tiny = { A: { x: 0, y: 0 } };
    var tinier = { A: { x: 1e-5, y: 0 } };
    ok(CsRevise.positionsMoved(tiny, tinier, 1) === 1 &&
        CsRevise.positionsMoved(tiny, tinier, 1e6) === 0,
        "positionsMoved: 'moved at all' is relative to the drawing size");

    var tsv = CsModel.newSurvey();
    tsv.shots.push(shotOf("T1", "T2", 10, 0));
    var tsSplay = shotOf("T2", "", 3, 90);
    tsSplay.splay = true;
    tsSplay.trip = 1;
    tsv.shots.push(tsSplay);
    var tsUpper = shotOf("T2", "T3", 10, 90);
    tsUpper.trip = 1;
    tsv.shots.push(tsUpper);
    var tsNames = CsRevise.tripStationNames(tsv);
    ok(tsNames[0].join(",") === "T1,T2",
        "tripStationNames: trip 0's own stations, got " + tsNames[0]);
    ok(tsNames[1].join(",") === "T2,,T2,T3",
        "tripStationNames: trip 1's, a splay's blank 'to' included -- " +
        "moveLinework's pair builder drops the blanks, got " + tsNames[1]);
    ok(CsRevise.tripStationNames(null)[0] === undefined,
        "tripStationNames: no survey -> nothing to fall back on");
})();

// --- the linework residual threshold: relative, and looser than the
// --- rigidity eps for a documented reason ----------------------------
(function() {
    ok(typeof CsRevise.LINEWORK_RESIDUAL_FRACTION === "number" &&
        CsRevise.LINEWORK_RESIDUAL_FRACTION > 1e-6,
        "linework tol: a relative fraction, looser than the rigidity eps");
    // the discrimination it exists for: a fit over stations that all
    // rotated as one body is exact, a fit over stations that bent is not
    var rigidPairs = [];
    var bentPairs = [];
    var th = 10 * Math.PI / 180;
    for (var i = 0; i < 4; i++) {
        var p = { x: i * 10, y: 0 };
        var r = { x: Math.cos(th) * p.x - Math.sin(th) * p.y,
            y: Math.sin(th) * p.x + Math.cos(th) * p.y };
        rigidPairs.push({ old: p, nu: r });
        // only the far half rotates: the passage bent in the middle
        bentPairs.push({ old: p, nu: i < 2 ? p : r });
    }
    var rigidFit = CsRevise.similarityFit(rigidPairs);
    var bentFit = CsRevise.similarityFit(bentPairs);
    var tol = CsRevise.LINEWORK_RESIDUAL_FRACTION * 30;
    ok(rigidFit.maxResidual <= tol,
        "linework tol: a rigidly-rotated station set fits inside it, got " +
        rigidFit.maxResidual);
    ok(bentFit.maxResidual > tol,
        "linework tol: a bent station set does not, got " +
        bentFit.maxResidual);
    // two stations always fit exactly -- which is why the threshold
    // only ever bites at three or more
    var twoFit = CsRevise.similarityFit([
        { old: { x: 0, y: 0 }, nu: { x: 5, y: 5 } },
        { old: { x: 10, y: 0 }, nu: { x: 5, y: 15 } }
    ]);
    near(twoFit.maxResidual, 0, 1e-12,
        "linework tol: a two-station fit is always exact");
})();

// ---------------------------------------------------------------------
// CsBind -- the pure half of linework binding: the layer gate, suffix
// stripping, coincidence/proximity over a station index, tag encoding.
// No document access, so these run under node too.
// ---------------------------------------------------------------------

(function() {
    ok(CsBind.TRIP_TAG === "LineworkTrip", "bind: trip tag name");
    ok(CsBind.STATIONS_TAG === "LineworkStations", "bind: stations tag name");

    // ---- the layer gate: the single decision about what may be
    // tagged or moved at all. Default is NO. ----
    ok(CsBind.isLineworkLayer("WALLS-SURVEYED") === true,
        "gate: a feature layer is linework");
    ok(CsBind.isLineworkLayer("BREAKDOWN") === true,
        "gate: BREAKDOWN is linework");
    ok(CsBind.isLineworkLayer("CTRL-SHOTS") === false,
        "gate: CTRL-SHOTS is the suite's own geometry");
    ok(CsBind.isLineworkLayer("CTRL-AERIAL") === false,
        "gate: CTRL-AERIAL is world-fixed");
    ok(CsBind.isLineworkLayer("CTRL-LRUD-WALL-LEFT") === false,
        "gate: generated wall runs are never linework");
    ok(CsBind.isLineworkLayer("TB_BORDER") === false,
        "gate: TB_ sheet furniture is never linework");
    // The sheet furniture the NSS template names WITHOUT a TB_ prefix.
    // NORTH-ARROW is the one that must never be got wrong: a
    // declination revision rotates the cave relative to true north, so
    // an arrow bound to the survey would turn with it and the map would
    // then lie about its own orientation.
    ok(CsBind.isLineworkLayer("NORTH-ARROW") === false,
        "gate: a hand-drawn north arrow is sheet furniture, not linework");
    ok(CsBind.isLineworkLayer("SCALE-BAR") === false,
        "gate: SCALE-BAR is sheet furniture");
    ok(CsBind.isLineworkLayer("TITLE-BLOCK") === false,
        "gate: TITLE-BLOCK is sheet furniture");
    ok(CsBind.isLineworkLayer("LEGEND") === false,
        "gate: LEGEND is sheet furniture");
    ok(CsBind.isLineworkLayer("BORDER") === false,
        "gate: BORDER is sheet furniture");
    ok(CsBind.isLineworkLayer("") === false, "gate: empty layer name refused");
    ok(CsBind.isLineworkLayer(null) === false, "gate: null layer name refused");
    // whatever CsRevise refuses to move, this refuses to claim
    for (var wf = 0; wf < CsRevise.WORLD_FIXED_LAYERS.length; wf++) {
        var pat = CsRevise.WORLD_FIXED_LAYERS[wf];
        var sample = pat.charAt(pat.length - 1) === "*" ?
            pat.substring(0, pat.length - 1) + "SAMPLE" : pat;
        ok(CsBind.isLineworkLayer(sample) === false,
            "gate: world-fixed layer " + sample + " refused");
    }

    // ---- suffix stripping: LRUD tips, multi-reading LRUD tips and
    // splay tips all reduce to their station ----
    ok(CsBind.lrudBase("A3.L") === "A3", "suffix: A3.L -> A3");
    ok(CsBind.lrudBase("A3.R") === "A3", "suffix: A3.R -> A3");
    ok(CsBind.lrudBase("A3.L2") === "A3", "suffix: A3.L2 -> A3");
    ok(CsBind.lrudBase("A3.R12") === "A3", "suffix: A3.R12 -> A3");
    ok(CsBind.lrudBase("A3") === "A3", "suffix: bare name unchanged");
    ok(CsBind.splayBase("A3.2") === "A3", "suffix: splay A3.2 -> A3");
    ok(CsBind.splayBase("A3") === "A3", "suffix: bare splay name unchanged");
    ok(CsBind.stationBase("A3.L") === "A3", "suffix: stationBase LRUD tip");
    ok(CsBind.stationBase("A3.L2") === "A3", "suffix: stationBase LRUD ledge");
    ok(CsBind.stationBase("A3.2") === "A3", "suffix: stationBase splay tip");
    ok(CsBind.stationBase("A3") === "A3", "suffix: stationBase passthrough");
    // a station legitimately named with a dot must not be mangled
    ok(CsBind.stationBase("BS.7A") === "BS.7A",
        "suffix: a dotted station name that is no tip is left alone");

    // ---- encode/decode round-trip ----
    ok(CsBind.encodeStations(["A1", "A2", "A3"]) === "A1|A2|A3",
        "encode: joins with |");
    ok(CsBind.encodeStations(["A1", "A1", "A2", ""]) === "A1|A2",
        "encode: duplicates collapse, empties dropped");
    ok(CsBind.encodeStations([]) === "", "encode: empty list -> empty text");
    ok(CsBind.encodeStations(null) === "", "encode: null -> empty text");
    ok(CsBind.decodeStations("").length === 0, "decode: empty text -> no names");
    ok(CsBind.decodeStations(null).length === 0, "decode: null -> no names");
    var rt = ["BIG ROOM 1", "A2", "SUMP 3"];
    var rtBack = CsBind.decodeStations(CsBind.encodeStations(rt));
    ok(rtBack.join(",") === rt.join(","),
        "encode/decode: round-trip keeps a name containing a space, got '" +
        rtBack.join(",") + "'");

    // ---- coincidence over a station index ----
    // three stations 10 apart, each carrying an LRUD tip 2 out: the
    // shape a drawn survey really leaves behind
    var idx = [
        { name: "A1", x: 0, y: 0 },
        { name: "A2", x: 0, y: 10 },
        { name: "A2", x: -2, y: 10 },  // its LRUD tip, same name
        { name: "A3", x: 0, y: 20 },
        { name: "A3", x: -2, y: 20 }
    ];
    var hit = CsBind.stationsForPoints([{ x: -2, y: 10 }, { x: 0, y: 20 }],
        idx, 1e-6);
    ok(hit.join(",") === "A2,A3",
        "coincide: two snapped vertices bind two stations, got '" +
        hit.join(",") + "'");
    var inside = CsBind.stationsForPoints([{ x: 0.0000005, y: 10 }], idx, 1e-6);
    ok(inside.join(",") === "A2", "coincide: within epsilon hits");
    var outside = CsBind.stationsForPoints([{ x: 0.01, y: 10 }], idx, 1e-6);
    ok(outside.length === 0, "coincide: outside epsilon misses");
    // the same station reached twice (both its LRUD tips) is one name
    var dup = CsBind.stationsForPoints([{ x: 0, y: 10 }, { x: -2, y: 10 }],
        idx, 1e-6);
    ok(dup.join(",") === "A2", "coincide: duplicate names collapse, got '" +
        dup.join(",") + "'");
    ok(CsBind.stationsForPoints([], idx, 1e-6).length === 0,
        "coincide: no points -> no stations");
    ok(CsBind.stationsForPoints([{ x: 0, y: 0 }], [], 1e-6).length === 0,
        "coincide: empty index -> no stations");
    ok(CsBind.stationsForPoints(null, null, 1e-6).length === 0,
        "coincide: null inputs -> no stations");

    // ---- proximity over a box ----
    var box = { minX: 1, minY: 9, maxX: 2, maxY: 11 };
    ok(CsBind.stationsInBox(box, idx, 0).length === 0,
        "box: nothing inside the bare box");
    var nearHits = CsBind.stationsInBox(box, idx, 1.5);
    ok(nearHits.join(",") === "A2", "box: margin reaches A2, got '" +
        nearHits.join(",") + "'");
    var wide = CsBind.stationsInBox(box, idx, 11);
    ok(wide.join(",") === "A1,A2,A3",
        "box: a wide margin reaches all three, got '" + wide.join(",") + "'");
    ok(CsBind.stationsInBox(null, idx, 1).length === 0,
        "box: null box -> no stations");
    ok(CsBind.boxOfPoints([]) === null, "box: no points -> null box");
    var bp = CsBind.boxOfPoints([{ x: 3, y: -1 }, { x: -2, y: 4 }]);
    ok(bp !== null && bp.minX === -2 && bp.maxX === 3 && bp.minY === -1 &&
        bp.maxY === 4, "box: boxOfPoints spans the points");

    // ---- the margin is read off the drawing's own feature spacing,
    // so metres and feet give proportionally identical answers ----
    near(CsBind.marginFor(idx), 2 * CsBind.PROXIMITY_FACTOR, 1e-9,
        "margin: median nearest-neighbour spacing times the factor");
    var idxFt = [];
    for (var fi = 0; fi < idx.length; fi++) {
        idxFt.push({ name: idx[fi].name, x: idx[fi].x * 3.280839895,
            y: idx[fi].y * 3.280839895 });
    }
    near(CsBind.marginFor(idxFt), CsBind.marginFor(idx) * 3.280839895, 1e-6,
        "margin: scales with the drawing's units");
    ok(CsBind.marginFor([]) === 0, "margin: empty index -> 0");
    ok(CsBind.marginFor([{ name: "A1", x: 0, y: 0 }]) === 0,
        "margin: one station -> 0");
})();

// ---------------------------------------------------------------------
// Trip INFERENCE -- the answer that replaced arming. Pure, so it runs
// under node too.
//
// The map's shape is CsRevise.tripStationNames': one entry per trip,
// station names repeated per shot, a splay's blank "to" included.
// ---------------------------------------------------------------------

(function() {
    // trip 0: A1-A2-A3(junction); trip 1: A3-A4-A5 plus a splay
    var ts = { 0: ["A1", "A2", "A2", "A3"], 1: ["A3", "A4", "A4", "A5", ""] };
    var by = CsBind.tripsByStation(ts);
    ok(by["A1"].join(",") === "0", "tripsByStation: A1 is trip 0 only");
    ok(by["A5"].join(",") === "1", "tripsByStation: A5 is trip 1 only");
    ok(by["A3"].slice(0).sort().join(",") === "0,1",
        "tripsByStation: the junction station belongs to BOTH trips, got " +
        by["A3"]);
    ok(by[""] === undefined,
        "tripsByStation: a splay's blank 'to' is not a station");
    ok(by["A2"].length === 1,
        "tripsByStation: a name repeated per shot is not counted twice");

    ok(CsBind.tripForStations(["A4", "A5"], ts) === 1,
        "tripFor: stations of one trip give that trip");
    ok(CsBind.tripForStations(["A1", "A2"], ts) === 0,
        "tripFor: and trip 0 is a real answer, not a default");
    // a wall that crosses the junction and runs on into trip 1: the
    // junction votes for both, so the non-shared station decides
    ok(CsBind.tripForStations(["A3", "A4"], ts) === 1,
        "tripFor: majority -- the junction votes both ways, A4 decides");
    ok(CsBind.tripForStations(["A2", "A3"], ts) === 0,
        "tripFor: the mirror case decides for trip 0");
    // a genuine tie: one station from each trip, nothing shared
    ok(CsBind.tripForStations(["A1", "A5"], ts, "A5") === 1,
        "tripFor: a tie goes to the NEAREST bound station's trip");
    ok(CsBind.tripForStations(["A1", "A5"], ts, "A1") === 0,
        "tripFor: the same tie the other way round");
    ok(CsBind.tripForStations(["A1", "A5"], ts) === 0,
        "tripFor: a tie with no nearest falls to the lowest trip id, so " +
        "the answer never depends on entity query order");
    ok(CsBind.tripForStations(["A1", "A5"], ts, "NOPE") === 0,
        "tripFor: a nearest belonging to neither tied trip is ignored");
    // nothing to go on: NULL, never 0 -- writing trip 0 as a guess
    // would tie the entity to a passage it has nothing to do with
    ok(CsBind.tripForStations(["ZZ1"], ts) === null,
        "tripFor: stations no trip owns -> null, not trip 0");
    ok(CsBind.tripForStations([], ts) === null, "tripFor: no stations -> null");
    ok(CsBind.tripForStations(["A1"], null) === null,
        "tripFor: no survey to ask -> null");

    var pidx = [{ name: "A1", x: 0, y: 0 }, { name: "A5", x: 100, y: 0 },
        { name: "A5", x: 103, y: 0 }];
    ok(CsBind.nearestStationName([{ x: 90, y: 0 }], pidx, ["A1", "A5"]) ===
        "A5", "nearest: the closer station wins");
    ok(CsBind.nearestStationName([{ x: 10, y: 0 }], pidx, ["A1", "A5"]) ===
        "A1", "nearest: and the other way round");
    ok(CsBind.nearestStationName([{ x: 90, y: 0 }], pidx, ["A1"]) === "A1",
        "nearest: only names on the shortlist are considered");
    ok(CsBind.nearestStationName([], pidx, ["A1"]) === null,
        "nearest: no points -> nothing to measure");
    ok(CsBind.nearestStationName([{ x: 0, y: 0 }], pidx, []) === null,
        "nearest: no names -> null");
})();

// --- the opt-out switch ----------------------------------------------
// ON by default, and the default has to hold even where the settings
// store cannot be reached: "no settings" is not a reason to stop doing
// the thing the feature exists to do. Exercised by SHADOWING the
// RSettings global (the same trick the QMessageBox-capturing tests
// further down use), never by writing the user's real preference -- a
// test that flipped that and then threw would leave the feature
// switched off in their own configuration.
(function() {
    ok(CsBind.SETTING_AUTO_BIND === "CaveSurvey/LineworkAutoBind",
        "switch: the settings key, got " + CsBind.SETTING_AUTO_BIND);
    var realOverride = CsBind.autoBindOverride;
    var realSettings = (typeof RSettings !== "undefined") ?
        RSettings : undefined;
    try {
        CsBind.autoBindOverride = null;
        var asked = null;
        var stored = {};
        RSettings = {
            getBoolValue: function(key, dflt) {
                asked = key;
                return stored.hasOwnProperty(key) ? stored[key] : dflt;
            },
            setValue: function(key, value) {
                stored[key] = value;
            }
        };
        ok(CsBind.autoBindEnabled() === true,
            "switch: ON by default, with nothing stored");
        ok(asked === CsBind.SETTING_AUTO_BIND,
            "switch: read from its own key, got " + asked);
        ok(CsBind.setAutoBindEnabled(false) === false &&
            CsBind.autoBindEnabled() === false,
            "switch: turning it off persists and reads back");
        ok(stored[CsBind.SETTING_AUTO_BIND] === false,
            "switch: and it is the SETTING that holds it, so the choice " +
            "survives the drawing being closed");
        ok(CsBind.setAutoBindEnabled(true) === true &&
            CsBind.autoBindEnabled() === true,
            "switch: and back on again");

        // no settings store at all
        RSettings = undefined;
        ok(CsBind.autoBindEnabled() === true,
            "switch: unreachable settings still means ON");

        // the harness seam wins over both, and writes nothing
        CsBind.autoBindOverride = false;
        ok(CsBind.autoBindEnabled() === false,
            "switch: the override forces off without touching settings");
        CsBind.autoBindOverride = true;
        ok(CsBind.autoBindEnabled() === true, "switch: and forces on");
    } finally {
        RSettings = realSettings;
        CsBind.autoBindOverride = realOverride;
    }
})();

// --- the sentence a revision owns up with -----------------------------
(function() {
    ok(CsRevise.lineworkClaimLine(0) === "" &&
        CsRevise.lineworkClaimLine(null) === "" &&
        CsRevise.lineworkClaimLine(undefined) === "",
        "claim: nothing claimed, nothing said");
    var one = CsRevise.lineworkClaimLine(1);
    ok(one.indexOf("1 was bound automatically") >= 0,
        "claim: the singular reads as English, got '" + one + "'");
    var many = CsRevise.lineworkClaimLine(9);
    ok(many.indexOf("9 were bound automatically") >= 0,
        "claim: the plural does too, got '" + many + "'");
    ok(many.indexOf("Undo") >= 0,
        "claim: and says how to take it back, got '" + many + "'");
    // the shared block is untouched when nothing was claimed, which is
    // what keeps it word for word identical to CsReport's (asserted
    // above) while CsReport does not yet know about the claim
    ok(CsRevise.lineworkSummary(3, []).join("\n") ===
        CsRevise.lineworkSummary(3, [], 0).join("\n"),
        "claim: a claim of 0 changes not one character of the summary");
    var withClaim = CsRevise.lineworkSummary(3, [], 2).join("\n");
    ok(withClaim.indexOf("Traced linework moved with its stations: 3") >= 0 &&
        withClaim.indexOf("2 were bound automatically") >= 0,
        "claim: the summary states the total AND what it claimed, " +
        "separately -- '3 moved' must not be able to hide '2 claimed'");
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

    // --- deep-compare kit, shared by the gate and CsRevise.apply tests
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

    (function() {
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

    // -----------------------------------------------------------------
    // CsRevise.apply, RIGID path: a whole-drawing declination revision.
    // One modify operation must transform EVERYTHING -- survey marks
    // and an untagged scratch line -- except TB_* sheet furniture, and
    // rewrite the azimuth/declination tags in the same step. The
    // one-operation claim is proven by a SINGLE di.undo() returning
    // both the scratch geometry and the tag edits at once.
    // -----------------------------------------------------------------
    (function() {
        var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var di = new RDocumentInterface(doc);
        getDocument = function() { return doc; };
        getDocumentInterface = function() { return di; };

        var S = CsModel.newSurvey();
        S.declination = 2.0;
        S.declinationSource = "user";
        var r0 = shotOf("R1", "R2", 10, 0);
        r0.backAzimuth = 180;
        var r1 = shotOf("R2", "R3", 8, 90);
        var r2 = shotOf("R3", "R1", 12.81, 218.66);  // loop closure
        S.shots.push(r0); S.shots.push(r1); S.shots.push(r2);
        CsModel.ensureTrips(S);
        var res0 = CsNetwork.resolve(S, {});
        CsDraw.survey(S, res0);

        // hand-drawn stand-in: an UNTAGGED scratch line on layer "0";
        // sheet furniture: a text on a TB_ layer, which must not move
        var tbLayer = new RLayer(doc, "TB_TEST", false, false,
            new RColor("white"), doc.getLinetypeId("CONTINUOUS"),
            RLineweight.Weight025, false);
        var tbOp = new RAddObjectsOperation();
        tbOp.addObject(tbLayer);
        di.applyOperation(tbOp);
        var addOp = new RAddObjectsOperation();
        var scratchLine = new RLineEntity(doc,
            new RLineData(new RVector(3, 1), new RVector(7, 2)));
        scratchLine.setLayerId(doc.getLayerId("0"));
        addOp.addObject(scratchLine, false);
        CsDraw.addText(doc, addOp, "TB_TEST", "SHEET 1",
            new RVector(50, 50), RS.HAlignLeft);
        di.applyOperation(addOp);

        var scan = function() {
            var found = { scratch: null, tbText: null,
                legs: {}, stations: {} };
            var ids = doc.queryAllEntities(false, false);
            for (var i = 0; i < ids.length; i++) {
                var e = doc.queryEntity(ids[i]);
                if (isNull(e)) {
                    continue;
                }
                var ln = doc.getLayerName(e.getLayerId());
                if (ln === "0") { found.scratch = e; }
                if (ln === "TB_TEST") { found.tbText = e; }
                var sh = CsTags.get(e, "Shot");
                if (sh !== "") { found.legs[sh] = e; }
                var stn = CsTags.get(e, "Station");
                if (stn !== "") { found.stations[stn] = e; }
            }
            return found;
        };

        var recon = CsRevise.surveyFromDocument(doc);
        ok(recon.legacy === false, "apply-rigid: recon is v3");
        // an independent second reconstruction is the revision model
        var newSurvey = CsRevise.surveyFromDocument(doc).survey;
        var rev = CsRevise.reviseDeclination(newSurvey, 0, 6.0, "igrf");
        near(rev.delta, 4.0, 1e-9, "apply-rigid: revision delta +4 deg");

        var idsBefore = doc.queryAllEntities(false, false).length;
        var report = CsRevise.apply(doc, di, recon, newSurvey);
        var idsAfter = doc.queryAllEntities(false, false).length;

        ok(report.rigid === true, "apply-rigid: classified rigid");
        ok(idsAfter === idsBefore,
            "apply-rigid: no entities added or removed, " + idsBefore +
            " -> " + idsAfter);
        ok(report.stationsChanged >= 2,
            "apply-rigid: non-anchor stations counted as moved, got " +
            report.stationsChanged);
        ok(report.loopsBefore.length === 1 && report.loopsAfter.length === 1,
            "apply-rigid: loop reported before and after");
        if (report.loopsBefore.length === 1 &&
                report.loopsAfter.length === 1) {
            near(report.loopsAfter[0].error, report.loopsBefore[0].error,
                1e-6, "apply-rigid: rigid move keeps the loop error");
        }

        // azimuth +4 => rotate -4 deg about the anchor (theta CCW-
        // positive in drawing coords); predict with applyFit itself
        var th = -4.0 * Math.PI / 180;
        var ax = recon.anchorPos.x, ay = recon.anchorPos.y;
        var predFit = { theta: th, scale: 1.0,
            tx: ax - (Math.cos(th) * ax - Math.sin(th) * ay),
            ty: ay - (Math.sin(th) * ax + Math.cos(th) * ay) };

        var after = scan();
        ok(after.scratch !== null, "apply-rigid: scratch line survived");
        var predS = CsRevise.applyFit(predFit, { x: 3, y: 1 });
        var predE = CsRevise.applyFit(predFit, { x: 7, y: 2 });
        var gotS = after.scratch.getStartPoint();
        var gotE = after.scratch.getEndPoint();
        near(gotS.x, predS.x, 1e-6, "apply-rigid: scratch start x rotated -4 deg");
        near(gotS.y, predS.y, 1e-6, "apply-rigid: scratch start y rotated -4 deg");
        near(gotE.x, predE.x, 1e-6, "apply-rigid: scratch end x rotated -4 deg");
        near(gotE.y, predE.y, 1e-6, "apply-rigid: scratch end y rotated -4 deg");

        ok(after.tbText !== null, "apply-rigid: TB_TEST text survived");
        var tbPos = after.tbText.getPosition();
        near(tbPos.x, 50, 1e-9, "apply-rigid: TB_TEST text x UNCHANGED");
        near(tbPos.y, 50, 1e-9, "apply-rigid: TB_TEST text y UNCHANGED");

        // station points really rotated: R2 was drawn at (0, 10)
        ok(after.stations["R2"] !== undefined, "apply-rigid: R2 found");
        var predR2 = CsRevise.applyFit(predFit, { x: 0, y: 10 });
        var gotR2 = after.stations["R2"].getPosition();
        near(gotR2.x, predR2.x, 1e-6, "apply-rigid: station R2 x rotated");
        near(gotR2.y, predR2.y, 1e-6, "apply-rigid: station R2 y rotated");

        // tags rewritten in the SAME operation
        var leg01 = after.legs["R1->R2"];
        ok(leg01 !== undefined, "apply-rigid: R1->R2 leg found");
        near(CsTags.getNumber(leg01, "Azimuth"), 4.0, 1e-9,
            "apply-rigid: leg Azimuth tag updated (+4)");
        near(CsTags.getNumber(leg01, "BackAzimuth"), 184.0, 1e-9,
            "apply-rigid: leg BackAzimuth tag co-updated");
        var a0 = after.stations["R1"];
        ok(a0 !== undefined, "apply-rigid: trip-0 anchor found");
        near(CsTags.getNumber(a0, "TripDeclination"), 6.0, 1e-9,
            "apply-rigid: TripDeclination updated");
        ok(CsTags.get(a0, "TripDeclinationSource") === "igrf",
            "apply-rigid: TripDeclinationSource updated, got '" +
            CsTags.get(a0, "TripDeclinationSource") + "'");
        near(CsTags.getNumber(a0, "Declination"), 6.0, 1e-9,
            "apply-rigid: legacy Declination mirror updated");
        var log = CsTags.get(a0, "RevisionLog");
        ok(log.indexOf("trip 0 declination 2 -> 6 (igrf)") >= 0,
            "apply-rigid: RevisionLog line appended, got '" + log + "'");

        var summary = CsReport.revisionSummary(report);
        ok(summary.indexOf("rigid") >= 0 &&
            summary.indexOf("WARNING") < 0,
            "apply-rigid: summary uses rigid wording, no warning");

        // (c) ONE-OPERATION PROOF: a single di.undo() must revert the
        // scratch geometry AND the tag edits together (both proven to
        // undo correctly in this bridge); a second-op design would need
        // two undos. Redo re-applies to leave the doc in the applied
        // state.
        di.undo();
        var undone = scan();
        var uS = undone.scratch.getStartPoint();
        near(uS.x, 3, 1e-9, "apply-rigid undo: scratch start x restored");
        near(uS.y, 1, 1e-9, "apply-rigid undo: scratch start y restored");
        near(CsTags.getNumber(undone.legs["R1->R2"], "Azimuth"), 0.0, 1e-9,
            "apply-rigid undo: Azimuth tag restored by the SAME undo step");
        near(CsTags.getNumber(undone.stations["R1"], "TripDeclination"),
            2.0, 1e-9,
            "apply-rigid undo: TripDeclination restored by the same step");
        di.redo();
        var redone = scan();
        near(redone.scratch.getStartPoint().x, predS.x, 1e-6,
            "apply-rigid redo: transform re-applied");
        near(CsTags.getNumber(redone.legs["R1->R2"], "Azimuth"), 4.0, 1e-9,
            "apply-rigid redo: tags re-applied");
    })();

    // -----------------------------------------------------------------
    // CsRevise.apply, NON-RIGID path: revising one trip of two bends
    // the survey, so the marks are erased and redrawn. Trip-0 stations
    // must not move; the redrawn drawing must reconstruct to exactly
    // the revised survey; the RevisionLog must ride the NEW anchor.
    // -----------------------------------------------------------------
    (function() {
        var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var di = new RDocumentInterface(doc);
        getDocument = function() { return doc; };
        getDocumentInterface = function() { return di; };

        var S = CsModel.newSurvey();
        S.declination = 1.0;
        S.declinationSource = "user";
        CsModel.ensureTrips(S);
        var t1 = CsModel.newTrip();
        t1.name = "UPPER";
        t1.declination = 1.0;
        t1.declinationSource = "user";
        S.trips.push(t1);
        var n0 = shotOf("N1", "N2", 10, 0);
        var n1 = shotOf("N2", "N3", 10, 90);
        var n2 = shotOf("N3", "N4", 8, 45);
        n2.trip = 1;
        var n3 = shotOf("N4", "N5", 6, 120);
        n3.trip = 1;
        S.shots.push(n0); S.shots.push(n1);
        S.shots.push(n2); S.shots.push(n3);
        var res0 = CsNetwork.resolve(S, {});
        CsDraw.survey(S, res0);

        var posOf = function() {
            var out = {};
            var sts = CsTags.collectStations(doc);
            for (var i = 0; i < sts.length; i++) {
                out[sts[i].name] = { x: sts[i].pos.x, y: sts[i].pos.y };
            }
            return out;
        };
        var posBefore = posOf();

        var recon = CsRevise.surveyFromDocument(doc);
        var newSurvey = CsRevise.surveyFromDocument(doc).survey;
        CsRevise.reviseDeclination(newSurvey, 1, 11.0, "user"); // +10, trip 1

        var report = CsRevise.apply(doc, di, recon, newSurvey);
        ok(report.rigid === false, "apply-redraw: classified NOT rigid");
        ok(report.stationsChanged > 0,
            "apply-redraw: stationsChanged > 0, got " +
            report.stationsChanged);

        var posAfter = posOf();
        var nAfter = 0;
        for (var pn in posAfter) {
            if (posAfter.hasOwnProperty(pn)) {
                nAfter++;
            }
        }
        ok(nAfter === 5, "apply-redraw: 5 stations after redraw, got " +
            nAfter);
        var t0names = ["N1", "N2", "N3"];
        for (var i = 0; i < t0names.length; i++) {
            var nm = t0names[i];
            near(posAfter[nm].x, posBefore[nm].x, 1e-6,
                "apply-redraw: trip-0 station " + nm + " x unchanged");
            near(posAfter[nm].y, posBefore[nm].y, 1e-6,
                "apply-redraw: trip-0 station " + nm + " y unchanged");
        }
        var d4x = posAfter["N4"].x - posBefore["N4"].x;
        var d4y = posAfter["N4"].y - posBefore["N4"].y;
        ok(Math.sqrt(d4x * d4x + d4y * d4y) > 0.1,
            "apply-redraw: trip-1 station N4 really moved");

        // the redrawn drawing reconstructs to EXACTLY the revised survey
        var rec2 = CsRevise.surveyFromDocument(doc);
        ok(rec2.legacy === false, "apply-redraw: still v3 after redraw");
        ok(rec2.survey.shots.length === newSurvey.shots.length,
            "apply-redraw: shot count reconstructs, expected " +
            newSurvey.shots.length + ", got " + rec2.survey.shots.length);
        for (i = 0; i < newSurvey.shots.length; i++) {
            if (i < rec2.survey.shots.length) {
                shotsEqual(newSurvey.shots[i], rec2.survey.shots[i],
                    "apply-redraw shot[" + i + "]");
            }
        }

        // RevisionLog carried onto the NEW trip-0 anchor
        var newAnchor = null;
        var ids = doc.queryAllEntities(false, false);
        for (i = 0; i < ids.length; i++) {
            var e = doc.queryEntity(ids[i]);
            if (isNull(e)) {
                continue;
            }
            if (CsTags.get(e, "Station") !== "" &&
                    CsTags.get(e, "Trip") !== "" &&
                    CsTags.getNumber(e, "Trip") === 0) {
                newAnchor = e;
                break;
            }
        }
        ok(newAnchor !== null, "apply-redraw: new trip-0 anchor found");
        var log = newAnchor !== null ?
            CsTags.get(newAnchor, "RevisionLog") : "";
        ok(log.indexOf("trip 1 declination 1 -> 11 (user)") >= 0,
            "apply-redraw: RevisionLog on the new anchor, got '" +
            log + "'");

        var summary = CsReport.revisionSummary(report);
        ok(summary.indexOf("erased and redrawn") >= 0 &&
            summary.indexOf("re-trace") >= 0,
            "apply-redraw: summary warns about hand-drawn linework");
    })();

    // -----------------------------------------------------------------
    // RebuildSurveyData: upgrading a drawing to tag schema v3.
    //
    // The tool file is loaded like a Core file (loadRepoScript strips
    // its include() lines); its wiring block runs at load and needs an
    // EAction base class, which the headless engine has no GUI for --
    // stub one if the real class isn't there.
    // -----------------------------------------------------------------
    if (typeof EAction === "undefined") {
        EAction = function() {};
        EAction.prototype.beginEvent = function() {};
        EAction.prototype.terminate = function() {};
        EAction.handleUserMessage = function() {};
    }
    loadRepoScript(
        "scripts/CaveSurvey/RebuildSurveyData/RebuildSurveyData.js");

    // every tagged station name -> its drawn position
    var rsdPositions = function(doc) {
        var out = {};
        var sts = CsTags.collectStations(doc);
        for (var i = 0; i < sts.length; i++) {
            out[sts[i].name] = { x: sts[i].pos.x, y: sts[i].pos.y };
        }
        return out;
    };
    // the v3 leg line for one shot, or null
    var rsdLeg = function(doc, from, to) {
        var ids = doc.queryAllEntities(false, false);
        for (var i = 0; i < ids.length; i++) {
            var e = doc.queryEntity(ids[i]);
            if (isNull(e)) {
                continue;
            }
            if (CsTags.get(e, "From") === from &&
                    CsTags.get(e, "To") === to &&
                    CsTags.get(e, "Distance") !== "") {
                return e;
            }
        }
        return null;
    };

    // ---- plan -> slope conversion, including the vertical guard -----
    (function() {
        var vsv = CsModel.newSurvey();
        var vLevel = shotOf("V1", "V2", 5, 0, 0);
        var vSteep = shotOf("V2", "V3", 5, 90, 60);
        var vVert = shotOf("V3", "V4", 1e-7, 0, 90);   // straight down/up
        vsv.shots.push(vLevel);
        vsv.shots.push(vSteep);
        vsv.shots.push(vVert);
        var conv = RebuildSurveyData.toSlopeDistances(vsv);
        ok(conv.scaled === 1, "rsd-slope: one shot rescaled, got " +
            conv.scaled);
        ok(conv.vertical === 1, "rsd-slope: one vertical shot skipped, " +
            "got " + conv.vertical);
        near(vLevel.distance, 5, 1e-12,
            "rsd-slope: a level shot's plan length IS its slope length");
        near(vSteep.distance, 5 / Math.cos(60 * Math.PI / 180), 1e-9,
            "rsd-slope: inclined shot scaled by 1/cos(inclination)");
        near(vVert.distance, 1e-7, 1e-15,
            "rsd-slope: a vertical shot has no plan length to scale -- " +
            "distance left exactly as drawn");
    })();

    // ---- LEGACY UPGRADE: hand-tagged station points, no leg data ----
    (function() {
        var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var di = new RDocumentInterface(doc);
        getDocument = function() { return doc; };
        getDocumentInterface = function() { return di; };

        // a 2-shot chain drawn by a pre-v3 build: station POINTS with
        // the old per-station tags and the legacy survey block, and no
        // leg lines at all. Geometry is PLAN, so the inclined shot's
        // drawn length is 10 * cos(30).
        var INC = 30.0;
        var plan = 10.0 * Math.cos(INC * Math.PI / 180.0);
        CsLayers.ensureSurveyLayers(doc, di);
        var op = new RAddObjectsOperation();
        var q1 = CsDraw.addPoint(doc, op, CsLayers.STATIONS,
            new RVector(0, 0));
        CsTags.tagStation(q1, { name: "Q1", seq: 0, azimuth: 0,
            inclination: 0, z: 0, note: "entrance" });
        CsTags.set(q1, "SurveyName", "OLD CAVE");
        CsTags.set(q1, "SurveyDate", "1994-06-01");
        CsTags.set(q1, "SurveyTeam", "N. Schonegg, K. Lee");
        CsTags.set(q1, "Declination", 3.5);
        CsTags.set(q1, "DeclinationSource", "user");
        CsTags.set(q1, "DistanceUnit", "ft");
        op.addObject(q1, false);
        var q2 = CsDraw.addPoint(doc, op, CsLayers.STATIONS,
            new RVector(0, 10));
        CsTags.tagStation(q2, { name: "Q2", seq: 1, azimuth: 0,
            inclination: 0, z: 0, left: 2, right: 3 });
        op.addObject(q2, false);
        var q3 = CsDraw.addPoint(doc, op, CsLayers.STATIONS,
            new RVector(plan, 10));
        CsTags.tagStation(q3, { name: "Q3", seq: 2, azimuth: 90,
            inclination: INC, z: 10.0 * Math.sin(INC * Math.PI / 180.0) });
        op.addObject(q3, false);
        di.applyOperation(op);

        var before = CsRevise.surveyFromDocument(doc);
        ok(before.legacy === true,
            "rsd-upgrade: fixture starts as a legacy drawing");
        var posBefore = rsdPositions(doc);

        var rep = RebuildSurveyData.rebuild(doc, di);
        ok(rep.mode === "upgrade", "rsd-upgrade: mode 'upgrade', got '" +
            rep.mode + "'");
        ok(rep.inferred === true,
            "rsd-upgrade: report flags inferred distances");
        ok(rep.stations === 3 && rep.shots === 2,
            "rsd-upgrade: 3 stations / 2 shots reported, got " +
            rep.stations + " / " + rep.shots);
        ok(rep.vertical === 0,
            "rsd-upgrade: no near-vertical shots in this fixture, got " +
            rep.vertical);
        ok(rep.message.indexOf(
            "inferred from geometry (slope = plan/cos(inclination))")
            >= 0, "rsd-upgrade: report says distances were inferred, got '" +
            rep.message + "'");

        // (a) the drawing is no longer legacy
        var after = CsRevise.surveyFromDocument(doc);
        ok(after.legacy === false,
            "rsd-upgrade: reconstruction is v3, not legacy");

        // (b) legs now carry Distance tags
        var legA = rsdLeg(doc, "Q1", "Q2");
        var legB = rsdLeg(doc, "Q2", "Q3");
        ok(legA !== null, "rsd-upgrade: Q1->Q2 leg carries shot data");
        ok(legB !== null, "rsd-upgrade: Q2->Q3 leg carries shot data");
        if (legA !== null) {
            near(CsTags.getNumber(legA, "Distance"), 10.0, 1e-6,
                "rsd-upgrade: level shot distance unchanged");
        }
        // (c) the inclined shot's distance is plan / cos(inclination)
        if (legB !== null) {
            near(CsTags.getNumber(legB, "Distance"),
                plan / Math.cos(INC * Math.PI / 180.0), 1e-6,
                "rsd-upgrade: inclined shot distance = plan/cos(inc)");
            near(CsTags.getNumber(legB, "Distance"), 10.0, 1e-6,
                "rsd-upgrade: inclined shot recovers its slope length");
            near(CsTags.getNumber(legB, "Inclination"), INC, 1e-9,
                "rsd-upgrade: inclination carried onto the leg");
        }

        // (d) station positions untouched
        var posAfter = rsdPositions(doc);
        var pn;
        for (pn in posBefore) {
            if (posBefore.hasOwnProperty(pn)) {
                ok(posAfter[pn] !== undefined,
                    "rsd-upgrade: station " + pn + " survived");
                if (posAfter[pn] !== undefined) {
                    near(posAfter[pn].x, posBefore[pn].x, 1e-9,
                        "rsd-upgrade: " + pn + " x unchanged");
                    near(posAfter[pn].y, posBefore[pn].y, 1e-9,
                        "rsd-upgrade: " + pn + " y unchanged");
                }
            }
        }

        // (e) trip 0 carries the legacy metadata block
        ok(after.survey.trips.length === 1,
            "rsd-upgrade: one trip, got " + after.survey.trips.length);
        if (after.survey.trips.length >= 1) {
            var t0 = after.survey.trips[0];
            ok(t0.date === "1994-06-01",
                "rsd-upgrade: trip 0 date, got '" + t0.date + "'");
            ok(t0.team === "N. Schonegg, K. Lee",
                "rsd-upgrade: trip 0 team, got '" + t0.team + "'");
            near(t0.declination, 3.5, 1e-9,
                "rsd-upgrade: trip 0 declination");
            ok(t0.declinationSource === "user",
                "rsd-upgrade: trip 0 declination source, got '" +
                t0.declinationSource + "'");
            ok(t0.distanceUnit === "ft",
                "rsd-upgrade: trip 0 distance unit, got '" +
                t0.distanceUnit + "'");
        }
        ok(after.survey.caveName === "OLD CAVE",
            "rsd-upgrade: legacy SurveyName becomes the cave name, got '" +
            after.survey.caveName + "'");
        ok(after.survey.startNote === "entrance",
            "rsd-upgrade: start note carried through, got '" +
            after.survey.startNote + "'");
        // the LRUD the old station tags carried rides its shot now
        if (after.survey.shots.length === 2) {
            near(after.survey.shots[0].left, 2, 1e-9,
                "rsd-upgrade: legacy LRUD carried onto the shot");
            near(after.survey.shots[0].right, 3, 1e-9,
                "rsd-upgrade: legacy LRUD right carried onto the shot");
        }
    })();

    // ---- IDEMPOTENCE: running twice on a v3 drawing changes nothing --
    (function() {
        var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var di = new RDocumentInterface(doc);
        getDocument = function() { return doc; };
        getDocumentInterface = function() { return di; };

        var S = CsModel.newSurvey();
        S.caveName = "IDEM CAVE";
        S.date = "2019-03-03";
        S.team = "Cara";
        S.declination = 1.25;
        S.declinationSource = "igrf";
        S.startNote = "gate is locked";
        S.startLrud = { left: 1, right: 2, up: 3, down: 4,
            leftAll: null, rightAll: null, upAll: null, downAll: null };
        var i0 = shotOf("I1", "I2", 10, 0);
        i0.left = 2; i0.right = 3; i0.up = 1; i0.down = 0.5;
        var i1 = shotOf("I2", "I3", 10, 90, 15);
        i1.notes = "steep bit";
        var i2 = shotOf("I2", "J1", 8, 200, -10);   // branch
        var i3 = shotOf("I3", "", 4, 45);           // splay
        i3.splay = true;
        S.shots.push(i0); S.shots.push(i1); S.shots.push(i2);
        S.shots.push(i3);
        CsModel.ensureTrips(S);
        var res0 = CsNetwork.resolve(S, {});
        CsDraw.survey(S, res0);

        var posBefore = rsdPositions(doc);
        var rec0 = CsRevise.surveyFromDocument(doc);
        ok(rec0.legacy === false, "rsd-idem: fixture starts v3");

        var countAt = function() {
            return doc.queryAllEntities(false, false).length;
        };

        var rep1 = RebuildSurveyData.rebuild(doc, di);
        var count1 = countAt();
        var pos1 = rsdPositions(doc);
        ok(rep1.mode === "heal", "rsd-idem: run 1 mode 'heal', got '" +
            rep1.mode + "'");
        ok(rep1.inferred === false,
            "rsd-idem: run 1 infers nothing -- the tags are the survey");

        var rep2 = RebuildSurveyData.rebuild(doc, di);
        var count2 = countAt();
        var pos2 = rsdPositions(doc);
        ok(rep2.mode === "heal", "rsd-idem: run 2 mode 'heal', got '" +
            rep2.mode + "'");
        ok(count1 === count2,
            "rsd-idem: entity count identical between runs, " + count1 +
            " -> " + count2);
        ok(rep1.stations === rep2.stations && rep1.shots === rep2.shots,
            "rsd-idem: same counts reported both runs, " + rep1.stations +
            "/" + rep1.shots + " then " + rep2.stations + "/" + rep2.shots);

        var pn;
        for (pn in posBefore) {
            if (posBefore.hasOwnProperty(pn)) {
                ok(pos1[pn] !== undefined && pos2[pn] !== undefined,
                    "rsd-idem: station " + pn + " survived both runs");
                if (pos1[pn] !== undefined) {
                    near(pos1[pn].x, posBefore[pn].x, 1e-9,
                        "rsd-idem: " + pn + " x stable after run 1");
                    near(pos1[pn].y, posBefore[pn].y, 1e-9,
                        "rsd-idem: " + pn + " y stable after run 1");
                }
                if (pos2[pn] !== undefined) {
                    near(pos2[pn].x, posBefore[pn].x, 1e-9,
                        "rsd-idem: " + pn + " x stable after run 2");
                    near(pos2[pn].y, posBefore[pn].y, 1e-9,
                        "rsd-idem: " + pn + " y stable after run 2");
                }
            }
        }

        // the survey the drawing reconstructs to is unchanged, field
        // for field (shotsEqual is hoisted above the gate IIFE)
        var rec2 = CsRevise.surveyFromDocument(doc);
        ok(rec2.legacy === false, "rsd-idem: still v3 after two runs");
        ok(rec2.survey.shots.length === rec0.survey.shots.length,
            "rsd-idem: shot count unchanged, expected " +
            rec0.survey.shots.length + ", got " +
            rec2.survey.shots.length);
        for (var si = 0; si < rec0.survey.shots.length; si++) {
            if (si < rec2.survey.shots.length) {
                shotsEqual(rec0.survey.shots[si], rec2.survey.shots[si],
                    "rsd-idem shot[" + si + "]");
            }
        }
        ok(rec2.anchorName === rec0.anchorName,
            "rsd-idem: anchor station unchanged, got '" +
            rec2.anchorName + "'");
        ok(rec2.survey.caveName === "IDEM CAVE" &&
            rec2.survey.date === "2019-03-03" &&
            rec2.survey.team === "Cara",
            "rsd-idem: survey metadata survives both runs");
        near(rec2.survey.declination, 1.25, 1e-9,
            "rsd-idem: declination survives both runs");
        ok(rec2.survey.startNote === "gate is locked",
            "rsd-idem: start note survives both runs, got '" +
            rec2.survey.startNote + "'");
    })();

    // -----------------------------------------------------------------
    // Linework binding, document side: the station index built from a
    // real drawn survey, an entity's points as this bridge exposes
    // them, and the ordered binding rules (snap / proximity / trip).
    //
    // Then THE HAZARD. CsDraw.eraseStations deletes generated geometry
    // by tag so a redraw can replace it -- wall runs included. Traced
    // linework must NEVER go the same way: wall runs regenerate from
    // the survey, traced linework is the user's hours of work and
    // deleting it is unrecoverable. The last assertions here are the
    // guard against a future edit tidying the two tags together.
    // -----------------------------------------------------------------
    (function() {
        var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var di = new RDocumentInterface(doc);
        getDocument = function() { return doc; };
        getDocumentInterface = function() { return di; };

        // three stations 10 apart running north, LRUD 2 left / 3 right
        // on the two arrival stations -- so the drawing really carries
        // the tagged tips a wall tracing would snap to
        var bsv = CsModel.newSurvey();
        var b1 = shotOf("E1", "E2", 10, 0);
        b1.left = 2; b1.right = 3;
        var b2 = shotOf("E2", "E3", 10, 0);
        b2.left = 2; b2.right = 3;
        bsv.shots.push(b1); bsv.shots.push(b2);
        var bres = CsNetwork.resolve(bsv, {});
        var bdrawn = CsDraw.survey(bsv, bres);
        ok(bdrawn.wallsDrawn > 0,
            "bind: the survey drew generated wall runs to erase later, got " +
            bdrawn.wallsDrawn);

        var findByTag = function(key) {
            var res = [];
            var fids = doc.queryAllEntities(false, false);
            for (var fi = 0; fi < fids.length; fi++) {
                var fe = doc.queryEntity(fids[fi]);
                if (isNull(fe)) {
                    continue;
                }
                if (CsTags.get(fe, key) !== "") {
                    res.push(fe);
                }
            }
            return res;
        };

        // where the tips actually landed -- read back, not recomputed,
        // so the snap test is a real coincidence and not arithmetic
        var tipAt = {};
        var tips = findByTag("LRUDName");
        for (var ti2 = 0; ti2 < tips.length; ti2++) {
            tipAt[CsTags.get(tips[ti2], "LRUDName")] =
                tips[ti2].getPosition();
        }
        ok(tipAt["E2.L"] !== undefined && tipAt["E3.L"] !== undefined,
            "bind: LRUD tips E2.L and E3.L found to trace against");

        // ---- the station index: stations plus every tagged tip, with
        // the tip suffixes stripped back to their station ----
        var bidx = CsBind.stationIndex(doc);
        var idxNames = {};
        for (var ii = 0; ii < bidx.length; ii++) {
            idxNames[bidx[ii].name] = (idxNames[bidx[ii].name] || 0) + 1;
        }
        ok(idxNames["E1"] === 1 && idxNames["E2"] === 3 &&
            idxNames["E3"] === 3,
            "index: E1 once (no LRUD), E2/E3 once plus two tips each, got " +
            idxNames["E1"] + "/" + idxNames["E2"] + "/" + idxNames["E3"]);
        ok(idxNames["E2.L"] === undefined,
            "index: tip suffixes are stripped, no 'E2.L' entry");

        var addPl = function(layerName, pts) {
            CsLayers.ensure(doc, di, layerName);
            var pd = new RPolylineData();
            for (var pi = 0; pi < pts.length; pi++) {
                pd.appendVertex(new RVector(pts[pi].x, pts[pi].y));
            }
            var pl = new RPolylineEntity(doc, pd);
            pl.setLayerId(doc.getLayerId(layerName));
            var aop = new RAddObjectsOperation();
            aop.addObject(pl, false);
            di.applyOperation(aop);
            return pl;
        };

        // 1: traced by SNAPPING to two LRUD tips -- the exact case
        var snapPl = addPl("WALLS-SURVEYED",
            [{ x: tipAt["E2.L"].x, y: tipAt["E2.L"].y },
             { x: tipAt["E3.L"].x, y: tipAt["E3.L"].y }]);
        // 2: freehand down the middle of the passage, snapped to nothing
        var nearPl = addPl("WALLS-SURVEYED",
            [{ x: 0.7, y: 4 }, { x: 0.7, y: 6 }]);
        // 3: a construction line miles from the cave
        var farPl = addPl("WALLS-SURVEYED",
            [{ x: 1000, y: 1000 }, { x: 1001, y: 1001 }]);
        // and one on each layer the gate must refuse
        addPl("CTRL-SHOTS", [{ x: 0, y: 1 }, { x: 0, y: 2 }]);
        addPl("TB_TEST", [{ x: 0, y: 3 }, { x: 0, y: 4 }]);
        addPl("CTRL-AERIAL", [{ x: 0, y: 5 }, { x: 0, y: 6 }]);

        // ---- pointsOf, as this bridge really exposes them ----
        ok(CsBind.pointsOf(snapPl).length === 2,
            "pointsOf: polyline vertices, got " +
            CsBind.pointsOf(snapPl).length);
        var stationPts = findByTag("Station");
        ok(stationPts.length === 3 &&
            CsBind.pointsOf(stationPts[0]).length === 1,
            "pointsOf: a point entity gives its position");
        ok(CsBind.pointsOf(null).length === 0, "pointsOf: null -> []");
        ok(CsBind.pointsOf({}).length === 0,
            "pointsOf: an object it understands nothing about -> [], no throw");

        // ---- the ordered binding rules ----
        var beps = CsBind.epsilonFor(doc);
        ok(beps > 0 && beps < 1,
            "epsilon: derived from the drawing extent, got " + beps);
        var snapBind = CsBind.bindEntity(doc, snapPl, 0, bidx, beps);
        ok(snapBind.source === "snap",
            "bind: snapped polyline binds by coincidence, got " +
            snapBind.source);
        var snapNames = snapBind.stations.slice(0).sort();
        ok(snapNames.join(",") === "E2,E3",
            "bind: snapped polyline binds exactly its two tips' stations, got '" +
            snapNames.join(",") + "'");

        var nearBind = CsBind.bindEntity(doc, nearPl, 0, bidx, beps);
        ok(nearBind.source === "proximity",
            "bind: freehand near stations falls back to proximity, got " +
            nearBind.source);
        var nearSet = {};
        for (var ni2 = 0; ni2 < nearBind.stations.length; ni2++) {
            nearSet[nearBind.stations[ni2]] = true;
        }
        ok(nearSet["E1"] === true && nearSet["E2"] === true &&
            nearSet["E3"] === undefined,
            "bind: proximity picks up the stations it runs between, got '" +
            nearBind.stations.join(",") + "'");

        var farBind = CsBind.bindEntity(doc, farPl, 0, bidx, beps);
        ok(farBind.source === "trip" && farBind.stations.length === 0,
            "bind: an entity far from everything follows its trip alone, got " +
            farBind.source + "/" + farBind.stations.length);

        // ---- the adopt scan ----
        var adopt = CsBind.adoptable(doc, 0);
        var bySource = { snap: 0, proximity: 0, trip: 0 };
        var badLayer = "";
        for (var ai = 0; ai < adopt.length; ai++) {
            bySource[adopt[ai].source] = (bySource[adopt[ai].source] || 0) + 1;
            if (!CsBind.isLineworkLayer(adopt[ai].layer)) {
                badLayer = adopt[ai].layer;
            }
        }
        ok(adopt.length === 3,
            "adopt: exactly the three traced entities are adoptable, got " +
            adopt.length);
        ok(bySource.snap === 1 && bySource.proximity === 1 &&
            bySource.trip === 1,
            "adopt: one of each source, got snap " + bySource.snap +
            " proximity " + bySource.proximity + " trip " + bySource.trip);
        ok(badLayer === "",
            "adopt: nothing on CTRL-SHOTS / TB_TEST / CTRL-AERIAL is ever " +
            "adoptable, but got " + badLayer);

        // ---- tagEntities: one operation, tags readable afterwards ----
        var tagged = CsBind.tagEntities(doc, di, adopt);
        ok(tagged === 3, "tag: all three tagged in one operation, got " +
            tagged);
        var withTrip = findByTag(CsBind.TRIP_TAG);
        ok(withTrip.length === 3,
            "tag: LineworkTrip readable back off three entities, got " +
            withTrip.length);
        var withStations = findByTag(CsBind.STATIONS_TAG);
        ok(withStations.length === 2,
            "tag: only the two that bound stations carry a station list, got " +
            withStations.length);
        // by ID, not by shape: the proximity polyline also bound two
        // stations, and entity query order is not stable
        var snapText = CsTags.get(doc.queryEntity(snapPl.getId()),
            CsBind.STATIONS_TAG);
        ok(CsBind.decodeStations(snapText).slice(0).sort().join(",") ===
            "E2,E3",
            "tag: the snapped polyline's station list round-trips, got '" +
            snapText + "'");
        // already tagged -> no longer adoptable (no double claim)
        ok(CsBind.adoptable(doc, 0).length === 0,
            "adopt: tagged linework is not offered again");

        // ---- an OFF layer: this build silently refuses MODIFIES there
        // too, so the tag would vanish without withLayerOn ----
        var offPl = addPl("TRACED-OFF",
            [{ x: tipAt["E2.L"].x, y: tipAt["E2.L"].y },
             { x: 5, y: 12 }]);
        var offLay = doc.queryLayer("TRACED-OFF");
        offLay.setOff(true);
        var offOp = new RModifyObjectsOperation();
        offOp.addObject(offLay, false);
        di.applyOperation(offOp);
        ok(doc.queryLayer("TRACED-OFF").isOff() === true,
            "off layer: TRACED-OFF really is off");
        var offAdopt = CsBind.adoptable(doc, 0);
        ok(offAdopt.length === 1 && offAdopt[0].source === "snap",
            "off layer: the entity on it is still adoptable, got " +
            offAdopt.length);
        CsBind.tagEntities(doc, di, offAdopt);
        ok(findByTag(CsBind.TRIP_TAG).length === 4,
            "off layer: the tag landed despite the layer being off, got " +
            findByTag(CsBind.TRIP_TAG).length);
        ok(doc.queryLayer("TRACED-OFF").isOff() === true,
            "off layer: left off again afterwards");

        // ---- THE HAZARD ----
        var wallRunsBefore = findByTag("WallRunStations").length;
        ok(wallRunsBefore > 0,
            "erase-guard: generated wall runs present before the erase, got " +
            wallRunsBefore);
        var lineworkBefore = findByTag(CsBind.STATIONS_TAG).length;
        ok(lineworkBefore === 3,
            "erase-guard: three linework entities carry a station list, got " +
            lineworkBefore);
        // the traced polylines list E2/E3 -- exactly the stations being
        // erased -- and the wall runs list all three
        CsDraw.eraseStations(doc, ["E1", "E2", "E3"]);
        ok(findByTag("WallRunStations").length === 0,
            "erase-guard: GENERATED wall runs over those stations are " +
            "removed (they regenerate), got " +
            findByTag("WallRunStations").length);
        ok(findByTag(CsBind.STATIONS_TAG).length === lineworkBefore,
            "erase-guard: TRACED linework over the SAME stations SURVIVES " +
            "-- deleting the user's tracing is unrecoverable; got " +
            findByTag(CsBind.STATIONS_TAG).length + " of " + lineworkBefore);
        ok(findByTag(CsBind.TRIP_TAG).length === 4,
            "erase-guard: the trip-bound linework survives too, got " +
            findByTag(CsBind.TRIP_TAG).length);
        ok(CsBind.pointsOf(doc.queryEntity(snapPl.getId())).length === 2,
            "erase-guard: the surviving tracing is intact, not just present");
        ok(CsTags.collectStations(doc).length === 0,
            "erase-guard: the stations themselves did go");
    })();

    // -----------------------------------------------------------------
    // Traced linework follows its OWN stations through a NON-RIGID
    // revision. This is the whole point of the binding: a per-trip
    // declination fix erases and redraws the survey marks, and before
    // this step everything the surveyor traced stayed behind.
    //
    // The drawing: two trips joined at Q3, LRUD on every arrival
    // station so there are real tips to snap to. Revising trip 1's
    // declination alone rotates trip 1 about Q3 and leaves trip 0
    // exactly where it was -- so one drawing exercises "moves" and
    // "must not move" at once.
    //
    // Everything is identified by getId(), never by shape or by
    // position in a query result: entity query order in this build is
    // NOT stable.
    // -----------------------------------------------------------------
    (function() {
        var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var di = new RDocumentInterface(doc);
        getDocument = function() { return doc; };
        getDocumentInterface = function() { return di; };

        var S = CsModel.newSurvey();
        S.declination = 1.0;
        S.declinationSource = "user";
        CsModel.ensureTrips(S);
        var qt = CsModel.newTrip();
        qt.name = "UPPER";
        qt.declination = 1.0;
        qt.declinationSource = "user";
        S.trips.push(qt);
        var qs = [shotOf("Q1", "Q2", 10, 0), shotOf("Q2", "Q3", 10, 90),
            shotOf("Q3", "Q4", 8, 45), shotOf("Q4", "Q5", 6, 120)];
        for (var qi = 0; qi < qs.length; qi++) {
            qs[qi].left = 2;
            qs[qi].right = 3;
            if (qi >= 2) {
                qs[qi].trip = 1;
            }
            S.shots.push(qs[qi]);
        }
        CsDraw.survey(S, CsNetwork.resolve(S, {}));

        var lwFind = function(key) {
            var res = [];
            var fids = doc.queryAllEntities(false, false);
            for (var fi = 0; fi < fids.length; fi++) {
                var fe = doc.queryEntity(fids[fi]);
                if (!isNull(fe) && CsTags.get(fe, key) !== "") {
                    res.push(fe);
                }
            }
            return res;
        };
        var tipAt = {};
        var lwTips = lwFind("LRUDName");
        for (var lt = 0; lt < lwTips.length; lt++) {
            tipAt[CsTags.get(lwTips[lt], "LRUDName")] =
                lwTips[lt].getPosition();
        }
        ok(tipAt["Q2.L"] !== undefined && tipAt["Q3.L"] !== undefined &&
            tipAt["Q4.L"] !== undefined && tipAt["Q5.L"] !== undefined,
            "linework: LRUD tips on both trips found to trace against");

        var addPl = function(layerName, pts) {
            CsLayers.ensure(doc, di, layerName);
            var pd = new RPolylineData();
            for (var pi = 0; pi < pts.length; pi++) {
                pd.appendVertex(new RVector(pts[pi].x, pts[pi].y));
            }
            var pl = new RPolylineEntity(doc, pd);
            pl.setLayerId(doc.getLayerId(layerName));
            var aop = new RAddObjectsOperation();
            aop.addObject(pl, false);
            di.applyOperation(aop);
            return pl;
        };
        var at = function(name) {
            return { x: tipAt[name].x, y: tipAt[name].y };
        };

        // a wall traced by SNAPPING to trip 1's two left-hand tips
        var wall1 = addPl("WALLS-SURVEYED", [at("Q4.L"), at("Q5.L")]);
        // and one on trip 0's, which this revision must leave alone
        var wall0 = addPl("WALLS-SURVEYED", [at("Q2.L"), at("Q3.L")]);
        var bidx = CsBind.stationIndex(doc);
        var beps = CsBind.epsilonFor(doc);
        var b1 = CsBind.bindEntity(doc, wall1, 1, bidx, beps);
        var b0 = CsBind.bindEntity(doc, wall0, 0, bidx, beps);
        ok(b1.source === "snap" &&
            b1.stations.slice(0).sort().join(",") === "Q4,Q5",
            "linework: the trip-1 wall binds Q4,Q5 by snap, got " +
            b1.source + " '" + b1.stations.join(",") + "'");
        ok(b0.source === "snap" &&
            b0.stations.slice(0).sort().join(",") === "Q2,Q3",
            "linework: the trip-0 wall binds Q2,Q3 by snap, got " +
            b0.source + " '" + b0.stations.join(",") + "'");

        // a sketch that snapped to nothing: LineworkTrip ALONE, no
        // station list. The mover has to see it through the trip tag --
        // keying on LineworkStations would skip exactly these.
        var tripOnly = addPl("BREAKDOWN",
            [{ x: 400, y: 400 }, { x: 402, y: 401 }]);
        // and one whose stations no longer exist at all: nothing to
        // follow, so it must be left alone and REPORTED, not guessed at
        var orphan = addPl("BREAKDOWN",
            [{ x: 600, y: 600 }, { x: 602, y: 601 }]);
        CsBind.tagEntities(doc, di, [
            { entity: wall1, trip: 1, stations: b1.stations },
            { entity: wall0, trip: 0, stations: b0.stations },
            { entity: tripOnly, trip: 1, stations: [] },
            { entity: orphan, trip: 9, stations: ["GONE1", "GONE2"] }
        ]);
        ok(CsTags.get(doc.queryEntity(tripOnly.getId()),
            CsBind.STATIONS_TAG) === "",
            "linework: the trip-only sketch really carries no station list");

        // Sheet furniture and ground-pinned imagery, each TAGGED as
        // linework on purpose: the assertion below is that the mover
        // consults CsBind.isLineworkLayer, not merely that these
        // entities happen to be untagged. NORTH-ARROW is the one that
        // matters most -- a declination revision re-orients the cave
        // against TRUE NORTH, so an arrow that turned with it would
        // make the sheet lie about which way north is.
        var furniture = {};
        var fLayers = ["NORTH-ARROW", "SCALE-BAR", "TITLE-BLOCK", "LEGEND",
            "BORDER", "TB_TEST", "CTRL-AERIAL"];
        for (var fl = 0; fl < fLayers.length; fl++) {
            var fEnt = addPl(fLayers[fl],
                [{ x: 50 + fl, y: 50 }, { x: 51 + fl, y: 52 }]);
            CsTags.commit(di, fEnt, { LineworkTrip: 1,
                LineworkStations: "Q4|Q5" });
            furniture[fLayers[fl]] = fEnt.getId();
        }

        var vertsOf = function(id) {
            return CsBind.pointsOf(doc.queryEntity(id));
        };
        var posOf = function() {
            var out = {};
            var sts = CsTags.collectStations(doc);
            for (var i = 0; i < sts.length; i++) {
                out[sts[i].name] = { x: sts[i].pos.x, y: sts[i].pos.y };
            }
            return out;
        };
        var ids = { wall1: wall1.getId(), wall0: wall0.getId(),
            tripOnly: tripOnly.getId(), orphan: orphan.getId() };
        var before = { wall1: vertsOf(ids.wall1), wall0: vertsOf(ids.wall0),
            tripOnly: vertsOf(ids.tripOnly),
            orphan: vertsOf(ids.orphan) };
        var fBefore = {};
        for (fl = 0; fl < fLayers.length; fl++) {
            fBefore[fLayers[fl]] = vertsOf(furniture[fLayers[fl]]);
        }
        var posBefore = posOf();

        var recon = CsRevise.surveyFromDocument(doc);
        var newSurvey = CsRevise.surveyFromDocument(doc).survey;
        CsRevise.reviseDeclination(newSurvey, 1, 11.0, "user"); // +10, trip 1
        var report = CsRevise.apply(doc, di, recon, newSurvey);
        ok(report.rigid === false,
            "linework: revising one trip of two is NOT rigid");

        var posAfter = posOf();
        // the fit each entity is entitled to: over ITS OWN stations,
        // old (pre-revision) -> new (as the redraw left them)
        var fitOver = function(names) {
            var pairs = [];
            for (var i = 0; i < names.length; i++) {
                pairs.push({ old: posBefore[names[i]],
                    nu: posAfter[names[i]] });
            }
            return CsRevise.similarityFit(pairs);
        };
        var checkFollows = function(what, id, fit, was) {
            var got = vertsOf(id);
            ok(got.length === was.length,
                "linework: " + what + " still has " + was.length +
                " vertices, got " + got.length);
            for (var i = 0; i < Math.min(got.length, was.length); i++) {
                var pred = CsRevise.applyFit(fit, was[i]);
                near(got[i].x, pred.x, 1e-6,
                    "linework: " + what + " vertex " + i + " x lands on " +
                    "its own stations' fit");
                near(got[i].y, pred.y, 1e-6,
                    "linework: " + what + " vertex " + i + " y lands on " +
                    "its own stations' fit");
            }
        };

        var fit1 = fitOver(["Q4", "Q5"]);
        near(fit1.maxResidual, 0, 1e-9,
            "linework: the trip-1 stations moved as one rigid piece");
        ok(Math.abs(fit1.theta) > 1e-3,
            "linework: and that piece really turned, theta " + fit1.theta);
        checkFollows("the trip-1 wall", ids.wall1, fit1, before.wall1);
        // ... and it MOVED: a fit that predicted "stay put" would pass
        // the check above for the wrong reason
        var w1After = vertsOf(ids.wall1);
        ok(Math.abs(w1After[0].x - before.wall1[0].x) > 1e-3 ||
            Math.abs(w1After[0].y - before.wall1[0].y) > 1e-3,
            "linework: the trip-1 wall really moved");

        // trip 0 did not move, so neither may anything traced on it
        for (var w = 0; w < before.wall0.length; w++) {
            near(vertsOf(ids.wall0)[w].x, before.wall0[w].x, 1e-9,
                "linework: trip-0 wall vertex " + w + " x UNCHANGED");
            near(vertsOf(ids.wall0)[w].y, before.wall0[w].y, 1e-9,
                "linework: trip-0 wall vertex " + w + " y UNCHANGED");
        }

        // the trip-only sketch follows its whole trip's fit
        checkFollows("the trip-only sketch", ids.tripOnly,
            fitOver(["Q3", "Q4", "Q5"]), before.tripOnly);

        // the orphan: reported, and NOT damaged in the process
        ok(report.lineworkUnmoved.length === 1,
            "linework: exactly one entity had nothing left to follow, got " +
            report.lineworkUnmoved.length + " [" +
            report.lineworkUnmoved.join(", ") + "]");
        ok(report.lineworkUnmoved.length === 1 &&
            report.lineworkUnmoved[0].indexOf("BREAKDOWN") === 0,
            "linework: the unmoved entity is named by its layer, got '" +
            report.lineworkUnmoved.join(", ") + "'");
        var orphanAfter = vertsOf(ids.orphan);
        ok(orphanAfter.length === 2,
            "linework: the orphan tracing is intact, got " +
            orphanAfter.length + " vertices");
        near(orphanAfter[0].x, before.orphan[0].x, 1e-9,
            "linework: the orphan tracing did not move");
        near(orphanAfter[0].y, before.orphan[0].y, 1e-9,
            "linework: the orphan tracing did not move (y)");

        ok(report.lineworkMoved === 3,
            "linework: three bound entities followed their stations, got " +
            report.lineworkMoved);

        // sheet furniture and the georeferenced basemap: tagged, on a
        // world-fixed layer, and therefore untouched
        for (fl = 0; fl < fLayers.length; fl++) {
            var fName = fLayers[fl];
            var fGot = vertsOf(furniture[fName]);
            var fWas = fBefore[fName];
            var same = fGot.length === fWas.length;
            for (var fv = 0; same && fv < fWas.length; fv++) {
                same = Math.abs(fGot[fv].x - fWas[fv].x) < 1e-9 &&
                    Math.abs(fGot[fv].y - fWas[fv].y) < 1e-9;
            }
            ok(same, "linework: an entity on " + fName + " did NOT move, " +
                "even tagged as linework" +
                (fName === "NORTH-ARROW" ? " -- an arrow that turned with " +
                    "the cave would make the map lie about north" : ""));
        }

        var summary = CsReport.revisionSummary(report);
        ok(summary.indexOf("Traced linework moved with its stations: 3") >= 0,
            "linework: the summary states how much followed, got '" +
            summary + "'");
        ok(summary.indexOf("re-trace") >= 0,
            "linework: the summary still warns about what did not follow");
    })();

    // -----------------------------------------------------------------
    // The SECOND way to revise a trip in place: the Survey Notebook's
    // Draw. It merges the page into the reconstructed survey, erases by
    // station name and redraws with CsDraw.survey -- it never goes near
    // CsRevise.apply -- so before this fix a trip revised through the
    // page moved the survey and left every traced wall behind. That is
    // the failure Nathan hit in a real drawing: a spline traced round a
    // station stayed put while the passage swung under it.
    //
    // The page's Az cells are MAGNETIC and the header's Decl converts
    // them (see sheetSurvey), so retyping Decl and pressing Draw is the
    // ordinary way in. Simulated here by re-converting the loaded
    // trip's cells through a new header, which is exactly what the
    // page's own cells would have produced.
    //
    // Keyed on getId() throughout: entity query order is NOT stable.
    // -----------------------------------------------------------------
    loadRepoScript("scripts/CaveSurvey/Core/CsPick.js");
    loadRepoScript("scripts/CaveSurvey/SurveyNotebook/SurveyNotebook.js");
    (function() {
        var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var di = new RDocumentInterface(doc);
        getDocument = function() { return doc; };
        getDocumentInterface = function() { return di; };

        // two trips joined at N3, distinct fingerprints (date | team) so
        // the page can be matched back to trip 1 and REPLACE it
        var S = CsModel.newSurvey();
        S.date = "2001-01-01";
        S.team = "LOWER TEAM";
        S.declination = 1.0;
        S.declinationSource = "user";
        CsModel.ensureTrips(S);
        var upper = CsModel.newTrip();
        upper.name = "UPPER";
        upper.date = "2002-02-02";
        upper.team = "UPPER TEAM";
        upper.declination = 1.0;
        upper.declinationSource = "user";
        S.trips.push(upper);
        var ns = [shotOf("N1", "N2", 10, 0), shotOf("N2", "N3", 10, 90),
            shotOf("N3", "N4", 8, 45), shotOf("N4", "N5", 6, 120)];
        for (var i = 0; i < ns.length; i++) {
            ns[i].left = 2;
            ns[i].right = 3;
            if (i >= 2) {
                ns[i].trip = 1; // the trip the page will revise
            }
            S.shots.push(ns[i]);
        }
        CsDraw.survey(S, CsNetwork.resolve(S, {}));

        var tipAt = {};
        var scan = doc.queryAllEntities(false, false);
        for (i = 0; i < scan.length; i++) {
            var se = doc.queryEntity(scan[i]);
            if (!isNull(se) && CsTags.get(se, "LRUDName") !== "") {
                tipAt[CsTags.get(se, "LRUDName")] = se.getPosition();
            }
        }
        ok(tipAt["N3.L"] !== undefined && tipAt["N4.L"] !== undefined &&
            tipAt["N5.L"] !== undefined,
            "notebook-linework: LRUD tips on both trips to trace against");
        var at = function(name) {
            return { x: tipAt[name].x, y: tipAt[name].y };
        };
        var stationAt = CsRevise.stationPositions(doc);

        var addPl = function(layerName, pts, closed) {
            CsLayers.ensure(doc, di, layerName);
            var pd = new RPolylineData();
            for (var pi = 0; pi < pts.length; pi++) {
                pd.appendVertex(new RVector(pts[pi].x, pts[pi].y));
            }
            if (closed === true) {
                try {
                    pd.setClosed(true);
                } catch (eClose) {
                    // an open ring still exercises the same binding
                }
            }
            var pl = new RPolylineEntity(doc, pd);
            pl.setLayerId(doc.getLayerId(layerName));
            var aop = new RAddObjectsOperation();
            aop.addObject(pl, false);
            di.applyOperation(aop);
            return pl;
        };

        // a wall traced by SNAPPING to trip 1's left-hand tips, and one
        // on trip 0's, which this revision must leave exactly alone
        var wall1 = addPl("WALLS-SURVEYED", [at("N4.L"), at("N5.L")]);
        var wall0 = addPl("WALLS-SURVEYED", [at("N2.L"), at("N3.L")]);
        // and Nathan's case: a closed ring drawn AROUND a station,
        // snapped to nothing, bound by PROXIMITY
        var ring = addPl("BREAKDOWN", [
            { x: stationAt.N5.x + 0.4, y: stationAt.N5.y },
            { x: stationAt.N5.x, y: stationAt.N5.y + 0.4 },
            { x: stationAt.N5.x - 0.4, y: stationAt.N5.y },
            { x: stationAt.N5.x, y: stationAt.N5.y - 0.4 }], true);
        // an untagged tracing: invisible to us, so untouched. Guessing
        // is what the design rejected.
        var loose = addPl("WALLS-SURVEYED",
            [{ x: 400, y: 400 }, { x: 403, y: 401 }]);

        var bidx = CsBind.stationIndex(doc);
        var beps = CsBind.epsilonFor(doc);
        var b1 = CsBind.bindEntity(doc, wall1, 1, bidx, beps);
        var b0 = CsBind.bindEntity(doc, wall0, 0, bidx, beps);
        var bR = CsBind.bindEntity(doc, ring, 1, bidx, beps);
        ok(b1.source === "snap" &&
            b1.stations.slice(0).sort().join(",") === "N4,N5",
            "notebook-linework: the trip-1 wall binds N4,N5 by snap, got " +
            b1.source + " '" + b1.stations.join(",") + "'");
        ok(b0.source === "snap" &&
            b0.stations.slice(0).sort().join(",") === "N2,N3",
            "notebook-linework: the trip-0 wall binds N2,N3 by snap, got " +
            b0.source + " '" + b0.stations.join(",") + "'");
        ok(bR.source === "proximity" && bR.stations.length > 0,
            "notebook-linework: the ring binds by proximity, got " +
            bR.source + " '" + bR.stations.join(",") + "'");
        var ringTrip1Only = true;
        for (i = 0; i < bR.stations.length; i++) {
            if (bR.stations[i] !== "N4" && bR.stations[i] !== "N5") {
                ringTrip1Only = false;
            }
        }
        ok(ringTrip1Only,
            "notebook-linework: the ring bound only trip-1 stations, so " +
            "one rigid move honestly describes it -- got '" +
            bR.stations.join(",") + "'");
        CsBind.tagEntities(doc, di, [
            { entity: wall1, trip: 1, stations: b1.stations },
            { entity: wall0, trip: 0, stations: b0.stations },
            { entity: ring, trip: 1, stations: bR.stations }
        ]);

        var vertsOf = function(id) {
            return CsBind.pointsOf(doc.queryEntity(id));
        };
        var ids = { wall1: wall1.getId(), wall0: wall0.getId(),
            ring: ring.getId(), loose: loose.getId() };
        var before = { wall1: vertsOf(ids.wall1),
            wall0: vertsOf(ids.wall0), ring: vertsOf(ids.ring),
            loose: vertsOf(ids.loose) };
        var posBefore = CsRevise.stationPositions(doc);

        // -- the page: trip 1 loaded, its Decl cell retyped 1 -> 11 ---
        var recon = CsRevise.surveyFromDocument(doc);
        var page = SurveyNotebook.tripSurvey(recon.survey, 1);
        var wasDecl = page.declination;
        page.declination = 11.0;
        page.declinationSource = "user";
        for (i = 0; i < page.shots.length; i++) {
            // back out the old header to recover what the compass read,
            // then forward through the new one: precisely what
            // sheetSurvey does to the untouched Az cells
            var mag = CsAngles.applyDeclination(page.shots[i].azimuth,
                -wasDecl);
            page.shots[i].azimuth = CsAngles.applyDeclination(mag, 11.0);
            page.shots[i].declination = null; // the page has no such cell
        }

        // Proof that nothing can move twice: count both entry points
        // across the one user action. Draw must never reach apply (whose
        // rigid branch transforms the whole drawing), and the mover must
        // run exactly once.
        var realApply = CsRevise.apply;
        var realMove = CsRevise.moveLinework;
        var applyCalls = 0, moveCalls = 0;
        CsRevise.apply = function() {
            applyCalls++;
            return realApply.apply(CsRevise, arguments);
        };
        CsRevise.moveLinework = function() {
            moveCalls++;
            return realMove.apply(CsRevise, arguments);
        };
        // headless: capture the Draw report instead of showing it
        var realBox = (typeof QMessageBox !== "undefined") ?
            QMessageBox : undefined;
        var boxText = "";
        QMessageBox = {
            information: function(parent, title, text) {
                boxText = String(text);
            },
            warning: function(parent, title, text) {
                boxText = "WARNING BOX: " + String(text);
            }
        };
        try {
            // w (the dock) is untouched by this function -- the page is
            // passed in as a survey
            SurveyNotebook.drawMergedSurvey(null, doc, page, recon);
        } finally {
            CsRevise.apply = realApply;
            CsRevise.moveLinework = realMove;
            QMessageBox = realBox;
        }

        ok(applyCalls === 0,
            "notebook-linework: Draw never reaches CsRevise.apply, so " +
            "no entity can be transformed by both paths, got " +
            applyCalls + " calls");
        ok(moveCalls === 1,
            "notebook-linework: the linework mover ran exactly once for " +
            "the one Draw, got " + moveCalls);

        var posAfter = CsRevise.stationPositions(doc);
        ok(posAfter.N5 !== undefined &&
            Math.abs(posAfter.N5.x - posBefore.N5.x) > 1e-3,
            "notebook-linework: the revision really moved trip 1 -- " +
            "without that the checks below would pass for nothing");
        near(posAfter.N2.x, posBefore.N2.x, 1e-9,
            "notebook-linework: trip 0 stayed put (x)");
        near(posAfter.N2.y, posBefore.N2.y, 1e-9,
            "notebook-linework: trip 0 stayed put (y)");

        // what each entity is entitled to: a fit over ITS OWN stations,
        // old (as traced) -> new (as the redraw left them)
        var fitOver = function(names) {
            var pairs = [];
            for (var k = 0; k < names.length; k++) {
                pairs.push({ old: posBefore[names[k]],
                    nu: posAfter[names[k]] });
            }
            return CsRevise.similarityFit(pairs);
        };
        var follows = function(what, id, fit, was) {
            var got = vertsOf(id);
            ok(got.length === was.length,
                "notebook-linework: " + what + " still has " +
                was.length + " vertices, got " + got.length);
            for (var k = 0; k < Math.min(got.length, was.length); k++) {
                var pred = CsRevise.applyFit(fit, was[k]);
                near(got[k].x, pred.x, 1e-6, "notebook-linework: " +
                    what + " vertex " + k + " x lands on its own " +
                    "stations' fit");
                near(got[k].y, pred.y, 1e-6, "notebook-linework: " +
                    what + " vertex " + k + " y lands on its own " +
                    "stations' fit");
            }
        };

        var fit1 = fitOver(["N4", "N5"]);
        near(fit1.maxResidual, 0, 1e-9,
            "notebook-linework: trip 1's stations moved as one piece");
        ok(Math.abs(fit1.theta) > 1e-3,
            "notebook-linework: and that piece really turned, theta " +
            fit1.theta);
        follows("the trip-1 wall", ids.wall1, fit1, before.wall1);
        var w1 = vertsOf(ids.wall1);
        ok(Math.abs(w1[0].x - before.wall1[0].x) > 1e-3 ||
            Math.abs(w1[0].y - before.wall1[0].y) > 1e-3,
            "notebook-linework: the trip-1 wall really moved");

        follows("the proximity-bound ring", ids.ring,
            fitOver(bR.stations), before.ring);
        var rg = vertsOf(ids.ring);
        ok(Math.abs(rg[0].x - before.ring[0].x) > 1e-3 ||
            Math.abs(rg[0].y - before.ring[0].y) > 1e-3,
            "notebook-linework: the ring really followed its station -- " +
            "this is the exact stay-put Nathan saw");

        // trip 0 did not move, so neither may anything traced on it
        for (i = 0; i < before.wall0.length; i++) {
            near(vertsOf(ids.wall0)[i].x, before.wall0[i].x, 1e-9,
                "notebook-linework: trip-0 wall vertex " + i + " x " +
                "UNCHANGED");
            near(vertsOf(ids.wall0)[i].y, before.wall0[i].y, 1e-9,
                "notebook-linework: trip-0 wall vertex " + i + " y " +
                "UNCHANGED");
        }
        // and the untagged tracing is invisible to us: untouched
        for (i = 0; i < before.loose.length; i++) {
            near(vertsOf(ids.loose)[i].x, before.loose[i].x, 1e-9,
                "notebook-linework: an UNTAGGED tracing did not move (x)");
            near(vertsOf(ids.loose)[i].y, before.loose[i].y, 1e-9,
                "notebook-linework: an UNTAGGED tracing did not move (y)");
        }

        // reported in the words the other revision path uses
        ok(boxText.indexOf(
            "Traced linework moved with its stations: 3") >= 0,
            "notebook-linework: the Draw report says how much followed, " +
            "got '" + boxText + "'");
        ok(boxText.indexOf("re-trace") < 0,
            "notebook-linework: nothing was left behind, so no re-trace " +
            "warning, got '" + boxText + "'");
        ok(boxText.indexOf("the linework move is a further one") >= 0,
            "notebook-linework: the report says the move is its own " +
            "undo step, got '" + boxText + "'");
    })();

    // -----------------------------------------------------------------
    // ... and the same Draw on a page that only ADDS a trip disturbs no
    // existing station, so it must not touch linework, claim any, cost
    // an undo step, or warn about re-tracing something that did not
    // move. The claim is the part worth insisting on: automatic binding
    // writes tags onto the user's own geometry, and doing that for a
    // revision that turned out to be a no-op would be a change to their
    // drawing in exchange for nothing.
    // -----------------------------------------------------------------
    (function() {
        var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var di = new RDocumentInterface(doc);
        getDocument = function() { return doc; };
        getDocumentInterface = function() { return di; };

        var S = CsModel.newSurvey();
        S.date = "2003-03-03";
        S.team = "FIRST";
        CsModel.ensureTrips(S);
        S.shots.push(shotOf("P1", "P2", 10, 0));
        S.shots.push(shotOf("P2", "P3", 10, 90));
        CsDraw.survey(S, CsNetwork.resolve(S, {}));
        var posBefore = CsRevise.stationPositions(doc);

        // an untagged tracing right on top of the survey: bindable, and
        // so exactly what must NOT be claimed by a Draw that moves
        // nothing
        CsLayers.ensure(doc, di, "WALLS-SURVEYED");
        var addPd = new RPolylineData();
        addPd.appendVertex(new RVector(posBefore.P1.x, posBefore.P1.y));
        addPd.appendVertex(new RVector(posBefore.P2.x, posBefore.P2.y));
        var addPl = new RPolylineEntity(doc, addPd);
        addPl.setLayerId(doc.getLayerId("WALLS-SURVEYED"));
        var addOp = new RAddObjectsOperation();
        addOp.addObject(addPl, false);
        di.applyOperation(addOp);
        var addId = addPl.getId();

        var recon = CsRevise.surveyFromDocument(doc);
        var page = CsModel.newSurvey();
        page.date = "2004-04-04";   // a fingerprint nothing matches
        page.team = "SECOND";
        page.shots.push(shotOf("P3", "P4", 7, 180));

        var realMove = CsRevise.moveLinework;
        var moveCalls = 0;
        CsRevise.moveLinework = function() {
            moveCalls++;
            return realMove.apply(CsRevise, arguments);
        };
        var realBox = (typeof QMessageBox !== "undefined") ?
            QMessageBox : undefined;
        var boxText = "";
        QMessageBox = {
            information: function(parent, title, text) {
                boxText = String(text);
            },
            warning: function(parent, title, text) {
                boxText = "WARNING BOX: " + String(text);
            }
        };
        try {
            SurveyNotebook.drawMergedSurvey(null, doc, page, recon);
        } finally {
            CsRevise.moveLinework = realMove;
            QMessageBox = realBox;
        }

        var posAfter = CsRevise.stationPositions(doc);
        near(posAfter.P1.x, posBefore.P1.x, 1e-9,
            "notebook-add: adding a trip moved no existing station");
        near(posAfter.P3.y, posBefore.P3.y, 1e-9,
            "notebook-add: the junction station stayed put too");
        ok(moveCalls === 0,
            "notebook-add: nothing moved, so the linework mover was " +
            "never asked, got " + moveCalls + " calls");
        ok(boxText.indexOf("Traced linework") < 0 &&
            boxText.indexOf("re-trace") < 0,
            "notebook-add: and the report says nothing about linework " +
            "for an event that did not happen, got '" + boxText + "'");
        ok(CsBind.hasLineworkTags(doc.queryEntity(addId)) === false,
            "notebook-add: a bindable untagged tracing is NOT claimed by " +
            "a Draw that moved nothing -- automatic binding writes tags " +
            "onto the user's geometry, and it owes them a reason");
        ok(boxText.indexOf("bound automatically") < 0,
            "notebook-add: and nothing is claimed out loud either, got '" +
            boxText + "'");
    })();

    // -----------------------------------------------------------------
    // AUTOMATIC BINDING, end to end. The point of the redesign: Nathan
    // drew a spline round a station, adopted it, revised, and it
    // followed -- but only because he remembered to adopt. Nobody
    // should have to.
    //
    // One drawing, two trips joined at M3, and five kinds of entity
    // that between them cover every decision this pass makes:
    //
    //   autoWall   untagged, snapped to trip 1's LRUD tips -> claimed,
    //              tagged trip 1 (INFERRED, never told), and moved
    //   autoRing   untagged closed ring round M5, snapped to nothing ->
    //              claimed by proximity and moved. Nathan's spline
    //   trip0Wall  untagged, snapped to trip 0's tips -> claimed and
    //              tagged trip ZERO from the same pass, in the same
    //              drawing, which is the proof that the trip comes off
    //              the geometry and not from a mode
    //   already    tagged BY HAND with a narrower station list than
    //              snapping would give -> its tags survive untouched
    //   far        untagged, nowhere near the survey -> never claimed,
    //              never moved
    //   ctrl/arrow untagged but on CTRL-SHOTS / NORTH-ARROW -> never
    //              claimed, whatever they sit on top of
    //
    // Keyed on getId() throughout: entity query order is NOT stable.
    // -----------------------------------------------------------------
    (function() {
        var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var di = new RDocumentInterface(doc);
        getDocument = function() { return doc; };
        getDocumentInterface = function() { return di; };

        var S = CsModel.newSurvey();
        S.date = "2005-05-05";
        S.team = "LOWER";
        S.declination = 1.0;
        S.declinationSource = "user";
        CsModel.ensureTrips(S);
        var upper = CsModel.newTrip();
        upper.name = "UPPER";
        upper.date = "2006-06-06";
        upper.team = "UPPER TEAM";
        upper.declination = 1.0;
        upper.declinationSource = "user";
        S.trips.push(upper);
        var ms = [shotOf("M1", "M2", 10, 0), shotOf("M2", "M3", 10, 90),
            shotOf("M3", "M4", 8, 45), shotOf("M4", "M5", 6, 120)];
        for (var i = 0; i < ms.length; i++) {
            ms[i].left = 2;
            ms[i].right = 3;
            if (i >= 2) {
                ms[i].trip = 1;
            }
            S.shots.push(ms[i]);
        }
        CsDraw.survey(S, CsNetwork.resolve(S, {}));

        var tipAt = {};
        var scan = doc.queryAllEntities(false, false);
        for (i = 0; i < scan.length; i++) {
            var se = doc.queryEntity(scan[i]);
            if (!isNull(se) && CsTags.get(se, "LRUDName") !== "") {
                tipAt[CsTags.get(se, "LRUDName")] = se.getPosition();
            }
        }
        var at = function(name) {
            return { x: tipAt[name].x, y: tipAt[name].y };
        };
        var stationAt = CsRevise.stationPositions(doc);
        ok(tipAt["M2.L"] !== undefined && tipAt["M4.L"] !== undefined &&
            tipAt["M5.L"] !== undefined,
            "auto-bind: LRUD tips on both trips to trace against");

        var addPl = function(layerName, pts, closed) {
            CsLayers.ensure(doc, di, layerName);
            var pd = new RPolylineData();
            for (var pi = 0; pi < pts.length; pi++) {
                pd.appendVertex(new RVector(pts[pi].x, pts[pi].y));
            }
            if (closed === true) {
                try {
                    pd.setClosed(true);
                } catch (eClose) {
                    // an open ring exercises the same binding
                }
            }
            var pl = new RPolylineEntity(doc, pd);
            pl.setLayerId(doc.getLayerId(layerName));
            var aop = new RAddObjectsOperation();
            aop.addObject(pl, false);
            di.applyOperation(aop);
            return pl;
        };

        var autoWall = addPl("WALLS-SURVEYED", [at("M4.L"), at("M5.L")]);
        var autoRing = addPl("BREAKDOWN", [
            { x: stationAt.M5.x + 0.4, y: stationAt.M5.y },
            { x: stationAt.M5.x, y: stationAt.M5.y + 0.4 },
            { x: stationAt.M5.x - 0.4, y: stationAt.M5.y },
            { x: stationAt.M5.x, y: stationAt.M5.y - 0.4 }], true);
        var trip0Wall = addPl("WALLS-SURVEYED", [at("M2.L"), at("M3.L")]);
        var already = addPl("WALLS-SURVEYED", [at("M4.R"), at("M5.R")]);
        var far = addPl("WALLS-SURVEYED",
            [{ x: 900, y: 900 }, { x: 903, y: 901 }]);
        var ctrl = addPl("CTRL-SHOTS",
            [at("M4.L"), { x: stationAt.M5.x, y: stationAt.M5.y }]);
        var arrow = addPl("NORTH-ARROW",
            [at("M4.L"), { x: stationAt.M5.x, y: stationAt.M5.y }]);

        // the deliberate adoption the automatic pass must not overrule:
        // M4 ALONE, though snapping would have found M4 and M5
        CsBind.tagEntities(doc, di, [
            { entity: already, trip: 1, stations: ["M4"] }
        ]);

        var vertsOf = function(id) {
            return CsBind.pointsOf(doc.queryEntity(id));
        };
        var ids = { autoWall: autoWall.getId(), autoRing: autoRing.getId(),
            trip0Wall: trip0Wall.getId(), already: already.getId(),
            far: far.getId(), ctrl: ctrl.getId(), arrow: arrow.getId() };
        var before = {};
        for (var k in ids) {
            if (ids.hasOwnProperty(k)) {
                before[k] = vertsOf(ids[k]);
            }
        }
        var posBefore = CsRevise.stationPositions(doc);

        // -- the page: trip 1 loaded, its Decl cell retyped 1 -> 11 ---
        var recon = CsRevise.surveyFromDocument(doc);
        var page = SurveyNotebook.tripSurvey(recon.survey, 1);
        var wasDecl = page.declination;
        page.declination = 11.0;
        page.declinationSource = "user";
        for (i = 0; i < page.shots.length; i++) {
            var mag = CsAngles.applyDeclination(page.shots[i].azimuth,
                -wasDecl);
            page.shots[i].azimuth = CsAngles.applyDeclination(mag, 11.0);
            page.shots[i].declination = null;
        }

        var realBox = (typeof QMessageBox !== "undefined") ?
            QMessageBox : undefined;
        var realOverride = CsBind.autoBindOverride;
        var boxText = "";
        QMessageBox = {
            information: function(parent, title, text) {
                boxText = String(text);
            },
            warning: function(parent, title, text) {
                boxText = "WARNING BOX: " + String(text);
            }
        };
        try {
            // forced ON rather than left to the real setting: this
            // asserts the behaviour, not the tester's preferences
            CsBind.autoBindOverride = true;
            SurveyNotebook.drawMergedSurvey(null, doc, page, recon);
        } finally {
            CsBind.autoBindOverride = realOverride;
            QMessageBox = realBox;
        }

        var posAfter = CsRevise.stationPositions(doc);
        ok(Math.abs(posAfter.M5.x - posBefore.M5.x) > 1e-3,
            "auto-bind: the revision really moved trip 1 -- without that " +
            "everything below would pass for nothing");

        var tagsOf = function(id) {
            var e = doc.queryEntity(id);
            return { trip: CsTags.getNumber(e, CsBind.TRIP_TAG),
                stations: CsBind.decodeStations(
                    CsTags.get(e, CsBind.STATIONS_TAG)).slice(0).sort()
                    .join(",") };
        };
        var fitOver = function(names) {
            var pairs = [];
            for (var n = 0; n < names.length; n++) {
                pairs.push({ old: posBefore[names[n]],
                    nu: posAfter[names[n]] });
            }
            return CsRevise.similarityFit(pairs);
        };
        var follows = function(what, id, fit) {
            var got = vertsOf(id);
            var was = before[what];
            ok(got.length === was.length,
                "auto-bind: " + what + " still has " + was.length +
                " vertices, got " + got.length);
            var movedAtAll = false;
            for (var n = 0; n < Math.min(got.length, was.length); n++) {
                var pred = CsRevise.applyFit(fit, was[n]);
                near(got[n].x, pred.x, 1e-6, "auto-bind: " + what +
                    " vertex " + n + " x lands on its own stations' fit");
                near(got[n].y, pred.y, 1e-6, "auto-bind: " + what +
                    " vertex " + n + " y lands on its own stations' fit");
                if (Math.abs(got[n].x - was[n].x) > 1e-3 ||
                        Math.abs(got[n].y - was[n].y) > 1e-3) {
                    movedAtAll = true;
                }
            }
            ok(movedAtAll, "auto-bind: " + what + " really moved -- a fit " +
                "that predicted 'stay put' would pass for the wrong reason");
        };
        var stayedPut = function(what, id) {
            var got = vertsOf(id);
            var was = before[what];
            var same = got.length === was.length;
            for (var n = 0; same && n < was.length; n++) {
                same = Math.abs(got[n].x - was[n].x) < 1e-9 &&
                    Math.abs(got[n].y - was[n].y) < 1e-9;
            }
            ok(same, "auto-bind: " + what + " did not move");
        };

        // 1: claimed, tagged with the INFERRED trip, and moved
        var wallTags = tagsOf(ids.autoWall);
        ok(wallTags.trip === 1 && wallTags.stations === "M4,M5",
            "auto-bind: the untagged wall was bound to M4,M5 and to trip " +
            "1 -- inferred from those stations, never told -- got trip " +
            wallTags.trip + " '" + wallTags.stations + "'");
        follows("autoWall", ids.autoWall, fitOver(["M4", "M5"]));

        // 2: Nathan's ring -- snapped to nothing, bound by proximity
        var ringTags = tagsOf(ids.autoRing);
        ok(ringTags.trip === 1 && ringTags.stations !== "",
            "auto-bind: the ring drawn AROUND a station was bound by " +
            "proximity to trip 1, got trip " + ringTags.trip + " '" +
            ringTags.stations + "'");
        follows("autoRing", ids.autoRing,
            fitOver(CsBind.decodeStations(CsTags.get(
                doc.queryEntity(ids.autoRing), CsBind.STATIONS_TAG))));

        // 3: the SAME pass, the SAME drawing, the other trip
        var t0Tags = tagsOf(ids.trip0Wall);
        ok(t0Tags.trip === 0 && t0Tags.stations === "M2,M3",
            "auto-bind: the wall over trip 0 was tagged trip ZERO by the " +
            "same pass -- the trip comes off the geometry, not from a " +
            "mode -- got trip " + t0Tags.trip + " '" + t0Tags.stations + "'");
        stayedPut("trip0Wall", ids.trip0Wall);

        // 4: a deliberate adoption is not second-guessed
        var alreadyTags = tagsOf(ids.already);
        ok(alreadyTags.stations === "M4",
            "auto-bind: an already-tagged entity keeps the station list " +
            "the user gave it (M4 alone, though snapping would say " +
            "M4,M5), got '" + alreadyTags.stations + "'");
        ok(alreadyTags.trip === 1,
            "auto-bind: and its trip tag is untouched, got " +
            alreadyTags.trip);
        follows("already", ids.already, fitOver(["M4"]));

        // 5: far away, and therefore not ours
        ok(CsBind.hasLineworkTags(doc.queryEntity(ids.far)) === false,
            "auto-bind: an entity that binds to NOTHING is left untagged " +
            "-- claiming unrelated construction geometry is the failure " +
            "nobody would notice until it moved");
        stayedPut("far", ids.far);

        // 6: the layer gate holds even sitting on top of the survey
        ok(CsBind.hasLineworkTags(doc.queryEntity(ids.ctrl)) === false,
            "auto-bind: nothing on CTRL-* is ever claimed");
        stayedPut("ctrl", ids.ctrl);
        ok(CsBind.hasLineworkTags(doc.queryEntity(ids.arrow)) === false,
            "auto-bind: nothing on a world-fixed layer is claimed either " +
            "-- a north arrow that turned with the cave would make the " +
            "sheet lie about north");
        stayedPut("arrow", ids.arrow);

        // 7: said out loud. Taking ownership of the user's geometry is
        // the price of automatic, so the count is reported.
        ok(boxText.indexOf("3 were bound automatically") >= 0,
            "auto-bind: the report names how many it claimed, got '" +
            boxText + "'");
        // 4, not 3: the trip-0 wall followed its own stations too, and
        // their fit is the identity because trip 0 did not move. "Moved
        // with its stations" is the honest description of that -- it is
        // exactly where it should be.
        ok(boxText.indexOf("Traced linework moved with its stations: 4") >= 0,
            "auto-bind: and how many followed, apart from the claim, got '" +
            boxText + "'");
        ok(boxText.indexOf("binding 3 untagged items was a further one") >= 0,
            "auto-bind: and that the binding is its own undo step, got '" +
            boxText + "'");
    })();

    // -----------------------------------------------------------------
    // The NEGATIVE CONTROL: the switch off. Nothing is claimed, nothing
    // the user did not bind themselves moves -- and linework they DID
    // bind still follows its stations, because turning off the
    // convenience must not turn off the feature.
    // -----------------------------------------------------------------
    (function() {
        var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var di = new RDocumentInterface(doc);
        getDocument = function() { return doc; };
        getDocumentInterface = function() { return di; };

        var S = CsModel.newSurvey();
        S.date = "2007-07-07";
        S.team = "LOWER";
        S.declination = 1.0;
        S.declinationSource = "user";
        CsModel.ensureTrips(S);
        var upper = CsModel.newTrip();
        upper.name = "UPPER";
        upper.date = "2008-08-08";
        upper.team = "UPPER TEAM";
        upper.declination = 1.0;
        upper.declinationSource = "user";
        S.trips.push(upper);
        var os = [shotOf("O1", "O2", 10, 0), shotOf("O2", "O3", 10, 90),
            shotOf("O3", "O4", 8, 45), shotOf("O4", "O5", 6, 120)];
        for (var i = 0; i < os.length; i++) {
            os[i].left = 2;
            os[i].right = 3;
            if (i >= 2) {
                os[i].trip = 1;
            }
            S.shots.push(os[i]);
        }
        CsDraw.survey(S, CsNetwork.resolve(S, {}));

        var tipAt = {};
        var scan = doc.queryAllEntities(false, false);
        for (i = 0; i < scan.length; i++) {
            var se = doc.queryEntity(scan[i]);
            if (!isNull(se) && CsTags.get(se, "LRUDName") !== "") {
                tipAt[CsTags.get(se, "LRUDName")] = se.getPosition();
            }
        }
        var at = function(name) {
            return { x: tipAt[name].x, y: tipAt[name].y };
        };
        var addPl = function(layerName, pts) {
            CsLayers.ensure(doc, di, layerName);
            var pd = new RPolylineData();
            for (var pi = 0; pi < pts.length; pi++) {
                pd.appendVertex(new RVector(pts[pi].x, pts[pi].y));
            }
            var pl = new RPolylineEntity(doc, pd);
            pl.setLayerId(doc.getLayerId(layerName));
            var aop = new RAddObjectsOperation();
            aop.addObject(pl, false);
            di.applyOperation(aop);
            return pl;
        };

        var untagged = addPl("WALLS-SURVEYED", [at("O4.L"), at("O5.L")]);
        var tagged = addPl("WALLS-SURVEYED", [at("O4.R"), at("O5.R")]);
        CsBind.tagEntities(doc, di, [
            { entity: tagged, trip: 1, stations: ["O4", "O5"] }
        ]);
        var vertsOf = function(id) {
            return CsBind.pointsOf(doc.queryEntity(id));
        };
        var ids = { untagged: untagged.getId(), tagged: tagged.getId() };
        var before = { untagged: vertsOf(ids.untagged),
            tagged: vertsOf(ids.tagged) };
        var posBefore = CsRevise.stationPositions(doc);

        var recon = CsRevise.surveyFromDocument(doc);
        var page = SurveyNotebook.tripSurvey(recon.survey, 1);
        var wasDecl = page.declination;
        page.declination = 11.0;
        page.declinationSource = "user";
        for (i = 0; i < page.shots.length; i++) {
            var mag = CsAngles.applyDeclination(page.shots[i].azimuth,
                -wasDecl);
            page.shots[i].azimuth = CsAngles.applyDeclination(mag, 11.0);
            page.shots[i].declination = null;
        }

        var realBox = (typeof QMessageBox !== "undefined") ?
            QMessageBox : undefined;
        var realOverride = CsBind.autoBindOverride;
        var boxText = "";
        QMessageBox = {
            information: function(parent, title, text) {
                boxText = String(text);
            },
            warning: function(parent, title, text) {
                boxText = "WARNING BOX: " + String(text);
            }
        };
        try {
            CsBind.autoBindOverride = false; // opted out
            SurveyNotebook.drawMergedSurvey(null, doc, page, recon);
        } finally {
            CsBind.autoBindOverride = realOverride;
            QMessageBox = realBox;
        }

        var posAfter = CsRevise.stationPositions(doc);
        ok(Math.abs(posAfter.O5.x - posBefore.O5.x) > 1e-3,
            "opt-out: the revision still moved trip 1");
        ok(CsBind.hasLineworkTags(doc.queryEntity(ids.untagged)) === false,
            "opt-out: with the switch off, a bindable untagged tracing " +
            "is NOT claimed");
        for (i = 0; i < before.untagged.length; i++) {
            near(vertsOf(ids.untagged)[i].x, before.untagged[i].x, 1e-9,
                "opt-out: and it does not move (x)");
            near(vertsOf(ids.untagged)[i].y, before.untagged[i].y, 1e-9,
                "opt-out: and it does not move (y)");
        }
        // the feature itself is untouched: what the user bound follows
        var tFit = CsRevise.similarityFit([
            { old: posBefore.O4, nu: posAfter.O4 },
            { old: posBefore.O5, nu: posAfter.O5 }]);
        var tGot = vertsOf(ids.tagged);
        for (i = 0; i < before.tagged.length; i++) {
            var pred = CsRevise.applyFit(tFit, before.tagged[i]);
            near(tGot[i].x, pred.x, 1e-6,
                "opt-out: linework the user DID bind still follows its " +
                "stations (x)");
            near(tGot[i].y, pred.y, 1e-6,
                "opt-out: linework the user DID bind still follows its " +
                "stations (y)");
        }
        ok(boxText.indexOf("bound automatically") < 0,
            "opt-out: and the report claims nothing, got '" + boxText + "'");
    })();

    // -----------------------------------------------------------------
    // The Draw path writes the RevisionLog.
    //
    // Editing the header Decl and pressing Draw REPLACES the trip and
    // rotates its azimuths -- declination came out of the fingerprint,
    // so the page still matches the trip it was loaded from. Nathan hit
    // exactly that on a real drawing: the geometry moved, the linework
    // followed, and nothing recorded that it had happened. A drawing
    // that cannot explain its own geometry six months later is the
    // failure this logs against.
    //
    // The wording is asserted on the pure builder first, then the whole
    // Draw is run twice over a real document to prove the log
    // ACCUMULATES -- the entry the first Draw wrote has to survive the
    // second, whose erase deletes the very point that carried it.
    // -----------------------------------------------------------------
    (function() {
        var lines = function(over) {
            var info = { tripId: 1, fingerprint: "2002-02-02|UPPER TEAM",
                replaced: true, oldDeclination: -4.5, newDeclination: -4.5,
                declinationSource: "user", oldShots: 4, newShots: 4,
                stationsMoved: 0, lineworkMoved: 0, lineworkUnmoved: 0,
                lineworkBound: 0 };
            for (var k in over) {
                if (over.hasOwnProperty(k)) {
                    info[k] = over[k];
                }
            }
            return SurveyNotebook.revisionLogLines(info).join("\n");
        };

        // (a) the declination case, in apply's own vocabulary
        var decl = lines({ newDeclination: -3.25, stationsMoved: 3 });
        ok(decl === "trip 1 (2002-02-02|UPPER TEAM) redrawn from the " +
            "notebook page: declination -4.5 -> -3.25 (user), 4 shots " +
            "replaced, 3 stations moved",
            "notebook-log: a declination change names the trip and BOTH " +
            "values, got '" + decl + "'");
        ok(decl.indexOf("declination -4.5 -> -3.25 (user)") >= 0,
            "notebook-log: the old -> new phrasing matches the lines " +
            "CsRevise.apply writes, so one log reads as one history");

        // (b) a new trip: "where did trip 2 come from" answered
        var added = lines({ replaced: false, tripId: 2, oldShots: 0,
            newShots: 1 });
        ok(added === "trip 2 (2002-02-02|UPPER TEAM) added from the " +
            "notebook page, 1 shot",
            "notebook-log: an added trip says so in one line, singular " +
            "shot count included, got '" + added + "'");

        // (c) a Draw that changed nothing writes nothing. An audit trail
        //     that grows on every no-op is one nobody reads.
        ok(lines({}) === "",
            "notebook-log: an unchanged redraw appends nothing, got '" +
            lines({}) + "'");
        ok(lines({ lineworkMoved: 6, lineworkBound: 2 }) === "",
            "notebook-log: and not even the linework counts can make a " +
            "no-op write a line");

        // (d) the three independent signals. A shot deleted off the END
        //     of the page moves no SHARED station, so a shot-count
        //     change has to count on its own.
        ok(lines({ stationsMoved: 2 }).indexOf("2 stations moved") >= 0,
            "notebook-log: moved stations alone are worth recording");
        ok(lines({ newShots: 3 }).indexOf("3 shots replaced") >= 0 &&
            lines({ newShots: 3 }).indexOf("no station moved") >= 0,
            "notebook-log: a dropped shot that moved nothing shared is " +
            "still recorded, got '" + lines({ newShots: 3 }) + "'");

        // (e) linework on a following line, from the counts already held
        var lw = lines({ newDeclination: -3.25, stationsMoved: 3,
            lineworkMoved: 5, lineworkUnmoved: 1, lineworkBound: 2 });
        ok(lw.indexOf("\n  linework: 5 moved, 1 left behind, " +
            "2 bound automatically") > 0,
            "notebook-log: linework follows on its own line, and the " +
            "automatic claim is named apart, got '" + lw + "'");
    })();

    (function() {
        var doc = new RDocument(new RMemoryStorage(),
            new RSpatialIndexNavel());
        var di = new RDocumentInterface(doc);
        getDocument = function() { return doc; };
        getDocumentInterface = function() { return di; };

        // one trip at declination -4.5, the shape of Nathan's test cave
        var S = CsModel.newSurvey();
        S.date = "1998-07-04";
        S.team = "NS/JB";
        S.declination = -4.5;
        S.declinationSource = "user";
        CsModel.ensureTrips(S);
        var ls = [shotOf("L1", "L2", 10, 0), shotOf("L2", "L3", 10, 90),
            shotOf("L3", "L4", 8, 45)];
        for (var i = 0; i < ls.length; i++) {
            ls[i].left = 2;
            ls[i].right = 3;
            S.shots.push(ls[i]);
        }
        CsDraw.survey(S, CsNetwork.resolve(S, {}));

        // a traced wall bound to the trip, so the linework clause is
        // real rather than a constant
        var stationAt = CsRevise.stationPositions(doc);
        CsLayers.ensure(doc, di, "WALLS-SURVEYED");
        var pd = new RPolylineData();
        pd.appendVertex(new RVector(stationAt.L3.x + 0.5, stationAt.L3.y));
        pd.appendVertex(new RVector(stationAt.L4.x + 0.5, stationAt.L4.y));
        var wall = new RPolylineEntity(doc, pd);
        wall.setLayerId(doc.getLayerId("WALLS-SURVEYED"));
        var aop = new RAddObjectsOperation();
        aop.addObject(wall, false);
        di.applyOperation(aop);
        CsBind.tagEntities(doc, di,
            [{ entity: wall, trip: 0, stations: ["L3", "L4"] }]);

        var realBox = (typeof QMessageBox !== "undefined") ?
            QMessageBox : undefined;
        var boxText = "";
        QMessageBox = {
            information: function(parent, title, text) {
                boxText = String(text);
            },
            warning: function(parent, title, text) {
                boxText = "WARNING BOX: " + String(text);
            }
        };

        // keyed on getId(): entity query order in this build is NOT
        // deterministic, so "the anchor" has to be re-found each time
        // rather than remembered as an object
        var logNow = function() {
            var a = CsRevise.trip0Anchor(doc);
            return a === null ? null : CsTags.get(a, "RevisionLog");
        };
        // the page as the drawing holds it, with Decl retyped: the Az
        // cells are MAGNETIC, so back out the old header and forward
        // through the new one -- exactly what sheetSurvey does to
        // untouched cells
        var drawWithDecl = function(newDecl) {
            var recon = CsRevise.surveyFromDocument(doc);
            var page = SurveyNotebook.tripSurvey(recon.survey, 0);
            var wasDecl = page.declination;
            page.declination = newDecl;
            page.declinationSource = "user";
            for (var k = 0; k < page.shots.length; k++) {
                var mag = CsAngles.applyDeclination(page.shots[k].azimuth,
                    -wasDecl);
                page.shots[k].azimuth =
                    CsAngles.applyDeclination(mag, newDecl);
                page.shots[k].declination = null;
            }
            SurveyNotebook.drawMergedSurvey(null, doc, page, recon);
        };

        try {
            ok(logNow() === "",
                "notebook-log-doc: a freshly drawn survey has no history " +
                "yet, got '" + logNow() + "'");

            // -- first revision: -4.5 -> -3.25 ------------------------
            drawWithDecl(-3.25);
            var log1 = logNow();
            ok(log1.indexOf("trip 0 (1998-07-04|NS/JB) redrawn from " +
                "the notebook page:") === 0,
                "notebook-log-doc: the first entry names the trip and " +
                "its fingerprint, got '" + log1 + "'");
            ok(log1.indexOf("declination -4.5 -> -3.25 (user)") > 0,
                "notebook-log-doc: and the declination change he would " +
                "come looking for, got '" + log1 + "'");
            ok(log1.indexOf("3 shots replaced") > 0,
                "notebook-log-doc: and how many shots the page replaced");
            ok(log1.indexOf("stations moved") > 0,
                "notebook-log-doc: and that stations moved, got '" +
                log1 + "'");
            ok(log1.indexOf("\n  linework:") > 0 &&
                log1.indexOf("moved") > 0,
                "notebook-log-doc: and the linework that followed, got '" +
                log1 + "'");
            ok(boxText.indexOf("revision-log write") > 0,
                "notebook-log-doc: the extra undo step is said out loud, " +
                "got '" + boxText + "'");

            // -- second revision: -3.25 -> -1.75 ----------------------
            // The erase deletes the point that carried log1, so this is
            // the assertion that the read happens BEFORE the erase: read
            // after, and log1 would be gone.
            drawWithDecl(-1.75);
            var log2 = logNow();
            ok(log2.indexOf(log1) === 0,
                "notebook-log-doc: the first entry survived the second " +
                "revision's erase, byte for byte and still first -- " +
                "got '" + log2 + "'");
            ok(log2.indexOf("declination -3.25 -> -1.75 (user)") > 0,
                "notebook-log-doc: the second change is recorded too, " +
                "got '" + log2 + "'");
            ok(log2.indexOf("declination -4.5 -> -3.25 (user)") <
                log2.indexOf("declination -3.25 -> -1.75 (user)"),
                "notebook-log-doc: in the order they happened -- the log " +
                "carries no timestamp, so order IS the chronology");
            var entries = log2.split("\n");
            var heads = 0;
            for (i = 0; i < entries.length; i++) {
                if (entries[i].indexOf("trip 0 (") === 0) {
                    heads++;
                }
            }
            ok(heads === 2,
                "notebook-log-doc: two revisions, two entries -- not one " +
                "overwritten and not three, got " + heads + " in '" +
                log2 + "'");

            // -- a Draw that changes nothing ---------------------------
            // Two facts in one assertion, and the second is the one
            // that bit: nothing is APPENDED, and the log that was
            // already there still survives. Every Draw erases the point
            // the log lives on, so "write nothing" cannot mean "commit
            // nothing" -- a plain Draw used to destroy the whole audit
            // trail on its way past.
            drawWithDecl(-1.75);
            ok(logNow() === log2,
                "notebook-log-doc: redrawing the same page appends " +
                "nothing and destroys nothing, got '" + logNow() + "'");

            // -- a page whose fingerprint matches nothing --------------
            var recon = CsRevise.surveyFromDocument(doc);
            var fresh = SurveyNotebook.tripSurvey(recon.survey, 0);
            fresh.date = "2010-10-10";
            fresh.team = "SOLO";
            fresh.shots = [shotOf("Q1", "Q2", 12, 200)];
            fresh.shots[0].trip = 0;
            SurveyNotebook.drawMergedSurvey(null, doc, fresh, recon);
            var log3 = logNow();
            ok(log3.indexOf(log2) === 0,
                "notebook-log-doc: the replacement history is still " +
                "intact under the new trip's entry");
            ok(log3.indexOf("trip 1 (2010-10-10|SOLO) added from the " +
                "notebook page, 1 shot") > 0,
                "notebook-log-doc: 'where did trip 1 come from' is " +
                "answered in the log, got '" + log3 + "'");
        } finally {
            QMessageBox = realBox;
        }
    })();

    // -----------------------------------------------------------------
    // A FIRST Draw into an EMPTY drawing, then a revision of it -- the
    // whole life of a survey Nathan typed himself, which is the case
    // that used to carry no history at all.
    //
    // The old behaviour: an empty document reconstructs to one BLANK
    // trip 0, the page's fingerprint matched it no better than any
    // other, so the page landed past it and the drawing ended up with
    // no trip-0 anchor -- every hand-typed survey started at trip 1 for
    // no reason a user could explain, and the log was DROPPED, silently,
    // on every revision, forever. CsRevise.trip0Anchor's lowest-anchor
    // fallback is what kept such a drawing's log alive despite that, and
    // it still exists for the drawings already out in Nathan's cave
    // files -- but SurveyNotebook.mergeTripIntoSurvey now OCCUPIES the
    // blank placeholder trip 0 (CsModel.isPlaceholderTrip) instead of
    // appending past it, so a NEWLY typed page anchors at trip 0
    // directly and the fallback below is never the one doing the work.
    //
    // Four things have to hold:
    //   1. reading a log off a drawing with no anchor at all must not
    //      throw. Nothing to read is not an error.
    //   2. the first Draw writes its entry, and onto trip 0's own
    //      anchor, not a fallback.
    //   3. a SECOND Draw finds that entry again across its own
    //      erase-and-redraw and appends to it. A home the next
    //      revision cannot find is no better than no home.
    //   4. a THIRD, genuinely different page does not displace trip 0
    //      -- it appends as trip 1, and trip 0's history is untouched.
    // -----------------------------------------------------------------
    (function() {
        var doc = new RDocument(new RMemoryStorage(),
            new RSpatialIndexNavel());
        var di = new RDocumentInterface(doc);
        getDocument = function() { return doc; };
        getDocumentInterface = function() { return di; };
        ok(CsRevise.trip0Anchor(doc) === null,
            "notebook-log-empty: an empty drawing has no anchor to read");

        var page = CsModel.newSurvey();
        page.date = "2026-01-01";
        page.team = "FIRST";
        page.declination = 0;
        page.declinationSource = "user";
        page.shots.push(shotOf("A1", "A2", 10, 45));
        page.shots.push(shotOf("A2", "A3", 10, 135));
        var recon = CsRevise.surveyFromDocument(doc);

        var realBox = (typeof QMessageBox !== "undefined") ?
            QMessageBox : undefined;
        QMessageBox = {
            information: function() {},
            warning: function() {}
        };
        var threw = null;
        try {
            SurveyNotebook.drawMergedSurvey(null, doc, page, recon);
        } catch (e) {
            threw = String(e);
        } finally {
            QMessageBox = realBox;
        }
        ok(threw === null,
            "notebook-log-empty: a first Draw with no anchor to read does " +
            "not throw, got " + threw);
        ok(CsTags.collectStations(doc).length === 3,
            "notebook-log-empty: and it still drew the page -- the log is " +
            "never allowed to cost the user their survey");

        // keyed on getId(): entity query order in this build is NOT
        // deterministic, so the anchor is re-found rather than held
        var logNow = function() {
            var a = CsRevise.trip0Anchor(doc);
            return a === null ? null : CsTags.get(a, "RevisionLog");
        };
        var anchorTrip = function() {
            var a = CsRevise.trip0Anchor(doc);
            return a === null ? null : CsTags.getNumber(a, "Trip");
        };
        ok(CsRevise.trip0Anchor(doc) !== null,
            "notebook-log-empty: a typed page gives the drawing an anchor " +
            "the log can live on");
        // Not just "an anchor" -- TRIP 0's anchor, occupied directly by
        // mergeTripIntoSurvey rather than reached through
        // trip0Anchor's lowest-anchor fallback (that fallback is for
        // drawings that already shipped without a trip 0, not a
        // standing crutch for brand-new ones).
        ok(anchorTrip() === 0,
            "notebook-log-empty: a page typed into an untagged drawing " +
            "lands as trip 0, not appended past it -- got trip " +
            anchorTrip());
        var elog1 = logNow();
        ok(elog1.indexOf("(2026-01-01|FIRST) added from the notebook " +
            "page, 2 shots") > 0,
            "notebook-log-empty: the first Draw is recorded, not dropped, " +
            "got '" + elog1 + "'");
        // The entry names a trip id, and the log has to sit on THAT
        // trip's anchor -- the entry and its home disagreeing is how a
        // reader ends up looking in the wrong place.
        ok(elog1.indexOf("trip 0 (") === 0,
            "notebook-log-empty: the entry sits on trip 0's own anchor, " +
            "got '" + elog1 + "'");
        // exactly one entity carries the log: parking a second copy
        // anywhere would give the next revision two histories to pick
        // from
        var carriers = 0;
        var eids = doc.queryAllEntities(false, false);
        for (var q = 0; q < eids.length; q++) {
            var ee = doc.queryEntity(eids[q]);
            if (isNull(ee)) {
                continue;
            }
            if (CsTags.get(ee, "RevisionLog") !== "") {
                carriers++;
            }
        }
        ok(carriers === 1,
            "notebook-log-empty: the log has exactly one home, got " +
            carriers);

        // -- and now revise it: the case Nathan asked the log FOR ------
        // Retype the header declination and Draw again. The Az cells are
        // MAGNETIC, so back out the old header and forward through the
        // new one, exactly as sheetSurvey does for untouched cells.
        var recon2 = CsRevise.surveyFromDocument(doc);
        var trip = anchorTrip();
        var page2 = SurveyNotebook.tripSurvey(recon2.survey, trip);
        var wasDecl = page2.declination;
        page2.declination = -3.75;
        page2.declinationSource = "user";
        for (var k = 0; k < page2.shots.length; k++) {
            var mag = CsAngles.applyDeclination(page2.shots[k].azimuth,
                -wasDecl);
            page2.shots[k].azimuth =
                CsAngles.applyDeclination(mag, -3.75);
            page2.shots[k].declination = null;
        }
        QMessageBox = {
            information: function() {},
            warning: function() {}
        };
        try {
            SurveyNotebook.drawMergedSurvey(null, doc, page2, recon2);
        } finally {
            QMessageBox = realBox;
        }
        var elog2 = logNow();
        ok(elog2 !== null && elog2.indexOf(elog1) === 0,
            "notebook-log-empty: the first entry survived the revision's " +
            "erase -- trip 0's own anchor is a STABLE home, got '" +
            elog2 + "'");
        ok(elog2.indexOf("declination 0 -> -3.75 (user)") > 0,
            "notebook-log-empty: and the declination change is named, " +
            "which is what the log is for, got '" + elog2 + "'");
        ok(anchorTrip() === 0,
            "notebook-log-empty: the revision stayed on trip 0, got trip " +
            anchorTrip());

        // -- a THIRD, genuinely different page: must NOT displace trip 0 --
        // Trip 0 is occupied now (a real trip with real shots), so this
        // is exactly the dangerous case CsModel.isPlaceholderTrip exists
        // to prevent: a different party's page landing on top of it
        // would silently merge two people's work under one record.
        var recon3 = CsRevise.surveyFromDocument(doc);
        var page3 = CsModel.newSurvey();
        page3.date = "2026-03-03";
        page3.team = "SECOND";
        page3.declination = 0;
        page3.declinationSource = "user";
        // Ties into A3 (trip 0's end) so the network resolver places it
        // without needing an explicit start-point seed -- a disconnected
        // page needs one (see drawMergedSurvey's anchor comment), which
        // would only be noise here; the numbering question this checks
        // does not depend on where the new shot connects.
        page3.shots.push(shotOf("A3", "B1", 8, 200));
        QMessageBox = {
            information: function() {},
            warning: function() {}
        };
        try {
            SurveyNotebook.drawMergedSurvey(null, doc, page3, recon3);
        } finally {
            QMessageBox = realBox;
        }
        var elog3 = logNow();
        ok(anchorTrip() === 0,
            "notebook-log-empty: trip 0's anchor is still trip 0 after a " +
            "second page arrives -- got trip " + anchorTrip());
        ok(elog3 !== null && elog3.indexOf(elog2) === 0,
            "notebook-log-empty: trip 0's history is untouched by a " +
            "second, unrelated page -- got '" + elog3 + "'");
        var tripsSeen = {};
        var eids3 = doc.queryAllEntities(false, false);
        for (var r = 0; r < eids3.length; r++) {
            var er = doc.queryEntity(eids3[r]);
            if (isNull(er) || CsTags.get(er, "Station") === "" ||
                    CsTags.get(er, "Trip") === "") {
                continue;
            }
            tripsSeen[CsTags.getNumber(er, "Trip")] = true;
        }
        ok(tripsSeen[0] === true && tripsSeen[1] === true,
            "notebook-log-empty: the second page appended as trip 1 " +
            "alongside trip 0, not merged into it");
        ok(CsTags.collectStations(doc).length === 4,
            "notebook-log-empty: both trips' stations are present -- " +
            "A1-A3 kept, B1 added, got " +
            CsTags.collectStations(doc).length);
        ok(elog3.indexOf("trip 1 (2026-03-03|SECOND) added from the " +
            "notebook page, 1 shot") > 0,
            "notebook-log-empty: the log names where trip 1 came from, " +
            "got '" + elog3 + "'");
    })();

    // -----------------------------------------------------------------
    // A drawing whose lowest trip is 1, built directly to model the
    // state the shipped defect already left in Nathan's cave files:
    // trips numbered from 1, no trip-0 anchor anywhere. Such a drawing
    // still has to get a working log, which is the whole reason
    // trip0Anchor falls back to the lowest anchor present.
    //
    // CsDraw tags one anchor per trip that has a resolved station, so a
    // survey whose trip 0 owns no shots simply produces no Trip=0 tag.
    // -----------------------------------------------------------------
    (function() {
        var doc = new RDocument(new RMemoryStorage(),
            new RSpatialIndexNavel());
        var di = new RDocumentInterface(doc);
        getDocument = function() { return doc; };
        getDocumentInterface = function() { return di; };

        var S = CsModel.newSurvey();
        CsModel.ensureTrips(S);            // the blank placeholder slot
        var t1 = CsModel.newTrip();
        t1.date = "2026-02-02"; t1.team = "LEGACY";
        t1.declination = -1.0; t1.declinationSource = "user";
        S.trips.push(t1);
        var g1 = shotOf("G1", "G2", 10, 30);
        var g2 = shotOf("G2", "G3", 10, 120);
        g1.trip = 1; g2.trip = 1;
        g1.declination = -1.0; g2.declination = -1.0;
        S.shots.push(g1);
        S.shots.push(g2);
        CsDraw.survey(S, CsNetwork.resolve(S, {}));

        var trips = {};
        var ids = doc.queryAllEntities(false, false);
        for (var i = 0; i < ids.length; i++) {
            var e = doc.queryEntity(ids[i]);
            if (isNull(e) || CsTags.get(e, "Station") === "" ||
                    CsTags.get(e, "Trip") === "") {
                continue;
            }
            trips[CsTags.getNumber(e, "Trip")] = true;
        }
        ok(trips[0] === undefined && trips[1] === true,
            "log-fallback: the drawing really does start at trip 1 -- no " +
            "trip-0 anchor to find");
        var fb = CsRevise.trip0Anchor(doc);
        ok(fb !== null && CsTags.getNumber(fb, "Trip") === 1,
            "log-fallback: trip0Anchor falls back to the lowest anchor " +
            "present, got " + (fb === null ? "null" :
                CsTags.getNumber(fb, "Trip")));

        // and a real revision through it lands and reads back
        var recon = CsRevise.surveyFromDocument(doc);
        var newSurvey = CsRevise.surveyFromDocument(doc).survey;
        CsRevise.reviseDeclination(newSurvey, 1, -4.0, "igrf");
        CsRevise.apply(doc, di, recon, newSurvey);
        var fbLog = CsTags.get(CsRevise.trip0Anchor(doc), "RevisionLog");
        ok(fbLog.indexOf("trip 1 declination -1 -> -4 (igrf)") >= 0,
            "log-fallback: a trip-1-only drawing carries its revision " +
            "after all, got '" + fbLog + "'");

        // Preference unchanged: once the drawing HAS a trip 0, that is
        // where the log lives. The fallback is for drawings that lack
        // one, not a new home for the ones that don't.
        var S2 = CsModel.newSurvey();
        S2.date = "2026-03-03"; S2.team = "HEALTHY";
        CsModel.ensureTrips(S2);
        var s2t1 = CsModel.newTrip();
        s2t1.date = "2026-03-04"; s2t1.team = "OTHER";
        S2.trips.push(s2t1);
        var h1 = shotOf("H1", "H2", 10, 0);
        var h2 = shotOf("H2", "H3", 10, 90);
        h2.trip = 1;
        S2.shots.push(h1);
        S2.shots.push(h2);
        var doc2 = new RDocument(new RMemoryStorage(),
            new RSpatialIndexNavel());
        var di2 = new RDocumentInterface(doc2);
        getDocument = function() { return doc2; };
        getDocumentInterface = function() { return di2; };
        CsDraw.survey(S2, CsNetwork.resolve(S2, {}));
        var a0 = CsRevise.trip0Anchor(doc2);
        ok(a0 !== null && CsTags.getNumber(a0, "Trip") === 0,
            "log-fallback: trip 0 still wins when it is there, got " +
            (a0 === null ? "null" : CsTags.getNumber(a0, "Trip")));
    })();
}

// ---------------------------------------------------------------------
// CsGeoProject -- projection and request math for the aerial basemap.
// ---------------------------------------------------------------------
{
    // Mercator anchors. The equator maps to y=0; 180 degrees of
    // longitude is half the Mercator world width.
    var m0 = CsGeoProject.toMercator(0, 0);
    near(m0.x, 0, 1e-6, "mercator: lon 0 -> x 0");
    near(m0.y, 0, 1e-6, "mercator: lat 0 -> y 0");
    near(CsGeoProject.toMercator(0, 180).x, CsGeoProject.WORLD_HALF, 1e-3,
        "mercator: lon 180 -> half world width");

    // Round-trip through both directions, at a cave-country latitude.
    var rt = CsGeoProject.fromMercator(
        CsGeoProject.toMercator(40.5042, -90.2583).x,
        CsGeoProject.toMercator(40.5042, -90.2583).y);
    near(rt.lat, 40.5042, 1e-6, "mercator round-trip: latitude");
    near(rt.lon, -90.2583, 1e-6, "mercator round-trip: longitude");

    // Ground extent: a 100 ft square drawing is 30.48 m before margin,
    // and a 25% margin makes it 38.1 m.
    var extFt = CsGeoProject.groundExtent(
        { width: 100, height: 100 }, CsUnits.FEET, 0.25, 10);
    near(extFt.width, 38.1, 1e-6, "groundExtent: feet converted + margin");
    near(extFt.height, 38.1, 1e-6, "groundExtent: feet height");

    // A metre drawing needs no conversion.
    var extM = CsGeoProject.groundExtent(
        { width: 400, height: 200 }, CsUnits.METERS, 0.25, 150);
    near(extM.width, 500, 1e-6, "groundExtent: metres + margin");
    near(extM.height, 250, 1e-6, "groundExtent: metres height");

    // Degenerate extent (a single station) floors, per axis.
    var extFloor = CsGeoProject.groundExtent(
        { width: 0, height: 0 }, CsUnits.METERS, 0.25, 150);
    near(extFloor.width, 150, 1e-6, "groundExtent: degenerate floors width");
    near(extFloor.height, 150, 1e-6, "groundExtent: degenerate floors height");

    // THE SQUARENESS INVARIANT. A lat/lon request stretches the image
    // because a degree of longitude is shorter than a degree of
    // latitude; working in Mercator and matching the pixel aspect to
    // the bbox aspect keeps ground pixels square. This is the assertion
    // that would have caught the original 4326 design.
    var bbox = CsGeoProject.mercatorBbox(40.5042, -90.2583,
        { width: 800, height: 400 }, { x: 0, y: 0 });
    var size = CsGeoProject.pixelSize(bbox, 0.3, 4000, 256);
    var bboxAspect = (bbox.xmax - bbox.xmin) / (bbox.ymax - bbox.ymin);
    var pixAspect = size.w / size.h;
    near(pixAspect / bboxAspect, 1.0, 0.01,
        "pixelSize: pixel aspect matches bbox aspect (square ground pixels)");
    near(bboxAspect, 2.0, 1e-6, "mercatorBbox: 800x400 ground is 2:1 in Mercator");

    // Mercator inflates ground distance by 1/cos(lat), so the bbox is
    // WIDER in Mercator metres than the ground extent it represents.
    var mercWidth = bbox.xmax - bbox.xmin;
    ok(mercWidth > 800, "mercatorBbox: Mercator metres exceed ground metres");
    near(mercWidth * Math.cos(40.5042 * Math.PI / 180), 800, 1.0,
        "mercatorBbox: de-inflating by cos(lat) recovers ground width");

    // Resolution clamps. A tiny extent must not ask for fewer than the
    // floor; a huge one must not exceed the service's 4000 limit.
    var tiny = CsGeoProject.pixelSize(
        CsGeoProject.mercatorBbox(40.5042, -90.2583,
            { width: 10, height: 10 }, { x: 0, y: 0 }), 0.3, 4000, 256);
    ok(tiny.w >= 256 && tiny.h >= 256, "pixelSize: floors at 256 px");
    var huge = CsGeoProject.pixelSize(
        CsGeoProject.mercatorBbox(40.5042, -90.2583,
            { width: 50000, height: 50000 }, { x: 0, y: 0 }), 0.3, 4000, 256);
    ok(huge.w <= 4000 && huge.h <= 4000, "pixelSize: clamps at the 4000 px service limit");

    // ASPECT UNDER EXTREME ELONGATION. tiny/huge above are both exactly
    // square (aspect 1), so they never exercise the cap and the floor
    // fighting each other on a non-square bbox. A real cave passage can
    // easily be more elongate than maxPx/minPx = 15.625:1 -- e.g. a
    // 3000x40 m bounding box becomes 3750x150 after the 25% margin,
    // aspect 25 -- and the delivered image must still keep ground
    // pixels square, even though that means the short axis can't reach
    // the 256 px floor. Both axes must always be at least 1 px and
    // never more than 4000, whatever the aspect.
    var elongate = CsGeoProject.pixelSize(
        CsGeoProject.mercatorBbox(40.5042, -90.2583,
            { width: 3750, height: 150 }, { x: 0, y: 0 }), 0.3, 4000, 256);
    var elongateBbox = CsGeoProject.mercatorBbox(40.5042, -90.2583,
        { width: 3750, height: 150 }, { x: 0, y: 0 });
    var elongateBboxAspect = (elongateBbox.xmax - elongateBbox.xmin) /
        (elongateBbox.ymax - elongateBbox.ymin);
    near(elongateBboxAspect, 25.0, 1e-6,
        "mercatorBbox: 3750x150 ground is 25:1 in Mercator");
    near((elongate.w / elongate.h) / elongateBboxAspect, 1.0, 0.01,
        "pixelSize: elongate bbox (25:1, past the 15.625:1 cap/floor ratio) " +
        "still keeps pixel aspect matching bbox aspect");
    ok(elongate.w >= 1 && elongate.w <= 4000,
        "pixelSize: elongate case keeps w within [1, 4000]");
    ok(elongate.h >= 1 && elongate.h <= 4000,
        "pixelSize: elongate case keeps h within [1, 4000]");

    // The mirror case: tall and narrow instead of wide and short.
    var tallNarrow = CsGeoProject.pixelSize(
        CsGeoProject.mercatorBbox(40.5042, -90.2583,
            { width: 150, height: 3750 }, { x: 0, y: 0 }), 0.3, 4000, 256);
    var tallNarrowBbox = CsGeoProject.mercatorBbox(40.5042, -90.2583,
        { width: 150, height: 3750 }, { x: 0, y: 0 });
    var tallNarrowBboxAspect = (tallNarrowBbox.xmax - tallNarrowBbox.xmin) /
        (tallNarrowBbox.ymax - tallNarrowBbox.ymin);
    near((tallNarrow.w / tallNarrow.h) / tallNarrowBboxAspect, 1.0, 0.01,
        "pixelSize: tall-narrow bbox (1:25, below the 1/15.625 threshold) " +
        "still keeps pixel aspect matching bbox aspect");
    ok(tallNarrow.w >= 1 && tallNarrow.w <= 4000,
        "pixelSize: tall-narrow case keeps w within [1, 4000]");
    ok(tallNarrow.h >= 1 && tallNarrow.h <= 4000,
        "pixelSize: tall-narrow case keeps h within [1, 4000]");

    // Cap and floor pulling in opposite directions on the SAME
    // non-square request: the long axis is big enough to need the
    // 4000 px cap, while the short axis (aspect-locked to it) falls
    // below the 256 px floor. Aspect preservation wins; the floor
    // yields (see the comment on CsGeoProject.pixelSize).
    ok(elongate.w === 4000,
        "pixelSize: elongate case's long axis hits the 4000 px cap");
    ok(elongate.h < 256,
        "pixelSize: elongate case's short axis is left below the 256 px " +
        "floor because honouring the floor would distort the aspect");

    // Drawing scale: units per pixel, in the drawing's own units.
    var uppM = CsGeoProject.drawingUnitsPerPixel(bbox, size.w, 40.5042,
        CsUnits.METERS);
    near(uppM * size.w, 800, 1.0, "drawingUnitsPerPixel: metres span the ground width");
    var uppFt = CsGeoProject.drawingUnitsPerPixel(bbox, size.w, 40.5042,
        CsUnits.FEET);
    near(uppFt / uppM, CsUnits.FEET_PER_METER, 1e-6,
        "drawingUnitsPerPixel: feet drawing scales by feet-per-metre");

    // The anchor offset shifts the window without resizing it.
    var off = CsGeoProject.mercatorBbox(40.5042, -90.2583,
        { width: 800, height: 400 }, { x: 100, y: -50 });
    near((off.xmax - off.xmin), (bbox.xmax - bbox.xmin), 1e-6,
        "mercatorBbox: offset preserves width");
    ok(off.xmin > bbox.xmin, "mercatorBbox: positive x offset moves the window east");
    ok(off.ymin < bbox.ymin, "mercatorBbox: negative y offset moves the window south");

    // URL construction.
    var url = CsGeoProject.naipUrl(bbox, size);
    ok(url.indexOf("bboxSR=3857") >= 0, "naipUrl: bbox spatial reference");
    ok(url.indexOf("imageSR=3857") >= 0, "naipUrl: image spatial reference");
    ok(url.indexOf("format=png") >= 0, "naipUrl: PNG format");
    ok(url.indexOf("f=image") >= 0, "naipUrl: image response");
    ok(url.indexOf("USGSNAIPImagery") >= 0, "naipUrl: NAIP service");
    ok(url.indexOf("size=" + size.w + "," + size.h) >= 0, "naipUrl: requested size");
    ok(url.indexOf(" ") < 0, "naipUrl: no unescaped spaces");

    // Coverage. NAIP is US-only; a European request must be refused
    // before it wastes a round trip.
    ok(CsGeoProject.insideCoverage(
        CsGeoProject.mercatorBbox(40.5042, -90.2583,
            { width: 800, height: 400 }, { x: 0, y: 0 })) === true,
        "insideCoverage: Indiana is inside NAIP");
    ok(CsGeoProject.insideCoverage(
        CsGeoProject.mercatorBbox(47.5, 11.0,
            { width: 800, height: 400 }, { x: 0, y: 0 })) === false,
        "insideCoverage: the Alps are outside NAIP");

    // The basemap PNG sits beside the drawing under a neutral name --
    // no coordinates, no cave name beyond what the DXF already carries.
    ok(CsGeoProject.imagePathFor("/tmp/Cave.dxf") === "/tmp/Cave-aerial.png",
        "imagePathFor: dxf -> -aerial.png beside it");
    ok(CsGeoProject.imagePathFor("/a/b/Deep River Cave.DXF") ===
        "/a/b/Deep River Cave-aerial.png",
        "imagePathFor: spaces and uppercase extension");
    ok(CsGeoProject.imagePathFor("") === null,
        "imagePathFor: unsaved drawing has no image path");
    ok(CsGeoProject.imagePathFor("C:\\Cave\\Survey.dxf") ===
        "C:\\Cave\\Survey-aerial.png",
        "imagePathFor: Windows-style backslash path");
    ok(CsGeoProject.imagePathFor("/a/2026.08.20/Cave") ===
        "/a/2026.08.20/Cave-aerial.png",
        "imagePathFor: dot in a directory name is not mistaken for an extension");
    ok(CsGeoProject.imagePathFor("/home/user/Cave") ===
        "/home/user/Cave-aerial.png",
        "imagePathFor: filename with no extension at all");
}

// ---------------------------------------------------------------------
// CsProc -- argv discipline, redaction, injectable backend.
// ---------------------------------------------------------------------

// Under CaveCAD's engine, RSettings and QFile both exist, so CsProc.log
// would otherwise append real lines to the user's own cave-git.log
// while this suite runs. Leave it off for the rest of the file.
CsProc.logEnabled = false;

var procCalls = [];
CsProc.setBackend(function(prog, argv, opts) {
    procCalls.push({ prog: prog, argv: argv, opts: opts });
    return { code: 0, out: "fake-out", err: "", timedOut: false };
});

var pr = CsProc.run("git", ["commit", "-m", "two words"]);
ok(pr.code === 0, "CsProc.run returns the backend's code");
ok(pr.out === "fake-out", "CsProc.run returns stdout");
ok(pr.timedOut === false, "CsProc.run reports no timeout");
ok(procCalls.length === 1, "CsProc.run called the backend once");
ok(procCalls[0].prog === "git", "CsProc passes the program through");
ok(procCalls[0].argv.length === 3, "CsProc passes 3 arguments, not a joined string");
ok(procCalls[0].argv[2] === "two words",
    "CsProc keeps a spaced argument as ONE argument");

// A timeout must not look like success.
CsProc.setBackend(function() {
    return { code: -1, out: "", err: "timed out", timedOut: true };
});
var pt = CsProc.run("git", ["fetch"]);
ok(pt.timedOut === true, "CsProc surfaces timedOut");
ok(pt.code !== 0, "a timeout is a non-zero code");

// Redaction. Synthetic strings only -- never a real token in a test.
ok(CsProc.redact("Token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345")
        .indexOf("ghp_ABCDEF") === -1,
    "CsProc.redact removes a ghp_ token");
ok(CsProc.redact("gho_0123456789abcdefghijklmnopqrstuvwx")
        .indexOf("<redacted>") !== -1,
    "CsProc.redact marks a gho_ token");
ok(CsProc.redact("ghu_AAA ghs_BBB").indexOf("ghu_AAA") === -1 &&
   CsProc.redact("ghu_AAA ghs_BBB").indexOf("ghs_BBB") === -1,
    "CsProc.redact removes ghu_ and ghs_ tokens");
ok(CsProc.redact("tok github_pat_11ABCDEFG0abcdefg")
        .indexOf("github_pat_11ABCDEFG0abcdefg") === -1,
    "CsProc.redact removes a github_pat_ fine-grained token");
ok(CsProc.redact("no secret here") === "no secret here",
    "CsProc.redact leaves ordinary text alone");
ok(CsProc.redact(null) === "", "CsProc.redact tolerates null");

// hasToken must be a stateless predicate despite TOKEN_RE carrying the
// "g" flag -- calling .test() on the shared regex directly would walk
// lastIndex and alternate true/false/true across repeated calls.
ok(CsProc.hasToken("ghp_AAAAAAAA") === true,
    "CsProc.hasToken finds a token (first call)");
ok(CsProc.hasToken("ghp_AAAAAAAA") === true,
    "CsProc.hasToken finds a token (second call in a row, same answer)");
ok(CsProc.hasToken("no secret here") === false,
    "CsProc.hasToken is false for ordinary text");

CsProc.setBackend(null);   // restore the real backend for later sections

// The fake above never exercises CsProc.qprocessBackend -- the only
// code that does real work, and where both the timeout/notStarted
// confusion and the missing-QProcess guard would have lived
// undetected. Run it for real, engine-only (node has no QProcess).
if (!IS_NODE) {
    CsProc.setBackend(null);
    var rv = CsProc.run("/bin/echo", ["one two"]);
    ok(rv.code === 0, "real backend: /bin/echo exits 0");
    ok(rv.out.indexOf("one two") === 0, "real backend: captures stdout as ONE arg");
    var rm = CsProc.run("/usr/bin/no-such-binary-xyz", []);
    ok(rm.code !== 0, "real backend: missing binary is a failure");
    ok(rm.timedOut === false, "real backend: missing binary is NOT a timeout");
    ok(rm.notStarted === true, "real backend: missing binary reports notStarted");
}

// CsProc.log had never written a single byte in any build: two
// independent failures (RSettings.getStandardWritableLocation is not
// a real method here, and `new QIODevice.OpenMode(...)` throws) were
// both swallowed by this file's own try/catch. logPath() returning
// null was the visible symptom; confirm it resolves, then round-trip
// a synthetic token through the real log() and read the file back to
// confirm the write landed AND arrived redacted.
if (!IS_NODE) {
    var logProbePath = CsProc.logPath();
    ok(logProbePath !== null, "CsProc.logPath resolves in this engine");

    if (logProbePath !== null) {
        var logProbeWasEnabled = CsProc.logEnabled;
        CsProc.logEnabled = true;
        var logProbeMarker = "CSPROC-TEST-PROBE";
        CsProc.log(logProbeMarker + " ghp_SYNTHETICNOTAREALTOKEN0000000000");
        CsProc.logEnabled = logProbeWasEnabled;

        var logProbeContents = readTextFile(logProbePath);
        ok(logProbeContents.indexOf(logProbeMarker) !== -1,
            "CsProc.log actually wrote the probe line to disk");
        ok(logProbeContents.indexOf("ghp_SYNTHETICNOTAREALTOKEN0000000000") === -1,
            "CsProc.log redacts the token before it reaches disk");
        ok(logProbeContents.indexOf("<redacted>") !== -1,
            "CsProc.log's on-disk line shows <redacted> in place of the token");
    }
}

// ---------------------------------------------------------------------
// CsGit -- argv builders (exact arrays) and output parsers.
// ---------------------------------------------------------------------

function sameArgv(got, want, what) {
    var equal = (got.length === want.length);
    if (equal) {
        for (var i = 0; i < want.length; i++) {
            if (got[i] !== want[i]) {
                equal = false;
                break;
            }
        }
    }
    ok(equal, what + " (got [" + got.join("|") + "], want [" + want.join("|") + "])");
}

sameArgv(CsGit.argvToplevel(), ["rev-parse", "--show-toplevel"], "argvToplevel");
sameArgv(CsGit.argvStatus(), ["status", "--porcelain"], "argvStatus");
sameArgv(CsGit.argvCurrentBranch(), ["rev-parse", "--abbrev-ref", "HEAD"],
    "argvCurrentBranch");
sameArgv(CsGit.argvCommit("msg with spaces"),
    ["commit", "-m", "msg with spaces"],
    "argvCommit keeps the message as ONE argument");
sameArgv(CsGit.argvAdd(["drawings/Blowing Hole.dxf", "survey/bh.shots.tsv"]),
    ["add", "--", "drawings/Blowing Hole.dxf", "survey/bh.shots.tsv"],
    "argvAdd separates paths with -- and keeps spaces intact");
sameArgv(CsGit.argvCheckoutNew("survey/2026-08-20-nd", "main"),
    ["checkout", "-b", "survey/2026-08-20-nd", "main"], "argvCheckoutNew");
sameArgv(CsGit.argvCheckoutNew("survey/2026-08-20-nd"),
    ["checkout", "-b", "survey/2026-08-20-nd"],
    "argvCheckoutNew with no starting point omits the trailing arg");
sameArgv(CsGit.argvPush("origin", "survey/2026-08-20-nd"),
    ["push", "-u", "origin", "survey/2026-08-20-nd"], "argvPush");
sameArgv(CsGit.argvClone("https://github.com/o/r.git", "/Users/n/Documents/Cave/r"),
    ["clone", "https://github.com/o/r.git", "/Users/n/Documents/Cave/r"],
    "argvClone");
sameArgv(CsGit.argvConfigSet("user.email", "1+n@users.noreply.github.com", false),
    ["config", "user.email", "1+n@users.noreply.github.com"],
    "argvConfigSet local omits --global");
sameArgv(CsGit.argvConfigSet("user.email", "1+n@users.noreply.github.com", true),
    ["config", "--global", "user.email", "1+n@users.noreply.github.com"],
    "argvConfigSet global includes --global");
sameArgv(CsGit.argvAheadBehind("origin/main", "HEAD"),
    ["rev-list", "--count", "--left-right", "origin/main...HEAD"],
    "argvAheadBehind");
sameArgv(CsGit.argvHooksPath(".githooks"),
    ["config", "core.hooksPath", ".githooks"], "argvHooksPath");
// The plan's own test section stopped short of these three builders,
// leaving them without the exact-array assertion the acceptance
// criteria require of every builder. argvConfigGet is confirmed used
// later (Task 5's identity probe reads user.name/user.email through
// it), so all three are asserted here rather than left untested or
// cut for being unused so far.
sameArgv(CsGit.argvPullRebase(), ["pull", "--rebase"], "argvPullRebase");
sameArgv(CsGit.argvConfigGet("user.email"), ["config", "--get", "user.email"],
    "argvConfigGet");
sameArgv(CsGit.argvVersion(), ["--version"], "argvVersion");

ok(CsGit.parseToplevel({ code: 0, out: "/Users/n/Documents/Cave/bh\n", err: "" }) ===
    "/Users/n/Documents/Cave/bh", "parseToplevel trims the newline");
ok(CsGit.parseToplevel({ code: 128, out: "", err: "not a git repository" }) === null,
    "parseToplevel returns null outside a work tree");

var gitSt = CsGit.parsePorcelain({ code: 0, out:
    " M drawings/plain.dxf\n?? survey/bh.shots.tsv\nA  notes/trip.md\n", err: "" });
ok(gitSt.length === 3, "parsePorcelain finds 3 entries");
ok(gitSt[0].path === "drawings/plain.dxf", "parsePorcelain reads the path");
ok(gitSt[0].code === "M", "parsePorcelain reads the status code");
ok(gitSt[1].code === "??", "parsePorcelain reads an untracked marker");
ok(gitSt[0].origPath === null,
    "parsePorcelain: origPath is null (not absent) on a plain modified entry");
ok(CsGit.parsePorcelain({ code: 0, out: "", err: "" }).length === 0,
    "parsePorcelain on a clean tree is empty");

// The passthrough branch, pinned honestly on the helper itself rather
// than as a parsePorcelain fixture with a space in an UNQUOTED path --
// real git always quotes a spaced path (see quotedMod below), so that
// shape is not something git emits.
ok(CsGit.unquotePath("d/Blowing Hole.dxf") === "d/Blowing Hole.dxf",
    "unquotePath passes an unquoted path through unchanged");

// Rename/copy: porcelain renders "old -> new". The destination is the
// file that now exists -- the one a later `git add` must name -- so
// `path` carries the destination and `origPath` carries the source.
// No spaces here, so real git would not quote either side either.
var rn = CsGit.parsePorcelain({ code: 0,
    out: "R  drawings/old.dxf -> drawings/new.dxf\n", err: "" });
ok(rn[0].code === "R", "parsePorcelain: rename keeps the R status code");
ok(rn[0].path === "drawings/new.dxf",
    "parsePorcelain: rename's path is the DESTINATION");
ok(rn[0].origPath === "drawings/old.dxf",
    "parsePorcelain: rename's origPath is the source");

// ---------------------------------------------------------------------
// Real git output, not invented fixtures.
//
// A spec review (2026-08-21) found that git C-quotes ANY path with a
// space -- not only a non-ASCII one -- and it does so in --porcelain
// with or without core.quotePath. The earlier version of this test
// section fed the parser a spaced rename with no quotes at all, a
// shape git never emits, so it passed while the actual bug -- a
// quoted path reaching CsGit.argvAdd as '"d/Blowing Hole.dxf"',
// literal quote marks and all, which `git add` rejects -- went
// uncaught. Every fixture below is copy-pasted byte-for-byte (verified
// with `xxd`) from `git status --porcelain` (git 2.54.0) run against a
// throwaway repo under the scratchpad, never against this worktree.
// ---------------------------------------------------------------------

// A plain modified entry, quoted for the space alone -- no non-ASCII
// involved. This is criterion 3's actual spaced-path case.
var quotedMod = CsGit.parsePorcelain({ code: 0,
    out: " M \"d/Blowing Hole.dxf\"\n", err: "" });
ok(quotedMod[0].code === "M", "parsePorcelain: quoted modified entry's code");
ok(quotedMod[0].path === "d/Blowing Hole.dxf",
    "parsePorcelain: quote marks are stripped from a spaced path -- " +
    "this is the path CsGit.argvAdd must receive");

// An untracked entry, same reason for quoting.
var quotedUntracked = CsGit.parsePorcelain({ code: 0,
    out: "?? \"untracked file.txt\"\n", err: "" });
ok(quotedUntracked[0].code === "??",
    "parsePorcelain: quoted untracked entry's code");
ok(quotedUntracked[0].path === "untracked file.txt",
    "parsePorcelain: quote marks stripped from a quoted untracked path");

// A pure rename, both sides spaced, so git quotes BOTH independently:
// R  "drawings/old name.txt" -> "drawings/new name.txt"
var rnBothQuoted = CsGit.parsePorcelain({ code: 0,
    out: "R  \"drawings/old name.txt\" -> \"drawings/new name.txt\"\n", err: "" });
ok(rnBothQuoted[0].code === "R", "parsePorcelain: both-quoted rename code");
ok(rnBothQuoted[0].path === "drawings/new name.txt",
    "parsePorcelain: both-quoted rename destination is unquoted");
ok(rnBothQuoted[0].origPath === "drawings/old name.txt",
    "parsePorcelain: both-quoted rename source is unquoted");

// An asymmetric rename -- only the spaced side is quoted:
// R  drawings/asym-old.txt -> "drawings/asym new.txt"
var rnOneQuoted = CsGit.parsePorcelain({ code: 0,
    out: "R  drawings/asym-old.txt -> \"drawings/asym new.txt\"\n", err: "" });
ok(rnOneQuoted[0].origPath === "drawings/asym-old.txt",
    "parsePorcelain: asymmetric rename -- unquoted source is untouched");
ok(rnOneQuoted[0].path === "drawings/asym new.txt",
    "parsePorcelain: asymmetric rename -- quoted destination is unquoted");

// decodeURIComponent's presence in this engine -- see the provenance
// note on CsGit.js's unquotePath for why this is verified rather than
// assumed.
ok(typeof decodeURIComponent === "function",
    "decodeURIComponent exists in this engine -- required by " +
    "CsGit.unquotePath's octal-run decoding");
ok(decodeURIComponent("%C3%B6") === "ö",
    "decodeURIComponent decodes a 2-byte UTF-8 sequence correctly");

// Non-ASCII, core.quotePath at its default (on): a "cafe/Blowing.dxf"
// with real accents comes back octal-escaped as UTF-8 BYTES, two
// escapes per accented character (\303\251 is "e-acute", \303\266 is
// "o-diaeresis"):
// A  "caf\303\251/Bl\303\266wing.dxf"
// Now that unquotePath decodes the octal runs, this is no longer a
// pinned limitation -- it is asserted to actually come back as the
// real accented text.
var quotedAccent = CsGit.parsePorcelain({ code: 0,
    out: "A  \"caf\\303\\251/Bl\\303\\266wing.dxf\"\n", err: "" });
ok(quotedAccent[0].code === "A", "parsePorcelain: non-ASCII entry's code");
ok(quotedAccent[0].path === "café/Blöwing.dxf",
    "parsePorcelain: octal-escaped UTF-8 bytes decode to real accented " +
    "text, not mojibake and not the raw escapes");

// A literal double-quote CHARACTER inside a filename, escaped by git
// as \" -- unexercised until now:
// ??  "say \"hi\".txt"
var quotedQuoteChar = CsGit.parsePorcelain({ code: 0,
    out: "?? \"say \\\"hi\\\".txt\"\n", err: "" });
ok(quotedQuoteChar[0].path === "say \"hi\".txt",
    "parsePorcelain: an escaped literal quote character decodes to a " +
    "real quote, not the two-character escape");

// A literal backslash followed by digits that LOOK like an octal
// escape -- see the ordering-hazard note on CsGit.js's unquotePath.
// Fixture: ??  "back\\123slash.txt" (git's escaping of a filename
// containing one literal backslash followed by "123").
var quotedBackslash = CsGit.parsePorcelain({ code: 0,
    out: "?? \"back\\\\123slash.txt\"\n", err: "" });
ok(quotedBackslash[0].path === "back\\123slash.txt",
    "parsePorcelain: an escaped backslash does not consume the octal-" +
    "looking digits that follow it");
// Round-tripped through a real repo (git 2.54.0, throwaway, outside
// this worktree): `git add -- 'back\123slash.txt'` -- the exact
// string CsGit.argvAdd would build from quotedBackslash[0].path --
// staged the file with no pathspec error.

// A malformed \ooo byte run: decodeURIComponent fails the WHOLE run
// even when only its last byte is bad, so unquotePath reverts to the
// original escape text (not the %XX form, and not just the bad byte)
// rather than silently discarding the good bytes ahead of it.
ok(CsGit.unquotePath("\"\\377\"") === "\\377",
    "unquotePath: a single invalid UTF-8 byte reverts to its raw \\ooo " +
    "escape rather than the %XX form");
ok(CsGit.unquotePath("\"a\\303\\251\\303\"") === "a\\303\\251\\303",
    "unquotePath: one bad trailing byte in a run must not discard the " +
    "decodable characters ahead of it -- the whole run reverts, raw");

// ---------------------------------------------------------------------
// Regression guard for a Critical: a short \ooo run (1 or 2 octal
// digits, or a digit followed by a non-octal character) used to enter
// the octal branch without ever advancing the scan cursor, spinning
// CsGit.unquotePath forever. Real git always emits exactly three
// digits, so nothing triggers this today -- but a hang is the one bug
// class this suite cannot catch by failing; it just never finishes.
// Every assertion below completing at all IS the test.
// ---------------------------------------------------------------------
ok(CsGit.unquotePath("\"a\\3\"") === "a\\3",
    "unquotePath returns on a 1-digit run at the end (does not hang)");
ok(CsGit.unquotePath("\"a\\30\"") === "a\\30",
    "unquotePath returns on a 2-digit run at the end (does not hang)");
ok(CsGit.unquotePath("\"a\\3x\"") === "a\\3x",
    "unquotePath returns on a digit followed by a non-octal char " +
    "(does not hang)");
ok(CsGit.unquotePath("\"a\\30b\"") === "a\\30b",
    "unquotePath returns on a 2-digit run followed by a literal " +
    "(does not hang)");
ok(CsGit.unquotePath("\"a\\7\"") === "a\\7",
    "unquotePath returns on a single trailing digit (does not hang)");
// Reachable through the public parser, not only the helper.
var shortOctalViaParser = CsGit.parsePorcelain({ code: 0,
    out: "?? \"d/a\\3b.dxf\"\n", err: "" });
ok(shortOctalViaParser[0].path === "d/a\\3b.dxf",
    "parsePorcelain also returns on a short octal run (does not hang)");

// Still out of scope -- see the note on CsGit.js's parsePorcelain: a
// filename containing the literal " -> " sequence, and no -z switch.

var ab = CsGit.parseAheadBehind({ code: 0, out: "2\t5\n", err: "" });
ok(ab.behind === 2 && ab.ahead === 5, "parseAheadBehind reads left-right counts");
ok(CsGit.parseAheadBehind({ code: 1, out: "", err: "no upstream" }) === null,
    "parseAheadBehind returns null with no upstream");

ok(CsGit.isNetworkFailure("fatal: unable to access 'https://github.com/': " +
    "Could not resolve host: github.com") === true,
    "isNetworkFailure spots an unresolved host");
ok(CsGit.isNetworkFailure("! [rejected]        main -> main (fetch first)") === false,
    "isNetworkFailure does not claim a rejected push");
ok(CsGit.isRejected("! [rejected]        main -> main (fetch first)") === true,
    "isRejected spots a non-fast-forward");

// ---------------------------------------------------------------------
// CsHub -- gh argv, JSON parsing, and the two privacy gates.
//
// Fixture provenance:
//   AUTH_OK, AUTH_LOGGED_OUT, REPO_VIEW_PUBLIC, REPO_VIEW_PRIVATE_SHAPE,
//   REPO_VIEW_MISSING, API_USER_REAL, USAGE_ERROR_ERR and
//   NETWORK_FAILURE_ERR are captured bytes from real `gh` 2.97.0 calls
//   on this machine (all read-only, none touching real GitHub state).
//   AUTH_LOGGED_OUT came from a throwaway GH_CONFIG_DIR, not this
//   machine's real session. AUTH_OK was re-verified with a live
//   `gh auth status --active` call on 2026-08-21 and is byte-identical
//   to the plain `gh auth status` capture in this single-account case.
//   USAGE_ERROR_ERR came from a made-up flag
//   (`gh auth status --this-flag-does-not-exist`) so it cannot collide
//   with a real one gh ever adds. NETWORK_FAILURE_ERR came from
//   pointing gh at an unresolvable proxy host, a self-inflicted
//   failure that never reaches the real internet, but gh's error
//   wording for it is genuine. AUTH_THIN is that same real AUTH_OK
//   with its scopes line edited to drop "repo" -- a genuine thin-scope
//   capture would require revoking a scope on the live token, which
//   this task must not do.
//   REPO_VIEW_INTERNAL and API_USER_NULL_NAME are synthetic: INTERNAL
//   visibility needs an organization-owned repo, and a null gh api
//   user "name" needs a second account that never set a display name
//   -- neither obtainable from this machine. TWO_ACCOUNT_RAW and
//   ACTIVE_BLOCK_ISOLATED (derived from it) are synthetic for the same
//   reason: a multi-account host needs a second real GitHub account,
//   also not obtainable here. Each test says so.
// ---------------------------------------------------------------------

sameArgv(CsHub.argvAuthStatus(), ["auth", "status", "--active"],
    "argvAuthStatus -- --active is not optional, see the comment on " +
    "CsHub.argvAuthStatus");
sameArgv(CsHub.argvDeviceLogin(),
    ["auth", "login", "--web", "--git-protocol", "https",
     "--hostname", "github.com", "--scopes", "repo,read:org",
     "--clipboard", "--skip-ssh-key"],
    "argvDeviceLogin");
sameArgv(CsHub.argvTokenLogin(),
    ["auth", "login", "--with-token", "--git-protocol", "https",
     "--hostname", "github.com"],
    "argvTokenLogin");
sameArgv(CsHub.argvSetupGit(), ["auth", "setup-git"], "argvSetupGit");
sameArgv(CsHub.argvRefreshScope("repo"), ["auth", "refresh", "-s", "repo"],
    "argvRefreshScope");
sameArgv(CsHub.argvRepoView("ndschonegg/cave-blowing-hole"),
    ["repo", "view", "ndschonegg/cave-blowing-hole", "--json",
     "visibility,nameWithOwner,defaultBranchRef"],
    "argvRepoView");
sameArgv(CsHub.argvRepoCreate("cave-blowing-hole"),
    ["repo", "create", "cave-blowing-hole", "--private"], "argvRepoCreate");
sameArgv(CsHub.argvRepoCreate("cave blowing hole"),
    ["repo", "create", "cave blowing hole", "--private"],
    "argvRepoCreate keeps a spaced name as ONE argument");
sameArgv(CsHub.argvApiUser(), ["api", "user"], "argvApiUser");
sameArgv(CsHub.argvVersion(), ["--version"], "argvVersion");

// gh auth status -- real captures. Authenticated lands on STDOUT with
// exit 0; logged out lands on STDERR with exit 1 and empty stdout.
// This is why CsHub.textOf must read both streams.
var AUTH_OK = "github.com\n" +
    "  ✓ Logged in to github.com account ndschonegg (keyring)\n" +
    "  - Active account: true\n" +
    "  - Git operations protocol: https\n" +
    "  - Token: gho_************************************\n" +
    "  - Token scopes: 'gist', 'read:org', 'repo', 'workflow'\n";
var AUTH_THIN = AUTH_OK.replace(
    "'gist', 'read:org', 'repo', 'workflow'", "'gist', 'read:user'");
var AUTH_LOGGED_OUT_ERR =
    "You are not logged into any GitHub hosts. To log in, run: gh auth login\n";

// Synthetic -- a second real GitHub account cannot be created on this
// machine, so this is composed rather than captured. Each individual
// block's shape IS the real captured AUTH_OK shape above, just
// repeated with a different login/active-flag/scopes, matching gh's
// documented multi-account-per-host format. This reproduces exactly
// the Important-1 regression: the active account (ndschonegg, with
// `repo`) listed SECOND, behind an inactive account (oldaccount, with
// only `gist`) listed first.
var TWO_ACCOUNT_RAW =
    "github.com\n" +
    "  ✓ Logged in to github.com account oldaccount (keyring)\n" +
    "  - Active account: false\n" +
    "  - Git operations protocol: https\n" +
    "  - Token: ghp_************************************\n" +
    "  - Token scopes: 'gist'\n" +
    "\n" +
    "  ✓ Logged in to github.com account ndschonegg (keyring)\n" +
    "  - Active account: true\n" +
    "  - Git operations protocol: https\n" +
    "  - Token: gho_************************************\n" +
    "  - Token scopes: 'gist', 'read:org', 'repo', 'workflow'\n";

// gh repo view --json visibility,nameWithOwner,defaultBranchRef -- real
// captures. Keys come back alphabetically sorted and defaultBranchRef
// is an OBJECT with a "name" key, not a bare string.
var REPO_VIEW_PUBLIC =
    '{"defaultBranchRef":{"name":"trunk"},"nameWithOwner":"cli/cli",' +
    '"visibility":"PUBLIC"}';
var REPO_VIEW_PRIVATE_SHAPE =
    '{"defaultBranchRef":{"name":"main"},"nameWithOwner":"owner/name",' +
    '"visibility":"PRIVATE"}';
var REPO_VIEW_MISSING_ERR =
    "GraphQL: Could not resolve to a Repository with the name " +
    "'owner/name'. (repository)\n";
// Synthetic -- INTERNAL visibility requires an organization-owned
// repo, not obtainable from this machine. The literal gh prints for
// it is the uppercase string "INTERNAL".
var REPO_VIEW_INTERNAL =
    '{"defaultBranchRef":{"name":"main"},"nameWithOwner":"org/name",' +
    '"visibility":"INTERNAL"}';

// gh api user -- real capture (login/id/name subset of the full real
// response; parseApiUser only reads those three keys so the extra
// ones gh actually returns do not matter here). id is an integer.
var API_USER_REAL =
    '{"login":"ndschonegg","id":307531413,"name":"Nathan Schonegg"}';
// Synthetic -- a null "name" needs a second GitHub account that never
// set a display name, not obtainable from this machine.
var API_USER_NULL_NAME = '{"login":"solo","id":7,"name":null}';

// Visibility. PRIVATE only -- decision 1, no override.
ok(CsHub.parseVisibility({ code: 0, out: REPO_VIEW_PRIVATE_SHAPE, err: "" }) ===
    "PRIVATE", "parseVisibility reads PRIVATE");
ok(CsHub.parseVisibility({ code: 0, out: REPO_VIEW_PUBLIC, err: "" }) ===
    "PUBLIC", "parseVisibility reads PUBLIC");
ok(CsHub.parseVisibility({ code: 0, out: REPO_VIEW_INTERNAL, err: "" }) ===
    "INTERNAL", "parseVisibility reads INTERNAL (synthetic fixture)");
ok(CsHub.parseVisibility(
    { code: 1, out: "", err: REPO_VIEW_MISSING_ERR }) === null,
    "parseVisibility returns null when the repo does not exist");
// Minor-3: STRICT, not case-normalized. Real gh only ever emits
// uppercase, so lowercase is a shape gh never actually produces --
// accepting it anyway is exactly the kind of leniency this privacy
// gate should not have.
ok(CsHub.parseVisibility({ code: 0, out: '{"visibility":"private"}', err: "" }) ===
    "private",
    "parseVisibility is a STRICT passthrough -- lowercase stays " +
    "lowercase, it is not silently upper-cased into a false PRIVATE " +
    "match (a shape gh never actually emits)");
// Important-1 adversarial inputs the previous 24-input pass missed:
// String(["PRIVATE"]) === "PRIVATE" (array-to-string coercion), and
// String({toString:1}) THROWS (no callable toString/valueOf). Real gh
// never emits either shape; both must be rejected without throwing.
ok(CsHub.parseVisibility(
    { code: 0, out: '{"visibility":["PRIVATE"]}', err: "" }) === null,
    "parseVisibility rejects a single-element array, does not " +
    "String()-coerce it into a false PRIVATE match");
ok(CsHub.parseVisibility(
    { code: 0, out: '{"visibility":{"toString":1}}', err: "" }) === null,
    "parseVisibility rejects an object with a non-callable toString " +
    "instead of throwing");

ok(CsHub.isPrivate({ code: 0, out: REPO_VIEW_PRIVATE_SHAPE, err: "" }) === true,
    "isPrivate accepts PRIVATE");
ok(CsHub.isPrivate({ code: 0, out: REPO_VIEW_PUBLIC, err: "" }) === false,
    "isPrivate rejects PUBLIC");
ok(CsHub.isPrivate({ code: 0, out: REPO_VIEW_INTERNAL, err: "" }) === false,
    "isPrivate rejects INTERNAL (synthetic fixture) -- " +
    "org-visible is not private");
ok(CsHub.isPrivate({ code: 1, out: "", err: REPO_VIEW_MISSING_ERR }) === false,
    "isPrivate FAILS CLOSED when the repo cannot be resolved");
ok(CsHub.isPrivate({ code: 1, out: "", err: "gh: command not found" }) === false,
    "isPrivate FAILS CLOSED when gh itself cannot be run");
ok(CsHub.isPrivate(null) === false,
    "isPrivate FAILS CLOSED on no result at all");
ok(CsHub.isPrivate({ code: 0, out: '{"visibility":"private"}', err: "" }) === false,
    "isPrivate rejects lowercase \"private\" -- a shape gh never emits");
ok(CsHub.isPrivate({ code: 0, out: '{"visibility":["PRIVATE"]}', err: "" }) === false,
    "isPrivate does NOT return true for a single-element array " +
    "(the privacy gate must not be defeated by String() coercion)");
(function() {
    var threw = false;
    var result = null;
    try {
        result = CsHub.isPrivate(
            { code: 0, out: '{"visibility":{"toString":1}}', err: "" });
    } catch (e) {
        threw = true;
    }
    ok(threw === false,
        "isPrivate does NOT throw on a visibility object with a " +
        "non-callable toString");
    ok(result === false,
        "... and fails closed (false), the only safe non-throwing " +
        "answer, rather than returning true");
})();

// Scopes. A token without repo makes a private repo 404, which reads
// as "no such repo" -- so this is checked explicitly rather than
// discovered.
var scopes = CsHub.parseScopes({ code: 0, out: AUTH_OK, err: "" });
ok(scopes.indexOf("repo") !== -1, "parseScopes finds repo");
ok(scopes.indexOf("read:org") !== -1, "parseScopes finds read:org");
ok(scopes.indexOf("workflow") !== -1, "parseScopes finds workflow");
ok(CsHub.hasRepoScope({ code: 0, out: AUTH_OK, err: "" }) === true,
    "hasRepoScope true when repo present");
ok(CsHub.hasRepoScope({ code: 0, out: AUTH_THIN, err: "" }) === false,
    "hasRepoScope false when repo absent");
ok(CsHub.hasRepoScope({ code: 1, out: "", err: AUTH_LOGGED_OUT_ERR }) === false,
    "hasRepoScope false when not logged in");

ok(CsHub.parseLogin({ code: 0, out: AUTH_OK, err: "" }) === "ndschonegg",
    "parseLogin reads the account login");
ok(CsHub.parseLogin({ code: 1, out: "", err: AUTH_LOGGED_OUT_ERR }) === null,
    "parseLogin null when not logged in");
ok(CsHub.isAuthenticated({ code: 0, out: AUTH_OK, err: "" }) === true,
    "isAuthenticated true on a good status");
ok(CsHub.isAuthenticated(
    { code: 1, out: "", err: AUTH_LOGGED_OUT_ERR }) === false,
    "isAuthenticated false when logged out");

// Real gh writes the authenticated case to stdout and the logged-out
// case to stderr -- but the stream is a gh implementation detail, so
// both parseLogin and isAuthenticated must read either one.
ok(CsHub.parseLogin({ code: 0, out: "", err: AUTH_OK }) === "ndschonegg",
    "parseLogin reads stderr too");
ok(CsHub.isAuthenticated({ code: 0, out: "", err: AUTH_OK }) === true,
    "isAuthenticated reads stderr too");

// Important-1 regression guard: without --active, gh would print
// BOTH account blocks and these parsers -- which only ever match the
// FIRST occurrence -- would read the inactive account. This is the
// bug (not the shipped behavior; argvAuthStatus always sends
// --active), demonstrated on the synthetic two-account fixture above.
ok(CsHub.parseLogin({ code: 0, out: TWO_ACCOUNT_RAW, err: "" }) === "oldaccount",
    "regression guard: without --active, parseLogin would read the " +
    "FIRST block, not the active one (this is the bug --active fixes)");
ok(CsHub.hasRepoScope({ code: 0, out: TWO_ACCOUNT_RAW, err: "" }) === false,
    "regression guard: without --active, hasRepoScope would read the " +
    "FIRST block's scopes even though the ACTIVE account has repo");
// gh's --active flag (what argvAuthStatus now actually sends) filters
// its output to exactly the active account's block per host. The
// fixture below is MECHANICALLY DERIVED from TWO_ACCOUNT_RAW's second
// (active) block -- not just a re-assertion against AUTH_OK, which
// would be tautological here since AUTH_OK is already asserted above
// and is byte-identical with or without --active in the
// single-account case. Deriving it from the two-account fixture's
// active block, in isolation, is what actually distinguishes
// "--active worked" from "--active is a no-op that happened to pass
// because there was only one block anyway". Synthetic, same reason as
// TWO_ACCOUNT_RAW: modeled on gh's documented --active behavior
// (exactly one block, the active one, no blank-line separator), not
// captured, since a second real account is not obtainable here.
var ACTIVE_BLOCK_ISOLATED =
    "github.com\n" + TWO_ACCOUNT_RAW.split("\n\n")[1];
ok(CsHub.parseLogin(
    { code: 0, out: ACTIVE_BLOCK_ISOLATED, err: "" }) === "ndschonegg",
    "the active block, isolated from the two-account fixture, " +
    "reads as ndschonegg -- not a re-check of AUTH_OK");
ok(CsHub.hasRepoScope(
    { code: 0, out: ACTIVE_BLOCK_ISOLATED, err: "" }) === true,
    "the active block, isolated from the two-account fixture, " +
    "shows repo -- not a re-check of AUTH_OK");

// noreply email, so a real address never lands in permanent history.
ok(CsHub.noreplyEmail({ id: 12345, login: "ndschonegg" }) ===
    "12345+ndschonegg@users.noreply.github.com", "noreplyEmail shape");
ok(CsHub.noreplyEmail(null) === null, "noreplyEmail null on no user");
ok(CsHub.noreplyEmail({ id: 7, login: "" }) === null,
    "noreplyEmail null on an empty login");
// Important-2: a missing/malformed id must not silently stringify
// into a bogus-but-plausible-looking address -- a wrong committer
// address in history is unfixable, same as the real-email leak this
// function exists to prevent.
ok(CsHub.noreplyEmail({ id: undefined, login: "x" }) === null,
    "noreplyEmail null when id is undefined (partial gh api user)");
ok(CsHub.noreplyEmail({ login: "x" }) === null,
    "noreplyEmail null when id is missing entirely");
ok(CsHub.noreplyEmail({ id: null, login: "x" }) === null,
    "noreplyEmail null when id is null");
ok(CsHub.noreplyEmail({ id: NaN, login: "x" }) === null,
    "noreplyEmail null when id is NaN");
ok(CsHub.noreplyEmail({ id: "", login: "x" }) === null,
    "noreplyEmail null when id is an empty string");
ok(CsHub.noreplyEmail({ id: "abc", login: "x" }) === null,
    "noreplyEmail null when id is a non-numeric string");
ok(CsHub.noreplyEmail({ id: "12345", login: "ndschonegg" }) ===
    "12345+ndschonegg@users.noreply.github.com",
    "noreplyEmail accepts a non-empty numeric STRING id " +
    "(gh api user's id is a JSON number, but this is a defensive " +
    "path, not a captured shape)");

// Important-2: the number and string id branches must AGREE. Every
// row below was reachable through the ORIGINAL two-branch check
// (number branch: typeof + isFinite only; string branch: /^\d+$/).
ok(CsHub.noreplyEmail({ id: -1, login: "x" }) === null,
    "noreplyEmail rejects a negative number id");
ok(CsHub.noreplyEmail({ id: 123.5, login: "x" }) === null,
    "noreplyEmail rejects a non-integer number id");
ok(CsHub.noreplyEmail({ id: 1e21, login: "x" }) === null,
    "noreplyEmail rejects 1e21 -- Math.floor(1e21) === 1e21 is " +
    "trivially true in IEEE 754 (no double past 2^52 has a " +
    "fractional part left to floor away), so the id must ALSO be " +
    "capped at Number.MAX_SAFE_INTEGER or this still gets through " +
    "as the exact well-formed-looking wrong address the review warned " +
    "about: \"1e+21+x@users.noreply.github.com\"");
ok(CsHub.noreplyEmail({ id: 1e-5, login: "x" }) === null,
    "noreplyEmail rejects a sub-1 number id (would stringify as " +
    "\"0.00001\")");
ok(CsHub.noreplyEmail({ id: "0123", login: "x" }) === null,
    "noreplyEmail rejects a leading-zero numeric string id");
ok(CsHub.noreplyEmail({ id: Number.MAX_SAFE_INTEGER, login: "x" }) ===
    "9007199254740991+x@users.noreply.github.com",
    "noreplyEmail accepts an id exactly at Number.MAX_SAFE_INTEGER");
ok(CsHub.noreplyEmail({ id: Number.MAX_SAFE_INTEGER + 2, login: "x" }) === null,
    "noreplyEmail rejects an id past Number.MAX_SAFE_INTEGER");
ok(CsHub.noreplyEmail({ id: "99999999999999999999", login: "x" }) === null,
    "noreplyEmail rejects a numeric STRING id past " +
    "Number.MAX_SAFE_INTEGER too -- the two branches still agree");

// Important-2: login was still truthiness-only -- an object, array or
// boolean login silently stringified into a wrong-but-plausible
// address instead of being rejected.
ok(CsHub.noreplyEmail({ login: {}, id: 1 }) === null,
    "noreplyEmail rejects an object login " +
    "(was \"1+[object Object]@users.noreply.github.com\")");
ok(CsHub.noreplyEmail({ login: [], id: 1 }) === null,
    "noreplyEmail rejects an array login (was \"1+@users.noreply...\")");
ok(CsHub.noreplyEmail({ login: true, id: 1 }) === null,
    "noreplyEmail rejects a boolean login " +
    "(was \"1+true@users.noreply.github.com\")");

var u = CsHub.parseApiUser({ code: 0, out: API_USER_REAL, err: "" });
ok(u.login === "ndschonegg" && u.id === 307531413 &&
    u.name === "Nathan Schonegg",
    "parseApiUser reads login, id and name");
var u2 = CsHub.parseApiUser({ code: 0, out: API_USER_NULL_NAME, err: "" });
ok(u2.name === "solo",
    "parseApiUser falls back to login when name is null (synthetic fixture)");
ok(CsHub.parseApiUser({ code: 1, out: "", err: "HTTP 401" }) === null,
    "parseApiUser null on failure");

// Minor-1: same class of bug as parseVisibility -- truthiness plus
// String() coercion let a malformed login through silently (an
// array) or threw outright (an object with a non-callable toString).
(function() {
    var threw = false;
    var result = null;
    try {
        result = CsHub.parseApiUser(
            { code: 0, out: '{"login":{"toString":1},"id":1}', err: "" });
    } catch (e) {
        threw = true;
    }
    ok(threw === false,
        "parseApiUser does NOT throw on a login object with a " +
        "non-callable toString");
    ok(result === null,
        "... and returns null rather than a bogus user object");
})();
ok(CsHub.parseApiUser({ code: 0, out: '{"login":["x"],"id":1}', err: "" }) === null,
    "parseApiUser rejects an array login instead of silently " +
    "String()-coercing it to \"x\"");
var u3 = CsHub.parseApiUser(
    { code: 0, out: '{"login":"x","id":1,"name":{"toString":1}}', err: "" });
ok(u3 !== null && u3.name === "x",
    "parseApiUser falls back to login when name is a malformed " +
    "shape, instead of throwing on String(name)");

// Important-3: a future gh that renames or drops --active must not
// look identical to "logged out" -- isUsageError distinguishes a
// usage error from an auth failure. Real capture, gh 2.97.0,
// 2026-08-21: `gh auth status --this-flag-does-not-exist`, a made-up
// flag chosen so this cannot collide with a real one gh ever adds.
// Exit 1, 0 bytes on stdout, 484 bytes on stderr; only the first line
// is reproduced here since that is all the classifier looks at.
var USAGE_ERROR_ERR =
    "unknown flag: --this-flag-does-not-exist\n\n" +
    "Usage:  gh auth status [flags]\n";
ok(CsHub.isUsageError({ code: 1, out: "", err: USAGE_ERROR_ERR }) === true,
    "isUsageError spots a real \"unknown flag\" rejection");
ok(CsHub.isUsageError({ code: 1, out: "", err: AUTH_LOGGED_OUT_ERR }) === false,
    "isUsageError does not misclassify a real logged-out message");
ok(CsHub.isUsageError({ code: 0, out: AUTH_OK, err: "" }) === false,
    "isUsageError does not misclassify a good auth status");

// Minor-2: pairs with isUsageError so Task 4 can tell "offline" apart
// from "not private". Real capture, gh 2.97.0, 2026-08-21:
// `HTTPS_PROXY=http://nonexistent-proxy.invalid gh repo view
// octocat/Spoon-Knife --json visibility` -- a self-inflicted,
// no-real-network-touched failure (the proxy host cannot resolve),
// not a genuine internet outage, but gh's wording for "could not
// reach the network at all" is real and exact. Exit 1, 0 bytes
// stdout, 105 bytes stderr.
var NETWORK_FAILURE_ERR =
    "error connecting to nonexistent-proxy.invalid\n" +
    "check your internet connection or https://githubstatus.com\n";
ok(CsHub.isNetworkFailure({ code: 1, out: "", err: NETWORK_FAILURE_ERR }) === true,
    "isNetworkFailure spots gh's real offline wording");
ok(CsHub.isNetworkFailure(
    { code: 1, out: "", err: REPO_VIEW_MISSING_ERR }) === false,
    "isNetworkFailure does not misclassify a real \"repo not found\"");
ok(CsHub.isNetworkFailure({ code: 1, out: "", err: USAGE_ERROR_ERR }) === false,
    "isNetworkFailure does not misclassify a usage error");

// ---------------------------------------------------------------------
// CsSetup -- discovery and install help.
//
// PATH is checked LAST, deliberately. The probe that found gh working
// inside CaveCAD ran the app FROM A TERMINAL, so it inherited a login
// shell PATH. Launched from Finder, a macOS GUI app has no
// /opt/homebrew/bin -- gh would read as "not installed" on a machine
// that has it.
// ---------------------------------------------------------------------

var ghMac = CsSetup.candidates("osx", "gh");
ok(ghMac[0] === "/opt/homebrew/bin/gh", "osx tries Homebrew arm64 first");
ok(ghMac.indexOf("/usr/local/bin/gh") > 0, "osx includes Homebrew intel prefix");
ok(ghMac[ghMac.length - 1] === "gh", "bare name (PATH) is LAST, not first");

var gitLinux = CsSetup.candidates("linux", "git");
ok(gitLinux[0] === "/usr/bin/git", "linux tries /usr/bin first");
ok(gitLinux[gitLinux.length - 1] === "git", "linux falls back to PATH last");

var ghWin = CsSetup.candidates("win", "gh");
ok(ghWin[ghWin.length - 1] === "gh.exe", "win falls back to gh.exe on PATH");
ok(ghWin.length > 1, "win has at least one absolute candidate");

// resolve() takes an injected existence predicate so this is testable
// with no filesystem.
var present = { "/usr/local/bin/gh": true };
ok(CsSetup.resolve("gh", "osx", function(p) { return present[p] === true; }) ===
    "/usr/local/bin/gh", "resolve picks the first existing candidate");
ok(CsSetup.resolve("gh", "osx", function() { return false; }) === null,
    "resolve returns null when nothing exists");

// A stale cache must not survive.
ok(CsSetup.validateCached("/opt/homebrew/bin/gh",
        function() { return false; }) === null,
    "validateCached discards a path that no longer resolves");
ok(CsSetup.validateCached("/usr/local/bin/gh",
        function(p) { return present[p] === true; }) === "/usr/local/bin/gh",
    "validateCached keeps a path that still resolves");
ok(CsSetup.validateCached("", function() { return true; }) === null,
    "validateCached rejects an empty cached value");

// Install help, per platform. Every rung's dialog is a remedy, so the
// text is asserted rather than left to whoever writes the dialog.
var hMac = CsSetup.installHelp("osx", "gh");
ok(hMac.command === "brew install gh", "osx gh command is brew install gh");
ok(hMac.links.join(" ").indexOf("https://cli.github.com/") !== -1,
    "osx gh help links cli.github.com");
var hWin = CsSetup.installHelp("win", "gh");
ok(hWin.command === "winget install -e --id GitHub.cli", "win gh command is winget");
var hLin = CsSetup.installHelp("linux", "gh");
ok(hLin.links.join(" ").indexOf("install_linux.md") !== -1,
    "linux gh help links the distro instructions");
var gMac = CsSetup.installHelp("osx", "git");
ok(gMac.command === "xcode-select --install", "osx git command is xcode-select");
var gWin = CsSetup.installHelp("win", "git");
ok(gWin.links.join(" ").indexOf("git-scm.com/download/win") !== -1,
    "win git help links git-scm");
var gLin = CsSetup.installHelp("linux", "git");
ok(gLin.links.length > 0, "linux git help has a link");
ok(CsSetup.installHelp("osx", "nonsense") === null,
    "installHelp returns null for an unknown program");

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
