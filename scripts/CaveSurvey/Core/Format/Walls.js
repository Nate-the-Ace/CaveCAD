// Walls.js -- Walls .srv reader and writer.
//
// Part of the Cave Survey Core library: pure functions producing and
// consuming the CsModel survey shape.
//
// SCOPE -- the common core, not the full specification (see
// Compass.js for why that matters). Supported: #Units (Feet/Meters,
// Order=, Decl=), a single current #Prefix (prepended "prefix:name"),
// #Fix (into survey.fixed), inline LRUD <L,R,U,D> with "--" as "not
// measured" (null), quadrant bearings (N30E), ; comments, splay shots
// (TO of "-") kept as splay-flagged shots. Not supported: nested
// #Prefix stacks, dive directives, LRUD generated from splays.
//
// Walls distances default to feet unless #Units says otherwise. The
// model keeps ONE distance unit for the whole survey: the unit in
// force at the first shot wins, and later #Units changes convert into
// it.

var CsFormatWalls = {};

CsFormatWalls.parse = function(content) {
    var survey = CsModel.newSurvey();
    var lines = content.split(/\r\n|\r|\n/);

    var order = ["D", "A", "V"];
    var unit = "ft";      // unit currently in force in the file
    var declination = 0.0;
    var prefix = "";
    survey.distanceUnit = null; // set by the first measured thing

    var intoSurveyUnit = function(v) {
        if (survey.distanceUnit === null) {
            survey.distanceUnit = unit;
        }
        return CsUnits.convert(v, unit, survey.distanceUnit);
    };

    var applyPrefix = function(name) {
        if (name === "-" || name === "") {
            return name;
        }
        if (prefix === "" || name.indexOf(":") >= 0) {
            return name;
        }
        return prefix + ":" + name;
    };

    for (var li = 0; li < lines.length; li++) {
        var line = lines[li].replace(/^\s+|\s+$/g, "");
        if (line.length === 0) {
            continue;
        }

        if (line.charAt(0) === "#") {
            var directiveTokens = line.split(/\s+/);
            var directive = directiveTokens[0].toLowerCase();

            if (directive === "#units") {
                for (var t = 1; t < directiveTokens.length; t++) {
                    var tok = directiveTokens[t];
                    if (/^feet$/i.test(tok)) {
                        unit = "ft";
                    } else if (/^meters$/i.test(tok) || /^metres$/i.test(tok)) {
                        unit = "m";
                    } else if (/^order=/i.test(tok)) {
                        order = tok.split("=")[1].toUpperCase().split("");
                    } else if (/^decl(ination)?=/i.test(tok)) {
                        declination = parseFloat(tok.split("=")[1]) || 0.0;
                        if (survey.declinationSource === "") {
                            survey.declination = declination;
                            survey.declinationSource = "file";
                        }
                    }
                }
            } else if (directive === "#prefix") {
                prefix = directiveTokens.length > 1 ? directiveTokens[1] : "";
            } else if (directive === "#fix") {
                if (directiveTokens.length >= 4) {
                    var fx = parseFloat(directiveTokens[2]);
                    var fy = parseFloat(directiveTokens[3]);
                    var fz = directiveTokens.length >= 5 ?
                        parseFloat(directiveTokens[4]) : 0.0;
                    if (!isNaN(fx) && !isNaN(fy)) {
                        survey.fixed[applyPrefix(directiveTokens[1])] = {
                            x: intoSurveyUnit(fx),
                            y: intoSurveyUnit(fy),
                            z: isNaN(fz) ? 0.0 : intoSurveyUnit(fz)
                        };
                    }
                }
            } else if (directive === "#date" && directiveTokens.length > 1) {
                survey.date = directiveTokens[1];
            }
            continue;
        }

        // LRUD block first (never legitimately contains ';'), then the
        // comment tail.
        var lrudMatch = line.match(/<([^>]*)>/);
        var lrud = { left: null, right: null, up: null, down: null };
        var workLine = line;
        if (lrudMatch !== null) {
            var parts = lrudMatch[1].split(",");
            var vals = [null, null, null, null];
            for (var p = 0; p < 4 && p < parts.length; p++) {
                var pv = parts[p].replace(/^\s+|\s+$/g, "");
                if (pv === "--" || pv === "") {
                    vals[p] = null;
                } else {
                    var pf = parseFloat(pv);
                    vals[p] = isNaN(pf) ? null : intoSurveyUnit(pf);
                }
            }
            lrud.left = vals[0];
            lrud.right = vals[1];
            lrud.up = vals[2];
            lrud.down = vals[3];
            workLine = workLine.replace(lrudMatch[0], " ");
        }
        var notes = "";
        var semiIdx = workLine.indexOf(";");
        if (semiIdx >= 0) {
            notes = workLine.substring(semiIdx + 1).replace(/^\s+|\s+$/g, "");
            workLine = workLine.substring(0, semiIdx);
        }

        var fields = workLine.replace(/^\s+|\s+$/g, "").split(/\s+/);
        if (fields.length < 2) {
            continue;
        }

        var shot = CsModel.newShot();
        shot.from = applyPrefix(fields[0]);
        shot.splay = (fields[1] === "-");
        shot.to = shot.splay ? "" : applyPrefix(fields[1]);
        shot.notes = notes;

        var measured = fields.slice(2);
        for (var oi = 0; oi < order.length && oi < measured.length; oi++) {
            var field = order[oi];
            if (field === "A") {
                var quad = CsAngles.parseQuadrant(measured[oi]);
                if (quad !== undefined) {
                    shot.azimuth = quad;
                    continue;
                }
            }
            var v = parseFloat(measured[oi]);
            if (isNaN(v)) {
                continue;
            }
            if (field === "D") {
                shot.distance = intoSurveyUnit(v);
            } else if (field === "A") {
                shot.azimuth = v;
            } else if (field === "V") {
                shot.inclination = v;
            }
        }
        shot.azimuth = CsAngles.normalizeAzimuth(shot.azimuth + declination);
        shot.left = lrud.left;
        shot.right = lrud.right;
        shot.up = lrud.up;
        shot.down = lrud.down;

        survey.shots.push(shot);
    }

    if (survey.distanceUnit === null) {
        survey.distanceUnit = unit;
    }
    return survey;
};

/** Writes a CsModel survey as a Walls .srv file. */
CsFormatWalls.write = function(survey) {
    var out = [];
    var unitWord = survey.distanceUnit === "m" ? "Meters" : "Feet";
    out.push("; " + (survey.name || "Cave survey"));
    if (survey.date) {
        out.push("#Date " + survey.date);
    }
    out.push("#Units " + unitWord + " Order=DAV" +
        (survey.declination ? " Decl=" + survey.declination.toFixed(2) : ""));

    for (var fname in survey.fixed) {
        if (survey.fixed.hasOwnProperty(fname)) {
            var f = survey.fixed[fname];
            out.push("#Fix " + fname + " " + f.x.toFixed(2) + " " +
                f.y.toFixed(2) + " " + (f.z || 0).toFixed(2));
        }
    }

    var fmt = function(v) {
        return v === null || v === undefined ? "--" : v.toFixed(2);
    };
    for (var i = 0; i < survey.shots.length; i++) {
        var s = survey.shots[i];
        // Walls files carry magnetic bearings when Decl= is declared;
        // the model's azimuths are true, so remove it again.
        var az = CsAngles.normalizeAzimuth(s.azimuth - (survey.declination || 0));
        var lineOut = s.from + "\t" + (s.splay ? "-" : s.to) + "\t" +
            s.distance.toFixed(2) + "\t" + az.toFixed(2) + "\t" +
            s.inclination.toFixed(2);
        if (s.left !== null || s.right !== null || s.up !== null || s.down !== null) {
            lineOut += "\t<" + fmt(s.left) + "," + fmt(s.right) + "," +
                fmt(s.up) + "," + fmt(s.down) + ">";
        }
        if (s.notes) {
            lineOut += "\t; " + s.notes;
        }
        out.push(lineOut);
    }
    return out.join("\n") + "\n";
};
