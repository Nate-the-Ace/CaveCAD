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
include(includeBasePath + "/CsPeople.js");

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

/** True when a value has something other than whitespace in it. */
var csCardFilled = function(v) {
    return v !== null && v !== undefined &&
        String(v).replace(/^\s+|\s+$/g, "") !== "";
};

/**
 * EVERYTHING missing before a card can be built, named at once (Nathan,
 * 2026-09-29: "too easy to not enter important information"). In the
 * panel's order, which is the card's: trip, roster, schedule,
 * escalation, route. The callout buffer is never required (it has a
 * default); the roster only when it is going on the card. Whitespace
 * counts as blank. Never throws on null or missing arguments.
 *
 * \param trip {startDate, days}
 * \param plan a CsTripPlan plan, or null
 * \param contacts {topName, topPhone, escalation}
 * \param roster the resolved party [{name, ...}]: at least one person going
 * \param includeRoster false leaves the roster off the card (and out of this)
 * \return [short human strings], empty when the card can be built
 */
CsCalloutCard.missingAll = function(trip, plan, contacts, roster, includeRoster) {
    var out = [];
    var t = (trip !== null && typeof trip === "object") ? trip : {};
    var c = (contacts !== null && typeof contacts === "object") ? contacts : {};
    var date = csCardFilled(t.startDate) ?
        String(t.startDate).replace(/^\s+|\s+$/g, "") : "";
    if (CsCalloutCard.dateMinutes(date) === null) {
        out.push("start date");
    }
    if (includeRoster !== false) {
        var person = false;
        var list = Object.prototype.toString.call(roster) === "[object Array]" ?
            roster : [];
        for (var i = 0; i < list.length; i++) {
            if (list[i] !== null && typeof list[i] === "object" &&
                    csCardFilled(list[i].name)) {
                person = true;
            }
        }
        if (!person) {
            out.push("at least one person going (tick Going, or untick Include roster)");
        }
    }
    if (Object.prototype.toString.call(t.days) !== "[object Array]" ||
            t.days.length === 0) {
        out.push("at least one day");
    }
    if (!csCardFilled(c.topName)) { out.push("topside contact name"); }
    if (!csCardFilled(c.topPhone)) { out.push("contact phone"); }
    if (!csCardFilled(c.escalation)) { out.push("the if-no-word escalation line"); }
    if (plan === null || plan === undefined || typeof plan !== "object" ||
            Object.prototype.toString.call(plan.stops) !== "[object Array]" ||
            plan.stops.length === 0) {
        out.push("at least one stop (add one under Route)");
    }
    return out;
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

CsCalloutCard.WATER_WORDS = /\b(flood\w*|sump\w*|siphon\w*|water\w*|wet|creek|stream|river)\b/i;
CsCalloutCard.HAZARD_WORDS = /\b(hazard\w*|danger\w*|loose|unstable|rockfall|bad air|co2|slippery|exposed|exposure)\b/i;
/** A day counts as wet at this chance (percent) or this much rain (inches). */
CsCalloutCard.RAIN_CHANCE = 50;
CsCalloutCard.RAIN_INCHES = 0.25;

/**
 * Notes on the way in that name water or a hazard.
 * \return [{station, text, water}] in route order, each note once
 */
CsCalloutCard.hazards = function(plan) {
    var out = [];
    var seen = {};
    for (var s = 0; s < plan.stops.length; s++) {
        var steps = plan.stops[s].steps;
        for (var k = 0; k < steps.length; k++) {
            var notes = steps[k].notes || [];
            for (var n = 0; n < notes.length; n++) {
                var line = String(notes[n]);
                if (seen[line] === true) { continue; }
                var water = CsCalloutCard.WATER_WORDS.test(line);
                if (!water && !CsCalloutCard.HAZARD_WORDS.test(line)) { continue; }
                seen[line] = true;
                var cut = line.indexOf(": ");
                out.push({ station: cut < 0 ? "" : line.slice(0, cut),
                    text: cut < 0 ? line : line.slice(cut + 2), water: water });
            }
        }
    }
    return out;
};

var csCardWet = function(day) {
    return day !== null && ((typeof day.rainChance === "number" &&
            day.rainChance >= CsCalloutCard.RAIN_CHANCE) ||
        (typeof day.rainTotal === "number" &&
            day.rainTotal >= CsCalloutCard.RAIN_INCHES));
};

/**
 * A 44x44 black-and-white weather glyph as an inline svg, or "" for an
 * unknown kind. Static markup; the label only goes into aria-label.
 * Showers differ from rain: a small sun above the cloud and two short
 * vertical drops, where rain is three long slanted lines.
 */
CsCalloutCard.weatherIconSvg = function(kind, label) {
    var cloud = "<path d=\"M13 30a6 6 0 0 1 0-12 8 8 0 0 1 15-2 6 6 0 0 1 2 14z\"/>";
    var lines = function(xs, y1, y2, dx) {
        var p = "";
        for (var i = 0; i < xs.length; i++) {
            p += "<path d=\"M" + xs[i] + " " + y1 + "l" + dx + " " + (y2 - y1) + "\"/>";
        }
        return p;
    };
    var sun = function(cx, cy, r) {
        var p = "<circle cx=\"" + cx + "\" cy=\"" + cy + "\" r=\"" + r + "\"/>";
        var a = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]];
        for (var i = 0; i < a.length; i++) {
            var f = i < 4 ? 1 : 0.7;
            p += "<path d=\"M" + (cx + a[i][0] * (r + 3) * f) + " " +
                (cy + a[i][1] * (r + 3) * f) + "L" + (cx + a[i][0] * (r + 7) * f) + " " +
                (cy + a[i][1] * (r + 7) * f) + "\"/>";
        }
        return p;
    };
    var body = {
        clear: sun(22, 22, 7),
        partly: sun(15, 14, 5) + "<path d=\"M15 36a5 5 0 0 1 0-10 7 7 0 0 1 13-2 5 5 0 0 1 2 12z\"/>",
        cloud: cloud,
        fog: "<path d=\"M13 26a6 6 0 0 1 0-12 8 8 0 0 1 15-2 6 6 0 0 1 2 14z\"/>" +
            "<path d=\"M10 33h24M14 38h16\"/>",
        drizzle: cloud + lines([16, 23, 30], 34, 38, 0),
        rain: cloud + lines([15, 22, 29], 33, 42, -3),
        showers: sun(30, 11, 4) + "<path d=\"M12 32a5 5 0 0 1 0-10 7 7 0 0 1 13-2 5 5 0 0 1 2 12z\"/>" +
            lines([16, 24], 36, 41, 0),
        snow: cloud + "<path d=\"M16 35v6M13 38h6M24 35v6M21 38h6M32 35v6M29 38h6\"/>",
        thunder: cloud + "<path d=\"M24 31l-5 6h5l-3 6\"/>"
    }[kind];
    if (body === undefined) { return ""; }
    var text = label || kind;
    return "<svg viewBox=\"0 0 44 44\" width=\"44\" height=\"44\" role=\"img\" " +
        "aria-label=\"" + CsTripPlan.esc(text) + "\" fill=\"none\" " +
        "stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" " +
        "stroke-linejoin=\"round\">" + body + "</svg>";
};

/** Two-line stamp text: "Sat 2026-10-03 08:00" without a weekday, dates are plain. */
var csCardWhen = function(stamp) { return stamp.date + " " + stamp.time; };

// ---------------------------------------------------------------------
// Shared page pieces. Every renderer (the single-team card, the topside
// sheet, the team file) builds from these, so the three look alike. Each
// pushes lines onto h, which the caller joins with "\n": the single-team
// card must stay byte-identical, so the push boundaries are part of the
// output and must not move.
// ---------------------------------------------------------------------

/** The document head and stylesheet, up to and including <body>. */
var csCardHead = function(h, titleText) {
    h.push("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">");
    h.push("<title>" + CsTripPlan.esc(titleText) + "</title>");
    h.push("<style>body{font:14px/1.4 -apple-system,Helvetica,Arial,sans-serif;" +
        "max-width:760px;margin:20px auto;padding:0 16px;color:#111}" +
        "h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:16px 0 4px;" +
        "border-bottom:1px solid #999}table{border-collapse:collapse;width:100%}" +
        "td,th{border:1px solid #bbb;padding:3px 6px;text-align:left;font-size:13px}" +
        ".note{color:#555}.warn{color:#8a4b00}.flag{font-weight:bold;color:#a00;" +
        "border:2px solid #a00;padding:4px 8px;margin:6px 0}" +
        ".box{border:3px solid #111;padding:8px 12px;margin:10px 0;font-size:17px}" +
        ".days{display:flex;gap:6px;flex-wrap:wrap}.day{border:1px solid #bbb;" +
        "padding:4px 8px;min-width:110px;display:flex;gap:8px;align-items:center}" +
        ".day .ico{flex:none;line-height:0}" +
        ".day .txt{font-size:12px}.day .txt b{font-size:14px}.page2{margin-top:32px}" +
        "@media print{.page2{page-break-before:always;margin-top:0}}" +
        CsTripPlan.SIGNS_CSS + "</style></head><body>");
};

/** The "first to last date · made <date>" line under the heading. */
var csCardDatesLine = function(h, dates, generated) {
    var esc = CsTripPlan.esc;
    h.push("<p class=\"note\">" + esc(dates.length > 0 ? dates[0] : "") +
        (dates.length > 1 ? " to " + esc(dates[dates.length - 1]) : "") +
        (generated ? " &middot; made " + esc(generated) : "") + "</p>");
};

/**
 * One roster row. withEmergency false leaves the emergency-contact
 * column out (team files: that stays on the topside sheet).
 */
var csCardRosterRow = function(p, withEmergency) {
    var esc = CsTripPlan.esc;
    if (p.known === false) {
        // On the party, but not in this computer's directory.
        return "<tr><td>" + esc(p.name) + "</td><td colspan=\"" +
            (withEmergency ? 5 : 4) + "\" " +
            "class=\"note\">details not on this computer</td></tr>";
    }
    var labels = CsPeople.skillLabels(p);
    var escLabels = [];
    for (var sl = 0; sl < labels.length; sl++) { escLabels.push(esc(labels[sl])); }
    var note = p.skillsNote === undefined || p.skillsNote === null ?
        "" : String(p.skillsNote);
    return "<tr><td>" + esc(p.name) + "</td><td>" + esc(p.role) + "</td><td>" +
        (typeof p.squeeze === "number" ? esc(p.squeeze) + " in" : "&mdash;") +
        "</td><td>" + esc(p.medical) + "</td><td>" +
        (withEmergency ? esc(p.emergency) + "</td><td>" : "") +
        escLabels.join(" &middot; ") +
        (note.replace(/\s+/g, "") !== "" ? (escLabels.length > 0 ? "<br>" : "") +
            "<span class=\"note\" style=\"font-size:11px\">" + esc(note) +
            "</span>" : "") + "</td></tr>";
};

/** A whole roster table: header, a row per person, close. */
var csCardRosterTable = function(h, people, withEmergency) {
    h.push("<table><tr><th>Name</th><th>Role</th><th>Squeeze limit</th>" +
        "<th>Medical</th>" + (withEmergency ? "<th>Emergency contact</th>" : "") +
        "<th>Skills</th></tr>");
    for (var r = 0; r < people.length; r++) {
        h.push(csCardRosterRow(people[r], withEmergency));
    }
    h.push("</table>");
};

/** The schedule table under `heading` (markup), then its warnings. */
var csCardSchedule = function(h, win, heading) {
    var esc = CsTripPlan.esc;
    h.push(heading + "<table><tr><th>Day</th><th>Entry</th>" +
        "<th>Turnaround</th><th>Expected out</th><th>Callout</th></tr>");
    for (var w = 0; w < win.rows.length; w++) {
        var row = win.rows[w];
        h.push("<tr><td>" + row.day + "</td><td>" + esc(csCardWhen(row.entry)) +
            "</td><td>" + esc(csCardWhen(row.turnaround)) + "</td>");
        if (row.endsOnSurface) {
            h.push("<td>" + esc(csCardWhen(row.expectedOut)) + "</td><td><b>" +
                esc(csCardWhen(row.callout)) + "</b></td></tr>");
        } else {
            h.push("<td colspan=\"2\" class=\"note\">Camp night, no callout until " +
                "the team surfaces</td></tr>");
        }
    }
    h.push("</table>");
    for (var wn = 0; wn < win.warnings.length; wn++) {
        h.push("<p class=\"warn\">" + esc(win.warnings[wn]) + "</p>");
    }
};

/** The boxed escalation section. */
var csCardEscalation = function(h, contacts, buffer) {
    var esc = CsTripPlan.esc;
    h.push("<h2>Escalation</h2><div class=\"box\">");
    if (!contacts.topName && !contacts.topPhone && !contacts.escalation) {
        h.push("<span class=\"warn\">Contacts not filled in.</span>");
    } else {
        h.push("Topside contact: <b>" + esc(contacts.topName) + "</b> " +
            esc(contacts.topPhone) + "<br>Callout buffer: " + esc(buffer) +
            " min after expected out.<br>" + esc(contacts.escalation));
    }
    h.push("</div>");
};

/**
 * The forecast strip for `dates`, with weather icons.
 * \return true when any of those dates is wet
 */
var csCardForecast = function(h, forecast, dates) {
    var esc = CsTripPlan.esc;
    h.push("<h2>Forecast</h2>");
    var anyWet = false;
    if (forecast === null || forecast === undefined) {
        h.push("<p class=\"warn\">No forecast, check before you go.</p>");
    } else {
        h.push("<div class=\"days\">");
        for (var d = 0; d < dates.length; d++) {
            var fd = null;
            for (var f = 0; f < forecast.days.length; f++) {
                if (forecast.days[f].date === dates[d]) { fd = forecast.days[f]; }
            }
            if (fd === null) {
                h.push("<div class=\"day\"><span class=\"txt\"><span class=\"note\">" +
                    esc(dates[d]) + "</span><br><span class=\"note\">" +
                    "outside forecast range</span></span></div>");
            } else {
                var wet = csCardWet(fd);
                if (wet) { anyWet = true; }
                var wxd = CsWeather.describeCode(fd.code) || CsWeather.fallbackKind(fd);
                h.push("<div class=\"day\"" + (wet ? " style=\"border:2px solid #111\"" : "") + ">");
                if (wxd !== null) {
                    h.push("<span class=\"ico\">" +
                        CsCalloutCard.weatherIconSvg(wxd.kind, wxd.label) + "</span>");
                }
                h.push("<span class=\"txt\"><span class=\"note\">" + esc(dates[d]) +
                    "</span><br>" + (wxd !== null ? "<b>" + esc(wxd.label) + "</b><br>" : "") +
                    esc(fd.high) + "&deg; / " + esc(fd.low) + "&deg; F<br>" +
                    "<span class=\"note\">rain " + esc(fd.rainTotal) + " in &middot; " +
                    esc(fd.rainChance) + "%</span></span></div>");
            }
        }
        h.push("</div>");
    }
    return anyWet;
};

/** The rain-plus-water flag, when a day is wet and a hazard is water. */
var csCardWaterFlag = function(h, anyWet, hazards) {
    var anyWater = false;
    for (var hz = 0; hz < hazards.length; hz++) {
        if (hazards[hz].water) { anyWater = true; }
    }
    if (anyWet && anyWater) {
        h.push("<p class=\"flag\">Rain forecast + water noted on route. Check " +
            "conditions before going in.</p>");
    }
};

/** Opens the route page (print page break before it) under `heading` (markup). */
var csCardRouteIntro = function(h, heading) {
    h.push("<div class=\"page2\"><h1>" + heading + "</h1>");
    h.push("<p class=\"note\">This route follows the survey line. It is not a " +
        "guarantee that the way is safe or easy: crawls, water, climbs and loose " +
        "ground are only known where someone wrote them down.</p>");
};

/** The route drawing and the directions, or `noRoute` (text) when there are no stops. */
var csCardRoute = function(h, plan, survey, resolved, noRoute) {
    var esc = CsTripPlan.esc;
    if (plan.stops.length === 0) {
        h.push("<p class=\"warn\">" + esc(noRoute) + "</p>");
        return;
    }
    h.push(CsTripPlan.routeSvg(survey, resolved, plan));
    h.push("<h2>Directions</h2>");
    for (var s = 0; s < plan.stops.length; s++) {
        h.push("<h3>To " + esc(plan.stops[s].station) + "</h3>");
        var legIn = CsTripPlan.signs(plan.stops[s].steps, plan.unit,
            plan.stops[s].station);
        h.push(CsTripPlan.legSummaryHtml(legIn, plan.stops[s].steps, plan.unit));
        h.push(CsTripPlan.signsHtml(legIn));
    }
    h.push("<h3>Back to " + esc(plan.start) + "</h3>");
    var legOut = CsTripPlan.signs(plan.back.steps, plan.unit, plan.start);
    h.push(CsTripPlan.legSummaryHtml(legOut, plan.back.steps, plan.unit));
    h.push(CsTripPlan.signsHtml(legOut));
};

/** The hazards list. */
var csCardHazards = function(h, hazards) {
    var esc = CsTripPlan.esc;
    h.push("<h2>Hazards on the route</h2>");
    if (hazards.length === 0) {
        h.push("<p class=\"note\">None noted. Notes only exist where someone wrote them.</p>");
    } else {
        h.push("<ul>");
        for (var z = 0; z < hazards.length; z++) {
            h.push("<li class=\"warn\">" + esc(hazards[z].station) + ": " +
                esc(hazards[z].text) + "</li>");
        }
        h.push("</ul>");
    }
};

/** Rope and hardware, when the route has any rope. */
var csCardRope = function(h, plan) {
    var esc = CsTripPlan.esc;
    if (plan.gear && plan.gear.rope.length > 0) {
        h.push("<h2>Rope and hardware</h2><ul>");
        for (var ro = 0; ro < plan.gear.rope.length; ro++) {
            h.push("<li>" + esc(plan.gear.rope[ro].text) + "</li>");
        }
        for (var hw = 0; hw < plan.gear.hardware.length; hw++) {
            h.push("<li class=\"warn\">" + esc(plan.gear.hardware[hw]) + "</li>");
        }
        h.push("</ul>");
    }
};

/**
 * The card as one HTML page that prints on two sheets.
 *
 * \param ctx {title, survey, resolved, trip, contacts: {topName, topPhone,
 *   escalation, bufferMin}, roster: the RESOLVED party
 *   (CsPeople.resolveParty: [{name, role, squeeze, medical, emergency,
 *   skills, skillsNote, known}]), includeRoster, forecast: {days: [{date,
 *   high, low, rainTotal, rainChance}]} | null, generated}
 */
CsCalloutCard.html = function(plan, ctx) {
    var esc = CsTripPlan.esc;
    var trip = ctx.trip;
    var contacts = ctx.contacts || {};
    var buffer = typeof contacts.bufferMin === "number" ? contacts.bufferMin : 120;
    var win = CsCalloutCard.windows(plan, trip, buffer);
    var hazards = CsCalloutCard.hazards(plan);
    var dates = CsCalloutCard.tripDates(trip);
    var h = [];
    csCardHead(h, ctx.title + " callout card");
    h.push("<h1>" + esc(ctx.title) + " &mdash; callout card</h1>");
    csCardDatesLine(h, dates, ctx.generated);

    // Roster: above the fold, straight under the header.
    h.push("<h2>Roster</h2>");
    if (ctx.includeRoster === false) {
        h.push("<p class=\"note\">Roster not included on this copy.</p>");
    } else if (!ctx.roster || ctx.roster.length === 0) {
        h.push("<p class=\"warn\">Roster not filled in.</p>");
    } else {
        csCardRosterTable(h, ctx.roster, true);
    }

    csCardSchedule(h, win, "<h2>Schedule</h2>");
    csCardEscalation(h, contacts, buffer);
    var anyWet = csCardForecast(h, ctx.forecast, dates);
    csCardWaterFlag(h, anyWet, hazards);

    // Page 2: the route.
    csCardRouteIntro(h, esc(ctx.title) + " &mdash; route");
    csCardRoute(h, plan, ctx.survey, ctx.resolved,
        "No route: add stops under Route in the Expedition Planner.");
    csCardHazards(h, hazards);
    csCardRope(h, plan);
    h.push("</div></body></html>");
    return h.join("\n");
};
