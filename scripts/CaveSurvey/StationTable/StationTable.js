// StationTable.js
//
// QCAD add-on tool: every station in the cave as one table you can
// filter, mark and navigate.
//
//   Cave Survey > Station Table   (or type "st")
//
// WHAT IT IS. A working table over the whole map: one row per station,
// badges for what kind of place it is (lead, open end, junction,
// control, loop, noted, flagged), and the team's own status and notes
// beside them, typed straight into the row. Leads are just one kind.
// Double-clicking a station goes there.
//
// NOTHING DERIVED IS STORED. Rows are computed from the survey on
// every refresh (Core/CsStationTable.js). What the team writes -- a
// status, a note, who has it -- lives in stations.json beside the
// drawing, so Google Drive carries it to the rest of the team
// (Core/CsStationStore.js).
//
// THE SIDECAR IS SHARED, SO A WRITE RE-READS IT FIRST. Somebody else's
// Drive may have delivered new marks since this panel last looked;
// saving from the copy read at open would silently throw theirs away.
// And a stations.json that will not parse is never overwritten: the
// panel says so and refuses to save until a person has looked at it.
//
// THE PLAN TAB routes a trip from the survey's first station to the
// stops picked here and back (Core/CsTripPlan.js), and writes the
// packet, trip-plan.html, beside the drawing. Pace and the team's
// packing list are stations.json `settings`, written the same safe way.
//
// WIDGETS ARE FOUND BY objectName, never stashed on objects or as
// expandos (cavecad-tab-engine-panels). The action is forceGlobal, so
// this all runs in the application engine that init() built the dock in.
//
// See docs/superpowers/specs/2026-09-28-station-table-design.md.

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

var csStationTableDock;

function StationTable(guiAction) {
    EAction.call(this, guiAction);
}

StationTable.prototype = new EAction();

StationTable.DOCK_NAME = "CaveSurveyStationTableDock";

/** Column indexes. */
StationTable.COL = { STATION: 0, KINDS: 1, TRIPS: 2, ELEV: 3, STATUS: 4,
    NOTE: 5, TEAM: 6, WHO: 7 };
StationTable.HEADERS = ["Station", "Kinds", "Trips", "Elev", "Status",
    "Note in survey", "Team notes", "Assigned"];

/** How far either side of a station a zoom frames, in feet. */
StationTable.ZOOM_FEET = 25.0;

/**
 * What the panel is currently showing. Module state -- plain JS, never
 * widget expandos. `drawnPos` is filled lazily on the first zoom after
 * a reload (one scan of the drawing), and dropped on every reload.
 */
/** Pixels for the Status column: wide enough for its dropdown. */
StationTable.STATUS_WIDTH = 120;

StationTable.state = { rows: [], shown: [], store: null, orphans: [],
    docPath: "", drawn: null, drawnPos: null, filling: false,
    loadError: "",
    // The Plan tab: the stops picked, the last plan built, and the pace
    // and packing text last PUT INTO the widgets from stations.json (so
    // a reload can tell a caver's unsaved typing from what it showed).
    planStops: [], plan: null, planShown: null,
    // Jobs run once the signal that queued them has returned (later()).
    laterJobs: [], laterTimer: null };

// ---------------------------------------------------------------------
// Reading the drawing
// ---------------------------------------------------------------------

/** The open document, or null. Resolved fresh every time. */
StationTable.document = function() {
    try {
        var doc = EAction.getDocument();
        return isNull(doc) ? null : doc;
    } catch (e) {
        return null;
    }
};

/** The open document's file path, or "" (none open, or never saved). */
StationTable.pathOf = function(doc) {
    if (doc === null) {
        return "";
    }
    try {
        var name = doc.getFileName();
        return isNull(name) ? "" : String(name);
    } catch (e) {
        return "";
    }
};

// ---------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------

/**
 * The table page: filters, the table (edited in place) and the footer,
 * as one widget. Kept separate from buildDock so a later page (the trip
 * plan) can sit beside it in a QTabWidget without this moving.
 */
StationTable.buildTablePage = function() {
    var page = new QWidget();
    var layout = new QVBoxLayout();
    layout.setContentsMargins(6, 6, 6, 6);
    layout.setSpacing(6);

    // Kind filters, any-of. None ticked means every station.
    var kindRow = new QHBoxLayout();
    for (var k = 0; k < CsStationTable.KINDS.length; k++) {
        var kind = CsStationTable.KINDS[k];
        var box = new QCheckBox(qsTr(CsStationTable.LABEL[kind]));
        box.objectName = "StationTableKind_" + kind;
        kindRow.addWidget(box, 0, 0);
        box.clicked.connect(function() { StationTable.fill(); });
    }
    kindRow.addStretch(1);
    layout.addLayout(kindRow, 0);

    // Search, status filter. Filtering is in memory over rows already
    // read, so per-keystroke refill is cheap -- nothing re-reads the
    // drawing or the sidecar here.
    var searchRow = new QHBoxLayout();
    var search = new QLineEdit();
    search.objectName = "StationTableSearch";
    try {
        search.placeholderText = qsTr("Search stations and notes");
    } catch (ePh) {
    }
    var statusFilter = new QComboBox();
    statusFilter.objectName = "StationTableStatusFilter";
    statusFilter.addItem(qsTr("Any status"));
    var statuses = CsStationStore.STATUSES;
    for (var s = 0; s < statuses.length; s++) {
        statusFilter.addItem(qsTr(statuses[s]));
    }
    searchRow.addWidget(search, 1, 0);
    searchRow.addWidget(statusFilter, 0, 0);
    layout.addLayout(searchRow, 0);
    search.textChanged.connect(function() { StationTable.fill(); });
    statusFilter.activated.connect(function() { StationTable.fill(); });

    // The table. Status, Team notes and Assigned are typed straight
    // into the row and saved as each cell is (commitCell /
    // commitStatus); every other cell is read-only, cell by cell, not by
    // switching editing off for the whole table (the CaveShelf idiom).
    var table = new QTableWidget(0, StationTable.HEADERS.length);
    table.objectName = "StationTableTable";
    table.setHorizontalHeaderLabels(StationTable.HEADERS);
    // Dim the headings of the columns that cannot be typed in, the way
    // Cave Shelf does (CsPanel.markHeadings). Status is edited through
    // its dropdown, so it counts as editable.
    CsPanel.markHeadings(table, StationTable.HEADERS,
        [false, false, false, false, true, false, true, true]);
    try {
        table.selectionBehavior = QAbstractItemView.SelectRows;
        table.selectionMode = QAbstractItemView.SingleSelection;
        table.editTriggers = StationTable.editTriggers();
    } catch (eSel) {
    }
    try {
        table.verticalHeader().visible = false;
        table.horizontalHeader().stretchLastSection = true;
    } catch (eHead) {
    }
    try {
        table.setMinimumHeight(200);
    } catch (eH) {
    }
    layout.addWidget(table, 1, 0);
    // FILLING IS NOT EDITING: setItem/setText fire itemChanged exactly
    // as typing does, so commitCell returns while state.filling is set.
    try {
        table["itemChanged(QTableWidgetItem*)"].connect(function(item) {
            StationTable.commitCell(item);
        });
    } catch (eChanged) {
        try {
            table.itemChanged.connect(function(item) {
                StationTable.commitCell(item);
            });
        } catch (eChanged2) {
        }
    }
    // A double-click on a read-only cell (the station, above all) goes
    // there; on an editable one it opens the editor instead.
    try {
        table["cellDoubleClicked(int, int)"].connect(function(row, column) {
            StationTable.onDoubleClick(row, column);
        });
    } catch (eDbl) {
        try {
            table.cellDoubleClicked.connect(function(row, column) {
                StationTable.onDoubleClick(row, column);
            });
        } catch (eDbl2) {
            table.itemDoubleClicked.connect(function() {
                StationTable.zoomToSelected();
            });
        }
    }

    // Footer. One line, deliberately: a wrapping label under a
    // stretching table is drawn clipped (qcad-js-bridge-traps).
    var footRow = new QHBoxLayout();
    var summary = new QLabel("");
    summary.objectName = "StationTableSummary";
    var refreshButton = new QPushButton(qsTr("Refresh"));
    refreshButton.objectName = "StationTableRefresh";
    refreshButton.toolTip = qsTr("Read the survey and stations.json again.");
    var exportButton = new QPushButton(qsTr("Export checklist"));
    exportButton.objectName = "StationTableExport";
    exportButton.toolTip = qsTr("Save the rows shown now as a CSV " +
        "checklist. It names no position, only elevation.");
    footRow.addWidget(summary, 1, 0);
    footRow.addWidget(refreshButton, 0, 0);
    footRow.addWidget(exportButton, 0, 0);
    layout.addLayout(footRow, 0);
    refreshButton.clicked.connect(function() { StationTable.reload(); });
    exportButton.clicked.connect(function() { StationTable.exportChecklist(); });

    page.setLayout(layout);
    return page;
};

/**
 * The trip-plan page: the stops picked from the table, pace and packing
 * (kept in stations.json settings), and the plan as text. Rows on the
 * Stations page select one at a time, so stops are gathered into a list
 * here; with the list empty, Plan trip uses the selected row.
 *
 * The stop list is a one-column QTableWidget, not a QListWidget: this
 * bridge has no constructor for QListWidget (see CaveShelf.js).
 */
StationTable.buildPlanPage = function() {
    var page = new QWidget();
    var layout = new QVBoxLayout();
    layout.setContentsMargins(6, 6, 6, 6);
    layout.setSpacing(6);

    var stopRow = new QHBoxLayout();
    var addButton = new QPushButton(qsTr("Add selected station"));
    addButton.objectName = "StationTablePlanAdd";
    addButton.toolTip = qsTr("Add the row selected on the Stations tab " +
        "to this trip's stops.");
    var removeButton = new QPushButton(qsTr("Remove"));
    removeButton.objectName = "StationTablePlanRemove";
    removeButton.toolTip = qsTr("Take the selected stop off the list.");
    var clearButton = new QPushButton(qsTr("Clear"));
    clearButton.objectName = "StationTablePlanClear";
    stopRow.addWidget(addButton, 0, 0);
    stopRow.addWidget(removeButton, 0, 0);
    stopRow.addWidget(clearButton, 0, 0);
    stopRow.addStretch(1);
    layout.addLayout(stopRow, 0);
    addButton.clicked.connect(function() { StationTable.addStop(); });
    removeButton.clicked.connect(function() { StationTable.removeStop(); });
    clearButton.clicked.connect(function() { StationTable.clearStops(); });

    var stops = new QTableWidget(0, 1);
    stops.objectName = "StationTablePlanStops";
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

    // Pace: one line, deliberately (qcad-js-bridge-traps).
    var paceRow = new QHBoxLayout();
    var paceLabel = new QLabel(qsTr("Walking pace, ft per minute:"));
    var pace = new QLineEdit();
    pace.objectName = "StationTablePace";
    try {
        pace.placeholderText = qsTr("264 (a 3 mph hike)");
    } catch (ePh) {
    }
    pace.toolTip = qsTr("Leave blank for the default, 264 ft a minute " +
        "(3 mph). Saved in stations.json for the whole team.");
    paceRow.addWidget(paceLabel, 0, 0);
    paceRow.addWidget(pace, 1, 0);
    layout.addLayout(paceRow, 0);

    var packing = new QPlainTextEdit();
    packing.objectName = "StationTablePacking";
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
    planButton.objectName = "StationTablePlanButton";
    planButton.toolTip = qsTr("Route from the survey's first station to " +
        "every stop and back. With no stops listed, plans to the row " +
        "selected on the Stations tab.");
    var packetButton = new QPushButton(qsTr("Save packet"));
    packetButton.objectName = "StationTableSavePacket";
    packetButton.toolTip = qsTr("Write trip-plan.html beside the drawing: " +
        "route sketch, directions, time and gear. No coordinates.");
    packetButton.enabled = false;
    runRow.addWidget(planButton, 0, 0);
    runRow.addWidget(packetButton, 0, 0);
    runRow.addStretch(1);
    layout.addLayout(runRow, 0);
    planButton.clicked.connect(function() { StationTable.planTrip(); });
    packetButton.clicked.connect(function() { StationTable.savePacket(); });

    var out = new QPlainTextEdit();
    out.objectName = "StationTablePlanOut";
    out.readOnly = true;
    try {
        out.setMinimumHeight(120);
    } catch (eOutH) {
    }
    layout.addWidget(out, 1, 0);

    page.setLayout(layout);
    return page;
};

StationTable.CALLOUT_DAY_HEADERS = ["Day", "Entry (HH:MM)", "Work hours", "Night (out/camp)"];
StationTable.CALLOUT_ROSTER_HEADERS = ["Name", "Role", "Squeeze limit (in)", "Medical", "Emergency contact"];

/** A labelled one-line field row; returns the QLineEdit. */
StationTable.calloutField = function(layout, label, name, tip) {
    var row = new QHBoxLayout();
    row.addWidget(new QLabel(label), 0, 0);
    var edit = new QLineEdit();
    edit.objectName = name;
    edit.toolTip = tip;
    row.addWidget(edit, 1, 0);
    layout.addLayout(row, 0);
    return edit;
};

/**
 * An editable table with fixed headers. It never connects itemChanged:
 * the form is read on Build card, so filling it by code writes nothing.
 */
StationTable.calloutTable = function(name, headers, minH, maxH) {
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
StationTable.addTableRow = function(table, cells) {
    var r = table.rowCount;
    table.setRowCount(r + 1);
    for (var c = 0; c < cells.length; c++) {
        table.setItem(r, c, new QTableWidgetItem(String(cells[c])));
    }
};

/** The selected row of a table, or -1. currentRow is a METHOD here. */
StationTable.calloutSelectedRow = function(table) {
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

StationTable.removeTableRow = function(table) {
    var r = StationTable.calloutSelectedRow(table);
    if (r >= 0 && r < table.rowCount) {
        table.removeRow(r);
    }
};

StationTable.buildCalloutPage = function() {
    var page = new QWidget();
    var layout = new QVBoxLayout();
    layout.setContentsMargins(6, 6, 6, 6);
    layout.setSpacing(6);

    StationTable.calloutField(layout, qsTr("Start date:"),
        "StationTableCalloutStart",
        qsTr("First day of the trip, YYYY-MM-DD. Saved in stations.json."));
    StationTable.calloutField(layout, qsTr("Forecast place:"),
        "StationTableCalloutPlace",
        qsTr("Optional: a nearby town. Blank uses the drawing's location " +
            "rounded to about 10 km. The exact entrance is never sent."));

    layout.addWidget(new QLabel(qsTr("Days (entry time, work hours, night):")), 0, 0);
    var days = StationTable.calloutTable("StationTableCalloutDays",
        StationTable.CALLOUT_DAY_HEADERS, 90, 150);
    layout.addWidget(days, 0, 0);
    var dayRow = new QHBoxLayout();
    var addDay = new QPushButton(qsTr("Add day"));
    var delDay = new QPushButton(qsTr("Remove day"));
    dayRow.addWidget(addDay, 0, 0);
    dayRow.addWidget(delDay, 0, 0);
    dayRow.addStretch(1);
    layout.addLayout(dayRow, 0);
    addDay.clicked.connect(function() {
        var t = StationTable.child("StationTableCalloutDays");
        StationTable.addTableRow(t, [t.rowCount + 1, "08:00", "6", "out"]);
    });
    delDay.clicked.connect(function() {
        StationTable.removeTableRow(StationTable.child("StationTableCalloutDays"));
    });

    StationTable.calloutField(layout, qsTr("Topside contact:"),
        "StationTableCalloutTopName", qsTr("Saved on this computer only."));
    StationTable.calloutField(layout, qsTr("Contact phone:"),
        "StationTableCalloutTopPhone", qsTr("Saved on this computer only."));
    StationTable.calloutField(layout, qsTr("If no word by callout:"),
        "StationTableCalloutEscalation",
        qsTr("Who to call next, with the number. Saved on this computer only."));
    StationTable.calloutField(layout, qsTr("Callout buffer, min:"),
        "StationTableCalloutBuffer",
        qsTr("Minutes after the expected exit that topside starts acting. Default 120."));

    layout.addWidget(new QLabel(qsTr("Roster (saved on this computer only):")), 0, 0);
    var roster = StationTable.calloutTable("StationTableCalloutRoster",
        StationTable.CALLOUT_ROSTER_HEADERS, 90, 170);
    layout.addWidget(roster, 0, 0);
    var rosterRow = new QHBoxLayout();
    var addP = new QPushButton(qsTr("Add person"));
    var delP = new QPushButton(qsTr("Remove person"));
    rosterRow.addWidget(addP, 0, 0);
    rosterRow.addWidget(delP, 0, 0);
    rosterRow.addStretch(1);
    layout.addLayout(rosterRow, 0);
    addP.clicked.connect(function() {
        StationTable.addTableRow(StationTable.child("StationTableCalloutRoster"),
            ["", "", "", "", ""]);
    });
    delP.clicked.connect(function() {
        StationTable.removeTableRow(StationTable.child("StationTableCalloutRoster"));
    });

    var include = new QCheckBox(qsTr("Include roster on the card"));
    include.objectName = "StationTableCalloutInclude";
    include.checked = true;
    layout.addWidget(include, 0, 0);

    var buildRow = new QHBoxLayout();
    var build = new QPushButton(qsTr("Build card"));
    build.objectName = "StationTableCalloutBuild";
    build.toolTip = qsTr("Write callout-card.html beside the drawing. Plan the " +
        "trip on the Plan tab first.");
    var status = new QLabel("");
    status.objectName = "StationTableCalloutStatus";
    buildRow.addWidget(build, 0, 0);
    buildRow.addWidget(status, 1, 0);
    layout.addLayout(buildRow, 0);
    build.clicked.connect(function() { StationTable.buildCard(); });

    page.setLayout(layout);
    return page;
};

StationTable.buildDock = function(appWin) {
    var dock = new QDockWidget(qsTr("Station Table"), appWin);
    // Without an objectName restoreState() cannot identify the dock and
    // silently forgets where it was.
    dock.objectName = StationTable.DOCK_NAME;
    var tabs = new QTabWidget();
    tabs.objectName = "StationTableTabs";
    tabs.addTab(StationTable.buildTablePage(), qsTr("Stations"));
    tabs.addTab(StationTable.buildPlanPage(), qsTr("Plan"));
    tabs.addTab(StationTable.buildCalloutPage(), qsTr("Callout"));
    dock.setWidget(tabs);
    appWin.addDockWidget(Qt.RightDockWidgetArea, dock);
    CsPanel.attachHelp(dock, "StationTable", qsTr("Station Table"));
    return dock;
};

StationTable.ensureDock = function() {
    if (isNull(csStationTableDock)) {
        csStationTableDock = StationTable.buildDock(RMainWindowQt.getMainWindow());
    }
    return csStationTableDock;
};

/** A child widget by objectName, or null. Widgets are found, never stashed. */
StationTable.child = function(name) {
    try {
        var w = StationTable.ensureDock().findChild(name);
        return isNull(w) ? null : w;
    } catch (e) {
        return null;
    }
};

/**
 * The status a combo's index stands for. Index 0 is the "any" /
 * "(unmarked)" entry, then CsStationStore.STATUSES in order -- so the
 * combo carries no item data and nothing depends on itemData/findData.
 */
StationTable.statusAt = function(index) {
    var i = Number(index);
    if (isNaN(i) || i <= 0 || i > CsStationStore.STATUSES.length) {
        return "";
    }
    return CsStationStore.STATUSES[i - 1];
};

/** The combo index for a status; 0 for "" or an unknown mark. */
StationTable.indexOfStatus = function(status) {
    var i = CsStationStore.STATUSES.indexOf(String(status || ""));
    return i < 0 ? 0 : i + 1;
};

/** The kinds currently ticked. */
StationTable.ticked = function() {
    var out = [];
    for (var k = 0; k < CsStationTable.KINDS.length; k++) {
        var box = StationTable.child("StationTableKind_" + CsStationTable.KINDS[k]);
        if (box !== null && box.checked === true) {
            out.push(CsStationTable.KINDS[k]);
        }
    }
    return out;
};

/** The rows the current filters leave, in station order. */
StationTable.visibleRows = function() {
    var search = StationTable.child("StationTableSearch");
    var statusFilter = StationTable.child("StationTableStatusFilter");
    var q = {
        kinds: StationTable.ticked(),
        text: search === null ? "" : String(search.text),
        status: statusFilter === null ? "" :
            StationTable.statusAt(statusFilter.currentIndex)
    };
    return CsStationTable.sort(CsStationTable.filter(StationTable.state.rows, q));
};

/** One row's cells, in HEADERS order. */
StationTable.cellsOf = function(row) {
    var labels = [];
    for (var k = 0; k < row.kinds.length; k++) {
        labels.push(CsStationTable.LABEL[row.kinds[k]]);
    }
    var status = CsStationTable.effectiveStatus(row);
    var suggest = CsStationTable.suggest(row);
    if (suggest !== "" && (row.status === undefined || row.status === "")) {
        status += " (looks " + suggest + ")";
    }
    var noteCell = row.noteText || "";
    if (row.link === "relink") {
        noteCell = "[note changed] " + noteCell;
    }
    // A null z stays blank: never a 0 (the elevation datum trap).
    var elev = (row.z === null || row.z === undefined || isNaN(row.z)) ? "" :
        String(Math.round(row.z * 10) / 10);
    return [row.station, labels.join(", "), (row.trips || []).join(" "),
        elev, status, noteCell, row.team || "", row.who || ""];
};

/** The columns a caver types in. Everything else is read from the survey. */
StationTable.isEditableColumn = function(column) {
    var C = StationTable.COL;
    return column === C.STATUS || column === C.TEAM || column === C.WHO;
};

/**
 * Double-click, typing, or F2 opens an editable cell. Read by name with
 * the plain numbers as a fallback: some enum names are not bound on
 * this bridge (qcad-js-bridge-traps), and an undefined in the OR would
 * silently make the table edit nothing.
 */
StationTable.editTriggers = function() {
    var dbl = QAbstractItemView.DoubleClicked;
    var key = QAbstractItemView.EditKeyPressed;
    var any = QAbstractItemView.AnyKeyPressed;
    return (typeof dbl === "number" ? dbl : 2) |
        (typeof key === "number" ? key : 8) |
        (typeof any === "number" ? any : 16);
};

/**
 * One cell as a QTableWidgetItem, editable or not. The flags are set
 * per cell, so Station, Kinds, Trips, Elev and the survey's note can
 * never be typed over.
 */
StationTable.itemFor = function(text, editable, wash) {
    var item = new QTableWidgetItem(String(text));
    try {
        var flags = item.flags();
        item.setFlags(editable === true ? (flags | Qt.ItemIsEditable) :
            (flags & ~Qt.ItemIsEditable));
    } catch (eFlags) {
    }
    // The same grey wash every read-only cell wears elsewhere in
    // CaveCAD (CsPanel.markCell), so what cannot be typed in is visible
    // at a glance. The brush is read from the palette ONCE per refill by
    // fill(), not once per cell: this table rebuilds on every keystroke
    // of the search box.
    if (editable !== true && !isNull(wash) && wash !== null) {
        try {
            item.setBackground(wash);
        } catch (eBack) {
        }
    }
    return item;
};

/** What the status combo's tooltip says for a row. */
StationTable.statusTip = function(row) {
    var tip = qsTr("This row's mark, saved to stations.json as soon as " +
        "you pick it.");
    if (row.status === undefined || row.status === "") {
        var shown = "";
        var eff = CsStationTable.effectiveStatus(row);
        var suggest = CsStationTable.suggest(row);
        if (eff !== "") {
            shown = qsTr("Unmarked, reads as \"%1\".").arg(eff);
        }
        if (suggest !== "") {
            shown += (shown === "" ? "" : " ") +
                qsTr("Looks %1: a later trip surveyed on from here.")
                    .arg(suggest);
        }
        if (shown !== "") {
            tip = shown + "\n" + tip;
        }
    }
    return tip;
};

/**
 * The Status cell's widget: a dropdown for a normal row, a Re-link
 * button for a row whose survey note changed. Index 0 is "(unmarked)",
 * index i is CsStationStore.STATUSES[i - 1] (statusAt/indexOfStatus).
 * The closures carry only the station's NAME, a plain string -- never a
 * row object or a widget -- and find the row when they fire.
 */
StationTable.statusWidget = function(row) {
    var station = String(row.station);
    if (row.link === "relink") {
        var button = new QPushButton(qsTr("Re-link"));
        button.toolTip = qsTr("The note in the survey changed. Keep this " +
            "row's marks with the new note.");
        button.clicked.connect(function() {
            StationTable.relink(station);
        });
        return button;
    }
    var combo = new QComboBox();
    combo.addItem(qsTr("(unmarked)"));
    var statuses = CsStationStore.STATUSES;
    for (var i = 0; i < statuses.length; i++) {
        combo.addItem(qsTr(statuses[i]));
    }
    combo.setCurrentIndex(StationTable.indexOfStatus(row.status));
    combo.toolTip = StationTable.statusTip(row);
    // activated, not currentIndexChanged: it fires only for a caver's
    // pick, never for setCurrentIndex, so building the table saves
    // nothing (the LinetypeMaker idiom).
    combo.activated.connect(function(index) {
        StationTable.commitStatus(station, index);
    });
    return combo;
};

/**
 * Repaint the table from state.rows and the current filters, keeping
 * the selected station selected (and the current column current) when
 * it is still shown.
 */
StationTable.fill = function() {
    var table = StationTable.child("StationTableTable");
    if (table === null) {
        return;
    }
    var s = StationTable.state;
    var C = StationTable.COL;
    var keep = StationTable.selectedRow();
    var keepColumn = -1;
    try {
        keepColumn = table.currentColumn();
    } catch (eCol) {
        keepColumn = -1;
    }
    var shown = StationTable.visibleRows();
    s.shown = shown;
    var wash = CsPanel.readOnlyBrush(table);
    s.filling = true;
    var reselect = -1;
    try {
        // 0 first, so the old rows' dropdowns and buttons go with them
        table.setRowCount(0);
        table.setRowCount(shown.length);
        for (var r = 0; r < shown.length; r++) {
            var row = shown[r];
            var cells = StationTable.cellsOf(row);
            var open = row.link !== "relink";
            for (var c = 0; c < cells.length; c++) {
                // Status is edited through its widget, never as text.
                var editable = open && (c === C.TEAM || c === C.WHO);
                // The widget sits ON the item, and the item's own text
                // shows through it (a marked row read "opeopen"), so the
                // Status item carries no text at all.
                table.setItem(r, c, StationTable.itemFor(
                    c === C.STATUS ? "" : cells[c], editable,
                    c === C.STATUS ? null : wash));
            }
            table.setCellWidget(r, C.STATUS, StationTable.statusWidget(row));
            if (keep !== null && row.station === keep.station) {
                reselect = r;
            }
        }
        try {
            table.resizeColumnToContents(C.STATION);
            table.resizeColumnToContents(C.KINDS);
            // A cell widget is not measured by resizeColumnToContents;
            // "(unmarked)" was clipped to "(unmarke".
            table.setColumnWidth(C.STATUS, StationTable.STATUS_WIDTH);
        } catch (eSize) {
        }
        if (reselect >= 0) {
            var done = false;
            if (typeof keepColumn === "number" && keepColumn >= 0) {
                try {
                    table.setCurrentCell(reselect, keepColumn);
                    done = true;
                } catch (eCur) {
                    done = false;
                }
            }
            if (!done) {
                table.selectRow(reselect);
            }
        }
    } finally {
        s.filling = false;
    }
    StationTable.updateSummary(shown.length);
};

StationTable.updateSummary = function(shownCount) {
    var s = StationTable.state;
    var label = StationTable.child("StationTableSummary");
    if (label === null) {
        return;
    }
    var text;
    if (s.drawn === null) {
        text = qsTr("No survey in this drawing.");
    } else {
        text = qsTr("%1 of %2 stations").arg(shownCount).arg(s.rows.length);
    }
    if (s.orphans.length > 0) {
        // Listed, never deleted: a note may come back, or a station be
        // renamed back, and the team's marks with it.
        text += "  |  " + qsTr("%1 saved marks match no station")
            .arg(s.orphans.length);
    }
    if (s.loadError !== "") {
        text += "  |  " + s.loadError;
    }
    label.text = text;
    try {
        var names = [];
        for (var i = 0; i < s.orphans.length; i++) {
            names.push(s.orphans[i].station + ": " +
                (s.orphans[i].note || "") + " [" +
                (s.orphans[i].status || "") + "]");
        }
        label.toolTip = names.join("\n");
    } catch (eTip) {
    }
};

/**
 * The selected row's data, or null. Read through the selection model --
 * the idiom LinetypeMaker already ships -- with currentRow() (a METHOD
 * here) as the fallback.
 */
StationTable.selectedRow = function() {
    var table = StationTable.child("StationTableTable");
    var shown = StationTable.state.shown || [];
    if (table === null) {
        return null;
    }
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
    return (typeof idx === "number" && idx >= 0 && idx < shown.length) ?
        shown[idx] : null;
};

/**
 * True when the drawing on screen is still the one the table was read
 * from. The panel is one dock across every tab; switching tabs does not
 * reload it, so a save or a zoom must check before acting.
 */
StationTable.sameDrawing = function() {
    return StationTable.pathOf(StationTable.document()) ===
        StationTable.state.docPath;
};

/** The row for a station name, or null. */
StationTable.rowOf = function(station) {
    var rows = StationTable.state.rows || [];
    for (var i = 0; i < rows.length; i++) {
        if (rows[i].station === station) {
            return rows[i];
        }
    }
    return null;
};

/**
 * Run fn after the current signal has returned. A refill deletes every
 * cell widget and item, so doing one inside the combo's, the button's or
 * the item's own signal would delete the thing still emitting it. The
 * job is plain JS and resolves everything when it fires.
 */
StationTable.later = function(fn) {
    var s = StationTable.state;
    s.laterJobs.push(fn);
    try {
        if (s.laterTimer === null) {
            s.laterTimer = new QTimer();
            s.laterTimer.singleShot = true;
            s.laterTimer.timeout.connect(function() {
                StationTable.runLater();
            });
        }
        s.laterTimer.start(0);
    } catch (eTimer) {
        StationTable.runLater();
    }
};

StationTable.runLater = function() {
    var jobs = StationTable.state.laterJobs;
    StationTable.state.laterJobs = [];
    for (var i = 0; i < jobs.length; i++) {
        try {
            jobs[i]();
        } catch (e) {
            EAction.handleUserMessage("Station Table: " + e);
        }
    }
};

/**
 * Write one row's fields into stations.json, the safe way: same drawing,
 * drawing saved, file re-read first (a teammate's marks may have arrived
 * through Drive), never over a file that will not parse. Only the fields
 * passed are changed; the rest come from the file as re-read.
 *
 * A relink row is refused unless `confirmRelink` -- the Re-link button
 * is the only way its entry moves to the new note.
 *
 * \return the entry as saved ({status, team, who}), or null when
 *   nothing was written (the caver has been told why)
 */
StationTable.commitRow = function(row, fields, confirmRelink) {
    var s = StationTable.state;
    if (row === null) {
        return null;
    }
    if (row.link === "relink" && confirmRelink !== true) {
        CsTell.warn(qsTr("Station Table: this row's note changed since its " +
            "marks were saved. Press Re-link to keep them with the new note."));
        return null;
    }
    if (!StationTable.sameDrawing()) {
        StationTable.later(function() { StationTable.reload(); });
        CsTell.warn(qsTr("Station Table: the drawing changed under the " +
            "table, so it has been read again and nothing was saved. " +
            "Make the change once more."));
        return null;
    }
    var path = CsStationSidecar.sidecarPath(s.docPath);
    if (path === "") {
        CsTell.warn(qsTr("Station Table: save the drawing first. The team " +
            "marks are stored beside it in stations.json."));
        return null;
    }
    var side = CsStationSidecar.readSidecar(path);
    if (side.error !== "") {
        s.loadError = side.error;
        StationTable.updateSummary((s.shown || []).length);
        CsTell.warn(qsTr("Station Table: stations.json beside the drawing " +
            "could not be read, so nothing was saved -- saving now would " +
            "replace everyone's marks. Look at the file first.") +
            "\n\n" + side.error);
        return null;
    }
    CsStationStore.setEntry(side.store, row, fields);
    if (!CsStationSidecar.writeSidecar(path, side.store)) {
        CsTell.warn(qsTr("Station Table: could not write stations.json " +
            "beside the drawing."));
        return null;
    }
    s.store = side.store;
    var key = CsStationStore.keyOf(row.station, row.keyText);
    var saved = { status: "", team: "", who: "" };
    var found = false;
    for (var i = 0; i < side.store.entries.length; i++) {
        var e = side.store.entries[i];
        if (CsStationStore.keyOf(e.station, e.note) === key) {
            saved = { status: e.status || "", team: e.team || "",
                who: e.who || "" };
            found = true;
        }
    }
    // The row now shows what the file holds for it, a teammate's other
    // fields included.
    row.status = saved.status;
    row.team = saved.team;
    row.who = saved.who;
    if (row.link !== "relink") {
        row.link = found ? "ok" : "";
    }
    return saved;
};

/** The shown table row index for a station, or -1. */
StationTable.shownIndex = function(station) {
    var shown = StationTable.state.shown || [];
    for (var i = 0; i < shown.length; i++) {
        if (shown[i].station === station) {
            return i;
        }
    }
    return -1;
};

/**
 * Put a row's Team notes and Assigned text back into its cells without
 * the change being taken for typing, and the status widget's pick.
 */
StationTable.showRowMarks = function(row) {
    var table = StationTable.child("StationTableTable");
    var r = StationTable.shownIndex(row.station);
    if (table === null || r < 0) {
        return;
    }
    var C = StationTable.COL;
    var s = StationTable.state;
    var was = s.filling;
    s.filling = true;
    try {
        var cells = StationTable.cellsOf(row);
        var cols = [C.STATUS, C.TEAM, C.WHO];
        for (var k = 0; k < cols.length; k++) {
            var item = table.item(r, cols[k]);
            if (!isNull(item) && String(item.text()) !== String(cells[cols[k]])) {
                item.setText(String(cells[cols[k]]));
            }
        }
        var combo = table.cellWidget(r, C.STATUS);
        if (!isNull(combo) && row.link !== "relink") {
            try {
                if (combo.currentIndex !== StationTable.indexOfStatus(row.status)) {
                    combo.setCurrentIndex(StationTable.indexOfStatus(row.status));
                }
                combo.toolTip = StationTable.statusTip(row);
            } catch (eCombo) {
            }
        }
    } finally {
        s.filling = was;
    }
};

/**
 * True when a status filter is picked, so a status just changed may
 * take its row out of the table. (A text edit is left shown even when
 * the search no longer matches it: the row stays under the caver's
 * hands until the filters next change.)
 */
StationTable.statusFilterActive = function() {
    var statusFilter = StationTable.child("StationTableStatusFilter");
    return statusFilter !== null && Number(statusFilter.currentIndex) > 0;
};

/**
 * A Team notes or Assigned cell was typed in: save it. The table is not
 * rebuilt -- the caver's place and focus stay where they are.
 */
StationTable.commitCell = function(item) {
    var s = StationTable.state;
    if (s.filling || isNull(item)) {
        return;
    }
    var r = -1, c = -1, typed = "";
    try {
        r = item.row();
        c = item.column();
        typed = String(item.text());
    } catch (eAt) {
        return;
    }
    var C = StationTable.COL;
    var field = c === C.TEAM ? "team" : (c === C.WHO ? "who" : "");
    var shown = s.shown || [];
    if (field === "" || r < 0 || r >= shown.length) {
        return;
    }
    var row = shown[r];
    if (String(row[field] || "") === typed) {
        return;
    }
    var fields = {};
    fields[field] = typed;
    StationTable.commitRow(row, fields, false);
    // Saved or not, the cell shows what the row holds: the value as
    // written, or the old one when the write was refused.
    StationTable.showRowMarks(row);
    StationTable.updateSummary(shown.length);
};

/** A status was picked in a row's dropdown: save it. */
StationTable.commitStatus = function(station, index) {
    var row = StationTable.rowOf(station);
    if (row === null) {
        return;
    }
    var status = StationTable.statusAt(index);
    if (String(row.status || "") !== status) {
        StationTable.commitRow(row, { status: status }, false);
    }
    StationTable.showRowMarks(row);
    // Only a status filter can drop the row; then refill, once the
    // combo's own signal has returned.
    if (StationTable.statusFilterActive()) {
        StationTable.later(function() { StationTable.fill(); });
    } else {
        StationTable.updateSummary((StationTable.state.shown || []).length);
    }
};

/**
 * The Re-link button: pressing it IS the confirmation. The row's marks
 * are written against the survey's new note, the old entry goes, and
 * the table is read again.
 */
StationTable.relink = function(station) {
    var row = StationTable.rowOf(station);
    if (row === null || row.link !== "relink") {
        return;
    }
    var saved = StationTable.commitRow(row, { status: row.status || "",
        team: row.team || "", who: row.who || "" }, true);
    if (saved !== null) {
        StationTable.later(function() { StationTable.reload(); });
    }
};

/**
 * Where each station is DRAWN, by name: the tagged station points
 * themselves, so the zoom lands where the caver sees the station even
 * after a warp or a re-anchor. Computed once per reload, on demand.
 */
StationTable.drawnPositions = function(doc) {
    var s = StationTable.state;
    if (s.drawnPos !== null) {
        return s.drawnPos;
    }
    var out = {};
    try {
        var found = CsTags.collectStations(doc);
        for (var i = 0; i < found.length; i++) {
            if (out[found[i].name] === undefined && !isNull(found[i].pos)) {
                out[found[i].name] = { x: found[i].pos.x, y: found[i].pos.y };
            }
        }
    } catch (e) {
        out = {};
    }
    s.drawnPos = out;
    return out;
};

/**
 * A double-click: on a read-only cell it goes to that row's station; an
 * editable cell's double-click is the caver opening its editor.
 */
StationTable.onDoubleClick = function(r, column) {
    if (StationTable.isEditableColumn(column)) {
        return;
    }
    var shown = StationTable.state.shown || [];
    if (typeof r === "number" && r >= 0 && r < shown.length) {
        StationTable.zoomTo(shown[r]);
    }
};

/** Frame the drawing on the selected station. */
StationTable.zoomToSelected = function() {
    StationTable.zoomTo(StationTable.selectedRow());
};

/** Frame the drawing on one row's station. */
StationTable.zoomTo = function(row) {
    if (row === null || row === undefined) {
        return;
    }
    if (!StationTable.sameDrawing()) {
        StationTable.reload();
        return;
    }
    var doc = StationTable.document();
    var di = null;
    try {
        di = EAction.getDocumentInterface();
    } catch (eDi) {
        di = null;
    }
    if (doc === null || isNull(di)) {
        return;
    }
    var at = StationTable.drawnPositions(doc)[row.station];
    if (at === undefined) {
        // Not drawn as a point: fall back to where the solve puts it.
        var d = StationTable.state.drawn;
        if (d !== null && !isNull(d.resolved) && !isNull(d.resolved.stations) &&
                !isNull(d.resolved.stations[row.station])) {
            at = d.resolved.stations[row.station];
        }
    }
    if (at === undefined || isNull(at)) {
        return;
    }
    try {
        // In DRAWING units: a metric cave's reach is metres (CheckMap).
        var reach = StationTable.ZOOM_FEET;
        try {
            reach = StationTable.ZOOM_FEET * CsShapeLine.perFoot(doc);
        } catch (eUnit) {
            reach = StationTable.ZOOM_FEET;
        }
        di.zoomTo(new RBox(new RVector(at.x - reach, at.y - reach),
            new RVector(at.x + reach, at.y + reach)));
    } catch (e) {
        EAction.handleUserMessage("Station Table: could not zoom (" + e + ").");
    }
};

/** Save the currently shown rows as a CSV checklist. */
StationTable.exportChecklist = function() {
    var s = StationTable.state;
    var folder = CsCave.folderOf(String(s.docPath));
    var start = (folder === null ? "" : folder + "/") + "checklist.csv";
    var path = CsFiles.saveFile(RMainWindowQt.getMainWindow(),
        qsTr("Export checklist"), start, "CSV (*.csv)");
    if (isNull(path) || String(path) === "") {
        return;
    }
    path = String(path);
    try {
        var file = new QFile(path);
        if (!file.open(QIODevice.WriteOnly | QIODevice.Truncate |
                QIODevice.Text)) {
            CsTell.warn(qsTr("Station Table: could not write the checklist."));
            return;
        }
        var stream = new QTextStream(file);
        try {
            stream.setEncoding(QStringConverter.Utf8);
        } catch (eEnc) {
        }
        stream.writeString(CsStationTable.checklistCsv(StationTable.visibleRows()));
        stream.flush();
        file.close();
    } catch (e) {
        CsTell.warn(qsTr("Station Table: could not write the checklist.") +
            " (" + e + ")");
    }
};

// ---------------------------------------------------------------------
// The Plan tab
// ---------------------------------------------------------------------

/**
 * The same-drawing guard for the Plan tab. The one dock serves every
 * tab, so a stop picked on one cave must never be routed on another.
 * \return true when it is safe to act
 */
StationTable.planGuard = function() {
    if (StationTable.sameDrawing()) {
        return true;
    }
    StationTable.reload();
    CsTell.warn(qsTr("Station Table: the drawing changed under the " +
        "table, so it has been read again and the trip's stops cleared. " +
        "Pick them again."));
    return false;
};

/** Repaint the stop list from state.planStops. */
StationTable.fillStops = function() {
    var list = StationTable.child("StationTablePlanStops");
    if (list === null) {
        return;
    }
    var stops = StationTable.state.planStops;
    list.setRowCount(0);
    list.setRowCount(stops.length);
    for (var i = 0; i < stops.length; i++) {
        list.setItem(i, 0, new QTableWidgetItem(String(stops[i])));
    }
};

/** Add the Stations tab's selected row to the stops. */
StationTable.addStop = function() {
    if (!StationTable.planGuard()) {
        return;
    }
    var row = StationTable.selectedRow();
    if (row === null) {
        CsTell.warn(qsTr("Station Table: select a row on the Stations tab " +
            "first, then add it here."));
        return;
    }
    var stops = StationTable.state.planStops;
    if (stops.indexOf(row.station) < 0) {
        stops.push(row.station);
    }
    StationTable.fillStops();
};

/** Take the selected stop off the list. */
StationTable.removeStop = function() {
    var list = StationTable.child("StationTablePlanStops");
    if (list === null) {
        return;
    }
    var idx = -1;
    try {
        var sel = list.selectionModel().selectedRows();
        if (sel.length > 0) {
            idx = sel[0].row();
        }
    } catch (eSel) {
        idx = -1;
    }
    if (idx < 0) {
        try {
            idx = list.currentRow();
        } catch (eCur) {
            idx = -1;
        }
    }
    var stops = StationTable.state.planStops;
    if (typeof idx === "number" && idx >= 0 && idx < stops.length) {
        stops.splice(idx, 1);
        StationTable.fillStops();
    }
};

StationTable.clearStops = function() {
    StationTable.state.planStops = [];
    StationTable.fillStops();
};

/**
 * The pace field read: null when blank (the default applies), a number
 * of ft/min when valid, NaN when it cannot be used.
 */
StationTable.paceTyped = function() {
    var edit = StationTable.child("StationTablePace");
    var text = edit === null ? "" : String(edit.text).replace(/^\s+|\s+$/g, "");
    if (text === "") {
        return null;
    }
    var v = Number(text);
    return (isFinite(v) && v > 0) ? v : NaN;
};

StationTable.packingTyped = function() {
    var edit = StationTable.child("StationTablePacking");
    return edit === null ? "" : String(edit.toPlainText());
};

/**
 * The stored pace block with the typed pace laid over it. Other keys a
 * team set by hand in stations.json (descent rate, rig time...) are
 * kept: the panel only owns paceFtPerMin.
 */
StationTable.paceBlock = function(stored, typed) {
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
StationTable.savePlanSettings = function(pace, packing) {
    var s = StationTable.state;
    var path = CsStationSidecar.sidecarPath(s.docPath);
    if (path === "") {
        return qsTr("pace and packing not saved: save the drawing first");
    }
    var side = CsStationSidecar.readSidecar(path);
    if (side.error !== "") {
        s.loadError = side.error;
        StationTable.updateSummary((s.shown || []).length);
        return qsTr("pace and packing not saved: stations.json could not " +
            "be read") + " (" + side.error + ")";
    }
    var st = side.store.settings;
    var block = StationTable.paceBlock(st.pace, pace);
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
StationTable.showPlanSettings = function(force) {
    var s = StationTable.state;
    var paceEdit = StationTable.child("StationTablePace");
    var packEdit = StationTable.child("StationTablePacking");
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
StationTable.unitOf = function(survey) {
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

/** The plan as the text the tab shows. */
StationTable.planText = function(p, paceUsed) {
    var unit = p.unit;
    var len = function(v) { return String(Math.round(v)) + " " + unit; };
    var lines = [];
    lines.push(qsTr("From %1, %2 stop(s), walking %3 ft/min.")
        .arg(p.start).arg(p.stops.length).arg(paceUsed));
    for (var w = 0; w < p.warnings.length; w++) {
        lines.push("WARNING: " + p.warnings[w]);
    }
    for (var i = 0; i < p.stops.length; i++) {
        lines.push("");
        lines.push("To " + p.stops[i].station + "  (" +
            CsTripPlan.clock(p.stops[i].minutesIn) + ")");
        for (var k = 0; k < p.stops[i].steps.length; k++) {
            lines.push("  " + p.stops[i].steps[k].text);
        }
    }
    if (p.stops.length > 0) {
        lines.push("");
        lines.push("Back to " + p.start + "  (" +
            CsTripPlan.clock(p.back.minutes) + ")");
        for (var b = 0; b < p.back.steps.length; b++) {
            lines.push("  " + p.back.steps[b].text);
        }
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
 * Build the plan from the stop list (or, with it empty, the selected
 * row) and show it. Saves pace and packing to stations.json first.
 * \return the plan, or null when nothing was planned
 */
StationTable.planTrip = function() {
    var s = StationTable.state;
    var out = StationTable.child("StationTablePlanOut");
    var packetButton = StationTable.child("StationTableSavePacket");
    if (!StationTable.planGuard()) {
        return null;
    }
    var d = s.drawn;
    if (d === null) {
        CsTell.warn(qsTr("Station Table: this drawing holds no survey to plan on."));
        return null;
    }
    var targets = s.planStops.slice(0);
    if (targets.length === 0) {
        var row = StationTable.selectedRow();
        if (row !== null) {
            targets = [row.station];
        }
    }
    if (targets.length === 0) {
        CsTell.warn(qsTr("Station Table: add stops to the trip, or select " +
            "a row on the Stations tab, first."));
        return null;
    }
    var pace = StationTable.paceTyped();
    if (pace !== null && isNaN(pace)) {
        CsTell.warn(qsTr("Station Table: the walking pace must be a number " +
            "of feet per minute above 0, or blank for the default 264."));
        return null;
    }
    var packing = StationTable.packingTyped();
    var why = StationTable.savePlanSettings(pace, packing);
    var config = StationTable.paceBlock(
        s.store === null ? {} : s.store.settings.pace, pace);
    s.plan = CsTripPlan.build(d.survey, d.resolved, { targets: targets,
        unit: StationTable.unitOf(d.survey), config: config,
        packing: packing });
    var text = StationTable.planText(s.plan,
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
StationTable.today = function() {
    var d = new Date();
    var two = function(n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate());
};

/** The form as {trip, contacts, roster, includeRoster}. */
StationTable.readCalloutForm = function() {
    var text = function(name) {
        var w = StationTable.child(name);
        return w === null ? "" : String(w.text);
    };
    var cell = function(t, r, c) {
        var it = t.item(r, c);
        return isNull(it) ? "" : String(it.text());
    };
    var days = [];
    var dt = StationTable.child("StationTableCalloutDays");
    for (var r = 0; dt !== null && r < dt.rowCount; r++) {
        days.push({ entry: cell(dt, r, 1), workHours: parseFloat(cell(dt, r, 2)),
            night: cell(dt, r, 3) });
    }
    var trip = CsStationStore.cleanTrip({ startDate: text("StationTableCalloutStart"),
        weatherPlace: text("StationTableCalloutPlace"), days: days });
    var rt = StationTable.child("StationTableCalloutRoster");
    var roster = [];
    for (var p = 0; rt !== null && p < rt.rowCount; p++) {
        roster.push({ name: cell(rt, p, 0), role: cell(rt, p, 1),
            squeeze: cell(rt, p, 2), medical: cell(rt, p, 3),
            emergency: cell(rt, p, 4) });
    }
    var include = StationTable.child("StationTableCalloutInclude");
    return { trip: trip,
        contacts: CsCalloutLocal.parseContacts(CsCalloutLocal.serializeContacts({
            topName: text("StationTableCalloutTopName"),
            topPhone: text("StationTableCalloutTopPhone"),
            escalation: text("StationTableCalloutEscalation"),
            bufferMin: text("StationTableCalloutBuffer") })),
        roster: CsCalloutLocal.parseRoster(CsCalloutLocal.serializeRoster(roster)),
        includeRoster: include === null ? true : include.checked === true };
};

/**
 * Fill the form from stations.json (trip) and local settings (people).
 * The Callout tables connect no itemChanged handler, so filling writes
 * nothing.
 */
StationTable.showCalloutSettings = function() {
    var s = StationTable.state;
    var set = function(name, v) {
        var w = StationTable.child(name);
        if (w !== null) { w.text = String(v); }
    };
    var dt = StationTable.child("StationTableCalloutDays");
    var rt = StationTable.child("StationTableCalloutRoster");
    if (dt === null || rt === null) {
        return;
    }
    var trip = (s.store !== null && s.store.settings.trip) ?
        s.store.settings.trip : CsStationStore.emptyTrip();
    set("StationTableCalloutStart", trip.startDate);
    set("StationTableCalloutPlace", trip.weatherPlace);
    dt.setRowCount(0);
    for (var i = 0; i < trip.days.length; i++) {
        StationTable.addTableRow(dt, [i + 1, trip.days[i].entry,
            trip.days[i].workHours, trip.days[i].night]);
    }
    var c = CsCalloutLocal.loadContacts();
    set("StationTableCalloutTopName", c.topName);
    set("StationTableCalloutTopPhone", c.topPhone);
    set("StationTableCalloutEscalation", c.escalation);
    set("StationTableCalloutBuffer", c.bufferMin);
    rt.setRowCount(0);
    var people = CsCalloutLocal.loadRoster();
    for (var p = 0; p < people.length; p++) {
        StationTable.addTableRow(rt, [people[p].name, people[p].role,
            people[p].squeeze === null ? "" : people[p].squeeze,
            people[p].medical, people[p].emergency]);
    }
};

/**
 * Put the trip into stations.json settings (re-reading the file first,
 * like savePlanSettings). \return "" when saved, else why not.
 */
StationTable.saveTrip = function(trip) {
    var s = StationTable.state;
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

StationTable.calloutSay = function(text) {
    var label = StationTable.child("StationTableCalloutStatus");
    if (label !== null) { label.text = text; }
};

/** Write callout-card.html beside the drawing. \return the path or "" */
StationTable.buildCard = function() {
    var s = StationTable.state;
    if (!StationTable.planGuard()) { return ""; }
    if (s.docPath === "" || CsCave.folderOf(s.docPath) === null) {
        StationTable.calloutSay(qsTr("Save the drawing first."));
        return "";
    }
    var form = StationTable.readCalloutForm();
    var plan = StationTable.planTrip();
    var need = CsCalloutCard.missing(form.trip, plan);
    if (need !== "") {
        StationTable.calloutSay(qsTr("Missing: %1").arg(need));
        return "";
    }
    var problems = [];
    var why = StationTable.saveTrip(form.trip);
    if (why !== "") { problems.push(why); }
    if (!CsCalloutLocal.saveRoster(form.roster)) { problems.push(qsTr("roster not saved")); }
    if (!CsCalloutLocal.saveContacts(form.contacts)) { problems.push(qsTr("contacts not saved")); }

    var anchor = null;
    try {
        var rec = CsLocationPick.anchorRecord(StationTable.document());
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
        generated: StationTable.today() });
    var path = CsCave.folderOf(s.docPath) + "/callout-card.html";
    if (!CsStationSidecar.writeText(path, html)) {
        StationTable.calloutSay(qsTr("Could not write callout-card.html beside the drawing."));
        return "";
    }
    StationTable.calloutSay(qsTr("Saved callout-card.html") +
        (problems.length > 0 ? " (" + problems.join("; ") + ")" : ""));
    try {
        // Same call CaveShelf.reveal ships.
        QDesktopServices.openUrl(new QUrl("file://" + path));
    } catch (eOpen) {
    }
    return path;
};

/**
 * Write trip-plan.html beside the drawing. Re-plans first, so the packet
 * is always what the tab shows for the stops, pace and packing now.
 * \return the path written, or ""
 */
StationTable.savePacket = function() {
    var s = StationTable.state;
    if (!StationTable.planGuard()) {
        return "";
    }
    if (s.docPath === "" || CsCave.folderOf(s.docPath) === null) {
        CsTell.warn(qsTr("Station Table: save the drawing first. The " +
            "packet is written beside it."));
        return "";
    }
    var plan = StationTable.planTrip();
    if (plan === null || plan.stops.length === 0) {
        return "";
    }
    var html = CsTripPlan.packetHtml(plan, {
        title: CsCave.nameOf(s.docPath) || qsTr("Cave"),
        survey: s.drawn.survey, resolved: s.drawn.resolved,
        date: StationTable.today() });
    var path = CsCave.folderOf(s.docPath) + "/trip-plan.html";
    if (!CsStationSidecar.writeText(path, html)) {
        CsTell.warn(qsTr("Station Table: could not write trip-plan.html " +
            "beside the drawing."));
        return "";
    }
    var out = StationTable.child("StationTablePlanOut");
    if (out !== null) {
        out.setPlainText(String(out.toPlainText()) + "\n\n" +
            qsTr("Packet saved: %1").arg(path));
    }
    try {
        EAction.handleUserMessage(qsTr("Station Table: packet saved as %1")
            .arg(path));
    } catch (eMsg) {
    }
    return path;
};

/** Forget the Plan tab's stops and plan (the drawing changed). */
StationTable.resetPlan = function() {
    var s = StationTable.state;
    s.planStops = [];
    s.plan = null;
    s.planShown = null;
    StationTable.fillStops();
    var out = StationTable.child("StationTablePlanOut");
    if (out !== null) {
        out.setPlainText("");
    }
    var packetButton = StationTable.child("StationTableSavePacket");
    if (packetButton !== null) {
        packetButton.enabled = false;
    }
};

/** Re-read the drawing and the sidecar, then repaint. */
StationTable.reload = function() {
    var s = StationTable.state;
    var doc = StationTable.document();
    var before = s.docPath;
    s.docPath = StationTable.pathOf(doc);
    s.drawnPos = null;
    // Another drawing: its stops, plan and pace belong to the old one.
    var changed = s.docPath !== before;
    if (changed) {
        StationTable.resetPlan();
    }
    var drawn = null;
    try {
        drawn = CsStationSidecar.readDrawing(doc);
    } catch (eRead) {
        drawn = null;
        CsTell.warn("Station Table: could not read the survey (" + eRead + ").");
    }
    s.drawn = drawn;
    var side = CsStationSidecar.readSidecar(CsStationSidecar.sidecarPath(s.docPath));
    s.store = side.store;
    s.loadError = side.error;
    StationTable.showPlanSettings(changed);
    if (changed) {
        StationTable.showCalloutSettings();
    }
    if (drawn === null) {
        s.rows = [];
        s.orphans = [];
        StationTable.fill();
        return;
    }
    var findings = [];
    try {
        findings = CsValidate.check(drawn.survey, drawn.resolved);
    } catch (eCheck) {
        // Flagged rows need it; the rest of the table does not.
        findings = [];
    }
    var rows = CsStationTable.rows(drawn.survey, drawn.resolved,
        { findings: findings });
    var rec = CsStationStore.reconcile(rows, s.store);
    s.rows = rec.rows;
    s.orphans = rec.orphans;
    StationTable.fill();
};

StationTable.open = function() {
    var dock = StationTable.ensureDock();
    dock.visible = true;
    try {
        dock.raise();
    } catch (eRaise) {
    }
    StationTable.reload();
};

StationTable.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    try {
        StationTable.open();
    } catch (e) {
        csStationTableDock = undefined;
        CsTell.warn("Station Table: this CaveCAD build refused the docked " +
            "panel (" + e + ") -- please report this.");
    }
    this.terminate();
};

StationTable.init = function(basePath) {
    StationTable.basePath = basePath;

    var action = new RGuiAction(qsTr("Station Table"),
        RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    // A requiresDocument action runs in the ACTIVE TAB'S own script
    // engine, where dock globals start empty; forceGlobal makes every
    // tab share the one dock (qcad-plugin-conventions).
    action.setForceGlobal(true);
    action.setScriptFile(basePath + "/StationTable.js");
    action.setIcon(basePath + "/StationTable.svg");
    action.setStatusTip(qsTr("Every station in the cave: filter to leads " +
        "and open ends, mark them, and jump to them on the map"));
    action.setDefaultCommands(["stationtable", "st"]);
    action.setGroupSortOrder(451);
    action.setSortOrder(12);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);

    // Built during init like the other docks: the main window's
    // restoreState() runs after this and can only place a dock that
    // already exists. Hidden until the menu entry shows it.
    try {
        var dock = StationTable.ensureDock();
        dock.visible = false;
    } catch (eInit) {
        csStationTableDock = undefined;
        warning("Station Table: could not build the panel at startup (" +
            eInit + "); the menu entry will try again.");
    }
};
