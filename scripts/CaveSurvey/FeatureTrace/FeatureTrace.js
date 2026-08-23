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

/**
 * TEMPORARY DIAGNOSTICS -- remove once the vanishing-commit bug is closed.
 *
 * Writes one line per event to ~/Documents/Cave/feature-trace-debug.log.
 * A file and not handleUserMessage because the command line shows one
 * line at a time and the question is the SEQUENCE: which handlers fire,
 * with what state, and where it stops.
 */
FeatureTrace.LOG_PATH = undefined;

FeatureTrace.log = function(line) {
    try {
        if (isNull(FeatureTrace.LOG_PATH)) {
            FeatureTrace.LOG_PATH = QDir.homePath() +
                "/Documents/Cave/feature-trace-debug.log";
        }
        var f = new QFile(FeatureTrace.LOG_PATH);
        // Plain bitwise OR: this bridge has NO QIODevice.OpenMode
        // constructor, and `new QIODevice.OpenMode(...)` throws inside
        // the try/catch below -- which is exactly why the first version
        // of this logger wrote nothing while every test stayed green.
        if (!f.open(QIODevice.WriteOnly | QIODevice.Append |
                QIODevice.Text)) {
            return;
        }
        var out = new QTextStream(f);
        out.writeString(String(line) + "\n");
        f.close();
    } catch (e) {
        // diagnostics must never break the tool they are diagnosing
    }
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
    } catch (eInit) {
        csFeatureTraceDock = undefined;
        warning("Feature Trace: could not build the panel at startup (" +
            eInit + "); the menu entry will try again.");
    }
};
