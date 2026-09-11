// DrawPanel.js
//
// QCAD add-on tool: ONE panel for putting marks on the map.
//
//   Cave Survey > Draw   (or type "draw", "ft", "sym")
//
// WHY "DrawPanel" AND NOT "Draw". QCAD's include() dedupes by
// BASENAME, and QCAD ships scripts/Draw/Draw.js -- so a tool file
// called Draw.js is silently skipped, `Draw` resolves to QCAD's own
// class, and the panel simply never exists. Found the hard way: the
// first build of this tool published cleanly, passed every test, and
// `typeof Draw.reveal` in the live engine came back "undefined".
// The MENU still says Draw; only the file and class are renamed.
//
// WHY. Drawing a cave is one job done with one hand -- a wall, then the
// ledge below it, then the stalactite beside that -- and it lived in
// two docks. A caver tracing a passage was choosing which PANEL to look
// at before choosing what to draw, and on a laptop only one of them
// fitted beside the drawing (Nathan, 2026-09-11).
//
// So Feature Trace and the Symbol Palette are two foldable sections of
// one panel now. Both already knew how to fold, remember what a caver
// left shut, and reorder from their own right-click menus -- this is
// CsPanel's stack doing what it was written for, one level up.
//
// SECTIONS AND NOT TABS, deliberately. Tabs would put a wall and a
// symbol on opposite sides of a click, and tracing a passage means
// reaching for both in the same breath; they would also throw away the
// folding both panels already have. A section you never use folds to
// one line and stays there.
//
// ONE BODY, ONE OWNER. Neither panel builds a dock of its own any
// more, and that is not tidiness: each of them keeps its widgets in a
// single module-level `widgets`, so a second copy of the body would
// leave one of the two copies wired to nothing -- a panel that looks
// right and does nothing when clicked. `featuretrace` and
// `symbolpalette` still type; they open THIS dock with that section
// unfolded.

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");
include(includeBasePath + "/../FeatureTrace/FeatureTrace.js");
include(includeBasePath + "/../SymbolPalette/SymbolPalette.js");

var csDrawPanelDock;

function DrawPanel(guiAction) {
    EAction.call(this, guiAction);
}

DrawPanel.prototype = new EAction();

/** Where the fold state of THIS panel's two sections is remembered.
 *  Its own key: folding "Symbols" here is not the same act as folding
 *  a symbol CATEGORY inside it, which the palette remembers itself. */
DrawPanel.COLLAPSED_SETTING = "CaveSurvey/DrawCollapsed";

DrawPanel.SEC_TRACE = "Trace";
DrawPanel.SEC_SYMBOLS = "Symbols";

/** The built sections by title, so `featuretrace` and `symbolpalette`
 *  can unfold the half they name. */
DrawPanel.sections = {};

DrawPanel.buildDock = function(appWin) {
    var dock = new QDockWidget(qsTr("Draw"), appWin);
    // Without an objectName restoreState() cannot identify the dock and
    // silently forgets where it was.
    dock.objectName = "CaveSurveyDrawDock";

    var body = new QWidget(dock);
    var layout = new QVBoxLayout();
    var collapsed = CsPanel.loadCollapsed(DrawPanel.COLLAPSED_SETTING);
    var stack = CsPanel.stack(layout, DrawPanel.COLLAPSED_SETTING, 0,
        function() {
            EAction.handleUserMessage(qsTr("Section order reset -- " +
                "reopen the panel to see it."));
        });

    // EACH PANEL BUILDS ITS OWN BODY, into this one's section. Nothing
    // is reimplemented here: the tiles, the search, the recent strip,
    // the undo row and every trap they cost are the ones those two
    // files already carry.
    var sections = [
        { title: DrawPanel.SEC_TRACE,
          build: function(parent) { return FeatureTrace.buildBody(parent); } },
        { title: DrawPanel.SEC_SYMBOLS,
          build: function(parent) { return SymbolPalette.buildBody(parent); } }
    ];
    var problems = [];
    for (var i = 0; i < sections.length; i++) {
        try {
            var section = CsPanel.section(body, sections[i].title,
                DrawPanel.COLLAPSED_SETTING, collapsed);
            var inner = new QVBoxLayout();
            try {
                inner.setContentsMargins(0, 0, 0, 0);
            } catch (eMargins) {
            }
            inner.addWidget(sections[i].build(section.host), 1, 0);
            section.host.setLayout(inner);
            // THE CALLER ADDS THE BOX. CsPanel.stackAdd only registers
            // the section for the reorder menu -- leaving this out
            // builds every widget correctly, parents them to the body,
            // and shows a 46-pixel-tall empty panel.
            layout.addWidget(section.box, 1, 0);
            CsPanel.stackAdd(stack, section, sections[i].title);
            DrawPanel.sections[sections[i].title] = section;
        } catch (eSection) {
            // ONE SECTION REFUSED IS NOT A PANEL REFUSED. A caver whose
            // symbol palette will not build still needs to trace.
            problems.push(sections[i].title + " (" + eSection + ")");
        }
    }

    // The caver's saved section order, applied once everything is in.
    try {
        CsPanel.applyOrder(stack);
    } catch (eOrder) {
    }

    body.setLayout(layout);
    dock.setWidget(body);

    if (problems.length > 0) {
        warning("Draw: this CaveCAD build refused " +
            problems.join("; ") + " -- the rest of the panel works.");
    }
    return dock;
};

DrawPanel.ensureDock = function() {
    if (csDrawPanelDock !== undefined && csDrawPanelDock !== null) {
        return csDrawPanelDock;
    }
    var appWin = RMainWindowQt.getMainWindow();
    csDrawPanelDock = DrawPanel.buildDock(appWin);
    appWin.addDockWidget(Qt.RightDockWidgetArea, csDrawPanelDock);
    return csDrawPanelDock;
};

/** Is the panel on screen? The two halves' listeners ask, because
 *  every one of them walks the drawing: a folded-away panel must not
 *  make every transaction in the application pay for a scan nobody
 *  will look at. */
DrawPanel.showing = function() {
    try {
        return (csDrawPanelDock !== undefined && csDrawPanelDock !== null &&
            csDrawPanelDock.visible === true);
    } catch (e) {
        return false;
    }
};

/** Opens the panel with ONE section unfolded -- the door `featuretrace`
 *  and `symbolpalette` come through.
 *
 *  Unfolds WITHOUT remembering (CsPanel.setOpen): a caver who keeps
 *  Symbols folded and types "ft" once has not changed their mind about
 *  Symbols. */
DrawPanel.reveal = function(title) {
    var dock = DrawPanel.ensureDock();
    dock.visible = true;
    try {
        dock.raise();
    } catch (eRaise) {
    }
    try {
        var section = DrawPanel.sections[title];
        if (!isNull(section)) {
            CsPanel.setOpen(section, title, true);
        }
    } catch (eOpen) {
    }
    return dock;
};

DrawPanel.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);

    // A SHEET IS NOT A DRAWING TO WORK IN. It is rebuilt from the
    // cave's record every time Build Sheet is pressed, so anything
    // drawn here goes with it -- silently, weeks later. See
    // Core/CsSheetFile.js.
    if (CsSheetFile.blocks(this.getDocument(), "Draw")) {
        this.terminate();
        return;
    }

    try {
        var existed = (csDrawPanelDock !== undefined && csDrawPanelDock !== null);
        var dock = DrawPanel.ensureDock();
        dock.visible = existed ? !dock.visible : true;
        try {
            FeatureTrace.flush();
        } catch (eFlush) {
            // a stale panel must never stop the tool opening
        }
    } catch (e) {
        csDrawPanelDock = undefined;
        warning("Draw: this CaveCAD build refused the docked panel (" +
            e + ") -- please report this.");
    }

    this.terminate();
};

DrawPanel.init = function(basePath) {
    DrawPanel.basePath = basePath;

    var action = new RGuiAction(qsTr("Draw"),
        RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/DrawPanel.js");
    action.setIcon(basePath + "/DrawPanel.svg");
    action.setStatusTip(qsTr("One panel for putting marks on the map: " +
        "trace features and shaped lines, place symbols"));
    // "ft" and "sym" still work, because a caver who has typed them for
    // a year should not have to learn that they now mean the same door.
    action.setDefaultCommands(["draw", "ft", "sym"]);
    action.setGroupSortOrder(452);
    action.setSortOrder(10);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);

    // Built during init like the suite's other docks: the main window's
    // restoreState() runs after this and can only place a dock that
    // already exists. Hidden until the menu entry shows it.
    try {
        var dock = DrawPanel.ensureDock();
        dock.visible = false;
    } catch (eInit) {
        csDrawPanelDock = undefined;
        warning("Draw: could not build the panel at startup (" + eInit +
            "); the menu entry will try again.");
    }
};
