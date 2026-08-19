// Declination.js
//
// QCAD add-on tool: estimate the magnetic declination for a place and
// a date -- including dates long before anyone wrote it in the notes.
//
// Old surveys rarely record the declination in force on the day.
// This tool evaluates the IGRF model (1900 to present, public-domain
// coefficients, see Core/Geomag.js) for any latitude/longitude and
// date, and reports the value with its sign convention spelled out
// both ways: "3.2 deg E" and "add +3.2 to magnetic azimuths".
//
// If the drawing has a Geo Reference anchor, its location is offered
// as the default. The result is an ESTIMATE and is always labelled as
// one -- but IGRF error is a fraction of a degree over most of the
// century, noise next to any hand-held compass.
//
// USAGE:
//   Cave Survey > Declination   (or type "decl")

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

function declinationRun() {
    var doc = getDocument();

    // ---- location: whatever the suite already knows prefills the
    // prompt (drawing anchor first, then the last declared anywhere)
    var coord = CsLocationPick.ask("Declination", "");
    if (coord === null) {
        return;
    }

    // ---- date -------------------------------------------------------
    var dateText = getText("Declination",
        "Survey date (YYYY-MM-DD -- the day the shots were taken, " +
        "not today; declination drifts over the years):", "");
    if (dateText === undefined || dateText === "") {
        return;
    }
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(dateText);
    if (m === null) {
        warning("Declination: date must be YYYY-MM-DD.");
        return;
    }
    var date = { year: parseInt(m[1], 10), month: parseInt(m[2], 10),
        day: parseInt(m[3], 10) };

    var result = CsGeomag.declination(coord.lat, coord.lon, date);
    if (result === null) {
        warning("Declination: " + date.year + " is before 1900, outside " +
            "the IGRF model. Enter the declination by hand for older work.");
        return;
    }

    var d = result.declination;
    var msg = CsReport.igrfLine(result, coord.lat, coord.lon, dateText) +
        "\n\nWhat to do with it:\n" +
        "  true azimuth = magnetic azimuth " +
        (d >= 0 ? "+ " : "- ") + Math.abs(d).toFixed(1) + "\n" +
        "  (east declination positive -- the suite's convention " +
        "everywhere)\n\n" +
        "The importers apply a file's declared declination themselves; " +
        "use this value when the notes never recorded one.";

    QMessageBox.information(getMainWindow(), "Declination", msg);
    EAction.handleUserMessage("Declination at " + coord.lat.toFixed(4) + ", " +
        coord.lon.toFixed(4) + " on " + dateText + ": " +
        CsAngles.formatDeclination(d) + " (IGRF estimate)");
}

// ============================================================
// Add-on wiring -- the standard pattern; see docs.
// ============================================================

function Declination(guiAction) {
    EAction.call(this, guiAction);
}

Declination.prototype = new EAction();

Declination.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    declinationRun();
    this.terminate();
};

Declination.init = function(basePath) {
    var action = new RGuiAction(qsTr("Declination"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(false); // works with no drawing open
    action.setScriptFile(basePath + "/Declination.js");
    action.setIcon(basePath + "/Declination.svg");
    action.setStatusTip(qsTr("Estimate magnetic declination for any location and date since 1900 (IGRF)"));
    action.setDefaultCommands(["declination", "decl"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(55);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
