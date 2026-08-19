// SurveyNotebook.js
//
// QCAD add-on tool: the Survey Notebook -- a docked panel laid out
// like a paper survey notes page. Type shots into the table, watch
// the stats, closures and warnings update as you type, then Draw the
// survey into the drawing in one undo step.
//
//   +-- Survey Notebook ------------------------------------+
//   | Survey [......] Date [YYYY-MM-DD] Team [............] |
//   | Declination [0.0] (E+)  [Infer from date+location]    |
//   |-------------------------------------------------------|
//   | From | To | Dist | Azm | Inc | L | R | U | D | Notes  |
//   |  ... table rows, column order = the notes page ...    |
//   | [+ Shot] [- Shot]                                     |
//   |-------------------------------------------------------|
//   | warnings / loop closures / stats (live)               |
//   | [Draw]  [Import File...]  [Export File...]            |
//   +-------------------------------------------------------+
//
// CONVENTIONS shown in the header row so nothing is guessed:
// azimuth clockwise from north (TRUE bearing -- declination has
// already been applied to what you type here, or type magnetic and
// use Infer/enter declination first); distance is slope; L/R face
// travel; LRUD belongs to the To station; blank LRUD = not measured.
//
// Validation is ADVISORY: a suspect row gets a warning line below
// the table, never a blocked entry -- the surveyor is the authority
// on their own notes.
//
// Import fills the table from any supported file (format detected);
// Export writes the table to Compass/Walls/Survex/CSV. Draw plots
// the survey (anchored on a selected station, a *fix, or 0,0) as one
// undo step -- draw again after edits and undo the old one, or work
// in a fresh document per revision.
//
// The Infer button estimates declination from the survey date and
// the drawing's Geo Reference anchor (or a typed location) via IGRF
// (1900+, see Core/Geomag.js), labelled as the estimate it is.

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/All.js");

// COMPATIBILITY: the QJSEngine widget bridge exposes a slightly
// different method set from build to build (e.g. QTableWidget's
// setHorizontalHeaderLabels is missing before ~3.33). So the panel
// PROBES the bridge at startup: full table mode when the table API
// answers, otherwise a text-sheet mode -- one shot per line in the
// suite's CSV column order, parsed by the same Core CSV reader --
// so the Notebook works on every build rather than dying on the
// newest method it touched.
//
// The dock is a singleton across invocations; QCAD keeps the script
// engine alive, so a global holds it.
var csNotebookDock = csNotebookDock || undefined;

function SurveyNotebook(guiAction) {
    EAction.call(this, guiAction);
}

SurveyNotebook.prototype = new EAction();

SurveyNotebook.COLUMNS = ["From", "To", "Dist", "Azm", "Inc",
    "L", "R", "U", "D", "Notes"];

/**
 * True when this build's script bridge supports everything table mode
 * needs. Probed once with a throwaway table, so a missing method means
 * a graceful fallback instead of a dead panel.
 */
SurveyNotebook.tableSupported = function() {
    if (typeof QTableWidget === "undefined" ||
        typeof QTableWidgetItem === "undefined") {
        return false;
    }
    try {
        var t = new QTableWidget(1, 2);
        t.setItem(0, 0, new QTableWidgetItem("probe"));
        if (String(t.item(0, 0).text()) !== "probe") {
            return false;
        }
        t.insertRow(1);
        t.removeRow(1);
        if (t.rowCount !== 1) {
            return false;
        }
        SurveyNotebook.setHeaders(t, ["a", "b"]);
        return true;
    } catch (e) {
        return false;
    }
};

/** Sets column headers, tolerating older bridges; headers are a
 *  nicety, so total failure is silently accepted. */
SurveyNotebook.setHeaders = function(table, labels) {
    try {
        table.setHorizontalHeaderLabels(labels);
        return;
    } catch (e) {
        // older bridge: no QStringList overload -- set one by one
    }
    try {
        for (var i = 0; i < labels.length; i++) {
            table.setHorizontalHeaderItem(i, new QTableWidgetItem(labels[i]));
        }
    } catch (e2) {
        // no headers then; the tooltip documents the columns
    }
};

/** Connects a signal, reporting rather than dying when the bridge
 *  lacks it. Returns true on success. */
SurveyNotebook.safeConnect = function(signal, fn, what, problems) {
    try {
        signal.connect(fn);
        return true;
    } catch (e) {
        problems.push(what + " (" + e + ")");
        return false;
    }
};

// ---------------------------------------------------------------------
// Table <-> model
// ---------------------------------------------------------------------

/** Reads the sheet (table or text mode) into a CsModel survey. */
SurveyNotebook.surveyFromTable = function(w) {
    var survey = CsModel.newSurvey();
    survey.name = w.nameEdit.text;
    survey.date = w.dateEdit.text;
    survey.team = w.teamEdit.text;
    survey.declination = parseFloat(w.declEdit.text) || 0.0;
    survey.declinationSource = w.declSource;
    survey.distanceUnit = w.unit;

    if (w.mode === "text") {
        var parsed = CsFormatCsv.parse(String(w.editor.toPlainText()));
        survey.shots = parsed.shots;
        return survey;
    }

    var t = w.table;
    for (var r = 0; r < t.rowCount; r++) {
        var cell = function(c) {
            var item = t.item(r, c);
            return (item === null || item === undefined) ? "" :
                String(item.text()).replace(/^\s+|\s+$/g, "");
        };
        var from = cell(0);
        var to = cell(1);
        if (from === "" && to === "") {
            continue; // blank row
        }
        var num = function(c) {
            var v = cell(c);
            if (v === "") {
                return null;
            }
            var n = parseFloat(v);
            return isNaN(n) ? null : n;
        };
        var shot = CsModel.newShot();
        shot.from = from;
        shot.to = to;
        shot.splay = (to === "" || to === "-");
        if (shot.splay) {
            shot.to = "";
        }
        shot.distance = num(2) === null ? 0.0 : num(2);
        shot.azimuth = num(3) === null ? 0.0 : CsAngles.normalizeAzimuth(num(3));
        shot.inclination = num(4) === null ? 0.0 : num(4);
        shot.left = num(5);
        shot.right = num(6);
        shot.up = num(7);
        shot.down = num(8);
        shot.notes = cell(9);
        survey.shots.push(shot);
    }
    return survey;
};

/** Fills the sheet from a CsModel survey (import path). */
SurveyNotebook.tableFromSurvey = function(w, survey) {
    w.loading = true;
    w.nameEdit.text = survey.name;
    w.dateEdit.text = survey.date;
    w.teamEdit.text = survey.team;
    w.declEdit.text = String(survey.declination || 0);
    w.declSource = survey.declinationSource || "user";
    w.unit = survey.distanceUnit;

    if (w.mode === "text") {
        w.editor.setPlainText(CsFormatCsv.write(survey));
        w.loading = false;
        SurveyNotebook.refresh(w);
        return;
    }

    var t = w.table;
    t.rowCount = 0;
    for (var i = 0; i < survey.shots.length; i++) {
        var s = survey.shots[i];
        var r = t.rowCount;
        t.insertRow(r);
        var put = function(c, v) {
            t.setItem(r, c, new QTableWidgetItem(
                v === null || v === undefined ? "" : String(v)));
        };
        put(0, s.from);
        put(1, s.splay ? "-" : s.to);
        put(2, s.distance);
        put(3, s.azimuth);
        put(4, s.inclination);
        put(5, s.left);
        put(6, s.right);
        put(7, s.up);
        put(8, s.down);
        put(9, s.notes);
    }
    w.loading = false;
    SurveyNotebook.refresh(w);
};

// ---------------------------------------------------------------------
// Live feedback
// ---------------------------------------------------------------------

SurveyNotebook.refresh = function(w) {
    if (w.loading) {
        return;
    }
    var survey = SurveyNotebook.surveyFromTable(w);
    if (survey.shots.length === 0) {
        w.statusLabel.text = "No shots yet. Column order matches the " +
            "notes page; azimuth is degrees clockwise from north, " +
            "distance is along the tape, LRUD belongs to the To station.";
        return;
    }
    var resolved = CsNetwork.resolve(survey, {});
    var findings = CsValidate.check(survey, resolved);
    var stats = CsStats.compute(survey, resolved, CsTraverse.SLOPE);
    var grade = CsGrade.compute(survey, resolved, stats);

    var lines = [];
    lines.push("Length " + CsReport.length(stats.surveyedLength, w.unit) +
        "   Depth " + CsReport.length(stats.depth, w.unit) +
        "   Stations " + stats.stationCount +
        "   Grade " + grade.uis);
    for (var i = 0; i < resolved.loops.length; i++) {
        var loop = resolved.loops[i];
        lines.push("Loop " + loop.from + " to " + loop.to + ": " +
            loop.error.toFixed(2) + " over " + loop.traverseLength.toFixed(1) +
            " (" + loop.percent.toFixed(2) + "%)");
    }
    var shown = 0;
    for (i = 0; i < findings.length && shown < 4; i++) {
        lines.push(findings[i].severity.toUpperCase() + ": " +
            findings[i].message);
        shown++;
    }
    if (findings.length > shown) {
        lines.push("(" + (findings.length - shown) + " more -- see Draw's report)");
    }
    w.statusLabel.text = lines.join("\n");
};

// ---------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------

SurveyNotebook.drawSurvey = function(w) {
    var doc = getDocument();
    if (doc === undefined || doc === null) {
        QMessageBox.warning(null, "Survey Notebook", "No drawing is open.");
        return;
    }
    var survey = SurveyNotebook.surveyFromTable(w);
    if (survey.shots.length === 0) {
        QMessageBox.information(null, "Survey Notebook", "No shots to draw.");
        return;
    }

    var anchor;
    var sel = CsPick.startPointFromSelection(doc, "Survey Notebook");
    if (sel !== undefined && survey.shots.length > 0) {
        anchor = { name: survey.shots[0].from, x: sel.pos.x, y: sel.pos.y, z: 0 };
    }

    var resolved = CsNetwork.resolve(survey, { anchor: anchor });
    var findings = CsValidate.check(survey, resolved);

    startTransaction(doc);
    var drawn = CsDraw.survey(survey, resolved);
    endTransaction();
    autoZoom();

    QMessageBox.information(null, "Survey Notebook",
        CsReport.drawSummary(survey, resolved, drawn, findings) +
        "\n\nDrawn as one undo step.");
};

SurveyNotebook.importFile = function(w) {
    var fileName = QFileDialog.getOpenFileName(null,
        "Import survey file", "", CsFormatRegistry.combinedFileFilter());
    if (!fileName) {
        return;
    }
    var f = new QFile(fileName);
    if (!f.open(QIODevice.ReadOnly | QIODevice.Text)) {
        QMessageBox.warning(null, "Survey Notebook",
            "Could not open " + fileName);
        return;
    }
    var content = new QTextStream(f).readAll();
    f.close();

    var format = CsFormatRegistry.detect(fileName, content);
    if (format === null) {
        QMessageBox.warning(null, "Survey Notebook",
            "Couldn't detect the format of that file.");
        return;
    }
    var survey = format.parse(content);
    if (survey.shots.length === 0) {
        QMessageBox.warning(null, "Survey Notebook",
            "No shots parsed (format tried: " + format.label + ").");
        return;
    }
    SurveyNotebook.tableFromSurvey(w, survey);
};

SurveyNotebook.exportFile = function(w) {
    var survey = SurveyNotebook.surveyFromTable(w);
    if (survey.shots.length === 0) {
        QMessageBox.information(null, "Survey Notebook", "Nothing to export.");
        return;
    }
    var labels = [];
    for (var i = 0; i < CsFormatRegistry.FORMATS.length; i++) {
        labels.push(CsFormatRegistry.FORMATS[i].label);
    }
    var choice = getItem("Survey Notebook", "Export as which format?",
        labels.join("|"), 0, "|");
    if (choice === undefined) {
        return;
    }
    var format = null;
    for (i = 0; i < CsFormatRegistry.FORMATS.length; i++) {
        if (CsFormatRegistry.FORMATS[i].label === choice) {
            format = CsFormatRegistry.FORMATS[i];
        }
    }
    var fileName = QFileDialog.getSaveFileName(null,
        "Export " + format.label, "", format.fileFilter);
    if (!fileName) {
        return;
    }
    var content = format.write(survey);
    var f = new QFile(fileName);
    if (!f.open(QIODevice.WriteOnly | QIODevice.Text)) {
        QMessageBox.warning(null, "Survey Notebook",
            "Could not write " + fileName);
        return;
    }
    var stream = new QTextStream(f);
    stream.writeString(content);
    f.close();
    EAction.handleUserMessage("Survey Notebook: exported " +
        survey.shots.length + " shots to " + fileName);
};

SurveyNotebook.inferDeclination = function(w) {
    // date from the header; location from the geo anchor or a prompt
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(w.dateEdit.text);
    if (m === null) {
        QMessageBox.information(null, "Survey Notebook",
            "Enter the survey date (YYYY-MM-DD) in the header first -- " +
            "declination drifts over the years, so the date matters.");
        return;
    }

    var coord = null;
    var doc = getDocument();
    if (doc !== undefined && doc !== null) {
        var ids = doc.queryAllEntities(false, false);
        for (var i = 0; i < ids.length; i++) {
            var e = doc.queryEntity(ids[i]);
            if (isNull(e)) {
                continue;
            }
            var lat = CsTags.getNumber(e, "GeoLat");
            var lon = CsTags.getNumber(e, "GeoLon");
            if (lat !== null && lon !== null) {
                coord = { lat: lat, lon: lon };
                break;
            }
        }
    }
    if (coord === null) {
        var text = getText("Survey Notebook",
            "Cave location (decimal like 39.6961, -86.3094 or DMS):", "");
        if (text === undefined || text === "") {
            return;
        }
        coord = CsAngles.parseLatLon(text);
        if (coord === null) {
            QMessageBox.warning(null, "Survey Notebook",
                "Couldn't read that location.");
            return;
        }
    }

    var result = CsGeomag.declination(coord.lat, coord.lon, {
        year: parseInt(m[1], 10), month: parseInt(m[2], 10),
        day: parseInt(m[3], 10)
    });
    if (result === null) {
        QMessageBox.warning(null, "Survey Notebook",
            "That date is before 1900 -- outside the IGRF model.");
        return;
    }
    w.declEdit.text = result.declination.toFixed(2);
    w.declSource = "igrf";
    QMessageBox.information(null, "Survey Notebook",
        CsReport.igrfLine(result, coord.lat, coord.lon, w.dateEdit.text) +
        "\n\nFilled into the header -- edit it freely; it stays your call.");
};

// ---------------------------------------------------------------------
// Widget construction
// ---------------------------------------------------------------------

SurveyNotebook.buildDock = function(appWin) {
    var dock = new QDockWidget("Survey Notebook", appWin);
    dock.objectName = "CaveSurveyNotebookDock";

    var w = {}; // widget handles + state, closed over by the handlers
    w.loading = false;
    w.declSource = "user";
    w.unit = "ft";
    var doc = getDocument();
    if (doc !== undefined && doc !== null) {
        w.unit = CsUnits.fromDrawingUnit(doc.getUnit(), RS);
    }

    var body = new QWidget(dock);
    var layout = new QVBoxLayout();

    // ---- header: survey / date / team ---------------------------
    var head1 = new QHBoxLayout();
    head1.addWidget(new QLabel("Survey"), 0, 0);
    w.nameEdit = new QLineEdit();
    head1.addWidget(w.nameEdit, 1, 0);
    head1.addWidget(new QLabel("Date"), 0, 0);
    w.dateEdit = new QLineEdit();
    w.dateEdit.placeholderText = "YYYY-MM-DD";
    w.dateEdit.maximumWidth = 110;
    head1.addWidget(w.dateEdit, 0, 0);
    layout.addLayout(head1, 0);

    var head2 = new QHBoxLayout();
    head2.addWidget(new QLabel("Team"), 0, 0);
    w.teamEdit = new QLineEdit();
    head2.addWidget(w.teamEdit, 1, 0);
    head2.addWidget(new QLabel("Decl"), 0, 0);
    w.declEdit = new QLineEdit();
    w.declEdit.placeholderText = "0.0 (E+)";
    w.declEdit.maximumWidth = 80;
    head2.addWidget(w.declEdit, 0, 0);
    w.inferButton = new QPushButton("Infer");
    w.inferButton.toolTip =
        "Estimate declination from the survey date and the cave's " +
        "location (IGRF model, 1900 to present). Always editable.";
    head2.addWidget(w.inferButton, 0, 0);
    layout.addLayout(head2, 0);

    // ---- the notes page: table where the bridge allows, text
    // sheet everywhere else ------------------------------------------
    var columnHelp =
        "Column order matches a survey notes page.\n" +
        "Azimuth: degrees clockwise from north (true bearing).\n" +
        "Dist: along the tape (slope). Inc: + up, - down.\n" +
        "L/R face the direction of travel; LRUD belongs to the To " +
        "station. Blank LRUD = not measured. To of \"-\" = splay.";

    w.mode = SurveyNotebook.tableSupported() ? "table" : "text";

    if (w.mode === "table") {
        w.table = new QTableWidget(0, SurveyNotebook.COLUMNS.length, body);
        SurveyNotebook.setHeaders(w.table, SurveyNotebook.COLUMNS);
        w.table.toolTip = columnHelp;
        layout.addWidget(w.table, 1, 0);

        var rowButtons = new QHBoxLayout();
        w.addRowButton = new QPushButton("+ Shot");
        w.delRowButton = new QPushButton("- Shot");
        rowButtons.addWidget(w.addRowButton, 0, 0);
        rowButtons.addWidget(w.delRowButton, 0, 0);
        rowButtons.addStretch(1);
        layout.addLayout(rowButtons, 0);
    } else {
        // Text sheet: one shot per line in the CSV column order; the
        // same Core parser reads it, so nothing downstream differs.
        w.editor = new QPlainTextEdit(body);
        w.editor.toolTip = columnHelp;
        w.editor.setPlainText(
            "from,to,distance,azimuth,inclination,left,right,up,down,notes\n");
        layout.addWidget(w.editor, 1, 0);
        var modeNote = new QLabel(
            "(text sheet: one shot per line, columns as the header row -- " +
            "this QCAD build's script bridge lacks the table widget)");
        modeNote.wordWrap = true;
        layout.addWidget(modeNote, 0, 0);
    }

    // ---- live status ----------------------------------------------
    w.statusLabel = new QLabel("");
    w.statusLabel.wordWrap = true;
    layout.addWidget(w.statusLabel, 0, 0);

    // ---- actions ----------------------------------------------------
    var actions = new QHBoxLayout();
    w.drawButton = new QPushButton("Draw");
    w.drawButton.toolTip = "Draw the survey into the drawing, one undo step.";
    w.importButton = new QPushButton("Import File...");
    w.exportButton = new QPushButton("Export File...");
    actions.addWidget(w.drawButton, 0, 0);
    actions.addWidget(w.importButton, 0, 0);
    actions.addWidget(w.exportButton, 0, 0);
    layout.addLayout(actions, 0);

    body.setLayout(layout);
    dock.setWidget(body);

    // ---- wiring: every connect reports rather than dying ----------
    var problems = [];
    if (w.mode === "table") {
        SurveyNotebook.safeConnect(w.addRowButton.clicked, function() {
            var r = w.table.rowCount;
            w.table.insertRow(r);
            // pre-fill From with the previous To, the way notes flow
            if (r > 0) {
                var prevTo = w.table.item(r - 1, 1);
                if (prevTo !== null && prevTo !== undefined) {
                    w.table.setItem(r, 0, new QTableWidgetItem(prevTo.text()));
                    w.table.setItem(r, 1, new QTableWidgetItem(
                        CsModel.nextStationName(String(prevTo.text()))));
                }
            }
        }, "+ Shot button", problems);
        SurveyNotebook.safeConnect(w.delRowButton.clicked, function() {
            var r = w.table.currentRow();
            if (r >= 0) {
                w.table.removeRow(r);
                SurveyNotebook.refresh(w);
            }
        }, "- Shot button", problems);
        SurveyNotebook.safeConnect(w.table.cellChanged, function() {
            SurveyNotebook.refresh(w);
        }, "live refresh", problems);
    } else {
        SurveyNotebook.safeConnect(w.editor.textChanged, function() {
            SurveyNotebook.refresh(w);
        }, "live refresh", problems);
    }
    SurveyNotebook.safeConnect(w.drawButton.clicked, function() {
        SurveyNotebook.drawSurvey(w);
    }, "Draw button", problems);
    SurveyNotebook.safeConnect(w.importButton.clicked, function() {
        SurveyNotebook.importFile(w);
    }, "Import button", problems);
    SurveyNotebook.safeConnect(w.exportButton.clicked, function() {
        SurveyNotebook.exportFile(w);
    }, "Export button", problems);
    SurveyNotebook.safeConnect(w.inferButton.clicked, function() {
        SurveyNotebook.inferDeclination(w);
    }, "Infer button", problems);

    if (problems.length > 0) {
        EAction.handleUserWarning("Survey Notebook: this build's script " +
            "bridge refused: " + problems.join("; ") +
            " -- those controls are inert; the rest of the panel works.");
    }

    SurveyNotebook.refresh(w);
    return dock;
};

// ---------------------------------------------------------------------
// Tool entry: create the dock once, then toggle it.
// ---------------------------------------------------------------------

SurveyNotebook.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);

    var appWin = RMainWindowQt.getMainWindow();
    try {
        if (csNotebookDock === undefined || csNotebookDock === null) {
            csNotebookDock = SurveyNotebook.buildDock(appWin);
            appWin.addDockWidget(Qt.RightDockWidgetArea, csNotebookDock);
            csNotebookDock.visible = true;
        } else {
            csNotebookDock.visible = !csNotebookDock.visible;
        }
    } catch (e) {
        // If this QCAD build's script bridge can't host the dock, say
        // so honestly instead of dying silently.
        csNotebookDock = undefined;
        warning("Survey Notebook: this QCAD build refused the docked " +
            "panel (" + e + "). Azimuth Traverse and Import Cave Survey " +
            "cover the same work meanwhile -- please report this.");
    }

    this.terminate();
};

SurveyNotebook.init = function(basePath) {
    var action = new RGuiAction(qsTr("Survey Notebook"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(false); // the panel may outlive documents
    action.setScriptFile(basePath + "/SurveyNotebook.js");
    action.setIcon(basePath + "/SurveyNotebook.svg");
    action.setStatusTip(qsTr("A docked survey notes page: type shots, watch closures live, draw in one step"));
    action.setDefaultCommands(["surveynotebook", "snb"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(15);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
