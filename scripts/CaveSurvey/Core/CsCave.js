// CsCave.js -- the cave folder on the shared drive, and nothing more.
//
// The survey group syncs cave folders through Google Drive, and Drive
// does the syncing. This file does NOT sync, version, lock, upload or
// authenticate. Its whole job is that the app knows the shape of a cave
// folder the moment a drawing is saved into one:
//
//     ALL DAY CAVE/            the cave, named the way people say it
//       All Day Cave.dxf       the drawing
//       scans/                 scanned hand sketches
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

// Makes sure this cave's scans/ folder exists, and points the stock
// image picker at it. Returns the folder, or null when there was
// nothing to do -- an unsaved drawing, or one outside every drive.
CsCave.pointAtScans = function(docPath) {
    if (typeof RSettings === "undefined" || typeof QDir === "undefined") {
        return null;
    }
    var scans = CsCave.scansDir(docPath);
    if (scans === null) { return null; }
    if (!CsCave.isUnderDrive(docPath, CsCave.driveRoots())) { return null; }
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
        var result = stock.apply(this, arguments);
        if (result === false) { return result; }
        try {
            if (typeof EAction !== "undefined") {
                var doc = EAction.getDocument();
                if (!isNull(doc)) { CsCave.pointAtScans(doc.getFileName()); }
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
