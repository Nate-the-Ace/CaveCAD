// edit_trip_run.js -- Edit Trip against a real document.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/edit_trip_run.js "$PWD"
//
// Prints "### EDIT TRIP OK <n>" or "### EDIT TRIP FAIL".
//
// The pure half of CsTripEdit (normalizeDate, planEdits, applyToSurvey,
// tagPlan) is covered in tests/js_unit.js. What only a real
// RDocument can prove is the half that matters most here:
//
//   - the edit reaches the DRAWING -- the tags come back changed from
//     CsRevise.surveyFromDocument, which is the reader every other tool
//     in the suite uses,
//   - the trip COUNT does not change. This is the whole reason the tool
//     exists: Survey Notebook's own edit path matches trips by
//     fingerprint (date | team), so correcting a date forked the trip
//     into a duplicate and left the original standing,
//   - nothing MOVED. These four fields carry no geometry, and an edit
//     that quietly re-resolved the network would be a different and
//     much more dangerous tool,
//   - a cleared field is really cleared. CsTags.set returns early on
//     "" by design, so clearing needs CsTags.remove; getting this
//     wrong leaves the old value in place while the dialog says it is
//     gone,
//   - editing trip 0 also rewrites the legacy drawing-level mirror
//     (SurveyDate/SurveyTeam), which pre-trip readers still consult.

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
function eqs(a, b, what) {
    ok(a === b, what + " (expected " + JSON.stringify(b) +
        ", got " + JSON.stringify(a) + ")");
}
function near(a, b, tol, what) {
    ok(Math.abs(a - b) <= tol,
        what + " (expected " + b + " +/- " + tol + ", got " + a + ")");
}

// ---------------------------------------------------------------------
// Fixture: a two-trip cave, drawn for real.
// ---------------------------------------------------------------------

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var di = new RDocumentInterface(doc);
getDocument = function() { return doc; };
getDocumentInterface = function() { return di; };

function shotOf(from, to, d, az, inc, trip) {
    var s = CsModel.newShot();
    s.from = from;
    s.to = to;
    s.distance = d;
    s.azimuth = az;
    s.inclination = inc || 0;
    s.trip = trip || 0;
    return s;
}

var survey = CsModel.newSurvey();
survey.caveName = "TRUITT CAVE";
survey.distanceUnit = "ft";
survey.trips = [CsModel.newTrip(), CsModel.newTrip()];
survey.trips[0].name = "ENTRANCE";
survey.trips[0].date = "2026-08-01";
survey.trips[0].team = "NDS, JB";
survey.trips[0].instruments = "SUUNTO";
survey.trips[0].declination = 3.5;
survey.trips[1].name = "";
survey.trips[1].date = "2026-08-08";     // the wrong date, on purpose
survey.trips[1].team = "NDS, RM";        // and the wrong team
survey.trips[1].instruments = "";
survey.trips[1].declination = 3.5;
survey.shots.push(shotOf("ENT", "A1", 30.0, 90.0, -5.0, 0));
survey.shots.push(shotOf("A1", "A2", 22.0, 45.0, 0.0, 0));
survey.shots.push(shotOf("A2", "B1", 18.5, 350.0, 3.0, 1));
survey.shots.push(shotOf("B1", "B2", 25.0, 20.0, -2.0, 1));

CsDraw.survey(survey, CsNetwork.resolve(survey, {}));

var before = CsRevise.surveyFromDocument(doc);
ok(before !== null && before.survey !== null,
    "the fixture drawing reconstructs");
eqs(before.survey.trips.length, 2, "the fixture drawing has two trips");
eqs(before.survey.trips[1].date, "2026-08-08",
    "the fixture drawing carries trip 1's date");
eqs(before.survey.shots.length, 4, "the fixture drawing has four shots");

/** Every station's drawn position, by name -- the "nothing moved"
 *  observable. */
function positions() {
    var out = {};
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || typeof e.getPosition !== "function") {
            continue;
        }
        var name = CsTags.get(e, "Station");
        if (name !== "") {
            var p = e.getPosition();
            out[name] = { x: p.x, y: p.y };
        }
    }
    return out;
}
var posBefore = positions();
ok(posBefore.hasOwnProperty("B1"), "the fixture drew its stations");

// ---------------------------------------------------------------------
// The edit: trip 1's date and team were both wrong, and it never got a
// name. Exactly Nathan's Truitt Cave case.
// ---------------------------------------------------------------------

var plan = CsTripEdit.planEdits(before.survey, [
    { tripId: 1, name: "UPPER MAZE", date: "2026-08-15",
      team: "NDS, RM, KW", instruments: "DISTOX2" }
]);
ok(plan.error === undefined, "planEdits accepted the correction");
eqs(plan.changes.length, 1, "one trip to change");

CsTripEdit.applyToSurvey(before.survey, plan.changes);
var res = CsTripEdit.writeTags(doc, di, before.survey, plan.changes);
eqs(res.written, 1, "one anchor point was retagged");
eqs(res.missing.length, 0, "every changed trip had an anchor");

var after = CsRevise.surveyFromDocument(doc);

// The claim the tool exists for.
eqs(after.survey.trips.length, 2,
    "the drawing still has TWO trips -- the correction did not fork one");

eqs(after.survey.trips[1].date, "2026-08-15", "trip 1's date is corrected");
eqs(after.survey.trips[1].team, "NDS, RM, KW", "trip 1's team is corrected");
eqs(after.survey.trips[1].name, "UPPER MAZE", "trip 1 gained its name");
eqs(after.survey.trips[1].instruments, "DISTOX2",
    "trip 1 gained its instruments");

// Everything the edit must NOT touch.
eqs(after.survey.trips[0].date, "2026-08-01", "trip 0's date is untouched");
eqs(after.survey.trips[0].team, "NDS, JB", "trip 0's team is untouched");
near(after.survey.trips[1].declination, 3.5, 1e-9,
    "trip 1's declination is untouched");
eqs(after.survey.shots.length, 4, "no shot was added or lost");
var tripOfShot = {};
for (var si = 0; si < after.survey.shots.length; si++) {
    tripOfShot[after.survey.shots[si].from] = after.survey.shots[si].trip;
}
eqs(tripOfShot["A2"], 1, "trip 1 still owns its shots");
eqs(tripOfShot["ENT"], 0, "trip 0 still owns its shots");

var posAfter = positions();
var moved = 0;
for (var n in posBefore) {
    if (!posBefore.hasOwnProperty(n)) {
        continue;
    }
    if (!posAfter.hasOwnProperty(n)) {
        moved++;
        continue;
    }
    if (Math.abs(posAfter[n].x - posBefore[n].x) > 1e-12 ||
            Math.abs(posAfter[n].y - posBefore[n].y) > 1e-12) {
        moved++;
    }
}
eqs(moved, 0, "not one station moved");

// ---------------------------------------------------------------------
// Clearing a field really clears it (CsTags.set cannot, CsTags.remove
// must).
// ---------------------------------------------------------------------

var clearPlan = CsTripEdit.planEdits(after.survey, [
    { tripId: 1, name: "UPPER MAZE", date: "2026-08-15",
      team: "NDS, RM, KW", instruments: "" }
]);
ok(clearPlan.error === undefined, "planEdits accepted the clear");
eqs(clearPlan.changes.length, 1, "clearing instruments is a change");
CsTripEdit.applyToSurvey(after.survey, clearPlan.changes);
CsTripEdit.writeTags(doc, di, after.survey, clearPlan.changes);
var cleared = CsRevise.surveyFromDocument(doc);
eqs(cleared.survey.trips[1].instruments, "",
    "a cleared field is really gone from the drawing");
eqs(cleared.survey.trips[1].team, "NDS, RM, KW",
    "clearing one field left its neighbours alone");

// ---------------------------------------------------------------------
// Trip 0 also owns the legacy drawing-level mirror, which pre-trip
// readers still consult -- an edit that skipped it would leave the
// drawing contradicting itself.
// ---------------------------------------------------------------------

function anchorTagOf(key) {
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || CsTags.get(e, "Station") === "") {
            continue;
        }
        if (CsTags.getNumber(e, "Trip") === 0) {
            return CsTags.get(e, key);
        }
    }
    return null;
}
eqs(anchorTagOf("SurveyDate"), "2026-08-01",
    "the legacy mirror starts where the fixture put it");

var plan0 = CsTripEdit.planEdits(cleared.survey, [
    { tripId: 0, name: "ENTRANCE", date: "2026-07-30", team: "NDS, JB, KW",
      instruments: "SUUNTO" }
]);
ok(plan0.error === undefined, "planEdits accepted the trip 0 correction");
CsTripEdit.applyToSurvey(cleared.survey, plan0.changes);
CsTripEdit.writeTags(doc, di, cleared.survey, plan0.changes);

var after0 = CsRevise.surveyFromDocument(doc);
eqs(after0.survey.trips[0].date, "2026-07-30", "trip 0's date is corrected");
eqs(after0.survey.trips.length, 2, "still two trips after the trip 0 edit");
eqs(anchorTagOf("SurveyDate"), "2026-07-30",
    "the legacy SurveyDate mirror followed trip 0");
eqs(anchorTagOf("SurveyTeam"), "NDS, JB, KW",
    "the legacy SurveyTeam mirror followed trip 0");
eqs(anchorTagOf("SurveyName"), "TRUITT CAVE",
    "the cave name still owns SurveyName");

// ---------------------------------------------------------------------
// A trip with no anchor in the drawing is reported, not silently
// dropped.
// ---------------------------------------------------------------------

var ghost = CsTripEdit.writeTags(doc, di, after0.survey,
    [{ tripId: 7, before: { name: "", date: "", team: "", instruments: "" },
       after: { name: "GHOST", date: "", team: "", instruments: "" } }]);
eqs(ghost.written, 0, "a trip with no anchor writes nothing");
eqs(ghost.missing.length, 1, "and is reported as missing");
eqs(ghost.missing[0], 7, "by its trip id");

// ---------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------

var out;
if (failures.length === 0) {
    out = "### EDIT TRIP OK " + passed + " assertions";
} else {
    out = "### EDIT TRIP FAIL " + failures.length + " of " +
        (passed + failures.length) + "\n";
    for (var fi = 0; fi < failures.length; fi++) {
        out += "  FAIL: " + failures[fi] + "\n";
    }
}
print(out);
