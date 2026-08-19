// GeoReference.js
//
// QCAD add-on tool: pin one station to a real-world latitude/
// longitude -- WITHOUT touching the drawing's geometry.
//
// WHAT CHANGED FROM THE OLD GENERATION (GeoAnchor): the old tool
// rescaled every entity into decimal degrees in place -- destructive,
// irreversible once saved, and it squashed every arc into an ellipse.
// This one stores the anchor AS DATA on the chosen station point:
//
//   CaveSurvey/GeoLat, GeoLon, GeoStation
//
// and leaves the drawing in its survey units. Anything that needs
// real-world coordinates (KML export, the Declination tool's
// location, a future web export) computes them on the way out from
// this anchor. Nothing is lost, nothing distorts, and re-anchoring is
// just running this again.
//
// USAGE:
//   1. Select exactly one station point (the entrance is customary).
//   2. Cave Survey > Geo Reference   (or type "georef")
//   3. Paste the coordinate -- Google Maps dropped-pin DMS
//      (39 41'45.8"N 86 18'34.0"W) or decimal (39.6961, -86.3094).
//
// The tool reports the IGRF declination at that spot for the
// drawing's survey date if one is tagged -- labelled as the estimate
// it is.

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

function geoReferenceRun() {
    var doc = getDocument();
    if (doc === undefined || doc === null) {
        warning("Geo Reference: no active drawing document.");
        return;
    }

    var entity = CsPick.singleSelected(doc, "Geo Reference");
    if (entity === null) {
        return;
    }
    if (typeof entity.getPosition !== "function") {
        warning("Geo Reference: the selection isn't a point entity.\n" +
            "Select one station point (the entrance is customary).");
        return;
    }

    var stationName = CsTags.get(entity, "Station");

    var coord = CsLocationPick.ask("Geo Reference", "");
    if (coord === null) {
        return;
    }

    // the point is already in the document -- a modify operation is
    // what actually persists the tags (transaction-wrapped property
    // writes fail silently in this bridge)
    CsTags.commit(getDocumentInterface(), entity, {
        GeoLat: coord.lat,
        GeoLon: coord.lon,
        GeoStation: stationName !== "" ? stationName : "anchor"
    });
    CsLocationPick.remember(coord);

    var msg = "Geo Reference: anchor stored on " +
        (stationName !== "" ? ("station " + stationName) : "the selected point") +
        " at " + coord.lat.toFixed(6) + ", " + coord.lon.toFixed(6) + ".\n" +
        "The drawing's geometry was NOT changed -- exports compute " +
        "real-world coordinates from this anchor.";

    // A courtesy: the IGRF declination for this spot, using the tagged
    // survey date when there is one.
    var dateText = CsTags.get(entity, "SurveyDate");
    var dateParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
    if (dateParts !== null) {
        var igrf = CsGeomag.declination(coord.lat, coord.lon, {
            year: parseInt(dateParts[1], 10),
            month: parseInt(dateParts[2], 10),
            day: parseInt(dateParts[3], 10)
        });
        if (igrf !== null) {
            msg += "\n\n" + CsReport.igrfLine(igrf, coord.lat, coord.lon, dateText);
        }
    } else {
        msg += "\n\nTip: the Declination tool can now estimate the " +
            "declination here for any survey date since 1900 (IGRF).";
    }

    QMessageBox.information(getMainWindow(), "Geo Reference", msg);
}

// ============================================================
// Add-on wiring -- the standard pattern; see docs.
// ============================================================

function GeoReference(guiAction) {
    EAction.call(this, guiAction);
}

GeoReference.prototype = new EAction();

GeoReference.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    geoReferenceRun();
    this.terminate();
};

GeoReference.init = function(basePath) {
    var action = new RGuiAction(qsTr("Geo Reference"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/GeoReference.js");
    action.setIcon(basePath + "/GeoReference.svg");
    action.setStatusTip(qsTr("Pin a station to a real latitude/longitude as data -- no destructive rescaling"));
    action.setDefaultCommands(["georeference", "georef"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(50);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
