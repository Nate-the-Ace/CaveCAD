// TripFocusRows.js -- the rows the Trip Focus window lists.
//
// Pure: survey in, display rows out. Separated from TripFocus.js so the
// numbers and the labels are testable headless while the widgets are
// not.

var TripFocusRows = {};

/**
 * \return [{key, title, note, rows: [{label, distanceText, percentText,
 *          pick}]}] -- four sections, always, in list order. `pick` is
 *          what CsFocus.stationSet wants: a trip id (Trips), a
 *          "team:"-prefixed team text (Teams), a "person:"-prefixed,
 *          CsContrib.personKey-normalised name (People), or a run key
 *          (Survey runs). The prefixes exist because a solo trip whose
 *          team text IS its one member's name would otherwise put the
 *          same string in both namespaces -- see tripsForGroup's own
 *          docblock for the failure that would follow.
 */
TripFocusRows.build = function(survey, resolved, tapeMode) {
    var unit = survey.distanceUnit || "";
    var tripRows = CsContrib.byTrip(survey, resolved, tapeMode);
    var teamRows = CsContrib.byTeam(tripRows);
    var personResult = CsContrib.byPerson(tripRows);
    var runResult = CsContrib.byRun(survey, resolved, tapeMode);
    var runRows = runResult.rows;

    /** Summed distance of the run rows -- the denominator's other half
     *  when working out what share the unclaimed distance is. */
    var runTotal = function(rows) {
        var sum = 0.0;
        for (var r = 0; r < rows.length; r++) {
            sum += rows[r].distance;
        }
        return sum;
    };

    var display = function(label, row, pick) {
        return {
            label: label,
            distanceText: CsContrib.distanceText(row.distance, unit),
            percentText: CsContrib.percentText(row.percent),
            pick: pick
        };
    };

    var trips = [], i;
    for (i = 0; i < tripRows.length; i++) {
        // a trip with no counted shots is still listed: "this party
        // went in and brought back nothing plottable" is information,
        // and hiding the row makes it look like the trip was never
        // recorded
        trips.push(display(tripRows[i].label, tripRows[i],
            tripRows[i].tripId));
    }

    var teams = [];
    for (i = 0; i < teamRows.length; i++) {
        teams.push(display(teamRows[i].team === "" ?
            "(no team recorded)" : teamRows[i].team,
            teamRows[i], "team:" + teamRows[i].team));
    }

    var people = [];
    for (i = 0; i < personResult.rows.length; i++) {
        people.push(display(personResult.rows[i].person,
            personResult.rows[i],
            "person:" + CsContrib.personKey(personResult.rows[i].person)));
    }

    var runs = [];
    for (i = 0; i < runRows.length; i++) {
        runs.push(display("Survey " + runRows[i].run, runRows[i],
            runRows[i].run));
    }
    // Distance no run could claim -- a shot into a station that never
    // resolved, which is the normal state of a survey mid-project. It is
    // LISTED so the runs visibly do not add up to the cave, and it is
    // NOT checkable (pick null): there is no station set to focus, since
    // the stations it belongs to are exactly the ones the drawing could
    // not place. Hiding it instead would make the Survey runs section
    // quietly claim 100% of a cave it only covers part of.
    if (runResult.unassigned > 0) {
        runs.push({
            label: "(not in any run)",
            distanceText: CsContrib.distanceText(runResult.unassigned, unit),
            percentText: CsContrib.percentText(
                CsContrib.share(runResult.unassigned,
                    runResult.unassigned + runTotal(runRows))),
            pick: null
        });
    }

    return [
        { key: "trips",  title: "Trips",       note: "", rows: trips },
        { key: "teams",  title: "Teams",       note: "", rows: teams },
        { key: "people", title: "People",
          note: personResult.overlapping ? CsContrib.PERSON_CREDIT_NOTE : "",
          rows: people },
        { key: "runs",   title: "Survey runs", note: "", rows: runs }
    ];
};

/**
 * Trip ids per team text and per person, for CsFocus.stationSet.
 *
 * ONE flat map covering TWO different key namespaces, so each key is
 * prefixed by which namespace it came from: "team:" + the team text
 * verbatim (byTeam's own key), "person:" + CsContrib.personKey(name)
 * (byPerson's dedup key, NOT the display-case name it reports).
 *
 * Without the prefixes, a solo trip whose team text IS its one
 * member's name ("Nathan") would write the SAME map key from both
 * loops below -- whichever ran last would win, and checking the Teams
 * row "Nathan" could silently return the PERSON's trip ids instead
 * (every trip Nathan was on, including ones with other people), a
 * mismatch nothing here would raise an error for. The prefixes must
 * match what TripFocusRows.build puts in each row's `pick`, since
 * CsFocus.stationSet looks entries up in this map by exactly that
 * string.
 */
TripFocusRows.tripsForGroup = function(survey, resolved, tapeMode) {
    var tripRows = CsContrib.byTrip(survey, resolved, tapeMode);
    var out = {};
    var i, rows = CsContrib.byTeam(tripRows);
    for (i = 0; i < rows.length; i++) {
        out["team:" + rows[i].team] = rows[i].tripIds;
    }
    var persons = CsContrib.byPerson(tripRows).rows;
    for (i = 0; i < persons.length; i++) {
        out["person:" + CsContrib.personKey(persons[i].person)] =
            persons[i].tripIds;
    }
    return out;
};
