// CsLayoutFurniture.js -- the Layout menu's "add a ... to this sheet" tools.
//
// Part of the Cave Survey Core library.
//
// Sheet Setup draws a whole sheet's furniture for you; these put ONE piece on
// a layout you are composing by hand -- a north arrow, a title block, a scale
// bar -- exactly as Sheet Setup would draw it (they draw through the same
// helpers, CsLayoutGen.envFor / drawNorth / drawTitle), and linked the same
// way: the north arrow and scale bar follow the viewport they belong to.
//
// Pieces made here carry no generator tag, so Sheet Setup never rewrites or
// deletes them: they are the person's.

var CsLayoutFurniture = {};

/** The layout being worked on, or undefined (and the caver is told why). */
CsLayoutFurniture.layoutOrWarn = function(doc, toolName) {
    var info = Layouts.current(doc);
    if (isNull(info) || CsModelSpace.inViewport()) {
        try {
            CsTell.warn(toolName + ": click a layout tab first (and leave the viewport) -- this puts a piece on a sheet, not in the cave.");
        } catch (e) {
        }
        return undefined;
    }
    return info;
};

/** The viewport a piece at paper (x, y) belongs to: the one under it, else the layout's only one. */
CsLayoutFurniture.viewportFor = function(doc, info, x, y) {
    return CsNorth.viewportFor(doc, info.blockId, x, y);
};

/** The latest declination reading of the survey, or null. */
CsLayoutFurniture.reading = function(doc) {
    try {
        var state = SheetSetup.readState(doc);
        if (!isNull(state) && state.ok === true) {
            return CsSheetSetup.latestDeclination(state.survey);
        }
    } catch (e) {
    }
    return null;
};

/** Inches of paper for a paper-space coordinate. */
CsLayoutFurniture.inches = function(doc, v) {
    return v / Layouts.toPaper(doc, 25.4);
};

/**
 * A north arrow with its base at paper (x, y), turned to the viewport's
 * angle and kept turned to it.
 *
 * \return true when it was added (false: no viewport to point north for)
 */
CsLayoutFurniture.addNorth = function(doc, di, info, x, y, vpOverride) {
    var vp = isNull(vpOverride) ? CsLayoutFurniture.viewportFor(doc, info, x, y) : vpOverride;
    if (isNull(vp)) {
        CsTell.warn(qsTr("Add North Arrow: there is no viewport on this layout to point north for."));
        return false;
    }
    doc.startTransactionGroup();
    var group = doc.getTransactionGroup();
    var fresh = doc.queryEntity(vp.getId());
    var guid = CsScaleBar.ensureGuid(fresh);
    var mod = new RModifyObjectOperation(fresh);
    mod.setText(qsTr("Add north arrow"));
    mod.setTransactionGroup(group);
    di.applyOperation(mod);

    var env = CsLayoutGen.envFor(doc, di, info.blockId, qsTr("Add north arrow"), "");
    env.op.setTransactionGroup(group);
    CsLayoutGen.drawNorth(env, CsLayoutFurniture.inches(doc, x), CsLayoutFurniture.inches(doc, y),
        CsLayoutFurniture.reading(doc), guid);
    di.applyOperation(env.op);
    // turned to the viewport's angle straight away
    CsNorth.sync(doc, di, doc.queryEntity(vp.getId()), group, false);
    return true;
};

/** The title block with its lower left at paper (x, y), filled from the survey and what the drawing already says. */
CsLayoutFurniture.addTitle = function(doc, di, info, x, y) {
    var values = {};
    try {
        var state = SheetSetup.readState(doc);
        values = SheetSetup.titleValues(doc, isNull(state) ? {} : state.filled);
    } catch (e) {
        values = {};
    }
    var lines = CsSheetSetup.titleLines(values);
    var env = CsLayoutGen.envFor(doc, di, info.blockId, qsTr("Add title block"), "");
    var xIn = CsLayoutFurniture.inches(doc, x), yIn = CsLayoutFurniture.inches(doc, y);
    CsLayoutGen.drawTitle(env, xIn, yIn + CsSheetSetup.linesHeight(lines), lines, values, "plan");
    di.applyOperation(env.op);
    return lines.length;
};

/** A scale bar for the viewport under (x, y), starting at paper (x, y). */
CsLayoutFurniture.addScaleBar = function(doc, di, info, x, y, vpOverride, quiet) {
    var vp = isNull(vpOverride) ? CsLayoutFurniture.viewportFor(doc, info, x, y) : vpOverride;
    if (isNull(vp)) {
        if (quiet !== true) { CsTell.warn(qsTr("Add Scale Bar: there is no viewport on this layout to measure.")); }
        return false;
    }
    if (CsScaleBar.hasBar(doc, vp)) {
        if (quiet === true) { return false; }
        CsTell.warn(qsTr("Add Scale Bar: this viewport already has one (a viewport has one bar; delete it to place another)."));
        return false;
    }
    return CsScaleBar.addFor(doc, di, vp, CsLayoutFurniture.inches(doc, x), CsLayoutFurniture.inches(doc, y));
};

/**
 * The body every "click where it goes" tool shares.
 *
 * \param tool   the EAction
 * \param name   the tool's title
 * \param prompt what to click
 * \param place  function(doc, di, info, x, y) called with the click
 */
CsLayoutFurniture.beginPlacing = function(tool, name, prompt) {
    var doc = tool.getDocument();
    if (isNull(CsLayoutFurniture.layoutOrWarn(doc, name))) {
        tool.terminate();
        return false;
    }
    var di = tool.getDocumentInterface();
    di.setClickMode(RAction.PickCoordinate);
    tool.setCrosshairCursor();
    tool.setCommandPrompt(prompt);
    tool.setLeftMouseTip(prompt);
    tool.setRightMouseTip(EAction.trCancel);
    return true;
};


/** A border `inset` inches inside the paper's edge, on the BORDER layer. */
CsLayoutFurniture.addBorder = function(doc, di, info, inset) {
    var ps = Layouts.paperSize(doc, info);
    var inch = Layouts.toPaper(doc, 25.4);
    var env = CsLayoutGen.envFor(doc, di, info.blockId, qsTr("Add border"), "");
    var W = ps.w / inch, H = ps.h / inch, b = inset;
    env.line(b, b, W - b, b, CsLayers.BORDER);
    env.line(W - b, b, W - b, H - b, CsLayers.BORDER);
    env.line(W - b, H - b, b, H - b, CsLayers.BORDER);
    env.line(b, H - b, b, b, CsLayers.BORDER);
    di.applyOperation(env.op);
    return true;
};
