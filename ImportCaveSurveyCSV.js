// ImportCaveSurveyCSV.js
//
// QCAD script tool: import a CSV of cave survey shot data (FROM/TO
// station network, azimuth + distance, optional LRUD) and draw the
// resulting centerline + passage-width ticks + station points
// automatically.
//
// USAGE:
//   OPTIONAL: before running, select a single line/arc/polyline/point
//   in the drawing -- if you do, the FIRST station named in the CSV
//   will be anchored to that entity's endpoint/position, so a new
//   survey can continue from an already-drawn passage (including a
//   STATIONS-layer point from a previous import/traverse). Otherwise
//   the first station is placed at (0,0).
//
//   Misc > Development > Run Script...  -> select this file
//
//   1. You'll be asked which convention your CSV loosely follows:
//      Walls, Compass, or Survex. This is currently mostly a label
//      for the import (see notes below) -- the column-matching logic
//      itself is shared across all three, since the underlying shot
//      data (from, to, distance, azimuth, inclination, LRUD) is the
//      same regardless of which cave-survey program's naming
//      conventions you used when you built the CSV.
//   2. You'll be asked to pick the CSV file.
//   3. The whole file is processed in one batch -- no per-row
//      prompts. A summary (stations plotted, shots drawn, any rows
//      that couldn't be resolved) is shown at the end.
//
// CSV FORMAT ASSUMPTIONS:
//   - A header row is REQUIRED (first non-blank, non-comment line).
//     Lines starting with # ; or // are treated as comments and
//     skipped, both before and after the header.
//   - Required columns (any common alias is recognized, see
//     FIELD_ALIASES below): FROM, TO, DISTANCE, AZIMUTH.
//   - Optional columns: INCLINATION, LEFT, RIGHT, UP, DOWN.
//     Missing optional columns default to 0.
//   - Distance is used AS-IS (assumed already horizontal, per your
//     field procedure) -- it is NOT corrected using inclination.
//   - Inclination, if present, is only used to estimate each
//     station's relative elevation for an optional text label; it
//     has no effect on the plan-view (X,Y) geometry.
//   - Azimuth: degrees, clockwise from North (0 = N, 90 = E), matching
//     the interactive AzimuthTraverse tool.
//
// NETWORK RESOLUTION:
//   Rows do not need to be in strict traversal order. The script
//   makes repeated passes over unresolved rows, resolving any row
//   whose FROM station is already known, until no further progress
//   is made. Rows where BOTH stations end up already known (loop
//   closures / re-visits) are drawn as a straight connecting line
//   between the existing station coordinates (no LRUD re-drawn).
//   Rows that remain unresolved after all passes (e.g. a typo in a
//   station name, or a disconnected fragment) are reported, not
//   silently dropped.
//
// SURVEX NOTE:
//   Survex natively often records LRUD separately from the leg table
//   (a *data passage block keyed by station), not per-shot like
//   Walls/Compass typically do. This script only reads LRUD from
//   columns on the SAME row as the shot. If your Survex-style CSV
//   keeps LRUD in a separate table, that will need a second pass --
//   let me know and I'll extend this to handle that structure once
//   I can see a sample file.
//
// LAYERS:
//   ALIGNMENT -- centerline shot lines only.
//   LRUD      -- LRUD tick lines and U/D text labels.
//   STATIONS  -- a POINT entity at every station, plus a text label
//                with its name and (if nonzero) estimated elevation.
//                Station points carry the name as a custom property
//                ("CaveSurvey"/"Station") for future table-building
//                scripts, and can be selected before re-running this
//                tool (or AzimuthTraverse / the native importer) to
//                continue a survey from that exact station.
//   All three layers are created automatically if missing.

include("scripts/simple.js");

var ALIGNMENT_LAYER = "ALIGNMENT";
var LRUD_LAYER = "LRUD";
var STATIONS_LAYER = "STATIONS";
var TEXT_HEIGHT = 0.5;
var DRAW_LRUD = true;
var DRAW_STATION_LABELS = true;
var DRAW_ELEVATION_LABELS = true;

// Column name aliases (normalized: lowercase, letters/digits only).
var FIELD_ALIASES = {
    from: ["from", "fromstation", "stationa", "frm", "a"],
    to: ["to", "tostation", "stationb", "b"],
    distance: ["distance", "dist", "length", "len", "tape"],
    azimuth: ["azimuth", "az", "azm", "bearing", "compass"],
    inclination: ["inclination", "inc", "clino", "vert", "vertangle", "verticalangle"],
    left: ["left", "l"],
    right: ["right", "r"],
    up: ["up", "u"],
    down: ["down", "d"]
};

function normalizeHeader(s) {
    return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

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
}

// Same selection-based start point logic as AzimuthTraverse.js.
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
            "Import Cave Survey CSV",
            "Anchor the first CSV station to which endpoint of the selected entity?",
            itemLabels.join("|"), 0, "|"
        );
        if (choice === undefined) {
            return undefined;
        }
        return (choice.indexOf("Point 1") === 0) ? p1 : p2;
    }
    return undefined;
}

function splitCsvLine(line) {
    var cells = line.split(",");
    for (var i = 0; i < cells.length; i++) {
        var c = cells[i].trim();
        if (c.length >= 2 && c.charAt(0) === "\"" && c.charAt(c.length - 1) === "\"") {
            c = c.substring(1, c.length - 1);
        }
        cells[i] = c;
    }
    return cells;
}

function isCommentOrBlank(line) {
    var t = line.trim();
    return t.length === 0 || t.indexOf("#") === 0 || t.indexOf(";") === 0 || t.indexOf("//") === 0;
}

function parseNumber(s) {
    if (s === undefined || s === null || s.trim() === "") {
        return 0.0;
    }
    var v = parseFloat(s);
    return isNaN(v) ? 0.0 : v;
}

function importCaveSurveyCsv() {
    var doc = getDocument();
    if (doc === undefined) {
        warning("ImportCaveSurveyCSV: no active drawing document.");
        return;
    }

    var formatLabel = getItem(
        "Import Cave Survey CSV",
        "Which convention does this CSV loosely follow?\n(column names are matched flexibly either way)",
        "Walls|Compass|Survex", 0, "|"
    );
    if (formatLabel === undefined) {
        return;
    }

    var fileName = QFileDialog.getOpenFileName(
        getMainWindow(), "Select Cave Survey CSV (" + formatLabel + ")", "",
        "CSV Files (*.csv);;All Files (*)"
    );
    if (!fileName) {
        return;
    }

    var file = new QFile(fileName);
    var openFlags = new QIODevice.OpenMode(QIODevice.ReadOnly | QIODevice.Text);
    if (!file.open(openFlags)) {
        warning("ImportCaveSurveyCSV: could not open file: " + fileName);
        return;
    }
    var stream = new QTextStream(file);
    var content = stream.readAll();
    file.close();

    var rawLines = content.split(/\r\n|\r|\n/);

    // -- find header row --
    var headerCells = null;
    var colIndex = {};
    var dataStartIdx = -1;

    for (var li = 0; li < rawLines.length; li++) {
        if (isCommentOrBlank(rawLines[li])) {
            continue;
        }
        var candidate = splitCsvLine(rawLines[li]);
        var candidateMap = {};
        for (var ci = 0; ci < candidate.length; ci++) {
            candidateMap[normalizeHeader(candidate[ci])] = ci;
        }

        var tempIndex = {};
        for (var field in FIELD_ALIASES) {
            var aliases = FIELD_ALIASES[field];
            for (var ai = 0; ai < aliases.length; ai++) {
                if (candidateMap.hasOwnProperty(aliases[ai])) {
                    tempIndex[field] = candidateMap[aliases[ai]];
                    break;
                }
            }
        }
        if (tempIndex.hasOwnProperty("from") && tempIndex.hasOwnProperty("to") &&
            tempIndex.hasOwnProperty("distance") && tempIndex.hasOwnProperty("azimuth")) {
            headerCells = candidate;
            colIndex = tempIndex;
            dataStartIdx = li + 1;
        }
        break; // only ever consider the first non-comment/blank line as the header
    }

    if (headerCells === null) {
        QMessageBox.warning(getMainWindow(), "Import Cave Survey CSV",
            "Could not find a header row with recognizable FROM, TO, DISTANCE, and " +
            "AZIMUTH columns (any common alias, e.g. DIST/LENGTH/TAPE, AZ/BEARING/COMPASS).\n\n" +
            "Please add a header row to the CSV and try again.");
        return;
    }

    // -- parse data rows --
    var rows = [];
    for (var di = dataStartIdx; di < rawLines.length; di++) {
        if (isCommentOrBlank(rawLines[di])) {
            continue;
        }
        var cells = splitCsvLine(rawLines[di]);
        if (cells.length <= 1 && cells[0] === "") {
            continue;
        }
        rows.push({
            from: (cells[colIndex.from] || "").trim(),
            to: (cells[colIndex.to] || "").trim(),
            distance: parseNumber(cells[colIndex.distance]),
            azimuth: parseNumber(cells[colIndex.azimuth]),
            inclination: colIndex.hasOwnProperty("inclination") ? parseNumber(cells[colIndex.inclination]) : 0.0,
            left: colIndex.hasOwnProperty("left") ? parseNumber(cells[colIndex.left]) : 0.0,
            right: colIndex.hasOwnProperty("right") ? parseNumber(cells[colIndex.right]) : 0.0,
            up: colIndex.hasOwnProperty("up") ? parseNumber(cells[colIndex.up]) : 0.0,
            down: colIndex.hasOwnProperty("down") ? parseNumber(cells[colIndex.down]) : 0.0,
            resolved: false
        });
    }

    if (rows.length === 0) {
        QMessageBox.warning(getMainWindow(), "Import Cave Survey CSV", "No data rows found in file.");
        return;
    }

    // -- anchor first station --
    var stations = {}; // name -> {pos: RVector, z: number}
    var firstStationName = rows[0].from;
    var anchor = getStartPointFromSelection(doc);
    if (anchor === undefined) {
        anchor = new RVector(0, 0);
    }
    stations[firstStationName] = { pos: anchor, z: 0.0 };

    startTransaction(doc);
    ensureAllLayers();

    drawStationPoint(anchor, firstStationName, 0.0, undefined);

    var shotsDrawn = 0;
    var closuresDrawn = 0;

    // -- multi-pass resolution --
    var progress = true;
    while (progress) {
        progress = false;
        for (var ri = 0; ri < rows.length; ri++) {
            var row = rows[ri];
            if (row.resolved) {
                continue;
            }
            if (!stations.hasOwnProperty(row.from)) {
                continue; // not resolvable yet, try again next pass
            }

            var fromStation = stations[row.from];

            if (stations.hasOwnProperty(row.to)) {
                // Both ends known -- loop closure / re-visit. Draw a
                // straight connector between the existing coordinates.
                var toStation = stations[row.to];
                setCurrentLayer(ALIGNMENT_LAYER);
                addLine(fromStation.pos, toStation.pos);
                closuresDrawn += 1;
                row.resolved = true;
                progress = true;
                continue;
            }

            // Normal case: compute TO from FROM + azimuth/distance.
            var rad = row.azimuth * (Math.PI / 180.0);
            var dx = row.distance * Math.sin(rad);
            var dy = row.distance * Math.cos(rad);
            var toPos = new RVector(fromStation.pos.x + dx, fromStation.pos.y + dy);

            var incRad = row.inclination * (Math.PI / 180.0);
            var toZ = fromStation.z + row.distance * Math.tan(incRad);

            setCurrentLayer(ALIGNMENT_LAYER);
            addLine(fromStation.pos, toPos);
            shotsDrawn += 1;

            stations[row.to] = { pos: toPos, z: toZ };

            if (DRAW_LRUD) {
                drawLrud(toPos, row.azimuth, row.left, row.right, row.up, row.down);
            }

            drawStationPoint(toPos, row.to, toZ, row.azimuth);

            row.resolved = true;
            progress = true;
        }
    }

    endTransaction();

    if (shotsDrawn > 0 || closuresDrawn > 0) {
        autoZoom();
    }

    // -- report unresolved rows --
    var unresolved = [];
    for (var ui = 0; ui < rows.length; ui++) {
        if (!rows[ui].resolved) {
            unresolved.push(rows[ui].from + " -> " + rows[ui].to);
        }
    }

    var summary = "Format: " + formatLabel + "\n" +
        "Stations plotted: " + Object.keys(stations).length + "\n" +
        "Shots drawn: " + shotsDrawn + "\n" +
        "Closure/re-visit lines drawn: " + closuresDrawn + "\n";

    if (unresolved.length > 0) {
        summary += "\nWARNING -- " + unresolved.length + " row(s) could not be resolved " +
            "(unknown FROM station -- check for typos or disconnected data):\n" +
            unresolved.join("\n");
        QMessageBox.warning(getMainWindow(), "Import Cave Survey CSV", summary);
    } else {
        QMessageBox.information(getMainWindow(), "Import Cave Survey CSV", summary);
    }
}

importCaveSurveyCsv();
