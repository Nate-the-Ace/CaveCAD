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
// The shaped-line draw action, so this panel can arm a ledge or a
// scallop as readily as a wall: same gesture, same freehand drag, same
// view routing -- the only difference is that ornament comes with it.
// See SHAPED_ROWS below.
include(includeBasePath + "/../ShapedLines/ShapedLinesRun.js");

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
 * The seven traceable features. ONE ROW PER FEATURE, not per view.
 *
 * The panel used to hold fifteen rows -- every feature once for each of
 * plan, profile and section -- inside three group boxes, and pressing
 * the wrong group's button was refused at the cursor. That refusal was
 * the tool asking the caver to say in a button what the drawing already
 * knew: a section bay's frame and a profile band's bounding box both
 * state, in the drawing, exactly which view a point belongs to. So the
 * view is READ from where the stroke lands (FeatureTraceRun.targetLayer)
 * and a feature needs one button.
 *
 * The `layer` is the PLAN-FRAME name, and it is the feature's identity
 * rather than its destination: CsLayers.twinFor turns BREAKDOWN into
 * PROFILE-BREAKDOWN or SECTION-BREAKDOWN at trace time, from the one
 * table that already derives every twin in the registry. A per-view
 * name spelled here would be a second copy of that derivation, free to
 * disagree with it.
 *
 * Layer CONSTANTS, never literals. CsLayers.CTRL_FLOOR is the GENERATED
 * layer and CsLayers.FLOOR the hand-traced one: one word apart,
 * opposite meanings, and tracing onto the generated one would look fine
 * until the next redraw erased the work. A test asserts every row here
 * is a plan-frame linework layer, which is false for anything CTRL-.
 */
FeatureTrace.ROWS = [
    { label: "Surveyed Walls", layer: CsLayers.WALLS_SURVEYED },
    { label: "Inferred Walls", layer: CsLayers.WALLS_INFERRED },
    { label: "Breakdown", layer: CsLayers.BREAKDOWN },
    { label: "Breakdown Boundary", layer: CsLayers.BREAKDOWN_BOUNDARY },
    { label: "Entrance", layer: CsLayers.ENTRANCE },
    { label: "Ceiling", layer: CsLayers.CEILING },
    { label: "Floor", layer: CsLayers.FLOOR }
];

/**
 * The shaped lines: the same freehand gesture, with NSS ornament
 * generated along the stroke and kept in step with it afterwards.
 *
 * WHY THEY LIVE IN THIS PANEL (Nathan's call, 2026-09-07). They were a
 * toolbar of their own, which made two front doors for one act: a caver
 * tracing a cave draws walls, ledges and flowstone in the same breath,
 * with the same drag, and had to know that six of those live somewhere
 * else. A shaped line IS a traced feature -- it just brings hachures.
 *
 * `style` is the CsShapeLine.STYLES key, and it is what marks a row as
 * shaped: armLayer starts the shaped action for these and the plain
 * one for everything in ROWS. The layer is the STYLE's own spine layer,
 * carried here only so the tile can paint itself in the right colour.
 */
FeatureTrace.SHAPED_ROWS = [
    { label: "Floor Ledge", style: "floorledge" },
    { label: "Ceiling Ledge", style: "ceilingledge" },
    { label: "Pit", style: "pit" },
    { label: "Flowstone", style: "flowstone" },
    { label: "Rimstone Dam", style: "rimstone" },
    { label: "Slope", style: "slope" }
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

/**
 * The row the panel starts on.
 *
 * NO SMOOTHING, Nathan's call: a caver tracing a wall off a scan is
 * copying a line someone already drew, and thinning it is the tool
 * second-guessing a measurement. Anyone who wants it thinned picks a
 * row.
 *
 * DELIBERATELY NOT the fallback below. This is a starting CHOICE and
 * is allowed to be a tolerance of zero; the fallback is what an
 * unrecognised name lands on, and zero would be wrong there -- see
 * FALLBACK_SMOOTHING.
 */
FeatureTrace.DEFAULT_SMOOTHING = "No Smoothing";

/**
 * The sample interval, in FEET of cave. Fixed.
 *
 * IT USED TO BE A FIELD, and the field is gone (Nathan, 2026-09-07:
 * "we can remove the interval setting and the smoothness, keep it at
 * 1ft and no smoothing"). Both boxes sat at the top of the panel asking
 * a caver to answer two questions about fidelity before they had chosen
 * what they were drawing, and in practice the answer was always the one
 * they are set to here. The values live on so the machinery below reads
 * the same as it always did -- and so a future panel that wants them
 * back has something to bind to.
 */
FeatureTrace.INTERVAL_FEET = 1.0;

/**
 * Where an unrecognised smoothing name lands.
 *
 * SEPARATE FROM DEFAULT_SMOOTHING since the panel's starting row became
 * a zero tolerance. Folding the two together would make a misspelled or
 * stale name silently mean "keep every sampled point" -- the
 * 400-fit-point spline this whole reduction exists to avoid -- which is
 * exactly the failure the fallback was written to stop.
 */
FeatureTrace.FALLBACK_SMOOTHING = "Fine";

/** The fraction for a smoothing name. An unrecognised name falls back
 *  to FALLBACK_SMOOTHING, never to a tolerance of zero. */
FeatureTrace.smoothingFraction = function(name) {
    var i;
    for (i = 0; i < FeatureTrace.SMOOTHING.length; i++) {
        if (FeatureTrace.SMOOTHING[i].label === name) {
            return FeatureTrace.SMOOTHING[i].fraction;
        }
    }
    for (i = 0; i < FeatureTrace.SMOOTHING.length; i++) {
        if (FeatureTrace.SMOOTHING[i].label ===
                FeatureTrace.FALLBACK_SMOOTHING) {
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
    FeatureTrace.clearShaped();
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
    return FeatureTrace.INTERVAL_FEET;
};

/**
 * How hard a trace is thinned: not at all.
 *
 * See INTERVAL_FEET. No Smoothing was already the panel's starting
 * choice, on the grounds that thinning a traced wall is the tool
 * second-guessing a measurement; with the control gone it is simply
 * what the tool does.
 */
FeatureTrace.toleranceFraction = function() {
    return FeatureTrace.smoothingFraction(FeatureTrace.DEFAULT_SMOOTHING);
};

FeatureTrace.RUN_SHARED = "Not tied to a band";

/** The combo entry meaning "read the run off WHERE the stroke lies" --
 *  the band bounding boxes (CsProfileBox) answer at commit time. The
 *  DEFAULT since the boxes exist: the caver traces inside the band
 *  they are working on anyway, so asking them to also say so in a
 *  combo was a second statement of the same fact. */
FeatureTrace.RUN_AUTO = "From the band I draw in";

/** The run token the panel has selected, or null for the shared layer.
 *
 *  AUTO also answers null here, deliberately: every existing caller of
 *  this function (variant resolution at arm time, isolation) wants "a
 *  specific run the caver named", and in auto mode there is none until
 *  a stroke exists -- FeatureTraceRun.commit resolves it then, from
 *  the stroke itself.
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
        if (text === FeatureTrace.RUN_SHARED ||
                text === FeatureTrace.RUN_AUTO) {
            return null;
        }
        return CsLayerVariants.sanitize(text);
    } catch (e) {
        return null;
    }
};

/** True when the run should be read off the stroke's location. Also
 *  true with NO PANEL AT ALL: a drag action running standalone has
 *  nobody to name a run, and location is the only voice left. */
FeatureTrace.runIsAuto = function() {
    var w = FeatureTrace.widgets;
    if (isNull(w) || isNull(w.runCombo)) {
        return true;
    }
    try {
        return String(w.runCombo.currentText) === FeatureTrace.RUN_AUTO;
    } catch (e) {
        return true;
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
    // Always repaint: choosing a run enables the Profile group, and
    // choosing "(all runs)" disables it again.
    FeatureTrace.refresh();
    if (FeatureTrace.isolatedRun === null) {
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
        // The selector must say what the view shows, or the panel claims
        // a run is in focus when every run is on screen.
        try {
            var w2 = FeatureTrace.widgets;
            if (!isNull(w2) && !isNull(w2.runCombo)) {
                for (var i2 = 0; i2 < w2.runCombo.count; i2++) {
                    if (String(w2.runCombo.itemText(i2)) ===
                            FeatureTrace.RUN_SHARED) {
                        w2.runCombo.currentIndex = i2;
                        break;
                    }
                }
            }
        } catch (eSel) {
            // the readout is a nicety; the layers already changed
        }
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
        // AUTO first, so index 0 -- the default a fresh combo lands
        // on -- is "read the run off the stroke's location".
        w.runCombo.addItem(FeatureTrace.RUN_AUTO);
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

/**
 * Writes the cursor's view -- and the layer that view means -- into the
 * panel. Defensive and silent.
 *
 * THE LAYER HALF IS THE SAFETY RAIL. With no per-view buttons, nothing
 * refuses a stroke for being in the wrong view: an elevation wall
 * traced a foot outside the profile region is a perfectly good PLAN
 * wall, and it lands silently. This readout is what makes that visible
 * BEFORE the press -- it changes as the cursor crosses a boundary, so
 * the caver sees WALLS-SURVEYED where they expected
 * PROFILE-WALLS-SURVEYED-A while there is still nothing to undo.
 *
 * `layer` is optional: a caller with no armed feature to resolve (or
 * one that predates this) still gets the view on its own.
 */
FeatureTrace.showCursorFrame = function(frame, layer) {
    var w = FeatureTrace.widgets;
    if (isNull(w) || isNull(w.frameLabel)) {
        return;
    }
    try {
        var text = qsTr("Cursor:  %1").arg(String(frame).toUpperCase());
        if (!isNull(layer) && String(layer).length > 0) {
            text += "  --  " + String(layer);
        }
        w.frameLabel.text = text;
    } catch (e) {
        // as above
    }
};

// THE FEATURE TILES ARE A GRID, NOT A LIST.
//
// One full-width button per feature made a column that grew every time
// a feature was added, until telling one entry from the next meant
// reading the whole stack -- and the buttons set the dock's width while
// they were at it. Fixed-size tiles in a grid mean a new feature is
// APPENDED to the next free cell: the panel grows a row for every
// GRID_COLUMNS features rather than for every one, and the shape stays
// scannable.
FeatureTrace.GRID_COLUMNS = 2;
FeatureTrace.CELL_W = 104;
FeatureTrace.CELL_H = 56;
/** Roughly how many characters fit on one line of a tile. Used only to
 *  break the label -- QPushButton renders "\n" but will not wrap for
 *  itself (probed 2026-08-29). */
FeatureTrace.CELL_CHARS = 12;

/**
 * A label broken over as many lines as it takes, greedily, on spaces.
 * A single word longer than the budget is left alone: a mid-word break
 * is harder to read than an overhang.
 */
FeatureTrace.wrapLabel = function(text, budget) {
    var words = String(text).split(" ");
    var lines = [];
    var line = "";
    for (var i = 0; i < words.length; i++) {
        if (line.length === 0) {
            line = words[i];
        } else if (line.length + 1 + words[i].length <= budget) {
            line += " " + words[i];
        } else {
            lines.push(line);
            line = words[i];
        }
    }
    if (line.length > 0) {
        lines.push(line);
    }
    return lines.join("\n");
};

/** The one group box: every feature, as a grid of fixed-size tiles.
 *
 *  No frame filter and no per-view groups. A tile is a FEATURE, and the
 *  view it draws into is decided by where the caver drags -- see
 *  FeatureTrace.ROWS. `header` is the profile run selector, which sits
 *  inside the box above the tiles because it refines what a profile
 *  stroke lands on rather than choosing it. */
FeatureTrace.buildGroup = function(w, parent, title, header, collapsed) {
    var section = CsPanel.section(parent, title,
        FeatureTrace.COLLAPSED_SETTING, collapsed);
    var box = section.box;
    var inner = new QGridLayout();
    var cell = 0;
    var firstRow = 0;
    if (header !== undefined && header !== null) {
        try {
            inner.addLayout(header, 0, 0, 1, FeatureTrace.GRID_COLUMNS);
            firstRow = 1;
        } catch (eHeader) {
            w.problems.push(title + " header (" + eHeader + ")");
        }
    }

    for (var i = 0; i < FeatureTrace.ROWS.length; i++) {
        var row = FeatureTrace.ROWS[i];
        try {
            // A TOOL button, not a push button: QPushButton lays icon
            // and text side by side with no way to stack them, so the
            // name ends up cut off next to the picture.
            var button = new QToolButton();
            button.text = FeatureTrace.wrapLabel(row.label,
                FeatureTrace.CELL_CHARS);
            try {
                button.toolButtonStyle = Qt.ToolButtonTextUnderIcon;
            } catch (eStyle) {
            }
            button.checkable = true;
            button.toolTip = row.layer;
            var icon = FeatureTrace.iconForLayer(row.layer);
            if (icon !== null) {
                try {
                    button.icon = icon;
                    button.iconSize = new QSize(FeatureTrace.ICON,
                        FeatureTrace.ICON);
                } catch (eIcon) {
                }
            }
            try {
                button.setFixedSize(FeatureTrace.CELL_W + 20,
                    FeatureTrace.CELL_H + 24);
            } catch (eSize) {
                // a bridge without setFixedSize gets tiles that stretch;
                // the grid still reads as a grid
            }
            FeatureTrace.connectRow(button, row);
            inner.addWidget(button,
                firstRow + Math.floor(cell / FeatureTrace.GRID_COLUMNS),
                cell % FeatureTrace.GRID_COLUMNS);
            cell++;
            w.buttons.push({ button: button, row: row });
        } catch (e) {
            w.problems.push(row.layer + " (" + e + ")");
        }
    }

    try {
        // Fixed-size tiles in a stretching grid would drift apart as the
        // dock widens; the stretch goes to a column PAST the last one,
        // so the tiles stay packed at the left in a steady grid.
        inner.setColumnStretch(FeatureTrace.GRID_COLUMNS, 1);
    } catch (eStretch) {
    }

    // The escape hatch, under the tiles it is an alternative to.
    if (!isNull(w.currentButton)) {
        try {
            inner.addWidget(w.currentButton,
                firstRow + Math.ceil(cell / FeatureTrace.GRID_COLUMNS),
                0, 1, FeatureTrace.GRID_COLUMNS);
        } catch (eHatch) {
            w.problems.push("current-layer button placement (" + eHatch + ")");
        }
    }

    section.host.setLayout(inner);
    return box;
};

/**
 * Every layer a feature can land on: its plan name and its two twins,
 * refined by the selected run where a run is selected.
 *
 * One tile, three destinations -- that IS the tool now, and this is the
 * one place that list is built, so the tooltip, the "(hidden)" marker
 * and anything added later cannot each derive it slightly differently.
 * The frames come from CsLayers.twinFor, which skips a twin the
 * registry refuses (CsLayers.NO_TWIN), so a feature with no section
 * counterpart simply lists two.
 *
 * Pure apart from the run combo read.
 */
FeatureTrace.destinationsOf = function(base) {
    var frames = ["plan", "profile", "section"];
    var run = FeatureTrace.runToken();
    var out = [];
    for (var i = 0; i < frames.length; i++) {
        var name = CsLayers.twinFor(base, frames[i]);
        if (name === null) {
            continue;
        }
        if (frames[i] === "profile" && run !== null) {
            var v = CsLayerVariants.nameFor(name, run);
            if (v !== null) {
                name = v;
            }
        }
        out.push(name);
    }
    return out;
};

/** Arms the row and starts a trace. Its own function so the closure
 *  captures ONE row rather than the loop variable. */
FeatureTrace.connectRow = function(button, row) {
    button.clicked.connect(function() {
        FeatureTrace.armLayer(row.layer);
        FeatureTrace.startRun();
    });
};

/** The armed SHAPED style, or null when a plain feature is armed.
 *  Read by nothing but this file -- the shaped action takes its style
 *  from its own prototype, and startShaped sets that. */
FeatureTrace.shapedStyle = undefined;

/**
 * Arms a shaped line and starts its draw action.
 *
 * The two kinds of tile are exclusive: arming one clears the other's
 * checked mark, because exactly one thing happens when the caver drags.
 */
FeatureTrace.armShaped = function(styleKey) {
    FeatureTrace.shapedStyle = styleKey;
    FeatureTrace.target = undefined;
    var w = FeatureTrace.widgets;
    if (!isNull(w)) {
        var i;
        try {
            if (!isNull(w.currentButton)) {
                w.currentButton.checked = false;
            }
        } catch (eCur) {
        }
        for (i = 0; i < w.buttons.length; i++) {
            try {
                w.buttons[i].button.checked = false;
            } catch (ePlain) {
            }
        }
        for (i = 0; i < w.shapedButtons.length; i++) {
            try {
                w.shapedButtons[i].button.checked =
                    (w.shapedButtons[i].row.style === styleKey);
            } catch (eShaped) {
            }
        }
    }
    FeatureTrace.startShaped(styleKey);
};

/** Clears any armed shaped tile. Called when a plain feature is armed,
 *  so the panel never shows two things armed at once. */
FeatureTrace.clearShaped = function() {
    FeatureTrace.shapedStyle = undefined;
    var w = FeatureTrace.widgets;
    if (isNull(w) || isNull(w.shapedButtons)) {
        return;
    }
    for (var i = 0; i < w.shapedButtons.length; i++) {
        try {
            w.shapedButtons[i].button.checked = false;
        } catch (e) {
        }
    }
};

/** Arms one shaped row. Its own function for connectRow's reason. */
FeatureTrace.connectShapedRow = function(button, row) {
    button.clicked.connect(function() {
        FeatureTrace.armShaped(row.style);
    });
};

/**
 * Hands control to the SHAPED draw action, armed to one style.
 *
 * The per-style subclasses (LedgeFloorDraw and friends) exist so the
 * old toolbar could have one button per style; from here the style is
 * set on the instance instead, which is the same thing the subclass
 * did in three lines. The typed commands still reach the subclasses.
 */
FeatureTrace.startShaped = function(styleKey) {
    var di = EAction.getDocumentInterface();
    if (isNull(di)) {
        return;
    }
    // Already drawing a shaped line? Re-style the running action rather
    // than replacing it: setCurrentAction on the action that is running
    // this very click tears it down under itself, which is a SIGSEGV
    // this suite has paid for once already.
    try {
        var current = di.getCurrentAction();
        if (!isNull(current)) {
            var file = String(current.getGuiAction().getScriptFile());
            if (file.indexOf("ShapedLinesRun.js") !== -1 ||
                    file.indexOf("Draw.js") !== -1) {
                ShapedLinesRun.prototype.styleKey = styleKey;
                return;
            }
        }
    } catch (e) {
    }
    var runAction = RGuiAction.getByScriptFile(
        FeatureTrace.basePath + "/../ShapedLines/ShapedLinesRun.js");
    var action = new ShapedLinesRun(runAction);
    action.styleKey = styleKey;
    di.setCurrentAction(action);
};

/** Where this panel's collapsed sections are remembered. Its own key,
 *  the Symbol Palette's its own -- one caver may want the shaped lines
 *  shut and every symbol category open. */
FeatureTrace.COLLAPSED_SETTING = "CaveSurvey/FeatureTraceCollapsed";

/** The section titles, named once because they are BOTH the heading a
 *  caver reads and the key their collapsed state is filed under. */
FeatureTrace.SEC_FEATURES = "Draw a feature";
FeatureTrace.SEC_SHAPED = "Draw a shaped line";
FeatureTrace.SEC_HOW = "How it draws";
FeatureTrace.SEC_BANDS = "Elevation bands";

/** Tile icon size, in pixels. Bigger than the Symbol Palette's: a
 *  ledge tile has to show hachures ON one side of a line, which is
 *  three strokes deep before it reads at all. */
FeatureTrace.ICON = 34;

/**
 * The picture on a PLAIN feature's tile: a sample of the line that
 * feature draws, in its own layer's colour and dashedness.
 *
 * The tile is then a legend entry you can draw from -- an inferred wall
 * is dashed in the panel because it is dashed on the map -- and the
 * colour comes from CsLayers.styleOf, the one place layer appearance is
 * resolved, so a tile cannot quietly disagree with the drawing.
 */
FeatureTrace.iconForLayer = function(layerName) {
    try {
        var curve = CsTileArt.sampleCurve(10, 20);
        return CsTileArt.iconOfClouds([curve], FeatureTrace.ICON,
            CsTileArt.penForLayer(layerName));
    } catch (e) {
        return null;
    }
};

/**
 * The picture on a SHAPED tile: a sample stroke with the style's own
 * ornament generated along it, by the same CsShapeLine.prims the
 * drawing uses.
 *
 * GENERATED, NOT DRAWN. A hand-drawn icon of a ledge is a promise about
 * what the tool does; this is the tool doing it, at tile size. Change
 * the hachure spacing tomorrow and every tile changes with it.
 */
FeatureTrace.iconForStyle = function(styleKey) {
    try {
        var spec = CsShapeLine.STYLES[styleKey];
        if (isNull(spec)) {
            return null;
        }
        // The sample is as long as it needs to be to show FOUR of
        // whatever this style repeats, at the style's OWN spacing. A
        // fixed-length sample would have shown a 5 ft ceiling-ledge
        // spacing as two lonely hachures and a 2 ft rimstone as a
        // scribble; stretching the line instead of squeezing the
        // ornament keeps the tile an honest picture of the spacing.
        var feet = Math.max(10, spec.spacingFeet * 4);
        var pts = spec.close === true ?
            CsTileArt.sampleRing(feet, 20) : CsTileArt.sampleCurve(feet, 20);
        var side = spec.close === true ?
            CsShapeLine.inwardSide(pts) : 1;
        // Spacing and size are the STYLE's, scaled to the sample: at
        // true cave spacing a 10 ft sample carries three hachures,
        // which is exactly what the tile should show.
        var prims = CsShapeLine.prims(pts, spec.close === true, spec,
            side, spec.spacingFeet,
            isNull(spec.sizeFeet) ? 2 : spec.sizeFeet);
        // prims answers { lines, polylines }: a line is a PAIR of
        // points, and a scallop chain is one bulged polyline
        // ({points, bulges, closed}) rather than a list of arcs.
        var clouds = [pts.slice(0)];
        if (spec.close === true) {
            clouds[0].push(pts[0]);   // close the ring for painting
        }
        var i, j;
        for (i = 0; i < prims.lines.length; i++) {
            var seg = prims.lines[i];
            if (!isNull(seg) && seg.length >= 2) {
                clouds.push([seg[0], seg[1]]);
            }
        }
        for (i = 0; i < prims.polylines.length; i++) {
            var chain = prims.polylines[i];
            if (isNull(chain) || chain.points.length < 2) {
                continue;
            }
            // Each bulged segment sampled the way the drawing samples
            // one, so a scallop in the tile is the curve it will be on
            // the map rather than the chord across it.
            var walk = [];
            var lastIndex = chain.closed ? chain.points.length :
                chain.points.length - 1;
            for (j = 0; j < lastIndex; j++) {
                var a = chain.points[j];
                var b = chain.points[(j + 1) % chain.points.length];
                CsShapeLine.sampleBulgeSeg(a, b, chain.bulges[j],
                    spec.spacingFeet / 8, walk);
            }
            if (walk.length > 1) {
                clouds.push(walk);
            }
        }
        return CsTileArt.iconOfClouds(clouds, FeatureTrace.ICON,
            CsTileArt.penForLayer(spec.decorLayer));
    } catch (e) {
        return null;
    }
};

/**
 * The shaped-line group: one tile per NSS line symbol, each showing its
 * own ornament.
 */
FeatureTrace.buildShapedGroup = function(w, parent, collapsed) {
    var section = CsPanel.section(parent, FeatureTrace.SEC_SHAPED,
        FeatureTrace.COLLAPSED_SETTING, collapsed);
    var box = section.box;
    var inner = new QGridLayout();
    var cell = 0;
    for (var i = 0; i < FeatureTrace.SHAPED_ROWS.length; i++) {
        var row = FeatureTrace.SHAPED_ROWS[i];
        try {
            var spec = CsShapeLine.STYLES[row.style];
            var button = new QToolButton();
            button.text = FeatureTrace.wrapLabel(row.label,
                FeatureTrace.CELL_CHARS);
            try {
                button.toolButtonStyle = Qt.ToolButtonTextUnderIcon;
            } catch (eStyle) {
            }
            button.checkable = true;
            button.toolTip = row.label + "\n" +
                (isNull(spec) ? "" : spec.decorLayer) + "\n" +
                qsTr("Drag along the line, then point at the side the " +
                    "ornament goes and click.");
            var icon = FeatureTrace.iconForStyle(row.style);
            if (icon !== null) {
                try {
                    button.icon = icon;
                    button.iconSize = new QSize(FeatureTrace.ICON,
                        FeatureTrace.ICON);
                } catch (eIcon) {
                }
            }
            try {
                button.setFixedSize(FeatureTrace.CELL_W + 20,
                    FeatureTrace.CELL_H + 24);
            } catch (eSize) {
            }
            FeatureTrace.connectShapedRow(button, row);
            inner.addWidget(button,
                Math.floor(cell / FeatureTrace.GRID_COLUMNS),
                cell % FeatureTrace.GRID_COLUMNS);
            cell++;
            w.shapedButtons.push({ button: button, row: row });
        } catch (e) {
            w.problems.push(row.style + " (" + e + ")");
        }
    }
    try {
        inner.setColumnStretch(FeatureTrace.GRID_COLUMNS, 1);
    } catch (eStretch) {
    }
    section.host.setLayout(inner);
    return box;
};

FeatureTrace.buildDock = function(appWin) {
    var dock = new QDockWidget(qsTr("Feature Trace"), appWin);
    // Without an objectName restoreState() cannot identify the dock and
    // silently forgets where it was.
    dock.objectName = "CaveSurveyFeatureTraceDock";

    var w = { problems: [], buttons: [], shapedButtons: [] };
    var body = new QWidget(dock);
    var layout = new QVBoxLayout();
    var collapsed = CsPanel.loadCollapsed(FeatureTrace.COLLAPSED_SETTING);

    // -- cursor frame readout ----------------------------------------
    try {
        w.frameLabel = new QLabel(qsTr("Cursor:  --"));
        layout.addWidget(w.frameLabel, 0, 0);
    } catch (eFrame) {
        w.problems.push("cursor frame readout (" + eFrame + ")");
    }

    // -- trace onto whatever layer the drawing is set to -------------
    //
    // The one control left from what used to be a settings section.
    // Interval and Smoothing lived here and are now fixed at one foot
    // and none (FeatureTrace.INTERVAL_FEET): two questions about
    // fidelity, asked before the caver had chosen what to draw, whose
    // answer never changed. This is not a setting -- it is a feature
    // choice, for a layer the tile list does not cover -- so it sits
    // with the tiles rather than above them.
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
    } catch (eCur) {
        w.problems.push("current-layer button (" + eCur + ")");
    }

    // -- the features ------------------------------------------------
    //
    // ONE group. There were three -- Plan, Profile, Cross Section --
    // and picking the right one was the caver restating which view they
    // were already looking at. The view is read from the stroke now, so
    // the groups had nothing left to divide.
    try {
        // THE RUN CONTROLS ARE THEIR OWN SECTION NOW, below the tiles.
        // They sat inside the Feature box, above the tiles, where they
        // read as something to answer before choosing a feature --
        // Nathan, 2026-09-07: "What does the Run > By Location control
        // do in this context? It is unclear." They have nothing to do
        // with which feature is armed: they are about the ELEVATION,
        // where each survey run is drawn as its own band, and they do
        // nothing at all to a stroke in the plan.
        var runRow = null;
        try {
            runRow = CsPanel.formGrid(2);
            // What the section is for, in the panel rather than in a
            // tooltip nobody hovers.
            var bandsWhy = new QLabel(qsTr("Only affects strokes drawn " +
                "in the elevation."));
            bandsWhy.wordWrap = true;
            try {
                bandsWhy.setMinimumWidth(1);
            } catch (eWide) {
            }
            runRow.addWidget(bandsWhy, 0, 0, 1, 2);
            runRow.addWidget(new QLabel(qsTr("Band")), 1, 0);
            w.runCombo = new QComboBox();
            // Seeded in the same order refreshRuns() repopulates it:
            // refreshRuns' first call preserves "the prior selection" if
            // it still exists in the new list, and a bootstrap of
            // RUN_SHARED alone made that prior selection RUN_SHARED --
            // permanently defeating the documented AUTO-first default on
            // every dock's first population.
            w.runCombo.addItem(FeatureTrace.RUN_AUTO);
            w.runCombo.addItem(FeatureTrace.RUN_SHARED);
            w.runCombo.toolTip = qsTr("The extended elevation draws each " +
                "survey run as its own BAND, and a line traced in a band " +
                "belongs to that run -- so it moves with the band when " +
                "the survey is revised, instead of being left behind.\n\n" +
                "\"From the band I draw in\" reads that off the band you " +
                "drew inside, which is why it is the default: you were " +
                "already in the right band. Naming a band instead files " +
                "every stroke under it wherever you draw. \"Not tied to " +
                "a band\" uses the shared elevation layers, and a revision " +
                "will not carry that work with any band.\n\nStrokes in " +
                "the plan and in a cross section ignore this entirely.");
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
            runRow.addWidget(w.runCombo, 1, 1);

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
            runRow.addWidget(w.isolateButton, 2, 0);

            w.showAllButton = new QPushButton(qsTr("Show All"));
            w.showAllButton.toolTip = qsTr("Bring every profile run back " +
                "into view.");
            w.showAllButton.clicked.connect(function() {
                FeatureTrace.showAllRuns();
            });
            runRow.addWidget(w.showAllButton, 2, 1);
        } catch (eRun) {
            w.problems.push("run selector (" + eRun + ")");
            runRow = null;
        }

        // The bands section: built here because the run controls were
        // built above, added to the panel BELOW the tiles.
        w.bandsSection = CsPanel.section(body, FeatureTrace.SEC_BANDS,
            FeatureTrace.COLLAPSED_SETTING, collapsed);
        if (runRow !== null) {
            w.bandsSection.host.setLayout(runRow);
        }
    } catch (eGroups) {
        w.problems.push("elevation bands (" + eGroups + ")");
    }

    // -- what to draw, which is why the panel is open ----------------
    try {
        w.featureGroup = FeatureTrace.buildGroup(w, body,
            FeatureTrace.SEC_FEATURES, null, collapsed);
        layout.addWidget(w.featureGroup, 0, 0);
    } catch (eFeatures) {
        w.problems.push("feature group (" + eFeatures + ")");
    }

    // -- the shaped lines --------------------------------------------
    //
    // A second group rather than more tiles in the first: they are the
    // same gesture but not the same thing -- these bring ornament, and
    // they ask one more question (which side) after the drag.
    try {
        w.shapedGroup = FeatureTrace.buildShapedGroup(w, body, collapsed);
        layout.addWidget(w.shapedGroup, 0, 0);
    } catch (eShaped) {
        w.problems.push("shaped lines group (" + eShaped + ")");
    }

    // -- which elevation band a stroke belongs to --------------------
    try {
        if (!isNull(w.bandsSection)) {
            layout.addWidget(w.bandsSection.box, 0, 0);
        }
    } catch (eBands) {
        w.problems.push("elevation bands placement (" + eBands + ")");
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

/** The open section bays' rectangles, cached for the same reason and on
 *  the same refresh. The readout has to know them or it reports PLAN
 *  for a cursor sitting inside a bay -- the frame whose tiles the caver
 *  is about to arm. Opening and capturing a bay are both transactions,
 *  so flush() sees every change to this list. */
FeatureTrace.bayRects = [];

/** Debounce for the panel's own rescans. See markDirty. */
FeatureTrace.dirtyTimer = null;

/** How long after the last change the panel repaints itself, in ms.
 *  Long enough to swallow a whole redraw's worth of operations, short
 *  enough that a caver never notices the delay. */
FeatureTrace.DIRTY_MS = 150;

/**
 * Note that the drawing changed, and repaint ONCE after it settles.
 *
 * The listeners used to do the work inline, and that made the panel
 * quadratic in a redraw. Measured on a 278-entity drawing:
 * CsTrace.profileRegion 5.4 ms, CsProfileDraw.runsIn 6.7 ms -- about
 * 17 ms of full-document scanning per notification. Our own redraw
 * applies DOZENS of operations (every CsLayers.withLayerOn toggle is
 * one, and the profile owns 40-odd layers once runs are segregated), and
 * each fired the listener again. Changing one shot's inclination took a
 * very long time, and on a real cave it would be unusable.
 *
 * Restarting the timer on each change is what makes it a debounce rather
 * than a throttle: a burst of eighty operations schedules one repaint,
 * 150 ms after the last of them.
 */
FeatureTrace.markDirty = function() {
    try {
        if (FeatureTrace.dirtyTimer === null) {
            var t = new QTimer();
            try {
                t.setSingleShot(true);
            } catch (eSingle) {
                // property form, or a bridge without it: the flush is
                // idempotent either way
            }
            t.timeout.connect(function() {
                try {
                    FeatureTrace.flush();
                } catch (eFlush) {
                    // a repaint must never throw into the application
                }
            });
            FeatureTrace.dirtyTimer = t;
        }
        FeatureTrace.dirtyTimer.start(FeatureTrace.DIRTY_MS);
    } catch (e) {
        // No timer in this bridge: fall back to repainting inline. Slow,
        // but a stale panel is worse than a slow one.
        FeatureTrace.flush();
    }
};

/** One repaint: the region box, the run list and the row states, each
 *  computed once. */
FeatureTrace.flush = function() {
    var doc = null;
    try {
        doc = EAction.getDocument();
    } catch (eDoc) {
        doc = null;
    }
    try {
        FeatureTrace.regionBox = isNull(doc) ? null :
            CsTrace.profileRegion(doc);
    } catch (eBox) {
        FeatureTrace.regionBox = null;
    }
    try {
        FeatureTrace.bayRects = isNull(doc) ? [] :
            CsTrace.sectionBays(doc);
    } catch (eBays) {
        FeatureTrace.bayRects = [];
    }
    FeatureTrace.refreshRuns(doc);
    FeatureTrace.refresh(doc, FeatureTrace.regionBox);
};

/**
 * Repaints what the panel knows about the drawing.
 *
 * Both of these are otherwise SILENT failures: an off layer refuses adds
 * with no error, so an hour of tracing lands nowhere and nothing says
 * so; and a drawing with no elevation refuses every profile row for a
 * reason no click can explain.
 */
FeatureTrace.refresh = function(docIn, regionIn) {
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
                // A feature now has THREE possible destinations and the
                // stroke chooses between them, so "is the layer hidden"
                // has three answers. The tile reports the worst case:
                // hidden in ANY view is worth saying, because the view
                // it is hidden in is exactly the one the caver may be
                // about to draw in, and the point of the marker is that
                // an off layer swallows a trace in silence.
                var dests = FeatureTrace.destinationsOf(entry.row.layer);
                var hidden = [];
                for (var d = 0; d < dests.length; d++) {
                    if (!isNull(doc) && doc.hasLayer(dests[d])) {
                        // frozen counts as hidden: the trace lands and
                        // is just as invisible either way.
                        if (CsLayers.refusesEdits(
                                doc.queryLayer(dests[d]))) {
                            hidden.push(dests[d]);
                        }
                    }
                }
                var off = hidden.length > 0;
                // Re-wrapped, not re-set: a tile's label is broken over
                // lines by FeatureTrace.wrapLabel, and writing the flat
                // label back here would undo that on the first refresh.
                // "(hidden)" gets a line of its own rather than a budget
                // it would not fit in.
                entry.button.text = FeatureTrace.wrapLabel(
                    entry.row.label, FeatureTrace.CELL_CHARS) +
                    (off ? "\n(hidden)" : "");
                entry.button.toolTip = off ?
                    hidden.join(", ") + " switched OFF -- a trace into " +
                        "that view will land but you will not see it" :
                    dests.join("\n");
            } catch (e) {
                // an unreadable button is still armable; only its label
                // goes stale, and that must never stop a trace
            }
        }
    }

    try {
        if (!isNull(w.featureGroup)) {
            // THE GROUP IS NEVER DISABLED. It used to be: the Profile
            // box greyed out until the drawing had an elevation AND the
            // caver had named a run, because a profile line with no run
            // is one CsProfileBind cannot move with its band. Those same
            // tiles now draw the plan and the sections too, so locking
            // them would lock tracing itself out of a drawing that has
            // no elevation -- and the run question is answered by the
            // stroke's location, then said out loud by
            // FeatureTraceRun.warnUnclaimedProfile when location cannot
            // answer it. Information after the fact beats a locked door
            // in front of work that was never wrong.
            //
            // The region is PASSED IN, computed once per repaint by
            // flush(). Recomputing it here would double the cost of
            // every repaint, and CsTrace.profileRegion walks every
            // entity in the drawing.
            var region = (regionIn === undefined) ?
                FeatureTrace.regionBox : regionIn;
            w.featureGroup.toolTip = isNull(region) ?
                qsTr("This drawing has no elevation yet, so every trace " +
                    "lands in the plan. Generate Profile builds one.") :
                qsTr("The view you drag in decides the layer: the plan, " +
                    "a profile band's box, or an open section bay.");
        }
    } catch (e2) {
        // a stale tooltip is cosmetic; the routing does not read it
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
                FeatureTrace.markDirty();
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
                var over = CsTrace.frameIn(FeatureTrace.regionBox,
                    { x: pos.x, y: pos.y }, FeatureTrace.bayRects);
                // The destination LAYER as well, resolved from the view
                // under the cursor -- the readout's whole job now that
                // no button states which view a trace is bound for.
                // Cheap: no points are passed, so nothing walks the
                // drawing (CsLayers.twinFor is a string operation).
                var doc = null;
                try {
                    doc = docIface.getDocument();
                } catch (eDocOf) {
                    doc = null;
                }
                FeatureTrace.showCursorFrame(over,
                    FeatureTraceRun.targetLayer(doc, over));
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
                FeatureTrace.markDirty();
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
            FeatureTrace.flush();
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
    action.setGroupSortOrder(452);
    // 45 puts this beside Scatter Breakdown (40), the other drawing
    // tool. 75 -- the number first proposed -- is Generate Profile's,
    // and a clash leaves menu order down to load sequence.
    action.setSortOrder(10);
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
