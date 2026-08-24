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

/**
 * Hides everything out of focus in the PREVIEW document.
 *
 * NOT `RModifyObjectsOperation` + `entity.setInvisible()` -- that was
 * this function's first draft, and it does not work in this build,
 * confirmed by an isolated probe before this version was trusted rather
 * than assumed from reading the operation classes. The reason: the
 * modify path is a PROPERTY DIFF (RTransaction::addObject compares
 * `object->getPropertyTypeIds()` against the stored original and only
 * persists properties that differ), and `RObject::PropertyInvisible` is
 * registered under `RObject::getRtti()` -- `RS::ObjectUnknown` -- never
 * re-registered per concrete entity type the way e.g. RLayer's own
 * off/frozen properties are. So `getPropertyTypeIds()` on an ordinary
 * entity (line, text, ...) never includes PropertyInvisible, the diff
 * never sees the flag changed, and the modify silently no-ops: the
 * clone's own isInvisible() flips locally but storage->saveObject() is
 * never called, so nothing is un-hidden OR hidden. This has nothing to
 * do with `setAllowInvisible`/`setAllowAll` -- those gate a DIFFERENT
 * check (REntity::isEditable) earlier in the same function, and the
 * modify was already failing before that check ever mattered.
 *
 * `RChangePropertyOperation` is the mechanism this engine actually uses
 * for a single-property change (it is what QCAD's own property editor
 * calls), and it sidesteps the diff: its `apply()` always sets
 * `transaction.setAllowInvisible(true)` itself (unconditionally, not
 * something this function controls) and hands the transaction an
 * EXPLICIT one-property set, so the flag change is never lost to the
 * enumeration gap above. Its cost is that it works over
 * `document.queryPropertyEditorObjects()` -- the document's current
 * SELECTION -- rather than an arbitrary id list, hence the
 * select/apply/clear dance below. That selection lives only in this
 * PREVIEW document; nothing here is visible to, or shared with, the
 * user's own document or its own selection.
 *
 * \param stationSet from CsFocus.stationSet, or null for All
 */
TripFocus.applyFocus = function(di, stationSet) {
    var doc = di.getDocument();
    var ids = doc.queryAllEntities(false, false);
    var toShow = [], toHide = [];
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        // Plan only (Nathan's decision): the profile band is out of the
        // window whatever is checked, so it is hidden before the focus
        // rules are consulted at all.
        var wanted = CsFocus.isPlanFrame(CsBind.layerNameOf(doc, e)) &&
            CsFocus.isVisible(e, stationSet);
        if (e.isInvisible() === !wanted) {
            continue;              // already in the right state
        }
        if (wanted) {
            toShow.push(ids[i]);
        } else {
            toHide.push(ids[i]);
        }
    }

    var changed = toShow.length + toHide.length;
    if (toHide.length > 0) {
        doc.clearSelection();
        doc.selectEntities(toHide, false);
        di.applyOperation(new RChangePropertyOperation(
            RObject.PropertyInvisible, true, RS.EntityAll, false));
    }
    if (toShow.length > 0) {
        doc.clearSelection();
        doc.selectEntities(toShow, false);
        di.applyOperation(new RChangePropertyOperation(
            RObject.PropertyInvisible, false, RS.EntityAll, false));
    }
    doc.clearSelection();          // leave no trace of a selection a
                                    // reader never asked for
    di.regenerateScenes();
    return changed;
};

/** Re-reads the drawing: a new copy, a rebuilt list. The window is a
 *  snapshot, not a mirror -- transactionUpdated is still unverified in
 *  this build, so refreshing is something the reader asks for rather
 *  than something we promise and half-deliver. */
TripFocus.refresh = function(sourceDoc) {
    var oldDi = TripFocus.previewDi;
    var di = TripFocus.buildPreview(sourceDoc);
    TripFocus.previewDi = di;
    TripFocus.state.view.getImageView().setScene(new RGraphicsSceneQt(di));
    if (!isNull(oldDi)) {
        destr(oldDi);
    }

    var read = TripFocus.readSurvey(sourceDoc);
    TripFocus.state.read = read;
    var fresh = TripFocus.buildTree(read);
    // swap the tree in place inside the splitter, so the reader's pane
    // widths survive a Refresh -- guarded, since sizes()/setSizes() are
    // not guaranteed by this Qt bridge (see SurveyNotebook.js's own
    // splitter for the same guard); losing the split is cosmetic, so a
    // failure here must not stop the tree from being replaced.
    var splitter = TripFocus.state.tree.parentWidget();
    var index = 0;
    var sizes = null;
    try {
        index = splitter.indexOf(TripFocus.state.tree);
        sizes = splitter.sizes();
    } catch (eSizes) {
        index = 0;
        sizes = null;
    }
    TripFocus.state.tree.setParent(null);
    splitter.insertWidget(index, fresh);
    if (sizes !== null) {
        try {
            splitter.setSizes(sizes);
        } catch (eSetSizes) {
        }
    }
    TripFocus.state.tree = fresh;
    TripFocus.wireTree();
    TripFocus.reapply();
};

/** Reads the checkboxes and applies them. Called on every change. */
TripFocus.reapply = function() {
    var read = TripFocus.state.read;
    if (isNull(read)) {
        TripFocus.applyFocus(TripFocus.previewDi, null);
        return;
    }
    var picked = TripFocus.picked(TripFocus.state.tree);
    if (CsFocus.isEmptySelection(picked)) {
        // nothing checked shows everything: a blank window looks like a
        // broken tool, not like an empty selection
        TripFocus.applyFocus(TripFocus.previewDi, null);
        return;
    }
    var grouped = CsProfile.groupRuns(read.resolved);
    var runStations = {};
    for (var i = 0; i < grouped.order.length; i++) {
        runStations[grouped.order[i]] =
            grouped.runs[grouped.order[i]].stations;
    }
    var set = CsFocus.stationSet(picked,
        CsRevise.tripStationNames(read.survey), runStations,
        TripFocusRows.tripsForGroup(read.survey, read.resolved,
            CsTraverse.SLOPE));
    TripFocus.applyFocus(TripFocus.previewDi, set);
};

/** Wires the tree's itemChanged signal: a section header cascades its
 *  check state to its children, and every real checkbox change --
 *  cascaded header or plain leaf alike -- re-applies the focus filter
 *  afterwards. Pulled out of show() into its own function so Refresh
 *  can re-wire the replacement tree the same way. Guarded: a failed
 *  connect must leave the window usable with plain independent
 *  checkboxes rather than crash the whole tool over a cascade that is a
 *  convenience, not the point of this window. */
TripFocus.wireTree = function() {
    var tree = TripFocus.state.tree;
    try {
        tree.itemChanged.connect(function(item, column) {
            if (column !== TripFocus.COL_WHAT || TripFocus.inCascade) {
                return;
            }
            if (item.childCount() > 0) {
                TripFocus.inCascade = true;   // a child's own itemChanged
                                              // would otherwise re-enter
                                              // this handler
                var state = item.checkState(TripFocus.COL_WHAT);
                for (var r = 0; r < item.childCount(); r++) {
                    item.child(r).setCheckState(TripFocus.COL_WHAT, state);
                }
                TripFocus.inCascade = false;
            }
            TripFocus.reapply();
        });
    } catch (e) {
    }
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

    // Section checkboxes drive their children, and every change re-runs
    // the filter -- see TripFocus.wireTree, pulled out on its own so
    // Refresh can re-wire the replacement tree the same way.
    TripFocus.wireTree();
    // Nothing is checked yet, which reapply() reads as All -- but the
    // profile band is out of this window regardless of what is checked
    // (see applyFocus), so this first call is what keeps it off the very
    // moment the window opens rather than only after the first click.
    TripFocus.reapply();

    var buttons = new QHBoxLayout();
    var allButton = new QPushButton("All");
    var refreshButton = new QPushButton("Refresh");
    var closeButton = new QPushButton("Close");
    buttons.addWidget(allButton, 0, 0);
    buttons.addWidget(refreshButton, 0, 0);
    buttons.addStretch(1);
    buttons.addWidget(closeButton, 0, 0);
    layout.addLayout(buttons, 0);

    // All: checks every checkable row, then filters once -- guarded the
    // same way wireTree's own cascade is, so the per-child checkState
    // notifications this fires do not each re-run the filter.
    try {
        allButton.clicked.connect(function() {
            TripFocus.inCascade = true;
            var tree = TripFocus.state.tree;
            for (var s = 0; s < tree.topLevelItemCount; s++) {
                var head = tree.topLevelItem(s);
                if (head.childCount() === 0) {
                    continue;
                }
                head.setCheckState(TripFocus.COL_WHAT, Qt.Checked);
                for (var r = 0; r < head.childCount(); r++) {
                    head.child(r).setCheckState(TripFocus.COL_WHAT,
                        Qt.Checked);
                }
            }
            TripFocus.inCascade = false;
            TripFocus.reapply();
        });
    } catch (eAll) {
    }
    try {
        refreshButton.clicked.connect(function() {
            TripFocus.refresh(doc);
        });
    } catch (eRefresh) {
    }

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
