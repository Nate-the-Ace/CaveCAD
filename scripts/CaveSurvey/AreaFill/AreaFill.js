// AreaFill.js -- Area Fill: the menu entry and the docked panel that
// arms which cave-floor pattern the next stroke encloses.
//
// The stroke itself (press, drag, release -> a boundary and its fill,
// one transaction) lives in AreaFillRun.js beside this file; the
// listener that keeps a fill in step with its boundary lives in
// AreaFillListener.js. QCAD cannot find either on its own -- init()
// below registers both, the same shape SymbolPalette.js registers
// SymbolPaletteRun.js and SymbolPaletteEdit.js.
//
// Panel shape follows SymbolPalette's own dock, including the two
// details that are load-bearing rather than stylistic: this file
// supplies a BODY ONLY, into the Draw panel's third section -- never a
// dock of its own -- and every widget construction and connect is
// wrapped so a bridge refusal costs one control, never the section.
// `widgets` is module-level for the same reason SymbolPalette's is: a
// second copy of this body would leave one of the two wired to
// nothing, a panel that looks right and does nothing when clicked.
//
// WHAT THE PANEL IS FOR. CsArea.CATALOG has known the suite's thirteen
// area patterns since Task 2 -- Blocks, Sump, Flowstone and the rest --
// and CsArea.build/CsArea.regenerate (Tasks 5 and 7) have known how to
// draw and rebuild every one of them. Nothing before this task could
// ARM one: AreaFillRun.armed is read at every stroke's release and had
// no writer. This is the front door -- one tile per pattern, a picture
// of what it actually draws, one click to arm and a press-drag-release
// to enclose.

// AreaFillListener.js is NOT included here: CaveSurvey.js already
// includes it and calls AreaFillListener.install() directly (Task 7),
// independently of whether this panel ever builds -- an area's fill
// must keep following its boundary even with the Areas panel closed
// or this tool file missing entirely. See that file's own header.
include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");
include(includeBasePath + "/AreaFillRun.js");

function AreaFill(guiAction) {
    EAction.call(this, guiAction);
}

AreaFill.prototype = new EAction();

/** The dock lives in DrawPanel; this is only the widgets THIS body
 *  owns. Module-level because there is one panel per application
 *  window -- see the file header. */
AreaFill.widgets = undefined;

/** The catalog's keys, in the order a caver should see them.
 *
 * NOT a `for (var key in CsArea.CATALOG)` walk. Every real engine this
 * suite has run on (including QtScript) enumerates a plain object's
 * string keys in insertion order, but that is a fact about engines and
 * not a promise of the language this file is written in -- and the
 * grouping SymbolPalette relies on ("the catalogue's order IS the
 * panel's order") is worth spelling out once here rather than betting
 * the tile order on an enumeration guarantee ES5 does not make. Kept in
 * the same order CsArea.CATALOG itself is written in.
 */
AreaFill.ORDER = ["BLOCKS", "DEBRIS", "PEBBLES", "SAND", "CLAY", "BEDROCK",
    "WATER", "SUMP", "FLOWSTONE", "MOONMILK", "GUANO", "ICE", "BONES"];

/** Tile icon size and cell size, in pixels. Sized like SymbolPalette's
 *  own tiles -- these sit two rows below Symbols in the same dock, and
 *  a caver's eye should not have to recalibrate between them. */
AreaFill.ICON = 30;
AreaFill.CELL_W = 84;
AreaFill.CELL_H = 76;
AreaFill.CELL_CHARS = 11;

/**
 * TILE COLUMNS. The approved mockup (Nathan, 2026-09-11, see
 * DrawPanel.js's header) puts two sections per row and lets a lone
 * section on the last row span the full width -- which is Areas'
 * normal position as the third section, but NOT its only possible one:
 * a caver can drag it into row 0 beside Trace or Symbols
 * (CsPanel.stackAdd's Move Up), landing it in a HALF-width cell instead.
 *
 * This bridge has no resizeEvent hook proven safe on a plain QWidget --
 * CsScanView.prototype.resizeEvent only works because that class
 * subclasses RGraphicsViewQt through QCAD's generated shell-class
 * dispatch (see that file's own header); nothing here establishes the
 * same dispatch exists for QWidget. What IS proven elsewhere in this
 * suite (CaveShelf.js, SketchScans.js) is a QTimer.singleShot(0, ...)
 * deferring a check to the next turn of the event loop, so
 * scheduleColumnCheck below uses that to read the tile host's actual
 * width shortly after this body is built and laid into its section --
 * a best-effort read, not a live resize handler: a caver who reorders
 * sections AFTER the checks below stop retrying sees no reflow.
 * Defaults to the full-width count, since a freshly built panel puts
 * Areas alone on row two.
 *
 * RETRIES rather than a single shot: a width of 0 (or anything under
 * COLUMN_CHECK_MIN_WIDTH) means layout has not run yet at that tick,
 * not that the section is somehow zero pixels wide, and giving up on
 * that reading permanently would leave a caver who moved Areas into a
 * half-width cell stuck with four columns crammed into half a dock for
 * the rest of the session. So an inconclusive read reschedules itself,
 * up to COLUMN_CHECK_MAX_TRIES times, before the full-width default is
 * accepted as final.
 *
 * TASK 13 MUST CHECK LIVE: build the panel, confirm the default
 * (full-width, four columns) tiles correctly, then use the section's
 * own right-click Move Up to put Areas beside Trace or Symbols in row
 * zero, reload the panel (close and reopen Draw, or restart CaveCAD)
 * and confirm the retried check catches the half-width case too. If it
 * does not -- if every one of COLUMN_CHECK_MAX_TRIES reads still comes
 * back under COLUMN_CHECK_MIN_WIDTH, or wrong once layout has clearly
 * finished -- the fallback is the full-width count, and this comment's
 * claim about "a best-effort read" is wrong until fixed.
 */
AreaFill.COLUMNS_HALF = 2;
AreaFill.COLUMNS_FULL = 4;
AreaFill.gridColumns = AreaFill.COLUMNS_FULL;

/** Below this pixel width, the tile host is judged to be in a
 *  half-width cell rather than spanning the full dock. Halfway between
 *  what two full CELL_W-wide tiles need and what four do -- there is no
 *  authoritative threshold to read off the bridge, so this is a guess,
 *  named so Task 13 knows exactly what to re-check if it guesses
 *  wrong. */
AreaFill.HALF_WIDTH_THRESHOLD = AreaFill.CELL_W * 3;

/** Below this pixel width, a read is not a real layout -- "absurdly
 *  small" in numbers: 20px is under a quarter of one tile's own
 *  CELL_W (84), and no cell this panel ever occupies is honestly that
 *  narrow. A read this low means the event loop has not laid the dock
 *  out yet, not that the section truly is 20px wide, so it is treated
 *  as inconclusive and retried rather than accepted. */
AreaFill.COLUMN_CHECK_MIN_WIDTH = 20;

/** How many times an inconclusive width read reschedules itself before
 *  the full-width default is accepted as final. 20 tries at the
 *  interval below is two seconds of retrying -- generous next to any
 *  layout pass this bridge has been measured taking, and cheap: each
 *  retry that finds nothing conclusive does exactly one property read
 *  and one comparison. */
AreaFill.COLUMN_CHECK_MAX_TRIES = 20;

/** Delay between retries, in milliseconds, after the first (which
 *  fires at 0 -- the next turn of the event loop, same as before this
 *  retry existed). Short enough that twenty of them do not make a
 *  caver wait to see the right column count, long enough not to spin
 *  the event loop pointlessly against a dock that plainly is not laid
 *  out yet. */
AreaFill.COLUMN_CHECK_RETRY_MS = 100;

/**
 * A label broken over lines, greedily, on spaces -- SymbolPalette's own
 * wrapLabel, copied rather than shared: both panels keep their small
 * pure helpers to themselves, the same way FeatureTrace and
 * SymbolPalette already do not share this one either.
 */
AreaFill.wrapLabel = function(text, budget) {
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

/** True when a catalog entry matches the panel's search text -- name or
 *  key, case-insensitively. Pure. */
AreaFill.matches = function(key, entry, needle) {
    if (isNull(needle) || String(needle).length === 0) {
        return true;
    }
    var n = String(needle).toLowerCase();
    if (String(entry.name).toLowerCase().indexOf(n) !== -1) {
        return true;
    }
    return String(key).toLowerCase().indexOf(n) !== -1;
};

/** The scale a stroke commits with -- the panel's spin box, or 1.0
 *  without a panel (AreaFillRun.scale's own fallback). */
AreaFill.scale = function() {
    var w = AreaFill.widgets;
    if (isNull(w) || isNull(w.scaleBox)) {
        return 1.0;
    }
    try {
        var v = w.scaleBox.value;
        return (isNaN(v) || v <= 0) ? 1.0 : v;
    } catch (e) {
        return 1.0;
    }
};

/** The density a scatter stroke commits with. Meaningless for a filled
 *  pattern -- CsArea.buildHatch never reads opts.density -- so this is
 *  never disarmed to 1.0 for that case; the DISABLED spin box already
 *  says "this control does nothing right now" without this function
 *  having to lie about what is in it. */
AreaFill.density = function() {
    var w = AreaFill.widgets;
    if (isNull(w) || isNull(w.densityBox)) {
        return 1.0;
    }
    try {
        var v = w.densityBox.value;
        return (isNaN(v) || v <= 0) ? 1.0 : v;
    } catch (e) {
        return 1.0;
    }
};

/** Density has nothing to thin out on a hatch -- disabled, not hidden,
 *  so its own tooltip can say why rather than the control simply not
 *  being there. */
AreaFill.refreshDensityEnabled = function() {
    var w = AreaFill.widgets;
    if (isNull(w) || isNull(w.densityBox)) {
        return;
    }
    var entry = isNull(AreaFillRun.armed) ? null :
        CsArea.entryFor(AreaFillRun.armed);
    var filled = !isNull(entry) && entry.engine === "filled";
    try {
        w.densityBox.enabled = !filled;
    } catch (e) {
    }
};

/**
 * Arms a pattern and makes the panel show which tile is armed.
 *
 * Mirrors SymbolPalette.arm: the checked tile IS the indicator, because
 * AreaFillRun.armed is module state with no other window onto it.
 */
AreaFill.arm = function(key) {
    AreaFillRun.armed = key;
    var w = AreaFill.widgets;
    if (!isNull(w) && !isNull(w.buttons)) {
        for (var i = 0; i < w.buttons.length; i++) {
            try {
                w.buttons[i].button.checked = (w.buttons[i].key === key);
            } catch (e) {
                // a button the bridge refuses to write back is still
                // armed correctly; only its appearance is wrong
            }
        }
    }
    AreaFill.refreshDensityEnabled();
};

/** Clears the armed pattern and every checked tile. */
AreaFill.disarm = function() {
    AreaFillRun.armed = undefined;
    var w = AreaFill.widgets;
    if (!isNull(w) && !isNull(w.buttons)) {
        for (var i = 0; i < w.buttons.length; i++) {
            try {
                w.buttons[i].button.checked = false;
            } catch (e) {
            }
        }
    }
    AreaFill.refreshDensityEnabled();
};

/**
 * Hands control to the placement action.
 *
 * BY SCRIPT FILE, not instanceof -- SymbolPalette.startRun's own header
 * has the measured reason (QCAD builds every action in its OWN script
 * context, so `instanceof` here is always false): if a fill stroke is
 * already the current action, arm() has changed the pattern and the
 * next stroke picks it up; calling setCurrentAction again would tear
 * down the action running THIS click.
 */
AreaFill.startRun = function() {
    var di = EAction.getDocumentInterface();
    if (isNull(di)) {
        return;
    }
    var runPath = AreaFill.basePath + "/AreaFillRun.js";
    try {
        var current = di.getCurrentAction();
        if (!isNull(current)) {
            var file = String(current.getGuiAction().getScriptFile());
            if (file.length > 0 && file.indexOf("AreaFillRun.js") !== -1) {
                return;
            }
        }
    } catch (e) {
        // no readable current action; starting one is the safe answer
    }
    var runAction = RGuiAction.getByScriptFile(runPath);
    di.setCurrentAction(new AreaFillRun(runAction));
};

/** Arms an entry and starts the placement action. Its own function so
 *  the closure captures ONE key, not the loop variable. */
AreaFill.connectTile = function(button, key) {
    button.clicked.connect(function() {
        AreaFill.arm(key);
        AreaFill.startRun();
    });
};

/**
 * One tile: a picture of the pattern from CsTileArt.iconOfFill, or --
 * when the bridge's painter refuses, or the pattern's own blocks are
 * not in this drawing's template -- a NAMED placeholder: the button
 * still exists, still arms the pattern, still says what it is. Only
 * the picture is missing.
 */
AreaFill.tileFor = function(key, entry) {
    var button = new QToolButton();
    button.text = AreaFill.wrapLabel(entry.name, AreaFill.CELL_CHARS);
    try {
        button.toolButtonStyle = Qt.ToolButtonTextUnderIcon;
    } catch (eStyle) {
    }
    button.checkable = true;

    var detail = [];
    detail.push(entry.engine === "scatter" ?
        qsTr("Scatters picture elements across the boundary.") :
        qsTr("Fills the boundary as one region."));
    detail.push(entry.layer);
    // No CsHelp entry for area patterns yet -- CsHelp.SYMBOL/FEATURE
    // both predate this tool -- so this passes null for `help` exactly
    // as SymbolPalette does for a custom symbol with no catalog prose.
    button.toolTip = CsPanel.tipHtml(entry.name, null, detail);

    var icon = null;
    try {
        icon = CsTileArt.iconOfFill(entry, AreaFill.ICON,
            CsTileArt.penForLayer(entry.layer));
    } catch (eIcon) {
        icon = null;
    }
    if (icon !== null) {
        try {
            button.icon = icon;
            button.iconSize = new QSize(AreaFill.ICON, AreaFill.ICON);
        } catch (eSet) {
            // a tile with no picture still says its name
        }
    }
    try {
        button.setFixedSize(AreaFill.CELL_W, AreaFill.CELL_H);
    } catch (eSize) {
    }
    AreaFill.connectTile(button, key);
    return button;
};

/**
 * Rebuilds the tile grid from the current search text.
 *
 * Tears the tile area down and builds it again, same reasoning as
 * SymbolPalette.rebuildTiles: nothing here can gain or lose a catalog
 * entry mid-session (CsArea.CATALOG is code, not a file a caver edits),
 * but the SEARCH can, and a hide-only filter would leave the same
 * number of live-but-invisible buttons behind on every keystroke.
 */
AreaFill.rebuildTiles = function() {
    var w = AreaFill.widgets;
    if (isNull(w) || isNull(w.tileGrid)) {
        return;
    }
    var armedKey = AreaFillRun.armed;

    try {
        for (var i = 0; i < w.tileWidgets.length; i++) {
            try {
                w.tileWidgets[i].setParent(null);
                w.tileWidgets[i].deleteLater();
            } catch (eDel) {
            }
        }
    } catch (eClear) {
    }
    w.tileWidgets = [];
    w.buttons = [];

    var needle = "";
    try {
        needle = isNull(w.searchEdit) ? "" : String(w.searchEdit.text);
    } catch (eSearch) {
    }

    var cell = 0;
    for (var k = 0; k < AreaFill.ORDER.length; k++) {
        var key = AreaFill.ORDER[k];
        var entry = CsArea.entryFor(key);
        if (isNull(entry) || !AreaFill.matches(key, entry, needle)) {
            continue;
        }
        try {
            var button = AreaFill.tileFor(key, entry);
            w.tileGrid.addWidget(button,
                Math.floor(cell / AreaFill.gridColumns),
                cell % AreaFill.gridColumns);
            cell++;
            w.tileWidgets.push(button);
            w.buttons.push({ button: button, key: key });
            if (key === armedKey) {
                try {
                    button.checked = true;
                } catch (eRe) {
                }
            }
        } catch (eTile) {
            w.problems.push(key + " (" + eTile + ")");
        }
    }
    try {
        w.tileGrid.setColumnStretch(AreaFill.gridColumns, 1);
    } catch (eStretch) {
    }
    AreaFill.refreshDensityEnabled();
};

/** See AreaFill.COLUMNS_HALF's own header: a RETRIED deferred read of
 *  the tile host's width, the closest thing to a resize hook this
 *  panel has proof this bridge supports. Rebuilds the grid only if the
 *  measured width actually changes the column count from the default.
 *
 *  `tries` counts attempts ALREADY MADE, including this one -- so a
 *  fresh call (from buildBody) passes nothing, and a rescheduled retry
 *  passes tries + 1. Read that way rather than a countdown so the
 *  "give up" comparison (tries >= MAX_TRIES) reads as what it is: this
 *  was the last one. */
AreaFill.scheduleColumnCheck = function(tries) {
    if (typeof QTimer === "undefined") {
        return;
    }
    var attempt = isNull(tries) ? 1 : tries;
    try {
        var w = AreaFill.widgets;
        var timer = new QTimer(RMainWindowQt.getMainWindow());
        timer.singleShot = true;
        timer.timeout.connect(function() {
            try {
                if (isNull(w) || isNull(w.tileHost)) {
                    return;
                }
                var width = w.tileHost.width;
                var conclusive = !isNaN(width) &&
                    width >= AreaFill.COLUMN_CHECK_MIN_WIDTH;
                if (!conclusive) {
                    // Not laid out yet at this tick -- NOT "genuinely
                    // narrow": see COLUMN_CHECK_MIN_WIDTH's own header.
                    // Retry rather than accept this reading as final,
                    // up to the try limit; a caver who reordered Areas
                    // into a half-width cell must not be stuck at four
                    // columns for the rest of the session because one
                    // early tick read back 0.
                    if (attempt < AreaFill.COLUMN_CHECK_MAX_TRIES) {
                        AreaFill.scheduleColumnCheck(attempt + 1);
                    }
                    return;
                }
                var wide = width >= AreaFill.HALF_WIDTH_THRESHOLD;
                var columns = wide ? AreaFill.COLUMNS_FULL :
                    AreaFill.COLUMNS_HALF;
                if (columns !== AreaFill.gridColumns) {
                    AreaFill.gridColumns = columns;
                    AreaFill.rebuildTiles();
                }
            } catch (eCheck) {
            }
        });
        // The FIRST attempt fires at 0 (the next turn of the event
        // loop, unchanged from before this retry existed); every retry
        // after it waits COLUMN_CHECK_RETRY_MS, so twenty retries do
        // not mean twenty back-to-back ticks fighting the layout pass
        // that has not finished yet.
        timer.start(attempt <= 1 ? 0 : AreaFill.COLUMN_CHECK_RETRY_MS);
    } catch (eTimer) {
        // no timer -- the default column count stands for the session
    }
};

/** THE PANEL'S BODY, separated from its dock -- see SymbolPalette's own
 *  buildBody for why. */
AreaFill.buildBody = function(parent) {
    var w = { problems: [], buttons: [], tileWidgets: [] };
    var body = new QWidget(parent);
    var layout = new QVBoxLayout();

    // -- search --------------------------------------------------------
    try {
        w.searchEdit = new QLineEdit("");
        w.searchEdit.toolTip = qsTr("Filter the patterns by name.");
        try {
            w.searchEdit.placeholderText = qsTr("Search patterns");
        } catch (ePlace) {
        }
        w.searchEdit.textChanged.connect(function(text) {
            try {
                AreaFill.rebuildTiles();
            } catch (eFilter) {
            }
        });
        layout.addWidget(w.searchEdit, 0, 0);
    } catch (eSearchBox) {
        w.problems.push("search box (" + eSearchBox + ")");
    }

    // -- scale and density ----------------------------------------------
    //
    // FEET-LIKE, NOT A RAW OP: both are multipliers CsArea.placements
    // applies to its own scaleMin/scaleMax and density numbers, so 1.0
    // always means "the catalog's own look" whichever pattern is armed
    // -- the same reason SymbolPalette.sizeValue works in feet rather
    // than a per-symbol multiplier.
    try {
        var controls = new QHBoxLayout();
        try {
            var scaleLabel = new QLabel(qsTr("Scale"));
            controls.addWidget(scaleLabel, 0, 0);
        } catch (eScaleLabel) {
        }
        w.scaleBox = new QDoubleSpinBox();
        w.scaleBox.toolTip = qsTr("How large each placed element is, " +
            "relative to the pattern's own size. 1.0 is the catalog's " +
            "own look.");
        try {
            w.scaleBox.setRange(0.25, 4.0);
            w.scaleBox.setSingleStep(0.25);
            w.scaleBox.setDecimals(2);
            w.scaleBox.setValue(1.0);
        } catch (eScaleSetup) {
        }
        controls.addWidget(w.scaleBox, 0, 0);

        try {
            var densityLabel = new QLabel(qsTr("Density"));
            controls.addWidget(densityLabel, 0, 0);
        } catch (eDensityLabel) {
        }
        w.densityBox = new QDoubleSpinBox();
        w.densityBox.toolTip = qsTr("How many elements a scatter places, " +
            "relative to the catalog's own density. Disabled for a " +
            "filled pattern -- a hatch has no scattered elements to " +
            "thin out.");
        try {
            w.densityBox.setRange(0.1, 5.0);
            w.densityBox.setSingleStep(0.1);
            w.densityBox.setDecimals(2);
            w.densityBox.setValue(1.0);
        } catch (eDensitySetup) {
        }
        controls.addWidget(w.densityBox, 0, 0);
        controls.addStretch(1);
        layout.addLayout(controls, 0);
    } catch (eControls) {
        w.problems.push("scale/density controls (" + eControls + ")");
    }

    // -- the tiles, in a scroll area -------------------------------------
    try {
        w.tileHost = new QWidget();
        w.tileGrid = new QGridLayout();
        w.tileHost.setLayout(w.tileGrid);
        try {
            w.tileGrid.setContentsMargins(2, 2, 2, 2);
        } catch (eMargins) {
        }
        var scroll = new QScrollArea();
        scroll.setWidget(w.tileHost);
        scroll.setWidgetResizable(true);
        layout.addWidget(scroll, 1, 0);
    } catch (eScroll) {
        w.problems.push("pattern area (" + eScroll + ")");
    }

    body.setLayout(layout);
    AreaFill.widgets = w;

    try {
        AreaFill.rebuildTiles();
    } catch (eBuild) {
        w.problems.push("pattern tiles (" + eBuild + ")");
    }

    try {
        AreaFill.scheduleColumnCheck();
    } catch (eColumns) {
        // the default column count stands for the session
    }

    if (w.problems.length > 0) {
        EAction.handleUserWarning("Area Fill: this CaveCAD build refused " +
            "part of the panel -- " + w.problems.join("; ") +
            ". Please report this.");
    }
    return body;
};

// NO DOCK OF ITS OWN. The body goes into the Draw panel's "Areas"
// section and nowhere else -- see the file header.

AreaFill.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);

    // A SHEET IS NOT A DRAWING TO WORK IN -- see CsSheetFile's own
    // header; a sheet is rebuilt from the cave's record on every Build
    // Sheet, and a fill drawn on one would go with it, silently, weeks
    // later.
    if (CsSheetFile.blocks(this.getDocument(), "Area Fill")) {
        this.terminate();
        return;
    }

    try {
        DrawPanel.reveal(DrawPanel.SEC_AREAS);
    } catch (e) {
        EAction.handleUserWarning("Area Fill: this CaveCAD build refused " +
            "the Draw panel (" + e + ") -- please report this.");
    }

    this.terminate();
};

AreaFill.init = function(basePath) {
    AreaFill.basePath = basePath;

    var action = new RGuiAction(qsTr("Area Fill"),
        RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/AreaFill.js");
    action.setIcon(basePath + "/AreaFill.svg");
    action.setStatusTip(qsTr("Fill a cave-floor pattern: pick one, then " +
        "press and drag to enclose the area"));
    // "area" belongs to the Draw panel now, the same door "ft" and
    // "sym" already open for FeatureTrace and SymbolPalette.
    action.setDefaultCommands(["area"]);
    // 452 is "draw the map"; 60 puts it after Symbol Palette (50).
    action.setGroupSortOrder(452);
    action.setSortOrder(60);
    // NOT ON THE MENU -- Draw is the one door, same as FeatureTrace and
    // SymbolPalette.
    action.setWidgetNames([]);

    AreaFillRun.init(basePath);

    // The DOCK is Draw's to build, during add-on init, so that
    // restoreState() can place it. Nothing to do here.
};
