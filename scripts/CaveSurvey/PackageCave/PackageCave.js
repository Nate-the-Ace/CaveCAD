// PackageCave.js
//
// QCAD add-on tool: assembles a cave project folder into one zip.
//
// TWO KINDS, AND THE DIFFERENCE IS THE ENTRANCE. A cave folder holds
// the location three ways: the drawing's GeoLat/GeoLon/GeoStation tags,
// the aerial photograph fetched beside it (which needs no tags to be
// read), and whatever is written on the hand sketches. The SANITIZED
// package -- the default -- leaves all three out. The FULL archive
// keeps them, is meant for the group's own storage and for handing a
// project to the next cartographer, and says so in its file name and
// its manifest.
//
// PDFs SHIP AS THEY ARE, in both kinds. A map in the cave's PDF/ folder
// was plotted on purpose by somebody who decided what it shows, and
// nothing here second-guesses that. Nor does anything here PLOT one:
// the packager collects what it finds and never generates a sheet.
//
// THE ORIGINAL IS NEVER TOUCHED. Sanitizing happens on a copy imported
// into a memory document; the drawing on disk is not opened, not
// modified and not resaved. The staged folder is assembled in the
// system temp directory, zipped, and deleted.
//
// The zip itself is made by whatever ships with the platform (see
// CsPackage.zipCommand): there is no zip library in the script engine,
// and taking on a dependency to write one archive would be a poor
// trade.

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

function PackageCave(guiAction) {
    EAction.call(this, guiAction);
}

PackageCave.prototype = new EAction();

// Seconds allowed for the zip. A big cave with scans can be hundreds of
// megabytes and the process has nothing to report meanwhile.
PackageCave.TIMEOUT_S = 300;

PackageCave.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    packageCaveRun();
    this.terminate();
};

PackageCave.init = function(basePath) {
    var action = new RGuiAction(qsTr("Package Cave Project..."),
        RMainWindowQt.getMainWindow());
    action.setRequiresDocument(false);
    action.setScriptFile(basePath + "/PackageCave.js");
    action.setIcon(basePath + "/PackageCave.svg");
    action.setStatusTip(qsTr("Assemble a cave project into one zip: " +
        "sanitized to share, or a full archive to keep"));
    action.setDefaultCommands(["packagecave", "pkgcave"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(95); // housekeeping, so: last
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};

// ---------------------------------------------------------------------
// Which cave
// ---------------------------------------------------------------------

/**
 * The cave to package: the one in front of the user if this drawing has
 * been saved, otherwise whichever they pick off the shelf.
 */
PackageCave.chooseCave = function(parent) {
    var doc = EAction.getDocument();
    if (!isNull(doc)) {
        var path = doc.getFileName();
        if (path !== "") {
            var folder = CsCave.folderOf(path);
            var known = CsShelf.find(folder);
            if (known !== null) { return known; }
            return CsShelf.normalize({ name: CsCave.nameOf(path),
                folder: folder, drawing: path });
        }
    }

    var shelf = CsShelf.list();
    if (shelf.length === 0) {
        EAction.handleUserWarning(qsTr("No cave to package: open a cave's " +
            "drawing, or add one in Cave Survey > Caves."));
        return null;
    }
    var names = [];
    for (var i = 0; i < shelf.length; i++) { names.push(shelf[i].name); }

    var chosen = QInputDialog.getItem(parent, qsTr("Package Cave Project"),
        qsTr("Which cave?"), names, 0, false);
    if (isNull(chosen) || String(chosen) === "") { return null; }
    for (var c = 0; c < shelf.length; c++) {
        if (shelf[c].name === String(chosen)) { return shelf[c]; }
    }
    return null;
};

// ---------------------------------------------------------------------
// What to include
// ---------------------------------------------------------------------

/**
 * Asks what kind of package and what goes in it.
 *
 * scans/ is a real choice rather than a policy: handing a project to a
 * new cartographer means handing over the sketches, and that handoff is
 * the full archive -- so scans follow the mode by default (off when
 * sanitized, on when full) and the user can say otherwise either way.
 *
 * \return {full, pdfs, data, scans, destination} or null.
 */
PackageCave.ask = function(parent, record, counts) {
    var dialog = new QDialog(parent);
    dialog.windowTitle = qsTr("Package Cave Project");

    var layout = new QVBoxLayout();

    var heading = new QLabel(record.name);
    try {
        var font = heading.font;
        font.setBold(true);
        heading.font = font;
    } catch (eFont) {
    }
    layout.addWidget(heading, 0, 0);

    var kind = new QGroupBox(qsTr("Package"));
    var kindLayout = new QVBoxLayout();
    var sanitized = new QRadioButton(
        qsTr("Sanitized — no coordinates, no aerial photograph"));
    var full = new QRadioButton(
        qsTr("Full archive — includes the entrance location"));
    sanitized.checked = true;
    kindLayout.addWidget(sanitized, 0, 0);
    kindLayout.addWidget(full, 0, 0);
    kind.setLayout(kindLayout);
    layout.addWidget(kind, 0, 0);

    var includes = new QGroupBox(qsTr("Include"));
    var includeLayout = new QVBoxLayout();
    var pdfs = new QCheckBox(qsTr("Maps from PDF/ (%1)").arg(counts.pdfs));
    pdfs.checked = counts.pdfs > 0;
    pdfs.enabled = counts.pdfs > 0;
    var data = new QCheckBox(qsTr("Survey data — Compass, Survex, CSV"));
    data.checked = true;
    var scans = new QCheckBox(qsTr("Hand sketches from scans/ (%1)")
        .arg(counts.scans));
    scans.checked = false;
    scans.enabled = counts.scans > 0;
    scans.toolTip = qsTr("Sketches often carry access notes, parking and " +
        "landowner names.");
    includeLayout.addWidget(pdfs, 0, 0);
    includeLayout.addWidget(data, 0, 0);
    includeLayout.addWidget(scans, 0, 0);
    includes.setLayout(includeLayout);
    layout.addWidget(includes, 0, 0);

    // The mode carries the sketches with it, until the user says
    // otherwise -- after which their choice stands.
    var scansTouched = { yes: false };
    scans.clicked.connect(function() { scansTouched.yes = true; });
    var followMode = function() {
        if (!scansTouched.yes && scans.enabled) {
            scans.checked = full.checked === true;
        }
    };
    full.toggled.connect(followMode);

    var destination = CsPackage.depotFor(QDir.homePath());
    var whereLabel = new QLabel("");
    whereLabel.wordWrap = true;
    var updateWhere = function() {
        whereLabel.text = qsTr("Writes to: ") + destination + "/" +
            CsPackage.archiveName(record.name, PackageCave.today(),
                full.checked === true);
    };
    full.toggled.connect(updateWhere);
    updateWhere();
    layout.addWidget(whereLabel, 0, 0);

    var buttons = new QHBoxLayout();
    var changeButton = new QPushButton(qsTr("Change Folder..."));
    var okButton = new QPushButton(qsTr("Package"));
    var cancelButton = new QPushButton(qsTr("Cancel"));
    buttons.addWidget(changeButton, 0, 0);
    buttons.addStretch(1);
    buttons.addWidget(okButton, 0, 0);
    buttons.addWidget(cancelButton, 0, 0);
    layout.addLayout(buttons, 0);
    dialog.setLayout(layout);

    changeButton.clicked.connect(function() {
        var picked = QFileDialog.getExistingDirectory(dialog,
            qsTr("Where should the package go?"), destination);
        if (!isNull(picked) && String(picked) !== "") {
            destination = String(picked).replace(/\\/g, "/")
                .replace(/\/+$/, "");
            updateWhere();
        }
    });
    okButton.clicked.connect(function() { dialog.accept(); });
    cancelButton.clicked.connect(function() { dialog.reject(); });

    var answer = dialog.exec();
    var options = null;
    if (answer !== 0) {
        options = {
            full: full.checked === true,
            pdfs: pdfs.checked === true,
            data: data.checked === true,
            scans: scans.checked === true,
            destination: destination
        };
    }
    destrDialog(dialog);
    return options;
};

/** Today, as the file names and the manifest write it. */
PackageCave.today = function() {
    try {
        return String(QDate.currentDate().toString("yyyy-MM-dd"));
    } catch (e) {
        return "";
    }
};

// ---------------------------------------------------------------------
// Building the package
// ---------------------------------------------------------------------

/** Files directly inside a folder, full paths, name-sorted. */
PackageCave.filesIn = function(folder) {
    var out = [];
    if (folder === null || folder === undefined) { return out; }
    try {
        var dir = new QDir(folder);
        if (!dir.exists()) { return out; }
        var names = dir.entryList([], QDir.Files | QDir.NoDotAndDotDot, QDir.Name);
        for (var i = 0; i < names.length; i++) {
            out.push(folder + "/" + String(names[i]));
        }
    } catch (e) {
    }
    return out;
};

/** Copies into an existing staging folder; returns how many landed. */
PackageCave.copyInto = function(paths, targetFolder) {
    var copied = 0;
    if (!(new QDir()).mkpath(targetFolder)) { return 0; }
    for (var i = 0; i < paths.length; i++) {
        var name = CsShelf.basename(paths[i]);
        try {
            if ((new QFile(paths[i])).copy(targetFolder + "/" + name)) {
                copied++;
            }
        } catch (e) {
        }
    }
    return copied;
};

/**
 * Writes the drawing into the staging folder.
 *
 * Full: a byte copy. Sanitized: the drawing is imported into a MEMORY
 * document, the geographic anchor tags are removed from whichever
 * station carries them, any aerial basemap image is deleted, and that
 * document is exported. The file on disk is never opened for writing.
 *
 * \return {ok, stripped, basemaps, error}
 */
PackageCave.stageDrawing = function(record, stagingFolder, full) {
    var target = stagingFolder + "/" + CsShelf.basename(record.drawing);

    if (full === true) {
        var copied = false;
        try {
            copied = (new QFile(record.drawing)).copy(target);
        } catch (eCopy) {
            copied = false;
        }
        return { ok: copied, stripped: 0, basemaps: 0,
            error: copied ? "" : "Could not copy the drawing." };
    }

    var di = new RDocumentInterface(
        new RDocument(new RMemoryStorage(), createSpatialIndex()));
    var result = { ok: false, stripped: 0, basemaps: 0, error: "" };
    try {
        if (di.importFile(record.drawing, "", false) !==
                RDocumentInterface.IoErrorNoError) {
            result.error = "Could not read the drawing.";
            return result;
        }
        var doc = di.getDocument();

        result.stripped = PackageCave.stripGeoTags(doc, di);
        if (typeof AerialBasemap !== "undefined" &&
                isFunction(AerialBasemap.eraseExisting)) {
            result.basemaps = AerialBasemap.eraseExisting(doc, di);
        }

        result.ok = di.exportFile(target, PackageCave.dxfFilter());
        if (!result.ok) {
            result.error = "Could not write the sanitized drawing.";
        }
    } catch (e) {
        result.error = "Sanitizing failed: " + e;
    } finally {
        destr(di);
    }
    return result;
};

/**
 * The exporter that persists custom properties as XDATA -- the same one
 * Save picks for a DXF with no format of its own. A package written by
 * any other writer would arrive with the survey data missing, which is
 * the one thing the drawing is for.
 */
PackageCave.dxfFilter = function() {
    try {
        var filters = RFileExporterRegistry.getFilterStrings();
        for (var i = 0; i < filters.length; i++) {
            if (filters[i].contains("dxflib") && filters[i].contains("*.dxf")) {
                return filters[i];
            }
        }
    } catch (e) {
    }
    return "";
};

/** Removes the geographic anchor from every entity carrying it. */
PackageCave.stripGeoTags = function(doc, di) {
    var stripped = 0;
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) { continue; }

        var carries = false;
        for (var t = 0; t < CsPackage.GEO_TAGS.length; t++) {
            if (CsTags.get(e, CsPackage.GEO_TAGS[t]) !== null &&
                    CsTags.get(e, CsPackage.GEO_TAGS[t]) !== undefined &&
                    CsTags.get(e, CsPackage.GEO_TAGS[t]) !== "") {
                carries = true;
            }
        }
        if (!carries) { continue; }

        for (var r = 0; r < CsPackage.GEO_TAGS.length; r++) {
            CsTags.remove(e, CsPackage.GEO_TAGS[r]);
        }
        var op = new RModifyObjectsOperation();
        op.addObject(e, false);
        di.applyOperation(op);
        stripped++;
    }
    return stripped;
};

/** Writes the survey out in every interchange format, into data/. */
PackageCave.stageData = function(survey, stagingFolder, caveName) {
    var written = [];
    if (survey === null || survey === undefined) { return written; }
    var folder = stagingFolder + "/data";
    if (!(new QDir()).mkpath(folder)) { return written; }

    var stem = CsPackage.safeName(caveName).replace(/\s+/g, "-").toLowerCase();
    if (stem === "") { stem = "survey"; }

    for (var i = 0; i < CsFormatRegistry.FORMATS.length; i++) {
        var format = CsFormatRegistry.FORMATS[i];
        try {
            var text = format.write(survey);
            if (text === null || text === undefined || text === "") { continue; }
            var name = stem + "." + format.extensions[0];
            if (writeTextFile(folder + "/" + name, text) !== false) {
                written.push(name);
            }
        } catch (e) {
            // One format refusing a survey it cannot express is not a
            // reason to lose the other three.
        }
    }
    return written;
};

/**
 * Assembles, zips, and cleans up.
 */
PackageCave.build = function(record, options) {
    var caveFolder = record.folder;
    var stagingRoot = QDir.tempPath() + "/CaveCADPackage";
    var folderName = CsPackage.safeName(record.name);
    if (folderName === "") { folderName = "Cave"; }
    var staging = stagingRoot + "/" + folderName;

    try {
        var old = new QDir(staging);
        if (old.exists()) { old.removeRecursively(); }
    } catch (eClean) {
    }
    if (!(new QDir()).mkpath(staging)) {
        EAction.handleUserWarning(qsTr("Could not prepare a staging folder " +
            "in ") + stagingRoot);
        return false;
    }

    var contents = [];

    // ---- the drawing --------------------------------------------------
    var drawing = PackageCave.stageDrawing(record, staging, options.full);
    if (!drawing.ok) {
        EAction.handleUserWarning(qsTr("Package failed: ") + drawing.error);
        return false;
    }
    contents.push({ path: CsShelf.basename(record.drawing),
        note: options.full ? "the drawing, complete" :
            "the drawing, geographic anchor removed" });

    // ---- the survey, read once and used twice -------------------------
    var read = CaveShelfReadForPackage(record);

    // ---- maps ---------------------------------------------------------
    if (options.pdfs) {
        var pdfs = CsCave.pdfFiles(caveFolder);
        var pdfCount = PackageCave.copyInto(pdfs, staging + "/" + CsCave.PDF);
        if (pdfCount > 0) {
            contents.push({ path: CsCave.PDF + "/ (" + pdfCount + ")",
                note: "maps, exactly as they were plotted" });
        }
    }

    // ---- sketches -----------------------------------------------------
    if (options.scans) {
        var scansFolder = CsCave.findSubfolder(caveFolder, CsCave.SCANS);
        var scanCount = scansFolder === null ? 0 :
            PackageCave.copyInto(PackageCave.filesIn(scansFolder),
                staging + "/" + CsCave.SCANS);
        if (scanCount > 0) {
            contents.push({ path: CsCave.SCANS + "/ (" + scanCount + ")",
                note: "hand sketches" });
        }
    }

    // ---- the aerial photograph, full archives only ---------------------
    if (options.full) {
        var aerial = CsGeoProject.imagePathFor(record.drawing);
        if (aerial !== null && (new QFileInfo(aerial)).exists()) {
            if ((new QFile(aerial)).copy(staging + "/" +
                    CsShelf.basename(aerial))) {
                contents.push({ path: CsShelf.basename(aerial),
                    note: "aerial basemap — SHOWS THE SURFACE LOCATION" });
            }
        }
    }

    // ---- interchange formats -------------------------------------------
    if (options.data && read !== null && read.survey !== null) {
        var written = PackageCave.stageData(read.survey, staging, record.name);
        if (written.length > 0) {
            contents.push({ path: "data/ (" + written.length + ")",
                note: written.join(", ") });
        }
    }

    // ---- the manifest ---------------------------------------------------
    contents.push({ path: "MANIFEST.txt", note: "this file" });
    var manifest = CsPackage.manifest({
        caveName: record.name,
        date: PackageCave.today(),
        full: options.full,
        generator: PackageCave.generator(),
        length: read === null ? 0 : read.length,
        unit: read === null ? "ft" : read.unit,
        trips: PackageCave.tripsForManifest(read),
        ends: read === null ? [] : read.ends,
        contents: contents
    });
    writeTextFile(staging + "/MANIFEST.txt", manifest);

    // ---- zip -------------------------------------------------------------
    if (!(new QDir()).mkpath(options.destination)) {
        EAction.handleUserWarning(qsTr("Could not create ") +
            options.destination);
        return false;
    }
    var zipPath = options.destination + "/" +
        CsPackage.archiveName(record.name, PackageCave.today(), options.full);
    try {
        if ((new QFile(zipPath)).exists()) { (new QFile(zipPath)).remove(); }
    } catch (eRm) {
    }

    var command = CsPackage.zipCommand(RS.getSystemId(), stagingRoot,
        folderName, zipPath);
    var zipped = PackageCave.runZip(command);

    try {
        (new QDir(staging)).removeRecursively();
    } catch (eClean2) {
    }

    if (!zipped.ok) {
        EAction.handleUserWarning(qsTr("The package was assembled but not " +
            "zipped: ") + zipped.error);
        return false;
    }

    EAction.handleUserMessage(qsTr("%1 packaged: %2").arg(record.name)
        .arg(zipPath));
    QMessageBox.information(RMainWindowQt.getMainWindow(),
        qsTr("Package Cave Project"),
        (options.full ?
            qsTr("Full archive written — it carries the entrance location.\n\n") :
            qsTr("Sanitized package written — no coordinates, no aerial.\n\n")) +
        zipPath);
    return true;
};

/** Runs the platform's zip program and waits for it. */
PackageCave.runZip = function(command) {
    try {
        var process = new QProcess();
        process.setWorkingDirectory(command.workingDirectory);
        process.start(command.program, command.args);
        if (!process.waitForStarted(10000)) {
            return { ok: false, error: command.program + " would not start." };
        }
        if (!process.waitForFinished(PackageCave.TIMEOUT_S * 1000)) {
            process.kill();
            return { ok: false, error: "zipping timed out." };
        }
        if (process.exitCode() !== 0) {
            return { ok: false, error: command.program + " exited " +
                process.exitCode() + ": " +
                String(process.readAllStandardError()) };
        }
        return { ok: true, error: "" };
    } catch (e) {
        return { ok: false, error: String(e) };
    }
};

/** The suite's version, for the manifest. */
PackageCave.generator = function() {
    var version = (typeof CaveSurvey !== "undefined") ?
        CaveSurvey.version : undefined;
    return "CaveCAD Cave Survey" + (isNull(version) ? "" : " " + version);
};

/** Trip rows for the manifest, with each trip's declination. */
PackageCave.tripsForManifest = function(read) {
    if (read === null || read === undefined ||
            Object.prototype.toString.call(read.trips) !== "[object Array]") {
        return [];
    }
    var survey = read.survey;
    var records = (survey !== null && survey !== undefined &&
        Object.prototype.toString.call(survey.trips) === "[object Array]") ?
        survey.trips : [];

    var out = [];
    for (var i = 0; i < read.trips.length; i++) {
        var trip = read.trips[i];
        var record = records[trip.id];
        out.push({
            id: trip.id,
            name: trip.name,
            date: trip.date,
            team: trip.team,
            shots: trip.shots,
            declination: record === undefined || record === null ? undefined :
                record.declination,
            declinationSource: record === undefined || record === null ? "" :
                record.declinationSource
        });
    }
    return out;
};

/**
 * The survey behind the package, read the same way the cave shelf reads
 * it -- one import, cached against the file's timestamp, so packaging a
 * cave just looked at costs nothing.
 */
function CaveShelfReadForPackage(record) {
    if (typeof CaveShelf === "undefined") { return null; }
    var read = CaveShelf.readCave(record);
    return read.ok ? read : null;
}

function packageCaveRun() {
    var appWin = RMainWindowQt.getMainWindow();

    var record = PackageCave.chooseCave(appWin);
    if (record === null) { return; }

    if (CsShelf.clean(record.drawing) === "" ||
            !(new QFileInfo(record.drawing)).exists()) {
        EAction.handleUserWarning(qsTr("This cave has no drawing to " +
            "package yet."));
        return;
    }

    var scansFolder = CsCave.findSubfolder(record.folder, CsCave.SCANS);
    var counts = {
        pdfs: CsCave.pdfFiles(record.folder).length,
        scans: scansFolder === null ? 0 :
            PackageCave.filesIn(scansFolder).length
    };

    var options = PackageCave.ask(appWin, record, counts);
    if (options === null) { return; }

    PackageCave.build(record, options);
}
