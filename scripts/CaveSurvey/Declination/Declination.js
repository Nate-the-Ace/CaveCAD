// Declination.js
//
// QCAD add-on tool: magnetic declination, two modes.
//
// ESTIMATE (no drawing open, or the drawing carries no tagged
// survey): evaluate the IGRF model (1900 to present, public-domain
// coefficients, see Core/CsGeomag.js) for any latitude/longitude and
// date, and report the value with its sign convention spelled out
// both ways: "3.2 deg E" and "add +3.2 to magnetic azimuths". Old
// surveys rarely record the declination in force on the day; this
// answers it for them. The result is an ESTIMATE and is always
// labelled as one -- but IGRF error is a fraction of a degree over
// most of the century, noise next to any hand-held compass.
//
// REVISE (the drawing carries a v3-tagged survey): show every trip
// with its recorded declination, let the user drop in the correct
// value per trip -- typed, or filled from IGRF when the drawing is
// geo-referenced and the trip has a date -- and apply the revision
// through CsRevise: azimuths rotate by the difference, the drawing
// redraws (rigidly when it can), and the change lands in the
// RevisionLog. Legacy (pre-v3) tagged drawings are directed to
// Rebuild Survey Data first; their reconstruction is a guess and
// revising a guess is how drawings drift.
//
// USAGE:
//   Cave Survey > Declination   (or type "decl")

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

// ---------------------------------------------------------------------
// Estimate mode -- the original flow, untouched.
// ---------------------------------------------------------------------

function declinationEstimate() {
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
    var date = Declination.parseIsoDate(dateText);
    if (date === null) {
        warning("Declination: date must be YYYY-MM-DD.");
        return;
    }

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

// ---------------------------------------------------------------------
// Revision mode -- one dialog, one CsRevise.apply.
// ---------------------------------------------------------------------

/**
 * The per-trip revision dialog over a v3-tagged survey. GUI only:
 * every decision (what changed, what source, what's invalid) is made
 * by Declination.parseTripEdits over plain data snapshotted from the
 * widgets, so the logic stays headlessly testable.
 */
function declinationRevise(doc, recon) {
    CsModel.ensureTrips(recon.survey);
    var trips = recon.survey.trips;

    // IGRF fills only from the DRAWING'S OWN geo reference -- a
    // remembered location from some other cave would be silently
    // wrong here. CsLocationPick.getShared scans the entities for
    // GeoLat/GeoLon and labels a hit source:"anchor".
    var geo = CsLocationPick.getShared(doc);
    if (geo !== null && geo.source !== "anchor") {
        geo = null;
    }

    // one connect failure on a critical control = unusable dialog
    var connectOk = function(signal, fn) {
        try {
            signal.connect(fn);
            return true;
        } catch (e) {
            return false;
        }
    };

    var state = { accepted: false, rowsData: null };
    var rows = []; // {tripId, recorded, edit, igrfText}
    var dlg;

    try {
        dlg = new QDialog(getMainWindow());
        dlg.windowTitle = "Declination";
        var layout = new QVBoxLayout();

        var intro = new QLabel(
            "This drawing carries a tagged survey. Drop in the correct\n" +
            "declination per trip (degrees, east positive) and the\n" +
            "drawing adjusts: azimuths rotate by the difference.\n" +
            "IGRF fills the estimate for a trip's date -- it needs a\n" +
            "Geo Reference in the drawing and a YYYY-MM-DD trip date.");
        layout.addWidget(intro, 0, 0);

        var grid = new QGridLayout();
        grid.addWidget(new QLabel("Trip"), 0, 0);
        grid.addWidget(new QLabel("Recorded"), 0, 1);
        grid.addWidget(new QLabel("New declination"), 0, 2);

        for (var t = 0; t < trips.length; t++) {
            var trip = trips[t];
            var gridRow = t + 1;
            grid.addWidget(new QLabel(Declination.tripLabel(t, trip)),
                gridRow, 0);
            grid.addWidget(new QLabel(Declination.recordedText(trip)),
                gridRow, 1);

            var edit = new QLineEdit();
            edit.text = Declination.declText(trip.declination);
            grid.addWidget(edit, gridRow, 2);

            var row = { tripId: t, recorded: trip.declination,
                edit: edit, igrfText: "" };
            rows.push(row);

            var igrfBtn = new QPushButton("IGRF");
            var tripDate = Declination.parseIsoDate(trip.date);
            if (geo !== null && tripDate !== null) {
                igrfBtn.toolTip = "Fill the IGRF estimate for " +
                    trip.date + " at the drawing's geo reference.";
                // closure per row -- capture row and date now
                (function(r, d) {
                    connectOk(igrfBtn.clicked, function() {
                        var res = CsGeomag.declination(geo.lat, geo.lon, d);
                        if (res === null) {
                            warning("Declination: " + d.year +
                                " is before 1900, outside the IGRF model.");
                            return;
                        }
                        // 2 decimals is the suite-wide IGRF-apply
                        // convention -- GeoReference.js's own revision
                        // offer rounds to the same precision before it
                        // ever reaches reviseDeclination (see its
                        // tripsNeedingRevision comment). Keeping both
                        // tools at 2 decimals means a trip revised by
                        // one reads back as unchanged in the other.
                        var txt = res.declination.toFixed(2);
                        r.edit.text = txt;
                        r.igrfText = txt;
                    });
                })(row, tripDate);
            } else {
                try {
                    igrfBtn.enabled = false;
                    igrfBtn.toolTip = geo === null ?
                        "No geo reference in this drawing -- run Geo " +
                        "Reference (georef) to enable IGRF fills." :
                        "This trip's date isn't YYYY-MM-DD, so IGRF " +
                        "can't be evaluated for it.";
                } catch (eDis) {
                    // stays enabled but clicking is wired to nothing
                }
            }
            grid.addWidget(igrfBtn, gridRow, 3);
        }
        layout.addLayout(grid, 0);

        var buttons = new QHBoxLayout();
        buttons.addStretch(1);
        var applyBtn = new QPushButton("Apply");
        var cancelBtn = new QPushButton("Cancel");
        buttons.addWidget(applyBtn, 0, 0);
        buttons.addWidget(cancelBtn, 0, 0);
        layout.addLayout(buttons, 0);

        dlg.setLayout(layout);

        var wired = connectOk(applyBtn.clicked, function() {
            // snapshot the widgets into plain data HERE, while they
            // are certainly alive; decisions happen after exec()
            var data = [];
            for (var i = 0; i < rows.length; i++) {
                data.push({ tripId: rows[i].tripId,
                    recorded: rows[i].recorded,
                    text: String(rows[i].edit.text),
                    igrfText: rows[i].igrfText });
            }
            state.rowsData = data;
            state.accepted = true;
            dlg.accept();
        });
        wired = connectOk(cancelBtn.clicked, function() {
            dlg.reject();
        }) && wired;
        if (!wired) {
            warning("Declination: this build's script bridge couldn't " +
                "wire the dialog buttons. Nothing was changed.");
            return;
        }

        dlg.exec();
    } catch (eDlg) {
        warning("Declination: couldn't build the revision dialog (" +
            eDlg + "). Nothing was changed.");
        return;
    }

    if (!state.accepted || state.rowsData === null) {
        return; // cancelled
    }

    // ---- decide (pure) ------------------------------------------------
    var decision = Declination.parseTripEdits(state.rowsData);
    if (decision.error !== undefined) {
        warning("Declination: " + decision.error);
        return;
    }
    if (decision.changes.length === 0) {
        QMessageBox.information(getMainWindow(), "Declination",
            "No declination changes.");
        return;
    }

    // ---- apply ----------------------------------------------------------
    // CsRevise.apply diffs the OLD model against the NEW: it needs a
    // PRISTINE reconstruction for its recon argument. reviseDeclination
    // mutates in place, so reconstruct a second time (the document is
    // untouched since the first scan -- the two are identical) and
    // mutate only the copy the dialog was built from.
    var pristine;
    try {
        pristine = CsRevise.surveyFromDocument(doc);
    } catch (ePr) {
        warning("Declination: couldn't re-read the survey (" + ePr +
            "). Nothing was changed.");
        return;
    }

    for (var c = 0; c < decision.changes.length; c++) {
        var ch = decision.changes[c];
        CsRevise.reviseDeclination(recon.survey, ch.tripId, ch.value,
            ch.source);
    }

    var report;
    try {
        report = CsRevise.apply(doc, getDocumentInterface(), pristine,
            recon.survey);
    } catch (eAp) {
        warning("Declination: applying the revision failed (" + eAp +
            "). If the drawing looks half-moved, undo restores it.");
        return;
    }

    var summary = CsReport.revisionSummary(report);
    EAction.handleUserMessage(summary);
    QMessageBox.information(getMainWindow(), "Declination", summary);
}

// ---------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------

function declinationRun() {
    var doc = getDocument();

    var recon = null;
    if (doc !== undefined && doc !== null) {
        try {
            recon = CsRevise.surveyFromDocument(doc);
        } catch (eRe) {
            recon = null; // unreadable tags -- the estimate still works
        }
    }

    // no drawing, or a drawing with no tagged survey in it: an
    // untagged document reconstructs to zero shots with legacy false
    if (recon === null ||
            (recon.legacy !== true && recon.survey.shots.length === 0)) {
        declinationEstimate();
        return;
    }

    // pre-v3 tags: the reconstruction is a chain-guess; revising a
    // guess silently corrupts drawings, so refuse and point the way
    if (recon.legacy === true) {
        QMessageBox.information(getMainWindow(), "Declination",
            "This drawing's survey predates the exact tag schema, so " +
            "its shots can't be revised safely from what's stored.\n\n" +
            "Run Rebuild Survey Data (command: rebuildsurveydata) " +
            "first -- it upgrades the tags in place -- then run " +
            "Declination again to revise per trip.");
        return;
    }

    declinationRevise(doc, recon);
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

// ---------------------------------------------------------------------
// Pure decision helpers -- no GUI, no document access; testable
// headless. (Declination is a function declaration, hoisted, so
// attaching these below the wiring block is safe.)
// ---------------------------------------------------------------------

/** "YYYY-MM-DD" -> {year, month, day}, or null. */
Declination.parseIsoDate = function(text) {
    if (text === undefined || text === null) {
        return null;
    }
    var s = String(text).replace(/^\s+|\s+$/g, "");
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (m === null) {
        return null;
    }
    return { year: parseInt(m[1], 10), month: parseInt(m[2], 10),
        day: parseInt(m[3], 10) };
};

/** A declination as dialog text: "3.5", "0.0", "-4.25". */
Declination.declText = function(value) {
    var n = Number(value);
    if (isNaN(n)) {
        return "0.0";
    }
    var s = String(Math.round(n * 10000) / 10000);
    if (s.indexOf(".") < 0 && s.indexOf("e") < 0 && s.indexOf("E") < 0) {
        s += ".0";
    }
    return s;
};

/** 'Trip 1: ENTRANCE SERIES 2024-03-02 AB, CD' -- blanks drop out. */
Declination.tripLabel = function(tripId, trip) {
    var parts = ["Trip " + tripId + ":"];
    if (trip.name !== undefined && trip.name !== null && trip.name !== "") {
        parts.push(String(trip.name));
    }
    if (trip.date !== undefined && trip.date !== null && trip.date !== "") {
        parts.push(String(trip.date));
    }
    if (trip.team !== undefined && trip.team !== null && trip.team !== "") {
        parts.push(String(trip.team));
    }
    return parts.length === 1 ? "Trip " + tripId : parts.join(" ");
};

/** The recorded value + where it came from: "0.0 (file)". */
Declination.recordedText = function(trip) {
    var src = trip.declinationSource;
    if (src === undefined || src === null || src === "") {
        src = "unrecorded";
    }
    return Declination.declText(trip.declination) + " (" + src + ")";
};

/**
 * The revision decisions, from plain data snapshotted off the dialog.
 *
 * \param rows [{tripId, recorded, text, igrfText}] --
 *   recorded  the trip's recorded declination (number)
 *   text      the field's text on Apply
 *   igrfText  the exact string the IGRF button last filled ("" if never)
 * \return { changes: [{tripId, value, source}] } for every field whose
 *         text no longer reads as the prefilled declText(recorded) --
 *         source "igrf" when the text still exactly matches the IGRF
 *         fill, "user" otherwise -- OR { error: "..." } when any field
 *         holds something unparseable (a prefilled field always holds
 *         a valid number, so junk is always an edit gone wrong; the
 *         caller must apply NOTHING).
 */
Declination.parseTripEdits = function(rows) {
    var changes = [];
    for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var text = String(r.text === undefined || r.text === null ?
            "" : r.text).replace(/^\s+|\s+$/g, "");
        if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text)) {
            return { error: "Trip " + r.tripId + ": \"" + text +
                "\" is not a number (degrees, east positive). " +
                "Nothing was changed." };
        }
        var value = parseFloat(text);
        if (!isFinite(value)) {
            return { error: "Trip " + r.tripId + ": \"" + text +
                "\" is not a usable number. Nothing was changed." };
        }
        // Unchanged means "still reads as what we prefilled", NOT
        // "equals the recorded double". The prefill is
        // declText(recorded) -- 4 decimals -- so a recorded
        // declination carrying more precision than that can never
        // round-trip a raw comparison: reopening this dialog and
        // pressing Apply with no edits would manufacture a ~1e-5 deg
        // "revision", append a junk RevisionLog line, and downgrade
        // the trip's declinationSource from igrf to user. Compare at
        // the precision the dialog actually shows -- both revision
        // tools apply IGRF at 2 decimals, well inside it.
        var shown = Declination.declText(r.recorded);
        if (text === shown || Math.abs(value - Number(shown)) <= 1e-9) {
            continue;
        }
        var source = (r.igrfText !== undefined && r.igrfText !== null &&
            r.igrfText !== "" && text === r.igrfText) ? "igrf" : "user";
        changes.push({ tripId: r.tripId, value: value, source: source });
    }
    return { changes: changes };
};
