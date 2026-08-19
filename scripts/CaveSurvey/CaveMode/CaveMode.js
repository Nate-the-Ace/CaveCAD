// CaveMode.js
//
// QCAD add-on tool: turn QCAD into a dedicated cave mapping
// workspace, and back, with one command.
//
// ON: hides the stock menus and toolbars a cave cartographer never
// needs (CAM, scripting, the block/dimension deep cuts), keeps the
// drawing essentials (File, Edit, View, Draw, Snap, Layer), and
// leaves the Cave Survey menu, toolbar and Survey Notebook front and
// center. OFF: restores exactly what was hidden -- QCAD's own state
// underneath is never modified, only visibility.
//
// The mode and the list of what was hidden persist across restarts
// via RSettings, and the mode re-applies itself at startup.
//
// DEFENSIVE BY DESIGN: widgets are matched against a KEEP list; a
// widget this version of QCAD doesn't know about stays VISIBLE. An
// unknown menu appearing after a QCAD update is clutter for a while,
// which is recoverable; a needed menu vanishing is a support call.
//
// USAGE:
//   Cave Survey > Cave Mode   (or type "cavemode")

include("scripts/EAction.js");
include("scripts/simple.js");

function CaveMode(guiAction) {
    EAction.call(this, guiAction);
}

CaveMode.prototype = new EAction();

CaveMode.SETTING_ACTIVE = "CaveSurvey/CaveModeActive";
CaveMode.SETTING_HIDDEN = "CaveSurvey/CaveModeHidden";

// Menus kept visible, by their TITLE with accelerator marks stripped.
// Everything else in the menu bar hides. Titles, not object names,
// because QCAD's object names for menus vary more across versions
// than the user-facing titles do.
CaveMode.KEEP_MENUS = [
    "File", "Edit", "View", "Select", "Draw", "Dimension", "Modify",
    "Snap", "Layer", "Block", "Cave Survey", "Window", "Help"
];

// Toolbars kept visible, by object name prefix. The Cave Survey
// toolbar and the core drawing/snap bars stay; CAM and the rest hide.
CaveMode.KEEP_TOOLBARS = [
    "CaveSurveyToolBar", "FileToolBar", "EditToolBar", "ViewToolBar",
    "SnapToolBar", "MainToolBar", "PropertiesToolBar"
];

CaveMode.stripAccel = function(title) {
    return String(title).replace(/&/g, "");
};

/** Applies or removes the mode. Returns [names hidden]. */
CaveMode.apply = function(on) {
    var appWin = RMainWindowQt.getMainWindow();
    var hidden = [];

    if (on) {
        // ---- menus -------------------------------------------------
        var menuBar = appWin.menuBar();
        var menus = menuBar.findChildren(QMenu);
        for (var i = 0; i < menus.length; i++) {
            var menu = menus[i];
            // top-level menus only: their parent is the menu bar
            if (menu.parentWidget() !== menuBar) {
                continue;
            }
            var title = CaveMode.stripAccel(menu.title);
            if (CaveMode.KEEP_MENUS.indexOf(title) >= 0) {
                continue;
            }
            var act = menu.menuAction();
            if (act !== null && act.visible) {
                act.visible = false;
                hidden.push("menu:" + title);
            }
        }

        // ---- toolbars ------------------------------------------------
        var toolbars = appWin.findChildren(QToolBar);
        for (i = 0; i < toolbars.length; i++) {
            var tb = toolbars[i];
            var name = String(tb.objectName);
            var keep = false;
            for (var k = 0; k < CaveMode.KEEP_TOOLBARS.length; k++) {
                if (name.indexOf(CaveMode.KEEP_TOOLBARS[k]) === 0) {
                    keep = true;
                    break;
                }
            }
            if (!keep && tb.visible) {
                tb.visible = false;
                hidden.push("toolbar:" + name);
            }
        }

        RSettings.setValue(CaveMode.SETTING_ACTIVE, true);
        RSettings.setValue(CaveMode.SETTING_HIDDEN, hidden.join("|"));
    } else {
        // restore exactly what we hid, nothing else
        var stored = RSettings.getStringValue(CaveMode.SETTING_HIDDEN, "");
        var names = stored === "" ? [] : stored.split("|");

        var menuBar2 = appWin.menuBar();
        var menus2 = menuBar2.findChildren(QMenu);
        var toolbars2 = appWin.findChildren(QToolBar);

        for (i = 0; i < names.length; i++) {
            var entry = names[i];
            if (entry.indexOf("menu:") === 0) {
                var mTitle = entry.substring(5);
                for (var mi = 0; mi < menus2.length; mi++) {
                    if (CaveMode.stripAccel(menus2[mi].title) === mTitle) {
                        var mAct = menus2[mi].menuAction();
                        if (mAct !== null) {
                            mAct.visible = true;
                        }
                    }
                }
            } else if (entry.indexOf("toolbar:") === 0) {
                var tName = entry.substring(8);
                for (var ti = 0; ti < toolbars2.length; ti++) {
                    if (String(toolbars2[ti].objectName) === tName) {
                        toolbars2[ti].visible = true;
                    }
                }
            }
        }

        RSettings.setValue(CaveMode.SETTING_ACTIVE, false);
        RSettings.setValue(CaveMode.SETTING_HIDDEN, "");
        hidden = names;
    }

    return hidden;
};

CaveMode.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);

    var active = RSettings.getBoolValue(CaveMode.SETTING_ACTIVE, false);
    try {
        var affected = CaveMode.apply(!active);
        if (!active) {
            EAction.handleUserMessage("Cave Mode ON: " + affected.length +
                " stock menus/toolbars hidden (nothing deleted -- run " +
                "cavemode again to restore them). The Cave Survey menu " +
                "and Survey Notebook are your workspace.");
        } else {
            EAction.handleUserMessage("Cave Mode OFF: stock QCAD restored (" +
                affected.length + " items back).");
        }
    } catch (e) {
        warning("Cave Mode: this QCAD build refused the UI toggle (" + e +
            "). Nothing was changed -- please report this.");
    }

    this.terminate();
};

// Re-apply at startup when the mode was left on.
CaveMode.init = function(basePath) {
    var action = new RGuiAction(qsTr("Cave Mode"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(false);
    action.setScriptFile(basePath + "/CaveMode.js");
    action.setIcon(basePath + "/CaveMode.svg");
    action.setStatusTip(qsTr("Toggle the dedicated cave-mapping workspace: stock CAD clutter hidden, cave tools front and center"));
    action.setDefaultCommands(["cavemode"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(90);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);

    if (RSettings.getBoolValue(CaveMode.SETTING_ACTIVE, false)) {
        // The main window is still assembling during init; hide once
        // the event loop settles.
        var timer = new QTimer();
        timer.singleShot = true;
        timer.timeout.connect(function() {
            try {
                CaveMode.apply(true);
            } catch (e) {
                // leave stock UI alone on any failure
            }
        });
        timer.start(1500);
    }
};
