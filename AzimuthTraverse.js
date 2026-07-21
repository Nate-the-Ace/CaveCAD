// AzimuthTraverse.js
//
// QCAD script tool: draw one or more connected lines by entering
// AZIMUTH (degrees, clockwise from North, 0 = North / 90 = East)
// and DISTANCE (drawing units) for each shot -- like plotting a
// survey traverse or cave survey leg by hand. Optionally enter
// LRUD (Left / Right / Up / Down) passage dimensions and a station
// name per shot.
//
// USAGE:
//   OPTIONAL: before running, select a single line, arc, polyline,
//   or POINT entity in the drawing (e.g. a station point from a
//   previous run) -- the script will start from one of its endpoints
//   (line/arc/polyline) or its exact position (point), instead of
//   asking you to type coordinates.
//
//   Misc > Development > Run Script...  -> select this file
//
//   1. Starting point:
//        - If you selected a POINT entity directly (named or not), its
//          position is used and no duplicate marker is ever drawn there.
//          If its name is readable, that name is used automatically with
//          no further prompt; if not, you're asked for a name, but the
//          point itself still isn't re-drawn.
//        - If you selected a line/arc/polyline, you'll be asked which
//          of its two endpoints to continue from, then asked for a
//          name (a line endpoint isn't itself a named station).
//        - Otherwise, you'll be asked for a name, then typed X/Y
//          coordinates.
//   2. For each shot, prompts appear in this order:
//        name for the new station (pre-filled with the previous
//        name's trailing number incremented, e.g. A1 -> A2) ->
//        Azimuth -> Distance -> Inclination -> Left -> Right -> Up ->
//        Down. Enter 0 (or cancel) for any numeric field you don't
//        have -- this does NOT stop the traverse, only Cancel on
//        Azimuth/Distance does that.
//   3. Press Cancel on the Azimuth or Distance prompt to stop.
//
// STATION POINT DATA:
//   Every station point is tagged (best-effort, via custom
//   properties under "CaveSurvey") with its name, the inclination
//   and full LRUD (Left/Right/Up/Down) of the shot that reached it,
//   and its running elevation (computed from inclination, not
//   corrected for slope in the plan-view distance itself). The label
//   text shown next to each point is the name plus elevation, if
//   nonzero.
//
// LAYERS:
//   ALIGNMENT -- centerline shot lines only.
//   LRUD      -- LRUD tick lines and U/D text labels.
//   STATIONS  -- a POINT entity at every station (start + each shot's
//                endpoint), plus a text label where a name was given.
//                Station points carry the name as a custom property
//                ("CaveSurvey"/"Station") for future table-building
//                scripts, and can be selected before re-running this
//                tool (or the CSV/native importers) to continue a
//                traverse from that exact station.
//   All three layers are created automatically if missing.
//
// AZIMUTH / LRUD CONVENTION:
//   Azimuth: standard surveying convention, clockwise from north.
//     dx = distance * sin(azimuth), dy = distance * cos(azimuth)
//   L/R: measured facing the direction of travel (the shot azimuth).
//     Right = azimuth + 90 deg, Left = azimuth - 90 deg.
//     Drawn as short perpendicular tick lines at the TO station.
//   U/D: vertical dimensions, can't be drawn in plan view -- placed
//     as a text label ("U#.## D#.##") next to the TO station.
//   LRUD is associated with the TO station (far end) of each shot.
//
// STATION SYMBOL:
//   Station points are inserted as references to the "SYM_FIXED_POINT"
//   block, which must already exist in the drawing (angle 0, uniform
//   scale set by STATION_BLOCK_SCALE below). If that block isn't found,
//   this falls back to a plain point entity instead, with a one-time
//   warning -- so a missing block never breaks the traverse, it just
//   won't look like your usual symbol.
//
// TEXT_HEIGHT below controls the size of text labels -- adjust it to
// suit your drawing's units/scale.

include("scripts/simple.js");

var TEXT_HEIGHT = 0.5;
var ALIGNMENT_LAYER = "ALIGNMENT";
var LRUD_LAYER = "LRUD";
var STATIONS_LAYER = "STATIONS";
var STATION_BLOCK_NAME = "SYM_FIXED_POINT";
var STATION_BLOCK_SCALE = 1.0; // adjust to suit the block's inherent size vs. your drawing scale

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

// Inserts a reference to the STATION_BLOCK_NAME block at the given
// position (angle 0, uniform STATION_BLOCK_SCALE). Falls back to a
// plain point (with a one-time warning) if that block doesn't exist
// in this drawing, so a missing block never breaks the traverse.
var stationBlockMissingWarned = false;
function addStationSymbol(doc, pos) {
    var block = doc.queryBlock(STATION_BLOCK_NAME);
    if (isNull(block)) {
        if (!stationBlockMissingWarned) {
            warning("AzimuthTraverse: block \"" + STATION_BLOCK_NAME +
                "\" not found in this drawing -- falling back to plain points.");
            stationBlockMissingWarned = true;
        }
        return addPoint(pos);
    }
    var blockId = block.getId();
    var scaleVec = new RVector(STATION_BLOCK_SCALE, STATION_BLOCK_SCALE);
    var bd = new RBlockReferenceData(blockId, pos, scaleVec, 0, 1, 1, 1, 1);
    var blockRef = new RBlockReferenceEntity(doc, bd);
    return addEntity(blockRef);
}

// Best-effort tag of station data onto a point entity so a future
// "build a station table" script can read it back. Silently does
// nothing if custom properties aren't available in this context --
// the point's position and (if given) its text label are still
// there regardless.
// data: {name, inclination, left, right, up, down, z} -- any field
// may be omitted/undefined to skip tagging that particular property.
function tagStationPoint(entity, data) {
    if (entity === undefined || entity === null) {
        return;
    }
    if (typeof entity.setCustomProperty !== "function") {
        return;
    }
    function tag(key, value) {
        if (value === undefined || value === null || value === "") {
            return;
        }
        try {
            entity.setCustomProperty("CaveSurvey", key, value);
        } catch (e) {
            // custom properties not supported here -- ignore, non-critical
        }
    }
    tag("Station", data.name);
    tag("Inclination", data.inclination);
    tag("Left", data.left);
    tag("Right", data.right);
    tag("Up", data.up);
    tag("Down", data.down);
    tag("Elevation", data.z);
}

// Draws a station point on STATIONS_LAYER and tags it with the full
// set of shot data that produced it (name, inclination, LRUD,
// running elevation). Label text is the name plus elevation (if
// nonzero), offset in the direction implied by azimuthDeg (or a
// fixed default offset if azimuthDeg is undefined, e.g. the very
// first station).
function drawStationPoint(pos, name, azimuthDeg, shotData) {
    var doc = getDocument();
    startTransaction(doc);
    setCurrentLayer(STATIONS_LAYER);
    var pt = addStationSymbol(doc, pos);

    var tagData = {
        name: name,
        inclination: shotData ? shotData.inclination : undefined,
        left: shotData ? shotData.left : undefined,
        right: shotData ? shotData.right : undefined,
        up: shotData ? shotData.up : undefined,
        down: shotData ? shotData.down : undefined,
        z: shotData ? shotData.z : undefined
    };
    tagStationPoint(pt, tagData);

    if (name !== undefined && name !== null && name !== "") {
        var stLabel = name;
        if (shotData && shotData.z !== undefined && Math.abs(shotData.z) > 1e-6) {
            stLabel += " (Z" + (shotData.z >= 0 ? "+" : "") + shotData.z.toFixed(1) + ")";
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

// Returns a perpendicular tick line (as [start, end]) at 'station',
// perpendicular to travel azimuth 'azimuthDeg', on one side ("L" or "R"),
// with the given length. Returns null if length is 0.
function lrudTick(station, azimuthDeg, side, length) {
    if (length === 0) {
        return null;
    }
    var perpAzimuth = (side === "R") ? azimuthDeg + 90.0 : azimuthDeg - 90.0;
    var rad = perpAzimuth * (Math.PI / 180.0);
    var dx = length * Math.sin(rad);
    var dy = length * Math.cos(rad);
    var end = new RVector(station.x + dx, station.y + dy);
    return [station, end];
}

// Draws LRUD ticks + U/D text on LRUD_LAYER.
function drawLrud(station, azimuthDeg, left, right, up, down) {
    startTransaction(getDocument());
    setCurrentLayer(LRUD_LAYER);

    var leftTick = lrudTick(station, azimuthDeg, "L", left);
    if (leftTick !== null) {
        addLine(leftTick[0], leftTick[1]);
    }
    var rightTick = lrudTick(station, azimuthDeg, "R", right);
    if (rightTick !== null) {
        addLine(rightTick[0], rightTick[1]);
    }

    if (up !== 0 || down !== 0) {
        var udText = "U" + up.toFixed(2) + " D" + down.toFixed(2);
        var noteRad = (azimuthDeg + 90.0) * (Math.PI / 180.0);
        var noteOffset = TEXT_HEIGHT * 1.5;
        var notePos = new RVector(
            station.x + noteOffset * Math.sin(noteRad),
            station.y + noteOffset * Math.cos(noteRad)
        );
        addSimpleText(udText, notePos, TEXT_HEIGHT, 0, "standard",
            RS.VAlignMiddle, RS.HAlignLeft, false, false);
    }
    endTransaction();
}

// Tries to derive a starting point from the current selection.
// Returns an RVector, or undefined if nothing usable is selected
// (caller should fall back to asking for typed coordinates).
function getStartPointFromSelection(doc) {
    if (!doc.hasSelection()) {
        return undefined;
    }

    var ids = doc.querySelectedEntities();
    if (ids.length !== 1) {
        // Ambiguous (0 or multiple) -- fall back to typed input.
        return undefined;
    }

    var entity = doc.queryEntity(ids[0]);
    if (isNull(entity)) {
        return undefined;
    }

    // Point entity: use its position directly. If it's already a tagged
    // station point, report that so the caller doesn't draw a duplicate
    // marker and can default the name prompt to its existing tag.
    if (typeof entity.getPosition === "function") {
        var existingName = "";
        if (typeof entity.getCustomProperty === "function") {
            try {
                existingName = entity.getCustomProperty("CaveSurvey", "Station", "");
            } catch (e) {
                // custom properties not supported here -- ignore
            }
        }
        return { pos: entity.getPosition(), isExistingStation: true, existingName: existingName };
    }

    // Line / arc / polyline: offer a choice of the two endpoints.
    if (typeof entity.getStartPoint === "function" &&
        typeof entity.getEndPoint === "function") {
        var p1 = entity.getStartPoint();
        var p2 = entity.getEndPoint();

        var itemLabels = [
            "Point 1: (" + p1.x.toFixed(3) + ", " + p1.y.toFixed(3) + ")",
            "Point 2: (" + p2.x.toFixed(3) + ", " + p2.y.toFixed(3) + ")"
        ];

        // getItem expects a single delimited string (it calls .split()
        // internally), not a JS array -- and our labels already contain
        // commas, so we join/split on "|" instead of the default ",".
        var choice = getItem(
            "Azimuth Traverse",
            "Start the traverse from which endpoint of the selected entity?",
            itemLabels.join("|"),
            0,
            "|"
        );
        if (choice === undefined) {
            return undefined;
        }
        var chosenPos = (choice.indexOf("Point 1") === 0) ? p1 : p2;
        return { pos: chosenPos, isExistingStation: false, existingName: "" };
    }

    return undefined;
}




// Guesses the next station name by incrementing a trailing number on
// the previous station's name (e.g. "A1" -> "A2", "A01" -> "A02",
// preserving zero-padding width). Falls back to "A1" if there's no
// previous name, or "<prevName>1" if the previous name has no
// trailing digits to increment.
function nextStationNameGuess(prevName) {
    if (prevName === undefined || prevName === null || prevName === "") {
        return "A1";
    }
    var m = prevName.match(/^(.*?)(\d+)$/);
    if (m === null) {
        return prevName + "1";
    }
    var prefix = m[1];
    var numStr = m[2];
    var incrementedStr = (parseInt(numStr, 10) + 1).toString();
    while (incrementedStr.length < numStr.length) {
        incrementedStr = "0" + incrementedStr;
    }
    return prefix + incrementedStr;
}

function azimuthTraverse() {
    var doc = getDocument();
    if (doc === undefined) {
        warning("AzimuthTraverse: no active drawing document.");
        return;
    }

    // -- starting point --
    // Priority: explicit selection. If you selected a point entity
    // directly (any point, named or not), its position is used and NO
    // duplicate marker is ever drawn at that spot -- if its name tag is
    // readable, that name is used with no further prompt; if not, you're
    // asked for a name but the point itself still isn't re-drawn. If you
    // selected a line/arc/polyline, you're asked which endpoint, then
    // asked for a name (since a line endpoint isn't itself a named
    // station). If nothing is selected, you're asked for a name and then
    // typed X/Y coordinates.
    var selResult = getStartPointFromSelection(doc);
    var current;
    var startName;
    var startPointAlreadyExists = false;

    if (selResult !== undefined && selResult.isExistingStation) {
        // Selected an existing point entity directly -- never draw a
        // duplicate marker here, regardless of whether we could read
        // back a name tag from it.
        current = selResult.pos;
        startPointAlreadyExists = true;
        if (selResult.existingName) {
            startName = selResult.existingName;
            QMessageBox.information(getMainWindow(), "Azimuth Traverse",
                "Starting from existing station \"" + startName + "\".");
        } else {
            startName = getText("Azimuth Traverse", "Name for the starting station:", "A1");
            if (startName === undefined) {
                startName = "";
            }
        }
    } else if (selResult !== undefined) {
        // Selected a line/arc/polyline endpoint -- use its position,
        // but still need a name (an endpoint isn't itself a station).
        current = selResult.pos;
        startName = getText("Azimuth Traverse", "Name for the starting station:", "A1");
        if (startName === undefined) {
            startName = "";
        }
    } else {
        // Nothing usable selected -- ask for name, then typed coordinates.
        startName = getText("Azimuth Traverse", "Name for the starting station:", "A1");
        if (startName === undefined) {
            startName = "";
        }
        var startX = getDouble("Azimuth Traverse", "Start point X:", 0.0, 6);
        if (startX === undefined) {
            return;
        }
        var startY = getDouble("Azimuth Traverse", "Start point Y:", 0.0, 6);
        if (startY === undefined) {
            return;
        }
        current = new RVector(startX, startY);
    }

    var count = 0;
    var currentStationName = startName;
    var currentZ = 0.0;

    ensureAllLayers();

    if (!startPointAlreadyExists) {
        drawStationPoint(current, startName, undefined, { z: currentZ });
    }

    while (true) {
        var fromLabel = (currentStationName !== "") ? currentStationName :
            ("Station at (" + current.x.toFixed(3) + ", " + current.y.toFixed(3) + ")");

        var toName = getText("Azimuth Traverse",
            "From " + fromLabel + " -- name for the new station:",
            nextStationNameGuess(currentStationName));
        if (toName === undefined) {
            toName = "";
        }
        var toLabel = (toName !== "") ? toName :
            ("Station at (" + fromLabel + " + this shot)");

        var shotLabel = fromLabel + " -> " + toLabel;

        var azimuth = getDouble(
            "Azimuth Traverse",
            shotLabel + "\nAzimuth (deg, 0 = North, clockwise):",
            0.0, 4, -360000, 360000
        );
        if (azimuth === undefined) {
            break;
        }

        var distance = getDouble(
            "Azimuth Traverse",
            shotLabel + "\nDistance:",
            0.0, 4, 0, 1000000000
        );
        if (distance === undefined) {
            break;
        }
        if (distance === 0) {
            // nothing to draw, treat as "done"
            break;
        }

        var inclination = getDouble(
            "Azimuth Traverse",
            shotLabel + "\nInclination (deg, + up / - down):",
            0.0, 4, -90, 90
        );
        if (inclination === undefined) {
            inclination = 0.0;
        }

        var left = getDouble("Azimuth Traverse", shotLabel + "\nLeft:", 0.0, 4, 0, 1000000000);
        if (left === undefined) {
            left = 0.0;
        }
        var right = getDouble("Azimuth Traverse", shotLabel + "\nRight:", 0.0, 4, 0, 1000000000);
        if (right === undefined) {
            right = 0.0;
        }
        var up = getDouble("Azimuth Traverse", shotLabel + "\nUp:", 0.0, 4, 0, 1000000000);
        if (up === undefined) {
            up = 0.0;
        }
        var down = getDouble("Azimuth Traverse", shotLabel + "\nDown:", 0.0, 4, 0, 1000000000);
        if (down === undefined) {
            down = 0.0;
        }

        var rad = azimuth * (Math.PI / 180.0);
        var dx = distance * Math.sin(rad);
        var dy = distance * Math.cos(rad);

        var next = new RVector(current.x + dx, current.y + dy);

        var incRad = inclination * (Math.PI / 180.0);
        var nextZ = currentZ + distance * Math.tan(incRad);

        startTransaction(doc);
        setCurrentLayer(ALIGNMENT_LAYER);
        addLine(current, next);
        endTransaction();

        drawLrud(next, azimuth, left, right, up, down);
        drawStationPoint(next, toName, azimuth, {
            inclination: inclination,
            left: left,
            right: right,
            up: up,
            down: down,
            z: nextZ
        });

        current = next;
        currentStationName = toName;
        currentZ = nextZ;
        count += 1;
    }

    if (count > 0) {
        autoZoom();
    }
}

azimuthTraverse();
