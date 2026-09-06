// make_lesson_cave.js -- the LESSON CAVE: one small, invented cave built
// to be surveyed and drawn in a single sitting, and rich enough that a
// student walking the six-stage menu (Task 9 of the teachable-
// consolidation plan) has a real reason to touch every stage.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tools/make_lesson_cave.js "$PWD" [targetFolder]
//
// Writes testdata/LessonCave.dat (through the Compass writer, via the
// format registry -- not hand-formatted) and a cave folder with a
// drawing into ~/Documents/Cave/lesson (or the folder given), built
// through CsDraw.survey exactly as tools/make_demo_caves.js builds its
// caves, so the drawing carries real tag schema v3.
//
// EVERY STATION, BEARING, DISTANCE AND COORDINATE HERE IS INVENTED.
// There is no real "Lesson Cave"; the name, the shots and the location
// are made up for teaching. The location reuses the same plausible-but-
// arbitrary point in the southern Indiana karst that make_demo_caves.js
// uses for its own shelf, for the same reason: real cave entrance
// locations do not belong in test data (see the suite's own privacy
// rule), and a generated cave can be regenerated whenever the tools
// change.
//
// ---------------------------------------------------------------------
// THE CAVE, ON PAPER, BEFORE ANY CODE:
//
// Trip 1 -- the entrance run. A student's first Notebook page: short
//   (5 legs), every station LRUD'd, gentle grade, nothing surprising.
//   A1 (the entrance, fixed) through A6.
//
// Trip 2 -- the side lead. Ties into A3, a trip 1 station, and stops at
//   B4 -- an open end, so the shelf has something to show as "stopped
//   at" and Survey Notebook / the frontier has a real lead to offer.
//
// Trip 3 -- the loop. Leaves A6, the far end of trip 1, wanders through
//   C1-C2 and rejoins trip 2 at B2, closing a real loop
//   (A3-A4-A5-A6-C1-C2-B2-B1-A3) that Survey Stats reports a genuine,
//   small misclosure on -- the student watches it close rather than
//   taking it on faith.
//
// Trip 4 -- the big room. Branches off A2 (a trip 1 station) into D1,
//   a wide room walked as its own small perimeter loop (D1-D2-D3-D1)
//   so it ties itself shut instead of leaving a second open end. Wide
//   LRUD and splays off every room station: worth a Cross Section,
//   worth scattering breakdown across in Scatter Breakdown.
//
// Fifteen stations total (A1-A6, B1-B4, C1-C2, D1-D3), four trips, one
// loop that closes, one open end, one wide room. Small enough for one
// sitting, and every stage of the menu has a reason to be pressed.
// ---------------------------------------------------------------------

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];
var targetRoot = QDir.homePath() + "/Documents/Cave/lesson";
// second-to-last argument is an explicit target when one was given --
// same convention as make_demo_caves.js.
if (args.length >= 2) {
    var maybe = String(args[args.length - 1]);
    var prev = String(args[args.length - 2]);
    if (prev.indexOf("make_lesson_cave.js") === -1 && maybe.indexOf("/") === 0 &&
            prev.indexOf("/") === 0) {
        repoRoot = prev;
        targetRoot = maybe;
    }
}

function loadRepoScript(rel) {
    var file = new QFile(repoRoot + "/" + rel);
    if (!file.open(QIODevice.ReadOnly | QIODevice.Text)) {
        throw new Error("cannot open " + rel);
    }
    var stream = new QTextStream(file);
    var src = stream.readAll();
    file.close();
    (0, eval)(src);
}

// A bare -autostart engine has no library.js, so the helpers the Core
// expects are not there. Same shims tools/make_demo_caves.js carries.
if (typeof isNull === "undefined") {
    isNull = function(v) {
        if (v === undefined || v === null) { return true; }
        try { if (typeof v.isNull === "function") { return v.isNull(); } }
        catch (e) { }
        return false;
    };
}
if (typeof isFunction === "undefined") {
    isFunction = function(v) { return typeof v === "function"; };
}
if (typeof destr === "undefined") {
    destr = function(o) {
        try { if (o !== null && o !== undefined && isFunction(o.destroy)) { o.destroy(); } }
        catch (e) { }
    };
}
if (typeof qsTr === "undefined") {
    qsTr = function(t) { return t; };
}
if (typeof writeTextFile === "undefined") {
    writeTextFile = function(path, text) {
        var f = new QFile(path);
        if (!f.open(QIODevice.WriteOnly | QIODevice.Text)) { return false; }
        var ts = new QTextStream(f);
        ts.writeString(text);
        f.close();
        return true;
    };
}

var CORE = ["CsUuid", "CsUnits", "CsCave", "CsShelf", "CsPackage",
    "CsGeoProject", "CsAngles", "CsIgrfCoeffs", "CsGeomag", "CsModel",
    "CsFrontier", "CsTraverse", "CsNetwork", "CsAdjust", "CsLrud",
    "CsProfile", "CsProfileDraw", "CsCallout", "CsElevation", "CsValidate",
    "CsStats", "CsGrade", "CsLayers", "CsLayerVariants", "CsBackup",
    "CsTrace", "CsStore", "CsTags", "CsBind", "CsDraw", "CsSheet",
    "CsSymbols", "CsRevise"];
for (var ci = 0; ci < CORE.length; ci++) {
    loadRepoScript("scripts/CaveSurvey/Core/" + CORE[ci] + ".js");
}
loadRepoScript("scripts/CaveSurvey/Core/Format/CsCompass.js");
loadRepoScript("scripts/CaveSurvey/Core/Format/CsWalls.js");
loadRepoScript("scripts/CaveSurvey/Core/Format/CsSurvex.js");
loadRepoScript("scripts/CaveSurvey/Core/Format/CsCsv.js");
loadRepoScript("scripts/CaveSurvey/Core/Format/CsTherion.js");
loadRepoScript("scripts/CaveSurvey/Core/Format/CsRegistry.js");

// The invented location the demo shelf already uses: a plausible but
// arbitrary point in the southern Indiana karst. Not a cave. Reused
// here rather than inventing a second one, on purpose -- one fictional
// point for the whole project's generated fixtures is easier to keep
// straight than several.
var GEO = { lat: 38.42137, lon: -86.51884 };
var ENTRANCE_ELEVATION = 771.30; // invented, upland-plausible, not zero

function round(v, places) {
    var f = Math.pow(10, places === undefined ? 2 : places);
    return Math.round(v * f) / f;
}

/** IGRF declination at GEO for a "YYYY-MM-DD" date, or 0. */
function igrfAt(dateText) {
    var parts = CsShelf.dateParts(dateText);
    if (parts === null) { return 0; }
    var value = CsShelf.declinationValue(
        CsGeomag.declination(GEO.lat, GEO.lon, parts, 0.0));
    return value === null ? 0 : round(value, 2);
}

// ---------------------------------------------------------------------
// A tiny position-tracking builder, ported down from tools/
// make_test_cave.js: walking each leg from an already-placed FROM
// station computes exactly where TO lands, so a closing leg between
// two already-placed stations can be computed rather than guessed --
// which is how a loop is made to close to a KNOWN, small misclosure
// instead of hoping.
// ---------------------------------------------------------------------

function newBuilder(caveName) {
    var survey = CsModel.newSurvey();
    survey.caveName = caveName;
    survey.distanceUnit = "ft";
    survey.trips = [];

    var b = { survey: survey, pos: {}, trip: 0 };

    b.addTrip = function(name, date, team, declination) {
        var t = CsModel.newTrip();
        t.name = name;
        t.date = date;
        t.team = team;
        t.declination = declination;
        t.declinationSource = "igrf";
        t.distanceUnit = "ft";
        survey.trips.push(t);
        b.trip = survey.trips.length - 1;
        return b.trip;
    };

    b.fix = function(name, x, y, z) {
        survey.fixed[name] = { x: x, y: y, z: z };
        if (b.pos[name] === undefined) {
            b.pos[name] = { x: x, y: y, z: z };
        }
    };

    /** One ordinary leg, walked forward from an already-placed FROM. */
    b.leg = function(from, to, dist, az, inc, opts) {
        opts = opts || {};
        var s = CsModel.newShot();
        s.from = from;
        s.to = to;
        s.distance = round(dist, 1);
        s.azimuth = round(CsAngles.normalizeAzimuth(az), 1);
        s.inclination = round(inc, 1);
        s.trip = b.trip;
        s.declination = survey.trips[b.trip].declination;
        if (opts.lrud !== undefined) {
            s.left = opts.lrud[0];
            s.right = opts.lrud[1];
            s.up = opts.lrud[2];
            s.down = opts.lrud[3];
        }
        if (opts.notes !== undefined) {
            s.notes = opts.notes;
        }
        survey.shots.push(s);

        if (opts.place !== false && b.pos[from] !== undefined &&
                b.pos[to] === undefined) {
            var off = CsTraverse.offset(s, CsTraverse.SLOPE);
            b.pos[to] = {
                x: b.pos[from].x + off.dx,
                y: b.pos[from].y + off.dy,
                z: b.pos[from].z + off.dz
            };
        }
        return s;
    };

    /**
     * The exact leg between two already-placed stations, perturbed by
     * a small deliberate error -- the same closing-leg idiom
     * make_test_cave.js uses. distFactor 1.0 = a perfect tape;
     * azError 0 = a perfect compass. Small nonzero values here are
     * what make the loop close to a small, REAL, computed misclosure
     * instead of exactly zero (which no real survey ever does).
     */
    b.closeLeg = function(from, to, distFactor, azError, opts) {
        var a = b.pos[from], c = b.pos[to];
        if (a === undefined || c === undefined) {
            throw new Error("closeLeg needs both stations placed: " +
                from + " -> " + to);
        }
        var dx = c.x - a.x, dy = c.y - a.y, dz = c.z - a.z;
        var plan = Math.sqrt(dx * dx + dy * dy);
        var dist = Math.sqrt(plan * plan + dz * dz);
        var az = CsAngles.normalizeAzimuth(
            Math.atan2(dx, dy) * 180.0 / Math.PI);
        var inc = plan === 0 && dz === 0 ? 0 :
            Math.atan2(dz, plan) * 180.0 / Math.PI;
        opts = opts || {};
        opts.place = false;
        return b.leg(from, to, dist * distFactor, az + azError, inc, opts);
    };

    /** A wall shot: no TO station, splay flag set. */
    b.splay = function(from, dist, az, inc, notes) {
        var s = CsModel.newShot();
        s.from = from;
        s.to = "";
        s.splay = true;
        s.distance = round(dist, 1);
        s.azimuth = round(CsAngles.normalizeAzimuth(az), 1);
        s.inclination = round(inc, 1);
        s.trip = b.trip;
        s.declination = survey.trips[b.trip].declination;
        if (notes !== undefined) {
            s.notes = notes;
        }
        survey.shots.push(s);
        return s;
    };

    return b;
}

// ---------------------------------------------------------------------
// Build the survey exactly as designed above.
// ---------------------------------------------------------------------

var b = newBuilder("LESSON CAVE");
b.fix("A1", 0.0, 0.0, ENTRANCE_ELEVATION);

// Trip 1 -- the entrance run: short, every station LRUD'd, gentle.
b.addTrip("Entrance series", "2026-03-07", "SCHONEGG, WELLER", igrfAt("2026-03-07"));
b.leg("A1", "A2", 32.0, 18.0, 2.0, { lrud: [3.5, 4.0, 6.5, 1.0] });
b.leg("A2", "A3", 41.5, 42.0, -3.0, { lrud: [2.5, 5.0, 7.0, 0.5] });
b.leg("A3", "A4", 28.0, 5.0, 4.0, { lrud: [4.0, 3.0, 5.5, 1.5] });
b.leg("A4", "A5", 36.0, 350.0, -6.0, { lrud: [3.0, 3.5, 6.0, 2.0] });
b.leg("A5", "A6", 24.5, 15.0, 1.0, { lrud: [2.0, 4.5, 5.0, 1.0] });

// Trip 2 -- the side lead: ties into A3, stops open at B4.
b.addTrip("Side lead", "2026-03-14", "WELLER, POOLE", igrfAt("2026-03-14"));
b.leg("A3", "B1", 19.0, 110.0, -8.0, { lrud: [2.0, 2.5, 4.0, 1.5] });
b.leg("B1", "B2", 33.0, 95.0, -2.0, { lrud: [3.0, 3.0, 5.0, 1.0] });
b.leg("B2", "B3", 27.5, 78.0, -5.0, { lrud: [2.5, 2.0, 4.5, 1.5] });
b.leg("B3", "B4", 21.0, 60.0, -10.0, { lrud: [1.5, 2.0, 3.5, 2.0],
    notes: "stopped -- passage continues, low and wet" });

// Trip 3 -- the loop: leaves A6 (trip 1's far end), rejoins B2 (trip
// 2), closing A3-A4-A5-A6-C1-C2-B2-B1-A3. The closing leg is computed
// from the two branches' walked positions and taped 0.8% long, which
// is what gives the loop a small, real, nonzero misclosure instead of
// a suspiciously perfect zero.
b.addTrip("The loop", "2026-03-21", "SCHONEGG, POOLE, HARMON", igrfAt("2026-03-21"));
b.leg("A6", "C1", 38.0, 205.0, 3.0, { lrud: [3.0, 3.5, 5.0, 1.0] });
b.leg("C1", "C2", 44.0, 240.0, -1.0, { lrud: [2.5, 3.0, 6.0, 1.5] });
var closer = b.closeLeg("C2", "B2", 1.008, 1.3,
    { lrud: [2.0, 2.5, 5.0, 1.0], notes: "closes the loop back to B2" });

// Trip 4 -- the big room: branches off A2, walked as its own small
// perimeter loop (D1-D2-D3-D1) so the room ties itself shut instead of
// leaving a second open end. Wide LRUD, splays scattered off every
// room station for the breakdown zone.
b.addTrip("The big room", "2026-03-28", "DUVAL, WELLER, HARMON", igrfAt("2026-03-28"));
b.leg("A2", "D1", 22.0, 260.0, -2.0, { lrud: [4.0, 4.5, 8.0, 1.5] });
b.leg("D1", "D2", 46.0, 300.0, 0.5, { lrud: [18.0, 22.0, 15.0, 3.5] });
b.leg("D2", "D3", 39.0, 15.0, -0.5, { lrud: [20.0, 16.0, 14.0, 4.0] });
b.closeLeg("D3", "D1", 1.003, -0.6, { lrud: [17.0, 19.0, 13.0, 3.0] });

// Splays off the room stations -- breakdown scattered across the
// floor, and a scan of the ceiling and walls, worth a Cross Section.
b.splay("D1", 12.0, 340.0, 60.0, "ceiling");
b.splay("D1", 9.0, 200.0, -55.0, "breakdown block");
b.splay("D2", 26.0, 55.0, 2.0, "far wall, big room");
b.splay("D2", 15.0, 340.0, -30.0, "breakdown, floor of room");
b.splay("D2", 11.0, 340.0, 65.0, "high ceiling dome");
b.splay("D3", 18.0, 130.0, -20.0, "breakdown pile, south side");
b.splay("D3", 8.0, 250.0, 40.0, "ledge");

var survey = b.survey;
survey.startLrud = { left: 2.0, right: 2.5, up: 6.0, down: 1.0 };
survey.trips[0].startLrud = survey.startLrud;

// ---------------------------------------------------------------------
// Verify the design before writing anything: the loop closes, there is
// exactly one open end, and nothing here trips an ERROR-severity
// finding (a lesson cave that raises an alarm is a bad first lesson).
// ---------------------------------------------------------------------

var resolved = CsNetwork.resolve(survey, {});
var findings = CsValidate.check(survey, resolved);
var stats = CsStats.compute(survey, resolved, CsTraverse.SLOPE);
var openEnds = CsFrontier.openEnds(survey);

var problems = [];
if (resolved.loops.length < 1) {
    problems.push("expected at least one loop, resolved " +
        resolved.loops.length);
}
if (openEnds.length !== 1) {
    problems.push("expected exactly one open end, found " +
        openEnds.length + ": " + JSON.stringify(openEnds));
}
if (CsValidate.checkHasErrors(findings)) {
    problems.push("the lesson cave trips an ERROR-severity finding");
}
if (CsModel.stationNames(survey).length >= 40) {
    problems.push("station count " + CsModel.stationNames(survey).length +
        " is not under 40");
}

if (problems.length > 0) {
    for (var pi = 0; pi < problems.length; pi++) {
        print("### PROBLEM " + problems[pi]);
    }
    // Do not print the success token, and do not write anything --
    // a lesson cave that fails its own design check must not ship.
    throw new Error("make_lesson_cave.js: design check failed");
}

// ---------------------------------------------------------------------
// Write testdata/LessonCave.dat -- through the format registry, not
// hand-formatted, exactly like every other fixture in this project.
// ---------------------------------------------------------------------

var datText = CsFormatRegistry.byId("compass").write(survey);
var datPath = repoRoot + "/testdata/LessonCave.dat";
if (!writeTextFile(datPath, datText)) {
    print("### PROBLEM could not write " + datPath);
    throw new Error("make_lesson_cave.js: could not write " + datPath);
}

// ---------------------------------------------------------------------
// Write the cave folder and its drawing, through CsDraw.survey exactly
// as make_demo_caves.js builds its own shelf -- see that file's own
// comment on the getDocument()/getDocumentInterface() workaround
// CsDraw.survey needs, which is reused here unchanged.
// ---------------------------------------------------------------------

function mkpath(p) { return (new QDir()).mkpath(p); }

var caveName = "LESSON CAVE";
var folder = targetRoot + "/" + caveName;
mkpath(folder);

var drawingPath = folder + "/" + caveName + ".dxf";

function writeDrawing(theSurvey, path) {
    var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
    var di = new RDocumentInterface(doc);
    getDocument = function() { return doc; };
    getDocumentInterface = function() { return di; };

    var template = repoRoot + "/templates/NSS_Cave_Template_PLAN.dxf";
    if ((new QFileInfo(template)).exists()) {
        var src = new RDocumentInterface(
            new RDocument(new RMemoryStorage(), new RSpatialIndexNavel()));
        try {
            if (src.importFile(template, "", false) ===
                    RDocumentInterface.IoErrorNoError) {
                var paste = new RPasteOperation(src.getDocument());
                paste.setOffset(new RVector(0, 0));
                paste.setCopyAllLayers(true);
                paste.setCopyEmptyBlocks(true);
                di.applyOperation(paste);
            }
        } finally {
            destr(src);
        }
    }

    var drawResolved = CsNetwork.resolve(theSurvey, {});
    CsDraw.survey(theSurvey, drawResolved, undefined, undefined, 0);

    // The georeference, on the entrance station, exactly where the
    // suite puts it -- so Package Cave Project has something real to
    // strip when it sanitizes.
    var stations = CsTags.collectStations(doc);
    for (var s = 0; s < stations.length; s++) {
        if (stations[s].name !== "A1") { continue; }
        CsTags.commit(di, stations[s].entity, {
            GeoLat: String(GEO.lat),
            GeoLon: String(GEO.lon),
            GeoStation: "A1"
        });
        break;
    }

    var filter = "";
    var filters = RFileExporterRegistry.getFilterStrings();
    for (var f = 0; f < filters.length; f++) {
        var label = String(filters[f]);
        if (label.indexOf("dxflib") !== -1 && label.indexOf("*.dxf") !== -1) {
            filter = filters[f];
            break;
        }
    }
    var ok = di.exportFile(path, filter);
    destr(di);
    return ok;
}

survey.caveName = caveName;
if (!writeDrawing(survey, drawingPath)) {
    print("### PROBLEM could not write " + drawingPath);
    throw new Error("make_lesson_cave.js: could not write " + drawingPath);
}

// ---------------------------------------------------------------------
// Report -- the same numbers the manifest records, so regenerating and
// re-checking the manifest by hand is a `diff`, not a re-derivation.
// ---------------------------------------------------------------------

print("### LESSON CAVE stations " + CsModel.stationNames(survey).length +
    "   trips " + survey.trips.length +
    "   shots " + survey.shots.length);
print("### LESSON CAVE surveyed " + stats.surveyedLength.toFixed(1) +
    " ft   plan " + stats.planLength.toFixed(1) +
    "   depth " + stats.depth.toFixed(1));
for (var li = 0; li < resolved.loops.length; li++) {
    var lp = resolved.loops[li];
    print("### LESSON CAVE loop " + lp.from + ".." + lp.to + "  " +
        lp.error.toFixed(2) + " off over " + lp.traverseLength.toFixed(1) +
        " = " + lp.percent.toFixed(2) + "%");
}
print("### LESSON CAVE open end " + JSON.stringify(openEnds));
print("### LESSON CAVE dat " + datPath);
print("### LESSON CAVE drawing " + drawingPath);
print("### LESSON CAVE WRITTEN");
