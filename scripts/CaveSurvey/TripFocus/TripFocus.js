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
    layout.addWidget(view, 1, 0);

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
