/**
 * SectionBayPanel.js
 *
 * The two buttons that used to be commands.
 *
 * A bay is a mode: something is open, and it has to be closed. A mode
 * with no visible way out is the thing a beginner gets stuck in -- and
 * the way out used to be a command (`skc`, "Capture Section") you had
 * to already know existed, or a second command (`ske`, "Edit Sketch")
 * to get back into one. Now Capture and Cancel are on screen for as
 * long as the bay is: CrossSection.js's own "trace" route shows this
 * panel the moment SectionBay.run succeeds, and hides it again once the
 * bay is gone, whichever way it went.
 *
 * Modeless on purpose: the caver traces with QCAD's own tools -- Feature
 * Trace, Shaped Lines, arcs -- while this is up, so it must never take
 * focus or block the document the way a QDialog would.
 *
 * RE-READS THE BAY AT CLICK TIME, never trusts the one `show` was
 * called with. Tracing happens between `show` and a click on either
 * button, so the bay's `traced` set -- and in principle the bay itself,
 * if it was torn down some other way (undo, a second Cross Section run)
 * -- can have changed underneath a stale reference. SectionCapture.
 * findBay is cheap enough to call again and is the one place both this
 * panel and the interactive command it replaces already agree on what
 * "the open bay" means.
 */
include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");
include(includeBasePath + "/SectionBay.js");
include(includeBasePath + "/SectionCapture.js");

function SectionBayPanel() {
}

/** The dock, built once. Module-local so `show`/`hide` are idempotent
 *  and there is never more than one of these floating around. */
var csSectionBayPanelDock = null;

/**
 * Show the panel, docked to the right, with Capture and Cancel wired up.
 * Safe to call repeatedly: the dock is built once and just re-shown and
 * re-labelled after that.
 *
 * \param doc, di   the open document -- read fresh at click time too,
 *                   since the panel can sit open for as long as the
 *                   caver is tracing
 * \param bay        a SectionCapture.findBay result, for the station
 *                    name shown on the panel; not held onto past this
 *                    call (see the file header)
 */
SectionBayPanel.show = function(doc, di, bay) {
    if (isNull(doc) || isNull(di) || bay === null || bay === undefined) {
        return;
    }
    SectionBayPanel.ensureDock();
    try {
        csSectionBayPanelDock.label.text = (bay.station !== null &&
                bay.station !== undefined && bay.station !== "") ?
            qsTr("Section bay open at %1").arg(bay.station) :
            qsTr("Section bay open");
    } catch (eLbl) {
    }
    try {
        csSectionBayPanelDock.visible = true;
        csSectionBayPanelDock.raise();
    } catch (eShow) {
    }
};

/** Hide the panel. Safe to call when it was never built. */
SectionBayPanel.hide = function() {
    if (csSectionBayPanelDock === null) {
        return;
    }
    try {
        csSectionBayPanelDock.visible = false;
    } catch (e) {
    }
};

/** Build the dock, idempotently -- modelled on SketchScans.buildDock,
 *  the only other dock this add-on builds by hand. */
SectionBayPanel.ensureDock = function() {
    if (csSectionBayPanelDock !== null) {
        return csSectionBayPanelDock;
    }
    var appWin = RMainWindowQt.getMainWindow();
    var dock = new QDockWidget(qsTr("Section Bay"), appWin);
    // Without an objectName, restoreState() cannot identify the dock
    // and silently forgets where it was -- the same trap SketchScans'
    // own dock avoids.
    dock.objectName = "CaveSurveySectionBayDock";

    var body = new QWidget(dock);
    var layout = new QVBoxLayout();

    dock.label = new QLabel(qsTr("Section bay open"));
    try {
        dock.label.wordWrap = true;
    } catch (eWrap) {
    }
    layout.addWidget(dock.label, 0, 0);

    var buttons = new QHBoxLayout();
    var captureBtn = new QPushButton(qsTr("Capture"));
    captureBtn.toolTip = qsTr("Place what is traced in the bay as a " +
        "section block, with a leader back to its station, and tear " +
        "the bay down.");
    var cancelBtn = new QPushButton(qsTr("Cancel"));
    cancelBtn.toolTip = qsTr("Abandon this bay: remove the frame, the " +
        "scan and the ghost, and leave whatever was traced exactly " +
        "where it is.");

    captureBtn.clicked.connect(function() {
        SectionBayPanel.captureClicked();
    });
    cancelBtn.clicked.connect(function() {
        SectionBayPanel.cancelClicked();
    });

    buttons.addWidget(captureBtn, 0, 0);
    buttons.addWidget(cancelBtn, 0, 0);
    layout.addLayout(buttons, 0);

    body.setLayout(layout);
    dock.setWidget(body);
    CsPanel.attachHelp(dock, "CrossSection", qsTr("Cross Section"));
    appWin.addDockWidget(Qt.RightDockWidgetArea, dock);
    dock.visible = false;

    csSectionBayPanelDock = dock;
    return dock;
};

/**
 * Capture clicked: hands over to the interactive placement, exactly
 * what the skc command used to start -- the proposal previewed, Enter
 * to accept it, or a click to put the section somewhere else.
 *
 * The refusals happen HERE, before any tool starts, so a refused
 * capture leaves the caver still in the bay with the panel still up and
 * more to trace. The panel hides itself from inside the action once a
 * section has actually been placed, or here when there is no bay left
 * to act on at all.
 */
SectionBayPanel.captureClicked = function() {
    var doc = EAction.getDocument();
    var di = EAction.getDocumentInterface();
    if (isNull(doc) || isNull(di)) {
        SectionBayPanel.hide();
        return;
    }
    var probe = SectionCapture.findBay(doc);
    if (probe === null && SectionCapture.findBayError === null) {
        // The bay is already gone by some other means (undo, a second
        // bay opened and closed elsewhere) -- nothing left to act on,
        // and nothing to say either. TWO open bays is a different
        // case: findBay still returns null but WITH a reason, and that
        // reason has to reach the caver -- the action below says it.
        SectionBayPanel.hide();
        return;
    }
    if (probe !== null && probe.traced.length === 0) {
        // Refused before any tool starts, so the caver stays in the bay
        // with the panel still up and more to trace.
        EAction.handleUserMessage(qsTr("Nothing has been traced inside " +
            "the bay yet, so there is no section to capture."));
        return;
    }
    // Hands over to the interactive placement -- proposal previewed,
    // Enter to accept it, or pick somewhere else. Where a section sits
    // on the sheet is the cartographer's decision, and this button is
    // the only way left to reach that flow now that skc is gone. The
    // panel hides itself from inside the action, once a section has
    // actually been placed.
    SectionCapture.startInteractive();
};

/** Cancel clicked: SectionBay.cancel on whatever bay is open now. */
SectionBayPanel.cancelClicked = function() {
    var doc = EAction.getDocument();
    var di = EAction.getDocumentInterface();
    if (!isNull(doc) && !isNull(di)) {
        var bay = SectionCapture.findBay(doc);
        if (bay !== null) {
            SectionBay.cancel(doc, di, bay);
        } else if (SectionCapture.findBayError !== null) {
            // Two bays open: cancelling THIS panel cannot know which
            // one the caver meant, so say so rather than guessing --
            // the same refusal Capture would give.
            EAction.handleUserMessage(SectionCapture.findBayError);
            return;
        }
    }
    SectionBayPanel.hide();
};
