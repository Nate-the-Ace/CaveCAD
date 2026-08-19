// LRUDWalls.js
//
// QCAD add-on tool: draw approximate passage walls (previsualization
// only) from the LRUD data tagged on the drawing's stations.
//
// WHAT CHANGED FROM THE OLD GENERATION: the walls are built from the
// survey model read back out of the drawing's tags (Core/Tags.js), in
// Seq order -- the survey's own order -- instead of entity creation
// order. That makes this work on IMPORTED surveys, resumed traverses
// and multi-traverse drawings, all of which the old version silently
// got wrong.
//
// Straight segments only, on faint dashed CTRL-LRUD-WALL-* layers: no
// splines, because implying wall detail between stations that isn't
// in the data would misrepresent the passage. Junction stations and
// stations without LRUD end a wall run rather than guessing across.
// Trace the real walls over these (WALLS-SURVEYED / WALLS-INFERRED),
// then hide the CTRL layers for printing.
//
// REQUIRES: stations drawn by Azimuth Traverse, Import Cave Survey or
// the Survey Notebook -- anything that tags CaveSurvey/Station data.
//
// One undo step.

include("scripts/EAction.js");
include("scripts/simple.js");
include("scripts/CaveSurvey/Core/All.js");

function lrudWallsRun() {
    var doc = getDocument();
    if (doc === undefined || doc === null) {
        warning("LRUD Walls: no active drawing document.");
        return;
    }

    var survey = CsTags.surveyFromDocument(doc);
    if (survey.shots.length === 0) {
        warning("LRUD Walls: no tagged survey stations found.\n" +
            "Run Azimuth Traverse, Import Cave Survey or the Survey " +
            "Notebook first -- this tool draws walls from the LRUD " +
            "they record.");
        return;
    }

    var resolved = CsNetwork.resolve(survey, {});
    var runs = CsLrud.wallRuns(survey, resolved);

    if (runs.left.length === 0 && runs.right.length === 0) {
        warning("LRUD Walls: the stations carry no usable LRUD.\n" +
            "Left/Right measurements are what wall runs are built from.");
        return;
    }

    CsLayers.ensure(CsLayers.LRUD_WALL_LEFT);
    CsLayers.ensure(CsLayers.LRUD_WALL_RIGHT);

    startTransaction(doc);
    var polylines = 0;
    var drawRuns = function(runList, layerName) {
        setCurrentLayer(layerName);
        for (var i = 0; i < runList.length; i++) {
            var pts = [];
            for (var k = 0; k < runList[i].length; k++) {
                pts.push(new RVector(runList[i][k].x, runList[i][k].y));
            }
            addPolyline(pts, false);
            polylines++;
        }
    };
    drawRuns(runs.left, CsLayers.LRUD_WALL_LEFT);
    drawRuns(runs.right, CsLayers.LRUD_WALL_RIGHT);
    endTransaction();

    autoZoom();
    EAction.handleUserMessage("LRUD Walls: " + polylines + " wall run" +
        (polylines === 1 ? "" : "s") + " drawn (dashed = approximate). " +
        "Runs break at junctions and unmeasured stations on purpose -- " +
        "trace the real walls onto WALLS-SURVEYED over these.");
}

// ============================================================
// Add-on wiring -- the standard pattern; see docs.
// ============================================================

function LRUDWalls(guiAction) {
    EAction.call(this, guiAction);
}

LRUDWalls.prototype = new EAction();

LRUDWalls.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    lrudWallsRun();
    this.terminate();
};

LRUDWalls.init = function(basePath) {
    var action = new RGuiAction(qsTr("LRUD Walls"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/LRUDWalls.js");
    action.setIcon(basePath + "/LRUDWalls.svg");
    action.setStatusTip(qsTr("Draw approximate passage walls from the LRUD recorded on the survey's stations"));
    action.setDefaultCommands(["lrudwalls", "lw"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(30);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
