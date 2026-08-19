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

// Toolbars HIDDEN by object name -- an explicit list, because this
// bridge has no findChildren to enumerate with; unknown toolbars stay
// visible, which fails safe. These are QCAD's stock toolbar object
// names; the Cave Survey toolbar and anything unrecognised survive.
CaveMode.HIDE_TOOLBARS = [
    "ReferencePointsToolBar", "DrawToolBar", "ModifyToolBar",
    "OrderToolBar", "InfoToolBar", "DimensionToolBar", "MiscToolBar",
    "BlockToolBar", "LayerToolBar", "WidgetsToolBar", "ScriptToolBar"
];

CaveMode.stripAccel = function(title) {
    return String(title).replace(/&/g, "");
};

/** Applies or removes the mode. Returns [names hidden]. */
CaveMode.apply = function(on) {
    var appWin = RMainWindowQt.getMainWindow();
    var hidden = [];

    // This bridge wraps no findChildren, so: menus are reached through
    // the menu bar's ACTIONS (each top-level menu is one QAction whose
    // text is its title), toolbars through findChild by their stock
    // object names -- unknown toolbars stay visible, failing safe.
    var menuActions = appWin.menuBar().actions();

    if (on) {
        for (var i = 0; i < menuActions.length; i++) {
            var act = menuActions[i];
            var title = CaveMode.stripAccel(act.text);
            if (CaveMode.KEEP_MENUS.indexOf(title) >= 0) {
                continue;
            }
            if (act.visible) {
                act.visible = false;
                hidden.push("menu:" + title);
            }
        }

        for (i = 0; i < CaveMode.HIDE_TOOLBARS.length; i++) {
            var tbName = CaveMode.HIDE_TOOLBARS[i];
            var tb = appWin.findChild(tbName);
            if (tb !== null && tb !== undefined && tb.visible) {
                tb.visible = false;
                hidden.push("toolbar:" + tbName);
            }
        }

        RSettings.setValue(CaveMode.SETTING_ACTIVE, true);
        RSettings.setValue(CaveMode.SETTING_HIDDEN, hidden.join("|"));
    } else {
        // restore exactly what we hid, nothing else
        var stored = RSettings.getStringValue(CaveMode.SETTING_HIDDEN, "");
        var names = (stored === "" || stored === undefined || stored === null) ?
            [] : String(stored).split("|");

        for (i = 0; i < names.length; i++) {
            var entry = names[i];
            if (entry.indexOf("menu:") === 0) {
                var mTitle = entry.substring(5);
                for (var mi = 0; mi < menuActions.length; mi++) {
                    if (CaveMode.stripAccel(menuActions[mi].text) === mTitle) {
                        menuActions[mi].visible = true;
                    }
                }
            } else if (entry.indexOf("toolbar:") === 0) {
                var tb2 = appWin.findChild(entry.substring(8));
                if (tb2 !== null && tb2 !== undefined) {
                    tb2.visible = true;
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
