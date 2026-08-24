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
// Same reason as isNull above -- the hookup tests further down build
// real RDocuments, and this build's -autostart entry point does not
// always preload library.js's own copy.
if (typeof createSpatialIndex === "undefined") {
    createSpatialIndex = function() {
        return new RSpatialIndexNavel();
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
    "scripts/CaveSurvey/Core/CsCave.js",
    "scripts/CaveSurvey/Core/CsGeoProject.js",
    "scripts/CaveSurvey/Core/CsAngles.js",
    "scripts/CaveSurvey/Core/CsIgrfCoeffs.js",
    "scripts/CaveSurvey/Core/CsGeomag.js",
    "scripts/CaveSurvey/Core/CsModel.js",
    "scripts/CaveSurvey/Core/CsTraverse.js",
    "scripts/CaveSurvey/Core/CsNetwork.js",
    "scripts/CaveSurvey/Core/CsAdjust.js",
    "scripts/CaveSurvey/Core/CsLrud.js",
    "scripts/CaveSurvey/Core/CsProfile.js",
    // CsProfileDraw is QCAD-context for render()/erase()/band()/run()/
    // label() (RVector, RLineEntity, ...), but CsProfileDraw.labelText
    // and CsProfileDraw.labelY0 are pure -- no document, no QCAD symbol
    // -- and can be loaded and called here exactly like CsProfile's own
    // functions. Loading the file costs nothing under node: none of its
    // QCAD-only functions are ever CALLED from this file, only defined,
    // and defining a function that REFERENCES CsLayers/CsDraw/CsTags
    // does not touch either symbol until that function actually runs.
    "scripts/CaveSurvey/Core/CsProfileDraw.js",
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

// Exact equality with a near()-style failure message. Its point is
// bundled assertions: a single ok(x !== null && x.a === "..." &&
// x.b === "...", what) reports only which CASE failed, not which
// FIELD or value -- eqs(actual, expected, what) names the value, so
// a failure is readable without re-running the test by hand.
function eqs(a, b, what) {
    ok(a === b, what + " (expected " + b + ", got " + a + ")");
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
// Traverse -- an absent measurement is not a coordinate.
//
// `null * Math.cos(x)` is `0`; `undefined * Math.cos(x)` is `NaN`. So
// without a guard, a shot with no distance draws AT its station (a
// fabricated wall point) and one with no distance recorded as
// `undefined` poisons every coordinate downstream with NaN. The guard
// must catch both, plus the same failure mode on the EFFECTIVE
// (fs/bs-corrected) azimuth and inclination -- and must NOT catch a
// real zero, which is a measurement, not an absence.
// ---------------------------------------------------------------------

(function() {
    var complete = { distance: 10, azimuth: 45, inclination: 20 };
    ok(CsTraverse.offset(complete, CsTraverse.SLOPE) !== null,
        "a complete shot still returns a real offset");

    ok(CsTraverse.offset(
        { distance: null, azimuth: 45, inclination: 20 }, CsTraverse.SLOPE
    ) === null, "null distance returns null, not a coordinate");
    ok(CsTraverse.offset(
        { distance: undefined, azimuth: 45, inclination: 20 }, CsTraverse.SLOPE
    ) === null, "undefined distance returns null, not NaN");
    ok(CsTraverse.offset(
        { distance: NaN, azimuth: 45, inclination: 20 }, CsTraverse.SLOPE
    ) === null, "NaN distance returns null");
    ok(CsTraverse.offset(
        { distance: Infinity, azimuth: 45, inclination: 20 }, CsTraverse.SLOPE
    ) === null, "non-finite (Infinity) distance returns null");

    ok(CsTraverse.offset(
        { distance: 10, azimuth: 45, inclination: null }, CsTraverse.SLOPE
    ) === null, "null inclination returns null, not a level shot");
    ok(CsTraverse.offset(
        { distance: 10, azimuth: 45, inclination: undefined }, CsTraverse.SLOPE
    ) === null, "undefined inclination returns null");

    ok(CsTraverse.offset(
        { distance: 10, azimuth: null, inclination: 20 }, CsTraverse.SLOPE
    ) === null, "null azimuth returns null, not a north-facing fabrication");
    ok(CsTraverse.offset(
        { distance: 10, azimuth: undefined, inclination: 20 }, CsTraverse.SLOPE
    ) === null, "undefined azimuth returns null");

    // the EFFECTIVE inclination/azimuth is what is checked: a bad
    // backsight that poisons the fs/bs mean must be caught too, not
    // just the raw foresight field
    ok(CsTraverse.offset({
        distance: 10, azimuth: 45, inclination: 20, backInclination: NaN
    }, CsTraverse.SLOPE) === null,
        "a NaN backsight poisoning the effective inclination returns null");

    // THE DISTINCTION THE WHOLE TASK TURNS ON: zero is a measurement,
    // absence is not. A zero-length, zero-inclination, zero-azimuth
    // shot is a real (if degenerate) reading and must keep returning
    // real, non-null geometry exactly as it always has.
    var zero = CsTraverse.offset(
        { distance: 0, azimuth: 0, inclination: 0 }, CsTraverse.SLOPE);
    ok(zero !== null, "distance 0 is a measurement, not an absence");
    near(zero.dx, 0, 1e-9, "zero distance: dx is really zero");
    near(zero.dy, 0, 1e-9, "zero distance: dy is really zero");
    near(zero.dz, 0, 1e-9, "zero distance: dz is really zero");
    var zeroInc = CsTraverse.offset(
        { distance: 10, azimuth: 0, inclination: 0 }, CsTraverse.SLOPE);
    ok(zeroInc !== null, "inclination 0 is a level shot, not an absence");
    near(zeroInc.plan, 10, 1e-9, "level shot keeps its full plan distance");

    // reverseOffset must not launder a null through the negation --
    // -null is still fabricated geometry
    ok(CsTraverse.reverseOffset(
        { distance: null, azimuth: 45, inclination: 20 }, CsTraverse.SLOPE
    ) === null, "reverseOffset passes the null through rather than " +
        "negating undefined fields");
    var revComplete = CsTraverse.reverseOffset(complete, CsTraverse.SLOPE);
    ok(revComplete !== null, "reverseOffset still works for a real shot");
    near(revComplete.dx, -CsTraverse.offset(complete, CsTraverse.SLOPE).dx,
        1e-9, "reverseOffset still negates a real shot's offset");
}());

// ---------------------------------------------------------------------
// Review I1: `isFinite` coerces before testing, so a bare `!isFinite(v)`
// misses every non-number encoding of "absent" -- blank strings above
// all, the commonest textual spelling, and the one the upstream parser
// task is about to start producing. One row per coercion hole, both on
// `unusable` directly and through `offset` end to end.
// ---------------------------------------------------------------------

(function() {
    ok(CsTraverse.unusable("") === true, 'unusable(""): a blank string is absent, not zero');
    ok(CsTraverse.unusable("  ") === true, 'unusable("  "): whitespace is absent too');
    ok(CsTraverse.unusable(false) === true, "unusable(false): not a number");
    ok(CsTraverse.unusable([]) === true, "unusable([]): not a number, even though [] == 0");
    ok(CsTraverse.unusable("5") === true,
        'unusable("5"): a numeric STRING is still not a number -- every ' +
        "parser parseFloats before a shot field is ever set, so this " +
        "costs nothing on real input");
    ok(CsTraverse.unusable(0) === false, "unusable(0): a real zero is never unusable");
    ok(CsTraverse.unusable(-5.5) === false, "unusable(-5.5): a real negative is never unusable");

    ok(CsTraverse.offset(
        { distance: "", azimuth: 45, inclination: 20 }, CsTraverse.SLOPE
    ) === null, 'offset: a blank-string distance returns null, not a ' +
        "coordinate at the station");
    ok(CsTraverse.offset(
        { distance: 10, azimuth: "  ", inclination: 20 }, CsTraverse.SLOPE
    ) === null, "offset: a whitespace-string azimuth returns null");
    ok(CsTraverse.offset(
        { distance: 10, azimuth: 45, inclination: false }, CsTraverse.SLOPE
    ) === null, "offset: a boolean inclination returns null");
    ok(CsTraverse.offset(
        { distance: [], azimuth: 45, inclination: 20 }, CsTraverse.SLOPE
    ) === null, "offset: an array distance returns null");
}());

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

// ---- anchors, error components, component ties ----------------------
ok(rsq.anchors.length === 1 && rsq.anchors[0] === "A4",
    "resolve exports its anchor (A4, the first usable shot's FROM)");
if (rsq.loops.length === 1) {
    near(rsq.loops[0].horizontal, 0.5, 1e-9, "loop horizontal error");
    near(rsq.loops[0].vertical, 0, 1e-9, "loop vertical error");
    near(rsq.closures[0].horizontal, 0.5, 1e-9, "closure horizontal error");
    near(rsq.closures[0].vertical, 0, 1e-9, "closure vertical error");
}

// a vertical-only misclosure must land in `vertical`, not be smeared
// into a number a reader takes for a plan error
var vsq = CsModel.newSurvey();
vsq.shots.push(shotOf("V1", "V2", 10, 0, 0));
vsq.shots.push(shotOf("V2", "V3", 10, 90, 0));
vsq.shots.push(shotOf("V3", "V1", 10 * Math.sqrt(2), 225, 2));
var rv = CsNetwork.resolve(vsq, {});
ok(rv.loops.length === 1, "vertical-bust survey has one loop");
if (rv.loops.length === 1) {
    // The closing leg's slope distance is fixed, so tilting it by 2 deg
    // shrinks its plan projection by a factor of cos(2 deg) -- a real,
    // if tiny, second-order coupling between "vertical bust" and
    // horizontal error, not a bug to paper over with an exact zero.
    var expectedHorizontal = 10 * Math.sqrt(2) *
        (1 - Math.cos(2 * Math.PI / 180));
    near(rv.loops[0].horizontal, expectedHorizontal, 1e-9,
        "vertical bust's horizontal error is only the small second-order tilt term");
    ok(rv.loops[0].vertical > 0.4, "vertical bust shows up as vertical error");
}

// two fixed components joined by one leg: a control tie, not a loop
var tie = CsModel.newSurvey();
tie.shots.push(shotOf("P1", "P2", 10, 0));
tie.shots.push(shotOf("Q1", "Q2", 10, 0));
tie.shots.push(shotOf("P2", "Q1", 10, 90));   // joins the two components
tie.fixed["P1"] = { x: 0, y: 0, z: 0 };
tie.fixed["Q1"] = { x: 10.4, y: 10, z: 0 };   // 0.4 off where P2->Q1 lands it
var rtie = CsNetwork.resolve(tie, {});
ok(rtie.loops.length === 0, "a component tie is not reported as a loop");
ok(rtie.ties.length === 1, "a component tie is reported as a tie");
if (rtie.ties.length === 1) {
    near(rtie.ties[0].error, 0.4, 1e-9, "tie misclosure against fixed control");
}
var tieLeg = null;
for (var tli = 0; tli < rtie.legs.length; tli++) {
    if (rtie.legs[tli].from === "P2" && rtie.legs[tli].to === "Q1") {
        tieLeg = rtie.legs[tli];
    }
}
ok(tieLeg !== null && tieLeg.kind === "tie", "the joining leg is kind 'tie'");
var tieFindings = CsValidate.check(tie, rtie);
var tieMisclosure = 0;
for (tli = 0; tli < tieFindings.length; tli++) {
    if (tieFindings[tli].code === "loop-misclosure") { tieMisclosure++; }
}
ok(tieMisclosure === 0, "a tie raises no loop-misclosure finding");
ok(rtie.anchors.length === 2, "each fixed component contributes an anchor");

// closures[] carry a kind matching which list they landed in
ok(rsq.closures[0].kind === "loop", "square fixture's closure is kind 'loop'");
ok(rtie.closures[0].kind === "tie", "tie fixture's closure is kind 'tie'");

// a there-and-back 2-station ring is a loop, not a tie: the closing
// shot is not the network's only connection between its ends (there
// are two parallel legs between R1 and R2), so the bridge test
// correctly says "loop", regardless of the chain-meet heuristic this
// replaced.
var backRing = CsModel.newSurvey();
backRing.shots.push(shotOf("R1", "R2", 10, 0));
backRing.shots.push(shotOf("R2", "R1", 10, 180));
var rBackRing = CsNetwork.resolve(backRing, {});
ok(rBackRing.loops.length === 1 && rBackRing.ties.length === 0,
    "a there-and-back 2-station ring is a loop, not a tie");

// A ring carrying two fixed stations: chain-meet is the wrong test
// here -- RA and RC anchor at two different spanning-tree roots even
// though the ring is one component throughout -- which is exactly the
// regression a spec reviewer caught. Seeding every fixed station up
// front (needed to make the P1/Q1 tie fixture above work at all)
// means the RB->RC and RD->RA legs BOTH arrive with both ends already
// known, so each is independently a closure: the ring produces two
// closures, one per arc between the two controls, not one figure for
// the whole ring. Both must come back "loop", never "tie".
var ring = CsModel.newSurvey();
ring.shots.push(shotOf("RA", "RB", 10, 0));
ring.shots.push(shotOf("RB", "RC", 10, 90));
ring.shots.push(shotOf("RC", "RD", 10, 180));
ring.shots.push(shotOf("RD", "RA", 10, 270));
ring.fixed["RA"] = { x: 0, y: 0, z: 0 };
ring.fixed["RC"] = { x: 10, y: 10, z: 0 };
var rring = CsNetwork.resolve(ring, {});
ok(rring.ties.length === 0, "two fixed stations on one ring: no ties");
ok(rring.loops.length === 2,
    "two fixed stations on one ring produce two arc closures, both loops");
if (rring.loops.length === 2) {
    // Each loop's traverseLength is its OWN arc, not the whole ring:
    // the closing leg itself (10) plus the one tree leg on the way
    // back to the other anchor (10) = 20, hand-computed independently
    // of the implementation.
    for (var rli = 0; rli < rring.loops.length; rli++) {
        near(rring.loops[rli].traverseLength, 20, 1e-9,
            "each arc-loop's traverseLength is its own half of the ring, not the full 40");
        near(rring.loops[rli].error, 0, 1e-6,
            "clean ring: each arc closes to (near) zero");
    }
}

// Same ring, a deliberate 5-unit blunder on one arc (RB->RC surveyed
// as 15 instead of 10): CsValidate must flag it, and CsGrade must see
// that loops exist. This is exactly the blindness the regression
// caused -- both closures used to be misclassified as ties, and
// neither CsValidate nor CsGrade ever look at resolved.ties for
// misclosure.
var ringBlunder = CsModel.newSurvey();
ringBlunder.shots.push(shotOf("BA", "BB", 10, 0));
ringBlunder.shots.push(shotOf("BB", "BC", 15, 90));  // 5-unit blunder
ringBlunder.shots.push(shotOf("BC", "BD", 10, 180));
ringBlunder.shots.push(shotOf("BD", "BA", 10, 270));
ringBlunder.fixed["BA"] = { x: 0, y: 0, z: 0 };
ringBlunder.fixed["BC"] = { x: 10, y: 10, z: 0 };
var rringBlunder = CsNetwork.resolve(ringBlunder, {});
ok(rringBlunder.loops.length === 2 && rringBlunder.ties.length === 0,
    "blundered ring still resolves to two loops, no ties");
var blunderFindings = CsValidate.check(ringBlunder, rringBlunder);
var blunderMisclosures = 0;
for (var bfi = 0; bfi < blunderFindings.length; bfi++) {
    if (blunderFindings[bfi].code === "loop-misclosure") { blunderMisclosures++; }
}
ok(blunderMisclosures === 1,
    "the blundered arc raises exactly one loop-misclosure finding");
var blunderStats = CsStats.compute(ringBlunder, rringBlunder, CsTraverse.SLOPE);
var blunderGrade = CsGrade.compute(ringBlunder, rringBlunder, blunderStats);
ok(blunderGrade.centrelineText.indexOf("no loops") === -1,
    "CsGrade sees the loops -- it must not claim there are none");

// explicit anchor wins
var ranch = CsNetwork.resolve(back, { anchor: { name: "X1", x: 5, y: 5, z: 0 } });
near(ranch.stations["X2"].y, -5, 1e-9, "explicit anchor overrides fixed");

// ---------------------------------------------------------------------
// Task 1b -- fixed control follows the anchor's frame.
//
// `back` has exactly ONE fixed station and it IS the anchor -- the
// "0 or 1 fixed station" case from the acceptance criteria. There is
// nothing else to offset, so this must be byte-identical to the
// resolve above: same station geometry, and a controlFrame that
// applied nothing.
// ---------------------------------------------------------------------
near(ranch.stations["X2"].y, -5, 1e-9,
    "task 1b: single-fixed-station anchor resolve is unchanged");
ok(ranch.controlFrame !== null && ranch.controlFrame !== undefined,
    "task 1b: controlFrame is present even when there is nothing to offset");
if (ranch.controlFrame) {
    ok(ranch.controlFrame.applied.length === 0,
        "task 1b: nothing else to apply the offset to -- one fixed station, and it's the anchor");
}

// Two-component tie fixture (P1/Q1), reused from the block above but
// with its own survey object so an explicit anchor can be layered on
// without disturbing `tie`. The anchor sits at a DIFFERENT drawing
// position than P1's own control (500,-200 instead of 0,0) so the
// frame offset is a real, nonzero translation -- proving the
// invariance below isn't a fluke of both frames coinciding.
var tieAnchored = CsModel.newSurvey();
tieAnchored.shots.push(shotOf("P1", "P2", 10, 0));
tieAnchored.shots.push(shotOf("Q1", "Q2", 10, 0));
tieAnchored.shots.push(shotOf("P2", "Q1", 10, 90));
tieAnchored.fixed["P1"] = { x: 0, y: 0, z: 0 };
tieAnchored.fixed["Q1"] = { x: 10.4, y: 10, z: 0 };

var rNoAnchorTie = CsNetwork.resolve(tieAnchored, {});
var rAnchoredTie = CsNetwork.resolve(tieAnchored,
    { anchor: { name: "P1", x: 500, y: -200, z: 0 } });

ok(rAnchoredTie.ties.length === 1,
    "task 1b: an explicit anchor on a fixed station still reports the tie, not a discard");
ok(rNoAnchorTie.ties.length === 1,
    "task 1b: sanity -- the same survey with no anchor also reports one tie");
if (rAnchoredTie.ties.length === 1 && rNoAnchorTie.ties.length === 1) {
    // THE INVARIANCE THAT PROVES IT RIGHT: a frame offset is a pure
    // translation and cannot change a measured disagreement. If these
    // two numbers differ, the offset logic is wrong regardless of
    // what else passes.
    near(rAnchoredTie.ties[0].error, rNoAnchorTie.ties[0].error, 1e-9,
        "task 1b invariance: tie misclosure is identical with or without the explicit anchor");
}
near(rAnchoredTie.stations["Q1"].x, 10.4 + 500, 1e-9,
    "task 1b: Q1's control is translated by the anchor's offset (x)");
near(rAnchoredTie.stations["Q1"].y, 10 + (-200), 1e-9,
    "task 1b: Q1's control is translated by the anchor's offset (y)");
ok(rAnchoredTie.anchors.length === 2,
    "task 1b: both P1 (explicit anchor) and Q1 (offset control) anchor their components");
ok(rAnchoredTie.controlFrame !== null && rAnchoredTie.controlFrame !== undefined,
    "task 1b: resolve exposes what it did with the fixed frame");
if (rAnchoredTie.controlFrame) {
    near(rAnchoredTie.controlFrame.offset.dx, 500, 1e-9,
        "task 1b: controlFrame.offset.dx is the anchor's x minus P1's own control x");
    near(rAnchoredTie.controlFrame.offset.dy, -200, 1e-9,
        "task 1b: controlFrame.offset.dy likewise for y");
    ok(rAnchoredTie.controlFrame.applied.indexOf("Q1") >= 0,
        "task 1b: controlFrame names Q1 as an applied (offset) station");
}

// Same-component variant: two fixed stations on ONE ring (reusing the
// `ring` fixture from the Task 1 block above), explicit anchor on RA.
// There is no tie here -- both arcs are loops -- but the invariance
// still has to hold, and RC's control still has to be translated.
var rRingAnchored = CsNetwork.resolve(ring,
    { anchor: { name: "RA", x: 1000, y: -1000, z: 0 } });
ok(rRingAnchored.loops.length === rring.loops.length,
    "task 1b: anchored ring keeps the same number of arc loops");
ok(rRingAnchored.ties.length === 0,
    "task 1b: still no ties on an anchored single-component ring");
if (rRingAnchored.loops.length === rring.loops.length) {
    for (var rai = 0; rai < rring.loops.length; rai++) {
        near(rRingAnchored.loops[rai].error, rring.loops[rai].error, 1e-9,
            "task 1b invariance: anchored ring's arc " + rai +
            " misclosure matches the un-anchored resolve");
    }
}
near(rRingAnchored.stations["RC"].x, 10 + 1000, 1e-9,
    "task 1b: RC's control is translated into RA's anchor frame (x)");
near(rRingAnchored.stations["RC"].y, 10 + (-1000), 1e-9,
    "task 1b: RC's control is translated into RA's anchor frame (y)");

// Explicit anchor whose OWN station has NO control at all: there is
// nothing to compute a translation from, so today's behavior stands
// -- P1 and Q1 are both still walked by ordinary traversal, their
// controls discarded exactly as before this task -- but the fact must
// be named, not buried a second time.
var rNoControlAnchor = CsNetwork.resolve(tieAnchored,
    { anchor: { name: "P2", x: 0, y: 0, z: 0 } });
near(rNoControlAnchor.stations["Q1"].x, 10, 1e-9,
    "task 1b: with no control to offset from, Q1 is walked by traversal (unchanged from today)");
near(rNoControlAnchor.stations["Q1"].y, 0, 1e-9,
    "task 1b: ...same for y");
ok(rNoControlAnchor.controlFrame !== null &&
    rNoControlAnchor.controlFrame !== undefined,
    "task 1b: resolve names the situation even when it can't fix it");
if (rNoControlAnchor.controlFrame) {
    ok(rNoControlAnchor.controlFrame.offset === null,
        "task 1b: no control to offset from means no offset computed");
    ok(rNoControlAnchor.controlFrame.notHonored.indexOf("P1") >= 0 &&
        rNoControlAnchor.controlFrame.notHonored.indexOf("Q1") >= 0,
        "task 1b: controlFrame names BOTH un-honored fixed stations");
    ok(rNoControlAnchor.controlFrame.reason !== null &&
        rNoControlAnchor.controlFrame.reason !== "",
        "task 1b: controlFrame explains why, in words");
}

// A fixed station with NO shot path to the anchor at all is a
// separate cave passage, not a frame disagreement with THIS anchor --
// it must keep anchoring itself at its own true control, same as
// always, and must not appear in controlFrame at all (it was never
// "fought" by this anchor in the first place).
var islandSv = CsModel.newSurvey();
islandSv.shots.push(shotOf("P1", "P2", 10, 0));
islandSv.shots.push(shotOf("Q1", "Q2", 10, 0));
islandSv.shots.push(shotOf("P2", "Q1", 10, 90));
islandSv.shots.push(shotOf("Z1", "Z2", 10, 0));   // wholly separate passage
islandSv.fixed["P1"] = { x: 0, y: 0, z: 0 };
islandSv.fixed["Q1"] = { x: 10.4, y: 10, z: 0 };
islandSv.fixed["Z1"] = { x: 9000, y: 9000, z: 0 };
var rIsland = CsNetwork.resolve(islandSv,
    { anchor: { name: "P1", x: 500, y: -200, z: 0 } });
near(rIsland.stations["Z1"].x, 9000, 1e-9,
    "task 1b: an unrelated fixed island keeps its own true control (x), not the anchor's offset");
near(rIsland.stations["Z1"].y, 9000, 1e-9,
    "task 1b: ...same for y");
if (rIsland.controlFrame) {
    ok(rIsland.controlFrame.applied.indexOf("Z1") === -1,
        "task 1b: the unrelated island is not named as an applied offset station");
    ok(rIsland.controlFrame.notHonored.indexOf("Z1") === -1,
        "task 1b: ...nor as a not-honored one -- it was never in play for this anchor");
}

// ---- the elevation subtlety --------------------------------------
//
// An absent anchor z must not rebase an absolute-datum cave (an
// entrance surveyed at 1250 ft, say) down to zero. Only an EXPLICIT
// anchor z -- including an explicit 0 -- means "move z too".
var elevSv = CsModel.newSurvey();
elevSv.shots.push(shotOf("E1", "E2", 10, 0));
elevSv.shots.push(shotOf("F1", "F2", 10, 0));
elevSv.shots.push(shotOf("E2", "F1", 10, 90));
elevSv.fixed["E1"] = { x: 0, y: 0, z: 1250 };
elevSv.fixed["F1"] = { x: 10, y: 10, z: 1300 };

var rElevNoAnchor = CsNetwork.resolve(elevSv, {});
// anchor pins E1's drawing position but says nothing about elevation
var rElevNoZ = CsNetwork.resolve(elevSv,
    { anchor: { name: "E1", x: 500, y: 500 } });
near(rElevNoZ.stations["F1"].z, 1300, 1e-9,
    "task 1b elevation: with no anchor z supplied, F1 keeps its own 1250-ft-class datum, not rebased to 0");
if (rElevNoZ.controlFrame) {
    near(rElevNoZ.controlFrame.offset.dz, 0, 1e-9,
        "task 1b elevation: controlFrame records a zero z-offset when the anchor supplied no z");
}
near(rElevNoZ.ties[0].error, rElevNoAnchor.ties[0].error, 1e-9,
    "task 1b elevation invariance: tie misclosure unaffected by the absent-z fallback");

// an EXPLICIT anchor z (even one that disagrees with the control) DOES
// drive the offset -- that's the caller deliberately saying "move z"
var rElevExplicit = CsNetwork.resolve(elevSv,
    { anchor: { name: "E1", x: 500, y: 500, z: 1000 } });
near(rElevExplicit.stations["F1"].z, 1300 - 250, 1e-9,
    "task 1b elevation: an explicit anchor z of 1000 (vs E1's control of 1250) shifts F1 by the same -250");
if (rElevExplicit.controlFrame) {
    near(rElevExplicit.controlFrame.offset.dz, -250, 1e-9,
        "task 1b elevation: controlFrame records the actual z offset applied");
}

// an explicit anchor z of exactly 0 is still explicit -- not the same
// as omitting z altogether
var rElevZeroAnchor = CsNetwork.resolve(elevSv,
    { anchor: { name: "E1", x: 500, y: 500, z: 0 } });
near(rElevZeroAnchor.stations["F1"].z, 1300 - 1250, 1e-9,
    "task 1b elevation: an explicit anchor z of exactly 0 still counts as explicit, not absent");

// ---------------------------------------------------------------------
// Task 5b review, the sixth door: an absent anchor Z is not zero.
// `rElevNoZ` above already covers "anchor IS a fixed station with a
// real z" (falls back to it, unchanged). These cover the other half:
// no z anywhere at all.
// ---------------------------------------------------------------------

(function() {
    // the anchor's name is not a fixed/control station at all, and it
    // supplied no z: there is nothing anywhere to read an elevation
    // from. Must anchor at z = null (plan position still matters), not
    // a fabricated 0, and must name the gap.
    var sv = CsModel.newSurvey();
    sv.shots.push(shotOf("G1", "G2", 10, 90)); // due east
    var r = CsNetwork.resolve(sv, { anchor: { name: "G1", x: 500, y: 500 } });
    eqs(r.stations["G1"].z, null,
        "sixth door: an anchor with no z anywhere is placed at z = null, not 0");
    ok(r.anchorZUnknown !== null && r.anchorZUnknown.name === "G1",
        "sixth door: the gap is named in anchorZUnknown, not silently absorbed");
    // x/y still resolve -- plan view does not lose the anchor over a
    // missing elevation, which the comment above calls the COMMON case
    near(r.stations["G1"].x, 500, 1e-9,
        "sixth door: the anchor's x/y still take, even with z unknown");
    near(r.stations["G2"].x, 510, 1e-9,
        "sixth door: and the rest of the traverse still resolves off it");
}());

(function() {
    // REGRESSION, the distinction this door turns on too: a fixed
    // anchor station whose OWN control z is a real, explicit 0 (sea
    // level, or a cave datumed at its own entrance) must NOT be
    // treated as unknown.
    var sv = CsModel.newSurvey();
    sv.shots.push(shotOf("H1", "H2", 10, 0));
    sv.fixed["H1"] = { x: 0, y: 0, z: 0 };
    var r = CsNetwork.resolve(sv, { anchor: { name: "H1", x: 500, y: 500 } });
    eqs(r.stations["H1"].z, 0,
        "sixth door: a REAL zero control z is used, not treated as unknown");
    eqs(r.anchorZUnknown, null,
        "sixth door: anchorZUnknown stays null when a real (even zero) z was found");
}());

(function() {
    // defensive-only (no current writer can produce this): if a fixed
    // station's own z were ever non-finite, that must not fabricate a
    // 0 either -- same rule, reached the other way.
    var sv = CsModel.newSurvey();
    sv.shots.push(shotOf("K1", "K2", 10, 0));
    sv.fixed["K1"] = { x: 0, y: 0, z: NaN };
    var r = CsNetwork.resolve(sv, { anchor: { name: "K1", x: 500, y: 500 } });
    eqs(r.stations["K1"].z, null,
        "sixth door: a non-finite control z is treated as absent, not 0");
    ok(r.anchorZUnknown !== null,
        "sixth door: and named, same as the no-record case");
}());

// ---------------------------------------------------------------------
// EIGHTH DOOR (elevation-datum trap, seedFixed's own copy of the sixth
// door's fabrication): a *fix'ed/#Fix'ed station with no usable z must
// resolve at z = null, not a silently refabricated 0 -- the identical
// `f.z || 0.0` disease the anchor path already refuses, now reachable
// because CsTags.surveyFromDocument's own "SEVENTH DOOR" fix hands this
// file a real null for the first time. Pure CsNetwork.resolve logic, so
// tested here under node as well as CaveCAD, unlike the seventh door
// itself (CsTags.js needs a real document).
// ---------------------------------------------------------------------

(function() {
    // no z at all on the fixed entry (key simply absent) -- the
    // ordinary "hand-built survey.fixed object with a typo" shape.
    var sv = CsModel.newSurvey();
    sv.shots.push(shotOf("N1", "N2", 10, 0));
    sv.fixed["N1"] = { x: 0, y: 0 };   // no z key at all
    var r = CsNetwork.resolve(sv, {});
    eqs(r.stations["N1"].z, null,
        "eighth door: a *fix'ed station missing z entirely resolves at " +
        "z = null, not 0");
    ok(r.fixedZUnknown.indexOf("N1") >= 0,
        "eighth door: the gap is named in fixedZUnknown, not silently " +
        "absorbed");
}());

(function() {
    // explicit null (what CsTags.surveyFromDocument's own fix now
    // writes for a station with no Elevation tag) and a non-finite
    // value (a corrupted numeric field) both take the same path.
    var sv = CsModel.newSurvey();
    sv.shots.push(shotOf("P1", "P2", 10, 0));
    sv.fixed["P1"] = { x: 0, y: 0, z: null };
    var r = CsNetwork.resolve(sv, {});
    eqs(r.stations["P1"].z, null,
        "eighth door: an explicit null fixed z resolves at z = null");
    ok(r.fixedZUnknown.indexOf("P1") >= 0, "and is named");

    var sv2 = CsModel.newSurvey();
    sv2.shots.push(shotOf("Q1", "Q2", 10, 0));
    sv2.fixed["Q1"] = { x: 0, y: 0, z: NaN };
    var r2 = CsNetwork.resolve(sv2, {});
    eqs(r2.stations["Q1"].z, null,
        "eighth door: a non-finite fixed z is treated as absent, not 0");
    ok(r2.fixedZUnknown.indexOf("Q1") >= 0, "and is named");
}());

(function() {
    // REGRESSION, same distinction as the sixth door's own regression
    // test: a *fix'ed station whose real control z is exactly 0 (sea
    // level, or a cave datumed at its own entrance) must NOT be treated
    // as unknown, and must NOT appear in fixedZUnknown.
    var sv = CsModel.newSurvey();
    sv.shots.push(shotOf("R1", "R2", 10, 0));
    sv.fixed["R1"] = { x: 0, y: 0, z: 0 };
    var r = CsNetwork.resolve(sv, {});
    eqs(r.stations["R1"].z, 0,
        "eighth door: a REAL zero fixed z is used, not treated as unknown");
    eqs(r.fixedZUnknown.length, 0,
        "eighth door: fixedZUnknown stays empty when every fixed " +
        "station has a real (even zero) z");
}());

// ---- CsReport says what happened to the fixed frame ----------------
var stubDrawn = { stationsDrawn: 0, shotsDrawn: 0, closuresDrawn: 0,
    wallsDrawn: 0, splaysDrawn: 0, skipped: 0 };
var offsetSummary = CsReport.drawSummary(tieAnchored, rAnchoredTie, stubDrawn, []);
ok(offsetSummary.indexOf("Q1") >= 0,
    "task 1b report: the offset-applied station is named in the summary, got:\n" +
    offsetSummary);
ok(offsetSummary.indexOf("538.5") >= 0,
    "task 1b report: the offset magnitude (sqrt(500^2+200^2)=538.5) is " +
    "reported in drawing units, got:\n" + offsetSummary);
// reported exactly once, not once per applied station
var offsetLines = offsetSummary.split("\n").filter(function(l) {
    return l.toLowerCase().indexOf("offset") >= 0 ||
        l.toLowerCase().indexOf("shift") >= 0;
});
ok(offsetLines.length === 1,
    "task 1b report: the applied offset is reported exactly once, got " +
    offsetLines.length + " lines:\n" + offsetSummary);

var notHonoredSummary = CsReport.drawSummary(tieAnchored, rNoControlAnchor,
    stubDrawn, []);
ok(notHonoredSummary.indexOf("P1") >= 0 && notHonoredSummary.indexOf("Q1") >= 0,
    "task 1b report: un-honored fixed stations are named in the summary, got:\n" +
    notHonoredSummary);

// no controlFrame at all (0/1 fixed, or no anchor): the summary must
// not gain a single new line relative to today
var plainSummaryBefore = CsReport.drawSummary(sq, rsq, stubDrawn, []);
ok(plainSummaryBefore.toLowerCase().indexOf("offset") === -1 &&
    plainSummaryBefore.toLowerCase().indexOf("not used") === -1,
    "task 1b report: a survey with no controlFrame news gets no new lines");

// ---- Task 5: the drawn-shot line has to account for control ties ----
// CsDraw stopped counting ties as ordinary shots. If the summary does
// not pick the new counter up, a two-entrance cave silently reports
// fewer shots drawn than it drew, which is the one thing a drawn-count
// exists to be trusted about.
var tieDrawnStub = { stationsDrawn: 4, shotsDrawn: 2, closuresDrawn: 0,
    tiesDrawn: 1, wallsDrawn: 0, splaysDrawn: 0, skipped: 0 };
var tieCountSummary = CsReport.drawSummary(tieAnchored, rAnchoredTie,
    tieDrawnStub, []);
ok(tieCountSummary.indexOf("1 control tie") >= 0,
    "task 5 report: the drawn control tie is accounted for in the shot " +
    "line, got:\n" + tieCountSummary);
// plural, and never announced when there are none
var twoTieStub = { stationsDrawn: 6, shotsDrawn: 2, closuresDrawn: 0,
    tiesDrawn: 2, wallsDrawn: 0, splaysDrawn: 0, skipped: 0 };
ok(CsReport.drawSummary(tieAnchored, rAnchoredTie, twoTieStub,
    []).indexOf("2 control ties") >= 0,
    "task 5 report: two ties read as ties, plural");
ok(plainSummaryBefore.indexOf("control tie") === -1,
    "task 5 report: no ties, no mention -- and a drawn object from " +
    "before this counter existed still summarises cleanly");

// ---------------------------------------------------------------------
// Task 5b: an unmeasurable splay's absence is named in the report, not
// silently folded into the generic "skipped" line (which means
// "excluded, or never connected" -- an unmeasurable splay's station
// DID connect).
// ---------------------------------------------------------------------

// review I4: this used to be one bundled ok() with substring searches
// -- deleting either new line still passed it, because the OTHER new
// line also contains "splay" and "no distance", and indexOf("2") is
// satisfied by "Stations plotted: 2". Exact-line assertions, one
// counter at a time, so deleting either line is its own failure.
var splaysOnlyStub = { stationsDrawn: 2, shotsDrawn: 1, closuresDrawn: 0,
    wallsDrawn: 0, splaysDrawn: 1, splaysSkipped: 2, skipped: 0 };
var splaysOnlySummary = CsReport.drawSummary(sq, rsq, splaysOnlyStub, []);
var splaysOnlyLines = splaysOnlySummary.split("\n");
ok(splaysOnlyLines.indexOf(
        "Splays not drawn: 2 (no distance, or no azimuth/inclination, on record)"
    ) >= 0,
    "task 5b report: the exact splays-not-drawn line, got:\n" + splaysOnlySummary);
ok(splaysOnlyLines.filter(function(l) {
        return l.indexOf("Wall points skipped") >= 0;
    }).length === 0,
    "task 5b report: no wallPointsSkipped field means no wall-points line, " +
    "even though splaysSkipped is reported");

var wallPointsOnlyStub = { stationsDrawn: 2, shotsDrawn: 1, closuresDrawn: 0,
    wallsDrawn: 0, splaysDrawn: 0, wallPointsSkipped: 1, skipped: 0 };
var wallPointsOnlySummary = CsReport.drawSummary(sq, rsq, wallPointsOnlyStub, []);
var wallPointsOnlyLines = wallPointsOnlySummary.split("\n");
ok(wallPointsOnlyLines.indexOf(
        "Wall points skipped: 1 (splay had no distance, or no " +
        "azimuth/inclination, on record)"
    ) >= 0,
    "task 5b report: the exact wall-points-skipped line, got:\n" +
    wallPointsOnlySummary);
ok(wallPointsOnlyLines.filter(function(l) {
        return l.indexOf("Splays not drawn") >= 0;
    }).length === 0,
    "task 5b report: no splaysSkipped field means no splays-not-drawn line, " +
    "even though wallPointsSkipped is reported");

// a drawn object from before these counters existed (every test above
// this one) still summarises with no new line and no crash
var plainSummaryLines = plainSummaryBefore.split("\n");
ok(plainSummaryLines.filter(function(l) {
        return l.indexOf("Splays not drawn") >= 0 ||
            l.indexOf("Wall points skipped") >= 0;
    }).length === 0,
    "task 5b report: a drawn object with neither counter gains no phantom " +
    "line, got:\n" + plainSummaryBefore);

// ---------------------------------------------------------------------
// Critical A (extended-elevation review): the AUTOMATIC profile pass's
// own skip reason has to reach the ordinary draw summary, not just the
// MANUAL GenerateProfile tool's dialog (CsReport.profileSummary) --
// before this fix `drawn.profile` was a real field on CsDraw.survey's
// return value that CsReport.drawSummary never read at all, so a plan
// draw that skipped the profile for size, a ProfileAuto switched off,
// an unsaved drawing, or a profile pass that threw, told the user
// nothing whatsoever about it.
// ---------------------------------------------------------------------
var profileSkippedStub = { stationsDrawn: 2, shotsDrawn: 1, closuresDrawn: 0,
    wallsDrawn: 0, splaysDrawn: 0, skipped: 0,
    profile: { skipped: true, reason: "CaveSurvey/ProfileAuto is off" } };
var profileSkippedSummary = CsReport.drawSummary(sq, rsq,
    profileSkippedStub, []);
var profileSkippedLines = profileSkippedSummary.split("\n");
ok(profileSkippedLines.indexOf(
        "Profile: not written -- CaveSurvey/ProfileAuto is off.") >= 0,
    "CRITICAL A: the automatic profile skip reason reaches the ordinary " +
    "draw summary, got:\n" + profileSkippedSummary);

var profileOkStub = { stationsDrawn: 2, shotsDrawn: 1, closuresDrawn: 0,
    wallsDrawn: 0, splaysDrawn: 0, skipped: 0,
    profile: { path: "/x/Cave-PROFILE.dxf", created: true, counts: {} } };
var profileOkSummary = CsReport.drawSummary(sq, rsq, profileOkStub, []);
ok(profileOkSummary.indexOf("Profile: not written") < 0,
    "CRITICAL A: a profile pass that actually wrote something prints no " +
    "skip line at all, got:\n" + profileOkSummary);

// a drawn object with no `profile` key at all (every fixture above this
// one, and every caller from before Task 9 existed) must still
// summarise cleanly with no phantom line and no crash
ok(plainSummaryLines.filter(function(l) {
        return l.indexOf("Profile:") >= 0;
    }).length === 0,
    "CRITICAL A: a drawn object with no profile field gains no phantom " +
    "profile line, got:\n" + plainSummaryBefore);

// ---------------------------------------------------------------------
// Task 1c -- bridge classifier cost and path honesty.
// ---------------------------------------------------------------------

// The classifier's verdicts on every existing fixture above (square,
// tie, there-and-back, two-fixed ring, ring+branch, and every Task 1b
// control-frame fixture) are already proven unchanged by every
// assertion already run against rsq/rtie/rBackRing/rring/
// rringBlunder/ranch/rAnchoredTie/rRingAnchored/etc. above -- this is
// a performance change, not a behavior change, and those pre-existing
// assertions are the proof; nothing new is needed here for that.

// -- .path is asserted for the single-root case (the square, `rsq`):
// the closing shot is A3->A4, and its ancestor chain walks all the
// way back to the anchor A4 -- a real surveyed walk the whole way.
ok(rsq.loops.length === 1 && rsq.loops[0].path.length === 4 &&
    rsq.loops[0].path[0] === "A3" && rsq.loops[0].path[1] === "A2" &&
    rsq.loops[0].path[2] === "A1" && rsq.loops[0].path[3] === "A4",
    "task 1c: square's single-root loop path walks the ring exactly, got " +
    (rsq.loops.length === 1 ? JSON.stringify(rsq.loops[0].path) : "n/a"));
ok(rsq.loops.length === 1 && rsq.loops[0].viaControl === false,
    "task 1c: single-root loop is not viaControl");

// -- .path for the two-root case (`ring`, RA/RC fixed): path is
// fromChain ++ reverse(toChain), e.g. [RB, RA, RC] -- which reads as
// "RA adjacent to RC" even though those two anchors are joined only
// through shared control, not by any surveyed leg. viaControl names
// that fact so a consumer doesn't have to re-derive it from path.
ok(rring.loops.length === 2, "sanity: ring still produces two arc loops");
if (rring.loops.length === 2) {
    var rbRc = null, rdRa = null;
    for (var rli2 = 0; rli2 < rring.loops.length; rli2++) {
        var lp = rring.loops[rli2];
        if (lp.from === "RB" && lp.to === "RC") { rbRc = lp; }
        if (lp.from === "RD" && lp.to === "RA") { rdRa = lp; }
    }
    ok(rbRc !== null && rbRc.path.length === 3 && rbRc.path[0] === "RB" &&
        rbRc.path[1] === "RA" && rbRc.path[2] === "RC",
        "task 1c: two-root loop path is fromChain ++ reverse(toChain), got " +
        (rbRc !== null ? JSON.stringify(rbRc.path) : "n/a"));
    ok(rbRc !== null && rbRc.viaControl === true,
        "task 1c: RB->RC arc is flagged viaControl -- RA is not really " +
        "adjacent to RC, they only share control");
    ok(rdRa !== null && rdRa.path.length === 3 && rdRa.path[0] === "RD" &&
        rdRa.path[1] === "RC" && rdRa.path[2] === "RA",
        "task 1c: the other arc's two-root path, got " +
        (rdRa !== null ? JSON.stringify(rdRa.path) : "n/a"));
    ok(rdRa !== null && rdRa.viaControl === true,
        "task 1c: RD->RA arc is also flagged viaControl");
}

// -- ties carry percent: null, matching the docstring's "no
// meaningful percent" claim, and are never viaControl (their path is
// a real surveyed leg, not a fabricated join).
ok(rtie.ties.length === 1 && rtie.ties[0].percent === null,
    "task 1c: a tie's percent is null, not a meaningless number, got " +
    JSON.stringify(rtie.ties.length === 1 ? rtie.ties[0].percent : null));
ok(rtie.ties.length === 1 && rtie.ties[0].viaControl === false,
    "task 1c: a tie's path is a real leg, so viaControl is false");

// -- no consumer formats a tie's (null) percent: CsReport, CsValidate
// and CsStats all only ever read percent off resolved.loops, never
// resolved.ties (grep confirms no shipped script reads `.ties` at
// all except this test file) -- but drive them end to end on the tie
// fixture anyway so a future consumer change that DID start reading
// ties would trip a real exception here, not just an audit note.
var tieStatsForNull = CsStats.compute(tie, rtie, CsTraverse.SLOPE);
var tieGradeForNull = CsGrade.compute(tie, rtie, tieStatsForNull);
var tieFindingsForNull = CsValidate.check(tie, rtie);
var tieReportForNull = CsReport.drawSummary(tie, rtie, stubDrawn, []);
ok(true,
    "task 1c: CsStats/CsGrade/CsValidate/CsReport all run on a " +
    "tie-carrying resolve without throwing on a null percent");

// -- a direct double tie between two already-fixed anchors: unlike
// `tie` above (only Q1, the TO end, is itself a fixed anchor -- P1 is
// one hop away via P2), here BOTH ends of each tying shot are
// themselves already-fixed, and there are TWO independent direct
// ties in the one survey. This exercises chain() at length 1 on
// both sides and proves two ties don't get confused with each other
// or misclassified as a loop.
var doubleTie = CsModel.newSurvey();
doubleTie.shots.push(shotOf("DP1", "DQ1", 10, 0));   // direct tie #1
doubleTie.shots.push(shotOf("DQ1", "DR1", 10, 90));  // direct tie #2
doubleTie.fixed["DP1"] = { x: 0, y: 0, z: 0 };
doubleTie.fixed["DQ1"] = { x: 0, y: 10.3, z: 0 };    // 0.3 off shot #1's landing
doubleTie.fixed["DR1"] = { x: 10, y: 10.5, z: 0 };   // 0.2 off shot #2's landing
var rDoubleTie = CsNetwork.resolve(doubleTie, {});
ok(rDoubleTie.loops.length === 0 && rDoubleTie.ties.length === 2,
    "task 1c: a direct double tie between already-fixed anchors reports " +
    "two ties and no loops, got loops=" + rDoubleTie.loops.length +
    " ties=" + rDoubleTie.ties.length);
if (rDoubleTie.ties.length === 2) {
    for (var dti = 0; dti < rDoubleTie.ties.length; dti++) {
        ok(rDoubleTie.ties[dti].percent === null,
            "task 1c: direct tie #" + dti + " percent is null");
        ok(rDoubleTie.ties[dti].path.length === 2,
            "task 1c: direct tie #" + dti + " path is just its two " +
            "endpoints (already fixed on both ends), got " +
            JSON.stringify(rDoubleTie.ties[dti].path));
    }
    var dt1 = null, dt2 = null;
    for (var dti2 = 0; dti2 < rDoubleTie.ties.length; dti2++) {
        if (rDoubleTie.ties[dti2].from === "DP1") { dt1 = rDoubleTie.ties[dti2]; }
        if (rDoubleTie.ties[dti2].from === "DQ1") { dt2 = rDoubleTie.ties[dti2]; }
    }
    near(dt1 !== null ? dt1.error : -1, 0.3, 1e-9,
        "task 1c: direct tie #1 (DP1->DQ1) misclosure");
    near(dt2 !== null ? dt2.error : -1, 0.2, 1e-9,
        "task 1c: direct tie #2 (DQ1->DR1) misclosure");
}
ok(rDoubleTie.anchors.length === 3,
    "task 1c: all three already-fixed stations anchor -- none reached by traversal");

// -- a shot with from === to must be SKIPPED, not scored as a
// 100%-blown loop. This is NOT the Compass zero-length LRUD carrier
// idiom: CsFormatCompass's reader filters those out during parsing
// (its isCarrier check) before they ever become a shot at all, and
// even the ones it writes target a distinct synthetic station name
// (station + "_L"), never from === to. Any from === to shot reaching
// here is something else; CsValidate already flags it on its own
// terms ("self-loop", independent of resolve()). Skipping it costs
// no LRUD: CsModel.lrudForStation scans survey.shots directly by
// station name and does not consult resolve()'s usable/skipped split.
var selfLoopSv = CsModel.newSurvey();
selfLoopSv.shots.push(shotOf("SL1", "SL2", 10, 0));
selfLoopSv.shots.push(shotOf("SL2", "SL2", 5, 0)); // self-loop: must be skipped
var rSelfLoop = CsNetwork.resolve(selfLoopSv, {});
ok(rSelfLoop.loops.length === 0,
    "task 1c: a from===to shot is not scored as a loop");
ok(rSelfLoop.closures.length === 0,
    "task 1c: a from===to shot produces no closure/misclosure entry at all");
var slSkipped = false;
for (var ssi = 0; ssi < rSelfLoop.skipped.length; ssi++) {
    if (rSelfLoop.skipped[ssi].from === "SL2" &&
            rSelfLoop.skipped[ssi].to === "SL2") {
        slSkipped = true;
    }
}
ok(slSkipped, "task 1c: the self-loop shot lands in resolve()'s `skipped`");
ok(rSelfLoop.stations.hasOwnProperty("SL2"),
    "task 1c: SL2 is still placed (reached by the earlier real shot) " +
    "despite its own self-loop shot being skipped");

// -- performance: the bridge classifier must not be quadratic. A
// chain-plus-a-handful-of-loops survey used to cost O(closure count *
// usable count^2) -- 32/96/366/1501ms at 500/1000/2000/4000 shots
// under node (see docs/superpowers/plans/2026-08-21-loop-closure-
// adjustment.md, Task 1c, for the measured baseline). Restricting the
// bridge test to closure candidates makes it O(k*m); a 4,000-shot
// survey with a handful of loops should resolve in well under 100ms.
// This bound is loose (order of magnitude above the expected cost)
// so ordinary machine noise doesn't make it flaky, but tight enough
// that the quadratic could never silently come back unnoticed.
if (IS_NODE) {
    var perfSv = CsModel.newSurvey();
    var perfN = 4000;
    var perfLoops = 0;
    for (var pk = 1; pk <= perfN; pk++) {
        perfSv.shots.push(shotOf("P" + (pk - 1), "P" + pk, 10, 0));
    }
    for (pk = 200; pk < perfN; pk += 200) {
        perfSv.shots.push(shotOf("P" + pk, "P" + (pk - 100), 10, 180));
        perfLoops++;
    }
    var perfT0 = Date.now();
    var perfR = CsNetwork.resolve(perfSv, {});
    var perfMs = Date.now() - perfT0;
    ok(perfR.loops.length === perfLoops,
        "task 1c perf: sanity check on the built survey's loop count, " +
        "expected " + perfLoops + " got " + perfR.loops.length);
    ok(perfMs < 100,
        "task 1c perf: a " + perfSv.shots.length + "-shot survey with " +
        perfLoops + " loops resolved in " + perfMs + "ms under node -- " +
        "want well under 100ms (was ~1500ms before Task 1c)");
}

// ---------------------------------------------------------------------
// Task 1d -- a REAL survey file exercising both two-anchor shapes at
// once, parsed through CsFormatRegistry like any other testdata file
// (not an in-memory fixture). Every fixture above this point that
// touches bridge classification, control ties, or the two-root
// circuit is built by hand inside this test file; none of it has ever
// gone through a format parser. testdata/TestCave_TwoFixed.svx closes
// that gap.
//
// Geometry, by hand (see the file's own header comment for the survey
// data itself -- all bearings 0/90/180/270, all lengths integers):
//
//   Component A (the ring), fixed at RA=(0,0,0) and RC=(10,10,0):
//     RA-RB north 10  -> RB=(0,10,0)
//     RB-RC east  10  -> RC computed=(10,10,0), matches fixed RC exactly
//     RC-RD south 10  -> RD=(10,0,0)
//     RD-RA west  10  -> RA computed=(0,0,0), matches fixed RA exactly
//   Both closures are EXACT (0 misclosure) by construction, so this is
//   the real-data twin of the existing synthetic `ring` fixture above:
//   two fixed stations on one ring produce TWO arc loops, each
//   viaControl (RA and RC are not surveyed-adjacent, only tied by
//   shared control), each traverseLength = its own closing leg (10)
//   plus the one tree leg back to the OTHER anchor (10) = 20.
//
//   The bridge leg RD-SB1, east 10 from RD=(10,0,0) -> traversed
//   SB1=(20,0,0). SB1's own control is *fix (20,3,0) -- a deliberate,
//   exact 3m misclosure (dy=-3, dx=0, dz=0 -> horizontal=vertical
//   distance=3). Removing this one leg leaves component B (SB1, SB2)
//   with no path back to component A at all, so it is a graph bridge:
//   a control TIE, not a loop, path=[RD,SB1], traverseLength=10 (its
//   own length only, no ring to walk), percent=null.
//
//   Component B: SB1 (fixed) - SB2 (traversed, south... north 10 from
//   SB1) exists purely so component B is a real little passage, not a
//   bare fixed point with nothing surveyed off it.
//
//   anchors: RA, RC, SB1 (the three *fix stations; SB2 and the ring's
//   RB/RD are reached by ordinary traversal, not anchors).
// ---------------------------------------------------------------------

var twoFixedContent = readTextFile(repoRoot + "/testdata/TestCave_TwoFixed.svx");
var twoFixedFmt = CsFormatRegistry.detect("TestCave_TwoFixed.svx", twoFixedContent);
ok(twoFixedFmt !== null && twoFixedFmt.id === "survex",
    "task 1d: TestCave_TwoFixed.svx detects as survex");
var twoFixed = twoFixedFmt.parse(twoFixedContent);
ok(twoFixed.shots.length === 6, "task 1d: 6 real shots parsed, got " +
    twoFixed.shots.length);
ok(twoFixed.fixed.hasOwnProperty("RA") && twoFixed.fixed.hasOwnProperty("RC") &&
    twoFixed.fixed.hasOwnProperty("SB1"),
    "task 1d: all three *fix stations parsed");

var rTwoFixed = CsNetwork.resolve(twoFixed, {});

// -- shape 1: two fixed stations on one ring -> per-arc LOOPS, never
// ties, matching the hand computation above exactly.
ok(rTwoFixed.loops.length === 2,
    "task 1d: the real ring produces two arc loops, got " +
    rTwoFixed.loops.length);
var tfArc1 = null, tfArc2 = null;
for (var tfi = 0; tfi < rTwoFixed.loops.length; tfi++) {
    var tfLoop = rTwoFixed.loops[tfi];
    if (tfLoop.from === "RB" && tfLoop.to === "RC") { tfArc1 = tfLoop; }
    if (tfLoop.from === "RD" && tfLoop.to === "RA") { tfArc2 = tfLoop; }
}
ok(tfArc1 !== null && tfArc2 !== null,
    "task 1d: both expected arcs (RB->RC and RD->RA) are present");
if (tfArc1 !== null) {
    near(tfArc1.traverseLength, 20, 1e-9,
        "task 1d: RB->RC arc traverseLength (closing leg 10 + RA->RB 10)");
    near(tfArc1.error, 0, 1e-9, "task 1d: RB->RC arc closes exactly");
    ok(tfArc1.viaControl === true,
        "task 1d: RB->RC arc is viaControl (RA, RC share control only)");
}
if (tfArc2 !== null) {
    near(tfArc2.traverseLength, 20, 1e-9,
        "task 1d: RD->RA arc traverseLength (closing leg 10 + RC->RD 10)");
    near(tfArc2.error, 0, 1e-9, "task 1d: RD->RA arc closes exactly");
    ok(tfArc2.viaControl === true,
        "task 1d: RD->RA arc is viaControl");
}

// -- shape 2: a separately fixed, disconnected component joined by
// exactly one leg -> a TIE, with the hand-computed 3m misclosure, and
// percent left null (never a number nobody can trust).
ok(rTwoFixed.ties.length === 1,
    "task 1d: the RD-SB1 bridge leg is reported as exactly one tie, got " +
    rTwoFixed.ties.length);
if (rTwoFixed.ties.length === 1) {
    near(rTwoFixed.ties[0].error, 3, 1e-9,
        "task 1d: tie misclosure is the hand-computed 3m (SB1 control " +
        "(20,3,0) vs traversed (20,0,0))");
    ok(rTwoFixed.ties[0].percent === null,
        "task 1d: tie percent stays null, matching the 'no meaningful " +
        "percent' rule -- deliberately never asserted as a number");
    ok(rTwoFixed.ties[0].path.length === 2 &&
        rTwoFixed.ties[0].path[0] === "RD" && rTwoFixed.ties[0].path[1] === "SB1",
        "task 1d: tie path is just its own two endpoints, got " +
        JSON.stringify(rTwoFixed.ties[0].path));
    ok(rTwoFixed.ties[0].viaControl === false,
        "task 1d: a tie's path is a real leg, so viaControl is false");
}
ok(rTwoFixed.anchors.length === 3,
    "task 1d: all three *fix stations anchor their own component, got " +
    rTwoFixed.anchors.length);

// -- the invariance that proves the frame-offset logic, now on real
// parsed data (Task 1b established this on synthetic fixtures; this
// is the same check on a real file). An explicit anchor on RA, at a
// drawing position with no relationship to RA's own (0,0,0) control,
// must translate RC and SB1's control by the SAME offset and leave
// every misclosure -- both ring arcs AND the tie -- exactly as they
// were with no anchor at all. A pure translation cannot change a
// measured disagreement; if these numbers move, the offset logic is
// wrong regardless of anything else here.
var rTwoFixedAnchored = CsNetwork.resolve(twoFixed,
    { anchor: { name: "RA", x: 1000, y: -1000, z: 0 } });
ok(rTwoFixedAnchored.controlFrame !== null &&
    rTwoFixedAnchored.controlFrame !== undefined,
    "task 1d: an explicit anchor on a fixed station reports a controlFrame");
if (rTwoFixedAnchored.controlFrame) {
    near(rTwoFixedAnchored.controlFrame.offset.dx, 1000, 1e-9,
        "task 1d: controlFrame.offset.dx is the anchor's x minus RA's own control x");
    near(rTwoFixedAnchored.controlFrame.offset.dy, -1000, 1e-9,
        "task 1d: controlFrame.offset.dy likewise for y");
    ok(rTwoFixedAnchored.controlFrame.applied.indexOf("RC") >= 0 &&
        rTwoFixedAnchored.controlFrame.applied.indexOf("SB1") >= 0,
        "task 1d: controlFrame names both RC and SB1 as offset-applied -- " +
        "SB1 shares RA's shot-graph component via the RD-SB1 bridge leg, " +
        "even though it roots its own anchor, got " +
        JSON.stringify(rTwoFixedAnchored.controlFrame.applied));
}
near(rTwoFixedAnchored.stations["RC"].x, 10 + 1000, 1e-9,
    "task 1d: RC's control is translated into RA's anchor frame (x)");
near(rTwoFixedAnchored.stations["RC"].y, 10 + (-1000), 1e-9,
    "task 1d: RC's control is translated into RA's anchor frame (y)");
near(rTwoFixedAnchored.stations["SB1"].x, 20 + 1000, 1e-9,
    "task 1d: SB1's control is translated into RA's anchor frame (x)");
near(rTwoFixedAnchored.stations["SB1"].y, 3 + (-1000), 1e-9,
    "task 1d: SB1's control is translated into RA's anchor frame (y)");

ok(rTwoFixedAnchored.loops.length === rTwoFixed.loops.length,
    "task 1d invariance: anchored resolve keeps the same number of arc loops");
if (rTwoFixedAnchored.loops.length === rTwoFixed.loops.length) {
    var tfArc1Anchored = null, tfArc2Anchored = null;
    for (var tfai = 0; tfai < rTwoFixedAnchored.loops.length; tfai++) {
        var tfaLoop = rTwoFixedAnchored.loops[tfai];
        if (tfaLoop.from === "RB" && tfaLoop.to === "RC") { tfArc1Anchored = tfaLoop; }
        if (tfaLoop.from === "RD" && tfaLoop.to === "RA") { tfArc2Anchored = tfaLoop; }
    }
    if (tfArc1 !== null && tfArc1Anchored !== null) {
        near(tfArc1Anchored.error, tfArc1.error, 1e-9,
            "task 1d invariance: RB->RC arc misclosure unchanged by the anchor");
    }
    if (tfArc2 !== null && tfArc2Anchored !== null) {
        near(tfArc2Anchored.error, tfArc2.error, 1e-9,
            "task 1d invariance: RD->RA arc misclosure unchanged by the anchor");
    }
}
ok(rTwoFixedAnchored.ties.length === 1,
    "task 1d invariance: anchored resolve still reports exactly one tie");
if (rTwoFixedAnchored.ties.length === 1 && rTwoFixed.ties.length === 1) {
    near(rTwoFixedAnchored.ties[0].error, rTwoFixed.ties[0].error, 1e-9,
        "task 1d invariance: tie misclosure is identical with or without " +
        "the explicit anchor -- a translation cannot change a measured " +
        "disagreement");
}

// ---------------------------------------------------------------------
// Task 2 -- CsAdjust: least-squares loop closure adjustment.
//
// The square fixture again (`sq` / `rsq` above), now with EQUAL weights
// (sigmaTape 1, sigmaAngle 0, so every leg's variance is 1) so the whole
// answer is doable by hand: four ring legs share one 0.5 misclosure, so
// each leg's residual is 0.5/4 = 0.125 and the stations walk out in
// 0.125 steps away from the pinned anchor A4. Solved by hand from the
// normal equations, NOT read off the solver's own output:
//
//   free x unknowns a1, a2, a3, b1 (A4 pinned at 0), observations
//   a1 = -10.5, a2 - a1 = 0, a3 - a2 = 10, -a3 = 0, b1 - a3 = 5
//   normal equations 2a1 - a2 = -10.5, 2a2 - a1 - a3 = -10,
//   3a3 - a2 - b1 = 5, b1 - a3 = 5
//   solution a1 = -10.375, a2 = -10.25, a3 = -0.125, b1 = 4.875
//   i.e. +0.125, +0.25, +0.375, +0.375 off the raw traverse.
// ---------------------------------------------------------------------

var EQ = { sigmaTape: 1, sigmaAngle: 0 };
var asq = CsAdjust.adjust(sq, rsq, EQ);

ok(asq.summary.converged === true, "square adjustment converges");
ok(asq.adjusted === true, "adjust marks its result adjusted");
near(asq.shifts["A4"].distance, 0, 1e-9, "the pinned anchor A4 does not move");
near(asq.shifts["A1"].dx, 0.125, 1e-9, "A1 shifts one quarter of the misclosure");
near(asq.shifts["A2"].dx, 0.25, 1e-9, "A2 shifts two quarters");
near(asq.shifts["A3"].dx, 0.375, 1e-9, "A3 shifts three quarters");
near(asq.shifts["B1"].dx, 0.375, 1e-9, "the branch rides along with A3");
near(asq.shifts["A2"].dy, 0, 1e-9, "no y misclosure, no y shift");
near(asq.shifts["A2"].dz, 0, 1e-9, "no z misclosure, no z shift");
ok(asq.summary.pinned.length === 1 && asq.summary.pinned[0] === "A4",
    "the square's only pinned station is its anchor, got " +
    JSON.stringify(asq.summary.pinned));

var resByPair = {};
for (var ri = 0; ri < asq.residuals.length; ri++) {
    var rr = asq.residuals[ri];
    resByPair[rr.from + ">" + rr.to] = rr;
}
near(resByPair["A4>A1"].dx, 0.125, 1e-9, "leg A4-A1 absorbs 0.125");
near(resByPair["A1>A2"].dx, 0.125, 1e-9, "leg A1-A2 absorbs 0.125");
near(resByPair["A2>A3"].dx, 0.125, 1e-9, "leg A2-A3 absorbs 0.125");
near(resByPair["A3>A4"].dx, 0.125, 1e-9, "closure leg A3-A4 absorbs 0.125");
near(resByPair["A3>B1"].distance, 0, 1e-9, "the branch leg absorbs nothing");
near(resByPair["A4>A1"].standardized, 0.125, 1e-9,
    "standardized residual is the residual over sigma (sigma = 1 here)");
ok(asq.residuals.length === rsq.legs.length,
    "one residual per leg, aligned to legs");

// The least-squares condition itself, checked independently of the
// solver: with equal weights the signed residuals must sum to zero at
// every FREE station (that IS the normal equation at that station).
// Pinned stations are Dirichlet boundaries and carry no equation.
function adjustGradientMax(result) {
    var g = {};
    var bump = function(name, sign, r) {
        if (!g.hasOwnProperty(name)) {
            g[name] = { x: 0.0, y: 0.0, z: 0.0 };
        }
        g[name].x += sign * r.dx;
        g[name].y += sign * r.dy;
        g[name].z += sign * r.dz;
    };
    var i;
    for (i = 0; i < result.residuals.length; i++) {
        bump(result.residuals[i].to, 1.0, result.residuals[i]);
        bump(result.residuals[i].from, -1.0, result.residuals[i]);
    }
    var pinnedSet = {};
    for (i = 0; i < result.summary.pinned.length; i++) {
        pinnedSet[result.summary.pinned[i]] = true;
    }
    var worst = 0.0;
    for (var nm in g) {
        if (!g.hasOwnProperty(nm) || pinnedSet[nm] === true) {
            continue;
        }
        worst = Math.max(worst, Math.abs(g[nm].x), Math.abs(g[nm].y),
            Math.abs(g[nm].z));
    }
    return worst;
}
ok(adjustGradientMax(asq) < 1e-9,
    "the square's adjusted coordinates satisfy the normal equations, worst " +
    "station imbalance " + adjustGradientMax(asq));

// HONESTY: closures, loops and ties pass through as-surveyed. CsGrade
// reads loops[].percent, so recomputing them post-adjustment would
// report every survey on earth as grade 5, worst closure 0.00%.
ok(asq.loops === rsq.loops, "adjust passes the loop list through, not a copy");
ok(asq.closures === rsq.closures, "adjust passes the closure list through");
ok(asq.ties === rsq.ties, "adjust passes the tie list through");
ok(asq.loops.length === rsq.loops.length, "adjust keeps the loop list");
near(asq.loops[0].error, 0.5, 1e-9, "adjust reports the AS-SURVEYED misclosure");
var gradeRaw = CsGrade.compute(sq, rsq, CsStats.compute(sq, rsq, CsTraverse.SLOPE));
var gradeAdj = CsGrade.compute(sq, asq, CsStats.compute(sq, asq, CsTraverse.SLOPE));
ok(gradeRaw.centreline === gradeAdj.centreline,
    "adjustment cannot launder the centreline grade");
ok(gradeRaw.centrelineText === gradeAdj.centrelineText,
    "adjustment cannot launder the grade's stated reasoning");
ok(asq.raw === rsq, "the adjusted result carries the raw resolve for the ghost");

// The ghost is only honest while the raw result stays as-surveyed:
// adjust must build a NEW stations map, never write its answer into the
// resolve result it was handed. A4 anchors at the origin, so the raw
// A3 sits at -0.5 (the whole misclosure still on the closing leg).
near(rsq.stations["A3"].x, -0.5, 1e-12,
    "adjust leaves the raw resolve's own coordinates untouched");
near(asq.raw.stations["A3"].x, -0.5, 1e-12,
    "...so the ghost layer still draws the as-surveyed line");
ok(asq.stations !== rsq.stations,
    "the adjusted stations are a new map, not the raw one mutated");

// An `excludeFromPlot` (P) leg is a real measurement that merely isn't
// drawn, and an `excludeFromLength` (L) leg is a real measurement that
// merely isn't counted -- the design spec's table says both take part
// in the adjustment. Nothing else in the suite pins that, so this does:
// flagging a ring leg P must not change the answer at all.
var adjFlagged = CsModel.newSurvey();
adjFlagged.shots.push(shotOf("A4", "A1", 10.5, 270));
adjFlagged.shots.push(shotOf("A1", "A2", 10, 0));
var adjFlaggedLeg = shotOf("A2", "A3", 10, 90);
adjFlaggedLeg.excludeFromPlot = true;
adjFlagged.shots.push(adjFlaggedLeg);
var adjFlaggedLeg2 = shotOf("A3", "A4", 10, 180);
adjFlaggedLeg2.excludeFromLength = true;
adjFlagged.shots.push(adjFlaggedLeg2);
var aAdjFlagged = CsAdjust.adjust(adjFlagged, CsNetwork.resolve(adjFlagged, {}), EQ);
near(aAdjFlagged.shifts["A1"].dx, 0.125, 1e-9,
    "a P-flagged and an L-flagged leg still constrain the solve (A1)");
near(aAdjFlagged.shifts["A3"].dx, 0.375, 1e-9,
    "...and the ring still walks out in equal 0.125 steps (A3)");

// an empty survey is a real state for a tool run on an empty drawing
var adjEmptySv = CsModel.newSurvey();
var aAdjEmpty = CsAdjust.adjust(adjEmptySv, CsNetwork.resolve(adjEmptySv, {}), EQ);
ok(aAdjEmpty.summary.stationCount === 0 && aAdjEmpty.summary.converged === true,
    "an empty survey adjusts to nothing, without dividing by an empty network");

// a tree has nothing to close: the raw coordinates are already the
// exact least-squares answer, so the solver must recognise that and
// not "converge" its way to a different one
var adjTree = CsModel.newSurvey();
adjTree.shots.push(shotOf("T1", "T2", 10, 0));
adjTree.shots.push(shotOf("T2", "T3", 10, 90, 5));
adjTree.shots.push(shotOf("T2", "T4", 7, 200, -12));
var rAdjTree = CsNetwork.resolve(adjTree, {});
var aAdjTree = CsAdjust.adjust(adjTree, rAdjTree, EQ);
ok(aAdjTree.summary.converged === true, "tree adjustment converges");
ok(aAdjTree.summary.iterations === 0, "a tree needs no iterations, got " +
    aAdjTree.summary.iterations);
near(aAdjTree.summary.worstShift, 0, 1e-9, "a tree does not move");

// idempotence: adjusting the adjusted result is a no-op, and the ghost
// still shows the ORIGINAL as-surveyed geometry, not the first pass
var asq2 = CsAdjust.adjust(sq, asq, EQ);
near(asq2.summary.worstShift, 0, 1e-6, "adjusting an adjusted survey moves nothing");
ok(asq2.raw === rsq, "re-adjusting keeps the original raw as the ghost");

// two fixed stations, joined through one free middle station. The
// joining leg arrives with both ends already known and is the only
// link between them, so it is a control TIE -- and a tie is a real
// observation: drop it from the solve and M1 stays at 10 instead of
// splitting the 0.6 disagreement.
var adjTwoFix = CsModel.newSurvey();
adjTwoFix.shots.push(shotOf("F1", "M1", 10, 90));
adjTwoFix.shots.push(shotOf("M1", "F2", 10, 90));
adjTwoFix.fixed["F1"] = { x: 0, y: 0, z: 0 };
adjTwoFix.fixed["F2"] = { x: 20.6, y: 0, z: 0 };   // 0.6 further than surveyed
var rAdjTwoFix = CsNetwork.resolve(adjTwoFix, {});
ok(rAdjTwoFix.ties.length === 1,
    "sanity: the F2 leg is a control tie, so this fixture tests a tie in the solve");
var aAdjTwoFix = CsAdjust.adjust(adjTwoFix, rAdjTwoFix, EQ);
near(aAdjTwoFix.stations["F1"].x, 0, 1e-9, "fixed F1 stays on its control");
near(aAdjTwoFix.stations["F2"].x, 20.6, 1e-9, "fixed F2 stays on its control");
near(aAdjTwoFix.stations["M1"].x, 10.3, 1e-9,
    "the middle station splits the difference -- the tie leg is in the solve");
ok(aAdjTwoFix.summary.pinned.length === 2,
    "both fixed stations are pinned, got " +
    JSON.stringify(aAdjTwoFix.summary.pinned));

// noAdjust (Flags C) holds its leg's geometry; the neighbour absorbs
// the error. Held by weight (1e6 x the median), so the surveyed length
// survives to well inside any drawable tolerance.
var adjHeld = CsModel.newSurvey();
var adjHeldLeg = shotOf("H1", "H2", 10, 90);
adjHeldLeg.noAdjust = true;
adjHeld.shots.push(adjHeldLeg);
adjHeld.shots.push(shotOf("H2", "H3", 10, 90));
adjHeld.fixed["H1"] = { x: 0, y: 0, z: 0 };
adjHeld.fixed["H3"] = { x: 20.6, y: 0, z: 0 };
var rAdjHeld = CsNetwork.resolve(adjHeld, {});
var aAdjHeld = CsAdjust.adjust(adjHeld, rAdjHeld, EQ);
ok(aAdjHeld.summary.converged === true, "the noAdjust network converges");
near(aAdjHeld.stations["H2"].x - aAdjHeld.stations["H1"].x, 10, 1e-4,
    "a noAdjust leg keeps its surveyed length");
ok(Math.abs(aAdjHeld.stations["H3"].x - aAdjHeld.stations["H2"].x - 10) > 0.5,
    "...while the neighbouring leg absorbs essentially the whole 0.6");

// non-convergence returns the survey UNADJUSTED, and says so. A
// half-solved network is worse than an unsolved one because it LOOKS
// adjusted.
var adjStuck = CsAdjust.adjust(sq, rsq, { sigmaTape: 1, sigmaAngle: 0,
    maxIterations: 1, cgTolerance: 1e-30 });
ok(adjStuck.summary.converged === false, "a starved solve reports non-convergence");
ok(adjStuck.adjusted === false, "a starved solve does not claim to be adjusted");
ok(adjStuck.raw === null, "a starved solve offers no ghost -- its geometry IS the raw");
near(adjStuck.stations["A3"].x, rsq.stations["A3"].x, 1e-12,
    "a starved solve leaves coordinates exactly as surveyed");
ok(adjStuck.summary.warning !== undefined && adjStuck.summary.warning !== "",
    "a starved solve explains itself in words");
ok(adjStuck.loops === rsq.loops,
    "even unadjusted, the loop list is the as-surveyed one");

// ---- the pin set follows controlFrame -------------------------------
//
// Task 1b: when an explicit anchor is passed and a fixed station's
// control could NOT be reconciled into the anchor's frame, resolve
// leaves that station to ordinary traversal and names it in
// controlFrame.notHonored. Its resolved position is a TRAVERSAL
// ARTIFACT, not control. Pinning it would freeze a coordinate nobody
// measured and force the whole adjustment to honour it.
var adjNh = CsModel.newSurvey();
adjNh.shots.push(shotOf("N1", "N2", 10, 0));
adjNh.shots.push(shotOf("N2", "N3", 10, 90));
adjNh.shots.push(shotOf("N3", "N4", 10, 180));
adjNh.shots.push(shotOf("N4", "N1", 10.5, 270));   // 0.5 misclosure
adjNh.fixed["N3"] = { x: 1000, y: 1000, z: 0 };    // world control

// (a) anchored on N1, which has no control of its own: N3's control
// cannot be placed in the anchor's frame, so N3 is NOT pinned.
var rAdjNh = CsNetwork.resolve(adjNh, { anchor: { name: "N1", x: 0, y: 0, z: 0 } });
ok(rAdjNh.controlFrame !== null && rAdjNh.controlFrame.notHonored.indexOf("N3") >= 0,
    "sanity: resolve reports N3's control as not honored under this anchor");
var aAdjNh = CsAdjust.adjust(adjNh, rAdjNh, EQ);
ok(aAdjNh.summary.pinned.indexOf("N3") === -1,
    "a station named in controlFrame.notHonored is NOT pinned, got " +
    JSON.stringify(aAdjNh.summary.pinned));
ok(aAdjNh.summary.pinned.length === 1 && aAdjNh.summary.pinned[0] === "N1",
    "only the explicit anchor is pinned under an un-honored control frame");
ok(aAdjNh.shifts["N3"].distance > 1e-6,
    "the un-honored station is free to move, shifted " +
    aAdjNh.shifts["N3"].distance);
ok(Math.abs(aAdjNh.stations["N3"].x - 1000) > 900,
    "the un-honored station is NOT dragged onto its unreconciled control");

// (a2) opts.pinned is the CALLER saying "hold this one" outright, and
// it wins over the notHonored exclusion above -- an explicit
// instruction is not a coordinate nobody chose. Task 7 is the first
// caller: CsRevise.apply passes the GEOREFERENCED station, the
// drawing's one point of contact with the real world, so least squares
// cannot drift the coordinate a basemap or a KML export derives from.
// (Task 2 shipped opts.pinned with no test at all.)
var aAdjNhPinned = CsAdjust.adjust(adjNh, rAdjNh,
    { sigmaTape: 1, sigmaAngle: 0, pinned: ["N3"] });
ok(aAdjNhPinned.summary.pinned.indexOf("N3") >= 0,
    "opts.pinned overrides the notHonored exclusion, got " +
    JSON.stringify(aAdjNhPinned.summary.pinned));
near(aAdjNhPinned.shifts["N3"].distance, 0, 1e-9,
    "...and an explicitly pinned station does not move at all (the same " +
    "station shifted " + aAdjNh.shifts["N3"].distance + " unpinned)");
// a name the network has never heard of is ignored, not pinned into
// existence -- CsRevise.apply passes a geo station that may have been
// deleted from the drawing
var aAdjNhGhostPin = CsAdjust.adjust(adjNh, rAdjNh,
    { sigmaTape: 1, sigmaAngle: 0, pinned: ["NOPE", "N3"] });
ok(aAdjNhGhostPin.summary.pinned.indexOf("NOPE") === -1 &&
    aAdjNhGhostPin.summary.pinned.indexOf("N3") >= 0,
    "opts.pinned skips names the network does not have, got " +
    JSON.stringify(aAdjNhGhostPin.summary.pinned));

// (b) the same survey with no anchor at all: N3's control IS honored
// (it seeds the traverse), so it is pinned and must not move.
var rAdjNhFree = CsNetwork.resolve(adjNh, {});
ok(rAdjNhFree.controlFrame === null,
    "sanity: with no explicit anchor there is no frame to reconcile");
var aAdjNhFree = CsAdjust.adjust(adjNh, rAdjNhFree, EQ);
ok(aAdjNhFree.summary.pinned.indexOf("N3") >= 0,
    "honored control IS pinned, got " + JSON.stringify(aAdjNhFree.summary.pinned));
near(aAdjNhFree.stations["N3"].x, 1000, 1e-9, "pinned control does not move (x)");
near(aAdjNhFree.stations["N3"].y, 1000, 1e-9, "pinned control does not move (y)");
near(adjustGradientMax(aAdjNhFree), 0, 1e-9,
    "the anchored ring's adjustment satisfies the normal equations");

// (c) and controlFrame itself must survive the adjustment. The return
// shape is a SUPERSET of a resolve result, and two consumers read this
// field: CsDraw skips writing a `Fixed` tag for an un-honored station
// (there is no truthful control value to write), and CsReport prints
// the warning naming it. Dropping the field here would silently
// reinstate a Fixed tag nobody ever pinned AND delete the warning that
// says the control went unused -- two truths lost at once, invisibly.
ok(aAdjNh.controlFrame === rAdjNh.controlFrame,
    "the adjusted result carries controlFrame through");
var adjNhReport = CsReport.drawSummary(adjNh, aAdjNh, stubDrawn, []);
ok(adjNhReport.indexOf("N3") >= 0,
    "CsReport still warns about the un-honored control from an ADJUSTED " +
    "result, got:\n" + adjNhReport);
var aAdjNhStuck = CsAdjust.adjust(adjNh, rAdjNh, { sigmaTape: 1, sigmaAngle: 0,
    maxIterations: 1, cgTolerance: 1e-30 });
ok(aAdjNhStuck.controlFrame === rAdjNh.controlFrame,
    "the unadjusted pass-through carries controlFrame too");

// ---- cost: the solver runs inside redraws ---------------------------
//
// resolve() plus adjust() happen on every redraw, so a change that
// made the solve quadratic in station count would show up as a hang in
// the GUI, not as a failing test. This bound is deliberately loose --
// an order of magnitude over the measured cost, so machine noise
// cannot make it flaky -- but tight enough that quadratic behaviour
// could never slip through unnoticed.
if (IS_NODE) {
    var adjPerfSv = CsModel.newSurvey();
    var adjPerfN = 3000;
    var adjPerfLoops = 0;
    for (var apk = 1; apk <= adjPerfN; apk++) {
        adjPerfSv.shots.push(shotOf("AP" + (apk - 1), "AP" + apk, 10, 0));
    }
    // Real closing legs: back down 100 chain legs of 10 units each,
    // surveyed 0.4 short, so every loop carries a plausible 0.4
    // misclosure. (A short closing shot spanning a long gap would
    // "resolve" and "adjust" fine but would be a 990-unit blunder, not
    // a survey, and would measure the solver on data no cave produces.)
    for (apk = 200; apk < adjPerfN; apk += 200) {
        adjPerfSv.shots.push(shotOf("AP" + apk, "AP" + (apk - 100), 999.6, 180));
        adjPerfLoops++;
    }
    var rAdjPerf = CsNetwork.resolve(adjPerfSv, {});
    ok(rAdjPerf.loops.length === adjPerfLoops,
        "task 2 perf: sanity check on the built survey, expected " +
        adjPerfLoops + " loops got " + rAdjPerf.loops.length);
    var adjT0 = Date.now();
    var aAdjPerf = CsAdjust.adjust(adjPerfSv, rAdjPerf, EQ);
    var adjMs = Date.now() - adjT0;
    ok(aAdjPerf.summary.converged === true,
        "task 2 perf: a " + adjPerfN + "-station network with " +
        adjPerfLoops + " loops converges, in " + aAdjPerf.summary.iterations +
        " iterations");
    ok(adjustGradientMax(aAdjPerf) < 1e-5,
        "task 2 perf: and it really is solved -- worst normal-equation " +
        "imbalance " + adjustGradientMax(aAdjPerf) + " (measured ~5e-8)");
    ok(adjMs < 500,
        "task 2 perf: adjusting " + adjPerfN + " stations took " + adjMs +
        "ms under node -- measured ~35ms in " +
        aAdjPerf.summary.iterations + " iterations, so this 500ms bound is " +
        "an order of magnitude of slack; a quadratic solve would blow it");
}

// ---------------------------------------------------------------------
// Task 8 -- CsReport says what the adjustment did.
// ---------------------------------------------------------------------

var adjDrawnStub = { stationsDrawn: 5, shotsDrawn: 5, closuresDrawn: 1,
    tiesDrawn: 0, wallsDrawn: 0, splaysDrawn: 0, ghostDrawn: 5, skipped: 0 };

var adjText = CsReport.drawSummary(sq, asq, adjDrawnStub, []);
ok(adjText.indexOf("Adjusted") >= 0,
    "task 8: an adjusted draw's summary says so, got:\n" + adjText);
ok(adjText.indexOf("CTRL-RAW") >= 0,
    "task 8: the summary names the ghost layer so it can be found, got:\n" +
    adjText);
ok(adjText.indexOf(asq.summary.worstStation) >= 0,
    "task 8: the summary names the station that moved most, got:\n" + adjText);
ok(adjText.indexOf(CsReport.length(asq.summary.worstShift,
    sq.distanceUnit)) >= 0,
    "task 8: the summary gives the worst shift's distance, got:\n" + adjText);
ok(adjText.indexOf("horizontal") >= 0 && adjText.indexOf("vertical") >= 0,
    "task 8: loop lines report horizontal and vertical error alongside " +
    "the 3D one, got:\n" + adjText);

// A plain CsNetwork.resolve() result has `.adjusted === undefined`, not
// `false` -- it must still fall through to the not-adjusted wording,
// never be mistaken for "adjusted" by a loose truthiness check.
var rawText = CsReport.drawSummary(sq, rsq, adjDrawnStub, []);
ok(rawText.indexOf("Adjusted") < 0,
    "task 8: a plain resolve() result (adjusted undefined) never claims " +
    "an adjustment, got:\n" + rawText);
ok(rawText.indexOf("as surveyed") >= 0,
    "task 8: ...and says the misclosure is still on the closing leg, as " +
    "surveyed, got:\n" + rawText);

// Adjustment explicitly turned off: CsAdjust.unadjusted's pass-through
// shape (adjusted: false, no warning) reads the same way as a plain
// resolve.
var offText = CsReport.drawSummary(sq, CsAdjust.unadjusted(rsq),
    adjDrawnStub, []);
ok(offText.indexOf("Adjusted") < 0,
    "task 8: an explicitly unadjusted draw does not claim an adjustment, " +
    "got:\n" + offText);
ok(offText.indexOf("as surveyed") >= 0,
    "task 8: ...and says so the same way, got:\n" + offText);

// Non-convergence: CsAdjust puts the warning in summary.warning, and it
// must appear VERBATIM -- a half-solved network that merely looked
// adjusted would be worse than an unsolved one.
var stuckText = CsReport.drawSummary(sq, adjStuck, adjDrawnStub, []);
ok(stuckText.indexOf(adjStuck.summary.warning) >= 0,
    "task 8: a non-convergent solve's warning appears verbatim, got:\n" +
    stuckText);
ok(stuckText.indexOf("Adjusted by least squares") < 0,
    "task 8: ...and a starved solve never claims to have adjusted " +
    "anything, got:\n" + stuckText);

// Control ties are reported separately from loops, and without a
// percent -- CsNetwork sets percent: null on ties on purpose, and
// .toFixed() on null throws.
var tieText = CsReport.drawSummary(tie, rtie, adjDrawnStub, []);
ok(tieText.indexOf("Control tie") >= 0,
    "task 8: a component tie is reported as a tie, not a loop, got:\n" +
    tieText);
ok(tieText.indexOf("Loop") < 0,
    "task 8: ...and the word 'Loop' does not leak into a tie-only " +
    "report, got:\n" + tieText);

// statsSummary's worst-loop line gains horizontal and vertical too.
var statsForWorst = CsStats.compute(sq, rsq, CsTraverse.SLOPE);
var gradeForWorst = CsGrade.compute(sq, rsq, statsForWorst);
var statsText = CsReport.statsSummary(sq, statsForWorst, gradeForWorst);
ok(statsText.indexOf("horizontal") >= 0 && statsText.indexOf("vertical") >= 0,
    "task 8: the worst-loop line in Survey Stats reports horizontal and " +
    "vertical error too, got:\n" + statsText);

// ---------------------------------------------------------------------
// Task 3 -- CsAdjust: settings, the per-drawing record, and the single
// resolveAndAdjust entry point.
// ---------------------------------------------------------------------

// Settings plumbing: under node there is no RSettings, so the defaults
// must come back rather than an exception, and adjustment is ON by
// default.
var defOpts = CsAdjust.currentOptions();
ok(defOpts.enabled === true, "task 3: adjustment enabled by default");
near(defOpts.sigmaTape, CsAdjust.DEFAULT_SIGMA_TAPE, 1e-12,
    "task 3: default sigmaTape");
near(defOpts.sigmaAngle, CsAdjust.DEFAULT_SIGMA_ANGLE, 1e-12,
    "task 3: default sigmaAngle");

// A stored setting is read back, and an engine whose getters throw
// (not just one that is entirely absent) must not raise --
// currentOptions() falls back to the defaults instead.
(function() {
    var realSettings = (typeof RSettings !== "undefined") ?
        RSettings : undefined;
    try {
        RSettings = {
            getBoolValue: function(key, dflt) {
                return key === CsAdjust.SETTING_ENABLED ? false : dflt;
            },
            getDoubleValue: function(key, dflt) {
                if (key === CsAdjust.SETTING_SIGMA_TAPE) { return 0.02; }
                if (key === CsAdjust.SETTING_SIGMA_ANGLE) { return 0.3; }
                return dflt;
            }
        };
        var stored = CsAdjust.currentOptions();
        ok(stored.enabled === false,
            "task 3: currentOptions reads the stored enabled flag");
        near(stored.sigmaTape, 0.02, 1e-12,
            "task 3: currentOptions reads the stored sigmaTape");
        near(stored.sigmaAngle, 0.3, 1e-12,
            "task 3: currentOptions reads the stored sigmaAngle");

        RSettings = {
            getBoolValue: function() { throw new Error("no such setting"); },
            getDoubleValue: function() { throw new Error("no such setting"); }
        };
        var thrown = CsAdjust.currentOptions();
        ok(thrown.enabled === true, "task 3: an engine whose getters throw " +
            "still returns the enabled default rather than an exception");
        near(thrown.sigmaTape, CsAdjust.DEFAULT_SIGMA_TAPE, 1e-12,
            "task 3: ...and the default sigmaTape, not a thrown error");
    } finally {
        RSettings = realSettings;
    }
})();

// A drawing's own recorded values win over the CURRENT SETTINGS --not
// merely the hardcoded defaults-- so reopening and redrawing
// reproduces the geometry it was drawn with even after someone changes
// the global setting in the meantime.
(function() {
    var realSettings = (typeof RSettings !== "undefined") ?
        RSettings : undefined;
    try {
        RSettings = {
            getBoolValue: function(key, dflt) { return dflt; },
            getDoubleValue: function(key, dflt) {
                if (key === CsAdjust.SETTING_SIGMA_TAPE) { return 0.05; }
                if (key === CsAdjust.SETTING_SIGMA_ANGLE) { return 0.6; }
                return dflt;
            }
        };
        var fromTags = CsAdjust.optionsFromTags({ Adjustment: "lsq",
            SigmaTape: "0.01", SigmaAngle: "0.3" });
        ok(fromTags.enabled === true,
            "task 3: recorded Adjustment=lsq enables");
        near(fromTags.sigmaTape, 0.01, 1e-12,
            "task 3: recorded sigmaTape wins over the current setting");
        near(fromTags.sigmaAngle, 0.3, 1e-12,
            "task 3: recorded sigmaAngle wins over the current setting");

        ok(CsAdjust.optionsFromTags({ Adjustment: "none" }).enabled === false,
            "task 3: recorded Adjustment=none disables");
        ok(CsAdjust.optionsFromTags({}).enabled === true,
            "task 3: a drawing with no recorded Adjustment follows the " +
            "(stubbed, on) settings");

        // absent sigmas follow the SETTINGS, not the hardcoded default
        var followsSettings = CsAdjust.optionsFromTags({ Adjustment: "lsq" });
        near(followsSettings.sigmaTape, 0.05, 1e-12,
            "task 3: an absent recorded sigmaTape follows the setting, " +
            "not the hardcoded default");
        near(followsSettings.sigmaAngle, 0.6, 1e-12,
            "task 3: an absent recorded sigmaAngle follows the setting, " +
            "not the hardcoded default");
    } finally {
        RSettings = realSettings;
    }
})();

// Unstubbed (node, no RSettings): a blank or unparseable recorded
// sigma falls back to the default rather than yielding NaN -- a NaN
// sigma would poison every weight in the solve.
ok(CsAdjust.optionsFromTags({ Adjustment: "lsq", SigmaTape: "" })
    .sigmaTape === CsAdjust.DEFAULT_SIGMA_TAPE,
    "task 3: a blank recorded sigma falls back to the default");
var unparseable = CsAdjust.optionsFromTags({ Adjustment: "lsq",
    SigmaTape: "not-a-number", SigmaAngle: "also-not-a-number" });
ok(!isNaN(unparseable.sigmaTape) &&
    unparseable.sigmaTape === CsAdjust.DEFAULT_SIGMA_TAPE,
    "task 3: an unparseable recorded sigmaTape falls back too, got " +
    unparseable.sigmaTape);
ok(!isNaN(unparseable.sigmaAngle) &&
    unparseable.sigmaAngle === CsAdjust.DEFAULT_SIGMA_ANGLE,
    "task 3: an unparseable recorded sigmaAngle falls back too, got " +
    unparseable.sigmaAngle);

// tagsFor round-trips through optionsFromTags to the same options
// (unstubbed, so "the settings" a bare tag set falls back to are the
// defaults).
var rtOn = { enabled: true, sigmaTape: 0.02, sigmaAngle: 0.44 };
var rtOnTags = CsAdjust.tagsFor(rtOn);
ok(rtOnTags.Adjustment === "lsq",
    "task 3: tagsFor records lsq when enabled");
var rtOnBack = CsAdjust.optionsFromTags(rtOnTags);
ok(rtOnBack.enabled === true, "task 3: tagsFor/optionsFromTags round-trip " +
    "enabled");
near(rtOnBack.sigmaTape, rtOn.sigmaTape, 1e-12,
    "task 3: tagsFor/optionsFromTags round-trip sigmaTape");
near(rtOnBack.sigmaAngle, rtOn.sigmaAngle, 1e-12,
    "task 3: tagsFor/optionsFromTags round-trip sigmaAngle");

var rtOff = { enabled: false, sigmaTape: 0.15, sigmaAngle: 2.0 };
var rtOffTags = CsAdjust.tagsFor(rtOff);
ok(rtOffTags.Adjustment === "none",
    "task 3: tagsFor records none when disabled");
var rtOffBack = CsAdjust.optionsFromTags(rtOffTags);
ok(rtOffBack.enabled === false,
    "task 3: tagsFor/optionsFromTags round-trip enabled=false");
near(rtOffBack.sigmaTape, rtOff.sigmaTape, 1e-12,
    "task 3: tagsFor/optionsFromTags round-trip sigmaTape when disabled");
near(rtOffBack.sigmaAngle, rtOff.sigmaAngle, 1e-12,
    "task 3: tagsFor/optionsFromTags round-trip sigmaAngle when disabled");

// One call for both paths, one shape out -- and controlFrame must
// travel in both, because CsDraw and CsReport both read it.
var freshResolve = CsNetwork.resolve(sq, {});
var onResult = CsAdjust.resolveAndAdjust(sq, {}, EQ);
ok(onResult.adjusted === true,
    "task 3: resolveAndAdjust adjusts when enabled");
ok(JSON.stringify(onResult.controlFrame) ===
    JSON.stringify(freshResolve.controlFrame),
    "task 3: the adjusted result carries controlFrame through");

var offResult = CsAdjust.resolveAndAdjust(sq, {},
    { enabled: false, sigmaTape: 1, sigmaAngle: 0 });
ok(offResult.adjusted === false,
    "task 3: resolveAndAdjust passes through when off");
ok(offResult.raw === null, "task 3: a pass-through offers no ghost");
near(offResult.stations["A3"].x, rsq.stations["A3"].x, 1e-12,
    "task 3: a pass-through is the raw resolve");
ok(JSON.stringify(offResult.controlFrame) ===
    JSON.stringify(freshResolve.controlFrame),
    "task 3: the pass-through result carries controlFrame too");

// adjustOpts omitted means CsAdjust.currentOptions() -- unstubbed, on
// by default -- so the survey with a real loop comes back adjusted.
var defaultResult = CsAdjust.resolveAndAdjust(sq, {});
ok(defaultResult.adjusted === true,
    "task 3: resolveAndAdjust with no adjustOpts follows currentOptions()");

// ---- task 7: both sides of a revision, identically adjusted --------
//
// CsRevise.apply resolves twice -- before and after the revision --
// and hands both to classifyChange. Adjust ONE side and not the other
// and the fit reads the adjustment itself as part of the revision: a
// pure declination change stops classifying as rigid, the drawing gets
// erased and redrawn, and untagged hand-traced walls go with it. So the
// property under test is a pair: identical options on both sides stays
// rigid, and a mismatched pair does not.
var revLoopSv = function() {
    var s = CsModel.newSurvey();
    s.shots.push(shotOf("R1", "R2", 10, 0));
    s.shots.push(shotOf("R2", "R3", 8, 90));
    // deliberately mis-shot: the exact closure is 12.806 ft at 218.66,
    // so this leaves ~1.9 ft of real misclosure for the adjustment to
    // distribute -- without it the test would prove nothing
    s.shots.push(shotOf("R3", "R1", 11.5, 225));
    return s;
};
var revAdjOpts = { enabled: true, sigmaTape: 1, sigmaAngle: 0 };
var revOldSv = revLoopSv();
var revNewSv = revLoopSv();
CsRevise.reviseDeclination(revNewSv, 0, 2.0, "user");
var revOldR = CsAdjust.resolveAndAdjust(revOldSv, {}, revAdjOpts);
var revNewR = CsAdjust.resolveAndAdjust(revNewSv, {}, revAdjOpts);
// vacuous otherwise: an adjustment that moved nothing could not be
// mistaken for a revision either
ok(revOldR.summary.worstShift > 0.1,
    "task 7: the fixture really is adjusted -- worst shift " +
    revOldR.summary.worstShift);
var revExtent = CsRevise.positionsExtent(revOldR.stations);
var revCls = CsRevise.classifyChange(revOldR, revNewR, revExtent);
ok(revCls.rigid === true,
    "task 7: a declination revision stays RIGID when both sides are " +
    "adjusted the same way (maxResidual " + revCls.maxResidual + ")");
near(revCls.theta, -2.0 * Math.PI / 180.0, 1e-9,
    "task 7: the rigid rotation is the declination delta, sign per " +
    "CsRevise.applyFit");
// the trap itself, pinned so nobody re-introduces it: one side adjusted
// and the other raw is NOT rigid, even though the only real change was
// a declination
var revMixedCls = CsRevise.classifyChange(revOldR,
    CsNetwork.resolve(revNewSv, {}), revExtent);
ok(revMixedCls.rigid === false,
    "task 7: adjusting only one side misclassifies the same revision as " +
    "non-rigid (maxResidual " + revMixedCls.maxResidual + ")");

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
// Splays feed the walls too. A splay tip IS a measured wall hit; before
// this it was drawn as a ray and then ignored by wall generation, so a
// DistoX survey with dozens of wall shots per station still got walls
// built from four LRUD numbers.
//
// Side comes from the sign of (splay azimuth - passage azimuth); order
// within a station's side from the along-passage projection, so a
// backward splay lands before the station's LRUD tick and a forward one
// after it, and the run advances instead of zigzagging.
// ---------------------------------------------------------------------

function splayOf(from, d, az, inc) {
    var s = CsModel.newShot();
    s.from = from;
    s.to = "";
    s.distance = d;
    s.azimuth = az;
    s.inclination = inc || 0;
    s.splay = true;
    return s;
}

// A1 -> A2 -> A3, due north, LRUD only at A2.
function splayFixture() {
    var sv = CsModel.newSurvey();
    var s1 = shotOf("A1", "A2", 10, 0);
    s1.left = 2;
    s1.right = 3;
    sv.shots.push(s1);
    sv.shots.push(shotOf("A2", "A3", 10, 0));
    return sv;
}

(function() {
    // due east splay at A2 (passage runs north): a RIGHT wall point,
    // at the splay's own tip, not at the LRUD tick
    var sv = splayFixture();
    sv.shots.push(splayOf("A2", 5, 90));
    var r = CsNetwork.resolve(sv, {});
    var w = CsLrud.wallRuns(sv, r);
    var right = [];
    for (var i = 0; i < w.right.length; i++) {
        for (var j = 0; j < w.right[i].length; j++) { right.push(w.right[i][j]); }
    }
    var hit = null;
    for (i = 0; i < right.length; i++) {
        if (Math.abs(right[i].x - 5) < 1e-9 && Math.abs(right[i].y - 10) < 1e-9) {
            hit = right[i];
        }
    }
    ok(hit !== null, "splay walls: east splay becomes a right wall point at its tip");

    // and it did not land on the left
    var leftBad = false;
    for (i = 0; i < w.left.length; i++) {
        for (var k = 0; k < w.left[i].length; k++) {
            if (w.left[i][k].x > 0.5) { leftBad = true; }
        }
    }
    ok(leftBad === false, "splay walls: an east splay never joins the left wall");
})();

(function() {
    // due west splay -> left wall
    var sv = splayFixture();
    sv.shots.push(splayOf("A2", 4, 270));
    var w = CsLrud.wallRuns(sv, CsNetwork.resolve(sv, {}));
    var found = false;
    for (var i = 0; i < w.left.length; i++) {
        for (var j = 0; j < w.left[i].length; j++) {
            if (Math.abs(w.left[i][j].x + 4) < 1e-9) { found = true; }
        }
    }
    ok(found, "splay walls: west splay becomes a left wall point");
})();

(function() {
    // ordering: a BACKWARD-left splay (az 225) comes before A2's LRUD
    // tick, a FORWARD-left one (az 315) after it
    var sv = splayFixture();
    sv.shots.push(splayOf("A2", Math.sqrt(2), 315));   // forward-left
    sv.shots.push(splayOf("A2", Math.sqrt(2), 225));   // backward-left
    var w = CsLrud.wallRuns(sv, CsNetwork.resolve(sv, {}));
    var ys = [];
    for (var i = 0; i < w.left.length; i++) {
        for (var j = 0; j < w.left[i].length; j++) { ys.push(w.left[i][j].y); }
    }
    var sorted = true;
    for (i = 1; i < ys.length; i++) {
        if (ys[i] < ys[i - 1] - 1e-9) { sorted = false; }
    }
    ok(ys.length >= 3 && sorted,
        "splay walls: a station's own splays run backward-to-forward, got [" +
        ys.join(",") + "]");
})();

(function() {
    // a station with splays but NO LRUD still contributes wall points
    // (and no longer breaks the run for want of four numbers)
    var sv = CsModel.newSurvey();
    var a = shotOf("B1", "B2", 10, 0);
    a.left = 2; a.right = 2;
    sv.shots.push(a);
    sv.shots.push(shotOf("B2", "B3", 10, 0));   // B3: no LRUD at all
    sv.shots.push(splayOf("B3", 3, 90));
    sv.shots.push(splayOf("B3", 3, 270));
    var w = CsLrud.wallRuns(sv, CsNetwork.resolve(sv, {}));
    var right3 = false, left3 = false;
    for (var i = 0; i < w.right.length; i++) {
        for (var j = 0; j < w.right[i].length; j++) {
            if (Math.abs(w.right[i][j].x - 3) < 1e-9 &&
                Math.abs(w.right[i][j].y - 20) < 1e-9) { right3 = true; }
        }
    }
    for (i = 0; i < w.left.length; i++) {
        for (j = 0; j < w.left[i].length; j++) {
            if (Math.abs(w.left[i][j].x + 3) < 1e-9 &&
                Math.abs(w.left[i][j].y - 20) < 1e-9) { left3 = true; }
        }
    }
    ok(right3 && left3,
        "splay walls: a splay-only station contributes both walls");
})();

(function() {
    // an AXIAL splay (straight up or down the passage) sits on the
    // centerline and belongs to neither wall
    var sv = splayFixture();
    sv.shots.push(splayOf("A2", 6, 0));
    sv.shots.push(splayOf("A2", 6, 180));
    var w = CsLrud.wallRuns(sv, CsNetwork.resolve(sv, {}));
    var bad = 0;
    var scan = function(runs) {
        for (var i = 0; i < runs.length; i++) {
            for (var j = 0; j < runs[i].length; j++) {
                if (Math.abs(runs[i][j].x) < 1e-9 &&
                    Math.abs(runs[i][j].y - 4) < 1e-9) { bad++; }
                if (Math.abs(runs[i][j].x) < 1e-9 &&
                    Math.abs(runs[i][j].y - 16) < 1e-9) { bad++; }
            }
        }
    };
    scan(w.left); scan(w.right);
    ok(bad === 0, "splay walls: axial splays join neither wall");
})();

(function() {
    // a splay kept out of the plot keeps out of the walls too
    var sv = splayFixture();
    var hidden = splayOf("A2", 7, 90);
    hidden.excludeFromPlot = true;
    var dropped = splayOf("A2", 8, 90);
    dropped.excludeFromAll = true;
    sv.shots.push(hidden);
    sv.shots.push(dropped);
    var w = CsLrud.wallRuns(sv, CsNetwork.resolve(sv, {}));
    var bad = false;
    for (var i = 0; i < w.right.length; i++) {
        for (var j = 0; j < w.right[i].length; j++) {
            if (w.right[i][j].x > 3.5) { bad = true; }
        }
    }
    ok(bad === false,
        "splay walls: excluded splays stay out of the walls, as they do " +
        "out of the plot");
})();

(function() {
    // steep splays are NOT filtered: every splay counts, so a near-
    // vertical one contributes its (short) plan projection
    var sv = splayFixture();
    sv.shots.push(splayOf("A2", 10, 90, 80));   // plan = 10*cos(80) = 1.736
    var w = CsLrud.wallRuns(sv, CsNetwork.resolve(sv, {}));
    var found = false;
    for (var i = 0; i < w.right.length; i++) {
        for (var j = 0; j < w.right[i].length; j++) {
            if (Math.abs(w.right[i][j].x - 10 * Math.cos(80 * Math.PI / 180)) < 1e-9) {
                found = true;
            }
        }
    }
    ok(found, "splay walls: a steep splay still counts, at its plan length");
})();

(function() {
    // REGRESSION: with no splays, a lone LRUD station still yields no
    // run -- one point is not a wall, and that has to stay true.
    var sv = splayFixture();
    var w = CsLrud.wallRuns(sv, CsNetwork.resolve(sv, {}));
    ok(w.left.length === 0 && w.right.length === 0,
        "splay walls: no splays, no change -- a single LRUD point is " +
        "still not a run");
})();

// ---------------------------------------------------------------------
// Splay walls -- an unmeasurable splay is skipped, not placed at the
// station. `splayOf` cannot itself build a null-distance shot (`d`
// passes straight through, but a real fixture needs `s.distance` set
// after construction), so these fixtures poke the field directly.
// ---------------------------------------------------------------------

(function() {
    // a no-distance splay must NOT become a wall point at the
    // station: that would assert "the wall is exactly here" for a
    // measurement nobody took.
    var sv = splayFixture();
    var ghost = splayOf("A2", 5, 90); // would-be right wall point at x=5
    ghost.distance = null;
    sv.shots.push(ghost);
    var w = CsLrud.wallRuns(sv, CsNetwork.resolve(sv, {}));
    var atStation = false, anyRight = false;
    for (var i = 0; i < w.right.length; i++) {
        for (var j = 0; j < w.right[i].length; j++) {
            anyRight = true;
            if (Math.abs(w.right[i][j].x - 0) < 1e-9 &&
                    Math.abs(w.right[i][j].y - 10) < 1e-9) {
                atStation = true;
            }
        }
    }
    ok(atStation === false,
        "splay walls: a no-distance splay does not fabricate a wall " +
        "point at the station");
    ok(anyRight === false,
        "splay walls: with the LRUD-only fixture and one unmeasurable " +
        "splay, the right side has no evidence at all");
    eqs(CsLrud.stationWallPoints({ x: 0, y: 10 }, 0, null, [ghost], "R",
        CsTraverse.SLOPE).length, 0,
        "stationWallPoints: an unmeasurable splay contributes zero points");
})();

(function() {
    // a no-inclination splay must not draw level either -- same rule,
    // the other missing field.
    var sv = splayFixture();
    var ghost = splayOf("A2", 5, 90);
    ghost.inclination = null;
    sv.shots.push(ghost);
    var w = CsLrud.wallRuns(sv, CsNetwork.resolve(sv, {}));
    var found = false;
    for (var i = 0; i < w.right.length; i++) {
        for (var j = 0; j < w.right[i].length; j++) {
            if (Math.abs(w.right[i][j].x - 5) < 1e-9) { found = true; }
        }
    }
    ok(found === false,
        "splay walls: a no-inclination splay is skipped, not drawn level");
})();

(function() {
    // REGRESSION, the distinction the whole task turns on: a REAL
    // zero-distance splay (a genuine tie between the LRUD tick and a
    // measured point exactly at the station) must keep producing a
    // wall point, unchanged.
    var sv = splayFixture();
    sv.shots.push(splayOf("A2", 0, 90)); // real zero distance
    var w = CsLrud.wallRuns(sv, CsNetwork.resolve(sv, {}));
    var atStation = false;
    for (var i = 0; i < w.right.length; i++) {
        for (var j = 0; j < w.right[i].length; j++) {
            if (Math.abs(w.right[i][j].x - 0) < 1e-9 &&
                    Math.abs(w.right[i][j].y - 10) < 1e-9) {
                atStation = true;
            }
        }
    }
    ok(atStation, "splay walls: a REAL zero-distance splay still " +
        "places a wall point at the station -- zero is a measurement");
})();

(function() {
    // wallRuns reports what it skipped, so a surveyor sees the gap
    // rather than a confident wrong line.
    var sv = splayFixture();
    var ghost1 = splayOf("A2", 5, 90);
    ghost1.distance = undefined;
    var ghost2 = splayOf("A2", 5, 270);
    ghost2.inclination = undefined;
    sv.shots.push(ghost1);
    sv.shots.push(ghost2);
    var w = CsLrud.wallRuns(sv, CsNetwork.resolve(sv, {}));
    eqs(w.skipped, 2,
        "wallRuns: both unmeasurable splays are counted as skipped");
})();

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

// --- CRITICAL 1's own fix: lineworkSummary's 4th argument, stationsMoved
// -------------------------------------------------------------------
// CsReport.profileSummary calls this with moved===0 on EVERY clean
// profile draw (a first-ever draw, or an idempotent redraw of an
// unchanged one -- CsProfileDraw.render runs its positionsMoved guard on
// every call, automatic or manual), not only on a real revision the way
// CsRevise.apply and the notebook's Draw do. Without this argument, the
// unconditional "hand-drawn linework did NOT move with it" warning at
// the bottom of this function fired on every one of those clean runs,
// telling the user their tracing was abandoned when nothing had moved
// for it to follow in the first place. Exact-line assertions against
// the exact WARNING text this function owns, not a substring, per this
// feature's own rule against bundled substring checks.
(function() {
    var ABANDONED = "WARNING -- hand-drawn linework that is not bound " +
        "to the survey did NOT move with it; re-trace walls and " +
        "detail near the moved stations, or bind it first " +
        "(Adopt linework) and revise again.";

    // stationsMoved omitted (undefined): defaults to true, so every
    // EXISTING caller (CsRevise.apply, the notebook's Draw -- neither of
    // which passes a 4th argument) keeps behaving exactly as before this
    // fix landed.
    ok(CsRevise.lineworkSummary(0, [], 0).indexOf(ABANDONED) >= 0,
        "lineworkSummary: 4th arg omitted defaults to true -- existing " +
        "callers still warn on moved===0, unchanged from before this fix");

    // stationsMoved explicitly false: nothing moved, so there was
    // nothing for a sketch to follow -- no warning at all.
    var quiet = CsRevise.lineworkSummary(0, [], 0, false);
    ok(quiet.indexOf(ABANDONED) < 0,
        "lineworkSummary: stationsMoved=false suppresses the abandoned-" +
        "tracing warning, got '" + quiet.join(" / ") + "'");
    ok(quiet.indexOf("Traced linework moved with its stations: 0") >= 0,
        "lineworkSummary: the moved-count line still prints even when " +
        "the warning is suppressed");

    // stationsMoved explicitly true, moved still 0: a REAL refusal --
    // stations genuinely moved and bound linework failed to follow --
    // must still warn. This is the case CRITICAL 1's fix must not
    // over-suppress.
    var real = CsRevise.lineworkSummary(0, [], 0, true);
    ok(real.indexOf(ABANDONED) >= 0,
        "lineworkSummary: stationsMoved=true still warns on moved===0 " +
        "-- a genuine refusal is not silenced by this fix");

    // moved > 0: no warning either way, stationsMoved is irrelevant once
    // something actually moved
    ok(CsRevise.lineworkSummary(3, [], 0, false).indexOf(ABANDONED) < 0 &&
        CsRevise.lineworkSummary(3, [], 0, true).indexOf(ABANDONED) < 0,
        "lineworkSummary: moved > 0 never warns, regardless of " +
        "stationsMoved");
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
// Layer registry -- pure data, runs under node and QCAD alike.
// ---------------------------------------------------------------------

(function() {
    loadRepoScript("scripts/CaveSurvey/Core/CsLayers.js");

    ok(CsLayers.RAW === "CTRL-RAW", "the as-surveyed ghost layer is CTRL-RAW");
    ok(CsLayers.DEFAULTS["CTRL-RAW"][1] === "DASHED",
        "CTRL-RAW is dashed -- it is not the survey, it is where the survey was");
    ok(CsLayers.OFF["CTRL-RAW"] === true, "CTRL-RAW is created switched off");
})();

// ---------------------------------------------------------------------
// Drawing round-trip -- QCAD engine only (node has no R* classes).
// This is the test that would have caught the silent simple.js
// failures: draw into a real document, read layers and tags back.
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// Lettering: everything the tools draw is UPPERCASE, the drafting
// convention. Enforced where the entity is made, so the survey data
// underneath keeps the case it was typed in.
// ---------------------------------------------------------------------

if (!IS_NODE) {
    (function() {
        loadRepoScript("scripts/CaveSurvey/Core/CsLayers.js");
        loadRepoScript("scripts/CaveSurvey/Core/CsStore.js");
        loadRepoScript("scripts/CaveSurvey/Core/CsTags.js");
        loadRepoScript("scripts/CaveSurvey/Core/CsDraw.js");
        loadRepoScript("scripts/CaveSurvey/Core/CsSheet.js");

        ok(CsDraw.caps("Sand floor, crawl") === "SAND FLOOR, CRAWL",
            "caps: plain text uppercased");
        ok(CsDraw.caps("a1") === "A1", "caps: station names too");
        ok(CsDraw.caps("") === "", "caps: empty stays empty");
        ok(CsDraw.caps(null) === "", "caps: null is not a crash");
        // MText formatting codes are case-sensitive: \P is a paragraph
        // break, \p is a paragraph property. Uppercasing blind would
        // rewrite one into the other, so the character after a
        // backslash keeps its case.
        ok(CsDraw.caps("line one\\pline two") === "LINE ONE\\pLINE TWO",
            "caps: an escape code keeps its case, got " +
            CsDraw.caps("line one\\pline two"));

        var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var di = new RDocumentInterface(doc);
        getDocument = function() { return doc; };
        getDocumentInterface = function() { return di; };

        // addText is the chokepoint every drawn label goes through
        var layer = new RLayer(doc, "CAPS-TEST", false, false,
            new RColor("white"), doc.getLinetypeId("CONTINUOUS"),
            RLineweight.Weight025, false);
        var lop = new RAddObjectsOperation();
        lop.addObject(layer);
        di.applyOperation(lop);
        var top = new RAddObjectsOperation();
        var drawnText = CsDraw.addText(doc, top, "CAPS-TEST", "Sheet 1",
            new RVector(0, 0), RS.HAlignLeft, "CapsTest", "one");
        di.applyOperation(top);
        ok(String(drawnText.getPlainText()) === "SHEET 1",
            "caps: addText letters in caps, got '" +
            drawnText.getPlainText() + "'");
        // the TAG is data, not lettering -- it keeps its own case
        ok(CsTags.get(drawnText, "CapsTest") === "one",
            "caps: tags are data and keep their case");

        // a drawn survey: station labels and notes come out capitalised
        var csv = CsModel.newSurvey();
        var cs1 = shotOf("c1", "c2", 10, 0);
        cs1.notes = "muddy crawl";
        csv.shots.push(cs1);
        CsDraw.survey(csv, CsNetwork.resolve(csv, {}));
        var lowerFound = false;
        var noteSeen = false;
        var cids = doc.queryAllEntities(false, false);
        for (var ci = 0; ci < cids.length; ci++) {
            var ce = doc.queryEntity(cids[ci]);
            if (isNull(ce) || typeof ce.getPlainText !== "function") {
                continue;
            }
            var txt = String(ce.getPlainText());
            if (txt !== txt.toUpperCase()) { lowerFound = true; }
            if (txt.indexOf("MUDDY CRAWL") >= 0) { noteSeen = true; }
        }
        ok(lowerFound === false, "caps: nothing drawn carries lower case");
        ok(noteSeen, "caps: a station note is drawn in caps");

        // the survey data itself is untouched -- caps is lettering only
        ok(csv.shots[0].notes === "muddy crawl",
            "caps: the typed note keeps its case in the model");
        var reread = CsTags.surveyFromDocument(doc);
        var keptCase = false;
        for (var ri = 0; ri < reread.shots.length; ri++) {
            if (reread.shots[ri].notes === "muddy crawl") { keptCase = true; }
        }
        ok(keptCase, "caps: the note reads back out of XDATA as typed");

        // title block values are lettering too
        var tbDoc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var tbDi = new RDocumentInterface(tbDoc);
        var field = CsSheet.fieldById("length");
        var tbAdd = new RAddObjectsOperation();
        var tbText = new RTextEntity(tbDoc, new RTextData(
            new RVector(0, 0), new RVector(0, 0), 0.14, 0.0,
            RS.VAlignTop, RS.HAlignLeft, RS.LeftToRight, RS.Exact, 1.0,
            "Length:  ____ ft", "standard", false, false, 0.0, false));
        CsTags.set(tbText, CsSheet.TAG, "length");
        tbAdd.addObject(tbText, false);
        tbDi.applyOperation(tbAdd);
        var tbOp2 = new RModifyObjectsOperation();
        ok(CsSheet.writeField(tbDoc, tbOp2, field, "1,234 ft") === true,
            "caps: title block field written");
        tbDi.applyOperation(tbOp2);
        ok(CsSheet.readField(tbDoc, field) === "LENGTH:  1,234 FT",
            "caps: a stamped title block value letters in caps, got '" +
            CsSheet.readField(tbDoc, field) + "'");
    })();
}

// ---------------------------------------------------------------------
// Task 5b, drawn end to end: an unmeasurable splay draws no ray and no
// wall point, but is named in what CsDraw.survey reports. QCAD engine
// only -- this is the path that would have reached RVector and the DXF
// writer with a fabricated (or NaN) coordinate before CsTraverse.offset
// guarded against it.
// ---------------------------------------------------------------------

if (!IS_NODE) {
    (function() {
        loadRepoScript("scripts/CaveSurvey/Core/CsLayers.js");
        loadRepoScript("scripts/CaveSurvey/Core/CsStore.js");
        loadRepoScript("scripts/CaveSurvey/Core/CsTags.js");
        loadRepoScript("scripts/CaveSurvey/Core/CsDraw.js");

        var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var di = new RDocumentInterface(doc);
        getDocument = function() { return doc; };
        getDocumentInterface = function() { return di; };

        var sv = CsModel.newSurvey();
        var main = shotOf("D1", "D2", 10, 0);
        main.left = 2; // gives D2 wall evidence so LRUD is in play too
        var real = splayOf("D2", 5, 90);      // a genuine, measurable splay
        var ghost = splayOf("D2", 4, 45);     // unmeasurable: no distance
        ghost.distance = null;
        // review I5: a REAL zero-distance splay (a genuine tie into the
        // station -- see the CsTraverse/CsLrud "distance 0 is a
        // measurement" tests) must draw exactly like any other. Placed
        // AFTER the ghost so a mutation that treats distance===0 as
        // unmeasurable, or that reuses the ghost's numbering slot,
        // shows up as a distinct, separately-named failure.
        var zeroSplay = splayOf("D2", 0, 135);
        sv.shots = [main, real, ghost, zeroSplay];
        var resolved = CsNetwork.resolve(sv, {});
        var drawn = CsDraw.survey(sv, resolved);

        eqs(drawn.splaysDrawn, 2,
            "both measurable splays draw, INCLUDING the zero-distance " +
            "one, got " + drawn.splaysDrawn);
        eqs(drawn.splaysSkipped, 1,
            "only the truly unmeasurable splay is counted as skipped");

        // no entity anywhere carries the skipped splay's tip -- not a
        // ray, not a tip point, not a label. D2 has two DRAWN splays
        // (D2.1 the real one, D2.3 the zero-distance one) and one
        // skipped (D2.2, the ghost) -- a fabricated D2.2 would mean the
        // ghost drew after all; a MISSING D2.3 would mean the zero-
        // distance regression protection above failed silently.
        var splayNames = [];
        var cids = doc.queryAllEntities(false, false);
        for (var ci = 0; ci < cids.length; ci++) {
            var ce = doc.queryEntity(cids[ci]);
            if (isNull(ce)) { continue; }
            var sn = CsTags.get(ce, "SplayName");
            if (sn !== null && sn !== undefined) { splayNames.push(String(sn)); }
        }
        ok(splayNames.indexOf("D2.2") < 0,
            "the unmeasurable splay never reaches the drawing as D2.2, " +
            "got splay tags [" + splayNames.join(",") + "]");
        ok(splayNames.indexOf("D2.1") >= 0,
            "the real splay still draws as D2.1");
        ok(splayNames.indexOf("D2.3") >= 0,
            "review I5: the REAL zero-distance splay still draws, as " +
            "D2.3, got splay tags [" + splayNames.join(",") + "]");

        // NO NaN reaches any coordinate this draw produced -- assert
        // directly, the plan-view half of the task's own requirement.
        var anyNaN = false;
        for (ci = 0; ci < cids.length; ci++) {
            var pe = doc.queryEntity(cids[ci]);
            if (isNull(pe) || typeof pe.getBoundingBox !== "function") {
                continue;
            }
            var bb = pe.getBoundingBox();
            if (bb === undefined || bb === null) { continue; }
            var mn = bb.getMinimum(), mx = bb.getMaximum();
            if (!isFinite(mn.x) || !isFinite(mn.y) ||
                    !isFinite(mx.x) || !isFinite(mx.y)) {
                anyNaN = true;
            }
        }
        ok(anyNaN === false, "no NaN coordinate reaches any drawn entity");
    })();
}

// ---------------------------------------------------------------------
// Review minors: `drawn.skipped`'s subtraction of splaysSkipped, and
// `drawn.wallPointsSkipped`'s plumbing from CsLrud.wallRuns, were both
// unexercised by any test. A fixture where the three counts are all
// DIFFERENT (1, 2, 1) so a wrong source variable, or a dropped term,
// changes a specific number rather than surviving by coincidence:
//   - ghost:      off-axis, unmeasurable -- counted by BOTH the ray
//                 loop (splaysSkipped) and CsLrud's wall-point loop
//                 (wallPointsSkipped)
//   - axialGhost: exactly on-axis, unmeasurable -- CsLrud excludes an
//                 axial splay from wall consideration BEFORE it would
//                 ever count it as skipped (same rule as a perfectly
//                 measured axial splay: neither wall), but CsDraw's
//                 ray loop has no such filter, so it DOES count this
//                 one. This is what makes wallPointsSkipped (1) differ
//                 from splaysSkipped (2) -- a `wallPointsSkipped =
//                 splaysSkipped` mix-up would show 2, not 1.
//   - neverConnected: its own station resolves nowhere at all, so it
//                 never reaches either counter -- only resolved.
//                 skipped's generic bucket, which `drawn.skipped` must
//                 still name (as 1), separately from the two above.
// ---------------------------------------------------------------------

if (!IS_NODE) {
    (function() {
        loadRepoScript("scripts/CaveSurvey/Core/CsLayers.js");
        loadRepoScript("scripts/CaveSurvey/Core/CsStore.js");
        loadRepoScript("scripts/CaveSurvey/Core/CsTags.js");
        loadRepoScript("scripts/CaveSurvey/Core/CsDraw.js");

        var doc2 = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var di2 = new RDocumentInterface(doc2);
        getDocument = function() { return doc2; };
        getDocumentInterface = function() { return di2; };

        var sv2 = CsModel.newSurvey();
        var main2 = shotOf("E1", "E2", 10, 0); // passage az 0
        main2.left = 2;
        var ghost2 = splayOf("E2", 4, 45);     // off-axis, unmeasurable
        ghost2.distance = null;
        var axialGhost = splayOf("E2", 3, 0);  // ON-AXIS, unmeasurable
        axialGhost.distance = null;
        var neverConnected = splayOf("Z9", 2, 10); // Z9 never resolves
        sv2.shots = [main2, ghost2, axialGhost, neverConnected];
        var resolved2 = CsNetwork.resolve(sv2, {});
        var drawn2 = CsDraw.survey(sv2, resolved2);

        eqs(resolved2.skipped.length, 3,
            "all three splays land in CsNetwork's generic skipped bucket");
        eqs(drawn2.splaysSkipped, 2,
            "both E2 splays count as unmeasurable ray-skips (axial " +
            "or not) -- only Z9's, which never reaches the offset " +
            "check at all, does not");
        eqs(drawn2.wallPointsSkipped, 1,
            "review minor: CsLrud excludes the AXIAL splay before it " +
            "would ever count it, so this is 1, not 2 -- proving " +
            "wallPointsSkipped reads CsLrud.wallRuns.skipped and is " +
            "not aliased to splaysSkipped");
        eqs(drawn2.skipped, 1,
            "review minor: 3 generic-skipped minus 0 drawn minus 2 " +
            "ray-skipped leaves exactly Z9 -- dropping the " +
            "'- splaysSkipped' term would show 3 instead");

        // independent cross-check against CsLrud directly, not just
        // CsDraw's own plumbing of it
        var runsCheck = CsLrud.wallRuns(sv2, resolved2);
        eqs(drawn2.wallPointsSkipped, runsCheck.skipped,
            "drawn.wallPointsSkipped agrees with calling CsLrud.wallRuns " +
            "directly");
    })();
}

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

        // -----------------------------------------------------------
        // SEVENTH DOOR in the elevation-datum-trap family: a station
        // with no usable resolved z draws no Elevation tag at all
        // (CsTags.set drops a null value on write), so reading it back
        // through CsTags.surveyFromDocument used to fabricate a 0 via
        // `getNumber(...) || 0.0` -- exactly the "sixth door" fabrication
        // CsNetwork's own anchorEffectiveZ already refuses. Z1 here is
        // an anchor given no z and no fixed control to fall back on
        // (the sixth-door scenario itself), so it resolves at z = null
        // and CsDraw draws it with no Elevation tag.
        // -----------------------------------------------------------
        var zsv = CsModel.newSurvey();
        zsv.shots.push(shotOf("Z1", "Z2", 10, 0));
        var zres = CsNetwork.resolve(zsv,
            { anchor: { name: "Z1", x: 900, y: 900 } });
        ok(zres.anchorZUnknown !== null,
            "sanity: the Z1 anchor really has no usable z in this fixture");
        eqs(zres.stations["Z1"].z, null,
            "sanity: Z1 resolves at z = null, not a fabricated 0");
        CsDraw.survey(zsv, zres);

        var zStations = CsTags.collectStations(doc);
        var z1Entity = null;
        for (var zi = 0; zi < zStations.length; zi++) {
            if (zStations[zi].name === "Z1") { z1Entity = zStations[zi].entity; }
        }
        ok(z1Entity !== null, "sanity: Z1 was actually drawn and tagged");
        eqs(CsTags.get(z1Entity, "Elevation"), "",
            "sanity: no Elevation tag was written for a station with no z");

        var zRebuilt = CsTags.surveyFromDocument(doc);
        ok(zRebuilt.fixed.hasOwnProperty("Z1"),
            "sanity: Z1 reads back as a fixed station");
        eqs(zRebuilt.fixed["Z1"].z, null,
            "SEVENTH DOOR: a station with no Elevation tag reconstructs " +
            "at z = null, not a fabricated 0.0 (got " +
            zRebuilt.fixed["Z1"].z + ")");

        // EIGHTH-DOOR companion, fixed in the same change: feeding that
        // null back through CsNetwork.resolve's seedFixed (every
        // station surveyFromDocument reads back is *fix'ed -- Critical
        // C's own finding) must not silently refabricate the exact 0
        // CsTags.surveyFromDocument just refused to invent, or the
        // seventh-door fix would only make the OBJECT more honest
        // without changing what actually gets resolved and drawn.
        var zres2 = CsNetwork.resolve(zRebuilt, {});
        eqs(zres2.stations["Z1"].z, null,
            "EIGHTH DOOR (CsNetwork.resolve's seedFixed): a *fix'ed " +
            "station with no usable z resolves at z = null, not 0");
        ok(zres2.fixedZUnknown.indexOf("Z1") >= 0,
            "and the gap is named in fixedZUnknown, not silently absorbed");
        CsDraw.eraseStations(doc, ["Z1", "Z2"]);

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
    // Task 1b: CsDraw must never write a Fixed tag that contradicts a
    // station's own drawn position.
    // -----------------------------------------------------------------
    (function() {
        var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var di = new RDocumentInterface(doc);
        getDocument = function() { return doc; };
        getDocumentInterface = function() { return di; };

        var fixedTagOf = function(name) {
            var stations = CsTags.collectStations(doc);
            for (var i = 0; i < stations.length; i++) {
                if (stations[i].name === name) {
                    return CsTags.get(stations[i].entity, "Fixed");
                }
            }
            return undefined;
        };

        // Fixture: P1/Q1 tied via P2, both fixed, anchored explicitly
        // on P1 at a drawing position OTHER than its own control --
        // forcing Q1's control to be translated before it is drawn.
        var fdSv = CsModel.newSurvey();
        fdSv.shots.push(shotOf("FD_P1", "FD_P2", 10, 0));
        fdSv.shots.push(shotOf("FD_Q1", "FD_Q2", 10, 0));
        fdSv.shots.push(shotOf("FD_P2", "FD_Q1", 10, 90));
        fdSv.fixed["FD_P1"] = { x: 0, y: 0, z: 0 };
        fdSv.fixed["FD_Q1"] = { x: 10.4, y: 10, z: 0 };
        var fdRes = CsNetwork.resolve(fdSv,
            { anchor: { name: "FD_P1", x: 500, y: 500, z: 0 } });
        CsDraw.survey(fdSv, fdRes);

        var fdQ1Tag = fixedTagOf("FD_Q1");
        ok(fdQ1Tag !== undefined && fdQ1Tag !== "",
            "draw: the offset-controlled station still carries a Fixed tag");
        if (fdQ1Tag) {
            var fdParts = fdQ1Tag.split(",");
            near(parseFloat(fdParts[0]), fdRes.stations["FD_Q1"].x, 1e-6,
                "draw: Fixed tag's x matches the DRAWN position, not the raw control");
            near(parseFloat(fdParts[1]), fdRes.stations["FD_Q1"].y, 1e-6,
                "draw: Fixed tag's y matches the DRAWN position");
            ok(Math.abs(parseFloat(fdParts[0]) - fdSv.fixed["FD_Q1"].x) > 1,
                "sanity: the drawn position really differs from the raw control here");
        }

        // Same fixture, but the anchor has no control of its own: Q1's
        // control is not honored at all (controlFrame.notHonored), so
        // there is nothing truthful to write -- no Fixed tag at all,
        // rather than one that contradicts where Q1 actually landed.
        var fdSv2 = CsModel.newSurvey();
        fdSv2.shots.push(shotOf("FE_P1", "FE_P2", 10, 0));
        fdSv2.shots.push(shotOf("FE_Q1", "FE_Q2", 10, 0));
        fdSv2.shots.push(shotOf("FE_P2", "FE_Q1", 10, 90));
        fdSv2.fixed["FE_P1"] = { x: 0, y: 0, z: 0 };
        fdSv2.fixed["FE_Q1"] = { x: 10.4, y: 10, z: 0 };
        var fdRes2 = CsNetwork.resolve(fdSv2,
            { anchor: { name: "FE_P2", x: 0, y: 0, z: 0 } });
        CsDraw.survey(fdSv2, fdRes2);
        var fdQ1Tag2 = fixedTagOf("FE_Q1");
        ok(fdQ1Tag2 === undefined || fdQ1Tag2 === "",
            "draw: an un-honored fixed station gets no Fixed tag at all, got '" +
            fdQ1Tag2 + "'");

        // The default (no-anchor) path is untouched: the Fixed tag
        // still carries the raw control, because here it IS the drawn
        // position -- byte-identical to before this task.
        var fdSv3 = CsModel.newSurvey();
        fdSv3.shots.push(shotOf("FF_P1", "FF_P2", 10, 0));
        fdSv3.fixed["FF_P1"] = { x: 7, y: 3, z: 42 };
        var fdRes3 = CsNetwork.resolve(fdSv3, {});
        CsDraw.survey(fdSv3, fdRes3);
        ok(fixedTagOf("FF_P1") === "7,3,42",
            "draw: no-anchor path writes the raw control unchanged, got '" +
            fixedTagOf("FF_P1") + "'");
    })();

    // -----------------------------------------------------------------
    // Task 5: a control TIE gets its own drawn counter. A tie is the
    // single shot joining two separately anchored components; it is not
    // a loop closure, and counting it as an ordinary shot (which the
    // else-branch did) was accidental rather than decided.
    // -----------------------------------------------------------------
    (function() {
        var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var di = new RDocumentInterface(doc);
        getDocument = function() { return doc; };
        getDocumentInterface = function() { return di; };

        // two components, each with its own fixed station, joined by
        // exactly one shot -- CsNetwork classifies that shot "tie"
        var tsv = CsModel.newSurvey();
        tsv.shots.push(shotOf("TP1", "TP2", 10, 0));
        tsv.shots.push(shotOf("TQ1", "TQ2", 10, 0));
        tsv.shots.push(shotOf("TP2", "TQ1", 10, 90));
        tsv.fixed["TP1"] = { x: 0, y: 0, z: 0 };
        tsv.fixed["TQ1"] = { x: 10.4, y: 10, z: 0 };
        var tres = CsNetwork.resolve(tsv, {});
        ok(tres.ties.length === 1,
            "tie count: the fixture really does produce one tie, got " +
            tres.ties.length);
        var tdrawn = CsDraw.survey(tsv, tres);
        ok(tdrawn.tiesDrawn === 1,
            "tie count: the control tie is counted as a tie, got " +
            tdrawn.tiesDrawn);
        ok(tdrawn.shotsDrawn === 2,
            "tie count: the tie no longer inflates the ordinary shot " +
            "count, got " + tdrawn.shotsDrawn);
        ok(tdrawn.closuresDrawn === 0,
            "tie count: a tie is not a loop closure, got " +
            tdrawn.closuresDrawn);
        // every leg still lands as geometry -- the new counter must
        // partition the legs, not lose one
        ok(tdrawn.shotsDrawn + tdrawn.closuresDrawn + tdrawn.tiesDrawn +
            tdrawn.hiddenDrawn === 3,
            "tie count: the counters still add up to every drawn leg, got " +
            (tdrawn.shotsDrawn + tdrawn.closuresDrawn + tdrawn.tiesDrawn +
             tdrawn.hiddenDrawn));
    })();

    // -----------------------------------------------------------------
    // Task 5: the AS-SURVEYED ghost on CTRL-RAW.
    //
    // Its own document, following this file's one-IIFE-per-concern
    // shape: the harness above ends in a full erase and a DXF
    // round trip, and a four-station loop threaded through it would
    // change what those assertions are measuring.
    // -----------------------------------------------------------------
    (function() {
        var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var di = new RDocumentInterface(doc);
        getDocument = function() { return doc; };
        getDocumentInterface = function() { return di; };

        var ghostSurvey = CsModel.newSurvey();
        ghostSurvey.shots.push(shotOf("G1", "G2", 10, 0));
        ghostSurvey.shots.push(shotOf("G2", "G3", 10, 90));
        ghostSurvey.shots.push(shotOf("G3", "G4", 10, 180));
        ghostSurvey.shots.push(shotOf("G4", "G1", 10.5, 270));
        var rGhost = CsNetwork.resolve(ghostSurvey, {});
        var aGhost = CsAdjust.adjust(ghostSurvey, rGhost,
            { sigmaTape: 1, sigmaAngle: 0 });
        ok(aGhost.adjusted === true && aGhost.raw !== null,
            "ghost: the fixture really did adjust, so there IS a raw to draw");
        // G3 is deliberately NOT the pinned station, and the drawing
        // origin is nowhere near the survey origin: the ghost has to
        // ride the DRAWN frame's offset, so the origin station's ghost
        // point must NOT land on top of its drawn point.
        var gOrigin = new RVector(100, 200);
        var drawnGhost = CsDraw.survey(ghostSurvey, aGhost, "G3", gOrigin, 0);

        ok(drawnGhost.ghostDrawn === 4,
            "ghost: one ghost leg per drawn leg, got " +
            drawnGhost.ghostDrawn);

        var rawLineAt = {}, rawPointAt = {}, rawLayerCount = 0;
        var ghostWithShotTag = 0, ghostWithStationTag = 0;
        var gids = doc.queryAllEntities(false, false);
        for (var gi = 0; gi < gids.length; gi++) {
            var ge = doc.queryEntity(gids[gi]);
            if (isNull(ge)) { continue; }
            if (doc.getLayerName(ge.getLayerId()) === "CTRL-RAW") {
                rawLayerCount++;
            }
            var rs = CsTags.get(ge, "RawShot");
            if (rs !== "") {
                rawLineAt[rs] = ge;
                if (CsTags.get(ge, "Shot") !== "") { ghostWithShotTag++; }
            }
            var rp = CsTags.get(ge, "RawStation");
            if (rp !== "") {
                rawPointAt[rp] = ge;
                if (CsTags.get(ge, "Station") !== "") {
                    ghostWithStationTag++;
                }
            }
        }
        var countKeys = function(o) {
            var c = 0;
            for (var k in o) { if (o.hasOwnProperty(k)) { c++; } }
            return c;
        };
        ok(countKeys(rawLineAt) === 4,
            "ghost: four ghost lines tagged RawShot, got " +
            countKeys(rawLineAt));
        ok(countKeys(rawPointAt) === 4,
            "ghost: four ghost points tagged RawStation, got " +
            countKeys(rawPointAt));
        // THE ENVIRONMENT HAZARD: CTRL-RAW is created OFF, and this
        // build's RAddObjectsOperation silently drops adds to an off
        // layer. If the write is not wrapped in withLayerOn there is no
        // geometry and no error.
        ok(rawLayerCount === 8,
            "ghost: 4 lines + 4 points really LANDED on CTRL-RAW despite " +
            "the layer being off, got " + rawLayerCount);
        ok(doc.queryLayer("CTRL-RAW").isOff() === true,
            "ghost: CTRL-RAW is left switched off again afterwards");
        // a ghost is not a leg and not a station: nothing that keys on
        // Shot or Station may ever see two positions under one name
        ok(ghostWithShotTag === 0,
            "ghost: ghost lines carry no Shot tag, got " + ghostWithShotTag);
        ok(ghostWithStationTag === 0,
            "ghost: ghost points carry no Station tag, got " +
            ghostWithStationTag);
        // ... and nothing reconstructs a survey from them
        var ghostRecon = CsRevise.surveyFromDocument(doc);
        ok(ghostRecon.survey.shots.length === 4,
            "ghost: reconstruction still finds four shots, not eight, got " +
            ghostRecon.survey.shots.length);

        // THE GEOMETRY: the ghost is the AS-SURVEYED centerline placed
        // in the drawn frame -- raw coordinates plus the same offset the
        // drawn stations got. Recomputing the offset from the raw
        // origin instead would pin the ghost to the drawn origin and
        // hide whatever the adjustment did to that station.
        var offX = gOrigin.x - aGhost.stations["G3"].x;
        var offY = gOrigin.y - aGhost.stations["G3"].y;
        var shiftG3 = Math.abs(rGhost.stations["G3"].x -
            aGhost.stations["G3"].x) +
            Math.abs(rGhost.stations["G3"].y - aGhost.stations["G3"].y);
        ok(shiftG3 > 1e-6,
            "ghost: sanity -- G3 really moved, so the check below is not " +
            "vacuous (moved " + shiftG3 + ")");
        if (rawPointAt["G3"] !== undefined) {
            var g3 = rawPointAt["G3"].getPosition();
            near(g3.x, rGhost.stations["G3"].x + offX, 1e-6,
                "ghost: G3's ghost sits where it was SURVEYED (x)");
            near(g3.y, rGhost.stations["G3"].y + offY, 1e-6,
                "ghost: G3's ghost sits where it was SURVEYED (y)");
            ok(Math.abs(g3.x - gOrigin.x) + Math.abs(g3.y - gOrigin.y) > 1e-6,
                "ghost: the origin station's ghost does NOT sit on top of " +
                "its drawn point -- the ghost rides the drawn frame");
        }
        if (rawLineAt["G1->G2"] !== undefined) {
            var gl = rawLineAt["G1->G2"];
            near(gl.getStartPoint().x, rGhost.stations["G1"].x + offX, 1e-6,
                "ghost: the G1->G2 ghost line starts at raw G1");
            near(gl.getEndPoint().y, rGhost.stations["G2"].y + offY, 1e-6,
                "ghost: the G1->G2 ghost line ends at raw G2");
        }

        // A PARTIAL erase: a ghost leg is pure derived decoration with
        // no data on it, so EITHER end being replaced replaces the
        // ghost -- deliberately NOT the both-ends rule the real leg
        // lines follow. A real leg spanning an erased and a kept
        // station is the drawing's only record of that shot and must
        // survive; a ghost line in the same position is a picture
        // pointing at a coordinate that is about to move, and the
        // redraw regenerates it from the whole reconstructed survey
        // anyway -- keeping it accumulates a stale duplicate.
        CsDraw.eraseStations(doc, ["G1"]);
        var afterG1 = {};
        gids = doc.queryAllEntities(false, false);
        for (gi = 0; gi < gids.length; gi++) {
            ge = doc.queryEntity(gids[gi]);
            if (isNull(ge)) { continue; }
            var rs2 = CsTags.get(ge, "RawShot");
            if (rs2 !== "") { afterG1[rs2] = true; }
            var rp2 = CsTags.get(ge, "RawStation");
            if (rp2 !== "") { afterG1["pt:" + rp2] = true; }
        }
        ok(afterG1["G1->G2"] === undefined &&
            afterG1["G4->G1"] === undefined,
            "ghost: erasing G1 alone takes BOTH ghost legs touching it");
        ok(afterG1["pt:G1"] === undefined,
            "ghost: erasing G1 alone takes its ghost point");
        ok(afterG1["G2->G3"] === true && afterG1["G3->G4"] === true &&
            afterG1["pt:G3"] === true,
            "ghost: ghost geometry for stations NOT being replaced stays put");

        // A TRACED entity that also happens to carry ghost tags: the
        // linework guard sits BEFORE every kill rule in eraseStations,
        // so the new RawShot/RawStation rules must not reach it either.
        CsLayers.ensure(doc, di, "WALLS-SURVEYED");
        var decoyData = new RPolylineData();
        decoyData.appendVertex(new RVector(50, 50));
        decoyData.appendVertex(new RVector(51, 51));
        var decoyPl = new RPolylineEntity(doc, decoyData);
        decoyPl.setLayerId(doc.getLayerId("WALLS-SURVEYED"));
        CsTags.set(decoyPl, CsBind.STATIONS_TAG,
            CsBind.encodeStations(["G1", "G2"]));
        CsTags.set(decoyPl, "RawShot", "G1->G2");
        CsTags.set(decoyPl, "RawStation", "G1");
        var decoyOp = new RAddObjectsOperation();
        decoyOp.addObject(decoyPl, false);
        di.applyOperation(decoyOp);
        var decoyId = decoyPl.getId();

        // a redraw must REPLACE the ghost, never accumulate or orphan it
        CsDraw.eraseStations(doc, ["G1", "G2", "G3", "G4"]);
        var leftLines = 0, leftPoints = 0, leftOnRaw = 0, decoySurvived = 0;
        gids = doc.queryAllEntities(false, false);
        for (gi = 0; gi < gids.length; gi++) {
            ge = doc.queryEntity(gids[gi]);
            if (isNull(ge)) { continue; }
            if (ge.getId() === decoyId) {
                decoySurvived++;
                continue;
            }
            if (doc.getLayerName(ge.getLayerId()) === "CTRL-RAW") {
                leftOnRaw++;
            }
            if (CsTags.get(ge, "RawShot") !== "") { leftLines++; }
            if (CsTags.get(ge, "RawStation") !== "") { leftPoints++; }
        }
        ok(leftLines === 0 && leftPoints === 0,
            "ghost: eraseStations leaves no ghost orphans (" + leftLines +
            " lines, " + leftPoints + " points)");
        ok(leftOnRaw === 0,
            "ghost: nothing at all is left on CTRL-RAW after the erase, got " +
            leftOnRaw);
        ok(decoySurvived === 1,
            "ghost: TRACED linework carrying ghost tags SURVIVES -- the " +
            "linework guard outranks the new kill rules; got " +
            decoySurvived);

        // THE WHOLE POINT: erase-then-redraw is what every rebuild and
        // every revision does. The ghost must come back once, not twice.
        CsDraw.survey(ghostSurvey, aGhost, "G3", gOrigin, 0);
        var onRawAgain = 0;
        gids = doc.queryAllEntities(false, false);
        for (gi = 0; gi < gids.length; gi++) {
            ge = doc.queryEntity(gids[gi]);
            if (isNull(ge)) { continue; }
            if (doc.getLayerName(ge.getLayerId()) === "CTRL-RAW") {
                onRawAgain++;
            }
        }
        ok(onRawAgain === 8,
            "ghost: a full erase-then-redraw cycle leaves ONE ghost, not " +
            "two -- 4 lines + 4 points, got " + onRawAgain);
    })();

    // -----------------------------------------------------------------
    // Task 5, found while making the ghost erasable: a DELETE is
    // refused on an off layer exactly as an add is. The engine says so
    // out loud --
    //   RTransaction::deleteObject: entity not editable (locked or
    //   hidden layer)
    //   RDocumentInterface::applyOperation: transaction failed
    // -- and drops that object while the rest of the operation lands.
    // So this was already broken for CTRL-HIDDEN before any ghost
    // existed: every redraw orphaned the old hidden legs and drew a
    // second copy beside them. The fix is generic over off layers, so
    // this pins CTRL-HIDDEN, not just CTRL-RAW.
    // -----------------------------------------------------------------
    (function() {
        var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var di = new RDocumentInterface(doc);
        getDocument = function() { return doc; };
        getDocumentInterface = function() { return di; };

        var onLayer = function(layerName) {
            var c = 0;
            var ids = doc.queryAllEntities(false, false);
            for (var i = 0; i < ids.length; i++) {
                var e = doc.queryEntity(ids[i]);
                if (isNull(e)) { continue; }
                if (doc.getLayerName(e.getLayerId()) === layerName) { c++; }
            }
            return c;
        };

        var hsv = CsModel.newSurvey();
        hsv.shots.push(shotOf("H1", "H2", 10, 0));
        var hHidden = shotOf("H2", "H3", 10, 90);
        hHidden.excludeFromPlot = true;
        hsv.shots.push(hHidden);
        var hres = CsNetwork.resolve(hsv, {});
        var hdrawn = CsDraw.survey(hsv, hres);
        ok(hdrawn.hiddenDrawn === 1,
            "off-layer erase: the hidden leg drew, got " + hdrawn.hiddenDrawn);
        ok(onLayer("CTRL-HIDDEN") === 1,
            "off-layer erase: one entity on CTRL-HIDDEN before, got " +
            onLayer("CTRL-HIDDEN"));

        CsDraw.eraseStations(doc, ["H1", "H2", "H3"]);
        ok(onLayer("CTRL-HIDDEN") === 0,
            "off-layer erase: the hidden leg on the OFF layer really was " +
            "deleted -- otherwise a redraw orphans it and draws a second " +
            "copy; got " + onLayer("CTRL-HIDDEN"));
        ok(doc.queryLayer("CTRL-HIDDEN").isOff() === true,
            "off-layer erase: CTRL-HIDDEN is left switched off again");
        ok(CsTags.collectStations(doc).length === 0,
            "off-layer erase: the ordinary marks went too -- switching a " +
            "layer on for the delete did not disturb the rest");
    })();

    // -----------------------------------------------------------------
    // Task 5: no raw, no ghost. The drawn geometry already IS the
    // as-surveyed geometry, and a ghost identical to it is noise.
    // -----------------------------------------------------------------
    (function() {
        var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var di = new RDocumentInterface(doc);
        getDocument = function() { return doc; };
        getDocumentInterface = function() { return di; };

        var onRaw = function() {
            var c = 0;
            var ids = doc.queryAllEntities(false, false);
            for (var i = 0; i < ids.length; i++) {
                var e = doc.queryEntity(ids[i]);
                if (isNull(e)) { continue; }
                if (CsTags.get(e, "RawShot") !== "" ||
                        CsTags.get(e, "RawStation") !== "") { c++; }
                if (doc.hasLayer("CTRL-RAW") &&
                        doc.getLayerName(e.getLayerId()) === "CTRL-RAW") {
                    c++;
                }
            }
            return c;
        };

        var nsv = CsModel.newSurvey();
        nsv.shots.push(shotOf("N1", "N2", 10, 0));
        nsv.shots.push(shotOf("N2", "N3", 10, 90));
        nsv.shots.push(shotOf("N3", "N1", 14.5, 225));
        var nres = CsNetwork.resolve(nsv, {});

        // a plain resolve result has no `raw` property at all
        var dn1 = CsDraw.survey(nsv, nres);
        ok(dn1.ghostDrawn === 0,
            "no ghost: a plain resolve result draws no ghost, got " +
            dn1.ghostDrawn);
        ok(onRaw() === 0,
            "no ghost: nothing on CTRL-RAW from a plain resolve, got " +
            onRaw());

        // ... and the pass-through shape sets raw to null on purpose
        CsDraw.eraseStations(doc, ["N1", "N2", "N3"]);
        var dn2 = CsDraw.survey(nsv, CsAdjust.unadjusted(nres));
        ok(dn2.ghostDrawn === 0,
            "no ghost: CsAdjust.unadjusted has raw === null, so no ghost, " +
            "got " + dn2.ghostDrawn);
        ok(onRaw() === 0,
            "no ghost: nothing on CTRL-RAW from an unadjusted result, got " +
            onRaw());
    })();

    // -----------------------------------------------------------------
    // Task 6: hand-traced linework must never bind to an as-surveyed
    // ghost point (CTRL-RAW, RawStation/RawShot -- Task 5). Probed
    // empirically before writing anything: by construction, a ghost
    // carries neither Station, LRUDName nor SplayName -- the only keys
    // stationIndex reads -- so CASES 1 and 3 below already held. The
    // one case that did NOT hold is the decoy: stationIndex had no
    // layer check at all, so an entity sitting on CTRL-RAW that
    // happened to carry a real Station tag (as if some future edit
    // tagged one carelessly) WAS indexed. That is what the guard in
    // CsBind.stationIndex below exists for -- defence against a future
    // mistake, not a fix for a live bug in the ghost itself.
    // -----------------------------------------------------------------
    (function() {
        var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var di = new RDocumentInterface(doc);
        getDocument = function() { return doc; };
        getDocumentInterface = function() { return di; };

        // a real, misclosing loop so the adjustment actually moves
        // stations and CsDraw.survey really draws a ghost
        var psv = CsModel.newSurvey();
        psv.shots.push(shotOf("P1", "P2", 10, 0));
        psv.shots.push(shotOf("P2", "P3", 10, 90));
        psv.shots.push(shotOf("P3", "P4", 10, 180));
        psv.shots.push(shotOf("P4", "P1", 10.7, 270));
        var pres = CsNetwork.resolve(psv, {});
        var padj = CsAdjust.adjust(psv, pres, { sigmaTape: 1, sigmaAngle: 0 });
        ok(padj.adjusted === true && padj.raw !== null,
            "ghost-bind: fixture really adjusted, so a ghost really draws");
        var pdrawn = CsDraw.survey(psv, padj, "P1", new RVector(500, 900), 0);
        ok(pdrawn.ghostDrawn === 4,
            "ghost-bind: the ghost drew, got " + pdrawn.ghostDrawn);

        var ghostPosOf = {}, realPosOf = {};
        var pids = doc.queryAllEntities(false, false);
        for (var pi = 0; pi < pids.length; pi++) {
            var pe = doc.queryEntity(pids[pi]);
            if (isNull(pe)) { continue; }
            var rst = CsTags.get(pe, "RawStation");
            if (rst !== "") { ghostPosOf[rst] = pe.getPosition(); }
            var st = CsTags.get(pe, "Station");
            if (st !== "") { realPosOf[st] = pe.getPosition(); }
        }
        var sep = Math.sqrt(
            Math.pow(ghostPosOf["P3"].x - realPosOf["P3"].x, 2) +
            Math.pow(ghostPosOf["P3"].y - realPosOf["P3"].y, 2));
        ok(sep > 0.01,
            "ghost-bind: sanity -- ghost P3 and real P3 really sit apart " +
            "(" + sep + "), so the checks below are not vacuous");

        // ---- CASE 1: no stationIndex entry resolves to an entity
        // actually sitting on CTRL-RAW ----
        var pidx = CsBind.stationIndex(doc);
        var rawIndexable = 0;
        for (var qi = 0; qi < pids.length; qi++) {
            var qe = doc.queryEntity(pids[qi]);
            if (isNull(qe)) { continue; }
            if (doc.getLayerName(qe.getLayerId()) !== "CTRL-RAW") { continue; }
            if (CsTags.get(qe, "Station") !== "" ||
                    CsTags.get(qe, "LRUDName") !== "" ||
                    CsTags.get(qe, "SplayName") !== "") {
                rawIndexable++;
            }
        }
        ok(rawIndexable === 0,
            "ghost-bind: no entity actually on CTRL-RAW carries a tag " +
            "stationIndex reads (Station/LRUDName/SplayName), got " +
            rawIndexable);
        ok(pidx.length === 4,
            "ghost-bind: stationIndex holds exactly the four real " +
            "stations, no ghost duplicates, got " + pidx.length);
        for (var xi = 0; xi < pidx.length; xi++) {
            var entry = pidx[xi];
            // P1 is the default pin (CsAdjust.adjust anchors the
            // lexicographically lowest name when nothing else is
            // pinned) -- a pinned station has zero adjustment
            // residual, so its ghost coincides with its real position
            // EXACTLY, by definition, no matter which entity it came
            // from. That coincidence is expected and is not this
            // test's concern; skip it here.
            if (entry.name === "P1") { continue; }
            var ghost = ghostPosOf[entry.name];
            if (ghost !== undefined) {
                var d = Math.sqrt(Math.pow(entry.x - ghost.x, 2) +
                    Math.pow(entry.y - ghost.y, 2));
                ok(d > 0.01,
                    "ghost-bind: stationIndex entry for " + entry.name +
                    " is the REAL position, not the ghost's (it is " +
                    d + " away from the ghost)");
            }
        }

        // ---- CASE 3: a wall traced exactly onto a ghost tip's
        // coordinates must not SNAP-bind to it ----
        CsLayers.ensure(doc, di, "WALLS-SURVEYED");
        var gp3 = ghostPosOf["P3"];
        var wpd = new RPolylineData();
        wpd.appendVertex(new RVector(gp3.x, gp3.y));
        wpd.appendVertex(new RVector(gp3.x + 1, gp3.y + 1));
        var wallPl = new RPolylineEntity(doc, wpd);
        wallPl.setLayerId(doc.getLayerId("WALLS-SURVEYED"));
        var wop = new RAddObjectsOperation();
        wop.addObject(wallPl, false);
        di.applyOperation(wop);

        var peps = CsBind.epsilonFor(doc);
        var pbind = CsBind.bindEntity(doc, wallPl, 0, pidx, peps);
        ok(pbind.source !== "snap",
            "ghost-bind: a wall traced onto the ghost tip's exact " +
            "coordinates does not SNAP-bind (no index entry sits there " +
            "to snap to), got source=" + pbind.source);

        // ---- CASE 4 (the decoy): an entity on CTRL-RAW that DOES
        // carry a real Station tag, as if some future edit tagged one
        // carelessly. stationIndex's own layer gate must catch this. ----
        CsLayers.withLayerOn(doc, di, "CTRL-RAW", function() {
            var decoyOp = new RAddObjectsOperation();
            var decoyPt = new RPointEntity(doc,
                new RPointData(new RVector(gp3.x + 5, gp3.y + 5)));
            decoyPt.setLayerId(doc.getLayerId("CTRL-RAW"));
            CsTags.set(decoyPt, "Station", "DECOY1");
            decoyOp.addObject(decoyPt, false);
            di.applyOperation(decoyOp);
        });
        var idxAfterDecoy = CsBind.stationIndex(doc);
        var decoyIndexed = false;
        for (var yi = 0; yi < idxAfterDecoy.length; yi++) {
            if (idxAfterDecoy[yi].name === "DECOY1") { decoyIndexed = true; }
        }
        ok(decoyIndexed === false,
            "ghost-bind: a decoy Station tag on CTRL-RAW is NOT indexed " +
            "-- stationIndex's layer gate catches it even though the " +
            "entity carries the real key stationIndex reads");
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
        // CRITICAL 2's fix, negative half: the rigid path never calls
        // CsDraw.survey at all (the whole-drawing transform moves
        // everything, profile included, without a redraw) -- report.
        // profile must stay absent here, not merely false or null, or a
        // rigid move would print a bogus "Profile: not written" line for
        // a profile pass that was never even attempted.
        ok(report.profile === undefined,
            "apply-rigid: report.profile is absent on the rigid path " +
            "(no CsDraw.survey call to report on), got " +
            JSON.stringify(report.profile));
        ok(summary.indexOf("Profile:") < 0,
            "apply-rigid: no profile line at all in a rigid move's " +
            "summary, got:\n" + summary);

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

        // The profile pass is forced to SKIP here, and the skip is
        // the thing under test: CsReport only speaks up when the pass
        // did NOT happen (a successful one is reported by
        // CsReport.profileSummary, in the tool that asked for it). The
        // fixture's drawing having no file name used to do this for
        // free; the elevation is a region of the drawing now, so an
        // unsaved drawing draws it happily and the switch is what is
        // left to turn off.
        var hadAutoAR = RSettings.getBoolValue("CaveSurvey/ProfileAuto", true);
        RSettings.setValue("CaveSurvey/ProfileAuto", false);
        var report;
        try {
            report = CsRevise.apply(doc, di, recon, newSurvey);
        } finally {
            RSettings.setValue("CaveSurvey/ProfileAuto", hadAutoAR);
        }
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

        // CRITICAL 2 -- "Revise a trip" is the flagship workflow this
        // whole feature was built for, and CsRevise.apply's non-rigid
        // path used to DISCARD CsDraw.survey's return value outright, so
        // report.profile did not exist at all and this revision's own
        // profile pass was completely silent. The fixture's drawing has
        // no file name, which USED to make the pass skip for want of a
        // sibling to write; the elevation lives in this drawing now, so
        // the pass genuinely runs and it is the DRAWN outcome that has
        // to reach the report.
        ok(report.profile !== undefined && report.profile !== null,
            "apply-redraw: CRITICAL 2 -- report.profile is present on " +
            "the non-rigid path, not discarded");
        if (report.profile !== undefined && report.profile !== null) {
            ok(report.profile.skipped === true,
                "apply-redraw: sanity -- ProfileAuto is off for this " +
                "fixture, so the profile pass really is skipped");
        }
        ok(summary.indexOf(
            "Profile: not written -- CaveSurvey/ProfileAuto is off")
            >= 0,
            "apply-redraw: CRITICAL 2 -- the skipped profile pass " +
            "reaches CsReport.revisionSummary's own text, got:\n" +
            summary);
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
        // A splay recovered from its tip alone: bearing and plan length
        // on record, inclination NOT. Reachable since
        // CsTags.collectSplays learned to rebuild splays from a
        // drawing's own geometry. `null * Math.PI / 180` is 0 and
        // `Math.cos(0)` is 1, so without a guard this shot's distance
        // is divided by one and then REPORTED AS RESCALED -- a
        // plan-to-slope conversion claimed on the one shot where the
        // conversion is impossible.
        var vNoInc = splayOf("V2", 7, 45);
        vNoInc.inclination = null;
        vsv.shots.push(vLevel);
        vsv.shots.push(vSteep);
        vsv.shots.push(vVert);
        vsv.shots.push(vNoInc);
        var conv = RebuildSurveyData.toSlopeDistances(vsv);
        ok(conv.scaled === 1, "rsd-slope: one shot rescaled, got " +
            conv.scaled);
        ok(conv.vertical === 1, "rsd-slope: one vertical shot skipped, " +
            "got " + conv.vertical);
        near(vNoInc.distance, 7, 1e-12,
            "rsd-slope: a shot with NO inclination on record keeps its " +
            "distance exactly -- there is no cos to divide by");
        near(vLevel.distance, 5, 1e-12,
            "rsd-slope: a level shot's plan length IS its slope length");
        near(vSteep.distance, 5 / Math.cos(60 * Math.PI / 180), 1e-9,
            "rsd-slope: inclined shot scaled by 1/cos(inclination)");
        near(vVert.distance, 1e-7, 1e-15,
            "rsd-slope: a vertical shot has no plan length to scale -- " +
            "distance left exactly as drawn");

        // Task 5: control ties got their own counter, so the total the
        // rebuild reports has to count them. Missing tiesDrawn here
        // would under-report the shots a two-entrance cave carries.
        ok(RebuildSurveyData.shotCount({ shotsDrawn: 2, closuresDrawn: 1,
            tiesDrawn: 3, hiddenDrawn: 4, splaysDrawn: 5,
            ghostDrawn: 99 }) === 15,
            "rsd-count: ties count toward the drawn shot total and ghosts " +
            "do not, got " + RebuildSurveyData.shotCount({ shotsDrawn: 2,
                closuresDrawn: 1, tiesDrawn: 3, hiddenDrawn: 4,
                splaysDrawn: 5, ghostDrawn: 99 }));
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
        // A pre-v3 SPLAY: a tip point carrying nothing but its name,
        // which is all an old build wrote. CsTags.collectSplays now
        // recovers it from its position -- bearing and plan length, but
        // no inclination, so the redraw cannot put it back and the run
        // has to SAY so instead of losing it silently (which is what
        // happened before the reader could see splays at all).
        var qs = CsDraw.addPoint(doc, op, CsLayers.SPLAYS,
            new RVector(3, 14));
        CsTags.set(qs, "SplayName", "Q2.1");
        op.addObject(qs, false);
        di.applyOperation(op);

        var before = CsRevise.surveyFromDocument(doc);
        ok(before.legacy === true,
            "rsd-upgrade: fixture starts as a legacy drawing");
        var posBefore = rsdPositions(doc);

        // ProfileAuto OFF for this fixture: the assertion below is
        // about the SKIP reaching the report, and CsReport is silent on
        // a successful pass by design. The drawing having no file name
        // used to force that skip; the elevation is a region of the
        // drawing now, so the switch is what does it.
        var hadAutoRSD = RSettings.getBoolValue("CaveSurvey/ProfileAuto", true);
        RSettings.setValue("CaveSurvey/ProfileAuto", false);
        var rep;
        try {
            rep = RebuildSurveyData.rebuild(doc, di);
        } finally {
            RSettings.setValue("CaveSurvey/ProfileAuto", hadAutoRSD);
        }
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
        ok(rep.scaled === 1,
            "rsd-upgrade: exactly ONE shot was rescaled -- the recovered " +
            "splay has no inclination to convert against and must not " +
            "be counted as converted, got " + rep.scaled);
        ok(rep.splaysUnplaceable === 1,
            "rsd-upgrade: the one splay the redraw could not put back is " +
            "reported, not lost in silence, got " + rep.splaysUnplaceable);
        ok(rep.message.indexOf(
            "1 splay had no inclination on record and could not be " +
            "redrawn.") >= 0,
            "rsd-upgrade: and the loss is named in the user's own " +
            "message, got '" + rep.message + "'");
        ok(rep.message.indexOf(
            "inferred from geometry (slope = plan/cos(inclination))")
            >= 0, "rsd-upgrade: report says distances were inferred, got '" +
            rep.message + "'");
        // CRITICAL 2: RebuildSurveyData.redraw's own CsDraw.survey call
        // runs a profile pass too -- before this fix the return value's
        // own .profile field was read only for shotCount(), so whatever
        // that pass did was completely silent. Same words as
        // CsReport.drawSummary's own line, so the two never read as two
        // different facts.
        ok(rep.message.indexOf(
            "Profile: not written -- CaveSurvey/ProfileAuto is off")
            >= 0,
            "rsd-upgrade: CRITICAL 2 -- the skipped profile pass reaches " +
            "the report, got '" + rep.message + "'");

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

        // ProfileAuto OFF for this fixture: the assertion below is
        // about the SKIP reaching the report, and CsReport is silent on
        // a successful pass by design. The drawing having no file name
        // used to force that skip; the elevation is a region of the
        // drawing now, so the switch is what does it.
        var hadAutoRSD1 = RSettings.getBoolValue("CaveSurvey/ProfileAuto", true);
        RSettings.setValue("CaveSurvey/ProfileAuto", false);
        var rep1;
        try {
            rep1 = RebuildSurveyData.rebuild(doc, di);
        } finally {
            RSettings.setValue("CaveSurvey/ProfileAuto", hadAutoRSD1);
        }
        var count1 = countAt();
        var pos1 = rsdPositions(doc);
        ok(rep1.mode === "heal", "rsd-idem: run 1 mode 'heal', got '" +
            rep1.mode + "'");
        ok(rep1.inferred === false,
            "rsd-idem: run 1 infers nothing -- the tags are the survey");
        // CRITICAL 2, the "heal" mode's own copy of the same fix (see
        // the identical assertion in the "upgrade" fixture above): the
        // profile pass runs here too, and its outcome must reach
        // rep1.message.
        ok(rep1.message.indexOf(
            "Profile: not written -- CaveSurvey/ProfileAuto is off")
            >= 0,
            "rsd-idem: CRITICAL 2 -- the heal path's skipped profile " +
            "pass reaches the report too, got '" + rep1.message + "'");

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

    // -----------------------------------------------------------------
    // Task 7: the drawing records what it was adjusted with.
    //
    // Without this record a redraw re-solves under whatever the global
    // setting happens to be that day, so opening a drawing with the
    // switch flipped silently moves every station. The record rides on
    // the trip-0 anchor beside StartNote/StartLrud, and
    // CsRevise.surveyFromDocument hands it back so a revision uses the
    // DRAWING's options rather than today's.
    // -----------------------------------------------------------------
    (function() {
        var mk = function(adjOpts) {
            var doc = new RDocument(new RMemoryStorage(),
                new RSpatialIndexNavel());
            var di = new RDocumentInterface(doc);
            getDocument = function() { return doc; };
            getDocumentInterface = function() { return di; };
            var S = CsModel.newSurvey();
            S.shots.push(shotOf("T1", "T2", 10, 0));
            S.shots.push(shotOf("T2", "T3", 8, 90));
            S.shots.push(shotOf("T3", "T1", 11.5, 225));
            CsDraw.survey(S, CsAdjust.resolveAndAdjust(S, {}, adjOpts));
            return doc;
        };

        var onDoc = mk({ enabled: true, sigmaTape: 0.25, sigmaAngle: 2 });
        var onAnchor = CsRevise.trip0Anchor(onDoc);
        ok(onAnchor !== null, "adjust-record: the trip-0 anchor is there");
        ok(CsTags.get(onAnchor, "Adjustment") === "lsq",
            "adjust-record: an adjusted drawing records Adjustment=lsq, " +
            "got '" + CsTags.get(onAnchor, "Adjustment") + "'");
        near(CsTags.getNumber(onAnchor, "SigmaTape"), 0.25, 1e-12,
            "adjust-record: the sigmas in force are recorded (tape)");
        near(CsTags.getNumber(onAnchor, "SigmaAngle"), 2, 1e-12,
            "adjust-record: the sigmas in force are recorded (angle)");

        var onRecon = CsRevise.surveyFromDocument(onDoc);
        ok(onRecon.adjustTags !== undefined && onRecon.adjustTags !== null,
            "adjust-record: surveyFromDocument returns adjustTags");
        var onOpts = CsAdjust.optionsFromTags(onRecon.adjustTags || {});
        ok(onOpts.enabled === true,
            "adjust-record: the record round-trips through " +
            "optionsFromTags as enabled");
        near(onOpts.sigmaTape, 0.25, 1e-12,
            "adjust-record: ...with the recorded sigmaTape, not today's " +
            "setting");
        near(onOpts.sigmaAngle, 2, 1e-12,
            "adjust-record: ...and the recorded sigmaAngle");

        // adjustment OFF is a record too: a drawing drawn as-surveyed
        // must redraw as-surveyed even if the setting is on tomorrow
        var offDoc = mk({ enabled: false, sigmaTape: 0.25, sigmaAngle: 2 });
        var offAnchor = CsRevise.trip0Anchor(offDoc);
        ok(CsTags.get(offAnchor, "Adjustment") === "none",
            "adjust-record: an unadjusted drawing records Adjustment=none, " +
            "got '" + CsTags.get(offAnchor, "Adjustment") + "'");
        var offOpts = CsAdjust.optionsFromTags(
            CsRevise.surveyFromDocument(offDoc).adjustTags || {});
        ok(offOpts.enabled === false,
            "adjust-record: 'none' round-trips as disabled, so a redraw " +
            "reproduces the as-surveyed geometry");

        // The other way in: a tool holding only the document, not a
        // reconstruction (Survey Stats). Same three tag names, one
        // reader, so the two paths cannot drift apart.
        var viaDoc = CsAdjust.optionsFromTags(
            CsRevise.adjustTagsOn(CsRevise.trip0Anchor(onDoc)));
        ok(viaDoc.enabled === true,
            "adjust-record: reading via trip0Anchor agrees about enabled");
        near(viaDoc.sigmaTape, 0.25, 1e-12,
            "adjust-record: ...and about the recorded sigmaTape");
        // and a drawing with no anchor at all must not throw: "" in
        // every field is what optionsFromTags calls "not recorded"
        var noneTags = CsRevise.adjustTagsOn(null);
        ok(noneTags.Adjustment === "" && noneTags.SigmaTape === "" &&
            noneTags.SigmaAngle === "",
            "adjust-record: no anchor reads back as no record, not a throw");
        ok(CsAdjust.optionsFromTags(noneTags).enabled ===
            CsAdjust.currentOptions().enabled,
            "adjust-record: an unrecorded drawing falls back to the " +
            "current settings");
    })();

    // -----------------------------------------------------------------
    // Task 7: Rebuild Survey Data REPAIRS a drawing -- it must not
    // re-solve it. It erases every station's marks and redraws them, so
    // solving under today's global setting instead of the drawing's own
    // record would move the whole cave in answer to a request to fix
    // its tags. This is the "heal" path, which the tool itself
    // advertises as "nothing inferred".
    // -----------------------------------------------------------------
    (function() {
        loadRepoScript(
            "scripts/CaveSurvey/RebuildSurveyData/RebuildSurveyData.js");
        var doc = new RDocument(new RMemoryStorage(),
            new RSpatialIndexNavel());
        var di = new RDocumentInterface(doc);
        getDocument = function() { return doc; };
        getDocumentInterface = function() { return di; };

        var S = CsModel.newSurvey();
        S.shots.push(shotOf("H1", "H2", 10, 0, 10));
        S.shots.push(shotOf("H2", "H3", 8, 90));
        S.shots.push(shotOf("H3", "H1", 11.5, 225));
        CsModel.ensureTrips(S);
        var drawnRes = CsAdjust.resolveAndAdjust(S, {},
            { enabled: true, sigmaTape: 1, sigmaAngle: 0 });
        CsDraw.survey(S, drawnRes);
        var posBefore = CsRevise.stationPositions(doc);
        // how far a re-solve WITHOUT the record would snap the drawing
        var rawGap = 0;
        for (var rn in posBefore) {
            if (!posBefore.hasOwnProperty(rn) ||
                    drawnRes.raw.stations[rn] === undefined) {
                continue;
            }
            var rdx = posBefore[rn].x - drawnRes.raw.stations[rn].x;
            var rdy = posBefore[rn].y - drawnRes.raw.stations[rn].y;
            var rd = Math.sqrt(rdx * rdx + rdy * rdy);
            if (rd > rawGap) {
                rawGap = rd;
            }
        }
        ok(rawGap > 0.1,
            "rebuild-heal: the drawing really sits on adjusted, not " +
            "as-surveyed, coordinates -- gap " + rawGap);

        var rep = RebuildSurveyData.rebuild(doc, di);
        ok(rep.mode === "heal",
            "rebuild-heal: took the heal path, got '" + rep.mode + "'");
        var posAfter = CsRevise.stationPositions(doc);
        var worst = 0;
        for (var hn in posBefore) {
            if (!posBefore.hasOwnProperty(hn) ||
                    posAfter[hn] === undefined) {
                continue;
            }
            var hdx = posAfter[hn].x - posBefore[hn].x;
            var hdy = posAfter[hn].y - posBefore[hn].y;
            var hd = Math.sqrt(hdx * hdx + hdy * hdy);
            if (hd > worst) {
                worst = hd;
            }
        }
        near(worst, 0, 1e-9,
            "rebuild-heal: a repair moved no station -- worst " + worst +
            " (a re-solve without the drawing's record would have moved " +
            "one by " + rawGap + ")");
    })();

    // -----------------------------------------------------------------
    // Task 7: CsRevise.apply must resolve BOTH sides the way the
    // drawing was drawn.
    //
    // The rigid path rewrites each station's Elevation tag from its own
    // resolve. Resolve unadjusted while the drawing was drawn adjusted
    // and a pure declination revision -- which cannot change any
    // elevation at all -- silently snaps every elevation back to the
    // as-surveyed value. That is the geometry moving under the
    // surveyor without a word, through the vertical axis instead of
    // the horizontal one.
    // -----------------------------------------------------------------
    (function() {
        var doc = new RDocument(new RMemoryStorage(),
            new RSpatialIndexNavel());
        var di = new RDocumentInterface(doc);
        getDocument = function() { return doc; };
        getDocumentInterface = function() { return di; };

        var S = CsModel.newSurvey();
        S.declination = 0.0;
        S.declinationSource = "user";
        // a loop with a real VERTICAL misclosure: the +10 rise never
        // comes back down, so the adjustment has 1.7 ft of z to spread
        S.shots.push(shotOf("Z1", "Z2", 10, 0, 10));
        S.shots.push(shotOf("Z2", "Z3", 8, 90));
        S.shots.push(shotOf("Z3", "Z1", 11.5, 225));
        CsModel.ensureTrips(S);

        var adjOpts = { enabled: true, sigmaTape: 1, sigmaAngle: 0 };
        var drawnRes = CsAdjust.resolveAndAdjust(S, {}, adjOpts);
        ok(Math.abs(drawnRes.stations["Z3"].z -
                drawnRes.raw.stations["Z3"].z) > 0.1,
            "apply-adjusted: the fixture's adjusted z really differs from " +
            "the as-surveyed z (adjusted " + drawnRes.stations["Z3"].z +
            " vs raw " + drawnRes.raw.stations["Z3"].z + ")");
        CsDraw.survey(S, drawnRes);

        var elevOf = function(name) {
            var ids = doc.queryAllEntities(false, false);
            for (var i = 0; i < ids.length; i++) {
                var e = doc.queryEntity(ids[i]);
                if (!isNull(e) && CsTags.get(e, "Station") === name) {
                    return CsTags.getNumber(e, "Elevation");
                }
            }
            return null;
        };
        near(elevOf("Z3"), drawnRes.stations["Z3"].z, 1e-9,
            "apply-adjusted: the drawing starts on the adjusted datum");

        var recon = CsRevise.surveyFromDocument(doc);
        var newSurvey = CsRevise.surveyFromDocument(doc).survey;
        CsRevise.reviseDeclination(newSurvey, 0, 3.0, "igrf");
        var report = CsRevise.apply(doc, di, recon, newSurvey);

        ok(report.rigid === true,
            "apply-adjusted: a declination revision still classifies as " +
            "RIGID with both sides adjusted");
        near(elevOf("Z3"), drawnRes.stations["Z3"].z, 1e-6,
            "apply-adjusted: a plan rotation leaves the elevations where " +
            "the drawing had them, got " + elevOf("Z3") + " for an " +
            "adjusted " + drawnRes.stations["Z3"].z + " (as-surveyed " +
            drawnRes.raw.stations["Z3"].z + ")");
        // the honesty rule, through the revision report: loop closures
        // are the AS-SURVEYED ones, never recomputed from adjusted
        // coordinates
        ok(report.loopsBefore.length === 1 && report.loopsAfter.length === 1,
            "apply-adjusted: one loop reported either side");
        if (report.loopsBefore.length === 1) {
            var rawLoop = CsNetwork.resolve(recon.survey, {});
            near(report.loopsBefore[0].error, rawLoop.loops[0].error, 1e-9,
                "apply-adjusted: the reported closure is the as-surveyed " +
                "one, not ~0 from the adjusted coordinates");
        }

        // The two calls themselves: IDENTICAL options, and the
        // georeferenced station pinned. Watched rather than inferred,
        // because "both sides the same" is the whole correctness
        // argument and nothing downstream reports which options ran.
        // The geo tags go on Z2, deliberately NOT the anchor.
        var gop = new RModifyObjectsOperation();
        var gids = doc.queryAllEntities(false, false);
        for (var gi = 0; gi < gids.length; gi++) {
            var ge = doc.queryEntity(gids[gi]);
            if (!isNull(ge) && CsTags.get(ge, "Station") === "Z2") {
                CsTags.set(ge, "GeoStation", "Z2");
                CsTags.set(ge, "GeoLat", "40.5");
                CsTags.set(ge, "GeoLon", "-90.2");
                gop.addObject(ge, false);
            }
        }
        di.applyOperation(gop);

        var seenOpts = [];
        var realRA = CsAdjust.resolveAndAdjust;
        CsAdjust.resolveAndAdjust = function(sv, rOpts, aOpts) {
            seenOpts.push(JSON.stringify(aOpts));
            return realRA.call(CsAdjust, sv, rOpts, aOpts);
        };
        var recon2 = CsRevise.surveyFromDocument(doc);
        var new2 = CsRevise.surveyFromDocument(doc).survey;
        CsRevise.reviseDeclination(new2, 0, 5.0, "user");
        try {
            CsRevise.apply(doc, di, recon2, new2);
        } finally {
            CsAdjust.resolveAndAdjust = realRA;
        }
        ok(seenOpts.length === 2,
            "apply-adjusted: apply resolves exactly twice through " +
            "resolveAndAdjust, got " + seenOpts.length);
        ok(seenOpts.length === 2 && seenOpts[0] === seenOpts[1],
            "apply-adjusted: BOTH sides get the SAME adjust options -- " +
            seenOpts.join("  |  "));
        ok(seenOpts.length > 0 && seenOpts[0].indexOf("\"Z2\"") >= 0,
            "apply-adjusted: the georeferenced station is pinned, got " +
            seenOpts[0]);
        ok(seenOpts.length > 0 && seenOpts[0].indexOf("\"lsq\"") === -1 &&
            JSON.parse(seenOpts[0]).enabled === true,
            "apply-adjusted: the options are the DRAWING's record read " +
            "back as options, not raw tags, got " + seenOpts[0]);
    })();

    // -----------------------------------------------------------------
    // Task 7: no call site may pass a PLACEHOLDER anchor z.
    //
    // Driving the real Survey Notebook Draw path (drawSurveyInner) with
    // a selected scratch point and a page whose first station carries a
    // *fix at an absolute datum. The picked point has no Elevation tag,
    // so the old code handed CsNetwork an EXPLICIT anchor z of 0 -- and
    // an explicit z always beats control, so the cave was rebased from
    // 1250 ft onto the drawing's origin. Same shape of bug as the
    // CsRevise.anchorZOf lesson, through a different door.
    //
    // Only sheetSurvey (the dock's cells) is stubbed; the selection,
    // the pick, the elevation lookup, the resolve and the draw are all
    // the real thing.
    // -----------------------------------------------------------------
    (function() {
        var doc = new RDocument(new RMemoryStorage(),
            new RSpatialIndexNavel());
        var di = new RDocumentInterface(doc);
        getDocument = function() { return doc; };
        getDocumentInterface = function() { return di; };

        // a bare scratch point, no tags of any kind, and really selected
        var addOp = new RAddObjectsOperation();
        var pick = new RPointEntity(doc, new RPointData(new RVector(500, 500)));
        addOp.addObject(pick, false);
        di.applyOperation(addOp);
        doc.selectEntity(doc.queryAllEntities(false, false)[0], true);
        ok(doc.hasSelection() && doc.querySelectedEntities().length === 1,
            "anchor-z: one untagged scratch point is selected");
        var pickedSel = CsPick.startPointFromSelection(doc, "anchor-z");
        ok(pickedSel !== undefined && pickedSel.elevation === null,
            "anchor-z: a picked entity with no Elevation tag reports NO " +
            "elevation, not a placeholder 0 -- got " +
            (pickedSel === undefined ? "undefined" : pickedSel.elevation));

        var page = CsModel.newSurvey();
        page.shots.push(shotOf("ENT", "P1", 10, 0));
        page.shots.push(shotOf("P1", "P2", 10, 90));
        // the entrance surveyed to an absolute datum, as a *fix / #Fix
        page.fixed["ENT"] = { x: 0, y: 0, z: 1250 };
        CsModel.ensureTrips(page);

        var realSheetSurvey = SurveyNotebook.sheetSurvey;
        var realBox = (typeof QMessageBox !== "undefined") ?
            QMessageBox : undefined;
        SurveyNotebook.sheetSurvey = function() { return page; };
        QMessageBox = {
            information: function() {},
            warning: function() {}
        };
        try {
            SurveyNotebook.drawSurveyInner(null);
        } finally {
            SurveyNotebook.sheetSurvey = realSheetSurvey;
            if (realBox !== undefined) {
                QMessageBox = realBox;
            }
        }

        var drawnElev = {};
        var drawnAt = {};
        var pids = doc.queryAllEntities(false, false);
        for (var pi = 0; pi < pids.length; pi++) {
            var pe = doc.queryEntity(pids[pi]);
            if (isNull(pe)) {
                continue;
            }
            var pn = CsTags.get(pe, "Station");
            if (pn !== "") {
                drawnElev[pn] = CsTags.getNumber(pe, "Elevation");
                drawnAt[pn] = pe.getPosition();
            }
        }
        ok(drawnAt["ENT"] !== undefined,
            "anchor-z: the page was drawn (ENT present)");
        if (drawnAt["ENT"] !== undefined) {
            near(drawnAt["ENT"].x, 500, 1e-9,
                "anchor-z: ENT landed on the picked point in PLAN");
            near(drawnAt["ENT"].y, 500, 1e-9,
                "anchor-z: ...both axes");
        }
        near(drawnElev["ENT"], 1250, 1e-9,
            "anchor-z: the cave keeps its absolute datum -- ENT at 1250 " +
            "ft, not rebased onto the picked point's silence, got " +
            drawnElev["ENT"]);
        near(drawnElev["P2"], 1250, 1e-9,
            "anchor-z: ...and so does every station downstream of it, got " +
            drawnElev["P2"]);
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
// CsCave -- the cave folder on the shared drive.
//
// Drive does the syncing; this only knows the folder shape, so that a
// scanned sketch is one click away from the drawing it belongs to.
// Pure half only here -- driveRoots/pointAtScans need QDir and RSettings.
// ---------------------------------------------------------------------

var CSCAVE_DOC = "/u/Library/CloudStorage/GoogleDrive-me/My Drive/" +
    "BIG Survey Group/ALL DAY CAVE/All Day Cave.dxf";
var CSCAVE_ROOTS = ["/u/Library/CloudStorage/GoogleDrive-me"];

ok(CsCave.folderOf(CSCAVE_DOC).indexOf("ALL DAY CAVE") !== -1 &&
   CsCave.folderOf(CSCAVE_DOC).indexOf(".dxf") === -1,
    "the cave folder is the folder the drawing sits in");
ok(CsCave.nameOf(CSCAVE_DOC) === "ALL DAY CAVE",
    "the cave is named the way the surveyor named the folder -- spaces, " +
    "capitals and all, never a slug");
ok(CsCave.scansDir(CSCAVE_DOC).indexOf("/ALL DAY CAVE/scans") !== -1,
    "scans/ sits beside the drawing");
ok(CsCave.folderOf("Untitled.dxf") === null &&
   CsCave.folderOf("") === null && CsCave.folderOf(null) === null,
    "an unsaved drawing has no cave folder");
ok(CsCave.scansDir(null) === null, "and no scans folder either");

ok(CsCave.isUnderDrive(CSCAVE_DOC, CSCAVE_ROOTS) === true,
    "a drawing under the drive is recognised");
ok(CsCave.isUnderDrive("/u/Desktop/scratch.dxf", CSCAVE_ROOTS) === false,
    "one outside it is not -- scans/ is never created beside a stray DXF");
// The prefix trap: a sibling whose name STARTS with the root's name.
ok(CsCave.isUnderDrive("/u/Library/CloudStorage/GoogleDrive-metoo/x.dxf",
        CSCAVE_ROOTS) === false,
    "a second account's folder is not mistaken for the first's");
ok(CsCave.isUnderDrive(CSCAVE_DOC,
        ["/u/Library/CloudStorage/GoogleDrive-me/"]) === true,
    "a trailing slash on the root changes nothing");
ok(CsCave.isUnderDrive(CSCAVE_DOC, []) === false &&
   CsCave.isUnderDrive(CSCAVE_DOC, null) === false,
    "no drive folders means nothing is under one");
ok(CsCave.isUnderDrive(CSCAVE_DOC, ["", "  "]) === false,
    "an empty root never matches everything -- the bug that would put " +
    "scans/ beside every drawing on the machine");

// Engine-only: the two halves that touch QDir and RSettings.
if (!IS_NODE) {
    var cscaveRoots = CsCave.driveRoots();
    ok(Object.prototype.toString.call(cscaveRoots) === "[object Array]",
        "driveRoots answers a list in this engine, even with no Drive");
    ok(CsCave.pointAtScans("/nowhere/outside/any/drive/x.dxf") === null,
        "a drawing outside every drive folder creates nothing");
    ok(CsCave.pointAtScans("") === null && CsCave.pointAtScans(null) === null,
        "and neither does an unsaved one");
}

// ---------------------------------------------------------------------
// CsProfile -- name parsing and run grouping
// ---------------------------------------------------------------------

(function() {
    // splitName's result is two fields at once; eqs on a "base|seq"
    // string names the actual value on failure instead of just the
    // case label, without three separate ok() calls per name.
    function sn(name) {
        var s = CsProfile.splitName(name);
        return (s === null) ? "null" : (s.base + "|" + s.seq);
    }

    eqs(sn("A20"), "A|20", "A20 splits A + 20");
    eqs(sn("A13a1"), "A13a|1", "A13a1 splits A13a + 1");
    eqs(sn("A13a2b1"), "A13a2b|1", "A13a2b1 splits A13a2b + 1");
    eqs(sn("B1"), "B|1", "B1 splits B + 1");

    // one group only: the whole name JOINS that run (it is not a
    // separate run of its own) and carries no sequence
    eqs(sn("A"), "A|", "bare A joins run A, with no sequence");

    // a splay name is not a station name
    eqs(sn("A3.1"), "null", "splay name refused");
    eqs(sn(""), "null", "empty name refused");
    eqs(sn(null), "null", "null name refused");

    eqs(CsProfile.runKeyOf("A13a1"), "A13a", "runKeyOf A13a1");
    eqs(CsProfile.runKeyOf("A20"), "A", "runKeyOf A20");

    eqs(CsProfile.tieNameOfRun("A13a"), "A13", "A13a ties A13");
    eqs(CsProfile.tieNameOfRun("A13a1"), null,
        "fed a station name instead of a run key, it refuses");
    eqs(CsProfile.tieNameOfRun("A13a2b"), "A13a2", "A13a2b ties A13a2");
    eqs(CsProfile.tieNameOfRun("A"), null,
        "letter run has no name-derived tie");
    eqs(CsProfile.tieNameOfRun("B"), null, "B has no name-derived tie");
}());

(function() {
    // A1-A3 with a spur off A2, plus a letter run off A3
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A1", "A2", 10, 0, 0),
        shotOf("A2", "A3", 10, 0, 0),
        shotOf("A2", "A2a1", 5, 90, 0),
        shotOf("A2a1", "A2a2", 5, 90, 0),
        shotOf("A3", "B1", 8, 45, 0),
        shotOf("B1", "B2", 8, 45, 0)
    ];
    var r = CsNetwork.resolve(sv, {});
    var g = CsProfile.groupRuns(r);

    // content-checked, not just length: g.order must match the
    // resolution order the runs were first seen in, A before A2a
    // before B
    eqs(g.order.join(","), "A,A2a,B", "runs found in resolution order");
    eqs(g.runs["A"].stations.join(","), "A1,A2,A3", "run A members ordered");
    eqs(g.runs["A2a"].stations.join(","), "A2a1,A2a2", "spur run members");
    eqs(g.runs["B"].stations.join(","), "B1,B2", "letter run members");

    // numeric ordering, not lexical: A10 must follow A9
    var sv2 = CsModel.newSurvey();
    sv2.shots = [
        shotOf("A9", "A10", 10, 0, 0),
        shotOf("A10", "A11", 10, 0, 0)
    ];
    var g2 = CsProfile.groupRuns(CsNetwork.resolve(sv2, {}));
    eqs(g2.runs["A"].stations.join(","), "A9,A10,A11",
        "numeric sequence ordering, not lexical");
}());

(function() {
    // The run's origin station -- no sequence at all, e.g. an
    // entrance or benchmark named plain "A" beside "A1", "A2", ... --
    // must sort FIRST, not last. Before the fix, seqOrder put an
    // empty sequence AFTER every numeric one, so "A" trailed "A10".
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A", "A1", 10, 0, 0),
        shotOf("A1", "A2", 10, 0, 0),
        shotOf("A2", "A10", 10, 0, 0)
    ];
    var g = CsProfile.groupRuns(CsNetwork.resolve(sv, {}));
    eqs(g.runs["A"].stations.join(","), "A,A1,A2,A10",
        "the run's origin leads, then numeric order");
}());

(function() {
    // A1 and A01 are DISTINCT stations that parse to the same numeric
    // value. seqOrder must never call them equal: CaveCAD's sort is
    // unstable, so an always-0 comparator would place them in whatever
    // order the engine's internal partitioning happens to leave them,
    // which can differ by which one the survey lists first. A real
    // total order does not have that problem -- the result is the same
    // whichever one comes first in the input.
    var svFirst = CsModel.newSurvey();
    svFirst.shots = [
        shotOf("X1", "A1", 10, 0, 0),
        shotOf("X1", "A01", 10, 45, 0)
    ];
    var svSecond = CsModel.newSurvey();
    svSecond.shots = [
        shotOf("X1", "A01", 10, 45, 0),
        shotOf("X1", "A1", 10, 0, 0)
    ];
    var gFirst = CsProfile.groupRuns(CsNetwork.resolve(svFirst, {}));
    var gSecond = CsProfile.groupRuns(CsNetwork.resolve(svSecond, {}));
    eqs(gFirst.runs["A"].stations.join(","),
        gSecond.runs["A"].stations.join(","),
        "A1/A01 order is fixed, independent of which one is listed first");
    ok(gFirst.runs["A"].stations.length === 2, "both A1 and A01 kept, not merged");
}());

(function() {
    // Property enumeration is not guaranteed to match resolution
    // order: "9" is a canonical array index by the language spec, so
    // it enumerates ahead of "A1"/"A2" (ordinary string keys) even
    // though A1 and A2 resolved first -- true under node too, not
    // only under CaveCAD's engine. This is the actual case the
    // names.sort in groupRuns exists for; removing that sort flips
    // this run order to "9,A".
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A1", "A2", 10, 0, 0),
        shotOf("A2", "9", 10, 90, 0)
    ];
    var g = CsProfile.groupRuns(CsNetwork.resolve(sv, {}));
    eqs(g.order.join(","), "A,9",
        "run order follows resolution order, not property enumeration");

    // Hardening on the same claim, from a synthetic resolve: .seq here
    // deliberately DISAGREES with insertion order, so no property
    // enumeration order can imitate the right answer -- the sort has to
    // be doing the work. The fixture above stays because it exercises
    // real resolve() output; this one cannot be satisfied by accident.
    eqs(CsProfile.groupRuns({ stations: { A1: { seq: 5 }, A2: { seq: 6 },
        B1: { seq: 0 } } }).order.join(","), "B,A",
        "run order comes from .seq, not from insertion order");
}());

(function() {
    // A splay-shaped "station" name must be refused into ungrouped,
    // not silently dropped or misgrouped. Not something CsNetwork.resolve
    // would ever actually produce (splays aren't stations), but
    // groupRuns must not assume its input is already clean.
    var sv = CsModel.newSurvey();
    sv.shots = [shotOf("A1", "A2", 10, 0, 0)];
    var r = CsNetwork.resolve(sv, {});
    r.stations["A3.1"] = { x: 0, y: 0, z: 0, seq: 99 };
    var g = CsProfile.groupRuns(r);
    ok(g.ungrouped.indexOf("A3.1") >= 0,
        "a splay-shaped name lands in ungrouped, not in a run");
}());

(function() {
    // Missing input gets the empty shape, not a thrown TypeError, and
    // that empty shape must not be confused with "resolved an empty
    // survey" -- both happen to look the same, which is fine: there is
    // nothing to group either way.
    var g1 = CsProfile.groupRuns(undefined);
    ok(g1.order.length === 0 && g1.ungrouped.length === 0,
        "groupRuns(undefined) returns the empty shape, does not throw");
    var g2 = CsProfile.groupRuns(null);
    ok(g2.order.length === 0, "groupRuns(null) is also empty, not a throw");
    var g3 = CsProfile.groupRuns({});
    ok(g3.order.length === 0, "groupRuns({}) with no .stations is also empty");
}());

(function() {
    // A1-A4; spur A2a1-A2a2 off A2; letter run B off A3; B rejoins A4
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A1", "A2", 10, 0, 0),
        shotOf("A2", "A3", 10, 0, 0),
        shotOf("A3", "A4", 10, 0, 0),
        shotOf("A2", "A2a1", 5, 90, 0),
        shotOf("A2a1", "A2a2", 5, 90, 0),
        shotOf("A3", "B1", 8, 45, 0),
        shotOf("B1", "A4", 8, 315, 0)
    ];
    var r = CsNetwork.resolve(sv, {});
    var h = CsProfile.hierarchy(CsProfile.groupRuns(r), r);

    ok(h.parents["A"] === null, "A is the root run");
    ok(h.parents["A2a"] === "A", "spur A2a hangs off A");
    ok(h.ties["A2a"] === "A2", "spur A2a ties at A2");
    ok(h.parents["B"] === "A", "letter run B hangs off A");
    ok(h.ties["B"] === "A3", "B ties at the earlier of its two A contacts");
    ok(h.secondTies.length === 1 && h.secondTies[0].run === "B" &&
        h.secondTies[0].otherStation === "A4" && h.secondTies[0].otherRun === "A",
        "B's second contact reported -- it arrives through the closure leg");
    // THE ORDINARY CASE, not an adversarial one: an everyday spur that
    // closes a loop back onto its own trunk. Phase 1 (new legs only)
    // already gives B its parent A at A3, so when phase 2 looks at A's
    // OWN view of that same closure (A4-B1) it finds B is already A's
    // descendant and skips the candidate entirely -- no parent, no
    // secondTie, no cycle. This is the regression this whole round of
    // review exists to prevent: an earlier, broader rank-1 rule made
    // EVERY closing loop report a spurious cycle, which is noise on any
    // real cave survey (loops are everywhere). Real caves are full of
    // exactly this shape, so `cycles` staying empty here is the point.
    ok(h.cycles.length === 0, "an ordinary closing loop reports no cycle at all");
    ok(h.parents["A2a"] !== undefined && h.parents["A"] === null,
        "a root run does not adopt its own child as parent");
    ok(h.mismatches.length === 0, "no name/graph mismatch here");
    ok(h.order[0] === "A", "root band first");
    ok(h.order.indexOf("A2a") < h.order.indexOf("B"),
        "siblings ordered by junction distance along the parent");
}());

(function() {
    // the spur's name says A13, its first leg really comes off A14
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A13", "A14", 10, 0, 0),
        shotOf("A14", "A13a1", 5, 90, 0)
    ];
    var r = CsNetwork.resolve(sv, {});
    var h = CsProfile.hierarchy(CsProfile.groupRuns(r), r);

    ok(h.ties["A13a"] === "A14", "graph tie wins over the name");
    ok(h.mismatches.length === 1, "mismatch reported");
    ok(h.mismatches[0].run === "A13a" &&
        h.mismatches[0].expected === "A13" &&
        h.mismatches[0].actual === "A14", "mismatch names both stations");
}());

(function() {
    // adjacency() itself, direct: the walked-chain graph excludes a
    // closure entirely (not just ranks it lower, as hierarchy's own
    // contact graph does) -- A3's closing leg back to A1 must not
    // appear on EITHER station's list.
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A1", "A2", 10, 0, 0),
        shotOf("A2", "A3", 10, 0, 0),
        shotOf("A3", "A1", 10, 90, 0)   // closes the ring -- a "closure" leg
    ];
    var r = CsNetwork.resolve(sv, {});
    ok(r.legs[2].kind === "closure", "fixture assumption: A3->A1 really is a closure");
    var adj = CsProfile.adjacency(r);
    ok(adj["A1"].length === 1 && adj["A1"][0].other === "A2",
        "A1 sees only its new-kind neighbor, not the closure back from A3");
    ok(adj["A3"].length === 1 && adj["A3"][0].other === "A2",
        "A3's closure leg to A1 is excluded from its own list too");
}());

(function() {
    // I6: adjacency's OTHER filter, pinned directly. resolve() never
    // actually emits a splay leg (see the belt-and-braces comment on
    // adjacency itself), so nothing in normal use exercises this --
    // dropping the filter currently survives the whole suite. Fed a
    // hand-built leg marked splay, adjacency() must still exclude it.
    var resolved = {
        legs: [{ shot: { splay: true }, from: "A1", to: "A2", kind: "new" }]
    };
    var adj = CsProfile.adjacency(resolved);
    ok((adj["A1"] || []).length === 0,
        "a splay-flagged leg contributes no adjacency edge, even though its kind is \"new\"");
}());

(function() {
    // C1: two *fixed* entrances on one connected cave, closing a ring.
    // CsNetwork.seedFixed places every fixed station up front, before
    // any traversal, so a fixed station's low .seq records SEEDING,
    // not walking -- raw-seq directionality alone mistakes that for
    // "this run already existed" and corrupts the hierarchy. Ranking
    // by leg kind first (closure/tie legs can't use seq for direction
    // at all) plus cycle-breaking on the earliest actual station fixes
    // it: A (anchored by the earlier-seeded fixed station A1) is root,
    // B ties at A3 (the real tie, not the fixed station B1), and B is
    // no longer falsely reported as an orphan while ALSO being A's
    // parent.
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A1", "A2", 10, 0, 0),
        shotOf("A2", "A3", 10, 0, 0),
        shotOf("B1", "B2", 10, 0, 0),
        shotOf("A3", "B1", 8, 45, 0)
    ];
    sv.fixed["A1"] = { x: 0, y: 0, z: 0 };
    sv.fixed["B1"] = { x: 100, y: 100, z: 0 };
    var r = CsNetwork.resolve(sv, {});
    var h = CsProfile.hierarchy(CsProfile.groupRuns(r), r);

    ok(h.parents["A"] === null, "A (seeded first) is root");
    ok(h.parents["B"] === "A" && h.ties["B"] === "A3",
        "B ties at A3, the real connecting station -- not the fixed B1");
    ok(h.orphans.indexOf("B") < 0, "the false orphan is gone");
}());

(function() {
    // C2: a side passage renumbered back into the trunk (A1..A3, B1-B2,
    // A4-A5) -- each run's OWN contact list independently and correctly
    // picks a "new"-kind edge to the other run, so the per-run ranking
    // alone cannot see the resulting cycle. Only walking the parent
    // chain afterward finds it. Must still produce a proper root, every
    // run exactly once in `order`, and the cycle reported rather than
    // silently resolved.
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A1", "A2", 10, 0, 0),
        shotOf("A2", "A3", 10, 0, 0),
        shotOf("A3", "B1", 10, 0, 0),
        shotOf("B1", "B2", 10, 0, 0),
        shotOf("B2", "A4", 10, 0, 0),
        shotOf("A4", "A5", 10, 0, 0)
    ];
    var r = CsNetwork.resolve(sv, {});
    var g = CsProfile.groupRuns(r);
    var h = CsProfile.hierarchy(g, r);

    ok(h.parents["A"] === null, "A (holding the very first station) becomes root");
    ok(h.cycles.length === 1 &&
        h.cycles[0].indexOf("A") >= 0 && h.cycles[0].indexOf("B") >= 0,
        "the rejoining side passage is reported as a broken cycle");
    ok(h.order.length === g.order.length, "every run appears in the band order");
    var seenRuns = {}, dup = false;
    for (var oi = 0; oi < h.order.length; oi++) {
        if (seenRuns.hasOwnProperty(h.order[oi])) {
            dup = true;
        }
        seenRuns[h.order[oi]] = true;
    }
    ok(!dup, "...and no run appears twice");
}());

(function() {
    // Phase 2's reason to exist: two SEPARATELY anchored components
    // (their own *fix'ed stations) whose only connection is a single
    // leg -- both ends already known when it is walked, so it is "tie"
    // kind, never "new". Neither run gets a phase-1 parent at all. The
    // later component (B, not holding the survey's globally-earliest
    // station) must still end up with a parent -- without phase 2 a
    // tie-only run would be a permanent, unreported orphan.
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A1", "A2", 10, 0, 0),
        shotOf("B1", "B2", 10, 0, 0),
        shotOf("A2", "B1", 8, 0, 0)
    ];
    sv.fixed["A1"] = { x: 0, y: 0, z: 0 };
    sv.fixed["B1"] = { x: 500, y: 500, z: 0 };
    var r = CsNetwork.resolve(sv, {});
    ok(r.legs[2].kind === "tie",
        "fixture assumption: the connecting leg really is a tie, not new");
    var h = CsProfile.hierarchy(CsProfile.groupRuns(r), r);

    ok(h.parents["A"] === null, "A (holding the earlier fixed station) stays root");
    ok(h.parents["B"] === "A" && h.ties["B"] === "A2",
        "B, tie-only, still gets a parent from phase 2 -- not a permanent orphan");
    ok(h.orphans.length === 0, "neither run is a false orphan");
    ok(h.cycles.length === 0,
        "no mutual claim: by the time A's own view of the same tie leg is " +
        "checked, B already has A live as its parent, so A sees B as its " +
        "own descendant and skips it");
}());

(function() {
    // A run whose ONLY contact of any kind is a closure/tie, and whose
    // candidate is NOT a descendant, must still get that parent -- the
    // descendant check is a narrow exception, not a blanket refusal of
    // every closure/tie candidate.
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A1", "A2", 10, 0, 0),
        shotOf("A2", "A3", 10, 0, 0),
        shotOf("C1", "C2", 10, 0, 0),
        shotOf("C2", "A3", 8, 0, 0)
    ];
    sv.fixed["A1"] = { x: 0, y: 0, z: 0 };
    sv.fixed["C1"] = { x: 500, y: 500, z: 0 };
    var r = CsNetwork.resolve(sv, {});
    var h = CsProfile.hierarchy(CsProfile.groupRuns(r), r);

    ok(h.parents["C"] === "A" && h.ties["C"] === "A3",
        "C's only contact is a closure/tie, and A is not C's descendant, " +
        "so C still gets A as its parent");
}());

(function() {
    // I1: the same junction (A3) reached from run B through TWO
    // different closure legs (B1->A3 and B2->A3) must be reported once,
    // not twice -- the dedupe has to track every station already
    // emitted for this run, not just the first one.
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A1", "A2", 10, 0, 0),
        shotOf("A2", "A3", 10, 0, 0),
        shotOf("A1", "B1", 8, 45, 0),
        shotOf("B1", "B2", 5, 0, 0),
        shotOf("B1", "A3", 8, 0, 0),
        shotOf("B2", "A3", 8, 0, 0)
    ];
    var r = CsNetwork.resolve(sv, {});
    var h = CsProfile.hierarchy(CsProfile.groupRuns(r), r);

    var a3ForB = 0;
    for (var sti = 0; sti < h.secondTies.length; sti++) {
        if (h.secondTies[sti].run === "B" && h.secondTies[sti].otherStation === "A3") {
            a3ForB++;
        }
    }
    ok(a3ForB === 1,
        "A3 reached twice through two different closures is one secondTie, not two");
}());

(function() {
    // I2: a run's second contact can land in a THIRD run entirely --
    // B and C both hang off A directly, and also close a ring with
    // EACH OTHER. The secondTie's otherRun names the run actually
    // touched (C, from B's perspective), which is not B's parent (A).
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A1", "A2", 10, 0, 0),
        shotOf("A2", "B1", 10, 0, 0),
        shotOf("B1", "B2", 10, 0, 0),
        shotOf("A2", "C1", 10, 0, 0),
        shotOf("C1", "C2", 10, 0, 0),
        shotOf("C2", "B2", 10, 0, 0)
    ];
    var r = CsNetwork.resolve(sv, {});
    var h = CsProfile.hierarchy(CsProfile.groupRuns(r), r);

    ok(h.parents["B"] === "A" && h.parents["C"] === "A",
        "B and C both hang directly off A");
    var found = false;
    for (var sti = 0; sti < h.secondTies.length; sti++) {
        if (h.secondTies[sti].run === "B" && h.secondTies[sti].otherRun === "C") {
            found = true;
        }
    }
    ok(found, "B's second contact names C (the run actually touched), " +
        "not A (B's own parent) -- otherRun, not parentRun");
}());

(function() {
    // I3: adjacency() and hierarchy() must tolerate the same empty
    // inputs groupRuns() is already hardened for (Task 1), not throw.
    var threw = false;
    try {
        CsProfile.adjacency(null);
        CsProfile.adjacency({});
        CsProfile.adjacency(undefined);
        CsProfile.hierarchy(CsProfile.groupRuns({}), {});
        CsProfile.hierarchy(CsProfile.groupRuns(undefined), undefined);
    } catch (e) {
        threw = true;
    }
    ok(!threw, "adjacency/hierarchy tolerate empty input instead of throwing");
    var h = CsProfile.hierarchy(CsProfile.groupRuns({}), {});
    ok(h.order.length === 0 && h.cycles.length === 0 &&
        h.orphans.length === 0 && h.strandedRoots.length === 0 &&
        h.secondTies.length === 0 && h.mismatches.length === 0,
        "hierarchy(groupRuns({}), {}) is the all-empty shape, not a throw");
}());

(function() {
    // The single most suspicious state hierarchy() can produce: a
    // NAMED spur (its own name asserts a tie station) that the graph
    // ties to NOTHING at all. Q1a1/Q1a2 are surveyed as their own
    // fixed, fully disconnected component -- Q1a's name asserts a tie
    // at "Q1", a station that does not even exist here. The mismatch
    // check must still fire even though the zero-contacts branch never
    // reaches a real tie station.
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A1", "A2", 10, 0, 0),
        shotOf("Q1a1", "Q1a2", 5, 0, 0)
    ];
    sv.fixed["A1"] = { x: 0, y: 0, z: 0 };
    sv.fixed["Q1a1"] = { x: 500, y: 500, z: 0 };
    var r = CsNetwork.resolve(sv, {});
    var h = CsProfile.hierarchy(CsProfile.groupRuns(r), r);

    ok(h.ties["Q1a"] === null, "the graph gives Q1a no tie at all");
    ok(h.mismatches.length === 1 && h.mismatches[0].run === "Q1a" &&
        h.mismatches[0].expected === "Q1" && h.mismatches[0].actual === null,
        "a named spur with zero contacts is still reported as a mismatch");
}());

(function() {
    // I4: siblings whose INSERTION order is the OPPOSITE of their
    // junction order. The A4 spur is surveyed (and so resolved) before
    // the A2 spur, so grouped.order is [A, A4a, A2a] -- but A2a ties in
    // earlier along the trunk (A2 before A4), so the band must still
    // read [A, A2a, A4a]. An always-0 sibling comparator would pass
    // this fixture only by accident under a stable sort and never
    // under CaveCAD's unstable one; here insertion order is wrong on
    // purpose so node's stability cannot save it either.
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A1", "A2", 10, 0, 0),
        shotOf("A2", "A3", 10, 0, 0),
        shotOf("A3", "A4", 10, 0, 0),
        shotOf("A4", "A5", 10, 0, 0),
        shotOf("A4", "A4a1", 5, 0, 0),
        shotOf("A2", "A2a1", 5, 0, 0)
    ];
    var r = CsNetwork.resolve(sv, {});
    var g = CsProfile.groupRuns(r);
    eqs(g.order.join(","), "A,A4a,A2a",
        "fixture assumption: A4a resolves (and so is inserted) before A2a");
    var h = CsProfile.hierarchy(g, r);
    eqs(h.order.join(","), "A,A2a,A4a",
        "the band follows junction distance, not insertion order");
}());

(function() {
    // I4: two spurs off the SAME station (A2), inserted b-then-a. Since
    // both tie at the identical station, seqOfTie ties exactly -- this
    // is the only fixture that exercises the run-key tiebreak itself,
    // not seqOfTie doing the sorting work.
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A1", "A2", 10, 0, 0),
        shotOf("A2", "A3", 10, 0, 0),
        shotOf("A2", "A2b1", 5, 0, 0),
        shotOf("A2", "A2a1", 5, 0, 0)
    ];
    var r = CsNetwork.resolve(sv, {});
    var g = CsProfile.groupRuns(r);
    eqs(g.order.join(","), "A,A2b,A2a",
        "fixture assumption: A2b resolves (and so is inserted) before A2a");
    var h = CsProfile.hierarchy(g, r);
    eqs(h.order.join(","), "A,A2a,A2b",
        "same junction: the run-key tiebreak, not seqOfTie, decides order");
}());

(function() {
    // I4: a genuine orphan -- two disconnected fixed components -- must
    // be reported, and reported alone: the root itself must never
    // appear in orphans just because it also has zero contacts.
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A1", "A2", 10, 0, 0),
        shotOf("C1", "C2", 10, 0, 0)
    ];
    sv.fixed["A1"] = { x: 0, y: 0, z: 0 };
    sv.fixed["C1"] = { x: 500, y: 500, z: 0 };
    var r = CsNetwork.resolve(sv, {});
    var h = CsProfile.hierarchy(CsProfile.groupRuns(r), r);
    eqs(h.orphans.join(","), "C",
        "only the truly disconnected run is an orphan -- not the root too");
    eqs(h.strandedRoots.join(","), "",
        "a genuinely disconnected component is never ALSO reported as " +
        "stranded -- no leg of any kind reaches it, so raw connectivity " +
        "cannot show it as part of the same cave");
}());

(function() {
    // orphans vs strandedRoots -- the split this whole round of review
    // is about. D places A6, a station of the eventual ROOT run's own
    // component, via an ordinary "new" leg -- but that leg is
    // ONE-DIRECTIONAL: only the later-placed side (A, via A6) can ever
    // treat it as an attaching candidate, so D itself never gets any
    // candidacy from it at all. A already has a competing candidate
    // (the B2-A4 rejoin, from the familiar C2 cycle fixture) that wins
    // and is then discarded by cycle-breaking, leaving A root -- and D,
    // despite being raw-connected to A's own station A6, never
    // attached to anything. D is PHYSICALLY part of the same cave (the
    // union-find says so) but algorithmically stranded: the data needs
    // no connecting shot, unlike a true orphan.
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A1", "A2", 10, 0, 0),
        shotOf("A2", "A3", 10, 0, 0),
        shotOf("A3", "B1", 10, 0, 0),
        shotOf("B1", "B2", 10, 0, 0),
        shotOf("B2", "A4", 10, 0, 0),
        shotOf("A4", "A5", 10, 0, 0),
        shotOf("D1", "A6", 8, 0, 0)
    ];
    sv.fixed["A1"] = { x: 0, y: 0, z: 0 };
    sv.fixed["D1"] = { x: 500, y: 500, z: 0 };
    var r = CsNetwork.resolve(sv, {});
    var h = CsProfile.hierarchy(CsProfile.groupRuns(r), r);

    ok(h.parents["A"] === null, "A is the primary root (elected by the cycle break)");
    eqs(h.strandedRoots.join(","), "D",
        "a second root inside one connected component appears in " +
        "strandedRoots, not orphans");
    ok(h.orphans.indexOf("D") < 0, "...and specifically NOT in orphans");
    ok(h.orphans.indexOf("A") < 0 && h.strandedRoots.indexOf("A") < 0,
        "the primary root itself appears in NEITHER field");

    // the invariant the whole split rests on: no run is EVER in both
    var union = h.orphans.concat(h.strandedRoots);
    var seenBoth = {}, overlap = false;
    for (var oi = 0; oi < union.length; oi++) {
        if (seenBoth.hasOwnProperty(union[oi])) {
            overlap = true;
        }
        seenBoth[union[oi]] = true;
    }
    ok(!overlap, "orphans and strandedRoots never share a member");
}());

(function() {
    // M1/I4: CsProfile.bandOrder is public and can be called directly
    // with a hand-built parents map hierarchy() never would produce --
    // an UNBROKEN cycle (hierarchy breaks every cycle it finds before
    // calling this). Without the unreached-fallback loop, a pure cycle
    // has no null-parent root, so `roots` is empty and the walk never
    // runs at all, silently emitting an empty order. Without the `seen`
    // guard, walking into the cycle recurses forever.
    var grouped = {
        runs: {
            A: { key: "A", stations: ["s1"] },
            B: { key: "B", stations: ["s2"] }
        },
        order: ["A", "B"]
    };
    var parents = { A: "B", B: "A" };
    var ties = { A: "s1", B: "s2" };
    var resolved = { stations: { s1: { seq: 0 }, s2: { seq: 1 } } };
    var order = CsProfile.bandOrder(grouped, parents, ties, resolved);
    ok(order.length === 2 && order.indexOf("A") >= 0 && order.indexOf("B") >= 0,
        "an unbroken cycle fed directly to bandOrder still emits every run once");
}());

(function() {
    // I-1: two fixed entrances, fully connected -- grouped.order[0]'s
    // own run ("A", since A1 is seeded before B1) ends up as a CHILD
    // (parent "B"), while "B" is the true root. Position in
    // grouped.order is not rootness: the primary root has to be found
    // by walking the parent chain, not assumed to be index 0.
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("B1", "B2", 10, 0, 0),
        shotOf("B2", "B3", 10, 0, 0),
        shotOf("A4", "B3", 10, 0, 0),
        shotOf("A1", "A2", 10, 0, 0),
        shotOf("A2", "A3", 10, 0, 0),
        shotOf("A3", "A4", 10, 0, 0)
    ];
    sv.fixed["A1"] = { x: 0, y: 0, z: 0 };
    sv.fixed["B1"] = { x: 500, y: 500, z: 0 };
    var r = CsNetwork.resolve(sv, {});
    var g = CsProfile.groupRuns(r);
    eqs(g.order.join(","), "A,B",
        "fixture assumption: A (holding the earlier fixed station) is grouped.order[0]");
    var h = CsProfile.hierarchy(g, r);

    ok(h.parents["A"] === "B" && h.parents["B"] === null,
        "A, though grouped.order[0], ends up B's child -- B is the true root");
    eqs(h.orphans.join(","), "",
        "the true root (B) is never reported as an orphan just because " +
        "it is not grouped.order[0]");
}());

(function() {
    // M-2: same topology (A-B-C, each separately *fixed*, joined only
    // by tie legs A2-B1 and B2-C1) -- ONLY the order the three fixed
    // stations were REGISTERED in differs (that decides which of B1/C1
    // gets the smaller resolution seq, hence which run phase 2's
    // reverse sweep reaches first). The physical structure -- and
    // therefore parents/ties/order -- comes out identical either way.
    // secondTies must ALSO be order-independent: a candidate that
    // looks free when this run is examined but becomes this run's own
    // descendant moments later, in the SAME phase-2 pass, must not
    // survive as a "second" contact -- it is describing the exact
    // junction the descendant now reports as its own primary tie.
    function build(fixedOrder) {
        var sv = CsModel.newSurvey();
        sv.shots = [
            shotOf("A1", "A2", 10, 0, 0),
            shotOf("B1", "B2", 10, 0, 0),
            shotOf("C1", "C2", 10, 0, 0),
            shotOf("A2", "B1", 8, 0, 0),
            shotOf("B2", "C1", 8, 0, 0)
        ];
        sv.fixed["A1"] = { x: 0, y: 0, z: 0 };
        sv.fixed[fixedOrder[0]] = { x: 500, y: 0, z: 0 };
        sv.fixed[fixedOrder[1]] = { x: 1000, y: 0, z: 0 };
        return CsNetwork.resolve(sv, {});
    }
    var rBC = build(["B1", "C1"]);   // B registered (and so seeded) before C
    var rCB = build(["C1", "B1"]);   // C registered (and so seeded) before B
    var gBC = CsProfile.groupRuns(rBC), gCB = CsProfile.groupRuns(rCB);
    eqs(gBC.order.join(","), "A,B,C", "fixture assumption: B seeded before C");
    eqs(gCB.order.join(","), "A,C,B", "fixture assumption: C seeded before B");
    var hBC = CsProfile.hierarchy(gBC, rBC);
    var hCB = CsProfile.hierarchy(gCB, rCB);

    ok(hBC.parents["B"] === "A" && hBC.parents["C"] === "B",
        "B registered first: A-B-C chain, as expected");
    ok(hCB.parents["B"] === "A" && hCB.parents["C"] === "B",
        "C registered first: same final parents, regardless of " +
        "registration order");
    eqs(hBC.secondTies.length + "", "0", "B registered first: no spurious second tie");
    eqs(hCB.secondTies.length + "", "0",
        "C registered first: MUST also be empty -- B's own phase-2 " +
        "examination sees C as free (not yet anyone's descendant) and " +
        "reports it as a second contact, but C becomes B's descendant " +
        "moments later in this very pass, so that entry describes C's " +
        "own primary tie a second time unless the final filter removes it");
}());

(function() {
    // M-3: a station (A3) reached by run B through a qualifying "new"
    // leg (A3-B5, phase 1's own SECOND rank-0 contact, already
    // deduped and reported once) AND, separately, through a closure
    // (B6-A3, phase 2). Two different dedupe maps that do not share
    // state would let this same station through twice -- once from
    // each phase -- even though the I1 fixture (two closures, one map)
    // already looks green.
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A1", "A2", 10, 0, 0),
        shotOf("A2", "A3", 10, 0, 0),
        shotOf("A2", "B1", 8, 0, 0),
        shotOf("B1", "B2", 5, 0, 0),
        shotOf("A3", "B5", 8, 0, 0),
        shotOf("B5", "B6", 5, 0, 0),
        shotOf("B6", "A3", 8, 0, 0)
    ];
    var r = CsNetwork.resolve(sv, {});
    ok(r.legs[6].kind === "closure",
        "fixture assumption: B6->A3 really is a closure");
    var h = CsProfile.hierarchy(CsProfile.groupRuns(r), r);

    var a3ForB = 0;
    for (var sti = 0; sti < h.secondTies.length; sti++) {
        if (h.secondTies[sti].run === "B" && h.secondTies[sti].otherStation === "A3") {
            a3ForB++;
        }
    }
    eqs(a3ForB + "", "1",
        "A3, reached via a phase-1 'new' leg AND a phase-2 closure, is " +
        "one secondTie -- the two phases must share a dedupe map");
}());

(function() {
    // M-4: run D is parentless after phase 1 (its only cross-run legs
    // are closures) and has TWO rank-1 candidates -- A (leg index 5)
    // and E (leg index 6, and E already has ITS OWN phase-1 parent, A,
    // so E can never itself become D's parent or vice versa through
    // this test). The smaller leg index must win as D's primary tie;
    // the other must be demoted to a secondTie via the phase-2 EXTRAS
    // path specifically (not phase 1's dedupe, and not the "already
    // has a parent" branch -- D has neither here).
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A1", "A2", 10, 0, 0),
        shotOf("A2", "A3", 10, 0, 0),
        shotOf("A2", "E1", 8, 0, 0),
        shotOf("E1", "E2", 5, 0, 0),
        shotOf("D1", "D2", 10, 0, 0),
        shotOf("A3", "D1", 8, 0, 0),   // leg index 5 -- must win
        shotOf("E2", "D1", 8, 0, 0)    // leg index 6 -- must be demoted
    ];
    sv.fixed["A1"] = { x: 0, y: 0, z: 0 };
    sv.fixed["D1"] = { x: 500, y: 500, z: 0 };
    var r = CsNetwork.resolve(sv, {});
    ok(r.legs[5].kind === "closure" && r.legs[6].kind === "closure",
        "fixture assumption: both of D's candidates are closures, so " +
        "phase 1 gives D nothing at all");
    var h = CsProfile.hierarchy(CsProfile.groupRuns(r), r);

    ok(h.parents["D"] === "A" && h.ties["D"] === "A3",
        "the smaller leg index (A3-D1) wins D's primary tie");
    var demoted = false;
    for (var sti = 0; sti < h.secondTies.length; sti++) {
        if (h.secondTies[sti].run === "D" && h.secondTies[sti].otherStation === "E2" &&
                h.secondTies[sti].otherRun === "E") {
            demoted = true;
        }
    }
    ok(demoted, "the losing candidate (E) is demoted to a secondTie for D");
}());

(function() {
    // M-5: breakCycle must elect the EARLIEST-STARTED member, not the
    // cycle's entry point. This fixture separates them: the parent-
    // chain walk starts at P (grouped.order[0]) and enters the cycle
    // at A, so a naive "elect cycleMembers[0]" would elect A -- but B
    // (seeded first, as a fixed station) is the one that was on the
    // ground earliest, and must be the one that ends up root.
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("P1", "P2", 10, 0, 0),
        shotOf("B1", "B2", 10, 0, 0),
        shotOf("B2", "A5", 10, 0, 0),
        shotOf("A5", "B7", 10, 0, 0),
        shotOf("A5", "P3", 10, 0, 0)
    ];
    sv.fixed["P1"] = { x: 0, y: 0, z: 0 };
    sv.fixed["B1"] = { x: 500, y: 500, z: 0 };
    var r = CsNetwork.resolve(sv, {});
    var g = CsProfile.groupRuns(r);
    eqs(g.order.join(","), "P,B,A",
        "fixture assumption: the parent-chain walk starts at P and " +
        "enters the cycle at A, not at B");
    var h = CsProfile.hierarchy(g, r);

    ok(h.parents["B"] === null,
        "B (seeded first, the earliest-started member) is elected root");
    ok(h.parents["A"] === "B" && h.parents["P"] === "A",
        "A and P both end up hanging off B, not the other way around");
}());

(function() {
    // M-6: breakCycle's discarded-contact demotion. The rejoining side
    // passage (A1..A3, B1-B2, A4-A5, every leg "new") elects A root
    // and discards A's own original claim on B (tied at B2) -- that
    // discarded contact must survive as a secondTie, not be silently
    // dropped.
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A1", "A2", 10, 0, 0),
        shotOf("A2", "A3", 10, 0, 0),
        shotOf("A3", "B1", 10, 0, 0),
        shotOf("B1", "B2", 10, 0, 0),
        shotOf("B2", "A4", 10, 0, 0),
        shotOf("A4", "A5", 10, 0, 0)
    ];
    var r = CsNetwork.resolve(sv, {});
    var h = CsProfile.hierarchy(CsProfile.groupRuns(r), r);

    var found = false;
    for (var sti = 0; sti < h.secondTies.length; sti++) {
        if (h.secondTies[sti].run === "A" && h.secondTies[sti].otherStation === "B2" &&
                h.secondTies[sti].otherRun === "B") {
            found = true;
        }
    }
    ok(found, "A's discarded parent claim on B (tied at B2) survives as " +
        "a secondTie -- the cycle break demotes it, it does not drop it");
}());

// ---------------------------------------------------------------------
// Profile -- Task 3: chain finding and unrolling one band.
// ---------------------------------------------------------------------

(function() {
    // A1 -> A2 -> A3 level, then A3 -> A4 down at 45 degrees.
    // A2 also carries a dead-end A2 -> A5 that is IN run A but off
    // the longest chain.
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A1", "A2", 10, 0, 0),
        shotOf("A2", "A3", 10, 90, 0),
        shotOf("A3", "A4", 10, 90, -45),
        shotOf("A2", "A5", 3, 180, 0)
    ];
    var r = CsNetwork.resolve(sv, {});
    var g = CsProfile.groupRuns(r);
    var h = CsProfile.hierarchy(g, r);
    var band = CsProfile.unrollBand(g.runs["A"], null, r, h, {});

    // I2: a caller-supplied opts.adjacency must produce the identical
    // band to building the graph internally -- the whole point of
    // accepting one is that Task 5 can hand the same prebuilt graph to
    // every band in a survey without changing what comes out.
    var prebuiltAdj = CsProfile.adjacency(r);
    var bandViaAdj = CsProfile.unrollBand(g.runs["A"], null, r, h, { adjacency: prebuiltAdj });
    eqs(JSON.stringify(bandViaAdj.stations), JSON.stringify(band.stations),
        "opts.adjacency produces the identical stations");
    eqs(JSON.stringify(bandViaAdj.omitted), JSON.stringify(band.omitted),
        "opts.adjacency produces the identical omitted list");

    // and it is genuinely CONSULTED, not silently accepted and ignored:
    // a deliberately empty graph must starve the walk down to one
    // isolated station, proving longestChain actually reads the graph
    // it was handed rather than rebuilding its own regardless.
    var starved = CsProfile.longestChain(g.runs["A"], r, {});
    eqs(starved.chain.length, 1,
        "an empty prebuilt adjacency graph starves the walk to one station -- the parameter is wired in");

    ok(band.stations[0].name === "A1", "root band starts at its own first station");
    near(band.stations[0].x, 0, 1e-9, "first station at X 0");
    near(band.stations[1].x, 10, 1e-9, "level leg advances X by its length");
    near(band.stations[2].x, 20, 1e-9, "second level leg advances X again");

    // 10 ft at -45 deg: plan 7.0711, rise -7.0711
    near(band.stations[3].x, 20 + 7.0710678, 1e-5, "sloped leg advances by plan");
    near(band.stations[3].y, -7.0710678, 1e-5, "sloped leg drops by rise");

    // the drawn leg length is the slope distance, which is the point
    var dx = band.stations[3].x - band.stations[2].x;
    var dy = band.stations[3].y - band.stations[2].y;
    near(Math.sqrt(dx * dx + dy * dy), 10, 1e-5, "leg draws at slope length");

    ok(band.omitted.indexOf("A5") >= 0, "off-chain station reported omitted");
    ok(band.legs.length === 3, "three legs in the band");

    // A5-A2-A3-A4 is exactly as long as A1-A2-A3-A4, so without a
    // tie-break the band's contents would depend on iteration order
    ok(band.stations[0].name === "A1",
        "equal-length chains resolve to the lower station sequence");

    // I4: the legs[] payload itself, not just its length -- six
    // mutations (fromX/fromY hardcoded 0, from/to swapped, shot: null,
    // toY ignoring exaggeration, toX multiplied by exaggeration) all
    // survived a suite that only ever checked band.legs.length. This
    // fixture's nonzero X values catch a hardcoded-0 fromX/toX; the
    // exaggeration fixture further below catches the other two.
    for (var li0 = 0; li0 < band.legs.length; li0++) {
        eqs(band.legs[li0].fromX, band.stations[li0].x,
            "leg " + li0 + " fromX matches its FROM station's X");
        eqs(band.legs[li0].fromY, band.stations[li0].y,
            "leg " + li0 + " fromY matches its FROM station's Y");
        eqs(band.legs[li0].toX, band.stations[li0 + 1].x,
            "leg " + li0 + " toX matches its TO station's X");
        eqs(band.legs[li0].toY, band.stations[li0 + 1].y,
            "leg " + li0 + " toY matches its TO station's Y");
        eqs(band.legs[li0].from, band.stations[li0].name,
            "leg " + li0 + " from matches its FROM station's name");
        eqs(band.legs[li0].to, band.stations[li0 + 1].name,
            "leg " + li0 + " to matches its TO station's name");
        ok(band.legs[li0].shot !== null && band.legs[li0].shot !== undefined,
            "leg " + li0 + " carries its real shot, not null");
    }
}());

(function() {
    // I6: legBetween's OWN two filters, pinned directly (adjacency's
    // splay filter is pinned separately above). Dropping either one --
    // the closure exclusion, which is the entire point of its
    // invariant with adjacency, or the splay guard -- currently
    // survives the suite with nothing to catch it.
    var closureResolved = {
        legs: [{ shot: shotOf("A1", "A2", 10, 0, 0), from: "A1", to: "A2", kind: "closure" }]
    };
    ok(CsProfile.legBetween("A1", "A2", closureResolved) === null,
        "legBetween refuses a closure leg");
    var splayResolved = {
        legs: [{ shot: { splay: true }, from: "A1", to: "A2", kind: "new" }]
    };
    ok(CsProfile.legBetween("A1", "A2", splayResolved) === null,
        "legBetween refuses a splay-flagged leg too");
    // tieLegBetween's own splay guard, same idea: it deliberately admits
    // closures (that is its whole purpose) but must still refuse a splay
    ok(CsProfile.tieLegBetween("A1", "A2", splayResolved) === null,
        "tieLegBetween refuses a splay-flagged leg despite admitting closures");
}());

// ---------------------------------------------------------------------
// CsProfile: the once-per-build leg index (CsProfile.legIndex) --
// CsProfile.legBetween and CsProfile.tieLegBetween used to scan all of
// resolved.legs on every chain step. The index changes WHICH legs each
// lookup looks at and nothing else; these tests are what says so.
// ---------------------------------------------------------------------

// The complete-data profile fixture and its snapshot, shared between the
// golden generator and tests/js_unit.js so the two can never drift.
function profileGoldenSurvey() {
    var sp = function(from, d, az, inc) {
        var s = shotOf(from, "", d, az, inc);
        s.splay = true;
        return s;
    };
    var sv = CsModel.newSurvey();
    // trunk A, closing a ring back onto A1 (a "closure" leg)
    sv.shots.push(shotOf("A1", "A2", 10, 0, 5));
    sv.shots.push(shotOf("A2", "A3", 10, 45, -3));
    sv.shots.push(shotOf("A3", "A4", 12, 90, 8));
    sv.shots.push(shotOf("A4", "A5", 11, 135, -6));
    sv.shots.push(shotOf("A5", "A6", 9, 200, 2));
    sv.shots.push(shotOf("A6", "A1", 21.4, 290, -6));
    // run B ties in at A3 -- an INTERIOR station of A's own longest chain
    sv.shots.push(shotOf("A3", "B1", 7, 300, 10));
    sv.shots.push(shotOf("B1", "B2", 8, 300, 4));
    sv.shots.push(shotOf("B2", "B3", 8, 310, -2));
    sv.shots.push(shotOf("B2", "B7", 4, 20, 1));      // B's own demoted arm
    // a lowercase spur off A4
    sv.shots.push(shotOf("A4", "A4a1", 6, 10, -12));
    sv.shots.push(shotOf("A4a1", "A4a2", 6, 15, -4));
    // a SECOND anchored component, joined by a control tie
    sv.shots.push(shotOf("C1", "C2", 10, 0, 0));
    sv.shots.push(shotOf("C2", "C3", 10, 90, 3));
    sv.shots.push(shotOf("C3", "B3", 15.2, 40, -2));
    // splays, so ceiling/floor runs and the flat ticks are covered too
    sv.shots.push(sp("A2", 3, 90, 40));
    sv.shots.push(sp("A2", 4, 270, -35));
    sv.shots.push(sp("A3", 2.5, 0, 55));
    sv.shots.push(sp("A3", 3.5, 180, -50));
    sv.shots.push(sp("B2", 5, 45, 30));
    sv.shots.push(sp("B2", 5, 225, -30));
    sv.shots.push(sp("C2", 2, 0, 60));
    sv.shots.push(sp("C2", 2, 180, -60));
    sv.shots.push(sp("A4", 3, 90, 45));
    sv.shots.push(sp("A4", 3, 270, -45));
    sv.shots.push(sp("A5", 3, 90, 20));
    sv.shots.push(sp("A5", 3, 270, -20));
    sv.shots.push(sp("B1", 4, 30, 35));
    sv.shots.push(sp("B1", 4, 210, -35));
    sv.shots.push(sp("B3", 4, 30, 25));
    sv.shots.push(sp("B3", 4, 210, -25));
    sv.shots.push(sp("C1", 2, 0, 50));
    sv.shots.push(sp("C1", 2, 180, -50));
    sv.shots.push(sp("C3", 2, 0, 45));
    sv.shots.push(sp("C3", 2, 180, -45));
    sv.shots.push(sp("A4a1", 2, 10, 40));
    sv.shots.push(sp("A4a1", 2, 190, -40));
    sv.shots.push(sp("A4a2", 2, 15, 40));
    sv.shots.push(sp("A4a2", 2, 195, -40));
    sv.shots.push(sp("A2", 6, 90, 3));                // near-horizontal: FLAT
    sv.fixed["A1"] = { x: 0, y: 0, z: 100 };
    sv.fixed["C1"] = { x: 200, y: 200, z: 140 };
    return sv;
}

// Every number CsProfile.build produced, one line at a time, at nine
// decimals -- so a comparison is point-for-point and a failure names
// the one point that moved. Nine decimals, not toString(), because the
// two engines' default float formatting is not the same text.
function profileSnapshotLines(built) {
    var lines = [], b, i, j;
    var n9 = function(v) {
        return (typeof v === "number") ? v.toFixed(9) : String(v);
    };
    var runLines = function(label, runs) {
        if (runs === undefined || runs === null) {
            lines.push("  " + label + "=none");
            return;
        }
        for (var r = 0; r < runs.length; r++) {
            var s = "  " + label + "[" + r + "]";
            for (var p = 0; p < runs[r].length; p++) {
                s += " (" + n9(runs[r][p].x) + "," + n9(runs[r][p].y) + ")";
            }
            lines.push(s);
        }
    };
    lines.push("bands=" + built.bands.length);
    for (i = 0; i < built.bands.length; i++) {
        b = built.bands[i];
        lines.push("BAND " + i + " key=" + b.key + " tie=" + b.tie +
            " datum=" + n9(b.datum) + " exag=" + n9(b.exaggeration) +
            " tapeMode=" + b.tapeMode + " parent=" + b.parent +
            " zOffset=" + n9(b.zOffset) + " stopped=" + b.stopped +
            " reason=" + b.stoppedReason +
            " omitted=[" + b.omitted.join(",") + "]");
        for (j = 0; j < b.stations.length; j++) {
            lines.push("  ST " + b.stations[j].name +
                " x=" + n9(b.stations[j].x) + " y=" + n9(b.stations[j].y) +
                " z=" + n9(b.stations[j].z));
        }
        for (j = 0; j < b.legs.length; j++) {
            lines.push("  LG " + b.legs[j].from + "->" + b.legs[j].to +
                " kind=" + b.legs[j].kind +
                " (" + n9(b.legs[j].fromX) + "," + n9(b.legs[j].fromY) +
                ")->(" + n9(b.legs[j].toX) + "," + n9(b.legs[j].toY) + ")" +
                " shotD=" + n9(b.legs[j].shot ? b.legs[j].shot.distance : null));
        }
        runLines("CEIL", b.ceiling);
        runLines("FLOOR", b.floor);
        if (b.flat !== undefined && b.flat !== null) {
            for (j = 0; j < b.flat.length; j++) {
                lines.push("  FLAT " + b.flat[j].name + " " +
                    n9(b.flat[j].x) + "," + n9(b.flat[j].y));
            }
        }
    }
    var f = built.findings;
    lines.push("F.omitted=[" + f.omitted.join(",") + "]");
    lines.push("F.ungrouped=[" + f.ungrouped.join(",") + "]");
    lines.push("F.orphans=[" + f.orphans.join(",") + "]");
    lines.push("F.strandedRoots=[" + f.strandedRoots.join(",") + "]");
    lines.push("F.wallPointsSkipped=" + f.wallPointsSkipped);
    for (i = 0; i < f.stopped.length; i++) {
        lines.push("F.stopped " + f.stopped[i].run + " " +
            f.stopped[i].station + " " + f.stopped[i].reason);
    }
    for (i = 0; i < f.mismatches.length; i++) {
        lines.push("F.mismatch " + f.mismatches[i].run + " " +
            f.mismatches[i].expected + " " + f.mismatches[i].actual);
    }
    for (i = 0; i < f.secondTies.length; i++) {
        lines.push("F.secondTie " + f.secondTies[i].run + " " +
            f.secondTies[i].otherRun + " " + f.secondTies[i].otherStation);
    }
    for (i = 0; i < f.undrawn.length; i++) {
        lines.push("F.undrawn " + f.undrawn[i].from + "->" + f.undrawn[i].to +
            " " + f.undrawn[i].kind + " " + f.undrawn[i].reason);
    }
    return lines;
}

// The geometry this fixture produced BEFORE CsProfile.legIndex existed,
// generated from the pre-change file and identical under node and
// CaveCAD. The index is a speed change, so every number here is a
// number the change must not move.
var PROFILE_GEOMETRY_BEFORE_INDEX = [
    "bands=4",
    "BAND 0 key=A tie=null datum=100.000000000 exag=1.000000000 tapeMode=slope parent=null zOffset=0.000000000 stopped=null reason=null omitted=[]",
    "  ST A1 x=0.000000000 y=100.000000000 z=100.000000000",
    "  ST A2 x=9.961946981 y=100.871557427 z=100.871557427",
    "  ST A3 x=19.948242328 y=100.348197865 z=100.348197865",
    "  ST A4 x=31.831459153 y=102.018275077 z=102.018275077",
    "  ST A5 x=42.771200002 y=100.868461981 z=100.868461981",
    "  ST A6 x=51.765717446 y=101.182557451 z=101.182557451",
    "  LG A1->A2 kind=new (0.000000000,100.000000000)->(9.961946981,100.871557427) shotD=10.000000000",
    "  LG A2->A3 kind=new (9.961946981,100.871557427)->(19.948242328,100.348197865) shotD=10.000000000",
    "  LG A3->A4 kind=new (19.948242328,100.348197865)->(31.831459153,102.018275077) shotD=12.000000000",
    "  LG A4->A5 kind=new (31.831459153,102.018275077)->(42.771200002,100.868461981) shotD=11.000000000",
    "  LG A5->A6 kind=new (42.771200002,100.868461981)->(51.765717446,101.182557451) shotD=9.000000000",
    "  CEIL[0] (9.961946981,102.799920257) (20.962191798,102.396077976)",
    "  FLOOR[0] (9.961946981,98.577251682) (18.357424157,97.667042314)",
    "  FLAT A2.3 9.961946981,101.185573165",
    // zOffset moved from -11.954744585 to -26.954744585 when
    // CsProfile.GUTTER_MIN went 5 -> 20, for room to annotate between
    // bands. The delta is exactly 15 -- the whole of the constant's
    // change and nothing else -- which is what says this line is the
    // intended widening rather than a geometry regression hiding in a
    // golden fixture. Any FURTHER movement here is a real change and
    // must be explained, not re-baselined.
    "BAND 1 key=B tie=A3 datum=100.348197865 exag=1.000000000 tapeMode=slope parent=A zOffset=-26.954744585 stopped=null reason=null omitted=[B7]",
    "  ST A3 x=0.000000000 y=100.348197865 z=100.348197865",
    "  ST B1 x=6.893654271 y=101.563735109 z=101.563735109",
    "  ST B2 x=14.874166673 y=102.121786899 z=102.121786899",
    "  ST B3 x=22.869293289 y=101.842590925 z=101.842590925",
    "  LG A3->B1 kind=new (0.000000000,100.348197865)->(6.893654271,101.563735109) shotD=7.000000000",
    "  LG B1->B2 kind=new (6.893654271,101.563735109)->(14.874166673,102.121786899) shotD=8.000000000",
    "  LG B2->B3 kind=new (14.874166673,102.121786899)->(22.869293289,101.842590925) shotD=8.000000000",
    "  CEIL[0] (6.893654271,103.858040854) (13.753447333,104.621786899)",
    "  FLOOR[0] (6.893654271,99.269429363) (15.994886013,99.621786899)",
    "BAND 2 key=C tie=B3 datum=101.842590925 exag=1.000000000 tapeMode=slope parent=B zOffset=-89.622888346 stopped=null reason=null omitted=[]",
    "  ST B3 x=0.000000000 y=101.842590925 z=101.842590925",
    "  ST C3 x=15.190740571 y=140.523359562 z=140.523359562",
    "  ST C2 x=25.177035918 y=140.000000000 z=140.000000000",
    "  ST C1 x=35.177035918 y=140.000000000 z=140.000000000",
    "  LG B3->C3 kind=tie (0.000000000,101.842590925)->(15.190740571,140.523359562) shotD=15.200000000",
    "  LG C3->C2 kind=new (15.190740571,140.523359562)->(25.177035918,140.000000000) shotD=10.000000000",
    "  LG C2->C1 kind=new (25.177035918,140.000000000)->(35.177035918,140.000000000) shotD=10.000000000",
    "  CEIL[0] (3.570155741,103.533063972) (16.274091012,141.937573125) (25.177035918,141.732050808) (36.462611138,141.532088886)",
    "  FLOOR[0] (-3.570155741,100.152117878) (14.107390130,139.109146000) (25.177035918,138.267949192) (33.891460699,138.467911114)",
    "BAND 3 key=A4a tie=A4 datum=102.018275077 exag=1.000000000 tapeMode=slope parent=A zOffset=-111.527150619 stopped=null reason=null omitted=[]",
    "  ST A4 x=0.000000000 y=102.018275077 z=102.018275077",
    "  ST A4a1 x=5.868885604 y=100.770804932 z=100.770804932",
    "  ST A4a2 x=11.854269906 y=100.352266089 z=100.352266089",
    "  LG A4->A4a1 kind=new (0.000000000,102.018275077)->(5.868885604,100.770804932) shotD=6.000000000",
    "  LG A4a1->A4a2 kind=new (5.868885604,100.770804932)->(11.854269906,100.352266089) shotD=6.000000000",
    "  CEIL[0] (7.400974491,102.056380151) (13.386358792,101.637841309)",
    "  FLOOR[0] (4.336796718,99.485229712) (10.322181020,99.066690870)",
    "F.omitted=[B7]",
    "F.ungrouped=[]",
    "F.orphans=[]",
    "F.strandedRoots=[]",
    "F.wallPointsSkipped=0",
    "F.undrawn A6->A1 closure closure",
    "F.undrawn B2->B7 new demoted arm"
];

(function() {
    // ---------------------------------------------------------------
    // CsProfile.pairKey / CsProfile.legIndex, and the promise the whole
    // index rests on: it changes WHICH legs a lookup looks at, never
    // WHICH ONES PASS. Every assertion below is written so that
    // deleting the behaviour it names makes THIS test fail, not some
    // distant geometry test.
    // ---------------------------------------------------------------

    // -- pairKey is an UNORDERED key -------------------------------
    eqs(CsProfile.pairKey("A1", "B2"), CsProfile.pairKey("B2", "A1"),
        "pairKey is the same string whichever way round the pair is given");
    ok(CsProfile.pairKey("A1", "A2") !== CsProfile.pairKey("A1", "A3"),
        "pairKey still tells two different pairs apart");

    // -- pairKey cannot collide two DIFFERENT pairs ----------------
    // The separator is what makes this true. Every printable candidate
    // fails here: with a space, ("A B","C") and ("A","B C") share a key
    // and one bucket, and first-match-wins then hands back a leg from
    // the wrong pair -- silently.
    var COLLIDE = [" ", ",", "-", ".", "/", "|", ":", "\t"];
    for (var cx = 0; cx < COLLIDE.length; cx++) {
        var ch = COLLIDE[cx];
        ok(CsProfile.pairKey("A" + ch + "B", "C") !==
                CsProfile.pairKey("A", "B" + ch + "C"),
            "pairKey does not collide two pairs whose names contain '" +
                ch + "'");
    }

    // -- a pairKey is never an Object.prototype member name ---------
    // Every key carries a PAIR_SEP and no builtin name does, which is
    // what makes plain [] access on a legIndex safe. Driven end to end
    // rather than asserted on the string, because the lookup is the
    // thing that would break.
    var protoResolved = { legs: [
        { shot: shotOf("__proto__", "hasOwnProperty", 10, 0, 0),
          from: "__proto__", to: "hasOwnProperty", kind: "new" }
    ] };
    var protoIndex = CsProfile.legIndex(protoResolved);
    ok(CsProfile.legBetween("__proto__", "hasOwnProperty", protoResolved,
            protoIndex) === protoResolved.legs[0],
        "a station named __proto__ still indexes and resolves like any other");
    ok(CsProfile.legBetween("hasOwnProperty", "toString", protoResolved,
            protoIndex) === null,
        "and a pair with no leg comes back null, not an inherited value");

    // -- legIndex FILTERS NOTHING ----------------------------------
    // This is the safety argument for the whole change: the kind
    // filters stay in legBetween and tieLegBetween, and the index never
    // becomes a third copy of them. If it ever started filtering,
    // tieLegBetween would lose the closure legs it exists to find.
    var mixedResolved = { legs: [
        { shot: shotOf("A1", "A2", 10, 0, 0), from: "A1", to: "A2",
          kind: "closure" },
        { shot: { splay: true }, from: "A2", to: "A3", kind: "new" },
        { shot: shotOf("A3", "A4", 10, 0, 0), from: "A3", to: "A4",
          kind: "new" }
    ] };
    var mixedIndex = CsProfile.legIndex(mixedResolved);
    eqs((mixedIndex[CsProfile.pairKey("A1", "A2")] || []).length, 1,
        "legIndex keeps a CLOSURE leg in its bucket -- it filters nothing");
    eqs((mixedIndex[CsProfile.pairKey("A2", "A3")] || []).length, 1,
        "legIndex keeps a SPLAY-flagged leg in its bucket too");
    ok(CsProfile.legBetween("A1", "A2", mixedResolved, mixedIndex) === null,
        "legBetween still refuses that closure THROUGH the index");
    ok(CsProfile.legBetween("A2", "A3", mixedResolved, mixedIndex) === null,
        "legBetween still refuses that splay leg THROUGH the index");
    ok(CsProfile.tieLegBetween("A1", "A2", mixedResolved, mixedIndex) ===
            mixedResolved.legs[0],
        "tieLegBetween still ADMITS that closure through the index -- the " +
        "one stated exception to the shared filter");
    ok(CsProfile.tieLegBetween("A2", "A3", mixedResolved, mixedIndex) === null,
        "tieLegBetween still refuses a splay through the index");

    // -- empty input tolerance, same as adjacency() ----------------
    var emptyIdx = CsProfile.legIndex({ legs: null });
    var emptyKeys = 0;
    for (var ek in emptyIdx) {
        if (emptyIdx.hasOwnProperty(ek)) { emptyKeys++; }
    }
    eqs(emptyKeys, 0, "legIndex tolerates a resolved with no legs at all");

    // ---------------------------------------------------------------
    // A DUPLICATE PAIR: two legs joining the same two stations. First
    // match wins, and a bucket lists a pair's legs in resolved.legs
    // order, so the indexed and unindexed answers must be the SAME
    // OBJECT -- not merely an equal-looking one.
    // ---------------------------------------------------------------
    var placeThenClose = { legs: [
        { shot: shotOf("A1", "A2", 10, 0, 0), from: "A1", to: "A2",
          kind: "new" },
        // the second leg on the same pair, written BACKWARDS, so this
        // also pins that a bucket is keyed on the unordered pair
        { shot: shotOf("A2", "A1", 99, 180, 0), from: "A2", to: "A1",
          kind: "closure" }
    ] };
    var ptcIndex = CsProfile.legIndex(placeThenClose);
    eqs((ptcIndex[CsProfile.pairKey("A1", "A2")] || []).length, 2,
        "both legs of a duplicate pair land in ONE bucket, either direction");
    eqs(ptcIndex[CsProfile.pairKey("A1", "A2")][0], placeThenClose.legs[0],
        "and the bucket keeps them in resolved.legs order");
    ok(CsProfile.legBetween("A1", "A2", placeThenClose) ===
            placeThenClose.legs[0] &&
        CsProfile.legBetween("A1", "A2", placeThenClose, ptcIndex) ===
            placeThenClose.legs[0],
        "duplicate pair: legBetween returns the PLACING leg, indexed and not");
    ok(CsProfile.tieLegBetween("A1", "A2", placeThenClose) ===
            placeThenClose.legs[0] &&
        CsProfile.tieLegBetween("A1", "A2", placeThenClose, ptcIndex) ===
            placeThenClose.legs[0],
        "duplicate pair: tieLegBetween returns the FIRST leg, indexed and not");

    // both legs closures -- the pair whose ends were already reachable
    // by other routes. legBetween finds nothing; tieLegBetween takes
    // the EARLIER closure, and the index must not reorder them.
    var twoClosures = { legs: [
        { shot: shotOf("A1", "A2", 7, 0, 0), from: "A1", to: "A2",
          kind: "closure" },
        { shot: shotOf("A1", "A2", 8, 0, 0), from: "A1", to: "A2",
          kind: "closure" }
    ] };
    var tcIndex = CsProfile.legIndex(twoClosures);
    ok(CsProfile.legBetween("A1", "A2", twoClosures) === null &&
        CsProfile.legBetween("A1", "A2", twoClosures, tcIndex) === null,
        "two closures on one pair: legBetween finds nothing, indexed and not");
    ok(CsProfile.tieLegBetween("A1", "A2", twoClosures) ===
            twoClosures.legs[0] &&
        CsProfile.tieLegBetween("A1", "A2", twoClosures, tcIndex) ===
            twoClosures.legs[0],
        "two closures on one pair: tieLegBetween returns the EARLIER one, " +
        "indexed and not");

    // ---------------------------------------------------------------
    // THE ORDERING PROPERTY ITSELF, pinned on CsNetwork.resolve rather
    // than assumed by CsProfile: a shot is classified "closure" only
    // when both its ends are ALREADY placed, so for any pair carrying
    // two legs the placing ("new") leg is emitted FIRST. That is what
    // makes the tie step's kind lookup behave as its docblock says.
    // ---------------------------------------------------------------
    var dupSv = CsModel.newSurvey();
    dupSv.shots.push(shotOf("D1", "D2", 10, 0, 0));
    dupSv.shots.push(shotOf("D2", "D3", 10, 90, 0));
    dupSv.shots.push(shotOf("D1", "D2", 10.3, 2, 1));  // same pair again
    var dupRes = CsNetwork.resolve(dupSv, {});
    var firstOnPair = null, closureBeforeNew = false, sawNew = false;
    for (var dl = 0; dl < dupRes.legs.length; dl++) {
        var dleg = dupRes.legs[dl];
        if (CsProfile.pairKey(dleg.from, dleg.to) !==
                CsProfile.pairKey("D1", "D2")) {
            continue;
        }
        if (firstOnPair === null) { firstOnPair = dleg; }
        if (dleg.kind === "closure" && !sawNew) { closureBeforeNew = true; }
        if (dleg.kind === "new") { sawNew = true; }
    }
    eqs((firstOnPair === null) ? "none" : firstOnPair.kind, "new",
        "resolve emits a duplicate pair's PLACING leg first");
    ok(!closureBeforeNew,
        "resolve never emits a closure on a pair before that pair's own " +
        "placing leg");

    // ---------------------------------------------------------------
    // CsProfile.build: ONE index for the whole profile, handed down to
    // every band, and never written back onto the caller's own opts.
    // ---------------------------------------------------------------
    var bsv = CsModel.newSurvey();
    bsv.shots.push(shotOf("E1", "E2", 10, 0, 0));
    bsv.shots.push(shotOf("E2", "E3", 10, 90, 0));
    bsv.shots.push(shotOf("E2", "F1", 8, 270, 0));
    bsv.shots.push(shotOf("F1", "F2", 8, 270, 0));
    var bres = CsNetwork.resolve(bsv, {});

    var realIndex = CsProfile.legIndex;
    var indexCalls = 0;
    try {
        CsProfile.legIndex = function(r) {
            indexCalls++;
            return realIndex.call(CsProfile, r);
        };
        var counted = CsProfile.build(bsv, bres, {});
        eqs(indexCalls, 1,
            "build constructs its leg index EXACTLY ONCE for the whole " +
            "profile, not once per band");
        eqs(counted.bands.length, 2, "and the two bands still come out");
    } finally {
        CsProfile.legIndex = realIndex;
    }

    // Does build actually HAND the index down? Feed it a deliberately
    // empty one: if every band resolves its steps through opts.legIndex,
    // every band must now stop for want of a leg. If build were still
    // scanning resolved.legs the bands would draw normally and this
    // would fail -- which is the point.
    try {
        CsProfile.legIndex = function() { return {}; };
        var starved = CsProfile.build(bsv, bres, {});
        var allStopped = (starved.bands.length > 0);
        for (var sb = 0; sb < starved.bands.length; sb++) {
            if (starved.bands[sb].stoppedReason !== "no-leg") {
                allStopped = false;
            }
        }
        ok(allStopped,
            "build hands its leg index to every band -- starve the index " +
            "and every band stops with 'no-leg'");
    } finally {
        CsProfile.legIndex = realIndex;
    }

    // C1, extended to the index: a caller's own opts object must come
    // back untouched, because CsDraw.survey reuses one across draws and
    // a map built from an earlier `resolved` answering for a later one
    // is a silently wrong profile.
    var reused = { exaggeration: 1.0 };
    CsProfile.build(bsv, bres, reused);
    ok(reused.legIndex === undefined,
        "build never writes its leg index back onto the caller's opts");
    ok(reused.adjacency === undefined,
        "nor its adjacency graph -- same rule, same reason");
    ok(reused.splaysByStation === undefined && reused.legCounts === undefined,
        "nor the two CsLrud maps");

    // ...and the consequence, driven rather than asserted on a field:
    // the SAME opts object across two DIFFERENT surveys still builds
    // the second one correctly.
    var otherSv = CsModel.newSurvey();
    otherSv.shots.push(shotOf("G1", "G2", 10, 0, 0));
    otherSv.shots.push(shotOf("G2", "G3", 10, 0, 0));
    var otherRes = CsNetwork.resolve(otherSv, {});
    var second = CsProfile.build(otherSv, otherRes, reused);
    eqs(second.bands.length, 1, "a reused opts object: the second build " +
        "still finds its one band");
    eqs(second.bands[0].stations.length, 3,
        "and draws all three of its stations -- no stale index answered " +
        "for the wrong survey");

    // ---------------------------------------------------------------
    // THE LOAD-BEARING INVARIANT, driven over a real survey: every edge
    // CsProfile.adjacency offers as a chain step, CsProfile.legBetween
    // can resolve -- through the index and without it. If the two kind
    // filters ever diverge, a chain includes a step legBetween cannot
    // resolve and the band silently stops there.
    // ---------------------------------------------------------------
    var invSv = profileGoldenSurvey();
    var invRes = CsNetwork.resolve(invSv, {});
    var invAdj = CsProfile.adjacency(invRes);
    var invIdx = CsProfile.legIndex(invRes);
    var unresolvable = 0, disagreed = 0, edges = 0;
    for (var at in invAdj) {
        if (!invAdj.hasOwnProperty(at)) { continue; }
        for (var ai2 = 0; ai2 < invAdj[at].length; ai2++) {
            var other = invAdj[at][ai2].other;
            edges++;
            var plain = CsProfile.legBetween(at, other, invRes);
            var viaIdx = CsProfile.legBetween(at, other, invRes, invIdx);
            if (plain === null) { unresolvable++; }
            if (plain !== viaIdx) { disagreed++; }
        }
    }
    ok(edges > 0, "the invariant walk actually had edges to check");
    eqs(unresolvable, 0,
        "every edge adjacency offers, legBetween resolves -- the filters " +
        "still agree by statement");
    eqs(disagreed, 0,
        "and the index returns the identical leg object on every one of them");

    // the same equality over every pair resolve() produced, both lookups
    var legDisagreed = 0, tieDisagreed = 0;
    for (var pl = 0; pl < invRes.legs.length; pl++) {
        var pleg = invRes.legs[pl];
        if (CsProfile.legBetween(pleg.from, pleg.to, invRes) !==
                CsProfile.legBetween(pleg.from, pleg.to, invRes, invIdx)) {
            legDisagreed++;
        }
        if (CsProfile.tieLegBetween(pleg.from, pleg.to, invRes) !==
                CsProfile.tieLegBetween(pleg.from, pleg.to, invRes, invIdx)) {
            tieDisagreed++;
        }
    }
    eqs(legDisagreed, 0, "legBetween: indexed and unindexed agree on every " +
        "pair of a real survey");
    eqs(tieDisagreed, 0, "tieLegBetween: likewise, closures included");

    // ---------------------------------------------------------------
    // THE GEOMETRY ITSELF, point for point, against the output this
    // fixture produced BEFORE the index existed. A survey with
    // branches, an interior tie, a loop closure, a control tie between
    // two anchored components, a demoted arm, wall runs on every band
    // and a flat tick. Any movement here is a regression, not an
    // improvement, so this is one assertion that names the line that
    // moved rather than many that each name a field.
    // ---------------------------------------------------------------
    var golden = CsProfile.build(invSv, invRes, {});
    var actual = profileSnapshotLines(golden);
    var diffAt = -1;
    for (var gi2 = 0; gi2 < Math.max(actual.length,
            PROFILE_GEOMETRY_BEFORE_INDEX.length); gi2++) {
        if (actual[gi2] !== PROFILE_GEOMETRY_BEFORE_INDEX[gi2]) {
            diffAt = gi2;
            break;
        }
    }
    ok(diffAt === -1 &&
            actual.length === PROFILE_GEOMETRY_BEFORE_INDEX.length,
        "the complete-data profile fixture is geometrically unchanged, " +
        "band for band and point for point" + ((diffAt >= 0) ?
            " -- line " + diffAt + " expected '" +
            PROFILE_GEOMETRY_BEFORE_INDEX[diffAt] + "', got '" +
            actual[diffAt] + "'" :
            " (" + actual.length + " vs " +
            PROFILE_GEOMETRY_BEFORE_INDEX.length + " lines)"));
}());

(function() {
    // the second tie-break: equal length, equal lowest sequence, so the
    // lower HIGHEST sequence wins -- A13-A14-A15 over A13-A14-A99
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A13", "A14", 10, 0, 0),
        shotOf("A14", "A15", 10, 0, 0),
        shotOf("A14", "A99", 3, 270, 0)
    ];
    var r = CsNetwork.resolve(sv, {});
    var found = CsProfile.longestChain(
        CsProfile.groupRuns(r).runs["A"], r);
    ok(found.chain.join(",") === "A13,A14,A15",
        "lower highest sequence wins (got " + found.chain.join(",") + ")");
    ok(found.omitted.join(",") === "A99", "A99 reported omitted");
}());

(function() {
    // I5, the HI tier in isolation: equal length, equal LOWEST
    // sequence, so the LOWEST of the two candidates' own highest
    // sequence must win -- A1-A2-A99 over A1-A2-A100. Chosen so the
    // join tier's lexicographic order ACTIVELY DISAGREES with the
    // numeric hi order ("A100" < "A99" as text, since '1' < '9'):
    // dropping the hi tier and falling straight to join here gives
    // A1,A2,A100 instead, confirmed by mutation.
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A1", "A2", 10, 0, 0),
        shotOf("A2", "A99", 10, 0, 0),
        shotOf("A2", "A100", 10, 90, 0)
    ];
    var r = CsNetwork.resolve(sv, {});
    var found = CsProfile.longestChain(CsProfile.groupRuns(r).runs["A"], r);
    eqs(found.chain.join(","), "A1,A2,A99",
        "the hi tier picks the lower highest sequence, not the join tier's own preference");
}());

(function() {
    // I5, the JOIN tier in isolation: a "star" of LETTERED (non-numeric)
    // sequences -- Ax is the hub, Ay/Az/Aw its three spokes. seqNumOf
    // returns Number.MAX_VALUE for every one of them, so the lo and hi
    // tiers tie on EVERY candidate 3-station path through the hub, and
    // only the join tier can ever pick a winner. Shuffled 200 times
    // (both the leg order and the run's own station order), correct
    // code must land on the SAME chain regardless of iteration order;
    // without the join tier nothing breaks the tie at all, so whichever
    // candidate the DFS happens to reach first survives untouched, and
    // shuffling should surface more than one distinct result.
    var legsBase = [
        { shot: shotOf("Ax", "Ay", 10, 0, 0), from: "Ax", to: "Ay", kind: "new" },
        { shot: shotOf("Ax", "Az", 10, 90, 0), from: "Ax", to: "Az", kind: "new" },
        { shot: shotOf("Ax", "Aw", 10, 180, 0), from: "Ax", to: "Aw", kind: "new" }
    ];
    var stationsBase = ["Ax", "Ay", "Az", "Aw"];
    var resolvedStations = {
        Ax: { x: 0, y: 0, z: 0, seq: 0 }, Ay: { x: 0, y: 0, z: 0, seq: 1 },
        Az: { x: 0, y: 0, z: 0, seq: 2 }, Aw: { x: 0, y: 0, z: 0, seq: 3 }
    };
    var shuffle = function(arr) {
        var a = arr.slice(0);
        for (var si = a.length - 1; si > 0; si--) {
            var sj = Math.floor(Math.random() * (si + 1));
            var tmp = a[si]; a[si] = a[sj]; a[sj] = tmp;
        }
        return a;
    };
    var distinct = {};
    for (var trial = 0; trial < 200; trial++) {
        var resolved = { stations: resolvedStations, legs: shuffle(legsBase) };
        var run = { key: "A", stations: shuffle(stationsBase) };
        var found = CsProfile.longestChain(run, resolved);
        distinct[found.chain.join(",")] = true;
    }
    var distinctKeys = [];
    for (var dk in distinct) {
        if (distinct.hasOwnProperty(dk)) { distinctKeys.push(dk); }
    }
    eqs(distinctKeys.length, 1,
        "the join tier picks the same chain regardless of iteration order (got " +
        distinctKeys.join(" | ") + ")");
}());

(function() {
    // I5, the LO tier in isolation, direct on betterChain: not
    // separable through longestChain without a contrived fixture, so
    // this is the honest way to reach it -- A9 beats A10 as the path's
    // OWN lowest sequence, regardless of the other (tied, higher)
    // member in each list.
    ok(CsProfile.betterChain(["A9", "A50"], ["A10", "A050"]) === true,
        "the lo tier alone decides: A9 < A10 as the lowest sequence in each path");
}());

(function() {
    // the final seqOrder reorientation is doing real work, not merely
    // confirming what the join tier already delivered: A9 and A10 sort
    // ASCENDING numerically (9 < 10) but DESCENDING lexicographically
    // ("A10" < "A9" as text), so the join tier's own lo/hi-tied
    // resolution actively prefers "A10,A9" -- only the final,
    // numeric-aware seqOrder pass corrects it back to ascending.
    var sv = CsModel.newSurvey();
    sv.shots = [shotOf("A9", "A10", 10, 0, 0)];
    var r = CsNetwork.resolve(sv, {});
    var found = CsProfile.longestChain(CsProfile.groupRuns(r).runs["A"], r);
    eqs(found.chain.join(","), "A9,A10",
        "seqOrder reorientation wins over the join tier's own lexicographic preference");
}());

(function() {
    // doubling back in plan must still advance X
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A1", "A2", 10, 0, 0),
        shotOf("A2", "A3", 10, 180, 0)   // straight back over A1
    ];
    var r = CsNetwork.resolve(sv, {});
    var g = CsProfile.groupRuns(r);
    var band = CsProfile.unrollBand(g.runs["A"], null, r,
        CsProfile.hierarchy(g, r), {});
    near(band.stations[2].x, 20, 1e-9, "extended elevation never doubles back");
}());

(function() {
    // Math.abs at the X step, and the vertical-leg behaviour the plan
    // now records as correct: a +90 degree shot's own PLAN distance is
    // essentially zero, so both stations land on the SAME X -- a
    // vertical shaft draws as a vertical line, exactly as a real one
    // looks in profile. Measured (not assumed): CsTraverse.offset gives
    // a slightly POSITIVE plan at exactly +/-90 in this engine (cos of
    // 90 degrees in radians rounds a hair positive), so this fixture
    // alone would pass even without Math.abs -- the second assertion
    // below, at an angle measured to give a slightly NEGATIVE plan
    // instead, is the one Math.abs is actually for: without it, X
    // would step backwards by that (tiny but real) amount.
    var sv = CsModel.newSurvey();
    sv.shots = [shotOf("A1", "A2", 10, 0, 90)];
    var r = CsNetwork.resolve(sv, {});
    var g = CsProfile.groupRuns(r);
    var band = CsProfile.unrollBand(g.runs["A"], null, r,
        CsProfile.hierarchy(g, r), {});
    near(band.stations[1].x, band.stations[0].x, 1e-9,
        "a vertical leg keeps both stations on the same X");
    near(band.stations[1].y, 10, 1e-9, "vertical leg's full rise still shows in Y");

    // measured: cos(90.00005 degrees) is slightly NEGATIVE in this
    // engine, so this shot's own plan distance is a tiny negative
    // number -- without Math.abs, x += o.plan would step X backwards.
    var pastVertical = CsTraverse.offset(
        { distance: 10, azimuth: 0, inclination: 90.00005 }, CsTraverse.SLOPE);
    ok(pastVertical.plan < 0,
        "fixture assumption: a hair past vertical gives a negative plan (got " +
        pastVertical.plan + ")");
    var sv2 = CsModel.newSurvey();
    sv2.shots = [shotOf("A1", "A2", 10, 0, 90.00005)];
    var r2 = CsNetwork.resolve(sv2, {});
    var g2 = CsProfile.groupRuns(r2);
    var band2 = CsProfile.unrollBand(g2.runs["A"], null, r2,
        CsProfile.hierarchy(g2, r2), {});
    ok(band2.stations[1].x >= band2.stations[0].x,
        "Math.abs keeps X from stepping backwards on a negative-plan leg");
}());

(function() {
    // a spur band opens with its tie station at X 0
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A1", "A2", 10, 0, 0),
        shotOf("A2", "A2a1", 6, 90, 0),
        shotOf("A2a1", "A2a2", 6, 90, 0)
    ];
    var r = CsNetwork.resolve(sv, {});
    var g = CsProfile.groupRuns(r);
    var h = CsProfile.hierarchy(g, r);
    var band = CsProfile.unrollBand(g.runs["A2a"], h.ties["A2a"], r, h, {});

    ok(band.stations[0].name === "A2", "spur band opens at its tie station");
    near(band.stations[0].x, 0, 1e-9, "tie station at X 0");
    near(band.stations[1].x, 6, 1e-9, "tie leg is drawn in the band");
    ok(band.legs.length === 2, "tie leg plus the spur's own leg");
    ok(band.tie === "A2", "band records its tie");
}());

(function() {
    // band.tie must not report a tie that was never actually drawn:
    // Task 5 stacks siblings by junction and has no other way to tell
    // "opened at this tie" from "the tie name was never usable" apart.
    // "Ghost" is not in resolved.stations at all, so the tie-handling
    // block never runs and the band is just run A's own plain chain.
    var sv = CsModel.newSurvey();
    sv.shots = [shotOf("A1", "A2", 10, 0, 0)];
    var r = CsNetwork.resolve(sv, {});
    var g = CsProfile.groupRuns(r);
    var band = CsProfile.unrollBand(g.runs["A"], "Ghost", r,
        CsProfile.hierarchy(g, r), {});
    ok(band.tie === null,
        "an unusable tie (absent from resolved.stations) reports null, not the ghost name");
    eqs(band.stations.length, 2, "the band is still run A's own plain chain");
}());

(function() {
    // elevation datum: a cave anchored at 1200 must profile at 1200
    var sv = CsModel.newSurvey();
    sv.shots = [shotOf("A1", "A2", 10, 0, 0)];
    var r = CsNetwork.resolve(sv, { anchor: { name: "A1", x: 0, y: 0, z: 1200 } });
    var g = CsProfile.groupRuns(r);
    var band = CsProfile.unrollBand(g.runs["A"], null, r,
        CsProfile.hierarchy(g, r), {});
    near(band.stations[0].y, 1200, 1e-9, "profile keeps the absolute datum");
    near(band.datum, 1200, 1e-9, "band datum is its own first elevation");

    // I4: fromY is nonzero here (1200, the anchored datum), which the
    // root-band fixture above never exercises (it starts at Y 0) --
    // catches a "fromY hardcoded to 0" mutation this specific leg would
    // otherwise let through.
    eqs(band.legs[0].fromY, band.stations[0].y, "leg 0 fromY matches the anchored datum, not 0");
    eqs(band.legs[0].toY, band.stations[1].y, "leg 0 toY matches its TO station's Y");

    // exaggeration scales about the datum, and leaves X alone
    var sv2 = CsModel.newSurvey();
    sv2.shots = [shotOf("A1", "A2", 10, 0, -45)];
    var r2 = CsNetwork.resolve(sv2, {});
    var b2 = CsProfile.unrollBand(CsProfile.groupRuns(r2).runs["A"], null, r2,
        CsProfile.hierarchy(CsProfile.groupRuns(r2), r2),
        { exaggeration: 2.0 });
    near(b2.stations[1].y, -7.0710678 * 2.0, 1e-5, "Y doubled");
    near(b2.stations[1].x, 7.0710678, 1e-5, "X untouched by exaggeration");

    // I4: legs[0].toX/toY must match the ALREADY-exaggerated stations
    // array exactly -- catches "toY ignoring exaggeration" (toY would
    // then be the raw, unscaled rise) and "toX multiplied by
    // exaggeration" (toX would then differ from the un-exaggerated X)
    // in one comparison each, since stations[] is the trusted value.
    eqs(b2.legs[0].toX, b2.stations[1].x, "leg 0 toX matches the (unscaled) station X");
    eqs(b2.legs[0].toY, b2.stations[1].y, "leg 0 toY matches the exaggerated station Y");
}());

(function() {
    // A run whose only external contact is a CLOSURE leg, not a "new"
    // or "tie" one. A1-A2-A3 walks into run B (A3-B1-B2, both "new"),
    // then B2-A1 closes a ring back to the start -- by the time that
    // shot is resolved both ends are already known and already in the
    // same component, so CsNetwork.resolve() classifies it "closure",
    // confirmed by inspecting r.legs below rather than assumed.
    //
    // This is deliberately NOT fed through CsProfile.hierarchy to pick
    // the tie: hierarchy's own phase 1 finds run B's ordinary "new"
    // parent at A3 first, so the closure at A1 only ever shows up as a
    // secondTie there -- that is hierarchy's business, not this
    // function's. What this test targets is unrollBand itself: handed
    // A1 (the closure-connected station) as `tie` directly, it must
    // still resolve that tie STEP and draw the tie leg, because the
    // tie step is not the interior chain walk CsProfile.legBetween
    // guards -- see CsProfile.tieLegBetween's own docblock for why the
    // tie step alone is allowed to see a closure.
    var sv = CsModel.newSurvey();
    var s1 = shotOf("A1", "A2", 10, 0, 0);
    var s2 = shotOf("A2", "A3", 10, 90, 0);
    var s3 = shotOf("A3", "B1", 10, 180, 0);
    var s4 = shotOf("B1", "B2", 10, 270, 0);
    var s5 = shotOf("B2", "A1", 5, 0, 0);
    // I1/I5: the fixture is extended (not replaced) with LRUD and
    // splay evidence, so bandWallRuns' closure-break behaviour has
    // something concrete to assert on below the original unrollBand
    // assertions. s4.up/.down is real evidence recorded AT B2 (the
    // closure-landing station in this band); s5.up/.down is real
    // evidence recorded AT A1 (via the closure shot itself).
    s4.up = 99; s4.down = 99;
    s5.up = 8; s5.down = 1;
    var b1Up1 = splayOf("B1", 5, 0, 60);
    var b1Up2 = splayOf("B1", 5, 90, 45);
    sv.shots = [s1, s2, s3, s4, s5, b1Up1, b1Up2];
    var r = CsNetwork.resolve(sv, {});

    var closureLeg = null;
    for (var li = 0; li < r.legs.length; li++) {
        if (r.legs[li].from === "B2" && r.legs[li].to === "A1") {
            closureLeg = r.legs[li];
        }
    }
    ok(closureLeg !== null && closureLeg.kind === "closure",
        "fixture assumption: the ring-closing B2-A1 shot resolves as a closure");

    var g = CsProfile.groupRuns(r);
    var h = CsProfile.hierarchy(g, r);
    eqs(h.ties["B"], "A3", "fixture assumption: hierarchy's own tie for B is the ordinary new-leg one");

    var band = CsProfile.unrollBand(g.runs["B"], "A1", r, h, {});
    eqs(band.stations.length, 3, "closure-tied band: tie station plus both of B's own");
    ok(band.stations[0].name === "A1", "band opens at the closure-connected tie station");
    ok(band.stations[1].name === "B2", "the closure leg is the tie step, drawn first");
    ok(band.stations[2].name === "B1", "B's own interior leg still follows, via ordinary legBetween");
    eqs(band.legs.length, 2, "tie leg (the closure) plus B's one interior leg");
    ok(band.stopped === null,
        "a closure-kind tie no longer silently truncates the band");
    eqs(band.stoppedReason, null, "no reason to report when nothing stopped the band");
    eqs(band.legs[0].kind, "closure",
        "M1: kind travels on the leg record itself now, no name-pair lookup needed");

    // I1: flush BEFORE a closure-landing station and skip it entirely,
    // exactly like CsLrud.wallRuns' own closure handling. B2 (the
    // closure landing point in THIS band) carries real LRUD
    // (up=99/down=99) but must not appear in B's own wall runs here --
    // that leg's drawn length is not its own tape reading (see
    // CsProfile.tieLegBetween), so wall detail must not hang across
    // it. A1's own LRUD (arriving via the closure shot itself) forms a
    // one-point run all on its own, dropped for being shorter than a
    // line; B1 alone, via its two splays, is what survives.
    var w = CsProfile.bandWallRuns(band, sv, r, {});
    eqs(w.ceiling.length, 1,
        "one surviving ceiling run: B1's own splays, not A1 or B2");
    eqs(w.ceiling[0].length, 2,
        "exactly B1's two splays -- B2's LRUD (99) never joined them");
    eqs(w.floor.length, 0,
        "A1's lone floor point was dropped, and neither B2 nor B1 add another");
    var b1x = band.stations[2].x;
    near(w.ceiling[0][1].x, b1x, 1e-9,
        "the forward-facing splay (t=0) sits at B1 itself, not at B2's X");
}());

(function() {
    // I7: a closure tie leg does NOT draw at its own tape length --
    // stated as a measured fact, not claimed away. A1..B2 all resolve
    // level (Y stays 0 throughout via an ordinary path), then a
    // closure shot B2->A1 at 5.00 ft and +30 degrees ties B to A: its
    // OWN implied rise is 5*sin(30) = 2.5 ft, but both its endpoints
    // already resolved to Y 0 independently, so the network's actual
    // Y-difference across this leg is 0, not 2.5 -- that gap IS the
    // misclosure this leg carries. Drawn length is therefore just its
    // plan advance, 5*cos(30) = 4.3301 ft, about 13% short of the tape.
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A1", "A2", 10, 0, 0),
        shotOf("A2", "A3", 10, 90, 0),
        shotOf("A3", "B1", 10, 180, 0),
        shotOf("B1", "B2", 10, 270, 0),
        shotOf("B2", "A1", 5, 0, 30)
    ];
    var r = CsNetwork.resolve(sv, {});
    var closureLeg = null;
    for (var li2 = 0; li2 < r.legs.length; li2++) {
        if (r.legs[li2].from === "B2" && r.legs[li2].to === "A1") {
            closureLeg = r.legs[li2];
        }
    }
    ok(closureLeg !== null && closureLeg.kind === "closure",
        "fixture assumption: B2->A1 again resolves as a closure");
    eqs(r.stations["A1"].z, r.stations["B2"].z,
        "fixture assumption: both ends resolve to the same Y independent of this leg");

    var g = CsProfile.groupRuns(r);
    var h = CsProfile.hierarchy(g, r);
    var band = CsProfile.unrollBand(g.runs["B"], "A1", r, h, {});
    var tieLeg = band.legs[0];
    var drawnLen = Math.sqrt(
        Math.pow(tieLeg.toX - tieLeg.fromX, 2) + Math.pow(tieLeg.toY - tieLeg.fromY, 2));
    near(drawnLen, 4.3301, 1e-4,
        "the closure tie leg draws at its plan advance, not its 5.00 ft tape reading");
    ok(Math.abs(drawnLen - 5.0) / 5.0 > 0.1,
        "off by more than 10% of the tape -- not a rounding-scale discrepancy");
}());

(function() {
    // datum honesty: a station with NO resolved Z at the head of a
    // chain must stop the band right there, not draw against a
    // fabricated Y of 0 -- the same bug family (missing Z quietly
    // rebasing an absolute-datum cave) this file's docblocks call out
    // repeatedly. Hand-built resolved/run, same style as the M1/I4
    // bandOrder fixture above, because CsNetwork.resolve() itself never
    // leaves a placed station's z undefined -- this is the shape a
    // caller handing unrollBand a partially-built network could still
    // produce, and it must stay honest even though nothing in normal
    // resolve() output exercises it today.
    var run = { key: "A", stations: ["A1", "A2"] };
    var resolved = {
        stations: {
            A1: { x: 0, y: 0, seq: 0 },              // z deliberately absent
            A2: { x: 0, y: 0, z: 10, seq: 1 }
        },
        legs: [
            { shot: shotOf("A1", "A2", 10, 0, 0), from: "A1", to: "A2", kind: "new" }
        ]
    };
    var band = CsProfile.unrollBand(run, null, resolved, {}, {});
    ok(band.stopped === "A1", "a missing-Z station at the chain head stops the band there");
    eqs(band.stations.length, 0, "no station drawn against a fabricated datum");
    ok(band.datum === null, "datum is null, never a fabricated 0, when the head station has no Z");
    eqs(band.stoppedReason, "no-z",
        "I8: the reason distinguishes a bad Z from a missing leg -- this one is no-z");
}());

(function() {
    // I8: the OTHER reason, "no-leg" -- a station with a perfectly
    // good Z whose only problem is that no leg (of ANY kind, closure
    // included -- CsProfile.tieLegBetween's own admission) reaches it
    // from the tie. "Tie" here has no contact anywhere on run A's own
    // chain at all (not even a closure), so it can only be prefixed and
    // honestly fail at the very next step -- never silently treated as
    // if nothing were wrong.
    var run = { key: "A", stations: ["A1", "A2"] };
    var resolved = {
        stations: {
            Tie: { x: 0, y: 0, z: 100, seq: 0 },
            A1: { x: 0, y: 0, z: 0, seq: 1 },
            A2: { x: 0, y: 0, z: 10, seq: 2 }
        },
        legs: [
            { shot: shotOf("A1", "A2", 10, 0, 0), from: "A1", to: "A2", kind: "new" }
        ]
    };
    var band = CsProfile.unrollBand(run, "Tie", resolved, {}, {});
    eqs(band.stations.length, 1, "only the tie station itself draws");
    ok(band.stations[0].name === "Tie", "the one drawn station is the tie");
    eqs(band.stopped, "A1", "A1 has a perfectly good Z (0) -- the failure is elsewhere");
    eqs(band.stoppedReason, "no-leg", "the reason is no-leg, not no-z, for a resolvable-Z station");
}());

(function() {
    // Task 5b: a THIRD reason a chain step can fail -- the leg exists
    // and both stations have a good Z, but the leg's own shot has no
    // usable distance/azimuth/inclination. Before CsTraverse.offset's
    // guard this would either fabricate X (null distance: plan = 0, so
    // A2 lands on TOP of A1 in the profile) or poison X with NaN
    // (undefined distance) -- silently, since unrollBand never checked
    // offset()'s result at all. Now it stops the band right there,
    // same honesty as no-z/no-leg, rather than either fabrication.
    var run = { key: "A", stations: ["A1", "A2"] };
    var badShot = shotOf("A1", "A2", 10, 0, 0);
    badShot.distance = null;
    var resolved = {
        stations: {
            A1: { x: 0, y: 0, z: 0, seq: 0 },
            A2: { x: 0, y: 0, z: 10, seq: 1 }   // a perfectly good Z
        },
        legs: [
            { shot: badShot, from: "A1", to: "A2", kind: "new" }
        ]
    };
    var band = CsProfile.unrollBand(run, null, resolved, {}, {});
    eqs(band.stations.length, 1, "only A1 draws -- A2's X cannot be computed");
    eqs(band.stopped, "A2", "the band stops at the station the bad leg would have reached");
    eqs(band.stoppedReason, "unmeasurable",
        "the reason names the actual cause: no usable measurement, not no-z/no-leg");
    ok(isFinite(band.stations[0].x) && isFinite(band.stations[0].y),
        "no NaN reaches the one station that DID draw");
}());

(function() {
    // C1 (the review's Critical): a run entered at an INTERIOR
    // junction, surveyed both ways -- A3 ties in at B1, then
    // B1-B2-B3-B4 one direction and B1-B5-B6-B7 the other. Run B's own
    // longest internal chain runs straight THROUGH B1 end to end
    // (B4..B1..B7); the tie's contact station (B1) is the MIDDLE of
    // that chain, not either end. The old endpoint-only assumption
    // unshifted the tie in front of whichever end the chain happened to
    // start at (B4), found no leg from A3 to B4, and discarded the
    // entire seven-station, eight-leg run down to one point. The fixed
    // code scans for where the tie actually attaches, then keeps the
    // longer of the two arms (equal here, so the tie-break -- lower
    // highest sequence, same rule as everywhere else in this file --
    // picks the B4 arm over the B7 arm) and demotes the other arm's
    // stations to `omitted` instead of vanishing the whole band.
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A1", "A2", 10, 0, 0),
        shotOf("A2", "A3", 10, 0, 0),
        shotOf("A3", "B1", 8, 90, 0),
        shotOf("B1", "B2", 10, 0, 0),
        shotOf("B2", "B3", 10, 90, 0),
        shotOf("B3", "B4", 10, 90, 0),
        shotOf("B1", "B5", 10, 180, 0),
        shotOf("B5", "B6", 10, 270, 0),
        shotOf("B6", "B7", 10, 270, 0)
    ];
    var r = CsNetwork.resolve(sv, {});
    var g = CsProfile.groupRuns(r);
    var h = CsProfile.hierarchy(g, r);
    eqs(h.ties["B"], "A3", "fixture assumption: B ties to the run at A3 (into B1)");
    var found = CsProfile.longestChain(g.runs["B"], r);
    eqs(found.chain.join(","), "B4,B3,B2,B1,B5,B6,B7",
        "fixture assumption: run B's own longest chain runs through B1, not ending on it");

    var band = CsProfile.unrollBand(g.runs["B"], "A3", r, h, {});
    ok(band.stopped === null, "the run is no longer silently discarded to one point");
    eqs(band.stations.length, 5, "tie station plus the four-station arm it keeps");
    eqs(
        band.stations.map(function(s) { return s.name; }).join(","),
        "A3,B1,B2,B3,B4",
        "the kept arm runs from the tie through the junction to B4, not B7"
    );
    eqs(band.legs.length, 4, "tie leg into B1, plus three interior legs out to B4");
    ok(band.omitted.indexOf("B5") >= 0 && band.omitted.indexOf("B6") >= 0 &&
        band.omitted.indexOf("B7") >= 0,
        "the shorter arm's stations are demoted to omitted, not lost outright");
}());

// ---------------------------------------------------------------------
// Floor and ceiling: classifySplay's dead zone, then bandWallRuns.
// ---------------------------------------------------------------------

(function() {
    ok(CsProfile.classifySplay(shotOf("A1", "", 5, 0, 40), 10) === "ceiling",
        "steep up splay joins the ceiling");
    ok(CsProfile.classifySplay(shotOf("A1", "", 5, 0, -40), 10) === "floor",
        "steep down splay joins the floor");
    ok(CsProfile.classifySplay(shotOf("A1", "", 5, 0, 3), 10) === "flat",
        "shallow splay joins neither");
    ok(CsProfile.classifySplay(shotOf("A1", "", 5, 0, 10), 10) === "flat",
        "the dead zone boundary is flat, not ceiling");
    ok(CsProfile.classifySplay(shotOf("A1", "", 5, 0, -10), 10) === "flat",
        "boundary below is flat too");
    ok(CsProfile.classifySplay(shotOf("A1", "", 5, 0, 11), 10) === "ceiling",
        "just outside the dead zone counts");
}());

(function() {
    // A1 -> A2 -> A3, level, each station 4 up and 2 down
    var sv = CsModel.newSurvey();
    var s1 = shotOf("A1", "A2", 10, 0, 0);
    s1.up = 4; s1.down = 2;
    var s2 = shotOf("A2", "A3", 10, 0, 0);
    s2.up = 4; s2.down = 2;
    sv.shots = [s1, s2];
    var r = CsNetwork.resolve(sv, {});
    var g = CsProfile.groupRuns(r);
    var h = CsProfile.hierarchy(g, r);
    var band = CsProfile.unrollBand(g.runs["A"], null, r, h, {});
    var w = CsProfile.bandWallRuns(band, sv, r, {});

    ok(w.ceiling.length === 1, "one ceiling run");
    ok(w.ceiling[0].length >= 2, "ceiling run has at least two points");
    near(w.ceiling[0][0].y, 4, 1e-9, "ceiling sits U above the station");
    near(w.floor[0][0].y, -2, 1e-9, "floor sits D below the station");
    near(w.ceiling[0][0].x, band.stations[1].x, 1e-9,
        "the LRUD point sits at its own station's X");
}());

(function() {
    // zero and null: 0 is a point at the station, null is no point
    var sv = CsModel.newSurvey();
    var s1 = shotOf("A1", "A2", 10, 0, 0);
    s1.up = 0; s1.down = null;
    var s2 = shotOf("A2", "A3", 10, 0, 0);
    s2.up = 0; s2.down = null;
    sv.shots = [s1, s2];
    var r = CsNetwork.resolve(sv, {});
    var g = CsProfile.groupRuns(r);
    var band = CsProfile.unrollBand(g.runs["A"], null, r,
        CsProfile.hierarchy(g, r), {});
    var w = CsProfile.bandWallRuns(band, sv, r, {});
    near(w.ceiling[0][0].y, 0, 1e-9, "U of 0 is a ceiling point at the station");
    ok(w.floor.length === 0, "null D draws no floor at all");
}());

(function() {
    // splays: one up, one down, one flat -- and along-passage ordering.
    // The legs carry U/D as well, so each line has an LRUD point at
    // every station: without that, a run of one point is dropped and
    // there is nothing to assert about ordering.
    var sv = CsModel.newSurvey();
    var s1 = shotOf("A1", "A2", 10, 0, 0);
    s1.up = 6; s1.down = 6;
    var s2 = shotOf("A2", "A3", 10, 0, 0);
    s2.up = 6; s2.down = 6;
    var up = splayOf("A2", 5, 0, 60);      // forward and up
    var down = splayOf("A2", 5, 180, -60); // backward and down
    var flat = splayOf("A2", 5, 90, 0);    // sideways, level
    sv.shots = [s1, s2, up, down, flat];
    var r = CsNetwork.resolve(sv, {});
    var g = CsProfile.groupRuns(r);
    var band = CsProfile.unrollBand(g.runs["A"], null, r,
        CsProfile.hierarchy(g, r), {});
    var w = CsProfile.bandWallRuns(band, sv, r, {});

    ok(w.flat.length === 1 && w.flat[0].station === "A2",
        "the level splay is a flat tick, in neither line");

    // A2 contributes its U point and the up splay; A3 its U point.
    // A1 has no LRUD (nothing arrives at it) so it contributes nothing.
    ok(w.ceiling.length === 1, "one ceiling run (got " + w.ceiling.length + ")");
    ok(w.ceiling[0].length === 3,
        "A2 tick + A2 up splay + A3 tick (got " + w.ceiling[0].length + ")");

    var a2x = band.stations[1].x, a3x = band.stations[2].x;
    // 5 ft at 60 deg up: plan 2.5, forward along the passage
    near(w.ceiling[0][0].x, a2x, 1e-9, "the LRUD point leads, at its station");
    near(w.ceiling[0][1].x, a2x + 2.5, 1e-5,
        "the forward up splay sits its plan projection past the station");
    ok(w.ceiling[0][1].x < a3x, "and still short of the next station");

    // X must be non-decreasing along the run, or the wall zigzags
    var sorted = true;
    for (var i = 1; i < w.ceiling[0].length; i++) {
        if (w.ceiling[0][i].x < w.ceiling[0][i - 1].x - 1e-9) { sorted = false; }
    }
    ok(sorted, "ceiling points are ordered along the passage");

    // the backward down splay lands BEFORE its station's floor tick
    ok(w.floor[0][0].x < a2x, "a backward splay lands before its station");
}());

(function() {
    // a junction ends a run rather than guessing across it
    var sv = CsModel.newSurvey();
    var mk = function(f, t, az) {
        var s = shotOf(f, t, 10, az, 0);
        s.up = 3; s.down = 3;
        return s;
    };
    sv.shots = [mk("A1", "A2", 0), mk("A2", "A3", 0), mk("A3", "A4", 0),
        mk("A2", "A2a1", 90)];
    var r = CsNetwork.resolve(sv, {});
    var g = CsProfile.groupRuns(r);
    var band = CsProfile.unrollBand(g.runs["A"], null, r,
        CsProfile.hierarchy(g, r), {});
    var w = CsProfile.bandWallRuns(band, sv, r, {});

    // A1 has no LRUD, so it breaks an empty run. A2 is a junction (three
    // legs touch it) and ends its own run at one point, which is dropped
    // for being shorter than a line. A3-A4 is the surviving run -- and
    // the point of the test is that A2 is NOT joined to it.
    ok(w.ceiling.length === 1,
        "one surviving ceiling run (got " + w.ceiling.length + ")");
    ok(w.ceiling[0].length === 2, "and it is A3-A4 only");
    near(w.ceiling[0][0].x, band.stations[2].x, 1e-9,
        "the run starts at A3, not at the junction");

    // without the junction, the same survey gives ONE run of three
    var sv2 = CsModel.newSurvey();
    sv2.shots = [mk("A1", "A2", 0), mk("A2", "A3", 0), mk("A3", "A4", 0)];
    var r2 = CsNetwork.resolve(sv2, {});
    var g2 = CsProfile.groupRuns(r2);
    var w2 = CsProfile.bandWallRuns(
        CsProfile.unrollBand(g2.runs["A"], null, r2,
            CsProfile.hierarchy(g2, r2), {}), sv2, r2, {});
    ok(w2.ceiling.length === 1 && w2.ceiling[0].length === 3,
        "no junction: A2-A3-A4 is one run of three");
}());

(function() {
    // I2: no fallback to due north. A one-station band -- band.legs is
    // EMPTY, there is no leg at all to read a passage direction from --
    // must not invent one. Every splay's along-passage projection is
    // 0, so it sits at its own station's X. Before this fix, "no
    // measured direction" silently defaulted to azimuth 0 (north),
    // which spread these three splays (aimed 0/90/180 degrees) across
    // several feet of X nobody surveyed.
    var resolved = {
        stations: { A1: { x: 0, y: 0, z: 0, seq: 0 } },
        legs: []
    };
    var run = { key: "A", stations: ["A1"] };
    var band = CsProfile.unrollBand(run, null, resolved, {}, {});
    eqs(band.legs.length, 0, "fixture assumption: a one-station band has no legs at all");

    var sv = CsModel.newSurvey();
    sv.shots = [
        splayOf("A1", 5, 0, 60),
        splayOf("A1", 5, 90, 60),
        splayOf("A1", 5, 180, 60)
    ];
    var w = CsProfile.bandWallRuns(band, sv, resolved, {});
    eqs(w.ceiling.length, 1, "all three splays survive as one run");
    eqs(w.ceiling[0].length, 3, "one point per splay");
    for (var i = 0; i < w.ceiling[0].length; i++) {
        near(w.ceiling[0][i].x, 0, 1e-9,
            "no fabricated bearing: every splay sits at its own station's X");
    }
}());

(function() {
    // I2: a PLUMB leg's compass reading is noise, so a station reached
    // by one gets the SAME "no measured direction" treatment as a
    // one-station band -- every splay there sits at its own station's
    // X, and that holds even though A2 is ALSO the `from` end of a
    // perfectly ordinary next leg (which must not rescue it with the
    // OUTGOING azimuth either). Before this fix, a backward-facing
    // splay at the bottom of a pitch could be projected against a
    // noise bearing and land BEFORE the pitch-top station's own
    // points -- X is supposed to be monotonically non-decreasing along
    // a wall run (that is what "extended elevation" means), and this
    // broke it.
    var sv = CsModel.newSurvey();
    var top = shotOf("A1", "A2", 10, 30, 89);    // 89 degrees: PLUMB
    var s2 = shotOf("A2", "A3", 10, 0, 0);
    s2.up = 6;
    var backward = splayOf("A2", 5, 210, 60);    // steep AND facing back
    sv.shots = [top, s2, backward];
    var r = CsNetwork.resolve(sv, {});
    var g = CsProfile.groupRuns(r);
    var band = CsProfile.unrollBand(g.runs["A"], null, r,
        CsProfile.hierarchy(g, r), {});
    var w = CsProfile.bandWallRuns(band, sv, r, {});

    eqs(w.ceiling.length, 1, "one ceiling run across the pitch");
    eqs(w.ceiling[0].length, 2, "A2's own splay plus A3's LRUD tick");
    var sorted = true;
    for (var i = 1; i < w.ceiling[0].length; i++) {
        if (w.ceiling[0][i].x < w.ceiling[0][i - 1].x - 1e-9) { sorted = false; }
    }
    ok(sorted, "monotone X across a pitch, even with a backward-facing splay at the bottom");
    near(w.ceiling[0][0].x, band.stations[1].x, 1e-9,
        "the plumb-arrival station's own splay sits at exactly its own X, " +
        "not projected backward against a noise bearing");
}());

(function() {
    // I5, exact criterion wording: "the LRUD tick at 0 leading ties."
    // No existing fixture creates a genuine t-tie -- a zero-distance
    // splay does, in one line: CsTraverse.offset returns dx=dy=dz=0
    // for it regardless of azimuth or inclination, so it lands at
    // exactly t=0, the same along-passage position as the station's
    // own LRUD tick.
    var sv = CsModel.newSurvey();
    var s1 = shotOf("A1", "A2", 10, 0, 0);
    s1.up = 4;
    var zeroSplay = splayOf("A2", 0, 45, 60);   // zero distance, steep: ceiling, t=0
    sv.shots = [s1, zeroSplay];
    var r = CsNetwork.resolve(sv, {});
    var g = CsProfile.groupRuns(r);
    var band = CsProfile.unrollBand(g.runs["A"], null, r,
        CsProfile.hierarchy(g, r), {});
    var w = CsProfile.bandWallRuns(band, sv, r, {});

    eqs(w.ceiling.length, 1, "one ceiling run: the LRUD tick plus the tying splay");
    eqs(w.ceiling[0].length, 2, "both points survive -- both sit at the same X");
    var a2x = band.stations[1].x;
    near(w.ceiling[0][0].x, a2x, 1e-9, "both points sit at A2's X (a genuine tie)");
    near(w.ceiling[0][1].x, a2x, 1e-9, "both points sit at A2's X (a genuine tie)");
    near(w.ceiling[0][0].y, band.stations[1].z + 4, 1e-9,
        "the LRUD tick (order -1) leads the tie: it is U=4 above the station");
    near(w.ceiling[0][1].y, band.stations[1].z, 1e-9,
        "the zero-distance splay (order 0) follows: its own dz is 0");
}());

(function() {
    // I5: the no-evidence break must fire on a genuine INTERIOR
    // station, not just the band's own opening one (where flush() on
    // an already-empty accumulator is a no-op regardless of whether
    // the check exists at all -- every earlier fixture's evidence-less
    // station was the first one, which is why this is its own test).
    // A3 here has neither an LRUD tick nor a splay, splitting a
    // would-be one-run band into two.
    var sv = CsModel.newSurvey();
    var mk = function(f, t) {
        var s = shotOf(f, t, 10, 0, 0);
        s.up = 5;
        return s;
    };
    var noEvidenceLeg = shotOf("A2", "A3", 10, 0, 0);   // no up/down at all
    var a1Splay = splayOf("A1", 5, 0, 60);
    sv.shots = [mk("A1", "A2"), noEvidenceLeg, mk("A3", "A4"), mk("A4", "A5"), a1Splay];
    var r = CsNetwork.resolve(sv, {});
    var g = CsProfile.groupRuns(r);
    var band = CsProfile.unrollBand(g.runs["A"], null, r,
        CsProfile.hierarchy(g, r), {});
    var w = CsProfile.bandWallRuns(band, sv, r, {});

    eqs(w.ceiling.length, 2, "A3's own no-evidence break splits the band into two runs");
    eqs(w.ceiling[0].length, 2, "run 1: A1's splay plus A2's LRUD tick");
    eqs(w.ceiling[1].length, 2, "run 2: A4 and A5's own LRUD ticks");
    near(w.ceiling[1][0].x, band.stations[3].x, 1e-9,
        "run 2 opens at A4, not somehow bridged from A2 across A3's gap");
}());

(function() {
    // I5: the total-order tiebreak between two DISTINCT splays (not
    // just an LRUD tick vs a splay, covered separately above). Built
    // to tie EXACTLY, not approximately -- an approximate tie would
    // just sort by whichever t is numerically smaller and never touch
    // the comparator's order-based tiebreak line at all, so a mutation
    // that broke or reversed that line would go uncaught. Both splays
    // share azimuth 0 against a passage azimuth of 0 (both exact, no
    // rounding at all), so each one's t equals its own plan projection
    // exactly; d2 is chosen so the two plan projections round-trip to
    // the SAME double, verified as a fixture assumption below rather
    // than assumed.
    var d1 = 5, inc1 = 60;
    var plan1 = d1 * Math.cos(inc1 * Math.PI / 180);
    var inc2 = 30;
    var c2 = Math.cos(inc2 * Math.PI / 180);
    var d2 = plan1 / c2;
    ok(d1 * Math.cos(inc1 * Math.PI / 180) === d2 * c2,
        "fixture assumption: the two splays' plan projections tie exactly");

    var sv = CsModel.newSurvey();
    var s1 = shotOf("A1", "A2", 10, 0, 0);
    var spA = splayOf("A2", d1, 0, inc1);   // order 0, steeper: more U
    var spB = splayOf("A2", d2, 0, inc2);   // order 1, same plan projection
    sv.shots = [s1, spA, spB];
    var r = CsNetwork.resolve(sv, {});
    var g = CsProfile.groupRuns(r);
    var band = CsProfile.unrollBand(g.runs["A"], null, r,
        CsProfile.hierarchy(g, r), {});
    var w = CsProfile.bandWallRuns(band, sv, r, {});

    eqs(w.ceiling.length, 1, "one ceiling run: the two tying splays");
    eqs(w.ceiling[0].length, 2, "both survive -- a comparator returning 0 would not drop either");
    near(w.ceiling[0][0].x, w.ceiling[0][1].x, 1e-9, "both sit at the same X -- this IS the tie");
    ok(w.ceiling[0][0].y !== w.ceiling[0][1].y,
        "fixture assumption: they are DISTINCT points (different U), not a no-op tie");
    ok(w.ceiling[0][0].y > w.ceiling[0][1].y,
        "order breaks the tie by splay index: spA (order 0, steeper -- higher U) leads spB (order 1)");
}());

(function() {
    // I5: the default 10 degree dead zone, and a custom flatSplayDeg
    // actually changing bandWallRuns' own output (not just
    // classifySplay in isolation, already covered above). A 7 degree
    // splay is flat under the default, but a real ceiling hit once the
    // caller narrows the dead zone to 5.
    var sv = CsModel.newSurvey();
    var s1 = shotOf("A1", "A2", 10, 0, 0);
    s1.up = 6;
    var s2 = shotOf("A2", "A3", 10, 0, 0);
    s2.up = 6;
    var sp = splayOf("A2", 5, 0, 7);
    sv.shots = [s1, s2, sp];
    var r = CsNetwork.resolve(sv, {});
    var g = CsProfile.groupRuns(r);
    var band = CsProfile.unrollBand(g.runs["A"], null, r,
        CsProfile.hierarchy(g, r), {});

    var wDefault = CsProfile.bandWallRuns(band, sv, r, {});
    eqs(wDefault.flat.length, 1, "default 10 deg dead zone: a 7 deg splay is flat");
    eqs(wDefault.ceiling[0].length, 2, "...only the two LRUD ticks join the ceiling");

    var wNarrow = CsProfile.bandWallRuns(band, sv, r, { flatSplayDeg: 5 });
    eqs(wNarrow.flat.length, 0, "custom 5 deg dead zone: the same 7 deg splay clears it");
    eqs(wNarrow.ceiling[0].length, 3, "...and joins the ceiling run instead");
}());

(function() {
    // I5: D===0 draws a floor point at the station (the wall is AT the
    // station), and null U draws nothing at all -- the mirror image of
    // the existing "U===0, D===null" fixture above, so both directions
    // of the null-vs-zero rule are independently exercised.
    var sv = CsModel.newSurvey();
    var s1 = shotOf("A1", "A2", 10, 0, 0);
    s1.up = null; s1.down = 0;
    var s2 = shotOf("A2", "A3", 10, 0, 0);
    s2.up = null; s2.down = 0;
    sv.shots = [s1, s2];
    var r = CsNetwork.resolve(sv, {});
    var g = CsProfile.groupRuns(r);
    var band = CsProfile.unrollBand(g.runs["A"], null, r,
        CsProfile.hierarchy(g, r), {});
    var w = CsProfile.bandWallRuns(band, sv, r, {});
    near(w.floor[0][0].y, band.stations[1].z, 1e-9,
        "D of 0 is a floor point at the station");
    ok(w.ceiling.length === 0, "null U draws no ceiling at all");
}());

(function() {
    // I5: floor runs shorter than 2 points are dropped, checked
    // INDEPENDENTLY of ceiling -- a mutation could weaken floor's own
    // threshold (e.g. >=1) while leaving ceiling's correct, and no
    // existing fixture asserts on w.floor's length on its own.
    var sv = CsModel.newSurvey();
    var s1 = shotOf("A1", "A2", 10, 0, 0);
    s1.down = 3;   // A2's only floor evidence anywhere in this survey
    sv.shots = [s1];
    var r = CsNetwork.resolve(sv, {});
    var g = CsProfile.groupRuns(r);
    var band = CsProfile.unrollBand(g.runs["A"], null, r,
        CsProfile.hierarchy(g, r), {});
    var w = CsProfile.bandWallRuns(band, sv, r, {});
    eqs(w.floor.length, 0, "a single floor point is dropped for being shorter than a line");
}());

(function() {
    // I5: a junction station's own point is INCLUDED in the run it
    // terminates -- the docblock's explicit claim, previously only
    // exercised where the junction's own point formed a LONE 1-point
    // run that got dropped anyway (indistinguishable from exclusion).
    // Here A2 supplies a first point so A3's own tick joins a real
    // 2-point run before that run is cut off.
    var sv = CsModel.newSurvey();
    var mk = function(f, t, az) {
        var s = shotOf(f, t, 10, az, 0);
        s.up = 5;
        return s;
    };
    sv.shots = [mk("A1", "A2", 0), mk("A2", "A3", 0), mk("A3", "A4", 0),
        mk("A3", "A3a1", 90)];
    var r = CsNetwork.resolve(sv, {});
    var g = CsProfile.groupRuns(r);
    var band = CsProfile.unrollBand(g.runs["A"], null, r,
        CsProfile.hierarchy(g, r), {});
    var w = CsProfile.bandWallRuns(band, sv, r, {});

    eqs(w.ceiling.length, 1, "one run survives");
    eqs(w.ceiling[0].length, 2, "A2's tick AND A3's own tick -- the junction's point is included");
    near(w.ceiling[0][1].x, band.stations[2].x, 1e-9,
        "the second point is A3 itself, not dropped from the run it ends");
}());

(function() {
    // I5: passage azimuth must come from the ARRIVING leg, not the
    // outgoing one -- every earlier fixture uses azimuth 0 throughout,
    // which cannot tell the two apart. A2 is reached going north
    // (azimuth 0) and leaves going east (azimuth 90); a splay aimed
    // east at A2 is ALONG the outgoing leg but PERPENDICULAR to the
    // arriving one. Using the wrong leg's azimuth would give it a
    // large nonzero along-passage projection instead of ~0.
    var sv = CsModel.newSurvey();
    var s1 = shotOf("A1", "A2", 10, 0, 0);    // arrives heading north (az 0)
    s1.up = 6;
    var s2 = shotOf("A2", "A3", 10, 90, 0);   // leaves heading east (az 90)
    var sp = splayOf("A2", 5, 90, 45);        // aimed east: along the OUTGOING leg
    sv.shots = [s1, s2, sp];
    var r = CsNetwork.resolve(sv, {});
    var g = CsProfile.groupRuns(r);
    var band = CsProfile.unrollBand(g.runs["A"], null, r,
        CsProfile.hierarchy(g, r), {});
    var w = CsProfile.bandWallRuns(band, sv, r, {});

    eqs(w.ceiling.length, 1, "A2's tick plus its splay");
    eqs(w.ceiling[0].length, 2, "A3 has no evidence of its own, so the run ends right after A2");
    near(w.ceiling[0][1].x, band.stations[1].x, 1e-6,
        "the splay uses the ARRIVING leg's azimuth (north): aimed east, it projects to ~0, " +
        "not the large offset the OUTGOING leg's azimuth (east) would give it");
}());

(function() {
    // I5: upAll/downAll are never read, even when populated -- a
    // multi-reading LRUD ("5/10" describing a ledge) still contributes
    // exactly one ceiling and one floor point, from up/down alone.
    var sv = CsModel.newSurvey();
    var s1 = shotOf("A1", "A2", 10, 0, 0);
    s1.up = 4;
    s1.upAll = [500, 999];      // if this were ever read, y would be way off
    s1.down = 2;
    s1.downAll = [500, 999];
    var s2 = shotOf("A2", "A3", 10, 0, 0);
    s2.up = 4; s2.down = 2;
    sv.shots = [s1, s2];
    var r = CsNetwork.resolve(sv, {});
    var g = CsProfile.groupRuns(r);
    var band = CsProfile.unrollBand(g.runs["A"], null, r,
        CsProfile.hierarchy(g, r), {});
    var w = CsProfile.bandWallRuns(band, sv, r, {});
    near(w.ceiling[0][0].y, band.stations[1].z + 4, 1e-9,
        "ceiling Y comes from up (4), never upAll");
    near(w.floor[0][0].y, band.stations[1].z - 2, 1e-9,
        "floor Y comes from down (2), never downAll");
}());

(function() {
    // I5: flat tick naming is <station>.<n>, 1-indexed by the splay's
    // OWN position among ALL splays at that station (not among just
    // the flat ones) -- matching CsDraw's own numbering, which later
    // tasks cross-reference. Four splays alternate ceiling/flat/floor/
    // flat: the flat ticks must be A2.2 and A2.4.
    var sv = CsModel.newSurvey();
    var s1 = shotOf("A1", "A2", 10, 0, 0);
    var sps = [
        splayOf("A2", 5, 0, 45),      // 1st: ceiling
        splayOf("A2", 5, 90, 3),      // 2nd: flat -> A2.2
        splayOf("A2", 5, 180, -45),   // 3rd: floor
        splayOf("A2", 5, 270, 5)      // 4th: flat -> A2.4
    ];
    sv.shots = [s1].concat(sps);
    var r = CsNetwork.resolve(sv, {});
    var g = CsProfile.groupRuns(r);
    var band = CsProfile.unrollBand(g.runs["A"], null, r,
        CsProfile.hierarchy(g, r), {});
    var w = CsProfile.bandWallRuns(band, sv, r, {});

    eqs(w.flat.length, 2, "two flat splays out of the four");
    eqs(w.flat[0].name, "A2.2", "the 2nd splay overall, not the 1st flat one");
    eqs(w.flat[1].name, "A2.4", "the 4th splay overall, not the 2nd flat one");
}());

(function() {
    // m2: a splay with NO inclination on record must be skipped
    // outright, not plotted as a flat tick at exactly centerline
    // elevation -- a fabricated coordinate for a measurement that was
    // never taken, at precisely the level the dead-zone rationale
    // calls meaningless.
    var sv = CsModel.newSurvey();
    var s1 = shotOf("A1", "A2", 10, 0, 0);
    var noInc = splayOf("A2", 5, 0, 0);
    noInc.inclination = null;
    sv.shots = [s1, noInc];
    var r = CsNetwork.resolve(sv, {});
    var g = CsProfile.groupRuns(r);
    var band = CsProfile.unrollBand(g.runs["A"], null, r,
        CsProfile.hierarchy(g, r), {});
    var w = CsProfile.bandWallRuns(band, sv, r, {});
    eqs(w.flat.length, 0, "a no-inclination splay contributes no tick at all");
    eqs(w.ceiling.length, 0, "...and obviously no ceiling either");
    eqs(w.floor.length, 0, "...nor floor");
    eqs(w.skipped, 1,
        "review I2: a no-inclination splay is counted as skipped too -- " +
        "the old m2 pre-guard continued past this counter and undercounted");
}());

(function() {
    // review I2's exact repro: two unmeasurable splays, one missing
    // inclination, one missing distance -- bandWallRuns.skipped must
    // match CsLrud.wallRuns.skipped on the equivalent plan-side data,
    // which it did not while the m2 pre-guard bypassed the counter.
    var sv = CsModel.newSurvey();
    var s1 = shotOf("A1", "A2", 10, 0, 0);
    var noInc = splayOf("A2", 5, 0, 0);
    noInc.inclination = null;
    var noDist = splayOf("A2", 5, 90, 30);
    noDist.distance = undefined;
    sv.shots = [s1, noInc, noDist];
    var r = CsNetwork.resolve(sv, {});
    var g = CsProfile.groupRuns(r);
    var band = CsProfile.unrollBand(g.runs["A"], null, r,
        CsProfile.hierarchy(g, r), {});
    var w = CsProfile.bandWallRuns(band, sv, r, {});
    eqs(w.skipped, 2,
        "review I2: both unmeasurable splays are counted, not just the " +
        "no-distance one");
}());

(function() {
    // Task 5b: the m2 guard above only ever caught a missing
    // INCLINATION (checked before bandWallRuns ever calls
    // CsTraverse.offset). A missing DISTANCE, or a missing AZIMUTH,
    // sailed straight past that pre-check and into offset() itself --
    // which, before CsTraverse.offset's own guard, either fabricated a
    // point at the station (null distance) or handed back NaN
    // (undefined distance/azimuth). Same rule, the other missing
    // fields: no ceiling point, no flat tick, and bandWallRuns counts
    // what it skipped.
    var sv = CsModel.newSurvey();
    var s1 = shotOf("A1", "A2", 10, 0, 0);
    s1.up = 4;
    var real = splayOf("A2", 5, 45, 60);       // a genuine ceiling hit
    var ghostDist = splayOf("A2", 5, 60, 60);
    ghostDist.distance = undefined;            // missing distance
    var ghostAz = splayOf("A2", 5, 30, 60);
    ghostAz.azimuth = null;                    // missing azimuth
    sv.shots = [s1, real, ghostDist, ghostAz];
    var r = CsNetwork.resolve(sv, {});
    var g = CsProfile.groupRuns(r);
    var band = CsProfile.unrollBand(g.runs["A"], null, r,
        CsProfile.hierarchy(g, r), {});
    var w = CsProfile.bandWallRuns(band, sv, r, {});

    eqs(w.ceiling.length, 1,
        "one ceiling run: the LRUD tick plus the ONE real splay");
    eqs(w.ceiling[0].length, 2,
        "the missing-distance and missing-azimuth splays add no point");
    eqs(w.flat.length, 0,
        "an unmeasurable splay does not fall back to a flat tick either");
    eqs(w.skipped, 2,
        "bandWallRuns counts both unmeasurable splays as skipped");

    // REGRESSION, the distinction the whole task turns on: a REAL
    // zero-distance splay at this same station must still place a
    // ceiling point exactly as it always has.
    var sv2 = CsModel.newSurvey();
    var s1b = shotOf("A1", "A2", 10, 0, 0);
    s1b.up = 4;
    var zeroSplay = splayOf("A2", 0, 45, 60);
    sv2.shots = [s1b, zeroSplay];
    var r2 = CsNetwork.resolve(sv2, {});
    var g2 = CsProfile.groupRuns(r2);
    var band2 = CsProfile.unrollBand(g2.runs["A"], null, r2,
        CsProfile.hierarchy(g2, r2), {});
    var w2 = CsProfile.bandWallRuns(band2, sv2, r2, {});
    eqs(w2.ceiling.length, 1,
        "a REAL zero-distance splay still ties into the ceiling run");
    eqs(w2.skipped, 0, "...and is not counted as skipped -- zero is a " +
        "measurement");
}());

(function() {
    // I4: the invariant is now structural, not just documented. A band
    // built with exaggeration 5 -- its own station Y already scaled up
    // accordingly -- must scale its wall points the SAME way even when
    // bandWallRuns is called with a DIFFERENT (or missing) exaggeration
    // in its own opts; it reads exaggeration/tapeMode off `band` itself
    // now, not off opts. The rise is real (inc 30, not level) so the
    // station's own Y is meaningfully amplified by the x5: under the
    // OLD bug (bandWallRuns re-deriving Y from its own, mismatched
    // opts.exaggeration default of 1), the ceiling would compute to Y
    // 9 while the station itself sits at Y 25 -- a ceiling drawn BELOW
    // its own station, measured exactly as the review reported it.
    var sv = CsModel.newSurvey();
    var s1 = shotOf("A1", "A2", 10, 0, 30);   // rise = 10*sin(30) = 5
    s1.up = 4;
    var s2 = shotOf("A2", "A3", 10, 0, 30);   // A2 alone is <2 points and gets dropped
    s2.up = 4;
    sv.shots = [s1, s2];
    var r = CsNetwork.resolve(sv, {});
    var g = CsProfile.groupRuns(r);
    var band = CsProfile.unrollBand(g.runs["A"], null, r,
        CsProfile.hierarchy(g, r), { exaggeration: 5 });
    eqs(band.exaggeration, 5, "fixture assumption: the band records its own exaggeration");
    var a2 = band.stations[1];
    near(a2.y, band.datum + 5 * 5, 1e-9,
        "fixture assumption: A2's own Y is scaled by the band's exaggeration");

    // opts.exaggeration here is deliberately absent (defaults to 1) --
    // a mismatch against the band's own 5, on purpose
    var w = CsProfile.bandWallRuns(band, sv, r, {});
    near(w.ceiling[0][0].y, band.datum + (5 + 4) * 5, 1e-9,
        "ceiling scales by the BAND's exaggeration (5), not opts' mismatched default (1)");
    ok(w.ceiling[0][0].y > a2.y,
        "the ceiling point stays above its own (already-scaled) station -- " +
        "a mismatched opts used to be able to put it below");
}());

// ---------------------------------------------------------------------
// Task 5: bandSpan.
// ---------------------------------------------------------------------

(function() {
    // stations, ceiling, floor AND flat all count -- a mutation that
    // drops any one of the four would still pass a span check that
    // never puts the widest evidence in a line the other three miss.
    var band = {
        stations: [{ y: 5 }, { y: 10 }],
        ceiling: [[{ y: 12 }]],
        floor: [[{ y: -3 }]],
        flat: [{ y: 20 }]
    };
    var span = CsProfile.bandSpan(band);
    ok(span !== null, "a band with evidence has a span");
    eqs(span.lo, -3, "lo comes from the floor point, the lowest of the four sources");
    eqs(span.hi, 20, "hi comes from the flat tick, the highest of the four sources");
}());

(function() {
    // a band with nothing drawn at all -- no stations, no walls --
    // reports no span, not a span of zero, so layout() knows to leave
    // it alone rather than treat "nothing" as "flat at zero"
    var band = { stations: [], ceiling: [], floor: [], flat: [] };
    ok(CsProfile.bandSpan(band) === null, "an empty band has no span");
}());

(function() {
    // COUPLING: bandSpan is only ever called on a band CsProfile.build
    // has already given ceiling/floor/flat to. Called on a raw
    // unrollBand() result (or any hand-built band missing those three
    // fields) it must still answer from stations alone, not throw.
    var band = { stations: [{ y: 7 }] };
    var span = CsProfile.bandSpan(band);
    ok(span !== null, "missing ceiling/floor/flat does not crash bandSpan");
    eqs(span.lo, 7, "a single station is its own lo");
    eqs(span.hi, 7, "and its own hi -- a degenerate, zero-height span");
}());

// ---------------------------------------------------------------------
// Task 5: layout.
// ---------------------------------------------------------------------

(function() {
    // a band that clears the stack, above or below, keeps zOffset 0
    // and widens the tracked range in that direction
    var below = { stations: [{ y: -2 }, { y: 2 }] };
    var above = { stations: [{ y: 10 }, { y: 20 }] };
    var lower = { stations: [{ y: -20 }, { y: -10 }] };
    CsProfile.layout([below, above, lower]);
    eqs(below.zOffset, 0, "the first band placed sits at true elevation");
    eqs(above.zOffset, 0, "a band clearing above the stack is not displaced");
    eqs(lower.zOffset, 0, "a band clearing below the stack is not displaced either");

    // clearing must actually WIDEN the tracked range, not just skip the
    // clearing band's own offset: a fourth band overlapping the RANGE
    // "above" just claimed has to collide against THAT top, not against
    // whatever the stack's top was before "above" was placed.
    var b0 = { stations: [{ y: -2 }, { y: 2 }] };
    var b1 = { stations: [{ y: 10 }, { y: 20 }] };
    var b2 = { stations: [{ y: 19 }, { y: 21 }] };
    CsProfile.layout([b0, b1, b2]);
    eqs(b0.zOffset, 0, "b0 at true elevation");
    eqs(b1.zOffset, 0, "b1 clears above b0 and widens the tracked top to 20");
    ok(b2.zOffset < 0,
        "b2 overlaps b1's range (19-21 against b1's 10-20) and must collide, " +
        "even though it clears the ORIGINAL top (b0's 2) fine");
}());

(function() {
    // bandSpan is called exactly once per band inside layout -- the
    // median is computed from spans already in hand, not by asking
    // bandSpan for the same band's span a second time.
    var real = CsProfile.bandSpan;
    var calls = 0;
    CsProfile.bandSpan = function(band) {
        calls++;
        return real(band);
    };
    try {
        var b0 = { stations: [{ y: -2 }, { y: 2 }] };
        var b1 = { stations: [{ y: -2 }, { y: 2 }] };
        var b2 = { stations: [{ y: -2 }, { y: 2 }] };
        CsProfile.layout([b0, b1, b2]);
        eqs(calls, 3,
            "bandSpan called exactly once per band, not once more per " +
            "collision to compute the median separately");
    } finally {
        CsProfile.bandSpan = real;
    }
}());

(function() {
    // three bands with the SAME span (height 4, so half their MEDIAN is
    // 2, floored to GUTTER_MIN 5): each collision pushes below the
    // lowest point placed so far by that one constant gutter -- not by
    // some ever-growing amount, and not all crammed against the very
    // first band.
    var b0 = { stations: [{ y: -2 }, { y: 2 }] };
    var b1 = { stations: [{ y: -2 }, { y: 2 }] };
    var b2 = { stations: [{ y: -2 }, { y: 2 }] };
    CsProfile.layout([b0, b1, b2]);
    eqs(b0.zOffset, 0, "b0 placed first, at true elevation");
    eqs(b1.zOffset, -(4 + CsProfile.GUTTER_MIN),
        "b1 pushed one gutter below b0's bottom, plus its own height");
    eqs(b2.zOffset, -(8 + 2 * CsProfile.GUTTER_MIN),
        "b2 pushed the same gutter below b1, not stacked on b0");
    // measured, not merely asserted: the gap between consecutive placed
    // bands is exactly the gutter once each band's own height is netted
    // out, for every pair, not just the first collision
    var b0Bottom = -2 + b0.zOffset, b1Top = 2 + b1.zOffset;
    var b1Bottom = -2 + b1.zOffset, b2Top = 2 + b2.zOffset;
    near(b0Bottom - b1Top, CsProfile.GUTTER_MIN, 1e-9,
        "gap between b0 and b1 is one gutter");
    near(b1Bottom - b2Top, CsProfile.GUTTER_MIN, 1e-9,
        "gap between b1 and b2 is the same one gutter, not a growing one");
}());

(function() {
    // a degenerate, zero-height band (a single station, or a dead-level
    // passage) still gets GUTTER_MIN, not a zero gutter that would land
    // two bands on the very same line -- half of a zero median is
    // still floored at GUTTER_MIN
    var b0 = { stations: [{ y: 0 }, { y: 0 }] };
    var b1 = { stations: [{ y: 0 }, { y: 0 }] };
    CsProfile.layout([b0, b1]);
    eqs(b0.zOffset, 0, "b0 at true elevation");
    eqs(b1.zOffset, -CsProfile.GUTTER_MIN,
        "a zero-height collision still pushes down by GUTTER_MIN, not by nothing");
}());

(function() {
    // I3, THE n=2 CASE: a median-of-the-whole-profile rule was tried
    // here first and FAILED at exactly this size -- the median of two
    // values [4, 2000] IS 1002, so half of it (501) still left the
    // 4-unit band with a gutter 125x its own height, merely 4x smaller
    // than the height-based rule it replaced. Two runs is the commonest
    // small-cave shape there is, so this is not an edge case to wave
    // off. The fix anchors to a LOW order statistic (nearest-rank,
    // index ceil(0.25n)-1) instead: at n=2 that index is 0, the
    // SMALLER of the two heights, so the gutter is half of 4 (floored
    // to GUTTER_MIN=5), not half of 1002.
    var normal = { stations: [{ y: -2 }, { y: 2 }] };
    var huge = { stations: [{ y: -1000 }, { y: 1000 }] };
    CsProfile.layout([normal, huge]);
    eqs(normal.zOffset, 0, "the ordinary band sits at true elevation");
    eqs(huge.zOffset, -(1002 + CsProfile.GUTTER_MIN),
        "gutter is GUTTER_MIN (anchored to the small band's height 4, " +
        "not the median of the pair, 1002)");
    var hugeTop = 1000 + huge.zOffset;
    near(normal.stations[0].y - hugeTop, CsProfile.GUTTER_MIN, 1e-9,
        "the blank gutter is one GUTTER_MIN, not 501 -- anchored to the small " +
        "band, not split down the middle with the outlier");
}());

(function() {
    // I3, THE n=4 CASE FROM THE SAME REVIEW: two small bands and two
    // huge ones, [4, 4, 2000, 2000]. A median-of-four here averages the
    // two middle (sorted) values, (4+2000)/2 = 1002 -- the SAME failure
    // as n=2, restated. The low order statistic used instead lands on
    // index ceil(0.25*4)-1 = 0, the smallest value (4), so the gutter
    // stays anchored to the small bands even though they are outnumbered.
    var s0 = { stations: [{ y: -2 }, { y: 2 }] };       // small, height 4
    var s1 = { stations: [{ y: -2 }, { y: 2 }] };       // small, height 4
    var h0 = { stations: [{ y: -1000 }, { y: 1000 }] }; // huge, height 2000
    var h1 = { stations: [{ y: -1000 }, { y: 1000 }] }; // huge, height 2000
    CsProfile.layout([s0, s1, h0, h1]);
    eqs(s0.zOffset, 0, "s0 placed first, at true elevation");
    eqs(s1.zOffset, -(4 + CsProfile.GUTTER_MIN),
        "s1 collides with s0: one gutter plus s0's own height(4)");
    eqs(h0.zOffset, -(1006 + 2 * CsProfile.GUTTER_MIN),
        "h0's gutter is still GUTTER_MIN, anchored to the small " +
        "bands, not a median of 1002 pulled up by its own huge neighbour");
    eqs(h1.zOffset, -(3006 + 3 * CsProfile.GUTTER_MIN),
        "h1's gutter is also GUTTER_MIN -- two huge bands in the " +
        "profile do not move the statistic off the small ones");
}());

(function() {
    // THE CASE THAT DISTINGUISHES THE LOW QUANTILE FROM A MEAN: one
    // band's height is enormous (2000) and four out of five bands are
    // small (4). The chosen statistic (index ceil(0.25*5)-1 = 1 into
    // [4,4,4,4,2000] sorted) is 4, so the gutter stays GUTTER_MIN (half
    // of 4 is 2, floored to 5) -- the separation follows the small
    // bands, not the outlier. A MEAN would instead average to
    // (4*4+2000)/5 = 403.2, giving a gutter of ~201.6 and failing every
    // assertion below.
    var b0 = { stations: [{ y: -2 }, { y: 2 }] };       // normal, height 4
    var b1 = { stations: [{ y: -1000 }, { y: 1000 }] }; // the one huge band
    var b2 = { stations: [{ y: -2 }, { y: 2 }] };       // normal
    var b3 = { stations: [{ y: -2 }, { y: 2 }] };       // normal
    var b4 = { stations: [{ y: -2 }, { y: 2 }] };       // normal
    CsProfile.layout([b0, b1, b2, b3, b4]);

    eqs(b0.zOffset, 0, "b0 placed first, at true elevation");
    eqs(b1.zOffset, -(1002 + CsProfile.GUTTER_MIN),
        "the huge band is pushed by GUTTER_MIN (the statistic stays 4, " +
        "gutter floors to GUTTER_MIN), not by its own height or a mean-inflated one");
    eqs(b2.zOffset, -(2004 + 2 * CsProfile.GUTTER_MIN),
        "b2's gutter below the huge band is still one plain gutter");
    eqs(b3.zOffset, -(2008 + 3 * CsProfile.GUTTER_MIN),
        "b3's gutter is constant, not growing");
    eqs(b4.zOffset, -(2012 + 4 * CsProfile.GUTTER_MIN),
        "b4's gutter is unchanged -- the statistic never moved");

    // every consecutive gap is exactly GUTTER_MIN, including the one
    // straddling the huge band -- the outlier changes ITS OWN offset,
    // never the separation applied to its neighbours
    var bottom = function(b) { return -2 + b.zOffset; };
    var top = function(b, hi) { return hi + b.zOffset; };
    near(bottom(b0) - top(b1, 1000), CsProfile.GUTTER_MIN, 1e-9,
        "gap straddling the huge band is still one plain gutter");
    near((-1000 + b1.zOffset) - top(b2, 2), CsProfile.GUTTER_MIN, 1e-9,
        "gap after the huge band is the same gutter, unaffected by it");
    near(bottom(b2) - top(b3, 2), CsProfile.GUTTER_MIN, 1e-9,
        "gap between two ordinary bands, unchanged");
    near(bottom(b3) - top(b4, 2), CsProfile.GUTTER_MIN, 1e-9,
        "and the next one -- the gutter never drifts");
}());

// ---------------------------------------------------------------------
// Task 5: CsProfile.build -- laying the whole profile out.
// ---------------------------------------------------------------------

(function() {
    // two runs at the same elevation: the second must be pushed down
    var sv = CsModel.newSurvey();
    var mk = function(f, t, az) {
        var s = shotOf(f, t, 10, az, 0);
        s.up = 2; s.down = 2;
        return s;
    };
    sv.shots = [mk("A1", "A2", 0), mk("A2", "A3", 0),
        mk("A2", "B1", 90), mk("B1", "B2", 90)];
    var r = CsNetwork.resolve(sv, {});
    var p = CsProfile.build(sv, r, {});

    ok(p.bands.length === 2, "two bands built");
    ok(p.bands[0].key === "A", "A is first");
    ok(p.bands[0].zOffset === 0, "the first band sits at true elevation");
    ok(p.bands[1].zOffset < 0, "the colliding band is pushed down");

    // band.parent: the root carries no parent, the child carries the
    // run it hangs off -- a mutation dropping this assignment entirely
    // would still leave every OTHER assertion in this file green.
    eqs(p.bands[0].parent, null, "A, the root, has no parent");
    eqs(p.bands[1].parent, "A", "B hangs off A");

    // I5: build() could return every band with ceiling/floor/flat
    // emptied out and this suite would not notice without an assertion
    // on ACTUAL wall content, not just that the arrays exist. Band A's
    // own ceiling/floor both end up empty in this fixture (A2 is a
    // three-leg junction, so A1/A2/A3 each contribute at most a lone,
    // sub-2-point run that CsProfile.bandWallRuns drops) -- band B is
    // the one with real, multi-point wall evidence here.
    eqs(p.bands[1].ceiling.length, 1, "B has one ceiling run");
    eqs(p.bands[1].ceiling[0].length, 2, "of two points (B1, B2 -- U=2 each)");
    eqs(p.bands[1].ceiling[0][0].y, 2, "the first ceiling point sits at U above datum");
    eqs(p.bands[1].floor.length, 1, "B has one floor run");
    eqs(p.bands[1].floor[0].length, 2, "of two points (B1, B2 -- D=2 each)");
    eqs(p.bands[1].floor[0][0].y, -2, "the first floor point sits at D below datum");

    // I6: a report printing "stopped at null" for a band that never
    // stopped is exactly as wrong as failing to report one that did --
    // this fixture is healthy end to end, so findings.stopped must be
    // reported as empty, not merely never checked.
    eqs(p.findings.stopped.length, 0, "a healthy two-band profile stops nowhere");

    // every leg drawn appears in at most one band -- no leg is EVER
    // drawn twice. A single canonical key (station names in a fixed
    // order) makes this ONE equality check per leg instead of a
    // bundled "not forward AND not backward" pair. In THIS fixture (no
    // interior tie, nothing demoted) that also means every leg is
    // drawn exactly once; see the separate interior-tie fixture below
    // for the general case, where a demoted arm's legs are drawn in NO
    // band at all.
    var seen = {}, total = 0;
    for (var b = 0; b < p.bands.length; b++) {
        for (var l = 0; l < p.bands[b].legs.length; l++) {
            var leg = p.bands[b].legs[l];
            var canon = (leg.from < leg.to) ?
                (leg.from + "->" + leg.to) : (leg.to + "->" + leg.from);
            ok(seen[canon] === undefined, "leg " + canon + " drawn once only");
            seen[canon] = true;
            total++;
        }
    }
    ok(total === 4, "all four legs drawn, none lost (no demotion in this fixture)");

    // C2: nothing left over to explain either -- every leg the survey
    // resolved was drawn, so findings.undrawn is empty, not merely
    // unchecked.
    eqs(p.findings.undrawn.length, 0, "all four legs drawn: nothing undrawn to report");
    // review I3: nothing unmeasurable in this fixture either
    eqs(p.findings.wallPointsSkipped, 0,
        "a healthy profile with nothing unmeasurable reports 0, not undefined");
}());

(function() {
    // review I3: bandWallRuns already counts what it could not place;
    // build() must SUM that across every band into findings, or the
    // count dies at the only entry point Tasks 8-11 will ever call.
    // Two bands, one unmeasurable splay each, so a bug that reads only
    // the LAST band's count (instead of summing) would still show 1.
    var sv = CsModel.newSurvey();
    var mk = function(f, t, az) {
        var s = shotOf(f, t, 10, az, 0);
        s.up = 2; s.down = 2;
        return s;
    };
    sv.shots = [mk("A1", "A2", 0), mk("A2", "A3", 0), mk("A2", "B1", 90)];
    var ghostA = splayOf("A3", 5, 90, 60);
    ghostA.distance = null;
    var ghostB = splayOf("B1", 5, 90, 60);
    ghostB.azimuth = undefined;
    sv.shots.push(ghostA, ghostB);
    var r = CsNetwork.resolve(sv, {});
    var p = CsProfile.build(sv, r, {});
    eqs(p.findings.wallPointsSkipped, 2,
        "review I3: summed across BOTH bands, not just the last one built");
}());

(function() {
    // findings are collected, not silently dropped
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A13", "A14", 10, 0, 0),
        shotOf("A14", "A13a1", 5, 90, 0),
        shotOf("A14", "A15", 10, 0, 0),
        shotOf("A14", "A99", 3, 270, 0)
    ];
    var r = CsNetwork.resolve(sv, {});
    var p = CsProfile.build(sv, r, {});
    ok(p.findings.mismatches.length === 1, "tie mismatch survives into findings");
    ok(p.findings.omitted.length >= 1, "off-chain station reported");
}());

(function() {
    // I1: "every leg is drawn, or has an endpoint in some band's
    // `omitted`" was fuzzed over 20,000 random surveys and FAILED in
    // 17% of them -- closure and cross-run-tie legs touch no omitted
    // station at all, they are simply never candidates for any band's
    // chain, and in 2,738 of those failures there was no `stopped`
    // finding either to explain them some other way. Now that C2's
    // findings.undrawn exists, THAT is the invariant this file stands
    // behind: no leg is EVER drawn in more than one band, and every
    // undrawn leg is named, with a reason, in findings.undrawn --
    // nothing is simply unaccounted for.
    //
    // This fixture demonstrates the specific case Task 3's interior-tie
    // fix introduced: a run entered at an interior junction demotes its
    // shorter arm (B1-B5-B6-B7) to `omitted`, and none of that arm's
    // legs are drawn in ANY band -- drawing them would need a second
    // copy of B1 that was never surveyed twice.
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A1", "A2", 10, 0, 0),
        shotOf("A2", "A3", 10, 0, 0),
        shotOf("A3", "B1", 8, 90, 0),
        shotOf("B1", "B2", 10, 0, 0),
        shotOf("B2", "B3", 10, 90, 0),
        shotOf("B3", "B4", 10, 90, 0),
        shotOf("B1", "B5", 10, 180, 0),
        shotOf("B5", "B6", 10, 270, 0),
        shotOf("B6", "B7", 10, 270, 0)
    ];
    var r = CsNetwork.resolve(sv, {});
    var p = CsProfile.build(sv, r, {});
    eqs(p.bands.length, 2, "fixture assumption: run A and run B");

    // no leg is ever drawn in more than one band -- one canonical key
    // per leg, one equality check, not a bundled "not forward AND not
    // backward" pair
    var seen = {}, drawn = 0;
    for (var b = 0; b < p.bands.length; b++) {
        for (var l = 0; l < p.bands[b].legs.length; l++) {
            var leg = p.bands[b].legs[l];
            var canon = (leg.from < leg.to) ?
                (leg.from + "->" + leg.to) : (leg.to + "->" + leg.from);
            ok(seen[canon] === undefined,
                "leg " + canon + " is never drawn in more than one band");
            seen[canon] = true;
            drawn++;
        }
    }
    eqs(drawn, 6, "6 of the survey's 9 legs are drawn (A1-A2,A2-A3,A3-B1,B1-B2,B2-B3,B3-B4)");

    // the honest invariant: findings.undrawn names exactly the other 3,
    // each with reason "demoted arm" -- not a loose "touches some
    // omitted station somewhere" check, the actual finding a report
    // would print
    eqs(p.findings.undrawn.length, 3, "the shorter arm's three legs are all undrawn");
    eqs(p.findings.undrawn[0].from, "B1", "first undrawn leg starts at B1");
    eqs(p.findings.undrawn[0].to, "B5", "and ends at B5");
    eqs(p.findings.undrawn[0].reason, "demoted arm", "reason: demoted arm");
    eqs(p.findings.undrawn[1].from, "B5", "second undrawn leg starts at B5");
    eqs(p.findings.undrawn[1].to, "B6", "and ends at B6");
    eqs(p.findings.undrawn[1].reason, "demoted arm", "reason: demoted arm");
    eqs(p.findings.undrawn[2].from, "B6", "third undrawn leg starts at B6");
    eqs(p.findings.undrawn[2].to, "B7", "and ends at B7");
    eqs(p.findings.undrawn[2].reason, "demoted arm", "reason: demoted arm");
}());

(function() {
    // build constructs the adjacency graph ONCE for the whole profile
    // and hands the SAME graph to every band -- rebuilding it per band
    // is O(runs x legs), measured at 60% of total build time on a
    // 401-run survey (see CsProfile.longestChain's own docblock). A
    // build() that rebuilt it per band would call CsProfile.adjacency
    // once per band instead of once total.
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A1", "A2", 10, 0, 0), shotOf("A2", "A3", 10, 0, 0),
        shotOf("A2", "B1", 10, 90, 0), shotOf("B1", "B2", 10, 90, 0),
        shotOf("A3", "C1", 10, 180, 0), shotOf("C1", "C2", 10, 180, 0)
    ];
    var r = CsNetwork.resolve(sv, {});

    var calls = 0;
    var real = CsProfile.adjacency;
    CsProfile.adjacency = function(resolved) {
        calls++;
        return real(resolved);
    };
    try {
        var p = CsProfile.build(sv, r, {});
        eqs(p.bands.length, 3, "fixture assumption: three bands (A, B, C)");
        eqs(calls, 1,
            "the adjacency graph is built exactly once for the whole profile, " +
            "not once per band");
    } finally {
        CsProfile.adjacency = real;
    }
}());

(function() {
    // C1: build() no longer accepts an adjacency graph from the
    // caller AT ALL -- a graph built from a DIFFERENT resolved once
    // silently produced a wrong profile with no error and no finding.
    // A correct build of this survey gives A three stations and B
    // four (B's own three plus the tie station A3, drawn again as B's
    // own opening station); passing in a graph built from a totally
    // unrelated survey must have NO effect on that result at all --
    // proving build() computes and uses its own, always, rather than
    // trusting whatever a caller happens to hand in through `opts`.
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A1", "A2", 10, 0, 0),
        shotOf("A2", "A3", 10, 0, 0),
        shotOf("A3", "B1", 8, 90, 0),
        shotOf("B1", "B2", 10, 0, 0),
        shotOf("B2", "B3", 10, 90, 0)
    ];
    var r = CsNetwork.resolve(sv, {});

    var sv2 = CsModel.newSurvey();
    sv2.shots = [shotOf("X1", "X2", 10, 0, 0)];
    var r2 = CsNetwork.resolve(sv2, {});
    var staleGraph = CsProfile.adjacency(r2);

    var correct = CsProfile.build(sv, r, {});
    eqs(correct.bands.length, 2, "fixture assumption: run A and run B");
    eqs(correct.bands[0].stations.length, 3, "A's correct station count");
    eqs(correct.bands[1].stations.length, 4, "B's correct station count");

    var poisoned = CsProfile.build(sv, r, { adjacency: staleGraph });
    eqs(poisoned.bands[0].stations.length, 3,
        "a stale opts.adjacency from an unrelated survey changes nothing -- " +
        "A is still 3 stations, not silently 1");
    eqs(poisoned.bands[1].stations.length, 4,
        "and B is still 4, not silently 2 -- the stale graph is ignored, " +
        "not merged with or preferred over build's own");
}());

(function() {
    // orphans and strandedRoots both survive into findings, and stay
    // the two DIFFERENT lists hierarchy() reports them as -- a report
    // that merged them would tell a surveyor to go shoot a connecting
    // leg for a run that needs nothing of the sort.
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A1", "A2", 10, 0, 0),
        shotOf("A2", "A3", 10, 0, 0),
        shotOf("A3", "B1", 10, 0, 0),
        shotOf("B1", "B2", 10, 0, 0),
        shotOf("B2", "A4", 10, 0, 0),
        shotOf("A4", "A5", 10, 0, 0),
        shotOf("D1", "A6", 8, 0, 0),
        shotOf("C1", "C2", 10, 0, 0)
    ];
    sv.fixed["A1"] = { x: 0, y: 0, z: 0 };
    sv.fixed["D1"] = { x: 500, y: 500, z: 0 };
    sv.fixed["C1"] = { x: 1000, y: 1000, z: 0 };
    var r = CsNetwork.resolve(sv, {});
    var p = CsProfile.build(sv, r, {});

    eqs(p.findings.orphans.join(","), "C",
        "the truly disconnected run is an orphan");
    eqs(p.findings.strandedRoots.join(","), "D",
        "the physically-connected-but-unattached run is stranded, not orphaned");
}());

(function() {
    // secondTies survive into findings too, unaltered -- one exact
    // check per field, not one bundled ok() a mismatch on any single
    // field would still pass by way of the others reading true.
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A1", "A2", 10, 0, 0),
        shotOf("A2", "A3", 10, 0, 0),
        shotOf("A3", "A4", 10, 0, 0),
        shotOf("A2", "A2a1", 5, 90, 0),
        shotOf("A2a1", "A2a2", 5, 90, 0),
        shotOf("A3", "B1", 8, 45, 0),
        shotOf("B1", "A4", 8, 315, 0)
    ];
    var r = CsNetwork.resolve(sv, {});
    var p = CsProfile.build(sv, r, {});
    eqs(p.findings.secondTies.length, 1, "one second contact reported");
    eqs(p.findings.secondTies[0].run, "B", "the run with the second contact");
    eqs(p.findings.secondTies[0].otherStation, "A4", "the station it touches");
    eqs(p.findings.secondTies[0].otherRun, "A", "the run that station belongs to");

    // C2, the "closure" reason: B1-A4 is exactly this second contact,
    // and it is a real surveyed shot that draws in no band at all --
    // findings.undrawn is where a report finds it, not silence.
    eqs(p.findings.undrawn.length, 1, "one undrawn leg: the closure back to A4");
    eqs(p.findings.undrawn[0].from, "B1", "the closure leg's own from");
    eqs(p.findings.undrawn[0].to, "A4", "and to");
    eqs(p.findings.undrawn[0].kind, "closure", "its kind, read straight off the leg");
    eqs(p.findings.undrawn[0].reason, "closure", "reason: closure");
}());

(function() {
    // findings.stopped carries the STATION AND THE REASON, not just a
    // bare name -- collapsing "no-z" and "no-leg" into one string would
    // ask a surveyor to fix the wrong thing. Hierarchy is stubbed here
    // (same technique the M1/I4 bandOrder fixture above uses) so the
    // fixture can name a tie with no supporting leg at all, the "no-leg"
    // case, without having to reverse-engineer a real multi-branch
    // survey that happens to produce it.
    var saved = CsProfile.hierarchy;
    var resolved = {
        stations: {
            Tie: { x: 0, y: 0, z: 100, seq: 0 },
            A1: { x: 0, y: 0, z: 0, seq: 1 },
            A2: { x: 0, y: 0, z: 10, seq: 2 }
        },
        legs: [
            { shot: shotOf("A1", "A2", 10, 0, 0), from: "A1", to: "A2", kind: "new" }
        ]
    };
    var survey = CsModel.newSurvey();
    survey.shots = [resolved.legs[0].shot];
    CsProfile.hierarchy = function() {
        return {
            parents: { A: null }, ties: { A: "Tie" }, order: ["A"],
            secondTies: [], mismatches: [], orphans: [], strandedRoots: [],
            cycles: []
        };
    };
    try {
        var p = CsProfile.build(survey, resolved, {});
        eqs(p.findings.stopped.length, 1, "one stopped band reported");
        eqs(p.findings.stopped[0].run, "A", "and which run it stopped in");
        eqs(p.findings.stopped[0].station, "A1",
            "A1 has a perfectly good Z -- the failure is the missing tie leg");
        eqs(p.findings.stopped[0].reason, "no-leg",
            "the reason travels with the station, not just its name");
    } finally {
        CsProfile.hierarchy = saved;
    }
}());

(function() {
    // the OTHER reason, "no-z", travels through findings.stopped too
    var saved = CsProfile.hierarchy;
    var resolved = {
        stations: {
            A1: { x: 0, y: 0, seq: 0 },              // z deliberately absent
            A2: { x: 0, y: 0, z: 10, seq: 1 }
        },
        legs: [
            { shot: shotOf("A1", "A2", 10, 0, 0), from: "A1", to: "A2", kind: "new" }
        ]
    };
    var survey = CsModel.newSurvey();
    survey.shots = [resolved.legs[0].shot];
    CsProfile.hierarchy = function() {
        return {
            parents: { A: null }, ties: { A: null }, order: ["A"],
            secondTies: [], mismatches: [], orphans: [], strandedRoots: [],
            cycles: []
        };
    };
    try {
        var p = CsProfile.build(survey, resolved, {});
        eqs(p.findings.stopped.length, 1, "one stopped band reported");
        eqs(p.findings.stopped[0].station, "A1",
            "the missing-Z station stops the band right there");
        eqs(p.findings.stopped[0].reason, "no-z",
            "and the reason is no-z, not no-leg, for a genuinely missing Z");
    } finally {
        CsProfile.hierarchy = saved;
    }
}());

(function() {
    // C2, the minimal repro: a bare triangle, A1-A2-A3-A1, where the
    // last leg closes the loop. The closure draws in no band -- Task 4
    // established that -- but before findings.undrawn existed, nothing
    // anywhere said so: omitted, stopped, mismatches, all empty, and a
    // real surveyed shot simply vanished from the profile with no trace.
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A1", "A2", 10, 0, 0),
        shotOf("A2", "A3", 10, 90, 0),
        shotOf("A3", "A1", 14.14, 225, 0)
    ];
    var r = CsNetwork.resolve(sv, {});
    var p = CsProfile.build(sv, r, {});

    eqs(p.bands.length, 1, "one band: A1, A2, A3 all belong to run A");
    eqs(p.bands[0].stations.length, 3, "all three stations drawn");
    eqs(p.findings.omitted.length, 0, "nothing omitted -- every station IS on the chain");
    eqs(p.findings.stopped.length, 0, "the band never stopped");

    eqs(p.findings.undrawn.length, 1, "the closure leg is the one undrawn leg");
    eqs(p.findings.undrawn[0].from, "A3", "the closure's own from");
    eqs(p.findings.undrawn[0].to, "A1", "and to");
    eqs(p.findings.undrawn[0].kind, "closure", "its kind");
    eqs(p.findings.undrawn[0].reason, "closure", "reason: closure");
}());

(function() {
    // C2, the "cross-run tie" reason: hierarchy is stubbed (same
    // technique as the no-z/no-leg fixtures above) to a run "A" that
    // ties at station T, while a completely separate run "B" is left
    // out of hier.order entirely -- so the T-B1 leg is a genuine
    // cross-run contact build() never draws for anyone. This is the
    // shape of an ordinary hierarchy secondTie (see the B/A4 fixture
    // above) with the closure removed, isolating the reason a
    // non-closure cross-run leg gets when it is not the one tie its
    // child run actually used.
    var saved = CsProfile.hierarchy;
    var resolved = {
        stations: {
            T: { x: 0, y: 0, z: 0, seq: 0 },
            A1: { x: 0, y: 0, z: 5, seq: 1 },
            B1: { x: 0, y: 0, z: 6, seq: 2 }
        },
        legs: [
            { shot: shotOf("T", "A1", 10, 0, 0), from: "T", to: "A1", kind: "new" },
            { shot: shotOf("T", "B1", 10, 0, 0), from: "T", to: "B1", kind: "new" }
        ]
    };
    var survey = CsModel.newSurvey();
    survey.shots = [resolved.legs[0].shot, resolved.legs[1].shot];
    CsProfile.hierarchy = function() {
        return {
            parents: { A: null }, ties: { A: "T" }, order: ["A"],
            secondTies: [], mismatches: [], orphans: [], strandedRoots: [],
            cycles: []
        };
    };
    try {
        var p = CsProfile.build(survey, resolved, {});
        eqs(p.bands.length, 1, "only run A is ever placed as a band");
        eqs(p.findings.undrawn.length, 1, "the T-B1 leg is undrawn");
        eqs(p.findings.undrawn[0].from, "T", "its own from");
        eqs(p.findings.undrawn[0].to, "B1", "and to");
        eqs(p.findings.undrawn[0].reason, "cross-run tie",
            "reason: cross-run tie, not demoted arm or after-stop");
    } finally {
        CsProfile.hierarchy = saved;
    }
}());

(function() {
    // C2, the "after-stop" reason: A2 has no resolved Z, so the band
    // stops there -- but unrollBand's own `stopped` names only A2
    // itself, not the leg that arrives at it (A1-A2) or anything past
    // it (A2-A3). Both of those legs are undrawn and, before this
    // finding existed, their stations never appeared ANYWHERE in
    // findings: not omitted (they ARE on the run's own longest chain),
    // not stopped (only the one station name is), simply absent.
    var saved = CsProfile.hierarchy;
    var resolved = {
        stations: {
            A1: { x: 0, y: 0, z: 0, seq: 0 },
            A2: { x: 0, y: 0, seq: 1 },              // z deliberately absent
            A3: { x: 0, y: 0, z: 10, seq: 2 }
        },
        legs: [
            { shot: shotOf("A1", "A2", 10, 0, 0), from: "A1", to: "A2", kind: "new" },
            { shot: shotOf("A2", "A3", 10, 0, 0), from: "A2", to: "A3", kind: "new" }
        ]
    };
    var survey = CsModel.newSurvey();
    survey.shots = [resolved.legs[0].shot, resolved.legs[1].shot];
    CsProfile.hierarchy = function() {
        return {
            parents: { A: null }, ties: { A: null }, order: ["A"],
            secondTies: [], mismatches: [], orphans: [], strandedRoots: [],
            cycles: []
        };
    };
    try {
        var p = CsProfile.build(survey, resolved, {});
        eqs(p.bands[0].stations.length, 1, "only A1 was actually drawn");
        eqs(p.bands[0].omitted.length, 0,
            "A2 and A3 are not omitted -- they ARE on the chain, just unreached");
        eqs(p.findings.stopped.length, 1, "one stopped band");
        eqs(p.findings.stopped[0].station, "A2", "stopped names only A2 itself");

        eqs(p.findings.undrawn.length, 2, "both legs past (and into) the stop are undrawn");
        eqs(p.findings.undrawn[0].from, "A1", "the leg arriving at the stop station");
        eqs(p.findings.undrawn[0].to, "A2", "");
        eqs(p.findings.undrawn[0].reason, "after-stop",
            "reason: after-stop, even for the leg landing ON the stop station");
        eqs(p.findings.undrawn[1].from, "A2", "the leg past the stop station");
        eqs(p.findings.undrawn[1].to, "A3", "");
        eqs(p.findings.undrawn[1].reason, "after-stop",
            "reason: after-stop -- A3 never appears in ANY finding otherwise");
    } finally {
        CsProfile.hierarchy = saved;
    }
}());

(function() {
    // I4: bandSpan's ceiling loop is the one nothing in this suite
    // exercised as the SOURCE of `hi` -- delete it entirely and the
    // rest of this file stays green, because every other bandSpan
    // fixture makes floor the minimum and flat the maximum. A ceiling
    // point higher than every other source closes that gap.
    var band = {
        stations: [{ y: 5 }, { y: 10 }],
        ceiling: [[{ y: 100 }]],
        floor: [[{ y: -3 }]],
        flat: [{ y: 20 }]
    };
    var span = CsProfile.bandSpan(band);
    eqs(span.lo, -3, "lo is still the floor point");
    eqs(span.hi, 100, "hi comes from the ceiling point, the highest of the four sources");
}());

(function() {
    // the null-span exclusion from the gutter statistic: a band that
    // drew nothing contributes NO height, not a phantom zero. Two real
    // bands of height 2000 sandwich one empty band -- if the empty
    // band's null span were wrongly treated as height 0, the 3-value
    // statistic [0, 2000, 2000] would pick the 0 (index
    // ceil(0.25*3)-1 = 0) and collapse the gutter to GUTTER_MIN. Only
    // counting the two REAL heights ([2000, 2000], n=2, index 0) gives
    // 2000, half of which is the gutter actually used below.
    var b0 = { stations: [{ y: -1000 }, { y: 1000 }] };
    var empty = { stations: [] };
    var b1 = { stations: [{ y: -1000 }, { y: 1000 }] };
    CsProfile.layout([b0, empty, b1]);
    eqs(b0.zOffset, 0, "b0 placed first");
    eqs(empty.zOffset, 0, "the empty band gets no offset and touches nothing");
    eqs(b1.zOffset, -(2000 + CsProfile.GUTTER_FACTOR * 2000),
        "gutter is GUTTER_FACTOR x the real 2000-height statistic, not GUTTER_MIN " +
        "(which a phantom zero-height entry would have produced)");
}());

(function() {
    // I2: CsLrud.splaysByStation and CsLrud.legCounts are each called
    // exactly once per build() -- not once per band -- matching the
    // adjacency graph's own once-per-profile treatment. Measured at
    // 22.8% and 21.7% of a 276ms build (401 runs) when each was
    // instead recomputed per band.
    var sv = CsModel.newSurvey();
    var mk = function(f, t, az) {
        var s = shotOf(f, t, 10, az, 0);
        s.up = 1; s.down = 1;
        return s;
    };
    sv.shots = [mk("A1", "A2", 0), mk("A2", "A3", 0),
        mk("A2", "B1", 90), mk("B1", "B2", 90),
        mk("A3", "C1", 180), mk("C1", "C2", 180)];
    var r = CsNetwork.resolve(sv, {});

    var splayCalls = 0, countCalls = 0;
    var realSplays = CsLrud.splaysByStation, realCounts = CsLrud.legCounts;
    CsLrud.splaysByStation = function(s) { splayCalls++; return realSplays(s); };
    CsLrud.legCounts = function(l) { countCalls++; return realCounts(l); };
    try {
        var p = CsProfile.build(sv, r, {});
        eqs(p.bands.length, 3, "fixture assumption: three bands (A, B, C)");
        eqs(splayCalls, 1, "CsLrud.splaysByStation called exactly once for the whole profile");
        eqs(countCalls, 1, "CsLrud.legCounts called exactly once for the whole profile");
    } finally {
        CsLrud.splaysByStation = realSplays;
        CsLrud.legCounts = realCounts;
    }
}());

(function() {
    // bandOpts.flatSplayDeg actually reaches CsProfile.bandWallRuns
    // through build() -- a 15-degree splay is "ceiling" under the
    // default 10-degree dead zone, and "flat" once build() is asked
    // for a wider one.
    function splayOf2(from, d, az, inc) {
        var s = CsModel.newShot();
        s.from = from; s.to = ""; s.distance = d; s.azimuth = az;
        s.inclination = inc;
        s.splay = true;
        return s;
    }
    var sv = CsModel.newSurvey();
    sv.shots = [shotOf("A1", "A2", 10, 0, 0), splayOf2("A2", 5, 0, 15)];
    var r = CsNetwork.resolve(sv, {});

    var pDefault = CsProfile.build(sv, r, {});
    eqs(pDefault.bands[0].flat.length, 0,
        "under the default 10-degree dead zone the 15-degree splay is ceiling, not flat");

    var pWide = CsProfile.build(sv, r, { flatSplayDeg: 20 });
    eqs(pWide.bands[0].flat.length, 1,
        "opts.flatSplayDeg reached bandWallRuns: the same 15-degree splay " +
        "reads as flat under a 20-degree dead zone");
}());

// ---------------------------------------------------------------------
// CsDraw.profile / CsDraw.survey's hookup. QCAD context only -- a real
// document and a real settings store -- and per this feature's own
// mutation-testing convention, this is the ONLY place these acceptance
// criteria can actually be proven: CsDraw.js is never loaded under node
// at all, so a node-only test cannot touch a single line of it.
//
// THE ELEVATION IS DRAWN INTO THE PLAN DRAWING NOW. The scenarios that
// used to prove sibling-file behaviour -- a path written, a `created`
// flag, a commit failure, a drawing refusing to profile itself because
// it was already the sibling -- are gone with the sibling itself, not
// merely reworded: there is no second file for any of them to be about.
// What survives is what still has a meaning in one drawing: the two
// gates, the exception safety, and that an UNSAVED drawing now draws
// its elevation like any other (it used to be refused outright, for
// want of a path to write to).
// ---------------------------------------------------------------------

if (!IS_NODE) {
    (function() {
        loadRepoScript("scripts/CaveSurvey/Core/CsLayers.js");
        loadRepoScript("scripts/CaveSurvey/Core/CsStore.js");
        loadRepoScript("scripts/CaveSurvey/Core/CsTags.js");
        loadRepoScript("scripts/CaveSurvey/Core/CsDraw.js");

        var KEY_AUTO = "CaveSurvey/ProfileAuto";
        var KEY_MAX = "CaveSurvey/ProfileAutoMaxStations";
        var hadAuto = RSettings.getBoolValue(KEY_AUTO, true);
        var hadMax = RSettings.getIntValue(KEY_MAX, -1);

        function freshDoc(fileName) {
            var d = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
            var i = new RDocumentInterface(d);
            d.setFileName(fileName);
            getDocument = function() { return d; };
            getDocumentInterface = function() { return i; };
            return { doc: d, di: i };
        }
        // Crash-safe field access: a regression that drops CsDraw.
        // survey's `profile` key entirely (or leaves it null on some
        // path) must fail exactly the assertion checking for the key,
        // not crash this whole procedural script with a TypeError on
        // undefined.profile and take out every assertion after it.
        function pf(drawn, field) {
            return (drawn && drawn.profile) ? drawn.profile[field] : undefined;
        }
        /** How many entities in doc sit on a profile-frame layer. */
        function profileFrameCount(doc) {
            var ids = doc.queryAllEntities(false, false);
            var n = 0, i, e;
            for (i = 0; i < ids.length; i++) {
                e = doc.queryEntity(ids[i]);
                if (isNull(e)) { continue; }
                if (CsLayers.frameOf(
                        doc.getLayerName(e.getLayerId())) === "profile") {
                    n++;
                }
            }
            return n;
        }

        try {
            RSettings.setValue(KEY_AUTO, true);
            RSettings.setValue(KEY_MAX, CsProfile.AUTO_MAX_STATIONS_DEFAULT);

            // -----------------------------------------------------
            // A. happy path: the elevation lands in THIS document,
            // on profile-frame layers, and CsDraw.survey's return
            // value carries the outcome.
            // -----------------------------------------------------
            var planPathA = QDir.tempPath() + "/cs_unit_hook_planA.dxf";
            var fdA = freshDoc(planPathA);

            var svA = CsModel.newSurvey();
            svA.shots = [shotOf("H1", "H2", 10, 0, 0)];
            var drawnA = CsDraw.survey(svA, CsNetwork.resolve(svA, {}));

            var hasProfileKey = drawnA.profile !== undefined;
            ok(hasProfileKey,
                "CsDraw.survey's return value carries a profile key");
            ok(hasProfileKey && drawnA.profile.skipped === undefined,
                "the happy path is not a skip (reason: '" +
                (hasProfileKey ? drawnA.profile.reason : "n/a") + "')");
            ok(hasProfileKey && drawnA.profile.counts !== undefined &&
                drawnA.profile.counts.stationsDrawn > 0,
                "the outcome carries what the elevation actually drew");
            ok(profileFrameCount(fdA.doc) > 0,
                "PROOF: THE ELEVATION LANDED IN THE PLAN'S OWN DRAWING, " +
                "on profile-frame layers -- no sibling file involved");
            ok(drawnA.stationsDrawn > 0,
                "sanity: the plan draw itself still ran normally");

            // -----------------------------------------------------
            // D. a profile pass that throws must not take the plan
            // draw down with it: caught, reported, plan draw normal.
            // -----------------------------------------------------
            var fdD = freshDoc(QDir.tempPath() + "/cs_unit_hook_planD.dxf");

            var svD = CsModel.newSurvey();
            svD.shots = [shotOf("L1", "L2", 10, 0, 0)];
            var resD = CsNetwork.resolve(svD, {});

            var savedBuild = CsProfile.build;
            CsProfile.build = function() {
                throw new Error("forced failure for CsDraw.profile test");
            };
            var threwD = false, drawnD = null;
            try {
                try {
                    drawnD = CsDraw.survey(svD, resD);
                } catch (eD) {
                    threwD = true;
                }
            } finally {
                CsProfile.build = savedBuild;
            }

            ok(!threwD,
                "PROOF: a throwing profile pass does not propagate " +
                "out of CsDraw.survey");
            ok(drawnD !== null && drawnD.stationsDrawn > 0,
                "PROOF: the plan draw itself still completed and " +
                "returned normally after the forced failure");
            ok(pf(drawnD, "skipped") === true,
                "the failure is reported, not silently swallowed");
            ok(String(pf(drawnD, "reason") || "")
                    .indexOf("profile pass failed") >= 0,
                "the reason names what happened (got: '" +
                pf(drawnD, "reason") + "')");
            eqs(profileFrameCount(fdD.doc), 0,
                "the forced failure left no profile geometry behind");

            // -----------------------------------------------------
            // CRITICAL D: an exception whose OWN toString() throws
            // must not escape CsDraw.survey either. The catch block
            // builds its reason by concatenation, which calls
            // toString() -- a hostile or merely buggy thrown value
            // would otherwise propagate a SECOND exception out of the
            // catch and out of CsDraw.survey with it.
            // -----------------------------------------------------
            freshDoc(QDir.tempPath() + "/cs_unit_hook_planD2.dxf");

            var svD2 = CsModel.newSurvey();
            svD2.shots = [shotOf("N1", "N2", 10, 0, 0)];
            var resD2 = CsNetwork.resolve(svD2, {});

            var savedBuild2 = CsProfile.build;
            CsProfile.build = function() {
                var poison = { toString: function() {
                    throw new Error("toString itself throws");
                } };
                throw poison;
            };
            var threwD2 = false, drawnD2 = null;
            try {
                try {
                    drawnD2 = CsDraw.survey(svD2, resD2);
                } catch (eD2) {
                    threwD2 = true;
                }
            } finally {
                CsProfile.build = savedBuild2;
            }

            ok(!threwD2,
                "CRITICAL D: a profile-pass exception whose own " +
                "toString() throws still does not propagate out of " +
                "CsDraw.survey");
            ok(drawnD2 !== null && drawnD2.stationsDrawn > 0,
                "CRITICAL D: the plan draw itself still completed " +
                "despite the adversarial throw");
            ok(pf(drawnD2, "skipped") === true,
                "CRITICAL D: the failure is still reported as a skip");
            eqs(pf(drawnD2, "reason"), "profile pass failed",
                "CRITICAL D: falls back to the plain reason when " +
                "describing the exception itself fails");

            // ---------------------------------------------------------
            // B. ProfileAuto false: nothing drawn, and the reason names
            // the setting.
            // ---------------------------------------------------------
            RSettings.setValue(KEY_AUTO, false);
            var fdB = freshDoc(QDir.tempPath() + "/cs_unit_hook_planB.dxf");

            var svB = CsModel.newSurvey();
            svB.shots = [shotOf("J1", "J2", 10, 0, 0)];
            var drawnB = CsDraw.survey(svB, CsNetwork.resolve(svB, {}));

            eqs(pf(drawnB, "skipped"), true,
                "ProfileAuto off: the profile pass is skipped");
            eqs(pf(drawnB, "reason"), "CaveSurvey/ProfileAuto is off",
                "the reason names the exact setting that is off");
            eqs(profileFrameCount(fdB.doc), 0,
                "PROOF: ProfileAuto off drew no profile geometry at all");
            RSettings.setValue(KEY_AUTO, true);

            // ---------------------------------------------------------
            // C. AN UNSAVED DRAWING DRAWS ITS ELEVATION LIKE ANY OTHER.
            // This used to be a refusal ("the drawing has no file name
            // yet"), because the elevation needed a sibling path to be
            // written to. It is a region of this drawing now, so a
            // drawing that has never been saved has everything it needs.
            // ---------------------------------------------------------
            var fdC = freshDoc("");   // unsaved: no file name at all

            var svC = CsModel.newSurvey();
            svC.shots = [shotOf("K1", "K2", 10, 0, 0)];
            var drawnC = CsDraw.survey(svC, CsNetwork.resolve(svC, {}));

            ok(pf(drawnC, "skipped") === undefined,
                "an unsaved drawing is NOT skipped any more (reason: '" +
                pf(drawnC, "reason") + "')");
            ok(profileFrameCount(fdC.doc) > 0,
                "PROOF: the unsaved drawing got its elevation, in itself");

            // ---------------------------------------------------------
            // E. above ProfileAutoMaxStations, the AUTOMATIC pass is
            // skipped and the reason names the manual command.
            // ---------------------------------------------------------
            RSettings.setValue(KEY_MAX, 2);
            var fdE = freshDoc(QDir.tempPath() + "/cs_unit_hook_planE.dxf");

            var svE = CsModel.newSurvey();
            svE.shots = [
                shotOf("M1", "M2", 10, 0, 0),
                shotOf("M2", "M3", 10, 0, 0),
                shotOf("M3", "M4", 10, 0, 0)
            ];
            var drawnE = CsDraw.survey(svE, CsNetwork.resolve(svE, {}));

            eqs(pf(drawnE, "skipped"), true,
                "an oversized run skips the automatic pass");
            ok(String(pf(drawnE, "reason") || "")
                    .indexOf("GenerateProfile") >= 0,
                "the reason names the manual command (got: '" +
                pf(drawnE, "reason") + "')");
            ok(String(pf(drawnE, "reason") || "")
                    .indexOf("ProfileAutoMaxStations") >= 0,
                "the reason names the setting that gated it");
            eqs(profileFrameCount(fdE.doc), 0,
                "PROOF: the oversized-run skip drew no elevation");

            // ---------------------------------------------------------
            // F. CRITICAL B, fixed: the gate measures the survey's TOTAL
            // station count, not just its largest run. Two runs of 2
            // stations each (P, tying to Q) total 4 resolved stations,
            // over the maxStations=2 still in force from E; NEITHER run
            // individually exceeds 2.
            // ---------------------------------------------------------
            var fdF = freshDoc(QDir.tempPath() + "/cs_unit_hook_planF.dxf");

            var svF = CsModel.newSurvey();
            svF.shots = [
                shotOf("P1", "P2", 10, 0, 0),
                shotOf("P2", "Q1", 10, 0, 0),
                shotOf("Q1", "Q2", 10, 0, 0)
            ];
            var resF = CsNetwork.resolve(svF, {});
            var groupedF = CsProfile.groupRuns(resF);
            ok(groupedF.order.length === 2,
                "sanity: the F fixture really is two separate runs");
            var largestF = 0;
            for (var gfi = 0; gfi < groupedF.order.length; gfi++) {
                var lenF = groupedF.runs[groupedF.order[gfi]].stations.length;
                if (lenF > largestF) { largestF = lenF; }
            }
            eqs(largestF, 2,
                "sanity: neither run in the F fixture exceeds 2 " +
                "stations, even though the survey totals 4");

            var drawnF = CsDraw.survey(svF, resF);
            eqs(pf(drawnF, "skipped"), true,
                "CRITICAL B: a survey whose TOTAL station count (4) " +
                "is over the limit (2) is skipped even though " +
                "NEITHER individual run is (largest 2) -- got: '" +
                pf(drawnF, "reason") + "'");
            ok(String(pf(drawnF, "reason") || "").indexOf("4 stations") >= 0,
                "the reason names the actual total (got: '" +
                pf(drawnF, "reason") + "')");
            ok(String(pf(drawnF, "reason") || "")
                    .indexOf("largest run 2") >= 0,
                "the reason ALSO names the largest run, for " +
                "diagnostic value, even though it is not what " +
                "decided the outcome here (got: '" +
                pf(drawnF, "reason") + "')");
            eqs(profileFrameCount(fdF.doc), 0,
                "PROOF: the total-based skip drew no elevation either");

            // F2: raising the limit back up to comfortably cover the
            // total lets the identical fixture draw normally -- proves
            // this is a real, reversible gate and not a fixture that
            // can now never pass.
            RSettings.setValue(KEY_MAX,
                CsProfile.AUTO_MAX_STATIONS_DEFAULT);
            var fdF2 = freshDoc(QDir.tempPath() + "/cs_unit_hook_planF2.dxf");
            var drawnF2 = CsDraw.survey(svF, CsNetwork.resolve(svF, {}));
            ok(pf(drawnF2, "skipped") === undefined,
                "F2: the same shape, under a limit that covers its " +
                "total, is NOT skipped -- got skipped, reason: '" +
                pf(drawnF2, "reason") + "'");
            ok(profileFrameCount(fdF2.doc) > 0,
                "F2: and it actually drew the elevation");
        } finally {
            RSettings.setValue(KEY_AUTO, hadAuto);
            RSettings.setValue(KEY_MAX, hadMax);
        }
    }());
}

// ---------------------------------------------------------------------
// SPLAY RECOVERY: CsTags.surveyFromDocument rebuilds splay shots from
// the drawing's own Splay/SplayName geometry.
//
// QCAD-context only, and per this repo's mutation-testing convention
// that is not a limitation to work around: CsTags.js and CsDraw.js are
// never loaded under node at all, so a node test cannot touch a line of
// either. Every assertion below is named so that deleting the
// behaviour it covers fails THAT assertion by name.
//
// The gap this closes: the reader walked Station-tagged points only, so
// a cave whose floor and ceiling come from splays rebuilt as a bare
// centerline -- measured, before the fix, as 4 splays / 1 ceiling run /
// 1 floor run from the live survey model versus 0 / 0 / 0 through
// CsTags.surveyFromDocument.
// ---------------------------------------------------------------------

if (!IS_NODE) {
    (function() {
        loadRepoScript("scripts/CaveSurvey/Core/CsLayers.js");
        loadRepoScript("scripts/CaveSurvey/Core/CsStore.js");
        loadRepoScript("scripts/CaveSurvey/Core/CsTags.js");
        loadRepoScript("scripts/CaveSurvey/Core/CsDraw.js");

        // The sibling-elevation pass fires on every CsDraw.survey call
        // and is not what this block is testing; keep it inert and put
        // the user's own setting back, exactly as the Task 9 block does.
        var KEY_AUTO = "CaveSurvey/ProfileAuto";
        var hadAuto = RSettings.getBoolValue(KEY_AUTO, true);
        RSettings.setValue(KEY_AUTO, false);

        function spDoc() {
            var d = new RDocument(new RMemoryStorage(),
                new RSpatialIndexNavel());
            var i = new RDocumentInterface(d);
            getDocument = function() { return d; };
            getDocumentInterface = function() { return i; };
            return { doc: d, di: i };
        }

        // every SplayName-tagged tip in the drawing, name -> {x, y}
        function spTips(doc) {
            var out = {};
            var ids = doc.queryAllEntities(false, false);
            for (var i = 0; i < ids.length; i++) {
                var e = doc.queryEntity(ids[i]);
                if (isNull(e) || typeof e.getPosition !== "function") {
                    continue;
                }
                var n = CsTags.get(e, "SplayName");
                if (n === "") {
                    continue;
                }
                var p = e.getPosition();
                out[n] = { x: p.x, y: p.y };
            }
            return out;
        }

        // the splay shots of a survey, in survey.shots order
        function spShots(survey) {
            var out = [];
            for (var i = 0; i < survey.shots.length; i++) {
                if (survey.shots[i].splay) {
                    out.push(survey.shots[i]);
                }
            }
            return out;
        }

        // one station point, hand-tagged, for the fixtures below that
        // need a shape CsDraw.survey would never draw
        function spStation(doc, op, name, seq, x, y) {
            var pt = CsDraw.addPoint(doc, op, CsLayers.STATIONS,
                new RVector(x, y));
            CsTags.tagStation(pt, { name: name, seq: seq, azimuth: 0,
                inclination: 0, z: 0 });
            op.addObject(pt, false);
            return pt;
        }

        // one splay TIP point and nothing else: no ray, so no shot tags
        function spTip(doc, op, name, x, y) {
            var pt = CsDraw.addPoint(doc, op, CsLayers.SPLAYS,
                new RVector(x, y));
            CsTags.set(pt, "SplayName", name);
            op.addObject(pt, false);
            return pt;
        }

        try {
            // =============================================================
            // 1. THE FIX ITSELF: a drawn survey's splays come back, from
            //    the ray's own schema-v3 shot tags, exactly.
            // =============================================================
            var f1 = spDoc();
            var sv1 = CsModel.newSurvey();
            var sp1a = splayOf("S2", 5, 90, 25);
            sp1a.notes = "ceiling pocket";
            var sp1b = splayOf("S2", 3, 200, -30);
            var sp1c = splayOf("S3", 7, 0, 45);
            sv1.shots = [shotOf("S1", "S2", 10, 0, 0),
                shotOf("S2", "S3", 10, 90, 0), sp1a, sp1b, sp1c];
            var res1 = CsNetwork.resolve(sv1, {});
            var drawn1 = CsDraw.survey(sv1, res1);
            eqs(drawn1.splaysDrawn, 3,
                "sanity: the fixture drew 3 splay rays");

            var rb1 = CsTags.surveyFromDocument(f1.doc);
            var got1 = spShots(rb1);
            eqs(got1.length, 3,
                "splay recovery: all 3 drawn splays come back as splay " +
                "shots (0 was the whole bug)");
            var flagsOk = true, toOk = true;
            for (var i1 = 0; i1 < got1.length; i1++) {
                if (got1[i1].splay !== true) { flagsOk = false; }
                if (got1[i1].to !== "") { toOk = false; }
            }
            ok(flagsOk, "splay recovery: every recovered splay carries " +
                "splay === true");
            ok(toOk, "splay recovery: every recovered splay has to === " +
                "\"\" (a splay has no TO station)");

            // WHICH station each belongs to, and in which order -- the
            // two facts a redraw's numbering depends on.
            var names1 = [];
            for (i1 = 0; i1 < got1.length; i1++) {
                names1.push(got1[i1].from);
            }
            eqs(names1.join(","), "S2,S2,S3",
                "splay recovery: each splay comes back on the station " +
                "its own tag names, its station's splays consecutive " +
                "and in their drawn order");

            // read from the RAY's tags, not guessed from the tip: the
            // tip carries no inclination at all, so a reader that fell
            // back to geometry here would hand back null/0 for all three
            near(got1[0].distance, 5, 1e-9,
                "splay recovery: distance comes off the ray's own tag");
            near(got1[0].azimuth, 90, 1e-9,
                "splay recovery: azimuth comes off the ray's own tag");
            near(got1[0].inclination, 25, 1e-9,
                "splay recovery: INCLINATION comes off the ray's own tag " +
                "-- the one reading a plan drawing's geometry cannot show");
            near(got1[1].inclination, -30, 1e-9,
                "splay recovery: a downward splay keeps its sign");
            near(got1[2].distance, 7, 1e-9,
                "splay recovery: the second station's splay is its own " +
                "shot, not a copy of the first station's");
            eqs(got1[0].notes, "ceiling pocket",
                "splay recovery: a splay's note rides back with it");

            // =============================================================
            // 2. ADDING SPLAYS MUST NOT MOVE ONE CENTERLINE STATION.
            //    CsNetwork.resolve routes every splay to `skipped` and
            //    emits no leg for one; if that ever stops being true,
            //    every drawing this reader touches silently changes
            //    shape. Compared against the SAME survey with its splays
            //    removed, so the comparison is about the splays alone.
            // =============================================================
            var stripped = CsModel.newSurvey();
            stripped.fixed = rb1.fixed;
            for (i1 = 0; i1 < rb1.shots.length; i1++) {
                if (!rb1.shots[i1].splay) {
                    stripped.shots.push(rb1.shots[i1]);
                }
            }
            var resWith = CsNetwork.resolve(rb1, {});
            var resWithout = CsNetwork.resolve(stripped, {});
            eqs(resWith.legs.length, resWithout.legs.length,
                "splays change nothing: the same number of legs resolve " +
                "with the splays present as without them");
            var moved = [];
            for (var n2 in resWithout.stations) {
                if (!resWithout.stations.hasOwnProperty(n2)) { continue; }
                var a2 = resWith.stations[n2], b2 = resWithout.stations[n2];
                if (a2 === undefined ||
                        Math.abs(a2.x - b2.x) > 1e-12 ||
                        Math.abs(a2.y - b2.y) > 1e-12 ||
                        a2.z !== b2.z) {
                    moved.push(n2);
                }
            }
            eqs(moved.join(","), "",
                "splays change nothing: every station resolves to the " +
                "IDENTICAL coordinate with the splays present");
            eqs(resWith.skipped.length - resWithout.skipped.length, 3,
                "splays change nothing: all 3 land in resolve()'s " +
                "`skipped` list, which is where a splay belongs");

            // =============================================================
            // 3. ROUND TRIP: drawn -> rebuilt from the drawing -> redrawn
            //    puts every splay tip back on its own coordinate, under
            //    its own name. This is the assertion a splay COUNT cannot
            //    make: a reader that recovered three splays with the
            //    wrong bearings, or in the wrong order (so the names
            //    swap), passes a count check and fails this.
            // =============================================================
            var tipsBefore = spTips(f1.doc);
            CsDraw.eraseStations(f1.doc, ["S1", "S2", "S3"]);
            eqs(CsTags.collectStations(f1.doc).length, 0,
                "sanity: the erase really cleared the drawing before the " +
                "redraw");
            var drawn1b = CsDraw.survey(rb1, resWith);
            eqs(drawn1b.splaysDrawn, 3,
                "round trip: the redraw draws all 3 splays again");
            var tipsAfter = spTips(f1.doc);
            var offBy = [];
            for (var tn in tipsBefore) {
                if (!tipsBefore.hasOwnProperty(tn)) { continue; }
                if (tipsAfter[tn] === undefined) {
                    offBy.push(tn + ":gone");
                } else if (Math.abs(tipsAfter[tn].x - tipsBefore[tn].x) > 1e-9 ||
                        Math.abs(tipsAfter[tn].y - tipsBefore[tn].y) > 1e-9) {
                    offBy.push(tn + ":moved");
                }
            }
            eqs(offBy.join(","), "",
                "ROUND TRIP: every splay tip is redrawn at the exact " +
                "coordinate it was drawn at, under the same name");

            // =============================================================
            // 4. TIP-ONLY RECOVERY (a pre-v3 ray, or a ray deleted by
            //    hand): bearing and PLAN length come back; inclination
            //    comes back NULL, not a fabricated 0.
            // =============================================================
            var f4 = spDoc();
            CsLayers.ensureSurveyLayers(f4.doc, f4.di);
            var op4 = new RAddObjectsOperation();
            spStation(f4.doc, op4, "T1", 0, 0, 0);
            spStation(f4.doc, op4, "T2", 1, 0, 10);
            // hung on T2, the station a LEG ARRIVES AT: CsLrud.wallRuns
            // walks arrival stations, so a splay on the very first
            // station of a chain is never offered to it and could not
            // prove the "counted, not dropped" claim below at all.
            spTip(f4.doc, op4, "T2.1", 3, 14);  // 3-4-5 from T2, brg 36.87
            f4.di.applyOperation(op4);

            var rb4 = CsTags.surveyFromDocument(f4.doc);
            var got4 = spShots(rb4);
            eqs(got4.length, 1,
                "tip-only splay: a tip with no ray is still recovered");
            if (got4.length === 1) {
                eqs(got4[0].from, "T2",
                    "tip-only splay: it hangs on the station its name " +
                    "names");
                near(got4[0].distance, 5, 1e-9,
                    "tip-only splay: distance is the tip's PLAN distance " +
                    "from its station");
                near(got4[0].azimuth,
                    Math.atan2(3, 4) * 180.0 / Math.PI, 1e-9,
                    "tip-only splay: azimuth is the tip's own bearing");
                eqs(got4[0].inclination, null,
                    "tip-only splay: INCLINATION IS NULL, not a " +
                    "fabricated 0 -- a plan drawing shows the horizontal " +
                    "projection and nothing else, and a 0 here would " +
                    "assert a dead-level shot nobody measured");
                eqs(CsTraverse.offset(got4[0], CsTraverse.SLOPE), null,
                    "tip-only splay: with no inclination on record it " +
                    "places no coordinate at all -- CsTraverse.offset " +
                    "refuses it");
            }
            var walls4 = CsLrud.wallRuns(rb4, CsNetwork.resolve(rb4, {}));
            ok(walls4.skipped >= 1,
                "tip-only splay: it is COUNTED as an unplaceable wall " +
                "point rather than vanishing silently, got " +
                walls4.skipped);

            // =============================================================
            // 5. ORPHANED GEOMETRY IS NOT RECOVERED: a tip whose base
            //    station is gone from the drawing has no origin to
            //    measure from, and CsDraw.survey would not redraw it
            //    either. This is the case GenerateProfile's own
            //    splay-loss warning still exists to name.
            // =============================================================
            var f5 = spDoc();
            CsLayers.ensureSurveyLayers(f5.doc, f5.di);
            var op5 = new RAddObjectsOperation();
            spStation(f5.doc, op5, "U1", 0, 0, 0);
            spStation(f5.doc, op5, "U2", 1, 0, 10);
            spTip(f5.doc, op5, "U1.1", 2, 0);
            spTip(f5.doc, op5, "GHOST.1", 50, 50);
            f5.di.applyOperation(op5);

            var got5 = spShots(CsTags.surveyFromDocument(f5.doc));
            eqs(got5.length, 1,
                "orphan splay: only the splay with a real station comes " +
                "back -- the one naming a station the drawing no longer " +
                "has is refused");
            if (got5.length === 1) {
                eqs(got5[0].from, "U1",
                    "orphan splay: and it is the RIGHT one that survived");
            }

            // =============================================================
            // 6. WHICH STATION A SPLAY BELONGS TO IS CsBind.splayBase's
            //    ANSWER, NOT A SECOND COPY OF THE RULE. Both fixtures
            //    here are shapes a hand-rolled base-name stripper gets
            //    wrong: a DOTTED station name (a `split(".")[0]` reads
            //    "A.1.3" as station "A") and a two-digit splay index (a
            //    `\.\d$` regex leaves "B1.12" unstripped).
            // =============================================================
            var f6 = spDoc();
            CsLayers.ensureSurveyLayers(f6.doc, f6.di);
            var op6 = new RAddObjectsOperation();
            spStation(f6.doc, op6, "A.1", 0, 0, 0);
            spStation(f6.doc, op6, "B1", 1, 0, 10);
            spTip(f6.doc, op6, "A.1.3", 0, -4);
            spTip(f6.doc, op6, "B1.9", 4, 10);
            spTip(f6.doc, op6, "B1.12", 6, 10);
            f6.di.applyOperation(op6);

            var got6 = spShots(CsTags.surveyFromDocument(f6.doc));
            var from6 = [];
            for (var i6 = 0; i6 < got6.length; i6++) {
                from6.push(got6[i6].from);
            }
            eqs(from6.join(","), "A.1,B1,B1",
                "splayBase: a splay on a DOTTED station name (\"A.1.3\") " +
                "belongs to \"A.1\", and a two-digit index (\"B1.12\") " +
                "still reduces to \"B1\"");
            // ORDER is numeric, not lexicographic: ".9" before ".12"
            var d9 = null, d12 = null;
            for (i6 = 0; i6 < got6.length; i6++) {
                if (got6[i6].from !== "B1") { continue; }
                if (d9 === null) { d9 = got6[i6].distance; }
                else if (d12 === null) { d12 = got6[i6].distance; }
            }
            near(d9, 4, 1e-9,
                "splay order: B1.9 comes before B1.12 -- the index is " +
                "compared as a NUMBER, so a redraw renumbers them .1/.2 " +
                "in that order rather than putting .12 first");
            near(d12, 6, 1e-9,
                "splay order: and B1.12 is the second of the two");

            eqs(CsTags.splayIndex("A3.12"), 12,
                "splayIndex: a two-digit index reads as 12");
            eqs(CsTags.splayIndex("A.1.3"), 3,
                "splayIndex: only the LAST dotted group is the index");
            eqs(CsTags.splayIndex("A3"), -1,
                "splayIndex: a bare station name (an older drawing's " +
                "splay tag) has no index");

            // =============================================================
            // 7. CsRevise.shotFromEntity IS the reader for the ray's tag
            //    set, not a second copy of it here -- proved by a field
            //    CsTags' own legacy centerline guesser never reads back:
            //    a splay's applied Declination.
            // =============================================================
            var f7 = spDoc();
            var sv7 = CsModel.newSurvey();
            var sp7 = splayOf("W2", 6, 45, 15);
            sp7.declination = 3.25;
            sp7.excludeFromLength = true;
            sv7.shots = [shotOf("W1", "W2", 10, 0, 0), sp7];
            CsDraw.survey(sv7, CsNetwork.resolve(sv7, {}));
            var got7 = spShots(CsTags.surveyFromDocument(f7.doc));
            eqs(got7.length, 1, "sanity: the declination fixture's splay " +
                "came back");
            if (got7.length === 1) {
                near(got7[0].declination, 3.25, 1e-9,
                    "shared reader: the splay's APPLIED DECLINATION comes " +
                    "back -- a field only CsRevise.shotFromEntity knows " +
                    "how to read, so a hand-rolled distance/azimuth/" +
                    "inclination reader here would lose it");
                ok(got7[0].excludeFromLength === true,
                    "shared reader: and so do its flags");
            }

            // =============================================================
            // 8. THE CONSUMERS. SurveyStats reads this same survey
            //    through CsStats.compute; a survey that gains splays must
            //    report the same length and the same shot count, or every
            //    drawing's title block changes the day this landed.
            // =============================================================
            var st8with = CsStats.compute(rb1, resWith, CsTraverse.SLOPE);
            var st8without = CsStats.compute(stripped, resWithout,
                CsTraverse.SLOPE);
            near(st8with.surveyedLength, st8without.surveyedLength, 1e-12,
                "consumer SurveyStats: surveyed length is unchanged by " +
                "the recovered splays");
            eqs(st8with.shotCount, st8without.shotCount,
                "consumer SurveyStats: the shot count is unchanged by " +
                "the recovered splays");
            near(st8with.depth, st8without.depth, 1e-12,
                "consumer SurveyStats: depth is unchanged by the " +
                "recovered splays");

            // =============================================================
            // 9. THE OTHER READER'S OWN COPY OF THE SAME RULE.
            //    CsRevise.surveyFromDocument (the exact v3 reader every
            //    revision tool uses) also derives a pre-From splay's
            //    station from its Splay tag, and had its own inline
            //    `replace(/\.\d+$/, "")` for it. It now calls
            //    CsBind.splayBase too, so a drawing's splays cannot be
            //    reconstructed under one reading of their names and
            //    ERASED under another. Proved on a DOTTED station name,
            //    the shape a naive stripper gets wrong.
            // =============================================================
            var f9 = spDoc();
            CsLayers.ensureSurveyLayers(f9.doc, f9.di);
            var op9 = new RAddObjectsOperation();
            spStation(f9.doc, op9, "C.1", 0, 0, 0);
            spStation(f9.doc, op9, "C.2", 1, 0, 10);
            // a v3 splay ray with NO From tag -- what an early v3 build
            // wrote, and the branch CsRevise's Splay-tag fallback is for
            CsDraw.addLine(f9.doc, op9, CsLayers.SPLAYS,
                new RVector(0, 0), new RVector(4, 0),
                "Splay", "C.1.2",
                { Distance: 4, Azimuth: 90, Inclination: 20 });
            f9.di.applyOperation(op9);

            var rec9 = CsRevise.surveyFromDocument(f9.doc);
            var got9 = spShots(rec9.survey);
            eqs(got9.length, 1,
                "CsRevise pre-From splay: the ray is read back as a splay " +
                "shot");
            if (got9.length === 1) {
                eqs(got9[0].from, "C.1",
                    "CsRevise pre-From splay: its station comes from " +
                    "CsBind.splayBase, so a DOTTED station name survives " +
                    "-- a split-on-dot reading would say \"C\"");
                near(got9[0].inclination, 20, 1e-9,
                    "CsRevise pre-From splay: and its readings come off " +
                    "the ray");
            }
            // the SAME name, read by the SAME rule, on the erase side
            eqs(CsBind.splayBase("C.1.2"), "C.1",
                "one rule: CsDraw.eraseStations strips \"C.1.2\" to the " +
                "same station the two readers hang it on");

            // =============================================================
            // 10. A SPLAY IS NEVER HANDED BACK AS AN ORDINARY LEG. The
            //     reader forces `to` empty rather than trusting whatever
            //     the ray carries, and this is the shape that proves it:
            //     a hand-edited (or foreign) ray whose To tag is filled
            //     in. Trust it and CsNetwork.resolve stops skipping the
            //     shot, places a station nobody surveyed, and the whole
            //     drawing changes shape the day splay recovery landed --
            //     the one outcome this task is not allowed to have.
            // =============================================================
            var f10 = spDoc();
            CsLayers.ensureSurveyLayers(f10.doc, f10.di);
            var op10 = new RAddObjectsOperation();
            spStation(f10.doc, op10, "V1", 0, 0, 0);
            spStation(f10.doc, op10, "V2", 1, 0, 10);
            CsDraw.addLine(f10.doc, op10, CsLayers.SPLAYS,
                new RVector(0, 10), new RVector(4, 10),
                "Splay", "V2.1",
                { From: "V2", To: "V9", Distance: 4, Azimuth: 90,
                  Inclination: 0 });
            f10.di.applyOperation(op10);

            var rb10 = CsTags.surveyFromDocument(f10.doc);
            var got10 = spShots(rb10);
            eqs(got10.length, 1,
                "sanity: the To-tagged splay ray came back as a splay");
            if (got10.length === 1) {
                eqs(got10[0].to, "",
                    "a splay is never an ordinary leg: its TO is forced " +
                    "empty, whatever the ray's own To tag says");
            }
            var res10 = CsNetwork.resolve(rb10, {});
            ok(res10.stations["V9"] === undefined,
                "a splay is never an ordinary leg: no station is placed " +
                "at its tip -- trusting the To tag would survey V9 into " +
                "existence");
            eqs(res10.legs.length, 1,
                "a splay is never an ordinary leg: exactly the one real " +
                "leg resolves, got " + res10.legs.length);
        } finally {
            RSettings.setValue(KEY_AUTO, hadAuto);
        }
    }());
}

// ---------------------------------------------------------------------
// CsLayers.frameOf -- the single frame test
// ---------------------------------------------------------------------

(function() {
    eqs(CsLayers.frameOf(CsLayers.SHOTS), "plan", "CTRL-SHOTS is plan");
    eqs(CsLayers.frameOf(CsLayers.WALLS_SURVEYED), "plan", "WALLS-SURVEYED is plan");
    eqs(CsLayers.frameOf(CsLayers.PROFILE_FLOOR), "profile",
        "CTRL-PROFILE-FLOOR is profile");
    eqs(CsLayers.frameOf(CsLayers.PROFILE_SHOTS), "profile",
        "CTRL-PROFILE-SHOTS is profile");
    eqs(CsLayers.frameOf("PROFILE-CEILING"), "profile",
        "the traced ceiling layer is profile");
    eqs(CsLayers.frameOf(CsLayers.BORDER), "sheet", "BORDER is sheet");
    eqs(CsLayers.frameOf(CsLayers.TITLE_BLOCK), "sheet", "TITLE-BLOCK is sheet");
    eqs(CsLayers.frameOf(CsLayers.SCALE_BAR), "sheet", "SCALE-BAR is sheet");
    eqs(CsLayers.frameOf(CsLayers.LEGEND), "sheet", "LEGEND is sheet");
    eqs(CsLayers.frameOf("0"), "sheet", "layer 0 is sheet");
    eqs(CsLayers.frameOf("Defpoints"), "sheet", "Defpoints is sheet");

    // An unknown layer defaults to PLAN, deliberately: a profile-scoped
    // sweep must never pick up a layer nobody classified.
    eqs(CsLayers.frameOf("SOMEONES-OWN-LAYER"), "plan",
        "an unknown layer defaults to plan, never profile");
    eqs(CsLayers.frameOf(""), "plan", "an empty name defaults to plan");
    eqs(CsLayers.frameOf(null), "plan", "null defaults to plan");
}());

(function() {
    // THE LOAD-BEARING RULE. Generated profile geometry must stay
    // ineligible for binding, and it stays ineligible only because the
    // name begins CTRL-. If a rename ever drops that prefix, the
    // generator's own output becomes bindable and movable, and this
    // assertion is what says so.
    var generated = [CsLayers.PROFILE_FLOOR, CsLayers.PROFILE_CEILING,
        CsLayers.PROFILE_SHOTS, CsLayers.PROFILE_STATIONS,
        CsLayers.PROFILE_STATION_LABELS, CsLayers.PROFILE_SPLAYS,
        CsLayers.PROFILE_LRUD];
    var i;
    for (i = 0; i < generated.length; i++) {
        ok(generated[i].indexOf("CTRL-") === 0,
            generated[i] + " begins CTRL- (the binding gate depends on it)");
        ok(CsBind.isLineworkLayer(generated[i]) === false,
            generated[i] + " is NOT bindable linework");
        eqs(CsLayers.frameOf(generated[i]), "profile",
            generated[i] + " is in the profile frame");
    }

    var traceable = ["PROFILE-CEILING", "PROFILE-FLOOR",
        "PROFILE-WALLS-INFERRED", "PROFILE-TEXT-NOTES",
        "PROFILE-TEXT-LABELS", "PROFILE-BREAKDOWN", "PROFILE-ENTRANCE"];
    for (i = 0; i < traceable.length; i++) {
        ok(traceable[i].indexOf("CTRL-") !== 0,
            traceable[i] + " does NOT begin CTRL-");
        ok(CsBind.isLineworkLayer(traceable[i]) === true,
            traceable[i] + " IS bindable linework -- it is traced by hand");
        eqs(CsLayers.frameOf(traceable[i]), "profile",
            traceable[i] + " is in the profile frame");
    }
}());

(function() {
    // every registry layer answers exactly one frame, and has a default
    var seen = {}, missing = [], bad = [];
    for (var k in CsLayers) {
        if (!CsLayers.hasOwnProperty(k) || typeof CsLayers[k] !== "string") {
            continue;
        }
        var name = CsLayers[k];
        var f = CsLayers.frameOf(name);
        if (f !== "plan" && f !== "profile" && f !== "sheet") {
            bad.push(name + "=" + f);
        }
        if (seen.hasOwnProperty(name) && seen[name] !== f) {
            bad.push(name + " answers two frames");
        }
        seen[name] = f;
        if (f !== "sheet" && !CsLayers.DEFAULTS.hasOwnProperty(name)) {
            missing.push(name);
        }
    }
    eqs(bad.join(","), "", "no layer answers a bad or doubled frame");
    eqs(missing.join(","), "", "every non-sheet registry layer has a DEFAULTS row");
}());

// ---------------------------------------------------------------------
// CsBind.inFrame -- the pure half of the cross-frame refusal
// ---------------------------------------------------------------------

(function() {
    var idx = [
        { name: "P1", x: 0, y: 0, frame: "plan" },
        { name: "Q/Q1", x: 1, y: 0, frame: "profile" },
        { name: "OLD", x: 2, y: 0 }
    ];
    var namesOf = function(list) {
        var out = [], i;
        for (i = 0; i < list.length; i++) { out.push(list[i].name); }
        return out.join(",");
    };
    eqs(namesOf(CsBind.inFrame(idx, "plan")), "P1,OLD",
        "the plan frame keeps its own stations");
    eqs(namesOf(CsBind.inFrame(idx, "profile")), "Q/Q1,OLD",
        "the profile frame keeps its own stations");
    // An entry with no frame at all comes from an index built by hand,
    // before frames existed. Keeping it refuses a KNOWN crossing
    // without demanding provenance nothing used to carry.
    eqs(namesOf(CsBind.inFrame(idx, "sheet")), "OLD",
        "an unlabelled entry stays eligible in every frame");
    eqs(String(CsBind.inFrame(null, "plan").length), "0",
        "a null index is empty, not a throw");
}());

// ---------------------------------------------------------------------
// CsTrace -- resample and reduce
// ---------------------------------------------------------------------
(function() {
    loadRepoScript("scripts/CaveSurvey/Core/CsUnits.js");
    loadRepoScript("scripts/CaveSurvey/Core/CsTrace.js");

    function pt(x, y) { return { x: x, y: y }; }

    // -- spacingFor -------------------------------------------------
    near(CsTrace.spacingFor("ft"), 1.0, 1e-9,
        "CsTrace.spacingFor: a foot drawing spaces at 1.0");
    near(CsTrace.spacingFor("m"), 0.3048, 1e-9,
        "CsTrace.spacingFor: a metre drawing spaces at 0.3048");

    // -- resample ---------------------------------------------------
    var line = [pt(0, 0), pt(10, 0)];
    var evenly = CsTrace.resample(line, 2.0);
    eqs(evenly.length, 6, "CsTrace.resample: 10 units at 2 gives 6 points");
    near(evenly[1].x, 2.0, 1e-9, "CsTrace.resample: second point at 2.0");
    near(evenly[5].x, 10.0, 1e-9, "CsTrace.resample: last input point kept");

    // A run whose length is NOT a whole number of intervals: 5 units at
    // spacing 2 gives 0, 2, 4 and then the end at 5. Without the tail
    // push the caver's chosen endpoint is silently rounded back to 4,
    // visibly shortening every wall run -- and the 10-at-2 case above
    // cannot see it, because there the last interval lands on the end.
    var ragged = CsTrace.resample([pt(0, 0), pt(5, 0)], 2.0);
    eqs(ragged.length, 4, "CsTrace.resample: a ragged end keeps the endpoint");
    // Indexed from the END, not by a fixed [3]: with the tail push
    // removed there is no element 3, and reading .x off undefined throws
    // before the report can print -- a real failure made invisible.
    near(ragged[ragged.length - 1].x, 5.0, 1e-9,
        "CsTrace.resample: the ragged endpoint is the input's own last point");

    var short = CsTrace.resample([pt(3, 4)], 1.0);
    eqs(short.length, 1, "CsTrace.resample: a single point is returned as-is");

    var degenerate = CsTrace.resample(line, 0);
    eqs(degenerate.length, 2,
        "CsTrace.resample: spacing 0 returns the input, it does not hang");

    var withDupes = CsTrace.resample([pt(0, 0), pt(0, 0), pt(4, 0)], 2.0);
    eqs(withDupes.length, 3,
        "CsTrace.resample: a zero-length segment is skipped, not divided by");

    var source = [pt(0, 0), pt(10, 0)];
    CsTrace.resample(source, 2.0);
    eqs(source.length, 2, "CsTrace.resample: the caller's array is untouched");

    var aliasProbe = [pt(1, 1)];
    var aliasOut = CsTrace.resample(aliasProbe, 1.0);
    aliasOut[0].x = 99;
    near(aliasProbe[0].x, 1.0, 1e-9,
        "CsTrace.resample: the degenerate return does not alias the input");

    // -- reduce -----------------------------------------------------
    var straight = [pt(0, 0), pt(1, 0), pt(2, 0), pt(3, 0), pt(4, 0)];
    var thinned = CsTrace.reduce(straight, 0.01);
    eqs(thinned.length, 2,
        "CsTrace.reduce: a straight run collapses to its two endpoints");

    var corner = [pt(0, 0), pt(5, 0), pt(5, 5)];
    eqs(CsTrace.reduce(corner, 0.01).length, 3,
        "CsTrace.reduce: a real corner is kept");

    var bulge = [pt(0, 0), pt(2, 1), pt(4, 0)];
    eqs(CsTrace.reduce(bulge, 2.0).length, 2,
        "CsTrace.reduce: a bulge inside tolerance is dropped");
    eqs(CsTrace.reduce(bulge, 0.5).length, 3,
        "CsTrace.reduce: the same bulge outside tolerance is kept");

    var pair = [pt(0, 0), pt(9, 9)];
    eqs(CsTrace.reduce(pair, 100.0).length, 2,
        "CsTrace.reduce: endpoints survive any tolerance");

    // No Smoothing is a tolerance of ZERO: every point that departs
    // from its neighbours' chord at all is kept, so wall detail survives
    // intact. Only exactly-collinear points drop, which is why a
    // straight run is still two points and not a hundred.
    var zig = [];
    for (var zi = 0; zi <= 20; zi++) {
        zig.push(pt(zi, (zi % 2) ? 1 : 0));
    }
    eqs(CsTrace.reduce(zig, 0).length, zig.length,
        "CsTrace.reduce: zero tolerance keeps every non-collinear point");
    eqs(CsTrace.reduce([pt(0, 0), pt(1, 0), pt(2, 0), pt(3, 0)], 0).length, 2,
        "CsTrace.reduce: zero tolerance still collapses a straight run");

    var reduceSource = [pt(0, 0), pt(1, 0), pt(2, 0)];
    CsTrace.reduce(reduceSource, 0.01);
    eqs(reduceSource.length, 3, "CsTrace.reduce: the caller's array is untouched");
}());

// ---------------------------------------------------------------------
// CsTrace -- the point-to-frame region test (QCAD only: needs RDocument)
// ---------------------------------------------------------------------
if (!IS_NODE) {
    (function() {
        loadRepoScript("scripts/CaveSurvey/Core/CsLayers.js");
        loadRepoScript("scripts/CaveSurvey/Core/CsTrace.js");

        function lineOn(doc, di, layerName, x1, y1, x2, y2) {
            CsLayers.ensure(doc, di, layerName);
            var e = new RLineEntity(doc, new RLineData(
                new RVector(x1, y1), new RVector(x2, y2)));
            e.setLayerId(doc.getLayerId(layerName));
            var op = new RAddObjectsOperation();
            op.addObject(e, false);
            di.applyOperation(op);
            return e;
        }

        // -- frameExtents generalises planExtents -------------------
        // profileRegion is CsProfileDraw.frameExtents(doc, "profile"):
        // the same union planExtents already did for the plan frame,
        // with the frame passed in rather than hardcoded.
        var docG = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var diG = new RDocumentInterface(docG);
        lineOn(docG, diG, CsLayers.WALLS_SURVEYED, 0, 0, 100, 50);
        var planBox = CsProfileDraw.frameExtents(docG, "plan");
        ok(planBox !== null, "frameExtents: finds plan geometry");
        ok(CsProfileDraw.frameExtents(docG, "profile") === null,
            "frameExtents: the same drawing has no profile geometry");
        near(CsProfileDraw.planExtents(docG).maxY, planBox.maxY, 1e-9,
            "planExtents: still answers exactly what frameExtents does");

        // -- an empty drawing has no region at all -------------------
        var docA = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        ok(CsTrace.profileRegion(docA) === null,
            "CsTrace.profileRegion: a drawing with no profile geometry has no region");
        eqs(CsTrace.frameAt(docA, { x: 0, y: -500 }), "plan",
            "CsTrace.frameAt: with no region every point is plan");

        // -- plan above, profile below, as CsProfileDraw places them --
        var docB = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var diB = new RDocumentInterface(docB);
        lineOn(docB, diB, CsLayers.WALLS_SURVEYED, 0, 0, 100, 50);
        lineOn(docB, diB, CsLayers.PROFILE_TRACED_CEILING, 0, -200, 100, -180);

        var region = CsTrace.profileRegion(docB);
        ok(region !== null, "CsTrace.profileRegion: profile geometry makes a region");
        near(region.maxY, -180, 1e-6,
            "CsTrace.profileRegion: the region's top is the profile geometry's top");

        eqs(CsTrace.frameAt(docB, { x: 50, y: -190 }), "profile",
            "CsTrace.frameAt: a point inside the region is profile");
        eqs(CsTrace.frameAt(docB, { x: 50, y: 25 }), "plan",
            "CsTrace.frameAt: a point in the plan geometry is plan");
        eqs(CsTrace.frameAt(docB, { x: 50, y: -100 }), "plan",
            "CsTrace.frameAt: a point in the gutter is plan, not profile");

        // -- hand-traced linework grows the region -------------------
        lineOn(docB, diB, CsLayers.PROFILE_TRACED_FLOOR, 0, -400, 100, -390);
        eqs(CsTrace.frameAt(docB, { x: 50, y: -395 }), "profile",
            "CsTrace.frameAt: hand-traced profile linework extends the region");

        // -- OVERLAPPING coordinates, both directions ----------------
        // The real risk: one model space, two frames. A profile line at
        // the SAME absolute coordinates as plan geometry must still
        // answer profile, and a plan line there must still answer plan.
        var docC = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var diC = new RDocumentInterface(docC);
        lineOn(docC, diC, CsLayers.PROFILE_TRACED_CEILING, 0, 0, 100, 10);
        eqs(CsTrace.frameAt(docC, { x: 50, y: 5 }), "profile",
            "CsTrace.frameAt: a profile region at the origin is still profile");

        var docD = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var diD = new RDocumentInterface(docD);
        lineOn(docD, diD, CsLayers.WALLS_SURVEYED, 0, 0, 100, 10);
        eqs(CsTrace.frameAt(docD, { x: 50, y: 5 }), "plan",
            "CsTrace.frameAt: the same coordinates with only plan geometry are plan");

        // -- the whole-path check -----------------------------------
        var boxB = CsTrace.profileRegion(docB);
        eqs(CsTrace.pathFrame(boxB, [{ x: 50, y: -190 }, { x: 60, y: -185 }]),
            "profile",
            "CsTrace.pathFrame: a path wholly inside the region is profile");
        ok(CsTrace.pathFrame(boxB, [{ x: 50, y: 25 }, { x: 50, y: -190 }]) === null,
            "CsTrace.pathFrame: a path crossing the gutter has no single frame");
        eqs(CsTrace.frameIn(null, { x: 0, y: 0 }), "plan",
            "CsTrace.frameIn: a null region makes every point plan");
    }());
}

// ---------------------------------------------------------------------
// CsTrace -- fitSpline and emit (QCAD only: RSpline and a document)
// ---------------------------------------------------------------------
if (!IS_NODE) {
    (function() {
        loadRepoScript("scripts/CaveSurvey/Core/CsLayers.js");
        loadRepoScript("scripts/CaveSurvey/Core/CsBind.js");
        loadRepoScript("scripts/CaveSurvey/Core/CsTrace.js");

        function pt(x, y) { return { x: x, y: y }; }

        var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var di = new RDocumentInterface(doc);

        // -- fitSpline ----------------------------------------------
        ok(CsTrace.fitSpline(doc, [pt(0, 0)]) === null,
            "CsTrace.fitSpline: one point is not a curve");
        ok(CsTrace.fitSpline(doc, []) === null,
            "CsTrace.fitSpline: no points is not a curve");

        var spline = CsTrace.fitSpline(doc, [pt(0, 0), pt(5, 1), pt(10, 0)]);
        ok(!isNull(spline), "CsTrace.fitSpline: three points make a spline");
        eqs(spline.getData().getControlPoints().length, 3,
            "CsTrace.fitSpline: every input point becomes a CONTROL point");
        eqs(spline.getData().getFitPoints().length, 0,
            "CsTrace.fitSpline: no fit points -- they have no geometry in this build");
        // Degree follows the point count: a B-spline of degree d needs
        // d+1 control points, and asking for cubic with fewer yields a
        // curve with no geometry at all.
        eqs(spline.getData().getDegree(), 2,
            "CsTrace.fitSpline: three control points give a quadratic");
        eqs(CsTrace.degreeFor(2), 1, "CsTrace.degreeFor: two points are linear");
        eqs(CsTrace.degreeFor(3), 2, "CsTrace.degreeFor: three are quadratic");
        eqs(CsTrace.degreeFor(4), 3, "CsTrace.degreeFor: four are cubic");
        eqs(CsTrace.degreeFor(50), 3, "CsTrace.degreeFor: capped at cubic");

        // The straight-passage case that would otherwise vanish: the
        // commonest trace there is, reduced to exactly two points.
        var straightDoc = new RDocument(new RMemoryStorage(),
            new RSpatialIndexNavel());
        var straightDi = new RDocumentInterface(straightDoc);
        var sres = CsTrace.emit(straightDoc, straightDi,
            CsLayers.WALLS_SURVEYED,
            [pt(0, 0), pt(10, 0), pt(20, 0)], 1.0, 0.01);
        eqs(sres.kept, 2, "straight run: reduce keeps just the endpoints");
        ok(sres.added === true, "straight run: it is drawn");
        var sEnt = straightDoc.queryEntity(straightDoc.queryLayerEntities(
            straightDoc.getLayerId(CsLayers.WALLS_SURVEYED), true)[0]);
        ok(sEnt.getBoundingBox().getWidth() > 15.0,
            "straight run: a two-point trace has real width, not a 0x0 box");
        near(spline.getData().getControlPoints()[1].x, 5.0, 1e-9,
            "CsTrace.fitSpline: control points keep their order");

        // Geometry is asserted on the ADDED entity, below: a bounding
        // box is only computed once the entity is in a document.

        // -- emit onto a normal layer -------------------------------
        var before = doc.queryAllEntities(false, false).length;
        var result = CsTrace.emit(doc, di, CsLayers.WALLS_SURVEYED,
            [pt(0, 0), pt(10, 0), pt(20, 0)], 1.0, 0.01);
        ok(result.added === true, "CsTrace.emit: a real path is added");
        eqs(doc.queryAllEntities(false, false).length, before + 1,
            "CsTrace.emit: exactly one entity lands");
        ok(result.sampled > result.kept,
            "CsTrace.emit: reduction dropped points from a straight run");
        eqs(result.kept, 2,
            "CsTrace.emit: a straight run keeps only its two endpoints");

        // queryAllEntities is NOT insertion-ordered, so ids[length-1] is
        // an arbitrary entity -- it only looked right here because this
        // document was empty. Find the entity by its layer instead.
        var onWalls = doc.queryLayerEntities(
            doc.getLayerId(CsLayers.WALLS_SURVEYED), true);
        eqs(onWalls.length, 1,
            "CsTrace.emit: exactly one entity is on the named layer");

        // THE CHECKS THAT WOULD HAVE CAUGHT THE SHIPPED BUG.
        //
        // Fit-point splines are a QCAD PRO feature; CaveCAD forks the
        // Community edition, so appendFitPoint yields a spline with no
        // control points, a 0 x 0 bounding box, and no DXF record --
        // while isValid() still answers TRUE. Three traces landed in the
        // document, reported success, rendered nothing and vanished on
        // save. So: never assert a spline by isValid(). Assert that it
        // occupies space, and that it survives a round trip to file.
        var addedEnt = doc.queryEntity(onWalls[0]);
        var addedBox = addedEnt.getBoundingBox();
        ok(addedBox.getWidth() > 15.0,
            "CsTrace.emit: the landed curve occupies real width");
        ok(addedEnt.getData().getControlPoints().length >= 2,
            "CsTrace.emit: the landed curve has control points");

        var rtPath = repoRoot + "/tests/.trace-roundtrip.dxf";
        var rtFilter = "";
        var rtFilters = RFileExporterRegistry.getFilterStrings();
        for (var rf = 0; rf < rtFilters.length; rf++) {
            if (String(rtFilters[rf]).indexOf("dxflib") >= 0) {
                rtFilter = rtFilters[rf];
                break;
            }
        }
        ok(di.exportFile(rtPath, rtFilter, false),
            "CsTrace.emit round trip: the drawing exports");

        var rtDoc = new RDocument(new RMemoryStorage(),
            new RSpatialIndexNavel());
        var rtDi = new RDocumentInterface(rtDoc);
        eqs(rtDi.importFile(rtPath, "", false),
            RDocumentInterface.IoErrorNoError,
            "CsTrace.emit round trip: the file reads back");
        eqs(rtDoc.queryLayerEntities(
                rtDoc.getLayerId(CsLayers.WALLS_SURVEYED), true).length, 1,
            "CsTrace.emit round trip: the traced curve SURVIVES the save");
        new QFile(rtPath).remove();

        // -- emit creates a layer the drawing lacks -----------------
        var doc3 = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var di3 = new RDocumentInterface(doc3);
        ok(!doc3.hasLayer(CsLayers.BREAKDOWN_BOUNDARY),
            "CsTrace.emit fixture: the target layer is absent to begin with");
        CsTrace.emit(doc3, di3, CsLayers.BREAKDOWN_BOUNDARY,
            [pt(0, 0), pt(4, 4)], 1.0, 0.01);
        ok(doc3.hasLayer(CsLayers.BREAKDOWN_BOUNDARY),
            "CsTrace.emit: ensures the layer rather than failing");

        // -- emit adds nothing for a degenerate path ----------------
        var beforeShort = doc.queryAllEntities(false, false).length;
        var shortResult = CsTrace.emit(doc, di, CsLayers.WALLS_SURVEYED,
            [pt(3, 3)], 1.0, 0.01);
        ok(shortResult.added === false,
            "CsTrace.emit: a one-point path reports nothing added");
        eqs(doc.queryAllEntities(false, false).length, beforeShort,
            "CsTrace.emit: a one-point path adds no entity");

        // -- emit onto an OFF layer ---------------------------------
        // This build drops adds on an off layer with NO error at all,
        // and switching the feature layer off to see the scan beneath
        // is the workflow this tool exists for.
        var doc2 = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var di2 = new RDocumentInterface(doc2);
        CsLayers.ensure(doc2, di2, CsLayers.PROFILE_TRACED_CEILING);
        var lay = doc2.queryLayer(CsLayers.PROFILE_TRACED_CEILING);
        lay.setOff(true);
        var opOff = new RModifyObjectsOperation();
        opOff.addObject(lay, false);
        di2.applyOperation(opOff);
        ok(doc2.queryLayer(CsLayers.PROFILE_TRACED_CEILING).isOff(),
            "CsTrace.emit fixture: the target layer starts off");

        var offBefore = doc2.queryAllEntities(false, false).length;
        CsTrace.emit(doc2, di2, CsLayers.PROFILE_TRACED_CEILING,
            [pt(0, -100), pt(10, -100), pt(20, -95)], 1.0, 0.01);
        eqs(doc2.queryAllEntities(false, false).length, offBefore + 1,
            "CsTrace.emit: the spline lands even though the layer is off");
        ok(doc2.queryLayer(CsLayers.PROFILE_TRACED_CEILING).isOff(),
            "CsTrace.emit: the layer is switched back off afterwards");

        // -- LOCKED and FROZEN refuse the add, and emit says so -----
        // withLayerOn covers OFF only. Locked and frozen also refuse,
        // silently, and emit must not claim success: an earlier version
        // returned added:true whenever a curve could be built, so the
        // panel reported "44 sampled, 10 kept" for a trace that never
        // reached the drawing.
        function refusingLayer(which) {
            var d = new RDocument(new RMemoryStorage(),
                new RSpatialIndexNavel());
            var i = new RDocumentInterface(d);
            CsLayers.ensure(d, i, CsLayers.WALLS_SURVEYED);
            var lay = d.queryLayer(CsLayers.WALLS_SURVEYED);
            if (which === "locked") { lay.setLocked(true); }
            if (which === "frozen") { lay.setFrozen(true); }
            var mop = new RModifyObjectsOperation();
            mop.addObject(lay, false);
            i.applyOperation(mop);
            return CsTrace.emit(d, i, CsLayers.WALLS_SURVEYED,
                [pt(0, 0), pt(10, 0), pt(20, 5)], 1.0, 0.5);
        }
        ok(refusingLayer("locked").added === false,
            "CsTrace.emit: a LOCKED layer refuses the add, and emit reports it");

        // FROZEN is now cleared for the write, like OFF. A drawing with
        // CTRL-RAW frozen made every Survey Notebook redraw print
        // "Transaction failed" twice with nothing to say which layer.
        ok(refusingLayer("frozen").added === true,
            "CsTrace.emit: a FROZEN layer is thawed for the write, like OFF");

        // ...and put back exactly as it was.
        (function() {
            var d = new RDocument(new RMemoryStorage(),
                new RSpatialIndexNavel());
            var i4 = new RDocumentInterface(d);
            CsLayers.ensure(d, i4, CsLayers.WALLS_SURVEYED);
            var lay4 = d.queryLayer(CsLayers.WALLS_SURVEYED);
            lay4.setFrozen(true);
            var m4 = new RModifyObjectsOperation();
            m4.addObject(lay4, false);
            i4.applyOperation(m4);
            ok(d.queryLayer(CsLayers.WALLS_SURVEYED).isFrozen(),
                "withLayerOn fixture: the layer starts frozen");

            var ran = false;
            CsLayers.withLayerOn(d, i4, CsLayers.WALLS_SURVEYED, function() {
                ran = true;
                ok(!d.queryLayer(CsLayers.WALLS_SURVEYED).isFrozen(),
                    "withLayerOn: thawed while fn runs");
            });
            ok(ran, "withLayerOn: fn ran");
            ok(d.queryLayer(CsLayers.WALLS_SURVEYED).isFrozen(),
                "withLayerOn: frozen again afterwards");

            // Restored even when fn throws, or a failed draw would leave
            // the caver's layer thawed with no sign of it.
            var threw = false;
            try {
                CsLayers.withLayerOn(d, i4, CsLayers.WALLS_SURVEYED,
                    function() { throw new Error("boom"); });
            } catch (eBoom) {
                threw = true;
            }
            ok(threw, "withLayerOn: it re-throws fn's error");
            ok(d.queryLayer(CsLayers.WALLS_SURVEYED).isFrozen(),
                "withLayerOn: still frozen again after a throw");

            // LOCKED is left alone on purpose: protection, not visibility.
            var d5 = new RDocument(new RMemoryStorage(),
                new RSpatialIndexNavel());
            var i5 = new RDocumentInterface(d5);
            CsLayers.ensure(d5, i5, CsLayers.WALLS_SURVEYED);
            var lay5 = d5.queryLayer(CsLayers.WALLS_SURVEYED);
            lay5.setLocked(true);
            var m5 = new RModifyObjectsOperation();
            m5.addObject(lay5, false);
            i5.applyOperation(m5);
            CsLayers.withLayerOn(d5, i5, CsLayers.WALLS_SURVEYED,
                function() {
                    ok(d5.queryLayer(CsLayers.WALLS_SURVEYED).isLocked(),
                        "withLayerOn: a LOCKED layer stays locked -- not ours to override");
                });
        }());

        // -- no binding tag ----------------------------------------
        var onCeiling = doc2.queryLayerEntities(
            doc2.getLayerId(CsLayers.PROFILE_TRACED_CEILING), true);
        var traced = doc2.queryEntity(onCeiling[0]);
        ok(!CsBind.hasLineworkTags(traced),
            "CsTrace.emit: leaves binding to the CsBind sweep, tags nothing");
    }());
}

// ---------------------------------------------------------------------
// FeatureTraceRun -- the frame guard, and the drag maths without a mouse
// ---------------------------------------------------------------------
if (!IS_NODE) {
    (function() {
        loadRepoScript("scripts/CaveSurvey/Core/CsLayers.js");
        loadRepoScript("scripts/CaveSurvey/Core/CsTrace.js");
        loadRepoScript("scripts/CaveSurvey/FeatureTrace/FeatureTraceRun.js");

        function pt(x, y) { return { x: x, y: y }; }

        var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var di = new RDocumentInterface(doc);

        CsLayers.ensure(doc, di, CsLayers.PROFILE_TRACED_CEILING);
        var band = new RLineEntity(doc, new RLineData(
            new RVector(0, -200), new RVector(100, -180)));
        band.setLayerId(doc.getLayerId(CsLayers.PROFILE_TRACED_CEILING));
        var op = new RAddObjectsOperation();
        op.addObject(band, false);
        di.applyOperation(op);

        var box = CsTrace.profileRegion(doc);

        // -- in frame, both ways ------------------------------------
        ok(FeatureTraceRun.frameGuard(box, CsLayers.PROFILE_TRACED_CEILING,
            pt(50, -190)) === null,
            "frameGuard: a profile layer traced inside the region is allowed");
        ok(FeatureTraceRun.frameGuard(box, CsLayers.WALLS_SURVEYED,
            pt(50, 500)) === null,
            "frameGuard: a plan layer traced outside the region is allowed");

        // -- out of frame, both ways --------------------------------
        var up = FeatureTraceRun.frameGuard(box,
            CsLayers.PROFILE_TRACED_CEILING, pt(50, 500));
        ok(up !== null,
            "frameGuard: a profile layer traced up in the plan is refused");
        ok(String(up).indexOf("profile") >= 0,
            "frameGuard: the refusal names the layer's frame");
        ok(String(up).indexOf("plan") >= 0,
            "frameGuard: the refusal names the frame the cursor was in");

        ok(FeatureTraceRun.frameGuard(box, CsLayers.WALLS_SURVEYED,
            pt(50, -190)) !== null,
            "frameGuard: a plan layer traced down in the region is refused");

        // -- targetLayer: fallback AND the armed case ---------------
        // Both halves, because a test of only the fallback passes even
        // if targetLayer ignores the armed target entirely -- which is
        // the whole mechanism the panel drives it through.
        eqs(FeatureTraceRun.targetLayer(), CsLayers.WALLS_SURVEYED,
            "FeatureTraceRun.targetLayer: falls back to surveyed walls unarmed");

        FeatureTrace = { target: CsLayers.PROFILE_TRACED_FLOOR };
        eqs(FeatureTraceRun.targetLayer(), CsLayers.PROFILE_TRACED_FLOOR,
            "FeatureTraceRun.targetLayer: an armed target is what gets traced");
        FeatureTrace = { target: undefined };
        eqs(FeatureTraceRun.targetLayer(), CsLayers.WALLS_SURVEYED,
            "FeatureTraceRun.targetLayer: disarming falls back again");

        // -- the drag maths, without a mouse ------------------------
        // A live drag is mouse-only, but what it DOES with the samples
        // is not: this is the same emit() call commit() makes, on a
        // sample list shaped like a real 6px-threshold capture.
        var samples = [];
        var i;
        for (i = 0; i <= 60; i++) {
            samples.push(pt(i * 0.5, 0));   // 30 ft of wall, ~6in apart
        }
        var planDoc = new RDocument(new RMemoryStorage(),
            new RSpatialIndexNavel());
        var planDi = new RDocumentInterface(planDoc);
        var res = CsTrace.emit(planDoc, planDi, CsLayers.WALLS_SURVEYED,
            samples, 1.0, 0.5);
        ok(res.added === true, "drag maths: a 30 ft straight run is drawn");
        eqs(planDoc.queryAllEntities(false, false).length, 1,
            "drag maths: exactly one entity lands for one run");
        ok(res.kept < res.sampled,
            "drag maths: the spline has fewer points than the drag sampled");
        eqs(planDoc.queryLayerEntities(
                planDoc.getLayerId(CsLayers.WALLS_SURVEYED), true).length, 1,
            "drag maths: it lands on the armed layer and no other");

        // A cross-gutter drag is discarded, so nothing lands.
        var crossing = [pt(50, 500), pt(50, 300), pt(50, -190)];
        ok(CsTrace.pathFrame(box, crossing) === null,
            "drag maths: a drag from the plan into the region has no frame");
    }());
}

// ---------------------------------------------------------------------
// FeatureTrace.ROWS -- the table cannot name a generator-owned layer
// ---------------------------------------------------------------------
if (!IS_NODE) {
    (function() {
        loadRepoScript("scripts/CaveSurvey/Core/CsLayers.js");
        loadRepoScript("scripts/CaveSurvey/Core/CsLayerVariants.js");
        loadRepoScript("scripts/CaveSurvey/Core/CsBind.js");
        loadRepoScript("scripts/CaveSurvey/Core/CsTrace.js");
        loadRepoScript("scripts/CaveSurvey/FeatureTrace/FeatureTraceRun.js");
        loadRepoScript("scripts/CaveSurvey/FeatureTrace/FeatureTrace.js");

        eqs(FeatureTrace.ROWS.length, 10,
            "FeatureTrace.ROWS: ten traceable features");

        var planCount = 0, profileCount = 0, i;
        var seen = {};
        for (i = 0; i < FeatureTrace.ROWS.length; i++) {
            var row = FeatureTrace.ROWS[i];

            // The one-word slip this kills: CsLayers.PROFILE_FLOOR is the
            // GENERATED CTRL-PROFILE-FLOOR, which erase() owns and clears.
            // isLineworkLayer is false for anything CTRL-, so a row naming
            // the generated twin fails HERE instead of losing an hour of
            // tracing at the next redraw.
            ok(CsBind.isLineworkLayer(row.layer),
                "FeatureTrace.ROWS: " + row.layer +
                    " is a linework layer, not a generated CTRL- one");

            var frame = CsLayers.frameOf(row.layer);
            ok(frame === "plan" || frame === "profile",
                "FeatureTrace.ROWS: " + row.layer + " is in a view frame");
            if (frame === "plan") { planCount++; } else { profileCount++; }

            ok(!isNull(row.label) && row.label.length > 0,
                "FeatureTrace.ROWS: " + row.layer + " has a label");

            ok(isNull(seen[row.layer]),
                "FeatureTrace.ROWS: " + row.layer + " appears once only");
            seen[row.layer] = true;

            // Every layer must be in the registry's DEFAULTS, or ensure()
            // silently gives it the fallback appearance instead of the
            // traced-wall weight the template carries.
            ok(!isNull(CsLayers.DEFAULTS[row.layer]),
                "FeatureTrace.ROWS: " + row.layer + " has a DEFAULTS entry");
        }
        eqs(planCount, 5, "FeatureTrace.ROWS: five plan rows");
        eqs(profileCount, 5, "FeatureTrace.ROWS: five profile rows");

        // -- arming is what FeatureTraceRun reads -------------------
        FeatureTrace.target = undefined;
        FeatureTrace.armLayer(CsLayers.PROFILE_TRACED_FLOOR);
        eqs(FeatureTrace.target, CsLayers.PROFILE_TRACED_FLOOR,
            "FeatureTrace.armLayer: sets the target the drag reads");
        eqs(FeatureTraceRun.targetLayer(), CsLayers.PROFILE_TRACED_FLOOR,
            "FeatureTrace.armLayer: the drag traces what the panel armed");

        // -- the smoothing table ------------------------------------
        // Tolerance is a FRACTION of the sample spacing, so it means the
        // same thing in a foot drawing and a metre one.
        ok(FeatureTrace.SMOOTHING.length >= 4,
            "FeatureTrace.SMOOTHING: none, fine, medium and coarse");
        near(FeatureTrace.smoothingFraction("No Smoothing"), 0.0, 1e-9,
            "FeatureTrace.smoothingFraction: No Smoothing is a zero tolerance");
        ok(FeatureTrace.smoothingFraction("Fine") <
                FeatureTrace.smoothingFraction("Medium"),
            "FeatureTrace.smoothingFraction: Fine is tighter than Medium");
        ok(FeatureTrace.smoothingFraction("Medium") <
                FeatureTrace.smoothingFraction("Coarse"),
            "FeatureTrace.smoothingFraction: Medium is tighter than Coarse");

        // The scale that shipped was too loose: Medium at HALF the
        // interval flattened the wall detail. Every step must stay well
        // under half, or that regression walks back in.
        ok(FeatureTrace.smoothingFraction("Coarse") < 0.5,
            "FeatureTrace.SMOOTHING: even Coarse is under half the interval");
        near(FeatureTrace.smoothingFraction("nonsense"), 0.05, 1e-9,
            "FeatureTrace.smoothingFraction: an unknown name falls back to the default");
        eqs(FeatureTrace.DEFAULT_SMOOTHING, "Fine",
            "FeatureTrace: the default is Fine, not Medium");

        // The invariant that fallback relies on.
        ok(FeatureTrace.smoothingFraction(FeatureTrace.DEFAULT_SMOOTHING) > 0,
            "FeatureTrace: DEFAULT_SMOOTHING is a name that is in SMOOTHING");

        // And the last-ditch constant, which is only reachable if that
        // invariant is broken. Untested it was dead code a mutation
        // survived; without it a misspelled default would return
        // undefined, making the tolerance NaN -- and a NaN tolerance
        // keeps EVERY sampled point, which is the 400-fit-point spline
        // the whole reduction exists to avoid.
        var savedDefault = FeatureTrace.DEFAULT_SMOOTHING;
        FeatureTrace.DEFAULT_SMOOTHING = "Misspelled";
        near(FeatureTrace.smoothingFraction("also nonsense"), 0.15, 1e-9,
            "FeatureTrace.smoothingFraction: a broken default still yields a usable tolerance");
        FeatureTrace.DEFAULT_SMOOTHING = savedDefault;

        // -- panel reads degrade to defaults without widgets --------
        // The drag action must work standalone: before the panel is
        // built, and if the bridge refuses to build it at all.
        FeatureTrace.widgets = undefined;
        near(FeatureTrace.intervalFeet(), 1.0, 1e-9,
            "FeatureTrace.intervalFeet: no panel means one foot");
        near(FeatureTrace.toleranceFraction(), 0.05, 1e-9,
            "FeatureTrace.toleranceFraction: no panel means the default, Fine");
        near(FeatureTraceRun.intervalFeet(), 1.0, 1e-9,
            "FeatureTraceRun.intervalFeet: reads through to the default");
        near(FeatureTraceRun.toleranceFraction(), 0.05, 1e-9,
            "FeatureTraceRun.toleranceFraction: reads through to the default");

        // -- and they read the panel when it IS there ---------------
        FeatureTrace.widgets = {
            intervalEdit: { text: "2.5" },
            smoothingCombo: { currentText: "Coarse" }
        };
        near(FeatureTrace.intervalFeet(), 2.5, 1e-9,
            "FeatureTrace.intervalFeet: a typed interval is used");
        near(FeatureTrace.toleranceFraction(), 0.35, 1e-9,
            "FeatureTrace.toleranceFraction: the chosen smoothing is used");

        // No Smoothing must survive the panel read as a real zero, not
        // get treated as "unset" and replaced by a default.
        FeatureTrace.widgets = { smoothingCombo: { currentText: "No Smoothing" } };
        near(FeatureTrace.toleranceFraction(), 0.0, 1e-9,
            "FeatureTrace.toleranceFraction: No Smoothing reads as zero, not unset");

        // Junk in the box must not stop a trace, and must not become a
        // spacing of zero -- CsTrace.resample would return the raw drag.
        FeatureTrace.widgets = { intervalEdit: { text: "" } };
        near(FeatureTrace.intervalFeet(), 1.0, 1e-9,
            "FeatureTrace.intervalFeet: a blank field falls back to one foot");
        FeatureTrace.widgets = { intervalEdit: { text: "-3" } };
        near(FeatureTrace.intervalFeet(), 1.0, 1e-9,
            "FeatureTrace.intervalFeet: a negative interval falls back");
        FeatureTrace.widgets = { intervalEdit: { text: "banana" } };
        near(FeatureTrace.intervalFeet(), 1.0, 1e-9,
            "FeatureTrace.intervalFeet: nonsense falls back");
        FeatureTrace.widgets = undefined;

        // -- no-gap walls: ties to a nearby wall end ----------------
        function pt(x, y) { return { x: x, y: y }; }

        ok(CsTrace.tiesOn(CsLayers.WALLS_SURVEYED),
            "CsTrace.tiesOn: surveyed walls tie");
        ok(CsTrace.tiesOn(CsLayers.PROFILE_TRACED_FLOOR),
            "CsTrace.tiesOn: the elevation's floor is a wall, so it ties");
        ok(!CsTrace.tiesOn(CsLayers.BREAKDOWN_BOUNDARY),
            "CsTrace.tiesOn: a breakdown boundary does NOT weld to walls");
        ok(!CsTrace.tiesOn(CsLayers.ENTRANCE),
            "CsTrace.tiesOn: an entrance does NOT weld to walls");

        var tieDoc = new RDocument(new RMemoryStorage(),
            new RSpatialIndexNavel());
        var tieDi = new RDocumentInterface(tieDoc);
        // An existing wall from (0,0) to (10,0).
        CsTrace.emit(tieDoc, tieDi, CsLayers.WALLS_SURVEYED,
            [pt(0, 0), pt(5, 0), pt(10, 0)], 1.0, 0.01);

        var found = CsTrace.nearestEnd(tieDoc, pt(10.4, 0.3),
            CsLayers.WALLS_SURVEYED, 1.0);
        ok(found !== null, "CsTrace.nearestEnd: finds an end within a foot");
        near(found.x, 10.0, 1e-6, "CsTrace.nearestEnd: returns the end's x");
        near(found.y, 0.0, 1e-6, "CsTrace.nearestEnd: returns the end's y");

        ok(CsTrace.nearestEnd(tieDoc, pt(14, 0), CsLayers.WALLS_SURVEYED,
            1.0) === null,
            "CsTrace.nearestEnd: a deliberate gap is left alone");
        ok(CsTrace.nearestEnd(tieDoc, pt(10.2, 0), CsLayers.WALLS_INFERRED,
            1.0) === null,
            "CsTrace.nearestEnd: never ties across to another layer");

        // The join itself: a second stroke starting near the first's end
        // begins exactly there, so the wall has no gap.
        var second = CsTrace.tieEnds(tieDoc,
            [pt(10.35, 0.25), pt(15, 2), pt(20, 5)],
            CsLayers.WALLS_SURVEYED, 1.0);
        near(second[0].x, 10.0, 1e-6, "CsTrace.tieEnds: the stroke starts at the wall end");
        near(second[0].y, 0.0, 1e-6, "CsTrace.tieEnds: exactly, in y too");
        near(second[2].x, 20.0, 1e-6, "CsTrace.tieEnds: a far end is untouched");

        // Idempotent: re-tying a joined stroke must not make it drift.
        var again = CsTrace.tieEnds(tieDoc, second,
            CsLayers.WALLS_SURVEYED, 1.0);
        near(again[0].x, second[0].x, 1e-9,
            "CsTrace.tieEnds: tying twice does not move the join");

        var srcTie = [pt(10.35, 0.25), pt(15, 2)];
        CsTrace.tieEnds(tieDoc, srcTie, CsLayers.WALLS_SURVEYED, 1.0);
        near(srcTie[0].x, 10.35, 1e-9,
            "CsTrace.tieEnds: the caller's array is untouched");

        // A non-tying layer passes straight through.
        var noTie = CsTrace.tieEnds(tieDoc, [pt(10.35, 0.25), pt(15, 2)],
            CsLayers.ENTRANCE, 1.0);
        near(noTie[0].x, 10.35, 1e-9,
            "CsTrace.tieEnds: a non-wall layer is not tied");

        // -- snap suspend / restore, by NAME not by object ----------
        // The object would be a use-after-free: setSnap takes ownership,
        // so the snap we saved is freed when RSnapFree replaces it.
        eqs(CsTrace.snapNameOf(new RSnapGrid()), "RSnapGrid",
            "CsTrace.snapNameOf: reads the class off a snap object");
        ok(CsTrace.snapNameOf(null) === null,
            "CsTrace.snapNameOf: null is null, not a throw");
        ok(CsTrace.snapNameOf("nonsense") === null,
            "CsTrace.snapNameOf: junk yields null");

        var snapDoc = new RDocument(new RMemoryStorage(),
            new RSpatialIndexNavel());
        var snapDi = new RDocumentInterface(snapDoc);
        snapDi.setSnap(new RSnapGrid());
        eqs(CsTrace.snapNameOf(snapDi.getSnap()), "RSnapGrid",
            "snap fixture: grid snap is on");

        var savedName = CsTrace.suspendSnap(snapDi);
        eqs(savedName, "RSnapGrid",
            "CsTrace.suspendSnap: reports the snap it replaced");
        eqs(CsTrace.snapNameOf(snapDi.getSnap()), "RSnapFree",
            "CsTrace.suspendSnap: tracing happens with snapping FREE");

        CsTrace.restoreSnap(snapDi, savedName);
        eqs(CsTrace.snapNameOf(snapDi.getSnap()), "RSnapGrid",
            "CsTrace.restoreSnap: puts the caver's snap back");

        // A name we cannot build restores nothing rather than inventing
        // a setting the caver never chose.
        snapDi.setSnap(new RSnapFree());
        CsTrace.restoreSnap(snapDi, "RSnapNotAThing");
        eqs(CsTrace.snapNameOf(snapDi.getSnap()), "RSnapFree",
            "CsTrace.restoreSnap: an unknown snap name changes nothing");
        CsTrace.restoreSnap(snapDi, null);
        eqs(CsTrace.snapNameOf(snapDi.getSnap()), "RSnapFree",
            "CsTrace.restoreSnap: a null name changes nothing");

        // -- refreshRuns actually populates from a drawing ----------
        // The logic, independent of what triggers it. (The bug in use was
        // the TRIGGER: an already-open panel never refreshed for a
        // drawing opened afterwards. A transaction listener covers that
        // now; this locks the population itself.)
        (function() {
            var d = new RDocument(new RMemoryStorage(),
                new RSpatialIndexNavel());
            var di2 = new RDocumentInterface(d);
            CsLayers.ensure(d, di2, CsLayers.STATIONS);
            var op3 = new RAddObjectsOperation();
            var nms = ["A1", "M4", "SINK2"];
            for (var q = 0; q < nms.length; q++) {
                var p3 = new RPointEntity(d,
                    new RPointData(new RVector(q * 3, 0)));
                p3.setLayerId(d.getLayerId(CsLayers.STATIONS));
                CsTags.set(p3, "Station", nms[q]);
                op3.addObject(p3, false);
            }
            di2.applyOperation(op3);

            // A combo stub: only what refreshRuns actually touches.
            var items = [];
            var combo = {
                currentText: FeatureTrace.RUN_SHARED,
                currentIndex: 0,
                clear: function() { items = []; },
                addItem: function(t) { items.push(t); },
                itemText: function(i) { return items[i]; }
            };
            Object.defineProperty(combo, "count", {
                get: function() { return items.length; }
            });
            FeatureTrace.widgets = { runCombo: combo };

            FeatureTrace.refreshRuns(d);
            eqs(items.length, 4,
                "FeatureTrace.refreshRuns: the shared entry plus three runs");
            eqs(items[0], FeatureTrace.RUN_SHARED,
                "FeatureTrace.refreshRuns: shared entry first");
            eqs(items[1], "A", "FeatureTrace.refreshRuns: A listed");
            eqs(items[2], "M", "FeatureTrace.refreshRuns: M listed");
            eqs(items[3], "SINK",
                "FeatureTrace.refreshRuns: a multi-letter run listed too");

            // Selection survives a refresh, so re-scanning cannot
            // silently re-aim a caver mid-job.
            combo.currentText = "M";
            FeatureTrace.refreshRuns(d);
            eqs(combo.currentIndex, 2,
                "FeatureTrace.refreshRuns: the chosen run stays chosen");
            FeatureTrace.widgets = undefined;
        }());

        // -- changing the run hot-swaps an isolated view -------------
        (function() {
            // onRunChosen is a plain function precisely so this is
            // testable without a live combo box.
            var calls = [];
            var realIsolate = FeatureTrace.isolateSelectedRun;
            var realShowAll = FeatureTrace.showAllRuns;
            FeatureTrace.isolateSelectedRun = function() {
                calls.push("isolate:" + FeatureTrace.runToken());
            };
            FeatureTrace.showAllRuns = function() { calls.push("showAll"); };

            // Not isolated: changing the run must NOT hide the rest of
            // the cave just because the caver switched which run they
            // are tracing.
            FeatureTrace.isolatedRun = null;
            FeatureTrace.widgets = { runCombo: { currentText: "B" } };
            FeatureTrace.onRunChosen();
            eqs(calls.length, 0,
                "onRunChosen: no isolation active means no view change");

            // Isolated on A, caver picks B: hot-swap to B.
            FeatureTrace.isolatedRun = "A";
            FeatureTrace.onRunChosen();
            eqs(calls.length, 1, "onRunChosen: isolated, so the view swaps");
            eqs(calls[0], "isolate:B",
                "onRunChosen: it swaps to the NEWLY chosen run");

            // Isolated, caver picks "(all runs)": show everything.
            calls = [];
            FeatureTrace.widgets = {
                runCombo: { currentText: FeatureTrace.RUN_SHARED } };
            FeatureTrace.onRunChosen();
            eqs(calls[0], "showAll",
                "onRunChosen: choosing (all runs) while isolated shows all");

            FeatureTrace.isolateSelectedRun = realIsolate;
            FeatureTrace.showAllRuns = realShowAll;
            FeatureTrace.isolatedRun = null;
            FeatureTrace.widgets = undefined;
        }());

        // -- refresh: hidden-layer markers and the profile gate ------
        (function() {
            var d = new RDocument(new RMemoryStorage(),
                new RSpatialIndexNavel());
            var di3 = new RDocumentInterface(d);

            function btn(label) {
                return { text: label, toolTip: "" };
            }
            var ceilingBtn = btn("Ceiling");
            var wallsBtn = btn("Surveyed Walls");
            var group = { enabled: true, toolTip: "" };
            FeatureTrace.widgets = {
                runCombo: { currentText: "A" },
                profileGroup: group,
                buttons: [
                    { button: ceilingBtn,
                      row: { label: "Ceiling",
                             layer: CsLayers.PROFILE_TRACED_CEILING } },
                    { button: wallsBtn,
                      row: { label: "Surveyed Walls",
                             layer: CsLayers.WALLS_SURVEYED } }
                ]
            };

            // No elevation yet: the Profile group is gated off and says why.
            FeatureTrace.refresh(d);
            ok(group.enabled === false,
                "FeatureTrace.refresh: no elevation disables the Profile group");
            ok(String(group.toolTip).indexOf("Generate Profile") >= 0,
                "FeatureTrace.refresh: and the tooltip says what to do");

            // Give it a band, and the group opens up.
            CsLayers.ensure(d, di3, CsLayers.PROFILE_SHOTS);
            var band = new RLineEntity(d, new RLineData(
                new RVector(0, -200), new RVector(50, -190)));
            band.setLayerId(d.getLayerId(CsLayers.PROFILE_SHOTS));
            var bop = new RAddObjectsOperation();
            bop.addObject(band, false);
            di3.applyOperation(bop);
            FeatureTrace.refresh(d);
            ok(group.enabled === true,
                "FeatureTrace.refresh: an elevation enables the Profile group");

            // The marker follows the SELECTED RUN's layer, since that is
            // what a click would actually draw to.
            CsLayerVariants.ensureProfile(d, di3,
                CsLayers.PROFILE_TRACED_CEILING, "A");
            FeatureTrace.refresh(d);
            eqs(ceilingBtn.text, "Ceiling",
                "FeatureTrace.refresh: a visible layer shows a plain label");
            eqs(ceilingBtn.toolTip, "PROFILE-CEILING-A",
                "FeatureTrace.refresh: the tooltip names the run's layer");

            var lay = d.queryLayer("PROFILE-CEILING-A");
            lay.setOff(true);
            var mop = new RModifyObjectsOperation();
            mop.addObject(lay, false);
            di3.applyOperation(mop);

            FeatureTrace.refresh(d);
            ok(String(ceilingBtn.text).indexOf("hidden") >= 0,
                "FeatureTrace.refresh: an OFF target layer is marked hidden");
            ok(String(ceilingBtn.toolTip).indexOf("switched OFF") >= 0,
                "FeatureTrace.refresh: and the tooltip explains the risk");

            // A plan row ignores the run entirely.
            eqs(wallsBtn.toolTip, CsLayers.WALLS_SURVEYED,
                "FeatureTrace.refresh: a plan row is never run-qualified");
            eqs(wallsBtn.text, "Surveyed Walls",
                "FeatureTrace.refresh: and is unmarked while its layer is on");

            FeatureTrace.widgets = undefined;
        }());

        // -- the run selector: profile features only ----------------
        // Each run is drawn as its own band and CsProfile lays bands out
        // so they never overlap, so a profile feature belongs to exactly
        // one run. The plan is one continuous map and must NOT be split:
        // a wall runs straight through survey boundaries.
        FeatureTrace.widgets = { runCombo: { currentText: "A" } };

        FeatureTrace.target = CsLayers.PROFILE_TRACED_CEILING;
        eqs(FeatureTraceRun.targetLayer(null), "PROFILE-CEILING-A",
            "run selector: a profile feature goes to its run's layer");

        FeatureTrace.target = CsLayers.PROFILE_WALLS_INFERRED;
        eqs(FeatureTraceRun.targetLayer(null), "PROFILE-WALLS-INFERRED-A",
            "run selector: a multi-word profile base still varies");

        FeatureTrace.target = CsLayers.WALLS_SURVEYED;
        eqs(FeatureTraceRun.targetLayer(null), CsLayers.WALLS_SURVEYED,
            "run selector: a PLAN feature is never split by run");
        FeatureTrace.target = CsLayers.BREAKDOWN_BOUNDARY;
        eqs(FeatureTraceRun.targetLayer(null), CsLayers.BREAKDOWN_BOUNDARY,
            "run selector: nor is a plan breakdown boundary");

        // "(all runs)" means the shared layer, not a run called that.
        FeatureTrace.widgets = { runCombo: { currentText: FeatureTrace.RUN_SHARED } };
        FeatureTrace.target = CsLayers.PROFILE_TRACED_CEILING;
        eqs(FeatureTraceRun.targetLayer(null), CsLayers.PROFILE_TRACED_CEILING,
            "run selector: the shared entry means the shared layer");

        // Lower case from the combo must resolve to the same layer.
        FeatureTrace.widgets = { runCombo: { currentText: "g" } };
        eqs(FeatureTraceRun.targetLayer(null), "PROFILE-CEILING-G",
            "run selector: the run token is sanitised, so g and G are one run");

        // No panel, no run: the drag still works standalone.
        FeatureTrace.widgets = undefined;
        eqs(FeatureTraceRun.targetLayer(null), CsLayers.PROFILE_TRACED_CEILING,
            "run selector: with no panel a profile feature uses the shared layer");
        ok(FeatureTraceRun.runToken() === null,
            "run selector: no panel means no run");
        FeatureTrace.target = undefined;

        // -- the current-layer escape hatch -------------------------
        var scratch = new RDocument(new RMemoryStorage(),
            new RSpatialIndexNavel());
        var scratchDi = new RDocumentInterface(scratch);
        CsLayers.ensure(scratch, scratchDi, CsLayers.TEXT_NOTES);
        scratch.setCurrentLayer(CsLayers.TEXT_NOTES);

        FeatureTrace.target = FeatureTrace.CURRENT_LAYER;
        eqs(FeatureTraceRun.targetLayer(scratch), CsLayers.TEXT_NOTES,
            "targetLayer: the current-layer sentinel resolves to the drawing's layer");
        // Resolved at trace time, not when armed: switch the current
        // layer and the same armed sentinel follows it.
        scratch.setCurrentLayer("0");
        eqs(FeatureTraceRun.targetLayer(scratch), "0",
            "targetLayer: the sentinel follows a change of current layer");
        eqs(FeatureTraceRun.targetLayer(undefined), CsLayers.WALLS_SURVEYED,
            "targetLayer: the sentinel without a document falls back");
        ok(FeatureTrace.CURRENT_LAYER !== CsLayers.WALLS_SURVEYED,
            "FeatureTrace.CURRENT_LAYER: the sentinel is not a real layer name");
        var sentinelIsARow = false;
        for (var ri = 0; ri < FeatureTrace.ROWS.length; ri++) {
            if (FeatureTrace.ROWS[ri].layer === FeatureTrace.CURRENT_LAYER) {
                sentinelIsARow = true;
            }
        }
        ok(!sentinelIsARow,
            "FeatureTrace.CURRENT_LAYER: never appears as a feature row");
        FeatureTrace.target = undefined;
    }());
}

// ---------------------------------------------------------------------
// CsLayerVariants -- on-demand layers derived from a registry layer
// ---------------------------------------------------------------------
(function() {
    loadRepoScript("scripts/CaveSurvey/Core/CsLayers.js");
    loadRepoScript("scripts/CaveSurvey/Core/CsLayerVariants.js");

    // -- sanitize ---------------------------------------------------
    eqs(CsLayerVariants.sanitize("a"), "A",
        "CsLayerVariants.sanitize: upper-cased, so run a and run A are one layer");
    eqs(CsLayerVariants.sanitize("A"), "A",
        "CsLayerVariants.sanitize: already-upper passes through");
    eqs(CsLayerVariants.sanitize("MAIN PASSAGE"), "MAIN_PASSAGE",
        "CsLayerVariants.sanitize: spaces become underscores");
    eqs(CsLayerVariants.sanitize("A/B*C"), "ABC",
        "CsLayerVariants.sanitize: DXF-illegal characters are dropped");
    eqs(CsLayerVariants.sanitize("A-B"), "A_B",
        "CsLayerVariants.sanitize: the separator cannot survive inside a token");
    ok(CsLayerVariants.sanitize("///") === null,
        "CsLayerVariants.sanitize: nothing usable yields null, not an empty segment");
    ok(CsLayerVariants.sanitize(null) === null,
        "CsLayerVariants.sanitize: null is null, not a throw");

    // -- nameFor ----------------------------------------------------
    eqs(CsLayerVariants.nameFor(CsLayers.PROFILE_TRACED_CEILING, "A"),
        "PROFILE-CEILING-A",
        "CsLayerVariants.nameFor: the token goes last");
    eqs(CsLayerVariants.nameFor(CsLayers.PROFILE_SHOTS, "B"),
        "CTRL-PROFILE-SHOTS-B",
        "CsLayerVariants.nameFor: a generated base keeps its CTRL- prefix");
    ok(CsLayerVariants.nameFor("NOT-A-REGISTRY-LAYER", "A") === null,
        "CsLayerVariants.nameFor: refuses a base with no appearance to inherit");
    ok(CsLayerVariants.nameFor(CsLayers.PROFILE_TRACED_CEILING, "") === null,
        "CsLayerVariants.nameFor: refuses an empty token");

    // -- the frame and linework rules survive, which is why token-last
    eqs(CsLayers.frameOf("PROFILE-CEILING-A"), "profile",
        "variant: a profile variant is still in the profile frame");
    eqs(CsLayers.frameOf("CTRL-PROFILE-SHOTS-B"), "profile",
        "variant: a generated profile variant is still profile frame");
    eqs(CsLayers.frameOf("WALLS-SURVEYED-A"), "plan",
        "variant: a plan variant is still in the plan frame");

    // -- split ------------------------------------------------------
    var sp = CsLayerVariants.split("PROFILE-CEILING-A");
    ok(sp !== null, "CsLayerVariants.split: reads a variant back");
    eqs(sp.base, "PROFILE-CEILING", "CsLayerVariants.split: recovers the base");
    eqs(sp.token, "A", "CsLayerVariants.split: recovers the token");

    // The disambiguation this library turns on: PROFILE-WALLS-INFERRED
    // splits cleanly into PROFILE-WALLS + INFERRED, and means something
    // completely different. Only a remainder the registry defines counts.
    ok(CsLayerVariants.split("PROFILE-WALLS-INFERRED") === null,
        "CsLayerVariants.split: a REGISTRY layer is not mistaken for a variant");
    ok(CsLayerVariants.split("WALLS-SURVEYED") === null,
        "CsLayerVariants.split: nor is a plan registry layer");
    ok(CsLayerVariants.split("NONSENSE-X") === null,
        "CsLayerVariants.split: nor is a name with no registry base");
    ok(CsLayerVariants.split("PROFILE-CEILING") === null,
        "CsLayerVariants.split: the bare base is not its own variant");

    var deep = CsLayerVariants.split("PROFILE-WALLS-INFERRED-A");
    ok(deep !== null, "CsLayerVariants.split: a multi-word base still splits");
    eqs(deep.base, "PROFILE-WALLS-INFERRED",
        "CsLayerVariants.split: the whole multi-word base is recovered");
    eqs(deep.token, "A", "CsLayerVariants.split: with its token");

    // -- baseOf -----------------------------------------------------
    eqs(CsLayerVariants.baseOf("PROFILE-CEILING-A"), "PROFILE-CEILING",
        "CsLayerVariants.baseOf: a variant points at its base");
    eqs(CsLayerVariants.baseOf("PROFILE-CEILING"), "PROFILE-CEILING",
        "CsLayerVariants.baseOf: a registry layer is its own base");
    ok(CsLayerVariants.baseOf("NONSENSE") === null,
        "CsLayerVariants.baseOf: an unknown name has no base");

    // -- round trip -------------------------------------------------
    var bases = [CsLayers.PROFILE_TRACED_CEILING, CsLayers.PROFILE_TRACED_FLOOR,
        CsLayers.PROFILE_WALLS_INFERRED, CsLayers.PROFILE_BREAKDOWN,
        CsLayers.PROFILE_ENTRANCE, CsLayers.PROFILE_SHOTS,
        CsLayers.WALLS_SURVEYED, CsLayers.BREAKDOWN_BOUNDARY];
    for (var bi = 0; bi < bases.length; bi++) {
        var nm = CsLayerVariants.nameFor(bases[bi], "G");
        var back = CsLayerVariants.split(nm);
        ok(back !== null && back.base === bases[bi] && back.token === "G",
            "CsLayerVariants: " + bases[bi] + " round-trips through a variant");
        eqs(CsLayers.frameOf(nm), CsLayers.frameOf(bases[bi]),
            "CsLayerVariants: " + bases[bi] + " keeps its frame as a variant");
    }

    // -- comparators are TOTAL orders (this engine's sort is unstable)
    eqs(CsLayerVariants.compareTokens("A", "A"), 0,
        "CsLayerVariants.compareTokens: equal tokens compare 0");
    ok(CsLayerVariants.compareTokens("A", "B") < 0,
        "CsLayerVariants.compareTokens: orders ascending");
    ok(CsLayerVariants.compareTokens("B", "A") > 0,
        "CsLayerVariants.compareTokens: and is antisymmetric");
}());

// ---------------------------------------------------------------------
// CsLayerVariants -- creation and queries (QCAD only: needs RDocument)
// ---------------------------------------------------------------------
if (!IS_NODE) {
    (function() {
        loadRepoScript("scripts/CaveSurvey/Core/CsLayers.js");
        loadRepoScript("scripts/CaveSurvey/Core/CsLayerVariants.js");
        loadRepoScript("scripts/CaveSurvey/Core/CsBind.js");

        var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var di = new RDocumentInterface(doc);

        // -- created on demand, and NOT before -----------------------
        ok(!doc.hasLayer("PROFILE-CEILING-A"),
            "variant fixture: a fresh drawing has no variant layers");

        var made = CsLayerVariants.ensure(doc, di,
            CsLayers.PROFILE_TRACED_CEILING, "A");
        eqs(made, "PROFILE-CEILING-A",
            "CsLayerVariants.ensure: returns the name it made");
        ok(doc.hasLayer("PROFILE-CEILING-A"),
            "CsLayerVariants.ensure: the layer now exists");

        // -- APPEARANCE IS INHERITED --------------------------------
        // The whole point. Without the baseOf hook in CsLayers.ensure a
        // variant silently takes the white/CONTINUOUS/Weight025 fallback
        // and looks nothing like the layer it varies.
        CsLayers.ensure(doc, di, CsLayers.PROFILE_TRACED_CEILING);
        var baseLay = doc.queryLayer(CsLayers.PROFILE_TRACED_CEILING);
        var varLay = doc.queryLayer("PROFILE-CEILING-A");
        eqs(String(varLay.getColor().toString()),
            String(baseLay.getColor().toString()),
            "CsLayerVariants: a variant inherits its base's COLOUR");
        eqs(varLay.getLineweight(), baseLay.getLineweight(),
            "CsLayerVariants: a variant inherits its base's LINEWEIGHT");

        // A dashed base proves it is really inherited and not a
        // coincidence of two layers both being white.
        var dashed = CsLayerVariants.ensure(doc, di,
            CsLayers.PROFILE_WALLS_INFERRED, "A");
        CsLayers.ensure(doc, di, CsLayers.PROFILE_WALLS_INFERRED);
        eqs(doc.queryLayer(dashed).getLinetypeId(),
            doc.queryLayer(CsLayers.PROFILE_WALLS_INFERRED).getLinetypeId(),
            "CsLayerVariants: a variant inherits its base's LINETYPE");
        ok(doc.queryLayer(dashed).getLineweight() !==
                doc.queryLayer("PROFILE-CEILING-A").getLineweight(),
            "CsLayerVariants: two variants of DIFFERENT bases differ, so it is really inherited");

        // -- binding eligibility follows the base, for free ----------
        ok(CsBind.isLineworkLayer("PROFILE-CEILING-A"),
            "CsLayerVariants: a traced variant is still bindable linework");
        ok(!CsBind.isLineworkLayer("CTRL-PROFILE-SHOTS-A"),
            "CsLayerVariants: a generated variant is still refused by CsBind");

        // -- profile-only scoping -----------------------------------
        // Segregating by run is wanted for the elevation and NOT for the
        // plan: a caver traces plan walls straight through survey
        // boundaries, and per-run plan layers would fragment one wall
        // into several AND stop nearestEnd closing the joins, since it
        // only ties within a layer. The elevation is already drawn one
        // band per run, so there the division is real.
        eqs(CsLayerVariants.ensureProfile(doc, di,
                CsLayers.PROFILE_TRACED_FLOOR, "C"), "PROFILE-FLOOR-C",
            "ensureProfile: a profile base is allowed");
        ok(CsLayerVariants.ensureProfile(doc, di,
                CsLayers.WALLS_SURVEYED, "C") === null,
            "ensureProfile: a PLAN base is refused -- plan view is not segregated");
        ok(!doc.hasLayer("WALLS-SURVEYED-C"),
            "ensureProfile: and nothing is created when it refuses");
        ok(CsLayerVariants.ensureProfile(doc, di, CsLayers.BORDER, "C") === null,
            "ensureProfile: a SHEET base is refused too");
        ok(CsLayerVariants.ensureProfile(doc, di,
                CsLayers.PROFILE_SHOTS, "C") !== null,
            "ensureProfile: a GENERATED profile base is allowed");

        // The general ensure() stays general: the library serves other
        // tools, and a future per-trip use should not inherit this rule.
        ok(CsLayerVariants.ensure(doc, di, CsLayers.WALLS_SURVEYED, "C") !== null,
            "ensure: the unrestricted call is still general by design");

        // -- refusals ------------------------------------------------
        ok(CsLayerVariants.ensure(doc, di, "INVENTED-LAYER", "A") === null,
            "CsLayerVariants.ensure: refuses a base the registry does not define");
        ok(!doc.hasLayer("INVENTED-LAYER-A"),
            "CsLayerVariants.ensure: and creates nothing when it refuses");

        // -- queries -------------------------------------------------
        CsLayerVariants.ensure(doc, di, CsLayers.PROFILE_TRACED_CEILING, "B");
        CsLayerVariants.ensure(doc, di, CsLayers.PROFILE_TRACED_FLOOR, "A");
        CsLayerVariants.ensure(doc, di, CsLayers.PROFILE_SHOTS, "A");

        var toks = CsLayerVariants.tokensIn(doc, CsLayers.PROFILE_TRACED_CEILING);
        eqs(toks.length, 2, "CsLayerVariants.tokensIn: finds both runs");
        eqs(toks[0], "A", "CsLayerVariants.tokensIn: sorted, A first");
        eqs(toks[1], "B", "CsLayerVariants.tokensIn: sorted, B second");
        eqs(CsLayerVariants.tokensIn(doc, CsLayers.PROFILE_ENTRANCE).length, 0,
            "CsLayerVariants.tokensIn: a base with no variants yields none");

        // This is what makes token-last naming affordable: isolating one
        // run is a query, not a hunt through a flat Layer list.
        // Four: ceiling, floor, walls-inferred and the generated shots.
        var forA = CsLayerVariants.layersForToken(doc, "A");
        eqs(forA.length, 4, "CsLayerVariants.layersForToken: all of run A's layers");
        eqs(forA[0], "CTRL-PROFILE-SHOTS-A",
            "CsLayerVariants.layersForToken: sorted by name");
        eqs(CsLayerVariants.layersForToken(doc, "a").length, 4,
            "CsLayerVariants.layersForToken: the token is sanitised on the way in");

        // -- COMPOSITE tokens, e.g. a run within a trip --------------
        // No library change needed: sanitize turns an inner "-" into "_"
        // precisely so a two-part token cannot break the split. Whether
        // trip BELONGS in a layer name is a separate question -- see the
        // plan -- but the mechanism is here.
        var comp = CsLayerVariants.ensure(doc, di,
            CsLayers.PROFILE_TRACED_CEILING, "B-4");
        eqs(comp, "PROFILE-CEILING-B_4",
            "CsLayerVariants: a composite token stays parseable");
        var compBack = CsLayerVariants.split(comp);
        eqs(compBack.base, "PROFILE-CEILING",
            "CsLayerVariants: a composite variant still recovers its base");
        eqs(compBack.token, "B_4",
            "CsLayerVariants: and its whole composite token");
        eqs(CsLayerVariants.layersForToken(doc, "B-4").length, 1,
            "CsLayerVariants.layersForToken: finds a composite token");
        eqs(CsLayerVariants.layersForToken(doc, "B").length, 1,
            "CsLayerVariants.layersForToken: B and B_4 are DIFFERENT tokens, not nested");
        eqs(CsLayerVariants.layersForToken(doc, "Z").length, 0,
            "CsLayerVariants.layersForToken: an unused token yields none");
        eqs(CsLayerVariants.layersForToken(doc, "///").length, 0,
            "CsLayerVariants.layersForToken: an unusable token yields none, not a throw");
    }());
}

// ---------------------------------------------------------------------
// CsProfileDraw -- per-run ownership (QCAD only: needs RDocument)
// ---------------------------------------------------------------------
if (!IS_NODE) {
    (function() {
        loadRepoScript("scripts/CaveSurvey/Core/CsLayers.js");
        loadRepoScript("scripts/CaveSurvey/Core/CsLayerVariants.js");
        loadRepoScript("scripts/CaveSurvey/Core/CsTags.js");
        loadRepoScript("scripts/CaveSurvey/Core/CsBind.js");
        loadRepoScript("scripts/CaveSurvey/Core/CsProfileDraw.js");
        loadRepoScript("scripts/CaveSurvey/Core/CsRevise.js");
        loadRepoScript("scripts/CaveSurvey/Core/CsProfileBind.js");

        // -- runsIn: the run list exists BEFORE any band is drawn ----
        // The workflow is run first, tool second. Deriving the list from
        // drawn bands left it empty until an elevation had already been
        // generated, which is the workflow backwards. Every band IS
        // drawn on every plot, so after a plot both sources agree -- the
        // difference is only before the first one, which is exactly when
        // a caver needs to choose a run.
        (function() {
            var d = new RDocument(new RMemoryStorage(),
                new RSpatialIndexNavel());
            var i2 = new RDocumentInterface(d);
            CsLayers.ensure(d, i2, CsLayers.STATIONS);
            var names = ["A1", "A2", "B1", "G7"];
            var op2 = new RAddObjectsOperation();
            for (var n = 0; n < names.length; n++) {
                var pt2 = new RPointEntity(d,
                    new RPointData(new RVector(n * 5, 0)));
                pt2.setLayerId(d.getLayerId(CsLayers.STATIONS));
                CsTags.set(pt2, "Station", names[n]);
                op2.addObject(pt2, false);
            }
            i2.applyOperation(op2);

            var runs = CsProfileDraw.runsIn(d);
            eqs(runs.length, 3,
                "CsProfileDraw.runsIn: three runs from four stations");
            eqs(runs[0], "A", "CsProfileDraw.runsIn: sorted, A first");
            eqs(runs[1], "B", "CsProfileDraw.runsIn: B second");
            eqs(runs[2], "G", "CsProfileDraw.runsIn: G third");

            // No profile layers exist at all yet -- that is the point.
            ok(!d.hasLayer("CTRL-PROFILE-STATIONS-A"),
                "CsProfileDraw.runsIn: no band has been drawn");

            // A run whose survey is gone but whose linework remains must
            // still be reachable from the panel that made it.
            CsLayerVariants.ensureProfile(d, i2,
                CsLayers.PROFILE_TRACED_CEILING, "Z");
            var withOrphan = CsProfileDraw.runsIn(d);
            var sawZ = false;
            for (var z = 0; z < withOrphan.length; z++) {
                if (withOrphan[z] === "Z") { sawZ = true; }
            }
            ok(sawZ,
                "CsProfileDraw.runsIn: a run with linework but no survey still lists");
        }());

        eqs(CsProfileDraw.runsIn(new RDocument(new RMemoryStorage(),
                new RSpatialIndexNavel())).length, 0,
            "CsProfileDraw.runsIn: an empty drawing has no runs");

        // -- isolate one run ----------------------------------------
        (function() {
            var d = new RDocument(new RMemoryStorage(),
                new RSpatialIndexNavel());
            var i3 = new RDocumentInterface(d);
            // Two runs, each with a generated band layer and a traced one.
            CsLayerVariants.ensureProfile(d, i3, CsLayers.PROFILE_SHOTS, "A");
            CsLayerVariants.ensureProfile(d, i3,
                CsLayers.PROFILE_TRACED_CEILING, "A");
            CsLayerVariants.ensureProfile(d, i3, CsLayers.PROFILE_SHOTS, "B");
            CsLayers.ensure(d, i3, CsLayers.PROFILE_SHOTS);   // shared
            CsLayers.ensure(d, i3, CsLayers.WALLS_SURVEYED);  // plan

            eqs(CsProfileDraw.profileVariantLayers(d).length, 3,
                "profileVariantLayers: three variants, shared and plan excluded");

            var moved = CsProfileDraw.isolateRun(d, i3, "A");
            eqs(moved, 1, "isolateRun: only run B's layer had to change");
            ok(!d.queryLayer("CTRL-PROFILE-SHOTS-A").isOff(),
                "isolateRun: run A's band stays visible");
            ok(!d.queryLayer("PROFILE-CEILING-A").isOff(),
                "isolateRun: run A's TRACED work stays visible too");
            ok(d.queryLayer("CTRL-PROFILE-SHOTS-B").isOff(),
                "isolateRun: run B is hidden");
            ok(!d.queryLayer(CsLayers.PROFILE_SHOTS).isOff(),
                "isolateRun: the SHARED profile layer is left alone");
            ok(!d.queryLayer(CsLayers.WALLS_SURVEYED).isOff(),
                "isolateRun: plan layers are never touched");

            // Idempotent: isolating the same run again changes nothing.
            eqs(CsProfileDraw.isolateRun(d, i3, "A"), 0,
                "isolateRun: isolating the same run twice is a no-op");

            // Case-folded, like every other use of a run token.
            CsProfileDraw.showAllRuns(d, i3);
            eqs(CsProfileDraw.isolateRun(d, i3, "a"), 1,
                "isolateRun: a lower-case run isolates the same layers");
            ok(d.queryLayer("CTRL-PROFILE-SHOTS-B").isOff(),
                "isolateRun: and B is hidden by it");

            eqs(CsProfileDraw.showAllRuns(d, i3), 1,
                "showAllRuns: brings the hidden run back");
            ok(!d.queryLayer("CTRL-PROFILE-SHOTS-B").isOff(),
                "showAllRuns: run B is visible again");
        }());

        // -- the token policy ----------------------------------------
        eqs(CsProfileDraw.tokenFor({ key: "A" }), "A",
            "CsProfileDraw.tokenFor: a band is segregated by its run");
        ok(CsProfileDraw.tokenFor(null) === null,
            "CsProfileDraw.tokenFor: no band, no token");
        ok(CsProfileDraw.tokenFor({}) === null,
            "CsProfileDraw.tokenFor: a band with no key gets no token");

        function docWith() {
            var d = new RDocument(new RMemoryStorage(),
                new RSpatialIndexNavel());
            return { doc: d, di: new RDocumentInterface(d) };
        }
        /** A generated band entity: on an owned layer, ProfileRun tagged. */
        function generated(ctx, layerName, runKey) {
            CsLayers.ensure(ctx.doc, ctx.di, layerName);
            var e = new RLineEntity(ctx.doc, new RLineData(
                new RVector(0, 0), new RVector(10, 0)));
            e.setLayerId(ctx.doc.getLayerId(layerName));
            CsTags.set(e, "ProfileRun", runKey);
            var op = new RAddObjectsOperation();
            op.addObject(e, false);
            ctx.di.applyOperation(op);
            return e;
        }

        // -- layerFor ensures and returns the variant ----------------
        var c0 = docWith();
        var got = CsProfileDraw.layerFor(c0.doc, c0.di,
            CsLayers.PROFILE_SHOTS, { key: "A" });
        eqs(got, "CTRL-PROFILE-SHOTS-A",
            "CsProfileDraw.layerFor: a band draws to its own run's layer");
        ok(c0.doc.hasLayer("CTRL-PROFILE-SHOTS-A"),
            "CsProfileDraw.layerFor: and creates it on demand");
        eqs(CsProfileDraw.layerFor(c0.doc, c0.di, CsLayers.PROFILE_SHOTS, null),
            CsLayers.PROFILE_SHOTS,
            "CsProfileDraw.layerFor: no band means the shared base layer");

        // -- ownLayerNames sees variants of owned bases only ---------
        var own = CsProfileDraw.ownLayerNames(c0.doc);
        var hasVariant = false, hasStrayVariant = false;
        CsLayerVariants.ensureProfile(c0.doc, c0.di,
            CsLayers.PROFILE_TRACED_CEILING, "A");   // NOT an owned base
        own = CsProfileDraw.ownLayerNames(c0.doc);
        for (var oi = 0; oi < own.length; oi++) {
            if (own[oi] === "CTRL-PROFILE-SHOTS-A") { hasVariant = true; }
            if (own[oi] === "PROFILE-CEILING-A") { hasStrayVariant = true; }
        }
        ok(hasVariant,
            "CsProfileDraw.ownLayerNames: a variant of an owned base is ours");
        ok(!hasStrayVariant,
            "CsProfileDraw.ownLayerNames: a variant of a TRACED base is NOT ours");

        // -- erase, unscoped: clears every run -----------------------
        var cAll = docWith();
        generated(cAll, "CTRL-PROFILE-SHOTS-A", "A");
        generated(cAll, "CTRL-PROFILE-SHOTS-B", "B");
        eqs(CsProfileDraw.erase(cAll.doc, cAll.di), 2,
            "CsProfileDraw.erase: unscoped clears every run's band");

        // -- erase, run-scoped: leaves other runs alone --------------
        // This is the whole point of segregating by run.
        var cOne = docWith();
        generated(cOne, "CTRL-PROFILE-SHOTS-A", "A");
        generated(cOne, "CTRL-PROFILE-SHOTS-B", "B");
        generated(cOne, "CTRL-PROFILE-STATIONS-B", "B");
        eqs(CsProfileDraw.erase(cOne.doc, cOne.di, "A"), 1,
            "CsProfileDraw.erase: scoped to A removes only A's band");
        eqs(cOne.doc.queryLayerEntities(
                cOne.doc.getLayerId("CTRL-PROFILE-SHOTS-B"), true).length, 1,
            "CsProfileDraw.erase: run B's band is untouched");
        eqs(CsProfileDraw.erase(cOne.doc, cOne.di, "B"), 2,
            "CsProfileDraw.erase: scoped to B then removes both of B's");

        // -- THE BINDER MUST SEE STATIONS ON PER-RUN LAYERS ----------
        // Reported from use: "in the profile, the drawn linework failed
        // to scale with the revised length of A2 to A3."
        //
        // CsProfileBind.stationIndex tested membership against
        // LAYERS() -- base names only -- so once bands drew to per-run
        // variants it rejected every station. The index came back empty,
        // claim() bailed, positions() had nothing to compare, and
        // CsRevise.positionsMoved therefore saw no movement: the band
        // redrew and the traced ceiling stayed put.
        (function() {
            function stationOn(ctx, layerName, name, x, y) {
                CsLayers.ensure(ctx.doc, ctx.di, layerName);
                var pt4 = new RPointEntity(ctx.doc,
                    new RPointData(new RVector(x, y)));
                pt4.setLayerId(ctx.doc.getLayerId(layerName));
                CsTags.set(pt4, "ProfileStation", name);
                CsTags.set(pt4, "ProfileRun", "A");
                var o = new RAddObjectsOperation();
                o.addObject(pt4, false);
                ctx.di.applyOperation(o);
            }

            var cVar = docWith();
            stationOn(cVar, "CTRL-PROFILE-STATIONS-A", "A2", 0, -200);
            stationOn(cVar, "CTRL-PROFILE-STATIONS-A", "A3", 30, -200);
            var idxVar = CsProfileBind.stationIndex(cVar.doc);
            eqs(idxVar.length, 2,
                "CsProfileBind.stationIndex: finds stations on a per-run layer");

            // positions() feeds CsRevise.positionsMoved. Empty here is
            // exactly why a revised shot moved nothing.
            // Keys are namespaced by run -- "A/A2", not "A2" -- so one
            // trip's station names cannot collide across bands.
            var posVar = CsProfileBind.positions(cVar.doc);
            ok(!isNull(posVar["A/A2"]),
                "CsProfileBind.positions: a per-run station reaches the move comparison");
            ok(!isNull(posVar["A/A3"]),
                "CsProfileBind.positions: and so does the far end of the revised shot");

            // The shared layer must keep working, for drawings that
            // predate segregation.
            var cShr = docWith();
            stationOn(cShr, CsLayers.PROFILE_STATIONS, "A2", 0, -200);
            eqs(CsProfileBind.stationIndex(cShr.doc).length, 1,
                "CsProfileBind.stationIndex: a shared-layer station still counts");

            // And a station on a layer that is NOT ours is still ignored,
            // which is the ownership property the base test protected.
            var cAlien = docWith();
            stationOn(cAlien, CsLayers.PROFILE_TRACED_CEILING, "A2", 0, -200);
            eqs(CsProfileBind.stationIndex(cAlien.doc).length, 0,
                "CsProfileBind.stationIndex: a point on a TRACED layer is not a station of ours");
        }());

        // -- binding scopes to the layer's RUN -----------------------
        (function() {
            var idx = [
                { name: "A/A1", x: 0, y: -200 },
                { name: "A/A2", x: 30, y: -200 },
                { name: "B/B1", x: 0, y: -400 }
            ];
            var runA = CsProfileBind.stationsOfRun(idx, "A");
            eqs(runA.length, 2, "stationsOfRun: two stations in run A");
            eqs(CsProfileBind.stationsOfRun(idx, "B").length, 1,
                "stationsOfRun: one in run B");
            eqs(CsProfileBind.stationsOfRun(idx, "Z").length, 0,
                "stationsOfRun: none for a run with no stations");
            eqs(CsProfileBind.namesOf(runA).join(","), "A/A1,A/A2",
                "namesOf: the run-qualified names, in order");

            // The behaviour that was broken: a ceiling traced WELL ABOVE
            // its stations. Distance-based binding skipped it, so it was
            // never tagged and never moved again. Its layer names run A,
            // so it now binds to run A's band.
            var ctx = docWith();
            function stationPt(layerName, name, x, y) {
                CsLayers.ensure(ctx.doc, ctx.di, layerName);
                var pt5 = new RPointEntity(ctx.doc,
                    new RPointData(new RVector(x, y)));
                pt5.setLayerId(ctx.doc.getLayerId(layerName));
                CsTags.set(pt5, "ProfileStation", name);
                CsTags.set(pt5, "ProfileRun", "A");
                var o = new RAddObjectsOperation();
                o.addObject(pt5, false);
                ctx.di.applyOperation(o);
            }
            stationPt("CTRL-PROFILE-STATIONS-A", "A1", 0, -200);
            stationPt("CTRL-PROFILE-STATIONS-A", "A2", 30, -200);

            // Traced 500 units above the band: nowhere near any station.
            var traced = CsLayerVariants.ensureProfile(ctx.doc, ctx.di,
                CsLayers.PROFILE_TRACED_CEILING, "A");
            var sp5 = new RSpline();
            sp5.setDegree(1);
            sp5.appendControlPoint(new RVector(0, 300));
            sp5.appendControlPoint(new RVector(30, 300));
            var ent5 = new RSplineEntity(ctx.doc, new RSplineData(sp5));
            ent5.setLayerId(ctx.doc.getLayerId(traced));
            var op5 = new RAddObjectsOperation();
            op5.addObject(ent5, false);
            ctx.di.applyOperation(op5);

            if (CsBind.autoBindEnabled()) {
                var res5 = CsProfileBind.claim(ctx.doc, ctx.di);
                eqs(res5.tagged, 1,
                    "claim: a ceiling traced far above its band still binds, via its run");
                eqs(res5.skipped, 0,
                    "claim: and is not skipped as unbindable");

                var again = ctx.doc.queryEntity(ctx.doc.queryLayerEntities(
                    ctx.doc.getLayerId(traced), true)[0]);
                var tag5 = CsTags.get(again, CsBind.STATIONS_TAG);
                ok(tag5 !== null && tag5 !== "",
                    "claim: the binding tag is written");
                ok(String(tag5).indexOf("A/") >= 0,
                    "claim: it names run A's stations, not another band's");
                ok(String(tag5).indexOf("B/") < 0,
                    "claim: and never binds across runs");
            } else {
                ok(true, "claim: auto-bind is off in this environment, not exercised");
            }
        }());

        // -- A FULL REGENERATE CLEARS THE SHARED LAYERS --------------
        // Nothing draws to the shared profile layers any more; every
        // band goes to its run's variant. So the pre-segregation
        // geometry sitting on them has to go on the next full draw, or a
        // caver keeps seeing an old elevation underneath the new one.
        // render() calls erase() unscoped, and ownLayerNames includes
        // the shared bases -- this is what pins that, since dropping the
        // bases from ownLayerNames would silently orphan all of it.
        var cShared = docWith();
        generated(cShared, CsLayers.PROFILE_SHOTS, "A");
        generated(cShared, CsLayers.PROFILE_STATIONS, "B");
        generated(cShared, "CTRL-PROFILE-SHOTS-A", "A");
        eqs(CsProfileDraw.erase(cShared.doc, cShared.di), 3,
            "erase unscoped: clears the SHARED layers as well as the variants");
        eqs(cShared.doc.queryLayerEntities(
                cShared.doc.getLayerId(CsLayers.PROFILE_SHOTS), true).length, 0,
            "erase unscoped: no pre-segregation geometry is left behind");

        var ownNames = CsProfileDraw.ownLayerNames(cShared.doc);
        var bases = CsProfileDraw.LAYERS();
        for (var bj = 0; bj < bases.length; bj++) {
            var present = false;
            for (var oj2 = 0; oj2 < ownNames.length; oj2++) {
                if (ownNames[oj2] === bases[bj]) { present = true; }
            }
            ok(present, "ownLayerNames: still claims the shared base " +
                bases[bj] + ", or its old geometry would be orphaned");
        }

        // -- legacy geometry: tagged, on the SHARED base layer -------
        // Scoping reads the ProfileRun TAG, not the layer's token, so
        // output drawn before layers were segregated is still cleaned.
        var cOld = docWith();
        generated(cOld, CsLayers.PROFILE_SHOTS, "A");
        eqs(CsProfileDraw.erase(cOld.doc, cOld.di, "A"), 1,
            "CsProfileDraw.erase: scoped erase still finds pre-segregation output");

        // -- THE GENERATOR OWNS NOTHING IN THE CAVER'S NAMESPACE -----
        // Its captions used to live on PROFILE-TEXT-LABELS, so erase()
        // owned a layer in the traced vocabulary and CsBind treated
        // generated captions as bindable linework. Per-run variants made
        // it worse: PROFILE-TEXT-LABELS-A was a generator-owned layer in
        // the user's namespace. Every owned layer is CTRL- now, and this
        // is what stops it drifting back.
        var owned = CsProfileDraw.LAYERS();
        for (var oj = 0; oj < owned.length; oj++) {
            ok(String(owned[oj]).indexOf("CTRL-") === 0,
                "CsProfileDraw.LAYERS: " + owned[oj] +
                    " is CTRL-, so the generator owns nothing traceable");
            ok(!CsBind.isLineworkLayer(owned[oj]),
                "CsProfileDraw.LAYERS: " + owned[oj] +
                    " is not bindable linework");
        }

        // A caver's OWN label on the traced layer survives erase even
        // when it carries a Profile* tag -- the promoted-line case, on
        // the layer that used to be shared.
        var cLbl = docWith();
        generated(cLbl, CsLayers.PROFILE_TEXT_LABELS, "A");
        eqs(CsProfileDraw.erase(cLbl.doc, cLbl.di), 0,
            "CsProfileDraw.erase: a label on the CAVER's text layer is spared");

        // -- the promoted line still survives, variants included -----
        // A generated curve moved onto a TRACED layer keeps its tags but
        // stops being ours. That protection must not weaken.
        var cProm = docWith();
        generated(cProm, "PROFILE-CEILING-A", "A");   // traced variant
        eqs(CsProfileDraw.erase(cProm.doc, cProm.di), 0,
            "CsProfileDraw.erase: a tagged entity on a TRACED variant is spared");
        eqs(cProm.doc.queryLayerEntities(
                cProm.doc.getLayerId("PROFILE-CEILING-A"), true).length, 1,
            "CsProfileDraw.erase: the promoted line is still there");
    }());
}

// ---------------------------------------------------------------------
// CsContrib -- who surveyed what, in distance and percent
// ---------------------------------------------------------------------
(function() {
    loadRepoScript("scripts/CaveSurvey/Core/CsAngles.js");
    loadRepoScript("scripts/CaveSurvey/Core/CsUnits.js");
    loadRepoScript("scripts/CaveSurvey/Core/CsModel.js");
    loadRepoScript("scripts/CaveSurvey/Core/CsTraverse.js");
    loadRepoScript("scripts/CaveSurvey/Core/CsNetwork.js");
    loadRepoScript("scripts/CaveSurvey/Core/CsProfile.js");
    loadRepoScript("scripts/CaveSurvey/Core/CsStats.js");
    loadRepoScript("scripts/CaveSurvey/Core/CsContrib.js");

    // -- people ------------------------------------------------------
    var people = CsContrib.people("Nathan, Jim and Sarah/Bob & Ann");
    eqs(people.join(","), "Nathan,Jim,Sarah,Bob,Ann",
        "CsContrib.people: splits on comma, 'and', slash and ampersand");
    eqs(CsContrib.people("").length, 0,
        "CsContrib.people: no team text means nobody credited");
    eqs(CsContrib.people("Nathan, nathan").join(","), "Nathan",
        "CsContrib.people: one person, however they capitalised it");

    // -- a two-trip survey -------------------------------------------
    var survey = CsModel.newSurvey();
    survey.distanceUnit = "ft";
    var t0 = CsModel.newTrip();
    t0.date = "2024-03-16"; t0.team = "Nathan, Jim";
    var t1 = CsModel.newTrip();
    t1.date = "2024-04-20"; t1.team = "Nathan, Sarah";
    survey.trips = [t0, t1];

    var shot = function(from, to, dist, trip) {
        var s = CsModel.newShot();
        s.from = from; s.to = to; s.distance = dist;
        s.azimuth = 90.0; s.inclination = 0.0; s.trip = trip;
        return s;
    };
    survey.shots = [
        shot("A1", "A2", 10.0, 0),
        shot("A2", "A3", 30.0, 0),
        shot("A3", "B1", 60.0, 1)
    ];
    // a splay and an excluded shot: counted by neither, exactly as
    // CsStats.compute counts neither, so the rows still sum to Length
    var sp = shot("A2", "", 5.0, 0); sp.splay = true;
    var ex = shot("A3", "A4", 99.0, 1); ex.excludeFromAll = true;
    survey.shots.push(sp);
    survey.shots.push(ex);

    var resolved = CsNetwork.resolve(survey);
    var stats = CsStats.compute(survey, resolved, CsTraverse.SLOPE);

    var trips = CsContrib.byTrip(survey, resolved, CsTraverse.SLOPE);
    eqs(trips.length, 2, "CsContrib.byTrip: one row per trip");
    eqs(trips[0].distance, 40.0, "CsContrib.byTrip: trip 0 surveyed 40");
    eqs(trips[1].distance, 60.0, "CsContrib.byTrip: trip 1 surveyed 60");
    eqs(trips[0].percent, 40.0, "CsContrib.byTrip: trip 0 is 40% of the cave");
    eqs(trips[0].distance + trips[1].distance, stats.surveyedLength,
        "CsContrib.byTrip: the rows sum to the title block's Length");
    eqs(trips[0].date, "2024-03-16", "CsContrib.byTrip: carries the date");
    eqs(trips[0].shotCount, 2, "CsContrib.byTrip: counts the counted shots");

    // -- teams -------------------------------------------------------
    var teams = CsContrib.byTeam(trips);
    eqs(teams.length, 2, "CsContrib.byTeam: two distinct parties");
    eqs(teams[0].team, "Nathan, Jim", "CsContrib.byTeam: keyed on the team text");
    eqs(teams[0].tripCount, 1, "CsContrib.byTeam: counts its trips");

    // -- people ------------------------------------------------------
    var persons = CsContrib.byPerson(trips);
    eqs(persons.rows.length, 3, "CsContrib.byPerson: Nathan, Jim, Sarah");
    var nathan = null, jim = null;
    for (var i = 0; i < persons.rows.length; i++) {
        if (persons.rows[i].person === "Nathan") { nathan = persons.rows[i]; }
        if (persons.rows[i].person === "Jim") { jim = persons.rows[i]; }
    }
    eqs(nathan.distance, 100.0,
        "CsContrib.byPerson: on both trips, credited both in full");
    eqs(jim.distance, 40.0, "CsContrib.byPerson: one trip, credited it");
    ok(persons.overlapping,
        "CsContrib.byPerson: flags that credited totals exceed the cave");

    // -- runs --------------------------------------------------------
    var runs = CsContrib.byRun(survey, resolved, CsTraverse.SLOPE);
    eqs(runs.length, 2, "CsContrib.byRun: runs A and B");
    eqs(runs[0].run, "A", "CsContrib.byRun: run A first, in survey order");
    eqs(runs[0].distance, 40.0,
        "CsContrib.byRun: a leg belongs to the run its TO station is in");
    eqs(runs[1].distance, 60.0, "CsContrib.byRun: the leg into B1 is B's");

    // -- empty survey ------------------------------------------------
    var empty = CsModel.newSurvey();
    var emptyResolved = CsNetwork.resolve(empty);
    var emptyTrips = CsContrib.byTrip(empty, emptyResolved, CsTraverse.SLOPE);
    eqs(emptyTrips.length, 1, "CsContrib.byTrip: an empty survey has trip 0");
    eqs(emptyTrips[0].percent, 0.0,
        "CsContrib.byTrip: nothing surveyed is 0%, never NaN");

    // -- formatting --------------------------------------------------
    eqs(CsContrib.distanceText(1234.4, "ft"), "1,234 ft",
        "CsContrib.distanceText: grouped, rounded, with the unit");
    eqs(CsContrib.percentText(13.6), "14%",
        "CsContrib.percentText: whole percent");
    eqs(CsContrib.percentText(0.2), "<1%",
        "CsContrib.percentText: a real contribution never reads as 0%");
    eqs(CsContrib.percentText(0.0), "0%",
        "CsContrib.percentText: nothing really is 0%");
})();

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
