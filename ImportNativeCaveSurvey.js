// ImportNativeCaveSurvey.js
//
// QCAD script tool: import a NATIVE Walls (.srv), Compass (.dat), or
// Survex (.svx) cave survey file and draw the resulting centerline +
// LRUD passage-width ticks automatically. Unlike the generic CSV
// importer, this reads each program's real file format directly --
// no manual re-formatting of your data required.
//
// ============================================================
// SCOPE -- read this before trusting the output on real data.
// ============================================================
// This implements the common, everyday-use core of each format.
// It does NOT implement the full specification of any of them.
// Getting a format detail wrong does not throw an error -- it
// silently draws a plausible-looking but WRONG map. Sanity-check
// the first import of any new file against a known plot.
//
// Compass (.dat) -- supported:
//   - Multiple surveys per file (separated by form-feed \f)
//   - DECLINATION (added to bearing)
//   - Fixed column order per the Compass spec: FROM TO LENGTH
//     BEARING INC LEFT UP DOWN RIGHT (this order is fixed by the
//     file format regardless of the FORMAT header string -- the
//     FORMAT string only documents the original notebook order)
//   - Negative LRUD values (missing measurement) treated as 0
//   - Shot flags: "#|X#" (exclude entirely) and "#|P#" (exclude
//     from plotting, but still used to position later stations)
//   NOT supported: redundant backsight columns (AZM2/INC2 -- read
//   past but unused), .MAK project files, multi-file projects.
//
// Walls (.srv) -- supported:
//   - #Units directives: Feet / Meters, Order=..., Decl=...
//   - #Prefix (single current prefix, prepended as "prefix:name")
//   - #Fix <station> <E> <N> <Up> (used only to anchor the very
//     first station if nothing is selected in the drawing)
//   - Inline LRUD as <L,R,U,D>, "--" = missing measurement -> 0
//   - ; comments (rest of line stripped)
//   - Splay shots (TO station given as "-") are skipped
//   NOT supported: nested/segmented #Prefix stacks, dive-specific
//   directives, LRUD generated from splays.
//
// Survex (.svx) -- supported:
//   - *begin / *end hierarchical station name prefixes (joined
//     with ".")
//   - *data normal <field order> (from/to/tape/compass/clino in
//     any declared order; backtape/backcompass/backclino read
//     past but unused)
//   - *data passage station left right up down -- LRUD recorded
//     SEPARATELY from the leg table (Survex's normal convention),
//     matched to stations by name once resolved
//   - *units length / *units compass (feet/metres, degrees/grads)
//   - *fix <station> <x> <y> <z> (same anchor role as Walls #Fix)
//   - ; comments
//   NOT supported: *include (multi-file projects -- import each
//   file separately), *data diving/cartesian/nosurvey styles,
//   *calibrate corrections.
//
// ============================================================
// USAGE
// ============================================================
//   OPTIONAL: select a single line/arc/polyline/point in the
//   drawing first -- the FIRST station named in the file will be
//   anchored to that entity's endpoint/position. Otherwise the
//   first station (or a #Fix / *fix point, if present and nothing
//   is selected) is used, defaulting to (0,0) if neither applies.
//
//   Misc > Development > Run Script...  -> select this file
//   1. Pick which format the file is: Walls, Compass, or Survex.
//   2. Pick the file.
//   3. Processed in one batch. A summary (stations plotted, shots
//      drawn, skipped shots, unresolved rows) is shown at the end.
//
// UNITS: set DRAWING_DISTANCE_UNIT below to "ft" or "m" to match
// YOUR QCAD drawing's units -- source values are converted to this
// unit. Compass data is always stored in decimal feet internally
// (per the Compass file format spec) regardless of what its FORMAT
// string says about the original notebook units.
//
// LAYERS: everything drawn is split across three layers (created if
// missing), matching AzimuthTraverse.js / ImportCaveSurveyCSV.js:
//   ALIGNMENT -- centerline shot lines only.
//   LRUD      -- LRUD tick lines and U/D text labels.
//   STATIONS  -- a POINT entity at every station (drawn even for
//                stations reached only via a no-plot-flagged shot),
//                plus a text label with its name and estimated
//                elevation. Station points carry the name as a
//                custom property ("CaveSurvey"/"Station") for future
//                table-building scripts, and can be selected before
//                re-running any of these tools to continue a survey
//                from that exact station.

include("scripts/simple.js");

var ALIGNMENT_LAYER = "ALIGNMENT";
var LRUD_LAYER = "LRUD";
var STATIONS_LAYER = "STATIONS";
var TEXT_HEIGHT = 0.5;
var DRAW_LRUD = true;
var DRAW_STATION_LABELS = true;
var DRAW_ELEVATION_LABELS = true;
var DRAWING_DISTANCE_UNIT = "ft"; // "ft" or "m" -- MUST match your QCAD drawing's units

var FEET_PER_METER = 3.280839895;

function toDrawingUnits(value, sourceUnit) {
    if (sourceUnit === DRAWING_DISTANCE_UNIT) {
        return value;
    }
    if (sourceUnit === "ft" && DRAWING_DISTANCE_UNIT === "m") {
        return value / FEET_PER_METER;
    }
    if (sourceUnit === "m" && DRAWING_DISTANCE_UNIT === "ft") {
        return value * FEET_PER_METER;
    }
    return value;
}

// ============================================================
// Shared drawing engine (same math/behavior as AzimuthTraverse.js
// and ImportCaveSurveyCSV.js)
// ============================================================

function ensureLayer(name, colorName) {
    if (!hasLayer(name)) {
        addLayer(name, colorName, "CONTINUOUS", RLineweight.Weight025);
    }
}

function ensureAllLayers() {
    ensureLayer(ALIGNMENT_LAYER, "white");
    ensureLayer(LRUD_LAYER, "yellow");
    ensureLayer(STATIONS_LAYER, "red");
}

function tagStationPoint(entity, name) {
    if (entity === undefined || entity === null) {
        return;
    }
    if (name === undefined || name === null || name === "") {
        return;
    }
    if (typeof entity.setCustomProperty === "function") {
        try {
            entity.setCustomProperty("CaveSurvey", "Station", name);
        } catch (e) {
            // custom properties not supported here -- ignore, non-critical
        }
    }
}

// Draws a station point + optional name/elevation label on STATIONS_LAYER.
function drawStationPoint(pos, name, z, azimuthDeg) {
    startTransaction(getDocument());
    setCurrentLayer(STATIONS_LAYER);
    var pt = addPoint(pos);
    tagStationPoint(pt, name);

    if (DRAW_STATION_LABELS && name !== undefined && name !== null && name !== "") {
        var stLabel = name;
        if (DRAW_ELEVATION_LABELS && z !== undefined && Math.abs(z) > 1e-6) {
            stLabel += " (Z" + (z >= 0 ? "+" : "") + z.toFixed(1) + ")";
        }
        var labelRad = (azimuthDeg === undefined) ?
            (Math.PI / 4.0) : ((azimuthDeg - 90.0) * (Math.PI / 180.0));
        var labelOffset = TEXT_HEIGHT * 1.5;
        var labelPos = new RVector(
            pos.x + labelOffset * Math.sin(labelRad),
            pos.y + labelOffset * Math.cos(labelRad)
        );
        addSimpleText(stLabel, labelPos, TEXT_HEIGHT, 0, "standard",
            RS.VAlignMiddle, RS.HAlignRight, false, false);
    }
    endTransaction();
}

function lrudTick(station, azimuthDeg, side, length) {
    if (!length) {
        return null;
    }
    var perpAzimuth = (side === "R") ? azimuthDeg + 90.0 : azimuthDeg - 90.0;
    var rad = perpAzimuth * (Math.PI / 180.0);
    var dx = length * Math.sin(rad);
    var dy = length * Math.cos(rad);
    return [station, new RVector(station.x + dx, station.y + dy)];
}

// Draws LRUD ticks + U/D text on LRUD_LAYER.
function drawLrud(toPos, azimuth, left, right, up, down) {
    startTransaction(getDocument());
    setCurrentLayer(LRUD_LAYER);
    var leftTick = lrudTick(toPos, azimuth, "L", left);
    if (leftTick !== null) {
        addLine(leftTick[0], leftTick[1]);
    }
    var rightTick = lrudTick(toPos, azimuth, "R", right);
    if (rightTick !== null) {
        addLine(rightTick[0], rightTick[1]);
    }
    if (up !== 0 || down !== 0) {
        var udText = "U" + up.toFixed(2) + " D" + down.toFixed(2);
        var noteRad = (azimuth + 90.0) * (Math.PI / 180.0);
        var noteOffset = TEXT_HEIGHT * 1.5;
        var notePos = new RVector(
            toPos.x + noteOffset * Math.sin(noteRad),
            toPos.y + noteOffset * Math.cos(noteRad)
        );
        addSimpleText(udText, notePos, TEXT_HEIGHT, 0, "standard",
            RS.VAlignMiddle, RS.HAlignLeft, false, false);
    }
    endTransaction();
}

function getStartPointFromSelection(doc) {
    if (!doc.hasSelection()) {
        return undefined;
    }
    var ids = doc.querySelectedEntities();
    if (ids.length !== 1) {
        return undefined;
    }
    var entity = doc.queryEntity(ids[0]);
    if (isNull(entity)) {
        return undefined;
    }
    if (typeof entity.getPosition === "function") {
        return entity.getPosition();
    }
    if (typeof entity.getStartPoint === "function" &&
        typeof entity.getEndPoint === "function") {
        var p1 = entity.getStartPoint();
        var p2 = entity.getEndPoint();
        var itemLabels = [
            "Point 1: (" + p1.x.toFixed(3) + ", " + p1.y.toFixed(3) + ")",
            "Point 2: (" + p2.x.toFixed(3) + ", " + p2.y.toFixed(3) + ")"
        ];
        var choice = getItem(
            "Import Cave Survey",
            "Anchor the first station to which endpoint of the selected entity?",
            itemLabels.join("|"), 0, "|"
        );
        if (choice === undefined) {
            return undefined;
        }
        return (choice.indexOf("Point 1") === 0) ? p1 : p2;
    }
    return undefined;
}

// shots: array of {from, to, distance, azimuth, inclination,
//   left, right, up, down, drawGeometry, includeInPositions}
// distance/left/right/up/down already converted to drawing units.
// fixedStations: optional {name: RVector} from #Fix / *fix.
function resolveAndDraw(doc, shots, fixedStations, formatLabel) {
    if (shots.length === 0) {
        QMessageBox.warning(getMainWindow(), "Import Cave Survey",
            "No shots were parsed from this file.");
        return;
    }

    var stations = {}; // name -> {pos: RVector, z: number}

    var anchor = getStartPointFromSelection(doc);
    var firstStationName = null;
    for (var fi = 0; fi < shots.length; fi++) {
        if (shots[fi].includeInPositions) {
            firstStationName = shots[fi].from;
            break;
        }
    }
    if (firstStationName === null) {
        firstStationName = shots[0].from;
    }

    if (anchor === undefined && fixedStations.hasOwnProperty(firstStationName)) {
        anchor = fixedStations[firstStationName];
    }
    if (anchor === undefined) {
        anchor = new RVector(0, 0);
    }
    stations[firstStationName] = { pos: anchor, z: 0.0 };

    ensureAllLayers();

    drawStationPoint(anchor, firstStationName, 0.0, undefined);

    var shotsDrawn = 0;
    var closuresDrawn = 0;
    var skippedShots = 0;

    for (var i = 0; i < shots.length; i++) {
        shots[i].resolved = false;
    }

    var progress = true;
    while (progress) {
        progress = false;
        for (var ri = 0; ri < shots.length; ri++) {
            var row = shots[ri];
            if (row.resolved) {
                continue;
            }
            if (!row.includeInPositions) {
                row.resolved = true;
                skippedShots += 1;
                progress = true;
                continue;
            }
            if (!stations.hasOwnProperty(row.from)) {
                continue;
            }

            var fromStation = stations[row.from];

            if (stations.hasOwnProperty(row.to)) {
                var toStationExisting = stations[row.to];
                if (row.drawGeometry) {
                    startTransaction(doc);
                    setCurrentLayer(ALIGNMENT_LAYER);
                    addLine(fromStation.pos, toStationExisting.pos);
                    endTransaction();
                    closuresDrawn += 1;
                }
                row.resolved = true;
                progress = true;
                continue;
            }

            var rad = row.azimuth * (Math.PI / 180.0);
            var dx = row.distance * Math.sin(rad);
            var dy = row.distance * Math.cos(rad);
            var toPos = new RVector(fromStation.pos.x + dx, fromStation.pos.y + dy);

            var incRad = row.inclination * (Math.PI / 180.0);
            var toZ = fromStation.z + row.distance * Math.tan(incRad);

            stations[row.to] = { pos: toPos, z: toZ };

            // The station itself gets a point regardless of whether the
            // connecting shot is flagged to skip drawing (e.g. Compass
            // "#|P#") -- the station still exists in the network.
            drawStationPoint(toPos, row.to, toZ, row.azimuth);

            if (row.drawGeometry) {
                startTransaction(doc);
                setCurrentLayer(ALIGNMENT_LAYER);
                addLine(fromStation.pos, toPos);
                endTransaction();
                shotsDrawn += 1;

                if (DRAW_LRUD) {
                    drawLrud(toPos, row.azimuth, row.left, row.right, row.up, row.down);
                }
            } else {
                skippedShots += 1;
            }

            row.resolved = true;
            progress = true;
        }
    }

    if (shotsDrawn > 0 || closuresDrawn > 0) {
        autoZoom();
    }

    var unresolved = [];
    for (var ui = 0; ui < shots.length; ui++) {
        if (!shots[ui].resolved) {
            unresolved.push(shots[ui].from + " -> " + shots[ui].to);
        }
    }

    var summary = "Format: " + formatLabel + "\n" +
        "Drawing units: " + DRAWING_DISTANCE_UNIT + "\n" +
        "Stations plotted: " + Object.keys(stations).length + "\n" +
        "Shots drawn: " + shotsDrawn + "\n" +
        "Closure/re-visit lines drawn: " + closuresDrawn + "\n" +
        "Shots skipped (splay/excluded/no-plot flags): " + skippedShots + "\n";

    if (unresolved.length > 0) {
        summary += "\nWARNING -- " + unresolved.length + " row(s) could not be resolved:\n" +
            unresolved.join("\n");
        QMessageBox.warning(getMainWindow(), "Import Cave Survey", summary);
    } else {
        QMessageBox.information(getMainWindow(), "Import Cave Survey", summary);
    }
}

function readWholeFile(fileName) {
    var file = new QFile(fileName);
    var openFlags = new QIODevice.OpenMode(QIODevice.ReadOnly | QIODevice.Text);
    if (!file.open(openFlags)) {
        return undefined;
    }
    var stream = new QTextStream(file);
    var content = stream.readAll();
    file.close();
    return content;
}

// ============================================================
// Compass (.dat) parser
// ============================================================

function parseCompassDat(content) {
    var shots = [];
    var blocks = content.split(/\f/);

    for (var b = 0; b < blocks.length; b++) {
        var block = blocks[b];
        if (block.trim().length === 0) {
            continue;
        }

        var declMatch = block.match(/DECLINATION:\s*(-?[0-9.]+)/i);
        var declination = declMatch ? parseFloat(declMatch[1]) : 0.0;

        var lines = block.split(/\r\n|\r|\n/);

        // The header (cave name / SURVEY NAME / SURVEY DATE / SURVEY TEAM /
        // DECLINATION+FORMAT+CORRECTIONS) contains lines that can look like
        // shot data to the numeric heuristic below -- most notably
        // "SURVEY DATE: 7 10 2024" has three numbers in a row, which is
        // exactly what the heuristic looks for. To avoid misreading it as a
        // shot, skip everything up to and including the DECLINATION line
        // (the last guaranteed header marker); only lines after it are
        // considered as candidate shot lines.
        var declLineIdx = -1;
        for (var dli = 0; dli < lines.length; dli++) {
            if (/DECLINATION:/i.test(lines[dli])) {
                declLineIdx = dli;
                break;
            }
        }
        var scanStart = (declLineIdx >= 0) ? declLineIdx + 1 : 0;

        for (var li = scanStart; li < lines.length; li++) {
            var line = lines[li].trim();
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
                continue; // not a shot line (header / column-title line)
            }

            var left = parseFloat(tokens[5]);
            var up = parseFloat(tokens[6]);
            var down = parseFloat(tokens[7]);
            var right = parseFloat(tokens[8]);
            if (isNaN(left) || left < 0) left = 0.0;
            if (isNaN(up) || up < 0) up = 0.0;
            if (isNaN(down) || down < 0) down = 0.0;
            if (isNaN(right) || right < 0) right = 0.0;

            var remainder = tokens.slice(9).join(" ");
            var flagMatch = remainder.match(/#\|([A-Za-z]*)#/);
            var flags = flagMatch ? flagMatch[1].toUpperCase() : "";
            var excludeAll = flags.indexOf("X") >= 0;
            var excludePlot = flags.indexOf("P") >= 0;

            shots.push({
                from: tokens[0],
                to: tokens[1],
                distance: toDrawingUnits(length, "ft"),
                azimuth: bearing + declination,
                inclination: inc,
                left: toDrawingUnits(left, "ft"),
                right: toDrawingUnits(right, "ft"),
                up: toDrawingUnits(up, "ft"),
                down: toDrawingUnits(down, "ft"),
                drawGeometry: !(excludeAll || excludePlot),
                includeInPositions: !excludeAll
            });
        }
    }
    return shots;
}

// ============================================================
// Walls (.srv) parser
// ============================================================

function parseWallsSrv(content) {
    var shots = [];
    var fixedStations = {};
    var lines = content.split(/\r\n|\r|\n/);

    var order = ["D", "A", "V"]; // Distance, Azimuth, Vertical-angle
    var distUnit = "ft";
    var declination = 0.0;
    var prefix = "";

    function applyPrefix(name) {
        if (name === "-" || name === "") {
            return name;
        }
        if (prefix === "" || name.indexOf(":") >= 0) {
            return name;
        }
        return prefix + ":" + name;
    }

    for (var li = 0; li < lines.length; li++) {
        var rawLine = lines[li];
        var line = rawLine.trim();
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
                        distUnit = "ft";
                    } else if (/^meters$/i.test(tok) || /^metres$/i.test(tok)) {
                        distUnit = "m";
                    } else if (/^order=/i.test(tok)) {
                        order = tok.split("=")[1].toUpperCase().split("");
                    } else if (/^decl(ination)?=/i.test(tok)) {
                        declination = parseFloat(tok.split("=")[1]) || 0.0;
                    }
                    // other tokens (Tape=, Typeab=, LRUD=, Incd=, etc.) intentionally ignored
                }
            } else if (directive === "#prefix") {
                prefix = directiveTokens.length > 1 ? directiveTokens[1] : "";
            } else if (directive === "#fix") {
                if (directiveTokens.length >= 4) {
                    var fixName = applyPrefix(directiveTokens[1]);
                    var fx = parseFloat(directiveTokens[2]);
                    var fy = parseFloat(directiveTokens[3]);
                    if (!isNaN(fx) && !isNaN(fy)) {
                        fixedStations[fixName] = new RVector(
                            toDrawingUnits(fx, distUnit), toDrawingUnits(fy, distUnit));
                    }
                }
            }
            // other directives (#Date, #Flag, #Segment, #Note, #Symbol, etc.) ignored
            continue;
        }

        // strip ; comment tail (but only OUTSIDE an LRUD <...> block --
        // LRUD blocks never legitimately contain ';' in practice)
        var lrudMatch = line.match(/<([^>]*)>/);
        var lrud = { left: 0, right: 0, up: 0, down: 0 };
        var workLine = line;
        if (lrudMatch !== null) {
            var lrudParts = lrudMatch[1].split(",");
            var lrudVals = [0, 0, 0, 0];
            for (var p = 0; p < 4 && p < lrudParts.length; p++) {
                var pv = lrudParts[p].trim();
                lrudVals[p] = (pv === "--" || pv === "") ? 0.0 : (parseFloat(pv) || 0.0);
            }
            lrud.left = lrudVals[0];
            lrud.right = lrudVals[1];
            lrud.up = lrudVals[2];
            lrud.down = lrudVals[3];
            workLine = workLine.replace(lrudMatch[0], " ");
        }
        var semiIdx = workLine.indexOf(";");
        if (semiIdx >= 0) {
            workLine = workLine.substring(0, semiIdx);
        }

        var fields = workLine.trim().split(/\s+/);
        if (fields.length < 2) {
            continue; // not a usable shot line
        }

        var fromName = applyPrefix(fields[0]);
        var toRaw = fields[1];
        var isSplay = (toRaw === "-");
        var toName = isSplay ? undefined : applyPrefix(toRaw);

        var distance = 0, azimuth = 0, inclination = 0;
        var vals = fields.slice(2);
        for (var oi = 0; oi < order.length && oi < vals.length; oi++) {
            var v = parseFloat(vals[oi]);
            if (isNaN(v)) {
                continue;
            }
            if (order[oi] === "D") {
                distance = v;
            } else if (order[oi] === "A") {
                azimuth = v;
            } else if (order[oi] === "V") {
                inclination = v;
            }
        }

        if (isSplay) {
            continue; // splays skipped entirely (not converted to LRUD)
        }

        shots.push({
            from: fromName,
            to: toName,
            distance: toDrawingUnits(distance, distUnit),
            azimuth: azimuth + declination,
            inclination: inclination,
            left: toDrawingUnits(lrud.left, distUnit),
            right: toDrawingUnits(lrud.right, distUnit),
            up: toDrawingUnits(lrud.up, distUnit),
            down: toDrawingUnits(lrud.down, distUnit),
            drawGeometry: true,
            includeInPositions: true
        });
    }

    return { shots: shots, fixedStations: fixedStations };
}

// ============================================================
// Survex (.svx) parser
// ============================================================

function parseSurvexSvx(content) {
    var shots = [];
    var fixedStations = {};
    var passageLrud = {}; // stationName -> {left,right,up,down}

    var lines = content.split(/\r\n|\r|\n/);
    var prefixStack = [];
    var lengthUnit = "m";
    // angleUnit currently assumed degrees; grads support noted but not
    // auto-applied per-reading (flag if you actually use grads).

    var dataStyle = null; // null | "normal" | "passage" | "other"
    var normalFields = ["from", "to", "tape", "compass", "clino"];
    var passageFields = ["station", "left", "right", "up", "down"];

    function fullName(name) {
        if (prefixStack.length === 0) {
            return name;
        }
        return prefixStack.join(".") + "." + name;
    }

    for (var li = 0; li < lines.length; li++) {
        var rawLine = lines[li];
        var semiIdx = rawLine.indexOf(";");
        var line = (semiIdx >= 0 ? rawLine.substring(0, semiIdx) : rawLine).trim();
        if (line.length === 0) {
            continue;
        }

        if (line.charAt(0) === "*") {
            var tokens = line.split(/\s+/);
            var cmd = tokens[0].toLowerCase();

            if (cmd === "*begin") {
                prefixStack.push(tokens.length > 1 ? tokens[1] : ("anon" + li));
            } else if (cmd === "*end") {
                prefixStack.pop();
            } else if (cmd === "*data") {
                if (tokens.length === 1) {
                    dataStyle = null;
                } else if (tokens[1].toLowerCase() === "normal") {
                    dataStyle = "normal";
                    normalFields = tokens.slice(2).map(function (s) { return s.toLowerCase(); });
                } else if (tokens[1].toLowerCase() === "passage") {
                    dataStyle = "passage";
                    passageFields = tokens.slice(2).map(function (s) { return s.toLowerCase(); });
                } else {
                    dataStyle = "other"; // diving/cartesian/nosurvey -- not supported for positions
                }
            } else if (cmd === "*units") {
                if (tokens.length >= 3 && tokens[1].toLowerCase() === "length") {
                    var lu = tokens[2].toLowerCase();
                    lengthUnit = (lu.indexOf("feet") >= 0 || lu === "ft") ? "ft" : "m";
                }
                // *units compass/clino grads not auto-converted -- flag if needed
            } else if (cmd === "*fix") {
                if (tokens.length >= 4) {
                    var fxName = fullName(tokens[1]);
                    var fx = parseFloat(tokens[2]);
                    var fy = parseFloat(tokens[3]);
                    if (!isNaN(fx) && !isNaN(fy)) {
                        fixedStations[fxName] = new RVector(
                            toDrawingUnits(fx, lengthUnit), toDrawingUnits(fy, lengthUnit));
                    }
                }
            }
            // *equate, *export, *include, *calibrate, *entrance, etc. ignored
            continue;
        }

        // plain data line -- interpretation depends on current *data style
        var fields = line.split(/\s+/);

        if (dataStyle === "normal") {
            var rec = {};
            for (var ni = 0; ni < normalFields.length && ni < fields.length; ni++) {
                rec[normalFields[ni]] = fields[ni];
            }
            if (!rec.hasOwnProperty("from") || !rec.hasOwnProperty("to") ||
                !rec.hasOwnProperty("tape") || !rec.hasOwnProperty("compass")) {
                continue; // can't use this line, missing required fields
            }
            var tape = parseFloat(rec.tape);
            var compass = parseFloat(rec.compass);
            var clino = rec.hasOwnProperty("clino") ? parseFloat(rec.clino) : 0.0;
            if (isNaN(tape) || isNaN(compass)) {
                continue; // OMIT ("-") or malformed -- can't place this station
            }
            if (isNaN(clino)) {
                clino = 0.0;
            }

            shots.push({
                from: fullName(rec.from),
                to: fullName(rec.to),
                distance: toDrawingUnits(tape, lengthUnit),
                azimuth: compass,
                inclination: clino,
                left: 0, right: 0, up: 0, down: 0, // filled in from passageLrud later
                drawGeometry: true,
                includeInPositions: true
            });
        } else if (dataStyle === "passage") {
            var prec = {};
            for (var pi = 0; pi < passageFields.length && pi < fields.length; pi++) {
                prec[passageFields[pi]] = fields[pi];
            }
            if (!prec.hasOwnProperty("station")) {
                continue;
            }
            var stName = fullName(prec.station);
            function num(v) {
                if (v === undefined || v === "-") return 0.0;
                var n = parseFloat(v);
                return isNaN(n) ? 0.0 : n;
            }
            passageLrud[stName] = {
                left: toDrawingUnits(num(prec.left), lengthUnit),
                right: toDrawingUnits(num(prec.right), lengthUnit),
                up: toDrawingUnits(num(prec.up), lengthUnit),
                down: toDrawingUnits(num(prec.down), lengthUnit)
            };
        }
        // dataStyle === "other" or null: line ignored
    }

    // attach passage LRUD (keyed by TO station) onto matching shots
    for (var si = 0; si < shots.length; si++) {
        if (passageLrud.hasOwnProperty(shots[si].to)) {
            var pl = passageLrud[shots[si].to];
            shots[si].left = pl.left;
            shots[si].right = pl.right;
            shots[si].up = pl.up;
            shots[si].down = pl.down;
        }
    }

    return { shots: shots, fixedStations: fixedStations };
}

// ============================================================
// Entry point
// ============================================================

function importNativeCaveSurvey() {
    var doc = getDocument();
    if (doc === undefined) {
        warning("ImportNativeCaveSurvey: no active drawing document.");
        return;
    }

    var formatLabel = getItem(
        "Import Cave Survey",
        "Which native format is this file?",
        "Walls (.srv)|Compass (.dat)|Survex (.svx)", 0, "|"
    );
    if (formatLabel === undefined) {
        return;
    }

    var filter;
    if (formatLabel.indexOf("Walls") === 0) {
        filter = "Walls Survey Files (*.srv);;All Files (*)";
    } else if (formatLabel.indexOf("Compass") === 0) {
        filter = "Compass Data Files (*.dat);;All Files (*)";
    } else {
        filter = "Survex Files (*.svx);;All Files (*)";
    }

    var fileName = QFileDialog.getOpenFileName(
        getMainWindow(), "Select " + formatLabel + " file", "", filter);
    if (!fileName) {
        return;
    }

    var content = readWholeFile(fileName);
    if (content === undefined) {
        QMessageBox.warning(getMainWindow(), "Import Cave Survey",
            "Could not open file: " + fileName);
        return;
    }

    var shots, fixedStations;
    if (formatLabel.indexOf("Walls") === 0) {
        var wResult = parseWallsSrv(content);
        shots = wResult.shots;
        fixedStations = wResult.fixedStations;
    } else if (formatLabel.indexOf("Compass") === 0) {
        shots = parseCompassDat(content);
        fixedStations = {};
    } else {
        var sResult = parseSurvexSvx(content);
        shots = sResult.shots;
        fixedStations = sResult.fixedStations;
    }

    resolveAndDraw(doc, shots, fixedStations, formatLabel);
}

importNativeCaveSurvey();
