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
// away. The trip's party (who is going: id and name only) is
// settings.trip.party there too.
//
// PERSONAL DATA STAYS ON THIS COMPUTER. The people directory (medical
// notes, emergency contacts, skills) is people.json in CaveCAD's
// per-user data folder (Core/CsPeople.js); the topside contacts are in
// this computer's settings (Core/CsCalloutLocal.js). Neither ever goes
// into the cave folder, which Drive syncs.
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
    planStops: [], plan: null, planShown: null,
    // The people directory as loaded from people.json, why it could not
    // be (the table is then read-only and nothing is written to it), and
    // what each roster row is: {id, name, known}. Unknown rows are party
    // members this computer has no details for.
    people: [], peopleError: "", rosterRows: [],
    // Set while the roster is filled by code (FILLING IS NOT EDITING).
    filling: false };

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
ExpeditionPlanner.CALLOUT_ROSTER_HEADERS = ["Going", "Name", "Role", "Squeeze (in)",
    "Skills", "Medical", "Emergency contact"];

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
 * A table with fixed headers. The days table never connects
 * itemChanged: it is read on Build card, so filling it by code writes
 * nothing. The roster does connect it, behind a fill guard.
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

/**
 * 1. TRIP: start date (Qt's own QDateEdit with its calendar dropdown),
 * forecast place.
 */
ExpeditionPlanner.buildTripSection = function(layout) {
    ExpeditionPlanner.heading(layout, qsTr("Trip"));
    var grid = CsPanel.formGrid(1);
    grid.addWidget(new QLabel(ExpeditionPlanner.labelText(qsTr("Start date"), false)), 0, 0);
    // The bridge has no QDateEdit constructor, so the field comes from
    // ExpeditionPlannerDate.ui (a row holding the QDateEdit, objectName
    // ExpeditionPlannerCalloutStart). Its wrapper exposes no signals and
    // no date getters: only property()/setProperty(), and only
    // startDateText/setStartDateText below use them. Parented to the
    // main window (null) until the grid takes it.
    var dateRow = WidgetFactory.createWidget(ExpeditionPlanner.basePath,
        "ExpeditionPlannerDate.ui", null);
    // Qt's calendar dropdown has no Today button and the bridge cannot
    // reach it, so Today sits beside the field: one click puts today's
    // date in, and the dropdown then opens on today's month. Added to
    // the row's own layout (probed live); a failure just loses the button.
    try {
        var todayButton = new QPushButton(qsTr("Today"));
        todayButton.objectName = "ExpeditionPlannerStartToday";
        todayButton.toolTip = qsTr("Set the start date to today.");
        // Without a cap the layout splits the row evenly with the date field.
        try {
            todayButton.setMaximumWidth(84);
        } catch (eWidth) {
        }
        dateRow.layout().addWidget(todayButton);
        todayButton.clicked.connect(function() { ExpeditionPlanner.startDateToday(); });
    } catch (eToday) {
    }
    grid.addWidget(dateRow, 0, 1);
    // A fresh panel starts on today; showCalloutSettings replaces it
    // with the drawing's saved start date, when there is one. Written on
    // the widget itself: setStartDateText would look it up through the
    // dock, which is still being built here (see ensureDock).
    ExpeditionPlanner.writeStartDate(
        isNull(dateRow) ? null : dateRow.findChild("ExpeditionPlannerCalloutStart"), "");
    ExpeditionPlanner.calloutField(grid, 1, qsTr("Forecast place"), false,
        "ExpeditionPlannerCalloutPlace",
        qsTr("Optional: a nearby town. Blank uses the drawing's location " +
            "rounded to about 10 km. The exact entrance is never sent."));
    layout.addLayout(grid, 0);
};

/**
 * 2. ROSTER: the people directory (people.json, this computer only) as
 * a read-only table with a Going tick per person, the buttons that
 * change it, and whether the roster goes on the card. Details are
 * typed in the Add/Edit person popup, never in the table.
 */
ExpeditionPlanner.buildRosterSection = function(layout) {
    ExpeditionPlanner.heading(layout, qsTr("Roster"));
    layout.addWidget(new QLabel("<span style=\"color:#777\">" +
        CsPanel.escapeHtml(qsTr("Saved on this computer only. Tick Going for " +
            "this trip.")) + "</span>"), 0, 0);
    var roster = ExpeditionPlanner.calloutTable("ExpeditionPlannerCalloutRoster",
        ExpeditionPlanner.CALLOUT_ROSTER_HEADERS, 90, 200);
    roster.toolTip = qsTr("Everyone in your people directory. Tick Going " +
        "for this trip; double-click a person (or Edit person) to change " +
        "their details.");
    try {
        roster.selectionBehavior = QAbstractItemView.SelectRows;
        roster.selectionMode = QAbstractItemView.SingleSelection;
        // Read-only: only the Going tick changes here. A checkable item
        // toggles whatever the edit triggers say.
        roster.editTriggers = QAbstractItemView.NoEditTriggers;
    } catch (eSel) {
    }
    layout.addWidget(roster, 0, 0);
    // FILLING IS NOT EDITING: setItem and setCheckState fire itemChanged
    // exactly as a click does, so onRosterItemChanged returns while
    // state.filling is set (the Station Table rule).
    try {
        roster["itemChanged(QTableWidgetItem*)"].connect(function(item) {
            ExpeditionPlanner.onRosterItemChanged(item);
        });
    } catch (eChanged) {
        try {
            roster.itemChanged.connect(function(item) {
                ExpeditionPlanner.onRosterItemChanged(item);
            });
        } catch (eChanged2) {
        }
    }
    try {
        roster["cellDoubleClicked(int, int)"].connect(function(row, column) {
            ExpeditionPlanner.editPerson(row);
        });
    } catch (eDbl) {
        try {
            roster.cellDoubleClicked.connect(function(row, column) {
                ExpeditionPlanner.editPerson(row);
            });
        } catch (eDbl2) {
        }
    }
    var b = ExpeditionPlanner.buttonRow(layout, [qsTr("Add person"),
        qsTr("Edit person"), qsTr("Remove person"), qsTr("Show file")]);
    b[0].objectName = "ExpeditionPlannerPersonAdd";
    b[0].toolTip = qsTr("Enter someone new in the people directory. They " +
        "are ticked Going for this trip.");
    b[1].objectName = "ExpeditionPlannerPersonEdit";
    b[1].toolTip = qsTr("Change the selected person's details.");
    b[2].objectName = "ExpeditionPlannerPersonRemove";
    b[2].toolTip = qsTr("Delete the selected person from the people directory.");
    b[3].objectName = "ExpeditionPlannerPeopleFile";
    b[3].toolTip = qsTr("Show the folder holding people.json. Copy that " +
        "file to back up or move your directory.");
    b[0].clicked.connect(function() { ExpeditionPlanner.openPersonDialog(""); });
    b[1].clicked.connect(function() { ExpeditionPlanner.editPerson(-1); });
    b[2].clicked.connect(function() { ExpeditionPlanner.removePerson(); });
    b[3].clicked.connect(function() { ExpeditionPlanner.showPeopleFile(); });
    var status = new QLabel("");
    status.objectName = "ExpeditionPlannerPeopleStatus";
    try {
        status.wordWrap = true;
    } catch (eWrap) {
    }
    layout.addWidget(status, 0, 0);
    var include = new QCheckBox(qsTr("Include roster on the card"));
    include.objectName = "ExpeditionPlannerCalloutInclude";
    include.toolTip = qsTr("While ticked, the card needs at least one " +
        "person going. Untick for a copy that leaves your hands.");
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
        // A lookup made WHILE the dock is being built (child(), the
        // start-date accessors) would land here again with the global
        // still unset and build the dock again, forever: 0.9.194.0 hung
        // CaveCAD at startup that way ("Maximum call stack size
        // exceeded"). Refuse instead; child() turns the throw into null.
        if (ExpeditionPlanner.building === true) {
            throw new Error("ExpeditionPlanner: the dock is still being built");
        }
        ExpeditionPlanner.building = true;
        try {
            csExpeditionPlannerDock = ExpeditionPlanner.buildDock(
                RMainWindowQt.getMainWindow());
        } finally {
            ExpeditionPlanner.building = false;
        }
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
// The people directory (ROSTER section)
// ---------------------------------------------------------------------
//
// people.json (CsPeople) is the directory; the Going ticks are the
// trip's party, saved in stations.json settings.trip.party (id and name
// only) whenever a tick changes and again on Build card. Every change to
// a person goes through applyPerson / removePersonById, which save
// people.json and repaint; the popup and the buttons only call them, so
// both can be driven without clicking.

/** Read people.json into state. A damaged file leaves the directory empty and read-only. */
ExpeditionPlanner.loadPeople = function() {
    var s = ExpeditionPlanner.state;
    var got = CsPeople.load();
    s.people = got.people;
    s.peopleError = got.error;
    var editable = got.error === "";
    var names = ["ExpeditionPlannerPersonAdd", "ExpeditionPlannerPersonEdit",
        "ExpeditionPlannerPersonRemove"];
    for (var i = 0; i < names.length; i++) {
        var b = ExpeditionPlanner.child(names[i]);
        if (b !== null) {
            try {
                b.enabled = editable;
            } catch (eEn) {
            }
        }
    }
};

/** The status line under the roster: the damage first, when there is any. */
ExpeditionPlanner.peopleSay = function(text) {
    var s = ExpeditionPlanner.state;
    var label = ExpeditionPlanner.child("ExpeditionPlannerPeopleStatus");
    if (label === null) {
        return;
    }
    var parts = [];
    if (s.peopleError !== "") {
        parts.push("<span style=\"color:#c00\">" + CsPanel.escapeHtml(
            qsTr("people.json could not be read, so the directory is " +
                "read-only and will not be overwritten: %1. Fix or move " +
                "the file (Show file), then press Refresh.").arg(s.peopleError)) +
            "</span>");
    }
    if (text !== undefined && text !== null && String(text) !== "") {
        parts.push(CsPanel.escapeHtml(String(text)));
    }
    label.text = parts.join("<br>");
};

/** A Going cell: checkable, never typed in. */
ExpeditionPlanner.goingItem = function(checked) {
    var it = new QTableWidgetItem("");
    try {
        it.setFlags((it.flags() | Qt.ItemIsUserCheckable) & ~Qt.ItemIsEditable);
    } catch (eFlags) {
    }
    try {
        it.setCheckState(checked ? Qt.Checked : Qt.Unchecked);
    } catch (eCheck) {
    }
    return it;
};

/** A read-only cell, grey when `grey`, with an optional tooltip. */
ExpeditionPlanner.readOnlyItem = function(text, grey, tip) {
    var it = new QTableWidgetItem(String(text));
    try {
        it.setFlags(it.flags() & ~Qt.ItemIsEditable);
    } catch (eFlags) {
    }
    if (grey === true) {
        try {
            it.setForeground(new QBrush(new QColor("#777777")));
        } catch (eGrey) {
        }
    }
    if (tip !== undefined && tip !== null && String(tip) !== "") {
        try {
            it.setToolTip(String(tip));
        } catch (eTip) {
        }
    }
    return it;
};

/**
 * Repaint the roster: everyone in the directory, ticked when they are
 * in `party` (matched by id, then name: CsPeople.resolveParty), then the
 * party members this computer has no details for, ticked, read-only and
 * grey. Fill-guarded, so it writes nothing.
 */
ExpeditionPlanner.fillRoster = function(party) {
    var s = ExpeditionPlanner.state;
    var t = ExpeditionPlanner.child("ExpeditionPlannerCalloutRoster");
    if (t === null) {
        return;
    }
    var resolved = CsPeople.resolveParty(party, s.people);
    var going = {};
    var extras = [];
    for (var r = 0; r < resolved.length; r++) {
        if (resolved[r].known) {
            going["#" + resolved[r].id] = true;
        } else {
            extras.push({ id: resolved[r].id, name: resolved[r].name });
        }
    }
    s.filling = true;
    try {
        t.setRowCount(0);
        s.rosterRows = [];
        var row;
        for (var i = 0; i < s.people.length; i++) {
            var p = s.people[i];
            row = t.rowCount;
            t.setRowCount(row + 1);
            t.setItem(row, 0, ExpeditionPlanner.goingItem(going["#" + p.id] === true));
            t.setItem(row, 1, ExpeditionPlanner.readOnlyItem(p.name));
            t.setItem(row, 2, ExpeditionPlanner.readOnlyItem(p.role));
            t.setItem(row, 3, ExpeditionPlanner.readOnlyItem(
                p.squeeze === null ? "" : p.squeeze));
            t.setItem(row, 4, ExpeditionPlanner.readOnlyItem(
                CsPeople.skillLabels(p).join(" · "), false, p.skillsNote));
            t.setItem(row, 5, ExpeditionPlanner.readOnlyItem(p.medical));
            t.setItem(row, 6, ExpeditionPlanner.readOnlyItem(p.emergency));
            s.rosterRows.push({ id: p.id, name: p.name, known: true });
        }
        for (var x = 0; x < extras.length; x++) {
            row = t.rowCount;
            t.setRowCount(row + 1);
            t.setItem(row, 0, ExpeditionPlanner.goingItem(true));
            t.setItem(row, 1, ExpeditionPlanner.readOnlyItem(extras[x].name, true,
                qsTr("On this trip's party, but not in the people directory " +
                    "on this computer. Add person to enter their details; " +
                    "untick Going to take them off the trip.")));
            t.setItem(row, 2, ExpeditionPlanner.readOnlyItem(
                qsTr("details not on this computer"), true));
            for (var c = 3; c < ExpeditionPlanner.CALLOUT_ROSTER_HEADERS.length; c++) {
                t.setItem(row, c, ExpeditionPlanner.readOnlyItem("", true));
            }
            s.rosterRows.push({ id: extras[x].id, name: extras[x].name, known: false });
        }
    } finally {
        s.filling = false;
    }
};

/** Whether a roster row's Going box is ticked. */
ExpeditionPlanner.rowGoing = function(t, r) {
    try {
        var it = t.item(r, 0);
        return !isNull(it) && it.checkState() == Qt.Checked;
    } catch (e) {
        return false;
    }
};

/**
 * The party the Going ticks say: the directory's ticked people (id and
 * name, directory order; CsPeople.partyOf), then the ticked people this
 * computer has no details for. Without the table, what stations.json
 * held.
 */
ExpeditionPlanner.readParty = function() {
    var s = ExpeditionPlanner.state;
    var t = ExpeditionPlanner.child("ExpeditionPlannerCalloutRoster");
    if (t === null) {
        return (s.store !== null && s.store.settings.trip) ?
            (s.store.settings.trip.party || []) : [];
    }
    var ids = [];
    var extras = [];
    var n = Math.min(t.rowCount, s.rosterRows.length);
    for (var r = 0; r < n; r++) {
        if (!ExpeditionPlanner.rowGoing(t, r)) {
            continue;
        }
        if (s.rosterRows[r].known) {
            ids.push(s.rosterRows[r].id);
        } else {
            extras.push({ id: s.rosterRows[r].id, name: s.rosterRows[r].name });
        }
    }
    return CsStationStore.cleanTrip({
        party: CsPeople.partyOf(s.people, ids).concat(extras) }).party;
};

/**
 * Put the party into stations.json settings.trip.party, re-reading the
 * file first like every other write here. An unchanged party writes
 * nothing. \return "" when saved or nothing to save, else why not
 */
ExpeditionPlanner.saveParty = function(party) {
    var s = ExpeditionPlanner.state;
    var clean = CsStationStore.cleanTrip({ party: party }).party;
    var path = CsStationSidecar.sidecarPath(s.docPath);
    if (path === "") {
        return qsTr("Going not saved: save the drawing first");
    }
    var side = CsStationSidecar.readSidecar(path);
    if (side.error !== "") {
        return qsTr("Going not saved: stations.json could not be read") +
            " (" + side.error + ")";
    }
    var trip = side.store.settings.trip || CsStationStore.emptyTrip();
    if (JSON.stringify(trip.party || []) !== JSON.stringify(clean)) {
        trip.party = clean;
        side.store.settings.trip = trip;
        if (!CsStationSidecar.writeSidecar(path, side.store)) {
            return qsTr("Going not saved: could not write stations.json");
        }
    }
    if (s.store !== null) {
        if (!s.store.settings.trip) { s.store.settings.trip = CsStationStore.emptyTrip(); }
        s.store.settings.trip.party = clean;
    }
    return "";
};

/** A Going tick changed: the party is saved at once (not on fills). */
ExpeditionPlanner.onRosterItemChanged = function(item) {
    var s = ExpeditionPlanner.state;
    if (s.filling) {
        return;
    }
    try {
        if (isNull(item) || item.column() !== 0) {
            return;
        }
    } catch (eCol) {
        return;
    }
    ExpeditionPlanner.peopleSay(ExpeditionPlanner.saveParty(
        ExpeditionPlanner.readParty()));
};

/** The directory index of a person id, or -1. */
ExpeditionPlanner.personIndex = function(id) {
    var list = ExpeditionPlanner.state.people;
    for (var i = 0; id !== "" && i < list.length; i++) {
        if (list[i].id === id) {
            return i;
        }
    }
    return -1;
};

/**
 * Create or update a person from the popup's fields, save people.json
 * and repaint, keeping the Going ticks. A new person is ticked Going.
 * The dialog calls this on OK; it can also be driven directly.
 *
 * \param fields {name, role, squeeze (text), medical, emergency,
 *   skills: [ids], skillsNote}
 * \param existingId the person to update, or "" to add
 * \return "" when saved, else why not (nothing changed)
 */
ExpeditionPlanner.applyPerson = function(fields, existingId) {
    var s = ExpeditionPlanner.state;
    if (s.peopleError !== "") {
        return qsTr("people.json could not be read, so nothing was changed") +
            " (" + s.peopleError + ")";
    }
    var problems = CsPeople.validate(fields);
    if (problems.length > 0) {
        return qsTr("Needed: %1").arg(problems.join(", "));
    }
    var trim = function(v) {
        return (v === undefined || v === null ? "" : String(v)).replace(/^\s+|\s+$/g, "");
    };
    var party = ExpeditionPlanner.readParty();
    var before = JSON.parse(JSON.stringify(s.people));
    var at = ExpeditionPlanner.personIndex(existingId === undefined ||
        existingId === null ? "" : String(existingId));
    var p;
    if (at >= 0) {
        p = s.people[at];
    } else {
        p = CsPeople.blank();
        s.people.push(p);
    }
    p.name = trim(fields.name);
    p.role = trim(fields.role);
    var sq = trim(fields.squeeze);
    p.squeeze = sq === "" ? null : Number(sq);
    p.medical = trim(fields.medical);
    p.emergency = trim(fields.emergency);
    p.skills = Object.prototype.toString.call(fields.skills) === "[object Array]" ?
        fields.skills.slice(0) : [];
    p.skillsNote = trim(fields.skillsNote);
    var why = CsPeople.save(s.people);
    if (why !== "") {
        s.people = before;
        return why;
    }
    // Re-read through the codec: the table shows what the file now holds.
    s.people = CsPeople.parse(CsPeople.serialize(s.people)).people;
    if (at < 0) {
        party.push({ id: p.id, name: p.name });
    }
    ExpeditionPlanner.fillRoster(party);
    ExpeditionPlanner.peopleSay(ExpeditionPlanner.saveParty(
        ExpeditionPlanner.readParty()));
    return "";
};

/**
 * Delete a person from the directory and untick them from this trip.
 * No question asked here: removePerson asks first.
 * \return "" when done, else why not (nothing changed)
 */
ExpeditionPlanner.removePersonById = function(id) {
    var s = ExpeditionPlanner.state;
    if (s.peopleError !== "") {
        return qsTr("people.json could not be read, so nothing was changed") +
            " (" + s.peopleError + ")";
    }
    var at = ExpeditionPlanner.personIndex(String(id));
    if (at < 0) {
        return qsTr("That person is not in the people directory.");
    }
    var party = ExpeditionPlanner.readParty();
    var keep = [];
    for (var i = 0; i < party.length; i++) {
        if (party[i].id !== id) { keep.push(party[i]); }
    }
    var before = JSON.parse(JSON.stringify(s.people));
    s.people.splice(at, 1);
    var why = CsPeople.save(s.people);
    if (why !== "") {
        s.people = before;
        return why;
    }
    ExpeditionPlanner.fillRoster(keep);
    ExpeditionPlanner.peopleSay(ExpeditionPlanner.saveParty(
        ExpeditionPlanner.readParty()));
    return "";
};

/** The row a button acts on: the one given, else the selected one. */
ExpeditionPlanner.rosterRowFor = function(row) {
    var s = ExpeditionPlanner.state;
    var r = row;
    if (typeof r !== "number" || r < 0) {
        var t = ExpeditionPlanner.child("ExpeditionPlannerCalloutRoster");
        r = t === null ? -1 : ExpeditionPlanner.selectedRowOf(t);
    }
    return (r >= 0 && r < s.rosterRows.length) ? s.rosterRows[r] : null;
};

/** Edit person (the button, or a double-click on row `row`). */
ExpeditionPlanner.editPerson = function(row) {
    var s = ExpeditionPlanner.state;
    if (s.peopleError !== "") {
        ExpeditionPlanner.peopleSay("");
        return;
    }
    var entry = ExpeditionPlanner.rosterRowFor(row);
    if (entry === null) {
        ExpeditionPlanner.peopleSay(qsTr("Pick a person in the table first."));
        return;
    }
    if (!entry.known) {
        ExpeditionPlanner.peopleSay(qsTr("%1 is not in the people directory " +
            "on this computer. Add person to enter their details.").arg(entry.name));
        return;
    }
    ExpeditionPlanner.openPersonDialog(entry.id);
};

/** Remove person: asks first, default No. */
ExpeditionPlanner.removePerson = function() {
    var s = ExpeditionPlanner.state;
    if (s.peopleError !== "") {
        ExpeditionPlanner.peopleSay("");
        return;
    }
    var entry = ExpeditionPlanner.rosterRowFor(-1);
    if (entry === null) {
        ExpeditionPlanner.peopleSay(qsTr("Pick a person in the table first."));
        return;
    }
    if (!entry.known) {
        ExpeditionPlanner.peopleSay(qsTr("%1 is not in the people directory; " +
            "untick Going to take them off this trip.").arg(entry.name));
        return;
    }
    // Parented to the main window and compared to QMessageBox.Yes
    // (qcad-js-bridge-traps: never truthy-test a message box answer).
    var answer = QMessageBox.question(RMainWindowQt.getMainWindow(),
        qsTr("Remove person"),
        qsTr("Remove %1 from the people directory? This deletes their " +
            "saved details from this computer.").arg(entry.name),
        QMessageBox.Yes | QMessageBox.No, QMessageBox.No);
    if (answer !== QMessageBox.Yes) {
        return;
    }
    var why = ExpeditionPlanner.removePersonById(entry.id);
    if (why !== "") {
        ExpeditionPlanner.peopleSay(why);
    }
};

/** Show file: the folder holding people.json, in the desktop's file manager. */
ExpeditionPlanner.showPeopleFile = function() {
    var folder = CsPeople.folder();
    if (folder === "") {
        ExpeditionPlanner.peopleSay(qsTr("The per-user data folder is unknown."));
        return;
    }
    var there = false;
    try {
        there = (new QFileInfo(CsPeople.path())).exists();
    } catch (eInfo) {
    }
    ExpeditionPlanner.peopleSay(there ?
        qsTr("people.json is in %1").arg(folder) :
        qsTr("No one saved yet: people.json appears in %1 after the first " +
            "Add person.").arg(folder));
    try {
        // Same call CaveShelf.reveal ships.
        QDesktopServices.openUrl(new QUrl("file://" + folder));
    } catch (eOpen) {
    }
};

/**
 * One collapsible skills category in the person popup: a CsPanel
 * section (chevron header, never a checkbox) whose header counts the
 * ticked boxes live, e.g. "Survey (2)". Open when the person already has
 * one of its skills, shut otherwise. Never remembered between openings.
 */
ExpeditionPlanner.addSkillGroup = function(parent, layout, group, person, boxes) {
    var titleFor = function(n) {
        return group.label + (n > 0 ? " (" + n + ")" : "");
    };
    var had = CsPeople.groupCount(person, group.id);
    var first = titleFor(had);
    var shut = {};
    if (had === 0) { shut[first] = true; }
    var sec = CsPanel.section(parent, first, "", shut);
    if (sec.header !== null) {
        sec.header.objectName = "ExpeditionPlannerPersonSkillGroup_" + group.id;
    }
    sec.host.objectName = "ExpeditionPlannerPersonSkillGroup_" + group.id + "_body";
    var grid = new QGridLayout();
    var mine = [];
    var have = {};
    var list = (person !== null && Object.prototype.toString.call(person.skills) ===
        "[object Array]") ? person.skills : [];
    for (var h = 0; h < list.length; h++) { have["#" + list[h]] = true; }
    for (var i = 0; i < group.skills.length; i++) {
        var sk = group.skills[i];
        var cb = new QCheckBox(sk.label);
        cb.objectName = "ExpeditionPlannerPersonSkill_" + sk.id;
        cb.checked = have["#" + sk.id] === true;
        grid.addWidget(cb, Math.floor(i / 2), i % 2);
        mine.push(cb);
        boxes.push({ id: sk.id, box: cb });
    }
    sec.host.setLayout(grid);
    var refresh = function() {
        if (sec.header === null) {
            return;
        }
        var n = 0;
        for (var k = 0; k < mine.length; k++) {
            if (mine[k].checked === true) { n++; }
        }
        try {
            sec.header.text = CsPanel.headerText(titleFor(n), sec.open === true);
        } catch (eText) {
        }
    };
    for (var m = 0; m < mine.length; m++) {
        try {
            mine[m]["toggled(bool)"].connect(refresh);
        } catch (eTog) {
            try {
                mine[m].clicked.connect(refresh);
            } catch (eClick) {
            }
        }
    }
    // After CsPanel's own handler, which re-titles the header with the
    // count it was built with: this puts the live count back.
    if (sec.header !== null) {
        try {
            sec.header.clicked.connect(refresh);
        } catch (eHead) {
        }
    }
    layout.addWidget(sec.box, 0, 0);
};

/**
 * The Add / Edit person popup, built but not shown: openPersonDialog
 * runs it, and a probe can show() it and drive its widgets. OK checks
 * the fields (CsPeople.validate: name, medical notes and emergency
 * contact are required) and stays open naming every gap; otherwise it
 * hands them to applyPerson and closes. Cancel changes nothing.
 * \param existingId the person to edit, or "" to add one
 */
ExpeditionPlanner.buildPersonDialog = function(existingId) {
    var s = ExpeditionPlanner.state;
    var at = ExpeditionPlanner.personIndex(existingId === undefined ||
        existingId === null ? "" : String(existingId));
    var person = at >= 0 ? s.people[at] : null;
    var id = person === null ? "" : person.id;
    var dlg = new QDialog(RMainWindowQt.getMainWindow());
    dlg.objectName = "ExpeditionPlannerPersonDialog";
    dlg.windowTitle = person === null ? qsTr("Add person") : qsTr("Edit person");
    var v = new QVBoxLayout();

    var grid = CsPanel.formGrid(1);
    var field = function(row, label, required, name, value, tip, hint) {
        grid.addWidget(new QLabel(ExpeditionPlanner.labelText(label, required)), row, 0);
        var edit = new QLineEdit();
        edit.objectName = name;
        edit.text = value === null || value === undefined ? "" : String(value);
        edit.toolTip = tip;
        if (hint !== undefined) {
            try {
                edit.placeholderText = hint;
            } catch (eHint) {
            }
        }
        grid.addWidget(edit, row, 1);
        return edit;
    };
    var nameEdit = field(0, qsTr("Name"), true, "ExpeditionPlannerPersonName",
        person === null ? "" : person.name, qsTr("As the team knows them."));
    var roleEdit = field(1, qsTr("Role"), false, "ExpeditionPlannerPersonRole",
        person === null ? "" : person.role, qsTr("Optional: lead, sketch, book, " +
            "instruments..."));
    var squeezeEdit = field(2, qsTr("Squeeze limit (in)"), false,
        "ExpeditionPlannerPersonSqueeze",
        person === null || person.squeeze === null ? "" : person.squeeze,
        qsTr("Optional: the tightest squeeze they fit, in inches."));
    var medicalEdit = field(3, qsTr("Medical notes"), true,
        "ExpeditionPlannerPersonMedical", person === null ? "" : person.medical,
        qsTr("Conditions, allergies, medication. Printed on the callout card."),
        qsTr("Type None if none: a blank is not an answer"));
    var emergencyEdit = field(4, qsTr("Emergency contact"), true,
        "ExpeditionPlannerPersonEmergency", person === null ? "" : person.emergency,
        qsTr("Name and phone, in one line."));
    v.addLayout(grid, 0);

    v.addWidget(new QLabel("<b>" + CsPanel.escapeHtml(qsTr("Skills")) + "</b>"), 0, 0);
    var boxes = [];
    var groups = CsPeople.skillsByGroup();
    for (var g = 0; g < groups.length; g++) {
        try {
            ExpeditionPlanner.addSkillGroup(dlg, v, groups[g], person, boxes);
        } catch (eGroup) {
        }
    }
    var noteGrid = CsPanel.formGrid(1);
    noteGrid.addWidget(new QLabel(qsTr("Other skills / details")), 0, 0);
    var noteEdit = new QLineEdit();
    noteEdit.objectName = "ExpeditionPlannerPersonSkillNote";
    noteEdit.text = person === null ? "" : person.skillsNote;
    noteEdit.toolTip = qsTr("Anything the checklist does not cover. Printed " +
        "under their skills on the card.");
    noteGrid.addWidget(noteEdit, 0, 1);
    v.addLayout(noteGrid, 0);

    var err = new QLabel("");
    err.objectName = "ExpeditionPlannerPersonError";
    try {
        err.wordWrap = true;
    } catch (eWrap) {
    }
    v.addWidget(err, 0, 0);

    var row = new QHBoxLayout();
    row.addStretch(1);
    var ok = new QPushButton(qsTr("OK"));
    ok.objectName = "ExpeditionPlannerPersonOk";
    var cancel = new QPushButton(qsTr("Cancel"));
    cancel.objectName = "ExpeditionPlannerPersonCancel";
    try {
        ok["default"] = true;
    } catch (eDef) {
    }
    row.addWidget(cancel, 0, 0);
    row.addWidget(ok, 0, 0);
    v.addLayout(row, 0);

    // CLOSURES, NOT SLOT NAMES (SymbolPaletteEdit.askMeta): connect takes
    // a function in this build.
    ok.clicked.connect(function() {
        var skills = [];
        for (var b = 0; b < boxes.length; b++) {
            if (boxes[b].box.checked === true) { skills.push(boxes[b].id); }
        }
        var keep = [];
        var known = {};
        for (var k = 0; k < CsPeople.SKILLS.length; k++) { known["#" + CsPeople.SKILLS[k].id] = true; }
        // Ids the checklist does not know (a newer file) are kept.
        var old = person !== null ? person.skills : [];
        for (var o = 0; o < old.length; o++) {
            if (known["#" + old[o]] !== true) { keep.push(old[o]); }
        }
        var fields = { name: String(nameEdit.text), role: String(roleEdit.text),
            squeeze: String(squeezeEdit.text), medical: String(medicalEdit.text),
            emergency: String(emergencyEdit.text), skills: skills.concat(keep),
            skillsNote: String(noteEdit.text) };
        var problems = CsPeople.validate(fields);
        var why = problems.length > 0 ? qsTr("Needed: %1").arg(problems.join(", ")) :
            ExpeditionPlanner.applyPerson(fields, id);
        if (why !== "") {
            err.text = "<span style=\"color:#c00\">" + CsPanel.escapeHtml(why) + "</span>";
            return;
        }
        dlg.accept();
    });
    cancel.clicked.connect(function() { dlg.reject(); });
    dlg.setLayout(v);
    return dlg;
};

/** Add person ("" ) or Edit person (an id): the popup, modal. */
ExpeditionPlanner.openPersonDialog = function(existingId) {
    var s = ExpeditionPlanner.state;
    if (s.peopleError !== "") {
        ExpeditionPlanner.peopleSay("");
        return;
    }
    var dlg = ExpeditionPlanner.buildPersonDialog(existingId);
    dlg.exec();
    // destroy() THROWS on every QDialog in this build (SymbolPaletteEdit):
    // close it and hand it to Qt instead. The OK handler has already
    // saved whatever was accepted.
    try {
        dlg.close();
        dlg.deleteLater();
    } catch (eClose) {
    }
};

// ---------------------------------------------------------------------
// The Start date field
// ---------------------------------------------------------------------
//
// A QDateEdit built from ExpeditionPlannerDate.ui. It is never unset: it
// starts on today, or on the drawing's saved start date. These two are
// the only code that touches the widget's value.

/** Today's LOCAL date as yyyy-mm-dd. Separate so tests can stub it. */
ExpeditionPlanner.todayIso = function() {
    var d = new Date();
    var pad = function(n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
};

/** The field's date as yyyy-mm-dd, or "" when invalid or absent. */
ExpeditionPlanner.startDateText = function() {
    var w = ExpeditionPlanner.child("ExpeditionPlannerCalloutStart");
    if (w === null) {
        return "";
    }
    var text = "";
    try {
        text = String(w.property("text")).replace(/^\s+|\s+$/g, "");
    } catch (e) {
        return "";
    }
    if (!csStoreDateOk(text)) {
        return "";
    }
    return text;
};

/**
 * Write `text` (yyyy-mm-dd; anything else means today) into the QDateEdit
 * `w` itself. Takes the widget so the dock BUILD can initialise the field
 * without looking it up through the dock, which does not exist yet.
 */
ExpeditionPlanner.writeStartDate = function(w, text) {
    if (isNull(w)) {
        return;
    }
    var t = String(isNull(text) ? "" : text).replace(/^\s+|\s+$/g, "");
    try {
        w.setProperty("date", csStoreDateOk(t) ? t : ExpeditionPlanner.todayIso());
    } catch (e) {
    }
};

/** The Today button: put today's date in the field. */
ExpeditionPlanner.startDateToday = function() {
    ExpeditionPlanner.setStartDateText("");
};

/** Show `text` (yyyy-mm-dd) in the field; anything else shows today. */
ExpeditionPlanner.setStartDateText = function(text) {
    ExpeditionPlanner.writeStartDate(
        ExpeditionPlanner.child("ExpeditionPlannerCalloutStart"), text);
};

// ---------------------------------------------------------------------
// The callout card
// ---------------------------------------------------------------------

/** The form as {trip (with its party), contacts, roster (resolved), includeRoster}. */
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
        startDate: ExpeditionPlanner.startDateText(),
        weatherPlace: text("ExpeditionPlannerCalloutPlace"), days: days,
        party: ExpeditionPlanner.readParty() });
    var include = ExpeditionPlanner.child("ExpeditionPlannerCalloutInclude");
    return { trip: trip,
        contacts: CsCalloutLocal.parseContacts(CsCalloutLocal.serializeContacts({
            topName: text("ExpeditionPlannerCalloutTopName"),
            topPhone: text("ExpeditionPlannerCalloutTopPhone"),
            escalation: text("ExpeditionPlannerCalloutEscalation"),
            bufferMin: text("ExpeditionPlannerCalloutBuffer") })),
        // What the card prints: the party with the directory's details.
        roster: CsPeople.resolveParty(trip.party, ExpeditionPlanner.state.people),
        includeRoster: include === null ? true : include.checked === true };
};

/**
 * Fill the form from stations.json (trip and party), people.json (the
 * directory) and local settings (contacts). The days table connects no
 * itemChanged handler, and the roster's is fill-guarded, so filling
 * writes nothing.
 */
ExpeditionPlanner.showCalloutSettings = function() {
    var s = ExpeditionPlanner.state;
    var set = function(name, v) {
        var w = ExpeditionPlanner.child(name);
        if (w !== null) { w.text = String(v); }
    };
    var dt = ExpeditionPlanner.child("ExpeditionPlannerCalloutDays");
    if (dt === null) {
        return;
    }
    var trip = (s.store !== null && s.store.settings.trip) ?
        s.store.settings.trip : CsStationStore.emptyTrip();
    ExpeditionPlanner.setStartDateText(trip.startDate);
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
    ExpeditionPlanner.loadPeople();
    ExpeditionPlanner.fillRoster(trip.party || []);
    ExpeditionPlanner.peopleSay("");
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
