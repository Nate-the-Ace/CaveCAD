// Therion.js -- Therion .th reader and writer.
//
// Part of the Cave Survey Core library: pure functions producing and
// consuming the CsModel survey shape.
//
// WHY THIS FORMAT AND NOT THREE. TopoDroid and PocketTopo are the two
// phones-in-the-cave tools a beginner is most likely to arrive with,
// and both export Therion -- TopoDroid writes .th natively and
// PocketTopo exports it directly. So one reader is the door for all
// three, and a native TopoDroid or PocketTopo reader would be a second
// dialect of the same data.
//
// SCOPE -- the common core, not the full specification (see
// Compass.js for why). Supported: survey/endsurvey nesting as name
// prefixes (joined with "." exactly as the Survex reader does),
// centreline/centerline blocks and their end forms, date (ranges keep
// the first), team with quoted names and role words, units length
// metres/feet/yards with an optional factor, units compass/clino
// degrees/grads/percent, declination (east-positive, ADDED -- the
// conventional sign, same as Survex's own declination command),
// data normal with declared field order including the length/bearing/
// gradient and ceiling/floor aliases and backcompass/backclino,
// data dimensions/topofil LRUD per station, plumbed legs (compass
// omitted "-", clino up/down/u/d/+v/-v/level), flags
// splay/duplicate/surface/approximate with "not", fix (standard
// errors read past), # comments, and backslash line continuation.
//
// Not supported, and SAID SO rather than passed over in silence
// (CsModel.addParseFinding, which every report already prints):
// input (a Therion project is routinely split across files, and a
// cave silently missing half its passages is the worst failure this
// reader could have), equate (station equivalence), and the diving /
// cartesian / cylpolar / nosurvey data styles. Also ignored, but
// harmlessly: scrap/endscrap and map/endmap drawing data, extend,
// station comments, mark, break, group, cs, sd, grade, calibrate.
//
// A .th2 file is Therion's DRAWING half and carries no centreline at
// all; it is not claimed by the registry.
//
// Therion's default length unit is metres, and its default data style
// inside a centreline is "normal from to length compass clino".
//
// STATION NAMES. Therion's own full name for station 1 of survey main
// is "1@main". This reader joins nested survey names with "." instead
// -- "inner.1" -- because the Survex reader already does, the two
// formats nest identically, and a station name that means one thing on
// import from one file and another from the next is a trap for every
// tool downstream. It also keeps "@" out of names bound for Compass
// and Walls, neither of which expects it.
//
// ONE DIVERGENCE from the Survex reader, deliberate: when a file has
// exactly ONE top-level survey block, that outermost name is NOT
// prefixed onto its stations. In Therion the outermost survey IS the
// cave, so the prefix is the same word on every station in the file --
// it distinguishes nothing, and these names are not an internal
// detail: CsDraw letters them onto the map, where "mainpassage.1"
// beside every station is noise a cartographer then has to work
// around. A file with SEVERAL top-level surveys keeps every prefix,
// because there the outermost name is the only thing telling "1" in
// one cave from "1" in the next. It also makes the round trip
// name-stable: the writer emits one survey block, and reading it back
// gives the names that went in.

var CsFormatTherion = {};

// field-name aliases (data normal / data dimensions)
CsFormatTherion.FIELD_ALIASES = {
    length: "tape", bearing: "compass", gradient: "clino",
    backlength: "backtape", backbearing: "backcompass",
    backgradient: "backclino",
    ceiling: "up", floor: "down"
};

// team role words -- everything from the first role onward is roles,
// the same rule the Survex reader keeps. Therion's role vocabulary is
// its own, so this is not shared with CsFormatSurvex.TEAM_ROLES.
CsFormatTherion.TEAM_ROLES = {
    tape: 1, length: 1, compass: 1, bearing: 1, clino: 1, gradient: 1,
    counter: 1, depth: 1, station: 1, position: 1, notes: 1,
    pictures: 1, pics: 1, insts: 1, instruments: 1, assistant: 1,
    altitude: 1, dimensions: 1, dog: 1, book: 1, explorer: 1,
    topofil: 1
};

/** Clino keyword -> degrees, or undefined when not a keyword. */
CsFormatTherion.clinoKeyword = function(text) {
    var t = String(text).toLowerCase();
    if (t === "up" || t === "u" || t === "+v" || t === "plumb") {
        return 90.0;
    }
    if (t === "down" || t === "d" || t === "-v") {
        return -90.0;
    }
    if (t === "level" || t === "h" || t === "horizontal") {
        return 0.0;
    }
    return undefined;
};

/**
 * Splits a line into tokens, keeping "quoted strings" and [bracket
 * groups] whole.
 *
 * Therion writes a team member as "Ann Bell" and a station comment the
 * same way, and wraps optional argument groups in square brackets. A
 * plain split on whitespace would turn one name into two tokens and
 * shift every role word along with it.
 */
CsFormatTherion.tokenize = function(line) {
    var tokens = [];
    var i = 0;
    var n = line.length;
    while (i < n) {
        var ch = line.charAt(i);
        if (/\s/.test(ch)) {
            i++;
            continue;
        }
        if (ch === "\"") {
            var endQuote = line.indexOf("\"", i + 1);
            if (endQuote === -1) {
                tokens.push(line.substring(i + 1));
                break;
            }
            tokens.push(line.substring(i + 1, endQuote));
            i = endQuote + 1;
            continue;
        }
        if (ch === "[") {
            var endBracket = line.indexOf("]", i + 1);
            if (endBracket === -1) {
                tokens.push(line.substring(i));
                break;
            }
            tokens.push(line.substring(i, endBracket + 1));
            i = endBracket + 1;
            continue;
        }
        var start = i;
        while (i < n && !/\s/.test(line.charAt(i))) {
            i++;
        }
        tokens.push(line.substring(start, i));
    }
    return tokens;
};

/**
 * Strips a # comment, respecting quotes.
 *
 * \return {text, comment}
 */
CsFormatTherion.splitComment = function(line) {
    var inQuote = false;
    for (var i = 0; i < line.length; i++) {
        var ch = line.charAt(i);
        if (ch === "\"") {
            inQuote = !inQuote;
        } else if (ch === "#" && !inQuote) {
            return {
                text: line.substring(0, i),
                comment: line.substring(i + 1).replace(/^\s+|\s+$/g, "")
            };
        }
    }
    return { text: line, comment: "" };
};

/**
 * Joins backslash-continued lines, carrying each logical line's own
 * trailing comment along with it.
 *
 * Done before parsing rather than inside the loop so that every
 * directive below sees one whole command, however the file wrapped it.
 */
CsFormatTherion.logicalLines = function(content) {
    var raw = content.split(/\r\n|\r|\n/);
    var out = [];
    var pending = null;
    for (var i = 0; i < raw.length; i++) {
        var split = CsFormatTherion.splitComment(raw[i]);
        var text = split.text.replace(/\s+$/g, "");
        var continues = /\\$/.test(text);
        if (continues) {
            text = text.substring(0, text.length - 1);
        }
        if (pending === null) {
            pending = { text: text, comment: split.comment };
        } else {
            pending.text += " " + text.replace(/^\s+/g, "");
            if (split.comment !== "") {
                pending.comment = pending.comment === "" ? split.comment :
                    pending.comment + " " + split.comment;
            }
        }
        if (!continues) {
            out.push({ text: pending.text.replace(/^\s+|\s+$/g, ""),
                comment: pending.comment });
            pending = null;
        }
    }
    if (pending !== null) {
        out.push({ text: pending.text.replace(/^\s+|\s+$/g, ""),
            comment: pending.comment });
    }
    return out;
};

/**
 * How many survey blocks the file opens at its top level.
 *
 * A pre-scan, because whether the outermost survey name belongs on a
 * station cannot be decided while reading the first one: it depends on
 * whether a second appears later (see the header's STATION NAMES
 * note). Counts blocks, not names, so a file that opens and closes two
 * caves answers 2 even though only one is ever open at a time.
 *
 * \param lines the output of CsFormatTherion.logicalLines.
 */
CsFormatTherion.topLevelSurveys = function(lines) {
    var depth = 0;
    var count = 0;
    var skip = 0;
    for (var i = 0; i < lines.length; i++) {
        var tokens = CsFormatTherion.tokenize(lines[i].text);
        if (tokens.length === 0) {
            continue;
        }
        var cmd = tokens[0].toLowerCase();
        if (skip > 0) {
            if (cmd === "scrap" || cmd === "map") {
                skip++;
            } else if (cmd === "endscrap" || cmd === "endmap") {
                skip--;
            }
            continue;
        }
        if (cmd === "scrap" || cmd === "map") {
            skip = 1;
        } else if (cmd === "survey") {
            if (depth === 0) {
                count++;
            }
            depth++;
        } else if (cmd === "endsurvey" && depth > 0) {
            depth--;
        }
    }
    return count;
};

CsFormatTherion.parse = function(content) {
    var survey = CsModel.newSurvey();
    var stationLrud = {};   // full station name -> {left,right,up,down}

    var lines = CsFormatTherion.logicalLines(content);
    var prefixStack = [];
    var lengthUnit = "m";
    var lengthScale = 1.0;
    var compassInGrads = false;
    var clinoUnit = "deg";   // "deg" | "grad" | "percent"
    var declination = 0.0;   // model frame: added to magnetic
    var flags = { splay: false, duplicate: false, surface: false,
        approximate: false };
    // Therion scopes survey settings to the block that set them, so
    // the reader restores them on endcentreline/endsurvey exactly as
    // the Survex reader restores flags on *end.
    var scopeStack = [];
    var inCentreline = false;
    var skipDepth = 0;       // inside scrap/map/other drawing data
    var teamDirty = false;
    // The running trip, kept here and not on survey.date/survey.team --
    // see the same note in CsSurvex.parse: ensureTrips mirrors trips[0]
    // onto those fields from inside tripIdFor, which turns them into a
    // trap for any reader using them as running state.
    var curDate = "";
    var curTeam = "";
    var reportedInput = false;
    var reportedEquate = false;
    var reportedStyle = {};
    survey.distanceUnit = null;

    var intoSurveyUnit = function(v) {
        if (survey.distanceUnit === null) {
            survey.distanceUnit = lengthUnit;
        }
        return CsUnits.convert(v * lengthScale, lengthUnit, survey.distanceUnit);
    };
    var compassToDegrees = function(v) {
        return compassInGrads ? CsAngles.gradsToDegrees(v) : v;
    };
    var clinoToDegrees = function(v) {
        if (clinoUnit === "grad") {
            return CsAngles.gradsToDegrees(v);
        }
        if (clinoUnit === "percent") {
            return Math.atan(v / 100.0) * 180.0 / Math.PI;
        }
        return v;
    };

    var dataStyle = "normal";
    var normalFields = ["from", "to", "tape", "compass", "clino"];
    var dimensionFields = ["station", "left", "right", "up", "down"];

    // See the header: the outermost survey name is dropped when it is
    // the file's only one, and kept when it is not.
    var dropOutermost = (CsFormatTherion.topLevelSurveys(lines) === 1);
    var fullName = function(name) {
        var parts = dropOutermost ? prefixStack.slice(1) : prefixStack;
        if (parts.length === 0) {
            return name;
        }
        return parts.join(".") + "." + name;
    };
    var isAnonymous = function(name) {
        return name === "-" || name === "." || name === ".." || name === "...";
    };
    var pushScope = function() {
        scopeStack.push({
            lengthUnit: lengthUnit, lengthScale: lengthScale,
            compassInGrads: compassInGrads, clinoUnit: clinoUnit,
            declination: declination,
            flags: { splay: flags.splay, duplicate: flags.duplicate,
                surface: flags.surface, approximate: flags.approximate },
            dataStyle: dataStyle, normalFields: normalFields,
            dimensionFields: dimensionFields
        });
    };
    var popScope = function() {
        if (scopeStack.length === 0) {
            return;
        }
        var s = scopeStack.pop();
        lengthUnit = s.lengthUnit;
        lengthScale = s.lengthScale;
        compassInGrads = s.compassInGrads;
        clinoUnit = s.clinoUnit;
        declination = s.declination;
        flags = s.flags;
        dataStyle = s.dataStyle;
        normalFields = s.normalFields;
        dimensionFields = s.dimensionFields;
    };

    for (var li = 0; li < lines.length; li++) {
        var line = lines[li].text;
        var notes = lines[li].comment;
        if (line.length === 0) {
            continue;
        }

        var tokens = CsFormatTherion.tokenize(line);
        if (tokens.length === 0) {
            continue;
        }
        var cmd = tokens[0].toLowerCase();

        // ---- drawing data: skipped whole ------------------------------
        // A scrap holds line/point/area records whose first two tokens
        // look enough like a station pair to be read as shots. Nothing
        // inside one is survey data.
        if (skipDepth > 0) {
            if (cmd === "scrap" || cmd === "map") {
                skipDepth++;
            } else if (cmd === "endscrap" || cmd === "endmap") {
                skipDepth--;
            }
            continue;
        }
        if (cmd === "scrap" || cmd === "map") {
            skipDepth = 1;
            continue;
        }

        // ---- blocks ----------------------------------------------------
        if (cmd === "survey") {
            prefixStack.push(tokens.length > 1 ? tokens[1] : ("anon" + li));
            pushScope();
            if (survey.name === "" && tokens.length > 1) {
                survey.name = tokens[1];
            }
            if (survey.caveName === "") {
                var titleAt = -1;
                for (var ti = 1; ti < tokens.length; ti++) {
                    if (tokens[ti].toLowerCase() === "-title") {
                        titleAt = ti + 1;
                    }
                }
                if (titleAt > 0 && titleAt < tokens.length) {
                    survey.caveName = tokens[titleAt];
                }
            }
            continue;
        }
        if (cmd === "endsurvey") {
            prefixStack.pop();
            popScope();
            continue;
        }
        if (cmd === "centreline" || cmd === "centerline") {
            inCentreline = true;
            pushScope();
            continue;
        }
        if (cmd === "endcentreline" || cmd === "endcenterline") {
            inCentreline = false;
            popScope();
            continue;
        }

        // Everything below is survey data, and only a centreline holds
        // any. A .th's top level is otherwise declarations and drawing.
        if (!inCentreline) {
            if (cmd === "input" && !reportedInput) {
                reportedInput = true;
                CsModel.addParseFinding(survey, "warning", "therion-input",
                    "This file pulls in other files with \"input\", which " +
                    "this reader does not follow -- only the passages " +
                    "written in this file were imported.");
            }
            continue;
        }

        if (cmd === "date" && tokens.length > 1) {
            // Same trip-boundary heuristic, and the same known gap, as
            // the Survex reader's *date: a date seen after a leg has
            // been recorded starts a new trip, so the running team is
            // cleared rather than appended to.
            if (teamDirty) {
                curTeam = "";
                survey.team = "";
                teamDirty = false;
            }
            // "2026.08.29", "2026.08.29-2026.08.30", "2026.08.29@10:30":
            // keep the first date, drop any time of day.
            var dtok = tokens[1];
            var dm = /^(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/.exec(dtok);
            if (dm !== null) {
                curDate = dm[1] + "-" +
                    (dm[2].length < 2 ? "0" : "") + dm[2] + "-" +
                    (dm[3].length < 2 ? "0" : "") + dm[3];
            } else {
                curDate = dtok.replace(/\./g, "-");
            }
            survey.date = curDate;
            continue;
        }
        if ((cmd === "team" || cmd === "explo-team") && tokens.length > 1) {
            // Only the surveying team goes in the trip record:
            // explo-team is who found the cave, not who read the
            // instruments, and merging the two misreports both.
            if (cmd === "explo-team") {
                continue;
            }
            var member = "";
            // tokenize() already unwrapped "Ann Bell" into one token,
            // so a quoted name is tokens[1] whole; an unquoted one runs
            // until the first role word.
            if (/\s/.test(tokens[1])) {
                member = tokens[1];
            } else {
                for (var mi = 1; mi < tokens.length; mi++) {
                    if (CsFormatTherion.TEAM_ROLES
                            .hasOwnProperty(tokens[mi].toLowerCase())) {
                        break;
                    }
                    member += (member === "" ? "" : " ") + tokens[mi];
                }
            }
            if (member !== "") {
                curTeam = curTeam === "" ? member : curTeam + ", " + member;
                survey.team = curTeam;
            }
            continue;
        }
        if (cmd === "units" && tokens.length > 2) {
            var unitWord = tokens[tokens.length - 1].toLowerCase();
            var factor = 1.0;
            var qtyEnd = tokens.length - 1;
            if (qtyEnd > 1 && !isNaN(parseFloat(tokens[qtyEnd - 1])) &&
                    isFinite(tokens[qtyEnd - 1])) {
                factor = parseFloat(tokens[qtyEnd - 1]);
                qtyEnd--;
            }
            var qtys = {};
            for (var qi = 1; qi < qtyEnd; qi++) {
                qtys[tokens[qi].toLowerCase()] = true;
            }
            if (qtys["length"] || qtys["tape"]) {
                if (unitWord.indexOf("feet") >= 0 || unitWord === "ft" ||
                        unitWord === "foot") {
                    lengthUnit = "ft";
                    lengthScale = factor;
                } else if (unitWord.indexOf("yard") >= 0) {
                    lengthUnit = "m";
                    lengthScale = 0.9144 * factor;
                } else {
                    lengthUnit = "m";
                    lengthScale = factor;
                }
            }
            if (qtys["compass"] || qtys["bearing"]) {
                compassInGrads = (unitWord.indexOf("grad") >= 0 ||
                    unitWord.indexOf("mil") >= 0);
            }
            if (qtys["clino"] || qtys["gradient"]) {
                if (unitWord.indexOf("grad") >= 0 ||
                        unitWord.indexOf("mil") >= 0) {
                    clinoUnit = "grad";
                } else if (unitWord.indexOf("percent") >= 0) {
                    clinoUnit = "percent";
                } else {
                    clinoUnit = "deg";
                }
            }
            continue;
        }
        if (cmd === "declination" && tokens.length > 1) {
            // Therion's sign is the conventional one: east-positive,
            // ADDED to the magnetic reading. (Survex's *calibrate
            // declination is the one that subtracts -- see CsSurvex.)
            var dv = parseFloat(tokens[1].replace(/^\[/, ""));
            if (!isNaN(dv)) {
                var dUnit = tokens.length > 2 ?
                    tokens[2].toLowerCase().replace(/\]$/, "") : "degrees";
                if (dUnit.indexOf("grad") >= 0 || dUnit.indexOf("mil") >= 0) {
                    dv = CsAngles.gradsToDegrees(dv);
                }
                declination = dv;
                survey.declination = dv;
                survey.declinationSource = "file";
            }
            continue;
        }
        if (cmd === "flags") {
            var negate = false;
            for (var fi = 1; fi < tokens.length; fi++) {
                var ftok = tokens[fi].toLowerCase();
                if (ftok === "not") {
                    negate = true;
                    continue;
                }
                if (flags.hasOwnProperty(ftok)) {
                    flags[ftok] = !negate;
                }
                negate = false;
            }
            continue;
        }
        if (cmd === "data" && tokens.length > 1) {
            var styleWord = tokens[1].toLowerCase();
            if (styleWord === "normal") {
                dataStyle = "normal";
                normalFields = [];
                for (var nf = 2; nf < tokens.length; nf++) {
                    var fword = tokens[nf].toLowerCase();
                    if (CsFormatTherion.FIELD_ALIASES.hasOwnProperty(fword)) {
                        fword = CsFormatTherion.FIELD_ALIASES[fword];
                    }
                    normalFields.push(fword);
                }
            } else if (styleWord === "dimensions" || styleWord === "topofil") {
                dataStyle = "dimensions";
                dimensionFields = [];
                for (var pf = 2; pf < tokens.length; pf++) {
                    var pword = tokens[pf].toLowerCase();
                    if (CsFormatTherion.FIELD_ALIASES.hasOwnProperty(pword)) {
                        pword = CsFormatTherion.FIELD_ALIASES[pword];
                    }
                    dimensionFields.push(pword);
                }
            } else {
                dataStyle = "other";
                if (!reportedStyle.hasOwnProperty(styleWord)) {
                    reportedStyle[styleWord] = true;
                    CsModel.addParseFinding(survey, "warning",
                        "therion-data-style",
                        "This file has a \"" + styleWord + "\" data " +
                        "section, which this reader does not understand -- " +
                        "those shots were skipped.");
                }
            }
            continue;
        }
        if (cmd === "fix" && tokens.length >= 4) {
            var fx = parseFloat(tokens[2]);
            var fy = parseFloat(tokens[3]);
            var fz = tokens.length >= 5 ? parseFloat(tokens[4]) : 0.0;
            if (!isNaN(fx) && !isNaN(fy)) {
                survey.fixed[fullName(tokens[1])] = {
                    x: intoSurveyUnit(fx),
                    y: intoSurveyUnit(fy),
                    z: isNaN(fz) ? 0.0 : intoSurveyUnit(fz)
                };
            }
            continue;
        }
        if (cmd === "equate") {
            if (!reportedEquate) {
                reportedEquate = true;
                CsModel.addParseFinding(survey, "warning", "therion-equate",
                    "This file joins stations with \"equate\", which this " +
                    "reader does not apply -- those stations stay separate, " +
                    "so loops through them will not close.");
            }
            continue;
        }
        // extend, station, mark, break, group, endgroup, cs, sd, grade,
        // calibrate, infer, copyright, instrument: no effect on the
        // shots this suite draws.
        if (/^(extend|station|mark|break|group|endgroup|cs|sd|grade|calibrate|infer|copyright|instrument|explo-date|declination-auto)$/
                .test(cmd)) {
            continue;
        }

        // ---- a data row ------------------------------------------------
        if (dataStyle === "normal") {
            var rec = {};
            for (var ni = 0; ni < normalFields.length && ni < tokens.length; ni++) {
                rec[normalFields[ni]] = tokens[ni];
            }
            if (!rec.hasOwnProperty("from") || !rec.hasOwnProperty("to") ||
                    !rec.hasOwnProperty("tape")) {
                continue;
            }
            var tape = parseFloat(rec.tape);
            if (isNaN(tape)) {
                continue; // a column-title line, or a directive not known here
            }

            // clino first: a plumbed leg legally omits the compass
            var clino = 0.0;
            var plumbed = false;
            if (rec.hasOwnProperty("clino")) {
                var kw = CsFormatTherion.clinoKeyword(rec.clino);
                if (kw !== undefined) {
                    clino = kw;
                    plumbed = (kw !== 0.0);
                } else {
                    var cv = parseFloat(rec.clino);
                    clino = isNaN(cv) ? 0.0 : clinoToDegrees(cv);
                    plumbed = (Math.abs(clino) >= 89.999);
                }
            }

            var compass = rec.hasOwnProperty("compass") ?
                parseFloat(rec.compass) : NaN;
            if (isNaN(compass)) {
                if (!plumbed) {
                    continue;
                }
                compass = 0.0;
            } else {
                compass = compassToDegrees(compass);
            }

            var shot = CsModel.newShot();
            var anonTo = isAnonymous(rec.to);
            shot.splay = anonTo || flags.splay;
            shot.from = fullName(rec.from);
            shot.to = anonTo ? "" : fullName(rec.to);
            shot.distance = intoSurveyUnit(tape);
            shot.azimuth = CsAngles.normalizeAzimuth(compass + declination);
            shot.declination = declination;
            shot.inclination = clino;
            shot.excludeFromLength = flags.duplicate || flags.surface;
            shot.excludeFromPlot = flags.surface;

            if (rec.hasOwnProperty("backcompass")) {
                var bc = parseFloat(rec.backcompass);
                if (!isNaN(bc)) {
                    shot.backAzimuth = CsAngles.normalizeAzimuth(
                        compassToDegrees(bc) + declination);
                }
            }
            if (rec.hasOwnProperty("backclino")) {
                var bkw = CsFormatTherion.clinoKeyword(rec.backclino);
                if (bkw !== undefined) {
                    shot.backInclination = bkw;
                } else {
                    var bcl = parseFloat(rec.backclino);
                    if (!isNaN(bcl)) {
                        shot.backInclination = clinoToDegrees(bcl);
                    }
                }
            }

            // LRUD carried on the leg itself, which is how TopoDroid
            // writes it. The model's convention is the same as
            // Therion's: the reading belongs to the TO station.
            var legNum = function(key) {
                if (!rec.hasOwnProperty(key)) {
                    return null;
                }
                if (rec[key] === "-" || rec[key] === ".") {
                    return null;
                }
                var v = parseFloat(rec[key]);
                return isNaN(v) ? null : intoSurveyUnit(v);
            };
            shot.left = legNum("left");
            shot.right = legNum("right");
            shot.up = legNum("up");
            shot.down = legNum("down");

            shot.notes = notes;

            var legTrip = CsModel.newTrip();
            legTrip.date = curDate;
            legTrip.team = curTeam;
            legTrip.declination = declination;
            shot.trip = CsModel.tripIdFor(survey, legTrip);
            teamDirty = true;

            survey.shots.push(shot);
        } else if (dataStyle === "dimensions") {
            var prec = {};
            for (var pi = 0; pi < dimensionFields.length && pi < tokens.length; pi++) {
                prec[dimensionFields[pi]] = tokens[pi];
            }
            if (!prec.hasOwnProperty("station")) {
                continue;
            }
            var num = function(v) {
                if (v === undefined || v === "-" || v === ".") {
                    return null;
                }
                var n = parseFloat(v);
                return isNaN(n) ? null : intoSurveyUnit(n);
            };
            // A dimensions row whose station column is a number is a
            // stray data line, not a station record.
            if (!isNaN(parseFloat(prec.station)) &&
                    isFinite(prec.station)) {
                continue;
            }
            stationLrud[fullName(prec.station)] = {
                left: num(prec.left), right: num(prec.right),
                up: num(prec.up), down: num(prec.down)
            };
        }
    }

    // Attach per-station LRUD, keyed by TO station -- a dimensions
    // block stores one reading per station, so two shots arriving at
    // one station share it. A reading already carried on the leg wins:
    // it is the more specific record.
    for (var si = 0; si < survey.shots.length; si++) {
        var s2 = survey.shots[si];
        if (s2.splay || !stationLrud.hasOwnProperty(s2.to)) {
            continue;
        }
        var pl = stationLrud[s2.to];
        if (s2.left === null) { s2.left = pl.left; }
        if (s2.right === null) { s2.right = pl.right; }
        if (s2.up === null) { s2.up = pl.up; }
        if (s2.down === null) { s2.down = pl.down; }
    }
    // The very first station has no arriving shot to carry its LRUD.
    if (survey.shots.length > 0 &&
            stationLrud.hasOwnProperty(survey.shots[0].from)) {
        var plFirst = stationLrud[survey.shots[0].from];
        survey.startLrud = {
            left: plFirst.left, right: plFirst.right,
            up: plFirst.up, down: plFirst.down
        };
        // trips[0] already exists (the first leg's tripIdFor built it),
        // so write the trip record directly -- see ensureTrips' WARNING.
        survey.trips[0].startLrud = survey.startLrud;
    }

    if (survey.distanceUnit === null) {
        survey.distanceUnit = lengthUnit;
    }
    CsModel.ensureTrips(survey);
    return survey;
};

/**
 * Writes a CsModel survey as a Therion .th file.
 *
 * One survey block wrapping one centreline, which is what a
 * single-cave export is. date and team are TRIP-level and are emitted
 * once per trip immediately before that trip's own legs, exactly as
 * the Survex writer does; declination follows the LEG, because it is
 * running state in Therion too and a leg records the value it was
 * computed with (CsModel.appliedDeclination). Bearings go back out as
 * the raw magnetic readings each leg was read as.
 *
 * LRUD rides on the leg rather than in a separate dimensions block:
 * Therion accepts it in the data line, it is how TopoDroid writes it,
 * and it keeps a reading with the shot it belongs to.
 *
 * Splays become anonymous "-" stations, which Therion accepts natively
 * (unlike Survex, which needs an alias for it).
 */
CsFormatTherion.write = function(survey) {
    CsModel.ensureTrips(survey);
    var out = [];

    var blockName = (survey.name || survey.caveName || "cave")
        .replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
    if (blockName === "") {
        blockName = "cave";
    }
    var title = survey.caveName || survey.name || "Cave survey";

    out.push("encoding utf-8");
    out.push("survey " + blockName + " -title \"" + title + "\"");
    out.push("");
    out.push("  centreline");
    if (survey.date) {
        out.push("    date " + survey.date.replace(/-/g, "."));
    }
    out.push("    units length " +
        (survey.distanceUnit === "ft" ? "feet" : "metres"));

    for (var fname in survey.fixed) {
        if (survey.fixed.hasOwnProperty(fname)) {
            var f = survey.fixed[fname];
            // See CsModel.fixedZ -- an absent elevation is not a zero
            // one, and therion's fix takes three coordinates or none.
            var fz = CsModel.fixedZ(f);
            if (fz === null) {
                out.push("    # " + ("elevation UNKNOWN for " + fname + " -- written as 0.00 to keep this file valid; it is NOT a surveyed datum"));
            }
            out.push("    fix " + fname + " " + f.x.toFixed(2) + " " +
                f.y.toFixed(2) + " " + (fz === null ? 0 : fz).toFixed(2));
        }
    }

    var i, s;
    var anyBack = false;
    var anyLrud = false;
    for (i = 0; i < survey.shots.length; i++) {
        s = survey.shots[i];
        if ((s.backAzimuth !== null && s.backAzimuth !== undefined) ||
                (s.backInclination !== null && s.backInclination !== undefined)) {
            anyBack = true;
        }
        if (s.left !== null || s.right !== null ||
                s.up !== null || s.down !== null) {
            anyLrud = true;
        }
    }

    var fields = ["from", "to", "length", "compass", "clino"];
    if (anyBack) {
        fields.push("backcompass", "backclino");
    }
    if (anyLrud) {
        fields.push("left", "right", "up", "down");
    }
    out.push("    data normal " + fields.join(" "));

    var fmt = function(v) {
        return (v === null || v === undefined) ? "-" : v.toFixed(2);
    };

    // Trips in the order their first leg appears, so the file reads in
    // survey order rather than trip-record order.
    // The trip whose header is currently in force. NOT a "have I
    // emitted this trip yet" set: this writer keeps the survey's own
    // shot order (which is the notebook's row order, and what
    // CsRevise sorts by), so a trip can be left and RETURNED TO -- as
    // PITFALL CAVE's MAIN TRUNK does, its last two legs sitting at the
    // end of the file. Emitting each trip's header only once left
    // those legs under whichever trip happened to be open, and they
    // read back on the wrong trip. Re-emitted on every change instead.
    // (CsFormatSurvex avoids this differently, by grouping shots into
    // per-trip blocks -- correct too, at the cost of the row order.)
    var lastTripIndex = -1;
    var emittedDecl = null;
    // Running flag state, emitted only where it CHANGES, the way a
    // Therion file is actually written.
    var flagState = { splay: false, duplicate: false, surface: false };

    for (i = 0; i < survey.shots.length; i++) {
        s = survey.shots[i];

        // A shot flagged "ignore entirely" (Compass #|X#) has no
        // Therion representation: the format's flags say how to TREAT a
        // leg, never that it is not one. Written as a comment, which is
        // what CsFormatSurvex does with it and for the same reason --
        // the alternative measured here (tools/format_fidelity.js) is
        // worse than losing it, because an excluded leg written as an
        // ordinary one comes back as REAL survey, adding a station the
        // surveyor had struck out and changing the shape of the cave.
        if (s.excludeFromAll) {
            out.push("    # excluded shot (no Therion equivalent): " +
                s.from + " " + (s.to === "" ? "-" : s.to) + " " +
                s.distance.toFixed(2) + " " + s.azimuth.toFixed(2) + " " +
                s.inclination.toFixed(2) +
                (s.notes ? "  " + s.notes : ""));
            continue;
        }

        var tripIndex = s.trip || 0;
        if (tripIndex !== lastTripIndex) {
            lastTripIndex = tripIndex;
            var trip = CsModel.tripOf(survey, s);
            if (trip !== null && trip !== undefined) {
                if (trip.date) {
                    out.push("    date " + trip.date.replace(/-/g, "."));
                }
                if (trip.team) {
                    var members = String(trip.team).split(/\s*,\s*/);
                    for (var mi = 0; mi < members.length; mi++) {
                        if (members[mi] !== "") {
                            out.push("    team \"" + members[mi] + "\"");
                        }
                    }
                }
            }
        }

        var applied = CsModel.appliedDeclination(s, CsModel.tripOf(survey, s));
        var decl = (applied === null || applied === undefined) ? 0.0 : applied;
        if (emittedDecl === null || Math.abs(decl - emittedDecl) > 1e-9) {
            out.push("    declination " + decl.toFixed(2) + " degrees");
            emittedDecl = decl;
        }

        // The magnetic reading this leg was actually read as: the
        // model's azimuth is TRUE, and Therion will re-apply the
        // declination above when it reads this file back.
        var magAz = CsAngles.normalizeAzimuth(s.azimuth - decl);

        // excludeFromPlot is Therion's "surface"; excludeFromLength on
        // its own is "duplicate". The reader sets BOTH for a surface
        // leg (a surface shot does not count toward length either), so
        // surface is tested first or every surface leg would go back out
        // as a duplicate.
        var want = { splay: !!s.splay,
            surface: !!s.excludeFromPlot,
            duplicate: !s.excludeFromPlot && !!s.excludeFromLength };
        var flagNames = ["splay", "duplicate", "surface"];
        for (var fx = 0; fx < flagNames.length; fx++) {
            var fn = flagNames[fx];
            if (want[fn] !== flagState[fn]) {
                out.push("    flags " + (want[fn] ? "" : "not ") + fn);
                flagState[fn] = want[fn];
            }
        }

        var toName = s.splay || s.to === "" ? "-" : s.to;
        var row = ["    " + s.from, toName, s.distance.toFixed(2),
            magAz.toFixed(2), s.inclination.toFixed(2)];
        if (anyBack) {
            row.push(s.backAzimuth === null || s.backAzimuth === undefined ?
                "-" : CsAngles.normalizeAzimuth(s.backAzimuth - decl).toFixed(2));
            row.push(s.backInclination === null ||
                s.backInclination === undefined ?
                "-" : s.backInclination.toFixed(2));
        }
        if (anyLrud) {
            row.push(fmt(s.left), fmt(s.right), fmt(s.up), fmt(s.down));
        }
        out.push(row.join(" ") + (s.notes ? " # " + s.notes : ""));
    }

    out.push("  endcentreline");
    out.push("");
    out.push("endsurvey");
    out.push("");
    return out.join("\n");
};
