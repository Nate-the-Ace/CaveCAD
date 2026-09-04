// EditTrip.js
//
// QCAD add-on tool: correct a trip's name, date, team and instruments
// after the trip has been drawn.
//
// Typed once in the Survey Notebook header, these four fields were
// uncorrectable. The path that looks like it should work forks the
// cave: Survey Notebook's "Load from drawing" replaces the trip whose
// FINGERPRINT (date | team) matches the page, so editing either field
// means nothing matches and the page lands as a brand new trip beside
// the old one. This tool edits by TRIP ID instead, which is what makes
// a typo fix a typo fix.
//
// It moves nothing. No geometry, elevation, LRUD, linework binding or
// profile depends on these fields, so there is no redraw, no resolve
// and no backup -- one modify operation over one point per trip.
//
// Declination is shown but not editable here. Changing it rotates every
// azimuth and moves the whole plan, and it already has an editor with
// the IGRF wiring: Survey Notebook's Declination dialog.
//
// USAGE:
//   Cave Survey > Edit Trip   (or type "et")

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

/**
 * Reads the drawing's trips, or explains why it cannot.
 * \return {ok, rows, survey, error}
 */
EditTrip.read = function(doc) {
    var recon;
    try {
        recon = CsRevise.surveyFromDocument(doc);
    } catch (e) {
        return { ok: false, rows: [], survey: null,
            error: "Edit Trip: could not read this drawing's survey (" +
                e + ")." };
    }
    if (recon === null || recon === undefined ||
            recon.survey === null || recon.survey === undefined) {
        return { ok: false, rows: [], survey: null,
            error: "Edit Trip: no survey in this drawing." };
    }
    if (recon.legacy === true) {
        // A legacy drawing's trips are CHAIN-GUESSED, not read off
        // anchor tags -- there is nothing to write an edit onto, and
        // an edit that appeared to work and vanished on reopen would
        // be worse than a refusal.
        return { ok: false, rows: [], survey: null,
            error: "Edit Trip: this drawing predates the current tag " +
                "schema, so its trips are reconstructed rather than " +
                "recorded, and there is nowhere to store an edit. Run " +
                "Rebuild Survey Data first -- it upgrades the tags in " +
                "place -- then try again." };
    }
    var rows = CsTripEdit.rows(recon.survey);
    if (rows.length === 0) {
        return { ok: false, rows: [], survey: null,
            error: "Edit Trip: this drawing has no trips yet." };
    }
    return { ok: true, rows: rows, survey: recon.survey, error: "" };
};

/** Which trip ids actually have an anchor point to write onto. */
EditTrip.anchoredTrips = function(doc) {
    var out = {};
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || CsTags.get(e, "Station") === "" ||
                typeof e.getPosition !== "function") {
            continue;
        }
        var tid = CsTags.getNumber(e, "Trip");
        if (tid !== null) {
            out[tid] = true;
        }
    }
    return out;
};

/** Upper-cases as typed, the same as the Notebook's header fields --
 *  station names, teams and instruments are upper case throughout the
 *  suite, and a lower-case correction would stand out on the map. */
EditTrip.upperCase = function(edit) {
    try {
        edit.textEdited.connect(function() {
            var t = String(edit.text);
            var u = t.toUpperCase();
            if (u !== t) {
                var pos = edit.cursorPosition;
                edit.text = u;
                try {
                    edit.cursorPosition = pos;
                } catch (eCur) {
                    // cursor jumps to the end -- cosmetic
                }
            }
        });
    } catch (e) {
        // no auto-caps; typing still works
    }
    return edit;
};

/** The summary line after a successful edit. */
EditTrip.reportText = function(changes, res) {
    if (changes.length === 0) {
        return "Edit Trip: nothing changed.";
    }
    var msg = "Edit Trip: " + changes.length + " trip" +
        (changes.length === 1 ? "" : "s") + " updated (";
    var parts = [];
    for (var i = 0; i < changes.length; i++) {
        parts.push("trip " + changes[i].tripId);
    }
    msg += parts.join(", ") + "). Tags only -- nothing was moved or " +
        "redrawn.";
    if (res.missing.length > 0) {
        msg += " Trip " + res.missing.join(", trip ") + " has no " +
            "station in the drawing to carry its metadata, so that " +
            "edit could not be stored.";
    }
    if (CsTripEdit.dateChanged(changes)) {
        msg += " A changed date means the trip's declination was " +
            "estimated for the wrong day: check it in Survey " +
            "Notebook > Declination.";
    }
    return msg;
};

function editTripRun() {
    var doc = getDocument();
    if (doc === undefined || doc === null) {
        warning("Edit Trip: no active drawing document.");
        return;
    }
    var di = getDocumentInterface();

    var read = EditTrip.read(doc);
    if (!read.ok) {
        EAction.handleUserMessage(read.error);
        return;
    }
    var anchored = EditTrip.anchoredTrips(doc);

    var dlg = new QDialog(getMainWindow());
    dlg.windowTitle = "Edit Trip";
    var layout = new QVBoxLayout();

    layout.addWidget(new QLabel(
        "The trips in this drawing. Correct a name, date, team or\n" +
        "instrument list here -- the edit lands on the trip you edit,\n" +
        "not on a new copy of it, and nothing is moved or redrawn.\n" +
        "Declination is not edited here: changing it rotates the plan,\n" +
        "so it lives in Survey Notebook > Declination."), 0, 0);

    var host = new QWidget();
    var grid = new QGridLayout();
    var head = ["Trip", "Shots", "Declination", "Name", "Date (YYYY-MM-DD)",
        "Team", "Instruments"];
    for (var h = 0; h < head.length; h++) {
        grid.addWidget(new QLabel(head[h]), 0, h);
    }

    var fields = []; // {tripId, name, date, team, instruments}
    for (var r = 0; r < read.rows.length; r++) {
        var row = read.rows[r];
        var g = r + 1;
        grid.addWidget(new QLabel(row.label), g, 0);
        grid.addWidget(new QLabel(String(row.shots)), g, 1);
        grid.addWidget(new QLabel(CsRevise.declText(row.declination)),
            g, 2);

        var editable = anchored[row.tripId] === true;
        // Explicit widths: without them the grid shrinks every field to
        // its neighbours' size and a team reads ")S, JB" -- measured in
        // the real dialog, where the columns collapsed to a few
        // characters each.
        var mk = function(text, caps, width) {
            var e = new QLineEdit();
            e.text = text;
            try {
                e.setMinimumWidth(width);
                // A long team list fills the field and shows its TAIL
                // ("...NEGG, TIM HARRIS"), which reads as the wrong
                // name until you click into it. Show the start.
                e.setCursorPosition(0);
            } catch (eW) {
                // the field is still usable, just narrow
            }
            if (!editable) {
                try {
                    e.readOnly = true;
                    e.enabled = false;
                } catch (eRo) {
                    // cosmetic only; the write is gated below anyway
                }
            } else if (caps) {
                EditTrip.upperCase(e);
            }
            return e;
        };
        var nameEdit = mk(row.name, true, 150);
        var dateEdit = mk(row.date, false, 120);
        var teamEdit = mk(row.team, true, 240);
        var instrEdit = mk(row.instruments, true, 180);
        grid.addWidget(nameEdit, g, 3);
        grid.addWidget(dateEdit, g, 4);
        grid.addWidget(teamEdit, g, 5);
        grid.addWidget(instrEdit, g, 6);

        if (editable) {
            fields.push({ tripId: row.tripId, name: nameEdit,
                date: dateEdit, team: teamEdit, instruments: instrEdit });
        } else {
            var why = new QLabel("no station in the drawing carries " +
                "this trip's tags");
            why.enabled = false;
            grid.addWidget(why, g, 7);
        }
    }
    host.setLayout(grid);

    var area = new QScrollArea();
    area.widgetResizable = true;
    area.setWidget(host);
    layout.addWidget(area, 1, 0);

    var buttons = new QHBoxLayout();
    var okButton = new QPushButton(qsTr("Apply"));
    var cancelButton = new QPushButton(qsTr("Cancel"));
    buttons.addStretch(1);
    buttons.addWidget(okButton, 0, 0);
    buttons.addWidget(cancelButton, 0, 0);
    layout.addLayout(buttons, 0);
    dlg.setLayout(layout);

    // The scroll area will happily scroll a table nobody can read: a
    // dialog sized to its own layout hint comes up ~600px wide and cuts
    // Team and Instruments off entirely (measured in the real dialog).
    // Open it wide enough to show every column, and let the scroll area
    // take over from there -- vertically for a cave with many trips,
    // horizontally on a small screen.
    try {
        dlg.resize(1040, Math.min(620, 220 + read.rows.length * 46));
    } catch (eSize) {
        // the layout's own size stands; the columns scroll
    }

    // Applied INSIDE the accept handler, not after exec(), so a
    // refusal can leave the dialog open with the caver's typing still
    // in it -- retyping four fields because one date had a typo is the
    // kind of thing that stops a tool being used. The widget text is
    // snapshotted here too, while the widgets are certainly alive.
    var applied = { done: false, changes: [], res: null };
    var onOk = function() {
        var inputs = [];
        for (var i = 0; i < fields.length; i++) {
            var f = fields[i];
            inputs.push({ tripId: f.tripId, name: String(f.name.text),
                date: String(f.date.text), team: String(f.team.text),
                instruments: String(f.instruments.text) });
        }
        var plan = CsTripEdit.planEdits(read.survey, inputs);
        if (plan.error !== undefined) {
            QMessageBox.warning(null, "Edit Trip", plan.error);
            return; // dialog stays open, typing intact
        }
        if (plan.changes.length === 0) {
            applied.done = true;
            dlg.accept();
            return;
        }
        CsTripEdit.applyToSurvey(read.survey, plan.changes);
        applied.res = CsTripEdit.writeTags(doc, di, read.survey,
            plan.changes);
        applied.changes = plan.changes;
        applied.done = true;
        dlg.accept();
    };

    // One failed connect on either button is an unusable dialog -- an
    // Apply that does nothing, or a Cancel that cannot close. Say so
    // rather than showing it.
    var wired = true;
    try {
        okButton.clicked.connect(onOk);
    } catch (eOk) {
        wired = false;
    }
    try {
        cancelButton.clicked.connect(function() { dlg.reject(); });
    } catch (eCancel) {
        wired = false;
    }
    if (!wired) {
        QMessageBox.warning(null, "Edit Trip",
            "This build's script bridge couldn't wire the dialog " +
            "buttons. Nothing was changed.");
        return;
    }

    dlg.exec();

    if (!applied.done) {
        return; // cancelled
    }
    if (applied.res === null) {
        EAction.handleUserMessage("Edit Trip: nothing changed.");
        return;
    }
    EAction.handleUserMessage(
        EditTrip.reportText(applied.changes, applied.res));
}

// ============================================================
// Add-on wiring -- the standard pattern; see docs.
// ============================================================

function EditTrip(guiAction) {
    EAction.call(this, guiAction);
}

EditTrip.prototype = new EAction();

EditTrip.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    editTripRun();
    this.terminate();
};

EditTrip.init = function(basePath) {
    var action = new RGuiAction(qsTr("Edit Trip"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/EditTrip.js");
    action.setIcon(basePath + "/EditTrip.svg");
    action.setStatusTip(qsTr("Correct a trip's name, date, team or instruments without redrawing anything"));
    action.setDefaultCommands(["edittrip", "et"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(16);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
