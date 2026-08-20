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
//                     (Compass #|P#)
//     excludeFromAll  boolean: ignore entirely (Compass #|X#)
//     notes           string
//   }
//
// LRUD nulls: parsers map "missing" markers (negative values in
// Compass, "--" in Walls, blank in CSV) to null, never to 0.

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
        notes: ""
    };
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
