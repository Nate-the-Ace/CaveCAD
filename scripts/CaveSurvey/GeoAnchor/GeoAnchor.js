// GeoAnchor.js
//
// QCAD ECMAScript tool: transforms the ENTIRE drawing so a single
// selected station point lands exactly on a real-world latitude/
// longitude you paste in from Google Maps (dropped-pin DMS format,
// e.g. 39 41'45.8"N 86 18'34.0"W), for use as a KML / Google Earth
// overlay.
//
// !! DESTRUCTIVE, WHOLE-DRAWING OPERATION -- RUN ON A COPY !!
// This rewrites the coordinates of every entity in the drawing. There
// is no partial-selection option and no built-in undo path back to
// your original survey units once saved. Duplicate your file first.
//
// WHY THIS DISTORTS CURVES:
// Decimal degrees are not a uniform unit like feet -- one degree of
// longitude covers a different real-world distance than one degree of
// latitude, and that ratio itself changes with latitude. Converting
// therefore requires a NON-UNIFORM (different X vs Y) scale factor.
// Straight lines, points, and text positions convert cleanly. Any
// circles or arcs -- including ones inside inserted NSS symbol blocks
// -- will come out visually squashed into ellipses. This is an
// unavoidable consequence of representing a small flat survey in a
// spherical coordinate system, not a bug in this script.
//
// WORKFLOW:
//   1. Select exactly one existing station POINT entity (e.g. one
//      created by AzimuthTraverse.js on CTRL-STATIONS) before running.
//      This point is the anchor -- everything else is transformed
//      relative to it, and it will land exactly on the coordinate you
//      enter in step 3.
//   2. Optional magnetic declination correction: if your traverse was
//      shot on magnetic north instead of true north, answer Yes and
//      enter the correction angle in degrees. Sign convention: enter
//      the value you'd ADD to a magnetic azimuth to get true azimuth
//      (e.g. if your area's declination is "3 W", enter -3; if "3 E",
//      enter +3). If you're not sure, check NOAA's declination
//      calculator for your survey's location and date -- declination
//      drifts over time, so use the value for when the survey was
//      shot, not today's value.
//   3. Paste the target coordinate exactly as Google Maps shows it for
//      a dropped pin, e.g.: 39 41'45.8"N 86 18'34.0"W
//      (degree symbol optional -- the parser accepts a plain space
//      too, in case copy/paste mangles the ° character).
//   4. Confirm the warning dialog. Nothing is changed until you do.
//
// UNITS ASSUMPTION: this script assumes your drawing is in FEET and
// already essentially true-north oriented apart from any declination
// correction you apply in step 2. If your drawing uses a different
// unit, convert FEET_PER_DRAWING_UNIT below before running.

include("scripts/EAction.js");
include("scripts/simple.js");

var FEET_PER_DRAWING_UNIT = 1.0; // change if your drawing isn't in feet

// ---- DMS parsing --------------------------------------------------------

// Parses "39 41'45.8"N 86 18'34.0"W" (degree symbol optional/mangled)
// into { lat: decimalDegrees, lon: decimalDegrees }, or null if the
// string doesn't match the expected Google Maps dropped-pin format.
function parseGoogleMapsDMS(text) {
    if (text === undefined || text === null) {
        return null;
    }
    var re = /(\d+)\D+(\d+)'([\d.]+)"?\s*([NSns])\D+(\d+)\D+(\d+)'([\d.]+)"?\s*([EWew])/;
    var m = re.exec(text);
    if (m === null) {
        return null;
    }
    function toDecimal(deg, min, sec, hemi) {
        var dec = parseFloat(deg) + parseFloat(min) / 60.0 + parseFloat(sec) / 3600.0;
        if (hemi === "S" || hemi === "s" || hemi === "W" || hemi === "w") {
            dec = -dec;
        }
        return dec;
    }
    return {
        lat: toDecimal(m[1], m[2], m[3], m[4]),
        lon: toDecimal(m[5], m[6], m[7], m[8])
    };
}

// ---- local flat-earth scale at a given latitude -------------------------

// Feet per degree of latitude/longitude at the given decimal latitude,
// using the standard NOAA local-radius-of-curvature approximation.
// Longitude spacing shrinks with latitude (cos(lat) term); latitude
// spacing itself varies slightly too, which is why both formulas have
// several terms rather than a single constant.
function feetPerDegreeAt(latDeg) {
    var lat = latDeg * Math.PI / 180.0;
    var metersPerDegLat = 111132.92 - 559.82 * Math.cos(2 * lat) +
        1.175 * Math.cos(4 * lat) - 0.0023 * Math.cos(6 * lat);
    var metersPerDegLon = 111412.84 * Math.cos(lat) - 93.5 * Math.cos(3 * lat) +
        0.118 * Math.cos(5 * lat);
    var feetPerMeter = 3.28084;
    return {
        feetPerDegLat: metersPerDegLat * feetPerMeter,
        feetPerDegLon: metersPerDegLon * feetPerMeter
    };
}

// ---- main entry point ----------------------------------------------------

function geoAnchor() {
    var doc = getDocument();
    if (doc === undefined) {
        warning("GeoAnchor: no active drawing document.");
        return;
    }

    // -- require exactly one selected point as the anchor --
    if (!doc.hasSelection()) {
        warning("GeoAnchor: select exactly one station point first, then run this tool.");
        return;
    }
    var ids = doc.querySelectedEntities();
    if (ids.length !== 1) {
        warning("GeoAnchor: select exactly ONE station point (found " + ids.length + ").");
        return;
    }
    var anchorEntity = doc.queryEntity(ids[0]);
    if (isNull(anchorEntity) || typeof anchorEntity.getPosition !== "function") {
        warning("GeoAnchor: the current selection isn't a point entity.");
        return;
    }
    var anchor = anchorEntity.getPosition();

    // -- optional declination correction --
    var declinationAnswer = QMessageBox.question(getMainWindow(), "GeoAnchor",
        "Apply a magnetic declination correction before geo-anchoring?",
        QMessageBox.Yes | QMessageBox.No);
    var declinationDeg = 0.0;
    if (declinationAnswer === QMessageBox.Yes) {
        var d = getDouble("GeoAnchor",
            "Declination correction (deg to ADD to magnetic azimuth to get true azimuth,\n" +
            "e.g. -3 for 3 deg West, +3 for 3 deg East):",
            0.0, 2, -90, 90);
        if (d === undefined) {
            return; // cancelled
        }
        declinationDeg = d;
    }

    // -- target coordinate --
    var dmsText = getText("GeoAnchor",
        "Paste the target coordinate exactly as Google Maps shows it\n" +
        "for a dropped pin (e.g. 39 41'45.8\"N 86 18'34.0\"W):", "");
    if (dmsText === undefined || dmsText === "") {
        return; // cancelled
    }
    var target = parseGoogleMapsDMS(dmsText);
    if (target === null) {
        warning("GeoAnchor: couldn't parse that coordinate. Expected format like " +
            "39 41'45.8\"N 86 18'34.0\"W.");
        return;
    }

    // -- compute local scale at the target latitude --
    var scale = feetPerDegreeAt(target.lat);
    var scaleLon = (1.0 / scale.feetPerDegLon) * FEET_PER_DRAWING_UNIT; // deg per drawing unit, X
    var scaleLat = (1.0 / scale.feetPerDegLat) * FEET_PER_DRAWING_UNIT; // deg per drawing unit, Y

    // -- final confirmation --
    var confirmMsg =
        "This will PERMANENTLY transform every entity in this drawing:\n\n" +
        "  Anchor station: (" + anchor.x.toFixed(3) + ", " + anchor.y.toFixed(3) + ")\n" +
        "  Target: " + target.lat.toFixed(6) + ", " + target.lon.toFixed(6) + "\n" +
        (declinationDeg !== 0 ? ("  Declination correction: " + declinationDeg + " deg\n") : "") +
        "  Non-uniform scale to decimal degrees (curves WILL distort)\n\n" +
        "Run this on a DUPLICATE of your file, not your working drawing.\n" +
        "Continue?";
    var confirm = QMessageBox.warning(getMainWindow(), "GeoAnchor -- confirm",
        confirmMsg, QMessageBox.Yes | QMessageBox.No);
    if (confirm !== QMessageBox.Yes) {
        return;
    }

    // -- apply to every entity in the drawing --
    // NOTE: the exact call to commit a mutated existing entity back into
    // the document varies across QCAD versions/APIs and is the one part
    // of this script I'm least certain about without testing against a
    // live QCAD instance. If this loop doesn't visibly change anything
    // (or errors out), that's the first place to look -- test on a tiny
    // 2-3 entity scratch drawing before trusting this on real survey data.
    var declinationRad = declinationDeg * Math.PI / 180.0;
    var allIds = doc.queryAllEntities(false, false);

    startTransaction(doc);
    for (var i = 0; i < allIds.length; i++) {
        var entity = doc.queryEntity(allIds[i]);
        if (isNull(entity)) {
            continue;
        }
        if (declinationRad !== 0) {
            entity.rotate(declinationRad, anchor);
        }
        entity.scale(new RVector(scaleLon, scaleLat), anchor);
        entity.move(new RVector(target.lon - anchor.x, target.lat - anchor.y));
        doc.addObject(entity);
    }
    endTransaction();

    autoZoom();
    EAction.handleUserMessage("GeoAnchor: transform complete. Anchor station now at " +
        target.lat.toFixed(6) + ", " + target.lon.toFixed(6) + ".");
}

// ============================================================
// Addon wiring -- same pattern as AzimuthTraverse.js / LRUDWalls.js.
// ============================================================

function GeoAnchor(guiAction) {
    EAction.call(this, guiAction);
}

GeoAnchor.prototype = new EAction();

GeoAnchor.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    geoAnchor();
    this.terminate();
};

GeoAnchor.init = function(basePath) {
    var action = new RGuiAction(qsTr("Geo Anchor"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/GeoAnchor.js");
    action.setStatusTip(qsTr("Translate/scale the whole drawing to a real-world lat/lon anchored on a selected station"));
    action.setDefaultCommands(["geoanchor"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(50);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
