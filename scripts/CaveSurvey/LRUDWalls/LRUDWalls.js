// LRUDWalls.js
//
// QCAD ECMAScript tool: draws approximate passage walls (previsualization
// only) by connecting the named LRUD tip points that AzimuthTraverse.js
// already creates and tags -- e.g. "A1.L" / "A1.R" -- rather than
// recomputing any offset geometry itself.
//
// Draws two faint STRAIGHT-LINE polylines (left wall, right wall).
// No curve fitting / splining: straight segments only, since implying
// wall detail between shots that isn't in the survey data would
// misrepresent the passage.
//
// REQUIRES: AzimuthTraverse.js must have been run first (or the drawing
// otherwise populated the same way) so that:
//   - CTRL-STATIONS holds one POINT per station, tagged
//     "CaveSurvey"/"Station" with the station's name.
//   - CTRL-LRUD holds a POINT at the tip of each L/R tick, tagged
//     "CaveSurvey"/"LRUDName" with "<station name>.L" or ".R".
//
// STATION ORDER ASSUMPTION: station sequence is taken from the creation
// order of points on CTRL-STATIONS. This is correct for a single
// continuous AzimuthTraverse run. If you've resumed a traverse from an
// existing station in a separate run, merged imported surveys, or have
// more than one traverse in the same drawing, verify the resulting wall
// connections before trusting them -- entity creation order may not
// match survey order in those cases.
//
// JUNCTION HANDLING: intentionally not implemented, same as before. At
// a T or cross junction, three or more shots meet at one station and
// the "two walls per traverse" model breaks down. This script will
// simply let the wall polylines terminate or overlap at a junction
// station -- close small gaps by hand, or run this once per traverse
// leg.

include("scripts/EAction.js");
include("scripts/simple.js");

// ---- tunables --------------------------------------------------------

var STATIONS_LAYER   = "CTRL-STATIONS";   // must match AzimuthTraverse.js
var LRUD_LAYER        = "CTRL-LRUD";       // must match AzimuthTraverse.js
var LEFT_WALL_LAYER   = "CTRL-LRUD-WALL-LEFT";
var RIGHT_WALL_LAYER  = "CTRL-LRUD-WALL-RIGHT";
var WALL_COLOR        = "gray";            // faint
var WALL_LINEWEIGHT   = RLineweight.Weight000; // thinnest available
var WALL_LINETYPE     = "DASHED";          // reads as "provisional"

// ---- entity lookup helpers ---------------------------------------------

// Returns all entities on a given layer, in ascending entity-id order
// (i.e. the order they were created in, for a normal linear traverse).
function collectLayerEntities(doc, layerName) {
    if (!hasLayer(layerName)) {
        return [];
    }
    var layerId = doc.getLayerId(layerName);
    var allIds = doc.queryAllEntities(false, false);
    var result = [];
    for (var i = 0; i < allIds.length; i++) {
        var e = doc.queryEntity(allIds[i]);
        if (!isNull(e) && e.getLayerId() === layerId) {
            result.push(e);
        }
    }
    return result;
}

// Reads a custom property off an entity, returning "" if unavailable.
function readCustomProperty(entity, key) {
    if (typeof entity.getCustomProperty !== "function") {
        return "";
    }
    try {
        return entity.getCustomProperty("CaveSurvey", key, "");
    } catch (e) {
        return "";
    }
}

// Returns station names in survey (creation) order, read from the
// "CaveSurvey"/"Station" tag on each CTRL-STATIONS point.
function getStationOrder(doc) {
    var pts = collectLayerEntities(doc, STATIONS_LAYER);
    var names = [];
    for (var i = 0; i < pts.length; i++) {
        var name = readCustomProperty(pts[i], "Station");
        if (name !== "") {
            names.push(name);
        }
    }
    return names;
}

// Finds the position of the LRUD point tagged with the given lookup
// name (e.g. "A1.L") among a pre-collected list of CTRL-LRUD entities.
// Returns null if not found (e.g. that station had a 0/blank reading
// on that side, so AzimuthTraverse.js never created the point).
function findLrudPointPosition(lrudEntities, lookupName) {
    for (var i = 0; i < lrudEntities.length; i++) {
        var e = lrudEntities[i];
        if (typeof e.getPosition !== "function") {
            continue; // skip tick lines, only points carry LRUDName
        }
        var name = readCustomProperty(e, "LRUDName");
        if (name === lookupName) {
            return e.getPosition();
        }
    }
    return null;
}

// ---- drawing ------------------------------------------------------------

function ensureWallLayer(name) {
    ensureLayer(name);
}

function ensureLayer(name) {
    if (!hasLayer(name)) {
        addLayer(name, WALL_COLOR, WALL_LINETYPE, WALL_LINEWEIGHT);
    }
}

// Draws a straight (no-bulge) polyline through the given points.
function drawStraightPolyline(doc, points, layerName) {
    if (points.length < 2) {
        return;
    }
    startTransaction(doc);
    setCurrentLayer(layerName);
    addPolyline(points, false); // false = not closed; straight segments only
    endTransaction();
}

// ---- main entry point ----------------------------------------------------

function lrudWalls() {
    var doc = getDocument();
    if (doc === undefined) {
        warning("LRUDWalls: no active drawing document.");
        return;
    }

    if (!hasLayer(STATIONS_LAYER) || !hasLayer(LRUD_LAYER)) {
        warning("LRUDWalls: " + STATIONS_LAYER + " and/or " + LRUD_LAYER +
            " not found. Run AzimuthTraverse.js first.");
        return;
    }

    ensureWallLayer(LEFT_WALL_LAYER);
    ensureWallLayer(RIGHT_WALL_LAYER);

    var stationNames = getStationOrder(doc);
    if (stationNames.length === 0) {
        warning("LRUDWalls: no tagged stations found on " + STATIONS_LAYER + ".");
        return;
    }

    var lrudEntities = collectLayerEntities(doc, LRUD_LAYER);

    var leftPoints = [];
    var rightPoints = [];

    for (var i = 0; i < stationNames.length; i++) {
        var name = stationNames[i];

        var lp = findLrudPointPosition(lrudEntities, name + ".L");
        if (lp !== null) {
            leftPoints.push(lp);
        }

        var rp = findLrudPointPosition(lrudEntities, name + ".R");
        if (rp !== null) {
            rightPoints.push(rp);
        }
    }

    drawStraightPolyline(doc, leftPoints, LEFT_WALL_LAYER);
    drawStraightPolyline(doc, rightPoints, RIGHT_WALL_LAYER);

    autoZoom();
}

// ============================================================
// Addon wiring -- same pattern as AzimuthTraverse.js: turns the
// function above into a launchable button/menu item/command.
// ============================================================

function LRUDWalls(guiAction) {
    EAction.call(this, guiAction);
}

LRUDWalls.prototype = new EAction();

LRUDWalls.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    lrudWalls();
    this.terminate();
};

LRUDWalls.init = function(basePath) {
    var action = new RGuiAction(qsTr("LRUD Walls"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/LRUDWalls.js");
    action.setStatusTip(qsTr("Draw approximate passage walls from named LRUD points created by Azimuth Traverse"));
    action.setDefaultCommands(["lrudwalls"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(30);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
