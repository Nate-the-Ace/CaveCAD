// FeatureTrace.js -- Feature Trace: the menu entry, and (from the next
// task) the docked panel that arms which feature the next drag traces.
//
// The interactive drag lives in FeatureTraceRun.js beside this file.
// QCAD cannot find that file on its own -- AddOn.getAddOns only builds
// an add-on from <dir>/<dir>.js -- so init() below registers it.

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");
include(includeBasePath + "/FeatureTraceRun.js");

function FeatureTrace(guiAction) {
    EAction.call(this, guiAction);
}

FeatureTrace.prototype = new EAction();

/** The armed target layer, read by FeatureTraceRun.targetLayer().
 *  Module state, which is only safe because the panel SHOWS which row
 *  is armed -- see the next task. Undefined means "not yet armed", and
 *  targetLayer() falls back to WALLS-SURVEYED. */
FeatureTrace.target = undefined;

FeatureTrace.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);

    // The next task replaces this with the dock toggle. Until then the
    // menu entry starts a trace directly, so this task is testable on
    // its own.
    FeatureTrace.startRun();

    this.terminate();
};

/** Hands control to the drag action.
 *
 *  Looks the action up by script file and passes it in, rather than
 *  constructing with null: stock Print.js does exactly this, and
 *  EAction's null-guiAction paths are not exercised anywhere. */
FeatureTrace.startRun = function() {
    var di = EAction.getDocumentInterface();
    if (isNull(di)) {
        return;
    }
    var runAction = RGuiAction.getByScriptFile(
        FeatureTrace.basePath + "/FeatureTraceRun.js");
    di.setCurrentAction(new FeatureTraceRun(runAction));
};

FeatureTrace.init = function(basePath) {
    FeatureTrace.basePath = basePath;

    var action = new RGuiAction(qsTr("Feature Trace"),
        RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/FeatureTrace.js");
    action.setIcon(basePath + "/FeatureTrace.svg");
    action.setStatusTip(qsTr("Trace cave walls and other features freehand: " +
        "drag along the sketch and a smooth line follows"));
    action.setDefaultCommands(["featuretrace", "ft"]);
    action.setGroupSortOrder(450);
    // 45 puts this beside Scatter Breakdown (40), the other drawing
    // tool. 75 -- the number the plan first proposed -- is Generate
    // Profile's, and a clash leaves menu order down to load sequence.
    action.setSortOrder(45);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);

    FeatureTraceRun.init(basePath);
};
