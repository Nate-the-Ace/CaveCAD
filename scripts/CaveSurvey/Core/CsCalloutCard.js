// CsCalloutCard.js -- the callout card: schedule windows and the page.
//
// Part of the Cave Survey Core library: pure ES5, no document, no GUI,
// no network. The forecast arrives as plain data; see CsWeather.
//
// NO COORDINATES in any output. Route labels are station names only.
// THE ROUTE FOLLOWS THE SURVEY LINE and is never called safe or easy.
//
// The 'Cs' prefix is mandatory: include() dedupes by basename.

include(includeBasePath + "/CsTripPlan.js");

var CsCalloutCard = {};

/** "HH:MM" to minutes past midnight, or null. */
CsCalloutCard.parseClock = function(text) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(text));
    if (m === null) { return null; }
    var h = parseInt(m[1], 10);
    var mi = parseInt(m[2], 10);
    if (h > 23 || mi > 59) { return null; }
    return h * 60 + mi;
};

/** "YYYY-MM-DD" to minutes since 1970 UTC at midnight, or null. Timezone free. */
CsCalloutCard.dateMinutes = function(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
    if (m === null) { return null; }
    return Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1,
        parseInt(m[3], 10)) / 60000;
};

/** Absolute minutes to {date, time, abs}. */
CsCalloutCard.stamp = function(abs) {
    var whole = Math.round(abs);
    var d = new Date(whole * 60000);
    var two = function(n) { return (n < 10 ? "0" : "") + n; };
    return { date: d.getUTCFullYear() + "-" + two(d.getUTCMonth() + 1) + "-" +
            two(d.getUTCDate()),
        time: two(d.getUTCHours()) + ":" + two(d.getUTCMinutes()), abs: whole };
};

/** The date of each trip day, "YYYY-MM-DD", in order. */
CsCalloutCard.tripDates = function(trip) {
    var base = CsCalloutCard.dateMinutes(trip.startDate);
    var out = [];
    if (base === null) { return out; }
    for (var i = 0; i < trip.days.length; i++) {
        out.push(CsCalloutCard.stamp(base + i * 1440).date);
    }
    return out;
};

/**
 * What is missing before a card can be built: "" when nothing, else a
 * short name of the first missing thing.
 */
CsCalloutCard.missing = function(trip, plan) {
    if (plan === null || plan === undefined || plan.stops === undefined ||
            plan.stops.length === 0) {
        return "a planned route (pick stops and press Plan trip)";
    }
    if (CsCalloutCard.dateMinutes(trip.startDate) === null) { return "start date"; }
    if (trip.days.length === 0) { return "at least one day"; }
    return "";
};

/**
 * The schedule as rows. A day STARTS FROM THE SURFACE when it is the
 * first or the night before was "out": the inbound time is added. A day
 * ENDS ON THE SURFACE when its night is "out" or it is the last: expected
 * out and callout are then given. Underground camp-to-camp moves are not
 * modelled; only the ends of the trip use the route's in and out times.
 *
 * \param plan a CsTripPlan plan (totals.minutesIn / minutesOut)
 * \param trip {startDate, days: [{entry, workHours, night}]}
 * \param bufferMin minutes after expected out that topside starts acting
 * \return {rows: [{day, entry, turnaround, expectedOut, callout, night,
 *   fromSurface, endsOnSurface}], warnings}; stamps are {date, time, abs}
 */
CsCalloutCard.windows = function(plan, trip, bufferMin) {
    var rows = [];
    var warnings = [];
    var base = CsCalloutCard.dateMinutes(trip.startDate);
    if (base === null) { return { rows: rows, warnings: warnings }; }
    var minutesIn = plan.totals.minutesIn;
    var minutesOut = plan.totals.minutesOut;
    var n = trip.days.length;
    for (var i = 0; i < n; i++) {
        var day = trip.days[i];
        var last = i === n - 1;
        var fromSurface = i === 0 || trip.days[i - 1].night === "out";
        var endsOnSurface = last || day.night === "out";
        var entryAbs = base + i * 1440 + CsCalloutCard.parseClock(day.entry);
        var turnAbs = entryAbs + (fromSurface ? minutesIn : 0) + day.workHours * 60;
        var row = { day: i + 1, entry: CsCalloutCard.stamp(entryAbs),
            turnaround: CsCalloutCard.stamp(turnAbs),
            expectedOut: null, callout: null,
            night: endsOnSurface ? "out" : "camp",
            fromSurface: fromSurface, endsOnSurface: endsOnSurface };
        var endAbs = turnAbs;
        if (endsOnSurface) {
            endAbs = turnAbs + minutesOut;
            row.expectedOut = CsCalloutCard.stamp(endAbs);
            row.callout = CsCalloutCard.stamp(endAbs + bufferMin);
        }
        rows.push(row);
        if (!last) {
            var nextEntry = base + (i + 1) * 1440 +
                CsCalloutCard.parseClock(trip.days[i + 1].entry);
            if (endAbs > nextEntry) {
                warnings.push("Day " + (i + 1) + " runs past day " + (i + 2) +
                    "'s entry time. Check the work hours.");
            }
        }
    }
    return { rows: rows, warnings: warnings };
};
