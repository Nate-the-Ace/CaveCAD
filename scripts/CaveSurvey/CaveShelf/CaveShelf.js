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
 * Is this file a placeholder the sync client has not filled in?
 *
 * A zero-byte drawing under a synced drive is the honest, portable
 * signal: Drive for Desktop leaves entries whose bytes are elsewhere,
 * and a DXF is never legitimately empty. Anything cleverer would mean
 * reading macOS file flags through a shell, which is a lot of machinery
 * for a message.
 *
 * \return the sentence to show, or null when the file is fine.
 */
CaveShelf.notDownloaded = function(path) {
    try {
        var info = new QFileInfo(path);
        if (!info.exists() || info.size() > 0) { return null; }
    } catch (e) {
        return null;
    }
    if (!CsCave.isUnderDrive(path, CsCave.driveRoots())) {
        return "The drawing is empty:\n" + path;
    }
    return "Not downloaded from the drive yet — the file is here but its " +
        "contents are not.\n\nOpen the cave's folder (Reveal in Finder) " +
        "and let the drive fetch it, then come back.";
};

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
        unit: "ft", legacy: false, survey: null, startable: false };

    if (record === null || record === undefined ||
            CsShelf.clean(record.drawing) === "") {
        blank.error = "No drawing yet. New Trip starts one from the NSS " +
            "template, saves it in this folder, and opens the notebook " +
            "on the first station.";
        blank.startable = true;
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

    // A Drive placeholder: the entry is there, the bytes are not. Saying
    // so beats letting the import fail with something about DXF syntax.
    var pending = CaveShelf.notDownloaded(path);
    if (pending !== null) {
        blank.error = pending;
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
            var why = "Could not read:\n" + path;
            if (CsCave.isUnderDrive(path, CsCave.driveRoots())) {
                why += "\n\nThis cave is on a synced drive. If the file has " +
                    "not been downloaded to this machine yet, open its " +
                    "folder and let the drive fetch it, then try again.";
            }
            read = { ok: false, error: why,
                trips: [], ends: [], length: 0, unit: "ft", legacy: false,
                survey: null, startable: false };
        }
        else {
            var caveDoc = sourceDi.getDocument();
            read = CaveShelf.summarize(CsRevise.surveyFromDocument(caveDoc),
                caveDoc, record.folder);
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

/**
 * Everything the shelf can learn about a cave in one pass over the
 * document it has already opened: what the survey is, and what about it
 * wants attention.
 *
 * The triage half is the point. Length and trip count describe a cave;
 * a bad loop closure, a trip surveyed under the wrong declination, or
 * linework no trip owns are things somebody has to DO something about,
 * and a shelf that shows them turns a list of files into a work queue.
 */
CaveShelf.summarize = function(recon, doc, folder) {
    var survey = (recon === null || recon === undefined) ? null : recon.survey;
    if (survey === null || survey === undefined) {
        return { ok: false, error: "This drawing carries no survey data.",
            trips: [], ends: [], length: 0, unit: "ft", legacy: false,
            survey: null, startable: true };
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

    var health = CaveShelf.inspect(survey, recon, doc, folder);

    return {
        ok: survey.shots.length > 0,
        stats: health.stats,
        grade: health.grade,
        badges: health.badges,
        drift: health.drift,
        // A fresh template drawing has no shots. That is not a fault --
        // it is a cave waiting for its first trip, and New Trip must
        // stay live for it.
        startable: survey.shots.length === 0,
        error: survey.shots.length > 0 ? "" :
            "No survey in this drawing yet. New Trip opens the notebook " +
            "on the first station.",
        survey: survey,
        trips: trips,
        ends: ends,
        length: length,
        unit: unit,
        legacy: recon.legacy === true
    };
};

/**
 * "1 trip", "6 trips" -- a cave with one of something is common enough
 * that "1 trips" would be on screen most of the time.
 */
CaveShelf.count = function(n, noun) {
    return n + " " + noun + (n === 1 ? "" : "s");
};

/**
 * The triage pass: solve the survey the way the DRAWING was solved, and
 * read the conditions worth flagging off the document itself.
 *
 * Solved through CsAdjust.resolveAndAdjust with the drawing's own
 * recorded options (CsRevise hands them over as adjustTags), not with
 * the current settings -- a closure figure computed under a different
 * adjustment than the geometry on screen is a number about nothing.
 *
 * Everything here is wrapped: a cave that cannot be analysed still
 * lists, with fewer things said about it.
 */
CaveShelf.inspect = function(survey, recon, doc, folder) {
    var out = { stats: null, grade: null, badges: [], drift: [] };
    if (survey === null || survey === undefined) { return out; }

    var resolved = null;
    try {
        resolved = CsAdjust.resolveAndAdjust(survey, {},
            CsAdjust.optionsFromTags(recon.adjustTags));
        out.stats = CsStats.compute(survey, resolved);
        out.grade = CsGrade.compute(survey, resolved, out.stats);
    } catch (eSolve) {
    }

    var errors = 0;
    try {
        var findings = CsValidate.check(survey, resolved);
        for (var f = 0; f < findings.length; f++) {
            if (findings[f].severity === "error") { errors++; }
        }
    } catch (eCheck) {
    }

    var scan = CaveShelf.scanDocument(doc);

    // Declination against IGRF, but only where the cave says where it
    // is: without an anchor there is no honest comparison to make.
    if (scan.lat !== null && scan.lon !== null) {
        var trips = [];
        var records = (Object.prototype.toString.call(survey.trips) ===
            "[object Array]") ? survey.trips : [];
        for (var t = 0; t < records.length; t++) {
            trips.push({ id: t, date: records[t].date,
                declination: records[t].declination });
        }
        out.drift = CsShelf.declinationDrift(trips, function(when) {
            var parts = CsShelf.dateParts(when);
            if (parts === null) { return null; }
            return CsShelf.declinationValue(
                CsGeomag.declination(scan.lat, scan.lon, parts, 0.0));
        });
    }

    var ends = CsFrontier.openEnds(survey);
    var noLrud = false;
    for (var e = 0; e < ends.length; e++) {
        if (ends[e].hasLrud === false) { noLrud = true; }
    }

    out.badges = CsShelf.badges({
        errors: errors,
        closure: CsShelf.worstClosure(out.stats),
        closureWarnAt: CsValidate.CLOSURE_WARN_PERCENT,
        driftedTrips: out.drift.length,
        legacy: recon.legacy === true,
        unbound: scan.unbound,
        openEndNoLrud: noLrud,
        geo: scan.lat !== null,
        elevation: scan.elevation,
        pdfs: CsCave.pdfFiles(folder).length
    });
    return out;
};

/**
 * One walk over the drawing for the three things only the document
 * knows: whether it is georeferenced (and where, which stays INSIDE
 * this function -- the coordinate is never shown, only used to ask IGRF
 * a question), whether an extended elevation has been drawn, and how
 * much traced linework belongs to no trip.
 */
CaveShelf.scanDocument = function(doc) {
    var out = { lat: null, lon: null, elevation: false, unbound: 0 };
    if (isNull(doc)) { return out; }

    var ids;
    try {
        ids = doc.queryAllEntities(false, false);
    } catch (eQuery) {
        return out;
    }

    for (var i = 0; i < ids.length; i++) {
        var e;
        try {
            e = doc.queryEntity(ids[i]);
        } catch (eEnt) {
            continue;
        }
        if (isNull(e)) { continue; }

        if (out.lat === null) {
            var lat = CsTags.getNumber(e, "GeoLat");
            var lon = CsTags.getNumber(e, "GeoLon");
            if (lat !== null && lon !== null) {
                out.lat = lat;
                out.lon = lon;
            }
        }

        if (!out.elevation && CsTags.get(e, "ProfileRun") !== null &&
                CsTags.get(e, "ProfileRun") !== undefined) {
            out.elevation = true;
        }

        try {
            var layer = doc.getLayerName(e.getLayerId());
            if (CsBind.isLineworkLayer(layer) &&
                    isNull(CsTags.get(e, CsBind.TRIP_TAG))) {
                out.unbound++;
            }
        } catch (eLayer) {
        }
    }
    return out;
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
    var addFolderButton = new QPushButton(qsTr("Add Folder..."));
    addFolderButton.toolTip = qsTr("Registers every cave inside a folder " +
        "at once -- a survey group's shared folder, say.");
    var forgetButton = new QPushButton(qsTr("Forget"));
    forgetButton.toolTip = qsTr("Removes the cave from this list. " +
        "Nothing on disk is touched.");
    leftButtons.addWidget(addButton, 1, 0);
    leftButtons.addWidget(addFolderButton, 0, 0);
    leftButtons.addWidget(forgetButton, 0, 0);
    left.addLayout(leftButtons, 0);
    main.addLayout(left, 0);

    // ---- right: the selected cave ------------------------------------
    var right = new QVBoxLayout();

    // The cave's name and its picture share the top of the pane.
    var header = new QHBoxLayout();
    var thumb = new QLabel("");
    thumb.setFixedSize(new QSize(CaveShelf.THUMB_W, CaveShelf.THUMB_H));
    thumb.alignment = Qt.AlignCenter;
    var heading = new QVBoxLayout();

    var title = new QLabel("");
    try {
        var titleFont = title.font;
        titleFont.setPointSize(titleFont.pointSize() + 5);
        titleFont.setBold(true);
        title.font = titleFont;
    } catch (eFont) {
    }
    heading.addWidget(title, 0, 0);

    var subtitle = new QLabel("");
    subtitle.wordWrap = true;
    heading.addWidget(subtitle, 0, 0);

    var badges = new QLabel("");
    badges.wordWrap = true;
    heading.addWidget(badges, 0, 0);
    heading.addStretch(1);

    header.addWidget(thumb, 0, 0);
    header.addLayout(heading, 1);
    right.addLayout(header, 0);

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

    var health = new QLabel("");
    health.wordWrap = true;
    right.addWidget(health, 0, 0);

    var frontier = new QLabel("");
    frontier.wordWrap = true;
    right.addWidget(frontier, 0, 0);

    // The cave's own actions sit with the cave; the window's actions
    // (new cave, close) stay in the footer.
    var caveActions = new QHBoxLayout();
    var revealButton = new QPushButton(qsTr("Reveal in Finder"));
    var pdfButton = new QPushButton(qsTr("Open PDF/"));
    var packageButton = new QPushButton(qsTr("Package..."));
    caveActions.addWidget(revealButton, 0, 0);
    caveActions.addWidget(pdfButton, 0, 0);
    caveActions.addWidget(packageButton, 0, 0);
    caveActions.addStretch(1);
    right.addLayout(caveActions, 0);

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

        badges.text = "";
        health.text = "";
        CaveShelf.showThumbnail(thumb, state.record);

        if (state.record === null) {
            title.text = state.records.length === 0 ?
                qsTr("No caves on the shelf yet") : "";
            subtitle.text = state.records.length === 0 ?
                qsTr("Add Cave... points at a cave's folder on your drive. " +
                    "Saving a drawing inside one adds it here by itself.") : "";
            frontier.text = "";
            state.read = null;
            CaveShelf.updateButtons(state, openButton, tripButton, forgetButton,
                revealButton, pdfButton, packageButton);
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
            CaveShelf.updateButtons(state, openButton, tripButton, forgetButton,
                revealButton, pdfButton, packageButton);
            return;
        }

        var pdfs = CsCave.pdfFiles(state.record.folder);
        var parts = [where,
            CaveShelf.formatLength(read.length, read.unit) + qsTr(" surveyed"),
            CaveShelf.count(read.trips.length, "trip")];
        if (pdfs.length > 0) {
            parts.push(CaveShelf.count(pdfs.length, "map") +
                qsTr(" in PDF/"));
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

        badges.text = CsShelf.badgeLine(read.badges);
        health.text = CsShelf.healthText(read.stats, read.grade, read.unit) +
            CaveShelf.driftText(read.drift);
        frontier.text = CaveShelf.frontierText(read);
        CaveShelf.updateButtons(state, openButton, tripButton, forgetButton,
            revealButton, pdfButton, packageButton);
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
        CaveShelf.updateButtons(state, openButton, tripButton, forgetButton,
            revealButton, pdfButton, packageButton);
    });

    addButton.clicked.connect(function() {
        var added = CaveShelf.addCave(dialog);
        if (added !== null) { fillList(added.folder); }
    });

    addFolderButton.clicked.connect(function() {
        var count = CaveShelf.addFolder(dialog);
        if (count > 0) { fillList(); showDetail(); }
    });

    revealButton.clicked.connect(function() {
        if (state.record !== null) { CaveShelf.reveal(state.record.folder); }
    });

    pdfButton.clicked.connect(function() {
        if (state.record === null) { return; }
        var pdfDir = CsCave.pdfFolderOf(state.record.folder);
        CaveShelf.reveal(pdfDir === null ? state.record.folder : pdfDir);
    });

    packageButton.clicked.connect(function() {
        if (state.record === null) { return; }
        if (typeof PackageCave === "undefined") {
            EAction.handleUserWarning(qsTr("Package Cave Project is not " +
                "installed."));
            return;
        }
        PackageCave.forRecord(state.record);
    });

    forgetButton.clicked.connect(function() {
        if (state.record === null) { return; }
        var answer = QMessageBox.question(RMainWindowQt.getMainWindow(), qsTr("Forget Cave"),
            qsTr("Take %1 off the shelf?\n\nThe folder and everything in " +
                "it stays exactly where it is.").arg(state.record.name),
            QMessageBox.Yes | QMessageBox.No);
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

/**
 * Enables what can be done to the selected cave, and says so.
 *
 * New Trip is the way IN to a cave, so it stays live in the three states
 * a cave can be in before it has any survey: no drawing at all (starting
 * the trip starts the drawing), a drawing with nothing in it, and a
 * drawing whose trips have left an open end. A cave that already HAS a
 * drawing never gets a second one -- the new trip is a numbered trip
 * inside that drawing, which is what lets loop closure solve across
 * trips and a revision correct one trip without touching the others. The only thing that disables it is a
 * drawing CaveCAD cannot open -- a DWG -- because guessing what to do
 * beside somebody's DWG is not this button's business.
 */
CaveShelf.updateButtons = function(state, openButton, tripButton, forgetButton,
        revealButton, pdfButton, packageButton) {
    var record = state.record;
    var read = state.read;
    var hasDrawing = record !== null && CsShelf.clean(record.drawing) !== "";
    var isDwg = hasDrawing && CsShelf.extension(record.drawing) === "dwg";

    forgetButton.enabled = record !== null;
    openButton.enabled = hasDrawing && !isDwg;

    var station = "";
    if (read !== null && read.ok) {
        if (state.trip >= 0 && state.trip < read.trips.length &&
                read.trips[state.trip].ends.length > 0) {
            station = read.trips[state.trip].ends[0].station;
        }
        else {
            station = CaveShelf.tieInFor(read);
        }
    }
    state.station = station;
    state.needsDrawing = record !== null && !hasDrawing;

    tripButton.enabled = record !== null && !isDwg &&
        (openButton.enabled || state.needsDrawing);

    if (revealButton !== undefined) {
        // A folder can always be opened, even for a cave with nothing in
        // it yet -- that is often exactly when somebody wants to look.
        revealButton.enabled = record !== null;
        pdfButton.enabled = record !== null;
        // Packaging needs something to package.
        packageButton.enabled = hasDrawing && !isDwg;
    }

    // Always "New Trip". Making the drawing when a cave has none is
    // what starting a trip MEANS for a cave nobody has surveyed yet --
    // it is not a different action, and a button that renames itself
    // buries the one thing the user came here to do. The label only
    // gains detail when there is a station to tie into.
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
    CaveShelf.captureThumbnailSoon(path);
    return true;
};

/**
 * Creates a cave's drawing: the NSS template, saved into the cave's own
 * folder under the cave's own name.
 *
 * Shared by New Cave... (which makes the folder first) and by New Trip
 * on a cave that was registered before it had any drawing -- adding a
 * folder off the drive and then wanting to survey it is the ordinary
 * way a cave starts, and it must not dead-end.
 *
 * \return the drawing's path, or null.
 */
CaveShelf.startDrawing = function(record) {
    if (record === null || record === undefined) { return null; }

    var stem = CsPackage.safeName(record.name);
    if (stem === "") { stem = CsShelf.basename(record.folder); }
    if (stem === "") { stem = "Cave"; }
    var drawing = record.folder + "/" + stem + ".dxf";

    // Already there (somebody saved one since this cave was added):
    // adopt it rather than writing over it.
    if ((new QFileInfo(drawing)).exists()) {
        CsShelf.register({ name: record.name, folder: record.folder,
            drawing: drawing });
        CaveShelf.openRecord({ drawing: drawing });
        return drawing;
    }

    // The template pours itself into the new document (CaveTemplate's
    // post-new hook); the one-shot flag makes that true even where
    // somebody switched the default off.
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
        EAction.handleUserWarning(qsTr("The drawing could not be saved " +
            "into %1. Use File > Save As.").arg(record.folder));
        return null;
    }

    CsCave.ensureProjectFolders(record.folder, true);
    CsShelf.register({ name: record.name, folder: record.folder,
        drawing: drawing });
    delete CaveShelf.cache[drawing];
    return drawing;
};

/**
 * Opens the cave and starts a trip in the notebook.
 *
 * Three states, one button. A cave with no drawing gets one made and
 * lands on A1 -- the entrance, by project convention. A drawing with no
 * survey yet also lands on A1. A drawing whose trips left an open end
 * lands on that station.
 *
 * The notebook owns the page from here: this fills in the tie-in and
 * the blank row under it, which is what a paper page looks like when a
 * trip starts, and nothing else.
 */
CaveShelf.startTrip = function(state) {
    var record = state.record;
    if (record === null || record === undefined) { return false; }

    if (state.needsDrawing === true) {
        if (CaveShelf.startDrawing(record) === null) { return false; }
    }
    else if (!CaveShelf.openRecord(record)) {
        return false;
    }

    var station = (state.station === undefined || state.station === "") ?
        "A1" : state.station;
    if (typeof SurveyNotebook === "undefined") { return true; }

    try {
        var dock = SurveyNotebook.ensureDock();
        dock.visible = true;
        if (SurveyNotebook.startTripAt(station) === true) {
            EAction.handleUserMessage(state.needsDrawing === true ?
                qsTr("%1 started. The notebook is open at %2.")
                    .arg(record.name).arg(station) :
                qsTr("New trip tied into %1.").arg(station));
        }
    } catch (e) {
        EAction.handleUserWarning(qsTr("The cave opened, but the Survey " +
            "Notebook did not: ") + e);
    }
    return true;
};

// The preview's box. Thumbnails are written at 512px on the long side,
// so this only ever scales down.
CaveShelf.THUMB_W = 150;
CaveShelf.THUMB_H = 110;

/**
 * Where this drawing's preview lives.
 *
 * In the cave's own images/ folder, beside the photographs -- the map's
 * picture is part of the project, travels with it, and is visible to
 * the whole survey group rather than sitting in one machine's cache.
 * The application's own cache path (an MD5 under the app cache
 * directory, which is where the stock recent-files thumbnail goes) is
 * the fallback for a drawing that has no cave folder at all.
 *
 * \return the path, or null when there is no picture yet.
 */
CaveShelf.thumbnailFor = function(drawing) {
    var path = CsShelf.clean(drawing);
    if (path === "") { return null; }

    var usable = function(candidate) {
        if (candidate === null || candidate === undefined) { return null; }
        try {
            var info = new QFileInfo(String(candidate));
            return (info.exists() && info.size() > 0) ? String(candidate) : null;
        } catch (e) {
            return null;
        }
    };

    var inProject = usable(CsCave.previewPathFor(path));
    if (inProject !== null) { return inProject; }

    try {
        return usable(RSettings.getThumbnailFilePath(path));
    } catch (eCache) {
        return null;
    }
};

/**
 * Puts the cave's picture in the label, or a word about why there
 * isn't one.
 *
 * A cave gets its picture the first time it is saved (or opened) since
 * thumbnails started being written -- so an old cave shows the note
 * until somebody opens it, which is honest and needs no bulk render
 * pass over everybody's drawings.
 */
CaveShelf.showThumbnail = function(label, record) {
    label.text = "";
    try {
        label.setPixmap(new QPixmap());
    } catch (eClear) {
    }
    if (record === null || record === undefined) { return; }

    var path = CaveShelf.thumbnailFor(record.drawing);
    if (path === null) {
        label.text = qsTr("no preview yet");
        return;
    }
    try {
        var pixmap = new QPixmap(path);
        if (pixmap.isNull()) {
            label.text = qsTr("no preview yet");
            return;
        }
        label.setPixmap(pixmap.scaled(CaveShelf.THUMB_W, CaveShelf.THUMB_H,
            Qt.KeepAspectRatio, Qt.SmoothTransformation));
    } catch (e) {
        label.text = qsTr("no preview yet");
    }
};

/**
 * Takes the picture for a cave that has just been opened, so a drawing
 * somebody only looks at still earns a preview -- saving is not the
 * only way to visit a cave.
 *
 * Queued: the view has to paint before there is anything to capture.
 */
CaveShelf.captureThumbnailSoon = function(drawing) {
    if (typeof QTimer === "undefined") { return; }
    var path = CsShelf.clean(drawing);
    if (path === "") { return; }
    try {
        var timer = new QTimer(RMainWindowQt.getMainWindow());
        timer.singleShot = true;
        timer.timeout.connect(function() {
            try {
                var di = EAction.getDocumentInterface();
                if (isNull(di) || !isFunction(di.updateThumbnail)) { return; }
                di.updateThumbnail();
                var image = di.getThumbnail();
                if (isNull(image) || image.isNull()) { return; }
                CsCave.writePreview(path, image);
            } catch (eShot) {
                // A preview is never worth an error message.
            }
        });
        timer.start(1200);
    } catch (e) {
    }
};

/**
 * Opens a folder in the desktop's own file manager.
 *
 * The shelf knows where every cave lives; making somebody navigate
 * there by hand to look at a scan or drop a PDF in is a small daily
 * tax for no reason.
 */
CaveShelf.reveal = function(folder) {
    var path = CsShelf.clean(folder);
    if (path === "" || !(new QFileInfo(path)).exists()) { return false; }
    try {
        return QDesktopServices.openUrl(new QUrl("file://" + path));
    } catch (e) {
        EAction.handleUserWarning(qsTr("Could not open ") + path);
        return false;
    }
};

/** What the drift flag says under the health line. */
CaveShelf.driftText = function(drift) {
    if (Object.prototype.toString.call(drift) !== "[object Array]" ||
            drift.length === 0) {
        return "";
    }
    var worst = drift[0];
    for (var i = 1; i < drift.length; i++) {
        if (Math.abs(drift[i].delta) > Math.abs(worst.delta)) {
            worst = drift[i];
        }
    }
    var off = Math.round(Math.abs(worst.delta) * 100) / 100;
    return "\n" + qsTr("Trip %1 was surveyed at %2° declination; IGRF says " +
        "%3° for that date here — %4° out.")
        .arg(worst.id)
        .arg(Math.round(worst.recorded * 100) / 100)
        .arg(Math.round(worst.igrf * 100) / 100)
        .arg(off);
};

/**
 * Registers every cave inside one folder -- a survey group's shared
 * folder, typically.
 *
 * This is the answer to the cost of an explicit registry, and it is
 * deliberately still a DECISION: one folder, chosen, scanned once, with
 * what was found shown before anything is written. What it is not is a
 * standing sweep of the drive at every startup, which is the thing that
 * makes a launcher slow on the machine with the most caves.
 *
 * \return how many caves were added.
 */
CaveShelf.addFolder = function(parent) {
    var roots = CsCave.driveRoots();
    var start = roots.length > 0 ? roots[0] : QDir.homePath();

    var picked = QFileDialog.getExistingDirectory(parent,
        qsTr("Pick a folder that holds caves"), start);
    if (isNull(picked) || String(picked) === "") { return 0; }
    var folder = String(picked).replace(/\\/g, "/").replace(/\/+$/, "");

    var subs = [];
    try {
        var dir = new QDir(folder);
        subs = dir.entryList([], QDir.Dirs | QDir.NoDotAndDotDot, QDir.Name);
    } catch (e) {
        return 0;
    }

    // The folder itself may BE a cave; a folder of caves is the other
    // case. Both are worth handling, because people point at both.
    var candidates = [];
    var self = CsShelf.recordFor(folder);
    if (self !== null && self.drawing !== "") { candidates.push(self); }
    for (var i = 0; i < subs.length; i++) {
        var sub = folder + "/" + String(subs[i]);
        var record = CsShelf.recordFor(sub);
        if (record === null) { continue; }
        // A folder with neither a drawing nor sketches is not a cave --
        // it is somebody's spreadsheets.
        var scans = CsCave.findSubfolder(sub, CsCave.SCANS);
        if (record.drawing === "" && scans === null) { continue; }
        candidates.push(record);
    }

    var known = CsShelf.list();
    var fresh = [];
    for (var c = 0; c < candidates.length; c++) {
        if (CsShelf.indexOfFolder(known, candidates[c].folder) === -1) {
            fresh.push(candidates[c]);
        }
    }

    if (fresh.length === 0) {
        QMessageBox.information(RMainWindowQt.getMainWindow(),
            qsTr("Add Folder"),
            candidates.length === 0 ?
                qsTr("No caves in that folder: nothing there holds a drawing " +
                    "or a scans folder.") :
                qsTr("Every cave in that folder is already on the shelf."));
        return 0;
    }

    var lines = [];
    for (var f = 0; f < fresh.length && f < 20; f++) {
        lines.push("   " + fresh[f].name +
            (fresh[f].drawing === "" ? qsTr("  (no drawing yet)") : ""));
    }
    if (fresh.length > lines.length) {
        lines.push(qsTr("   ...and %1 more").arg(fresh.length - lines.length));
    }

    var answer = QMessageBox.question(RMainWindowQt.getMainWindow(),
        qsTr("Add Folder"),
        qsTr("Add these %1 caves to the shelf?\n\n").arg(fresh.length) +
            lines.join("\n"),
        QMessageBox.Yes | QMessageBox.No);
    if (answer !== QMessageBox.Yes) { return 0; }

    for (var a = 0; a < fresh.length; a++) {
        CsShelf.register(fresh[a]);
    }
    EAction.handleUserMessage(qsTr("%1 caves added to the shelf.")
        .arg(fresh.length));
    return fresh.length;
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
        var answer = QMessageBox.question(RMainWindowQt.getMainWindow(), qsTr("No Drawing Found"),
            qsTr("No DXF or DWG in %1 or one folder below it.\n\n" +
                "Add it anyway? The cave will sit on the shelf until a " +
                "drawing is saved in it.").arg(record.name),
            QMessageBox.Yes | QMessageBox.No);
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

    var answer = QMessageBox.question(RMainWindowQt.getMainWindow(), qsTr("Cave Project Folders"),
        qsTr("This cave has no %1 folder. Create it?\n\n" +
            "scans/ holds the hand sketches (Draw > Image opens there); " +
            "PDF/ holds the maps you plot, and is what Package Cave " +
            "Project collects.").arg(missing.join("/ and no ")),
        QMessageBox.Yes | QMessageBox.No);
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
    // apostrophes are how caves are actually named. Same sanitizer the
    // drawing's own file name uses, so the folder and the file inside
    // it can never disagree.
    var safe = CsPackage.safeName(name);
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
        var answer = QMessageBox.question(RMainWindowQt.getMainWindow(), qsTr("Folder Exists"),
            qsTr("%1 already exists. Put the new drawing in it?")
                .arg(folder),
            QMessageBox.Yes | QMessageBox.No);
        if (answer !== QMessageBox.Yes) { return null; }
    }
    else if (!(new QDir()).mkpath(folder)) {
        EAction.handleUserWarning(qsTr("Could not create %1").arg(folder));
        return null;
    }

    CsCave.ensureProjectFolders(folder, true);

    var drawing = folder + "/" + safe + ".dxf";
    if ((new QFileInfo(drawing)).exists()) {
        var overwrite = QMessageBox.question(RMainWindowQt.getMainWindow(), qsTr("Drawing Exists"),
            qsTr("%1 already exists. Open it instead of starting a new " +
                "one?").arg(drawing),
            QMessageBox.Yes | QMessageBox.No);
        if (overwrite !== QMessageBox.Yes) { return null; }
        var existing = CsShelf.normalize({ name: name, folder: folder,
            drawing: drawing });
        CsShelf.register(existing);
        CaveShelf.openRecord(existing);
        return existing;
    }

    var record = CsShelf.normalize({ name: name, folder: folder,
        drawing: "" });
    if (CaveShelf.startDrawing(record) === null) { return null; }

    EAction.handleUserMessage(qsTr("%1 started: %2").arg(name).arg(drawing));
    return CsShelf.find(folder);
};
