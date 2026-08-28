// PitDraw.js -- the Pit button: drag AROUND the pit's edge and release
// near where you pressed; the loop closes itself and the hachures aim
// into the hole (NSS 1976: a pit is a closed contour, hachures point
// in/down). Behavior lives in ShapedLinesRun; the close-the-loop and
// aim-inward specifics key off the style's `close` flag there.

include("scripts/EAction.js");
include(includeBasePath + "/ShapedLinesRun.js");

function PitDraw(guiAction) {
    ShapedLinesRun.call(this, guiAction);
}

PitDraw.prototype = new ShapedLinesRun();
PitDraw.prototype.styleKey = "pit";

PitDraw.init = function(basePath) {
    var drawAction = new RGuiAction(qsTr("Pit"),
        RMainWindowQt.getMainWindow());
    drawAction.setRequiresDocument(true);
    drawAction.setScriptFile(basePath + "/PitDraw.js");
    drawAction.setIcon(basePath + "/PitDraw.svg");
    drawAction.setStatusTip(qsTr("Drag around a pit edge; the loop " +
        "closes itself and ticks point into the hole"));
    drawAction.setDefaultCommands(["pitedge", "pte"]);
    drawAction.setGroupSortOrder(450);
    drawAction.setSortOrder(33);
    drawAction.setWidgetNames(["CaveLinesToolBar"]);
};
