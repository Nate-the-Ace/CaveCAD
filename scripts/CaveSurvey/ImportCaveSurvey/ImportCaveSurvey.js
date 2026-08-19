// ImportCaveSurvey.js
//
// QCAD add-on tool: import a cave survey file -- Compass (.dat),
// Walls (.srv), Survex (.svx) or CSV -- and draw the centerline,
// stations and LRUD ticks.
//
// You pick a FILE, not a format: the format is detected from the
// extension and the content, and only asked about when genuinely
// ambiguous. Everything is drawn in ONE undo step, onto the same
// CTRL- layers the NSS templates carry and Azimuth Traverse draws to,
// with every station tagged so the other tools (LRUD Walls, Survey
// Stats, the Notebook) can read the survey back out of the drawing.
//
// USAGE:
//   OPTIONAL: select a single station point (or line/arc endpoint)
//   first -- the file's first station is anchored there, which is how
//   an imported survey ties into one already in the drawing.
//   Otherwise a #Fix / *fix in the file anchors it, or (0,0).
//
//   Cave Survey > Import Cave Survey   (or type "ics")
//
// UNITS: distances are converted from the file's unit to the
// DRAWING's unit (Edit > Drawing Preferences > Units), not to a
// constant in this file. Compass is always feet; Walls and Survex
// declare theirs.
//
// The tape is treated as SLOPE distance (what all three formats
// mean): plan = d*cos(inc), rise = d*sin(inc).
//
// Scope limits per format are documented in Core/Format/*.js -- the
// short version: the everyday core of each format, not the full
// specification, and a wrong detail draws a plausible but WRONG map,
// so check a first import against a known plot.

include("scripts/EAction.js");
include("scripts/simple.js");
include("scripts/CaveSurvey/Core/All.js");

function importCaveSurvey() {
    var doc = getDocument();
    if (doc === undefined || doc === null) {
        warning("Import Cave Survey: no active drawing document.");
        return;
    }

    // -- pick the file ------------------------------------------------
    var fileName = QFileDialog.getOpenFileName(getMainWindow(),
        "Select a cave survey file", "",
        CsFormatRegistry.combinedFileFilter());
    if (!fileName) {
        return;
    }

    var file = new QFile(fileName);
    if (!file.open(QIODevice.ReadOnly | QIODevice.Text)) {
        warning("Import Cave Survey: could not open\n" + fileName);
        return;
    }
    var content = new QTextStream(file).readAll();
    file.close();

    // -- detect the format ---------------------------------------------
    var format = CsFormatRegistry.detect(fileName, content);
    if (format === null) {
        var labels = [];
        for (var i = 0; i < CsFormatRegistry.FORMATS.length; i++) {
            labels.push(CsFormatRegistry.FORMATS[i].label);
        }
        var choice = getItem("Import Cave Survey",
            "The format couldn't be detected -- which is it?",
            labels.join("|"), 0, "|");
        if (choice === undefined) {
            return;
        }
        for (i = 0; i < CsFormatRegistry.FORMATS.length; i++) {
            if (CsFormatRegistry.FORMATS[i].label === choice) {
                format = CsFormatRegistry.FORMATS[i];
            }
        }
    }

    // -- parse ----------------------------------------------------------
    var survey = format.parse(content);
    if (survey.shots.length === 0) {
        warning("Import Cave Survey: no shots were parsed from this file.\n" +
            "Format tried: " + format.label);
        return;
    }

    // -- convert to the drawing's unit -----------------------------------
    var drawingUnit = CsUnits.fromDrawingUnit(doc.getUnit(), RS);
    if (survey.distanceUnit !== drawingUnit) {
        var factor = CsUnits.convert(1.0, survey.distanceUnit, drawingUnit);
        for (i = 0; i < survey.shots.length; i++) {
            var s = survey.shots[i];
            s.distance *= factor;
            if (s.left !== null) { s.left *= factor; }
            if (s.right !== null) { s.right *= factor; }
            if (s.up !== null) { s.up *= factor; }
            if (s.down !== null) { s.down *= factor; }
        }
        for (var fname in survey.fixed) {
            if (survey.fixed.hasOwnProperty(fname)) {
                survey.fixed[fname].x *= factor;
                survey.fixed[fname].y *= factor;
                survey.fixed[fname].z *= factor;
            }
        }
        survey.distanceUnit = drawingUnit;
    }

    // -- anchor on the selection, if there is one -------------------------
    var anchor;
    var sel = CsPick.startPointFromSelection(doc, "Import Cave Survey");
    if (sel !== undefined) {
        // find the first positionable station name
        var firstName = "";
        for (i = 0; i < survey.shots.length; i++) {
            if (!survey.shots[i].excludeFromAll && !survey.shots[i].splay &&
                survey.shots[i].from !== "") {
                firstName = survey.shots[i].from;
                break;
            }
        }
        if (firstName !== "") {
            anchor = { name: firstName, x: sel.pos.x, y: sel.pos.y, z: 0.0 };
        }
    }

    // -- resolve and draw, one undo step ---------------------------------
    var resolved = CsNetwork.resolve(survey, { anchor: anchor });
    var findings = CsValidate.check(survey, resolved);

    startTransaction(doc);
    var drawn = CsDraw.survey(survey, resolved);
    endTransaction();

    if (drawn.stationsDrawn > 0) {
        autoZoom();
    }

    // -- report in plain language ------------------------------------------
    var summary = "Format: " + format.label + "\n" +
        "Drawing units: " + survey.distanceUnit + "\n" +
        CsReport.drawSummary(survey, resolved, drawn, findings);
    if (resolved.unresolved.length > 0 ||
        CsValidate.checkHasErrors(findings)) {
        QMessageBox.warning(getMainWindow(), "Import Cave Survey", summary);
    } else {
        QMessageBox.information(getMainWindow(), "Import Cave Survey", summary);
    }
}

// ============================================================
// Add-on wiring -- the standard pattern; see docs.
// ============================================================

function ImportCaveSurvey(guiAction) {
    EAction.call(this, guiAction);
}

ImportCaveSurvey.prototype = new EAction();

ImportCaveSurvey.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    importCaveSurvey();
    this.terminate();
};

ImportCaveSurvey.init = function(basePath) {
    var action = new RGuiAction(qsTr("Import Cave Survey"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/ImportCaveSurvey.js");
    action.setIcon(basePath + "/ImportCaveSurvey.svg");
    action.setStatusTip(qsTr("Import a Compass, Walls, Survex or CSV survey file -- the format is detected for you"));
    action.setDefaultCommands(["importcavesurvey", "ics"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(20);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
