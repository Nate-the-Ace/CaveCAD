// CheckMap.js
//
// QCAD add-on tool: read the finished map back and say what is wrong
// with it, in the words that explain WHY it is wrong.
//
//   Cave Survey > Check Map   (or type "chk")
//
// WHO THIS IS FOR. Someone drawing their first cave map does not know
// what they have left out -- that is the whole difficulty. The suite
// already refuses to let them put a stalactite on the water layer, but
// nothing ever said "your sheet has no scale bar", which is the fault
// that makes a map unusable and the one nobody notices until it is
// printed.
//
// A PANEL, NOT A DIALOG, and that is the point of the tool. A modal
// dialog listing eight faults has to be dismissed before any of them
// can be fixed, so the list is read, half-remembered, and closed. This
// docks beside the drawing: pick a finding, read why it matters, press
// Show Me to be taken to it, fix it, press Check Again. The list is
// meant to be worked down to nothing.
//
// IT FIXES NOTHING, deliberately -- see Core/CsCheck.js's header. Every
// finding might be a decision rather than a mistake, and the tool that
// silently "corrected" a cartographer would be worse than no tool.

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

var csCheckMapDock;

function CheckMap(guiAction) {
    EAction.call(this, guiAction);
}

CheckMap.prototype = new EAction();

/** How far around a finding's point the view is framed, in feet of
 *  cave. Wide enough that the fault is seen IN CONTEXT -- a wall gap
 *  filling the screen tells you nothing about which wall it is. */
CheckMap.SHOW_FEET = 40.0;

CheckMap.buildDock = function(appWin) {
    var dock = new QDockWidget(qsTr("Check Map"), appWin);
    // Without an objectName restoreState() cannot identify the dock and
    // silently forgets where it was.
    dock.objectName = "CaveSurveyCheckMapDock";

    var w = { findings: [] };
    var body = new QWidget(dock);
    var layout = new QVBoxLayout();

    w.summary = new QLabel(qsTr("Press Check Again to read this map."));
    w.summary.wordWrap = true;
    layout.addWidget(w.summary, 0, 0);

    // A ONE-COLUMN TABLE, not a QListWidget. This bridge generates
    // QListWidget (and QTreeWidget) as WRAPPER-ONLY classes: `new
    // QListWidget()` warns "No constructor found" and hands back an
    // object with nothing behind it, whose every method is undefined.
    // Found live rather than in review -- the panel built, and clear()
    // threw the moment it was asked to show a finding. CaveShelf and
    // Sketch Scans reached the same conclusion before this did.
    w.list = new QTableWidget(0, 1);
    try {
        w.list.horizontalHeader().visible = false;
        w.list.verticalHeader().visible = false;
        w.list.horizontalHeader().stretchLastSection = true;
        w.list.selectionBehavior = QAbstractItemView.SelectRows;
        w.list.editTriggers = QAbstractItemView.NoEditTriggers;
        w.list.alternatingRowColors = true;
    } catch (eList) {
        // a bridge without the header accessors gets a table with
        // headers on, which is ugly and still perfectly usable
    }
    try {
        // The LIST gets the panel's height, not the why box. Set live
        // on 2026-09-10: with only a stretch factor the table came out
        // three rows tall under a why box half the panel high, and a
        // findings list you have to scroll three rows at a time is a
        // findings list nobody works down.
        w.list.minimumHeight = 220;
    } catch (eHeight) {
    }
    layout.addWidget(w.list, 1, 0);

    w.why = new QTextBrowser();
    w.why.readOnly = true;
    // WHY IS NOT OPTIONAL FURNITURE. A list of faults teaches nothing;
    // a beginner who is told "no scale bar" learns to add a scale bar,
    // and one who is told what a scale bar is FOR learns to check for
    // it on the next map without being asked.
    try {
        w.why.setMinimumHeight(90);
        w.why.setMaximumHeight(150);
    } catch (eWhyHeight) {
        // a bridge without the setters gets whatever the layout gives
    }
    layout.addWidget(w.why, 0, 0);

    var row = new QHBoxLayout();
    w.showButton = new QPushButton(qsTr("Show Me"));
    w.showButton.toolTip = qsTr("Frame the drawing on this finding. " +
        "Greyed out for a fault that belongs to the whole sheet rather " +
        "than to one place -- a missing scale bar is nowhere in " +
        "particular.");
    w.showButton.enabled = false;
    row.addWidget(w.showButton, 1, 0);
    w.againButton = new QPushButton(qsTr("Check Again"));
    w.againButton.toolTip = qsTr("Read the map again. Fix something, " +
        "press this, watch it leave the list.");
    row.addWidget(w.againButton, 1, 0);
    layout.addLayout(row, 0);

    body.setLayout(layout);
    dock.setWidget(body);
    CheckMap.widgets = w;

    w.list.itemSelectionChanged.connect(function() {
        CheckMap.showSelected();
    });
    w.list.itemDoubleClicked.connect(function() {
        CheckMap.showMe();
    });
    w.showButton.clicked.connect(function() {
        CheckMap.showMe();
    });
    w.againButton.clicked.connect(function() {
        CheckMap.refresh();
    });
    return dock;
};

/** The row one finding gets: how bad, then what is wrong. */
CheckMap.rowText = function(finding) {
    return CsCheck.LABEL[finding.severity] + "  --  " + finding.title;
};

CheckMap.refresh = function() {
    var w = CheckMap.widgets;
    if (isNull(w)) {
        return;
    }
    var doc = null;
    try {
        doc = EAction.getDocument();
    } catch (eDoc) {
        doc = null;
    }
    if (isNull(doc)) {
        w.summary.text = qsTr("No drawing open.");
        w.list.setRowCount(0);
        w.findings = [];
        w.why.plainText = "";
        return;
    }

    var result = CsCheck.run(doc);
    w.findings = result.findings;
    w.list.setRowCount(0);
    w.list.setRowCount(result.findings.length);
    for (var i = 0; i < result.findings.length; i++) {
        w.list.setItem(i, 0,
            new QTableWidgetItem(CheckMap.rowText(result.findings[i])));
    }
    w.summary.text = CsCheck.summary(result);
    w.why.plainText = result.clean ?
        qsTr("Nothing to fix. This map carries a scale bar, a north " +
            "arrow, a filled-in title block, and everything on it is " +
            "on a layer the suite knows.") : "";
    w.showButton.enabled = false;
    EAction.handleUserMessage(CsCheck.summary(result));
};

/** The finding the list has selected, or null. */
CheckMap.selected = function() {
    var w = CheckMap.widgets;
    if (isNull(w) || isNull(w.findings)) {
        return null;
    }
    // currentRow() is a METHOD here, not a property -- reading it as a
    // property hands back a function, and `function >= 0` is false, so
    // the panel would answer "nothing selected" forever.
    var row = w.list.currentRow();
    if (row < 0 || row >= w.findings.length) {
        return null;
    }
    return w.findings[row];
};

CheckMap.showSelected = function() {
    var w = CheckMap.widgets;
    var finding = CheckMap.selected();
    if (finding === null) {
        w.why.plainText = "";
        w.showButton.enabled = false;
        return;
    }
    var text = finding.title + "\n\n" + finding.why;
    if (finding.layer !== "") {
        text += "\n\nLayer: " + finding.layer;
    }
    w.why.plainText = text;
    w.showButton.enabled = !isNull(finding.at);
};

/** Frame the drawing on the selected finding. */
CheckMap.showMe = function() {
    var finding = CheckMap.selected();
    if (finding === null || isNull(finding.at)) {
        return;
    }
    var di = null;
    try {
        di = EAction.getDocumentInterface();
    } catch (eDi) {
        di = null;
    }
    if (isNull(di)) {
        return;
    }
    try {
        // In DRAWING units, not feet: a metric cave's 40 is 40 metres
        // and framing it in feet would put the fault off screen.
        var reach = CheckMap.SHOW_FEET;
        try {
            reach = CheckMap.SHOW_FEET *
                CsShapeLine.perFoot(EAction.getDocument());
        } catch (eUnit) {
            reach = CheckMap.SHOW_FEET;
        }
        di.zoomTo(new RBox(
            new RVector(finding.at.x - reach, finding.at.y - reach),
            new RVector(finding.at.x + reach, finding.at.y + reach)));
    } catch (e) {
        EAction.handleUserMessage("Check Map: could not frame that " +
            "finding (" + e + ").");
    }
};

CheckMap.ensureDock = function() {
    if (csCheckMapDock !== undefined && csCheckMapDock !== null) {
        return csCheckMapDock;
    }
    var appWin = RMainWindowQt.getMainWindow();
    csCheckMapDock = CheckMap.buildDock(appWin);
    appWin.addDockWidget(Qt.RightDockWidgetArea, csCheckMapDock);
    return csCheckMapDock;
};

CheckMap.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);

    try {
        var dock = CheckMap.ensureDock();
        // Unlike the drawing panels, this one always OPENS and always
        // re-reads: it is a verb, not a palette. Toggling it shut on a
        // second press would make "check my map again" a two-click
        // gesture whose first click hides the answer.
        dock.visible = true;
        CheckMap.refresh();
    } catch (e) {
        csCheckMapDock = undefined;
        warning("Check Map: this CaveCAD build refused the docked " +
            "panel (" + e + ") -- please report this.");
    }

    this.terminate();
};

CheckMap.init = function(basePath) {
    CheckMap.basePath = basePath;

    var action = new RGuiAction(qsTr("Check Map"),
        RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/CheckMap.js");
    action.setIcon(basePath + "/CheckMap.svg");
    action.setStatusTip(qsTr("Read the map back and say what is missing " +
        "or wrong, and why it matters"));
    action.setDefaultCommands(["checkmap", "chk"]);
    // FIRST in stage 6: check, then repair, then share. A caver who
    // packages before checking has shared the faults.
    action.setGroupSortOrder(455);
    action.setSortOrder(5);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);

    // Built during init like the other docks: the main window's
    // restoreState() runs after this and can only place a dock that
    // already exists. Hidden until the menu entry shows it.
    try {
        var dock = CheckMap.ensureDock();
        dock.visible = false;
    } catch (eInit) {
        csCheckMapDock = undefined;
        warning("Check Map: could not build the panel at startup (" +
            eInit + "); the menu entry will try again.");
    }
};
