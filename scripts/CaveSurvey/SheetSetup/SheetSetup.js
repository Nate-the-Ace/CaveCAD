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
 *  what the last one drew instead of stacking a second sheet on it. */
var SS_TAG = "SheetPiece";

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

function sheetSetupRun() {
    var doc = getDocument();
    if (doc === undefined || doc === null) {
        warning(qsTr("Sheet Setup: no active drawing document."));
        return;
    }
    var di = getDocumentInterface();

    var caveBox = SheetSetup.caveBox(doc);
    if (caveBox === null) {
        warning(qsTr("Sheet Setup: this drawing has nothing on it yet.\n" +
            "Draw the cave first -- the sheet is built around it, and " +
            "a sheet with nothing in it has no scale to be at."));
        return;
    }
    var perFoot = CsShapeLine.perFoot(doc);
    var caveW = (caveBox.maxX - caveBox.minX) / perFoot;
    var caveH = (caveBox.maxY - caveBox.minY) / perFoot;

    var read = SheetSetup.readSurvey(doc);
    var filled = CsSheetSetup.autoFill(read.survey, read.stats, read.grade);

    // ---- ask ---------------------------------------------------------
    var dlg = new QDialog(getMainWindow());
    dlg.windowTitle = qsTr("Sheet Setup");
    var layout = new QVBoxLayout();
    layout.addWidget(new QLabel(qsTr(
        "The cave measures %1 x %2 ft. Everything below is drawn at the " +
        "plot scale, so it prints the size it should.")
        .arg(Math.round(caveW)).arg(Math.round(caveH))), 0, 0);

    var form = new QFormLayout();
    var sheetCombo = new QComboBox();
    var defaultRow = 0;
    for (var s = 0; s < CsSheetSetup.SHEETS.length; s++) {
        sheetCombo.addItem(CsSheetSetup.SHEETS[s].name);
        if (CsSheetSetup.SHEETS[s].name === CsSheetSetup.DEFAULT_SHEET) {
            defaultRow = s;
        }
    }
    sheetCombo.currentIndex = defaultRow;
    form.addRow(qsTr("Paper:"), sheetCombo);

    var scaleCombo = new QComboBox();
    for (var c = 0; c < CsSheetSetup.SCALES.length; c++) {
        scaleCombo.addItem("1\" = " + CsSheetSetup.SCALES[c] + " ft");
    }
    form.addRow(qsTr("Plot scale:"), scaleCombo);

    var fitLabel = new QLabel("");
    fitLabel.wordWrap = true;
    form.addRow("", fitLabel);
    layout.addLayout(form, 0);

    /** Re-picks the scale that fits whenever the paper changes, and
     *  says what it chose. A caver who wants another scale overrides
     *  it; one who does not now has a sheet that fits, which is the
     *  question they could not have answered. */
    var suggest = function() {
        var sheet = CsSheetSetup.sheetByName(
            String(sheetCombo.currentText));
        var fit = CsSheetSetup.fit(caveW, caveH, sheet);
        var at = CsSheetSetup.SCALES.indexOf(fit.scale);
        scaleCombo.currentIndex = at < 0 ? 0 : at;
        fitLabel.text = fit.fits ?
            (qsTr("Fits at 1\" = %1 ft").arg(fit.scale) +
                (fit.turned ? qsTr(", with the paper turned.") : ".")) :
            qsTr("This cave does not fit on that paper at any standard " +
                "scale -- pick bigger paper, or plot it in sections.");
    };
    suggest();
    sheetCombo["currentIndexChanged(int)"].connect(suggest);

    var cbBorder = new QCheckBox(qsTr("Border around the cave"));
    var cbBar = new QCheckBox(qsTr("Scale bar"));
    var cbNorth = new QCheckBox(qsTr("North arrow, with the declination"));
    var cbTitle = new QCheckBox(qsTr("Title block, filled in from the survey"));
    cbBorder.checked = true;
    cbBar.checked = true;
    cbNorth.checked = true;
    cbTitle.checked = true;
    layout.addWidget(cbBorder, 0, 0);
    layout.addWidget(cbBar, 0, 0);
    layout.addWidget(cbNorth, 0, 0);
    layout.addWidget(cbTitle, 0, 0);

    var known = [];
    for (var key in filled) {
        if (filled.hasOwnProperty(key)) {
            known.push(CsSheet.fieldById(key).label);
        }
    }
    var note = new QLabel(known.length === 0 ?
        qsTr("The drawing holds no survey to fill the title block from " +
            "-- the lines are drawn empty for you to type into.") :
        qsTr("From the survey: %1. The location is never filled in " +
            "automatically -- type it yourself.").arg(known.join(", ")));
    note.wordWrap = true;
    layout.addWidget(note, 0, 0);

    var buttons = new QDialogButtonBox(QDialogButtonBox.Ok |
        QDialogButtonBox.Cancel);
    // CLOSURES, NOT SLOT NAMES -- see RepairDrawing.js's note; this
    // build's connect() throws on a slot name.
    buttons.accepted.connect(function() { dlg.accept(); });
    buttons.rejected.connect(function() { dlg.reject(); });
    layout.addWidget(buttons, 0, 0);
    dlg.setLayout(layout);

    if (dlg.exec() !== QDialog.Accepted) {
        return;
    }
    var sheet = CsSheetSetup.sheetByName(String(sheetCombo.currentText));
    var scale = CsSheetSetup.SCALES[scaleCombo.currentIndex];
    var wants = {
        border: cbBorder.checked, bar: cbBar.checked,
        north: cbNorth.checked, title: cbTitle.checked
    };

    // ---- draw --------------------------------------------------------
    var fit = CsSheetSetup.fit(caveW, caveH, sheet);
    EAction.handleUserMessage(SheetSetup.draw(doc, di, {
        caveBox: caveBox, sheet: sheet, scale: scale,
        turned: fit.turned, wants: wants, filled: filled,
        survey: read.survey
    }));
}

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
    var text = function(x, y, inches, label, layer) {
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
        CsTags.set(e, SS_TAG, layer);
        op.addObject(e, false);
        return e;
    };
    var line = function(x1, y1, x2, y2, layer) {
        var e = new RLineEntity(doc,
            new RLineData(new RVector(x1, y1), new RVector(x2, y2)));
        e.setLayerId(doc.getLayerId(layer));
        CsTags.set(e, SS_TAG, layer);
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

    di.applyOperation(op);

    return "Sheet Setup: " + drew.join(", ") +
        " at 1\" = " + scale + " ft on " + sheet.name +
        (fit.turned ? " (turned)" : "") +
        (cleared > 0 ? " -- the previous sheet was replaced" : "") +
        ". Nothing was written into the location line; type that one " +
        "yourself.";
};

// ============================================================
// Add-on wiring -- the standard pattern; see docs.
// ============================================================

SheetSetup.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    sheetSetupRun();
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
    // FIRST in stage 5: the sheet is what the rest of this stage
    // decorates, and a legend placed before there is a sheet to place
    // it on lands in the middle of the cave.
    action.setGroupSortOrder(454);
    action.setSortOrder(5);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
