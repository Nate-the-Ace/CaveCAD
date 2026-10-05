// SheetSetup.js
//
// QCAD add-on tool: turn a drawn cave into a finished SHEET -- border,
// scale bar, north arrow, and a title block filled in from what the
// drawing already knows.
//
//   Cave Survey > Sheet Setup   (or type "sheet")
//
// WHY IT EXISTS. The NSS template ships the sheet furniture as
// reference pieces -- a scale bar, a north arrow, modular title block
// lines -- parked below the sheet for a cartographer to copy and scale
// by hand. They are measured in INCHES of paper and the cave is drawn
// in FEET, and the number that reconciles the two is the plot scale.
// A beginner does not know that, so the pieces stay in the corner of
// the template and the map goes out with no scale bar at all. Check Map
// finds exactly that on real drawings: no scale bar, no north arrow, a
// title block that never says who surveyed the cave.
//
// So this asks two questions a cartographer can answer -- what paper,
// what scale -- and does the arithmetic. Every measurement it draws is
// an inch of paper multiplied by the scale, which is why a 0.14 inch
// title block line comes out 7 feet tall at 1" = 50 ft and prints at
// 0.14 inch. See Core/CsSheetSetup.js.
//
// WHAT IT WILL NOT DO. It never writes the LOCATION field, though the
// drawing usually knows exactly where the cave is. See
// CsSheetSetup.locationFor: filling that automatically would put an
// entrance's coordinates on every sheet anybody plotted, without one
// decision being made by a person.
//
// It also never overwrites a field a human has already typed. Re-run it
// after another trip and the length, depth and grade are refreshed; the
// cave's name, as you worded it, stays as you worded it.

include("scripts/EAction.js");
include("scripts/simple.js");
include("scripts/File/Print/Print.js");
include(includeBasePath + "/../Core/CsAll.js");

/** The tag every generated sheet entity carries, so a re-run replaces
 *  what the last one drew instead of stacking a second sheet on it.
 *  Lives in Core because CsProfileDraw reads it too -- it asks where
 *  the elevation sheet is by finding that sheet's border. */
var SS_TAG = CsSheetSetup.TAG;

function SheetSetup(guiAction) {
    EAction.call(this, guiAction);
}

SheetSetup.prototype = new EAction();

/**
 * The PLAN's own extents.
 *
 * THE PLAN ONLY (Nathan, 2026-09-10). The extended elevation is drawn
 * BELOW the plan in the same drawing and a section bay is parked clear
 * of both, so measuring "everything in the document" measured a column
 * of three views and sized the sheet for it -- which is why Truitt Cave
 * wanted 1" = 80 ft for a plan that fits comfortably at 40. A sheet is
 * laid out around the MAP, and the other views are placed onto it
 * afterwards as elements, the way a legend or a cross section is.
 *
 * Ignores anything this tool drew and anything on a sheet layer too:
 * otherwise the second run measures the first run's border and the
 * sheet grows every time it is run.
 */
/**
 * The entities of the cave itself: MODEL SPACE, whichever sheet or view
 * happens to be showing. (queryAllEntities(.., false) answers for the
 * CURRENT block, which is a layout when the panel is opened from one.)
 */
SheetSetup.modelIds = function(doc) {
    return doc.queryBlockEntities(doc.getModelSpaceBlockId());
};

SheetSetup.caveBox = function(doc) {
    var box = null;
    var ids = SheetSetup.modelIds(doc);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || CsTags.get(e, SS_TAG) !== "") {
            continue;
        }
        var layer = CsBind.layerNameOf(doc, e);
        var frame = CsLayers.frameOf(layer);
        if (frame !== "plan") {
            continue;   // sheet furniture, the elevation, a section bay
        }
        var b = null;
        try {
            b = e.getBoundingBox();
        } catch (eBox) {
            b = null;
        }
        if (isNull(b)) {
            continue;
        }
        var min = b.getMinimum(), max = b.getMaximum();
        if (!isFinite(min.x) || !isFinite(max.x)) {
            continue;
        }
        if (box === null) {
            box = { minX: min.x, minY: min.y, maxX: max.x, maxY: max.y };
        } else {
            box.minX = Math.min(box.minX, min.x);
            box.minY = Math.min(box.minY, min.y);
            box.maxX = Math.max(box.maxX, max.x);
            box.maxY = Math.max(box.maxY, max.y);
        }
    }
    return box;
};

/**
 * What the cave is MADE OF, as a list of boxes: one per plan entity,
 * for a tiled plan to decide which sheets have anything on them. Scans
 * and the aerial photograph are left out (a sheet carries no raster, so
 * a photograph under the whole cave must not make every tile "occupied"),
 * and so is anything this tool drew. Capped, because a box per entity of
 * a big drawing is thousands.
 */
SheetSetup.occupancy = function(doc) {
    var out = [];
    var ids = SheetSetup.modelIds(doc);
    var stride = Math.max(1, Math.ceil(ids.length / 8000));
    for (var i = 0; i < ids.length; i += stride) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || CsTags.get(e, SS_TAG) !== "" ||
                e instanceof RImageEntity) {
            continue;
        }
        if (CsLayers.frameOf(CsBind.layerNameOf(doc, e)) !== "plan") {
            continue;
        }
        try {
            var b = e.getBoundingBox();
            var mn = b.getMinimum(), mx = b.getMaximum();
            if (isFinite(mn.x) && isFinite(mx.x)) {
                out.push({ minX: mn.x, minY: mn.y, maxX: mx.x, maxY: mx.y });
            }
        } catch (eBox) {
        }
    }
    return out;
};

/**
 * The band under the map, as a function of the paper's orientation, for
 * the choices on the panel (which pieces are ticked): the furniture packs
 * into more rows on a narrower sheet, so the answer depends on which way
 * up the paper is.
 */
SheetSetup.footerFn = function(state, sheet, wants) {
    var picked = isNull(wants) ? { title: true, bar: true, north: true } :
        wants;
    var reading = isNull(state.declination) ? null :
        { declination: state.declination,
            date: isNull(state.declinationDate) ? "" : state.declinationDate };
    return function(turned) {
        return CsSheetSetup.footerFor({ sheet: sheet, turned: turned,
            wants: picked, titleHeight: state.titleHeight,
            reading: reading });
    };
};

/**
 * The tile layout for the choices on the panel, or null when the cave
 * fits ONE sheet at this scale (so everything below stays exactly as it
 * always was for the ordinary case).
 *
 * The cave dragged by hand slides the PAPER under it the other way,
 * the same rule borderBox follows -- which is the layout's shiftInches.
 */
SheetSetup.tileLayoutFor = function(state, sheet, scale, offsets, wants,
        turned) {
    if (isNull(state) || isNull(state.caveBox) || isNull(sheet)) {
        return null;
    }
    var drag = CsSheetSetup.offsetOf(offsets, "cave");
    var layout = CsSheetTile.layout({ caveBox: state.caveBox,
        sheet: sheet,
        // drawing units per inch of paper: feet per inch times units per foot
        scale: scale * (isNull(state.perFoot) ? 1 : state.perFoot),
        // NO BAND IS RESERVED on a tiled plan: every sheet is map right
        // out to the page margin, and the title block, bar and arrow sit
        // over it on a white backing (see clipToMap).
        footerInches: 0,
        // the paper's way up is the caver's, never worked out for them
        turned: turned === true,
        occupied: state.occupied,
        shiftInches: { x: -drag.x, y: -drag.y } });
    return layout.tiled === true ? layout : null;
};

/** True when this drawing has an extended elevation to place. */
SheetSetup.hasElevation = function(doc) {
    try {
        return CsProfileBox.boxes(doc).length > 0;
    } catch (e) {
        return false;
    }
};

/** Every title block field's value: what the drawing already says,
 *  falling back to what the survey can tell us. Computed once, because
 *  the sheet has to be SIZED from these before it can be drawn. */
SheetSetup.titleValues = function(doc, filled) {
    var values = {};
    for (var f = 0; f < CsSheet.FIELDS.length; f++) {
        var field = CsSheet.FIELDS[f];
        var existing = SheetSetup.readWhole(doc, field);
        if (String(existing).replace(/\s/g, "") !== "") {
            values[field.id] = existing;
        } else if (!isNull(filled) && filled.hasOwnProperty(field.id)) {
            values[field.id] = filled[field.id];
        }
    }
    return values;
};

/**
 * What one title block field currently says, in full.
 *
 * Prefers the whole value stashed by a previous run over what is
 * VISIBLE on the sheet: a field wrapped across four lines has only its
 * first line under CsSheet's own tag, and reading that back would let
 * every re-run trim the credit list a little further.
 */
SheetSetup.readWhole = function(doc, field) {
    // The title block lives on a layout now. Whatever a sheet says -- the
    // generator's words or a person's edit of them -- is read back from the
    // sheet, so a regenerated tile never overwrites what was typed.
    try {
        var sheets = Layouts.list(doc);
        for (var l = 0; l < sheets.length; l++) {
            var ids = doc.queryBlockEntities(sheets[l].blockId);
            for (var i = 0; i < ids.length; i++) {
                var e = doc.queryEntity(ids[i]);
                if (isNull(e) || e.isUndone() || CsTags.get(e, CsSheet.TAG) !== field.id) {
                    continue;
                }
                var whole = CsTags.get(e, CsSheetSetup.TAG_FULL);
                if (whole !== "") {
                    return whole;
                }
                // what the sheet SHOWS, without the field's caption ("LOCATION: "):
                // reading the caption back as part of the value is how it got
                // printed twice on the next build
                var shown = String(e.getPlainText());
                // the caption is compared WITHOUT its trailing blanks: an empty field is
                // drawn as the bare caption ("CARTOGRAPHY BY:"), and the caption itself is
                // "Cartography by:  " -- an exact-prefix test read the bare caption back as
                // the VALUE and printed it twice on the next build
                var prefix = isNull(field.prefix) ? "" : String(field.prefix).replace(/\s+$/, "");
                if (prefix !== "" && shown.toUpperCase().indexOf(prefix.toUpperCase()) === 0) {
                    shown = shown.substring(prefix.length);
                }
                shown = shown.replace(/^\s+|\s+$/g, "");
                if (shown !== "") {
                    return shown;
                }
            }
        }
    } catch (eWhole) {
        // fall through to nothing
    }
    return "";
};

/** The survey, its stats and its grade -- or nulls, for a drawing with
 *  no survey in it yet. A sheet is still worth building on a drawing
 *  that has only tracing on it; it just cannot fill in the numbers. */
SheetSetup.readSurvey = function(doc) {
    var out = { survey: null, resolved: null, stats: null, grade: null };
    try {
        var asDrawn = CsRevise.resolveAsDrawn(doc);
        if (isNull(asDrawn)) {
            return out;
        }
        out.survey = asDrawn.survey;
        out.resolved = asDrawn.resolved;
        out.survey.distanceUnit = CsUnits.fromDrawingUnit(doc.getUnit(), RS);
        out.stats = CsStats.compute(out.survey, asDrawn.resolved,
            CsTraverse.SLOPE);
        out.grade = CsGrade.compute(out.survey, asDrawn.resolved, out.stats);
    } catch (e) {
        // a drawing whose survey will not resolve still gets its sheet
    }
    return out;
};

// ---------------------------------------------------------------------
// THE PALETTE.
//
// A dock, not a dialog (Nathan, 2026-09-10). Choosing paper and scale
// is not one question answered once: it is a handful of choices that
// argue with each other -- bigger paper buys detail, a title block with
// twenty-one surveyors on it takes a scale step, the elevation only
// fits at all because it has its own sheet. A modal dialog makes each
// of those a guess followed by a build followed by a look.
//
// So the panel shows the layout as it will be, roughly, and rebuilds
// the picture as the choices change. Building the file is then the LAST
// thing rather than the way to find out.
// ---------------------------------------------------------------------

var csSheetSetupDock;

/** What the panel says under the preview when nothing is being
 *  dragged. Held here so the drag readout can put it back. */
// SHORT ON PURPOSE. A wrapped QLabel under a stretching view is given
// the height its sizeHint asked for BEFORE the wrap, so a three-line
// sentence here is drawn clipped -- measured live, 2026-09-14, with the
// first line cut in half. The rest of the explanation is the
// handbook's job.
/**
 * How SheetSetup.tell says each kind of thing (Nathan, 2026-09-27: "the
 * red text made me think something bad happened"). Green is done;
 * yellow is nothing broke but you have to act first; red is something
 * failed. Plain status -- the fit, the spill-free page -- stays in the
 * label's own colour. Mid-tones, so each reads on light and dark.
 */
SheetSetup.DONE = "done";
SheetSetup.WARNING = "warning";
SheetSetup.ERROR = "error";
SheetSetup.LEVELS = {
    done:    { colour: "#2e9e4f", box: false },
    warning: { colour: "#c99a06", box: true },
    error:   { colour: "#d9463b", box: true }
};

/** Text made safe to sit inside the command line's rich text. */
SheetSetup.escapeHtml = function(text) {
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
};

/** The files the last Build Sheet wrote; empty when it wrote none. */
SheetSetup.lastWritten = [];

SheetSetup.HINT = qsTr("Drag a piece to arrange the page. Edges and " +
    "middles snap.");

/** How the preview paints each kind of box. */
SheetSetup.PREVIEW_STYLE = {
    "sheet": { line: [70, 70, 70], fill: [255, 255, 255], width: 2 },
    "elevation-sheet": { line: [70, 70, 70], fill: [255, 255, 255],
        width: 2 },
    "tile": { line: [90, 90, 90], fill: [255, 255, 255], width: 1 },
    "tile-margin": { line: [170, 170, 170], fill: null, width: 1,
        dashed: true },
    "matchline": { line: [200, 40, 160], fill: [200, 40, 160, 120],
        width: 1 },
    "margin": { line: [150, 150, 150], fill: null, width: 1,
        dashed: true },
    "cave": { line: [40, 90, 190], fill: [40, 90, 190, 40], width: 1 },
    "band": { line: [40, 90, 190], fill: [40, 90, 190, 40], width: 1 },
    "title": { line: [150, 100, 30], fill: [220, 170, 70, 90], width: 1 },
    "bar": { line: [60, 130, 60], fill: [90, 180, 90, 110], width: 1 },
    "north": { line: [60, 130, 60], fill: [90, 180, 90, 110], width: 1 }
};

/** The style for any item kind, including a per-chunk "band:<key>"
 *  kind -- one box per chunk, sharing plain "band"'s look. See
 *  CsSheetSetup.preview and CsSheetSetup.isMovable. */
SheetSetup.previewStyleFor = function(kind) {
    if (!isNull(SheetSetup.PREVIEW_STYLE[kind])) {
        return SheetSetup.PREVIEW_STYLE[kind];
    }
    if (typeof kind === "string" && kind.indexOf("band:") === 0) {
        return SheetSetup.PREVIEW_STYLE.band;
    }
    return null;
};

/** Paints one preview into a pixmap. Rough by design -- see
 *  CsSheetSetup.preview. */
SheetSetup.paintPreview = function(preview, width, height) {
    try {
        var pixmap = new QPixmap(width, height);
        pixmap.fill(new QColor(245, 245, 245));
        if (isNull(preview) || preview.bounds === null) {
            return pixmap;
        }
        var painter = new QPainter();
        painter.begin(pixmap);
        try {
            painter.setRenderHint(QPainter.Antialiasing, true);
        } catch (eHint) {
        }
        var pad = 6;
        var bw = preview.bounds.maxX - preview.bounds.minX;
        var bh = preview.bounds.maxY - preview.bounds.minY;
        var factor = Math.min((width - pad * 2) / (bw > 0 ? bw : 1),
            (height - pad * 2) / (bh > 0 ? bh : 1));
        var offX = pad + ((width - pad * 2) - bw * factor) / 2;
        var offY = pad + ((height - pad * 2) - bh * factor) / 2;

        for (var i = 0; i < preview.items.length; i++) {
            var item = preview.items[i];
            var style = SheetSetup.previewStyleFor(item.kind);
            if (isNull(style)) {
                continue;
            }
            var x = offX + (item.box.minX - preview.bounds.minX) * factor;
            // Y IS FLIPPED: a drawing counts up, a pixmap counts down.
            var y = offY + (preview.bounds.maxY - item.box.maxY) * factor;
            var w = (item.box.maxX - item.box.minX) * factor;
            var h = (item.box.maxY - item.box.minY) * factor;
            var pen = new QPen(new QColor(style.line[0], style.line[1],
                style.line[2]));
            pen.setWidth(style.width);
            if (style.dashed === true) {
                try {
                    pen.setStyle(Qt.DashLine);
                } catch (eDash) {
                }
            }
            painter.setPen(pen);
            if (isNull(style.fill)) {
                painter.setBrush(new QBrush());
            } else {
                painter.setBrush(new QBrush(new QColor(style.fill[0],
                    style.fill[1], style.fill[2],
                    style.fill.length > 3 ? style.fill[3] : 255)));
            }
            painter.drawRect(x, y, Math.max(w, 1), Math.max(h, 1));
            // A CHUNK BOX NEEDS ITS OWN LABEL. Furniture is told apart
            // by colour alone, which works for four fixed pieces of
            // four different colours -- it does not work for however
            // many chunks a cave has, all the same colour. See
            // CsSheetSetup.preview, which is the only place item.label
            // is ever set.
            if (!isNull(item.label) && item.label !== "") {
                painter.setPen(new QPen(new QColor(style.line[0],
                    style.line[1], style.line[2])));
                painter.drawText(x + 2, y + 12, String(item.label));
            }
        }
        painter.end();
        return pixmap;
    } catch (ePaint) {
        return null;
    }
};

/** Everything the panel needs to know about the open drawing, read
 *  once per refresh. */
SheetSetup.readState = function(doc) {
    var state = { ok: false, why: "", caveBox: null, caveW: 0, caveH: 0,
        recordPath: "", hasElevation: false, bands: [], filled: {},
        titleLines: [], footerInches: 0, declination: null,
        declinationDate: "" };
    if (isNull(doc)) {
        state.why = "No drawing open.";
        return state;
    }
    try {
        state.recordPath = String(doc.getFileName());
    } catch (ePath) {
        state.recordPath = "";
    }
    state.caveBox = SheetSetup.caveBox(doc);
    if (state.caveBox === null) {
        state.why = "This drawing has nothing on it yet. Draw the cave " +
            "first -- a sheet with nothing in it has no scale to be at.";
        return state;
    }
    state.occupied = SheetSetup.occupancy(doc);
    var perFoot = CsShapeLine.perFoot(doc);
    state.perFoot = perFoot;
    state.caveW = (state.caveBox.maxX - state.caveBox.minX) / perFoot;
    state.caveH = (state.caveBox.maxY - state.caveBox.minY) / perFoot;

    var read = SheetSetup.readSurvey(doc);
    state.survey = read.survey;
    state.resolved = read.resolved;
    // The magnetic arm the north arrow will carry, so the preview's
    // north box is the whole piece rather than the true arrow alone.
    var reading = CsSheetSetup.latestDeclination(read.survey);
    state.declination = isNull(reading) ? null : reading.declination;
    state.declinationDate = isNull(reading) ? "" : reading.date;
    state.filled = CsSheetSetup.autoFill(read.survey, read.stats,
        read.grade);
    state.titleLines = CsSheetSetup.titleLines(
        SheetSetup.titleValues(doc, state.filled));
    state.footerInches = Math.max(
        CsSheetSetup.linesHeight(state.titleLines) + 0.4,
        CsSheetSetup.BAR.height + CsSheetSetup.TEXT.body * 4);
    // The title block's own height: what the furniture layout packs.
    state.titleHeight = CsSheetSetup.linesHeight(state.titleLines) + 0.2;
    state.hasElevation = SheetSetup.hasElevation(doc);
    state.chunked = false;
    if (state.hasElevation) {
        var mode = "extended";
        try {
            mode = RSettings.getStringValue("CaveSurvey/ProfileMode",
                "extended");
        } catch (eMode) {
        }
        state.chunked = (mode === "chunked");
        // A CHUNKED SHEET NEEDS EACH CHUNK'S OWN BOX AND CAPTION, which
        // the live drawing's box layer does not carry (CsProfileBox
        // reads back a bare key, not the caver-facing pitch-depth
        // text) -- so this is computed fresh from CsProfile.build
        // rather than read off the drawing, same auto-layout preset
        // Generate Profile itself would land on. A caver's in-progress
        // drag lives only in w.offsets and is applied later, purely in
        // CsSheetSetup.preview -- see CsSheetSetup.js:1049.
        if (state.chunked && !isNull(state.resolved)) {
            try {
                var chunkSettings = CsProfile.settings();
                var builtChunks = CsProfile.build(state.survey,
                    state.resolved,
                    { flatSplayDeg: chunkSettings.flatSplayDeg,
                      offsets: {} });
                var boxMargin;
                try {
                    var boxUnit = CsUnits.fromDrawingUnit(doc.getUnit(), RS);
                    boxMargin = CsUnits.convert(
                        CsProfileDraw.BOX_MARGIN_FEET, CsUnits.FEET,
                        boxUnit);
                } catch (eMargin) {
                    boxMargin = CsProfileDraw.BOX_MARGIN_FEET;
                }
                var chunkBoxes = CsProfileDraw.boxesFor(builtChunks,
                    boxMargin);
                state.bands = [];
                for (var bi = 0; bi < builtChunks.bands.length; bi++) {
                    var bnd = builtChunks.bands[bi];
                    var bx = null;
                    for (var boxi = 0; boxi < chunkBoxes.length; boxi++) {
                        if (chunkBoxes[boxi].key === bnd.key) {
                            bx = chunkBoxes[boxi];
                            break;
                        }
                    }
                    if (bx === null) {
                        continue;
                    }
                    state.bands.push({ key: bnd.key, minX: bx.minX,
                        minY: bx.minY, maxX: bx.maxX, maxY: bx.maxY,
                        label: CsChunk.caption(bnd) });
                }
            } catch (eChunked) {
                state.bands = [];
            }
        } else {
            try {
                state.bands = CsProfileBox.boxes(doc);
            } catch (eBands) {
                state.bands = [];
            }
        }
    }
    state.ok = true;
    if (state.borrowed === true) {
        // The record was opened only to be measured. Letting it go here
        // rather than holding it means the panel never has a second
        // document alive behind the caver's back.
        SheetSetup.release();
    }
    return state;
};

/** Opens a cave's record into a memory document, for measuring.
 *  Null when it will not read. */
SheetSetup.readRecord = function(path) {
    try {
        var di = new RDocumentInterface(
            new RDocument(new RMemoryStorage(), createSpatialIndex()));
        if (di.importFile(path, "", false) !==
                RDocumentInterface.IoErrorNoError) {
            return null;
        }
        SheetSetup.borrowedInterface = di;
        return di.getDocument();
    } catch (e) {
        return null;
    }
};

/** Lets a borrowed record go. */
SheetSetup.release = function() {
    try {
        if (!isNull(SheetSetup.borrowedInterface) &&
                typeof destr === "function") {
            destr(SheetSetup.borrowedInterface);
        }
    } catch (e) {
    }
    SheetSetup.borrowedInterface = null;
};

SheetSetup.buildDock = function(appWin) {
    var dock = new QDockWidget(qsTr("Sheet Setup"), appWin);
    dock.objectName = "CaveSurveySheetSetupDock";

    // WHAT HAS BEEN DRAGGED WHERE, in inches of paper, per piece.
    // Inches because the scale is one of the two things this panel
    // exists to change: a bar nudged two inches right stays two inches
    // right when the scale steps.
    var w = { state: null, quiet: false, offsets: {} };
    var body = new QWidget(dock);
    var layout = new QVBoxLayout();

    // A GRID, not a QFormLayout: this bridge generates QFormLayout
    // without addRow (probed live, 2026-09-10 -- the panel threw before
    // it had built a single control). CsPanel.formGrid is the suite's
    // own answer, already used by every other panel with fields on it.
    var form = CsPanel.formGrid(1);
    w.sheetCombo = new QComboBox();
    for (var s = 0; s < CsSheetSetup.SHEETS.length; s++) {
        w.sheetCombo.addItem(CsSheetSetup.SHEETS[s].name);
        if (CsSheetSetup.SHEETS[s].name === CsSheetSetup.DEFAULT_SHEET) {
            w.sheetCombo.currentIndex = s;
        }
    }
    w.scaleCombo = new QComboBox();
    for (var c = 0; c < CsSheetSetup.SCALE_ROWS.length; c++) {
        // The ROW's own label: an imperial scale says "1" = 50 ft" and
        // a metric one says "1:500", because that is how each is said.
        w.scaleCombo.addItem(CsSheetSetup.SCALE_ROWS[c].label);
    }

    // ONE ROW, SPLIT DOWN THE MIDDLE (Nathan, 2026-09-10). A docked
    // panel's scarce dimension is height -- the preview underneath is
    // the thing worth giving it to -- and two fields that each need a
    // label and a combo do not need two rows to say so.
    //
    // The two combo columns take equal stretch and the label columns
    // take none, so the split lands in the middle whatever the dock is
    // widened to.
    form.addWidget(new QLabel(qsTr("Paper:")), 0, 0);
    form.addWidget(w.sheetCombo, 0, 1);
    form.addWidget(new QLabel(qsTr("Scale:")), 0, 2);
    form.addWidget(w.scaleCombo, 0, 3);
    // WHICH WAY UP is part of choosing the paper, so it sits with the
    // paper and the scale: the sheet is landscape, as listed, unless
    // this is ticked.
    w.cbTurn = new QCheckBox(qsTr("Portrait"));
    w.cbTurn.toolTip = qsTr("The paper is used the way up you set it: " +
        "landscape, as the paper is listed, unless this is ticked.");
    form.addWidget(w.cbTurn, 0, 4);
    try {
        form.setColumnStretch(0, 0);
        form.setColumnStretch(1, 1);
        form.setColumnStretch(2, 0);
        form.setColumnStretch(3, 1);
        form.setColumnStretch(4, 0);
    } catch (eStretch) {
        // a bridge without the setter gets whatever the grid gives,
        // which is still one row
    }
    layout.addLayout(form, 0);

    w.fitLabel = new QLabel("");
    w.fitLabel.wordWrap = true;
    layout.addWidget(w.fitLabel, 0, 0);

    // THE PREVIEW IS A VIEW, NOT A PICTURE (Nathan, 2026-09-14). A
    // QPixmap in a QLabel could show the layout and nothing more: this
    // bridge gives a script no way to get a click coordinate out of a
    // label, so "put the scale bar over there" was a wish. An embedded
    // QCAD view over a scratch document takes drags, and
    // Core/CsSheetView.js holds the wiring.
    //
    // The label stays as the FALLBACK: a build that refuses the view
    // still gets the picture, which is what the panel had before.
    w.pane = CsSheetPreview.build(body);
    if (w.pane !== null) {
        try {
            w.pane.view.setMinimumHeight(150);
        } catch (eMin) {
        }
        layout.addWidget(w.pane.view, 1, 0);
        w.pane.view.onDrag = function(kind, snapped) {
            SheetSetup.dragTo(kind, snapped);
        };
        w.pane.view.onDragDone = function() {
            SheetSetup.dragDone();
        };
    } else {
        w.preview = new QLabel("");
        try {
            w.preview.setMinimumHeight(150);
            w.preview.alignment = Qt.AlignCenter;
        } catch (ePrev) {
        }
        layout.addWidget(w.preview, 1, 0);
    }

    w.hint = new QLabel(SheetSetup.HINT);
    w.hint.wordWrap = true;
    layout.addWidget(w.hint, 0, 0);

    w.cbBorder = new QCheckBox(qsTr("Border"));
    w.cbBar = new QCheckBox(qsTr("Scale bar"));
    w.cbNorth = new QCheckBox(qsTr("North arrow"));
    w.cbTitle = new QCheckBox(qsTr("Title block"));
    w.cbElevation = new QCheckBox(qsTr("Elevation on its own sheet"));
    w.cbBorder.checked = true;
    w.cbBar.checked = true;
    w.cbNorth.checked = true;
    w.cbTitle.checked = true;
    layout.addWidget(w.cbBorder, 0, 0);
    layout.addWidget(w.cbBar, 0, 0);
    layout.addWidget(w.cbNorth, 0, 0);
    layout.addWidget(w.cbTitle, 0, 0);
    layout.addWidget(w.cbElevation, 0, 0);

    w.note = new QLabel("");
    w.note.wordWrap = true;
    layout.addWidget(w.note, 0, 0);

    var row = new QHBoxLayout();
    w.buildButton = new QPushButton(qsTr("Build Sheet"));
    w.buildButton.toolTip = qsTr("Writes the sheet as its own file " +
        "beside the cave and opens it. Your drawing is not touched.");
    row.addWidget(w.buildButton, 1, 0);
    w.pdfButton = new QPushButton(qsTr("Export PDF"));
    w.pdfButton.toolTip = qsTr("Plots each sheet you just built to a " +
        "PDF beside its DXF, at the sheet's paper size and scale.");
    row.addWidget(w.pdfButton, 0, 0);
    w.refreshButton = new QPushButton(qsTr("Re-read Drawing"));
    w.refreshButton.toolTip = qsTr("Measure the cave again -- after " +
        "another trip, or after tracing more of it.");
    row.addWidget(w.refreshButton, 0, 0);
    w.resetButton = new QPushButton(qsTr("Reset Layout"));
    w.resetButton.toolTip = qsTr("Put every piece back where the " +
        "default layout puts it.");
    w.resetButton.enabled = false;
    row.addWidget(w.resetButton, 0, 0);
    layout.addLayout(row, 0);

    body.setLayout(layout);
    dock.setWidget(body);
    CsPanel.attachHelp(dock, "SheetSetup", qsTr("Sheet Setup"));
    SheetSetup.widgets = w;

    var changed = function() {
        if (w.quiet !== true) {
            SheetSetup.repaint();
        }
    };
    w.sheetCombo["currentIndexChanged(int)"].connect(function() {
        // The paper changed, so the scale that fits probably did too.
        SheetSetup.suggestScale();
        changed();
    });
    w.scaleCombo["currentIndexChanged(int)"].connect(changed);
    w.cbBorder.toggled.connect(changed);
    w.cbBar.toggled.connect(changed);
    w.cbNorth.toggled.connect(changed);
    w.cbTitle.toggled.connect(changed);
    w.cbElevation.toggled.connect(changed);
    w.cbTurn.toggled.connect(function() {
        // a different way up fits a different scale
        SheetSetup.suggestScale();
        changed();
    });
    w.buildButton.clicked.connect(function() { SheetSetup.build(); });
    w.pdfButton.clicked.connect(function() { SheetSetup.exportPdf(); });
    w.refreshButton.clicked.connect(function() { SheetSetup.refresh(); });
    w.resetButton.clicked.connect(function() { SheetSetup.resetLayout(); });

    return dock;
};

/** Which way up the paper is: the way the caver set it, never chosen
 *  for them. */
SheetSetup.turnedOf = function(w) {
    return w.cbTurn.checked === true;
};

/** Which furniture the panel has ticked, in the shape the layout reads. */
SheetSetup.wantsOf = function(w) {
    return { title: w.cbTitle.checked === true, bar: w.cbBar.checked === true,
        north: w.cbNorth.checked === true };
};

/** The paper's most detailed standard scale, chosen for the caver. */
SheetSetup.suggestScale = function() {
    var w = SheetSetup.widgets;
    if (isNull(w) || isNull(w.state) || w.state.ok !== true) {
        return;
    }
    var sheet = CsSheetSetup.sheetByName(String(w.sheetCombo.currentText));
    var fit = CsSheetSetup.fit(w.state.caveW, w.state.caveH, sheet,
        SheetSetup.footerFn(w.state, sheet, SheetSetup.wantsOf(w)),
        SheetSetup.turnedOf(w));
    var at = CsSheetSetup.SCALES.indexOf(fit.scale);
    var was = w.quiet;
    w.quiet = true;
    w.scaleCombo.currentIndex = at < 0 ? 0 : at;
    w.quiet = was;
};

/**
 * Fit the page into the pane once the layout has settled.
 *
 * WHY A TIMER. The panel draws its first page while the dock is still
 * being laid out: an autoZoom there fits to a size the view is about to
 * stop having, and the sheet ends up a postage stamp in the middle of
 * an empty pane (measured live, 2026-09-14). A zero-interval timer runs
 * after Qt has finished laying the dock out, which is the first moment
 * the view's real size exists.
 *
 * The timer is kept on SheetSetup rather than in a local: one held only
 * by a local goes out of scope before it fires. Only a plain JS call
 * lives in the closure -- a Qt wrapper held across that boundary is one
 * of this bridge's crash modes.
 */
SheetSetup.fitLater = function() {
    try {
        var timer = new QTimer();
        timer.singleShot = true;
        timer.timeout.connect(function() {
            SheetSetup.fitNow();
        });
        SheetSetup.fitTimer = timer;
        timer.start(0);
    } catch (e) {
        // no timer here: the view keeps whatever zoom autoZoom gave it
        SheetSetup.fitNow();
    }
};

/** Fit the page into the pane now. */
SheetSetup.fitNow = function() {
    var w = SheetSetup.widgets;
    if (isNull(w) || isNull(w.pane) || w.pane === undefined) {
        return;
    }
    try {
        CsSheetPreview.fit(w.pane);
        w.pane.view.fitPending = false;
    } catch (e) {
    }
};

/** Reads the drawing again and repaints. */
SheetSetup.refresh = function() {
    var w = SheetSetup.widgets;
    if (isNull(w)) {
        return;
    }
    var doc = null;
    try {
        doc = EAction.getDocument();
    } catch (eDoc) {
        doc = null;
    }
    w.state = SheetSetup.readState(doc);
    w.quiet = true;
    try {
        w.cbElevation.enabled = w.state.hasElevation === true;
        w.cbElevation.checked = w.state.hasElevation === true;
    } finally {
        w.quiet = false;
    }
    SheetSetup.suggestScale();
    SheetSetup.repaint();
    SheetSetup.fitLater();
};

/** Redraws the picture and the words under it. */
SheetSetup.repaint = function() {
    var w = SheetSetup.widgets;
    if (isNull(w) || isNull(w.state)) {
        return;
    }
    if (w.state.ok !== true) {
        w.fitLabel.text = w.state.why;
        w.note.setStyleSheet("");
        w.note.text = "";
        w.buildButton.enabled = false;
        return;
    }
    var sheet = CsSheetSetup.sheetByName(String(w.sheetCombo.currentText));
    var scale = CsSheetSetup.SCALES[w.scaleCombo.currentIndex];
    var picked = SheetSetup.wantsOf(w);
    var fit = CsSheetSetup.fit(w.state.caveW, w.state.caveH, sheet,
        SheetSetup.footerFn(w.state, sheet, picked), SheetSetup.turnedOf(w));

    // THE CAVE OVERFLOWS ONE SHEET at this scale: lay it over a grid.
    var tiles = SheetSetup.tileLayoutFor(w.state, sheet, scale, w.offsets,
        picked, SheetSetup.turnedOf(w));
    w.tiles = tiles;
    var preview = CsSheetSetup.preview({
        caveBox: w.state.caveBox, sheet: sheet, scale: scale,
        tileLayout: tiles,
        turned: fit.turned, footerInches: w.state.footerInches,
        titleHeight: w.state.titleHeight,
        declinationDate: w.state.declinationDate,
        wants: { border: w.cbBorder.checked, bar: w.cbBar.checked,
            north: w.cbNorth.checked, title: w.cbTitle.checked },
        elevation: w.cbElevation.checked === true,
        bands: w.state.bands,
        chunked: w.state.chunked === true,
        offsets: w.offsets,
        declination: w.state.declination
    });
    w.preview_data = preview;
    if (w.pane !== null && w.pane !== undefined) {
        // WHAT PAGE THIS IS. The view re-fits when this string changes
        // and not otherwise: a re-fit on every repaint would make a
        // drag chase its own tail, zooming out from under the cursor
        // as the piece it grabbed moved the bounds.
        // The sheet ARRANGEMENT is part of the page -- more sheets want
        // a wider view -- but not WHILE a sheet is held: a neighbour
        // appearing mid-drag must not zoom the view out from under the
        // hand that is moving it. The view settles when the sheet is let go.
        var arrangement = tiles === null ? "one" : (tiles.rows + "x" +
            tiles.cols + "x" + tiles.tiles.length);
        if (!isNull(w.dragKind) && !isNull(w.lastArrangement)) {
            arrangement = w.lastArrangement;
        }
        w.lastArrangement = arrangement;
        var pageKey = [String(w.sheetCombo.currentText), scale,
            fit.turned, w.cbElevation.checked === true,
            w.state.recordPath, arrangement].join("|");
        CsSheetPreview.show(w.pane, preview, { scale: scale,
            guideX: w.guideX, guideY: w.guideY,
            centredX: w.centredX === true, centredY: w.centredY === true,
            pageKey: pageKey });
    } else {
        // The fallback picture, for a build that refused the view.
        // Painted at the size the label ACTUALLY has, not a fixed 150.
        var previewH = 150;
        try {
            previewH = Math.max(120, Math.min(520, w.preview.height - 4));
        } catch (eH) {
            previewH = 150;
        }
        var pixmap = SheetSetup.paintPreview(preview,
            Math.max(200, w.preview.width - 8), previewH);
        if (pixmap !== null) {
            w.preview.pixmap = pixmap;
        }
    }
    try {
        w.resetButton.enabled = CsSheetSetup.anyMoved(w.offsets);
    } catch (eReset) {
    }

    var spill = CsSheetSetup.previewFits(preview);
    w.fitLabel.text = (w.state.rebuilding === true ?
            qsTr("Rebuilding this sheet from the cave's drawing.  ") : "") +
        qsTr("The plan measures %1 x %2 ft.")
        .arg(Math.round(w.state.caveW)).arg(Math.round(w.state.caveH)) +
        "  " + (fit.fits ?
            qsTr("Fits at 1\" = %1 ft").arg(fit.scale) +
                (fit.turned ? qsTr(", paper turned.") : ".") :
            qsTr("It does not fit this paper at any standard scale."));
    // THE SPILL IS THE POINT OF THE PICTURE. Everything else the panel
    // says could be worked out; this is the one thing a caver would
    // otherwise learn by building the file and looking at it.
    // Off the paper is a WARNING -- the build would still run, but the
    // plot would lose part of the cave. Fitting is plain status.
    w.note.setStyleSheet(spill.fits ? "" :
        "color:" + SheetSetup.LEVELS[SheetSetup.WARNING].colour + ";");
    w.note.text = spill.fits ?
        qsTr("Everything sits on the paper.") :
        qsTr("Off the paper: %1. Try a smaller scale or bigger paper.")
            .arg(spill.spilling.join(", "));
    if (tiles !== null) {
        // MORE THAN ONE SHEET IS NOT A PROBLEM, it is the answer: say
        // what will be built, and what the sheets are called.
        w.fitLabel.text = qsTr("The plan measures %1 x %2 ft: too big " +
            "for one sheet at 1\" = %3 ft.")
            .arg(Math.round(w.state.caveW)).arg(Math.round(w.state.caveH))
            .arg(scale) + "  " + qsTr("It tiles over a %1.")
            .arg(CsSheetTile.describe(tiles));
        w.note.text = qsTr("Drag the blue viewport: sheets appear " +
            "beside the first wherever the cave runs past a margin and " +
            "go again when it does not. Each carries a match line and " +
            "the name of the sheet that continues it, and repeats %1 in " +
            "of its neighbour past the line.").arg(CsSheetTile.OVERLAP_INCHES) +
            (spill.fits ? "" : "  " + qsTr("Off the grid: %1.")
                .arg(spill.spilling.join(", ")));
    }
    w.buildButton.enabled = (w.state.recordPath !== "");
    w.buildButton.text = (tiles !== null) ?
        qsTr("Build %1 Sheets").arg(tiles.tiles.length) :
        ((w.state.rebuilding === true) ?
            qsTr("Rebuild This Sheet") : qsTr("Build Sheet"));
    if (w.state.recordPath === "") {
        w.buildButton.toolTip = qsTr("Save this drawing first -- the " +
            "sheet is written beside it, and an unsaved drawing has " +
            "nowhere to put one.");
    }
};

/** Builds the file. */
SheetSetup.build = function() {
    var w = SheetSetup.widgets;
    if (isNull(w)) {
        return;
    }
    // A PANEL NOBODY HAS READ YET. The dock is built hidden at startup
    // and restoreState() can put it on screen without the menu entry
    // ever running, so its first press can arrive with no state at all.
    // Read the drawing now rather than ignore the press.
    if (isNull(w.state)) {
        SheetSetup.refresh();
    }
    if (isNull(w.state) || w.state.ok !== true) {
        SheetSetup.tell(isNull(w.state) || isNull(w.state.why) ?
            qsTr("Sheet Setup could not read this drawing.") :
            String(w.state.why), SheetSetup.WARNING);
        return;
    }
    var doc = null, di = null;
    try {
        doc = EAction.getDocument();
        di = EAction.getDocumentInterface();
    } catch (eDoc) {
        doc = null;
    }
    if (isNull(doc) || isNull(di)) {
        SheetSetup.tell(qsTr("Sheet Setup needs a drawing open."), SheetSetup.WARNING);
        return;
    }
    var sheet = CsSheetSetup.sheetByName(String(w.sheetCombo.currentText));
    var scale = CsSheetSetup.SCALES[w.scaleCombo.currentIndex];
    var wants = { border: w.cbBorder.checked, bar: w.cbBar.checked,
        north: w.cbNorth.checked, title: w.cbTitle.checked };
    var fit = CsSheetSetup.fit(w.state.caveW, w.state.caveH, sheet,
        SheetSetup.footerFn(w.state, sheet, SheetSetup.wantsOf(w)),
        SheetSetup.turnedOf(w));
    var tiles = SheetSetup.tileLayoutFor(w.state, sheet, scale, w.offsets,
        SheetSetup.wantsOf(w), SheetSetup.turnedOf(w));
    var turned = tiles !== null ? tiles.turned : fit.turned;
    var perFoot = CsShapeLine.perFoot(doc);

    var elevBox = null;
    if (w.cbElevation.checked === true && w.state.hasElevation) {
        elevBox = SheetSetup.frameBox(doc, "profile");
    }
    var caveDrag = CsSheetSetup.offsetOf(w.offsets, "cave");
    var res;
    try {
        res = CsLayoutGen.generate(doc, di, {
            caveBox: w.state.caveBox, elevBox: elevBox, sheet: sheet, turned: turned,
            scale: scale, perFoot: perFoot, wants: wants,
            titleValues: SheetSetup.titleValues(doc, w.state.filled),
            reading: CsSheetSetup.latestDeclination(w.state.survey),
            tiles: tiles, elevation: elevBox !== null,
            shiftInches: { x: -caveDrag.x, y: -caveDrag.y },
            extra: { offsets: w.offsets,
                titleValues: SheetSetup.titleValues(doc, w.state.filled) } });
    } catch (eGen) {
        SheetSetup.tell(qsTr("Sheet Setup: building the sheets failed (") + eGen + ").",
            SheetSetup.ERROR);
        return;
    }
    var words = [];
    if (res.made.length > 0) {
        words.push(qsTr("made ") + res.made.join(", "));
    }
    if (res.rewritten.length > 0) {
        words.push(qsTr("rewrote ") + res.rewritten.join(", "));
    }
    var said = qsTr("Sheet Setup: ") + words.join("; ") + qsTr(", at 1\" = ") + scale +
        qsTr(" ft on ") + sheet.name + ".";
    var level = SheetSetup.DONE;
    if (res.skipped.length > 0) {
        said += " " + qsTr("Left alone because they were edited or made by hand: ") +
            res.skipped.join(", ") + qsTr(". Right-click a sheet's tab, Revert to automatic, to have it rebuilt.");
        level = SheetSetup.WARNING;
    }
    if (res.made.length + res.rewritten.length === 0) {
        level = SheetSetup.WARNING;
    }
    if (w.state.chunked === true && elevBox !== null) {
        said += " " + qsTr("A chunked elevation is shown as drawn; its arrangement offsets are not part of sheets yet.");
    }
    // show the first sheet that was written
    var first = res.made.length > 0 ? res.made[0] : (res.rewritten.length > 0 ? res.rewritten[0] : "");
    if (first !== "") {
        try {
            Layouts.activate(di, first);
        } catch (eAct) {
        }
    }
    SheetSetup.tell(said, level);
};

/**
 * Say something the caver will actually see: on the panel's own note
 * line, coloured by level, and on the command line in the same colour.
 * A warning or an error also comes up in a box, because a note under a
 * preview is easy to miss when the thing you expected was a new tab.
 *
 * Never warning(): that is qWarning, which only reaches stderr.
 *
 * \param level SheetSetup.DONE, WARNING or ERROR -- see LEVELS.
 */
SheetSetup.tell = function(text, level) {
    text = String(text);
    var look = SheetSetup.LEVELS[level] || SheetSetup.LEVELS[SheetSetup.DONE];
    try {
        var w = SheetSetup.widgets;
        if (!isNull(w) && !isNull(w.note)) {
            w.note.text = text;
            w.note.setStyleSheet("color:" + look.colour + ";");
        }
    } catch (eNote) {
    }
    try {
        // Unescaped so the span colours it, which means the text has to
        // be escaped here instead. Not handleUserWarning: that is always
        // red, and a warning is not a failure.
        EAction.handleUserMessage("<span style='color:" + look.colour +
            ";'>" + SheetSetup.escapeHtml(text) + "</span>", false);
    } catch (eLine) {
    }
    if (look.box === true) {
        try {
            QMessageBox.warning(RMainWindowQt.getMainWindow(),
                qsTr("Sheet Setup"), text);
        } catch (eBox) {
        }
    }
};

/**
 * A piece being dragged, reported in DRAWING units and snapped.
 *
 * The move is turned into INCHES of paper and added to what the piece
 * already carries, and the panel redraws from that -- so the picture a
 * caver is dragging IS the layout that will be built, not a rubber band
 * over an unchanged one.
 */
SheetSetup.dragTo = function(kind, snapped) {
    var w = SheetSetup.widgets;
    if (isNull(w) || isNull(w.state) || w.state.ok !== true) {
        return;
    }
    var scale = CsSheetSetup.SCALES[w.scaleCombo.currentIndex];
    if (!(scale > 0)) {
        return;
    }
    // A FRAME THAT DRAWS THE SAME PICTURE IS DROPPED HERE. While a
    // piece is held on a snap guide the mouse keeps moving and the
    // piece does not, so every one of those moves used to rebuild the
    // preview for nothing -- see CsSheetSetup.dragKey.
    var key = CsSheetSetup.dragKey(kind, snapped);
    if (key !== null && key === w.dragFrame) {
        return;
    }
    w.dragFrame = key;
    // FROM WHERE THE DRAG BEGAN, not from the last frame: the view
    // reports the whole move each time, measured against the box it
    // grabbed, so adding each frame to the last would move the piece
    // twice as far as the mouse.
    var stored = kind;
    var sign = 1;
    if (isNull(w.dragFrom) || w.dragKind !== kind) {
        w.dragKind = kind;
        w.dragFrom = CsSheetSetup.offsetOf(w.offsets, stored);
    }
    var moved = {};
    var k;
    for (k in w.offsets) {
        if (w.offsets.hasOwnProperty(k)) {
            moved[k] = CsSheetSetup.offsetOf(w.offsets, k);
        }
    }
    moved[stored] = { x: w.dragFrom.x + sign * snapped.dx / scale,
                      y: w.dragFrom.y + sign * snapped.dy / scale };
    w.offsets = moved;
    w.guideX = snapped.guideX;
    w.guideY = snapped.guideY;
    w.centredX = snapped.centredX === true;
    w.centredY = snapped.centredY === true;
    SheetSetup.repaint();
    // SAY IT OUT LOUD. A piece sitting a hair off centre looks exactly
    // like one on it, and the guide line alone does not say WHICH kind
    // of line it is to a caver who has not read the handbook.
    try {
        var say = SheetSetup.HINT;
        if (w.centredX && w.centredY) {
            say = qsTr("Centred both ways.");
        } else if (w.centredX) {
            say = qsTr("Centred left to right.");
        } else if (w.centredY) {
            say = qsTr("Centred top to bottom.");
        }
        // ONLY WHEN IT CHANGES. The hint is a word-wrapped label, so a
        // new string of a different length relays out the whole dock --
        // and a relayout resizes the view under the cursor mid-drag.
        if (String(w.hint.text) !== String(say)) {
            w.hint.text = say;
        }
    } catch (eHint) {
    }
};

/** The drag is over: the guides go, the offset stays. */
SheetSetup.dragDone = function() {
    var w = SheetSetup.widgets;
    if (isNull(w)) {
        return;
    }
    w.dragKind = null;
    w.dragFrom = null;
    w.dragFrame = null;
    w.guideX = null;
    w.guideY = null;
    w.centredX = false;
    w.centredY = false;
    try {
        w.hint.text = SheetSetup.HINT;
    } catch (eHint) {
    }
    SheetSetup.repaint();
};

/** Every piece back where the default layout puts it. */
SheetSetup.resetLayout = function() {
    var w = SheetSetup.widgets;
    if (isNull(w)) {
        return;
    }
    w.offsets = {};
    w.dragKind = null;
    w.dragFrom = null;
    w.guideX = null;
    w.guideY = null;
    w.centredX = false;
    w.centredY = false;
    try {
        w.hint.text = SheetSetup.HINT;
    } catch (eHint) {
    }
    SheetSetup.repaint();
};

SheetSetup.ensureDock = function() {
    if (csSheetSetupDock !== undefined && csSheetSetupDock !== null) {
        return csSheetSetupDock;
    }
    var appWin = RMainWindowQt.getMainWindow();
    csSheetSetupDock = SheetSetup.buildDock(appWin);
    appWin.addDockWidget(Qt.RightDockWidgetArea, csSheetSetupDock);
    return csSheetSetupDock;
};

/**
 * Builds the sheet in a COPY of the record and opens it.
 *
 * The record drawing is imported into a memory document, the sheet is
 * drawn there, and that document is exported to the cave's sheets
 * folder. The file the caver has open is never written to and never
 * even modified in memory -- which is the whole point, and is why this
 * does not simply draw and then "undo".
 *
 * \return the sentence the caver is told.
 */
SheetSetup.intoCopy = function(recordPath, opts) {
    SheetSetup.lastWritten = [];
    var folder = CsCave.folderOf(recordPath);
    var caveName = CsCave.nameOf(recordPath);
    if (isNull(folder) || folder === "") {
        return "Sheet Setup: could not work out which folder " +
            recordPath + " lives in, so there is nowhere to put the " +
            "sheet.";
    }
    try {
        (new QDir("/")).mkpath(folder + "/" +
            CsSheetSetup.SHEETS_FOLDER);
    } catch (eDir) {
    }

    // ONE FILE PER SHEET. A plan file and, when asked for, a profile
    // file -- never one drawing holding both, which is one enormous
    // page as far as a plotter is concerned. See
    // CsSheetSetup.sheetPathFor.
    //
    // A TILED PLAN IS A GRID OF FILES, one per sheet the cave touches,
    // named by place in the grid ("<Cave> Plan Sheet B2.dxf").
    var jobs = [];
    if (!isNull(opts.tiles) && opts.tiles.tiled === true) {
        for (var ti = 0; ti < opts.tiles.tiles.length; ti++) {
            jobs.push({ kind: CsSheetSetup.PLAN_SHEET,
                tile: opts.tiles.tiles[ti] });
        }
    } else {
        jobs.push({ kind: CsSheetSetup.PLAN_SHEET, tile: null });
    }
    if (opts.elevation === true) {
        jobs.push({ kind: CsSheetSetup.ELEVATION_SHEET, tile: null });
    }

    var written = [];
    // Every file this run finished writing, read by build() to tell a
    // failure from a success. Reset first so an early return reads as
    // "nothing written".
    SheetSetup.lastWritten = written;
    var said = "";
    for (var k = 0; k < jobs.length; k++) {
        var target = CsSheetSetup.sheetPathFor(folder, caveName,
            jobs[k].kind, jobs[k].tile === null ? "" : jobs[k].tile.id);
        var di = new RDocumentInterface(
            new RDocument(new RMemoryStorage(), createSpatialIndex()));
        try {
            if (di.importFile(recordPath, "", false) !==
                    RDocumentInterface.IoErrorNoError) {
                return "Sheet Setup: could not read " + recordPath + ".";
            }
            var one = {};
            for (var key in opts) {
                if (opts.hasOwnProperty(key)) {
                    one[key] = opts[key];
                }
            }
            one.kind = jobs[k].kind;
            one.tile = jobs[k].tile;
            one.tileCount = isNull(opts.tiles) ? 0 : opts.tiles.tiles.length;
            said = SheetSetup.draw(di.getDocument(), di, one);
            if (!di.exportFile(target, CsSanitize.dxfFilter())) {
                return "Sheet Setup: could not write " + target + ".";
            }
            written.push(target);
        } catch (e) {
            return "Sheet Setup: building the sheet failed (" + e + ").";
        } finally {
            try {
                if (typeof destr === "function") {
                    destr(di);
                }
            } catch (eDestroy) {
            }
        }
    }

    var names = [];
    for (var n = 0; n < written.length; n++) {
        names.push(CsShelf.basename(written[n]));
    }
    if (!isNull(opts.tiles) && opts.tiles.tiled === true) {
        said = "Sheet Setup: a " + CsSheetTile.describe(opts.tiles) +
            ", at 1\" = " + opts.scale +
            " ft on " + opts.sheet.name + ", each with its match lines " +
            "and the name of the sheet that continues it.";
        if (names.length > 4) {
            names = names.slice(0, 3).concat(["... and " +
                (names.length - 3) + " more"]);
        }
    }
    var tail = " Written to " + CsSheetSetup.SHEETS_FOLDER + "/: " +
        names.join(" and ") + " -- your own drawing was not touched.";
    // EARLIER PLAN SHEETS THIS SET REPLACES ARE NAMED, not deleted: a
    // layout with fewer sheets (or the single sheet it used to be) leaves
    // the old files beside the new ones, and a stale "Plan Sheet A4"
    // looks exactly like part of the set.
    try {
        var older = (new QDir(folder + "/" + CsSheetSetup.SHEETS_FOLDER))
            .entryList(["* Plan Sheet*.dxf"], QDir.Files);
        var stale = [];
        for (var so = 0; so < older.length; so++) {
            var theirPath = folder + "/" + CsSheetSetup.SHEETS_FOLDER + "/" +
                older[so];
            var kept = false;
            for (var sw = 0; sw < written.length; sw++) {
                if ((new QFileInfo(written[sw])).fileName() === older[so]) {
                    kept = true;
                }
            }
            if (!kept && theirPath.indexOf(caveName) >= 0) {
                stale.push(String(older[so]));
            }
        }
        if (stale.length > 0 && !isNull(opts.tiles)) {
            tail += " Plan sheets from an earlier layout are still in that " +
                "folder and are NOT part of this set: " + stale.join(", ") +
                ".";
        }
    } catch (eStale) {
    }
    // A SHEET ALREADY ON SCREEN IS NOT REOPENED (Nathan, 2026-09-14:
    // "Build Sheet failed to open the built sheet"). QCAD's openFiles
    // walks the open tabs first and, finding one whose file name
    // matches, ACTIVATES it and returns -- it never re-reads the file
    // (library.js, the foundExisting branch). A sheet is rebuilt from
    // the record every single time it is built, so the second build
    // shows the FIRST build's drawing, silently: the file on disk is
    // new, the tab is old, and nothing says so.
    SheetSetup.reopen(written);
    return said + tail;
};

/**
 * Show the sheets this run wrote, re-read from disk.
 *
 * CLOSE, THEN OPEN ON THE NEXT PASS. Closing a sub window is QUEUED:
 * `closeActiveSubWindow` returns before the window is gone, so an open
 * issued immediately afterwards still finds the doomed tab in
 * `subWindowList`, activates it, and returns -- and the queued close
 * then takes it away. Measured live 2026-09-14: the rebuild ended with
 * NO sheet on screen at all, which is the same complaint one step
 * further on. A zero-interval timer runs after Qt has finished closing,
 * which is the first moment an open can win.
 *
 * Only a plain JS call lives in the timer's closure: a Qt wrapper held
 * across that boundary is one of this bridge's crash modes.
 *
 * \param written every file this build wrote; the first is the PLAN
 *                sheet, which is the one shown -- it is the map, and a
 *                caver who wanted the profile can open it from the
 *                same folder.
 */
SheetSetup.reopen = function(written) {
    if (isNull(written) || written.length === 0) {
        return;
    }
    var closed = 0;
    try {
        var mdi = RMainWindowQt.getMainWindow().getMdiArea();
        var subs = mdi.subWindowList();
        for (var i = 0; i < subs.length; i++) {
            var open = "";
            try {
                open = String(subs[i].getDocument().getFileName());
            } catch (eName) {
                continue;
            }
            if (open === "") {
                continue;
            }
            var here = (new QFileInfo(open)).absoluteFilePath();
            for (var k = 0; k < written.length; k++) {
                if (here !== (new QFileInfo(written[k])).absoluteFilePath()) {
                    continue;
                }
                // A sheet the caver has drawn on asks to be saved
                // first, which is Qt's own prompt and the right
                // question: the rebuild has already replaced it.
                mdi.setActiveSubWindow(subs[i]);
                mdi.closeActiveSubWindow();
                closed += 1;
                break;
            }
        }
    } catch (eClose) {
        // no MDI area to ask (a scripted run): the open below is still
        // right for a sheet that was not on screen
    }
    SheetSetup.pendingSheet = written[0];
    if (closed === 0) {
        SheetSetup.openPending();
        return;
    }
    try {
        var timer = new QTimer();
        timer.singleShot = true;
        timer.timeout.connect(function() {
            SheetSetup.openPending();
        });
        SheetSetup.openTimer = timer;
        timer.start(0);
    } catch (eTimer) {
        SheetSetup.openPending();
    }
};

/** Open the sheet SheetSetup.reopen set aside, once. */
SheetSetup.openPending = function() {
    var path = SheetSetup.pendingSheet;
    SheetSetup.pendingSheet = null;
    if (isNull(path) || path === "") {
        return;
    }
    try {
        // openFiles(), the global QCAD opens drawings with -- see the
        // note where this used mainWindow.openFile and could not.
        openFiles([path], false);
    } catch (eOpen) {
        SheetSetup.tell(qsTr("Sheet Setup: the sheet was written but " +
            "would not open (") + eOpen + "). " + path, SheetSetup.ERROR);
    }
};

/**
 * Clips everything on a sheet that is not sheet furniture, inside the
 * caller's operation:
 *
 *   to the MAP AREA `rect` (a tiled sheet shows only its own part of the
 *   map; null skips this), and
 *   around the HOLES -- the boxes the sheet's own elements stand in. A
 *   title block, scale bar or north arrow is backed WHITE: whatever the
 *   viewport has put under it is cut away, so the element reads clean
 *   however the map was slid under it. (A white fill is no use: a CAD
 *   plot prints anything near white as black.)
 *
 *   untouched            wholly inside the map and clear of every hole
 *   dropped              wholly outside the map, or its middle in a hole
 *   a line, a polyline   cut at the map edge and around each hole; the
 *                        parts left are kept, as open polylines carrying
 *                        the original's layer, colour, linetype and weight
 *                        (a bulged segment is followed as the arc it is)
 *   a spline             the same, through its polyline
 *   anything else        kept or dropped by where its middle is -- a
 *                        symbol, a note, a circle is small beside a sheet
 *
 * Sheet furniture (anything this tool tagged) and the sheet's own mark
 * are never touched. The sheet is a derived file, rebuilt from the
 * record on every build, so replacing a long wall with the pieces of it
 * that survive loses nothing.
 *
 * \return { kept, trimmed, dropped }
 */
SheetSetup.clipToMap = function(doc, op, rect, holes) {
    var out = { kept: 0, trimmed: 0, dropped: 0 };
    var cut = isNull(holes) ? [] : holes;
    var ids = doc.queryAllEntities(false, false);
    var carry = function(from, to) {
        to.setLayerId(from.getLayerId());
        try { to.setColor(from.getColor()); } catch (eC) {}
        try { to.setLinetypeId(from.getLinetypeId()); } catch (eL) {}
        try { to.setLineweight(from.getLineweight()); } catch (eW) {}
    };
    var runsToEntities = function(e, runs) {
        for (var r = 0; r < runs.length; r++) {
            var made;
            if (runs[r].length === 2 && e instanceof RLineEntity) {
                made = new RLineEntity(doc, new RLineData(
                    new RVector(runs[r][0].x, runs[r][0].y),
                    new RVector(runs[r][1].x, runs[r][1].y)));
            } else {
                var pd = new RPolylineData();
                for (var v = 0; v < runs[r].length; v++) {
                    pd.appendVertex(new RVector(runs[r][v].x, runs[r][v].y));
                }
                made = new RPolylineEntity(doc, pd);
            }
            carry(e, made);
            op.addObject(made, false);
        }
    };
    var meets = function(a, b) {
        return a.minX < b.maxX && a.maxX > b.minX &&
            a.minY < b.maxY && a.maxY > b.minY;
    };
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || CsTags.get(e, SS_TAG) !== "" ||
                CsTags.get(e, CsSheetFile.TAG) !== "") {
            continue;
        }
        var bb = e.getBoundingBox();
        var mn = bb.getMinimum(), mx = bb.getMaximum();
        if (!isFinite(mn.x) || !isFinite(mx.x)) {
            continue;
        }
        var box = { minX: mn.x, minY: mn.y, maxX: mx.x, maxY: mx.y };
        var overMap = rect !== null && !CsSheetTile.inside(box, rect);
        var overHoles = [];
        for (var h = 0; h < cut.length; h++) {
            if (meets(box, cut[h])) { overHoles.push(cut[h]); }
        }
        if (!overMap && overHoles.length === 0) {
            out.kept++;
            continue;
        }
        if (rect !== null && (box.maxX < rect.minX || box.minX > rect.maxX ||
                box.maxY < rect.minY || box.minY > rect.maxY)) {
            op.deleteObject(e);
            out.dropped++;
            continue;
        }
        // A LINEAR THING: its points, to be cut
        var points = null, closed = false;
        if (e instanceof RLineEntity) {
            var sp = e.getStartPoint(), ep = e.getEndPoint();
            points = [{ x: sp.x, y: sp.y }, { x: ep.x, y: ep.y }];
        } else if (e instanceof RPolylineEntity) {
            var verts = [];
            for (var vi = 0; vi < e.countVertices(); vi++) {
                var vp = e.getVertexAt(vi);
                verts.push({ x: vp.x, y: vp.y, bulge: e.getBulgeAt(vi) });
            }
            closed = e.isClosed() === true;
            points = verts.length >= 2 ?
                CsSheetTile.samplePolyline(verts, closed) : null;
        } else if (e instanceof RSplineEntity) {
            try {
                var sampled = e.getData().toPolyline(24);
                points = [];
                for (var si = 0; si < sampled.countVertices(); si++) {
                    var sv = sampled.getVertexAt(si);
                    points.push({ x: sv.x, y: sv.y });
                }
            } catch (eSpline) {
                points = null;
            }
        }
        if (points !== null && points.length >= 2) {
            var runs = [{ pts: points, closed: closed }];
            var changed = false;
            if (rect !== null) {
                var inMap = CsSheetTile.clipRuns(points, closed, rect);
                if (inMap !== null) {
                    runs = inMap.map(function(r) { return { pts: r, closed: false }; });
                    changed = true;
                }
            }
            for (var ho = 0; ho < overHoles.length; ho++) {
                var next = [];
                for (var rr = 0; rr < runs.length; rr++) {
                    var around = CsSheetTile.cutOutRuns(runs[rr].pts,
                        runs[rr].closed, overHoles[ho]);
                    if (around === null) {
                        next.push(runs[rr]);
                    } else {
                        changed = true;
                        for (var ar = 0; ar < around.length; ar++) {
                            next.push({ pts: around[ar], closed: false });
                        }
                    }
                }
                runs = next;
            }
            if (!changed) {
                out.kept++;
                continue;
            }
            op.deleteObject(e);
            if (runs.length === 0) {
                out.dropped++;
            } else {
                runsToEntities(e, runs.map(function(r) { return r.pts; }));
                out.trimmed++;
            }
            continue;
        }
        // anything else: by where its middle is
        var mid = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
        var gone = rect !== null && !CsSheetTile.within(mid, rect);
        for (var hm = 0; hm < cut.length && !gone; hm++) {
            gone = CsSheetTile.within(mid, cut[hm]);
        }
        if (gone) {
            op.deleteObject(e);
            out.dropped++;
        } else {
            out.kept++;
        }
    }
    return out;
};

/**
 * Writes the sheet's border into the drawing's page settings: paper
 * size and orientation, the print scale, and the offset that puts the
 * paper's corner on the border's. Glue margins are zeroed -- QCAD
 * otherwise defaults them to the default printer's unprintable edge and
 * crops the border off the page.
 *
 * Returns the settings it wrote (null when it could not), so the build
 * and the tests can read back what the paper was told.
 */
SheetSetup.writePageSettings = function(doc, box, sheet, turned) {
    try {
        var unitMM = RUnit.convert(1.0, doc.getUnit(), RS.Millimeter);
        var page = CsSheetSetup.pageSettings(box, sheet, turned, unitMM);
        doc.setVariable("UnitSettings/PaperUnit", RS.Millimeter);
        doc.setVariable("PageSettings/PaperWidth", page.paperWidthMM);
        doc.setVariable("PageSettings/PaperHeight", page.paperHeightMM);
        doc.setVariable("PageSettings/PageOrientation", page.orientation);
        doc.setVariable("PageSettings/Scale", page.scale);
        doc.setVariable("PageSettings/OffsetX", page.offsetX);
        doc.setVariable("PageSettings/OffsetY", page.offsetY);
        doc.setVariable("MultiPageSettings/Columns", 1);
        doc.setVariable("MultiPageSettings/Rows", 1);
        doc.setVariable("MultiPageSettings/GlueMarginsLeft", 0);
        doc.setVariable("MultiPageSettings/GlueMarginsRight", 0);
        doc.setVariable("MultiPageSettings/GlueMarginsTop", 0);
        doc.setVariable("MultiPageSettings/GlueMarginsBottom", 0);
        return page;
    } catch (eSettings) {
        return null;
    }
};

/**
 * Plots the sheets to PDF, one file per sheet, beside each DXF.
 *
 * Goes through QCAD's own Print.print -- the path File > Export to PDF
 * takes -- so what comes out is what the page settings Build Sheet
 * wrote say it is. Then it reads the PDF's /MediaBox back and compares
 * it to the paper the sheet asked for: a page that came out at the
 * wrong size is reported, not shipped quietly.
 *
 * Sheets are the ones the last Build Sheet wrote; with none, the sheet
 * on screen (a sheet opened from disk is plotted just as well).
 */
SheetSetup.exportPdf = function() {
    var doc = null, di = null;
    try {
        doc = EAction.getDocument();
        di = EAction.getDocumentInterface();
    } catch (eDoc) {
        doc = null;
    }
    if (isNull(doc) || isNull(di)) {
        return;
    }
    var sheets = Layouts.list(doc);
    if (sheets.length === 0) {
        SheetSetup.tell(qsTr("Nothing to plot yet. Build Sheet first."), SheetSetup.WARNING);
        return;
    }
    // ONE PDF, a page per sheet in tab order, beside the cave's other PDFs;
    // a drawing with no file yet asks where.
    var path = "";
    var here = "";
    try {
        here = String(doc.getFileName());
    } catch (eName) {
        here = "";
    }
    var folder = CsCave.pdfDir(here);
    var caveName = CsCave.nameOf(here);
    if (folder !== null && caveName !== null) {
        try {
            (new QDir("/")).mkpath(folder);
        } catch (eDir) {
        }
        path = folder + "/" + caveName + " Sheets.pdf";
    } else {
        path = CsFiles.saveFile(getMainWindow(), qsTr("Export sheets to PDF"),
            QDir.homePath() + "/Sheets.pdf", "PDF (*.pdf)");
        if (path === "") {
            return;
        }
    }
    var names = [];
    for (var i = 0; i < sheets.length; i++) {
        names.push(sheets[i].name);
    }
    var back = LayoutPlot.exportPdf(di, names, path);
    if (back.ok !== true) {
        SheetSetup.tell(qsTr("PDF export failed -- ") + back.error, SheetSetup.ERROR);
        return;
    }
    try {
        QDesktopServices.openUrl(QUrl.fromLocalFile(path));
    } catch (eOpen) {
    }
    SheetSetup.tell(qsTr("Plotted ") + CsShelf.basename(path) + " (" + back.pages +
        (back.pages === 1 ? qsTr(" page") : qsTr(" pages")) + qsTr(", one per sheet)."), SheetSetup.DONE);
};

/**
 * Plots several sheet files into ONE multi-page PDF, a page per sheet in
 * the order given.
 *
 * One printer and one painter are kept open across every sheet: each
 * sheet is brought up in its own tab (a plot needs the sheet's view),
 * handed to QCAD's own Print for its page, and the printer is told to
 * start a new page before the next. The paper comes from the first
 * sheet -- the tiles of one plan are all the same size and way up.
 *
 * \return { ok, why }
 */
SheetSetup.plotSet = function(sheetPaths, pdf) {
    for (var e = 0; e < sheetPaths.length; e++) {
        if (!(new QFileInfo(sheetPaths[e])).exists()) {
            return { ok: false, why: qsTr("%1 is gone")
                .arg(CsShelf.basename(sheetPaths[e])) };
        }
    }
    if ((new QFileInfo(pdf)).exists() &&
            QMessageBox.question(getMainWindow(), "Sheet Setup",
                qsTr("%1 already exists. Replace it?")
                    .arg(CsShelf.basename(pdf)),
                QMessageBox.Yes | QMessageBox.No) !== QMessageBox.Yes) {
        return { ok: false, why: qsTr("left as it was") };
    }
    var printer = null, painter = null;
    try {
        var wanted = null;
        for (var i = 0; i < sheetPaths.length; i++) {
            openFiles([sheetPaths[i]], false);
            var child = EAction.getMdiChild();
            var doc = EAction.getDocument();
            if (isNull(child) || isNull(doc) ||
                    (new QFileInfo(String(doc.getFileName())))
                        .absoluteFilePath() !==
                    (new QFileInfo(sheetPaths[i])).absoluteFilePath()) {
                return { ok: false, why: qsTr("could not bring %1 up")
                    .arg(CsShelf.basename(sheetPaths[i])) };
            }
            var view = child.getLastKnownViewWithFocus();
            var plotter = new Print(undefined, doc, view);
            if (i === 0) {
                var paper = Print.getPaperSizeMM(doc);
                wanted = { w: paper.width() / 25.4, h: paper.height() / 25.4 };
                printer = plotter.createPrinter(pdf);
                if (isNull(printer)) {
                    return { ok: false, why: qsTr("could not start the PDF") };
                }
                painter = new QPainter();
                if (!painter.begin(printer)) {
                    return { ok: false, why: qsTr("could not write the PDF") };
                }
            } else {
                printer.newPage();
            }
            plotter.printCurrentBlock(printer, painter);
        }
        painter.end();
        painter = null;
        try {
            destr(printer);
        } catch (eDestr) {
        }
        printer = null;
        var file = new QFile(pdf);
        if (!file.open(QIODevice.ReadOnly)) {
            return { ok: false, why: qsTr("the PDF was not written") };
        }
        var bytes = file.readAll();
        file.close();
        var total = bytes.length();
        var tail = "";
        for (var b = Math.max(0, total - 20000); b < total; b++) {
            tail += String.fromCharCode(bytes.at(b) & 255);
        }
        var page = CsSheetSetup.mediaBoxInches(tail);
        if (page !== null && !CsSheetSetup.pageMatches(page, wanted)) {
            return { ok: false, why: qsTr("the PDF pages are %1 x %2 in, " +
                "not the sheets' paper").arg(page.w.toFixed(1))
                .arg(page.h.toFixed(1)) };
        }
        return { ok: true, why: "" };
    } catch (ePlot) {
        try {
            if (painter !== null) { painter.end(); }
        } catch (eEnd) {
        }
        return { ok: false, why: String(ePlot) };
    }
};

/**
 * Plots one open (or openable) sheet to `pdf`.
 * \return { ok, why } -- why is a sentence when ok is false.
 */
SheetSetup.plotOne = function(sheetPath, pdf) {
    if (!(new QFileInfo(sheetPath)).exists()) {
        return { ok: false, why: qsTr("the sheet file is gone") };
    }
    if ((new QFileInfo(pdf)).exists() &&
            QMessageBox.question(getMainWindow(), "Sheet Setup",
                qsTr("%1 already exists. Replace it?")
                    .arg(CsShelf.basename(pdf)),
                QMessageBox.Yes | QMessageBox.No) !== QMessageBox.Yes) {
        return { ok: false, why: qsTr("left as it was") };
    }
    try {
        // openFiles activates a tab already showing this file rather
        // than re-reading it, which is what we want: the sheet as the
        // caver sees it is the sheet that is plotted.
        openFiles([sheetPath], false);
        var child = EAction.getMdiChild();
        var doc = EAction.getDocument();
        if (isNull(child) || isNull(doc) ||
                (new QFileInfo(String(doc.getFileName()))).absoluteFilePath()
                !== (new QFileInfo(sheetPath)).absoluteFilePath()) {
            return { ok: false, why: qsTr("could not bring the sheet up") };
        }
        var view = child.getLastKnownViewWithFocus();
        var paper = Print.getPaperSizeMM(doc);
        var wanted = { w: paper.width() / 25.4, h: paper.height() / 25.4 };
        if (!(new Print(undefined, doc, view)).print(pdf)) {
            return { ok: false, why: qsTr("could not write the PDF") };
        }
        var file = new QFile(pdf);
        if (!file.open(QIODevice.ReadOnly)) {
            return { ok: false, why: qsTr("the PDF was not written") };
        }
        var bytes = file.readAll();
        file.close();
        // QByteArray reaches script as a bare wrapper (no indexOf, no
        // mid, no usable toString), so the tail is read a byte at a
        // time. Qt writes the page dictionary AFTER the page's content
        // stream, so the tail is where /MediaBox lives however big the
        // plot is.
        var total = bytes.length();
        var from = Math.max(0, total - 20000);
        var tail = "";
        for (var b = from; b < total; b++) {
            tail += String.fromCharCode(bytes.at(b) & 255);
        }
        if (tail.indexOf("/MediaBox") < 0) {
            return { ok: true, why: "" };
        }
        var page = CsSheetSetup.mediaBoxInches(tail);
        if (page !== null && !CsSheetSetup.pageMatches(page, wanted)) {
            return { ok: false, why: qsTr("the PDF page is %1 x %2 in, " +
                "not the sheet's paper").arg(page.w.toFixed(1))
                .arg(page.h.toFixed(1)) };
        }
        return { ok: true, why: "" };
    } catch (ePlot) {
        return { ok: false, why: String(ePlot) };
    }
};

/**
 * Draws the sheet. Separated from the dialog ON PURPOSE: everything
 * above this line asks a human questions, and everything below it is
 * geometry that has to be testable without one. tests/sheet_setup_run.js
 * calls straight into here.
 *
 * Answers the sentence the caver is told.
 */
SheetSetup.draw = function(doc, di, opts) {
    // WHICH SHEET THIS FILE IS. Each is its own drawing holding one
    // sheet -- see CsSheetSetup.sheetPathFor on why -- so the plan file
    // has no elevation in it at all and the profile file has no plan.
    var kind = isNull(opts.kind) ? CsSheetSetup.PLAN_SHEET : opts.kind;
    var elevationSheet = (kind === CsSheetSetup.ELEVATION_SHEET);
    var caveBox = opts.caveBox;
    var sheet = opts.sheet;
    var scale = opts.scale;
    var wants = opts.wants;
    var filled = isNull(opts.filled) ? {} : opts.filled;
    var read = { survey: opts.survey };
    var fit = { turned: opts.turned === true };
    var perFoot = CsShapeLine.perFoot(doc);

    // What the furniture will need at the bottom, measured BEFORE the
    // sheet is placed: the title block is as tall as its credit list
    // makes it, and the sheet has to reserve that band rather than let
    // the map print over it.
    var titleValues = SheetSetup.titleValues(doc, filled);
    var titleLines = (wants.title === true) ?
        CsSheetSetup.titleLines(titleValues) : [];
    // The furniture's own layout decides how tall the band under the map
    // must be -- the same function the preview used, so the two cannot
    // disagree about where a piece is.
    var turnedPaper = (!isNull(opts.tile) && !elevationSheet) ?
        opts.turned === true : fit.turned === true;
    var sheetReading = CsSheetSetup.latestDeclination(read.survey);
    // Only the TITLE sheet of a tiled plan (A1) carries the title block;
    // every other sheet has just the scale bar and the north arrow.
    var titleHere = wants.title === true &&
        (isNull(opts.tile) || elevationSheet || opts.tile.title === true);
    var fur = CsSheetSetup.furniture({
        widthInches: turnedPaper ? sheet.h : sheet.w,
        wants: { title: titleHere, bar: wants.bar === true,
            north: wants.north === true && !elevationSheet },
        titleHeight: CsSheetSetup.linesHeight(titleLines) + 0.2,
        reading: sheetReading });
    var footerInches = fur.footer;
    // HAND-ARRANGED MOVES, in inches of paper. The cave's own is the
    // odd one: a caver dragging the cave across the preview is asking
    // for the map to sit elsewhere on the PAGE, and survey coordinates
    // are not a layout decision -- so the paper moves the other way
    // instead, which is what the negation is.
    var offsets = isNull(opts.offsets) ? {} : opts.offsets;
    var caveOff = CsSheetSetup.offsetOf(offsets, "cave");
    // A TILE IS A SHEET WITH ITS OWN PLACE ON THE GRID: the paper box
    // CsSheetTile worked out, not one centred on the cave.
    var tile = (isNull(opts.tile) || elevationSheet) ? null : opts.tile;
    var box = tile !== null ? tile.paper :
        CsSheetSetup.borderBox(caveBox, sheet, scale, fit.turned,
            footerInches, { x: -caveOff.x, y: -caveOff.y });
    // THE PAPER IS TOLD WHAT THE SHEET IS, so File > Print and Export
    // PDF plot it to scale without a trip through Page Setup.
    SheetSetup.writePageSettings(doc, box, sheet, fit.turned);
    var layers = [CsLayers.BORDER, CsLayers.SCALE_BAR,
        CsLayers.NORTH_ARROW, CsLayers.TITLE_BLOCK];
    for (var L = 0; L < layers.length; L++) {
        CsLayers.ensure(doc, di, layers[L]);
    }

    var op = new RAddObjectsOperation();
    op.setText("Sheet setup");

    var cleared = 0;
    var allIds = doc.queryAllEntities(false, false);
    for (var i = 0; i < allIds.length; i++) {
        var old = doc.queryEntity(allIds[i]);
        if (!isNull(old) && CsTags.get(old, SS_TAG) !== "") {
            op.deleteObject(old);
            cleared++;
        }
    }

    var erased = 0;
    var unit = function(inches) {
        return CsSheetSetup.atScale(inches, scale) * perFoot;
    };
    var text = function(x, y, inches, label, layer, kind, keepCase) {
        var height = unit(inches);
        // The wrap width is generous on purpose: the lines are wrapped
        // by CsSheetSetup.titleLines before they get here, and a narrow
        // width would wrap them a SECOND time inside the entity, which
        // is what put twenty-one surveyors on top of six other fields.
        var e = new RTextEntity(doc, new RTextData(
            new RVector(x, y), new RVector(x, y), height,
            unit(CsSheetSetup.TITLE_INCHES * 4),
            RS.VAlignMiddle, RS.HAlignLeft, RS.LeftToRight, RS.Exact,
            1.0, keepCase === true ? String(label) : CsDraw.caps(label),
            "standard", false, false, 0.0, false));
        e.setLayerId(doc.getLayerId(layer));
        // The tag says which SHEET a piece belongs to as well as
        // marking it generated: CsProfileDraw asks where sheet two is
        // by looking for its border, so there has to be exactly one
        // answer and it has to be drawn rather than stored.
        CsTags.set(e, SS_TAG, isNull(kind) ? layer : kind);
        op.addObject(e, false);
        return e;
    };
    var line = function(x1, y1, x2, y2, layer, kind) {
        var e = new RLineEntity(doc,
            new RLineData(new RVector(x1, y1), new RVector(x2, y2)));
        e.setLayerId(doc.getLayerId(layer));
        CsTags.set(e, SS_TAG, isNull(kind) ? layer : kind);
        op.addObject(e, false);
        return e;
    };

    /** Paints one entity the magnetic arm's grey. The sheet's layers
     *  carry every other colour decision -- see CsLayers and the
     *  palette rule -- but both arms are ONE piece of furniture on one
     *  layer, and the whole point of the second is that it is not the
     *  first. Grey says "secondary" the way every compass rose on
     *  paper does, and Build Legend and Loop Errors colour entities
     *  the same way for the same kind of reason. */
    var greyed = function(entity) {
        try {
            entity.setColor(new RColor(CsSheetSetup.MAGNETIC_GREY[0],
                CsSheetSetup.MAGNETIC_GREY[1],
                CsSheetSetup.MAGNETIC_GREY[2]));
        } catch (eColor) {
            // a build that will not colour an entity still gets an arm
        }
        return entity;
    };

    var drew = [];

    // EACH FILE KEEPS ONE VIEW. The copy came from the record, which
    // holds both: a plan sheet that quietly carried the elevation off
    // the paper would plot it, and a profile sheet carrying the plan
    // would be a plan sheet with a border in the wrong place.
    var wrongFrame = elevationSheet ? "plan" : "profile";

    // A CHUNKED ELEVATION IS REDRAWN AT THE CAVER'S ARRANGEMENT before
    // anything below measures it, so the frame this sheet lays itself
    // out around is the one the caver actually dragged -- see
    // SheetSetup.buildChunkedElevation for why this regenerates rather
    // than translates.
    if (elevationSheet && opts.chunked === true && !isNull(opts.survey) &&
            !isNull(opts.resolved)) {
        SheetSetup.buildChunkedElevation(doc, di, opts.survey,
            opts.resolved, offsets, scale);
    }

    // A PROFILE SHEET IS LAID OUT AROUND THE ELEVATION, measured
    // BEFORE the plan is taken out -- the border goes round what this
    // sheet actually shows, and on this sheet that is the bands.
    if (elevationSheet) {
        var elevBox = SheetSetup.frameBox(doc, "profile");
        if (elevBox !== null) {
            caveBox = elevBox;
        }
    }
    var dropped = SheetSetup.eraseFrame(doc, di, wrongFrame);

    // THE SKETCH SCANS GO, ALWAYS. Not a checkbox: a scanned field
    // book page is a tracing reference, and everything worth keeping
    // off it has already been traced. See SheetSetup.eraseScans.
    var scansGone = SheetSetup.eraseScans(doc, di);

    // THE MARK GOES IN FIRST, in the same operation as everything else,
    // so a sheet cannot exist unmarked -- see Core/CsSheetFile.js. A
    // sheet is rebuilt from the record every time it is built, and the
    // mark is what stops a caver drawing work into something with a
    // demolition date on it.
    CsSheetFile.mark(doc, di);

    // ---- WHAT SHOWS ON THE SHEET ------------------------------------
    // The sheet's own elements (title block, scale bar, north arrow) are
    // BACKED WHITE: wherever the viewport has been slid over one, the map
    // underneath is cut away so the element reads clean (Nathan,
    // 2026-10-05: overlap is fine, give the elements a white background).
    // And on a tiled plan only THIS sheet's map area shows, so what
    // belongs to a neighbour does not print in the margin.
    //
    // CUT AWAY, not painted over: a CAD plot prints a white fill as black
    // (white is assumed to be the paper), which turned a margin solid
    // black when tried.
    var holes = [];
    var padH = unit(0.08);
    for (var hk in fur.pieces) {
        if (!fur.pieces.hasOwnProperty(hk)) { continue; }
        var hp = fur.pieces[hk];
        var hoff = CsSheetSetup.offsetOf(offsets, hk);
        var hx = box.minX + box.margin + unit(hp.x + hoff.x);
        var hy = box.minY + box.margin + unit(hp.y + hoff.y);
        holes.push({ minX: hx - padH, minY: hy - padH,
            maxX: hx + unit(hp.w) + padH, maxY: hy + unit(hp.h) + padH });
    }
    var clipped = SheetSetup.clipToMap(doc, op,
        tile !== null ? tile.map : null, holes);
    if (tile !== null && clipped.trimmed + clipped.dropped > 0) {
        drew.push("only its own part of the map (" + clipped.trimmed +
            " cut at the edge or round a title block, bar or arrow, " +
            clipped.dropped + " left out)");
    }

    if (wants.border === true) {
        line(box.minX, box.minY, box.maxX, box.minY, CsLayers.BORDER);
        line(box.maxX, box.minY, box.maxX, box.maxY, CsLayers.BORDER);
        line(box.maxX, box.maxY, box.minX, box.maxY, CsLayers.BORDER);
        line(box.minX, box.maxY, box.minX, box.minY, CsLayers.BORDER);
        drew.push("a border");
    }

    // ---- TILED: this sheet's name, and where each edge continues ----
    if (tile !== null) {
        // The match lines. Both sheets of a pair draw the SAME line (the
        // shared edge of their cores), dashed, in the border's colour.
        for (var mi = 0; mi < tile.matches.length; mi++) {
            var m = tile.matches[mi];
            var ml = line(m.x1, m.y1, m.x2, m.y2, CsLayers.BORDER,
                "matchline");
            try {
                ml.setLinetypeId(doc.getLinetypeId("DASHED"));
            } catch (eDash) {
            }
            // THE WORDS, along the line and on this sheet's own side of
            // it: "MATCH LINE - SEE SHEET B3". A vertical line is read
            // turned a quarter, bottom to top.
            var gap = unit(CsSheetSetup.TEXT.body * 1.2);
            var mx = (m.x1 + m.x2) / 2, my = (m.y1 + m.y2) / 2;
            var vertical = (m.edge === "E" || m.edge === "W");
            var tx = mx, ty = my, angle = 0;
            if (m.edge === "E") { tx = m.x1 - gap; angle = Math.PI / 2; }
            else if (m.edge === "W") { tx = m.x1 + gap; angle = Math.PI / 2; }
            else if (m.edge === "S") { ty = m.y1 + gap; }
            else { ty = m.y1 - gap; }
            var words = new RTextEntity(doc, new RTextData(
                new RVector(tx, ty), new RVector(tx, ty),
                unit(CsSheetSetup.TEXT.body),
                unit(CsSheetSetup.TITLE_INCHES * 4),
                RS.VAlignMiddle, RS.HAlignCenter, RS.LeftToRight, RS.Exact,
                1.0, CsDraw.caps(CsSheetTile.matchText(m.to)),
                "standard", false, false, angle, false));
            words.setLayerId(doc.getLayerId(CsLayers.BORDER));
            CsTags.set(words, SS_TAG, "matchline");
            op.addObject(words, false);
        }
        // This sheet's name, large, inside the border's top left corner.
        text(box.minX + box.margin * 1.2,
            box.maxY - box.margin * 1.5, CsSheetSetup.TEXT.caveName * 0.8,
            "SHEET " + tile.id, CsLayers.BORDER, "sheetid", false);
        drew.push("sheet " + tile.id + (tile.matches.length > 0 ?
            " with " + tile.matches.length + " match line" +
            (tile.matches.length === 1 ? "" : "s") : ""));
    }

    // The furniture sits inside the bottom margin, left to right:
    // title block, then the scale bar, then the north arrow. That is
    // the order a reader's eye takes them in, and it is the order the
    // NSS template's own reference sheet uses.
    var footY = box.minY + box.margin;
    var leftX = box.minX + box.margin;
    var titleOff = CsSheetSetup.offsetOf(offsets, "title");
    var barOff = CsSheetSetup.offsetOf(offsets, "bar");
    var northOff = CsSheetSetup.offsetOf(offsets, "north");

    if (titleHere) {
        // What each field will say: whatever the drawing already holds,
        // and the computed value only where the drawing holds nothing.
        //
        // NEVER OVERWRITE A HUMAN. A cartographer who wrote "Truitt
        // Cave System" does not want it replaced with the survey file's
        // "TRUITT" on the next run -- so a re-run refreshes the numbers
        // and leaves the wording alone.
        // WRAPPED, and stacked UPWARD from the bottom margin. Truitt
        // Cave credits twenty-one surveyors: unwrapped they came out as
        // one text entity that wrapped inside itself and printed over
        // the six lines below it, and stacked downward from the margin
        // the whole block ran off the paper. Both were seen on the
        // first live run.
        var values = titleValues;
        var lines = titleLines;
        var titleX = leftX + unit(fur.pieces.title.x) + unit(titleOff.x);
        var y = box.minY + box.margin + unit(fur.pieces.title.y) +
            unit(CsSheetSetup.linesHeight(lines)) + unit(titleOff.y);
        for (var n = 0; n < lines.length; n++) {
            var t = text(titleX, y, lines[n].inches, lines[n].text,
                CsLayers.TITLE_BLOCK);
            if (lines[n].fieldId !== "") {
                CsTags.set(t, CsSheet.TAG, lines[n].fieldId);
                // The whole value, so a re-run can read back what it
                // wrote rather than the first line of it.
                CsTags.set(t, CsSheetSetup.TAG_FULL,
                    isNull(values[lines[n].fieldId]) ? "" :
                        String(values[lines[n].fieldId]));
            }
            y -= unit(lines[n].inches * CsSheetSetup.LINE_SPACING);
        }
        // WHICH VIEW THIS SHEET IS, said on the sheet. A reader
        // holding the profile sheet on its own has to know, and the
        // plan sheet says it too rather than leaving "the one without
        // the words on it" as the way to tell them apart.
        text(titleX, y, CsSheetSetup.TEXT.heading,
            elevationSheet ? "EXTENDED ELEVATION" : "PLAN",
            CsLayers.TITLE_BLOCK);
        drew.push("a title block");
    }

    if (wants.bar === true) {
        var bar = CsSheetSetup.barFor(scale);
        var barX = leftX + unit(fur.pieces.bar.x) + unit(barOff.x);
        // lifted so its numbers, which hang below the line, stay above
        // the bottom margin
        var barY = footY + unit(fur.pieces.bar.y + CsSheetSetup.BAR_LIFT) +
            unit(barOff.y);
        // The bar's LENGTH comes from its own feet, not from three
        // inches of paper: a metric bar is a round number of METRES,
        // which is very nearly three inches and not exactly. One block
        // spans perBlockFeet of cave, and perFoot turns that into
        // drawing units.
        var blockW = bar.perBlockFeet * perFoot;
        var barH = unit(CsSheetSetup.BAR.height);
        for (var b = 0; b <= bar.blocks; b++) {
            var x = barX + blockW * b;
            line(x, barY, x, barY + barH, CsLayers.SCALE_BAR);
            text(x, barY - unit(CsSheetSetup.BAR.tick * 2),
                CsSheetSetup.TEXT.small, String(bar.perBlock * b),
                CsLayers.SCALE_BAR);
        }
        line(barX, barY, barX + blockW * bar.blocks, barY,
            CsLayers.SCALE_BAR);
        line(barX, barY + barH, barX + blockW * bar.blocks, barY + barH,
            CsLayers.SCALE_BAR);
        text(barX, barY + barH + unit(CsSheetSetup.TEXT.body),
            CsSheetSetup.TEXT.body, CsSheetSetup.scaleText(scale),
            CsLayers.SCALE_BAR);
        text(barX + blockW * bar.blocks + unit(0.1),
            barY - unit(CsSheetSetup.BAR.tick * 2),
            CsSheetSetup.TEXT.small, bar.unit, CsLayers.SCALE_BAR);
        drew.push("a scale bar in " + bar.perBlock + " " +
            bar.unit.toLowerCase() + " steps");
    }

    // NO NORTH ARROW ON A PROFILE SHEET. An elevation has no north --
    // the layer registry says so in its own way by refusing
    // NORTH-ARROW a per-view twin -- and an arrow here would answer a
    // question the drawing cannot be asked.
    if (wants.north === true && !elevationSheet) {
        var arrow = CsSheetSetup.NORTH;
        // THE PIN IS PLACED BY THE PIECE'S REAL REACH, captions and
        // magnetic arm included, so the whole arrow sits inside the
        // margin -- see CsSheetSetup.northExtent.
        var np = fur.pieces.north;
        var nx = leftX + unit(np.x + np.pinX) + unit(northOff.x);
        var ny = footY + unit(np.y + np.pinY) + unit(northOff.y);
        var nh = unit(arrow.height);
        line(nx, ny, nx, ny + nh, CsLayers.NORTH_ARROW);
        line(nx, ny + nh, nx - unit(arrow.headHalf),
            ny + nh - unit(arrow.headLength), CsLayers.NORTH_ARROW);
        line(nx, ny + nh, nx + unit(arrow.headHalf),
            ny + nh - unit(arrow.headLength), CsLayers.NORTH_ARROW);
        text(nx - unit(0.09), ny + nh + unit(0.28),
            CsSheetSetup.TEXT.heading, "N", CsLayers.NORTH_ARROW);
        // WHICH north, said out loud. The suite rotates the survey by
        // the declination as it draws, so what is on the sheet is TRUE
        // north -- and a reader who assumes otherwise is out by
        // degrees. The declination is printed as the evidence.
        var reading = CsSheetSetup.latestDeclination(read.survey);
        var decl = "";
        if (!isNull(reading) && reading.declination !== 0) {
            decl = "  (DECLINATION " +
                Number(reading.declination).toFixed(1) + "° APPLIED)";
        }
        text(nx - unit(0.9), ny - unit(0.2), CsSheetSetup.TEXT.small,
            "TRUE NORTH" + decl, CsLayers.NORTH_ARROW);
        if (!isNull(reading)) {
            // UNDER the true north line, not out beside the arm: the
            // arrow lives at the right margin, and a caption drawn to
            // the right of a magnetic tip runs straight off the paper.
            greyed(text(nx - unit(0.9),
                ny - unit(0.2 + CsSheetSetup.TEXT.small * 2),
                CsSheetSetup.TEXT.small,
                CsSheetSetup.magneticText(reading),
                CsLayers.NORTH_ARROW));
        }

        // MAGNETIC NORTH, ON THE SAME PIN (Nathan, 2026-09-14). One
        // arrow with two arms, sharing an origin and the north arrow's
        // own layer and tag: it is one piece of furniture, it moves as
        // one when the arrow is dragged, and a reader takes the angle
        // between the arms as the declination because that is exactly
        // what it is. A separate symbol somewhere else on the sheet
        // would be a second thing to place and a second thing to get
        // out of step.
        if (!isNull(reading)) {
            var mag = CsSheetSetup.magneticUnit(reading.declination);
            var mh = unit(arrow.magneticHeight);
            var tipX = nx + mag.x * mh;
            var tipY = ny + mag.y * mh;
            greyed(line(nx, ny, tipX, tipY, CsLayers.NORTH_ARROW));
            // The head, built in the arm's own frame and rotated with
            // it: a head drawn square to the page leans wrong the
            // moment the declination is anything but zero.
            var back = unit(arrow.magneticHeadLength);
            var half = unit(arrow.magneticHeadHalf);
            var bx = tipX - mag.x * back, by = tipY - mag.y * back;
            greyed(line(tipX, tipY, bx - mag.y * half,
                by + mag.x * half, CsLayers.NORTH_ARROW));
            greyed(line(tipX, tipY, bx + mag.y * half,
                by - mag.x * half, CsLayers.NORTH_ARROW));
            // "mN", in the case it is written in: a lower-case m for
            // magnetic beside the capital N, which is how a compass
            // rose tells the two apart in one glyph. keepCase, because
            // everything else on a sheet is drawn through CsDraw.caps
            // and capitals here would just be the true arrow's label
            // again.
            greyed(text(tipX + mag.x * unit(0.12) - unit(0.06),
                tipY + unit(0.18), CsSheetSetup.TEXT.small, "mN",
                CsLayers.NORTH_ARROW, null, true));
            drew.push("a north arrow with magnetic north at " +
                Number(reading.declination).toFixed(1) + "°" +
                (reading.date === "" ? "" : " (" + reading.date + ")"));
        } else {
            drew.push("a north arrow");
        }
    }

    di.applyOperation(op);

    return "Sheet Setup: " + drew.join(", ") +
        " at 1\" = " + scale + " ft on " + sheet.name +
        (fit.turned ? " (turned)" : "") +
        (cleared > 0 ? " -- the previous sheet was replaced" : "") +
        (dropped > 0 ? (" " + dropped + " " + wrongFrame +
            "-frame entities left out.") : "") +
        (scansGone > 0 ? (" " + scansGone + " image" +
            (scansGone === 1 ? "" : "s") + " left out -- a sheet is " +
            "plotted, and a scan is something you trace from.") : "") +
        " Nothing was written into the location line; type that one " +
        "yourself.";
};

/**
 * Redraws a chunked elevation into (doc, di) at the caver's chosen
 * per-chunk arrangement, in place of whatever chunked geometry the
 * sheet copy already carries.
 *
 * REGENERATED, NOT TRANSLATED. A tie line between two chunks is one
 * entity spanning both chunks' real coordinates, filed under a single
 * chunk's ProfileRun tag (Core/CsProfileDraw.js, CsProfileDraw.render's
 * tie loop) -- moving one chunk's entities by that tag would drag the
 * WHOLE tie with it, stranding the end belonging to the chunk that did
 * not move. This calls the same build+render pipeline Generate Profile
 * already uses on the live drawing, so every tie is computed fresh
 * from each chunk's TRUE final position.
 *
 * \param offsets {"band:<key>": {x, y}} in INCHES OF PAPER, the shape
 *        CsSheetSetup.offsetOf reads everywhere else in this file.
 * \param scale   feet of cave per inch of paper -- what a chunk's
 *        inches-of-paper drag is converted through to reach the
 *        drawing units CsProfile.build's own offsets are in.
 */
SheetSetup.buildChunkedElevation = function(doc, di, survey, resolved,
        offsets, scale) {
    if (isNull(survey) || isNull(resolved)) {
        return null;
    }
    var perFoot = CsShapeLine.perFoot(doc);
    var chunkOffsets = {};
    var k;
    for (k in offsets) {
        if (!offsets.hasOwnProperty(k) || k.indexOf("band:") !== 0) {
            continue;
        }
        var off = CsSheetSetup.offsetOf(offsets, k);
        // inches of paper -> feet of cave (the scale) -> drawing units
        // (perFoot) -- the same two-step conversion CsSheetSetup.preview's
        // own `add()` closure and SheetSetup.draw's `unit()` already do.
        chunkOffsets[k.substring("band:".length)] =
            off.x * scale * perFoot;
    }
    var profileSettings = CsProfile.settings();
    var profile = CsProfile.build(survey, resolved,
        { flatSplayDeg: profileSettings.flatSplayDeg,
          offsets: chunkOffsets });
    SheetSetup.eraseFrame(doc, di, "profile");
    CsProfileDraw.render(doc, di, profile, {});
    return profile;
};

/** The extents of one frame's own content, or null. */
SheetSetup.frameBox = function(doc, frame) {
    var box = null;
    var ids = SheetSetup.modelIds(doc);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || CsTags.get(e, SS_TAG) !== "") {
            continue;
        }
        var layer = CsBind.layerNameOf(doc, e);
        if (CsLayers.frameOf(layer) !== frame) {
            continue;
        }
        // The band BOXES describe the region rather than being drawn
        // in it, and they are exactly the outline a border should sit
        // outside of -- so they count.
        var b = null;
        try {
            b = e.getBoundingBox();
        } catch (eBox) {
            b = null;
        }
        if (isNull(b)) {
            continue;
        }
        var mn = b.getMinimum(), mx = b.getMaximum();
        if (!isFinite(mn.x) || !isFinite(mx.x)) {
            continue;
        }
        if (box === null) {
            box = { minX: mn.x, minY: mn.y, maxX: mx.x, maxY: mx.y };
        } else {
            box.minX = Math.min(box.minX, mn.x);
            box.minY = Math.min(box.minY, mn.y);
            box.maxX = Math.max(box.maxX, mx.x);
            box.maxY = Math.max(box.maxY, mx.y);
        }
    }
    return box;
};

/**
 * Takes the sketch scans out of the sheet copy.
 *
 * SCANS NEVER REACH A SHEET (Nathan, 2026-09-10). A scanned field book
 * page is a TRACING REFERENCE: it is under the drawing so a
 * cartographer can follow it, and every line worth keeping has already
 * been traced off it. On a sheet it is a photograph of somebody's
 * handwriting printed under the map -- and on Truitt Cave that is
 * forty-two of them, most of a megabyte of raster, in a file whose
 * whole job is to be plotted.
 *
 * All three frames: the plan's scans, the elevation's, and the ones
 * inside a section bay. The layer IS the definition -- CsScanFrame
 * gives each frame its own scan layer precisely so a sweep like this
 * can be exact -- so this takes everything on them rather than
 * guessing at images by type. Anything a caver has put there is a scan
 * or is on the wrong layer.
 *
 * \return how many entities went.
 */
SheetSetup.SCAN_LAYERS = function() {
    return [CsLayers.CTRL_SCAN, CsLayers.CTRL_PROFILE_SCAN,
        CsLayers.CTRL_SECTION_SCAN];
};

SheetSetup.eraseScans = function(doc, di) {
    var layers = SheetSetup.SCAN_LAYERS();
    var wanted = {};
    for (var l = 0; l < layers.length; l++) {
        wanted[layers[l]] = true;
    }
    var gone = 0;
    // EVERY LAYER, because the scan layers are not enough. Two of
    // Truitt Cave's forty-two scans sit on layer 0 -- placed before the
    // suite's own alignment tools existed, or dragged in by hand -- and
    // a rule that trusts the layer let exactly those two through onto
    // the sheet. So the rule is the ENTITY: a sheet carries no raster
    // at all.
    //
    // That takes the aerial photograph with them, which is right twice
    // over: nobody asked a plotted cave map to carry surface imagery,
    // and an aerial is georeferenced -- it is the cave's location baked
    // into a picture, on a file made to be handed to people.
    var everyLayer = [];
    try {
        var layerIds = doc.queryAllLayers();
        for (var q = 0; q < layerIds.length; q++) {
            var lay = doc.queryLayer(layerIds[q]);
            if (!isNull(lay) && CsLayers.refusesEdits(lay)) {
                everyLayer.push(String(lay.getName()));
            }
        }
    } catch (eLayers) {
        everyLayer = layers;
    }
    // A caver may well have switched a scan layer off to see the map
    // underneath -- and an off layer refuses deletes in silence.
    CsLayers.withLayersOn(doc, di, everyLayer, function() {
        var op = new RDeleteObjectsOperation();
        var ids = doc.queryAllEntities(false, true);
        for (var i = 0; i < ids.length; i++) {
            var e = doc.queryEntity(ids[i]);
            if (isNull(e)) {
                continue;
            }
            var isRaster = false;
            try {
                isRaster = (e.getType() === RS.EntityImage);
            } catch (eType) {
                isRaster = false;
            }
            if (!isRaster &&
                    wanted[CsBind.layerNameOf(doc, e)] !== true) {
                continue;
            }
            op.deleteObject(e);
            gone += 1;
        }
        if (gone > 0) {
            di.applyOperation(op);
        }
    });
    return gone;
};

/**
 * Takes the extended elevation out of the sheet copy entirely.
 *
 * EVERY profile-frame layer, plus the band boxes that describe them:
 * what is left has to be a drawing of the plan, not a drawing of the
 * plan with an elevation parked off the paper. Only ever called on the
 * COPY -- the record keeps its elevation, which is where the elevation
 * belongs.
 *
 * \return how many entities went.
 */
SheetSetup.eraseFrame = function(doc, di, frame) {
    var op = new RDeleteObjectsOperation();
    var gone = 0;
    var locked = [];
    try {
        var layerIds = doc.queryAllLayers();
        for (var l = 0; l < layerIds.length; l++) {
            var lay = doc.queryLayer(layerIds[l]);
            if (!isNull(lay) && CsLayers.refusesEdits(lay)) {
                locked.push(String(lay.getName()));
            }
        }
    } catch (eLayers) {
    }
    // OFF, FROZEN **AND LOCKED**. Three separate ways a layer refuses
    // an edit in silence, and the band boxes manage two of them: they
    // live on CTRL-PROFILE-BOX, which the registry ships LOCKED, and
    // the first version of this cleared only off and frozen. Sixteen
    // band boxes survived into a sheet built with the elevation
    // unticked -- invisible, on a hidden layer, and enough to make the
    // next Generate Profile think the elevation was still there.
    CsLayers.withLayersOn(doc, di, locked, function() {
        CsLayers.withLayerUnlocked(doc, di, CsLayers.CTRL_PROFILE_BOX,
                function() {
            var ids = doc.queryAllEntities(false, true);
            for (var i = 0; i < ids.length; i++) {
                var e = doc.queryEntity(ids[i]);
                if (isNull(e)) {
                    continue;
                }
                var layer = CsBind.layerNameOf(doc, e);
                if (CsLayers.frameOf(layer) !== frame) {
                    continue;
                }
                op.deleteObject(e);
                gone += 1;
            }
            if (gone > 0) {
                di.applyOperation(op);
            }
        });
    });
    return gone;
};

/**
 * Slides the whole extended elevation onto the elevation sheet.
 *
 * \return how many bands moved, or 0 when there was nothing to move.
 */
SheetSetup.moveElevation = function(doc, di, sheetBox) {
    var boxes;
    try {
        boxes = CsProfileBox.boxes(doc);
    } catch (eBoxes) {
        return 0;
    }
    if (isNull(boxes) || boxes.length === 0) {
        return 0;
    }
    var minX = null, maxY = null;
    for (var i = 0; i < boxes.length; i++) {
        if (minX === null || boxes[i].minX < minX) { minX = boxes[i].minX; }
        if (maxY === null || boxes[i].maxY > maxY) { maxY = boxes[i].maxY; }
    }
    var inset = (sheetBox.maxX - sheetBox.minX) *
        CsSheetSetup.BAND_INSET_FRACTION;
    var dx = (sheetBox.minX + inset) - minX;
    var dy = (sheetBox.maxY - inset) - maxY;
    if (Math.abs(dx) < 0.0001 && Math.abs(dy) < 0.0001) {
        return boxes.length;   // already there
    }
    try {
        CsProfileDraw.translateRegion(doc, di, dx, dy);
    } catch (eMove) {
        return 0;
    }
    return boxes.length;
};

// ============================================================
// Add-on wiring -- the standard pattern; see docs.
// ============================================================

SheetSetup.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);

    try {
        var dock = SheetSetup.ensureDock();
        // Always opens and always re-reads: a caver reaching for this
        // wants to look at the layout, and toggling it shut on a second
        // press would make "show me again" a two-click gesture whose
        // first click hides the answer. Same rule as Check Map.
        dock.visible = true;
        SheetSetup.refresh();
    } catch (e) {
        // Forget the dock ONLY if it was never built. Forgetting a live
        // one because refresh() threw made the next press build a
        // second panel beside it.
        if (isNull(dock)) {
            csSheetSetupDock = undefined;
        }
        EAction.handleUserWarning("Sheet Setup: this CaveCAD build refused the docked " +
            "panel (" + e + ") -- please report this.");
    }

    this.terminate();
};

SheetSetup.init = function(basePath) {
    var action = new RGuiAction(qsTr("Sheet Setup"),
        RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    // THE APPLICATION'S SCRIPT ENGINE, NOT THE TAB'S. Without this QCAD
    // runs beginEvent in the active document's OWN engine, where the dock
    // globals start empty: opening the panel from a second tab built a
    // second panel, and closing that tab left one wired to a dead engine
    // -- buttons that do nothing, and Sheet Setup's preview crashing
    // CaveCAD on hover (Nathan, 2026-09-27). Stock Print Preview uses the
    // same flag. tests/test_addon.py enforces it for every panel opener.
    action.setForceGlobal(true);
    action.setScriptFile(basePath + "/SheetSetup.js");
    action.setIcon(basePath + "/SheetSetup.svg");
    action.setStatusTip(qsTr("Border, scale bar, north arrow and a " +
        "title block, all at the plot scale you choose"));
    action.setDefaultCommands(["sheetsetup", "sheet"]);
    SheetSetup.basePath = basePath;
    // FIRST in stage 5: the sheet is what the rest of this stage
    // decorates, and a legend placed before there is a sheet to place
    // it on lands in the middle of the cave.
    action.setGroupSortOrder(454);
    action.setSortOrder(5);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);

    // Built during init like the suite's other docks: the main window's
    // restoreState() runs after this and can only place a dock that
    // already exists. Hidden until the menu entry shows it.
    try {
        var dock = SheetSetup.ensureDock();
        dock.visible = false;
    } catch (eInit) {
        csSheetSetupDock = undefined;
        warning("Sheet Setup: could not build the panel at startup (" +
            eInit + "); the menu entry will try again.");
    }
};
