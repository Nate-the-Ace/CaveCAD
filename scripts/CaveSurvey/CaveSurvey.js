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

    // report the suite on the splash screen, beside CaveCAD's own version:
    var version = CaveSurvey.getVersion(basePath);
    if (!isNull(splash) && !isNull(version)) {
        splash.showMessage(qsTr("Cave Survey Tools %1").arg(version) + "\n", Qt.AlignBottom);
    }
};
