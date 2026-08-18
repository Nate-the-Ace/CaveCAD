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
//          point itself still isn't re-drawn. LRUD is NOT asked again
//          here, since an existing station should already have it from
//          whenever it was first created as a TO station.
//        - If you selected a line/arc/polyline, you'll be asked which
//          of its two endpoints to continue from, then asked for a
//          name (a line endpoint isn't itself a named station).
//        - Otherwise, you'll be asked for a name, then typed X/Y
//          coordinates. Since this creates a brand new starting station,
//          you'll ALSO be asked for its Left/Right/Up/Down right after
//          entering the first shot's azimuth (see step 2) -- this is the
//          only case where a station's LRUD is asked before its shot's
//          distance, since otherwise the very first station's LRUD would
//          never be captured at all.
//   2. For each shot, prompts appear in this order:
//        name for the new station (pre-filled with the previous
//        name's trailing number incremented, e.g. A1 -> A2) ->
//        Azimuth -> [first shot of a new traverse only: Left -> Right ->
//        Up -> Down for the STARTING station, see step 1] -> Distance ->
//        Inclination -> Left -> Right -> Up -> Down (for the new TO
//        station). Enter 0 (or cancel) for any numeric field you don't
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
// LAYERS: (matching the NSS Cave Template's CTRL- control layers)
//   CTRL-SHOTS         -- centerline shot lines only.
//   CTRL-LRUD          -- LRUD tick lines, plus a POINT entity at the tip
//                         of each tick, tagged with a lookup name
//                         ("CaveSurvey"/"LRUDName", e.g. "A1.L" / "A1.R")
//                         for future scripts (e.g. LRUDWalls.js) to find
//                         by name instead of recomputing offsets. Not
//                         present in the template -- created automatically,
//                         following its CTRL- naming convention.
//   CTRL-STATIONS      -- a POINT entity at every station (start + each
//                         shot's endpoint). Station points carry the name
//                         as a custom property ("CaveSurvey"/"Station")
//                         for future table-building scripts, and can be
//                         selected before re-running this tool (or the
//                         CSV/native importers) to continue a traverse
//                         from that exact station.
//   CTRL-STATION-LABELS -- station name/elevation text, and the LRUD
//                         U/D text note.
//   All four layers are created automatically if missing.
//
// AZIMUTH / LRUD CONVENTION:
//   Azimuth: standard surveying convention, clockwise from north.
//     dx = distance * sin(azimuth), dy = distance * cos(azimuth)
//   L/R: measured facing the direction of travel (the shot azimuth).
//     Right = azimuth + 90 deg, Left = azimuth - 90 deg.
//     Drawn as short perpendicular tick lines at the TO station.
//   U/D: vertical dimensions, can't be drawn in plan view -- placed
//     as a text label ("U#.## D#.##") next to the TO station.
//   LRUD is associated with the TO station (far end) of each shot,
//   EXCEPT for the very first station of a freshly-created traverse,
//   which has no incoming shot to attach LRUD to -- its LRUD is asked
//   right after the first shot's azimuth is entered, using that
//   azimuth as the direction reference (see step 1/2 above).
//
// TEXT_HEIGHT below controls the size of text labels and the point
// display size -- adjust it to suit your drawing's units/scale.

include("scripts/EAction.js");
include("scripts/simple.js");

var TEXT_HEIGHT = 0.5;
var ALIGNMENT_LAYER = "CTRL-SHOTS";
var LRUD_LAYER = "CTRL-LRUD"; // not in the template -- created fresh, following its CTRL- naming convention
var STATIONS_LAYER = "CTRL-STATIONS";
var STATION_LABELS_LAYER = "CTRL-STATION-LABELS";

function ensureLayer(name, colorName) {
    if (!hasLayer(name)) {
        addLayer(name, colorName, "CONTINUOUS", RLineweight.Weight025);
    }
}

function ensureAllLayers() {
    ensureLayer(ALIGNMENT_LAYER, "gray");
    ensureLayer(LRUD_LAYER, "yellow");
    ensureLayer(STATIONS_LAYER, "red");
    ensureLayer(STATION_LABELS_LAYER, "red");
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
// running elevation). Label text (on STATION_LABELS_LAYER) is the name
// plus elevation (if nonzero), offset in the direction implied by
// azimuthDeg (or a fixed default offset if azimuthDeg is undefined,
// e.g. the very first station).
function drawStationPoint(pos, name, azimuthDeg, shotData) {
    startTransaction(getDocument());
    setCurrentLayer(STATIONS_LAYER);
    var pt = addPoint(pos);

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
    endTransaction();

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
        startTransaction(getDocument());
        setCurrentLayer(STATION_LABELS_LAYER);
        addSimpleText(stLabel, labelPos, TEXT_HEIGHT, 0, "standard",
            RS.VAlignMiddle, RS.HAlignRight, false, false);
        endTransaction();
    }

    return pt;
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

// Tags a point entity with a lookup name for future scripts (e.g.
// LRUDWalls.js), under the same "CaveSurvey" custom property group used
// by station points, but with its own key ("LRUDName") so it doesn't
// collide with the "Station" tag. Silently does nothing if custom
// properties aren't available in this context.
function tagLrudPoint(entity, name) {
    if (entity === undefined || entity === null) {
        return;
    }
    if (typeof entity.setCustomProperty !== "function") {
        return;
    }
    try {
        entity.setCustomProperty("CaveSurvey", "LRUDName", name);
    } catch (e) {
        // custom properties not supported here -- ignore, non-critical
    }
}

// Draws LRUD ticks on LRUD_LAYER and the U/D text note on
// STATION_LABELS_LAYER. Also drops a named point at the tip of each
// tick (e.g. "A1.L" / "A1.R") so a future script (LRUDWalls.js) can
// look walls up by station name instead of recomputing offsets.
function drawLrud(station, azimuthDeg, left, right, up, down, name) {
    startTransaction(getDocument());
    setCurrentLayer(LRUD_LAYER);

    var leftTick = lrudTick(station, azimuthDeg, "L", left);
    if (leftTick !== null) {
        addLine(leftTick[0], leftTick[1]);
        if (name !== undefined && name !== null && name !== "") {
            var leftPt = addPoint(leftTick[1]);
            tagLrudPoint(leftPt, name + ".L");
        }
    }
    var rightTick = lrudTick(station, azimuthDeg, "R", right);
    if (rightTick !== null) {
        addLine(rightTick[0], rightTick[1]);
        if (name !== undefined && name !== null && name !== "") {
            var rightPt = addPoint(rightTick[1]);
            tagLrudPoint(rightPt, name + ".R");
        }
    }
    endTransaction();

    if (up !== 0 || down !== 0) {
        var udText = "U" + up.toFixed(2) + " D" + down.toFixed(2);
        var noteRad = (azimuthDeg + 90.0) * (Math.PI / 180.0);
        var noteOffset = TEXT_HEIGHT * 1.5;
        var notePos = new RVector(
            station.x + noteOffset * Math.sin(noteRad),
            station.y + noteOffset * Math.cos(noteRad)
        );
        startTransaction(getDocument());
        setCurrentLayer(STATION_LABELS_LAYER);
        addSimpleText(udText, notePos, TEXT_HEIGHT, 0, "standard",
            RS.VAlignMiddle, RS.HAlignLeft, false, false);
        endTransaction();
    }
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

    var startPointEntity;
    if (!startPointAlreadyExists) {
        startPointEntity = drawStationPoint(current, startName, undefined, { z: currentZ });
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

        // One-time only: the very first station of a freshly-created
        // traverse never gets asked for LRUD anywhere else, since LRUD
        // is normally captured for the TO station of each shot. Ask for
        // it now, using the first shot's azimuth as the only available
        // direction reference. Skip this if we resumed from an existing
        // station -- its LRUD should already have been captured whenever
        // it was originally created as a TO station in an earlier run.
        if (count === 0 && !startPointAlreadyExists) {
            var startLeft = getDouble("Azimuth Traverse",
                "Start station (" + fromLabel + ")\nLeft:", 0.0, 4, 0, 1000000000);
            if (startLeft === undefined) {
                startLeft = 0.0;
            }
            var startRight = getDouble("Azimuth Traverse",
                "Start station (" + fromLabel + ")\nRight:", 0.0, 4, 0, 1000000000);
            if (startRight === undefined) {
                startRight = 0.0;
            }
            var startUp = getDouble("Azimuth Traverse",
                "Start station (" + fromLabel + ")\nUp:", 0.0, 4, 0, 1000000000);
            if (startUp === undefined) {
                startUp = 0.0;
            }
            var startDown = getDouble("Azimuth Traverse",
                "Start station (" + fromLabel + ")\nDown:", 0.0, 4, 0, 1000000000);
            if (startDown === undefined) {
                startDown = 0.0;
            }

            drawLrud(current, azimuth, startLeft, startRight, startUp, startDown, startName);

            if (startPointEntity !== undefined) {
                tagStationPoint(startPointEntity, {
                    left: startLeft,
                    right: startRight,
                    up: startUp,
                    down: startDown
                });
            }
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

        drawLrud(next, azimuth, left, right, up, down, toName);
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

// ============================================================
// Addon wiring -- turns the function above into a launchable
// button/menu item/command instead of code that runs immediately
// on load. The actual traverse logic above is untouched.
// ============================================================

function AzimuthTraverse(guiAction) {
    EAction.call(this, guiAction);
}

AzimuthTraverse.prototype = new EAction();

// Called when the tool is launched from its button, menu item, or
// command. Runs the (unchanged) interactive traverse function once,
// then terminates -- same pattern QCAD uses for one-shot tools like
// auto zoom.
AzimuthTraverse.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    azimuthTraverse();
    this.terminate();
};

// Called once by QCAD at startup to register the button/menu item.
AzimuthTraverse.init = function(basePath) {
    var action = new RGuiAction(qsTr("Azimuth Traverse"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/AzimuthTraverse.js");
    action.setIcon(basePath + "/AzimuthTraverse.svg");
    action.setStatusTip(qsTr("Interactive azimuth/distance/inclination traverse entry with LRUD and station tagging"));
    action.setDefaultCommands(["azimuthtraverse", "azt"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(10);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
