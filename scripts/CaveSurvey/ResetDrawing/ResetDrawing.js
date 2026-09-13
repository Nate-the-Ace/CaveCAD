/**
 * ResetDrawing.js
 *
 * Empty a cave drawing completely, without touching the cave's folder.
 *
 *   Cave Survey > Reset Drawing   (or type "rd")
 *
 * For teaching a class the same starting point twice, and for testing a
 * tool against a project that does not have to be rebuilt by hand every
 * run. Nothing in the drawing survives -- survey, linework, symbols,
 * notes, sections, the placed sketch scans and the aerial basemap, and
 * the georeference with them -- because every one of those is put there
 * by a tool a student is here to learn. The scans and the imagery
 * themselves stay on disk, so all of it can be done again.
 *
 * The rules -- what a refusal says, what the counts mean -- are in
 * Core/CsReset.js and are tested under node; this file is the walk, the
 * dialog and the delete.
 *
 * ORDER IS THE SAFETY PROPERTY, not the dialog. The backup is written
 * BEFORE the confirmation is even shown, and a backup that does not
 * write stops the tool. A typed cave name is the second guard, not the
 * first.
 */
include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");

function ResetDrawing(guiAction) {
    EAction.call(this, guiAction);
}

ResetDrawing.prototype = new EAction();

ResetDrawing.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    resetDrawingRun();
    this.terminate();
};

/** One entity's facts, in the shape CsReset's pure half reads. The
 *  entity kind is read only so that images can be COUNTED apart -- it
 *  no longer decides anything's fate. */
ResetDrawing.infoFor = function(entity) {
    var isImage = false;
    try {
        isImage = (typeof isImageEntity === "function") &&
            isImageEntity(entity) === true;
    } catch (e) {
        isImage = false;
    }
    var layer = "";
    try {
        layer = String(entity.getLayerName());
    } catch (eL) {
        layer = "";
    }
    return { isImage: isImage, layer: layer };
};

/**
 * Walks model space and counts what is about to go.
 *
 * Model space only (allBlocks false). A symbol's BLOCK DEFINITION is
 * not drawing content -- the inserts that reference it are, and those
 * are in model space. Reaching into the definitions would empty the
 * symbol library the palette expects to find.
 *
 * \return {ids: [deleted ids], counts}
 */
ResetDrawing.classify = function(doc) {
    var ids = [];
    var infos = [];
    var all = doc.queryAllEntities(false, false);
    for (var i = 0; i < all.length; i++) {
        var e = doc.queryEntityDirect(all[i]);
        if (isNull(e)) {
            continue;
        }
        var info = ResetDrawing.infoFor(e);
        infos.push(info);
        if (!CsReset.keepsEntity(info)) {
            ids.push(all[i]);
        }
    }
    return { ids: ids, counts: CsReset.tally(infos) };
};

/**
 * Runs fn with EVERY layer editable -- neither off, frozen, nor locked
 * -- and puts each one back afterwards.
 *
 * LOCKED IS CLEARED HERE, which CsLayers.withLayersOn deliberately will
 * not do. That restraint is right for a tool writing into one layer: a
 * caver locked it to stop things changing. It is wrong for a reset,
 * because a locked layer does not refuse LOUDLY -- it refuses in
 * silence, and the drawing comes back looking emptied while whatever
 * was locked quietly survived. That exact hole is how a sanitized
 * package once shipped with the aerial photograph still in it.
 */
ResetDrawing.withEveryLayerEditable = function(doc, di, fn) {
    var restore = [];
    var op = null;
    try {
        var layerIds = doc.queryAllLayers();
        for (var i = 0; i < layerIds.length; i++) {
            var lay = doc.queryLayer(layerIds[i]);
            if (isNull(lay)) {
                continue;
            }
            var was = { name: String(lay.getName()), off: false,
                frozen: false, locked: false };
            try {
                if (lay.isOff()) { lay.setOff(false); was.off = true; }
            } catch (eOff) {
            }
            try {
                if (lay.isFrozen()) { lay.setFrozen(false); was.frozen = true; }
            } catch (eFrozen) {
            }
            try {
                if (lay.isLocked()) { lay.setLocked(false); was.locked = true; }
            } catch (eLock) {
            }
            if (was.off || was.frozen || was.locked) {
                if (op === null) {
                    op = new RModifyObjectsOperation();
                }
                op.addObject(lay, false);
                restore.push(was);
            }
        }
    } catch (eWalk) {
    }
    if (op !== null) {
        try {
            di.applyOperation(op);
        } catch (eApply) {
            restore = [];   // nothing landed, nothing to put back
        }
    }

    var result, thrown = null, didThrow = false;
    try {
        result = fn();
    } catch (eFn) {
        thrown = eFn;
        didThrow = true;
    }

    if (restore.length > 0) {
        try {
            var back = new RModifyObjectsOperation();
            var any = false;
            for (var r = 0; r < restore.length; r++) {
                var lay2 = doc.queryLayer(restore[r].name);
                if (isNull(lay2)) {
                    continue;
                }
                if (restore[r].off) { lay2.setOff(true); }
                if (restore[r].frozen) { lay2.setFrozen(true); }
                if (restore[r].locked) { lay2.setLocked(true); }
                back.addObject(lay2, false);
                any = true;
            }
            if (any) {
                di.applyOperation(back);
            }
        } catch (eBack) {
            // visibility is a nicety; the delete already landed
        }
    }
    if (didThrow) {
        throw thrown;
    }
    return result;
};

/** Deletes every id in one operation. \return how many went. */
ResetDrawing.deleteAll = function(doc, di, ids) {
    if (ids.length === 0) {
        return 0;
    }
    var del = new RDeleteObjectsOperation();
    var n = 0;
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntityDirect(ids[i]);
        if (!isNull(e)) {
            del.deleteObject(e);
            n++;
        }
    }
    di.applyOperation(del);
    return n;
};

/** The cave folder this drawing sits in, or null when it is not in one.
 *  A cave project has a scans/ folder; that is what makes it one. */
ResetDrawing.caveFolderOf = function(path) {
    var folder = CsCave.folderOf(path);
    if (folder === null) {
        return null;
    }
    return CsCave.findSubfolder(folder, CsCave.SCANS) === null ? null : folder;
};

function resetDrawingRun() {
    var doc = getDocument();
    if (isNull(doc)) {
        warning(qsTr("Reset Drawing: no active drawing document."));
        return;
    }
    // A SHEET IS NOT A DRAWING TO WORK IN -- it is rebuilt from the
    // cave's record every time Build Sheet is pressed.
    if (CsSheetFile.blocks(doc, "Reset Drawing")) {
        return;
    }
    var di = getDocumentInterface();

    var path = "";
    try {
        path = String(doc.getFileName());
    } catch (eP) {
        path = "";
    }
    var caveFolder = ResetDrawing.caveFolderOf(path);
    var caveName = CsCave.nameOf(path);
    var split = ResetDrawing.classify(doc);

    var plan = CsReset.planReset({
        hasDocument: true,
        isSheet: false,
        docPath: path,
        inCaveFolder: caveFolder !== null,
        caveName: caveName,
        counts: split.counts
    });
    if (!plan.can) {
        try {
            QMessageBox.information(getMainWindow(), qsTr("Reset Drawing"),
                plan.reason);
        } catch (eI) {
            EAction.handleUserMessage(plan.reason);
        }
        return;
    }

    // THE BACKUP COMES FIRST, and a backup that will not write stops
    // the tool. The dialog below is the second guard, never the only
    // one.
    var backupPath = "";
    if (CsBackup.copyPrevious(path) !== true) {
        var why = qsTr("Reset Drawing: could not write a copy of the " +
            "drawing into its backup folder, so nothing has been " +
            "changed. Check that ") + String(caveFolder) +
            qsTr("/backup can be written to.");
        try {
            QMessageBox.warning(getMainWindow(), qsTr("Reset Drawing"), why);
        } catch (eW) {
            EAction.handleUserMessage(why);
        }
        return;
    }
    try {
        var gens = CsBackup.generations(path);
        if (gens.length > 0) {
            backupPath = CsBackup.backupFolderFor(path) + "/" +
                gens[gens.length - 1];
        }
    } catch (eG) {
        backupPath = "";
    }

    // doc.isModified(), NOT di.isModified(): the document interface has
    // no such method in this build and answers a TypeError, which a
    // guarded read turns into "not modified" -- so the warning about
    // unsaved work would simply never appear. Probed live, 2026-09-13.
    var modified = false;
    try {
        modified = doc.isModified() === true;
    } catch (eM) {
        modified = false;
    }

    if (!ResetDrawing.confirm(caveName, split.counts, backupPath, modified)) {
        return;
    }

    // The georeference rides an entity and goes with it: nothing here
    // reads or re-commits it. That is deliberate -- declaring the cave's
    // location is one of the steps a class is here to practise, and a
    // location quietly surviving a reset is one the student never
    // learns to set.
    ResetDrawing.withEveryLayerEditable(doc, di, function() {
        ResetDrawing.deleteAll(doc, di, split.ids);
    });
    // The layer table last, so the drawing a class opens carries the
    // current palette and every layer the template has, not whatever
    // the previous student left behind.
    CsRestyle.ensureAndApply(doc, di);

    var done = CsReset.doneText({ counts: split.counts,
        backupPath: backupPath });
    try {
        QMessageBox.information(getMainWindow(), qsTr("Reset Drawing"),
            done.join("\n"));
    } catch (eD) {
        EAction.handleUserMessage(done[0]);
    }
}

/**
 * The confirmation: a counted summary, and a box the cave's name has to
 * be typed into before OK will do anything.
 *
 * A reset in front of a class must not be one stray Return away, which
 * is why the default button is Cancel and why OK starts disabled.
 */
ResetDrawing.buildConfirm = function(caveName, counts, backupPath,
        modified) {
    var dlg = new QDialog(getMainWindow());
    dlg.windowTitle = qsTr("Reset Drawing") +
        (caveName === null ? "" : " \u2014 " + caveName);
    var layout = new QVBoxLayout();
    var label = new QLabel(CsReset.summaryText({
        caveName: caveName, counts: counts, backupPath: backupPath,
        modified: modified
    }).join("\n"));
    label.wordWrap = true;
    layout.addWidget(label, 0, 0);

    var edit = new QLineEdit();
    edit.text = "";
    layout.addWidget(edit, 0, 0);

    // HAND-BUILT BUTTONS, not a QDialogButtonBox. The box's own
    // button(QDialogButtonBox.Ok) is how you would normally reach the
    // OK button to disable it, and nothing else in this add-on has ever
    // called it -- an unproven wrapper method here would fail the way
    // the GUI always fails in this bridge, silently and only in front
    // of a caver. Two QPushButtons are what CsLocationPick.askText
    // already uses and are known to work.
    var bar = new QHBoxLayout();
    var okBtn = new QPushButton(qsTr("Reset"));
    var cancelBtn = new QPushButton(qsTr("Cancel"));
    okBtn.enabled = false;      // the typed name is what enables it
    try {
        cancelBtn["default"] = true;    // a stray Return cancels
    } catch (eDef) {
    }
    bar.addStretch(1);
    bar.addWidget(okBtn, 0, 0);
    bar.addWidget(cancelBtn, 0, 0);
    layout.addLayout(bar, 0);
    dlg.setLayout(layout);

    edit.textChanged.connect(function(text) {
        try {
            okBtn.enabled = CsReset.matchesName(text, caveName);
        } catch (eT) {
        }
    });
    okBtn.clicked.connect(function() { dlg.accept(); });
    cancelBtn.clicked.connect(function() { dlg.reject(); });

    return { dlg: dlg, edit: edit, okBtn: okBtn, cancelBtn: cancelBtn };
};

/**
 * Shows it, and answers whether the reset was confirmed.
 *
 * Split from buildConfirm so the dialog can be BUILT and inspected
 * without exec()ing it -- a modal exec blocks the application until a
 * human dismisses it, which makes the one kind of failure this build
 * specialises in (a widget that silently does nothing) impossible to
 * check any other way.
 */
ResetDrawing.confirm = function(caveName, counts, backupPath, modified) {
    var built = ResetDrawing.buildConfirm(caveName, counts, backupPath,
        modified);
    var accepted = (built.dlg.exec() === QDialog.Accepted);
    // destroy() throws on every QDialog in this build; close and hand
    // it to Qt instead, guarded -- tearing down a dialog must never
    // cost the answer just given to it.
    try {
        built.dlg.close();
        built.dlg.deleteLater();
    } catch (eClose) {
    }
    return accepted;
};

ResetDrawing.init = function(basePath) {
    var action = new RGuiAction(qsTr("Reset Drawing"),
        RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/ResetDrawing.js");
    action.setIcon(basePath + "/ResetDrawing.svg");
    action.setStatusTip(qsTr("Empty this drawing for a fresh start, " +
        "keeping its images and the cave's location"));
    // NOT "reset": that is QCAD's own command (scripts/Reset), and the
    // loser of a clash is whichever registers second.
    action.setDefaultCommands(["resetdrawing", "rd"]);
    // Beside Teaching Cave: both are doors onto a starting point rather
    // than tools that draw.
    action.setGroupSortOrder(450);
    action.setSortOrder(41);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
