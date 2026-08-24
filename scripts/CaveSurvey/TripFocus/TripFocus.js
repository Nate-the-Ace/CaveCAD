// TripFocus.js
//
// QCAD add-on tool: a standalone window showing who surveyed what.
//
// Each trip, team, person and survey run is listed with the distance it
// surveyed and its share of the cave. Check any of them and the view
// beside the list shows just that work.
//
// WHY A SEPARATE WINDOW WITH ITS OWN COPY OF THE DRAWING, rather than
// hiding entities in the drawing itself: everything this window does is
// done to a PRIVATE COPY, so the user's drawing is never written to.
// That is not tidiness. Hiding entities in the real document walks into
// four separate silent failures in this build -- an invisible entity is
// not editable, so un-hiding it is refused with no error; eraseStations
// then cannot delete it either, so the next redraw draws a duplicate
// beside it; every toggle marks the drawing modified; and every toggle
// lands on the undo stack. A scratch copy has none of those, and it is
// also what makes the next step (colour by trip) safe, since recolouring
// a copy cannot overwrite the cartographer's own colours.
//
// USAGE:
//   Cave Survey > Trip Focus   (or type "tripfocus" / "tf")

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");
include(includeBasePath + "/TripFocusRows.js");

function TripFocus(guiAction) {
    EAction.call(this, guiAction);
}

TripFocus.prototype = new EAction();

/** The one live window. Reopening focuses it rather than stacking a
 *  second copy: two windows would each hold a full copy of the drawing
 *  and each claim to be the focus. */
TripFocus.dialog = null;
TripFocus.previewDi = null;
/** {tree, read, view, doc} while the window is open, null otherwise. */
TripFocus.state = null;

TripFocus.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    TripFocus.show(this.getDocument());
    this.terminate();
};

/**
 * A private copy of `sourceDoc` and an interface onto it.
 *
 * setSelectionOnly(false) is what makes this safe: with it ON (the
 * default) RCopyOperation copies the SOURCE's selection, which would
 * mean selecting entities in the user's drawing to look at them. With it
 * off, RCopyOperation copies queryAllEntities() and carries layers,
 * linetypes and blocks across, so the copy is faithful and the main
 * window's selection is never touched.
 */
TripFocus.buildPreview = function(sourceDoc) {
    var previewDoc = new RDocument(new RMemoryStorage(),
        createSpatialIndex());
    var di = new RDocumentInterface(previewDoc);
    di.setNotifyListeners(false);

    var op = new RCopyOperation(new RVector(0, 0), sourceDoc);
    op.setSelectionOnly(false);
    di.applyOperation(op);
    return di;
};

/** The reconstructed survey the window is describing, or null when the
 *  drawing holds none. Read once per open/Refresh -- surveyFromDocument
 *  is a full document scan. */
TripFocus.readSurvey = function(doc) {
    try {
        var recon = CsRevise.surveyFromDocument(doc);
        if (isNull(recon) || isNull(recon.survey)) {
            return null;
        }
        var resolved = CsNetwork.resolve(recon.survey);
        return { survey: recon.survey, resolved: resolved };
    } catch (e) {
        return null;
    }
};

TripFocus.COL_WHAT = 0;
TripFocus.COL_DISTANCE = 1;
TripFocus.COL_SHARE = 2;

/** The list pane. Section items carry their own key in column 0's
 *  user role so picked() can read a checked child's section without
 *  walking back up by title text. */
TripFocus.buildTree = function(read) {
    var tree = new QTreeWidget();
    tree.objectName = "TripFocusTree";
    tree.columnCount = 3;
    tree.setHeaderLabels(["Contributor", "Distance", "Share"]);
    tree.rootIsDecorated = true;
    tree.uniformRowHeights = true;

    if (read === null) {
        var none = new QTreeWidgetItem(tree);
        none.setText(TripFocus.COL_WHAT, "No survey data in this drawing");
        none.setDisabled(true);
        return tree;
    }

    var sections = TripFocusRows.build(read.survey, read.resolved,
        CsTraverse.SLOPE);
    for (var s = 0; s < sections.length; s++) {
        var section = sections[s];
        var head = new QTreeWidgetItem(tree);
        head.setText(TripFocus.COL_WHAT, section.title +
            (section.note === "" ? "" : "  -- " + section.note));
        head.setData(TripFocus.COL_WHAT, Qt.UserRole, section.key);
        head.setExpanded(true);

        if (section.rows.length === 0) {
            head.setDisabled(true);
            head.setText(TripFocus.COL_WHAT, section.title +
                "  (none recorded)");
            continue;
        }
        head.setFlags(head.flags() | Qt.ItemIsUserCheckable);
        head.setCheckState(TripFocus.COL_WHAT, Qt.Unchecked);

        for (var r = 0; r < section.rows.length; r++) {
            var row = section.rows[r];
            var item = new QTreeWidgetItem(head);
            item.setText(TripFocus.COL_WHAT, row.label);
            item.setText(TripFocus.COL_DISTANCE, row.distanceText);
            item.setText(TripFocus.COL_SHARE, row.percentText);
            if (isNull(row.pick)) {
                // informational only -- see TripFocusRows' unassigned row
                item.setDisabled(true);
            } else {
                item.setFlags(item.flags() | Qt.ItemIsUserCheckable);
                item.setCheckState(TripFocus.COL_WHAT, Qt.Unchecked);
            }
            item.setData(TripFocus.COL_WHAT, Qt.UserRole, section.key);
            item.setData(TripFocus.COL_SHARE, Qt.UserRole,
                isNull(row.pick) ? null : String(row.pick));
        }
    }
    return tree;
};

/** What is checked, in the shape CsFocus.stationSet wants. A trip's
 *  pick round-trips through text (Qt.UserRole is set as a string), so
 *  it comes back parsed rather than as "0". Team and person picks
 *  come back exactly as TripFocusRows.build wrote them ("team:..." /
 *  "person:..." -- see that file's docblock for why the namespace
 *  prefix matters), which is what CsFocus.stationSet's tripsForGroup
 *  lookup now expects. */
TripFocus.picked = function(tree) {
    var out = { trips: [], teams: [], people: [], runs: [] };
    for (var s = 0; s < tree.topLevelItemCount; s++) {
        var head = tree.topLevelItem(s);
        for (var r = 0; r < head.childCount(); r++) {
            var item = head.child(r);
            if (item.checkState(TripFocus.COL_WHAT) !== Qt.Checked) {
                continue;
            }
            var key = item.data(TripFocus.COL_WHAT, Qt.UserRole);
            var pick = item.data(TripFocus.COL_SHARE, Qt.UserRole);
            if (isNull(pick) || pick === "null") {
                continue;   // the "(not in any run)" row: nothing to focus
            }
            if (key === "trips") {
                out.trips.push(parseInt(pick, 10));
            } else if (key === "teams") {
                out.teams.push(String(pick));
            } else if (key === "people") {
                out.people.push(String(pick));
            } else if (key === "runs") {
                out.runs.push(String(pick));
            }
        }
    }
    return out;
};

TripFocus.show = function(doc) {
    if (TripFocus.dialog !== null && TripFocus.dialog !== undefined) {
        TripFocus.dialog.raise();
        return;
    }

    var dlg = new QDialog(RMainWindowQt.getMainWindow());
    dlg.windowTitle = "Trip Focus";
    // a window in its own right, not a sheet stuck to the main one:
    // the reader compares it against the drawing behind it
    dlg.setSizeGripEnabled(true);
    var layout = new QVBoxLayout();

    var di = TripFocus.buildPreview(doc);
    TripFocus.previewDi = di;

    var view = new RGraphicsViewQt(dlg, false);
    view.objectName = "TripFocusView";
    var imageView = view.getImageView();
    imageView.setScene(new RGraphicsSceneQt(di));
    imageView.setPaintOrigin(false);
    imageView.setMargin(10);

    var read = TripFocus.readSurvey(doc);
    var tree = TripFocus.buildTree(read);

    var splitter = new QSplitter(Qt.Horizontal, dlg);
    splitter.addWidget(tree);
    splitter.addWidget(view);
    splitter.setSizes([320, 620]);
    layout.addWidget(splitter, 1, 0);

    // one window at a time (show() raises the existing one), so the
    // window's parts live here rather than as properties bolted onto the
    // QDialog wrapper -- Refresh replaces the tree widget, and a stale
    // reference on a wrapper object is the kind of thing that reads as
    // "the buttons stopped working" much later
    TripFocus.state = { tree: tree, read: read, view: view, doc: doc };

    // Section checkboxes drive their children. Guarded: a failed
    // connect must leave the window usable with plain independent
    // checkboxes rather than crash the whole tool over a cascade that
    // is a convenience, not the point of this window.
    try {
        tree.itemChanged.connect(function(item, column) {
            if (column !== TripFocus.COL_WHAT || TripFocus.inCascade) {
                return;
            }
            if (item.childCount() === 0) {
                return;
            }
            TripFocus.inCascade = true;   // a child's own itemChanged
                                          // would otherwise re-enter
                                          // this handler
            var state = item.checkState(TripFocus.COL_WHAT);
            for (var r = 0; r < item.childCount(); r++) {
                item.child(r).setCheckState(TripFocus.COL_WHAT, state);
            }
            TripFocus.inCascade = false;
        });
    } catch (e) {
    }

    var buttons = new QHBoxLayout();
    var closeButton = new QPushButton("Close");
    buttons.addStretch(1);
    buttons.addWidget(closeButton, 0, 0);
    layout.addLayout(buttons, 0);

    dlg.setLayout(layout);
    dlg.resize(900, 600);

    // A plain function literal, not connect(dlg, "close") -- every
    // other signal wired in this suite (and in QCAD's own dialogs) is
    // wired this way; a connect() whose second argument is a slot NAME
    // STRING has no precedent anywhere in either tree and is not worth
    // being the first to find out whether this bridge supports it.
    closeButton.clicked.connect(function() { dlg.reject(); });
    dlg.finished.connect(function() { TripFocus.cleanUp(); });

    TripFocus.dialog = dlg;
    dlg.show();                  // NON-modal: exec() would freeze the
                                 // main window the reader is comparing
                                 // against
    imageView.autoZoom();
};

/** Frees the scratch document AND the dialog's own C++ widgets. A
 *  preview left behind holds a whole second copy of the drawing; ten
 *  opens without the first line is ten copies. destr() only frees the
 *  document interface -- without destrDialog() too, the QDialog itself
 *  (parented to the main window) outlives the close, so ten opens would
 *  still be ten abandoned dialogs, each holding a view and a scene, kept
 *  alive by the main window until the application exits. destrDialog()
 *  is this suite's (and QCAD's own) standard way to free a dialog --
 *  see scripts/library.js and every scripts/*Dialog.js in the QCAD tree.
 */
TripFocus.cleanUp = function() {
    if (TripFocus.previewDi !== null && TripFocus.previewDi !== undefined) {
        destr(TripFocus.previewDi);
        TripFocus.previewDi = null;
    }
    if (TripFocus.dialog !== null && TripFocus.dialog !== undefined) {
        destrDialog(TripFocus.dialog);
    }
    TripFocus.dialog = null;
    TripFocus.state = null;
};

TripFocus.init = function(basePath) {
    var action = new RGuiAction(qsTr("Trip Focus"),
        RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/TripFocus.js");
    action.setIcon(basePath + "/TripFocus.svg");
    action.setStatusTip(qsTr("See how much of the cave each trip, team " +
        "and person surveyed, and look at just their work."));
    action.setDefaultCommands(["tripfocus", "tf"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(30);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
