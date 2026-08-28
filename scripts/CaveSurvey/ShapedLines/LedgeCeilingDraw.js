// LedgeCeilingDraw.js -- the Ceiling Ledge button: dashed spine (the
// LEDGE-CEILING layer's linetype), hachures toward the LOWER ceiling
// (NSS 1976: "hachures point down"). Behavior lives in ShapedLinesRun.

include("scripts/EAction.js");
include(includeBasePath + "/ShapedLinesRun.js");

function LedgeCeilingDraw(guiAction) {
    ShapedLinesRun.call(this, guiAction);
}

LedgeCeilingDraw.prototype = new ShapedLinesRun();
LedgeCeilingDraw.prototype.styleKey = "ceilingledge";

LedgeCeilingDraw.init = function(basePath) {
    var drawAction = new RGuiAction(qsTr("Ceiling Ledge"),
        RMainWindowQt.getMainWindow());
    drawAction.setRequiresDocument(true);
    drawAction.setScriptFile(basePath + "/LedgeCeilingDraw.js");
    drawAction.setIcon(basePath + "/LedgeCeilingDraw.svg");
    drawAction.setStatusTip(qsTr("Drag along a ceiling ledge; dashed " +
        "line with ticks toward the lower ceiling"));
    drawAction.setDefaultCommands(["ledgeceiling", "lgc"]);
    drawAction.setGroupSortOrder(450);
    drawAction.setSortOrder(32);
    drawAction.setWidgetNames(["CaveLinesToolBar"]);
};
