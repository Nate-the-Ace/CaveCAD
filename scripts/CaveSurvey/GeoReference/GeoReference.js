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
//
// On a v3-tagged drawing it goes one step further: with a real
// location finally known, it reconstructs the survey and, for every
// trip whose recorded declination disagrees with the IGRF estimate
// for that trip's date by more than half a degree (and whose value
// wasn't already stamped "igrf" or read from a data file), offers to
// revise that trip's azimuths -- one question per trip, one combined
// CsRevise.apply for whatever was accepted. Legacy (pre-v3) drawings
// are never offered a revision; their reconstruction is a guess.

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

    // With a real location known at last, offer per-trip declination
    // revision on v3 surveys. Legacy reconstructions are chain-guessed
    // approximations -- never revise from a guess -- and a drawing with
    // no shots has nothing to revise; both keep the plain ending.
    var recon = CsRevise.surveyFromDocument(doc);
    if (recon.legacy === true || recon.survey.shots.length === 0) {
        QMessageBox.information(getMainWindow(), "Geo Reference", msg);
        return;
    }

    var candidates = GeoReference.tripsNeedingRevision(
        recon.survey, coord.lat, coord.lon);
    var marked = [];
    for (var ci = 0; ci < candidates.length; ci++) {
        var c = candidates[ci];
        var answer = QMessageBox.question(getMainWindow(), "Geo Reference",
            "Trip " + c.tripId + " (" + c.date +
            (c.team !== "" ? ", " + c.team : "") + "): recorded " +
            c.recorded.toFixed(2) + " deg, IGRF estimates " +
            c.igrf.toFixed(2) + " deg here. " +
            "Revise this trip's azimuths?",
            QMessageBox.Yes | QMessageBox.No);
        if (answer === QMessageBox.Yes) {
            marked.push(c);
        }
    }

    if (marked.length === 0) {
        QMessageBox.information(getMainWindow(), "Geo Reference", msg);
        return;
    }

    // CsRevise.apply's contract: recon stays the PRISTINE
    // reconstruction; the revision mutates a second reconstruction of
    // the same drawing. One apply covers every accepted trip.
    var revised = CsRevise.surveyFromDocument(doc).survey;
    for (var mi = 0; mi < marked.length; mi++) {
        CsRevise.reviseDeclination(revised, marked[mi].tripId,
            marked[mi].igrf, "igrf");
    }
    var report = CsRevise.apply(doc, getDocumentInterface(), recon, revised);
    var summary = CsReport.revisionSummary(report);
    EAction.handleUserMessage(summary);
    QMessageBox.information(getMainWindow(), "Geo Reference",
        msg + "\n\n" + summary);
}

// ============================================================
// Pure decision logic -- no Qt, no document access, so the test
// suite can exercise it headless (suite convention).
// ============================================================

/**
 * Which trips deserve an IGRF declination-revision offer once an
 * anchor at (lat, lon) is known.
 *
 * A trip qualifies when ALL of:
 *   - its declinationSource is "" or "user" (a value already stamped
 *     "igrf", or read from a survey data file, is not second-guessed),
 *   - its date parses as YYYY-MM-DD (IGRF needs a real date),
 *   - the IGRF model covers that date (declination() non-null), and
 *   - the recorded declination differs from the IGRF estimate by
 *     more than 0.5 degrees.
 *
 * \param survey CsModel survey (e.g. CsRevise.surveyFromDocument().survey)
 * \param lat    anchor latitude, degrees, north positive
 * \param lon    anchor longitude, degrees, east positive
 * \return [{tripId, recorded, igrf, date, team}] in trip-id order
 */
GeoReference.tripsNeedingRevision = function(survey, lat, lon) {
    var out = [];
    var trips = survey.trips || [];
    for (var t = 0; t < trips.length; t++) {
        var trip = trips[t];
        if (trip.declinationSource !== "" &&
                trip.declinationSource !== "user") {
            continue;
        }
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trip.date);
        if (m === null) {
            continue;
        }
        var igrf = CsGeomag.declination(lat, lon, {
            year: parseInt(m[1], 10),
            month: parseInt(m[2], 10),
            day: parseInt(m[3], 10)
        });
        if (igrf === null) {
            continue;
        }
        if (Math.abs(trip.declination - igrf.declination) > 0.5) {
            out.push({ tripId: t, recorded: trip.declination,
                igrf: igrf.declination, date: trip.date,
                team: trip.team });
        }
    }
    return out;
};

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
