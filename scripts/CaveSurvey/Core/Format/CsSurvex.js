// Survex.js -- Survex .svx reader and writer.
//
// Part of the Cave Survey Core library: pure functions producing and
// consuming the CsModel survey shape.
//
// SCOPE -- the common core, not the full specification (see
// Compass.js for why). Supported: *begin/*end name prefixes (joined
// with "."), *data normal with declared field order (backsight fields
// read past, unused), *data passage (LRUD per STATION, Survex's own
// convention, matched to shots by TO name), *units length feet/metres
// and *units compass degrees/grads, *calibrate declination (applied
// like the other formats' declination), *fix, ; comments, splays via
// "-" or *flags splay. Not supported: *include, diving/cartesian/
// nosurvey styles, other *calibrate corrections.
//
// Survex default length unit is metres.

var CsFormatSurvex = {};

CsFormatSurvex.parse = function(content) {
    var survey = CsModel.newSurvey();
    var passageLrud = {}; // full station name -> {left,right,up,down}

    var lines = content.split(/\r\n|\r|\n/);
    var prefixStack = [];
    var lengthUnit = "m";
    var compassInGrads = false;
    var declination = 0.0;
    survey.distanceUnit = null;

    var intoSurveyUnit = function(v) {
        if (survey.distanceUnit === null) {
            survey.distanceUnit = lengthUnit;
        }
        return CsUnits.convert(v, lengthUnit, survey.distanceUnit);
    };

    var dataStyle = "normal"; // Survex's default before any *data
    var normalFields = ["from", "to", "tape", "compass", "clino"];
    var passageFields = ["station", "left", "right", "up", "down"];

    var fullName = function(name) {
        if (prefixStack.length === 0) {
            return name;
        }
        return prefixStack.join(".") + "." + name;
    };

    for (var li = 0; li < lines.length; li++) {
        var rawLine = lines[li];
        var semiIdx = rawLine.indexOf(";");
        var notes = semiIdx >= 0 ?
            rawLine.substring(semiIdx + 1).replace(/^\s+|\s+$/g, "") : "";
        var line = (semiIdx >= 0 ? rawLine.substring(0, semiIdx) : rawLine)
            .replace(/^\s+|\s+$/g, "");
        if (line.length === 0) {
            continue;
        }

        if (line.charAt(0) === "*") {
            var tokens = line.split(/\s+/);
            var cmd = tokens[0].toLowerCase();

            if (cmd === "*begin") {
                prefixStack.push(tokens.length > 1 ? tokens[1] : ("anon" + li));
                if (survey.name === "" && tokens.length > 1) {
                    survey.name = tokens[1];
                }
            } else if (cmd === "*end") {
                prefixStack.pop();
            } else if (cmd === "*date" && tokens.length > 1) {
                survey.date = tokens[1].replace(/\./g, "-");
            } else if (cmd === "*team" && tokens.length > 1) {
                var member = tokens.slice(1).join(" ").replace(/"/g, "");
                survey.team = survey.team === "" ?
                    member : survey.team + ", " + member;
            } else if (cmd === "*data") {
                if (tokens.length === 1) {
                    dataStyle = "normal";
                } else if (tokens[1].toLowerCase() === "normal") {
                    dataStyle = "normal";
                    normalFields = [];
                    for (var nf = 2; nf < tokens.length; nf++) {
                        normalFields.push(tokens[nf].toLowerCase());
                    }
                } else if (tokens[1].toLowerCase() === "passage") {
                    dataStyle = "passage";
                    passageFields = [];
                    for (var pf = 2; pf < tokens.length; pf++) {
                        passageFields.push(tokens[pf].toLowerCase());
                    }
                } else {
                    dataStyle = "other";
                }
            } else if (cmd === "*units") {
                if (tokens.length >= 3 && tokens[1].toLowerCase() === "length") {
                    var lu = tokens[2].toLowerCase();
                    lengthUnit = (lu.indexOf("feet") >= 0 || lu === "ft") ? "ft" : "m";
                }
                if (tokens.length >= 3 && tokens[1].toLowerCase() === "compass") {
                    var cu = tokens[2].toLowerCase();
                    compassInGrads = (cu.indexOf("grad") >= 0);
                }
            } else if (cmd === "*calibrate") {
                // *calibrate declination <x>: x is ADDED to compass
                // readings by Survex; carrying it through fixes the
                // "svx relying on it imports rotated" defect.
                if (tokens.length >= 3 &&
                    tokens[1].toLowerCase() === "declination") {
                    var dv = parseFloat(tokens[2]);
                    if (!isNaN(dv)) {
                        declination = dv;
                        survey.declination = dv;
                        survey.declinationSource = "file";
                    }
                }
            } else if (cmd === "*fix") {
                if (tokens.length >= 4) {
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
                }
            }
            // *equate, *export, *include, *entrance, *flags: ignored
            continue;
        }

        var fields = line.split(/\s+/);

        if (dataStyle === "normal") {
            var rec = {};
            for (var ni = 0; ni < normalFields.length && ni < fields.length; ni++) {
                rec[normalFields[ni]] = fields[ni];
            }
            if (!rec.hasOwnProperty("from") || !rec.hasOwnProperty("to") ||
                !rec.hasOwnProperty("tape") || !rec.hasOwnProperty("compass")) {
                continue;
            }
            var tape = parseFloat(rec.tape);
            var compass = parseFloat(rec.compass);
            var clino = rec.hasOwnProperty("clino") ? parseFloat(rec.clino) : 0.0;
            if (isNaN(tape) || isNaN(compass)) {
                continue; // OMIT ("-") or malformed
            }
            if (isNaN(clino)) {
                clino = 0.0;
            }
            if (compassInGrads) {
                compass = CsAngles.gradsToDegrees(compass);
            }

            var shot = CsModel.newShot();
            shot.splay = (rec.to === "-" || rec.to === "..");
            shot.from = fullName(rec.from);
            shot.to = shot.splay ? "" : fullName(rec.to);
            shot.distance = intoSurveyUnit(tape);
            shot.azimuth = CsAngles.normalizeAzimuth(compass + declination);
            shot.inclination = clino;
            shot.notes = notes;
            survey.shots.push(shot);
        } else if (dataStyle === "passage") {
            var prec = {};
            for (var pi = 0; pi < passageFields.length && pi < fields.length; pi++) {
                prec[passageFields[pi]] = fields[pi];
            }
            if (!prec.hasOwnProperty("station")) {
                continue;
            }
            var num = function(v) {
                if (v === undefined || v === "-") {
                    return null;
                }
                var n = parseFloat(v);
                return isNaN(n) ? null : intoSurveyUnit(n);
            };
            passageLrud[fullName(prec.station)] = {
                left: num(prec.left),
                right: num(prec.right),
                up: num(prec.up),
                down: num(prec.down)
            };
        }
    }

    // Attach passage LRUD, keyed by TO station -- Survex stores LRUD
    // per station, so two shots ending at one station share a reading.
    for (var si = 0; si < survey.shots.length; si++) {
        var s2 = survey.shots[si];
        if (!s2.splay && passageLrud.hasOwnProperty(s2.to)) {
            var pl = passageLrud[s2.to];
            s2.left = pl.left;
            s2.right = pl.right;
            s2.up = pl.up;
            s2.down = pl.down;
        }
    }

    if (survey.distanceUnit === null) {
        survey.distanceUnit = lengthUnit;
    }
    return survey;
};

/**
 * Writes a CsModel survey as a Survex .svx file.
 *
 * Only emits a *begin block when every station already shares that
 * prefix, so plain names round-trip un-renamed. Passage LRUD is
 * per-station: when two shots into one station disagree, the last
 * non-null reading wins and a comment records the conflict.
 */
CsFormatSurvex.write = function(survey) {
    var out = [];
    out.push("; " + (survey.name || "Cave survey"));
    if (survey.date) {
        out.push("*date " + survey.date.replace(/-/g, "."));
    }
    if (survey.distanceUnit === "ft") {
        out.push("*units length feet");
    }
    if (survey.declination) {
        out.push("*calibrate declination " + survey.declination.toFixed(2));
    }

    for (var fname in survey.fixed) {
        if (survey.fixed.hasOwnProperty(fname)) {
            var f = survey.fixed[fname];
            out.push("*fix " + fname + " " + f.x.toFixed(2) + " " +
                f.y.toFixed(2) + " " + (f.z || 0).toFixed(2));
        }
    }

    out.push("*data normal from to tape compass clino");
    var i, s;
    for (i = 0; i < survey.shots.length; i++) {
        s = survey.shots[i];
        // Survex expects the raw compass reading when *calibrate
        // declination is declared; the model's azimuths are true.
        var az = CsAngles.normalizeAzimuth(s.azimuth - (survey.declination || 0));
        out.push(s.from + "\t" + (s.splay ? "-" : s.to) + "\t" +
            s.distance.toFixed(2) + "\t" + az.toFixed(2) + "\t" +
            s.inclination.toFixed(2) + (s.notes ? "\t; " + s.notes : ""));
    }

    // passage LRUD, one record per TO station with any reading
    var lrudByStation = {};
    var lrudOrder = [];
    var conflicts = [];
    for (i = 0; i < survey.shots.length; i++) {
        s = survey.shots[i];
        if (s.splay ||
            (s.left === null && s.right === null && s.up === null && s.down === null)) {
            continue;
        }
        if (lrudByStation.hasOwnProperty(s.to)) {
            var prev = lrudByStation[s.to];
            if (prev.left !== s.left || prev.right !== s.right ||
                prev.up !== s.up || prev.down !== s.down) {
                conflicts.push(s.to);
            }
        } else {
            lrudOrder.push(s.to);
        }
        lrudByStation[s.to] = { left: s.left, right: s.right, up: s.up, down: s.down };
    }
    if (lrudOrder.length > 0) {
        out.push("*data passage station left right up down");
        var fmt = function(v) {
            return v === null || v === undefined ? "-" : v.toFixed(2);
        };
        for (i = 0; i < lrudOrder.length; i++) {
            var name = lrudOrder[i];
            var l = lrudByStation[name];
            var lineOut = name + "\t" + fmt(l.left) + "\t" + fmt(l.right) +
                "\t" + fmt(l.up) + "\t" + fmt(l.down);
            if (conflicts.indexOf(name) >= 0) {
                lineOut += "\t; two shots into " + name +
                    " disagreed; kept the later reading (Survex stores LRUD per station)";
            }
            out.push(lineOut);
        }
    }

    return out.join("\n") + "\n";
};
