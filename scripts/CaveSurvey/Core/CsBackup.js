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

/** Set once a "could not write the backup" warning has been shown, so a
 *  broken guard says so without nagging on every save. */
CsBackup.warnedThisSession = false;

/** The (path, size, modified) already backed up, so the same bytes are
 *  not copied twice. A single Notebook Draw runs BOTH destructive
 *  operations -- eraseStations and CsProfileDraw.erase -- so without
 *  this it copies the whole drawing twice per draw for no gain: the file
 *  on disk cannot have changed in between, because only a save changes
 *  it. On a multi-megabyte cave redrawn repeatedly that is real churn. */
CsBackup.lastBackedUp = null;

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

/** True when a backup file for `path` is actually present. Checked
 *  alongside the fingerprint so a deleted .bak is remade rather than
 *  skipped because we remember making it once. */
CsBackup.hasBackup = function(path) {
    try {
        return new QFileInfo(String(path) + CsBackup.SUFFIX).exists();
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
 * WHY THERE IS NO "ON SAVE" HOOK, and there cannot be one from here.
 * Both candidates were tried and measured:
 *
 *   - Wrapping Save.prototype.save installs cleanly, reports success,
 *     and never runs. QCAD builds an action in its own script context
 *     (RScriptHandlerJs::createActionDocumentLevel), so the prototype
 *     patched from add-on init is not the prototype the action uses.
 *     CsCave.installSaveHook uses the same mechanism and is very likely
 *     just as inert.
 *   - RExportListenerAdapter's preExport/postExport/endOfExport fire
 *     ZERO times for RDocumentInterface::exportFile, which is what a
 *     save actually calls. Those signals belong to the graphics-export
 *     framework, not the DXF writer. Counted: 0, 0, 0.
 *
 * So the backup is taken at the moment that actually matters instead --
 * immediately before this suite's own destructive operations, from
 * CsDraw.eraseStations and CsProfileDraw.erase. That is a better moment
 * than a save anyway: it snapshots the last saved good file BEFORE the
 * tool that might gut the drawing runs, which is exactly the sequence
 * that destroyed a real survey.
 *
 * What it does not cover: a drawing damaged by hand and saved. QCAD's
 * own AutoSave is the separate net for that, and it keeps the CURRENT
 * state rather than the previous one.
 */

/**
 * Keep the previous version of `path`, and say so if it was due and
 * failed. The one entry point both hooks call.
 */
CsBackup.beforeWrite = function(path) {
    var due = CsBackup.worthKeeping(path) && !CsBackup.inGoogleDrive(path);
    if (!due) {
        return false;
    }

    // Already have this exact file? Then the backup on disk is the same
    // bytes and copying again buys nothing. Keyed on size AND modified
    // time, because only a save changes the file -- and a save changes
    // both.
    var stamp = null;
    try {
        var info = new QFileInfo(String(path));
        stamp = String(path) + "|" + info.size() + "|" +
            String(info.lastModified().toString());
    } catch (eStamp) {
        stamp = null;   // cannot fingerprint it: copy, do not guess
    }
    if (stamp !== null && CsBackup.lastBackedUp === stamp &&
            CsBackup.hasBackup(path)) {
        return true;
    }

    var made = CsBackup.copyPrevious(path);
    if (made && stamp !== null) {
        CsBackup.lastBackedUp = stamp;
    }
    if (!made && !CsBackup.warnedThisSession) {
        CsBackup.warnedThisSession = true;
        warning("Cave Survey: could not keep a backup of " + path +
            CsBackup.SUFFIX + ". Saving anyway -- but there is no " +
            "previous version to fall back on, so check the folder is " +
            "writable.");
    }
    return made;
};
