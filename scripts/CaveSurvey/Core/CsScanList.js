// CsScanList.js -- the scans browser, as one list two panels share.
//
// Part of the Cave Survey Core library. GUI context (QTableWidget),
// like CsPanel and CsScanView; the model it draws is CsScanTree, which
// is pure and tested under node.
//
// WHY IT IS HERE. Sketch Scans grew a folder tree over a cave's
// scans/ -- collapsible, with a tick on every page a caver has
// finished with and on every trip whose pages are all done -- and the
// Survey Notebook needs the same thing for a different reason: the
// numbers being typed come off those pages, and "which have I done" is
// the same question in both places (Nathan, 2026-09-11: "not to have
// two different workflows for the same information").
//
// Two browsers over one folder would be two answers to that question.
// Worse, they would drift: a page marked done in one panel would still
// look undone in the other, and the mark is the only record of what a
// caver has actually worked through.
//
// A TREE ON A TABLE, because this bridge cannot construct a real
// QTreeWidget -- it is a wrapper-only stub, the same trap CaveShelf
// documents. So folders are rows that fold, drawn with an arrow and an
// indent, and CsScanTree decides what that means.

var CsScanList = {};

/** The tick. One character, so it costs a row nothing. */
CsScanList.COMPLETE = "✓";

/**
 * What the right-click menu calls marking a page finished with.
 *
 * HERE, so every panel showing this list says the same words. The
 * Survey Notebook's copy said "Finished with" while Sketch Scans said
 * "Mark Complete" -- the same act, the same setting, the same tick, and
 * two names for it, which is exactly the drift that sharing the list
 * was supposed to end (Nathan, 2026-09-11).
 */
CsScanList.MARK_COMPLETE = "Mark Complete";
CsScanList.MARK_INCOMPLETE = "Mark Incomplete";
CsScanList.MARK_FOLDER_COMPLETE = "Mark Folder Complete";
CsScanList.MARK_FOLDER_INCOMPLETE = "Mark Folder Incomplete";

// ---------------------------------------------------------------------
// The marks themselves. ONE STORE, READ-MODIFY-WRITE.
// ---------------------------------------------------------------------
//
// THE BUG THIS EXISTS FOR. Each panel kept its own copy of the
// completed set, loaded when it built its list, and wrote the WHOLE of
// that copy back on every toggle. So marking a page in one panel and
// then marking anything in the other undid the first: the second
// panel's copy predated the first panel's tick, and the whole-set
// write is what carried the stale answer to disk (Nathan, 2026-09-11:
// "'Mark Complete' is getting out of sync between the different
// pallets").
//
// Two fixes, and both are needed. A toggle now RE-READS the store,
// changes the one page it was asked about, and writes that back -- so
// a stale in-memory set cannot travel to disk at all. And a write
// ANNOUNCES itself, so the other panel repaints instead of sitting
// there showing a tick that is no longer true.

/** This cave's completed pages, freshly read. */
CsScanList.loadComplete = function(folder) {
    try {
        return CsScanTree.collapsedSetFor(CsScanTree.parseCollapsed(
            RSettings.getStringValue(CsScanTree.SETTING_BOOKMARKS, "")),
            folder);
    } catch (e) {
        return {};
    }
};

/**
 * Marks one page complete, or unmarks it, and answers the set as it
 * now stands on disk -- which is what the caller must draw from.
 *
 * `listedRels` is every FILE the calling panel listed: marks on pages
 * that are no longer there fall out rather than accreting forever.
 * Pass null when the caller has not listed the whole folder, and
 * nothing is pruned -- pruning against a partial list would delete
 * the marks on every page the caller happened not to show.
 */
CsScanList.toggleComplete = function(folder, rel, listedRels) {
    var set = CsScanList.loadComplete(folder);
    if (folder === null || folder === undefined || typeof rel !== "string" ||
            rel === "") {
        return set;
    }
    if (set[rel] === true) {
        delete set[rel];
    } else {
        set[rel] = true;
    }
    try {
        var map = CsScanTree.parseCollapsed(
            RSettings.getStringValue(CsScanTree.SETTING_BOOKMARKS, ""));
        var valid = listedRels;
        if (valid === null || valid === undefined) {
            // Nothing to prune against: keep every mark already stored
            // for this cave, plus whatever this call just changed.
            valid = [];
            for (var key in set) {
                if (set[key] === true) { valid.push(key); }
            }
        }
        CsScanTree.recordCollapsed(map, folder, set, valid);
        RSettings.setValue(CsScanTree.SETTING_BOOKMARKS,
            CsScanTree.serializeCollapsed(map));
    } catch (e) {
        // a bridge without RSettings forgets the mark; the panel still
        // shows what this call decided, for this session
    }
    CsScanList.announce(folder);
    return set;
};

/**
 * Panels that want to know when the marks change. ONE SLOT PER KEY, so
 * a panel that rebuilds its body replaces its own callback instead of
 * leaving the old one pointing at dead widgets.
 */
CsScanList.watchers = {};

CsScanList.watch = function(key, fn) {
    CsScanList.watchers[key] = fn;
};

/** Tells every panel but nobody in particular that this cave's marks
 *  moved. A watcher that throws is dropped: a panel whose widgets have
 *  gone must not stop the panel that is still on screen repainting. */
CsScanList.announce = function(folder) {
    for (var key in CsScanList.watchers) {
        try {
            CsScanList.watchers[key](folder);
        } catch (e) {
            delete CsScanList.watchers[key];
        }
    }
};

// ---------------------------------------------------------------------
// WHAT IS IN A CAVE'S scans FOLDER -- one answer, for every panel.
// ---------------------------------------------------------------------
//
// THE BUG THIS EXISTS FOR (Nathan, 2026-09-14: "trimmed images need to
// not show up in the scan view tree"). Sketch Scans listed the folder
// and filtered its own derivatives out; the Survey Notebook listed the
// same folder with a bare CsCave.filesUnder and filtered nothing. So
// every crop Scan Trim had ever written showed up as a page in the
// Notebook's tree, beside the page it was cut from -- the same drift
// sharing the LIST was supposed to end, in the one part that was still
// copied rather than shared: the listing itself.
//
// Three kinds of file are in that folder and are NOT pages of field
// notes:
//   - the map's own generated preview (CsCave.isPreviewName)
//   - Scan Trim's crops, under Trimmed/ (CsScanTrim.isTrimPath)
//   - a PDF that has already been split into page images beside it
//     (CsScanPdf) -- the pages ARE the trip now, and listing the PDF
//     too offers every page twice, once as itself and once inside a
//     file that previews as page 1.
//
// A PDF that has NOT been split still lists, and must: it is the only
// way to right-click it and split it.

/** The file patterns a scans folder is read with -- whatever this
 *  build's QImageReader can open, PDFs included, and a fixed list when
 *  it cannot be asked. */
CsScanList.scanFilters = function() {
    var filters = [];
    try {
        var formats = QImageReader.supportedImageFormats();
        for (var i = 0; i < formats.length; i++) {
            filters.push("*." + String(formats[i]));
        }
    } catch (e) {
        filters = [];
    }
    if (filters.length === 0) {
        filters = ["*.png", "*.jpg", "*.jpeg", "*.tif", "*.tiff",
            "*.bmp", "*.gif", "*.pdf"];
    }
    return filters;
};

/**
 * Every page under a cave's scans folder, as relative paths, in the
 * order the tree draws them.
 *
 * EVERY PANEL CALLS THIS. A panel that lists the folder itself is a
 * panel that will show a different set from the one beside it.
 */
CsScanList.scanFiles = function(folder, maxDepth) {
    var rels = [];
    try {
        rels = CsCave.filesUnder(folder, CsScanList.scanFilters(),
            isNull(maxDepth) ? 4 : maxDepth);
    } catch (eList) {
        return [];
    }
    return CsScanTree.keepScans(rels, function(rel) {
        return CsScanPdf.pageCount(folder + "/" + rel);
    });
};

/** What the right-click menu calls splitting a PDF. HERE, like the
 *  mark labels above, so every panel showing this list says the same
 *  words. */
CsScanList.SPLIT_PDF = "Split into Pages";

/**
 * Adds "Split into Pages" to a scan row's context menu, when that row
 * is a PDF.
 *
 * SHARED, and for the reason the whole file is: the scans tree appears
 * in Sketch Scans and in the Survey Notebook, and a right-click that
 * can split a trip in one of them and not the other is the same drift
 * as two different words for the tick.
 *
 * Does nothing for a row that is not a PDF, so a caller can call it on
 * every file row without asking first.
 *
 * \param menu    the QMenu being built
 * \param folder  the cave's scans folder, absolute
 * \param rel     the row's path, relative to it
 * \param onDone  called after a successful split, to re-list the folder
 */
CsScanList.addSplitAction = function(menu, folder, rel, onDone) {
    if (isNull(menu) || typeof rel !== "string" ||
            !CsScanPdf.isPdfPath(rel)) {
        return null;
    }
    var action = null;
    try {
        action = menu.addAction(qsTr(CsScanList.SPLIT_PDF));
    } catch (eAdd) {
        return null;
    }
    action.triggered.connect(function() {
        CsScanList.splitPdf(folder, rel, onDone);
    });
    return action;
};

/** What the right-click menu calls showing a scan in the file manager.
 *  Two names because it is two different applications, and a menu that
 *  says "Finder" on Linux is a menu written by somebody who has never
 *  run it there. */
CsScanList.REVEAL_MAC = "Reveal in Finder";
CsScanList.REVEAL_OTHER = "Open Containing Folder";

/** True when this machine has macOS's `open`. The label and the method
 *  both hang off this, and it is a file test rather than a platform
 *  string because the platform string is the thing that would be
 *  wrong on the one build nobody tested. */
CsScanList.hasMacOpen = function() {
    try {
        return new QFileInfo("/usr/bin/open").exists();
    } catch (e) {
        return false;
    }
};

/** The menu label for revealing, on this machine. */
CsScanList.revealLabel = function(isMac) {
    return (isMac === true) ? CsScanList.REVEAL_MAC :
        CsScanList.REVEAL_OTHER;
};

/**
 * Adds "Reveal in Finder" to a scan row's context menu.
 *
 * WHY A CAVER WANTS THIS. Everything else this suite does to a scan is
 * something it knows how to do -- mark it, trim it, split it. Renaming
 * a page, deleting a bad scan, dragging in forty more from a phone,
 * fixing a trip folder somebody named wrong: those are file
 * management, they happen in Finder, and the alternative is hunting
 * down a folder six levels inside a Google Drive mount by hand
 * (Nathan, 2026-09-14).
 *
 * A FILE ROW reveals the file itself, selected. A FOLDER ROW opens
 * that folder. Both are what the row points at.
 *
 * \param menu      the QMenu being built
 * \param folder    the cave's scans folder, absolute
 * \param rel       the row's path, relative to it
 * \param isFolder  true for a trip row, false for a page
 */
CsScanList.addRevealAction = function(menu, folder, rel, isFolder) {
    if (isNull(menu) || typeof folder !== "string" || folder === "" ||
            typeof rel !== "string") {
        return null;
    }
    var action = null;
    try {
        action = menu.addAction(
            qsTr(CsScanList.revealLabel(CsScanList.hasMacOpen())));
    } catch (eAdd) {
        return null;
    }
    // Plain strings in the closure and nothing else: a Qt wrapper held
    // across a deferred call is one of this bridge's crash modes.
    var target = folder + "/" + rel;
    var asFolder = (isFolder === true);
    action.triggered.connect(function() {
        CsScanList.reveal(target, asFolder);
    });
    return action;
};

/**
 * Shows one path in the machine's file manager.
 *
 * TWO WAYS, and the good one first. `open -R` reveals the file with it
 * SELECTED, which is the difference between "here is the folder, find
 * it again" and "here it is". Everything else gets
 * QDesktopServices.openUrl on the containing folder, which opens the
 * right window and selects nothing.
 *
 * THE LAUNCH TRAP (probed 2026-09-14): `QProcess.startDetached(prog,
 * args)` as a static does not exist here, and calling the INSTANCE
 * method with both arguments warns "Too many arguments, ignoring 2"
 * and returns false -- it would have launched `open` with no path at
 * all. setProgram + setArguments + startDetached() is the form that
 * works. Detached and not start(), because a QProcess collected at the
 * end of this function takes its child with it.
 */
CsScanList.reveal = function(absPath, isFolder) {
    var containing = absPath;
    if (isFolder !== true) {
        var cut = String(absPath).lastIndexOf("/");
        containing = (cut > 0) ? String(absPath).substring(0, cut) :
            String(absPath);
    }
    if (isFolder !== true && CsScanList.hasMacOpen()) {
        try {
            var proc = new QProcess();
            proc.setProgram("/usr/bin/open");
            proc.setArguments(["-R", absPath]);
            if (proc.startDetached() === true) {
                return true;
            }
        } catch (eProc) {
            // fall through to the folder, which is most of the answer
        }
    }
    try {
        return QDesktopServices.openUrl(QUrl.fromLocalFile(containing)) ===
            true;
    } catch (eUrl) {
        EAction.handleUserWarning(qsTr("This build could not open %1.")
            .arg(containing));
        return false;
    }
};

/**
 * Splits one PDF and says what happened.
 *
 * Its own function so the menu action's closure holds three strings
 * and nothing else -- a Qt wrapper captured in a deferred closure is
 * one of this bridge's crash modes.
 */
CsScanList.splitPdf = function(folder, rel, onDone) {
    var abs = folder + "/" + rel;
    var pages = CsScanPdf.pageCount(abs);
    if (pages < 1) {
        EAction.handleUserWarning(qsTr("%1 could not be read as a PDF.")
            .arg(rel));
        return;
    }
    // A HALF-SPLIT PDF is the only case that can overwrite anything: a
    // fully split one is not in the tree to be right-clicked. Ask,
    // because the pages it would replace may be ones a caver has
    // already trimmed and traced from.
    var existing = CsScanPdf.splitState(rel,
        CsCave.filesUnder(folder, ["*" + CsScanPdf.EXTENSION], 4), pages);
    if (existing === "partial") {
        var sure = QMessageBox.question(RMainWindowQt.getMainWindow(),
            qsTr("Split into Pages"),
            qsTr("Some pages of %1 have already been written. Split it " +
                "again and those files are overwritten. Continue?")
                .arg(rel),
            QMessageBox.Yes | QMessageBox.No);
        if (sure !== QMessageBox.Yes) {
            return;
        }
    }
    EAction.handleUserMessage(qsTr("Splitting %1 -- %2 pages at %3 dpi...")
        .arg(rel).arg(pages).arg(CsScanPdf.DPI));
    var res = CsScanPdf.split(abs);
    if (!res.ok) {
        EAction.handleUserWarning(qsTr("%1 was not split: %2")
            .arg(rel).arg(res.error));
        return;
    }
    EAction.handleUserMessage(qsTr("%1 is now %2 pages. The PDF itself " +
        "drops out of the list -- its pages are the trip now.")
        .arg(rel).arg(res.written.length));
    // The panel that was right-clicked re-lists through `onDone`. The
    // OTHER one picks the change up on its next refresh -- both re-read
    // the folder when their dock is re-shown -- because `announce`
    // carries a MARKS change and its watchers repaint ticks, they do
    // not re-walk the folder. Announcing anyway costs nothing and keeps
    // the ticks honest if a page name has gone.
    try {
        CsScanList.announce(folder);
    } catch (eTell) {
    }
    if (!isNull(onDone)) {
        try {
            onDone();
        } catch (eDone) {
        }
    }
};

/** The menu label for one page, given whether it is already marked. */
CsScanList.markLabel = function(marked) {
    return (marked === true) ? CsScanList.MARK_INCOMPLETE :
        CsScanList.MARK_COMPLETE;
};

/** The same, for a whole folder. */
CsScanList.folderMarkLabel = function(marked) {
    return (marked === true) ? CsScanList.MARK_FOLDER_INCOMPLETE :
        CsScanList.MARK_FOLDER_COMPLETE;
};

/**
 * Marks every page under a folder complete, or unmarks them all, and
 * answers the set as it now stands on disk.
 *
 * A TRIP AT A TIME, because that is how the pages arrive: a caver comes
 * back from a trip with forty scanned pages, works through them, and
 * the last thing they want is forty right-clicks to say so. The folder
 * tick already means "everything in here is done" (CsScanTree.
 * folderComplete), so this is the way to say it directly.
 *
 * ONE WRITE, not one per page. Every toggleComplete announces, and
 * forty announcements would have the other panel repaint forty times.
 *
 * Read-modify-write for the same reason toggleComplete is: the other
 * panel is marking the same pages, and writing this panel's whole copy
 * back is how the two undid each other.
 *
 * \param folderRel the folder's path relative to the scans folder
 * \param rows      the display rows, as CsScanTree.rowsOf returns
 * \param want      true to mark complete, false to unmark
 * \return the set as it now stands
 */
CsScanList.setFolderComplete = function(folder, folderRel, rows, want,
                                        listedRels) {
    var set = CsScanList.loadComplete(folder);
    if (folder === null || folder === undefined ||
            typeof folderRel !== "string" || folderRel === "" ||
            rows === null || rows === undefined) {
        return set;
    }
    var touched = CsScanTree.markFolder(set, folderRel, rows, want);
    if (touched === 0) {
        // Nothing changed, so nothing is written and nobody is told.
        return set;
    }
    try {
        var map = CsScanTree.parseCollapsed(
            RSettings.getStringValue(CsScanTree.SETTING_BOOKMARKS, ""));
        var valid = listedRels;
        if (valid === null || valid === undefined) {
            valid = [];
            for (var key in set) {
                if (set[key] === true) { valid.push(key); }
            }
        }
        CsScanTree.recordCollapsed(map, folder, set, valid);
        RSettings.setValue(CsScanTree.SETTING_BOOKMARKS,
            CsScanTree.serializeCollapsed(map));
    } catch (e) {
        // a bridge without RSettings forgets the marks; the panel still
        // shows what this call decided, for this session
    }
    CsScanList.announce(folder);
    return set;
};

/**
 * A list widget configured the way both panels want it.
 *
 * One column, no headers, rows selected whole, nothing editable.
 */
CsScanList.build = function(parent) {
    var table = new QTableWidget(0, 1, parent);
    try {
        table.horizontalHeader().visible = false;
        table.verticalHeader().visible = false;
        table.horizontalHeader().stretchLastSection = true;
        table.selectionBehavior = QAbstractItemView.SelectRows;
        table.editTriggers = QAbstractItemView.NoEditTriggers;
        table.alternatingRowColors = true;
    } catch (e) {
        // a bridge without the header accessors gets a table with
        // headers on, which is ugly and still usable
    }
    return table;
};

/**
 * What one row says: its indent, its fold arrow, its tick.
 *
 * A FOLDER IS TICKED WHEN EVERYTHING IN IT IS DONE -- open or
 * collapsed, since "this trip is finished" is worth seeing either way.
 * Ticking a folder that merely CONTAINS a finished page would put the
 * same mark on a trip with one page done as on one with forty.
 */
CsScanList.rowText = function(row, collapsed, complete, rows) {
    var indent = new Array(row.depth + 1).join("  ");
    var marks = complete || {};
    if (row.kind === "folder") {
        var folded = collapsed[row.rel] === true;
        var done = CsScanTree.folderComplete(row.rel, rows || [], marks);
        return indent + (folded ? "▸ " : "▾ ") + row.label +
            (done ? "  " + CsScanList.COMPLETE : "");
    }
    return indent + (marks[row.rel] === true ?
        CsScanList.COMPLETE + " " : "  ") + row.label;
};

/**
 * Draws the rows into the table.
 *
 * `opts.previewWidth` turns on the hover preview -- an <img> tooltip
 * over the page itself. Left out where a panel has the page on screen
 * anyway.
 */
CsScanList.fill = function(table, rows, state, opts) {
    var options = isNull(opts) ? {} : opts;
    var collapsed = isNull(state.collapsed) ? {} : state.collapsed;
    var complete = isNull(state.complete) ? {} : state.complete;
    try {
        table.setRowCount(0);
        table.setRowCount(rows.length);
    } catch (eCount) {
        return;
    }
    for (var i = 0; i < rows.length; i++) {
        var item = new QTableWidgetItem(
            CsScanList.rowText(rows[i], collapsed, complete, rows));
        if (rows[i].kind === "folder") {
            // Bold, clickable, but never SELECTED -- the selection
            // stays on a page while folders fold and unfold around it.
            try {
                var bold = item.font();
                bold.setBold(true);
                item.setFont(bold);
            } catch (eBold) {
            }
            try {
                item.setFlags(Qt.ItemIsEnabled);
            } catch (eFlags) {
            }
        } else if (!isNull(options.previewWidth) &&
                !isNull(state.folder)) {
            try {
                item.setToolTip("<img src=\"" + state.folder + "/" +
                    rows[i].rel + "\" width=\"" +
                    options.previewWidth + "\">");
            } catch (eTip) {
                // no hover preview on this bridge; the panel still works
            }
        }
        try {
            table.setItem(i, 0, item);
        } catch (eSet) {
        }
    }
    CsScanList.applyHidden(table, rows, collapsed);
};

/** Hides the rows inside collapsed folders. */
CsScanList.applyHidden = function(table, rows, collapsed) {
    try {
        for (var r = 0; r < rows.length; r++) {
            table.setRowHidden(r, CsScanTree.isHidden(rows[r], collapsed));
        }
    } catch (eHide) {
        // an engine without setRowHidden shows the list flat
    }
};

/** Redraws one row in place -- after a tick, or a fold. */
CsScanList.refreshRow = function(table, rows, state, index) {
    if (index < 0 || index >= rows.length) {
        return;
    }
    try {
        table.item(index, 0).setText(CsScanList.rowText(rows[index],
            isNull(state.collapsed) ? {} : state.collapsed,
            isNull(state.complete) ? {} : state.complete, rows));
    } catch (e) {
    }
};

/** The relative path the table has selected, or null when the
 *  selection is a folder or nothing. */
CsScanList.selectedRel = function(table, rows) {
    try {
        var at = table.currentRow();
        if (at < 0 || at >= rows.length) {
            return null;
        }
        return rows[at].kind === "file" ? rows[at].rel : null;
    } catch (e) {
        return null;
    }
};
