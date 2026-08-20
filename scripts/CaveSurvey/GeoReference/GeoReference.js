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
//      (40 30'15.0"N 90 15'30.0"W) or decimal (40.5042, -90.2583).
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
    //
    // Everything below this point is a BONUS on top of the anchor
    // that's ALREADY COMMITTED above -- the tags were written and
    // msg already describes that success. So every CsRevise/Qt call
    // from here down is wrapped (matching Declination.js's own
    // try/catch around the same calls): a throw must fall through to
    // the plain anchor-stored message, never lose it.
    var recon;
    try {
        recon = CsRevise.surveyFromDocument(doc);
    } catch (eRe) {
        warning("Geo Reference: couldn't re-read the survey for a " +
            "declination-revision offer (" + eRe + "). The anchor " +
            "above was still stored.");
        QMessageBox.information(getMainWindow(), "Geo Reference", msg);
        return;
    }
    if (recon.legacy === true || recon.survey.shots.length === 0) {
        QMessageBox.information(getMainWindow(), "Geo Reference", msg);
        return;
    }

    var candidates = GeoReference.tripsNeedingRevision(
        recon.survey, coord.lat, coord.lon);
    var marked = [];
    for (var ci = 0; ci < candidates.length; ci++) {
        var c = candidates[ci];
        var answer;
        try {
            // IGRF is shown at 2 decimals here because that's the
            // precision reviseDeclination is actually handed below --
            // see the rounding comment in tripsNeedingRevision.
            answer = QMessageBox.question(getMainWindow(), "Geo Reference",
                "Trip " + c.tripId + " (" + c.date +
                (c.team !== "" ? ", " + c.team : "") + "): recorded " +
                c.recorded.toFixed(2) + " deg, IGRF estimates " +
                c.igrf.toFixed(2) + " deg here. " +
                "Revise this trip's azimuths?",
                QMessageBox.Yes | QMessageBox.No);
        } catch (eQ) {
            warning("Geo Reference: couldn't show the revision prompt " +
                "for trip " + c.tripId + " (" + eQ + "). Skipping it; " +
                "the anchor above was still stored.");
            continue;
        }
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
    var revised;
    try {
        revised = CsRevise.surveyFromDocument(doc).survey;
        for (var mi = 0; mi < marked.length; mi++) {
            CsRevise.reviseDeclination(revised, marked[mi].tripId,
                marked[mi].igrf, "igrf");
        }
    } catch (eRv) {
        warning("Geo Reference: couldn't prepare the declination " +
            "revision (" + eRv + "). Nothing further was changed; the " +
            "anchor above was still stored.");
        QMessageBox.information(getMainWindow(), "Geo Reference", msg);
        return;
    }

    var report;
    try {
        report = CsRevise.apply(doc, getDocumentInterface(), recon, revised);
    } catch (eAp) {
        warning("Geo Reference: applying the declination revision " +
            "failed (" + eAp + "). If the drawing looks half-moved, " +
            "undo restores it. The anchor above was still stored.");
        QMessageBox.information(getMainWindow(), "Geo Reference", msg);
        return;
    }
    var summary = CsReport.revisionSummary(report);
    EAction.handleUserMessage(summary);
    QMessageBox.information(getMainWindow(), "Geo Reference",
        msg + "\n\n" + summary);
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

// ---------------------------------------------------------------------
// Pure decision logic -- MOVED to CsRevise.
//
// The proactive offer below the anchor -- "your 1998 trips are 2.5 deg
// off, revise them?" -- now also fires from the Survey Notebook, right
// after IT stores an anchor, and this tool is on its way out. The
// decision about which trips are worth offering went where both
// callers can reach it and where it survives the deletion of this
// folder: CsRevise, beside the revision math it serves. This name
// stays a thin alias so the call site above keeps working meanwhile --
// ONE implementation, no second copy to drift. (GeoReference is a
// function declaration, hoisted, so attaching it below the wiring
// block is safe.)
// ---------------------------------------------------------------------

GeoReference.tripsNeedingRevision = CsRevise.tripsNeedingRevision;
