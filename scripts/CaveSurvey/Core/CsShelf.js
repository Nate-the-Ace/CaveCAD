// CsShelf.js -- the caves this machine knows about.
//
// Part of the Cave Survey Core library. Split like CsCave: a pure half
// (the record shape, the JSON, and the ranking that decides which file
// in a folder is THE drawing) that tests/js_unit.js runs under node,
// and a runtime half that touches RSettings and QDir.
//
// WHY A REGISTRY AND NOT A SCAN. The obvious design walks the Google
// Drive folder looking for caves. It was rejected on purpose: Drive for
// Desktop streams placeholders, so a recursive walk stats network-backed
// files and the launcher opens slowly on exactly the machine that has
// the most caves. Worse, the folder layouts in the wild disagree --
// caves sit at the top of My Drive, inside a project folder (BIG Survey
// Group), or with the drawing buried one deeper in a CARTO subfolder --
// so a scanner is guessing anyway.
//
// So the shelf is an explicit list, kept in the setting CaveSurvey/Caves.
// Adding a cave scans ONE folder, two levels deep, which is cheap and
// certain. Saving a drawing under a drive root registers it silently.
// The cost, accepted with open eyes: a cave a teammate adds to the shared
// folder does not appear here until somebody adds it.
//
// A record is {name, folder, drawing}: the cave as people say it, the
// folder that is the cave project, and the plan drawing inside it. The
// drawing may be a DWG -- CaveCAD cannot open one, and the launcher says
// so rather than pretending the cave is not there.

var CsShelf = {};

CsShelf.SETTING = "CaveSurvey/Caves";

// How deep addCave looks for the drawing: the cave folder itself, then
// one level of subfolders (STUDABAKER CAVE/STUDABAKER CARTO/...).
CsShelf.SCAN_DEPTH = 2;

// ---------------------------------------------------------------------
// Pure half -- no Q* or R* globals.
// ---------------------------------------------------------------------

CsShelf.newRecord = function() {
    return { name: "", folder: "", drawing: "" };
};

/** Trims, and turns anything unusable into "". */
CsShelf.clean = function(value) {
    if (value === undefined || value === null) { return ""; }
    return String(value).replace(/^\s+|\s+$/g, "").replace(/\/+$/, "");
};

/**
 * A record with the fields it must have, or null. A record with no
 * folder is meaningless -- the folder IS the cave -- so that is the one
 * field whose absence rejects the whole record. A missing name falls
 * back to the folder's own basename, which is what the convention says
 * the cave is called anyway.
 */
CsShelf.normalize = function(record) {
    if (record === undefined || record === null ||
            typeof record !== "object") {
        return null;
    }
    var folder = CsShelf.clean(record.folder);
    if (folder === "") { return null; }

    var name = CsShelf.clean(record.name);
    if (name === "") { name = CsShelf.basename(folder); }

    return {
        name: name,
        folder: folder,
        drawing: CsShelf.clean(record.drawing)
    };
};

/** The last path component, forward slashes only (Qt reports those). */
CsShelf.basename = function(path) {
    var p = CsShelf.clean(path);
    if (p === "") { return ""; }
    var slash = p.lastIndexOf("/");
    return slash === -1 ? p : p.substring(slash + 1);
};

/** The file name without its extension. */
CsShelf.stem = function(path) {
    var base = CsShelf.basename(path);
    var dot = base.lastIndexOf(".");
    return dot <= 0 ? base : base.substring(0, dot);
};

/** Lower-cased extension without the dot ("dxf"), or "". */
CsShelf.extension = function(path) {
    var base = CsShelf.basename(path);
    var dot = base.lastIndexOf(".");
    return dot <= 0 ? "" : base.substring(dot + 1).toLowerCase();
};

/**
 * Two folder paths meaning the same cave. Trailing slashes and case
 * differ harmlessly on the platforms this add-on targets (macOS and
 * Windows are both case-insensitive; a Linux user who keeps two cave
 * folders differing only in case has bigger problems).
 */
CsShelf.sameFolder = function(a, b) {
    var x = CsShelf.clean(a).toLowerCase();
    var y = CsShelf.clean(b).toLowerCase();
    return x !== "" && x === y;
};

/** Names that are never the cave's plan drawing. */
CsShelf.isRejectedDrawing = function(path) {
    var base = CsShelf.basename(path).toLowerCase();
    if (base === "") { return true; }
    // The legacy sibling elevation, back when the profile was its own
    // file; the elevation is a region of the plan drawing now.
    if (/-?profile\./.test(base)) { return true; }
    // Editor and backup leftovers.
    if (/(~|\.bak|\.orig|backup)/.test(base)) { return true; }
    // QCAD's own template stock, if somebody copied one in.
    if (/template/.test(base)) { return true; }
    return false;
};

/**
 * Which file in a cave folder is THE drawing.
 *
 * Ranked rather than matched, because the folder conventions in the wild
 * disagree and every rule here loses to a stronger one:
 *   a DXF beats a DWG                        CaveCAD can open the DXF
 *   a name matching the folder beats one that does not
 *   a name saying PLAN beats one that does not
 *   shallower beats deeper                   the drawing beside the
 *                                            folder outranks one in a
 *                                            CARTO subfolder
 *   otherwise, alphabetical, so the answer is stable
 *
 * \param paths     candidate file paths
 * \param folder    the cave folder they were found under
 * \return the winning path, or null when nothing qualifies.
 */
CsShelf.pickDrawing = function(paths, folder) {
    if (Object.prototype.toString.call(paths) !== "[object Array]") {
        return null;
    }
    var folderName = CsShelf.basename(folder).toLowerCase().replace(/[\s_-]/g, "");
    var best = null;
    var bestScore = null;

    for (var i = 0; i < paths.length; i++) {
        var path = CsShelf.clean(paths[i]);
        if (path === "") { continue; }
        var ext = CsShelf.extension(path);
        if (ext !== "dxf" && ext !== "dwg") { continue; }
        if (CsShelf.isRejectedDrawing(path)) { continue; }

        var stem = CsShelf.stem(path).toLowerCase().replace(/[\s_-]/g, "");
        var depth = path.split("/").length;

        var score = [
            ext === "dxf" ? 1 : 0,
            (folderName !== "" && stem.indexOf(folderName) !== -1) ? 1 : 0,
            /plan/.test(stem) ? 1 : 0,
            -depth
        ];

        if (bestScore === null || CsShelf.scoreBeats(score, bestScore) ||
                (CsShelf.scoreTies(score, bestScore) && path < best)) {
            best = path;
            bestScore = score;
        }
    }
    return best;
};

/** Lexicographic comparison of the ranking tuples above. */
CsShelf.scoreBeats = function(a, b) {
    for (var i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) { return a[i] > b[i]; }
    }
    return false;
};

CsShelf.scoreTies = function(a, b) {
    for (var i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) { return false; }
    }
    return true;
};

/**
 * Records to the string kept in settings.
 *
 * One JSON array in one key, rather than a QStringList: a list value in
 * a QSettings ini splits on commas, and cave folders contain commas
 * ("Smith, J. Cave" is a real naming style) often enough to lose data.
 */
CsShelf.serialize = function(records) {
    var clean = [];
    if (Object.prototype.toString.call(records) === "[object Array]") {
        for (var i = 0; i < records.length; i++) {
            var record = CsShelf.normalize(records[i]);
            if (record !== null) { clean.push(record); }
        }
    }
    return JSON.stringify(clean);
};

/**
 * The stored string back to records. Tolerant on purpose -- a settings
 * file people edit by hand, and a QSettings that hands back a list where
 * a string went in, both have to degrade to "no caves registered"
 * instead of breaking the launcher.
 */
CsShelf.parse = function(text) {
    var out = [];
    if (text === undefined || text === null) { return out; }

    var raw = text;
    if (Object.prototype.toString.call(raw) === "[object Array]") {
        raw = raw.join(",");
    }
    raw = String(raw);
    if (CsShelf.clean(raw) === "") { return out; }

    var parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        return out;
    }
    if (Object.prototype.toString.call(parsed) !== "[object Array]") {
        return out;
    }
    for (var i = 0; i < parsed.length; i++) {
        var record = CsShelf.normalize(parsed[i]);
        if (record === null) { continue; }
        if (CsShelf.indexOfFolder(out, record.folder) !== -1) { continue; }
        out.push(record);
    }
    return out;
};

/** Index of the record for a folder, or -1. */
CsShelf.indexOfFolder = function(records, folder) {
    if (Object.prototype.toString.call(records) !== "[object Array]") {
        return -1;
    }
    for (var i = 0; i < records.length; i++) {
        if (records[i] !== null && records[i] !== undefined &&
                CsShelf.sameFolder(records[i].folder, folder)) {
            return i;
        }
    }
    return -1;
};

/**
 * Adds or updates a record in a list, in place, and returns the list.
 * Registering a cave twice is not an error -- it is what saving a
 * drawing into an already-registered folder does on every save -- so
 * the second registration refreshes the record instead of duplicating
 * it. A refresh never blanks a field: an update carrying no drawing
 * keeps the drawing already known.
 */
CsShelf.put = function(records, record) {
    var list = (Object.prototype.toString.call(records) === "[object Array]") ?
        records : [];
    var incoming = CsShelf.normalize(record);
    if (incoming === null) { return list; }

    var at = CsShelf.indexOfFolder(list, incoming.folder);
    if (at === -1) {
        list.push(incoming);
        return list;
    }
    var existing = list[at];
    list[at] = {
        name: incoming.name !== "" ? incoming.name : existing.name,
        folder: incoming.folder,
        drawing: incoming.drawing !== "" ? incoming.drawing : existing.drawing
    };
    return list;
};

/** Removes the record for a folder, in place; true if one went. */
CsShelf.remove = function(records, folder) {
    var at = CsShelf.indexOfFolder(records, folder);
    if (at === -1) { return false; }
    records.splice(at, 1);
    return true;
};

/** Records sorted the way the launcher lists them: by cave name. */
CsShelf.sorted = function(records) {
    var list = [];
    if (Object.prototype.toString.call(records) === "[object Array]") {
        for (var i = 0; i < records.length; i++) { list.push(records[i]); }
    }
    list.sort(function(a, b) {
        var x = CsShelf.clean(a.name).toLowerCase();
        var y = CsShelf.clean(b.name).toLowerCase();
        return x < y ? -1 : (x > y ? 1 : 0);
    });
    return list;
};

// ---------------------------------------------------------------------
// Runtime half -- RSettings and QDir. Every function degrades to an
// empty answer rather than throwing: the launcher must open even when
// the shelf is unreadable.
// ---------------------------------------------------------------------

/** Every registered cave, name-sorted. */
CsShelf.list = function() {
    if (typeof RSettings === "undefined") { return []; }
    var raw = "";
    try {
        raw = RSettings.getStringValue(CsShelf.SETTING, "");
    } catch (e) {
        return [];
    }
    return CsShelf.sorted(CsShelf.parse(raw));
};

/** Writes the whole shelf back. */
CsShelf.save = function(records) {
    if (typeof RSettings === "undefined") { return false; }
    try {
        RSettings.setValue(CsShelf.SETTING, CsShelf.serialize(records));
        return true;
    } catch (e) {
        return false;
    }
};

/** Registers (or refreshes) one cave. */
CsShelf.register = function(record) {
    var list = CsShelf.list();
    CsShelf.put(list, record);
    return CsShelf.save(list);
};

/** Forgets one cave. The folder on disk is never touched. */
CsShelf.forget = function(folder) {
    var list = CsShelf.list();
    if (!CsShelf.remove(list, folder)) { return false; }
    return CsShelf.save(list);
};

/** The record for a folder, or null. */
CsShelf.find = function(folder) {
    var list = CsShelf.list();
    var at = CsShelf.indexOfFolder(list, folder);
    return at === -1 ? null : list[at];
};

/**
 * Drawing files in a cave folder: the folder itself, then one level of
 * subfolders. scans/ and PDF/ are skipped -- a DXF in either is not the
 * cave's map.
 */
CsShelf.drawingsIn = function(folder) {
    var out = [];
    if (typeof QDir === "undefined") { return out; }
    var root = CsShelf.clean(folder);
    if (root === "") { return out; }

    var filesIn = function(path) {
        var found = [];
        try {
            var dir = new QDir(path);
            if (!dir.exists()) { return found; }
            var names = dir.entryList([], QDir.Files | QDir.NoDotAndDotDot,
                QDir.Name);
            for (var i = 0; i < names.length; i++) {
                var n = String(names[i]);
                var ext = CsShelf.extension(n);
                if (ext === "dxf" || ext === "dwg") {
                    found.push(path + "/" + n);
                }
            }
        } catch (e) {
        }
        return found;
    };

    out = out.concat(filesIn(root));

    try {
        var dir = new QDir(root);
        if (dir.exists()) {
            var subs = dir.entryList([], QDir.Dirs | QDir.NoDotAndDotDot, 0);
            for (var i = 0; i < subs.length; i++) {
                var sub = String(subs[i]);
                var lower = sub.toLowerCase();
                if (lower === CsShelf.clean(CsCave.SCANS).toLowerCase() ||
                        lower === CsShelf.clean(CsCave.PDF).toLowerCase()) {
                    continue;
                }
                out = out.concat(filesIn(root + "/" + sub));
            }
        }
    } catch (e2) {
    }
    return out;
};

/**
 * Builds the record for a folder by looking inside it: the cave's name
 * is the folder's own name, the drawing is whichever file wins
 * pickDrawing. A folder with no drawing at all still yields a record --
 * a cave somebody registered before the first survey exists, and the
 * launcher shows it as having no drawing yet rather than refusing it.
 */
CsShelf.recordFor = function(folder) {
    var root = CsShelf.clean(folder);
    if (root === "") { return null; }
    var drawing = CsShelf.pickDrawing(CsShelf.drawingsIn(root), root);
    return CsShelf.normalize({
        name: CsShelf.basename(root),
        folder: root,
        drawing: drawing === null ? "" : drawing
    });
};

/**
 * Registers the cave a drawing was just saved into, so the shelf fills
 * itself from ordinary work instead of from the Add Cave button.
 *
 * Only under a drive root, matching CsCave.pointAtScans: a DXF saved to
 * the desktop is not a cave project, and a launcher that accumulated
 * every scratch drawing anybody ever saved would be useless within a
 * week.
 */
CsShelf.registerSaved = function(docPath) {
    if (typeof CsCave === "undefined") { return false; }
    var path = CsShelf.clean(docPath);
    if (path === "") { return false; }
    if (!CsCave.isUnderDrive(path, CsCave.driveRoots())) { return false; }

    var folder = CsCave.folderOf(path);
    if (folder === null) { return false; }

    return CsShelf.register({
        name: CsCave.nameOf(path),
        folder: folder,
        drawing: path
    });
};
