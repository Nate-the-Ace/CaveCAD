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
// (added to bearings, recorded on the survey), the fixed column order
// FROM TO LENGTH BEARING INC LEFT UP DOWN RIGHT (fixed by the file
// format; the FORMAT header string only documents the original
// notebook order), negative LRUD as "not measured" (null, never 0),
// shot flags #|X# (exclude entirely) and #|P# (position but don't
// plot). Not supported: backsight columns (read past, unused), .MAK
// projects, multi-file projects.
//
// Compass stores decimal feet ALWAYS, whatever the notebook used.

var CsFormatCompass = {};

/** Parses .dat content into a CsModel survey. */
CsFormatCompass.parse = function(content) {
    var survey = CsModel.newSurvey();
    survey.distanceUnit = "ft";

    var blocks = content.split(/\f/);
    var firstHeader = true;

    for (var b = 0; b < blocks.length; b++) {
        var block = blocks[b];
        if (block.replace(/\s/g, "").length === 0) {
            continue;
        }

        var declMatch = block.match(/DECLINATION:\s*(-?[0-9.]+)/i);
        var declination = declMatch ? parseFloat(declMatch[1]) : 0.0;

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
            var lrud = function(tok) {
                var v = parseFloat(tok);
                return (isNaN(v) || v < 0) ? null : v;
            };

            var remainder = tokens.slice(9).join(" ");
            var flagMatch = remainder.match(/#\|([A-Za-z]*)#/);
            var flags = flagMatch ? flagMatch[1].toUpperCase() : "";

            var shot = CsModel.newShot();
            shot.from = tokens[0];
            shot.to = tokens[1];
            shot.distance = length;
            shot.azimuth = CsAngles.normalizeAzimuth(bearing + declination);
            shot.inclination = inc;
            shot.left = lrud(tokens[5]);
            shot.up = lrud(tokens[6]);
            shot.down = lrud(tokens[7]);
            shot.right = lrud(tokens[8]);
            shot.excludeFromAll = flags.indexOf("X") >= 0;
            shot.excludeFromPlot = flags.indexOf("P") >= 0;
            survey.shots.push(shot);
        }
    }
    return survey;
};

/**
 * Writes a CsModel survey as a Compass .dat file (one survey block).
 * Distances are converted to feet, Compass's only storage unit, and
 * azimuths are written back as MAGNETIC by removing the declination
 * the model has applied -- with the declination declared in the
 * header, which is what Compass expects.
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
        "  FORMAT: DMMDLRUDLADN  CORRECTIONS: 0.00 0.00 0.00");
    out.push("");
    out.push("FROM         TO           LENGTH  BEARING      INC     LEFT       UP     DOWN    RIGHT");
    out.push("");

    for (var i = 0; i < survey.shots.length; i++) {
        var s = survey.shots[i];
        if (s.splay) {
            continue; // Compass has no splay concept in this scope
        }
        var magnetic = CsAngles.normalizeAzimuth(
            s.azimuth - (survey.declination || 0));
        var lr = function(v) {
            return v === null || v === undefined ? -9.90 : toFt(v);
        };
        var flags = "";
        if (s.excludeFromAll) {
            flags = " #|X#";
        } else if (s.excludeFromPlot) {
            flags = " #|P#";
        }
        out.push(pad(s.from, 12) + " " + pad(s.to, 12) +
            num(toFt(s.distance), 7) + " " + num(magnetic, 8) + " " +
            num(s.inclination, 8) + " " + num(lr(s.left), 8) + " " +
            num(lr(s.up), 8) + " " + num(lr(s.down), 8) + " " +
            num(lr(s.right), 8) + flags +
            (s.notes ? "  " + s.notes : ""));
    }
    out.push("\f");
    return out.join("\r\n");
};
