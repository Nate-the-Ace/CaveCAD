// SurveyStats.js
//
// QCAD add-on tool: the numbers the title block wants, and the honest
// survey grade -- computed from the drawing's tagged survey data, not
// asserted.
//
// Reports: surveyed length (tape) and plan length, vertical extent,
// station/shot/loop counts, worst loop closure, and the defensible
// BCRA/UIS grade with its reasoning. The data can prove a grade DOWN
// (bad closure) but only support one UP, and the report says which.
//
// Offers to write length, depth and grade into the title block's
// TB_LENGTH / TB_DEPTH / TB_SURVEY_CODE fields, one undo step.
//
// USAGE:
//   Cave Survey > Survey Stats   (or type "sst")

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/All.js");

function surveyStatsRun() {
    var doc = getDocument();
    if (doc === undefined || doc === null) {
        warning("Survey Stats: no active drawing document.");
        return;
    }

    var survey = CsTags.surveyFromDocument(doc);
    if (survey.shots.length === 0) {
        warning("Survey Stats: no tagged survey stations found.\n" +
            "Run Azimuth Traverse, Import Cave Survey or the Survey " +
            "Notebook first.");
        return;
    }
    survey.distanceUnit = CsUnits.fromDrawingUnit(doc.getUnit(), RS);

    var resolved = CsNetwork.resolve(survey, {});
    var stats = CsStats.compute(survey, resolved, CsTraverse.SLOPE);
    var grade = CsGrade.compute(survey, resolved, stats);

    var summary = CsReport.statsSummary(survey, stats, grade);

    // ---- offer to stamp the title block ----------------------------
    var canStamp =
        CsSheet.textEntitiesInBlock(doc, "TB_LENGTH").length > 0 ||
        CsSheet.textEntitiesInBlock(doc, "TB_DEPTH").length > 0 ||
        CsSheet.textEntitiesInBlock(doc, "TB_SURVEY_CODE").length > 0;

    if (!canStamp) {
        QMessageBox.information(getMainWindow(), "Survey Stats", summary);
        return;
    }

    var answer = QMessageBox.question(getMainWindow(), "Survey Stats",
        summary + "\n\nWrite length, depth and grade into the title block?",
        QMessageBox.Yes | QMessageBox.No);
    if (answer !== QMessageBox.Yes) {
        return;
    }

    var op = new RModifyObjectsOperation();
    op.setText("Survey stats into title block");
    var wrote = [];
    var tryWrite = function(fieldId, value) {
        var field = CsSheet.fieldById(fieldId);
        if (CsSheet.writeField(doc, op, field, value)) {
            wrote.push(field.label);
        }
    };
    tryWrite("length", CsReport.length(stats.surveyedLength, survey.distanceUnit));
    tryWrite("depth", CsReport.length(stats.depth, survey.distanceUnit));
    tryWrite("surveyCode", grade.uis);
    getDocumentInterface().applyOperation(op);

    EAction.handleUserMessage("Survey Stats: updated " + wrote.join(", ") +
        " in the title block (one undo step).");
}

// ============================================================
// Add-on wiring -- the standard pattern; see docs.
// ============================================================

function SurveyStats(guiAction) {
    EAction.call(this, guiAction);
}

SurveyStats.prototype = new EAction();

SurveyStats.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    surveyStatsRun();
    this.terminate();
};

SurveyStats.init = function(basePath) {
    var action = new RGuiAction(qsTr("Survey Stats"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/SurveyStats.js");
    action.setIcon(basePath + "/SurveyStats.svg");
    action.setStatusTip(qsTr("Length, depth, loop closures and the honest survey grade, computed from the drawing"));
    action.setDefaultCommands(["surveystats", "sst"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(70);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
