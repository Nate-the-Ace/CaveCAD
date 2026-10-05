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


/** True when the layout already has a border (axis-aligned BORDER lines most of the paper wide and tall). */
CsLayoutFurniture.hasBorder = function(doc, info) {
    var ps = Layouts.paperSize(doc, info), inch = Layouts.toPaper(doc, 25.4);
    var W = ps.w / inch, H = ps.h / inch, h = 0, v = 0;
    var ids = doc.queryBlockEntities(info.blockId);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || e.isUndone() || e.getType() !== RS.EntityLine || CsBind.layerNameOf(doc, e) !== CsLayers.BORDER) {
            continue;
        }
        var a = e.getStartPoint(), b = e.getEndPoint(), len = a.getDistanceTo(b) / inch;
        if (Math.abs(a.y - b.y) < 1e-9 && len >= 0.6 * W) { h++; }
        else if (Math.abs(a.x - b.x) < 1e-9 && len >= 0.6 * H) { v++; }
    }
    return h >= 2 && v >= 2;
};

// ---------------------------------------------------------------------
// The legend: a VIEWPORT onto the legend in model space
//
// Build Legend draws the legend in model space on the LEGEND layer. A sheet
// shows it the AutoCAD way: a viewport framed on the legend that hides every
// other layer, while the cave's own viewports hide LEGEND -- so the legend is
// drawn once, at its own scale, and never lands on top of the map.
// ---------------------------------------------------------------------

/** The legend's extents in model space, {minX, minY, maxX, maxY}, or undefined when none is built. */
CsLayoutFurniture.legendBox = function(doc) {
    var box;
    var ids = doc.queryBlockEntities(doc.getModelSpaceBlockId());
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || e.isUndone()) {
            continue;
        }
        var mine = CsTags.get(e, CsLegend.TAG) !== "" || CsBind.layerNameOf(doc, e) === CsLayers.LEGEND;
        if (!mine) {
            continue;
        }
        var b = e.getBoundingBox(), mn = b.getMinimum(), mx = b.getMaximum();
        if (!isFinite(mn.x) || !isFinite(mx.x) || !isFinite(mn.y) || !isFinite(mx.y)) {
            continue;
        }
        if (isNull(box)) {
            box = { minX: mn.x, minY: mn.y, maxX: mx.x, maxY: mx.y };
        }
        else {
            box.minX = Math.min(box.minX, mn.x); box.minY = Math.min(box.minY, mn.y);
            box.maxX = Math.max(box.maxX, mx.x); box.maxY = Math.max(box.maxY, mx.y);
        }
    }
    return box;
};

/** Every layer id EXCEPT the named one: what a legend viewport hides. */
CsLayoutFurniture.allLayersExcept = function(doc, keepName) {
    var ids = [], names = doc.getLayerNames();
    for (var i = 0; i < names.length; i++) {
        if (String(names[i]) !== keepName) {
            ids.push(doc.getLayerId(names[i]));
        }
    }
    return ids;
};

/** True when a viewport is a legend viewport. */
CsLayoutFurniture.isLegendViewport = function(vp) {
    return String(vp.getCustomProperty("CaveCAD", "Legend", "")) === "1";
};

/**
 * Adds a legend viewport with its top left at paper (x, y), at the first
 * standard scale at which the legend fits in about a third of the sheet, and
 * makes the layout's other viewports hide LEGEND.
 *
 * \return true when added (false: no legend built yet; the caver is told)
 */
CsLayoutFurniture.addLegend = function(doc, di, info, x, y) {
    var box = CsLayoutFurniture.legendBox(doc);
    if (isNull(box)) {
        CsTell.warn(qsTr("Add Legend: there is no legend in the drawing yet. In the model, run Cave Survey > Build Legend first."));
        return false;
    }
    var ps = Layouts.paperSize(doc, info);
    var w = Math.max(box.maxX - box.minX, 1e-9), h = Math.max(box.maxY - box.minY, 1e-9);
    var fpi = NewViewport.fitScale(doc, ps.w / 3, ps.h / 3, box);
    var s = Layouts.scaleFor(doc, fpi);
    var vw = w * s * 1.04, vh = h * s * 1.04;
    var x0 = Math.min(Math.max(x, 0), Math.max(0, ps.w - vw));
    var y1 = Math.max(Math.min(y, ps.h), vh);
    var vp = new RViewportEntity(doc, new RViewportData());
    vp.setCenter(new RVector(x0 + vw / 2, y1 - vh / 2));
    vp.setWidth(vw);
    vp.setHeight(vh);
    vp.setScale(s);
    vp.setViewCenter(new RVector((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2));
    vp.setViewTarget(new RVector(0, 0));
    vp.setBlockId(info.blockId);
    vp.setLayerId(doc.getCurrentLayerId());
    vp.setFrozenLayerIds(CsLayoutFurniture.allLayersExcept(doc, CsLayers.LEGEND));
    vp.setCustomProperty("CaveCAD", "NoRaster", "1");
    vp.setCustomProperty("CaveCAD", "Legend", "1");
    vp.setStatus(vp.getStatus() | Layouts.LOCK_BIT);

    doc.startTransactionGroup();
    var group = doc.getTransactionGroup();
    var add = new RAddObjectOperation(vp, false);
    add.setText(qsTr("Add legend"));
    add.setTransactionGroup(group);
    di.applyOperation(add);

    // the map's own viewports must not show the legend
    var legendId = doc.getLayerId(CsLayers.LEGEND);
    var others = Layouts.viewports(doc, info);
    for (var i = 0; i < others.length; i++) {
        var o = others[i];
        if (o.isOverall() || CsLayoutFurniture.isLegendViewport(o)) {
            continue;
        }
        var ids = o.getFrozenLayerIds();
        if (ids.indexOf(legendId) < 0 && legendId !== RObject.INVALID_ID) {
            var fresh = doc.queryEntity(o.getId());
            ids.push(legendId);
            fresh.setFrozenLayerIds(ids);
            var mod = new RModifyObjectOperation(fresh);
            mod.setText(qsTr("Add legend"));
            mod.setTransactionGroup(group);
            di.applyOperation(mod);
        }
    }
    return true;
};


/** The Add Border tool's body: a 0.2 inch border on the current layout, unless it already has one. */
CsLayoutFurniture.addBorderTool = function(di) {
    var doc = di.getDocument();
    var info = CsLayoutFurniture.layoutOrWarn(doc, qsTr("Add Border"));
    if (isNull(info)) {
        return false;
    }
    if (CsLayoutFurniture.hasBorder(doc, info)) {
        CsTell.warn(qsTr("Add Border: this layout already has a border."));
        return false;
    }
    return CsLayoutFurniture.addBorder(doc, di, info, 0.2);
};
