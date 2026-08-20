// SwapTheme.js
//
// QCAD add-on tool: one-button dark/light switch. Flips the
// Theme/ThemeName setting between the "Dark" stylesheet theme and the
// default (system light) look, and re-applies the stylesheet on the
// spot -- no preferences dialog, no digging.
//
// The swap is LIVE for everything driven by the application
// stylesheet. What it cannot reach live: icons already rendered with
// the old light/dark mapping (QCAD caches the inverse-icon decision at
// startup), so a restart settles the last few pixels. The setting is
// persisted either way, and the choice survives into the next start
// via the normal startup applyTheme().
//
// Relies on the CaveCAD fork allowing stylesheet themes on macOS
// (upstream QCAD ignores Theme/ThemeName on Mac except for the
// plugin-only "Modern" theme). On a build that still ignores it, the
// setting is written and takes effect wherever that build honors it.

include("scripts/EAction.js");

function SwapTheme(guiAction) {
    EAction.call(this, guiAction);
}

SwapTheme.prototype = new EAction();

SwapTheme.DARK = "Dark";
// "Default" (not an empty value) on purpose: applyTheme() enters its
// theme branch, clears the application stylesheet, finds no
// themes/Default/ stylesheet and leaves the clean system look -- an
// empty value would skip the branch and leave the OLD stylesheet up.
SwapTheme.LIGHT = "Default";

SwapTheme.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);

    var current = RSettings.getStringValue("Theme/ThemeName", "");
    var next = (current === SwapTheme.DARK) ? SwapTheme.LIGHT : SwapTheme.DARK;
    RSettings.setValue("Theme/ThemeName", next);

    try {
        qApp.styleSheet = "";
        applyTheme();
        EAction.handleUserMessage(qsTr("Theme: %1. A restart settles " +
            "toolbar icons that were drawn for the previous theme.")
            .arg(next === SwapTheme.LIGHT ? qsTr("Light") : qsTr("Dark")));
    } catch (e) {
        EAction.handleUserMessage(qsTr("Theme set to %1 -- restart " +
            "CaveCAD to apply it.").arg(next));
    }

    this.terminate();
};

SwapTheme.init = function(basePath) {
    var action = new RGuiAction(qsTr("Swap Theme"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(false);
    action.setScriptFile(basePath + "/SwapTheme.js");
    action.setIcon(basePath + "/SwapTheme.svg");
    action.setStatusTip(qsTr("Switch between the dark and light interface theme"));
    action.setDefaultCommands(["swaptheme", "theme"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(95);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
