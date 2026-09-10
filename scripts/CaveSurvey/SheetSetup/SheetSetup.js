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
SheetSetup.caveBox = function(doc) {
    var box = null;
    var ids = doc.queryAllEntities(false, false);
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
    try {
        var ids = doc.queryAllEntities(false, false);
        for (var i = 0; i < ids.length; i++) {
            var e = doc.queryEntity(ids[i]);
            if (isNull(e) || CsTags.get(e, CsSheet.TAG) !== field.id) {
                continue;
            }
            var whole = CsTags.get(e, CsSheetSetup.TAG_FULL);
            if (whole !== "") {
                return whole;
            }
        }
    } catch (eWhole) {
        // fall through to what the sheet shows
    }
    try {
        return CsSheet.readField(doc, field);
    } catch (eRead) {
        return "";
    }
};

/** The survey, its stats and its grade -- or nulls, for a drawing with
 *  no survey in it yet. A sheet is still worth building on a drawing
 *  that has only tracing on it; it just cannot fill in the numbers. */
SheetSetup.readSurvey = function(doc) {
    var out = { survey: null, stats: null, grade: null };
    try {
        var asDrawn = CsRevise.resolveAsDrawn(doc);
        if (isNull(asDrawn)) {
            return out;
        }
        out.survey = asDrawn.survey;
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

/** How the preview paints each kind of box. */
SheetSetup.PREVIEW_STYLE = {
    "sheet": { line: [70, 70, 70], fill: [255, 255, 255], width: 2 },
    "elevation-sheet": { line: [70, 70, 70], fill: [255, 255, 255],
        width: 2 },
    "cave": { line: [40, 90, 190], fill: [40, 90, 190, 40], width: 1 },
    "band": { line: [40, 90, 190], fill: [40, 90, 190, 40], width: 1 },
    "title": { line: [150, 100, 30], fill: [220, 170, 70, 90], width: 1 },
    "bar": { line: [60, 130, 60], fill: [90, 180, 90, 110], width: 1 },
    "north": { line: [60, 130, 60], fill: [90, 180, 90, 110], width: 1 }
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
            var style = SheetSetup.PREVIEW_STYLE[item.kind];
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
            painter.setPen(pen);
            painter.setBrush(new QBrush(new QColor(style.fill[0],
                style.fill[1], style.fill[2],
                style.fill.length > 3 ? style.fill[3] : 255)));
            painter.drawRect(x, y, Math.max(w, 1), Math.max(h, 1));
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
        titleLines: [], footerInches: 0 };
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
    var perFoot = CsShapeLine.perFoot(doc);
    state.caveW = (state.caveBox.maxX - state.caveBox.minX) / perFoot;
    state.caveH = (state.caveBox.maxY - state.caveBox.minY) / perFoot;

    var read = SheetSetup.readSurvey(doc);
    state.survey = read.survey;
    state.filled = CsSheetSetup.autoFill(read.survey, read.stats,
        read.grade);
    state.titleLines = CsSheetSetup.titleLines(
        SheetSetup.titleValues(doc, state.filled));
    state.footerInches = Math.max(
        CsSheetSetup.linesHeight(state.titleLines) + 0.4,
        CsSheetSetup.BAR.height + CsSheetSetup.TEXT.body * 4);
    state.hasElevation = SheetSetup.hasElevation(doc);
    if (state.hasElevation) {
        try {
            state.bands = CsProfileBox.boxes(doc);
        } catch (eBands) {
            state.bands = [];
        }
    }
    state.ok = true;
    return state;
};

SheetSetup.buildDock = function(appWin) {
    var dock = new QDockWidget(qsTr("Sheet Setup"), appWin);
    dock.objectName = "CaveSurveySheetSetupDock";

    var w = { state: null, quiet: false };
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
    form.addWidget(new QLabel(qsTr("Paper:")), 0, 0);
    form.addWidget(w.sheetCombo, 0, 1);

    w.scaleCombo = new QComboBox();
    for (var c = 0; c < CsSheetSetup.SCALES.length; c++) {
        w.scaleCombo.addItem("1\" = " + CsSheetSetup.SCALES[c] + " ft");
    }
    form.addWidget(new QLabel(qsTr("Plot scale:")), 1, 0);
    form.addWidget(w.scaleCombo, 1, 1);
    layout.addLayout(form, 0);

    w.fitLabel = new QLabel("");
    w.fitLabel.wordWrap = true;
    layout.addWidget(w.fitLabel, 0, 0);

    w.preview = new QLabel("");
    try {
        w.preview.setMinimumHeight(150);
        w.preview.alignment = Qt.AlignCenter;
    } catch (ePrev) {
    }
    layout.addWidget(w.preview, 1, 0);

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
    w.refreshButton = new QPushButton(qsTr("Re-read Drawing"));
    w.refreshButton.toolTip = qsTr("Measure the cave again -- after " +
        "another trip, or after tracing more of it.");
    row.addWidget(w.refreshButton, 0, 0);
    layout.addLayout(row, 0);

    body.setLayout(layout);
    dock.setWidget(body);
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
    w.buildButton.clicked.connect(function() { SheetSetup.build(); });
    w.refreshButton.clicked.connect(function() { SheetSetup.refresh(); });

    return dock;
};

/** The paper's most detailed standard scale, chosen for the caver. */
SheetSetup.suggestScale = function() {
    var w = SheetSetup.widgets;
    if (isNull(w) || isNull(w.state) || w.state.ok !== true) {
        return;
    }
    var sheet = CsSheetSetup.sheetByName(String(w.sheetCombo.currentText));
    var fit = CsSheetSetup.fit(w.state.caveW, w.state.caveH, sheet,
        w.state.footerInches);
    var at = CsSheetSetup.SCALES.indexOf(fit.scale);
    var was = w.quiet;
    w.quiet = true;
    w.scaleCombo.currentIndex = at < 0 ? 0 : at;
    w.quiet = was;
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
};

/** Redraws the picture and the words under it. */
SheetSetup.repaint = function() {
    var w = SheetSetup.widgets;
    if (isNull(w) || isNull(w.state)) {
        return;
    }
    if (w.state.ok !== true) {
        w.fitLabel.text = w.state.why;
        w.note.text = "";
        w.buildButton.enabled = false;
        return;
    }
    var sheet = CsSheetSetup.sheetByName(String(w.sheetCombo.currentText));
    var scale = CsSheetSetup.SCALES[w.scaleCombo.currentIndex];
    var fit = CsSheetSetup.fit(w.state.caveW, w.state.caveH, sheet,
        w.state.footerInches);

    var preview = CsSheetSetup.preview({
        caveBox: w.state.caveBox, sheet: sheet, scale: scale,
        turned: fit.turned, footerInches: w.state.footerInches,
        wants: { border: w.cbBorder.checked, bar: w.cbBar.checked,
            north: w.cbNorth.checked, title: w.cbTitle.checked },
        elevation: w.cbElevation.checked === true,
        bands: w.state.bands
    });
    var pixmap = SheetSetup.paintPreview(preview,
        Math.max(200, w.preview.width - 8), 150);
    if (pixmap !== null) {
        w.preview.pixmap = pixmap;
    }

    var spill = CsSheetSetup.previewFits(preview);
    w.fitLabel.text = qsTr("The plan measures %1 x %2 ft.")
        .arg(Math.round(w.state.caveW)).arg(Math.round(w.state.caveH)) +
        "  " + (fit.fits ?
            qsTr("Fits at 1\" = %1 ft").arg(fit.scale) +
                (fit.turned ? qsTr(", paper turned.") : ".") :
            qsTr("It does not fit this paper at any standard scale."));
    // THE SPILL IS THE POINT OF THE PICTURE. Everything else the panel
    // says could be worked out; this is the one thing a caver would
    // otherwise learn by building the file and looking at it.
    w.note.text = spill.fits ?
        qsTr("Everything sits on the paper.") :
        qsTr("Off the paper: %1. Try a smaller scale or bigger paper.")
            .arg(spill.spilling.join(", "));
    w.buildButton.enabled = (w.state.recordPath !== "");
    if (w.state.recordPath === "") {
        w.buildButton.toolTip = qsTr("Save this drawing first -- the " +
            "sheet is written beside it, and an unsaved drawing has " +
            "nowhere to put one.");
    }
};

/** Builds the file. */
SheetSetup.build = function() {
    var w = SheetSetup.widgets;
    if (isNull(w) || isNull(w.state) || w.state.ok !== true) {
        return;
    }
    var doc = null;
    try {
        doc = EAction.getDocument();
    } catch (eDoc) {
        doc = null;
    }
    if (!isNull(doc) && doc.isModified() === true) {
        warning(qsTr("Sheet Setup: save this drawing first.\n" +
            "The sheet is built from the FILE on disk, so anything " +
            "not yet saved would be missing from it."));
        return;
    }
    var sheet = CsSheetSetup.sheetByName(String(w.sheetCombo.currentText));
    var scale = CsSheetSetup.SCALES[w.scaleCombo.currentIndex];
    var fit = CsSheetSetup.fit(w.state.caveW, w.state.caveH, sheet,
        w.state.footerInches);
    EAction.handleUserMessage(SheetSetup.intoCopy(w.state.recordPath, {
        caveBox: w.state.caveBox, sheet: sheet, scale: scale,
        turned: fit.turned,
        wants: { border: w.cbBorder.checked, bar: w.cbBar.checked,
            north: w.cbNorth.checked, title: w.cbTitle.checked },
        filled: w.state.filled, survey: w.state.survey,
        elevation: w.cbElevation.checked === true
    }));
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
    var folder = CsCave.folderOf(recordPath);
    var caveName = CsCave.nameOf(recordPath);
    if (isNull(folder) || folder === "") {
        return "Sheet Setup: could not work out which folder " +
            recordPath + " lives in, so there is nowhere to put the " +
            "sheet.";
    }
    var target = CsSheetSetup.sheetPathFor(folder, caveName);
    try {
        (new QDir("/")).mkpath(folder + "/" +
            CsSheetSetup.SHEETS_FOLDER);
    } catch (eDir) {
    }

    var di = new RDocumentInterface(
        new RDocument(new RMemoryStorage(), createSpatialIndex()));
    var said = "";
    try {
        if (di.importFile(recordPath, "", false) !==
                RDocumentInterface.IoErrorNoError) {
            return "Sheet Setup: could not read " + recordPath + ".";
        }
        said = SheetSetup.draw(di.getDocument(), di, opts);
        if (!di.exportFile(target, CsSanitize.dxfFilter())) {
            return "Sheet Setup: could not write " + target + ".";
        }
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

    try {
        // Opened for the caver, because a sheet they cannot see is a
        // sheet they will assume did not happen.
        //
        // openFiles(), the global QCAD itself opens drawings with --
        // NOT mainWindow.openFile(), which does not exist in this
        // build (probed live, 2026-09-10: every plausible spelling on
        // the main window came back undefined). Cave Shelf opens a cave
        // the same way.
        openFiles([target], false);
    } catch (eOpen) {
        return said + " Written to " + target + " -- open it from " +
            "there; your own drawing was not touched.";
    }
    return said + " Written to " + target + " -- your own drawing was " +
        "not touched.";
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
    var footerInches = Math.max(
        CsSheetSetup.linesHeight(titleLines) + 0.4,
        CsSheetSetup.BAR.height + CsSheetSetup.TEXT.body * 4);
    var box = CsSheetSetup.borderBox(caveBox, sheet, scale, fit.turned,
        footerInches);
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

    var unit = function(inches) {
        return CsSheetSetup.atScale(inches, scale) * perFoot;
    };
    var text = function(x, y, inches, label, layer, kind) {
        var height = unit(inches);
        // The wrap width is generous on purpose: the lines are wrapped
        // by CsSheetSetup.titleLines before they get here, and a narrow
        // width would wrap them a SECOND time inside the entity, which
        // is what put twenty-one surveyors on top of six other fields.
        var e = new RTextEntity(doc, new RTextData(
            new RVector(x, y), new RVector(x, y), height,
            unit(CsSheetSetup.TITLE_INCHES * 4),
            RS.VAlignMiddle, RS.HAlignLeft, RS.LeftToRight, RS.Exact,
            1.0, CsDraw.caps(label), "standard", false, false, 0.0, false));
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

    var drew = [];

    if (wants.border === true) {
        line(box.minX, box.minY, box.maxX, box.minY, CsLayers.BORDER);
        line(box.maxX, box.minY, box.maxX, box.maxY, CsLayers.BORDER);
        line(box.maxX, box.maxY, box.minX, box.maxY, CsLayers.BORDER);
        line(box.minX, box.maxY, box.minX, box.minY, CsLayers.BORDER);
        drew.push("a border");
    }

    // The furniture sits inside the bottom margin, left to right:
    // title block, then the scale bar, then the north arrow. That is
    // the order a reader's eye takes them in, and it is the order the
    // NSS template's own reference sheet uses.
    var footY = box.minY + box.margin * 0.55;
    var leftX = box.minX + box.margin;

    if (wants.title === true) {
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
        var y = box.minY + box.margin * 0.35 +
            unit(CsSheetSetup.linesHeight(lines));
        for (var n = 0; n < lines.length; n++) {
            var t = text(leftX, y, lines[n].inches, lines[n].text,
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
        drew.push("a title block");
    }

    if (wants.bar === true) {
        var bar = CsSheetSetup.barFor(scale);
        var barX = box.minX + box.width * 0.45;
        var blockW = unit(CsSheetSetup.BAR.length) / bar.blocks;
        var barH = unit(CsSheetSetup.BAR.height);
        for (var b = 0; b <= bar.blocks; b++) {
            var x = barX + blockW * b;
            line(x, footY, x, footY + barH, CsLayers.SCALE_BAR);
            text(x, footY - unit(CsSheetSetup.BAR.tick * 2),
                CsSheetSetup.TEXT.small, String(bar.perBlock * b),
                CsLayers.SCALE_BAR);
        }
        line(barX, footY, barX + blockW * bar.blocks, footY,
            CsLayers.SCALE_BAR);
        line(barX, footY + barH, barX + blockW * bar.blocks, footY + barH,
            CsLayers.SCALE_BAR);
        text(barX, footY + barH + unit(CsSheetSetup.TEXT.body),
            CsSheetSetup.TEXT.body, CsSheetSetup.scaleText(scale),
            CsLayers.SCALE_BAR);
        text(barX + blockW * bar.blocks + unit(0.1),
            footY - unit(CsSheetSetup.BAR.tick * 2),
            CsSheetSetup.TEXT.small, "FT", CsLayers.SCALE_BAR);
        drew.push("a scale bar in " + bar.perBlock + " ft steps");
    }

    if (wants.north === true) {
        var nx = box.maxX - box.margin;
        var ny = footY;
        var nh = unit(1.4);
        line(nx, ny, nx, ny + nh, CsLayers.NORTH_ARROW);
        line(nx, ny + nh, nx - unit(0.18), ny + nh - unit(0.4),
            CsLayers.NORTH_ARROW);
        line(nx, ny + nh, nx + unit(0.18), ny + nh - unit(0.4),
            CsLayers.NORTH_ARROW);
        text(nx - unit(0.09), ny + nh + unit(0.28),
            CsSheetSetup.TEXT.heading, "N", CsLayers.NORTH_ARROW);
        // WHICH north, said out loud. The suite rotates the survey by
        // the declination as it draws, so what is on the sheet is TRUE
        // north -- and a reader who assumes otherwise is out by
        // degrees. The declination is printed as the evidence.
        var decl = "";
        if (!isNull(read.survey) && !isNull(read.survey.trips) &&
                read.survey.trips.length > 0) {
            var d = read.survey.trips[0].declination;
            if (!isNull(d) && isFinite(d) && d !== 0) {
                decl = "  (DECLINATION " + Number(d).toFixed(1) +
                    "° APPLIED)";
            }
        }
        text(nx - unit(0.9), ny - unit(0.2), CsSheetSetup.TEXT.small,
            "TRUE NORTH" + decl, CsLayers.NORTH_ARROW);
        drew.push("a north arrow");
    }

    // ---- sheet two: the extended elevation ---------------------------
    //
    // ITS OWN SHEET, at the SAME scale. A map carrying two scales is a
    // lie, and a cave whose plan fits the paper at 1" = 40 rarely has
    // room left for eight elevation bands beside it. See
    // CsSheetSetup.elevationSheetBox for why the alternatives were
    // rejected.
    var elevation = null;
    if (opts.elevation === true) {
        elevation = CsSheetSetup.elevationSheetBox(box, scale);

        line(elevation.minX, elevation.minY, elevation.maxX, elevation.minY,
            CsLayers.BORDER, CsSheetSetup.ELEVATION_SHEET);
        line(elevation.maxX, elevation.minY, elevation.maxX, elevation.maxY,
            CsLayers.BORDER, CsSheetSetup.ELEVATION_SHEET);
        line(elevation.maxX, elevation.maxY, elevation.minX, elevation.maxY,
            CsLayers.BORDER, CsSheetSetup.ELEVATION_SHEET);
        line(elevation.minX, elevation.maxY, elevation.minX, elevation.minY,
            CsLayers.BORDER, CsSheetSetup.ELEVATION_SHEET);

        var eLeft = elevation.minX + elevation.margin;
        var eFoot = elevation.minY + elevation.margin * 0.55;

        // The name, and what this sheet IS. A reader who picks up the
        // second sheet on its own has to know which cave and which view
        // without the first one in front of them.
        var eName = isNull(values) || isNull(values.caveName) ? "" :
            String(values.caveName);
        text(eLeft, elevation.minY + elevation.margin * 0.95,
            CsSheetSetup.TEXT.caveName,
            eName === "" ? "CAVE NAME" : eName, CsLayers.TITLE_BLOCK,
            CsSheetSetup.ELEVATION_SHEET);
        text(eLeft, elevation.minY + elevation.margin * 0.95 -
                unit(CsSheetSetup.TEXT.caveName *
                    CsSheetSetup.LINE_SPACING),
            CsSheetSetup.TEXT.heading, "EXTENDED ELEVATION",
            CsLayers.TITLE_BLOCK, CsSheetSetup.ELEVATION_SHEET);

        // The same bar as the plan's, because it is the same scale --
        // and a sheet whose scale a reader has to go and look up on
        // another sheet is a sheet that will be read wrong.
        var eBar = CsSheetSetup.barFor(scale);
        var eBarX = elevation.minX + elevation.width * 0.45;
        var eBlockW = unit(CsSheetSetup.BAR.length) / eBar.blocks;
        var eBarH = unit(CsSheetSetup.BAR.height);
        for (var eb = 0; eb <= eBar.blocks; eb++) {
            var ex = eBarX + eBlockW * eb;
            line(ex, eFoot, ex, eFoot + eBarH, CsLayers.SCALE_BAR,
                CsSheetSetup.ELEVATION_SHEET);
            text(ex, eFoot - unit(CsSheetSetup.BAR.tick * 2),
                CsSheetSetup.TEXT.small, String(eBar.perBlock * eb),
                CsLayers.SCALE_BAR, CsSheetSetup.ELEVATION_SHEET);
        }
        line(eBarX, eFoot, eBarX + eBlockW * eBar.blocks, eFoot,
            CsLayers.SCALE_BAR, CsSheetSetup.ELEVATION_SHEET);
        line(eBarX, eFoot + eBarH, eBarX + eBlockW * eBar.blocks,
            eFoot + eBarH, CsLayers.SCALE_BAR,
            CsSheetSetup.ELEVATION_SHEET);
        text(eBarX, eFoot + eBarH + unit(CsSheetSetup.TEXT.body),
            CsSheetSetup.TEXT.body, CsSheetSetup.scaleText(scale),
            CsLayers.SCALE_BAR, CsSheetSetup.ELEVATION_SHEET);

        // NO NORTH ARROW. An elevation has no north -- the registry
        // says so in its own way by refusing NORTH-ARROW a per-view
        // twin -- and an arrow on this sheet would be answering a
        // question the drawing cannot be asked.
        drew.push("an elevation sheet");
    }

    di.applyOperation(op);

    // AND MOVE THE ELEVATION ONTO IT, now, rather than leaving a caver
    // with an empty sheet and a note about regenerating. The region is
    // translated as a unit -- CsProfileDraw.translateRegion takes the
    // caver's own tracing with it -- and the next regenerate lands in
    // the same place, because computeOrigin reads the border this run
    // just drew.
    var moved = 0;
    if (elevation !== null) {
        moved = SheetSetup.moveElevation(doc, di, elevation);
    }

    return "Sheet Setup: " + drew.join(", ") +
        " at 1\" = " + scale + " ft on " + sheet.name +
        (fit.turned ? " (turned)" : "") +
        (cleared > 0 ? " -- the previous sheet was replaced" : "") +
        (moved > 0 ? (" The elevation moved onto its own sheet (" +
            moved + " bands).") : "") +
        " Nothing was written into the location line; type that one " +
        "yourself.";
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
        CsSheetSetup.MARGIN_FRACTION;
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
        csSheetSetupDock = undefined;
        warning("Sheet Setup: this CaveCAD build refused the docked " +
            "panel (" + e + ") -- please report this.");
    }

    this.terminate();
};

SheetSetup.init = function(basePath) {
    var action = new RGuiAction(qsTr("Sheet Setup"),
        RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
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
