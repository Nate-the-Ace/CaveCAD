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
include(includeBasePath + "/../SketchSection/SketchSection.js");
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
        // NOR IS A TRIMMED DERIVATIVE. It is a crop of a page already
        // in this list; showing both would offer the same sketch twice
        // and make the shelf grow with every trim. The filter belongs
        // HERE and not in CsCave.filesUnder, which the photo tools
        // share and which has no business knowing about this suite's
        // derivatives.
        if (CsScanTrim.isTrimPath(name)) {
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
// The COMPLETE tick. A trip's scans run to dozens of IMG_4021-shaped
// names, so "which of these have I already done" is a real question
// with no other answer.
SketchScans.COMPLETE = "\u2713";

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
SketchScans.rowText = function(row, collapsed, bookmarks, rows) {
    var indent = new Array(row.depth + 1).join("  ");
    var marks = bookmarks || {};
    if (row.kind === "folder") {
        var folded = collapsed[row.rel] === true;
        // A FOLDER IS TICKED WHEN EVERYTHING IN IT IS DONE -- open or
        // collapsed, since "this trip is finished" is worth seeing
        // either way. Ticking a folder that merely CONTAINS a finished
        // page would put the same mark on a trip with one page done as
        // on one with forty.
        var done = CsScanTree.folderComplete(row.rel, rows || [], marks);
        return indent + (folded ? "▸ " : "▾ ") + row.label +
            (done ? "  " + SketchScans.COMPLETE : "");
    }
    return indent + (marks[row.rel] === true ?
        SketchScans.COMPLETE + " " : "  ") + row.label;
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
        bookmarks: {},      // this cave's COMPLETED scans
        picking: null,      // an alignment in progress: {pairs, rel}
        trim: null,         // the trim choice for the selected scan:
                            // {rel, rect, path, chosen}; null before
                            // anything is selected

        calibrating: null,  // a section scale being set in the preview:
                            // {path, rel, station, lrud, from, to,
                            //  forced, cal}
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
        // THE TRIM BAR. Not an optional extra button: a scan is not
        // placeable until the caver has said which part of it they
        // mean. A page with one sketch on it costs one click ("Use
        // whole page") and nothing else; a page with three costs a
        // drag.
        var trimRow = new QHBoxLayout();
        w.trimLabel = new QLabel(qsTr("Trim: drag a box"));
        try {
            w.trimLabel.toolTip = qsTr("Drag a box round the sketch you " +
                "want. Only that part of the page is placed, so the " +
                "other sketches on it stay out of the drawing.");
        } catch (eTt) {
        }
        w.trimWholeButton = new QPushButton(qsTr("Use whole page"));
        w.trimWholeButton.toolTip = qsTr("Place the entire scanned " +
            "page, as before. Nothing is written to disk.");
        w.trimRedoButton = new QPushButton(qsTr("Redo box"));
        w.trimRedoButton.toolTip = qsTr("Forget this box and draw " +
            "another one.");
        trimRow.addWidget(w.trimLabel, 1, 0);
        trimRow.addWidget(w.trimWholeButton, 0, 0);
        trimRow.addWidget(w.trimRedoButton, 0, 0);
        previewLayout.addLayout(trimRow, 0);
        w.trimWholeButton.clicked.connect(function() {
            SketchScans.chooseWholePage();
        });
        w.trimRedoButton.clicked.connect(function() {
            SketchScans.resetTrim(true);
        });
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
                SketchScans.takePick(point);
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
    w.refreshButton = new QPushButton(qsTr("Refresh"));
    w.refreshButton.toolTip = qsTr("Re-read the scans folder -- new " +
        "scans appear here once Drive has synced them.");
    // ALIGN FIRST, THEN INSERT. The stations are picked on the scan in
    // the viewer above, so the fit is known before the image is placed
    // -- the caver never inserts a scan and then hunts for it in the
    // drawing to align it.
    w.pickAlignButton = new QPushButton(qsTr("Assign Stations to Scans"));
    w.pickAlignButton.toolTip = qsTr("Click each station on the scan " +
        "itself and say which station it is; the scan is then placed " +
        "already fitted. Zoom in first -- the fit is only as good as " +
        "the picks.");
    // THREE FRAMES, ONE CONTROL. A checkbox could say plan-or-profile
    // and nothing more; sections make that a third state, and a combo
    // always has a value to read rather than a click history to
    // reconstruct.
    w.frameCombo = new QComboBox();
    w.frameCombo.addItem(qsTr("Plan"));
    w.frameCombo.addItem(qsTr("Profile"));
    w.frameCombo.addItem(qsTr("Cross Section"));
    w.frameCombo.currentIndex = 0;
    w.frameCombo.toolTip = qsTr("Which view this scan is assigned to. " +
        "Profile assigns to the ELEVATION's own stations, on " +
        "CTRL-PROFILE-SCAN, following its band when the elevation is " +
        "redrawn. Cross Section assigns to the PLAN's stations -- a " +
        "section is cut at a plan station, not its own -- and lands on " +
        "CTRL-SECTION-SCAN.");
    // `activated`, not currentIndexChanged -- FeatureTrace's run combo
    // draws the same line for the same reason: currentIndexChanged
    // fires on a PROGRAMMATIC change too, and this handler must only
    // react to the caver actually choosing something.
    w.frameCombo.activated.connect(function() {
        // THE GATE OWNS THIS BUTTON NOW. Sketch Section needs a cross
        // section AND a trim choice; setting enabled here directly
        // would switch it on for an untrimmed scan.
        SketchScans.updateTrimGate();
    });
    w.alignButton = new QPushButton(qsTr("Insert && Align"));
    w.alignButton.toolTip = qsTr("Insert the selected scan over the " +
        "survey and start Align Image on it: pick two points on the " +
        "scan and their true positions, and it fits.");
    w.insertButton = new QPushButton(qsTr("Insert"));
    w.insertButton.toolTip = qsTr("Insert the selected scan over the " +
        "survey, unaligned.");
    // SKETCH SECTION IS GATED ON THE COMBO, not on the selected file --
    // a plan or profile scan has no ghost to trace onto, so the button
    // stays off until "Cross Section" is chosen, exactly the state the
    // combo starts in.
    w.sketchButton = new QPushButton(qsTr("Sketch Section"));
    w.sketchButton.enabled = false;
    w.sketchButton.toolTip = qsTr("Open a staging bay for the selected " +
        "scan: the computed cross section at a chosen plan station, " +
        "dashed, to scale the scan onto and trace by hand.");
    // THE CORRECTION, AS A COMBO RATHER THAN A RE-PICK. The letter is
    // INFERRED from the direction of the second click, and an inference
    // is occasionally wrong -- a wall that leans, a station drawn low in
    // its own outline. Making the caver re-click for that would punish
    // them for the tool's guess; the two clicks are still perfectly
    // good measurements of a pixel distance, and only the NAME attached
    // to that distance is in doubt. So the letter is the one thing that
    // can be changed after the fact, and changing it re-reads the same
    // two clicks against a different measurement.
    //
    // Hidden until there are two clicks to correct: an L/R/U/D combo
    // sitting there before anything is picked invites the caver to
    // choose a letter FIRST, which is a different (and worse) workflow
    // -- it would mean promising to click that particular wall.
    w.lrudCombo = new QComboBox();
    for (var li = 0; li < CsSectionBay.LRUD_LETTERS.length; li++) {
        w.lrudCombo.addItem(CsSectionBay.LRUD_LETTERS[li]);
    }
    w.lrudCombo.toolTip = qsTr("Which measurement the second click " +
        "touched. Change it if the guess was wrong -- the two clicks " +
        "stand, only the letter is re-read.");
    w.calibCancelButton = new QPushButton(qsTr("Cancel"));
    w.calibCancelButton.toolTip = qsTr("Abandon this calibration " +
        "without opening a bay.");
    try {
        w.lrudCombo.maximumWidth = 60;
        w.lrudCombo.visible = false;
        w.calibCancelButton.visible = false;
    } catch (eCalibHide) {
        // a bridge that cannot hide them shows two extra idle controls;
        // both are inert until a calibration is running
    }
    try {
        w.lrudCombo.activated.connect(function() {
            SketchScans.correctLetter();
        });
    } catch (eLrudConn) {
        // no correction on this bridge: the inferred letter stands, and
        // the caver can still open the bay unscaled and scale by hand
    }
    try {
        w.calibCancelButton.clicked.connect(function() {
            SketchScans.endCalibration();
        });
    } catch (eCancelConn) {
    }

    w.sketchButton.clicked.connect(function() {
        SketchScans.sketchClicked();
    });
    buttons.addWidget(w.refreshButton, 0, 0);
    buttons.addStretch(1);
    buttons.addWidget(w.frameCombo, 0, 0);
    buttons.addWidget(w.pickAlignButton, 0, 0);
    buttons.addWidget(w.alignButton, 0, 0);
    buttons.addWidget(w.insertButton, 0, 0);
    buttons.addWidget(w.lrudCombo, 0, 0);
    buttons.addWidget(w.calibCancelButton, 0, 0);
    buttons.addWidget(w.sketchButton, 0, 0);
    layout.addLayout(buttons, 0);

    body.setLayout(layout);
    dock.setWidget(body);
    SketchScans.w = w;
    // Nothing is selected yet, so nothing is placeable yet.
    SketchScans.updateTrimGate();

    var selectedFile = function() {
        var row = w.list.currentRow();
        if (row < 0 || row >= w.rows.length) { return null; }
        return w.rows[row].kind === "file" ? w.rows[row].rel : null;
    };
    // The trim functions live on SketchScans rather than in this
    // closure -- the buttons above are connected before they exist --
    // so they reach the selection through here.
    SketchScans.selectedRel = selectedFile;

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
                    w.scanView.band = null;
                } catch (eEmpty) {
                }
                SketchScans.w.trim = null;
                SketchScans.updateTrimGate();
                return;
            }
            try {
                w.pickLabel.text = "";
            } catch (eClearPick) {
            }
            if (w.picking !== null && w.picking.rel !== rel) {
                // another scan: the picks belonged to the old one
                w.picking = null;
                w.pickAlignButton.text = qsTr("Assign Stations to Scans");
            }
            // Likewise for a calibration: the two clicks are pixels on
            // ONE scan, and carrying them onto another would scale the
            // new sketch by the old one's page -- silently, and
            // plausibly enough to be traced before anyone noticed.
            if (w.calibrating !== null && w.calibrating.rel !== rel) {
                SketchScans.endCalibration();
            }
            if (!CsScanPreview.show(w.scanView, w.scans + "/" + rel)) {
                showMessage(qsTr("unreadable image"));
                SketchScans.w.trim = null;
                SketchScans.updateTrimGate();
                return;
            }
            // A NEW SCAN IS A NEW CHOICE. Carrying the last scan's box
            // onto this one would trim a different page to a rectangle
            // that meant something only on the old one.
            SketchScans.w.trim = { rel: rel, rect: null, path: null,
                                   chosen: false };
            SketchScans.resetTrim(false);
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
                SketchScans.rowText(row, w.collapsed, w.bookmarks, w.rows));
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
        var eff = SketchScans.effectivePath(rel);
        if (eff === null) { return; }
        var placed = SketchScans.insert(doc, di, eff.path, rel,
            frameNow(), eff.rect);
        if (placed === null) {
            return;                 // insert already explained why
        }
        if (align) {
            SketchScans.alignSoon(placed);
        } else {
            EAction.handleUserMessage(rel + " inserted on " +
                CsScanFrame.layerFor(frameNow()) +
                ". Align Image fits it to the survey.");
        }
    };

    /** The drawing's plotted stations, and the order to walk them. */
    /** Which view the picks are being taken in: the combo decides.
     *  ONE FRAME AT A TIME, deliberately -- offering the plan's
     *  stations and the elevation's together would double a list that
     *  is already long enough to hunt through. */
    var frameNow = function() {
        try {
            if (w.frameCombo === undefined || w.frameCombo === null) {
                return "plan";
            }
            switch (w.frameCombo.currentIndex) {
            case 1:  return "profile";
            case 2:  return "section";
            default: return "plan";
            }
        } catch (e) {
            return "plan";
        }
    };

    /** The places pickable in the current frame, in reading order. */
    var stationsNow = function() {
        var doc = EAction.getDocument();
        if (isNull(doc)) {
            return null;
        }
        try {
            var places = CsScanFrame.placesIn(doc,
                CsScanFrame.stationFrameFor(frameNow()));
            if (places.length === 0) {
                return null;
            }
            // Reading order -- A1, A2, A9, A10 -- so a name is found by
            // reading rather than hunted for.
            places.sort(function(a, b) {
                return CsStationOrder.naturalCompare(a.label, b.label);
            });
            var labels = [];
            for (var i = 0; i < places.length; i++) {
                labels.push(places[i].label);
            }
            return { places: places, names: labels };
        } catch (e) {
            return null;
        }
    };

    /** The place one offered label belongs to. */
    var placeOfLabel = function(ctx, label) {
        for (var i = 0; i < ctx.places.length; i++) {
            if (ctx.places[i].label === label) {
                return ctx.places[i];
            }
        }
        return null;
    };

    var pickStatus = function(text) {
        try {
            w.pickLabel.text = text;
        } catch (e) {
        }
    };

    /** Every pick so far, and what to do next. */
    var refreshPickState = function() {
        if (w.picking === null) {
            w.pickAlignButton.text = qsTr("Assign Stations to Scans");
            return;
        }
        var n = w.picking.pairs.length;
        w.pickAlignButton.text = (n >= 2) ?
            qsTr("Place (%1 stations)").arg(n) : qsTr("Cancel");
        pickStatus(n === 0 ?
            qsTr("Click station 1 on the scan") :
            qsTr("%1 picked -- click another, or Place").arg(n));
    };

    // =================================================================
    // SETTING A SECTION'S SCALE IN THE PREVIEW.
    //
    // A cross-section scan has no scale. The station it is cut at DOES:
    // its LRUD says how far the wall, floor and ceiling really are. So
    // the scale is one division -- a known distance over the pixels it
    // covers on the page -- and both halves are available here, before
    // anything is placed in the drawing.
    //
    // WHY IN THE DOCK RATHER THAN IN THE CAD VIEW. The bay used to open
    // auto-fitted to the ghost's width and the caver rescaled the scan
    // by hand over the outline. That is fitting by eye against a
    // reference, over a faded image, with the mouse -- and it is the
    // step of this workflow that takes longest and is easiest to get
    // wrong. Two clicks on the scan itself, at whatever zoom makes the
    // marks readable, is the same information measured instead of
    // judged. The station must be chosen FIRST, because the station is
    // where the known distance comes from.
    // =================================================================

    /** The station's LRUD read as the caver would say it, for a
     *  readout: "L 4.5  R 3  U 11  D 2", or "" when nothing is known. */
    var lrudText = function(lrud) {
        var parts = [];
        for (var i = 0; i < CsSectionBay.LRUD_LETTERS.length; i++) {
            var letter = CsSectionBay.LRUD_LETTERS[i];
            var d = CsSectionBay.lrudDistance(lrud, letter);
            if (d !== null) {
                parts.push(letter + " " + (Math.round(d * 100) / 100));
            }
        }
        return parts.join("  ");
    };

    /** What the panel says about the calibration as it stands, and what
     *  the Sketch Section button offers to do next. */
    var refreshCalibState = function() {
        var c = w.calibrating;
        try {
            w.lrudCombo.visible = (c !== null && c.to !== null);
            w.calibCancelButton.visible = (c !== null);
        } catch (eVis) {
        }
        if (c === null) {
            try {
                w.sketchButton.text = qsTr("Sketch Section");
                w.frameCombo.enabled = true;
            } catch (eIdle) {
            }
            // THE GATE HAS THE LAST WORD on the placement buttons: an
            // idle calibration is not a reason to offer a placement for
            // a scan nobody has trimmed yet.
            SketchScans.updateTrimGate();
            return;
        }
        // Locked for the same reason the alignment locks them: the
        // station and the frame belong to THIS calibration, not to
        // whatever the panel is set to by the time the bay opens.
        try {
            w.pickAlignButton.enabled = false;
            w.frameCombo.enabled = false;
            w.sketchButton.enabled = true;
        } catch (eLock) {
        }
        var known = lrudText(c.lrud);
        if (c.from === null) {
            pickStatus(qsTr("%1: click the STATION point on the scan")
                .arg(c.station) + (known === "" ? "" : "  (" + known + ")"));
        } else if (c.to === null) {
            pickStatus(qsTr("Now click a wall on the outline -- above " +
                "for U, below for D, left for L, right for R"));
        } else if (c.cal !== null && c.cal.refused === "nolrud") {
            pickStatus(qsTr("%1 has no %2 measured, so it cannot set a " +
                "scale. Pick another letter, or open the bay unscaled.")
                .arg(c.station).arg(String(c.cal.letter)) +
                (known === "" ? "" : "  (" + known + ")"));
        } else if (c.cal !== null && c.cal.refused !== undefined) {
            pickStatus(qsTr("Those two clicks are the same point -- " +
                "click the station, then a wall."));
        } else if (c.cal !== null) {
            // WHAT IT MEASURED AND WHAT FELL OUT OF IT, both. The
            // distance alone does not say whether the pick was any
            // good; the units-per-pixel is the number that is about to
            // place the scan, so it is the one the caver can sanity-
            // check against the other scans in this cave.
            pickStatus(qsTr("%1 = %2 over %3 px  --  %4 units/pixel")
                .arg(String(c.cal.letter))
                .arg(Math.round(c.cal.distance * 100) / 100)
                .arg(Math.round(c.cal.pixels))
                .arg(Math.round(c.cal.unitsPerPixel * 100000) / 100000) +
                (c.cal.inferred === true ? "" : qsTr("  (corrected)")));
        }
        try {
            w.sketchButton.text = (c.cal !== null &&
                c.cal.refused === undefined) ?
                qsTr("Open Bay (scaled)") : qsTr("Open Bay (unscaled)");
        } catch (eText) {
        }
    };

    /** Re-read the two clicks, against the letter now in force. */
    var recalibrate = function() {
        var c = w.calibrating;
        if (c === null || c.from === null || c.to === null) {
            return;
        }
        c.cal = CsSectionBay.calibrationFrom(c.from, c.to, c.lrud,
            CsSectionDraw.scaleOf(), c.forced);
        // The combo follows the letter in force, so the caver is
        // correcting FROM the guess rather than from whatever the combo
        // happened to be left on.
        try {
            var letter = String(c.cal.letter);
            for (var i = 0; i < CsSectionBay.LRUD_LETTERS.length; i++) {
                if (CsSectionBay.LRUD_LETTERS[i] === letter) {
                    w.lrudCombo.currentIndex = i;
                }
            }
        } catch (eSync) {
        }
    };

    /** A left-click on the scan while a calibration is running. */
    var takeCalibrationPick = function(point) {
        var c = w.calibrating;
        // A THIRD CLICK STARTS OVER rather than being ignored. Once
        // there is a readout the caver can see whether the pair was any
        // good, and "click the station again" is the obvious way to
        // redo it -- there is no other gesture that would mean anything
        // at that moment.
        if (c.from === null || c.to !== null) {
            c.from = { x: point.x, y: point.y };
            c.to = null;
            c.cal = null;
            c.forced = null;
        } else {
            c.to = { x: point.x, y: point.y };
            recalibrate();
        }
        refreshCalibState();
    };

    /** The caver disagrees with the inferred letter. */
    var correctLetter = function() {
        if (w.calibrating === null) {
            return;
        }
        try {
            w.calibrating.forced =
                CsSectionBay.LRUD_LETTERS[w.lrudCombo.currentIndex];
        } catch (e) {
            return;
        }
        recalibrate();
        refreshCalibState();
    };

    /** Put the panel back to idle, calibrated or not. */
    var endCalibration = function() {
        w.calibrating = null;
        refreshCalibState();
        pickStatus("");
    };

    /** Open the bay with whatever the calibration came to. */
    var openCalibratedBay = function() {
        var c = w.calibrating;
        if (c === null) {
            return;
        }
        // A REFUSED CALIBRATION IS NOT A FAILURE, it is the old
        // behaviour: null here means SketchSection auto-fits exactly as
        // it always did, and the caver scales by hand over the ghost.
        var cal = (c.cal !== null && c.cal !== undefined &&
            c.cal.refused === undefined && c.cal.unitsPerPixel > 0) ?
            { unitsPerPixel: c.cal.unitsPerPixel } : null;
        var path = c.path;
        var station = c.station;
        endCalibration();
        SketchScans.sketchSoon(path, station, cal);
    };

    /** The Sketch Section button: start a calibration, or finish one. */
    var sketchClicked = function() {
        if (w.calibrating !== null) {
            openCalibratedBay();
            return;
        }
        if (w.picking !== null) {
            return;               // an alignment owns the clicks already
        }
        var rel = selectedFile();
        if (rel === null || w.scans === null) {
            return;
        }
        var effSketch = SketchScans.effectivePath(rel);
        if (effSketch === null) {
            return;
        }
        var path = effSketch.path;
        // NO PREVIEW VIEW, NO CALIBRATION. A build that could not embed
        // the CAD view (CsScanPreview.build returned null) has nowhere
        // to take the two clicks, and the bay is still worth opening --
        // so it opens the way it always has rather than not at all.
        if (w.scanView === null) {
            SketchScans.sketchSoon(path);
            return;
        }
        var doc = EAction.getDocument();
        if (isNull(doc)) {
            return;
        }
        // THE STATION FIRST, always. The whole calibration is one
        // division by the station's own LRUD, so there is nothing to
        // measure until it is known which station that is -- and
        // choosing it afterwards would let the caver take two careful
        // clicks and then find the station has no measurement for them.
        var station = SketchSection.askStation(doc);
        if (station === null) {
            return;                       // cancelled: nothing starts
        }
        var lrud = SketchSection.lrudAt(doc, station);
        if (lrud === null) {
            // Nothing to calibrate against. Said out loud rather than
            // silently skipped: the caver is about to be handed the
            // hand-scaling workflow and should know why.
            warning("Sketch Scans: " + station + " has no LRUD in this " +
                "drawing's survey, so there is no known distance to set " +
                "a scale from. The bay opens auto-fitted; scale the scan " +
                "by hand over the ghost.");
            SketchScans.sketchSoon(path, station, null);
            return;
        }
        w.calibrating = { path: path, rel: rel, station: station,
                          lrud: lrud, from: null, to: null,
                          forced: null, cal: null };
        refreshCalibState();
    };

    /** A left-click on the scan while an alignment is running. */
    var takePick = function(point) {
        if (w.calibrating !== null) {
            takeCalibrationPick(point);
            return;
        }
        if (w.picking === null) {
            // not aligning: the click is just a readout
            pickStatus(CsScanPreview.pixelText(point, w.scanView.heightPx));
            return;
        }
        var ctx = stationsNow();
        if (ctx === null) {
            warning("Sketch Scans: this drawing has no " +
                (frameNow() === "profile" ? "elevation stations" :
                    "plotted stations") + " to assign.");
            w.picking = null;
            refreshPickState();
            return;
        }
        // used by LABEL, not name: in the elevation the same name is a
        // different place in each band it ties into
        var used = {};
        for (var i = 0; i < w.picking.pairs.length; i++) {
            used[w.picking.pairs[i].label] = true;
        }
        var offer = [];
        for (var k = 0; k < ctx.names.length; k++) {
            if (used[ctx.names[k]] !== true) {
                offer.push(ctx.names[k]);
            }
        }
        if (offer.length === 0) {
            warning("Sketch Scans: every plotted station is already on " +
                "this scan.");
            return;
        }
        // THE NEXT STATION IN ORDER IS ALREADY SELECTED, so a run down
        // a passage is Enter, Enter, Enter and only the exceptions cost
        // a choice. "Next" means the first unused name after the last
        // one picked, in the same reading order the list is offered in.
        var start = 0;
        if (w.picking.pairs.length > 0) {
            var last = w.picking.pairs[w.picking.pairs.length - 1].label;
            var from = -1;
            for (var f = 0; f < ctx.names.length; f++) {
                if (ctx.names[f] === last) { from = f; break; }
            }
            for (var g = from + 1; g < ctx.names.length; g++) {
                if (used[ctx.names[g]] !== true) {
                    for (var h = 0; h < offer.length; h++) {
                        if (offer[h] === ctx.names[g]) { start = h; break; }
                    }
                    break;
                }
            }
        }
        // A DIALOG INSTANCE, NOT QInputDialog.getItem. The static
        // convenience function's C++ signature reports Cancel through an
        // `ok` OUT-PARAMETER, and this binding drops it -- so Cancel
        // returned the selected station exactly as OK did, and there was
        // no way to tell the two apart. Cancel simply did not work.
        //
        // An instance carries the answer in its own result: exec()
        // returns QDialog.Accepted only when the caver pressed OK.
        var chosen = null;
        try {
            var dlg = new QInputDialog(RMainWindowQt.getMainWindow());
            dlg.windowTitle = qsTr("Assign Stations to Scans");
            dlg.setLabelText(qsTr("Which station did you just click?"));
            // The station list itself, so a name cannot be mistyped and
            // one already used cannot be offered twice.
            dlg.setComboBoxEditable(false);
            dlg.setComboBoxItems(offer);
            if (start >= 0 && start < offer.length) {
                dlg.setTextValue(offer[start]);
            }
            if (dlg.exec() !== QDialog.Accepted) {
                return;                   // cancelled: the pick is dropped
            }
            chosen = dlg.textValue();
        } catch (eDlg) {
            chosen = null;
        }
        if (chosen === null || chosen === undefined || chosen === "") {
            return;                       // nothing chosen, nothing recorded
        }
        var place = placeOfLabel(ctx, String(chosen));
        if (place === null) {
            return;
        }
        w.picking.pairs.push({
            name: place.name,
            label: place.label,
            run: place.run,
            source: { x: point.x, y: point.y },
            dest: { x: place.pos.x, y: place.pos.y }
        });
        // The frame is fixed by the FIRST pick, so a scan cannot end up
        // fitted to half a plan and half an elevation.
        if (w.picking.frame === undefined || w.picking.frame === null) {
            w.picking.frame = frameNow();
        }
        refreshPickState();
    };

    /** Place the scan using the picks. */
    var placeAligned = function() {
        var di = EAction.getDocumentInterface();
        var doc = EAction.getDocument();
        if (isNull(doc) || isNull(di) || w.picking === null) {
            return;
        }
        var fit = CsScanFit.fit(w.picking.pairs);
        if (fit === null) {
            warning("Sketch Scans: those picks do not describe a fit -- " +
                "two stations in different places on the scan are the " +
                "least it takes.");
            return;
        }
        // A MIRRORED FIT IS NOT PLACED AT ALL. It lays the scan down
        // backwards, and it is never what a caver meant: the picks wind
        // one way on the scan and the other way in the drawing, so at
        // least one is on the wrong mark or carries the wrong name.
        // This used to warn and then place it anyway, which left the
        // caver to undo a scan the tool already knew was wrong.
        if (CsScanFit.isMirrored(fit.matrix)) {
            var which = "";
            if (w.picking.pairs.length >= 4) {
                var mres = CsScanFit.residuals(w.picking.pairs, fit.matrix);
                which = "\n\nThe worst-fitting pick is " +
                    w.picking.pairs[mres.worstIndex - 1].name + ".";
            } else {
                which = "\n\nWith " + w.picking.pairs.length +
                    " picks the fit passes through all of them exactly, " +
                    "so it cannot say WHICH one is wrong. A fourth " +
                    "station is the first one it can disagree with.";
            }
            warning("Sketch Scans: these picks would lay the scan down " +
                "MIRRORED -- backwards, as if read through the paper." +
                "\n\nThey wind one way on the scan and the other way in " +
                "the drawing, so at least one is on the wrong mark or " +
                "has the wrong name." + which +
                "\n\nNothing has been placed. Cancel Align and re-pick.");
            return;
        }
        // Read the residuals BEFORE clearing the picks -- they are the
        // only report the caver gets on whether the fit is any good.
        var pairs = w.picking.pairs;
        var rel = w.picking.rel;
        var frame = CsScanFrame.normaliseKind(w.picking.frame);
        var res = CsScanFit.residuals(pairs, fit.matrix);
        // BEFORE placing: once the new scan is in, it would be counted
        // among the neighbours it is being judged against.
        var neighbours = SketchScans.placedScales(doc);
        var scale = CsScanFit.scaleOutlier(
            CsScanFit.describe(fit.matrix).unitsPerPixel, neighbours);
        // THE PREVIEW IS WHAT WAS PICKED ON. Once a box is set the
        // preview holds the DERIVATIVE, so the picked pixels and
        // heightPx are already in the crop's own space and the fit
        // needs no adjustment -- only the rect has to be recorded.
        var effFit = SketchScans.effectivePath(rel);
        if (effFit === null) { return; }
        var placed = SketchScans.insertFitted(doc, di,
            effFit.path, rel, fit, w.scanView.heightPx, pairs,
            frame, effFit.rect);
        w.picking = null;
        try {
            w.frameCombo.enabled = true;
        } catch (eUnlock) {
        }
        refreshPickState();
        pickStatus("");
        if (placed !== null) {
            // WHAT THE FIT ACTUALLY DID, in numbers -- and a warning
            // when the numbers say it cannot be right.
            //
            // THE RESIDUALS PROVE NOTHING at two or three picks: two
            // pairs fit a similarity exactly and three fit an affine
            // exactly, whichever station was called which. "Off by 0"
            // there is arithmetic, not evidence. What CAN be checked is
            // the shape of the answer.
            // THE PLACEMENT, CHECKED AGAINST QCAD'S OWN MAPPING. Every
            // anchor is run back through the placed image's
            // mapFromImage and compared with the station it was picked
            // for. This is the one measurement that separates "the
            // picks were wrong" from "the placement is wrong": if the
            // picks land on their stations, the tool did what it was
            // told and the picks are the thing to look at.
            try {
                var back = doc.queryEntity(placed);
                var worstBack = 0, worstName = "";
                if (!isNull(back)) {
                    var bd = back.getData();
                    for (var b = 0; b < pairs.length; b++) {
                        var got = bd.mapFromImage(new RVector(
                            pairs[b].source.x, pairs[b].source.y));
                        var ex = got.x - pairs[b].dest.x;
                        var ey = got.y - pairs[b].dest.y;
                        var miss = Math.sqrt(ex * ex + ey * ey);
                        if (miss > worstBack) {
                            worstBack = miss;
                            worstName = pairs[b].name;
                        }
                    }
                    if (worstBack > 0.01) {
                        warning("Sketch Scans: the placed scan does not " +
                            "put " + worstName + " where the drawing has " +
                            "it -- out by " +
                            (Math.round(worstBack * 100) / 100) +
                            ". That is a placement fault, not a bad pick; " +
                            "please report it.");
                    } else {
                        EAction.handleUserMessage(qsTr("Placement " +
                            "verified: every picked station lands on its " +
                            "own point in the drawing."));
                    }
                }
            } catch (eVerify) {
                // the check is a courtesy; a scan that placed is placed
            }

            var d = CsScanFit.describe(fit.matrix);
            var turn = Math.round(d.turnDeg * 10) / 10;
            EAction.handleUserMessage("Cross-check: " +
                (Math.round(d.unitsPerPixel * 10000) / 10000) +
                " units per pixel, turned " + turn + " degrees" +
                (fit.kind === "affine" ? (", stretch " +
                    (Math.round(d.stretch * 100) / 100)) : "") + ".");
            if (scale.outlier === true) {
                warning("Sketch Scans: this scan has landed " +
                    (scale.ratio > 1 ?
                        (Math.round(scale.ratio * 10) / 10) + " times LARGER" :
                        (Math.round(10 / scale.ratio) / 10) + " times SMALLER") +
                    " than the scans already in this drawing.\n\nOne " +
                    "cave's sketches are drawn at one or two scales, so " +
                    "that usually means a station was picked in the " +
                    "wrong place or named as the wrong station. Undo and " +
                    "check the picks.");
            } else if (fit.thin === true) {
                warning("Sketch Scans: those stations lie too close to a " +
                    "straight line for a stretch-and-skew fit to mean " +
                    "anything -- across the line it would be guessing, " +
                    "and guessing there is what turns a scan sideways." +
                    "\n\nThe scan has been moved, turned and resized to " +
                    "the two furthest-apart picks instead, keeping its " +
                    "shape. For a fit that can correct a scanner's " +
                    "stretch, pick a station well OFF the line of the " +
                    "others.");
            } else if (pairs.length <= 3) {
                EAction.handleUserMessage(qsTr("Note: %1 picks always " +
                    "fit exactly, so a zero miss proves nothing. Add a " +
                    "fourth station to have the fit check itself.")
                    .arg(pairs.length));
            }
            EAction.handleUserMessage(rel + qsTr(" placed on ") +
                CsScanFrame.layerFor(frame) + qsTr(" from %1 stations, %2. ")
                    .arg(pairs.length).arg(how) +
                qsTr("Worst station is off by %1; the average is %2.")
                    .arg(Math.round(res.worst * 100) / 100)
                    .arg(Math.round(res.average * 100) / 100));
        }
    };

    w.pickAlignButton.clicked.connect(function() {
        if (w.calibrating !== null) {
            return;               // a calibration owns the clicks already
        }
        if (w.picking !== null) {
            if (w.picking.pairs.length >= 2) {
                placeAligned();
            } else {
                w.picking = null;
                refreshPickState();
                pickStatus("");
            }
            return;
        }
        var rel = selectedFile();
        if (rel === null || w.scans === null || w.scanView === null) {
            return;
        }
        if (stationsNow() === null) {
            warning("Sketch Scans: this drawing has no plotted stations " +
                "to align to. Draw the survey first.");
            return;
        }
        w.picking = { pairs: [], rel: rel, frame: null };
        try {
            // locked while picks are being taken: the frame belongs to
            // the set of picks, not to whatever the combo says later
            w.frameCombo.enabled = false;
        } catch (eLock) {
        }
        refreshPickState();
    });

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
    var toggleBookmark = function(row) {
        if (row === undefined || row === null) {
            row = w.list.currentRow();
        }
        if (row < 0 || row >= w.rows.length ||
                w.rows[row].kind !== "file" || w.scans === null) {
            return;
        }
        var rel = w.rows[row].rel;
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
                    SketchScans.rowText(w.rows[r], w.collapsed, w.bookmarks, w.rows));
            } catch (eText) {
                // a stale glyph is cosmetic; the bookmark still stands
            }
        }
        SketchScans.saveBookmarks(w.scans, w.bookmarks, w.rows);
        if (row >= 0) {
            w.list.selectRow(row);
        }
    };
    // The bookmark lives on the RIGHT-CLICK now, not on a button: it is
    // a per-scan action and it belongs on the scan, not in a row of
    // controls that apply to the panel.
    //
    // The menu acts on the row that was RIGHT-CLICKED, which is
    // selected first. Acting on the current selection instead would
    // bookmark whatever happened to be highlighted when the caver
    // right-clicked somewhere else -- silently, and on the wrong scan.
    try {
        w.list.contextMenuPolicy = Qt.CustomContextMenu;
        w.list.customContextMenuRequested.connect(function(pos) {
            try {
                // QPoint's x and y are FUNCTIONS in this bridge, not
                // properties (probed 2026-08-29). Reading pos.y would
                // hand rowAt a function object, and the menu would
                // silently never find a row.
                var py = (typeof pos.y === "function") ? pos.y() : pos.y;
                var row = w.list.rowAt(py);
                if (row === undefined || row === null || row < 0 ||
                        row >= w.rows.length ||
                        w.rows[row].kind !== "file") {
                    return;          // a folder row has nothing to bookmark
                }
                w.list.selectRow(row);
                var rel = w.rows[row].rel;
                var marked = w.bookmarks[rel] === true;
                // Kept on `w` so it is not collected while it is open --
                // popup() returns immediately, unlike exec().
                w.scanMenu = new QMenu();
                var act = w.scanMenu.addAction(marked ?
                    qsTr("Mark Incomplete") :
                    qsTr("Mark Complete"));
                try {
                    act.checkable = true;
                    act.checked = marked;
                } catch (eChk) {
                }
                act.triggered.connect(function() {
                    toggleBookmark(row);
                });
                w.scanMenu.popup(w.list.viewport().mapToGlobal(pos));
            } catch (eMenu) {
                // no context menu on this bridge: the scan is still
                // selectable and insertable, only the bookmark is out
                // of reach
            }
        });
    } catch (eCtx) {
    }
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
    SketchScans.takePick = takePick;
    SketchScans.sketchClicked = sketchClicked;
    SketchScans.correctLetter = correctLetter;
    SketchScans.endCalibration = endCalibration;
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
    w.alignButton.enabled = false;
    w.insertButton.enabled = false;
    // A REBUILT PANEL HAS NO SELECTION, so it has no trim choice
    // either; the gate turns the placement buttons back on when one is
    // made. Setting them from w.ready alone would offer a placement for
    // whatever row the table happens to restore.
    w.trim = null;
    SketchScans.updateTrimGate();

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
            SketchScans.rowText(w.rows[i], w.collapsed, w.bookmarks, w.rows));
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

    // Initial selection: the first scan still to do. A mark meaning
    // "finished" is not a place to return to -- the last thing you
    // finished is the one scan with no work left on it.
    var landing = CsScanTree.firstIncompleteRow(w.rows, w.bookmarks,
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
 * WHICH FILE THE PLACEMENT ACTUALLY USES.
 *
 * The one accessor every placement path goes through -- Insert,
 * Insert & Align, Assign Stations to Scans and Sketch Section. A path
 * built by hand anywhere else is a path that will still place the whole
 * page after the caver drew a box.
 *
 * \return { path: <absolute>, rel: <page-relative>, rect: <box|null> },
 *         or null when nothing is selected.
 */
SketchScans.effectivePath = function(rel) {
    var w = SketchScans.w;
    if (w === undefined || w === null || w.scans === null ||
            rel === null || rel === undefined) {
        return null;
    }
    if (w.trim !== null && w.trim !== undefined && w.trim.rel === rel &&
            w.trim.rect !== null && w.trim.rect !== undefined &&
            w.trim.path !== null && w.trim.path !== undefined) {
        return { path: w.trim.path, rel: rel, rect: w.trim.rect };
    }
    return { path: w.scans + "/" + rel, rel: rel, rect: null };
};

/**
 * Back to "no choice made yet" for the selected scan: the page in the
 * preview, the band gone, the box armed and the placement buttons off.
 *
 * \param reload true when the preview is showing a derivative and has
 *        to go back to the page.
 */
SketchScans.resetTrim = function(reload) {
    var w = SketchScans.w;
    if (w === undefined || w === null) {
        return;
    }
    var rel = (w.trim !== null && w.trim !== undefined) ? w.trim.rel :
        SketchScans.selectedRel();
    w.trim = (rel === null || rel === undefined) ? null :
        { rel: rel, rect: null, path: null, chosen: false };
    try {
        if (reload === true && rel !== null && rel !== undefined &&
                w.scans !== null && w.scanView !== null) {
            CsScanPreview.show(w.scanView, w.scans + "/" + rel);
        }
        if (w.scanView !== null) {
            CsScanPreview.armBox(w.scanView, function(box) {
                SketchScans.boxDrawn(box);
            });
        }
        w.trimLabel.text = qsTr("Trim: drag a box");
    } catch (e) {
        // a bridge that cannot relabel still gates on the state below
    }
    SketchScans.updateTrimGate();
};

/** The whole page, deliberately -- no file written, the original path
 *  used, exactly what this tool did before trimming existed. */
SketchScans.chooseWholePage = function() {
    var w = SketchScans.w;
    if (w === undefined || w === null) {
        return;
    }
    var rel = SketchScans.selectedRel();
    if (rel === null || rel === undefined) {
        return;
    }
    w.trim = { rel: rel, rect: null, path: null, chosen: true };
    try {
        CsScanPreview.armBox(w.scanView, null);
        w.trimLabel.text = qsTr("Trim: whole page");
    } catch (e) {
    }
    SketchScans.updateTrimGate();
};

/**
 * A finished drag: normalise it, write the derivative, and show it.
 *
 * A FAILED WRITE LEAVES THE BUTTONS OFF. Falling back to the page here
 * would place the very clutter the caver just boxed away, without
 * saying so.
 */
SketchScans.boxDrawn = function(box) {
    var w = SketchScans.w;
    if (w === undefined || w === null || w.scanView === null) {
        return;
    }
    var rel = SketchScans.selectedRel();
    if (rel === null || rel === undefined || w.scans === null) {
        return;
    }
    var rect = CsScanTrim.rectFromPicks(box.a, box.b,
        w.scanView.widthPx, w.scanView.heightPx);
    if (rect === null) {
        try {
            CsScanPreview.clearBand(w.scanView);
            w.trimLabel.text = qsTr("Trim: that box is too small -- " +
                "drag a bigger one");
        } catch (eSmall) {
        }
        return;
    }
    // A box round the whole page is not a crop. Writing a byte-for-byte
    // copy of the scan and placing that would leave a derivative behind
    // for nothing.
    if (CsScanTrim.isWholePage(rect, w.scanView.widthPx,
            w.scanView.heightPx)) {
        SketchScans.chooseWholePage();
        return;
    }
    var res = CsScanTrim.write(w.scans, rel, rect);
    if (res.path === null) {
        try {
            w.trimLabel.text = qsTr("Trim failed");
        } catch (eLbl) {
        }
        warning("Sketch Scans: " + res.error);
        return;
    }
    w.trim = { rel: rel, rect: rect, path: res.path, chosen: true };
    try {
        CsScanPreview.armBox(w.scanView, null);
        CsScanPreview.show(w.scanView, res.path);
        w.trimLabel.text = qsTr("Trim: ") + rect.w + " \u00d7 " +
            rect.h + qsTr(" px");
    } catch (eShow) {
    }
    SketchScans.updateTrimGate();
};

/** The placement controls follow the trim choice. Sketch Section keeps
 *  its own extra condition: a plan or profile scan has no ghost to
 *  trace onto. */
SketchScans.updateTrimGate = function() {
    var w = SketchScans.w;
    if (w === undefined || w === null) {
        return;
    }
    var chosen = (w.trim !== null && w.trim !== undefined &&
        w.trim.chosen === true);
    try {
        w.pickAlignButton.enabled = chosen;
        w.alignButton.enabled = chosen;
        w.insertButton.enabled = chosen;
        w.trimRedoButton.enabled = chosen;
        w.sketchButton.enabled = chosen &&
            (w.frameCombo.currentIndex === 2);
    } catch (e) {
        // a bridge that cannot disable them leaves the old behaviour,
        // which is placing the whole page -- never a wrong crop
    }
};

/**
 * Inserts one scan over the survey: centered on the drawing's extent,
 * scaled so its width spans about that extent (or 150 units for an
 * empty drawing), tagged with the frame it belongs to, on that frame's
 * own scan layer, on top -- an underlay about to be aligned needs to be
 * seen.
 *
 * \param frame which view this scan belongs to; defaults to "plan"
 *        when absent, same as CsScanFrame.normaliseKind.
 * \param trimRect the box on the ORIGINAL page that `path` is a crop
 *        of, or null/absent when `path` IS the page. Recorded, never
 *        applied: the cropping already happened on disk.
 * \return the entity id, or null (a message has been shown).
 */
SketchScans.insert = function(doc, di, path, name, frame, trimRect) {
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

    // The frame's OWN scan layer. A profile sketch on CTRL-SCAN would
    // read as plan content to CsLayers.frameOf, so a plan-wide warp
    // would drag it and it would swell the plan's data window.
    var kind = CsScanFrame.normaliseKind(frame);
    var layer = CsScanFrame.layerFor(kind);
    CsLayers.ensure(doc, di, layer);
    // Layer, tags and draw order BEFORE adding -- post-add writes fail
    // silently in this bridge (see CsDraw.js's header).
    entity.setLayerId(doc.getLayerId(layer));
    CsTags.set(entity, "SketchScan", name);
    CsTags.set(entity, CsScanFrame.TAG, kind);
    // WHICH PART OF THE PAGE THIS IS. `name` deliberately stays the
    // page's own relative path -- the shelf's completion ticks and
    // placedScales both find our images by that tag -- so this is the
    // only record that the placed file is a crop, and the only thing
    // that can map an anchor picked in trimmed pixels back onto the
    // page it came from.
    if (trimRect !== undefined && trimRect !== null) {
        CsTags.set(entity, CsScanTrim.TAG, CsScanTrim.serialize(trimRect));
    }
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
        layer + " layer may be locked or frozen.");
    return null;
};

/**
 * The units-per-pixel of every scan already placed in the drawing.
 *
 * An image's u vector IS its units per pixel, so this is a read rather
 * than a calculation. Used to judge whether a new scan's scale is in
 * step with its neighbours -- see CsScanFit.scaleOutlier.
 */
SketchScans.placedScales = function(doc) {
    var out = [];
    if (isNull(doc)) {
        return out;
    }
    try {
        var ids = doc.queryAllEntities(false, true);
        for (var i = 0; i < ids.length; i++) {
            var e = doc.queryEntity(ids[i]);
            if (isNull(e) || !isImageEntity(e)) {
                continue;
            }
            if (CsTags.get(e, "SketchScan") === "") {
                continue;          // not one of ours
            }
            var u = e.getUVector();
            var m = Math.sqrt(u.x * u.x + u.y * u.y);
            if (m > 0) {
                out.push(m);
            }
        }
    } catch (eScan) {
    }
    return out;
};

/**
 * Inserts a scan ALREADY FITTED to the stations picked on it.
 *
 * The ordinary insert drops the scan over the survey at a guessed size
 * for Align Image to fix afterwards. This one knows the answer first:
 * the fit came from stations picked on the scan itself, so the image is
 * placed by the three vectors that fit describes and never has to be
 * moved again.
 *
 * \return the entity id, or null (a message has been shown).
 */
SketchScans.insertFitted = function(doc, di, path, name, fit, heightPx,
        pairs, frame, trimRect) {
    var image = new QImage(path);
    if (image.isNull()) {
        warning("Sketch Scans: " + name + " could not be read as an image.");
        return null;
    }
    var pxW = image.width(), pxH = image.height();
    if (pxW < 1 || pxH < 1) {
        warning("Sketch Scans: " + name + " has no size.");
        return null;
    }

    var v = CsScanFit.imageVectors(fit.matrix);
    var entity;
    try {
        var data = new RImageData(path,
            new RVector(v.position.x, v.position.y),
            new RVector(v.u.x, v.u.y),
            new RVector(v.v.x, v.v.y),
            pxW, pxH, 0);
        try {
            data.setFade(SketchScans.FADE_PERCENT);
        } catch (eFade) {
        }
        entity = new RImageEntity(doc, data);
    } catch (e) {
        warning("Sketch Scans: creating the image entity failed: " + e);
        return null;
    }

    // The frame's OWN scan layer. A profile sketch on CTRL-SCAN would
    // read as plan content to CsLayers.frameOf, so a plan-wide warp
    // would drag it and it would swell the plan's data window.
    var kind = CsScanFrame.normaliseKind(frame);
    var layer = CsScanFrame.layerFor(kind);
    CsLayers.ensure(doc, di, layer);
    // Layer, tags and draw order BEFORE adding -- post-add writes fail
    // silently in this bridge (see CsDraw.js's header).
    entity.setLayerId(doc.getLayerId(layer));
    CsTags.set(entity, "SketchScan", name);
    CsTags.set(entity, CsScanFrame.TAG, kind);
    // WHICH PART OF THE PAGE THIS IS. `name` deliberately stays the
    // page's own relative path -- the shelf's completion ticks and
    // placedScales both find our images by that tag -- so this is the
    // only record that the placed file is a crop, and the only thing
    // that can map an anchor picked in trimmed pixels back onto the
    // page it came from.
    if (trimRect !== undefined && trimRect !== null) {
        CsTags.set(entity, CsScanTrim.TAG, CsScanTrim.serialize(trimRect));
    }
    // The band it was assigned within, where the frame has bands. A
    // HINT for re-fitting, never trusted over the station names: a
    // renamed run must not strand a scan.
    try {
        if (pairs.length > 0 && pairs[0].run !== undefined &&
                pairs[0].run !== null && pairs[0].run !== "") {
            CsTags.set(entity, CsScanFrame.KEY_TAG, pairs[0].run);
        }
    } catch (eRun) {
    }
    // The stations it was fitted to, in the same tag Align Image uses,
    // so re-aligning this scan later resumes past them rather than
    // offering them again.
    try {
        var names = [];
        for (var n = 0; n < pairs.length; n++) {
            names.push(pairs[n].name);
        }
        CsTags.set(entity, CsStationOrder.TAG,
            CsStationOrder.serializeAssigned(names));
    } catch (eTag) {
        // the scan is placed either way; only the resume list is lost
    }
    // AND WHERE ON THE PAGE each of them was picked, in the scan's own
    // pixels. Written for two reasons. It makes a placement CHECKABLE
    // after the fact -- run each anchor through the placed image's own
    // mapFromImage and it must land on that station -- which is the
    // difference between "it looks offset" and a number. And it is what
    // a later redraw would need to re-fit the scan when the survey
    // moves under it, instead of leaving it stranded.
    //
    // AND NOTE ON TRIMMING. These are in the PLACED image's pixels,
    // which for a trimmed placement is the crop's own space, not the
    // page's. ScanTrim above is what rebases them:
    //   page_u = anchor_u + trim.x,  page_v = anchor_v + trim.y
    // Nothing here does that rebasing; the tag exists so a later
    // reader CAN.
    try {
        var anchors = [];
        for (var q = 0; q < pairs.length; q++) {
            anchors.push({ name: pairs[q].name,
                           u: pairs[q].source.x, v: pairs[q].source.y });
        }
        CsTags.set(entity, "ScanAnchors",
            CsScanFit.serializeAnchors(anchors));
    } catch (eAnchor) {
        // placement stands; only the record of where it was picked is lost
    }
    entity.setDrawOrder(doc.getStorage().getMinDrawOrder() - 1);

    var beforeIds = {};
    var ids = doc.queryAllEntities(false, false);
    var i;
    for (i = 0; i < ids.length; i++) {
        beforeIds[ids[i]] = true;
    }
    var op = new RAddObjectsOperation();
    op.setText("Place aligned sketch scan");
    op.addObject(entity, false);
    di.applyOperation(op);

    ids = doc.queryAllEntities(false, false);
    for (i = 0; i < ids.length; i++) {
        if (beforeIds[ids[i]] !== true) {
            return ids[i];
        }
    }
    warning("Sketch Scans: the insert added nothing -- the " +
        layer + " layer may be locked or frozen.");
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

/**
 * Hand a scan to the Sketch Section tool, DEFERRED.
 *
 * Starting an action from inside a widget event is the documented
 * hard-crash trap: triggering makes QCAD build a new action, and
 * setCurrentAction then runs deleteTerminatedActions(), which frees the
 * action still executing this very handler. The zero-delay timer puts
 * the start on the next event loop turn, out of that handler -- the
 * same shape alignSoon above uses, for the same reason.
 */
SketchScans.sketchSoon = function(path, station, calibration) {
    // Normalised here rather than at every call site: an omitted
    // argument is `undefined`, and SketchSection.run's own "was I given
    // a station?" test reads "" and null, not undefined.
    var name = (station === undefined || station === null ||
        station === "") ? null : station;
    var cal = (calibration === undefined) ? null : calibration;
    var timer = new QTimer(RMainWindowQt.getMainWindow());
    timer.singleShot = true;
    timer.timeout.connect(function() {
        try {
            SketchSection.run(path, name, cal);
        } catch (e) {
            EAction.handleUserWarning("Sketch Section: " + e);
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
