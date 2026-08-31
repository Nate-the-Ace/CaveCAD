// RestyleLayers.js
//
// QCAD add-on tool: make this drawing's layers match the current
// palette.
//
// Every drawing keeps the layer appearance it was BORN with --
// CsLayers.ensure resolves colour, linetype and lineweight at creation
// and never revisits them -- so a cave started before a palette change
// stays on the old palette forever, and a cave started from an old
// template is missing every layer added since. This command closes both
// gaps in one undo step: it adds the registry layers the drawing lacks,
// then rewrites colour/linetype/lineweight on the ones it has.
//
// It touches LAYER RECORDS ONLY. No entity is moved, deleted, recoloured
// or re-layered; anything drawn with an explicit per-entity colour keeps
// it (nothing in the suite does that except the Sketch Scans preview).
// A layer CsLayers has never heard of -- a caver's own, or an imported
// one -- is left exactly as it is.
//
// USAGE:
//   Cave Survey > Restyle Layers   (or type "rsl")

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

function restyleLayersRun() {
    var doc = getDocument();
    if (doc === undefined || doc === null) {
        warning("Restyle Layers: no active drawing document.");
        return;
    }
    var di = getDocumentInterface();

    // Counted BEFORE the sweep: ensureAndApply adds layers as it goes,
    // and a count taken afterwards would report the new total as though
    // the drawing had always had them.
    var before = doc.queryAllLayers().length;

    var res = CsRestyle.ensureAndApply(doc, di);

    var msg = "Restyle Layers: " + res.changed.length + " of " +
        res.total + " registry layer" + (res.total === 1 ? "" : "s") +
        " restyled";
    if (res.added > 0) {
        msg += ", " + res.added + " missing layer" +
            (res.added === 1 ? "" : "s") + " added";
    }
    msg += " (" + before + " layers before). Layer records only -- no " +
        "entity was touched.";
    if (res.changed.length === 0 && res.added === 0) {
        msg = "Restyle Layers: already matches the palette -- nothing " +
            "to change.";
    }
    EAction.handleUserMessage(msg);
}

// ============================================================
// Add-on wiring -- the standard pattern; see docs.
// ============================================================

function RestyleLayers(guiAction) {
    EAction.call(this, guiAction);
}

RestyleLayers.prototype = new EAction();

RestyleLayers.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    restyleLayersRun();
    this.terminate();
};

RestyleLayers.init = function(basePath) {
    var action = new RGuiAction(qsTr("Restyle Layers"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/RestyleLayers.js");
    action.setIcon(basePath + "/RestyleLayers.svg");
    action.setStatusTip(qsTr("Apply the current layer palette to this drawing: add missing registry layers, restyle the rest"));
    action.setDefaultCommands(["restylelayers", "rsl"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(94);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
