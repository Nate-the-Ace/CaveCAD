// LinetypeMaker.js -- Linetype Maker: make, edit and import linetypes.
//
// A docked panel over Core/CsLinetype (the pattern as data) and
// Core/CsLinetypeStore (the caver's .lin library and the open drawing).
// Built in init() and left hidden, like every dock in the suite: the
// main window's restoreState() runs after add-on init and can only place
// a dock that already exists. The menu action is setForceGlobal so it
// runs in the application engine where init built the dock.
//
// WHAT A ROW IS. One row per dash (positive length), gap (negative) or
// dot (0), repeating. A row with text draws that text at the END of the
// row -- where the engine puts it -- so "a gap with W on it" is one row,
// not two. The Kind column is derived and never typed.

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");

var csLinetypeMakerDock;

function LinetypeMaker(guiAction) {
    EAction.call(this, guiAction);
}

LinetypeMaker.prototype = new EAction();

/** Table columns, in order. Kind is derived, never typed. */
LinetypeMaker.COLUMNS = ["Kind", "Length", "Text", "Font", "Size", "Rot°", "X", "Y"];

LinetypeMaker.PREVIEW_W = 280;
LinetypeMaker.PREVIEW_H = 56;

/** Widgets and the model being edited. One panel per window. */
LinetypeMaker.w = undefined;

LinetypeMaker.blank = function() {
    return { name: "", description: "", segments: [CsLinetype.segment(0.5),
                                                   CsLinetype.segment(-0.25)] };
};

LinetypeMaker.buildDock = function(appWin) {
    var dock = new QDockWidget(qsTr("Linetype Maker"), appWin);
    // Without an objectName restoreState() cannot identify the dock.
    dock.objectName = "CaveSurveyLinetypeMakerDock";
    var w = { model: LinetypeMaker.blank(), entries: [], filling: false };
    var body = new QWidget(dock);
    var layout = new QVBoxLayout();
    layout.setContentsMargins(4, 4, 4, 4);
    layout.setSpacing(4);

    var pickRow = new QHBoxLayout();
    w.picker = new QComboBox();
    w.picker.toolTip = qsTr("Your library, then the linetypes already in this drawing.");
    pickRow.addWidget(w.picker, 1, 0);
    w.newButton = new QPushButton(qsTr("New"));
    pickRow.addWidget(w.newButton, 0, 0);
    w.deleteButton = new QPushButton(qsTr("Delete"));
    w.deleteButton.toolTip = qsTr("Remove it from your library. Drawings keep their own copy.");
    pickRow.addWidget(w.deleteButton, 0, 0);
    layout.addLayout(pickRow, 0);

    var form = new QGridLayout();
    form.addWidget(new QLabel(qsTr("Name")), 0, 0);
    w.name = new QLineEdit();
    w.name.toolTip = qsTr("Letters, digits, _ - and $ -- no spaces.");
    form.addWidget(w.name, 0, 1);
    form.addWidget(new QLabel(qsTr("Description")), 1, 0);
    w.description = new QLineEdit();
    form.addWidget(w.description, 1, 1);
    layout.addLayout(form, 0);

    w.table = new QTableWidget(0, LinetypeMaker.COLUMNS.length);
    w.table.setHorizontalHeaderLabels(LinetypeMaker.COLUMNS);
    w.table.toolTip = qsTr("One row per dash (positive length), gap (negative) " +
        "or dot (0). A row with text draws it at the END of that row.");
    try {
        w.table.setMinimumHeight(150);
    } catch (eH) {
    }
    layout.addWidget(w.table, 1, 0);

    var rowButtons = new QHBoxLayout();
    w.addDash = new QPushButton(qsTr("+ Dash"));
    w.addGap = new QPushButton(qsTr("+ Gap"));
    w.addText = new QPushButton(qsTr("+ Text"));
    w.removeRow = new QPushButton(qsTr("Remove"));
    w.upRow = new QPushButton("↑");
    w.downRow = new QPushButton("↓");
    var rb = [w.addDash, w.addGap, w.addText, w.removeRow, w.upRow, w.downRow];
    for (var i = 0; i < rb.length; i++) {
        rowButtons.addWidget(rb[i], 0, 0);
    }
    layout.addLayout(rowButtons, 0);

    w.preview = new QLabel("");
    try {
        w.preview.setMinimumHeight(LinetypeMaker.PREVIEW_H);
    } catch (eP) {
    }
    layout.addWidget(w.preview, 0, 0);
    w.problems = new QLabel("");
    w.problems.wordWrap = true;
    layout.addWidget(w.problems, 0, 0);

    var foot = new QHBoxLayout();
    w.saveButton = new QPushButton(qsTr("Save to Library"));
    w.saveButton.toolTip = qsTr("Keep it in your library beside your caves. " +
        "Every new cave map gets the whole library.");
    w.applyButton = new QPushButton(qsTr("Apply to Drawing"));
    w.applyButton.toolTip = qsTr("Add it to the open drawing (or update it there).");
    w.importButton = new QPushButton(qsTr("Import…"));
    w.importButton.toolTip = qsTr("Read linetypes from an AutoCAD .lin file or another drawing.");
    foot.addWidget(w.saveButton, 0, 0);
    foot.addWidget(w.applyButton, 0, 0);
    foot.addWidget(w.importButton, 0, 0);
    layout.addLayout(foot, 0);

    body.setLayout(layout);
    dock.setWidget(body);
    LinetypeMaker.w = w;

    function on(signal, fn) {
        try {
            signal.connect(fn);
        } catch (eConnect) {
            // a bridge refusal costs one control, not the whole panel
        }
    }
    on(w.picker.activated, function(index) { LinetypeMaker.pick(index); });
    on(w.newButton.clicked, function() { LinetypeMaker.load(LinetypeMaker.blank()); });
    on(w.deleteButton.clicked, function() { LinetypeMaker.remove(); });
    on(w.name.textEdited, function() { LinetypeMaker.readForm(); });
    on(w.description.textEdited, function() { LinetypeMaker.readForm(); });
    on(w.table.cellChanged, function() { LinetypeMaker.readForm(); });
    on(w.addDash.clicked, function() { LinetypeMaker.addRow(0.5, false); });
    on(w.addGap.clicked, function() { LinetypeMaker.addRow(-0.25, false); });
    on(w.addText.clicked, function() { LinetypeMaker.addRow(-0.5, true); });
    on(w.removeRow.clicked, function() { LinetypeMaker.moveRow(0); });
    on(w.upRow.clicked, function() { LinetypeMaker.moveRow(-1); });
    on(w.downRow.clicked, function() { LinetypeMaker.moveRow(1); });
    on(w.saveButton.clicked, function() { LinetypeMaker.save(); });
    on(w.applyButton.clicked, function() { LinetypeMaker.applyToDrawing(); });
    on(w.importButton.clicked, function() { LinetypeMaker.importFile(); });
    on(dock.visibilityChanged, function(shown) {
        if (shown) {
            LinetypeMaker.refresh();
        }
    });

    appWin.addDockWidget(Qt.RightDockWidgetArea, dock);
    CsPanel.attachHelp(dock, "LinetypeMaker", qsTr("Linetype Maker"));
    LinetypeMaker.load(w.model);
    return dock;
};

LinetypeMaker.ensureDock = function() {
    if (isNull(csLinetypeMakerDock)) {
        csLinetypeMakerDock = LinetypeMaker.buildDock(RMainWindowQt.getMainWindow());
    }
    return csLinetypeMakerDock;
};

/** The open drawing, or null -- never a null-wrapped document. */
LinetypeMaker.document = function() {
    var doc = EAction.getDocument();
    if (isNull(doc) || typeof doc.getLinetypeNames !== "function") {
        return null;
    }
    try {
        doc.getLinetypeNames();
    } catch (eDoc) {
        return null;
    }
    return doc;
};

/** Rebuilds the picker: library first, then the open drawing's own. */
LinetypeMaker.refresh = function() {
    var w = LinetypeMaker.w;
    w.entries = [];
    var lib = CsLinetypeStore.loadCustom();
    for (var i = 0; i < lib.linetypes.length; i++) {
        w.entries.push({ source: "library", model: lib.linetypes[i] });
    }
    var doc = LinetypeMaker.document();
    if (doc !== null) {
        var drawn = CsLinetypeStore.fromDocument(doc);
        for (var d = 0; d < drawn.length; d++) {
            if (CsLinetypeStore.indexOf(lib.linetypes, drawn[d].name) < 0) {
                w.entries.push({ source: "drawing", model: drawn[d] });
            }
        }
    }
    w.picker.clear();
    w.picker.addItem(qsTr("— choose a linetype —"));
    for (var k = 0; k < w.entries.length; k++) {
        var e = w.entries[k];
        w.picker.addItem((e.source === "library" ? qsTr("Library: ") :
            qsTr("Drawing: ")) + e.model.name);
    }
    LinetypeMaker.render();
    if (lib.errors.length > 0) {
        w.problems.text = qsTr("Some library lines could not be read: ") +
            lib.errors.join("; ");
    }
};

LinetypeMaker.pick = function(index) {
    var w = LinetypeMaker.w;
    if (index < 1 || index > w.entries.length) {
        return;
    }
    LinetypeMaker.load(JSON.parse(JSON.stringify(w.entries[index - 1].model)));
};

/** Puts a model into the form. */
LinetypeMaker.load = function(model) {
    var w = LinetypeMaker.w;
    w.model = model;
    w.filling = true;
    try {
        w.name.text = model.name;
        w.description.text = model.description || "";
        w.table.setRowCount(model.segments.length);
        for (var r = 0; r < model.segments.length; r++) {
            var s = model.segments[r];
            var cells = [CsLinetype.kindOf(s), CsLinetype.num(s.length), s.text,
                s.style, CsLinetype.num(s.scale), CsLinetype.num(s.rotation),
                CsLinetype.num(s.x), CsLinetype.num(s.y)];
            for (var c = 0; c < cells.length; c++) {
                var item = new QTableWidgetItem(String(cells[c]));
                if (c === 0) {
                    try {
                        item.setFlags(Qt.ItemIsSelectable | Qt.ItemIsEnabled);
                    } catch (eFlags) {
                    }
                }
                w.table.setItem(r, c, item);
            }
        }
    } finally {
        w.filling = false;
    }
    LinetypeMaker.render();
};

LinetypeMaker.cell = function(r, c) {
    var item = LinetypeMaker.w.table.item(r, c);
    return isNull(item) ? "" : String(item.text()).trim();
};

/** Reads the form back into the model; never while load() is filling. */
LinetypeMaker.readForm = function() {
    var w = LinetypeMaker.w;
    if (w.filling) {
        return;
    }
    var m = { name: String(w.name.text).trim(),
              description: String(w.description.text).trim(), segments: [] };
    // rowCount is a PROPERTY in this bridge; currentRow is a method.
    for (var r = 0; r < w.table.rowCount; r++) {
        var s = CsLinetype.segment(Number(LinetypeMaker.cell(r, 1)));
        s.text = LinetypeMaker.cell(r, 2);
        s.style = LinetypeMaker.cell(r, 3);
        s.scale = LinetypeMaker.cell(r, 4) === "" ? 1 : Number(LinetypeMaker.cell(r, 4));
        s.rotation = Number(LinetypeMaker.cell(r, 5)) || 0;
        s.x = Number(LinetypeMaker.cell(r, 6)) || 0;
        s.y = Number(LinetypeMaker.cell(r, 7)) || 0;
        m.segments.push(s);
    }
    w.model = m;
    w.filling = true;
    try {
        for (var k = 0; k < m.segments.length; k++) {
            var kind = w.table.item(k, 0);
            if (!isNull(kind)) {
                kind.setText(CsLinetype.kindOf(m.segments[k]));
            }
        }
    } finally {
        w.filling = false;
    }
    LinetypeMaker.render();
};

LinetypeMaker.addRow = function(length, withText) {
    var m = LinetypeMaker.w.model;
    var s = CsLinetype.segment(length);
    if (withText) {
        s.text = "TEXT";
        s.style = "standard";
        s.scale = 0.1;
        s.y = -0.05;
    }
    m.segments.push(s);
    LinetypeMaker.load(m);
};

/** delta 0 removes the current row; -1 / 1 moves it. */
LinetypeMaker.moveRow = function(delta) {
    var w = LinetypeMaker.w;
    var r = w.table.currentRow();
    var segs = w.model.segments;
    if (r < 0 || r >= segs.length) {
        return;
    }
    if (delta === 0) {
        segs.splice(r, 1);
    } else {
        var to = r + delta;
        if (to < 0 || to >= segs.length) {
            return;
        }
        var t = segs[r];
        segs[r] = segs[to];
        segs[to] = t;
        r = to;
    }
    LinetypeMaker.load(w.model);
    try {
        if (segs.length > 0) {
            w.table.setCurrentCell(Math.min(r, segs.length - 1), 1);
        }
    } catch (eCur) {
    }
};

/** Preview + problems line + which buttons make sense. */
LinetypeMaker.render = function() {
    var w = LinetypeMaker.w;
    var problems = CsLinetype.validate(w.model);
    w.problems.text = problems.join("\n");
    w.saveButton.enabled = problems.length === 0;
    w.applyButton.enabled = problems.length === 0 && LinetypeMaker.document() !== null;
    try {
        w.preview.setPixmap(LinetypeMaker.previewPixmap(w.model));
    } catch (ePix) {
        w.preview.text = CsLinetype.toPattern(w.model);
    }
};

/**
 * Three periods of the pattern along a straight line. Dashes and dots
 * come from CsLinetype.layout; each text from the ENGINE's own glyph
 * paths (RLinetypePattern.getShapeAt), so the preview shows the font
 * CaveCAD will draw. A bridge that cannot paint an RPainterPath falls
 * back to drawText.
 */
LinetypeMaker.previewPixmap = function(model) {
    var W = LinetypeMaker.PREVIEW_W, H = LinetypeMaker.PREVIEW_H;
    var pixmap = new QPixmap(W, H);
    pixmap.fill(new QColor(0, 0, 0, 0));
    var period = 0;
    for (var i = 0; i < model.segments.length; i++) {
        period += Math.abs(Number(model.segments[i].length) || 0);
    }
    if (!(period > 0)) {
        return pixmap;
    }
    var margin = 8;
    var f = (W - 2 * margin) / (3 * period);
    var y0 = H / 2;
    var lay = CsLinetype.layout(model, 3 * period);

    var engine = null;
    try {
        engine = new RLinetypePattern(true, "PREVIEW", "");
        if (!engine.setPatternString(CsLinetype.toPattern(model))) {
            engine = null;
        }
    } catch (eEng) {
        engine = null;
    }

    var ink = new QColor(40, 40, 40);
    try {
        ink = LinetypeMaker.w.preview.palette.color(QPalette.WindowText);
    } catch (eInk) {
        // the palette is a nicety; dark grey reads on a light panel
    }

    var painter = new QPainter();
    painter.begin(pixmap);
    try {
        painter.setRenderHint(QPainter.Antialiasing, true);
        var pen = new QPen(ink);
        pen.setWidth(2);
        painter.setPen(pen);
        for (var d = 0; d < lay.dashes.length; d++) {
            painter.drawLine(margin + lay.dashes[d][0] * f, y0,
                             margin + lay.dashes[d][1] * f, y0);
        }
        for (var p = 0; p < lay.dots.length; p++) {
            painter.drawPoint(margin + lay.dots[p] * f, y0);
        }
        var thin = new QPen(ink);
        thin.setWidth(0);
        painter.setPen(thin);
        for (var g = 0; g < lay.glyphs.length; g++) {
            var seg = model.segments[lay.glyphs[g].index];
            var gx = margin + lay.glyphs[g].at * f;
            var drawn = false;
            if (engine !== null) {
                try {
                    var paths = engine.getShapeAt(lay.glyphs[g].index);
                    painter.save();
                    painter.translate(gx, y0);
                    painter.scale(f, -f);
                    for (var k = 0; k < paths.length; k++) {
                        painter.drawPath(paths[k]);
                    }
                    painter.restore();
                    drawn = paths.length > 0;
                } catch (ePath) {
                    drawn = false;
                }
            }
            if (!drawn) {
                painter.drawText(gx + seg.x * f, y0 - seg.y * f, seg.text);
            }
        }
    } finally {
        painter.end();
    }
    return pixmap;
};

LinetypeMaker.save = function() {
    var err = CsLinetypeStore.saveCustom(LinetypeMaker.w.model);
    if (err !== null) {
        CsTell.warn(err);
        return;
    }
    EAction.handleUserMessage(qsTr("Linetype Maker: saved ") +
        LinetypeMaker.w.model.name + qsTr(" to ") + CsLinetypeStore.customPath());
    LinetypeMaker.refresh();
};

// Not LinetypeMaker.apply: that would shadow Function.prototype.apply.
LinetypeMaker.applyToDrawing = function() {
    var doc = LinetypeMaker.document();
    var di = EAction.getDocumentInterface();
    if (doc === null || isNull(di)) {
        CsTell.warn(qsTr("Open a drawing first."));
        return;
    }
    // A sheet is rebuilt from the cave's record; anything added to one
    // is lost on the next build. See Core/CsSheetFile.js.
    if (CsSheetFile.blocks(doc, "Linetype Maker")) {
        return;
    }
    var err = CsLinetypeStore.applyToDocument(doc, di, LinetypeMaker.w.model);
    if (err !== null) {
        CsTell.warn(err);
        return;
    }
    EAction.handleUserMessage(qsTr("Linetype Maker: ") + LinetypeMaker.w.model.name +
        qsTr(" is in this drawing -- pick it from any layer's or entity's linetype list."));
    LinetypeMaker.refresh();
};

LinetypeMaker.remove = function() {
    var name = LinetypeMaker.w.model.name;
    var err = CsLinetypeStore.removeCustom(name);
    if (err !== null) {
        CsTell.warn(err);
        return;
    }
    LinetypeMaker.load(LinetypeMaker.blank());
    LinetypeMaker.refresh();
};

/**
 * Import...: a .lin or another drawing, then a tick list of what it
 * holds. A name already in the library says so on its row; ticking it
 * replaces yours, unticking leaves yours alone.
 */
LinetypeMaker.importFile = function() {
    var path = CsFiles.openFile(RMainWindowQt.getMainWindow(),
        qsTr("Import linetypes"), QDir.homePath(),
        qsTr("Linetypes (*.lin *.dxf *.dwg);;All files (*)"));
    // isNull + String: a wrapped empty QString is truthy
    if (isNull(path) || String(path) === "") {
        return;
    }
    var found = CsLinetypeStore.readImport(String(path));
    if (found.linetypes.length === 0) {
        CsTell.warn(qsTr("No linetypes found in ") + path +
            (found.errors.length > 0 ? " -- " + found.errors.join("; ") : "."));
        return;
    }
    var mine = CsLinetypeStore.loadCustom().linetypes;

    var dialog = new QDialog(RMainWindowQt.getMainWindow());
    dialog.windowTitle = qsTr("Import linetypes");
    var v = new QVBoxLayout();
    var boxes = [];
    for (var i = 0; i < found.linetypes.length; i++) {
        var lt = found.linetypes[i];
        var label = lt.name + (lt.description ? " -- " + lt.description : "");
        var usable = CsLinetype.validate(lt).length === 0;
        if (!usable) {
            label += qsTr("  (cannot be used: ") + CsLinetype.validate(lt)[0] + ")";
        } else if (CsLinetypeStore.indexOf(mine, lt.name) >= 0) {
            label += qsTr("  (replaces yours)");
        }
        var box = new QCheckBox(label);
        box.checked = usable;
        box.enabled = usable;
        v.addWidget(box, 0, 0);
        boxes.push(box);
    }
    if (found.errors.length > 0) {
        var errs = new QLabel(qsTr("Skipped: ") + found.errors.join("; "));
        errs.wordWrap = true;
        v.addWidget(errs, 0, 0);
    }
    var buttons = new QHBoxLayout();
    var okButton = new QPushButton(qsTr("Import"));
    var cancelButton = new QPushButton(qsTr("Cancel"));
    buttons.addStretch(1);
    buttons.addWidget(cancelButton, 0, 0);
    buttons.addWidget(okButton, 0, 0);
    v.addLayout(buttons, 0);
    dialog.setLayout(v);
    okButton.clicked.connect(function() { dialog.accept(); });
    cancelButton.clicked.connect(function() { dialog.reject(); });
    // exec() answers a plain 0 on cancel (qcad-js-bridge-traps)
    if (dialog.exec() === 0) {
        return;
    }
    var saved = 0, failed = [];
    for (var k = 0; k < boxes.length; k++) {
        if (boxes[k].checked !== true) {
            continue;
        }
        var err = CsLinetypeStore.saveCustom(found.linetypes[k]);
        if (err === null) {
            saved++;
        } else {
            failed.push(found.linetypes[k].name + ": " + err);
        }
    }
    if (failed.length > 0) {
        CsTell.warn(failed.join("\n"));
    }
    EAction.handleUserMessage(qsTr("Linetype Maker: imported ") + saved +
        qsTr(" linetype(s) into your library."));
    LinetypeMaker.refresh();
};

LinetypeMaker.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    try {
        var dock = LinetypeMaker.ensureDock();
        dock.visible = !dock.visible;
        if (dock.visible) {
            dock.raise();
        }
    } catch (e) {
        csLinetypeMakerDock = undefined;
        CsTell.warn("Linetype Maker: this CaveCAD build refused the docked panel (" +
            e + ") -- please report this.");
    }
    this.terminate();
};

LinetypeMaker.init = function(basePath) {
    LinetypeMaker.basePath = basePath;
    var action = new RGuiAction(qsTr("Linetype Maker"), RMainWindowQt.getMainWindow());
    // Not setRequiresDocument: the library is edited without a drawing.
    // Apply to Drawing is what needs one, and it says so.
    action.setRequiresDocument(false);
    action.setScriptFile(basePath + "/LinetypeMaker.js");
    action.setIcon(basePath + "/LinetypeMaker.svg");
    action.setStatusTip(qsTr("Make, edit and import linetypes -- dashes, gaps and text"));
    action.setDefaultCommands(["linetypemaker", "ltm"]);
    action.setGroupSortOrder(452);
    action.setSortOrder(45);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);

    // Built during init like the other docks: restoreState() runs after
    // this and can only place a dock that already exists.
    try {
        var dock = LinetypeMaker.ensureDock();
        dock.visible = false;
    } catch (eInit) {
        csLinetypeMakerDock = undefined;
        warning("Linetype Maker: could not build the panel at startup (" +
            eInit + "); the menu entry will try again.");
    }
};
