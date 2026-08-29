// CsCave.js -- the cave folder on the shared drive, and nothing more.
//
// The survey group syncs cave folders through Google Drive, and Drive
// does the syncing. This file does NOT sync, version, lock, upload or
// authenticate. Its whole job is that the app knows the shape of a cave
// folder the moment a drawing is saved into one:
//
//     ALL DAY CAVE/            the cave, named the way people say it
//       All Day Cave.dxf       the drawing
//       All Day Cave-aerial.png  the basemap, when one was fetched
//       scans/                 scanned hand sketches
//       PDF/                   produced maps
//       images/                photographs, and the map's own preview
//
// PDF/ is where finished maps are kept, and nothing in the suite ever
// writes one: plotting a sheet is the cartographer's job, and Package
// Cave Project only COLLECTS what it finds there. Its name is matched
// case-insensitively -- "PDF", "pdf" and "Pdf" are all the same folder
// to a surveyor, and on Linux they are three different folders to
// QDir.
//
// That is the entire convention. No marker file, no index, no slug --
// a cave folder is simply the folder a cave drawing was saved in, which
// is what the group already does (BIG Survey Group holds ALL DAY CAVE,
// BC Pit, IU Show Cave, TRUITT CAVE exactly like this).
//
// WHAT IT ACTUALLY BUYS. QCAD's stock image insert opens wherever the
// setting "Image/Path" last pointed -- read at Draw/Image/Image.js:144,
// written back at :229. Point that at this cave's scans/ folder when a
// cave drawing is saved and Draw > Image opens on the sketches for the
// cave in front of you, with no dialog wrapped and no tool replaced.
//
// SCANS/ IS ONLY EVER CREATED UNDER A SHARED DRIVE. Making one beside
// every DXF anyone saves anywhere would litter directories that have
// nothing to do with caving; making one only under the drive folder
// means the empty folder that appears is always somewhere it belongs.

var CsCave = {};

CsCave.SCANS = "scans";
CsCave.PDF = "PDF";
CsCave.IMAGES = "images";

// The folders a cave project keeps beside its drawing.
// Where CsBackup keeps previous versions, datestamped. Part of the
// standard structure so a cave folder has one whether or not a backup
// has been taken yet -- an empty backup/ says the guard exists; a
// missing one says nothing.
CsCave.BACKUP = "backup";
CsCave.SUBFOLDERS = [CsCave.SCANS, CsCave.PDF, CsCave.IMAGES, CsCave.BACKUP];

// The map's own preview lives in images/ with the photographs, under a
// name derived from the drawing, so a person looking in that folder can
// tell the generated picture from the ones they put there.
CsCave.PREVIEW_SUFFIX = " preview.png";

// PHOTOGRAPHS OF A CAVE ARE LOCATION DATA. An entrance photograph shows
// where the entrance is, and a phone writes the coordinates into the
// file besides. Nothing here reads or strips EXIF, so images/ is
// treated exactly like scans/ when a project is packaged: left out of a
// sanitized package unless somebody asks for it by name. See
// PackageCave.js.

/** The images folder for a cave folder, as it exists, or null. */
CsCave.imagesFolderOf = function(folder) {
    return CsCave.findSubfolder(folder, CsCave.IMAGES);
};

/**
 * Where the map preview for a drawing belongs: inside the cave's own
 * images folder, named after the drawing.
 *
 * \return the path, or null when the drawing has no folder.
 */
CsCave.previewPathFor = function(docPath) {
    var folder = CsCave.folderOf(docPath);
    if (folder === null) { return null; }
    var stem = docPath.substring(folder.length + 1);
    var dot = stem.lastIndexOf(".");
    if (dot > 0) { stem = stem.substring(0, dot); }
    if (stem === "") { return null; }
    var images = CsCave.imagesFolderOf(folder);
    if (images === null) { images = folder + "/" + CsCave.IMAGES; }
    return images + "/" + stem + CsCave.PREVIEW_SUFFIX;
};

/** True for the generated preview, as opposed to somebody's photograph. */
CsCave.isPreviewName = function(name) {
    if (typeof name !== "string") { return false; }
    return name.length > CsCave.PREVIEW_SUFFIX.length &&
        name.substring(name.length - CsCave.PREVIEW_SUFFIX.length) ===
            CsCave.PREVIEW_SUFFIX;
};

// An explicit drive folder, when the automatic answer is wrong -- a
// second account, a non-default mount, a group that keeps caves on
// Dropbox or a file server instead. Empty means "detect".
CsCave.SETTING_ROOT = "CaveSurvey/CaveRoot";

// ---------------------------------------------------------------------
// Pure half -- no Q* or R* globals, so tests/js_unit.js can reach it.
// ---------------------------------------------------------------------

// The folder a drawing lives in. Forward slashes only: Qt reports file
// paths with "/" on every platform this add-on targets, Windows too.
CsCave.folderOf = function(docPath) {
    if (typeof docPath !== "string" || docPath.length === 0) { return null; }
    var slash = docPath.lastIndexOf("/");
    if (slash <= 0) { return null; }
    return docPath.substring(0, slash);
};

// The cave's name, for messages: the folder's own name.
CsCave.nameOf = function(docPath) {
    var folder = CsCave.folderOf(docPath);
    if (folder === null) { return null; }
    var slash = folder.lastIndexOf("/");
    var name = (slash === -1) ? folder : folder.substring(slash + 1);
    return name.length > 0 ? name : null;
};

CsCave.scansDir = function(docPath) {
    var folder = CsCave.folderOf(docPath);
    return folder === null ? null : folder + "/" + CsCave.SCANS;
};

CsCave.pdfDir = function(docPath) {
    var folder = CsCave.folderOf(docPath);
    return folder === null ? null : folder + "/" + CsCave.PDF;
};

// Is this file name a PDF? Extension only, case-insensitive -- the
// packager trusts the folder, not the bytes.
CsCave.isPdfName = function(name) {
    if (typeof name !== "string") { return false; }
    return /\.pdf$/i.test(name);
};

// Is this drawing inside one of the drive folders?
//
// Prefix matching with a trailing separator, so "/x/GoogleDrive-me" does
// not swallow "/x/GoogleDrive-metoo". A path already inside a scans/
// folder still answers true -- it is under the drive either way, and
// deciding otherwise is scansDir's business, not this function's.
CsCave.isUnderDrive = function(docPath, roots) {
    if (typeof docPath !== "string" || docPath.length === 0) { return false; }
    if (Object.prototype.toString.call(roots) !== "[object Array]") {
        return false;
    }
    for (var i = 0; i < roots.length; i++) {
        var r = roots[i];
        if (typeof r !== "string" || r.length === 0) { continue; }
        var base = r.replace(/\/+$/, "");
        if (base.length === 0) { continue; }
        if (docPath.indexOf(base + "/") === 0) { return true; }
    }
    return false;
};

// ---------------------------------------------------------------------
// Runtime half -- Qt and settings. Every function here degrades to a
// no-op rather than throwing: a folder convenience may never be the
// reason a save or a startup fails.
// ---------------------------------------------------------------------

// Where Google Drive for Desktop mounts. On macOS the current client
// uses ~/Library/CloudStorage/GoogleDrive-<account>/, one per signed-in
// account, and older installs leave a ~/Google Drive. Both are listed
// when both exist, because a surveyor with two accounts has caves under
// whichever one the group shared with.
//
// An explicit CsCave.SETTING_ROOT wins outright -- if someone has said
// where the caves are, do not go looking somewhere else.
CsCave.driveRoots = function() {
    var roots = [];
    if (typeof RSettings === "undefined" || typeof QDir === "undefined") {
        return roots;
    }
    try {
        var set = RSettings.getStringValue(CsCave.SETTING_ROOT, "");
        if (typeof set === "string" && set.length > 0) {
            return [set.replace(/\/+$/, "")];
        }
    } catch (e) {
    }
    try {
        var home = QDir.homePath();
        var cloud = home + "/Library/CloudStorage";
        var dir = new QDir(cloud);
        if (dir.exists()) {
            var names = dir.entryList([], QDir.Dirs | QDir.NoDotAndDotDot, 0);
            for (var i = 0; i < names.length; i++) {
                var n = String(names[i]);
                if (n.indexOf("GoogleDrive") === 0) {
                    roots.push(cloud + "/" + n);
                }
            }
        }
        if ((new QDir(home + "/Google Drive")).exists()) {
            roots.push(home + "/Google Drive");
        }
    } catch (e2) {
    }
    return roots;
};

// A subfolder of `folder` whose name matches `name` however it was
// cased, or null. macOS does not care about the difference; Linux does,
// and a cave folder that came off somebody else's machine can hold
// "pdf" where this one would have made "PDF".
CsCave.findSubfolder = function(folder, name) {
    if (typeof QDir === "undefined") { return null; }
    if (typeof folder !== "string" || folder === "" ||
            typeof name !== "string" || name === "") {
        return null;
    }
    try {
        var dir = new QDir(folder);
        if (!dir.exists()) { return null; }
        var wanted = name.toLowerCase();
        var names = dir.entryList([], QDir.Dirs | QDir.NoDotAndDotDot, 0);
        for (var i = 0; i < names.length; i++) {
            var n = String(names[i]);
            if (n.toLowerCase() === wanted) { return folder + "/" + n; }
        }
    } catch (e) {
    }
    return null;
};

// The cave's PDF folder as it exists on disk, whatever its casing, or
// null when there is none. Read-only: this never creates anything.
CsCave.pdfFolderOf = function(folder) {
    return CsCave.findSubfolder(folder, CsCave.PDF);
};

// Natural, case-insensitive ordering: digit runs compare as NUMBERS,
// everything else as lowercased text. Surveyors name trip folders by
// date -- "4-6-24 Survey Scans" -- and scanners number pages --
// "Page_10.jpg" -- and a plain string sort puts November before April
// and page 10 before page 2. Ties on equal numbers ("03" vs "3") fall
// back to plain string order so the ordering stays total and
// deterministic.
CsCave.compareNatural = function(a, b) {
    var sa = String(a), sb = String(b);
    var la = sa.toLowerCase(), lb = sb.toLowerCase();
    var ia = 0, ib = 0;
    var digits = /[0-9]/;
    while (ia < la.length && ib < lb.length) {
        var ca = la.charAt(ia), cb = lb.charAt(ib);
        if (digits.test(ca) && digits.test(cb)) {
            var ja = ia, jb = ib;
            while (ja < la.length && digits.test(la.charAt(ja))) { ja++; }
            while (jb < lb.length && digits.test(lb.charAt(jb))) { jb++; }
            var na = parseInt(la.substring(ia, ja), 10);
            var nb = parseInt(lb.substring(ib, jb), 10);
            if (na !== nb) { return na < nb ? -1 : 1; }
            ia = ja; ib = jb;
            continue;
        }
        if (ca !== cb) { return ca < cb ? -1 : 1; }
        ia++; ib++;
    }
    // one ran out: the shorter (a prefix of the longer) comes first
    var restA = la.length - ia, restB = lb.length - ib;
    if (restA !== restB) { return restA < restB ? -1 : 1; }
    // numerically equal all the way through ("03" vs "3"): plain order
    return sa < sb ? -1 : (sa > sb ? 1 : 0);
};

// Every file under `folder` matching the QDir name filters, as paths
// RELATIVE to `folder`, sorted naturally (dates and page numbers in
// human order -- see compareNatural). Recurses into
// subfolders down to `maxDepth` levels (0 = the folder itself only),
// skipping hidden ones. Surveyors keep scans in per-trip subfolders
// ("scans/2025 Scans/9-7-25 Survey Scans/..."), so a flat listing of
// scans/ itself sees nothing.
CsCave.filesUnder = function(folder, filters, maxDepth) {
    if (typeof QDir === "undefined") { return []; }
    if (typeof folder !== "string" || folder === "") { return []; }
    if (typeof maxDepth !== "number" || maxDepth < 0) { maxDepth = 4; }
    var out = [];
    var walk = function(abs, rel, depth) {
        var dir = new QDir(abs);
        if (!dir.exists()) { return; }
        var files = dir.entryList(filters, QDir.Files, QDir.Name);
        var i;
        for (i = 0; i < files.length; i++) {
            out.push(rel + String(files[i]));
        }
        if (depth >= maxDepth) { return; }
        var subs = dir.entryList([], QDir.Dirs | QDir.NoDotAndDotDot,
            QDir.Name);
        for (i = 0; i < subs.length; i++) {
            var name = String(subs[i]);
            if (name.charAt(0) === ".") { continue; }
            walk(abs + "/" + name, rel + name + "/", depth + 1);
        }
    };
    try {
        walk(folder, "", 0);
    } catch (e) {
        // an unreadable folder reads as empty
    }
    out.sort(CsCave.compareNatural);
    return out;
};

// The photographs in a cave's images folder -- everything except the
// preview this suite generates. Name-sorted, full paths.
CsCave.imageFiles = function(folder, includePreview) {
    var out = [];
    if (typeof QDir === "undefined") { return out; }
    var images = CsCave.imagesFolderOf(folder);
    if (images === null) { return out; }
    try {
        var dir = new QDir(images);
        var names = dir.entryList([], QDir.Files | QDir.NoDotAndDotDot, QDir.Name);
        for (var i = 0; i < names.length; i++) {
            var n = String(names[i]);
            if (n.indexOf(".") === 0) { continue; }
            if (includePreview !== true && CsCave.isPreviewName(n)) { continue; }
            out.push(images + "/" + n);
        }
    } catch (e) {
    }
    return out;
};

// Every PDF in a cave's PDF folder, as full paths, name-sorted.
// An absent folder and an empty one both answer [] -- "no maps" is a
// normal state for a cave nobody has plotted yet, not an error.
CsCave.pdfFiles = function(folder) {
    var out = [];
    if (typeof QDir === "undefined") { return out; }
    var pdfDir = CsCave.pdfFolderOf(folder);
    if (pdfDir === null) { return out; }
    try {
        var dir = new QDir(pdfDir);
        var names = dir.entryList([], QDir.Files | QDir.NoDotAndDotDot, QDir.Name);
        for (var i = 0; i < names.length; i++) {
            var n = String(names[i]);
            if (CsCave.isPdfName(n)) { out.push(pdfDir + "/" + n); }
        }
    } catch (e) {
    }
    return out;
};

// Creates the folders a cave project keeps (scans/, PDF/) inside an
// EXISTING cave folder, skipping any that are already there under any
// casing.
//
// Same restraint as pointAtScans: only under a drive root, so the app
// never scatters empty folders through directories that have nothing to
// do with caving. `force` is for the launcher's own New Cave flow,
// where the user just said in so many words that this folder is a cave.
//
// \return the folders created (possibly empty), or null when there was
// nothing to do.
CsCave.ensureProjectFolders = function(folder, force) {
    if (typeof QDir === "undefined") { return null; }
    if (typeof folder !== "string" || folder === "") { return null; }
    if (force !== true && !CsCave.isUnderDrive(folder + "/x", CsCave.driveRoots())) {
        return null;
    }
    var made = [];
    try {
        if (!(new QDir(folder)).exists()) { return null; }
        for (var i = 0; i < CsCave.SUBFOLDERS.length; i++) {
            var sub = CsCave.SUBFOLDERS[i];
            if (CsCave.findSubfolder(folder, sub) !== null) { continue; }
            var path = folder + "/" + sub;
            if ((new QDir()).mkpath(path)) { made.push(path); }
        }
    } catch (e) {
        return made;
    }
    return made;
};

/**
 * Writes a drawing's preview picture into its cave project (images/),
 * and into the application's own thumbnail cache as well so the stock
 * recent-files list shows the same picture.
 *
 * \param image a QImage, normally RDocumentInterface.getThumbnail()
 * \return true if a picture landed somewhere.
 */
CsCave.writePreview = function(docPath, image) {
    var wrote = false;
    var usable = false;
    try {
        usable = image !== undefined && image !== null && !image.isNull();
    } catch (eNull) {
        usable = false;
    }

    // No picture in hand? The stock save has just handed one to
    // RSettings.addRecentFile, which wrote it to the application cache
    // -- so take it from there. The thumbnail on the document interface
    // is only refreshed from a graphics view WITH FOCUS, and a save that
    // happens while a dialog is up (importing a cave is exactly that)
    // finds no focused view and leaves it empty.
    if (!usable) {
        return CsCave.copyCachedPreview(docPath);
    }

    var put = function(target) {
        if (target === null || target === undefined) { return false; }
        try {
            var info = new QFileInfo(String(target));
            info.dir().mkpath(".");
            return image.save(String(target), "PNG") === true;
        } catch (e) {
            return false;
        }
    };

    if (put(CsCave.previewPathFor(docPath))) { wrote = true; }
    try {
        if (typeof RSettings !== "undefined" &&
                typeof RSettings.getThumbnailFilePath === "function") {
            if (put(RSettings.getThumbnailFilePath(docPath))) { wrote = true; }
        }
    } catch (eCache) {
    }
    return wrote;
};

/**
 * Copies the application's cached thumbnail for a drawing into the
 * cave's images/ folder. The fallback for a save with no focused view.
 *
 * \return true if a picture landed.
 */
CsCave.copyCachedPreview = function(docPath) {
    if (typeof RSettings === "undefined" ||
            typeof RSettings.getThumbnailFilePath !== "function") {
        return false;
    }
    try {
        var cached = String(RSettings.getThumbnailFilePath(docPath));
        var info = new QFileInfo(cached);
        if (!info.exists() || info.size() === 0) { return false; }

        var target = CsCave.previewPathFor(docPath);
        if (target === null) { return false; }
        (new QFileInfo(String(target))).dir().mkpath(".");
        if ((new QFileInfo(String(target))).exists()) {
            (new QFile(String(target))).remove();
        }
        return (new QFile(cached)).copy(String(target)) === true;
    } catch (e) {
        return false;
    }
};

// Makes sure this cave's scans/ folder exists, and points the stock
// image picker at it. Returns the folder, or null when there was
// nothing to do -- an unsaved drawing, or one outside every drive.
CsCave.pointAtScans = function(docPath) {
    if (typeof RSettings === "undefined" || typeof QDir === "undefined") {
        return null;
    }
    var folder = CsCave.folderOf(docPath);
    if (folder === null) { return null; }
    if (!CsCave.isUnderDrive(docPath, CsCave.driveRoots())) { return null; }

    // The folder as it EXISTS, whatever its casing -- real cave folders
    // in the wild carry "Scans" as often as "scans", and building the
    // path literally makes a second folder beside the first on any
    // case-sensitive filesystem.
    var scans = CsCave.findSubfolder(folder, CsCave.SCANS);
    if (scans === null) { scans = CsCave.scansDir(docPath); }
    if (scans === null) { return null; }
    try {
        if (!(new QDir(scans)).exists() && !(new QDir()).mkpath(scans)) {
            return null;
        }
        // The key QCAD's own image insert reads for its starting
        // directory (Draw/Image/Image.js:144) and writes back to (:229).
        RSettings.setValue("Image/Path", scans);
        return scans;
    } catch (e) {
        return null;
    }
};

// Runs pointAtScans after every successful save.
//
// Wrapping the prototype rather than asking each caller to opt in: a
// hook you have to remember to call is a hook that is off on the
// machine that needed it. Idempotent by marker, because init() can run
// more than once and a wrapper that wraps itself does its work twice.
CsCave.installSaveHook = function() {
    if (typeof Save === "undefined") {
        if (typeof include === "function") {
            try { include("scripts/File/Save/Save.js"); } catch (e) {}
        }
    }
    if (typeof Save === "undefined" || !Save.prototype ||
            typeof Save.prototype.save !== "function") {
        return false;
    }
    if (Save.prototype.save.csCaveWrapped === true) { return true; }
    var stock = Save.prototype.save;
    var wrapped = function() {
        // Refresh the drawing's thumbnail from the view BEFORE the save
        // runs. The stock save hands di.getThumbnail() to
        // RSettings.addRecentFile, which is what writes the PNG into
        // the cache -- but NOTHING in the application ever calls
        // updateThumbnail(), so the image handed over is empty and the
        // cache stays empty with it. One call here gives every saved
        // cave a picture, and the cave shelf shows it.
        var thumbDi = null;
        try {
            thumbDi = EAction.getDocumentInterface();
            if (!isNull(thumbDi) && isFunction(thumbDi.updateThumbnail)) {
                thumbDi.updateThumbnail();
            }
        } catch (eThumb) {
            // A picture is never a reason a save fails.
        }

        var result = stock.apply(this, arguments);
        if (result === false) { return result; }
        try {
            if (typeof EAction !== "undefined") {
                var doc = EAction.getDocument();
                if (!isNull(doc)) {
                    var savedPath = doc.getFileName();
                    CsCave.pointAtScans(savedPath);
                    // A cave saved under a drive root puts itself on the
                    // launcher's shelf, so the list fills from ordinary
                    // work rather than from the Add Cave button, and
                    // gains the folders a cave project keeps.
                    if (typeof CsShelf !== "undefined") {
                        CsShelf.registerSaved(savedPath);
                    }
                    CsCave.ensureProjectFolders(CsCave.folderOf(savedPath));
                    // The picture refreshed above, kept where the cave
                    // keeps its images rather than only in this
                    // machine's cache.
                    if (!isNull(thumbDi) && isFunction(thumbDi.getThumbnail)) {
                        CsCave.writePreview(savedPath, thumbDi.getThumbnail());
                    }
                }
            }
        } catch (e) {
            // A folder convenience never breaks a save.
        }
        return result;
    };
    wrapped.csCaveWrapped = true;
    Save.prototype.save = wrapped;
    return true;
};
