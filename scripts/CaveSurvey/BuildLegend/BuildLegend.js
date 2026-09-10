// BuildLegend.js
//
// QCAD add-on tool: generate the legend from what the map ACTUALLY
// USES -- its lines as well as its symbols -- and say what each one
// means.
//
// Scans the drawing for catalogue symbols, traced feature layers and
// shaped lines (Core/CsLegend.js decides what that adds up to), then
// lays out one row each: a SAMPLE of the real thing beside its name,
// and under the name one plain sentence saying what it is. Lines come
// first and symbols after, because a reader meets the passage outline
// before they meet the stalactites.
//
// Nothing is invented: a feature the map does not draw does not appear.
// A legend explaining a rimstone dam that is nowhere on the sheet is
// worse than no legend, because a reader will go looking for it.
//
// THE SAMPLES ARE DRAWN, NOT DESCRIBED. A dashed inferred wall is shown
// dashed, a floor ledge is shown with its hachures, because "Inferred
// Walls" as words teaches nobody which of the lines on the map is the
// inferred one. They live on the LEGEND layer so the whole legend hides
// and clears as a unit, and carry the source layer's colour, linetype
// and lineweight explicitly so they still LOOK like what they explain.
//
// The sentences can be switched off with CaveSurvey/LegendExplain, for
// a tight sheet or a judge who wants the terse form.
//
// Re-running replaces the previous generated legend (tagged
// CaveSurvey/LegendRow) in the same undo step as drawing the new one.
//
// USAGE:
//   Cave Survey > Build Legend   (or type "bl")

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

var BL_ROW_HEIGHT = 2.0;      // drawing units per legend row
var BL_TEXT_OFFSET = 2.5;     // text x offset from the sample column

/** Puts one generated entity on the LEGEND layer, wearing the
 *  appearance of the layer it is explaining.
 *
 *  Explicit colour/linetype/lineweight rather than the real layer,
 *  because a legend has to be one object a caver can hide, move or
 *  delete without hunting fourteen layers -- and has to look like the
 *  map at the same time. This is the only place in the suite that sets
 *  appearance on an entity rather than letting its layer decide, and it
 *  is deliberate: these entities are a PICTURE of layers, not members
 *  of them. */
function blStyleAs(doc, entity, sourceLayer, legendLayerId) {
    entity.setLayerId(legendLayerId);
    if (isNull(sourceLayer) || sourceLayer === "") {
        return entity;
    }
    try {
        var style = CsLayers.styleOf(sourceLayer);
        entity.setColor(new RColor(style[0]));
        entity.setLinetypeId(CsLayers.linetypeIdFor(doc, style));
        entity.setLineweight(RLineweight[style[2]]);
    } catch (e) {
        // an unstyled sample is still the right shape in the right
        // place, which is most of what the row is for
    }
    return entity;
}

/** A short straight line for a "this is what that line looks like"
 *  sample, left to right at the row's height. */
function blSampleLine(doc, x, y, length) {
    return new RLineEntity(doc, new RLineData(
        new RVector(x, y), new RVector(x + length, y)));
}

/** The ornament for a shaped-line sample: a throwaway spine, tagged the
 *  way a real one is, run through the same generator the map uses. The
 *  spine is never added to the drawing -- only what it produces.
 *
 *  Side +1 puts the hachures BELOW the sample line, which is the way
 *  they are drawn on a map whose low ground is toward the reader. */
function blShapeDecor(doc, style, x, y, length) {
    var spec = CsShapeLine.STYLES[style];
    if (isNull(spec)) {
        return { spine: null, decor: [], layer: "" };
    }
    var spine = blSampleLine(doc, x, y, length);
    try {
        spine.setLayerId(doc.getLayerId(spec.spineLayer));
    } catch (eLayer) {
        // buildDecor only reads the layer to tell plan from elevation;
        // a spine without one is read as plan, which is what a legend
        // sample is
    }
    CsTags.set(spine, CsShapeLine.KEY.STYLE, style);
    CsTags.set(spine, CsShapeLine.KEY.ID, "legend-" + style);
    CsTags.set(spine, CsShapeLine.KEY.SIDE, "1");
    CsTags.set(spine, CsShapeLine.KEY.SCALE, "1");
    var built = null;
    try {
        built = CsShapeLine.buildDecor(doc, spine);
    } catch (eBuild) {
        built = null;
    }
    return {
        spine: spine,
        decor: isNull(built) ? [] : built.entities,
        // Flowstone, rimstone and slope keep their spine on a hidden
        // control layer, so their sample is the ORNAMENT alone -- which
        // is right: on the map, the ornament is all a reader sees.
        spineVisible: spec.spineLayer.indexOf("CTRL-") !== 0,
        spineLayer: spec.spineLayer,
        decorLayer: isNull(built) ? spec.decorLayer : built.decorLayer
    };
}

/** One line of legend text. */
function blText(doc, x, y, height, label, layerId) {
    var text = new RTextEntity(doc, new RTextData(
        new RVector(x, y), new RVector(x, y),
        height,
        100.0,
        RS.VAlignMiddle, RS.HAlignLeft,
        RS.LeftToRight, RS.Exact,
        1.0, label, "standard", false, false, 0.0, false));
    text.setLayerId(layerId);
    return text;
}

function buildLegendRun() {
    var doc = getDocument();
    if (doc === undefined || doc === null) {
        warning("Build Legend: no active drawing document.");
        return;
    }
    var di = getDocumentInterface();

    var explain = CsLegend.explaining();
    var rows = CsLegend.rowsFor(CsLegend.usage(doc));
    if (rows.length === 0) {
        warning("Build Legend: this map has nothing to explain yet.\n" +
            "Trace some walls or place some symbols first -- the " +
            "legend only ever describes what the map actually uses.");
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

    CsLayers.ensure(doc, di, CsLayers.LEGEND);

    var op = new RAddObjectsOperation();
    op.setText("Build legend");

    // clear the previously generated legend, same undo step
    var cleared = 0;
    var allIds = doc.queryAllEntities(false, false);
    for (var c = 0; c < allIds.length; c++) {
        var old = doc.queryEntity(allIds[c]);
        if (!isNull(old) && CsTags.get(old, CsLegend.TAG) !== "") {
            op.deleteObject(old);
            cleared++;
        }
    }

    var legendLayerId = doc.getLayerId(CsLayers.LEGEND);
    var perFoot = CsShapeLine.perFoot(doc);
    var sample = CsLegend.SAMPLE_FEET * perFoot;
    // The name column clears the widest sample, so a hachured ledge
    // never runs into its own label.
    var textX = xText + sample + BL_TEXT_OFFSET;
    var y = yText;

    var counts = { line: 0, shape: 0, symbol: 0 };
    var added = [];

    /** Everything this run draws goes through here: tagged so the next
     *  run can clear it, and never anywhere but the operation. */
    function keep(entity, key) {
        CsTags.set(entity, CsLegend.TAG, key);
        added.push(entity);
        op.addObject(entity, false);
    }

    for (var r = 0; r < rows.length; r++) {
        var row = rows[r];

        if (row.kind === "heading") {
            keep(blText(doc, xText, y, CsDraw.TEXT_HEIGHT,
                CsDraw.caps(row.label), legendLayerId), "heading");
            y -= BL_ROW_HEIGHT * CsLegend.heightOf(row, explain);
            continue;
        }

        if (row.kind === "line") {
            keep(blStyleAs(doc, blSampleLine(doc, xText, y, sample),
                row.layer, legendLayerId), row.key);
            counts.line++;
        } else if (row.kind === "shape") {
            var shaped = blShapeDecor(doc, row.style, xText, y, sample);
            if (shaped.spineVisible === true && !isNull(shaped.spine)) {
                keep(blStyleAs(doc, shaped.spine, shaped.spineLayer,
                    legendLayerId), row.key);
            }
            for (var d = 0; d < shaped.decor.length; d++) {
                keep(blStyleAs(doc, shaped.decor[d], shaped.decorLayer,
                    legendLayerId), row.key);
            }
            counts.shape++;
        } else {
            var block = doc.queryBlock(row.block);
            if (!isNull(block)) {
                // NORMALISED to one legend size. A custom symbol may be
                // drawn anything up to the palette's 10 ft working
                // square, and Truitt Cave's mud slope at scale 1 came
                // out taller than the five rows above it.
                var radius = 0;
                try {
                    radius = CsSymbolStore.radiusOf(doc, row.block);
                } catch (eRadius) {
                    radius = 0;
                }
                var symScale = CsLegend.scaleForSize(
                    CsLegend.SYMBOL_FEET, radius, perFoot);
                var data = new RBlockReferenceData(block.getId(),
                    new RVector(xText + sample / 2, y),
                    new RVector(symScale, symScale),
                    0, 1, 1, 1, 1);
                var symRef = new RBlockReferenceEntity(doc, data);
                keep(blStyleAs(doc, symRef, row.layer, legendLayerId),
                    row.key);
            }
            counts.symbol++;
        }

        keep(blText(doc, textX, y, CsDraw.TEXT_HEIGHT,
            CsDraw.caps(row.label), legendLayerId), row.key);

        // The sentence, under the name and indented, at two thirds the
        // height: a legend is a list of names first, and the meanings
        // must not compete with them for a reader's eye.
        var explainLines = CsLegend.explainLines(row, explain);
        var below = y;
        for (var e = 0; e < explainLines.length; e++) {
            below -= BL_ROW_HEIGHT * 0.6;
            keep(blText(doc, textX + BL_TEXT_OFFSET, below,
                CsDraw.TEXT_HEIGHT * 0.66, explainLines[e],
                legendLayerId), row.key);
        }

        y -= BL_ROW_HEIGHT * CsLegend.heightOf(row, explain);
    }

    di.applyOperation(op);

    var parts = [];
    if (counts.line > 0) {
        parts.push(counts.line + " line" + (counts.line === 1 ? "" : "s"));
    }
    if (counts.shape > 0) {
        parts.push(counts.shape + " shaped line" +
            (counts.shape === 1 ? "" : "s"));
    }
    if (counts.symbol > 0) {
        parts.push(counts.symbol + " symbol" +
            (counts.symbol === 1 ? "" : "s"));
    }
    EAction.handleUserMessage("Build Legend: " + parts.join(", ") +
        " in use, legend drawn" +
        (explain ? " with what each one means" : "") +
        (cleared > 0 ? " (previous generated legend replaced)" : "") +
        ". Anything the map does not use is not in the legend -- by " +
        "design.");
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
    action.setGroupSortOrder(454);
    action.setSortOrder(30);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
