// SketchScans.js
//
// QCAD add-on tool: a DOCKABLE panel that browses the cave's scans/
// folder -- including the per-trip subfolders surveyors actually keep
// scans in -- previews each sketch large enough to tell the right one
// from the rest, and inserts it into the drawing, straight into the
// Align Image tool, so a scan goes from folder to aligned underlay in
// one motion. Docked (right area, tabbed beside Feature Trace and the
// Survey Notebook) rather than modal: several scans commonly underlie
// one map, and the panel stays put between inserts.
//
// The preview is the point of the tool. A trip's scans have names like
// "IMG_4021.jpeg"; picking the wrong one costs a whole tracing session.
// So the list shows a live preview pane under it for the selected
// file, and hovering any row pops a bigger picture as a tooltip (Qt
// rich-text tooltips render <img>).
//
// The list is a folder TREE, simulated on a QTableWidget (QTreeWidget
// is not constructible in this bridge -- see CaveShelf.js): bold
// folder rows with ▾/▸ glyphs, one plain click folds a folder by
// hiding its rows, and the collapsed set is remembered per cave in
// settings (CsScanTree.SETTING). The model behind it is
// Core/CsScanTree.js.
//
// Inserting is ADDITIVE -- re-running never erases previous scans
// (unlike the basemap and the contours, which replace themselves).
// Each image is tagged SketchScan=<path relative to scans/> and lands
// on CTRL-SCAN, scaled to sit over the survey at a sensible size,
// HALF FADED and at the BACK of the draw order, the basemap's
// treatment: the scan is an underlay to trace over, and at full
// strength on top it hid the very linework being drawn.
//
// "Insert & Align" hands the freshly inserted image, selected, to the
// Align Image tool -- deferred through a zero-delay timer, because
// starting another action from inside a widget event is the documented
// hard-crash trap.
//
// USAGE:
//   Cave Survey > Sketch Scans   (or "sketchscans" / "ss")
//   -- toggles the panel.

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");
include(includeBasePath + "/../AlignImage/AlignImage.js");
include(includeBasePath + "/ScanView.js");

// The panel, built once per session (FeatureTrace's pattern).
var csSketchScansDock;

/** Toggles the panel; a fresh refresh every time it shows. */
function sketchScansRun() {
    if (typeof RImageData === "undefined" ||
            typeof RImageEntity === "undefined") {
        warning("Sketch Scans: this build's script engine has no image " +
            "support (RImageData).\nThe CaveCAD fork is the supported " +
            "platform.");
        return;
    }
    try {
        var existed = (csSketchScansDock !== undefined &&
            csSketchScansDock !== null);
        var dock = SketchScans.ensureDock();
        dock.visible = existed ? !dock.visible : true;
        if (dock.visible) {
            SketchScans.refresh();
            try {
                dock.raise();
            } catch (eRaise) {
                // tabbed dock that cannot front itself still shows
            }
        }
    } catch (e) {
        csSketchScansDock = undefined;
        warning("Sketch Scans: this CaveCAD build refused the docked " +
            "panel (" + e + ") -- please report this.");
    }
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

// Hover-tooltip preview width; the in-dock pane scales to itself.
SketchScans.PREVIEW_W = 420;
// The inserted scan's fade, percent (0 = full strength). Half, the
// basemap's value: an underlay must not out-shout the linework.
SketchScans.FADE_PERCENT = 50;
// The preview pane's STARTING height -- the user drags the splitter
// for more or less, and the drag is remembered here:
SketchScans.DOCK_PREVIEW_H = 240;
SketchScans.SETTING_SPLIT = "CaveSurvey/SketchScansSplitterSizes";
// The bookmark glyph. A trip's scans run to dozens of IMG_4021-shaped
// names and the panel re-reads the folder every time it is shown, so
// "where was I" is a real question with no other answer.
SketchScans.BOOKMARK = "\u2605";

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

// Writes the collapsed set back, keeping only folders the panel
// actually showed -- renamed or deleted trip folders fall out. Called
// on every fold/unfold: a dock has no closing moment to save on.
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

// This cave's bookmarks, from settings. Stored exactly like the
// collapsed set -- see CsScanTree.SETTING_BOOKMARKS for why those
// helpers are shared rather than copied.
SketchScans.loadBookmarks = function(scans) {
    try {
        var map = CsScanTree.parseCollapsed(
            RSettings.getStringValue(CsScanTree.SETTING_BOOKMARKS, ""));
        return CsScanTree.collapsedSetFor(map, scans);
    } catch (e) {
        return {};
    }
};

// Writes them back, keeping only scans the panel actually listed -- a
// bookmark on a scan that has been deleted or renamed falls out
// instead of accreting forever.
SketchScans.saveBookmarks = function(scans, bookmarks, rows) {
    try {
        var map = CsScanTree.parseCollapsed(
            RSettings.getStringValue(CsScanTree.SETTING_BOOKMARKS, ""));
        var valid = [];
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].kind === "file") { valid.push(rows[i].rel); }
        }
        CsScanTree.recordCollapsed(map, scans, bookmarks, valid);
        RSettings.setValue(CsScanTree.SETTING_BOOKMARKS,
            CsScanTree.serializeCollapsed(map));
    } catch (e) {
        // a bridge without RSettings just forgets the bookmarks
    }
};

// The text of one row: indentation by depth, a disclosure glyph on
// folder rows, a glyph-wide gap on file rows so labels at one depth
// line up across kinds.
SketchScans.rowText = function(row, collapsed, bookmarks) {
    var indent = new Array(row.depth + 1).join("  ");
    var marks = bookmarks || {};
    if (row.kind === "folder") {
        var folded = collapsed[row.rel] === true;
        // A COLLAPSED FOLDER CARRIES THE STAR of any bookmark inside
        // it. That is the case the mark is most needed in -- a bookmark
        // you cannot see is no use for finding your place -- and it
        // costs nothing while the folder is open, where the scan's own
        // row shows it instead.
        var buried = folded &&
            CsScanTree.folderHoldsBookmark(row.rel, marks);
        return indent + (folded ? "▸ " : "▾ ") + row.label +
            (buried ? "  " + SketchScans.BOOKMARK : "");
    }
    return indent + (marks[row.rel] === true ?
        SketchScans.BOOKMARK + " " : "  ") + row.label;
};

/** Builds the dock and hands it to the main window. Idempotent. */
SketchScans.ensureDock = function() {
    if (csSketchScansDock !== undefined && csSketchScansDock !== null) {
        return csSketchScansDock;
    }
    var appWin = RMainWindowQt.getMainWindow();
    csSketchScansDock = SketchScans.buildDock(appWin);
    appWin.addDockWidget(Qt.RightDockWidgetArea, csSketchScansDock);
    return csSketchScansDock;
};

SketchScans.buildDock = function(appWin) {
    var dock = new QDockWidget(qsTr("Sketch Scans"), appWin);
    // Without an objectName restoreState() cannot identify the dock and
    // silently forgets where it was.
    dock.objectName = "CaveSurveySketchScansDock";

    // Everything refresh() and the handlers need, in one place.
    var w = {
        rows: [],           // CsScanTree rows behind the table indices
        collapsed: {},      // this cave's collapsed set
        bookmarks: {},      // this cave's bookmarked scans
        scans: null,        // the scans folder the table was built from
        ready: false        // false while the panel shows a message
    };

    var body = new QWidget(dock);
    var layout = new QVBoxLayout();

    w.header = new QLabel("");
    try {
        w.header.wordWrap = true;
    } catch (eWrap) {
    }
    layout.addWidget(w.header, 0, 0);

    w.list = new QTableWidget(0, 1);
    try {
        w.list.horizontalHeader().visible = false;
        w.list.verticalHeader().visible = false;
        w.list.horizontalHeader().stretchLastSection = true;
        w.list.selectionBehavior = QAbstractItemView.SelectRows;
        w.list.editTriggers = QAbstractItemView.NoEditTriggers;
    } catch (eList) {
    }

    // The preview: a real CAD view over a scratch document holding just
    // the scan, so it zooms and pans (see ScanView.js). The old QLabel
    // stays as the fallback for a build that cannot embed a view, and
    // as the place messages go either way.
    w.preview = new QLabel("");
    try {
        w.preview.minimumHeight = 40;
        w.preview.alignment = Qt.AlignCenter;
    } catch (ePrev) {
    }

    w.previewPane = new QWidget();
    var previewLayout = new QVBoxLayout();
    try {
        previewLayout.setContentsMargins(0, 0, 0, 0);
    } catch (eMargins) {
    }
    w.scanView = CsScanPreview.build(w.previewPane);
    if (w.scanView !== null) {
        previewLayout.addWidget(w.scanView.view, 1, 0);
        var zoomRow = new QHBoxLayout();
        w.fitButton = new QPushButton(qsTr("Fit"));
        w.fitButton.toolTip = qsTr("Fit the whole scan in the pane.");
        w.zoomInButton = new QPushButton("+");
        w.zoomOutButton = new QPushButton("\u2212");
        try {
            w.zoomInButton.maximumWidth = 34;
            w.zoomOutButton.maximumWidth = 34;
            w.fitButton.maximumWidth = 50;
        } catch (eZw) {
        }
        zoomRow.addWidget(w.fitButton, 0, 0);
        zoomRow.addWidget(w.zoomOutButton, 0, 0);
        zoomRow.addWidget(w.zoomInButton, 0, 0);
        zoomRow.addStretch(1);
        previewLayout.addLayout(zoomRow, 0);
        w.fitButton.clicked.connect(function() {
            CsScanPreview.fit(w.scanView);
        });
        w.zoomInButton.clicked.connect(function() {
            CsScanPreview.zoom(w.scanView, 1.4);
        });
        w.zoomOutButton.clicked.connect(function() {
            CsScanPreview.zoom(w.scanView, 1 / 1.4);
        });
        // A click in the scan reports the pixel it landed on. This is
        // the groundwork for picking alignment stations off the scan
        // instead of off the drawing; for now it proves the click
        // arrives and says where.
        w.pickLabel = new QLabel("");
        try {
            w.pickLabel.toolTip = qsTr("The pixel last clicked on the " +
                "scan. Zoom in for a finer pick.");
        } catch (ePl) {
        }
        zoomRow.addWidget(w.pickLabel, 0, 0);
        w.scanView.view.onScanPick = function(point) {
            try {
                w.pickLabel.text = CsScanPreview.pixelText(point,
                    w.scanView.heightPx);
            } catch (ePick) {
            }
        };
        // the label is only for messages now
        w.preview.visible = false;
    }
    previewLayout.addWidget(w.preview, w.scanView === null ? 1 : 0, 0);
    w.previewPane.setLayout(previewLayout);

    // List over preview on a draggable splitter, so the preview is
    // whatever size the user wants it -- the drag is remembered, the
    // same way the Survey Notebook remembers its page/status split.
    w.splitter = new QSplitter(Qt.Vertical);
    w.splitter.addWidget(w.list);
    w.splitter.addWidget(w.previewPane);
    try {
        w.splitter.setStretchFactor(0, 3); // the list gets the growth
        w.splitter.setStretchFactor(1, 1);
    } catch (eSf) {
        // cosmetic
    }
    try {
        var savedSplit = RSettings.getStringValue(
            SketchScans.SETTING_SPLIT, "");
        var splitSizes = [];
        if (savedSplit.length > 0) {
            var splitParts = savedSplit.split(",");
            for (var si = 0; si < splitParts.length; si++) {
                splitSizes.push(parseInt(splitParts[si], 10));
            }
        }
        if (splitSizes.length === 2 &&
                !isNaN(splitSizes[0]) && !isNaN(splitSizes[1])) {
            w.splitter.setSizes(splitSizes);
        } else {
            // setSizes distributes PROPORTIONALLY when the panel is
            // smaller than the request -- [10000, 240] squeezed the
            // preview to its 40px floor. 3:1 keeps the preview about a
            // quarter of the panel at any size.
            w.splitter.setSizes([3 * SketchScans.DOCK_PREVIEW_H,
                SketchScans.DOCK_PREVIEW_H]);
        }
        w.splitter.splitterMoved.connect(function() {
            try {
                RSettings.setValue(SketchScans.SETTING_SPLIT,
                    w.splitter.sizes().join(","));
            } catch (eSave) {
            }
            // The pane changed size under the picture. The LABEL path
            // needs a rescale; the view path does not, and re-showing
            // would throw away the zoom the caver had just set.
            if (SketchScans.w !== undefined && SketchScans.w !== null &&
                    SketchScans.w.scanView === null) {
                SketchScans.showPreview();
            }
        });
    } catch (eSplit) {
        // bridge without sizes()/setSizes(): stretch factors stand
    }
    layout.addWidget(w.splitter, 1, 0);

    var buttons = new QHBoxLayout();
    w.bookmarkButton = new QPushButton(SketchScans.BOOKMARK);
    w.bookmarkButton.toolTip = qsTr("Bookmark the selected scan, so the " +
        "panel opens on it again. A bookmark inside a collapsed folder " +
        "puts the star on the folder instead.");
    try {
        w.bookmarkButton.maximumWidth = 34;
    } catch (eBw) {
        // a bridge that will not size it gets a wider button
    }
    w.refreshButton = new QPushButton(qsTr("Refresh"));
    w.refreshButton.toolTip = qsTr("Re-read the scans folder -- new " +
        "scans appear here once Drive has synced them.");
    w.alignButton = new QPushButton(qsTr("Insert && Align"));
    w.alignButton.toolTip = qsTr("Insert the selected scan over the " +
        "survey and start Align Image on it: pick two points on the " +
        "scan and their true positions, and it fits.");
    w.insertButton = new QPushButton(qsTr("Insert"));
    w.insertButton.toolTip = qsTr("Insert the selected scan over the " +
        "survey, unaligned.");
    buttons.addWidget(w.bookmarkButton, 0, 0);
    buttons.addWidget(w.refreshButton, 0, 0);
    buttons.addStretch(1);
    buttons.addWidget(w.alignButton, 0, 0);
    buttons.addWidget(w.insertButton, 0, 0);
    layout.addLayout(buttons, 0);

    body.setLayout(layout);
    dock.setWidget(body);
    SketchScans.w = w;

    var selectedFile = function() {
        var row = w.list.currentRow();
        if (row < 0 || row >= w.rows.length) { return null; }
        return w.rows[row].kind === "file" ? w.rows[row].rel : null;
    };

    var showMessage = function(text) {
        w.preview.text = text;
        try {
            w.preview.visible = (text !== "");
        } catch (eVis) {
        }
    };

    var showPreview = function() {
        var rel = selectedFile();
        showMessage("");
        try {
            w.preview.setPixmap(new QPixmap());
        } catch (eClear) {
        }

        if (w.scanView !== null) {
            if (rel === null || w.scans === null) {
                try {
                    w.scanView.di.clear();
                } catch (eEmpty) {
                }
                return;
            }
            try {
                w.pickLabel.text = "";
            } catch (eClearPick) {
            }
            if (!CsScanPreview.show(w.scanView, w.scans + "/" + rel)) {
                showMessage(qsTr("unreadable image"));
            }
            return;
        }

        // No embeddable view in this build: the scaled pixmap, as before.
        if (rel === null || w.scans === null) {
            return;
        }
        try {
            var pixmap = new QPixmap(w.scans + "/" + rel);
            if (pixmap.isNull()) {
                showMessage(qsTr("unreadable image"));
                return;
            }
            // Scale to the pane's ACTUAL size -- the user sets it with
            // the splitter handle and by resizing the dock.
            var paneW = Math.max(120, w.preview.width - 8);
            var paneH = Math.max(32, w.preview.height - 8);
            w.preview.setPixmap(pixmap.scaled(paneW, paneH,
                Qt.KeepAspectRatio, Qt.SmoothTransformation));
        } catch (e) {
            showMessage(qsTr("unreadable image"));
        }
    };

    var toggleFolder = function(rowIdx) {
        var row = w.rows[rowIdx];
        if (row === undefined || row.kind !== "folder") { return; }
        if (w.collapsed[row.rel] === true) {
            delete w.collapsed[row.rel];
        } else {
            w.collapsed[row.rel] = true;
        }
        try {
            w.list.item(rowIdx, 0).setText(
                SketchScans.rowText(row, w.collapsed, w.bookmarks));
        } catch (eGlyph) {
            // a stale glyph is cosmetic; the rows still fold
        }
        SketchScans.applyHidden();
        SketchScans.saveCollapsed(w.scans, w.collapsed, w.rows);
    };

    var chooseInsert = function(align) {
        var rel = selectedFile();
        if (rel === null || w.scans === null) { return; }
        var di = EAction.getDocumentInterface();
        var doc = EAction.getDocument();
        if (isNull(di) || isNull(doc)) { return; }
        // The active drawing can change under a dock. If it did, the
        // list belongs to some other cave: rebuild instead of dropping
        // one cave's sketch into another cave's map.
        var folder = CsCave.folderOf(doc.getFileName());
        var scansNow = folder === null ? null :
            CsCave.findSubfolder(folder, CsCave.SCANS);
        if (scansNow !== w.scans) {
            SketchScans.refresh();
            return;
        }
        var placed = SketchScans.insert(doc, di, w.scans + "/" + rel, rel);
        if (placed === null) {
            return;                 // insert already explained why
        }
        if (align) {
            SketchScans.alignSoon(placed);
        } else {
            EAction.handleUserMessage(rel + " inserted on " +
                CsLayers.CTRL_SCAN + ". Align Image fits it to the survey.");
        }
    };

    w.list.itemSelectionChanged.connect(showPreview);
    // Folder rows fold on a plain click.
    w.list.cellClicked.connect(function(row, col) { toggleFolder(row); });
    // Double-click by ROW: on a scan it inserts and aligns; on a folder
    // it does nothing more (the first click already toggled it) --
    // itemDoubleClicked alone would read the SELECTION and insert the
    // selected scan when a folder row was the thing double-clicked.
    try {
        w.list.cellDoubleClicked.connect(function(row, col) {
            if (w.rows[row] !== undefined && w.rows[row].kind === "file") {
                chooseInsert(true);
            }
        });
    } catch (eDbl) {
        // no row-aware double-click on this bridge; the buttons cover it
    }
    var toggleBookmark = function() {
        var rel = selectedFile();
        if (rel === null || w.scans === null) {
            return;
        }
        var row = w.list.currentRow();
        if (w.bookmarks[rel] === true) {
            delete w.bookmarks[rel];
        } else {
            w.bookmarks[rel] = true;
        }
        // Repaint every row, not just this one: a folder row's star
        // depends on what is bookmarked BENEATH it, so bookmarking a
        // scan can change an ancestor's text as well as its own.
        for (var r = 0; r < w.rows.length; r++) {
            try {
                w.list.item(r, 0).setText(
                    SketchScans.rowText(w.rows[r], w.collapsed, w.bookmarks));
            } catch (eText) {
                // a stale glyph is cosmetic; the bookmark still stands
            }
        }
        SketchScans.saveBookmarks(w.scans, w.bookmarks, w.rows);
        if (row >= 0) {
            w.list.selectRow(row);
        }
    };
    w.bookmarkButton.clicked.connect(toggleBookmark);
    w.refreshButton.clicked.connect(function() { SketchScans.refresh(); });
    w.alignButton.clicked.connect(function() { chooseInsert(true); });
    w.insertButton.clicked.connect(function() { chooseInsert(false); });

    // A re-shown dock re-reads the folder -- scans may have synced in
    // while it was hidden. Wrapped: not every bridge has the signal,
    // and without it the Refresh button covers the same ground.
    try {
        dock.visibilityChanged.connect(function(visible) {
            if (visible === true) {
                SketchScans.refresh();
            }
        });
    } catch (eVis) {
    }

    SketchScans.showPreview = showPreview;
    return dock;
};

// Everything between "panel is up" and "these are the scans": reads
// the ACTIVE drawing's cave folder and rebuilds the tree. Message
// states (no drawing, unsaved, no scans folder, nothing readable) land
// in the header label with the list empty and inserts disabled.
SketchScans.refresh = function() {
    var w = SketchScans.w;
    if (w === undefined || w === null) { return; }

    var message = null;
    var doc = EAction.getDocument();
    var scans = null;

    if (isNull(doc)) {
        message = qsTr("No drawing open.");
    } else {
        var folder = CsCave.folderOf(doc.getFileName());
        if (folder === null) {
            message = qsTr("Save the drawing first.\nThe scans live in " +
                "the cave project's scans/ folder, which sits beside " +
                "the drawing file.");
        } else {
            scans = CsCave.findSubfolder(folder, CsCave.SCANS);
            if (scans === null) {
                scans = CsCave.scansDir(doc.getFileName());
            }
            if (scans === null || !(new QDir(scans)).exists()) {
                message = qsTr("This cave has no scans/ folder yet.\n" +
                    "Put the sketch scans in ") +
                    CsCave.scansDir(doc.getFileName()) +
                    qsTr(" and press Refresh.");
                scans = null;
            }
        }
    }

    var files = [];
    if (message === null) {
        files = SketchScans.imageFiles(scans);
        if (files.length === 0) {
            message = qsTr("Nothing in ") + scans +
                qsTr(" reads as an image.\nScans in JPEG, PNG, TIFF " +
                "or HEIC all work.");
        }
    }

    w.scans = message === null ? scans : null;
    w.ready = message === null;
    // What this panel was built FROM -- the staleness listeners compare
    // against it and rebuild only when the answer would differ.
    w.stamp = (isNull(doc) ? "" : String(doc.getFileName())) + "|" +
        (scans === null ? "" : scans);
    w.alignButton.enabled = w.ready;
    w.insertButton.enabled = w.ready;

    if (!w.ready) {
        w.header.text = message;
        w.rows = [];
        w.collapsed = {};
        w.list.setRowCount(0);
        SketchScans.showPreview();
        return;
    }

    w.header.text = scans + "  —  " + files.length + " scan" +
        (files.length === 1 ? "" : "s") + qsTr(". Hover a scan for a " +
        "preview; double-click inserts and aligns; click a folder to " +
        "collapse it.");

    w.rows = CsScanTree.rowsOf(files);
    w.collapsed = SketchScans.loadCollapsed(scans);
    w.bookmarks = SketchScans.loadBookmarks(scans);

    w.list.setRowCount(w.rows.length);
    for (var i = 0; i < w.rows.length; i++) {
        var item = new QTableWidgetItem(
            SketchScans.rowText(w.rows[i], w.collapsed, w.bookmarks));
        if (w.rows[i].kind === "folder") {
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
                    w.rows[i].rel + "\" width=\"" +
                    SketchScans.PREVIEW_W + "\">");
            } catch (eTip) {
                // no hover preview on this bridge; the pane still works
            }
        }
        w.list.setItem(i, 0, item);
    }
    SketchScans.applyHidden();

    // Initial selection: the bookmark if there is a visible one -- that
    // is the whole point of it -- and otherwise the first visible scan.
    var landing = CsScanTree.firstBookmarkRow(w.rows, w.bookmarks,
        w.collapsed);
    if (landing < 0) {
        for (var s = 0; s < w.rows.length; s++) {
            if (w.rows[s].kind === "file" &&
                    !CsScanTree.isHidden(w.rows[s], w.collapsed)) {
                landing = s;
                break;
            }
        }
    }
    if (landing >= 0) {
        w.list.selectRow(landing);
        try {
            // selectRow alone does not bring a row into view in a long
            // list, which is exactly the list a bookmark exists for.
            w.list.scrollToItem(w.list.item(landing, 0));
        } catch (eScroll) {
            // no scrollToItem here: the row is still selected
        }
    }
    SketchScans.showPreview();
};

SketchScans.applyHidden = function() {
    var w = SketchScans.w;
    try {
        for (var r = 0; r < w.rows.length; r++) {
            w.list.setRowHidden(r,
                CsScanTree.isHidden(w.rows[r], w.collapsed));
        }
    } catch (eHide) {
        // an engine without setRowHidden shows the list flat
    }
};

// Rebuilds the panel ONLY when the active drawing (and with it the
// scans folder) is no longer the one the panel was built from -- the
// cheap fingerprint compare runs on every transaction and mouse move,
// the disk never gets touched until the answer would change.
SketchScans.refreshIfStale = function() {
    var w = SketchScans.w;
    if (w === undefined || w === null) { return; }
    if (csSketchScansDock === undefined || csSketchScansDock === null ||
            !csSketchScansDock.visible) {
        return;
    }
    var doc = EAction.getDocument();
    var scans = null;
    if (!isNull(doc)) {
        var folder = CsCave.folderOf(doc.getFileName());
        scans = folder === null ? null :
            CsCave.findSubfolder(folder, CsCave.SCANS);
    }
    var stamp = (isNull(doc) ? "" : String(doc.getFileName())) + "|" +
        (scans === null ? "" : scans);
    if (stamp !== w.stamp) {
        SketchScans.refresh();
    }
};

/**
 * Watches the application so a visible panel follows the active
 * drawing: a cave opened from the shelf, a tab switch, a first save.
 * Guarded to a fingerprint compare while hidden or unchanged -- a
 * dock must not make every transaction pay for a folder scan
 * (FeatureTrace's rule). Idempotent.
 */
SketchScans.installListener = function(appWin) {
    if (SketchScans.listener !== undefined) {
        return;
    }
    try {
        var adapter = new RTransactionListenerAdapter();
        appWin.addTransactionListener(adapter);
        adapter.transactionUpdated.connect(function(document, transaction) {
            try {
                SketchScans.refreshIfStale();
            } catch (eInner) {
                // a listener must never throw into the application
            }
        });
        SketchScans.listener = adapter;

        // Transactions alone miss a plain tab switch; the first mouse
        // move over the newly active drawing catches it.
        var coord = new RCoordinateListenerAdapter();
        appWin.addCoordinateListener(coord);
        coord.coordinateUpdated.connect(function(docIface) {
            try {
                SketchScans.refreshIfStale();
            } catch (eCoord) {
                // as above
            }
        });
        SketchScans.coordListener = coord;
    } catch (e) {
        SketchScans.listener = null;
        // without listeners the Refresh button and re-toggling cover it
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
        var data = new RImageData(
            path,
            new RVector(centerX - (pxW * unitsPerPixel) / 2.0,
                centerY - (pxH * unitsPerPixel) / 2.0),
            new RVector(unitsPerPixel, 0),
            new RVector(0, unitsPerPixel),
            pxW, pxH, 0);
        // Half faded, the basemap's treatment: at full strength the
        // scan out-shouts the linework being traced over it. Fade
        // survives the DXF round trip, and the property editor can
        // still change it per image.
        try {
            data.setFade(SketchScans.FADE_PERCENT);
        } catch (eFade) {
            // an engine without setFade gets a full-strength scan
        }
        entity = new RImageEntity(doc, data);
    } catch (e) {
        warning("Sketch Scans: creating the image entity failed: " + e);
        return null;
    }

    CsLayers.ensure(doc, di, CsLayers.CTRL_SCAN);
    // Layer, tag and draw order BEFORE adding -- post-add writes fail
    // silently in this bridge (see CsDraw.js's header).
    entity.setLayerId(doc.getLayerId(CsLayers.CTRL_SCAN));
    CsTags.set(entity, "SketchScan", name);
    // To the very back, under the survey linework -- the basemap's
    // call, one below getMinDrawOrder() because THIS entity is not in
    // storage yet and a tie at the minimum is not documented to
    // resolve in its favour. Without this the add operation's default
    // lands new entities ON TOP of everything (verified live).
    entity.setDrawOrder(doc.getStorage().getMinDrawOrder() - 1);

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
        CsLayers.CTRL_SCAN + " layer may be locked or frozen.");
    return null;
};

/**
 * Starts Align Image on the entity AFTER the click that asked for it
 * has fully unwound: selects it (selection does not dirty the
 * document), then a zero-delay timer -- outside the widget event, the
 * same reason FeatureTrace's dock buttons defer -- makes Align Image
 * the current action. With a selection standing, Align Image skips its
 * own entity-picking state and goes straight to the source point.
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
    action.setStatusTip(qsTr("Toggle the Sketch Scans panel: browse the " +
        "cave's scanned sketches with previews, insert one and align it " +
        "to the survey"));
    action.setDefaultCommands(["sketchscans", "ss"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(56);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);

    // Build the dock NOW, during add-on init: the main window's
    // readSettings()/restoreState() runs after init and can only place
    // (and re-show) a dock that already exists. Created hidden; the
    // saved window state decides whether it opens, exactly like QCAD's
    // own docks. First-ever run: stays hidden until the action shows it.
    try {
        var dock = SketchScans.ensureDock();
        dock.visible = false;
        SketchScans.installListener(RMainWindowQt.getMainWindow());
    } catch (eInit) {
        csSketchScansDock = undefined;
        warning("Sketch Scans: could not build the panel at startup (" +
            eInit + "); the menu entry will try again.");
    }
};
