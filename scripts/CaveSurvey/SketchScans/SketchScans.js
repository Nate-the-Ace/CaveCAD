// SketchScans.js
//
// QCAD add-on tool: browse the cave's scans/ folder -- including the
// per-trip subfolders surveyors actually keep scans in -- preview each
// sketch large enough to tell the right one from the rest, and insert
// it into the drawing -- straight into the Align Image tool, so a scan
// goes from folder to aligned underlay in one motion.
//
// The preview is the point of the tool. A trip's scans have names like
// "IMG_4021.jpeg"; picking the wrong one costs a whole tracing session.
// So the list shows a live preview pane for the selected file, and
// hovering any row pops the same picture as a tooltip (Qt rich-text
// tooltips render <img>).
//
// The list is a folder TREE, simulated on a QTableWidget (QTreeWidget
// is not constructible in this bridge -- see CaveShelf.js): bold
// folder rows with ▾/▸ glyphs, one plain click folds a folder by
// hiding its rows, and the collapsed set is remembered per cave in
// settings (CsScanTree.SETTING) because the dialog closes after every
// insert. The model behind it is Core/CsScanTree.js.
//
// Inserting is ADDITIVE -- several scans commonly underlie one map, so
// re-running never erases previous scans (unlike the basemap and the
// contours, which replace themselves). Each image is tagged
// SketchScan=<path relative to scans/> and lands on CTRL-SCAN, scaled to sit over
// the survey at a sensible size, on TOP of the draw order -- an
// underlay being aligned needs to be visible; send it to back with
// Modify > Draw Order once traced.
//
// "Insert & Align" hands the freshly inserted image, selected, to the
// Align Image tool -- deferred through a zero-delay timer, because
// starting another action from inside this one's own lifecycle event
// is the documented hard-crash trap.
//
// USAGE:
//   Cave Survey > Sketch Scans   (or "sketchscans" / "ss")

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");
include(includeBasePath + "/../AlignImage/AlignImage.js");

function sketchScansRun() {
    var doc = getDocument();
    var di = getDocumentInterface();
    if (doc === undefined || doc === null) {
        warning("Sketch Scans: no active drawing document.");
        return;
    }
    if (typeof RImageData === "undefined" ||
            typeof RImageEntity === "undefined") {
        warning("Sketch Scans: this build's script engine has no image " +
            "support (RImageData).\nThe CaveCAD fork is the supported " +
            "platform.");
        return;
    }

    var docPath = doc.getFileName();
    var folder = CsCave.folderOf(docPath);
    if (folder === null) {
        warning("Sketch Scans: save the drawing first.\n" +
            "The scans live in the cave project's scans/ folder, which " +
            "sits beside the drawing file.");
        return;
    }

    // The folder as it exists on disk, whatever its casing.
    var scans = CsCave.findSubfolder(folder, CsCave.SCANS);
    if (scans === null) {
        scans = CsCave.scansDir(docPath);
    }
    if (scans === null || !(new QDir(scans)).exists()) {
        warning("Sketch Scans: this cave has no scans/ folder yet.\n" +
            "Put the sketch scans in " + CsCave.scansDir(docPath) +
            " and run this again.");
        return;
    }

    var files = SketchScans.imageFiles(scans);
    if (files.length === 0) {
        warning("Sketch Scans: nothing in " + scans + " reads as an " +
            "image.\nScans in JPEG, PNG, TIFF or HEIC all work.");
        return;
    }

    SketchScans.dialog(doc, di, scans, files);
}

// How deep below scans/ to look. Real caves nest scans in per-trip
// subfolders ("scans/2025 Scans/9-7-25 Survey Scans/..."), so a
// top-level-only listing sees an empty folder on every real cave.
SketchScans.DEPTH = 4;

/**
 * Image files under a scans folder, RECURSIVE, as paths relative to it,
 * name-sorted, by the formats QImage reads.
 */
SketchScans.imageFiles = function(folder) {
    var filters = [];
    try {
        var formats = QImageReader.supportedImageFormats();
        for (var i = 0; i < formats.length; i++) {
            filters.push("*." + String(formats[i]));
        }
    } catch (e) {
        filters = ["*.png", "*.jpg", "*.jpeg", "*.tif", "*.tiff",
            "*.bmp", "*.gif"];
    }
    var names = CsCave.filesUnder(folder, filters, SketchScans.DEPTH);
    var out = [];
    for (var k = 0; k < names.length; k++) {
        var name = names[k];
        var base = name.substring(name.lastIndexOf("/") + 1);
        // the map's own generated preview is not a sketch
        if (CsCave.isPreviewName && CsCave.isPreviewName(base)) {
            continue;
        }
        out.push(name);
    }
    return out;
};

// Preview pane size. Tooltip previews use the same width.
SketchScans.PREVIEW_W = 420;
SketchScans.PREVIEW_H = 340;

// The collapsed set for one cave's scans folder, from settings.
// A bridge without RSettings starts fully expanded.
SketchScans.loadCollapsed = function(scans) {
    try {
        var map = CsScanTree.parseCollapsed(
            RSettings.getStringValue(CsScanTree.SETTING, ""));
        return CsScanTree.collapsedSetFor(map, scans);
    } catch (e) {
        return {};
    }
};

// Writes the collapsed set back, keeping only folders the dialog
// actually showed -- renamed or deleted trip folders fall out.
SketchScans.saveCollapsed = function(scans, collapsed, rows) {
    try {
        var map = CsScanTree.parseCollapsed(
            RSettings.getStringValue(CsScanTree.SETTING, ""));
        var valid = [];
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].kind === "folder") { valid.push(rows[i].rel); }
        }
        CsScanTree.recordCollapsed(map, scans, collapsed, valid);
        RSettings.setValue(CsScanTree.SETTING,
            CsScanTree.serializeCollapsed(map));
    } catch (e) {
        // a bridge without RSettings just forgets the collapse state
    }
};

// The text of one row: indentation by depth, a disclosure glyph on
// folder rows, a glyph-wide gap on file rows so labels at one depth
// line up across kinds.
SketchScans.rowText = function(row, collapsed) {
    var indent = new Array(row.depth + 1).join("  ");
    if (row.kind === "folder") {
        return indent +
            (collapsed[row.rel] === true ? "▸ " : "▾ ") +
            row.label;
    }
    return indent + "  " + row.label;
};

/** The browse dialog. */
SketchScans.dialog = function(doc, di, scans, files) {
    var rows = CsScanTree.rowsOf(files);
    var collapsed = SketchScans.loadCollapsed(scans);

    var appWin = RMainWindowQt.getMainWindow();
    var dlg = new QDialog(appWin);
    dlg.windowTitle = "Sketch Scans";
    var layout = new QVBoxLayout();

    layout.addWidget(new QLabel(scans + "  —  " + files.length +
        " scan" + (files.length === 1 ? "" : "s") + ". Hover a scan " +
        "for a preview; double-click inserts and aligns; click a " +
        "folder to collapse it."), 0, 0);

    var main = new QHBoxLayout();

    var list = new QTableWidget(0, 1);
    try {
        list.horizontalHeader().visible = false;
        list.verticalHeader().visible = false;
        list.horizontalHeader().stretchLastSection = true;
        list.selectionBehavior = QAbstractItemView.SelectRows;
        list.editTriggers = QAbstractItemView.NoEditTriggers;
        list.minimumWidth = 240;
    } catch (eList) {
    }
    list.setRowCount(rows.length);
    for (var i = 0; i < rows.length; i++) {
        var item = new QTableWidgetItem(
            SketchScans.rowText(rows[i], collapsed));
        if (rows[i].kind === "folder") {
            // Bold, clickable, but never SELECTED -- the selection
            // (and with it the preview pane) stays on a scan while
            // folders fold and unfold around it.
            try {
                var bold = item.font();
                bold.setBold(true);
                item.setFont(bold);
            } catch (eBold) {
            }
            try {
                item.setFlags(Qt.ItemIsEnabled);
            } catch (eFlags) {
            }
        } else {
            try {
                item.setToolTip("<img src=\"" + scans + "/" +
                    rows[i].rel + "\" width=\"" +
                    SketchScans.PREVIEW_W + "\">");
            } catch (eTip) {
                // no hover preview on this bridge; the pane still works
            }
        }
        list.setItem(i, 0, item);
    }

    var applyHidden = function() {
        try {
            for (var r = 0; r < rows.length; r++) {
                list.setRowHidden(r,
                    CsScanTree.isHidden(rows[r], collapsed));
            }
        } catch (eHide) {
            // an engine without setRowHidden shows the list flat
        }
    };
    applyHidden();
    main.addWidget(list, 0, 0);

    var preview = new QLabel("");
    preview.setFixedSize(new QSize(SketchScans.PREVIEW_W,
        SketchScans.PREVIEW_H));
    preview.alignment = Qt.AlignCenter;
    main.addWidget(preview, 1);
    layout.addLayout(main, 1);

    var buttons = new QHBoxLayout();
    buttons.addStretch(1);
    var alignButton = new QPushButton("Insert && Align");
    alignButton.toolTip = "Insert the selected scan over the survey " +
        "and start Align Image on it: pick two points on the scan and " +
        "their true positions, and it fits.";
    var insertButton = new QPushButton("Insert");
    insertButton.toolTip = "Insert the selected scan over the survey, " +
        "unaligned.";
    var closeButton = new QPushButton("Close");
    try {
        alignButton["default"] = true;
    } catch (eDef) {
    }
    buttons.addWidget(alignButton, 0, 0);
    buttons.addWidget(insertButton, 0, 0);
    buttons.addWidget(closeButton, 0, 0);
    layout.addLayout(buttons, 0);

    dlg.setLayout(layout);

    var selectedFile = function() {
        var row = list.currentRow();
        if (row < 0 || row >= rows.length) { return null; }
        return rows[row].kind === "file" ? rows[row].rel : null;
    };

    var toggleFolder = function(rowIdx) {
        var row = rows[rowIdx];
        if (row === undefined || row.kind !== "folder") { return; }
        if (collapsed[row.rel] === true) {
            delete collapsed[row.rel];
        } else {
            collapsed[row.rel] = true;
        }
        try {
            list.item(rowIdx, 0).setText(
                SketchScans.rowText(row, collapsed));
        } catch (eGlyph) {
            // a stale glyph is cosmetic; the rows still fold
        }
        applyHidden();
    };

    var showPreview = function() {
        var name = selectedFile();
        preview.text = "";
        try {
            preview.setPixmap(new QPixmap());
        } catch (eClear) {
        }
        if (name === null) {
            return;
        }
        try {
            var pixmap = new QPixmap(scans + "/" + name);
            if (pixmap.isNull()) {
                preview.text = "unreadable image";
                return;
            }
            preview.setPixmap(pixmap.scaled(SketchScans.PREVIEW_W,
                SketchScans.PREVIEW_H, Qt.KeepAspectRatio,
                Qt.SmoothTransformation));
        } catch (e) {
            preview.text = "unreadable image";
        }
    };

    // 0 = closed, then the chosen work happens after exec() returns --
    // decisions after the widgets are done, like every dialog here.
    var chosen = { file: null, align: false };
    var choose = function(align) {
        var name = selectedFile();
        if (name === null) {
            return;
        }
        chosen.file = name;
        chosen.align = align;
        dlg.accept();
    };

    list.itemSelectionChanged.connect(showPreview);
    // Folder rows fold on a plain click; they are not selectable, so
    // the double-click below can only ever land on a scan.
    list.cellClicked.connect(function(row, col) { toggleFolder(row); });
    list.itemDoubleClicked.connect(function() { choose(true); });
    alignButton.clicked.connect(function() { choose(true); });
    insertButton.clicked.connect(function() { choose(false); });
    closeButton.clicked.connect(function() { dlg.reject(); });

    // Initial selection: the first visible scan, not a folder row.
    for (var s = 0; s < rows.length; s++) {
        if (rows[s].kind === "file" &&
                !CsScanTree.isHidden(rows[s], collapsed)) {
            list.selectRow(s);
            break;
        }
    }
    showPreview();

    dlg.exec();
    destrDialog(dlg);
    SketchScans.saveCollapsed(scans, collapsed, rows);

    if (chosen.file === null) {
        return;
    }
    var placed = SketchScans.insert(doc, di, scans + "/" + chosen.file,
        chosen.file);
    if (placed === null) {
        return;                     // insert already explained why
    }
    if (chosen.align) {
        SketchScans.alignSoon(placed);
    } else {
        EAction.handleUserMessage(chosen.file + " inserted on " +
            CsLayers.SCAN + ". Align Image fits it to the survey.");
    }
};

/**
 * Inserts one scan over the survey: centered on the drawing's extent,
 * scaled so its width spans about that extent (or 150 units for an
 * empty drawing), tagged, on CTRL-SCAN, on top -- an underlay about to
 * be aligned needs to be seen.
 *
 * \return the entity id, or null (a message has been shown).
 */
SketchScans.insert = function(doc, di, path, name) {
    var image = new QImage(path);
    if (image.isNull()) {
        warning("Sketch Scans: " + name + " could not be read as an " +
            "image.");
        return null;
    }
    var pxW = image.width(), pxH = image.height();
    if (pxW < 1 || pxH < 1) {
        warning("Sketch Scans: " + name + " has no size.");
        return null;
    }

    var box = null;
    try {
        box = doc.getBoundingBox(true, true);
    } catch (eBox) {
    }
    var centerX = 0, centerY = 0, targetW = 150;
    if (box !== null && !isNull(box) && typeof box.isSane === "function" &&
            box.isSane()) {
        var min = box.getMinimum(), max = box.getMaximum();
        if (isNumber(min.x) && isNumber(max.x) && max.x > min.x) {
            centerX = (min.x + max.x) / 2.0;
            centerY = (min.y + max.y) / 2.0;
            targetW = Math.max(max.x - min.x, 50);
        }
    }
    var unitsPerPixel = targetW / pxW;

    var entity;
    try {
        entity = new RImageEntity(doc, new RImageData(
            path,
            new RVector(centerX - (pxW * unitsPerPixel) / 2.0,
                centerY - (pxH * unitsPerPixel) / 2.0),
            new RVector(unitsPerPixel, 0),
            new RVector(0, unitsPerPixel),
            pxW, pxH, 0));
    } catch (e) {
        warning("Sketch Scans: creating the image entity failed: " + e);
        return null;
    }

    CsLayers.ensure(doc, di, CsLayers.SCAN);
    // Layer and tag BEFORE adding -- post-add writes fail silently in
    // this bridge (see CsDraw.js's header).
    entity.setLayerId(doc.getLayerId(CsLayers.SCAN));
    CsTags.set(entity, "SketchScan", name);

    // The new entity's id by set difference: queryAllEntities is not
    // insertion-ordered, and the script-side object is not guaranteed
    // to learn its id from the apply.
    var beforeIds = {};
    var ids = doc.queryAllEntities(false, false);
    var i;
    for (i = 0; i < ids.length; i++) {
        beforeIds[ids[i]] = true;
    }

    var op = new RAddObjectsOperation();
    op.setText("Insert sketch scan");
    op.addObject(entity, false);
    di.applyOperation(op);

    ids = doc.queryAllEntities(false, false);
    for (i = 0; i < ids.length; i++) {
        if (beforeIds[ids[i]] !== true) {
            return ids[i];
        }
    }
    warning("Sketch Scans: the insert operation added nothing -- the " +
        CsLayers.SCAN + " layer may be locked or frozen.");
    return null;
};

/**
 * Starts Align Image on the entity AFTER this action has fully
 * terminated: selects it (selection does not dirty the document), then
 * a zero-delay timer -- outside the action lifecycle, the same reason
 * FeatureTrace's dock buttons defer -- makes Align Image the current
 * action. With a selection standing, Align Image skips its own
 * entity-picking state and goes straight to the source point.
 */
SketchScans.alignSoon = function(entityId) {
    if (entityId === null || entityId === undefined) {
        return;
    }
    var timer = new QTimer(RMainWindowQt.getMainWindow());
    timer.singleShot = true;
    timer.timeout.connect(function() {
        var di = getDocumentInterface();
        if (di === undefined || di === null) {
            return;
        }
        try {
            di.selectEntity(entityId, false);
        } catch (eSel) {
            return;   // nothing selected, nothing to mis-align
        }
        try {
            var guiAction = RGuiAction.getByScriptFile(
                SketchScans.alignScriptPath());
            di.setCurrentAction(new AlignImage(guiAction));
        } catch (eAct) {
            EAction.handleUserWarning("Sketch Scans: the scan is " +
                "inserted and selected, but Align Image would not " +
                "start (" + eAct + "). Run Align Image from the menu.");
        }
    });
    timer.start(0);
};

/** Align Image's registered script path, from this tool's own. */
SketchScans.alignScriptPath = function() {
    var base = SketchScans.basePath || "";
    return base.replace(/\/SketchScans$/, "/AlignImage") + "/AlignImage.js";
};

// ============================================================
// Add-on wiring -- the standard pattern; see docs.
// ============================================================

function SketchScans(guiAction) {
    EAction.call(this, guiAction);
}

SketchScans.prototype = new EAction();

SketchScans.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    sketchScansRun();
    this.terminate();
};

SketchScans.init = function(basePath) {
    SketchScans.basePath = basePath;
    var action = new RGuiAction(qsTr("Sketch Scans"),
        RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/SketchScans.js");
    action.setIcon(basePath + "/SketchScans.svg");
    action.setStatusTip(qsTr("Browse the cave's scanned sketches with " +
        "previews, insert one and align it to the survey"));
    action.setDefaultCommands(["sketchscans", "ss"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(56);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
