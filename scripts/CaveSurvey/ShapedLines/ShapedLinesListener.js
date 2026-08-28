// ShapedLinesListener.js -- keeps a shaped line's decoration on its
// spine while the caver edits with QCAD's OWN tools. Stretch the
// spine, drag a grip, rotate the selection: this hears the
// transaction and rebuilds the ticks or scallops.
//
// A structural clone of CalloutListener, because that file's shape is
// the survivor of every defect this pattern has produced. The same
// four hazards, handled the same ways:
//
//  1. RECURSION -- the busy flag, cleared in finally. And because a
//     queued signal can arrive after the flag clears, the REAL guard
//     is in CsShapeLine.decorate: an unchanged feature is a signature
//     compare and a return, never a write.
//  2. COST -- the gate reads XDATA only off objects the transaction
//     already touched. A drawing with no shaped lines pays one
//     queryEntity per affected object and nothing else.
//  3. A FREED RDocument cannot be detected and touching one
//     segfaults. The document argument is used synchronously and
//     never stored.
//  4. UNDO -- reconciliation joins the triggering edit's transaction
//     group, so one Ctrl+Z takes the caver's edit AND the reflow.
//
// Not a menu tool. Registers no RGuiAction. Installed once from
// CaveSurvey.js.

function ShapedLinesListener() {}

ShapedLinesListener.installed = false;

/** Re-entrancy guard. Also set by ShapedFlip/ShapedSync/ShapedLines
 *  around their own multi-operation writes, so the listener never
 *  reacts to a half-finished sequence of its own suite's making. */
ShapedLinesListener.busy = false;

ShapedLinesListener.install = function() {
    if (ShapedLinesListener.installed) {
        return false;
    }
    var appWin = RMainWindowQt.getMainWindow();
    if (isNull(appWin) || isNull(appWin.addTransactionListener)) {
        return false;   // headless: no window to listen to
    }
    var adapter;
    try {
        adapter = new RTransactionListenerAdapter();
        appWin.addTransactionListener(adapter);
        adapter.transactionUpdated.connect(ShapedLinesListener.onTransaction);
    } catch (e) {
        // Without the listener shaped lines still work; they just need
        // Sync Shaped Lines run by hand. Degrade, never crash startup.
        return false;
    }
    ShapedLinesListener.installed = true;
    return true;
};

/**
 * Every ShapeId touched by this transaction, or an empty object.
 * THE CHEAP GATE -- reads only objects the transaction names, and only
 * their XDATA.
 */
ShapedLinesListener.touchedIds = function(document, transaction) {
    var touched = {};
    var objIds;
    try {
        objIds = transaction.getAffectedObjects();
    } catch (e) {
        return touched;
    }
    for (var i = 0; i < objIds.length; i++) {
        var e = document.queryEntity(objIds[i]);
        if (isNull(e)) {
            continue;   // deleted, or not an entity
        }
        var sid = CsTags.get(e, CsShapeLine.KEY.ID);
        if (sid === "") {
            sid = CsTags.get(e, CsShapeLine.KEY.DECOR);
        }
        if (sid !== "") {
            touched[sid] = true;
        }
    }
    return touched;
};

ShapedLinesListener.onTransaction = function(document, transaction) {
    if (ShapedLinesListener.busy) {
        return;
    }
    if (isNull(document) || isNull(transaction)) {
        return;
    }

    var touched = ShapedLinesListener.touchedIds(document, transaction);
    var any = false;
    for (var probe in touched) {
        if (touched.hasOwnProperty(probe)) {
            any = true;
            break;
        }
    }
    if (!any) {
        return;   // the common case: nothing shaped was touched
    }

    // RDocument has NO getDocumentInterface in this build; the main
    // window is where a di comes from, and only when its current
    // document IS the one that changed (acting on another document
    // would resolve the ids against the wrong drawing).
    var appWin = RMainWindowQt.getMainWindow();
    if (isNull(appWin)) {
        return;
    }
    var di = appWin.getDocumentInterface();
    if (isNull(di)) {
        return;
    }
    var current = di.getDocument();
    if (isNull(current) || current.getFileName() !== document.getFileName()) {
        return;
    }

    var group = -1;
    try {
        group = transaction.getGroup();
    } catch (eG) {
        group = -1;
    }

    ShapedLinesListener.busy = true;
    try {
        for (var id in touched) {
            if (!touched.hasOwnProperty(id)) {
                continue;
            }
            try {
                CsShapeLine.reconcile(current, di, id, group);
            } catch (eOne) {
                // One broken feature must not stop the others, and must
                // never surface as a dialog mid-drag.
            }
        }
    } finally {
        ShapedLinesListener.busy = false;
    }
};
