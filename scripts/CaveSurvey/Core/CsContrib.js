// CsContrib.js -- who surveyed what, in distance and percent.
//
// Part of the Cave Survey Core library: pure functions, no document and
// no GUI, so the whole of it runs under the headless test harness.
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
 *  ampersand, plus, and the word "and" (which is why "Ann and Bob"
 *  splits but "Alexander" does not -- the pattern needs the word
 *  whole). */
CsContrib.PERSON_SPLIT = /\s*(?:,|;|\/|&|\+|\band\b)\s*/i;

CsContrib.people = function(teamText) {
    if (teamText === undefined || teamText === null) {
        return [];
    }
    var parts = String(teamText).split(CsContrib.PERSON_SPLIT);
    var out = [], seen = {};
    for (var i = 0; i < parts.length; i++) {
        var name = parts[i].replace(/^\s+|\s+$/g, "");
        if (name.length === 0) {
            continue;
        }
        // one person however they capitalised it, keeping the first
        // spelling seen -- a survey where "nathan" and "Nathan" are two
        // contributors is a data-entry artefact, not two people
        var key = name.toUpperCase();
        if (seen[key] === true) {
            continue;
        }
        seen[key] = true;
        out.push(name);
    }
    return out;
};

/** True when a shot contributes to surveyed length. The one rule, so
 *  every row type agrees and the total matches CsStats. */
CsContrib.counts = function(shot) {
    return !(shot.excludeFromAll || shot.splay ||
        shot.from === "" || shot.to === "");
};

/** percent of total, 0 (not NaN) when there is no total. */
CsContrib.share = function(part, total) {
    if (!(total > 0)) {
        return 0.0;
    }
    return part / total * 100.0;
};

/**
 * One row per trip.
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
            label: (typeof CsRevise !== "undefined" &&
                    typeof CsRevise.tripLabel === "function") ?
                CsRevise.tripLabel(i, t) :
                ((t.date || "") + " " + (t.team || "")),
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
        var id = s.trip || 0;
        if (id < 0 || id >= rows.length) {
            id = 0;   // a shot whose trip index is gone still counts
        }
        rows[id].distance += s.distance;
        rows[id].planDistance += CsTraverse.offset(s, tapeMode).plan;
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
 *          overlapping: true when the credited total exceeds the
 *          survey total, i.e. parties of more than one exist}
 */
CsContrib.byPerson = function(tripRows) {
    var order = [], byKey = {}, total = 0.0, credited = 0.0;
    for (var i = 0; i < tripRows.length; i++) {
        var r = tripRows[i];
        total += r.distance;
        var names = CsContrib.people(r.team);
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
            credited += r.distance;
        }
    }
    var rows = [];
    for (i = 0; i < order.length; i++) {
        var row = byKey[order[i]];
        row.percent = CsContrib.share(row.distance, total);
        rows.push(row);
    }
    return { rows: rows, overlapping: credited > total };
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
 * \return [{run, distance, percent, shotCount, stations}] in
 *         resolution order
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

    var byKey = {}, order = [], total = 0.0;
    for (i = 0; i < survey.shots.length; i++) {
        var s = survey.shots[i];
        if (!CsContrib.counts(s)) {
            continue;
        }
        var run = runOf[s.to];
        if (run === undefined) {
            continue;   // never resolved, or a name groupRuns refuses
        }
        if (byKey[run] === undefined) {
            byKey[run] = { run: run, distance: 0.0, percent: 0.0,
                shotCount: 0, stations: grouped.runs[run].stations };
            order.push(run);
        }
        byKey[run].distance += s.distance;
        byKey[run].shotCount++;
        total += s.distance;
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
    return out;
};

/** "1,234 ft" -- grouped, rounded to the whole unit, unit appended.
 *  Matches CsSheet's title-block Length so the two never look like
 *  different measurements of the same cave. */
CsContrib.distanceText = function(distance, unit) {
    var n = Math.round(distance === null || distance === undefined ?
        0 : distance);
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
