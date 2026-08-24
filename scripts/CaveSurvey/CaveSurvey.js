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
// The Core library, so init() below can install the cave-folder hook.
// Tools include the same file themselves; include() dedupes by basename,
// so this costs nothing when a tool has already loaded it.
include(includeBasePath + "/Core/CsAll.js");

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

// The suite's version, read once from the VERSION file that
// tools/make_package.sh stamps into the packaged add-on. A source tree run
// straight from the repository has no such file, and reports nothing --
// only a published build claims a version number.
//
// CaveCAD reads this property for the Script Add-Ons tab of Help > About;
// init() below also writes it onto the splash screen.
CaveSurvey.version = undefined;

CaveSurvey.getVersion = function(basePath) {
    if (!isNull(CaveSurvey.version)) {
        return CaveSurvey.version;
    }

    if (isNull(basePath)) {
        return undefined;
    }

    var fileName = basePath + "/VERSION";
    if (!new QFileInfo(fileName).exists()) {
        return undefined;
    }

    var contents = readTextFile(fileName);
    if (isNull(contents)) {
        return undefined;
    }

    contents = contents.trim();
    if (contents.length===0) {
        return undefined;
    }

    CaveSurvey.version = contents;
    return CaveSurvey.version;
};

CaveSurvey.init = function(basePath, splash) {
    CaveSurvey.getMenu();
    CaveSurvey.getToolBar();

    // Cave folders on the shared drive: after a save, make sure this
    // cave's scans/ folder exists and point the image picker at it, so
    // Draw > Image opens on the sketches for the cave in front of you.
    // No menu entry -- a convenience you have to switch on is one that
    // is off on the machine that needed it. See CsCave.js.
    if (typeof CsCave !== "undefined") {
        CsCave.installSaveHook();
    }

    // Keep the previous version of a drawing beside it on every save.
    // A redraw is erase-then-draw across two operations, so a draw that
    // fails after the erase has landed leaves the drawing gutted -- and
    // the next save writes that over the only copy. That has happened.
    // No menu entry: a guard you have to switch on is one that is off on
    // the machine that needed it.
    // No backup hook is installed here on purpose. Neither available
    // mechanism reaches a save: a Save.prototype patch never runs in
    // QCAD's own action context, and the export listener's signals are
    // not fired by the DXF writer (both measured -- see CsBackup). The
    // backup is taken instead at the moment that matters, immediately
    // before this suite's own destructive operations.

    // report the suite on the splash screen, beside CaveCAD's own version:
    var version = CaveSurvey.getVersion(basePath);
    if (!isNull(splash) && !isNull(version)) {
        splash.showMessage(qsTr("Cave Survey Tools %1").arg(version) + "\n", Qt.AlignBottom);
    }
};
