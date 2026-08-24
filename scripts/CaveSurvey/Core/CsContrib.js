// CsContrib.js -- who surveyed what, in distance and percent.
//
// Part of the Cave Survey Core library: no document and no GUI, so
// the whole of it runs under the headless test harness. Not every
// function here is pure, though: byTrip calls CsModel.ensureTrips
// (survey), which can MUTATE its `survey` argument -- the first time
// a survey with no trips reaches it, ensureTrips builds trips[0] out
// of the top-level fields and stamps every shot missing a trip with 0
// (see ensureTrips' own docblock).
//
// WHAT COUNTS. Exactly the shots CsStats.compute counts: not splays,
// not excludeFromAll, nothing missing an end. That is copied
// deliberately rather than reinvented -- the rows have to sum to the
// Length printed on the title block, or the window and the sheet
// disagree in front of the reader. It inherits CsStats' known gap
// (excludeFromLength is not honoured); closing that is a CsStats change
// and belongs with the task already spawned for it, not here.
//
// CREDIT IS NOT DIVIDED. Two people on one trip are each credited its
// full distance, so People percentages can exceed 100%. Dividing 412 ft
// by a party of three invents a number nobody measured. byPerson
// reports `overlapping` so the window can say so out loud instead of
// leaving the reader to work out why the column does not add up.

var CsContrib = {};

/** Team text -> people. Separators: comma, semicolon, slash,
 *  ampersand, plus, a run of newlines, and the word "and" (which is
 *  why "Ann and Bob" splits but "Alexander" does not -- the pattern
 *  needs the word whole). Deliberately NOT a bare hyphen: that would
 *  split a hyphenated surname ("Mary Smith-Jones") into two people. */
CsContrib.PERSON_SPLIT = /\s*(?:,|;|\/|&|\+|\n+|\band\b)\s*/i;

/** Trailing tokens that read as part of the PREVIOUS name, not as a
 *  person of their own, once a generic split has cut a name in two on
 *  the comma that precedes them ("Nathan Schonegg, Jr." must not hand
 *  back a person named "Jr."). Matched case-insensitively against the
 *  whole trimmed token. */
CsContrib.NAME_SUFFIXES = ["jr", "jr.", "sr", "sr.", "ii", "iii", "iv",
    "phd", "ph.d.", "et al", "et al."];

CsContrib.isNameSuffix = function(token) {
    var t = String(token).replace(/^\s+|\s+$/g, "").toLowerCase();
    for (var i = 0; i < CsContrib.NAME_SUFFIXES.length; i++) {
        if (t === CsContrib.NAME_SUFFIXES[i]) {
            return true;
        }
    }
    return false;
};

/**
 * Team text -> the people on it.
 *
 * Three passes, in this order, each closing a way the naive
 * "split on punctuation" reading fabricates contributors nobody typed:
 *
 *   1. Parenthesised / bracketed role notes ("(book and sketch)",
 *      "[sketch]") are stripped before anything else looks at the
 *      text -- otherwise the "and" or comma INSIDE the note splits
 *      like a separator and hands back a phantom person.
 *   2. A team text containing a semicolon is read as a surname-first
 *      list ("Last, First; Last, First") and split on semicolons
 *      ONLY: the comma there is part of one name, not a break between
 *      two, so the generic comma-splitting path is skipped entirely.
 *   3. Otherwise, split on the generic separators above, then
 *      re-attach a trailing NAME_SUFFIXES token onto the name before
 *      it, so "Nathan Schonegg, Jr." reads as one person.
 *
 * Case-insensitive de-duplication (kept from the first version) still
 * runs last, over whatever the three passes produced.
 */
CsContrib.people = function(teamText) {
    if (teamText === undefined || teamText === null) {
        return [];
    }
    var text = String(teamText)
        .replace(/\([^)]*\)/g, " ")
        .replace(/\[[^\]]*\]/g, " ");

    var parts;
    if (text.indexOf(";") >= 0) {
        parts = text.split(/\s*;\s*/);
    } else {
        parts = text.split(CsContrib.PERSON_SPLIT);
    }

    var merged = [];
    for (var i = 0; i < parts.length; i++) {
        var name = parts[i].replace(/^\s+|\s+$/g, "");
        if (name.length === 0) {
            continue;
        }
        if (CsContrib.isNameSuffix(name) && merged.length > 0) {
            merged[merged.length - 1] = merged[merged.length - 1] +
                ", " + name;
            continue;
        }
        merged.push(name);
    }

    var out = [], seen = {};
    for (var m = 0; m < merged.length; m++) {
        // one person however they capitalised it, keeping the first
        // spelling seen -- a survey where "nathan" and "Nathan" are two
        // contributors is a data-entry artefact, not two people
        var key = merged[m].toUpperCase();
        if (seen[key] === true) {
            continue;
        }
        seen[key] = true;
        out.push(merged[m]);
    }
    return out;
};

/** True when a shot contributes to surveyed length. The one rule, so
 *  every row type agrees and the total matches CsStats. */
CsContrib.counts = function(shot) {
    return !(shot.excludeFromAll || shot.splay ||
        shot.from === "" || shot.to === "");
};

/** percent of total, 0 (not NaN, not Infinity) when there is no total
 *  or the part itself is not a finite number. */
CsContrib.share = function(part, total) {
    if (!(total > 0)) {
        return 0.0;
    }
    if (typeof part !== "number" || !isFinite(part)) {
        return 0.0;
    }
    return part / total * 100.0;
};

/**
 * One row per trip.
 *
 * stationCount counts stations TOUCHED: both ends of every counted
 * shot in the trip, so a station an earlier trip already established
 * is counted again here. Summed across trips it therefore exceeds the
 * survey's own count of distinct stations, and is deliberately not
 * comparable to CsStats.compute().stationCount despite the shared
 * field name.
 *
 * \return [{tripId, label, name, date, team, distance, planDistance,
 *           shotCount, stationCount, percent}] in trip-index order
 */
CsContrib.byTrip = function(survey, resolved, tapeMode) {
    CsModel.ensureTrips(survey);
    var rows = [];
    var i;
    for (i = 0; i < survey.trips.length; i++) {
        var t = survey.trips[i];
        rows.push({
            tripId: i,
            label: CsRevise.tripLabel(i, t),
            name: t.name || "",
            date: t.date || "",
            team: t.team || "",
            distance: 0.0,
            planDistance: 0.0,
            shotCount: 0,
            stationCount: 0,
            percent: 0.0
        });
    }

    var stationsSeen = [];
    for (i = 0; i < rows.length; i++) {
        stationsSeen.push({});
    }

    var total = 0.0;
    for (i = 0; i < survey.shots.length; i++) {
        var s = survey.shots[i];
        if (!CsContrib.counts(s)) {
            continue;
        }
        // A stale or hand-edited trip index can be fractional
        // (CsTags.getNumber reads a hand-edited "Trip=1.5" tag with
        // parseFloat) or simply gone -- floor the first, and fall the
        // second back to trip 0, rather than indexing rows with a
        // value that is not one of its own keys.
        var rawId = (s.trip === undefined || s.trip === null) ?
            0 : Number(s.trip);
        var id = Math.floor(rawId);
        if (isNaN(id) || id < 0 || id >= rows.length) {
            id = 0;
        }
        rows[id].distance += s.distance;
        var off = CsTraverse.offset(s, tapeMode);
        if (off !== null) {
            rows[id].planDistance += off.plan;
        }
        rows[id].shotCount++;
        stationsSeen[id][s.from] = true;
        stationsSeen[id][s.to] = true;
        total += s.distance;
    }

    for (i = 0; i < rows.length; i++) {
        rows[i].percent = CsContrib.share(rows[i].distance, total);
        var n = 0;
        for (var name in stationsSeen[i]) {
            if (stationsSeen[i].hasOwnProperty(name)) {
                n++;
            }
        }
        rows[i].stationCount = n;
    }
    return rows;
};

/**
 * Trip rows grouped by their team text.
 *
 * \return [{team, distance, percent, tripCount, tripIds}] in
 *         first-appearance order
 */
CsContrib.byTeam = function(tripRows) {
    var order = [], byKey = {}, total = 0.0;
    for (var i = 0; i < tripRows.length; i++) {
        var r = tripRows[i];
        var key = r.team || "";
        if (byKey[key] === undefined) {
            byKey[key] = { team: key, distance: 0.0, percent: 0.0,
                tripCount: 0, tripIds: [] };
            order.push(key);
        }
        byKey[key].distance += r.distance;
        byKey[key].tripCount++;
        byKey[key].tripIds.push(r.tripId);
        total += r.distance;
    }
    var out = [];
    for (i = 0; i < order.length; i++) {
        var row = byKey[order[i]];
        row.percent = CsContrib.share(row.distance, total);
        out.push(row);
    }
    return out;
};

/**
 * Trip rows credited to each person who was on them, IN FULL -- see
 * the note at the top of this file.
 *
 * \return {rows: [{person, distance, percent, tripCount, tripIds}],
 *          overlapping: true when any single trip with distance > 0
 *          lists two or more people -- that trip's distance was
 *          credited to more than one row, so the People percentages
 *          cannot be read as parts of a single whole. A grand-total
 *          comparison would miss this: an unattributed trip (blank
 *          team, credited to nobody) can carry enough distance of its
 *          own to keep the credited sum under the survey total even
 *          while a party of two is double-counted elsewhere.}
 */
CsContrib.byPerson = function(tripRows) {
    var order = [], byKey = {}, total = 0.0, overlapping = false;
    for (var i = 0; i < tripRows.length; i++) {
        var r = tripRows[i];
        total += r.distance;
        var names = CsContrib.people(r.team);
        if (r.distance > 0 && names.length >= 2) {
            overlapping = true;
        }
        for (var p = 0; p < names.length; p++) {
            var key = names[p].toUpperCase();
            if (byKey[key] === undefined) {
                byKey[key] = { person: names[p], distance: 0.0,
                    percent: 0.0, tripCount: 0, tripIds: [] };
                order.push(key);
            }
            byKey[key].distance += r.distance;
            byKey[key].tripCount++;
            byKey[key].tripIds.push(r.tripId);
        }
    }
    var rows = [];
    for (i = 0; i < order.length; i++) {
        var row = byKey[order[i]];
        row.percent = CsContrib.share(row.distance, total);
        rows.push(row);
    }
    return { rows: rows, overlapping: overlapping };
};

/** The note the window prints over the People section, so the reader is
 *  never left wondering why the column adds up to more than the cave. */
CsContrib.PERSON_CREDIT_NOTE =
    "Everyone on a trip is credited its whole distance, so these add " +
    "up to more than 100%.";

/**
 * One row per survey run (station-name prefix).
 *
 * A leg belongs to the run its TO station is in: that is the station
 * the shot established, and it is the same rule the profile bands use
 * to decide which run a leg belongs to. A leg from A3 into B1 is B's
 * first leg, not A's fourth.
 *
 * A shot whose TO station never resolved into the network (a run not
 * yet tied in to the rest of the cave) or whose name CsProfile.
 * splitName refuses is a NORMAL mid-project state, not an error --
 * cavers survey in disconnected blocks all the time. Dropping that
 * distance from both the row and the total would silently rescale
 * every other run to fill 100%, which reads as "this is the whole
 * cave" when it is not. It is counted into `unassigned` instead, so
 * the gap is visible rather than hidden.
 *
 * \return {rows: [{run, distance, planDistance, percent, shotCount,
 *          stations}] in resolution order, percent being that run's
 *          share of the FULL counted total -- rows' percentages plus
 *          unassigned's share sum to 100%, the same convention byTrip
 *          uses,
 *          unassigned: summed distance of counted shots no run
 *          claimed}
 */
CsContrib.byRun = function(survey, resolved, tapeMode) {
    var grouped = CsProfile.groupRuns(resolved);
    var runOf = {};
    var i, k;
    for (i = 0; i < grouped.order.length; i++) {
        var key = grouped.order[i];
        var members = grouped.runs[key].stations;
        for (k = 0; k < members.length; k++) {
            runOf[members[k]] = key;
        }
    }

    var byKey = {}, total = 0.0, unassigned = 0.0;
    for (i = 0; i < survey.shots.length; i++) {
        var s = survey.shots[i];
        if (!CsContrib.counts(s)) {
            continue;
        }
        total += s.distance;
        var run = runOf[s.to];
        if (run === undefined) {
            unassigned += s.distance;
            continue;
        }
        if (byKey[run] === undefined) {
            byKey[run] = { run: run, distance: 0.0, planDistance: 0.0,
                percent: 0.0, shotCount: 0,
                stations: grouped.runs[run].stations };
        }
        byKey[run].distance += s.distance;
        var off = CsTraverse.offset(s, tapeMode);
        if (off !== null) {
            byKey[run].planDistance += off.plan;
        }
        byKey[run].shotCount++;
    }

    // resolution order, not discovery-by-shot order, so the list reads
    // the same way the profile bands and the notebook do
    var out = [];
    for (i = 0; i < grouped.order.length; i++) {
        var ordered = byKey[grouped.order[i]];
        if (ordered !== undefined) {
            ordered.percent = CsContrib.share(ordered.distance, total);
            out.push(ordered);
        }
    }
    return { rows: out, unassigned: unassigned };
};

/** "1,234 ft" -- grouped, rounded to the whole unit, unit appended.
 *  Matches CsSheet's title-block Length so the two never look like
 *  different measurements of the same cave. A non-finite distance
 *  (Infinity, -Infinity, NaN) reads as 0 rather than falling through
 *  to the digit-grouping loop, which otherwise treats "Infinity"'s
 *  own letters as digits and produces something like "In,fin,ity". */
CsContrib.distanceText = function(distance, unit) {
    var d = (distance === null || distance === undefined) ? 0 : distance;
    if (typeof d !== "number" || !isFinite(d)) {
        d = 0;
    }
    var n = Math.round(d);
    var text = String(Math.abs(n));
    var grouped = "";
    while (text.length > 3) {
        grouped = "," + text.substring(text.length - 3) + grouped;
        text = text.substring(0, text.length - 3);
    }
    grouped = text + grouped;
    if (n < 0) {
        grouped = "-" + grouped;
    }
    return grouped + ((unit === undefined || unit === null || unit === "") ?
        "" : (" " + unit));
};

/** "14%" -- and "<1%" for a real but tiny share, because a row that
 *  reads 0% next to a drawn passage looks like a bug. */
CsContrib.percentText = function(percent) {
    var p = (percent === null || percent === undefined) ? 0 : percent;
    if (p > 0 && p < 0.5) {
        return "<1%";
    }
    return String(Math.round(p)) + "%";
};
