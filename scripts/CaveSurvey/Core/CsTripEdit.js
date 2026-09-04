// CsTripEdit.js -- correcting a trip's metadata after it was drawn.
//
// A trip's name, date, team and instruments are typed once, in the
// Survey Notebook's header, and until this module existed there was no
// way to correct them. The path that looks like it should work makes it
// worse: Survey Notebook's "Load from drawing" decides which trip the
// page REPLACES by FINGERPRINT -- date + "|" + team
// (CsModel.tripFingerprint) -- so editing either field means nothing
// matches, the page lands as a NEW trip, and the old one keeps its
// shots. Fixing a typo forked the cave. That is the bug this module
// exists to close: every edit here is applied by TRIP ID.
//
// What it deliberately does NOT touch:
//
//   declination   changing it rotates every azimuth and moves the whole
//                 plan. That already has an editor -- Survey Notebook's
//                 Declination dialog, which runs CsRevise.reviseDeclination
//                 and CsRevise.apply and carries the IGRF wiring. Name,
//                 date, team and instruments move NO geometry, so this
//                 module never resolves a network, never redraws and
//                 never needs a backup. Keeping the two apart keeps a
//                 team-name typo off the heavy path.
//
//   trip identity as a MERGE. Two trips that would end up with the same
//                 date and team are refused by name. Merging trips
//                 renumbers shots and rebinds linework; it is not
//                 something to smuggle in behind a typo fix.
//
// Where the data lives: each trip's metadata rides as XDATA on that
// trip's ANCHOR station point -- its first resolved station in drawing
// order -- written by CsDraw.survey and read back by
// CsRevise.surveyFromDocument. Trip 0's anchor additionally carries the
// legacy drawing-level mirror (SurveyName/SurveyDate/SurveyTeam) that
// pre-trip readers still use, so an edit to trip 0 must rewrite that
// too or the drawing starts contradicting itself.

if (typeof CsTripEdit === "undefined") {
    var CsTripEdit = {};
}

/** The fields this module edits, in display order. */
CsTripEdit.FIELDS = ["name", "date", "team", "instruments"];

/**
 * One row per trip, for display.
 *
 * \param survey a CsModel survey (normalized in place by ensureTrips,
 *               the suite-wide idiom)
 * \return [{tripId, label, name, date, team, instruments,
 *           declination, declinationSource, shots}] in trip-id order
 */
CsTripEdit.rows = function(survey) {
    CsModel.ensureTrips(survey);
    var counts = {};
    for (var i = 0; i < survey.shots.length; i++) {
        var t = survey.shots[i].trip || 0;
        counts[t] = (counts[t] || 0) + 1;
    }
    var out = [];
    for (var ti = 0; ti < survey.trips.length; ti++) {
        var trip = survey.trips[ti];
        var label = "Trip " + ti;
        if (trip.name !== "" && trip.name !== null &&
                trip.name !== undefined) {
            label += " — " + trip.name;
        }
        out.push({
            tripId: ti,
            label: label,
            name: trip.name || "",
            date: trip.date || "",
            team: trip.team || "",
            instruments: trip.instruments || "",
            declination: Number(trip.declination) || 0.0,
            declinationSource: trip.declinationSource || "",
            shots: counts[ti] || 0
        });
    }
    return out;
};

/** Days in a month, 1-based month, with the Gregorian leap rule. */
CsTripEdit.daysInMonth = function(year, month) {
    var days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month === 2 &&
            ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0)) {
        return 29;
    }
    return days[month - 1];
};

/** Left-pads a number to two digits. */
CsTripEdit.pad2 = function(n) {
    return (n < 10 ? "0" : "") + String(n);
};

/**
 * The date a trip should store, from what a caver typed.
 *
 * Accepts, after trimming:
 *   ""            a trip may legitimately carry no date
 *   YYYY-MM-DD    the stored form
 *   M/D/YYYY      what actually gets typed; converted
 *
 * An impossible calendar date (2026-02-30) is REFUSED rather than
 * stored. This field is not decoration: the shelf's declination-drift
 * check and the IGRF estimate both parse it, and a date that parses to
 * nothing turns those into silent no-ops.
 *
 * \return {ok: true, value: "YYYY-MM-DD" or ""} or
 *         {ok: false, error: "..."}
 */
CsTripEdit.normalizeDate = function(text) {
    var s = String(text === undefined || text === null ? "" : text)
        .replace(/^\s+|\s+$/g, "");
    if (s === "") {
        return { ok: true, value: "" };
    }
    var y, m, d;
    var iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    var us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (iso !== null) {
        y = parseInt(iso[1], 10);
        m = parseInt(iso[2], 10);
        d = parseInt(iso[3], 10);
    } else if (us !== null) {
        m = parseInt(us[1], 10);
        d = parseInt(us[2], 10);
        y = parseInt(us[3], 10);
    } else {
        return { ok: false, error: "\"" + s + "\" is not a date. Use " +
            "YYYY-MM-DD (or M/D/YYYY), or leave it empty." };
    }
    if (m < 1 || m > 12) {
        return { ok: false, error: "\"" + s + "\" has no month " + m +
            "." };
    }
    if (d < 1 || d > CsTripEdit.daysInMonth(y, m)) {
        return { ok: false, error: "\"" + s + "\" is not a real date: " +
            "month " + m + " of " + y + " has no day " + d + "." };
    }
    return { ok: true,
        value: y + "-" + CsTripEdit.pad2(m) + "-" + CsTripEdit.pad2(d) };
};

/**
 * Turns raw field text into the edits to apply -- or into one error
 * that stops the whole thing.
 *
 * All-or-nothing on purpose. A dialog that applied the three rows it
 * could parse and complained about the fourth would leave the drawing
 * in a state nobody asked for and no undo step describes.
 *
 * \param survey the survey read back from the drawing
 * \param inputs [{tripId, name, date, team, instruments}] -- raw text,
 *               one entry per EDITABLE row (a row the dialog showed
 *               read-only simply isn't here)
 * \return {changes: [{tripId, before: {...}, after: {...}}]} listing
 *         only trips that actually differ, or {error: "..."}
 */
CsTripEdit.planEdits = function(survey, inputs) {
    CsModel.ensureTrips(survey);
    var trim = function(v) {
        return String(v === undefined || v === null ? "" : v)
            .replace(/^\s+|\s+$/g, "");
    };
    // The would-be fingerprint of every trip, edited or not: the
    // collision check has to see the trips this edit does NOT touch,
    // or renaming trip 2 onto trip 5's date and team would sail
    // through.
    var after = [];
    for (var t = 0; t < survey.trips.length; t++) {
        after.push({ date: survey.trips[t].date || "",
            team: survey.trips[t].team || "" });
    }

    var changes = [];
    for (var i = 0; i < inputs.length; i++) {
        var inp = inputs[i];
        var id = inp.tripId;
        if (typeof id !== "number" || id < 0 ||
                id >= survey.trips.length) {
            return { error: "No trip " + id + " in this drawing. " +
                "Nothing was changed." };
        }
        var trip = survey.trips[id];
        var dateOut = CsTripEdit.normalizeDate(inp.date);
        if (!dateOut.ok) {
            return { error: "Trip " + id + ": " + dateOut.error +
                " Nothing was changed." };
        }
        var nu = { name: trim(inp.name), date: dateOut.value,
            team: trim(inp.team), instruments: trim(inp.instruments) };
        var old = { name: trip.name || "", date: trip.date || "",
            team: trip.team || "",
            instruments: trip.instruments || "" };
        after[id] = { date: nu.date, team: nu.team };

        var differs = false;
        for (var f = 0; f < CsTripEdit.FIELDS.length; f++) {
            if (nu[CsTripEdit.FIELDS[f]] !== old[CsTripEdit.FIELDS[f]]) {
                differs = true;
            }
        }
        if (differs) {
            changes.push({ tripId: id, before: old, after: nu });
        }
    }

    // Identity: two trips with the same date and team ARE the same trip
    // (CsModel.tripFingerprint), and the rest of the suite believes it.
    //
    // Only a collision this edit CREATES is refused. Trips that already
    // shared a fingerprint keep sharing it -- a cave imported without
    // per-trip metadata has several trips all reading "|", and refusing
    // there would make the one tool that can fill those fields in
    // refuse to run on exactly the drawings that need it most.
    for (var a = 0; a < after.length; a++) {
        for (var b = a + 1; b < after.length; b++) {
            if (CsModel.tripFingerprint(after[a]) !==
                    CsModel.tripFingerprint(after[b])) {
                continue;
            }
            if (CsModel.tripFingerprint(survey.trips[a]) ===
                    CsModel.tripFingerprint(survey.trips[b])) {
                continue; // already indistinguishable before this edit
            }
            return { error: "Trip " + a + " and trip " + b +
                " would have the same date and team, which makes them " +
                "the same trip. Merging trips is not what this does. " +
                "Nothing was changed." };
        }
    }

    return { changes: changes };
};

/**
 * Writes planned changes into the survey model.
 *
 * ensureTrips runs afterwards because trips[0] is the authority over
 * the survey's top-level date/team/name mirror -- an edit to trip 0
 * that skipped this would leave survey.date reading the old value to
 * everything that still consults it.
 */
CsTripEdit.applyToSurvey = function(survey, changes) {
    CsModel.ensureTrips(survey);
    for (var i = 0; i < changes.length; i++) {
        var c = changes[i];
        var trip = survey.trips[c.tripId];
        if (trip === undefined) {
            continue;
        }
        for (var f = 0; f < CsTripEdit.FIELDS.length; f++) {
            var key = CsTripEdit.FIELDS[f];
            trip[key] = c.after[key];
        }
    }
    CsModel.ensureTrips(survey);
    return survey;
};

/**
 * The tags a trip's anchor should carry after an edit, and the ones to
 * remove. Pure, so the write below stays a loop over a decision made
 * here.
 *
 * CsTags.set CANNOT clear a tag -- it returns early on "" by design --
 * so a field the caver emptied has to be REMOVED, not set. Getting
 * that wrong is how a cleared field silently keeps its old value.
 *
 * \param tripId  the trip's id, written back so the anchor keeps
 *                declaring which trip it anchors
 * \param after   {name, date, team, instruments}
 * \param legacy  true for trip 0, which also carries the pre-trip
 *                drawing-level mirror
 * \param caveName the drawing's cave name, which owns SurveyName when
 *                it is set (CsDraw writes caveName || trip name)
 * \return {set: {key: value}, remove: [key]}
 */
CsTripEdit.tagPlan = function(tripId, after, legacy, caveName) {
    var set = {};
    var remove = [];
    var put = function(key, value) {
        if (value === "" || value === null || value === undefined) {
            remove.push(key);
        } else {
            set[key] = value;
        }
    };
    // Trip is re-set rather than assumed: the anchor was found BY this
    // tag, so writing it back costs nothing and keeps the write
    // self-describing.
    set.Trip = tripId;
    put("TripName", after.name);
    put("TripDate", after.date);
    put("TripTeam", after.team);
    put("TripInstruments", after.instruments);
    if (legacy === true) {
        put("SurveyDate", after.date);
        put("SurveyTeam", after.team);
        put("SurveyName", (caveName !== "" && caveName !== null &&
            caveName !== undefined) ? caveName : after.name);
    }
    return { set: set, remove: remove };
};

/**
 * Applies planned changes to the drawing: retags one anchor point per
 * changed trip, in ONE modify operation so the whole edit is one undo
 * step.
 *
 * No geometry is touched, nothing is erased and nothing is redrawn --
 * no drawn thing depends on these four fields. That is what makes this
 * safe enough to run without a backup, unlike every other operation in
 * the suite that writes to a drawing.
 *
 * Wrapped in CsRevise.withOffLayersOn: station points sit on a control
 * layer that is routinely switched off, and a modify operation on an
 * off layer is refused SILENTLY -- the edit would report success and
 * change nothing.
 *
 * \return {written, missing} -- missing lists trip ids with no anchor
 *         point in the drawing (a trip whose stations never resolved,
 *         so CsDraw had nothing to hang its metadata on)
 */
CsTripEdit.writeTags = function(doc, di, survey, changes) {
    var wanted = {};
    for (var i = 0; i < changes.length; i++) {
        wanted[changes[i].tripId] = changes[i];
    }
    var caveName = (survey === null || survey === undefined) ? "" :
        (survey.caveName || "");

    var run = function() {
        var op = new RModifyObjectsOperation();
        op.setText("Edit trip");
        var written = 0;
        var seen = {};
        var ids = doc.queryAllEntities(false, false);
        for (var k = 0; k < ids.length; k++) {
            var e = doc.queryEntity(ids[k]);
            if (isNull(e)) {
                continue;
            }
            // A trip anchor is a STATION point carrying a Trip tag.
            // The Trip tag alone is not enough: legs and splays carry
            // one too, and retagging a leg would scatter a trip's
            // metadata over its shots.
            if (CsTags.get(e, "Station") === "" ||
                    typeof e.getPosition !== "function") {
                continue;
            }
            var tid = CsTags.getNumber(e, "Trip");
            if (tid === null || !wanted.hasOwnProperty(tid) ||
                    seen[tid] === true) {
                continue;
            }
            seen[tid] = true;
            var plan = CsTripEdit.tagPlan(tid, wanted[tid].after,
                tid === 0, caveName);
            for (var key in plan.set) {
                if (plan.set.hasOwnProperty(key)) {
                    CsTags.set(e, key, plan.set[key]);
                }
            }
            for (var r = 0; r < plan.remove.length; r++) {
                CsTags.remove(e, plan.remove[r]);
            }
            op.addObject(e, false); // false: leave it on its layer
            written++;
        }
        di.applyOperation(op);

        var missing = [];
        for (var w in wanted) {
            if (wanted.hasOwnProperty(w) && seen[w] !== true) {
                missing.push(Number(w));
            }
        }
        missing.sort(function(a, b) { return a - b; });
        return { written: written, missing: missing };
    };

    if (typeof CsRevise !== "undefined" &&
            typeof CsRevise.withOffLayersOn === "function") {
        return CsRevise.withOffLayersOn(doc, di, run);
    }
    return run();
};

/**
 * The one-line consequence of a set of changes, for the report.
 *
 * A changed DATE is the one edit with a follow-on: the trip's
 * declination was estimated for the old date, and IGRF moves. Saying so
 * is the whole point -- this tool cannot fix it, and the tool that can
 * is somewhere else.
 */
CsTripEdit.dateChanged = function(changes) {
    for (var i = 0; i < changes.length; i++) {
        if (changes[i].before.date !== changes[i].after.date) {
            return true;
        }
    }
    return false;
};
