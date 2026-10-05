// CsLayoutGen.js -- Sheet Setup's output as LAYOUTS in the drawing.
//
// Part of the Cave Survey Core library.
//
// WHAT THIS REPLACES. Sheet Setup used to copy the whole record into a new
// drawing per sheet, cut the geometry down to the sheet, draw the furniture
// into the copy and export it into the cave's sheets/ folder. A grid of
// tiles was a grid of files. Here every sheet is a LAYOUT of the cave's own
// drawing (see scripts/Layouts/Layouts.js): a named piece of paper holding
//
//   - ONE VIEWPORT showing the part of the cave this sheet is responsible
//     for, at the plot scale, with the other views' layers frozen in it;
//   - the sheet's FURNITURE drawn in paper space: border, title block,
//     scale bar, north arrow, match lines, "SHEET B2".
//
// Nothing is copied, nothing is clipped, nothing is stale: the viewport
// shows the live drawing, and a PDF of all the layouts is one call.
//
// AUTO AND MANUAL. A layout this file generates is AUTO: Sheet Setup owns
// it and rewrites it freely. The first hand edit turns it MANUAL (see the
// layout listener) and a manual layout is never touched again until its
// owner asks for the generated one back (CsLayoutGen.revert). Everything
// generated here carries the TAG below so "what did the generator draw" is
// a question with an answer.
//
// COORDINATES. A sheet is drawn in INCHES OF PAPER from its lower left
// corner, then converted to paper-space coordinates (drawing units, see
// Layouts.js) at the one place, `P`. The same furniture arithmetic as the
// old file builder (CsSheetSetup.furniture) is used unchanged.

var CsLayoutGen = {};

/** Tag on every entity this file draws; its value says which piece it is. */
CsLayoutGen.TAG = "LayoutGen";

/** Tag on a layout's generator inputs (custom property of the layout). */
CsLayoutGen.INPUTS = "GenInputs";

/** The layers that belong to the OTHER views, by frame, are frozen in a viewport. */
// ("sheet" layers -- 0, BORDER, TITLE-BLOCK... -- are shared by every view on
// purpose, see CsLayers.SHEET_LAYERS, so they are never frozen.)
CsLayoutGen.OTHER_FRAMES = {
    plan: ["profile", "section"],
    elevation: ["plan", "section"]
};

/**
 * Plans the sheets of one run: pure geometry, no document.
 *
 * \param o.caveBox     {minX, minY, maxX, maxY} of the plan, drawing units
 * \param o.elevBox     the profile frame's box, or null
 * \param o.sheet       {name, w, h} inches
 * \param o.turned      paper turned (portrait)
 * \param o.scale       feet per inch
 * \param o.perFoot     drawing units per foot
 * \param o.wants       {border, bar, north, title}
 * \param o.titleValues what the title block says (id -> text)
 * \param o.reading     declination reading or null (CsSheetSetup.latestDeclination)
 * \param o.tiles       a tiled CsSheetTile layout, or null for ONE plan sheet
 * \param o.shiftInches {x, y} how far the single plan sheet was slid by hand
 * \param o.elevation   also plan an elevation sheet (needs elevBox)
 * \return [{id, name, kind, ...}] one per sheet, plan sheets first
 */
CsLayoutGen.plan = function(o) {
    var wants = isNull(o.wants) ? { border: true, bar: true, north: true, title: true } : o.wants;
    var titleLines = (wants.title === true) ? CsSheetSetup.titleLines(o.titleValues) : [];
    var titleHeight = CsSheetSetup.linesHeight(titleLines) + 0.2;
    var turned = o.turned === true;
    var W = turned ? o.sheet.h : o.sheet.w;
    var H = turned ? o.sheet.w : o.sheet.h;
    var margin = CsSheetSetup.MARGIN_INCHES;
    var jobs = [];

    function furnitureFor(titleHere, elevation) {
        return CsSheetSetup.furniture({
            widthInches: W,
            wants: { title: titleHere, bar: wants.bar === true,
                north: wants.north === true && !elevation },
            titleHeight: titleHeight,
            reading: o.reading });
    }

    function job(id, kind, box, map, tile, titleHere, fur) {
        return {
            id: id, name: id, kind: kind, turned: turned,
            paperInches: { w: W, h: H }, marginInches: margin,
            box: box, map: map, tile: tile, titleHere: titleHere,
            wants: { border: wants.border === true, bar: wants.bar === true,
                north: wants.north === true && kind !== "elevation",
                title: titleHere },
            fur: fur, titleLines: titleLines, scale: o.scale,
            perFoot: o.perFoot, sheetName: o.sheet.name, reading: o.reading
        };
    }

    var i;
    if (!isNull(o.tiles) && o.tiles.tiled === true) {
        for (i = 0; i < o.tiles.tiles.length; i++) {
            var t = o.tiles.tiles[i];
            var titleHere = wants.title === true && t.title === true;
            jobs.push(job(t.id, "plan", t.paper, t.map, t, titleHere, furnitureFor(titleHere, false)));
        }
    }
    else {
        var titleOne = wants.title === true;
        var fur = furnitureFor(titleOne, false);
        // borderBox works in drawing units per inch of paper: feet per inch
        // times the drawing's units per foot
        var box = CsSheetSetup.borderBox(o.caveBox, o.sheet, o.scale * o.perFoot, turned,
            fur.footer, isNull(o.shiftInches) ? { x: 0, y: 0 } : o.shiftInches);
        jobs.push(job("Plan", "plan", box, CsLayoutGen.mapOfBox(box), null, titleOne, fur));
    }

    if (o.elevation === true && !isNull(o.elevBox)) {
        var furE = furnitureFor(wants.title === true, true);
        var boxE = CsSheetSetup.borderBox(o.elevBox, o.sheet, o.scale * o.perFoot, turned,
            furE.footer, { x: 0, y: 0 });
        jobs.push(job("Elevation", "elevation", boxE, CsLayoutGen.mapOfBox(boxE), null,
            wants.title === true, furE));
    }
    return jobs;
};

/** The model-space rectangle a viewport shows for a border box: inside the margin, above the footer. */
CsLayoutGen.mapOfBox = function(box) {
    return { minX: box.minX + box.margin, maxX: box.maxX - box.margin,
        minY: box.minY + box.margin + box.footer, maxY: box.maxY - box.margin };
};

/**
 * The viewport of a job, in INCHES OF PAPER from the sheet's lower left,
 * plus what it shows: { x, y, w, h (inches), viewCenter, scaleInchPerUnit }.
 * `inchPerUnit` is inches of paper per drawing unit of the cave.
 */
CsLayoutGen.viewportOf = function(job) {
    var inchPerUnit = 1 / (job.scale * job.perFoot);
    var map = job.map;
    var w = (map.maxX - map.minX) * inchPerUnit;
    var h = (map.maxY - map.minY) * inchPerUnit;
    var x = (map.minX - job.box.minX) * inchPerUnit;
    var y = (map.minY - job.box.minY) * inchPerUnit;
    return { x: x, y: y, w: w, h: h,
        viewCenter: { x: (map.minX + map.maxX) / 2, y: (map.minY + map.maxY) / 2 },
        inchPerUnit: inchPerUnit };
};

/** A model point as inches of paper from the job's sheet corner. */
CsLayoutGen.inchesOf = function(job, x, y) {
    var inchPerUnit = 1 / (job.scale * job.perFoot);
    return { x: (x - job.box.minX) * inchPerUnit, y: (y - job.box.minY) * inchPerUnit };
};

/** Layers whose frame is any of `frames`, among the layers the document has. */
CsLayoutGen.layersOfFrames = function(doc, frames) {
    var ids = [];
    var names = doc.getLayerNames();
    for (var i = 0; i < names.length; i++) {
        var frame = CsLayers.frameOf(names[i]);
        if (frames.indexOf(frame) >= 0) {
            ids.push(doc.getLayerId(names[i]));
        }
    }
    return ids;
};

// ---------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------

/**
 * Draws one planned sheet into its layout's paper space.
 *
 * \param doc, di     the drawing and its interface
 * \param job         one CsLayoutGen.plan entry
 * \param info        the layout (Layouts.get) the sheet goes on
 * \return the list of things drawn, as words
 */
CsLayoutGen.draw = function(doc, di, job, info, extra) {
    var blockId = info.blockId;
    var inch = Layouts.toPaper(doc, 25.4);              // paper-space coordinates in one inch
    var P = function(inches) { return inches * inch; };
    var op = new RAddObjectsOperation();
    op.setText(qsTr("Generate sheet"));
    var drew = [];
    var ex = isNull(extra) ? {} : extra;

    var layerIds = {};
    var ensure = function(name) {
        CsLayers.ensure(doc, di, name);
        if (isNull(layerIds[name])) {
            layerIds[name] = doc.getLayerId(name);
        }
        return layerIds[name];
    };

    var add = function(entity, layer, kind) {
        entity.setBlockId(blockId);
        entity.setLayerId(ensure(layer));
        CsTags.set(entity, CsLayoutGen.TAG, kind);
        op.addObject(entity, false);
        return entity;
    };
    var text = function(xIn, yIn, heightIn, label, layer, kind, keepCase, angle, halign) {
        var e = new RTextEntity(doc, new RTextData(
            new RVector(P(xIn), P(yIn)), new RVector(P(xIn), P(yIn)), P(heightIn),
            P(CsSheetSetup.TITLE_INCHES * 4),
            RS.VAlignMiddle, isNull(halign) ? RS.HAlignLeft : halign, RS.LeftToRight, RS.Exact,
            1.0, keepCase === true ? String(label) : CsDraw.caps(label),
            "standard", false, false, isNull(angle) ? 0.0 : angle, false));
        return add(e, layer, isNull(kind) ? layer : kind);
    };
    var line = function(x1, y1, x2, y2, layer, kind) {
        var e = new RLineEntity(doc, new RLineData(new RVector(P(x1), P(y1)), new RVector(P(x2), P(y2))));
        return add(e, layer, isNull(kind) ? layer : kind);
    };
    var greyed = function(entity) {
        try {
            entity.setColor(new RColor(CsSheetSetup.MAGNETIC_GREY[0],
                CsSheetSetup.MAGNETIC_GREY[1], CsSheetSetup.MAGNETIC_GREY[2]));
        } catch (eColor) {
        }
        return entity;
    };

    var W = job.paperInches.w, H = job.paperInches.h, m = job.marginInches;
    var fur = job.fur;
    var wants = job.wants;
    var offs = isNull(ex.offsets) ? {} : ex.offsets;
    var off = function(kind) { return CsSheetSetup.offsetOf(offs, kind); };

    // ---- THE VIEWPORT -------------------------------------------------
    var vp = CsLayoutGen.viewportOf(job);
    var viewport = new RViewportEntity(doc, new RViewportData());
    viewport.setCenter(new RVector(P(vp.x + vp.w / 2), P(vp.y + vp.h / 2)));
    viewport.setWidth(P(vp.w));
    viewport.setHeight(P(vp.h));
    // paper units per model unit: one inch of paper per (scale * perFoot) drawing units
    viewport.setScale(P(1) / (job.scale * job.perFoot));
    viewport.setViewCenter(new RVector(vp.viewCenter.x, vp.viewCenter.y));
    viewport.setViewTarget(new RVector(0, 0));
    viewport.setFrozenLayerIds(CsLayoutGen.layersOfFrames(doc, CsLayoutGen.OTHER_FRAMES[job.kind]));
    // A PLOTTED MAP CARRIES NO RASTER: scans are tracing references and an
    // aerial photograph is the cave's location baked into a picture, on a
    // file made to be handed to people. The engine's viewport honours this
    // property by not drawing images, whatever layer they sit on.
    viewport.setCustomProperty("CaveCAD", "NoRaster", "1");
    add(viewport, CsLayers.BORDER, "viewport");
    drew.push("a viewport at 1\" = " + job.scale + " ft");

    // ---- BORDER -------------------------------------------------------
    // The viewport's own frame IS the border when there is no footer band
    // (every tile); a sheet with a band gets the margin box besides.
    if (wants.border === true && job.box.footer > 0) {
        line(m, m, W - m, m, CsLayers.BORDER);
        line(W - m, m, W - m, H - m, CsLayers.BORDER);
        line(W - m, H - m, m, H - m, CsLayers.BORDER);
        line(m, H - m, m, m, CsLayers.BORDER);
        drew.push("a border");
    }

    // ---- TILED: match lines and the sheet's name ----------------------
    if (!isNull(job.tile)) {
        var tile = job.tile;
        for (var mi = 0; mi < tile.matches.length; mi++) {
            var ml = tile.matches[mi];
            var a = CsLayoutGen.inchesOf(job, ml.x1, ml.y1), b = CsLayoutGen.inchesOf(job, ml.x2, ml.y2);
            var mline = line(a.x, a.y, b.x, b.y, CsLayers.BORDER, "matchline");
            try {
                mline.setLinetypeId(doc.getLinetypeId("DASHED"));
            } catch (eDash) {
            }
            var gap = CsSheetSetup.TEXT.body * 1.2;
            var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            var tx = mx, ty = my, angle = 0;
            if (ml.edge === "E") { tx = a.x - gap; angle = Math.PI / 2; }
            else if (ml.edge === "W") { tx = a.x + gap; angle = Math.PI / 2; }
            else if (ml.edge === "S") { ty = a.y + gap; }
            else { ty = a.y - gap; }
            text(tx, ty, CsSheetSetup.TEXT.body, CsSheetTile.matchText(ml.to),
                CsLayers.BORDER, "matchline", false, angle, RS.HAlignCenter);
        }
        text(m * 1.2, H - m * 1.5, CsSheetSetup.TEXT.caveName * 0.8, "SHEET " + tile.id,
            CsLayers.BORDER, "sheetid");
        drew.push("sheet " + tile.id + (tile.matches.length > 0 ? " with " + tile.matches.length +
            " match line" + (tile.matches.length === 1 ? "" : "s") : ""));
    }

    // ---- FURNITURE ----------------------------------------------------
    var footY = m, leftX = m;

    // WHITE BACKING, where the furniture sits over the map (every tile: no
    // band is kept clear -- Nathan, 2026-10-05, overlap is fine). A WIPEOUT,
    // not a white fill: the engine paints a wipeout in the paper's colour and
    // exempts it from the colour mapping that turns a white entity BLACK on
    // a plot (the trap that sank the old white mask). Drawn after the
    // viewport and before the furniture, so it covers the map and nothing else.
    if (job.box.footer <= 0) {
        var pad = 0.08;
        for (var pk in fur.pieces) {
            if (!fur.pieces.hasOwnProperty(pk)) { continue; }
            var pc = fur.pieces[pk];
            var po = off(pk);
            var x0 = leftX + pc.x + po.x - pad, y0 = footY + pc.y + po.y - pad;
            var x1 = leftX + pc.x + po.x + pc.w + pad, y1 = footY + pc.y + po.y + pc.h + pad;
            var poly = new RPolyline();
            poly.appendVertex(new RVector(P(x0), P(y0)));
            poly.appendVertex(new RVector(P(x1), P(y0)));
            poly.appendVertex(new RVector(P(x1), P(y1)));
            poly.appendVertex(new RVector(P(x0), P(y1)));
            poly.setClosed(true);
            add(new RWipeoutEntity(doc, new RWipeoutData(poly)), CsLayers.BORDER, "backing");
        }
    }

    if (wants.title === true) {
        var lines = job.titleLines;
        var tOff = off("title");
        var titleX = leftX + fur.pieces.title.x + tOff.x;
        var y = footY + fur.pieces.title.y + CsSheetSetup.linesHeight(lines) + tOff.y;
        var values = isNull(ex.titleValues) ? {} : ex.titleValues;
        for (var n = 0; n < lines.length; n++) {
            var t = text(titleX, y, lines[n].inches, lines[n].text, CsLayers.TITLE_BLOCK);
            if (lines[n].fieldId !== "") {
                CsTags.set(t, CsSheet.TAG, lines[n].fieldId);
                CsTags.set(t, CsSheetSetup.TAG_FULL,
                    isNull(values[lines[n].fieldId]) ? "" : String(values[lines[n].fieldId]));
            }
            y -= lines[n].inches * CsSheetSetup.LINE_SPACING;
        }
        text(titleX, y, CsSheetSetup.TEXT.heading,
            job.kind === "elevation" ? "EXTENDED ELEVATION" : "PLAN", CsLayers.TITLE_BLOCK);
        drew.push("a title block");
    }

    if (wants.bar === true) {
        var bar = CsSheetSetup.barFor(job.scale);
        var bOff = off("bar");
        var barX = leftX + fur.pieces.bar.x + bOff.x;
        var barY = footY + fur.pieces.bar.y + CsSheetSetup.BAR_LIFT + bOff.y;
        // one block is perBlockFeet of cave = perBlockFeet / scale inches of paper
        var blockW = bar.perBlockFeet / job.scale;
        var barH = CsSheetSetup.BAR.height;
        for (var bk = 0; bk <= bar.blocks; bk++) {
            var bx = barX + blockW * bk;
            line(bx, barY, bx, barY + barH, CsLayers.SCALE_BAR);
            text(bx, barY - CsSheetSetup.BAR.tick * 2, CsSheetSetup.TEXT.small,
                String(bar.perBlock * bk), CsLayers.SCALE_BAR);
        }
        line(barX, barY, barX + blockW * bar.blocks, barY, CsLayers.SCALE_BAR);
        line(barX, barY + barH, barX + blockW * bar.blocks, barY + barH, CsLayers.SCALE_BAR);
        text(barX, barY + barH + CsSheetSetup.TEXT.body, CsSheetSetup.TEXT.body,
            CsSheetSetup.scaleText(job.scale), CsLayers.SCALE_BAR);
        text(barX + blockW * bar.blocks + 0.1, barY - CsSheetSetup.BAR.tick * 2,
            CsSheetSetup.TEXT.small, bar.unit, CsLayers.SCALE_BAR);
        drew.push("a scale bar in " + bar.perBlock + " " + bar.unit.toLowerCase() + " steps");
    }

    if (wants.north === true) {
        var arrow = CsSheetSetup.NORTH;
        var np = fur.pieces.north;
        var nOff = off("north");
        var nx = leftX + np.x + np.pinX + nOff.x;
        var ny = footY + np.y + np.pinY + nOff.y;
        var nh = arrow.height;
        line(nx, ny, nx, ny + nh, CsLayers.NORTH_ARROW);
        line(nx, ny + nh, nx - arrow.headHalf, ny + nh - arrow.headLength, CsLayers.NORTH_ARROW);
        line(nx, ny + nh, nx + arrow.headHalf, ny + nh - arrow.headLength, CsLayers.NORTH_ARROW);
        text(nx - 0.09, ny + nh + 0.28, CsSheetSetup.TEXT.heading, "N", CsLayers.NORTH_ARROW);
        var reading = job.reading;
        var decl = "";
        if (!isNull(reading) && reading.declination !== 0) {
            decl = "  (DECLINATION " + Number(reading.declination).toFixed(1) + "° APPLIED)";
        }
        text(nx - 0.9, ny - 0.2, CsSheetSetup.TEXT.small, "TRUE NORTH" + decl, CsLayers.NORTH_ARROW);
        if (!isNull(reading)) {
            greyed(text(nx - 0.9, ny - (0.2 + CsSheetSetup.TEXT.small * 2), CsSheetSetup.TEXT.small,
                CsSheetSetup.magneticText(reading), CsLayers.NORTH_ARROW));
            var mag = CsSheetSetup.magneticUnit(reading.declination);
            var mh = arrow.magneticHeight;
            var tipX = nx + mag.x * mh, tipY = ny + mag.y * mh;
            greyed(line(nx, ny, tipX, tipY, CsLayers.NORTH_ARROW));
            var back = arrow.magneticHeadLength, half = arrow.magneticHeadHalf;
            var bx2 = tipX - mag.x * back, by2 = tipY - mag.y * back;
            greyed(line(tipX, tipY, bx2 - mag.y * half, by2 + mag.x * half, CsLayers.NORTH_ARROW));
            greyed(line(tipX, tipY, bx2 + mag.y * half, by2 - mag.x * half, CsLayers.NORTH_ARROW));
            greyed(text(tipX + mag.x * 0.12 - 0.06, tipY + 0.18, CsSheetSetup.TEXT.small, "mN",
                CsLayers.NORTH_ARROW, null, true));
            drew.push("a north arrow with magnetic north at " + Number(reading.declination).toFixed(1) + "°");
        }
        else {
            drew.push("a north arrow");
        }
    }

    di.applyOperation(op);
    return drew;
};

/** Every entity in a layout's block that the generator drew. */
CsLayoutGen.derived = function(doc, blockId) {
    var out = [];
    var ids = doc.queryBlockEntities(blockId);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (!isNull(e) && !e.isUndone() && CsTags.get(e, CsLayoutGen.TAG) !== "") {
            out.push(e);
        }
    }
    return out;
};

/**
 * Generates the sheets of a plan into the drawing's layouts.
 *
 * AUTO layouts of the same name are rewritten; MANUAL ones are left alone
 * and named in the result; layouts that do not exist yet are created.
 *
 * \return { made: [names], rewritten: [names], skipped: [names], said }
 */
CsLayoutGen.generate = function(doc, di, o) {
    var jobs = CsLayoutGen.plan(o);
    var res = { made: [], rewritten: [], skipped: [], jobs: jobs, said: "" };
    var savedBlock = doc.getCurrentBlockId();
    for (var j = 0; j < jobs.length; j++) {
        var job = jobs[j];
        var info = Layouts.get(doc, job.name);
        if (!isNull(info) && info.mode !== "auto") {
            res.skipped.push(job.name);
            continue;
        }
        if (isNull(info)) {
            info = Layouts.create(di, {
                name: job.name,
                paper: { w: job.paperInches.w * 25.4, h: job.paperInches.h * 25.4 },
                landscape: job.paperInches.w >= job.paperInches.h,
                units: Layouts.INCHES, margins: job.marginInches * 25.4, mode: "auto" });
            res.made.push(job.name);
        }
        else {
            // paper may have changed
            info = Layouts.setPaper(di, job.name, {
                paper: { w: job.paperInches.w * 25.4, h: job.paperInches.h * 25.4 },
                landscape: job.paperInches.w >= job.paperInches.h,
                margins: job.marginInches * 25.4 });
            var old = CsLayoutGen.derived(doc, info.blockId);
            if (old.length > 0) {
                var del = new RDeleteObjectsOperation();
                del.setText(qsTr("Generate sheet"));
                for (var d = 0; d < old.length; d++) {
                    del.deleteObject(old[d]);
                }
                di.applyOperation(del);
            }
            res.rewritten.push(job.name);
        }
        CsLayoutGen.draw(doc, di, job, info, o.extra);
    }
    doc.setCurrentBlock(savedBlock);
    return res;
};
