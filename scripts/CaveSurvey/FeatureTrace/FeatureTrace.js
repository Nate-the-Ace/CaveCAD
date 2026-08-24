// FeatureTrace.js -- Feature Trace: the menu entry and the docked panel
// that arms which feature the next drag traces.
//
// The interactive drag lives in FeatureTraceRun.js beside this file.
// QCAD cannot find that file on its own -- AddOn.getAddOns only builds
// an add-on from <dir>/<dir>.js -- so init() below registers it.
//
// Panel shape follows SurveyNotebook's dock, including the two details
// that are load-bearing rather than stylistic: the dock is BUILT during
// init() and left hidden (the main window's restoreState() runs after
// add-on init and can only place a dock that already exists), and every
// widget construction and connect is wrapped so a bridge refusal costs
// one control rather than the whole panel.

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");
include(includeBasePath + "/FeatureTraceRun.js");

function FeatureTrace(guiAction) {
    EAction.call(this, guiAction);
}

FeatureTrace.prototype = new EAction();

/** The armed target layer, read by FeatureTraceRun.targetLayer().
 *
 *  Module state, which is only safe because the panel SHOWS which row
 *  is armed. Panel-only means there is no per-feature menu command to
 *  make the choice visible, so the checked button IS the indicator --
 *  see armLayer below. Undefined means "not yet armed", and
 *  targetLayer() falls back to WALLS-SURVEYED. */
FeatureTrace.target = undefined;

/** Sentinel target meaning "whatever layer the drawing is set to".
 *
 *  A sentinel rather than a layer name, resolved at trace time, because
 *  the current layer can change between arming the button and drawing.
 *  Deliberately NOT a member of ROWS: every row there must name a real
 *  registry layer, and a test asserts it. */
FeatureTrace.CURRENT_LAYER = "\u0000CURRENT-LAYER";

/**
 * The ten traceable features, plan frame first.
 *
 * Layer CONSTANTS, never literals. CsLayers.PROFILE_FLOOR is the
 * GENERATED CTRL-PROFILE-FLOOR and CsLayers.PROFILE_TRACED_FLOOR is the
 * hand-traced PROFILE-FLOOR: one word apart, opposite meanings, and
 * tracing onto the generated one would look fine until the next redraw
 * erased the work. A test asserts every row here is a linework layer,
 * which is false for anything CTRL-.
 *
 * No `frame` field. The frame is DERIVED from CsLayers.frameOf, the one
 * place that question is answered; a second spelling here is how the
 * two would come to disagree.
 *
 * Labels are bare because the group header already says which view they
 * belong to. The layer names and the README keep the PROFILE- wording.
 */
FeatureTrace.ROWS = [
    { label: "Surveyed Walls", layer: CsLayers.WALLS_SURVEYED },
    { label: "Inferred Walls", layer: CsLayers.WALLS_INFERRED },
    { label: "Breakdown", layer: CsLayers.BREAKDOWN },
    { label: "Breakdown Boundary", layer: CsLayers.BREAKDOWN_BOUNDARY },
    { label: "Entrance", layer: CsLayers.ENTRANCE },
    { label: "Ceiling", layer: CsLayers.PROFILE_TRACED_CEILING },
    { label: "Floor", layer: CsLayers.PROFILE_TRACED_FLOOR },
    { label: "Inferred Walls", layer: CsLayers.PROFILE_WALLS_INFERRED },
    { label: "Breakdown", layer: CsLayers.PROFILE_BREAKDOWN },
    { label: "Entrance", layer: CsLayers.PROFILE_ENTRANCE }
];

/**
 * How hard to thin the trace, as a FRACTION of the sample spacing.
 *
 * A fraction and not an absolute distance, so one setting means the
 * same thing in a foot drawing and a metre one.
 *
 * The first scale here was far too loose -- Medium at HALF the interval
 * meant a six-inch tolerance at one point per foot, which flattens the
 * scallops and rock detail that make a cave wall read as a cave wall.
 * Every step is tighter now, listed from least smoothing to most, and
 * the default moved to Fine.
 *
 * "No Smoothing" is a tolerance of zero: every resampled point becomes
 * a control point, which is literally one control point per foot of
 * cave. Only exactly-collinear points drop, so a straight run is still
 * two points rather than a hundred.
 *
 * Note the OTHER lever: reduction can only keep detail the resampling
 * left. At the default one-foot interval, nothing smaller than a foot
 * survives no matter what this is set to. For finer walls, lower the
 * Interval as well.
 */
FeatureTrace.SMOOTHING = [
    { label: "No Smoothing", fraction: 0.0 },
    { label: "Fine", fraction: 0.05 },
    { label: "Medium", fraction: 0.15 },
    { label: "Coarse", fraction: 0.35 }
];

FeatureTrace.DEFAULT_SMOOTHING = "Fine";

/** The fraction for a smoothing name, defaulting to Medium. An
 *  unrecognised name must not become a tolerance of zero -- that keeps
 *  every sampled point and produces the 400-fit-point spline this whole
 *  reduction exists to avoid. */
FeatureTrace.smoothingFraction = function(name) {
    var i;
    for (i = 0; i < FeatureTrace.SMOOTHING.length; i++) {
        if (FeatureTrace.SMOOTHING[i].label === name) {
            return FeatureTrace.SMOOTHING[i].fraction;
        }
    }
    for (i = 0; i < FeatureTrace.SMOOTHING.length; i++) {
        if (FeatureTrace.SMOOTHING[i].label === FeatureTrace.DEFAULT_SMOOTHING) {
            return FeatureTrace.SMOOTHING[i].fraction;
        }
    }
    return 0.15;
};

/** The dock, and the widgets the panel updates. Module-level singletons
 *  because there is one panel per application window. */
var csFeatureTraceDock;
FeatureTrace.widgets = undefined;

/**
 * Sets the armed target and makes the panel show it.
 *
 * The showing is not decoration. With no per-feature menu commands, a
 * target held in module state is exactly the invisible mode that
 * separate commands would have prevented; the panel answers that only
 * while it displays which row is armed. Checked buttons, one at a time.
 */
FeatureTrace.armLayer = function(layerName) {
    FeatureTrace.target = layerName;
    FeatureTrace.refreshRuns();
    FeatureTrace.refresh();

    var w = FeatureTrace.widgets;
    if (isNull(w) || isNull(w.buttons)) {
        return;
    }
    try {
        if (!isNull(w.currentButton)) {
            w.currentButton.checked =
                (layerName === FeatureTrace.CURRENT_LAYER);
        }
    } catch (eCur) {
        // as below: armed correctly, only the display is wrong
    }
    for (var i = 0; i < w.buttons.length; i++) {
        try {
            w.buttons[i].button.checked =
                (w.buttons[i].row.layer === layerName);
        } catch (e) {
            // a button the bridge will not let us write back is still
            // armed correctly; only its appearance is wrong
        }
    }
};

/** The sample interval in FEET, from the panel, or 1.0.
 *
 *  Feet and not drawing units, so the field means the same thing in a
 *  metre drawing -- CsTrace.spacingFor converts. A blank or nonsense
 *  entry falls back rather than refusing: a bad number in a text box
 *  must not stop a caver mid-trace. */
FeatureTrace.intervalFeet = function() {
    var w = FeatureTrace.widgets;
    if (isNull(w) || isNull(w.intervalEdit)) {
        return 1.0;
    }
    try {
        var typed = parseFloat(w.intervalEdit.text);
        if (!isNaN(typed) && typed > 0) {
            return typed;
        }
    } catch (e) {
        // unreadable field; fall through
    }
    return 1.0;
};

/** The reduce tolerance as a fraction of the spacing, from the panel. */
FeatureTrace.toleranceFraction = function() {
    var w = FeatureTrace.widgets;
    if (isNull(w) || isNull(w.smoothingCombo)) {
        return FeatureTrace.smoothingFraction(FeatureTrace.DEFAULT_SMOOTHING);
    }
    try {
        return FeatureTrace.smoothingFraction(w.smoothingCombo.currentText);
    } catch (e) {
        return FeatureTrace.smoothingFraction(FeatureTrace.DEFAULT_SMOOTHING);
    }
};

/** The combo entry meaning "no run: use the shared layer". */
FeatureTrace.RUN_SHARED = "(all runs)";

/** The run token the panel has selected, or null for the shared layer.
 *
 *  Sanitised on the way out so the panel and the layer name can never
 *  disagree about what run "a" means. */
FeatureTrace.runToken = function() {
    var w = FeatureTrace.widgets;
    if (isNull(w) || isNull(w.runCombo)) {
        return null;
    }
    try {
        var text = String(w.runCombo.currentText);
        if (text === FeatureTrace.RUN_SHARED) {
            return null;
        }
        return CsLayerVariants.sanitize(text);
    } catch (e) {
        return null;
    }
};

/** The run currently isolated, or null when every run is visible.
 *
 *  Held so that CHANGING the run hot-swaps the view instead of leaving
 *  the caver looking at the old run's band while tracing the new one --
 *  which is the invisible-work trap the Isolate button exists to avoid
 *  in the first place. */
FeatureTrace.isolatedRun = null;

/**
 * The run selection changed by hand. Hot-swaps the isolated view.
 *
 * A plain function rather than a closure in the signal wiring, so the
 * behaviour is testable without a live combo box.
 *
 * Only acts while something IS isolated: if the caver is looking at
 * every run, changing which run they trace should not suddenly hide the
 * rest of the cave.
 *
 * Wired to the combo's `activated`, which fires only on a real user
 * choice -- not on the programmatic clear/repopulate that refreshRuns
 * does. Using currentIndexChanged would have re-isolated mid-refresh,
 * against whatever selection existed for the instant after clear().
 */
FeatureTrace.onRunChosen = function() {
    if (FeatureTrace.isolatedRun === null) {
        FeatureTrace.refresh();
        return;
    }
    var run = FeatureTrace.runToken();
    if (run === null) {
        // "(all runs)" chosen while isolated: they asked for all of it.
        FeatureTrace.showAllRuns();
        return;
    }
    FeatureTrace.isolateSelectedRun();
};

/** Shows only the selected run's profile layers.
 *
 *  Refuses with a message when no run is selected rather than quietly
 *  showing everything: "(all runs)" and "isolate" are opposite
 *  intentions, and guessing which was meant would hide or reveal work
 *  the caver did not ask about. */
FeatureTrace.isolateSelectedRun = function() {
    var run = FeatureTrace.runToken();
    if (run === null) {
        EAction.handleUserMessage(qsTr("Pick a run above first -- " +
            "\"(all runs)\" has nothing to isolate."));
        return;
    }
    var doc = null, di = null;
    try {
        doc = EAction.getDocument();
        di = EAction.getDocumentInterface();
    } catch (eEnv) {
        return;
    }
    if (isNull(doc) || isNull(di)) {
        return;
    }
    try {
        var n = CsProfileDraw.isolateRun(doc, di, run);
        FeatureTrace.isolatedRun = run;
        FeatureTrace.refresh(doc);
        EAction.handleUserMessage(qsTr("Showing run %1 only (%2 layer(s) " +
            "hidden or shown).").arg(run).arg(n));
    } catch (e) {
        warning("Feature Trace: could not isolate run " + run + " (" + e + ")");
    }
};

/** Brings every profile run back into view. */
FeatureTrace.showAllRuns = function() {
    var doc = null, di = null;
    try {
        doc = EAction.getDocument();
        di = EAction.getDocumentInterface();
    } catch (eEnv) {
        return;
    }
    if (isNull(doc) || isNull(di)) {
        return;
    }
    try {
        var n = CsProfileDraw.showAllRuns(doc, di);
        FeatureTrace.isolatedRun = null;
        FeatureTrace.refresh(doc);
        EAction.handleUserMessage(qsTr("Every profile run is visible " +
            "again (%1 layer(s) changed).").arg(n));
    } catch (e) {
        warning("Feature Trace: could not show all runs (" + e + ")");
    }
};

/** Repopulates the run list from the bands the drawing actually has.
 *
 *  From CsProfileDraw.runsIn, which reads the SURVEY -- a caver picks
 *  the run first and the tool second, so the list must be populated
 *  before any elevation has been generated. Keeps the current selection
 *  when it still exists, so refreshing does not silently re-aim a caver
 *  mid-job. */
FeatureTrace.refreshRuns = function(docIn) {
    var w = FeatureTrace.widgets;
    if (isNull(w) || isNull(w.runCombo)) {
        return;
    }
    try {
        var doc = isNull(docIn) ? EAction.getDocument() : docIn;
        var runs = isNull(doc) ? [] : CsProfileDraw.runsIn(doc);
        var was = String(w.runCombo.currentText);
        w.runCombo.clear();
        w.runCombo.addItem(FeatureTrace.RUN_SHARED);
        for (var i = 0; i < runs.length; i++) {
            w.runCombo.addItem(runs[i]);
        }
        var found = false;
        for (var k = 0; k < w.runCombo.count; k++) {
            if (String(w.runCombo.itemText(k)) === was) {
                w.runCombo.currentIndex = k;
                found = true;
                break;
            }
        }
        // The isolated run has gone from the drawing -- its survey was
        // deleted. Leaving it isolated would show an empty elevation
        // with no way to tell why, so bring everything back.
        if (!found && FeatureTrace.isolatedRun !== null) {
            FeatureTrace.showAllRuns();
        }
    } catch (e) {
        // a stale run list must never stop a trace
    }
};

/** Reports what the last trace cost, so the caver can feel whether the
 *  smoothing suits the passage rather than guessing at a number. */
FeatureTrace.reportTrace = function(layerName, result) {
    var w = FeatureTrace.widgets;
    if (isNull(w) || isNull(w.lastLabel)) {
        return;
    }
    try {
        w.lastLabel.text = qsTr("Last: %1 -- %2 sampled, %3 kept")
            .arg(layerName).arg(result.sampled).arg(result.kept);
    } catch (e) {
        // a stale readout must never stop a trace
    }
};

/** Writes the cursor's frame into the panel. Defensive and silent. */
FeatureTrace.showCursorFrame = function(frame) {
    var w = FeatureTrace.widgets;
    if (isNull(w) || isNull(w.frameLabel)) {
        return;
    }
    try {
        w.frameLabel.text = qsTr("Cursor frame:  %1")
            .arg(String(frame).toUpperCase());
    } catch (e) {
        // as above
    }
};

/** One group box holding every row whose layer belongs to `frame`.
 *  Rows are selected by asking CsLayers.frameOf, so the group a button
 *  sits in and the frame its layer belongs to cannot disagree. */
FeatureTrace.buildGroup = function(w, parent, frame, title) {
    var box = new QGroupBox(title, parent);
    var inner = new QVBoxLayout();

    for (var i = 0; i < FeatureTrace.ROWS.length; i++) {
        var row = FeatureTrace.ROWS[i];
        if (CsLayers.frameOf(row.layer) !== frame) {
            continue;
        }
        try {
            var button = new QPushButton(row.label);
            button.checkable = true;
            button.toolTip = row.layer;
            FeatureTrace.connectRow(button, row);
            inner.addWidget(button, 0, 0);
            w.buttons.push({ button: button, row: row });
        } catch (e) {
            w.problems.push(row.layer + " (" + e + ")");
        }
    }

    box.setLayout(inner);
    return box;
};

/** Arms the row and starts a trace. Its own function so the closure
 *  captures ONE row rather than the loop variable. */
FeatureTrace.connectRow = function(button, row) {
    button.clicked.connect(function() {
        FeatureTrace.armLayer(row.layer);
        FeatureTrace.startRun();
    });
};

FeatureTrace.buildDock = function(appWin) {
    var dock = new QDockWidget(qsTr("Feature Trace"), appWin);
    // Without an objectName restoreState() cannot identify the dock and
    // silently forgets where it was.
    dock.objectName = "CaveSurveyFeatureTraceDock";

    var w = { problems: [], buttons: [] };
    var body = new QWidget(dock);
    var layout = new QVBoxLayout();

    // -- cursor frame readout ----------------------------------------
    try {
        w.frameLabel = new QLabel(qsTr("Cursor frame:  --"));
        layout.addWidget(w.frameLabel, 0, 0);
    } catch (eFrame) {
        w.problems.push("cursor frame readout (" + eFrame + ")");
    }

    // -- interval and smoothing --------------------------------------
    try {
        var settings = new QHBoxLayout();
        settings.addWidget(new QLabel(qsTr("Interval")), 0, 0);
        w.intervalEdit = new QLineEdit("1.0");
        w.intervalEdit.maximumWidth = 60;
        w.intervalEdit.toolTip = qsTr("Spacing between control points, in " +
            "FEET of cave -- converted for a metric drawing. This is sheet " +
            "smoothness, not a measurement: vertical exaggeration does not " +
            "change it.");
        settings.addWidget(w.intervalEdit, 0, 0);
        settings.addWidget(new QLabel(qsTr("ft")), 0, 0);

        settings.addWidget(new QLabel(qsTr("Smoothing")), 0, 0);
        w.smoothingCombo = new QComboBox();
        for (var si = 0; si < FeatureTrace.SMOOTHING.length; si++) {
            w.smoothingCombo.addItem(FeatureTrace.SMOOTHING[si].label);
        }
        // Selected by NAME. A hardcoded index silently selects the
        // wrong row the moment the table is reordered -- and it was.
        for (var sd = 0; sd < FeatureTrace.SMOOTHING.length; sd++) {
            if (FeatureTrace.SMOOTHING[sd].label ===
                    FeatureTrace.DEFAULT_SMOOTHING) {
                w.smoothingCombo.currentIndex = sd;
                break;
            }
        }
        w.smoothingCombo.toolTip = qsTr("How hard to thin the trace. " +
            "No Smoothing keeps every point -- one control point per " +
            "interval. Coarse keeps fewest. Detail is also capped by the " +
            "Interval: nothing smaller than that survives, whatever this " +
            "is set to.");
        settings.addWidget(w.smoothingCombo, 1, 0);
        layout.addLayout(settings, 0);
    } catch (eSettings) {
        w.problems.push("interval/smoothing (" + eSettings + ")");
    }

    // -- trace on whatever layer the drawing is set to ---------------
    // Its own button above the groups, not a row: the groups are the
    // registry's traceable features, and this is an escape hatch for
    // any layer the registry does not know about.
    try {
        w.currentButton = new QPushButton(qsTr("Trace on Current Layer"));
        w.currentButton.checkable = true;
        w.currentButton.toolTip = qsTr("Trace onto whichever layer the " +
            "drawing's current layer is, resolved when you draw. Use this " +
            "for a layer the feature list does not cover.");
        w.currentButton.clicked.connect(function() {
            FeatureTrace.armLayer(FeatureTrace.CURRENT_LAYER);
            FeatureTrace.startRun();
        });
        layout.addWidget(w.currentButton, 0, 0);
    } catch (eCur) {
        w.problems.push("current-layer button (" + eCur + ")");
    }

    // -- the two frame groups ----------------------------------------
    try {
        w.planGroup = FeatureTrace.buildGroup(w, body, "plan", qsTr("Plan"));
        layout.addWidget(w.planGroup, 0, 0);
        // The run selector sits HERE, directly above the group it
        // governs: it applies to profile features and to nothing else,
        // and a control at the top of the panel read as though it
        // applied to the plan rows too.
        try {
            var runRow = new QHBoxLayout();
            runRow.addWidget(
                new QLabel(qsTr("Work on Which Profile Run? :")), 0, 0);
            w.runCombo = new QComboBox();
            w.runCombo.addItem(FeatureTrace.RUN_SHARED);
            w.runCombo.toolTip = qsTr("Which survey run the profile " +
                "features below belong to. Each run is drawn as its own " +
                "band and the bands never overlap, so its walls get their " +
                "own layers. The plan rows above ignore this -- the plan " +
                "is one continuous map.");
            // `activated`, not currentIndexChanged: it fires only on a
            // real user choice, so refreshRuns' clear/repopulate cannot
            // trigger a spurious hot-swap.
            w.runCombo.activated.connect(function(index) {
                try {
                    FeatureTrace.onRunChosen();
                } catch (eSwap) {
                    // never throw out of a signal handler
                }
            });
            runRow.addWidget(w.runCombo, 1, 0);

            // Isolate acts on the run the combo has SELECTED, so the
            // visible run and the run being traced cannot drift apart.
            // They must not: an off layer still accepts a trace (emit
            // wraps the add in withLayerOn) and then hides it again, so
            // tracing a run you cannot see lands work you cannot find.
            w.isolateButton = new QPushButton(qsTr("Isolate"));
            w.isolateButton.toolTip = qsTr("Show only the selected run's " +
                "profile layers, band and traced work both. The shared " +
                "profile layers and the whole plan are left alone.");
            w.isolateButton.clicked.connect(function() {
                FeatureTrace.isolateSelectedRun();
            });
            runRow.addWidget(w.isolateButton, 0, 0);

            w.showAllButton = new QPushButton(qsTr("Show All"));
            w.showAllButton.toolTip = qsTr("Bring every profile run back " +
                "into view.");
            w.showAllButton.clicked.connect(function() {
                FeatureTrace.showAllRuns();
            });
            runRow.addWidget(w.showAllButton, 0, 0);

            layout.addLayout(runRow, 0);
        } catch (eRun) {
            w.problems.push("run selector (" + eRun + ")");
        }

        w.profileGroup = FeatureTrace.buildGroup(w, body, "profile",
            qsTr("Profile"));
        layout.addWidget(w.profileGroup, 0, 0);
    } catch (eGroups) {
        w.problems.push("feature groups (" + eGroups + ")");
    }

    // -- what the last trace cost ------------------------------------
    try {
        w.lastLabel = new QLabel(qsTr("Last: --"));
        layout.addWidget(w.lastLabel, 0, 0);
    } catch (eLast) {
        w.problems.push("last-trace readout (" + eLast + ")");
    }

    layout.addStretch(1);
    body.setLayout(layout);
    dock.setWidget(body);

    if (w.problems.length > 0) {
        warning("Feature Trace: this CaveCAD build refused: " +
            w.problems.join("; ") +
            " -- those controls are inert; the rest of the panel works.");
    }

    FeatureTrace.widgets = w;
    return dock;
};

/** The profile region, cached.
 *
 *  Cached because the cursor readout asks per mouse move and
 *  CsTrace.profileRegion walks every entity: a per-move scan would make
 *  the whole application crawl on a real cave. Refreshed on any
 *  transaction, which is when the region can actually change. */
FeatureTrace.regionBox = null;

/**
 * Repaints what the panel knows about the drawing.
 *
 * Both of these are otherwise SILENT failures: an off layer refuses adds
 * with no error, so an hour of tracing lands nowhere and nothing says
 * so; and a drawing with no elevation refuses every profile row for a
 * reason no click can explain.
 */
FeatureTrace.refresh = function(docIn) {
    var w = FeatureTrace.widgets;
    if (isNull(w)) {
        return;
    }
    // Guarded: EAction.getDocument does not exist in every engine this
    // code is loaded into (the headless test harness among them), and a
    // panel repaint must never be the thing that throws.
    var doc = docIn;
    if (isNull(doc)) {
        try {
            doc = EAction.getDocument();
        } catch (eDoc) {
            doc = null;
        }
    }

    if (!isNull(w.buttons)) {
        for (var i = 0; i < w.buttons.length; i++) {
            var entry = w.buttons[i];
            try {
                // The row's layer for the CURRENTLY selected run: that is
                // what a click would actually draw to, so that is the
                // layer whose state the caver needs to know about.
                var layerName = entry.row.layer;
                var run = FeatureTrace.runToken();
                if (run !== null &&
                        CsLayers.frameOf(layerName) === "profile") {
                    var v = CsLayerVariants.nameFor(layerName, run);
                    if (v !== null) {
                        layerName = v;
                    }
                }
                var off = false;
                if (!isNull(doc) && doc.hasLayer(layerName)) {
                    var lay = doc.queryLayer(layerName);
                    off = !isNull(lay) && lay.isOff();
                }
                entry.button.text = off ?
                    entry.row.label + "   (hidden)" : entry.row.label;
                entry.button.toolTip = off ?
                    layerName + " is switched OFF -- a trace will land on " +
                        "it but you will not see it" : layerName;
            } catch (e) {
                // an unreadable button is still armable; only its label
                // goes stale, and that must never stop a trace
            }
        }
    }

    try {
        if (!isNull(w.profileGroup)) {
            var hasRegion = !isNull(doc) &&
                CsTrace.profileRegion(doc) !== null;
            w.profileGroup.enabled = hasRegion;
            w.profileGroup.toolTip = hasRegion ? "" :
                qsTr("This drawing has no elevation yet -- run Generate " +
                    "Profile first.");
        }
    } catch (e2) {
        // leave the group as it is: a wrongly-enabled row still refuses
        // an out-of-frame press via frameGuard
    }
};

/**
 * Keeps the run list following the DRAWING rather than the panel's own
 * toggle. Idempotent -- installed once.
 *
 * Without this the list was only rebuilt when the dock was toggled or a
 * feature armed, so a panel that was already open (restored visible by
 * the saved window state at startup) never learned the runs of a drawing
 * opened afterwards. Opening a file, redrawing the notebook and deleting
 * geometry all run transactions, so this catches every path that can
 * change which runs exist.
 *
 * Guarded on dock VISIBILITY, because CsProfileDraw.runsIn walks every
 * entity: a hidden panel must not make every transaction in the
 * application pay for a scan it will not display.
 */
FeatureTrace.installListener = function(appWin) {
    if (FeatureTrace.listener !== undefined) {
        return;
    }
    try {
        var adapter = new RTransactionListenerAdapter();
        appWin.addTransactionListener(adapter);
        adapter.transactionUpdated.connect(function(document, transaction) {
            try {
                if (csFeatureTraceDock === undefined ||
                        csFeatureTraceDock === null ||
                        !csFeatureTraceDock.visible) {
                    return;
                }
                FeatureTrace.refreshRuns(document);
                // The region can only change on a transaction, which is
                // what lets the cursor readout cache it.
                try {
                    FeatureTrace.regionBox = isNull(document) ? null :
                        CsTrace.profileRegion(document);
                } catch (eBox) {
                    FeatureTrace.regionBox = null;
                }
                FeatureTrace.refresh(document);
            } catch (eInner) {
                // a listener must never throw into the application
            }
        });
        FeatureTrace.listener = adapter;

        // The cursor readout. A COORDINATE listener, not the trace
        // action's own mouse handler: that only fires while a trace is
        // already running, so the readout sat at "--" exactly when a
        // caver was deciding which row to arm.
        var coord = new RCoordinateListenerAdapter();
        appWin.addCoordinateListener(coord);
        coord.coordinateUpdated.connect(function(docIface) {
            try {
                if (csFeatureTraceDock === undefined ||
                        csFeatureTraceDock === null ||
                        !csFeatureTraceDock.visible || isNull(docIface)) {
                    return;
                }
                var pos = docIface.getLastPosition();
                if (isNull(pos)) {
                    return;
                }
                FeatureTrace.showCursorFrame(CsTrace.frameIn(
                    FeatureTrace.regionBox, { x: pos.x, y: pos.y }));
            } catch (eCoord) {
                // a listener must never throw into the application
            }
        });
        FeatureTrace.coordListener = coord;

        // Layer visibility is what the "(hidden)" markers report, and it
        // does not always change through a transaction.
        var layerAdapter = new RLayerListenerAdapter();
        appWin.addLayerListener(layerAdapter);
        layerAdapter.layersUpdated.connect(function(docIface, ids) {
            try {
                if (csFeatureTraceDock === undefined ||
                        csFeatureTraceDock === null ||
                        !csFeatureTraceDock.visible) {
                    return;
                }
                FeatureTrace.refresh(EAction.getDocument());
            } catch (eLay) {
                // as above
            }
        });
        FeatureTrace.layerListener = layerAdapter;
    } catch (e) {
        FeatureTrace.listener = null;
        warning("Feature Trace: could not watch the drawing for survey " +
            "runs (" + e + "); the run list refreshes when the panel is " +
            "reopened or a feature is armed.");
    }
};

/** Builds the dock and hands it to the main window. Idempotent. */
FeatureTrace.ensureDock = function() {
    if (csFeatureTraceDock !== undefined && csFeatureTraceDock !== null) {
        return csFeatureTraceDock;
    }
    var appWin = RMainWindowQt.getMainWindow();
    csFeatureTraceDock = FeatureTrace.buildDock(appWin);
    appWin.addDockWidget(Qt.RightDockWidgetArea, csFeatureTraceDock);
    return csFeatureTraceDock;
};

/** Hands control to the drag action.
 *
 *  Looks the action up by script file and passes it in, rather than
 *  constructing with null: stock Print.js does exactly this, and
 *  EAction's null-guiAction paths are not exercised anywhere. */
FeatureTrace.startRun = function() {
    var di = EAction.getDocumentInterface();
    if (isNull(di)) {
        return;
    }

    // If a trace is ALREADY the current action, just leave it running:
    // armLayer has already changed the target, and the next stroke picks
    // it up. Calling setCurrentAction again would make QCAD tear down
    // the action that is running this very click --
    // deleteTerminatedActions() frees it and the return lands in freed
    // memory. That is a hard SIGSEGV, and it is what a snap-action
    // trigger from inside the action lifecycle already cost us once.
    try {
        var current = di.getCurrentAction();
        if (!isNull(current) && current instanceof FeatureTraceRun) {
            return;
        }
    } catch (e) {
        // cannot read the current action; fall through and start one
    }

    var runAction = RGuiAction.getByScriptFile(
        FeatureTrace.basePath + "/FeatureTraceRun.js");
    di.setCurrentAction(new FeatureTraceRun(runAction));
};

FeatureTrace.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);

    try {
        var existed = (csFeatureTraceDock !== undefined &&
            csFeatureTraceDock !== null);
        var dock = FeatureTrace.ensureDock();
        dock.visible = existed ? !dock.visible : true;
        // The drawing may have gained or lost bands since last time.
        FeatureTrace.refreshRuns();
        try {
            var shown = EAction.getDocument();
            FeatureTrace.regionBox = isNull(shown) ? null :
                CsTrace.profileRegion(shown);
            FeatureTrace.refresh(shown);
        } catch (eShow) {
            // a stale panel must never stop the tool opening
        }
    } catch (e) {
        csFeatureTraceDock = undefined;
        warning("Feature Trace: this CaveCAD build refused the docked " +
            "panel (" + e + ") -- please report this.");
    }

    this.terminate();
};

FeatureTrace.init = function(basePath) {
    FeatureTrace.basePath = basePath;

    var action = new RGuiAction(qsTr("Feature Trace"),
        RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/FeatureTrace.js");
    action.setIcon(basePath + "/FeatureTrace.svg");
    action.setStatusTip(qsTr("Trace cave walls and other features freehand: " +
        "drag along the sketch and a smooth line follows"));
    action.setDefaultCommands(["featuretrace", "ft"]);
    action.setGroupSortOrder(450);
    // 45 puts this beside Scatter Breakdown (40), the other drawing
    // tool. 75 -- the number first proposed -- is Generate Profile's,
    // and a clash leaves menu order down to load sequence.
    action.setSortOrder(45);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);

    FeatureTraceRun.init(basePath);

    // Build the dock NOW, during add-on init: the main window's
    // readSettings()/restoreState() runs after init and can only place
    // (and re-show) a dock that already exists. Created hidden; the
    // saved window state decides whether it opens, exactly like QCAD's
    // own docks. First-ever run: stays hidden until the action shows it.
    try {
        var dock = FeatureTrace.ensureDock();
        dock.visible = false;
        FeatureTrace.installListener(RMainWindowQt.getMainWindow());
    } catch (eInit) {
        csFeatureTraceDock = undefined;
        warning("Feature Trace: could not build the panel at startup (" +
            eInit + "); the menu entry will try again.");
    }
};
