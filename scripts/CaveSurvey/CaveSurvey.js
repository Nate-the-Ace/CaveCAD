/**
 * CaveSurvey.js
 *
 * Top-level menu / toolbar host for the Cave Survey suite.
 *
 * This file must live at scripts/CaveSurvey/CaveSurvey.js. Every tool
 * lives in its own subfolder beside it (a folder is a tool if and
 * only if it contains <Folder>.js -- Core/ and Panel/ are libraries
 * and deliberately have no such file), and registers itself onto the
 * two widget names created here:
 *
 *   action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
 *
 * init() is called by QCAD at startup, before any tool's init(), so
 * the menu and toolbar exist by the time the tools attach to them.
 */

include("scripts/EAction.js");

function CaveSurvey(guiAction) {
    EAction.call(this, guiAction);
}

CaveSurvey.prototype = new EAction();

// Returns the QMenu for "Cave Survey". The object name must be unique
// and is what every tool's setWidgetNames(...) references.
CaveSurvey.getMenu = function() {
    return EAction.getMenu(CaveSurvey.getTitle(), "CaveSurveyMenu");
};

// Returns the QToolBar, same arrangement.
CaveSurvey.getToolBar = function() {
    return EAction.getToolBar(CaveSurvey.getTitle(), "CaveSurveyToolBar");
};

CaveSurvey.getTitle = function() {
    return qsTr("Cave Survey");
};

CaveSurvey.init = function(basePath) {
    CaveSurvey.getMenu();
    CaveSurvey.getToolBar();
};
