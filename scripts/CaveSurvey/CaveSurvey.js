/**
 * CaveSurvey.js
 *
 * Top level menu / tool bar builder for the Cave Survey tool suite.
 *
 * This file must live at:
 *   scripts/CaveSurvey/CaveSurvey.js
 *
 * All individual tools (AzimuthTraverse, ImportNativeCaveSurvey,
 * ScatterBreakdown, CaveWallSpline, etc.) live in their own subfolders
 * beside this file, e.g.:
 *
 *   scripts/CaveSurvey/CaveSurvey.js              <- this file
 *   scripts/CaveSurvey/CaveWallSpline/CaveWallSpline.js
 *   scripts/CaveSurvey/AzimuthTraverse/AzimuthTraverse.js
 *   scripts/CaveSurvey/ImportNativeCaveSurvey/ImportNativeCaveSurvey.js
 *   scripts/CaveSurvey/ScatterBreakdown/ScatterBreakdown.js
 *
 * Each of those tool scripts derives from CaveSurvey (below) and, in its
 * own static init(), calls:
 *
 *   action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
 *
 * which is exactly what CaveWallSpline.js already does - it just needed
 * this file to exist so those two widget names resolve to something.
 */

// All actions are derived from class EAction:
include("scripts/EAction.js");

// Constructor calls base class constructor:
function CaveSurvey(guiAction) {
    EAction.call(this, guiAction);
}

// Derive class CaveSurvey from class EAction:
CaveSurvey.prototype = new EAction();

// Returns a new or existing QMenu object for the "Cave Survey" menu.
// The object name ("CaveSurveyMenu") must be unique and is what each
// tool's setWidgetNames(...) call references.
CaveSurvey.getMenu = function() {
    return EAction.getMenu(CaveSurvey.getTitle(), "CaveSurveyMenu");
};

// Returns a new or existing QToolBar object for the "Cave Survey" tool bar.
// The object name ("CaveSurveyToolBar") must be unique and is what each
// tool's setWidgetNames(...) call references.
CaveSurvey.getToolBar = function() {
    return EAction.getToolBar(CaveSurvey.getTitle(), "CaveSurveyToolBar");
};

// Title used for both the menu label and the tool bar's display name.
CaveSurvey.getTitle = function() {
    return qsTr("Cave Survey");
};

// init() is called by QCAD at startup to create the menu and tool bar
// before any individual tool tries to attach a button to them.
CaveSurvey.init = function(basePath) {
    CaveSurvey.getMenu();
    CaveSurvey.getToolBar();
};
