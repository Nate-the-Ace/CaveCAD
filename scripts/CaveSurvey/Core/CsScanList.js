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

/** The menu label for one page, given whether it is already marked. */
CsScanList.markLabel = function(marked) {
    return (marked === true) ? CsScanList.MARK_INCOMPLETE :
        CsScanList.MARK_COMPLETE;
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
