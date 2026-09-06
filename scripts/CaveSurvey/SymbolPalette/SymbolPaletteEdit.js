// SymbolPaletteEdit.js -- drawing a symbol of your own: the editor
// drawing, and saving what is in it back into the cave template.
//
// NOT an add-on QCAD can find. AddOn.getAddOns only builds an add-on
// from <dir>/<dir>.js, so SymbolPalette.init() calls this file's init().
//
// THE EDITOR IS A REAL DRAWING TAB, not a dialog with a canvas in it.
// A caver drawing a symbol wants the tools they already know -- lines,
// arcs, snapping, undo, zoom -- and every one of those is a CaveCAD
// action that needs a document to act on. So the editor is a document:
// an ordinary empty tab with an origin crosshair and a size reference
// in it, and the only unusual thing about it is that Save Symbol writes
// what it holds into the template instead of to a file.
//
// WHAT IS NOT SAVED. The crosshair and the reference circle are
// FURNITURE, tagged as such (FURNITURE_TAG), and skipped when the
// symbol is collected. A caver who deletes them still gets a symbol; a
// caver who leaves them does not get a symbol with a target drawn on
// it.

include("scripts/EAction.js");
include("scripts/File/NewFile/NewFile.js");
include(includeBasePath + "/../Core/CsAll.js");

var SymbolPaletteEdit = {};

/** Marks the editor's own scaffolding, so saving can leave it out. */
SymbolPaletteEdit.FURNITURE_TAG = "SymbolEditorFurniture";

/** The layer the furniture sits on inside the editor drawing.
 *  CTRL-HIDDEN is the suite's name for "scaffolding, not the map". */
SymbolPaletteEdit.FURNITURE_LAYER = "CTRL-HIDDEN";

/**
 * The size the reference circle is drawn at, in drawing units.
 *
 * ONE FOOT, which is roughly what the shipped symbols measure -- a
 * stalactite in the template is half a unit across. It is a sense of
 * scale and nothing more: nothing measures a symbol against it, and a
 * symbol drawn twice its size is placed twice as big, which is what
 * the palette's Scale field is for.
 */
SymbolPaletteEdit.REFERENCE_RADIUS = 0.5;

/**
 * The editing session, or null when no editor is open.
 *
 *   { di, block, meta, editing }
 *
 * `block` and `meta` are non-null only when an EXISTING symbol is being
 * edited; a new symbol has no name until it is saved. `di` is the
 * editor document's interface, and is what saveFromEditor checks the
 * current document against -- a caver who wanders back to their cave
 * map and presses Save Symbol must not have the map's contents written
 * into the template.
 */
SymbolPaletteEdit.session = null;

/** True when an editor drawing is open and current. */
SymbolPaletteEdit.isEditing = function() {
    return SymbolPaletteEdit.session !== null;
};

/**
 * The plan-frame registry layers a symbol may call home, sorted.
 *
 * FROM THE REGISTRY AND NOT FREE TEXT (Nathan's call, 2026-09-06): a
 * hand-typed layer is outside CsLayers.DEFAULTS, which means CsRestyle
 * cannot style it, twinFor gives it no profile or section counterpart,
 * and the template/registry agreement test does not know it exists. A
 * symbol bound to a real registry layer inherits all three for free.
 *
 * Sheet layers and CTRL- layers are excluded: a symbol lives in the
 * cave's linework, not in the sheet furniture or the survey mechanics.
 *
 * Pure.
 */
SymbolPaletteEdit.homeLayers = function() {
    var sheet = {};
    var i;
    for (i = 0; i < CsLayers.SHEET_LAYERS.length; i++) {
        sheet[CsLayers.SHEET_LAYERS[i]] = true;
    }
    var out = [];
    for (var name in CsLayers.DEFAULTS) {
        if (!CsLayers.DEFAULTS.hasOwnProperty(name)) {
            continue;
        }
        if (sheet[name] === true) {
            continue;
        }
        if (name.indexOf("CTRL-") === 0) {
            continue;
        }
        if (CsLayers.frameOf(name) !== "plan") {
            continue;   // the twins are derived, never chosen
        }
        out.push(name);
    }
    out.sort();
    return out;
};

/**
 * Opens an editor drawing.
 *
 * The one-shot setting suppresses CaveTemplateApply: every File > New
 * in this build pours the whole NSS cave template into the new
 * document, and a symbol editor that opens as a cave map with a title
 * block is not an editor.
 *
 * \return the new document interface, or null.
 */
SymbolPaletteEdit.openEditorDocument = function(title) {
    try {
        RSettings.setValue("CaveSurvey/TemplateOnNewSkipOnce", true);
    } catch (eSet) {
    }
    var child = null;
    try {
        child = NewFile.createMdiChild();
    } catch (eNew) {
        child = null;
    }
    if (isNull(child)) {
        try {
            RSettings.setValue("CaveSurvey/TemplateOnNewSkipOnce", false);
        } catch (eClear) {
        }
        return null;
    }
    var di = null;
    try {
        di = child.getDocumentInterface();
    } catch (eDi) {
        di = null;
    }
    if (isNull(di)) {
        return null;
    }
    try {
        // The tab's name says what it is. It has no file name, so Save
        // in this tab asks where to put a DXF -- which is a real thing
        // a caver might want (a symbol kept as a file) and is not how
        // the symbol reaches the palette.
        child.windowTitle = title;
    } catch (eTitle) {
    }
    return di;
};

/** Draws the origin crosshair and the size reference. */
SymbolPaletteEdit.addFurniture = function(doc, di) {
    try {
        CsLayers.ensure(doc, di, SymbolPaletteEdit.FURNITURE_LAYER);
    } catch (eEnsure) {
    }
    var r = SymbolPaletteEdit.REFERENCE_RADIUS;
    var pieces = [];
    try {
        pieces.push(new RLineEntity(doc, new RLineData(
            new RVector(-r * 1.4, 0), new RVector(r * 1.4, 0))));
        pieces.push(new RLineEntity(doc, new RLineData(
            new RVector(0, -r * 1.4), new RVector(0, r * 1.4))));
        pieces.push(new RCircleEntity(doc, new RCircleData(
            new RVector(0, 0), r)));
    } catch (eMake) {
        return;
    }
    var layerId = null;
    try {
        layerId = doc.getLayerId(SymbolPaletteEdit.FURNITURE_LAYER);
    } catch (eLayer) {
        layerId = null;
    }
    var op = new RAddObjectsOperation();
    for (var i = 0; i < pieces.length; i++) {
        try {
            CsTags.set(pieces[i], SymbolPaletteEdit.FURNITURE_TAG, "1");
            if (!isNull(layerId) && layerId !== RObject.INVALID_ID) {
                pieces[i].setLayerId(layerId);
            }
            op.addObject(pieces[i], false);
        } catch (eAdd) {
        }
    }
    try {
        // The furniture layer is OFF in the registry (CsLayers.OFF keeps
        // CTRL-HIDDEN off), and scaffolding a caver cannot see is
        // scaffolding that does not help. withLayerOn adds it and leaves
        // it visible for as long as this document exists -- which is
        // only ever the editor.
        CsLayers.withLayerOn(doc, di, SymbolPaletteEdit.FURNITURE_LAYER,
            function() {
                di.applyOperation(op);
            });
        var lay = doc.queryLayer(SymbolPaletteEdit.FURNITURE_LAYER);
        if (!isNull(lay)) {
            lay.setFrozen(false);
            var lop = new RModifyObjectOperation(lay);
            di.applyOperation(lop);
        }
    } catch (eApply) {
    }
};

/** Opens an empty editor for a brand new symbol. */
SymbolPaletteEdit.startNew = function() {
    if (SymbolPaletteEdit.isEditing()) {
        EAction.handleUserMessage(qsTr("A symbol editor is already open. " +
            "Save or close it first."));
        return;
    }
    var di = SymbolPaletteEdit.openEditorDocument(qsTr("New Symbol"));
    if (isNull(di)) {
        EAction.handleUserWarning("Symbol Palette: this CaveCAD build would not open a " +
            "drawing to draw the symbol in.");
        return;
    }
    SymbolPaletteEdit.addFurniture(di.getDocument(), di);
    SymbolPaletteEdit.session = { di: di, block: null, meta: null };
    SymbolPalette.enterEditorMode(qsTr("Draw the symbol around the " +
        "crosshair, then press Save Symbol."));
};

/**
 * Opens an editor holding an existing custom symbol's geometry.
 *
 * Only a custom symbol: CsSymbolStore.saveBlock refuses to write a
 * shipped name, so editing one could never be saved and offering it
 * would be a dead end with a dialog at the far side of it.
 */
SymbolPaletteEdit.startEdit = function(entry) {
    if (isNull(entry)) {
        return;
    }
    if (entry.custom !== true) {
        EAction.handleUserMessage(qsTr("%1 is one of the symbols the suite " +
            "ships and cannot be edited.").arg(entry.nss));
        return;
    }
    if (SymbolPaletteEdit.isEditing()) {
        EAction.handleUserMessage(qsTr("A symbol editor is already open. " +
            "Save or close it first."));
        return;
    }

    var path = CsSymbolStore.templatePath();
    var srcDi = isNull(path) ? null : CsSymbolStore.openOffscreen(path);
    if (srcDi === null) {
        EAction.handleUserWarning("Symbol Palette: the cave template could not be read, so " +
            entry.nss + " cannot be opened for editing.");
        return;
    }

    var di = SymbolPaletteEdit.openEditorDocument(
        qsTr("Symbol: %1").arg(entry.nss));
    if (isNull(di)) {
        EAction.handleUserWarning("Symbol Palette: this CaveCAD build would not open a " +
            "drawing to edit the symbol in.");
        return;
    }
    var doc = di.getDocument();
    SymbolPaletteEdit.addFurniture(doc, di);

    var entities = CsSymbolStore.geometryOf(srcDi.getDocument(), entry.block);
    var op = new RAddObjectsOperation();
    var copied = 0;
    var modelId = null;
    try {
        modelId = doc.getModelSpaceBlockId();
    } catch (eModel) {
        modelId = null;
    }
    for (var i = 0; i < entities.length; i++) {
        try {
            var e = entities[i];
            // adopt first, then every id: an entity still carrying the
            // template document's object id is read as an EDIT to
            // whatever that id names here, and lands nothing. See
            // CsSymbolStore.adopt.
            CsSymbolStore.adopt(doc, e);
            if (!isNull(modelId) && modelId !== RObject.INVALID_ID) {
                e.setBlockId(modelId);
            }
            e.setLayerId(doc.getLayerId("0"));
            op.addObject(e, false);
            copied++;
        } catch (eCopy) {
        }
    }
    if (copied > 0) {
        try {
            di.applyOperation(op);
        } catch (eApply) {
        }
    }
    try {
        di.autoZoom();
    } catch (eZoom) {
    }

    SymbolPaletteEdit.session = { di: di, block: entry.block, meta: entry };
    SymbolPalette.enterEditorMode(qsTr("Editing %1. Press Save Symbol when " +
        "you are done.").arg(entry.nss));
};

/**
 * Everything in the editor that is the SYMBOL: model-space entities
 * that are not furniture.
 *
 * Model space only, so a caver who happens to define a block inside the
 * editor does not get its definition entities collected twice -- once
 * as the block and once loose.
 */
SymbolPaletteEdit.collect = function(doc) {
    var out = [];
    var ids;
    try {
        ids = doc.queryAllEntities(false, false);
    } catch (eQ) {
        return out;
    }
    var modelId = null;
    try {
        modelId = doc.getModelSpaceBlockId();
    } catch (eModel) {
        modelId = null;
    }
    for (var i = 0; i < ids.length; i++) {
        var e = null;
        try {
            e = doc.queryEntity(ids[i]);
        } catch (eE) {
            continue;
        }
        if (isNull(e)) {
            continue;
        }
        if (CsTags.get(e, SymbolPaletteEdit.FURNITURE_TAG) === "1") {
            continue;
        }
        if (!isNull(modelId) && modelId !== RObject.INVALID_ID) {
            try {
                if (e.getBlockId() !== modelId) {
                    continue;
                }
            } catch (eBlk) {
            }
        }
        out.push(e);
    }
    return out;
};

/**
 * Asks for the symbol's name, category and home layer.
 *
 * \return {nss, uis, category, layer} or null when cancelled.
 */
SymbolPaletteEdit.askMeta = function(existing) {
    var dlg = new QDialog(RMainWindowQt.getMainWindow());
    dlg.windowTitle = qsTr("Save Symbol");
    var v = new QVBoxLayout();

    v.addWidget(new QLabel(qsTr("Name")), 0, 0);
    var nameEdit = new QLineEdit(isNull(existing) ? "" : existing.nss);
    v.addWidget(nameEdit, 0, 0);

    v.addWidget(new QLabel(qsTr("Other name (UIS), optional")), 0, 0);
    var uisEdit = new QLineEdit(isNull(existing) ? "" : existing.uis);
    v.addWidget(uisEdit, 0, 0);

    v.addWidget(new QLabel(qsTr("Category")), 0, 0);
    var catCombo = new QComboBox();
    catCombo.editable = true;   // a new category is a legitimate answer
    var cats = CsSymbols.categoriesOf(CsSymbols.merged().entries);
    for (var c = 0; c < cats.length; c++) {
        catCombo.addItem(cats[c]);
    }
    if (!isNull(existing) && !isNull(existing.category)) {
        catCombo.setEditText(existing.category);
    }
    v.addWidget(catCombo, 0, 0);

    v.addWidget(new QLabel(qsTr("Layer it lives on")), 0, 0);
    var layerCombo = new QComboBox();
    var layers = SymbolPaletteEdit.homeLayers();
    for (var l = 0; l < layers.length; l++) {
        layerCombo.addItem(layers[l]);
    }
    // Selected by NAME, never by index: a hardcoded index silently
    // selects the wrong row the moment the registry gains a layer.
    var want = isNull(existing) ? CsLayers.BREAKDOWN : existing.layer;
    for (var s = 0; s < layers.length; s++) {
        if (layers[s] === want) {
            layerCombo.currentIndex = s;
            break;
        }
    }
    layerCombo.toolTip = qsTr("The layer this symbol is placed on in the " +
        "plan. Its elevation and cross-section layers are derived from " +
        "this one, so a symbol dropped in a band lands on the right twin " +
        "without you choosing again.");
    v.addWidget(layerCombo, 0, 0);

    var bb = new QDialogButtonBox(QDialogButtonBox.Ok |
        QDialogButtonBox.Cancel);
    bb.accepted.connect(dlg, "accept");
    bb.rejected.connect(dlg, "reject");
    v.addWidget(bb, 0, 0);
    dlg.setLayout(v);

    if (dlg.exec() !== QDialog.Accepted) {
        dlg.destroy();
        return null;
    }
    var meta = {
        nss: String(nameEdit.text).trim(),
        uis: String(uisEdit.text).trim(),
        category: String(catCombo.currentText).trim(),
        layer: String(layerCombo.currentText)
    };
    dlg.destroy();
    if (meta.category === "") {
        meta.category = CsSymbolStore.DEFAULT_CATEGORY;
    }
    return meta;
};

/**
 * Saves what the editor holds into the template.
 *
 * Every refusal happens BEFORE anything is written, and each one names
 * what to do about it: a symbol half-written into a template is a
 * template a caver has to repair by hand.
 */
SymbolPaletteEdit.save = function() {
    var session = SymbolPaletteEdit.session;
    if (session === null) {
        return;
    }
    var di = session.di;
    if (isNull(di)) {
        SymbolPaletteEdit.finish();
        return;
    }
    // The editor's OWN document, not whichever tab is in front. A caver
    // who clicked back to their cave map and pressed Save Symbol would
    // otherwise write the whole map into the template as one symbol.
    var doc = null;
    try {
        doc = di.getDocument();
    } catch (eDoc) {
        doc = null;
    }
    if (isNull(doc)) {
        QMessageBox.warning(RMainWindowQt.getMainWindow(),
            qsTr("Save Symbol"),
            qsTr("The symbol editor's drawing has been closed, so there is " +
                "nothing to save."));
        SymbolPaletteEdit.finish();
        return;
    }

    var entities = SymbolPaletteEdit.collect(doc);
    if (entities.length === 0) {
        QMessageBox.warning(RMainWindowQt.getMainWindow(),
            qsTr("Save Symbol"),
            qsTr("There is nothing to save: draw the symbol first. (The " +
                "crosshair and the circle are guides, not geometry.)"));
        return;
    }

    var meta = SymbolPaletteEdit.askMeta(session.meta);
    if (meta === null) {
        return;
    }
    if (meta.nss === "") {
        QMessageBox.warning(RMainWindowQt.getMainWindow(),
            qsTr("Save Symbol"), qsTr("A symbol needs a name."));
        return;
    }

    // An EDIT keeps its block name whatever the display name became --
    // renaming the block would leave every already-placed instance
    // pointing at a name that no longer exists.
    var blockName = session.block;
    if (isNull(blockName)) {
        blockName = CsSymbolStore.blockNameFor(meta.nss);
    }
    if (blockName === null) {
        QMessageBox.warning(RMainWindowQt.getMainWindow(),
            qsTr("Save Symbol"),
            qsTr("That name has no letters or numbers in it, so it cannot " +
                "become a block name. Try another."));
        return;
    }
    if (isNull(session.block)) {
        var clash = null;
        var merged = CsSymbols.merged();
        for (var i = 0; i < merged.entries.length; i++) {
            if (merged.entries[i].block === blockName) {
                clash = merged.entries[i];
                break;
            }
        }
        if (clash !== null) {
            QMessageBox.warning(RMainWindowQt.getMainWindow(),
                qsTr("Save Symbol"),
                qsTr("There is already a symbol called %1 (%2). Give this " +
                    "one a different name.").arg(clash.nss).arg(blockName));
            return;
        }
    }

    var res = CsSymbolStore.saveBlock(null, blockName, doc, entities, meta);
    if (!res.ok) {
        QMessageBox.warning(RMainWindowQt.getMainWindow(),
            qsTr("Save Symbol"), res.error);
        return;
    }

    EAction.handleUserMessage(qsTr("%1 saved to the cave template as %2.")
        .arg(meta.nss).arg(blockName));
    SymbolPaletteEdit.finish();

    // The palette rebuilds from the template, so the new symbol appears
    // and is armed -- a caver who just drew a symbol wants to place it.
    try {
        SymbolPalette.rebuildTiles();
        var listed = CsSymbols.merged();
        for (var j = 0; j < listed.entries.length; j++) {
            if (listed.entries[j].block === blockName) {
                SymbolPalette.arm(listed.entries[j]);
                break;
            }
        }
    } catch (eRefresh) {
    }
};

/** Abandons the editing session. The editor DRAWING is left open: it
 *  may hold work, and closing a document out from under a caver to
 *  tidy up a panel is not a trade this tool gets to make. */
SymbolPaletteEdit.cancel = function() {
    SymbolPaletteEdit.finish();
};

/** Ends the session and puts the panel back into placing mode. */
SymbolPaletteEdit.finish = function() {
    SymbolPaletteEdit.session = null;
    try {
        SymbolPalette.leaveEditorMode();
    } catch (e) {
    }
};

SymbolPaletteEdit.init = function(basePath) {
    // No widget names, no sort order, no icon: this is reached from the
    // Symbol Palette panel and never from a menu. The variable is
    // deliberately NOT called "action" -- test_sort_orders_are_unique
    // reads "action.setSortOrder" out of the folder-named file, and a
    // second match there would make which one it reads a coin flip.
    var editAction = new RGuiAction(qsTr("Edit Symbol"),
        RMainWindowQt.getMainWindow());
    editAction.setRequiresDocument(false);
    editAction.setScriptFile(basePath + "/SymbolPaletteEdit.js");
};
