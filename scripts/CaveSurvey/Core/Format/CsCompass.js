// Compass.js -- Compass .dat reader and writer.
//
// Part of the Cave Survey Core library: pure functions producing and
// consuming the CsModel survey shape.
//
// SCOPE -- the common, everyday core of the format, not the full
// specification. A format detail read wrong doesn't throw; it draws a
// plausible but WRONG map, so sanity-check the first import of any new
// file against a known plot.
//
// Supported: multiple surveys per file (\f separated), DECLINATION
// ("This number is added to the azimuth of each shot", east positive),
// the fixed data column order FROM TO LENGTH BEARING INC LEFT UP DOWN
// RIGHT [AZM2 INC2] [flags] [comment] (fixed by the file format; the
// FORMAT header's unit/order characters only document the original
// notebook -- but its trailing B and F/T characters are real: B
// declares the redundant-backsight columns, F/T the LRUD station
// association), negative LRUD as "not measured" (null, never 0),
// backsight columns Azm2/Inc2 ("always stored uncorrected", -999 =
// missing), shot flags #|X#, #|P#, #|L#, #|C#, #|S# (splay), and the
// trailing comment (legal with or without a flags field).
// Not supported: .MAK projects, multi-file projects, CORRECTIONS/
// CORRECTIONS2 instrument corrections (read past, virtually always 0).
//
// LRUD association: Compass' de-facto default is the FROM station, so
// a line's reading is attached to the shot ARRIVING at its FROM
// station, and the first station's reading lands in survey.startLrud.
// FORMAT ...T declares TO-station readings, which map straight onto
// the model's shots. Zero-length shots (the documented way to carry a
// leaf station's LRUD) are folded into the station reading instead of
// becoming shots.
//
// Compass stores decimal feet ALWAYS, whatever the notebook used.

var CsFormatCompass = {};

/** -999 marks a missing bearing/inclination in backsight columns. */
CsFormatCompass.isMissingReading = function(v) {
    return v === null || isNaN(v) || v <= -900;
};

CsFormatCompass.parse = function(content) {
    var survey = CsModel.newSurvey();
    survey.distanceUnit = "ft";

    var blocks = content.split(/\f/);
    var firstHeader = true;

    // raw shot records, station reference counts, per-station LRUD
    var raws = [];
    var stationRefs = {};
    var stationLrud = {};

    for (var b = 0; b < blocks.length; b++) {
        var block = blocks[b];
        if (block.replace(/\s/g, "").length === 0) {
            continue;
        }

        var declMatch = block.match(/DECLINATION:\s*(-?[0-9.]+)/i);
        var declination = declMatch ? parseFloat(declMatch[1]) : 0.0;

        var formatMatch = block.match(/FORMAT:\s*([A-Za-z]+)/);
        var formatStr = formatMatch ? formatMatch[1] : "";
        var lastChar = formatStr.charAt(formatStr.length - 1).toUpperCase();
        // de-facto default is From when the FORMAT doesn't say
        var lrudAssoc = (lastChar === "T") ? "T" : "F";
        var formatHasBacksights = /B/.test(formatStr.substring(8));

        var lines = block.split(/\r\n|\r|\n/);

        if (firstHeader) {
            firstHeader = false;
            // Line 1 is the cave name; SURVEY NAME / DATE / TEAM follow.
            if (lines.length > 0) {
                survey.name = lines[0].replace(/^\s+|\s+$/g, "");
            }
            var dateMatch = block.match(/SURVEY DATE:\s*(\d+)\s+(\d+)\s+(\d+)/i);
            if (dateMatch !== null) {
                var mo = parseInt(dateMatch[1], 10);
                var da = parseInt(dateMatch[2], 10);
                var yr = parseInt(dateMatch[3], 10);
                if (yr < 100) {
                    yr += (yr > 50) ? 1900 : 2000;
                }
                survey.date = yr + "-" + (mo < 10 ? "0" : "") + mo + "-" +
                    (da < 10 ? "0" : "") + da;
            }
            var teamIdx = -1;
            for (var ti = 0; ti < lines.length; ti++) {
                if (/SURVEY TEAM:/i.test(lines[ti])) {
                    teamIdx = ti;
                    break;
                }
            }
            if (teamIdx >= 0 && teamIdx + 1 < lines.length) {
                survey.team = lines[teamIdx + 1].replace(/^\s+|\s+$/g, "");
            }
            survey.declination = declination;
            survey.declinationSource = declMatch ? "file" : "";
        }

        // Header lines can look numeric ("SURVEY DATE: 7 10 2024"), so
        // only lines after the DECLINATION marker are shot candidates.
        var declLineIdx = -1;
        for (var dli = 0; dli < lines.length; dli++) {
            if (/DECLINATION:/i.test(lines[dli])) {
                declLineIdx = dli;
                break;
            }
        }
        var scanStart = (declLineIdx >= 0) ? declLineIdx + 1 : 0;

        for (var li = scanStart; li < lines.length; li++) {
            var line = lines[li].replace(/^\s+|\s+$/g, "");
            if (line.length === 0) {
                continue;
            }
            var tokens = line.split(/\s+/);
            if (tokens.length < 9) {
                continue;
            }
            var length = parseFloat(tokens[2]);
            var bearing = parseFloat(tokens[3]);
            var inc = parseFloat(tokens[4]);
            if (isNaN(length) || isNaN(bearing) || isNaN(inc)) {
                continue; // header / column-title line
            }

            // negative LRUD = not measured -> null
            var lrudNum = function(tok) {
                var v = parseFloat(tok);
                return (isNaN(v) || v < 0) ? null : v;
            };

            // optional backsight columns follow the LRUDs: declared by
            // FORMAT ...B, or detected structurally (the spec's own
            // sample declares N yet carries the columns)
            var next = 9;
            var backAz = null, backInc = null;
            var t9 = tokens.length > 10 ? parseFloat(tokens[9]) : NaN;
            var t10 = tokens.length > 10 ? parseFloat(tokens[10]) : NaN;
            var haveBackCols = formatHasBacksights ||
                (!isNaN(t9) && !isNaN(t10) && isFinite(t9) && isFinite(t10));
            if (haveBackCols && tokens.length > 10 && !isNaN(t9) && !isNaN(t10)) {
                backAz = CsFormatCompass.isMissingReading(t9) ? null : t9;
                backInc = CsFormatCompass.isMissingReading(t10) ? null : t10;
                next = 11;
            }

            // flags field, then the comment (legal without flags too)
            var remainder = tokens.slice(next).join(" ");
            var flagMatch = remainder.match(/#\|([A-Za-z]*)#\s*/);
            var flags = "";
            var comment = remainder;
            if (flagMatch !== null) {
                flags = flagMatch[1].toUpperCase();
                comment = remainder.substring(
                    remainder.indexOf(flagMatch[0]) + flagMatch[0].length);
            }
            comment = comment.replace(/^\s+|\s+$/g, "");

            var raw = {
                from: tokens[0],
                to: tokens[1],
                distance: length,
                azimuth: CsAngles.normalizeAzimuth(bearing + declination),
                inclination: inc,
                backAzimuth: backAz === null ? null :
                    CsAngles.normalizeAzimuth(backAz + declination),
                backInclination: backInc,
                lrud: {
                    left: lrudNum(tokens[5]),
                    up: lrudNum(tokens[6]),
                    down: lrudNum(tokens[7]),
                    right: lrudNum(tokens[8])
                },
                flags: flags,
                notes: comment,
                lrudAssoc: lrudAssoc
            };
            raws.push(raw);
            stationRefs[raw.from] = (stationRefs[raw.from] || 0) + 1;
            stationRefs[raw.to] = (stationRefs[raw.to] || 0) + 1;
        }
    }

    // Build shots. Zero-length lines whose TO station exists nowhere
    // else and that carry an LRUD are pure LRUD carriers, not shots.
    for (var ri = 0; ri < raws.length; ri++) {
        var r = raws[ri];
        var hasLrud = (r.lrud.left !== null || r.lrud.right !== null ||
            r.lrud.up !== null || r.lrud.down !== null);
        var isCarrier = (r.distance === 0.0 && hasLrud &&
            stationRefs[r.to] === 1 && r.flags.indexOf("S") < 0);
        if (r.lrudAssoc === "F" && hasLrud) {
            stationLrud[r.from] = r.lrud; // last reading wins
        }
        if (isCarrier) {
            continue;
        }

        var shot = CsModel.newShot();
        shot.from = r.from;
        shot.splay = r.flags.indexOf("S") >= 0;
        shot.to = shot.splay ? "" : r.to;
        shot.distance = r.distance;
        shot.azimuth = r.azimuth;
        shot.inclination = r.inclination;
        shot.backAzimuth = r.backAzimuth;
        shot.backInclination = r.backInclination;
        if (r.lrudAssoc === "T" && !shot.splay) {
            shot.left = r.lrud.left;
            shot.up = r.lrud.up;
            shot.down = r.lrud.down;
            shot.right = r.lrud.right;
        }
        shot.excludeFromAll = r.flags.indexOf("X") >= 0;
        shot.excludeFromPlot = r.flags.indexOf("P") >= 0;
        shot.excludeFromLength = r.flags.indexOf("L") >= 0;
        shot.noAdjust = r.flags.indexOf("C") >= 0;
        shot.notes = r.notes;
        survey.shots.push(shot);
    }

    // From-station readings: attach to the shot arriving at the
    // station; the very first station's reading is startLrud.
    for (var si = 0; si < survey.shots.length; si++) {
        var s2 = survey.shots[si];
        if (!s2.splay && s2.left === null && s2.right === null &&
            s2.up === null && s2.down === null &&
            stationLrud.hasOwnProperty(s2.to)) {
            var sl = stationLrud[s2.to];
            s2.left = sl.left;
            s2.up = sl.up;
            s2.down = sl.down;
            s2.right = sl.right;
        }
    }
    if (survey.shots.length > 0 &&
        stationLrud.hasOwnProperty(survey.shots[0].from)) {
        var slF = stationLrud[survey.shots[0].from];
        survey.startLrud = { left: slF.left, right: slF.right,
            up: slF.up, down: slF.down };
    }

    return survey;
};

/**
 * Writes a CsModel survey as a Compass .dat file (one survey block).
 * Distances are converted to feet, Compass's only storage unit, and
 * azimuths are written back as MAGNETIC by removing the declination
 * the model has applied -- with the declination declared in the
 * header, which is what Compass expects. Backsight columns (Azm2/
 * Inc2, uncorrected, -999 when missing) appear when any shot carries
 * a backsight, declared by FORMAT ...B.
 *
 * LRUDs are written in Compass' native FROM-station association
 * (FORMAT ...F): each line carries the reading of its FROM station,
 * the first line the startLrud, and a leaf station's reading rides a
 * zero-length carrier shot (the documented Compass idiom), which the
 * parser folds back into the station.
 */
CsFormatCompass.write = function(survey) {
    var toFt = function(v) {
        return CsUnits.convert(v, survey.distanceUnit, "ft");
    };
    var num = function(v, width) {
        var s = v.toFixed(2);
        while (s.length < width) {
            s = " " + s;
        }
        return s;
    };
    var pad = function(s, width) {
        s = String(s);
        while (s.length < width) {
            s = s + " ";
        }
        return s;
    };

    var i, s;
    var anyBack = false;
    for (i = 0; i < survey.shots.length; i++) {
        s = survey.shots[i];
        if ((s.backAzimuth !== null && s.backAzimuth !== undefined) ||
            (s.backInclination !== null && s.backInclination !== undefined)) {
            anyBack = true;
            break;
        }
    }

    var dateParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(survey.date || "");
    var dateLine = dateParts ?
        (parseInt(dateParts[2], 10) + " " + parseInt(dateParts[3], 10) + " " +
            dateParts[1]) : "1 1 1900";

    var out = [];
    out.push(survey.name || "CAVE");
    out.push("SURVEY NAME: " + (survey.name || "1"));
    out.push("SURVEY DATE: " + dateLine + "  COMMENT:");
    out.push("SURVEY TEAM:");
    out.push(survey.team || "");
    out.push("DECLINATION: " + (survey.declination || 0).toFixed(2) +
        "  FORMAT: DDDDLRUD" + (anyBack ? "LADadB" : "LADN") + "F" +
        "  CORRECTIONS: 0.00 0.00 0.00");
    out.push("");
    out.push("FROM         TO           LENGTH  BEARING      INC     LEFT       UP     DOWN    RIGHT" +
        (anyBack ? "     AZM2     INC2" : ""));
    out.push("");

    // FROM-station readings: first station <- startLrud, station X <-
    // the model's reading at X (LRUD lives on the shot arriving at X)
    var stationLrud = {};
    if (survey.shots.length > 0 && survey.startLrud !== null &&
        survey.startLrud !== undefined) {
        stationLrud[survey.shots[0].from] = survey.startLrud;
    }
    for (i = 0; i < survey.shots.length; i++) {
        s = survey.shots[i];
        if (!s.splay && s.to !== "" &&
            (s.left !== null || s.right !== null ||
             s.up !== null || s.down !== null)) {
            stationLrud[s.to] = { left: s.left, right: s.right,
                up: s.up, down: s.down };
        }
    }
    var lrudEmitted = {};

    var decl = survey.declination || 0;
    var lr = function(v) {
        return v === null || v === undefined ? -9.90 : toFt(v);
    };
    var splaySeq = 0;

    var shotLine = function(from, to, distFt, magAz, inc, lrud,
                            backAz, backInc, flags, notes) {
        var lineOut = pad(from, 12) + " " + pad(to, 12) +
            num(distFt, 7) + " " + num(magAz, 8) + " " +
            num(inc, 8) + " " + num(lr(lrud.left), 8) + " " +
            num(lr(lrud.up), 8) + " " + num(lr(lrud.down), 8) + " " +
            num(lr(lrud.right), 8);
        if (anyBack) {
            lineOut += " " + num(backAz === null ? -999 : backAz, 8) +
                " " + num(backInc === null ? -999 : backInc, 8);
        }
        if (flags !== "") {
            lineOut += " #|" + flags + "#";
        }
        if (notes) {
            lineOut += " " + notes;
        }
        return lineOut;
    };

    for (i = 0; i < survey.shots.length; i++) {
        s = survey.shots[i];
        var magnetic = CsAngles.normalizeAzimuth(s.azimuth - decl);
        var backAz = (s.backAzimuth === null || s.backAzimuth === undefined) ?
            null : CsAngles.normalizeAzimuth(s.backAzimuth - decl);
        var backInc = (s.backInclination === null ||
            s.backInclination === undefined) ? null : s.backInclination;

        // flag letters, at most three (the field's cap)
        var flags = "";
        if (s.excludeFromAll) {
            flags += "X";
        }
        if (s.splay) {
            flags += "S";
        }
        if (s.excludeFromPlot) {
            flags += "P";
        }
        if (s.excludeFromLength) {
            flags += "L";
        }
        if (s.noAdjust) {
            flags += "C";
        }
        flags = flags.substring(0, 3);

        var fromLrud = stationLrud.hasOwnProperty(s.from) ?
            stationLrud[s.from] :
            { left: null, right: null, up: null, down: null };
        if (stationLrud.hasOwnProperty(s.from)) {
            lrudEmitted[s.from] = true;
        }
        var toName = s.to;
        if (s.splay && toName === "") {
            splaySeq++;
            toName = s.from + ".s" + splaySeq;
        }

        out.push(shotLine(s.from, toName, toFt(s.distance), magnetic,
            s.inclination, fromLrud, backAz, backInc, flags, s.notes));
    }

    // leaf stations still holding a reading: zero-length carriers
    for (var st in stationLrud) {
        if (stationLrud.hasOwnProperty(st) && !lrudEmitted[st]) {
            out.push(shotLine(st, st + "_L", 0.0, 0.0, 0.0,
                stationLrud[st], null, null, "", "LRUD carrier"));
        }
    }

    out.push("\f");
    return out.join("\r\n");
};
