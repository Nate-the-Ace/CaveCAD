// CaveShelf.js
//
// QCAD add-on tool: the window CaveCAD opens on -- the caves this
// machine knows about, what each one's trips did, and where each trip
// stopped.
//
// WHY IT EXISTS. Starting the application used to create a document,
// and in this build every new document is poured full of the NSS
// template, so CaveCAD opened on a map of nothing, for a cave nobody
// had named, every single time. The application source now offers that
// moment to an add-on instead (see caveLauncherClaimsStart in QCAD's
// library.js): the global caveShowLauncher below answers it, and
// returning true means no document is created.
//
// THE DIALOG IS QUEUED, NEVER SHOWN FROM THE CLAIM. Startup is still
// running when the claim is answered -- the main window is up but
// add-ons are still settling -- and a modal dialog opened there blocks
// the rest of it. A zero-delay timer puts the window up on the first
// idle turn instead, by which time the application is genuinely
// running.
//
// READING A CAVE COSTS ONE FILE OPEN, and only when a cave is selected.
// The list itself is the registry (CsShelf) and needs no file at all;
// selecting a cave imports its drawing into a memory document and reads
// the survey back from the tags (CsRevise.surveyFromDocument), which is
// what makes the trip table and the frontier real rather than guessed.
// The result is cached for the session against the file's modification
// time, so clicking back and forth is free and a drawing edited outside
// the app is still re-read.
//
// NOTHING HERE WRITES TO A DRAWING. Open, and the stock file machinery
// takes over; New Trip seeds the Survey Notebook page and the notebook
// owns everything after that. The launcher's whole job is choosing.

include("scripts/EAction.js");
include("scripts/simple.js");
include("scripts/File/NewFile/NewFile.js");
include(includeBasePath + "/../Core/CsAll.js");

function CaveShelf(guiAction) {
    EAction.call(this, guiAction);
}

CaveShelf.prototype = new EAction();

// Read by the application's startup gate; also the checkbox in the
// dialog's footer.
CaveShelf.SETTING_SHOW = "Startup/ShowCaveLauncher";

// path -> {mtime, read}. Session only: a cache that outlived the
// session would have to be invalidated by something other than a
// timestamp, and there is nothing here worth that.
CaveShelf.cache = {};

CaveShelf.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    CaveShelf.show();
    this.terminate();
};

CaveShelf.init = function(basePath) {
    var action = new RGuiAction(qsTr("Caves..."), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(false);
    action.setScriptFile(basePath + "/CaveShelf.js");
    action.setIcon(basePath + "/CaveShelf.svg");
    action.setStatusTip(qsTr("The caves on this machine: their trips, and where each one stopped"));
    action.setDefaultCommands(["caveshelf", "caves"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(1); // the way in, so: first
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};

/**
 * The application's startup gate calls this when it has nothing to
 * open. Returning true means "the start is taken care of, create no
 * document".
 *
 * Global on purpose: this is the whole interface between the
 * application and the add-on, and it is deliberately one function with
 * no arguments, so a CaveCAD without this add-on installed simply finds
 * nothing and behaves the way QCAD always did.
 */
function caveShowLauncher() {
    if (typeof QTimer === "undefined") {
        return false;
    }
    var timer = new QTimer(RMainWindowQt.getMainWindow());
    timer.singleShot = true;
    timer.timeout.connect(function() {
        try {
            CaveShelf.show();
        } catch (e) {
            // The launcher failing must not leave the user staring at an
            // empty application with no way in.
            EAction.handleUserWarning("Cave shelf: " + e +
                " -- use File > New, or Cave Survey > Caves.");
        }
    });
    timer.start(0);
    return true;
}

// ---------------------------------------------------------------------
// Reading a cave
// ---------------------------------------------------------------------

/**
 * A stamp that changes whenever the file does, for the read cache.
 *
 * Modification time AND size: QDateTime.toString() ignores the format
 * string this bridge passes it, so the text is whatever Qt's default
 * is -- fine as an identity, useless as a parsed date, and the size
 * catches an edit that lands inside the same second.
 */
CaveShelf.mtimeOf = function(path) {
    try {
        var info = new QFileInfo(path);
        if (!info.exists()) { return "0"; }
        return String(info.lastModified().toString()) + ":" + info.size();
    } catch (e) {
        return "0";
    }
};

/**
 * Everything the detail pane shows about one cave, read from its
 * drawing.
 *
 * \return {
 *   ok        false when there is nothing readable
 *   error     why, when !ok -- shown to the user as written
 *   survey    the reconstructed survey
 *   trips     [{id, name, date, team, shots, ends}] in id order
 *   ends      the whole cave's open ends, newest trip first
 *   length    total leg distance, in the survey's own unit
 *   unit      "ft" / "m"
 *   legacy    true when the drawing predates tag schema v3
 * }
 */
CaveShelf.readCave = function(record) {
    var blank = { ok: false, error: "", trips: [], ends: [], length: 0,
        unit: "ft", legacy: false, survey: null };

    if (record === null || record === undefined ||
            CsShelf.clean(record.drawing) === "") {
        blank.error = "No drawing registered for this cave yet. " +
            "Add Cave... again once one is saved in the folder.";
        return blank;
    }

    var path = record.drawing;
    if (!(new QFileInfo(path)).exists()) {
        blank.error = "The drawing is missing:\n" + path;
        return blank;
    }
    if (CsShelf.extension(path) === "dwg") {
        blank.error = "This cave's drawing is a DWG. CaveCAD reads DXF -- " +
            "convert it (any CAD that writes DXF will do) and register " +
            "the cave again.";
        return blank;
    }

    var stamp = CaveShelf.mtimeOf(path);
    var cached = CaveShelf.cache[path];
    if (cached !== undefined && cached.stamp === stamp) {
        return cached.read;
    }

    var sourceDi = new RDocumentInterface(
        new RDocument(new RMemoryStorage(), createSpatialIndex()));
    var read = blank;
    try {
        if (sourceDi.importFile(path, "", false) !==
                RDocumentInterface.IoErrorNoError) {
            read = { ok: false, error: "Could not read:\n" + path,
                trips: [], ends: [], length: 0, unit: "ft", legacy: false,
                survey: null };
        }
        else {
            read = CaveShelf.summarize(
                CsRevise.surveyFromDocument(sourceDi.getDocument()));
        }
    } catch (e) {
        read = { ok: false, error: "Could not read this cave: " + e,
            trips: [], ends: [], length: 0, unit: "ft", legacy: false,
            survey: null };
    } finally {
        destr(sourceDi);
    }

    CaveShelf.cache[path] = { stamp: stamp, read: read };
    return read;
};

/** The reconstruction, arranged the way the detail pane reads it. */
CaveShelf.summarize = function(recon) {
    var survey = (recon === null || recon === undefined) ? null : recon.survey;
    if (survey === null || survey === undefined) {
        return { ok: false, error: "This drawing carries no survey data.",
            trips: [], ends: [], length: 0, unit: "ft", legacy: false,
            survey: null };
    }

    var unit = survey.distanceUnit === undefined || survey.distanceUnit === null ?
        "ft" : survey.distanceUnit;

    var length = 0;
    var counts = {};
    for (var i = 0; i < survey.shots.length; i++) {
        var shot = survey.shots[i];
        if (!CsFrontier.isLeg(shot)) { continue; }
        if (shot.excludeFromLength !== true) {
            length += (typeof shot.distance === "number") ? shot.distance : 0;
        }
        var id = (typeof shot.trip === "number") ? shot.trip : 0;
        counts[id] = (counts[id] === undefined ? 0 : counts[id]) + 1;
    }

    var ends = CsFrontier.openEnds(survey);

    var tripRecords = (Object.prototype.toString.call(survey.trips) ===
        "[object Array]") ? survey.trips : [];
    var trips = [];
    var seen = {};
    var push = function(id, record) {
        if (seen[id] === true) { return; }
        seen[id] = true;
        trips.push({
            id: id,
            name: record === null || record === undefined ? "" :
                CsShelf.clean(record.name),
            date: record === null || record === undefined ? "" :
                CsShelf.clean(record.date),
            team: record === null || record === undefined ? "" :
                CsShelf.clean(record.team),
            shots: counts[id] === undefined ? 0 : counts[id],
            ends: CsFrontier.openEndsOfTrip(survey, id)
        });
    };
    for (var t = 0; t < tripRecords.length; t++) {
        push(t, tripRecords[t]);
    }
    // A drawing with shots but no trip records (or fewer records than
    // trips) still has trips -- they are just anonymous.
    for (var key in counts) {
        if (Object.prototype.hasOwnProperty.call(counts, key)) {
            push(parseInt(key, 10), null);
        }
    }
    trips.sort(function(a, b) { return a.id - b.id; });

    return {
        ok: survey.shots.length > 0,
        error: survey.shots.length > 0 ? "" :
            "This drawing carries no survey data yet.",
        survey: survey,
        trips: trips,
        ends: ends,
        length: length,
        unit: unit,
        legacy: recon.legacy === true
    };
};

/** "4,180 ft" */
CaveShelf.formatLength = function(length, unit) {
    var rounded = Math.round(length);
    var text = String(rounded);
    var grouped = "";
    while (text.length > 3) {
        grouped = "," + text.substring(text.length - 3) + grouped;
        text = text.substring(0, text.length - 3);
    }
    return text + grouped + " " + unit;
};

/** "Trip 6 -- Upper maze", or "Trip 6" when it was never named. */
CaveShelf.tripLabel = function(trip) {
    var label = "Trip " + trip.id;
    return trip.name === "" ? label : label + " — " + trip.name;
};

/** The station a new trip would tie into, or "" when there is none. */
CaveShelf.tieInFor = function(read) {
    if (read === null || read === undefined ||
            Object.prototype.toString.call(read.ends) !== "[object Array]" ||
            read.ends.length === 0) {
        return "";
    }
    return read.ends[0].station;
};

// ---------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------

/**
 * Builds and runs the shelf.
 *
 * Everything cosmetic is wrapped: this bridge refuses the odd widget
 * property depending on the Qt build, and a launcher that throws while
 * setting a header's stretch would leave the user with no way into
 * their own caves.
 */
CaveShelf.show = function() {
    var appWin = RMainWindowQt.getMainWindow();
    var dialog = new QDialog(appWin);
    dialog.windowTitle = qsTr("Caves");
    dialog.setMinimumSize(new QSize(880, 520));

    var state = {
        records: [],     // what the list currently shows
        record: null,    // the selected cave
        read: null,      // its reconstruction
        trip: -1         // the selected trip, -1 for none
    };

    var outer = new QVBoxLayout();
    var main = new QHBoxLayout();

    // ---- left: the shelf itself --------------------------------------
    var left = new QVBoxLayout();
    var search = new QLineEdit();
    search.placeholderText = qsTr("Search caves");
    left.addWidget(search, 0, 0);

    // A one-column table, not a QListWidget: this bridge generates
    // QListWidget (and QTreeWidget) as WRAPPER-ONLY classes -- they can
    // wrap a widget C++ made, and `new QListWidget()` only warns "No
    // constructor found" and hands back an object with nothing behind
    // it, which the layout then refuses as a null widget. QTableWidget
    // is generated with a real constructor, so the shelf is a table
    // with one column and no headers.
    var list = new QTableWidget(0, 1);
    list.minimumWidth = 240;
    try {
        list.horizontalHeader().visible = false;
        list.verticalHeader().visible = false;
        list.horizontalHeader().stretchLastSection = true;
        list.selectionBehavior = QAbstractItemView.SelectRows;
        list.editTriggers = QAbstractItemView.NoEditTriggers;
    } catch (eList) {
    }
    left.addWidget(list, 1, 0);

    var leftButtons = new QHBoxLayout();
    var addButton = new QPushButton(qsTr("Add Cave..."));
    var forgetButton = new QPushButton(qsTr("Forget"));
    forgetButton.toolTip = qsTr("Removes the cave from this list. " +
        "Nothing on disk is touched.");
    leftButtons.addWidget(addButton, 1, 0);
    leftButtons.addWidget(forgetButton, 0, 0);
    left.addLayout(leftButtons, 0);
    main.addLayout(left, 0);

    // ---- right: the selected cave ------------------------------------
    var right = new QVBoxLayout();
    var title = new QLabel("");
    try {
        var titleFont = title.font;
        titleFont.setPointSize(titleFont.pointSize() + 5);
        titleFont.setBold(true);
        title.font = titleFont;
    } catch (eFont) {
    }
    right.addWidget(title, 0, 0);

    var subtitle = new QLabel("");
    subtitle.wordWrap = true;
    right.addWidget(subtitle, 0, 0);

    var table = new QTableWidget(0, 5);
    try {
        table.setHorizontalHeaderLabels(["Trip", "Date", "Team", "Shots",
            "Ends at"]);
        table.verticalHeader().visible = false;
        table.horizontalHeader().stretchLastSection = true;
        table.selectionBehavior = QAbstractItemView.SelectRows;
        table.editTriggers = QAbstractItemView.NoEditTriggers;
    } catch (eTable) {
    }
    right.addWidget(table, 1, 0);

    var frontier = new QLabel("");
    frontier.wordWrap = true;
    right.addWidget(frontier, 0, 0);
    main.addLayout(right, 1);
    outer.addLayout(main, 1);

    // ---- footer -------------------------------------------------------
    var footer = new QHBoxLayout();
    var atStartup = new QCheckBox(qsTr("Open this window at startup"));
    atStartup.checked =
        RSettings.getBoolValue(CaveShelf.SETTING_SHOW, true) === true;
    footer.addWidget(atStartup, 0, 0);
    footer.addStretch(1);

    var newCaveButton = new QPushButton(qsTr("New Cave..."));
    var openButton = new QPushButton(qsTr("Open Drawing"));
    var tripButton = new QPushButton(qsTr("New Trip"));
    var closeButton = new QPushButton(qsTr("Close"));
    try {
        openButton.default = true;
    } catch (eDefault) {
    }
    footer.addWidget(newCaveButton, 0, 0);
    footer.addWidget(openButton, 0, 0);
    footer.addWidget(tripButton, 0, 0);
    footer.addWidget(closeButton, 0, 0);
    outer.addLayout(footer, 0);

    dialog.setLayout(outer);

    // ---- filling it ---------------------------------------------------

    var fillList = function(selectFolder) {
        var needle = String(search.text).toLowerCase();
        state.records = [];
        list.setRowCount(0);
        var all = CsShelf.list();
        for (var i = 0; i < all.length; i++) {
            var record = all[i];
            if (needle !== "" &&
                    record.name.toLowerCase().indexOf(needle) === -1 &&
                    record.folder.toLowerCase().indexOf(needle) === -1) {
                continue;
            }
            state.records.push(record);
            list.setRowCount(state.records.length);
            list.setItem(state.records.length - 1, 0,
                new QTableWidgetItem(record.name));
        }
        if (state.records.length === 0) {
            return;
        }
        var at = 0;
        if (selectFolder !== undefined && selectFolder !== null) {
            var found = CsShelf.indexOfFolder(state.records, selectFolder);
            if (found !== -1) { at = found; }
        }
        list.selectRow(at);
    };

    var showDetail = function() {
        var row = list.currentRow();
        state.trip = -1;
        state.record = (row >= 0 && row < state.records.length) ?
            state.records[row] : null;

        table.setRowCount(0);

        if (state.record === null) {
            title.text = state.records.length === 0 ?
                qsTr("No caves on the shelf yet") : "";
            subtitle.text = state.records.length === 0 ?
                qsTr("Add Cave... points at a cave's folder on your drive. " +
                    "Saving a drawing inside one adds it here by itself.") : "";
            frontier.text = "";
            state.read = null;
            CaveShelf.updateButtons(state, openButton, tripButton, forgetButton);
            return;
        }

        title.text = state.record.name;
        subtitle.text = qsTr("Reading...");
        QCoreApplication.processEvents();

        var read = CaveShelf.readCave(state.record);
        state.read = read;

        var where = state.record.drawing !== "" ?
            state.record.drawing : state.record.folder;
        if (!read.ok) {
            subtitle.text = where + "\n" + read.error;
            frontier.text = "";
            CaveShelf.updateButtons(state, openButton, tripButton, forgetButton);
            return;
        }

        var pdfs = CsCave.pdfFiles(state.record.folder);
        var parts = [where,
            CaveShelf.formatLength(read.length, read.unit) + qsTr(" surveyed"),
            read.trips.length + qsTr(" trips")];
        if (pdfs.length > 0) {
            parts.push(pdfs.length + qsTr(" maps in PDF/"));
        }
        if (read.legacy) {
            parts.push(qsTr("pre-v3 tags: trips are approximate"));
        }
        subtitle.text = parts.join("  ·  ");

        table.setRowCount(read.trips.length);
        for (var t = 0; t < read.trips.length; t++) {
            var trip = read.trips[t];
            var endNames = [];
            for (var e = 0; e < trip.ends.length; e++) {
                endNames.push(trip.ends[e].station);
            }
            var cells = [
                CaveShelf.tripLabel(trip),
                trip.date,
                trip.team,
                String(trip.shots),
                endNames.length === 0 ? "—" : endNames.join(", ")
            ];
            for (var c = 0; c < cells.length; c++) {
                table.setItem(t, c, new QTableWidgetItem(cells[c]));
            }
        }
        try {
            table.resizeColumnsToContents();
        } catch (eResize) {
        }

        frontier.text = CaveShelf.frontierText(read);
        CaveShelf.updateButtons(state, openButton, tripButton, forgetButton);
    };

    // ---- wiring -------------------------------------------------------

    search.textChanged.connect(function() { fillList(); });
    list.itemSelectionChanged.connect(showDetail);

    list.itemDoubleClicked.connect(function() {
        if (CaveShelf.openRecord(state.record)) { dialog.accept(); }
    });

    table.itemSelectionChanged.connect(function() {
        state.trip = table.currentRow();
        if (state.read !== null) {
            frontier.text = CaveShelf.frontierText(state.read, state.trip);
        }
        CaveShelf.updateButtons(state, openButton, tripButton, forgetButton);
    });

    addButton.clicked.connect(function() {
        var added = CaveShelf.addCave(dialog);
        if (added !== null) { fillList(added.folder); }
    });

    forgetButton.clicked.connect(function() {
        if (state.record === null) { return; }
        var answer = QMessageBox.question(dialog, qsTr("Forget Cave"),
            qsTr("Take %1 off the shelf?\n\nThe folder and everything in " +
                "it stays exactly where it is.").arg(state.record.name),
            makeQMessageBoxStandardButtons(QMessageBox.Yes, QMessageBox.No));
        if (answer === QMessageBox.Yes) {
            CsShelf.forget(state.record.folder);
            fillList();
            showDetail();
        }
    });

    newCaveButton.clicked.connect(function() {
        var created = CaveShelf.newCave(dialog);
        if (created !== null) { dialog.accept(); }
    });

    openButton.clicked.connect(function() {
        if (CaveShelf.openRecord(state.record)) { dialog.accept(); }
    });

    tripButton.clicked.connect(function() {
        if (CaveShelf.startTrip(state)) { dialog.accept(); }
    });

    closeButton.clicked.connect(function() { dialog.reject(); });

    fillList();
    showDetail();

    dialog.exec();

    RSettings.setValue(CaveShelf.SETTING_SHOW, atStartup.checked === true);
    destrDialog(dialog);
};

/** The sentence under the trip table. */
CaveShelf.frontierText = function(read, tripRow) {
    if (read === null || !read.ok) { return ""; }

    var ends = read.ends;
    var lead = qsTr("Open ends");
    if (tripRow !== undefined && tripRow >= 0 && tripRow < read.trips.length) {
        var trip = read.trips[tripRow];
        ends = trip.ends;
        lead = qsTr("Where %1 stopped").arg(CaveShelf.tripLabel(trip));
    }

    if (ends.length === 0) {
        return lead + ": " + qsTr("none — every station is tied in.");
    }

    var parts = [];
    for (var i = 0; i < ends.length && i < 6; i++) {
        parts.push(ends[i].station + (ends[i].hasLrud ? "" :
            qsTr(" (no LRUD)")));
    }
    var text = lead + ": " + parts.join(", ");
    if (ends.length > parts.length) {
        text += qsTr(", and %1 more").arg(ends.length - parts.length);
    }
    return text;
};

/** Enables what can be done to the selected cave, and says so. */
CaveShelf.updateButtons = function(state, openButton, tripButton, forgetButton) {
    var record = state.record;
    var readable = record !== null && state.read !== null && state.read.ok;

    forgetButton.enabled = record !== null;
    openButton.enabled = record !== null && CsShelf.clean(record.drawing) !== "" &&
        CsShelf.extension(record.drawing) !== "dwg";

    var station = "";
    if (readable) {
        if (state.trip >= 0 && state.trip < state.read.trips.length &&
                state.read.trips[state.trip].ends.length > 0) {
            station = state.read.trips[state.trip].ends[0].station;
        }
        else {
            station = CaveShelf.tieInFor(state.read);
        }
    }
    state.station = station;

    tripButton.enabled = openButton.enabled && readable;
    tripButton.text = station === "" ? qsTr("New Trip") :
        qsTr("New Trip from %1").arg(station);
};

// ---------------------------------------------------------------------
// What the buttons do
// ---------------------------------------------------------------------

/** Opens a cave's drawing through the stock file machinery. */
CaveShelf.openRecord = function(record) {
    if (record === null || record === undefined) { return false; }
    var path = CsShelf.clean(record.drawing);
    if (path === "" || !(new QFileInfo(path)).exists()) { return false; }
    openFiles([path], false);
    return true;
};

/**
 * Opens the cave and starts a trip on the station the survey stopped at.
 *
 * The notebook owns the page from here: this fills in the tie-in and
 * the blank row under it, which is what a paper page looks like when a
 * trip starts, and nothing else.
 */
CaveShelf.startTrip = function(state) {
    if (!CaveShelf.openRecord(state.record)) { return false; }

    var station = state.station === undefined ? "" : state.station;
    if (typeof SurveyNotebook === "undefined") { return true; }

    try {
        var dock = SurveyNotebook.ensureDock();
        dock.visible = true;
        if (station !== "" && SurveyNotebook.startTripAt(station) === true) {
            EAction.handleUserMessage(
                qsTr("New trip tied into %1.").arg(station));
        }
    } catch (e) {
        EAction.handleUserWarning(qsTr("The cave opened, but the Survey " +
            "Notebook did not: ") + e);
    }
    return true;
};

/**
 * Registers a cave folder the user points at.
 *
 * One folder, scanned two levels deep -- see CsShelf's header for why
 * this is not a sweep of the whole drive.
 *
 * \return the record registered, or null.
 */
CaveShelf.addCave = function(parent) {
    var roots = CsCave.driveRoots();
    var start = roots.length > 0 ? roots[0] : QDir.homePath();

    var folder = QFileDialog.getExistingDirectory(parent,
        qsTr("Pick a cave's folder"), start);
    if (isNull(folder) || String(folder) === "") { return null; }
    folder = String(folder).replace(/\\/g, "/").replace(/\/+$/, "");

    var record = CsShelf.recordFor(folder);
    if (record === null) { return null; }

    if (record.drawing === "") {
        var answer = QMessageBox.question(parent, qsTr("No Drawing Found"),
            qsTr("No DXF or DWG in %1 or one folder below it.\n\n" +
                "Add it anyway? The cave will sit on the shelf until a " +
                "drawing is saved in it.").arg(record.name),
            makeQMessageBoxStandardButtons(QMessageBox.Yes, QMessageBox.No));
        if (answer !== QMessageBox.Yes) { return null; }
    }

    CsShelf.register(record);
    CaveShelf.offerProjectFolders(parent, folder);
    return record;
};

/**
 * Offers to create the folders a cave project keeps, when they are
 * missing. Asks rather than acting: this is somebody else's folder --
 * possibly a shared one -- and the group may keep sketches somewhere
 * this convention knows nothing about.
 */
CaveShelf.offerProjectFolders = function(parent, folder) {
    var missing = [];
    for (var i = 0; i < CsCave.SUBFOLDERS.length; i++) {
        if (CsCave.findSubfolder(folder, CsCave.SUBFOLDERS[i]) === null) {
            missing.push(CsCave.SUBFOLDERS[i]);
        }
    }
    if (missing.length === 0) { return; }

    var answer = QMessageBox.question(parent, qsTr("Cave Project Folders"),
        qsTr("This cave has no %1 folder. Create it?\n\n" +
            "scans/ holds the hand sketches (Draw > Image opens there); " +
            "PDF/ holds the maps you plot, and is what Package Cave " +
            "Project collects.").arg(missing.join("/ and no ")),
        makeQMessageBoxStandardButtons(QMessageBox.Yes, QMessageBox.No));
    if (answer === QMessageBox.Yes) {
        CsCave.ensureProjectFolders(folder, true);
    }
};

/**
 * Starts a cave: a folder named after it, the project folders inside,
 * a drawing on the NSS template, and a shelf entry.
 *
 * The drawing is SAVED before the user sees it, which is the point --
 * a cave that exists only as an unsaved window is a cave that has no
 * folder, no scans/, no PDF/ and no place on the shelf.
 *
 * \return the record created, or null.
 */
CaveShelf.newCave = function(parent) {
    var typed = QInputDialog.getText(parent, qsTr("New Cave"),
        qsTr("Cave name, the way people say it:"), QLineEdit.Normal, "");
    if (isNull(typed)) { return null; }
    var name = String(typed).replace(/^\s+|\s+$/g, "");
    if (name === "") { return null; }

    // A cave name is a folder name and a file name. Only the characters
    // that cannot BE either are removed -- spaces, commas and
    // apostrophes are how caves are actually named.
    var safe = name.replace(/[\/\\:*?"<>|]/g, "").replace(/^\s+|\s+$/g, "");
    if (safe === "") {
        EAction.handleUserWarning(qsTr("That name has nothing in it a " +
            "folder can be called."));
        return null;
    }

    var roots = CsCave.driveRoots();
    var start = roots.length > 0 ? roots[0] : QDir.homePath();
    var parentFolder = QFileDialog.getExistingDirectory(parent,
        qsTr("Where should %1 live?").arg(safe), start);
    if (isNull(parentFolder) || String(parentFolder) === "") { return null; }
    parentFolder = String(parentFolder).replace(/\\/g, "/").replace(/\/+$/, "");

    var folder = parentFolder + "/" + safe;
    if ((new QDir(folder)).exists()) {
        var answer = QMessageBox.question(parent, qsTr("Folder Exists"),
            qsTr("%1 already exists. Put the new drawing in it?")
                .arg(folder),
            makeQMessageBoxStandardButtons(QMessageBox.Yes, QMessageBox.No));
        if (answer !== QMessageBox.Yes) { return null; }
    }
    else if (!(new QDir()).mkpath(folder)) {
        EAction.handleUserWarning(qsTr("Could not create %1").arg(folder));
        return null;
    }

    CsCave.ensureProjectFolders(folder, true);

    var drawing = folder + "/" + safe + ".dxf";
    if ((new QFileInfo(drawing)).exists()) {
        var overwrite = QMessageBox.question(parent, qsTr("Drawing Exists"),
            qsTr("%1 already exists. Open it instead of starting a new " +
                "one?").arg(drawing),
            makeQMessageBoxStandardButtons(QMessageBox.Yes, QMessageBox.No));
        if (overwrite !== QMessageBox.Yes) { return null; }
        var existing = CsShelf.normalize({ name: name, folder: folder,
            drawing: drawing });
        CsShelf.register(existing);
        CaveShelf.openRecord(existing);
        return existing;
    }

    // The template pours itself into the new document (CaveTemplate's
    // post-new hook); the one-shot flag makes that true even on a
    // machine where somebody switched it off.
    RSettings.setValue("CaveSurvey/TemplateOnNewOnce", true);
    var newAction = RGuiAction.getByScriptFile("scripts/File/NewFile/NewFile.js");
    if (isNull(newAction)) {
        EAction.handleUserWarning(qsTr("Could not reach File > New."));
        return null;
    }
    newAction.slotTrigger();

    var saved = false;
    try {
        saved = new Save().save(drawing, "", false) !== false;
    } catch (e) {
        saved = false;
    }
    if (!saved) {
        EAction.handleUserWarning(qsTr("%1 was created, but the drawing " +
            "could not be saved into it. Use File > Save As.").arg(folder));
        return null;
    }

    var record = CsShelf.normalize({ name: name, folder: folder,
        drawing: drawing });
    CsShelf.register(record);
    EAction.handleUserMessage(qsTr("%1 started: %2").arg(name).arg(drawing));
    return record;
};
