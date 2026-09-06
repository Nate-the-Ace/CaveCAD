/**
 * RepairDrawing.js
 *
 * One entry for the three things that fix a drawing rather than draw in
 * it. The passes live in Core/CsRepair.js; this is the dialog and the
 * report.
 */
include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");

function RepairDrawing(guiAction) {
    EAction.call(this, guiAction);
}

RepairDrawing.prototype = new EAction();

RepairDrawing.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    repairDrawingRun();
    this.terminate();
};

function repairDrawingRun() {
    var doc = getDocument();
    if (isNull(doc)) {
        warning(qsTr("Repair Drawing: no active drawing document."));
        return;
    }
    var di = getDocumentInterface();

    var dlg = new QDialog(getMainWindow());
    dlg.windowTitle = qsTr("Repair Drawing");
    var layout = new QVBoxLayout();
    layout.addWidget(new QLabel(
        qsTr("Runs on the whole drawing. Nothing is moved or deleted.")),
        0, 0);

    var cbRebuild = new QCheckBox(
        qsTr("Survey data -- re-read the survey from the drawing's tags, "
           + "and bring an old drawing's tags up to date"));
    var cbRestyle = new QCheckBox(
        qsTr("Layers -- add any layer this drawing is missing, and put "
           + "the rest back on the current palette"));
    var cbCallouts = new QCheckBox(
        qsTr("Callouts -- put every note's arrows back on the note"));
    cbRebuild.checked = true;
    cbRestyle.checked = true;
    cbCallouts.checked = true;
    layout.addWidget(cbRebuild, 0, 0);
    layout.addWidget(cbRestyle, 0, 0);
    layout.addWidget(cbCallouts, 0, 0);

    var buttons = new QDialogButtonBox(QDialogButtonBox.Ok
                                     | QDialogButtonBox.Cancel);
    // .accepted/.rejected are signals on the wrapper: connect, do not assign.
    buttons.accepted.connect(dlg, "accept");
    buttons.rejected.connect(dlg, "reject");
    layout.addWidget(buttons, 0, 0);
    dlg.setLayout(layout);

    if (dlg.exec() !== QDialog.Accepted) {
        dlg.destroy();
        return;
    }
    var opts = {
        rebuild: cbRebuild.checked,
        restyle: cbRestyle.checked,
        callouts: cbCallouts.checked
    };
    dlg.destroy();

    var report = CsRepair.run(doc, di, opts);

    // QMessageBox, not handleUserMessage: the command line escapes the
    // text and wraps it in a <span>, so Qt reads it as rich text and
    // every newline collapses to a space.
    try {
        QMessageBox.information(getMainWindow(), qsTr("Repair Drawing"),
            report.lines.join("\n"));
    } catch (e) {
        EAction.handleUserMessage(report.lines[0]);
    }
}

RepairDrawing.init = function(basePath) {
    var action = new RGuiAction(qsTr("Repair Drawing"),
                                RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/RepairDrawing.js");
    action.setIcon(basePath + "/RepairDrawing.svg");
    action.setStatusTip(qsTr("Fix a drawing that is out of date or out "
        + "of step: survey tags, layer palette, callout arrows"));
    action.setDefaultCommands(["repairdrawing", "rep"]);
    action.setGroupSortOrder(455);
    action.setSortOrder(10);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
