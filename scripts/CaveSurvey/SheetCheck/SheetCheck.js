// SheetCheck.js
//
// QCAD add-on tool: "what would a judge mark missing?"
//
// Runs the sheet checklist -- the NSS Cartography Salon core elements
// -- against the current drawing and reports every gap in plain
// language, with what convention asks for and which tool supplies it.
// This is the suite's most beginner-facing feature: it turns tacit
// cartographic convention into a to-do list.
//
// Read-only: changes nothing, safe to run any time. Run it early and
// often, not only at the end.
//
// USAGE:
//   Cave Survey > Sheet Check   (or type "shc")

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

function sheetCheckRun() {
    var doc = getDocument();
    if (doc === undefined || doc === null) {
        warning("Sheet Check: no active drawing document.");
        return;
    }

    var results = CsSheet.checklist(doc);

    var missing = 0;
    var lines = [];
    for (var i = 0; i < results.length; i++) {
        var r = results[i];
        if (r.ok) {
            lines.push("[ok]  " + r.item);
        } else {
            missing++;
            lines.push("[--]  " + r.item);
            lines.push("      " + r.why);
        }
    }

    var header;
    if (missing === 0) {
        header = "Every checklist element is present. Remaining quality " +
            "is judgment -- line weights, lettering hierarchy, layout " +
            "balance -- which no checker can score for you.\n";
    } else {
        header = missing + " element" + (missing === 1 ? "" : "s") +
            " a judge would mark missing:\n";
    }

    QMessageBox.information(getMainWindow(), "Sheet Check",
        header + "\n" + lines.join("\n"));
    EAction.handleUserMessage("Sheet Check: " +
        (results.length - missing) + " of " + results.length +
        " elements present.");
}

// ============================================================
// Add-on wiring -- the standard pattern; see docs.
// ============================================================

function SheetCheck(guiAction) {
    EAction.call(this, guiAction);
}

SheetCheck.prototype = new EAction();

SheetCheck.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    sheetCheckRun();
    this.terminate();
};

SheetCheck.init = function(basePath) {
    var action = new RGuiAction(qsTr("Sheet Check"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/SheetCheck.js");
    action.setIcon(basePath + "/SheetCheck.svg");
    action.setStatusTip(qsTr("Check the sheet against the NSS required-elements list and say what is missing, in plain language"));
    action.setDefaultCommands(["sheetcheck", "shc"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(80);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
