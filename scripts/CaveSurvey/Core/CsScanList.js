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
