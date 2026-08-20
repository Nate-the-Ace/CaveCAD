// Model.js -- the survey value objects every tool works from.
//
// Part of the Cave Survey Core library: pure data, no GUI, no
// document access.
//
// One neutral shape, whatever the source (typed into the Notebook,
// parsed from Compass/Walls/Survex/CSV, or read back out of a
// drawing's entity tags):
//
//   Survey {
//     name            string, e.g. "Main Passage"
//     date            "YYYY-MM-DD" or ""
//     team            string, free text
//     declination     degrees, positive east, already APPLIED to the
//                     azimuths below (the storage convention every
//                     supported format shares); recorded so it can be
//                     reported and un-applied
//     declinationSource  "file" | "user" | "igrf" | ""
//     distanceUnit    "ft" | "m" -- unit of every distance and LRUD
//     shots           [Shot]
//     fixed           { stationName: {x, y, z} } from #Fix / *fix
//     trips           [Trip] -- one drawing can hold shots from several
//                     survey trips (different date/team/declination
//                     each); trips[0] mirrors the top-level fields
//                     above for the common one-trip case, so old code
//                     that never heard of trips keeps working. See
//                     ensureTrips/tripOf/tripIdFor below.
//   }
//
//   Trip {
//     name, date, team, declination, declinationSource, distanceUnit,
//     startNote, startLrud   -- same meaning as the matching Survey
//                     field, but scoped to this one trip
//   }
//
//   Shot {
//     from, to        station names ("" for splays' missing end)
//     distance        tape length (slope distance unless tapeMode says
//                     otherwise -- see Traverse.js)
//     azimuth         degrees clockwise from north, TRUE bearing
//     inclination     degrees, positive up
//     left,right,up,down  LRUD at the TO station, facing travel;
//                     null = not measured (distinct from 0 = wall at
//                     the station)
//     splay           boolean: no named TO station, geometry only
//     excludeFromPlot boolean: position stations but draw nothing
//                     (Compass #|P#, Survex *flags surface)
//     excludeFromAll  boolean: ignore entirely (Compass #|X#)
//     excludeFromLength boolean: real geometry, but skip in length
//                     stats (Compass #|L#, Survex *flags duplicate)
//     noAdjust        boolean: hold fixed during loop closure
//                     (Compass #|C#)
//     notes           string
//     trip            index into survey.trips this shot belongs to;
//                     0 when the survey has never been split into
//                     trips
//   }
//
// Backsight frame: backAzimuth/backInclination are UNREVERSED (a good
// backsight compass reads ~180 deg from azimuth, backInclination ~
// -inclination) but live in the SAME frame as azimuth: declination
// already applied by the parsers, removed again by the writers. That
// keeps Traverse's fore/back averaging inside one frame.
//
// LRUD nulls: parsers map "missing" markers (negative values in
// Compass, "--" in Walls, blank in CSV) to null, never to 0.
//
// Trip identity: two trip records are "the same trip" when their
// fingerprint -- date + "|" + declination.toFixed(4) + "|" + team --
// is equal. Declination is included (to 4 decimals) because the same
// crew can revisit on the same date with a re-measured declination,
// and that's a distinct trip for un-applying purposes; name is
// deliberately NOT part of the fingerprint (it's a label, not
// identity). See tripFingerprint/tripIdFor.

var CsModel = {};

/** A fresh, empty survey. */
CsModel.newSurvey = function() {
    return {
        name: "",
        date: "",
        team: "",
        declination: 0.0,
        declinationSource: "",
        distanceUnit: "ft",
        shots: [],
        fixed: {},
        // note for the very first station (no arriving shot to carry it)
        startNote: "",
        // LRUD of the very first station, which no shot arrives at --
        // {left, right, up, down} or null. The paper notes page records
        // it beside the first station; the first shot's azimuth is its
        // direction reference when drawn.
        startLrud: null
    };
};

/** A shot with every field present and neutral. */
CsModel.newShot = function() {
    return {
        from: "",
        to: "",
        distance: 0.0,
        azimuth: 0.0,
        inclination: 0.0,
        backAzimuth: null,      // backsight compass, uncorrected (deg)
        backInclination: null,  // backsight clino, uncorrected (deg)
        left: null,
        right: null,
        up: null,
        down: null,
        // every reading when a side was written "5/10"; null otherwise
        leftAll: null,
        rightAll: null,
        upAll: null,
        downAll: null,
        splay: false,
        excludeFromPlot: false,
        excludeFromAll: false,
        excludeFromLength: false,
        noAdjust: false,
        notes: "",
        // index into survey.trips; 0 until the survey is split into
        // trips (see ensureTrips)
        trip: 0
    };
};

/** A fresh trip record, fields neutral -- see the Trip shape above. */
CsModel.newTrip = function() {
    return {
        name: "",
        date: "",
        team: "",
        declination: 0.0,
        declinationSource: "",
        distanceUnit: "ft",
        startNote: "",
        startLrud: null
    };
};

/**
 * The identity string two trip records are compared by: same date,
 * same declination (to 4 decimals), same team means "the same trip".
 * A null/undefined declination is treated as 0.0 so a half-built trip
 * record still fingerprints instead of throwing.
 */
CsModel.tripFingerprint = function(trip) {
    var d = (trip.declination === null || trip.declination === undefined) ?
        0.0 : trip.declination;
    return (trip.date || "") + "|" + d.toFixed(4) + "|" + (trip.team || "");
};

/**
 * Brings a survey's trips array into existence and keeps it in sync
 * with the top-level name/date/team/... fields every OLDER piece of
 * code still reads and writes. Two directions, both idempotent:
 *
 *   no trips yet  -- build trips[0] by copying the top-level fields
 *                    down, then stamp every shot missing a trip with
 *                    trip 0 (shots written before trips existed)
 *   trips already exist -- mirror trips[0] back UP to the top level,
 *                    so a caller that only reads survey.team still
 *                    sees trip 0's team after someone edited it
 *
 * Called at the top of every function (tripIdFor, writers, etc.) that
 * needs trips to exist, so nothing else has to remember to call it
 * first.
 */
CsModel.ensureTrips = function(survey) {
    if (survey.trips === undefined || survey.trips === null ||
            survey.trips.length === 0) {
        var t = CsModel.newTrip();
        t.name = survey.name;
        t.date = survey.date;
        t.team = survey.team;
        t.declination = survey.declination;
        t.declinationSource = survey.declinationSource;
        t.distanceUnit = survey.distanceUnit;
        t.startNote = survey.startNote || "";
        t.startLrud = survey.startLrud || null;
        survey.trips = [t];
        for (var i = 0; i < survey.shots.length; i++) {
            if (survey.shots[i].trip === undefined ||
                    survey.shots[i].trip === null) {
                survey.shots[i].trip = 0;
            }
        }
    }
    var t0 = survey.trips[0];
    survey.name = t0.name;
    survey.date = t0.date;
    survey.team = t0.team;
    survey.declination = t0.declination;
    survey.declinationSource = t0.declinationSource;
    survey.distanceUnit = t0.distanceUnit;
    survey.startNote = t0.startNote;
    survey.startLrud = t0.startLrud;
    return survey;
};

/** The trip record a shot belongs to (trip 0 when unset). */
CsModel.tripOf = function(survey, shot) {
    return survey.trips[shot.trip || 0];
};

/**
 * Finds tripRecord's trip index within survey, matching by
 * fingerprint (see tripFingerprint) so re-importing the same trip
 * twice reuses one slot instead of piling up duplicates. Appends
 * tripRecord itself when no existing trip matches. Always calls
 * ensureTrips first, so this is safe to call on a survey that has
 * never seen a trip before.
 */
CsModel.tripIdFor = function(survey, tripRecord) {
    CsModel.ensureTrips(survey);
    var fp = CsModel.tripFingerprint(tripRecord);
    for (var i = 0; i < survey.trips.length; i++) {
        if (CsModel.tripFingerprint(survey.trips[i]) === fp) {
            return i;
        }
    }
    survey.trips.push(tripRecord);
    return survey.trips.length - 1;
};

/**
 * The LRUD recorded for a station, taken from the last non-splay shot
 * arriving at it (LRUD belongs to the TO station). Returns
 * {left, right, up, down, azimuth} or null if the station has none.
 * A survey's very first station can only get LRUD from a shot LEAVING
 * it, which callers handle explicitly (see AzimuthTraverse).
 */
CsModel.lrudForStation = function(survey, stationName) {
    var found = null;
    for (var i = 0; i < survey.shots.length; i++) {
        var s = survey.shots[i];
        if (s.excludeFromAll || s.splay) {
            continue;
        }
        if (s.to === stationName &&
            (s.left !== null || s.right !== null || s.up !== null || s.down !== null)) {
            found = {
                left: s.left, right: s.right, up: s.up, down: s.down,
                leftAll: s.leftAll, rightAll: s.rightAll,
                upAll: s.upAll, downAll: s.downAll,
                azimuth: s.azimuth
            };
        }
    }
    return found;
};

/** Every distinct station name, in first-appearance order. */
CsModel.stationNames = function(survey) {
    var seen = {};
    var names = [];
    var add = function(n) {
        if (n !== "" && !seen.hasOwnProperty(n)) {
            seen[n] = true;
            names.push(n);
        }
    };
    for (var i = 0; i < survey.shots.length; i++) {
        var s = survey.shots[i];
        if (s.excludeFromAll) {
            continue;
        }
        add(s.from);
        if (!s.splay) {
            add(s.to);
        }
    }
    return names;
};

/**
 * Guesses the next station name from the previous one by incrementing
 * a trailing number ("A1" -> "A2", "A09" -> "A10", zero padding
 * preserved). "A1" from nothing; "<name>1" if there's no number.
 */
CsModel.nextStationName = function(prevName) {
    if (prevName === undefined || prevName === null || prevName === "") {
        return "A1";
    }
    var m = String(prevName).match(/^(.*?)(\d+)$/);
    if (m === null) {
        return prevName + "1";
    }
    var incremented = String(parseInt(m[2], 10) + 1);
    while (incremented.length < m[2].length) {
        incremented = "0" + incremented;
    }
    return m[1] + incremented;
};

/**
 * Parses one LRUD cell the way survey notes are written:
 *   "3.5"   one reading
 *   "P"     passage -- no wall that way; recorded as 0 by convention
 *   "5/10"  multiple readings (ledge + outer wall): ALL are drawn;
 *           the LARGEST is the primary value -- the outer wall is
 *           what wall runs, stats and native-format exports use
 *   ""      not measured
 *
 * \return { value: Number|null primary, all: [Number]|null every
 *          reading when more than one, raw: String as entered }
 */
CsModel.parseLrudEntry = function(text) {
    var raw = (text === undefined || text === null) ? "" :
        String(text).replace(/^\s+|\s+$/g, "");
    if (raw === "" || raw === "--") {
        return { value: null, all: null, raw: raw };
    }
    var parts = raw.split("/");
    var values = [];
    for (var i = 0; i < parts.length; i++) {
        var pTrim = parts[i].replace(/^\s+|\s+$/g, "");
        if (pTrim === "") {
            continue;
        }
        if (/^[Pp]$/.test(pTrim)) {
            values.push(0);
            continue;
        }
        var n = parseFloat(pTrim);
        if (!isNaN(n)) {
            values.push(n);
        }
    }
    if (values.length === 0) {
        return { value: null, all: null, raw: raw };
    }
    var primary = values[0];
    for (i = 1; i < values.length; i++) {
        if (values[i] > primary) {
            primary = values[i];
        }
    }
    return {
        value: primary,
        all: values.length > 1 ? values : null,
        raw: raw
    };
};

/** The cell text for a stored LRUD field ("5/10" round-trips). */
CsModel.lrudEntryText = function(value, all) {
    if (all !== null && all !== undefined && all.length > 1) {
        return all.join("/");
    }
    return (value === null || value === undefined) ? "" : String(value);
};

// ---------------------------------------------------------------------
// Text serialization -- turns Shot/startLrud fields into compact
// strings and back, so they can be carried as DXF XDATA tag values
// (one tag value per shot, one shot per drawn segment) without QCAD
// ever needing to know the survey model shape. Newline handling is
// deliberately NOT done here: a note's real newlines pass straight
// through these functions untouched, because the tag carrier (see
// CsTags.js) is the layer that escapes/unescapes them for storage in
// a single-line tag. Tabs are the field separator used here, so they
// ARE stripped from free text below.
// ---------------------------------------------------------------------

/**
 * The four exclusion/hold flags as a compact letter code -- the same
 * vocabulary Compass uses in "#|PCL#" flag blocks: P excludeFromPlot,
 * X excludeFromAll, L excludeFromLength, C noAdjust. Letter order is
 * fixed on write but parseFlags reads them in any order.
 */
CsModel.flagsText = function(shot) {
    return (shot.excludeFromPlot ? "P" : "") +
        (shot.excludeFromAll ? "X" : "") +
        (shot.excludeFromLength ? "L" : "") +
        (shot.noAdjust ? "C" : "");
};

/**
 * Reads a flagsText code back into shot's four booleans (order does
 * not matter, unknown letters are ignored, "" or null means all
 * false). Mutates shot in place and returns it, matching parseFlags'
 * cousins elsewhere in the Core (e.g. parseLrudEntry's callers).
 */
CsModel.parseFlags = function(text, shot) {
    var t = text || "";
    shot.excludeFromPlot = t.indexOf("P") >= 0;
    shot.excludeFromAll = t.indexOf("X") >= 0;
    shot.excludeFromLength = t.indexOf("L") >= 0;
    shot.noAdjust = t.indexOf("C") >= 0;
    return shot;
};

/**
 * One shot as a tab-separated row: from, to, distance, azimuth,
 * inclination, backAzimuth, backInclination, L, R, U, D, flags, note
 * -- in that fixed order. Numeric fields that are null (only the
 * backsight pair can be) write as "". LRUD fields go through the
 * existing lrudEntryText so "5/10" multi-readings keep round-tripping
 * the same way they do everywhere else in the Core. The note is
 * always the LAST field: any tab it happens to contain is flattened
 * to a space on the way out (tabs are the separator here), and
 * parseShotRow reads everything from field 12 onward back into it so
 * a note that somehow still contains a tab doesn't get truncated.
 */
CsModel.shotRowText = function(shot) {
    var numText = function(v) {
        return (v === null || v === undefined) ? "" : String(v);
    };
    var note = (shot.notes || "").replace(/\t/g, " ");
    return [
        shot.from,
        shot.to,
        numText(shot.distance),
        numText(shot.azimuth),
        numText(shot.inclination),
        numText(shot.backAzimuth),
        numText(shot.backInclination),
        CsModel.lrudEntryText(shot.left, shot.leftAll),
        CsModel.lrudEntryText(shot.right, shot.rightAll),
        CsModel.lrudEntryText(shot.up, shot.upAll),
        CsModel.lrudEntryText(shot.down, shot.downAll),
        CsModel.flagsText(shot),
        note
    ].join("\t");
};

/** The inverse of shotRowText -- see that function for the layout. */
CsModel.parseShotRow = function(text) {
    var f = (text || "").split("\t");
    var shot = CsModel.newShot();
    // Distance/azimuth/inclination are never null in the model (a
    // shot always has SOME geometry), so an empty or unparseable
    // field falls back to 0.0 rather than null; the backsight pair
    // genuinely can be absent, so theirs falls back to null.
    var num = function(v, fallback) {
        if (v === undefined || v === "") {
            return fallback;
        }
        var n = parseFloat(v);
        return isNaN(n) ? fallback : n;
    };
    shot.from = f[0] || "";
    shot.to = f[1] || "";
    shot.distance = num(f[2], 0.0);
    shot.azimuth = num(f[3], 0.0);
    shot.inclination = num(f[4], 0.0);
    shot.backAzimuth = num(f[5], null);
    shot.backInclination = num(f[6], null);
    var sides = [["left", 7], ["right", 8], ["up", 9], ["down", 10]];
    for (var i = 0; i < sides.length; i++) {
        var e = CsModel.parseLrudEntry(f[sides[i][1]] || "");
        shot[sides[i][0]] = e.value;
        shot[sides[i][0] + "All"] = e.all;
    }
    CsModel.parseFlags(f[11] || "", shot);
    shot.notes = f.slice(12).join("\t");
    return shot;
};

/**
 * A survey's or trip's startLrud as one comma-joined cell:
 * "L,R,U,D", each side through lrudEntryText so multi-readings keep
 * their "5/10" form, EXCEPT a null side writes "-" rather than ""
 * (an empty cell would be ambiguous with a merely-missing trailing
 * field on parse; "-" can't collide with a real reading because a
 * legitimate 0 always renders as the digit "0", never as "-"). A
 * null/undefined lrud -- no start station recorded at all -- writes
 * as "".
 */
CsModel.startLrudText = function(lrud) {
    if (lrud === null || lrud === undefined) {
        return "";
    }
    var side = function(value, all) {
        if (value === null || value === undefined) {
            return "-";
        }
        return CsModel.lrudEntryText(value, all);
    };
    return [
        side(lrud.left, lrud.leftAll),
        side(lrud.right, lrud.rightAll),
        side(lrud.up, lrud.upAll),
        side(lrud.down, lrud.downAll)
    ].join(",");
};

/** The inverse of startLrudText -- see that function for the layout. */
CsModel.parseStartLrud = function(text) {
    if (text === "" || text === null || text === undefined) {
        return null;
    }
    var f = text.split(",");
    var out = {
        left: null, right: null, up: null, down: null,
        leftAll: null, rightAll: null, upAll: null, downAll: null
    };
    var names = ["left", "right", "up", "down"];
    for (var i = 0; i < names.length; i++) {
        if (f[i] === undefined || f[i] === "-") {
            continue;
        }
        var e = CsModel.parseLrudEntry(f[i]);
        out[names[i]] = e.value;
        out[names[i] + "All"] = e.all;
    }
    return out;
};
