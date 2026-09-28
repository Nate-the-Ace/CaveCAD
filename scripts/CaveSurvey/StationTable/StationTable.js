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
// beside them. Leads are just one kind. Double-clicking a row goes there.
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
StationTable.state = { rows: [], shown: [], store: null, orphans: [],
    docPath: "", drawn: null, drawnPos: null, filling: false,
    loadError: "" };

// ---------------------------------------------------------------------
// Reading the drawing
// ---------------------------------------------------------------------

/**
 * The whole cave as the drawing carries it, resolved the way the drawing
 * was solved (anchor, datum and adjustment as recorded), so elevations
 * agree with the map. CsRevise.resolveAsDrawn is that recipe, shared.
 *
 * \return {survey, resolved} or null when the drawing holds no survey
 */
StationTable.readDrawing = function(doc) {
    if (isNull(doc)) {
        return null;
    }
    var drawn = CsRevise.resolveAsDrawn(doc);
    if (drawn === null || drawn === undefined || isNull(drawn.survey)) {
        return null;
    }
    return drawn;
};

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
// The sidecar file
// ---------------------------------------------------------------------

/** Absolute path of stations.json beside the drawing, or "" when unsaved. */
StationTable.sidecarPath = function(docPath) {
    var folder = CsCave.folderOf(String(docPath === undefined ||
        docPath === null ? "" : docPath));
    return folder === null ? "" : folder + "/" + CsStationStore.FILE;
};

/** \return {store, error} -- never throws */
StationTable.readSidecar = function(path) {
    if (path === "") {
        return { store: CsStationStore.empty(), error: "" };
    }
    try {
        var file = new QFile(path);
        if (!file.exists()) {
            return { store: CsStationStore.empty(), error: "" };
        }
        if (!file.open(QIODevice.ReadOnly | QIODevice.Text)) {
            return { store: CsStationStore.empty(),
                error: qsTr("stations.json exists but could not be opened") };
        }
        var stream = new QTextStream(file);
        try {
            stream.setEncoding(QStringConverter.Utf8);
        } catch (eEnc) {
            // an older bridge reads in the locale's codec
        }
        var text = String(stream.readAll());
        file.close();
        return CsStationStore.parse(text);
    } catch (e) {
        return { store: CsStationStore.empty(),
            error: qsTr("stations.json could not be read") + " (" + e + ")" };
    }
};

/** \return true on success */
StationTable.writeSidecar = function(path, store) {
    if (path === "") {
        return false;
    }
    try {
        var file = new QFile(path);
        if (!file.open(QIODevice.WriteOnly | QIODevice.Truncate |
                QIODevice.Text)) {
            return false;
        }
        var stream = new QTextStream(file);
        try {
            stream.setEncoding(QStringConverter.Utf8);
        } catch (eEnc) {
        }
        stream.writeString(CsStationStore.serialize(store));
        stream.flush();
        file.close();
        return true;
    } catch (e) {
        return false;
    }
};

// ---------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------

/**
 * The table page: filters, the table, the editing strip and the footer,
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

    // The table.
    var table = new QTableWidget(0, StationTable.HEADERS.length);
    table.objectName = "StationTableTable";
    table.setHorizontalHeaderLabels(StationTable.HEADERS);
    try {
        table.selectionBehavior = QAbstractItemView.SelectRows;
        table.selectionMode = QAbstractItemView.SingleSelection;
        table.editTriggers = QAbstractItemView.NoEditTriggers;
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
    table.itemSelectionChanged.connect(function() {
        StationTable.onSelection();
    });
    table.itemDoubleClicked.connect(function() {
        StationTable.zoomToSelected();
    });

    // Editing strip for the selected row.
    var editRow = new QHBoxLayout();
    var statusEdit = new QComboBox();
    statusEdit.objectName = "StationTableStatusEdit";
    statusEdit.addItem(qsTr("(unmarked)"));
    for (var s2 = 0; s2 < statuses.length; s2++) {
        statusEdit.addItem(qsTr(statuses[s2]));
    }
    var whoEdit = new QLineEdit();
    whoEdit.objectName = "StationTableWho";
    var teamEdit = new QLineEdit();
    teamEdit.objectName = "StationTableTeam";
    try {
        whoEdit.placeholderText = qsTr("Assigned to");
        teamEdit.placeholderText = qsTr("Team notes (objective, what to look at)");
    } catch (ePh2) {
    }
    var saveButton = new QPushButton(qsTr("Save row"));
    saveButton.objectName = "StationTableSave";
    saveButton.toolTip = qsTr("Write this row's mark and notes to " +
        "stations.json beside the drawing.");
    var goButton = new QPushButton(qsTr("Go to"));
    goButton.objectName = "StationTableGo";
    goButton.toolTip = qsTr("Frame the drawing on this station " +
        "(or double-click the row).");
    var relinkButton = new QPushButton(qsTr("Re-link"));
    relinkButton.objectName = "StationTableRelink";
    relinkButton.toolTip = qsTr("The note in the survey changed. Keep this " +
        "row's marks with the new note.");
    editRow.addWidget(statusEdit, 0, 0);
    editRow.addWidget(whoEdit, 1, 0);
    editRow.addWidget(teamEdit, 2, 0);
    editRow.addWidget(saveButton, 0, 0);
    editRow.addWidget(relinkButton, 0, 0);
    editRow.addWidget(goButton, 0, 0);
    layout.addLayout(editRow, 0);
    saveButton.clicked.connect(function() { StationTable.saveSelected(false); });
    relinkButton.clicked.connect(function() { StationTable.saveSelected(true); });
    goButton.clicked.connect(function() { StationTable.zoomToSelected(); });

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

StationTable.buildDock = function(appWin) {
    var dock = new QDockWidget(qsTr("Station Table"), appWin);
    // Without an objectName restoreState() cannot identify the dock and
    // silently forgets where it was.
    dock.objectName = StationTable.DOCK_NAME;
    var body = StationTable.buildTablePage();
    dock.setWidget(body);
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

/**
 * Repaint the table from state.rows and the current filters, keeping
 * the selected station selected when it is still shown.
 */
StationTable.fill = function() {
    var table = StationTable.child("StationTableTable");
    if (table === null) {
        return;
    }
    var s = StationTable.state;
    var keep = StationTable.selectedRow();
    var shown = StationTable.visibleRows();
    s.shown = shown;
    s.filling = true;
    var reselect = -1;
    try {
        table.setRowCount(0);
        table.setRowCount(shown.length);
        for (var r = 0; r < shown.length; r++) {
            var cells = StationTable.cellsOf(shown[r]);
            for (var c = 0; c < cells.length; c++) {
                table.setItem(r, c, new QTableWidgetItem(String(cells[c])));
            }
            if (keep !== null && shown[r].station === keep.station) {
                reselect = r;
            }
        }
        try {
            table.resizeColumnToContents(StationTable.COL.STATION);
            table.resizeColumnToContents(StationTable.COL.KINDS);
        } catch (eSize) {
        }
        if (reselect >= 0) {
            table.selectRow(reselect);
        }
    } finally {
        s.filling = false;
    }
    StationTable.updateSummary(shown.length);
    StationTable.onSelection();
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

/** Load the selected row into the editing strip. */
StationTable.onSelection = function() {
    if (StationTable.state.filling) {
        return;
    }
    var row = StationTable.selectedRow();
    var statusEdit = StationTable.child("StationTableStatusEdit");
    var who = StationTable.child("StationTableWho");
    var team = StationTable.child("StationTableTeam");
    var relink = StationTable.child("StationTableRelink");
    var save = StationTable.child("StationTableSave");
    var go = StationTable.child("StationTableGo");
    if (statusEdit === null || who === null || team === null ||
            relink === null || save === null) {
        return;
    }
    var enabled = row !== null;
    statusEdit.enabled = enabled;
    who.enabled = enabled;
    team.enabled = enabled;
    save.enabled = enabled;
    if (go !== null) {
        go.enabled = enabled;
    }
    relink.visible = enabled && row.link === "relink";
    if (!enabled) {
        statusEdit.currentIndex = 0;
        who.text = "";
        team.text = "";
        return;
    }
    statusEdit.currentIndex = StationTable.indexOfStatus(row.status);
    who.text = row.who || "";
    team.text = row.team || "";
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

/** Write the editing strip into the sidecar for the selected row. */
StationTable.saveSelected = function(confirmRelink) {
    var row = StationTable.selectedRow();
    var s = StationTable.state;
    if (row === null) {
        return;
    }
    if (!StationTable.sameDrawing()) {
        StationTable.reload();
        CsTell.warn(qsTr("Station Table: the drawing changed under the " +
            "table, so it has been read again. Pick the row and save once more."));
        return;
    }
    var path = StationTable.sidecarPath(s.docPath);
    if (path === "") {
        CsTell.warn(qsTr("Station Table: save the drawing first. The team " +
            "marks are stored beside it in stations.json."));
        return;
    }
    if (row.link === "relink" && confirmRelink !== true) {
        // Saving a row whose note changed must not silently move the
        // old entry: say so, and leave it for the Re-link button.
        CsTell.warn(qsTr("Station Table: this row's note changed since its " +
            "marks were saved. Press Re-link to keep them with the new note."));
        return;
    }
    // Re-read: Drive may have brought a teammate's marks since the panel
    // last looked, and writing the stale copy would erase them.
    var side = StationTable.readSidecar(path);
    if (side.error !== "") {
        s.loadError = side.error;
        StationTable.updateSummary((s.shown || []).length);
        CsTell.warn(qsTr("Station Table: stations.json beside the drawing " +
            "could not be read, so nothing was saved -- saving now would " +
            "replace everyone's marks. Look at the file first.") +
            "\n\n" + side.error);
        return;
    }
    var edit = StationTable.child("StationTableStatusEdit");
    var whoEdit = StationTable.child("StationTableWho");
    var teamEdit = StationTable.child("StationTableTeam");
    var fields = {
        status: StationTable.statusAt(edit === null ? 0 : edit.currentIndex),
        who: whoEdit === null ? "" : String(whoEdit.text),
        team: teamEdit === null ? "" : String(teamEdit.text)
    };
    CsStationStore.setEntry(side.store, row, fields);
    if (!StationTable.writeSidecar(path, side.store)) {
        CsTell.warn(qsTr("Station Table: could not write stations.json " +
            "beside the drawing."));
        return;
    }
    StationTable.reload();
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

/** Frame the drawing on the selected station. */
StationTable.zoomToSelected = function() {
    var row = StationTable.selectedRow();
    if (row === null) {
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

/** Re-read the drawing and the sidecar, then repaint. */
StationTable.reload = function() {
    var s = StationTable.state;
    var doc = StationTable.document();
    s.docPath = StationTable.pathOf(doc);
    s.drawnPos = null;
    var drawn = null;
    try {
        drawn = StationTable.readDrawing(doc);
    } catch (eRead) {
        drawn = null;
        CsTell.warn("Station Table: could not read the survey (" + eRead + ").");
    }
    s.drawn = drawn;
    var side = StationTable.readSidecar(StationTable.sidecarPath(s.docPath));
    s.store = side.store;
    s.loadError = side.error;
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
