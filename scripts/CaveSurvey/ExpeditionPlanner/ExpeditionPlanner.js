// ExpeditionPlanner.js
//
// QCAD add-on tool: plan a trip into the cave and build its callout card.
//
//   Cave Survey > Expedition Planner   (or type "epl")
//
// WHAT IT IS. A docked panel, ONE page with no tabs, laid out top to
// bottom in the order of the printed callout card: Trip, Roster,
// Schedule, Escalation, Route, Card. Route plans a trip from the
// survey's first station to the stops picked from a dropdown of the
// map's stations and back (Core/CsTripPlan.js), and writes the packet,
// trip-plan.html, beside the drawing. Build card writes
// callout-card.html, the sheet a topside contact keeps
// (Core/CsCalloutCard.js), and refuses until every required field is
// filled in, naming all the gaps at once. This is the home for the
// later expedition tools too.
//
// THE SIDECAR IS SHARED, SO A WRITE RE-READS IT FIRST. Pace, the team's
// packing list and the trip's days are stations.json `settings`, the
// same file Station Table keeps its marks in (Core/CsStationSidecar.js).
// Every write reads the file again and changes only its own settings,
// so a teammate's marks that arrived through Drive are never thrown
// away. The roster and contacts are personal data and live in this
// computer's settings only (Core/CsCalloutLocal.js).
//
// WIDGETS ARE FOUND BY objectName, never stashed on objects or as
// expandos (cavecad-tab-engine-panels). The action is forceGlobal, so
// this all runs in the application engine that init() built the dock in.
//
// See docs/superpowers/plans/2026-09-29-expedition-planner-panel.md.

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

var csExpeditionPlannerDock;

function ExpeditionPlanner(guiAction) {
    EAction.call(this, guiAction);
}

ExpeditionPlanner.prototype = new EAction();

ExpeditionPlanner.DOCK_NAME = "CaveSurveyExpeditionPlannerDock";

/**
 * What the panel is currently showing. Module state -- plain JS, never
 * widget expandos. `docPath` starts null so the first reload counts as
 * a new drawing and fills every field.
 */
ExpeditionPlanner.state = { drawn: null, docPath: null, store: null,
    loadError: "",
    // The station names the picker offers, in natural order.
    stations: [],
    // The stops picked, the last plan built, and the pace and packing
    // text last PUT INTO the widgets from stations.json (so a reload can
    // tell a caver's unsaved typing from what it showed).
    planStops: [], plan: null, planShown: null };

// ---------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------
//
// ONE PAGE, NO TABS, IN THE ORDER OF THE PRINTED CARD (Nathan,
// 2026-09-29: "Too easy to not enter important information"). The page
// reads top to bottom as callout-card.html does: Trip, Roster,
// Schedule, Escalation, Route, Card. Required fields carry a red
// asterisk, and Build card refuses, naming every gap at once
// (CsCalloutCard.missingAll), until they are all filled in.
//
// The stop list is a one-column QTableWidget, not a QListWidget: this
// bridge has no constructor for QListWidget (see CaveShelf.js). The
// picker is an editable QComboBox, whose own inline completion does the
// typing help: QCompleter does not exist on this bridge. QFormLayout has
// no addRow here either, so fields sit in CsPanel.formGrid grids.

ExpeditionPlanner.CALLOUT_DAY_HEADERS = ["Day", "Entry (HH:MM)", "Work hours", "Night (out/camp)"];
ExpeditionPlanner.CALLOUT_ROSTER_HEADERS = ["Name", "Role", "Squeeze limit (in)", "Medical", "Emergency contact"];

/** The objectName of the one scrolling page (the footer sits outside it). */
ExpeditionPlanner.PAGE_SCROLL_NAME = "ExpeditionPlannerPageScroll";

/** Label text (rich) for a field; a required one ends in a red asterisk. */
ExpeditionPlanner.labelText = function(text, required) {
    return CsPanel.escapeHtml(text) + (required === true ?
        " <span style=\"color:#c00\">*</span>" : "");
};

/** A bold section heading, with a little air above it. */
ExpeditionPlanner.heading = function(layout, text) {
    try {
        layout.addSpacing(6);
    } catch (eSp) {
    }
    layout.addWidget(new QLabel("<b>" + CsPanel.escapeHtml(text) + "</b>"), 0, 0);
};

/**
 * A labelled one-line field on row `row` of a formGrid; returns the
 * QLineEdit. Label left, field right, so the page stays narrow.
 */
ExpeditionPlanner.calloutField = function(grid, row, label, required, name, tip) {
    grid.addWidget(new QLabel(ExpeditionPlanner.labelText(label, required)), row, 0);
    var edit = new QLineEdit();
    edit.objectName = name;
    edit.toolTip = tip;
    grid.addWidget(edit, row, 1);
    return edit;
};

/**
 * An editable table with fixed headers. It never connects itemChanged:
 * the form is read on Build card, so filling it by code writes nothing.
 */
ExpeditionPlanner.calloutTable = function(name, headers, minH, maxH) {
    var t = new QTableWidget(0, headers.length);
    t.objectName = name;
    t.setHorizontalHeaderLabels(headers);
    try {
        t.verticalHeader().visible = false;
        t.horizontalHeader().stretchLastSection = true;
        t.setMinimumHeight(minH);
        t.setMaximumHeight(maxH);
    } catch (e) {
    }
    return t;
};

/** rowCount is a PROPERTY on this bridge (see LinetypeMaker). */
ExpeditionPlanner.addTableRow = function(table, cells) {
    var r = table.rowCount;
    table.setRowCount(r + 1);
    for (var c = 0; c < cells.length; c++) {
        table.setItem(r, c, new QTableWidgetItem(String(cells[c])));
    }
};

/** The selected row of a table, or -1. currentRow is a METHOD here. */
ExpeditionPlanner.selectedRowOf = function(table) {
    var idx = -1;
    try {
        var sel = table.selectionModel().selectedRows();
        if (sel.length > 0) {
            idx = sel[0].row();
        }
    } catch (eSel) {
        idx = -1;
    }
    if (idx < 0) {
        try {
            idx = table.currentRow();
        } catch (eCur) {
            idx = -1;
        }
    }
    return (typeof idx === "number" && idx >= 0) ? idx : -1;
};

ExpeditionPlanner.removeTableRow = function(table) {
    var r = ExpeditionPlanner.selectedRowOf(table);
    if (r >= 0 && r < table.rowCount) {
        table.removeRow(r);
    }
};

/** A row of buttons, left-aligned; returns the buttons in order. */
ExpeditionPlanner.buttonRow = function(layout, labels) {
    var row = new QHBoxLayout();
    var out = [];
    for (var i = 0; i < labels.length; i++) {
        var b = new QPushButton(labels[i]);
        row.addWidget(b, 0, 0);
        out.push(b);
    }
    row.addStretch(1);
    layout.addLayout(row, 0);
    return out;
};

/** 1. TRIP: start date, forecast place. */
ExpeditionPlanner.buildTripSection = function(layout) {
    ExpeditionPlanner.heading(layout, qsTr("Trip"));
    var grid = CsPanel.formGrid(1);
    ExpeditionPlanner.calloutField(grid, 0, qsTr("Start date"), true,
        "ExpeditionPlannerCalloutStart",
        qsTr("First day of the trip, YYYY-MM-DD. Saved in stations.json."));
    ExpeditionPlanner.calloutField(grid, 1, qsTr("Forecast place"), false,
        "ExpeditionPlannerCalloutPlace",
        qsTr("Optional: a nearby town. Blank uses the drawing's location " +
            "rounded to about 10 km. The exact entrance is never sent."));
    layout.addLayout(grid, 0);
};

/** 2. ROSTER: the people, and whether they go on the card. */
ExpeditionPlanner.buildRosterSection = function(layout) {
    ExpeditionPlanner.heading(layout, qsTr("Roster"));
    layout.addWidget(new QLabel(qsTr("Saved on this computer only.")), 0, 0);
    var roster = ExpeditionPlanner.calloutTable("ExpeditionPlannerCalloutRoster",
        ExpeditionPlanner.CALLOUT_ROSTER_HEADERS, 90, 170);
    layout.addWidget(roster, 0, 0);
    var b = ExpeditionPlanner.buttonRow(layout,
        [qsTr("Add person"), qsTr("Remove person")]);
    b[0].clicked.connect(function() {
        ExpeditionPlanner.addTableRow(
            ExpeditionPlanner.child("ExpeditionPlannerCalloutRoster"),
            ["", "", "", "", ""]);
    });
    b[1].clicked.connect(function() {
        ExpeditionPlanner.removeTableRow(
            ExpeditionPlanner.child("ExpeditionPlannerCalloutRoster"));
    });
    var include = new QCheckBox(qsTr("Include roster on the card"));
    include.objectName = "ExpeditionPlannerCalloutInclude";
    include.toolTip = qsTr("While ticked, the card needs at least one " +
        "person. Untick for a copy that leaves your hands.");
    include.checked = true;
    layout.addWidget(include, 0, 0);
};

/** 3. SCHEDULE: one row per day. */
ExpeditionPlanner.buildScheduleSection = function(layout) {
    ExpeditionPlanner.heading(layout, qsTr("Schedule"));
    layout.addWidget(new QLabel(ExpeditionPlanner.labelText(
        qsTr("Days: entry time, work hours, night"), true)), 0, 0);
    var days = ExpeditionPlanner.calloutTable("ExpeditionPlannerCalloutDays",
        ExpeditionPlanner.CALLOUT_DAY_HEADERS, 90, 150);
    layout.addWidget(days, 0, 0);
    var b = ExpeditionPlanner.buttonRow(layout,
        [qsTr("Add day"), qsTr("Remove day")]);
    b[0].clicked.connect(function() {
        var t = ExpeditionPlanner.child("ExpeditionPlannerCalloutDays");
        ExpeditionPlanner.addTableRow(t, [t.rowCount + 1, "08:00", "6", "out"]);
    });
    b[1].clicked.connect(function() {
        ExpeditionPlanner.removeTableRow(
            ExpeditionPlanner.child("ExpeditionPlannerCalloutDays"));
    });
};

/** 4. ESCALATION: who topside is, and what they do. */
ExpeditionPlanner.buildEscalationSection = function(layout) {
    ExpeditionPlanner.heading(layout, qsTr("Escalation"));
    var grid = CsPanel.formGrid(1);
    ExpeditionPlanner.calloutField(grid, 0, qsTr("Topside contact"), true,
        "ExpeditionPlannerCalloutTopName", qsTr("Saved on this computer only."));
    ExpeditionPlanner.calloutField(grid, 1, qsTr("Contact phone"), true,
        "ExpeditionPlannerCalloutTopPhone", qsTr("Saved on this computer only."));
    ExpeditionPlanner.calloutField(grid, 2, qsTr("If no word by callout"), true,
        "ExpeditionPlannerCalloutEscalation",
        qsTr("Who to call next, with the number. Saved on this computer only."));
    ExpeditionPlanner.calloutField(grid, 3, qsTr("Callout buffer, min"), false,
        "ExpeditionPlannerCalloutBuffer",
        qsTr("Minutes after the expected exit that topside starts acting. Default 120."));
    layout.addLayout(grid, 0);
};

/**
 * 5. ROUTE: the station picker, the stops, pace and packing (kept in
 * stations.json settings), Plan trip and Save packet.
 */
ExpeditionPlanner.buildRouteSection = function(layout) {
    ExpeditionPlanner.heading(layout, qsTr("Route"));
    layout.addWidget(new QLabel(ExpeditionPlanner.labelText(
        qsTr("Stops"), true)), 0, 0);

    var pickRow = new QHBoxLayout();
    var picker = new QComboBox();
    picker.objectName = "ExpeditionPlannerPicker";
    picker.toolTip = qsTr("Type or pick a station of this drawing.");
    try {
        picker.setEditable(true);
    } catch (eEdit) {
        try {
            picker.editable = true;
        } catch (eEdit2) {
        }
    }
    try {
        // Enter must not add the typed text to the list as a new
        // "station": only Add stop adds, and only a real station.
        picker.insertPolicy = QComboBox.NoInsert;
    } catch (eIns) {
    }
    var addButton = new QPushButton(qsTr("Add stop"));
    addButton.objectName = "ExpeditionPlannerAdd";
    addButton.toolTip = qsTr("Add the station in the box to this trip's stops.");
    pickRow.addWidget(picker, 1, 0);
    pickRow.addWidget(addButton, 0, 0);
    layout.addLayout(pickRow, 0);
    addButton.clicked.connect(function() { ExpeditionPlanner.addStop(); });

    // One line, deliberately (qcad-js-bridge-traps).
    var pickStatus = new QLabel("");
    pickStatus.objectName = "ExpeditionPlannerPickStatus";
    layout.addWidget(pickStatus, 0, 0);

    var stops = new QTableWidget(0, 1);
    stops.objectName = "ExpeditionPlannerStops";
    try {
        stops.horizontalHeader().visible = false;
        stops.verticalHeader().visible = false;
        stops.horizontalHeader().stretchLastSection = true;
        stops.selectionBehavior = QAbstractItemView.SelectRows;
        stops.selectionMode = QAbstractItemView.SingleSelection;
        stops.editTriggers = QAbstractItemView.NoEditTriggers;
    } catch (eStops) {
    }
    try {
        stops.setMinimumHeight(70);
        stops.setMaximumHeight(120);
    } catch (eStopsH) {
    }
    layout.addWidget(stops, 0, 0);

    var stopRow = new QHBoxLayout();
    var removeButton = new QPushButton(qsTr("Remove"));
    removeButton.objectName = "ExpeditionPlannerRemove";
    removeButton.toolTip = qsTr("Take the selected stop off the list.");
    var clearButton = new QPushButton(qsTr("Clear"));
    clearButton.objectName = "ExpeditionPlannerClear";
    stopRow.addWidget(removeButton, 0, 0);
    stopRow.addWidget(clearButton, 0, 0);
    stopRow.addStretch(1);
    layout.addLayout(stopRow, 0);
    removeButton.clicked.connect(function() { ExpeditionPlanner.removeStop(); });
    clearButton.clicked.connect(function() { ExpeditionPlanner.clearStops(); });

    // Pace: one line, deliberately (qcad-js-bridge-traps).
    var paceGrid = CsPanel.formGrid(1);
    paceGrid.addWidget(new QLabel(qsTr("Walking pace, ft/min")), 0, 0);
    var pace = new QLineEdit();
    pace.objectName = "ExpeditionPlannerPace";
    try {
        pace.placeholderText = qsTr("264 (a 3 mph hike)");
    } catch (ePh) {
    }
    pace.toolTip = qsTr("Leave blank for the default, 264 ft a minute " +
        "(3 mph). Saved in stations.json for the whole team.");
    paceGrid.addWidget(pace, 0, 1);
    layout.addLayout(paceGrid, 0);

    var packing = new QPlainTextEdit();
    packing.objectName = "ExpeditionPlannerPacking";
    try {
        packing.placeholderText = qsTr("Team packing list, one item per line");
    } catch (ePh2) {
    }
    packing.toolTip = qsTr("Printed in the packet as written. Saved in " +
        "stations.json for the whole team.");
    try {
        packing.setMinimumHeight(50);
        packing.setMaximumHeight(100);
    } catch (ePackH) {
    }
    layout.addWidget(packing, 0, 0);

    var runRow = new QHBoxLayout();
    var planButton = new QPushButton(qsTr("Plan trip"));
    planButton.objectName = "ExpeditionPlannerPlanButton";
    planButton.toolTip = qsTr("Route from the survey's first station to " +
        "every stop and back.");
    var packetButton = new QPushButton(qsTr("Save packet"));
    packetButton.objectName = "ExpeditionPlannerSavePacket";
    packetButton.toolTip = qsTr("Write trip-plan.html beside the drawing: " +
        "route sketch, directions, time and gear. No coordinates.");
    packetButton.enabled = false;
    runRow.addWidget(planButton, 0, 0);
    runRow.addWidget(packetButton, 0, 0);
    runRow.addStretch(1);
    layout.addLayout(runRow, 0);
    planButton.clicked.connect(function() { ExpeditionPlanner.planTrip(); });
    packetButton.clicked.connect(function() { ExpeditionPlanner.savePacket(); });
};

/** 6. CARD: Build card, its status, and the plan as text beneath. */
ExpeditionPlanner.buildCardSection = function(layout) {
    ExpeditionPlanner.heading(layout, qsTr("Card"));
    var buildRow = new QHBoxLayout();
    var build = new QPushButton(qsTr("Build card"));
    build.objectName = "ExpeditionPlannerCalloutBuild";
    build.toolTip = qsTr("Write callout-card.html beside the drawing. Every " +
        "field marked * must be filled in first.");
    buildRow.addWidget(build, 0, 0);
    buildRow.addStretch(1);
    layout.addLayout(buildRow, 0);
    build.clicked.connect(function() { ExpeditionPlanner.buildCard(); });

    // Its own row and word-wrapped: "Missing: ..." names every gap at
    // once, and one long line would widen the page into a horizontal
    // scroll. It sits above the plan text, never under a stretching
    // widget (qcad-js-bridge-traps: a wrapped label there is clipped).
    var status = new QLabel("");
    status.objectName = "ExpeditionPlannerCalloutStatus";
    try {
        status.wordWrap = true;
    } catch (eWrap) {
    }
    layout.addWidget(status, 0, 0);

    var out = new QPlainTextEdit();
    out.objectName = "ExpeditionPlannerPlanOut";
    out.readOnly = true;
    try {
        out.setMinimumHeight(160);
    } catch (eOutH) {
    }
    layout.addWidget(out, 1, 0);
};

/** The one page, top to bottom in the card's order. */
ExpeditionPlanner.buildPage = function() {
    var page = new QWidget();
    var layout = new QVBoxLayout();
    layout.setContentsMargins(6, 6, 6, 6);
    layout.setSpacing(4);
    var hint = new QLabel("<span style=\"color:#777\">" +
        CsPanel.escapeHtml(qsTr("* required to build the card")) + "</span>");
    hint.objectName = "ExpeditionPlannerRequiredHint";
    layout.addWidget(hint, 0, 0);
    // Each section in its own try: a refused control costs that
    // section, never the page (qcad-js-bridge-traps: wrap per control).
    var sections = [ExpeditionPlanner.buildTripSection,
        ExpeditionPlanner.buildRosterSection,
        ExpeditionPlanner.buildScheduleSection,
        ExpeditionPlanner.buildEscalationSection,
        ExpeditionPlanner.buildRouteSection,
        ExpeditionPlanner.buildCardSection];
    for (var i = 0; i < sections.length; i++) {
        try {
            sections[i](layout);
        } catch (eSection) {
            CsTell.warn("Expedition Planner: part " + (i + 1) + " of the " +
                "panel could not be built (" + eSection + ") -- please " +
                "report this.");
        }
    }
    page.setLayout(layout);
    return page;
};

ExpeditionPlanner.buildDock = function(appWin) {
    var dock = new QDockWidget(qsTr("Expedition Planner"), appWin);
    // Without an objectName restoreState() cannot identify the dock and
    // silently forgets where it was.
    dock.objectName = ExpeditionPlanner.DOCK_NAME;
    var body = new QWidget();
    var layout = new QVBoxLayout();
    layout.setContentsMargins(0, 0, 0, 0);
    layout.setSpacing(4);

    // The page scrolls; the footer below it does not.
    var page = ExpeditionPlanner.buildPage();
    var scroll = null;
    try {
        scroll = new QScrollArea();
        scroll.objectName = ExpeditionPlanner.PAGE_SCROLL_NAME;
        // METHODS, NOT PROPERTIES: the bridge treats several QScrollArea
        // properties as read-only (CsPanel.makeScrollable).
        scroll.setWidgetResizable(true);
        try {
            scroll.setFrameShape(QFrame.NoFrame);
        } catch (eFrame) {
        }
        try {
            scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAsNeeded);
            scroll.setVerticalScrollBarPolicy(Qt.ScrollBarAsNeeded);
        } catch (ePolicy) {
        }
        scroll.setWidget(page);
        layout.addWidget(scroll, 1, 0);
    } catch (eScroll) {
        // No scroll area: the page still works, the outer
        // CsPanel.makeScrollable wrap scrolls the whole dock instead.
        layout.addWidget(page, 1, 0);
    }

    // Footer. One line, deliberately: a wrapping label under a
    // stretching page is drawn clipped (qcad-js-bridge-traps).
    var footRow = new QHBoxLayout();
    footRow.setContentsMargins(6, 0, 6, 6);
    var summary = new QLabel("");
    summary.objectName = "ExpeditionPlannerSummary";
    var refreshButton = new QPushButton(qsTr("Refresh"));
    refreshButton.objectName = "ExpeditionPlannerRefresh";
    refreshButton.toolTip = qsTr("Read the survey and stations.json again.");
    footRow.addWidget(summary, 1, 0);
    footRow.addWidget(refreshButton, 0, 0);
    layout.addLayout(footRow, 0);
    refreshButton.clicked.connect(function() { ExpeditionPlanner.reload(); });

    body.setLayout(layout);
    dock.setWidget(body);
    appWin.addDockWidget(Qt.RightDockWidgetArea, dock);
    CsPanel.attachHelp(dock, "ExpeditionPlanner", qsTr("Expedition Planner"));
    return dock;
};

ExpeditionPlanner.ensureDock = function() {
    if (isNull(csExpeditionPlannerDock)) {
        csExpeditionPlannerDock = ExpeditionPlanner.buildDock(
            RMainWindowQt.getMainWindow());
    }
    return csExpeditionPlannerDock;
};

/** A child widget by objectName, or null. Widgets are found, never stashed. */
ExpeditionPlanner.child = function(name) {
    try {
        var w = ExpeditionPlanner.ensureDock().findChild(name);
        return isNull(w) ? null : w;
    } catch (e) {
        return null;
    }
};

ExpeditionPlanner.updateSummary = function() {
    var s = ExpeditionPlanner.state;
    var label = ExpeditionPlanner.child("ExpeditionPlannerSummary");
    if (label === null) {
        return;
    }
    var text;
    if (s.drawn === null) {
        text = qsTr("No survey in this drawing.");
    } else {
        text = qsTr("%1 stations").arg(s.stations.length);
    }
    if (s.loadError !== "") {
        text += "  |  " + s.loadError;
    }
    label.text = text;
};

/**
 * True when the drawing on screen is still the one the panel was read
 * from. The panel is one dock across every tab; switching tabs does not
 * reload it, so a plan or a save must check before acting.
 */
ExpeditionPlanner.sameDrawing = function() {
    return CsStationSidecar.pathOf(CsStationSidecar.document()) ===
        ExpeditionPlanner.state.docPath;
};

/**
 * The same-drawing guard. The one dock serves every tab, so a stop
 * picked on one cave must never be routed on another.
 * \return true when it is safe to act
 */
ExpeditionPlanner.planGuard = function() {
    if (ExpeditionPlanner.sameDrawing()) {
        return true;
    }
    ExpeditionPlanner.reload();
    CsTell.warn(qsTr("Expedition Planner: the drawing changed under the " +
        "panel, so it has been read again and the trip's stops cleared. " +
        "Pick them again."));
    return false;
};

// ---------------------------------------------------------------------
// The station picker
// ---------------------------------------------------------------------

/**
 * Every station a trip can be routed to -- each end of a survey leg and
 * each fixed station -- in the order a caver reads them (A2 before A10).
 */
ExpeditionPlanner.stationNames = function(survey) {
    var names = {};
    var name;
    var degree = CsFrontier.degrees(survey);
    for (name in degree) {
        if (Object.prototype.hasOwnProperty.call(degree, name)) { names[name] = true; }
    }
    var anchors = CsFrontier.anchors(survey);
    for (name in anchors) {
        if (Object.prototype.hasOwnProperty.call(anchors, name)) { names[name] = true; }
    }
    var out = [];
    for (name in names) {
        if (Object.prototype.hasOwnProperty.call(names, name)) { out.push(name); }
    }
    out.sort(CsStationTable.compareNatural);
    return out;
};

/**
 * The station a typed name means: an exact match first, then one that
 * differs only in case. \return the station's own name, or null
 */
ExpeditionPlanner.matchStation = function(names, typed) {
    var t = String(typed === undefined || typed === null ? "" : typed)
        .replace(/^\s+|\s+$/g, "");
    if (t === "") {
        return null;
    }
    if (names.indexOf(t) >= 0) {
        return t;
    }
    var lower = t.toLowerCase();
    for (var i = 0; i < names.length; i++) {
        if (String(names[i]).toLowerCase() === lower) {
            return names[i];
        }
    }
    return null;
};

/** The picker's text. currentText is read as either form the bridge offers. */
ExpeditionPlanner.pickerText = function(picker) {
    try {
        return String(typeof picker.currentText === "function" ?
            picker.currentText() : picker.currentText);
    } catch (e) {
        return "";
    }
};

ExpeditionPlanner.setPickerText = function(picker, text) {
    try {
        picker.setEditText(String(text));
    } catch (e) {
    }
};

ExpeditionPlanner.pickSay = function(text) {
    var label = ExpeditionPlanner.child("ExpeditionPlannerPickStatus");
    if (label !== null) { label.text = text; }
};

/**
 * Refill the picker from state.stations. Anything the caver has typed
 * but not added yet stays in the box.
 */
ExpeditionPlanner.fillPicker = function() {
    var picker = ExpeditionPlanner.child("ExpeditionPlannerPicker");
    if (picker === null) {
        return;
    }
    var typed = ExpeditionPlanner.pickerText(picker);
    try {
        picker.clear();
        var names = ExpeditionPlanner.state.stations;
        for (var i = 0; i < names.length; i++) {
            picker.addItem(String(names[i]));
        }
    } catch (e) {
    }
    ExpeditionPlanner.setPickerText(picker, typed);
};

// ---------------------------------------------------------------------
// The Route section
// ---------------------------------------------------------------------

/** Repaint the stop list from state.planStops. */
ExpeditionPlanner.fillStops = function() {
    var list = ExpeditionPlanner.child("ExpeditionPlannerStops");
    if (list === null) {
        return;
    }
    var stops = ExpeditionPlanner.state.planStops;
    list.setRowCount(0);
    list.setRowCount(stops.length);
    for (var i = 0; i < stops.length; i++) {
        list.setItem(i, 0, new QTableWidgetItem(String(stops[i])));
    }
};

/** Add the station named in the picker to the stops. */
ExpeditionPlanner.addStop = function() {
    if (!ExpeditionPlanner.planGuard()) {
        return;
    }
    var picker = ExpeditionPlanner.child("ExpeditionPlannerPicker");
    if (picker === null) {
        return;
    }
    var typed = ExpeditionPlanner.pickerText(picker).replace(/^\s+|\s+$/g, "");
    if (typed === "") {
        ExpeditionPlanner.pickSay(qsTr("Type or pick a station first."));
        return;
    }
    var station = ExpeditionPlanner.matchStation(
        ExpeditionPlanner.state.stations, typed);
    if (station === null) {
        ExpeditionPlanner.pickSay(qsTr("%1 is not a station in this drawing")
            .arg(typed));
        return;
    }
    ExpeditionPlanner.pickSay("");
    var stops = ExpeditionPlanner.state.planStops;
    if (stops.indexOf(station) >= 0) {
        return;
    }
    stops.push(station);
    ExpeditionPlanner.fillStops();
    ExpeditionPlanner.setPickerText(picker, "");
};

/** Take the selected stop off the list. */
ExpeditionPlanner.removeStop = function() {
    var list = ExpeditionPlanner.child("ExpeditionPlannerStops");
    if (list === null) {
        return;
    }
    var idx = ExpeditionPlanner.selectedRowOf(list);
    var stops = ExpeditionPlanner.state.planStops;
    if (idx >= 0 && idx < stops.length) {
        stops.splice(idx, 1);
        ExpeditionPlanner.fillStops();
    }
};

ExpeditionPlanner.clearStops = function() {
    ExpeditionPlanner.state.planStops = [];
    ExpeditionPlanner.fillStops();
};

/**
 * The pace field read: null when blank (the default applies), a number
 * of ft/min when valid, NaN when it cannot be used.
 */
ExpeditionPlanner.paceTyped = function() {
    var edit = ExpeditionPlanner.child("ExpeditionPlannerPace");
    var text = edit === null ? "" : String(edit.text).replace(/^\s+|\s+$/g, "");
    if (text === "") {
        return null;
    }
    var v = Number(text);
    return (isFinite(v) && v > 0) ? v : NaN;
};

ExpeditionPlanner.packingTyped = function() {
    var edit = ExpeditionPlanner.child("ExpeditionPlannerPacking");
    return edit === null ? "" : String(edit.toPlainText());
};

/**
 * The stored pace block with the typed pace laid over it. Other keys a
 * team set by hand in stations.json (descent rate, rig time...) are
 * kept: the panel only owns paceFtPerMin.
 */
ExpeditionPlanner.paceBlock = function(stored, typed) {
    var out = {};
    var src = (stored !== null && typeof stored === "object") ? stored : {};
    for (var key in src) {
        if (Object.prototype.hasOwnProperty.call(src, key)) {
            out[key] = src[key];
        }
    }
    if (typed === null) {
        delete out.paceFtPerMin;
    } else {
        out.paceFtPerMin = typed;
    }
    return out;
};

/**
 * Put pace and packing into stations.json settings, re-reading the file
 * first like every other write here. Unchanged values write nothing.
 * \return "" when saved or nothing to save, else why not
 */
ExpeditionPlanner.savePlanSettings = function(pace, packing) {
    var s = ExpeditionPlanner.state;
    var path = CsStationSidecar.sidecarPath(s.docPath);
    if (path === "") {
        return qsTr("pace and packing not saved: save the drawing first");
    }
    var side = CsStationSidecar.readSidecar(path);
    if (side.error !== "") {
        s.loadError = side.error;
        ExpeditionPlanner.updateSummary();
        return qsTr("pace and packing not saved: stations.json could not " +
            "be read") + " (" + side.error + ")";
    }
    var st = side.store.settings;
    var block = ExpeditionPlanner.paceBlock(st.pace, pace);
    var was = st.pace === null || typeof st.pace !== "object" ? undefined :
        st.pace.paceFtPerMin;
    var shown = { pace: pace === null ? "" : String(pace), packing: packing };
    if (st.packing === packing && was === block.paceFtPerMin) {
        if (s.store !== null) {
            s.store.settings = st;
        }
        s.planShown = shown;
        return "";
    }
    st.packing = packing;
    st.pace = block;
    if (!CsStationSidecar.writeSidecar(path, side.store)) {
        return qsTr("pace and packing not saved: could not write stations.json");
    }
    if (s.store !== null) {
        s.store.settings = st;
    }
    s.planShown = shown;
    return "";
};

/**
 * Show the stored pace and packing in the widgets. Only overwrites what
 * the caver has not edited since it was last shown (or when the drawing
 * changed), so a Refresh never eats unsaved typing.
 */
ExpeditionPlanner.showPlanSettings = function(force) {
    var s = ExpeditionPlanner.state;
    var paceEdit = ExpeditionPlanner.child("ExpeditionPlannerPace");
    var packEdit = ExpeditionPlanner.child("ExpeditionPlannerPacking");
    if (paceEdit === null || packEdit === null || s.store === null) {
        return;
    }
    var st = s.store.settings || {};
    var pv = (st.pace !== null && typeof st.pace === "object") ?
        st.pace.paceFtPerMin : undefined;
    var want = { pace: (typeof pv === "number" && isFinite(pv) && pv > 0) ?
        String(pv) : "", packing: String(st.packing || "") };
    var shown = s.planShown;
    var untouched = shown === null ||
        (String(paceEdit.text) === shown.pace &&
         String(packEdit.toPlainText()) === shown.packing);
    if (force === true || untouched) {
        paceEdit.text = want.pace;
        packEdit.setPlainText(want.packing);
        s.planShown = want;
    }
};

/** The survey's distance unit: the first trip's, "m" or "ft". */
ExpeditionPlanner.unitOf = function(survey) {
    var u = "";
    if (!isNull(survey.trips) && survey.trips.length > 0 &&
            !isNull(survey.trips[0])) {
        u = survey.trips[0].distanceUnit;
    }
    if (u !== "m" && u !== "ft") {
        u = survey.distanceUnit;
    }
    return u === "m" ? "m" : "ft";
};

/** The plan as the text the panel shows. */
ExpeditionPlanner.planText = function(p, paceUsed) {
    var unit = p.unit;
    var len = function(v) { return String(Math.round(v)) + " " + unit; };
    var lines = [];
    lines.push(qsTr("From %1, %2 stop(s), walking %3 ft/min.")
        .arg(p.start).arg(p.stops.length).arg(paceUsed));
    for (var w = 0; w < p.warnings.length; w++) {
        lines.push("WARNING: " + p.warnings[w]);
    }
    // Counted intersections, not stations: underground nobody can tell
    // which station they are at (Nathan, 2026-09-29). Same structure as
    // the signs on the printed pages.
    var leg = function(heading, steps, destination) {
        var signs = CsTripPlan.signs(steps, unit, destination);
        lines.push("");
        lines.push(heading + " " + destination + " (" +
            CsTripPlan.legSummary(signs, steps, unit).split(" · ").join(", ") + ")");
        lines = lines.concat(CsTripPlan.signsText(signs));
    };
    for (var i = 0; i < p.stops.length; i++) {
        leg("To", p.stops[i].steps, p.stops[i].station);
    }
    if (p.stops.length > 0) {
        leg("Back to", p.back.steps, p.start);
    }
    var t = p.totals;
    lines.push("");
    lines.push("Total " + CsTripPlan.clock(t.minutesAll) + "  (in " +
        CsTripPlan.clock(t.minutesIn) + ", work " +
        CsTripPlan.clock(t.minutesWork) + ", out " +
        CsTripPlan.clock(t.minutesOut) + ")");
    lines.push("Distance " + len(t.lengthIn) + " in, " + len(t.lengthAll) +
        " round trip");
    for (var r = 0; r < p.gear.rope.length; r++) {
        lines.push("Rope: " + p.gear.rope[r].text);
    }
    for (var h = 0; h < p.gear.hardware.length; h++) {
        lines.push("Rigging: " + p.gear.hardware[h]);
    }
    lines.push("");
    lines.push(qsTr("The route follows the survey line. It is not a " +
        "guarantee that the way is safe or easy."));
    return lines.join("\n");
};

/**
 * Build the plan from the stop list and show it. Saves pace and packing
 * to stations.json first.
 * \return the plan, or null when nothing was planned
 */
ExpeditionPlanner.planTrip = function() {
    var s = ExpeditionPlanner.state;
    var out = ExpeditionPlanner.child("ExpeditionPlannerPlanOut");
    var packetButton = ExpeditionPlanner.child("ExpeditionPlannerSavePacket");
    if (!ExpeditionPlanner.planGuard()) {
        return null;
    }
    var d = s.drawn;
    if (d === null) {
        CsTell.warn(qsTr("Expedition Planner: this drawing holds no survey " +
            "to plan on."));
        return null;
    }
    var targets = s.planStops.slice(0);
    if (targets.length === 0) {
        CsTell.warn(qsTr("Expedition Planner: Add at least one stop."));
        return null;
    }
    var pace = ExpeditionPlanner.paceTyped();
    if (pace !== null && isNaN(pace)) {
        CsTell.warn(qsTr("Expedition Planner: the walking pace must be a " +
            "number of feet per minute above 0, or blank for the default 264."));
        return null;
    }
    var packing = ExpeditionPlanner.packingTyped();
    var why = ExpeditionPlanner.savePlanSettings(pace, packing);
    var config = ExpeditionPlanner.paceBlock(
        s.store === null ? {} : s.store.settings.pace, pace);
    s.plan = CsTripPlan.build(d.survey, d.resolved, { targets: targets,
        unit: ExpeditionPlanner.unitOf(d.survey), config: config,
        packing: packing });
    var text = ExpeditionPlanner.planText(s.plan,
        CsTripPlan.config(config).paceFtPerMin);
    if (why !== "") {
        text += "\n(" + why + ")";
    }
    if (out !== null) {
        out.setPlainText(text);
    }
    if (packetButton !== null) {
        packetButton.enabled = s.plan.stops.length > 0;
    }
    return s.plan;
};

/** Today as YYYY-MM-DD (JS Date: the bridge has no QDate). */
ExpeditionPlanner.today = function() {
    var d = new Date();
    var two = function(n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate());
};

/**
 * Write trip-plan.html beside the drawing. Re-plans first, so the packet
 * is always what the panel shows for the stops, pace and packing now.
 * \return the path written, or ""
 */
ExpeditionPlanner.savePacket = function() {
    var s = ExpeditionPlanner.state;
    if (!ExpeditionPlanner.planGuard()) {
        return "";
    }
    if (s.docPath === "" || CsCave.folderOf(s.docPath) === null) {
        CsTell.warn(qsTr("Expedition Planner: save the drawing first. The " +
            "packet is written beside it."));
        return "";
    }
    var plan = ExpeditionPlanner.planTrip();
    if (plan === null || plan.stops.length === 0) {
        return "";
    }
    var html = CsTripPlan.packetHtml(plan, {
        title: CsCave.nameOf(s.docPath) || qsTr("Cave"),
        survey: s.drawn.survey, resolved: s.drawn.resolved,
        date: ExpeditionPlanner.today() });
    var path = CsCave.folderOf(s.docPath) + "/trip-plan.html";
    if (!CsStationSidecar.writeText(path, html)) {
        CsTell.warn(qsTr("Expedition Planner: could not write trip-plan.html " +
            "beside the drawing."));
        return "";
    }
    var out = ExpeditionPlanner.child("ExpeditionPlannerPlanOut");
    if (out !== null) {
        out.setPlainText(String(out.toPlainText()) + "\n\n" +
            qsTr("Packet saved: %1").arg(path));
    }
    try {
        EAction.handleUserMessage(qsTr("Expedition Planner: packet saved as %1")
            .arg(path));
    } catch (eMsg) {
    }
    return path;
};

/** Forget the trip's stops and plan (the drawing changed). */
ExpeditionPlanner.resetPlan = function() {
    var s = ExpeditionPlanner.state;
    s.planStops = [];
    s.plan = null;
    s.planShown = null;
    ExpeditionPlanner.fillStops();
    ExpeditionPlanner.pickSay("");
    var out = ExpeditionPlanner.child("ExpeditionPlannerPlanOut");
    if (out !== null) {
        out.setPlainText("");
    }
    var packetButton = ExpeditionPlanner.child("ExpeditionPlannerSavePacket");
    if (packetButton !== null) {
        packetButton.enabled = false;
    }
};

// ---------------------------------------------------------------------
// The callout card
// ---------------------------------------------------------------------

/** The form as {trip, contacts, roster, includeRoster}. */
ExpeditionPlanner.readCalloutForm = function() {
    var text = function(name) {
        var w = ExpeditionPlanner.child(name);
        return w === null ? "" : String(w.text);
    };
    var cell = function(t, r, c) {
        var it = t.item(r, c);
        return isNull(it) ? "" : String(it.text());
    };
    var days = [];
    var dt = ExpeditionPlanner.child("ExpeditionPlannerCalloutDays");
    for (var r = 0; dt !== null && r < dt.rowCount; r++) {
        days.push({ entry: cell(dt, r, 1), workHours: parseFloat(cell(dt, r, 2)),
            night: cell(dt, r, 3) });
    }
    var trip = CsStationStore.cleanTrip({
        startDate: text("ExpeditionPlannerCalloutStart"),
        weatherPlace: text("ExpeditionPlannerCalloutPlace"), days: days });
    var rt = ExpeditionPlanner.child("ExpeditionPlannerCalloutRoster");
    var roster = [];
    for (var p = 0; rt !== null && p < rt.rowCount; p++) {
        roster.push({ name: cell(rt, p, 0), role: cell(rt, p, 1),
            squeeze: cell(rt, p, 2), medical: cell(rt, p, 3),
            emergency: cell(rt, p, 4) });
    }
    var include = ExpeditionPlanner.child("ExpeditionPlannerCalloutInclude");
    return { trip: trip,
        contacts: CsCalloutLocal.parseContacts(CsCalloutLocal.serializeContacts({
            topName: text("ExpeditionPlannerCalloutTopName"),
            topPhone: text("ExpeditionPlannerCalloutTopPhone"),
            escalation: text("ExpeditionPlannerCalloutEscalation"),
            bufferMin: text("ExpeditionPlannerCalloutBuffer") })),
        roster: CsCalloutLocal.parseRoster(CsCalloutLocal.serializeRoster(roster)),
        includeRoster: include === null ? true : include.checked === true };
};

/**
 * Fill the form from stations.json (trip) and local settings (people).
 * The roster and days tables connect no itemChanged handler, so filling writes
 * nothing.
 */
ExpeditionPlanner.showCalloutSettings = function() {
    var s = ExpeditionPlanner.state;
    var set = function(name, v) {
        var w = ExpeditionPlanner.child(name);
        if (w !== null) { w.text = String(v); }
    };
    var dt = ExpeditionPlanner.child("ExpeditionPlannerCalloutDays");
    var rt = ExpeditionPlanner.child("ExpeditionPlannerCalloutRoster");
    if (dt === null || rt === null) {
        return;
    }
    var trip = (s.store !== null && s.store.settings.trip) ?
        s.store.settings.trip : CsStationStore.emptyTrip();
    set("ExpeditionPlannerCalloutStart", trip.startDate);
    set("ExpeditionPlannerCalloutPlace", trip.weatherPlace);
    dt.setRowCount(0);
    for (var i = 0; i < trip.days.length; i++) {
        ExpeditionPlanner.addTableRow(dt, [i + 1, trip.days[i].entry,
            trip.days[i].workHours, trip.days[i].night]);
    }
    var c = CsCalloutLocal.loadContacts();
    set("ExpeditionPlannerCalloutTopName", c.topName);
    set("ExpeditionPlannerCalloutTopPhone", c.topPhone);
    set("ExpeditionPlannerCalloutEscalation", c.escalation);
    set("ExpeditionPlannerCalloutBuffer", c.bufferMin);
    rt.setRowCount(0);
    var people = CsCalloutLocal.loadRoster();
    for (var p = 0; p < people.length; p++) {
        ExpeditionPlanner.addTableRow(rt, [people[p].name, people[p].role,
            people[p].squeeze === null ? "" : people[p].squeeze,
            people[p].medical, people[p].emergency]);
    }
};

/**
 * Put the trip into stations.json settings (re-reading the file first,
 * like savePlanSettings). \return "" when saved, else why not.
 */
ExpeditionPlanner.saveTrip = function(trip) {
    var s = ExpeditionPlanner.state;
    var path = CsStationSidecar.sidecarPath(s.docPath);
    if (path === "") {
        return qsTr("trip not saved: save the drawing first");
    }
    var side = CsStationSidecar.readSidecar(path);
    if (side.error !== "") {
        return qsTr("trip not saved: stations.json could not be read") +
            " (" + side.error + ")";
    }
    side.store.settings.trip = trip;
    if (!CsStationSidecar.writeSidecar(path, side.store)) {
        return qsTr("trip not saved: could not write stations.json");
    }
    if (s.store !== null) { s.store.settings.trip = trip; }
    return "";
};

ExpeditionPlanner.calloutSay = function(text) {
    var label = ExpeditionPlanner.child("ExpeditionPlannerCalloutStatus");
    if (label !== null) { label.text = text; }
};

/** Write callout-card.html beside the drawing. \return the path or "" */
ExpeditionPlanner.buildCard = function() {
    var s = ExpeditionPlanner.state;
    if (!ExpeditionPlanner.planGuard()) { return ""; }
    if (s.docPath === "" || CsCave.folderOf(s.docPath) === null) {
        ExpeditionPlanner.calloutSay(qsTr("Save the drawing first."));
        return "";
    }
    var form = ExpeditionPlanner.readCalloutForm();
    // No stops (or no survey) is a gap to name with the others, not a
    // reason for planTrip's warning box; route only when there is one.
    var plan = null;
    if (s.drawn !== null && s.planStops.length > 0) {
        plan = ExpeditionPlanner.planTrip();
        if (plan === null) {
            // planTrip has said why (a bad pace, most likely).
            ExpeditionPlanner.calloutSay(qsTr("The route could not be " +
                "planned; nothing was built."));
            return "";
        }
    }
    // EVERY gap at once, and nothing built until there are none.
    var need = CsCalloutCard.missingAll(form.trip, plan, form.contacts,
        form.roster, form.includeRoster);
    if (need.length > 0) {
        ExpeditionPlanner.calloutSay(qsTr("Missing: %1").arg(need.join(", ")));
        return "";
    }
    var problems = [];
    var why = ExpeditionPlanner.saveTrip(form.trip);
    if (why !== "") { problems.push(why); }
    if (!CsCalloutLocal.saveRoster(form.roster)) { problems.push(qsTr("roster not saved")); }
    if (!CsCalloutLocal.saveContacts(form.contacts)) { problems.push(qsTr("contacts not saved")); }

    var anchor = null;
    try {
        var rec = CsLocationPick.anchorRecord(CsStationSidecar.document());
        if (rec !== null) { anchor = { lat: rec.lat, lon: rec.lon }; }
    } catch (eAnchor) {
    }
    var wx = CsWeather.lookup(CsCalloutCard.tripDates(form.trip), anchor,
        form.trip.weatherPlace);
    if (wx.days === null) {
        problems.push(qsTr("no forecast (%1)").arg(wx.error));
    }
    var html = CsCalloutCard.html(plan, {
        title: CsCave.nameOf(s.docPath) || qsTr("Cave"),
        survey: s.drawn.survey, resolved: s.drawn.resolved,
        trip: form.trip, contacts: form.contacts, roster: form.roster,
        includeRoster: form.includeRoster,
        forecast: wx.days === null ? null : { days: wx.days },
        generated: ExpeditionPlanner.today() });
    var path = CsCave.folderOf(s.docPath) + "/callout-card.html";
    if (!CsStationSidecar.writeText(path, html)) {
        ExpeditionPlanner.calloutSay(qsTr("Could not write callout-card.html beside the drawing."));
        return "";
    }
    ExpeditionPlanner.calloutSay(qsTr("Saved callout-card.html") +
        (problems.length > 0 ? " (" + problems.join("; ") + ")" : ""));
    try {
        // Same call CaveShelf.reveal ships.
        QDesktopServices.openUrl(new QUrl("file://" + path));
    } catch (eOpen) {
    }
    return path;
};

// ---------------------------------------------------------------------
// Reloading
// ---------------------------------------------------------------------

/** Re-read the drawing and the sidecar, then repaint. */
ExpeditionPlanner.reload = function() {
    var s = ExpeditionPlanner.state;
    var doc = CsStationSidecar.document();
    var before = s.docPath;
    s.docPath = CsStationSidecar.pathOf(doc);
    // Another drawing: its stops, plan and pace belong to the old one.
    var changed = s.docPath !== before;
    if (changed) {
        ExpeditionPlanner.resetPlan();
    }
    var drawn = null;
    try {
        drawn = CsStationSidecar.readDrawing(doc);
    } catch (eRead) {
        drawn = null;
        CsTell.warn("Expedition Planner: could not read the survey (" +
            eRead + ").");
    }
    s.drawn = drawn;
    s.stations = [];
    if (drawn !== null) {
        try {
            s.stations = ExpeditionPlanner.stationNames(drawn.survey);
        } catch (eNames) {
            s.stations = [];
        }
    }
    var side = CsStationSidecar.readSidecar(
        CsStationSidecar.sidecarPath(s.docPath));
    s.store = side.store;
    s.loadError = side.error;
    ExpeditionPlanner.showPlanSettings(changed);
    if (changed) {
        ExpeditionPlanner.showCalloutSettings();
    }
    ExpeditionPlanner.fillPicker();
    ExpeditionPlanner.updateSummary();
};

ExpeditionPlanner.open = function() {
    var dock = ExpeditionPlanner.ensureDock();
    dock.visible = true;
    try {
        dock.raise();
    } catch (eRaise) {
    }
    ExpeditionPlanner.reload();
};

ExpeditionPlanner.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    try {
        ExpeditionPlanner.open();
    } catch (e) {
        csExpeditionPlannerDock = undefined;
        CsTell.warn("Expedition Planner: this CaveCAD build refused the " +
            "docked panel (" + e + ") -- please report this.");
    }
    this.terminate();
};

ExpeditionPlanner.init = function(basePath) {
    ExpeditionPlanner.basePath = basePath;

    var action = new RGuiAction(qsTr("Expedition Planner"),
        RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    // A requiresDocument action runs in the ACTIVE TAB'S own script
    // engine, where dock globals start empty; forceGlobal makes every
    // tab share the one dock (qcad-plugin-conventions).
    action.setForceGlobal(true);
    action.setScriptFile(basePath + "/ExpeditionPlanner.js");
    action.setIcon(basePath + "/ExpeditionPlanner.svg");
    action.setStatusTip(qsTr("Plan a trip to stations in the cave, save " +
        "its route packet, and build the callout card for topside"));
    action.setDefaultCommands(["expeditionplanner", "epl"]);
    action.setGroupSortOrder(451);
    action.setSortOrder(13);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);

    // Built during init like the other docks: the main window's
    // restoreState() runs after this and can only place a dock that
    // already exists. Hidden until the menu entry shows it.
    try {
        var dock = ExpeditionPlanner.ensureDock();
        dock.visible = false;
    } catch (eInit) {
        csExpeditionPlannerDock = undefined;
        warning("Expedition Planner: could not build the panel at startup (" +
            eInit + "); the menu entry will try again.");
    }
};
