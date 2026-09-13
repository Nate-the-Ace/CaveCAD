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
    // A SHEET REBUILDS ITSELF (Nathan, 2026-09-10). Pressing Build
    // Sheet while looking at a sheet is not a request for a sheet OF a
    // sheet -- borders inside borders, a record two steps from the
    // survey it claims to show. It is a request to build THIS sheet
    // again: another trip has been surveyed, or the choices have
    // changed. The record it came from is one folder up and named after
    // the cave, so everything below measures THAT, and the build lands
    // back in the file the caver is looking at.
    if (CsSheetFile.isSheet(doc)) {
        var back = CsSheetSetup.recordPathFor(state.recordPath);
        var haveIt = false;
        try {
            haveIt = (back !== "") && (new QFileInfo(back)).exists();
        } catch (eBack) {
            haveIt = false;
        }
        if (!haveIt) {
            state.why = "This is a sheet, and the cave's own drawing " +
                "is not where a sheet is built from -- one folder up, " +
                "named after the cave. Open that drawing to build a " +
                "sheet from it.";
            return state;
        }
        state.rebuilding = true;
        state.recordPath = back;
        doc = SheetSetup.readRecord(back);
        if (isNull(doc)) {
            state.why = "Could not read the cave's own drawing at " +
                back + ".";
            return state;
        }
        state.borrowed = true;
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
    try {
        form.setColumnStretch(0, 0);
        form.setColumnStretch(1, 1);
        form.setColumnStretch(2, 0);
        form.setColumnStretch(3, 1);
    } catch (eStretch) {
        // a bridge without the setter gets whatever the grid gives,
        // which is still one row
    }
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
    // Painted at the size the label ACTUALLY has, not a fixed 150: the
    // fields were squeezed onto one row to free vertical space, and the
    // point of freeing it is for the picture to use it. Clamped at both
    // ends so a very short dock still gets something legible and a very
    // tall one does not paint a mural.
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
    w.note.text = spill.fits ?
        qsTr("Everything sits on the paper.") :
        qsTr("Off the paper: %1. Try a smaller scale or bigger paper.")
            .arg(spill.spilling.join(", "));
    w.buildButton.enabled = (w.state.recordPath !== "");
    w.buildButton.text = (w.state.rebuilding === true) ?
        qsTr("Rebuild This Sheet") : qsTr("Build Sheet");
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
    // Only the RECORD has to be saved. A sheet with unsaved changes in
    // it is a caver who has drawn on a sheet, which is exactly what
    // this rebuild is about to throw away -- and saying "save first"
    // there would be advice to preserve the thing that cannot be kept.
    if (w.state.rebuilding !== true && !isNull(doc) &&
            doc.isModified() === true) {
        warning(qsTr("Sheet Setup: save this drawing first.\n" +
            "The sheet is built from the FILE on disk, so anything " +
            "not yet saved would be missing from it."));
        return;
    }
    if (w.state.rebuilding === true) {
        var lost = !isNull(doc) && doc.isModified() === true;
        if (lost && QMessageBox.question(getMainWindow(), "Sheet Setup",
                qsTr("This sheet has unsaved changes, and rebuilding " +
                    "replaces it from the cave's drawing -- they will " +
                    "be gone.\n\nRebuild anyway?"),
                QMessageBox.Yes | QMessageBox.No) !== QMessageBox.Yes) {
            return;
        }
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
    try {
        (new QDir("/")).mkpath(folder + "/" +
            CsSheetSetup.SHEETS_FOLDER);
    } catch (eDir) {
    }

    // ONE FILE PER SHEET. A plan file and, when asked for, a profile
    // file -- never one drawing holding both, which is one enormous
    // page as far as a plotter is concerned. See
    // CsSheetSetup.sheetPathFor.
    var kinds = [CsSheetSetup.PLAN_SHEET];
    if (opts.elevation === true) {
        kinds.push(CsSheetSetup.ELEVATION_SHEET);
    }

    var written = [];
    var said = "";
    for (var k = 0; k < kinds.length; k++) {
        var target = CsSheetSetup.sheetPathFor(folder, caveName, kinds[k]);
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
            one.kind = kinds[k];
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
    var tail = " Written to " + CsSheetSetup.SHEETS_FOLDER + "/: " +
        names.join(" and ") + " -- your own drawing was not touched.";
    try {
        // The PLAN sheet is the one opened: it is the map, and a caver
        // who wanted the profile can open it from the same folder.
        // openFiles(), the global QCAD opens drawings with -- see the
        // note where this used mainWindow.openFile and could not.
        openFiles([written[0]], false);
    } catch (eOpen) {
        return said + tail;
    }
    return said + tail;
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

    var erased = 0;
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

    // EACH FILE KEEPS ONE VIEW. The copy came from the record, which
    // holds both: a plan sheet that quietly carried the elevation off
    // the paper would plot it, and a profile sheet carrying the plan
    // would be a plan sheet with a border in the wrong place.
    var wrongFrame = elevationSheet ? "plan" : "profile";

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
        // WHICH VIEW THIS SHEET IS, said on the sheet. A reader
        // holding the profile sheet on its own has to know, and the
        // plan sheet says it too rather than leaving "the one without
        // the words on it" as the way to tell them apart.
        text(leftX, y, CsSheetSetup.TEXT.heading,
            elevationSheet ? "EXTENDED ELEVATION" : "PLAN",
            CsLayers.TITLE_BLOCK);
        drew.push("a title block");
    }

    if (wants.bar === true) {
        var bar = CsSheetSetup.barFor(scale);
        var barX = box.minX + box.width * 0.45;
        // The bar's LENGTH comes from its own feet, not from three
        // inches of paper: a metric bar is a round number of METRES,
        // which is very nearly three inches and not exactly. One block
        // spans perBlockFeet of cave, and perFoot turns that into
        // drawing units.
        var blockW = bar.perBlockFeet * perFoot;
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
            CsSheetSetup.TEXT.small, bar.unit, CsLayers.SCALE_BAR);
        drew.push("a scale bar in " + bar.perBlock + " " +
            bar.unit.toLowerCase() + " steps");
    }

    // NO NORTH ARROW ON A PROFILE SHEET. An elevation has no north --
    // the layer registry says so in its own way by refusing
    // NORTH-ARROW a per-view twin -- and an arrow here would answer a
    // question the drawing cannot be asked.
    if (wants.north === true && !elevationSheet) {
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

/** The extents of one frame's own content, or null. */
SheetSetup.frameBox = function(doc, frame) {
    var box = null;
    var ids = doc.queryAllEntities(false, false);
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
