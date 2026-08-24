// CsBackup.js -- keep the previous version of a drawing beside it.
//
// Part of the Cave Survey Core library. On every save, the file that is
// about to be overwritten is copied to <name>.dxf.bak first. One
// generation, in the same folder as the drawing.
//
// WHY THIS EXISTS. A Survey Notebook redraw is erase-then-draw across
// two separate operations. If the draw fails after the erase has landed,
// the drawing is left gutted -- and a save then writes that over the
// only copy. That happened: a real drawing went from 312 entities to
// 170, losing its whole survey, and there was nothing to go back to.
//
// The specific draw failure is a bug to fix on its own. This is the
// guard for the general case: any tool, any failure, any future bug of
// the same shape. A tool that can destroy a drawing must not also be the
// only thing standing between the user and losing it.
//
// WHAT THIS IS NOT. Not a version history -- one generation only, so a
// SECOND bad save overwrites the good backup. Not a crash recovery
// system either; QCAD's own AutoSave covers that, and differently: it
// snapshots the CURRENT state periodically, which would have captured
// the gutted drawing just as happily. This keeps the PREVIOUS state,
// which is the thing that was missing.
//
// SKIPPED INSIDE GOOGLE DRIVE, by decision: Drive keeps its own version
// history for what it syncs, so a .bak beside a synced drawing is
// clutter. Worth knowing what that trades away -- Drive's history is a
// manual rollback through the web UI, bounded to 100 revisions or 30
// days by default, and only covers what actually synced. The drawing
// this was written for lived on the local disk outside Drive entirely,
// which is why it had nothing at all.

var CsBackup = {};

/** Appended to the drawing's own name, so the backup sits beside it and
 *  sorts next to it. Not a hidden file: a backup nobody can see is a
 *  backup nobody remembers to use. */
CsBackup.SUFFIX = ".bak";

/**
 * Google Drive roots on this machine, canonical, only those that exist.
 *
 * Both spellings: the modern per-account mount under CloudStorage, and
 * the older ~/Google Drive, which is often a symlink to it -- hence
 * canonical paths, so the two do not read as different places.
 *
 * Discovered rather than hardcoded to one account: a machine can have
 * several, and a hardcoded address would silently stop matching the day
 * the account changes.
 */
CsBackup.driveRoots = function() {
    var out = [];
    var add = function(path) {
        try {
            var info = new QFileInfo(path);
            if (!info.exists() || !info.isDir()) {
                return;
            }
            var canon = info.canonicalFilePath();
            if (isNull(canon) || String(canon).length === 0) {
                canon = info.absoluteFilePath();
            }
            for (var i = 0; i < out.length; i++) {
                if (out[i] === String(canon)) {
                    return;
                }
            }
            out.push(String(canon));
        } catch (e) {
            // an unreadable candidate is simply not a root
        }
    };

    var home = QDir.homePath();
    try {
        var cloud = new QDir(home + "/Library/CloudStorage");
        if (cloud.exists()) {
            var names = cloud.entryList(makeQDirFilters(QDir.NoDotAndDotDot,
                QDir.Dirs), makeQDirSortFlags(QDir.NoSort));
            for (var i = 0; i < names.length; i++) {
                if (String(names[i]).indexOf("GoogleDrive") === 0) {
                    add(home + "/Library/CloudStorage/" + names[i]);
                }
            }
        }
    } catch (eCloud) {
        // no CloudStorage on this machine
    }
    add(home + "/Google Drive");
    return out;
};

/**
 * True when `path` sits inside a Google Drive folder.
 *
 * Drive keeps its own version history for files it syncs, so a local
 * .bak beside a synced drawing is redundant clutter -- the user's call,
 * and a fair one.
 *
 * What it costs, stated once: Drive's history is a manual rollback
 * through the web UI, bounded (100 revisions or 30 days by default), and
 * it only holds what actually synced. A local .bak is none of those
 * things. So this returning true is a decision to trust Drive, not proof
 * the file is recoverable.
 *
 * Compared on CANONICAL paths, so a symlinked route into Drive counts.
 * Anything unreadable answers false, which errs toward writing a
 * backup -- the safe direction when the question is whether data is
 * protected.
 */
CsBackup.inGoogleDrive = function(path) {
    if (isNull(path) || String(path).length === 0) {
        return false;
    }
    var canon;
    try {
        var info = new QFileInfo(String(path));
        canon = info.canonicalFilePath();
        if (isNull(canon) || String(canon).length === 0) {
            canon = info.absoluteFilePath();
        }
        canon = String(canon);
    } catch (e) {
        return false;
    }
    var roots = CsBackup.driveRoots();
    for (var i = 0; i < roots.length; i++) {
        if (canon === roots[i] || canon.indexOf(roots[i] + "/") === 0) {
            return true;
        }
    }
    return false;
};

/** True when `path` names a file that exists and holds something. An
 *  empty file is not worth preserving and would overwrite a good backup
 *  with nothing -- the one way this feature could itself lose data. */
CsBackup.worthKeeping = function(path) {
    if (isNull(path) || String(path).length === 0) {
        return false;
    }
    try {
        var info = new QFileInfo(path);
        return info.exists() && info.size() > 0;
    } catch (e) {
        return false;
    }
};

/**
 * Copies `path` to `path` + SUFFIX, replacing any previous backup.
 *
 * Returns true only when a backup now exists holding the old bytes.
 * Every failure is a false, never a throw: this runs on the way into a
 * save, and a backup that cannot be written must not be the reason a
 * caver cannot save their work.
 */
CsBackup.copyPrevious = function(path) {
    if (!CsBackup.worthKeeping(path)) {
        return false;   // nothing to preserve: a first save, or no file
    }
    if (CsBackup.inGoogleDrive(path)) {
        return false;   // Drive versions it; see inGoogleDrive
    }
    var bak = String(path) + CsBackup.SUFFIX;
    try {
        // QFile.copy refuses an existing target, so the old backup goes
        // first. That is the one moment there is no backup at all, which
        // is why it is immediately followed by the copy and nothing else.
        var existing = new QFile(bak);
        if (existing.exists() && !existing.remove()) {
            return false;
        }
        return new QFile(String(path)).copy(bak);
    } catch (e) {
        return false;
    }
};

/**
 * Wraps Save so the previous version is kept before it is overwritten.
 * Idempotent. QCAD context only.
 *
 * The same monkey-patch CsCave.installSaveHook uses, on purpose -- one
 * established way of hooking a save in this suite rather than two. The
 * difference is the side: CsCave runs AFTER a successful save, this runs
 * BEFORE, because by the time the save has returned the previous version
 * is already gone.
 *
 * The path comes from the document, so this covers Save. A Save As to a
 * different path overwrites that destination without a backup -- worth
 * knowing, and worth fixing when the pre-save destination can be read.
 *
 * \return true when the hook is installed
 */
CsBackup.installSaveHook = function() {
    if (typeof Save === "undefined") {
        if (typeof include === "function") {
            try { include("scripts/File/Save/Save.js"); } catch (e) {}
        }
    }
    if (typeof Save === "undefined" || !Save.prototype ||
            typeof Save.prototype.save !== "function") {
        return false;
    }
    if (Save.prototype.save.csBackupWrapped === true) {
        return true;
    }

    var stock = Save.prototype.save;
    var wrapped = function() {
        try {
            if (typeof EAction !== "undefined") {
                var doc = EAction.getDocument();
                if (!isNull(doc)) {
                    CsBackup.copyPrevious(doc.getFileName());
                }
            }
        } catch (e) {
            // A failed backup NEVER blocks a save. Refusing to save
            // because we could not make a copy would be its own way of
            // losing work.
        }
        return stock.apply(this, arguments);
    };
    wrapped.csBackupWrapped = true;
    Save.prototype.save = wrapped;
    return true;
};
