// BuildLegend.js
//
// QCAD add-on tool: generate the symbol legend from the symbols the
// map ACTUALLY USES.
//
// Scans the drawing for references to catalog symbols (Core/
// Symbols.js), then lays out one legend row per distinct symbol --
// the block at legend scale beside its NSS name (with the UIS alias
// where it differs) -- as a column on the LEGEND layer, at a point
// you type. Nothing is invented: a symbol that isn't on the map
// doesn't appear in the legend, which is exactly what the salon's
// "symbols explained" element means.
//
// Re-running replaces the previous generated legend (tagged
// CaveSurvey/LegendRow) in the same undo step as drawing the new one.
//
// USAGE:
//   Cave Survey > Build Legend   (or type "bl")

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/All.js");

var BL_ROW_HEIGHT = 2.0;      // drawing units per legend row
var BL_SYMBOL_SCALE = 1.0;
var BL_TEXT_OFFSET = 2.5;     // text x offset from the symbol column

function buildLegendRun() {
    var doc = getDocument();
    if (doc === undefined || doc === null) {
        warning("Build Legend: no active drawing document.");
        return;
    }
    var di = getDocumentInterface();

    // ---- which catalog symbols does the map use? -------------------
    var used = {};
    var refIds = doc.queryAllEntities(false, false, RS.EntityBlockRef);
    for (var i = 0; i < refIds.length; i++) {
        var ref = doc.queryEntity(refIds[i]);
        if (isNull(ref)) {
            continue;
        }
        // generated legend rows don't count as usage
        if (CsTags.get(ref, "LegendRow") !== "") {
            continue;
        }
        var block = doc.queryBlock(ref.getReferencedBlockId());
        if (isNull(block)) {
            continue;
        }
        var entry = CsSymbols.byBlock(block.getName());
        if (entry !== null) {
            used[entry.block] = entry;
        }
    }

    var entries = [];
    for (i = 0; i < CsSymbols.CATALOG.length; i++) { // catalog order = stable
        if (used.hasOwnProperty(CsSymbols.CATALOG[i].block)) {
            entries.push(CsSymbols.CATALOG[i]);
        }
    }
    if (entries.length === 0) {
        warning("Build Legend: no catalog symbols found on the map yet.\n" +
            "Place symbols first (Scatter Breakdown, or insert SYM_* " +
            "blocks) -- the legend only explains what the map uses.");
        return;
    }

    // ---- where does the legend go? -----------------------------------
    var xText = getDouble("Build Legend", "Legend position X:", 0.0, 3);
    if (xText === undefined) {
        return;
    }
    var yText = getDouble("Build Legend", "Legend position Y (top):", 0.0, 3);
    if (yText === undefined) {
        return;
    }

    CsLayers.ensure(CsLayers.LEGEND);

    var op = new RAddObjectsOperation();
    op.setText("Build legend");

    // clear the previously generated legend, same undo step
    var cleared = 0;
    var allIds = doc.queryAllEntities(false, false);
    for (i = 0; i < allIds.length; i++) {
        var old = doc.queryEntity(allIds[i]);
        if (!isNull(old) && CsTags.get(old, "LegendRow") !== "") {
            op.deleteObject(old);
            cleared++;
        }
    }

    var legendLayerId = doc.getLayerId(CsLayers.LEGEND);
    var y = yText;
    var rows = 0;
    for (i = 0; i < entries.length; i++) {
        var entry = entries[i];
        var pos = new RVector(xText, y);

        var block = doc.queryBlock(entry.block);
        if (!isNull(block)) {
            var data = new RBlockReferenceData(block.getId(), pos,
                new RVector(BL_SYMBOL_SCALE, BL_SYMBOL_SCALE), 0, 1, 1, 1, 1);
            var symRef = new RBlockReferenceEntity(doc, data);
            symRef.setLayerId(legendLayerId);
            CsTags.set(symRef, "LegendRow", entry.block);
            op.addObject(symRef, false);
        }

        var label = entry.nss;
        if (entry.uis !== entry.nss) {
            label += "  (UIS: " + entry.uis + ")";
        }
        var text = new RTextEntity(doc, new RTextData(
            new RVector(xText + BL_TEXT_OFFSET, y),
            new RVector(xText + BL_TEXT_OFFSET, y),
            CsDraw.TEXT_HEIGHT,
            100.0,
            RS.VAlignMiddle, RS.HAlignLeft,
            RS.LeftToRight, RS.Exact,
            1.0, label, "standard", false, false, 0.0, false));
        text.setLayerId(legendLayerId);
        CsTags.set(text, "LegendRow", entry.block);
        op.addObject(text, false);

        y -= BL_ROW_HEIGHT;
        rows++;
    }

    di.applyOperation(op);

    EAction.handleUserMessage("Build Legend: " + rows + " symbol" +
        (rows === 1 ? "" : "s") + " in use, legend drawn" +
        (cleared > 0 ? " (previous generated legend replaced)" : "") +
        ". Symbols not on the map are not in the legend -- by design.");
}

// ============================================================
// Add-on wiring -- the standard pattern; see docs.
// ============================================================

function BuildLegend(guiAction) {
    EAction.call(this, guiAction);
}

BuildLegend.prototype = new EAction();

BuildLegend.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    buildLegendRun();
    this.terminate();
};

BuildLegend.init = function(basePath) {
    var action = new RGuiAction(qsTr("Build Legend"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/BuildLegend.js");
    action.setIcon(basePath + "/BuildLegend.svg");
    action.setStatusTip(qsTr("Generate the legend from the symbols the map actually uses, NSS names with UIS aliases"));
    action.setDefaultCommands(["buildlegend", "bl"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(78);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
