/**
 * SectionEdit -- reopen a sketched section's bay and carry on tracing.
 *
 * WHY REOPENING RATHER THAN BLOCK EDITING. The scan is the point. A
 * section traced from a field book is revised AGAINST that field book,
 * and editing the block in place would mean re-inserting and
 * re-scaling the scan by hand every time. The reference carries the
 * scan path and the fit, so the bay comes back with the scan already
 * where the caver left it -- the revision framework's rule one kind
 * over: the drawing is reconstructible from what is stored on it.
 *
 * THE SECTION EXISTS IN EXACTLY ONE PLACE AT A TIME. Reopening DELETES
 * the placed reference, its leaders and the now-empty block definition,
 * and puts the linework loose in the bay; Capture puts it back. A
 * drawing showing both at once would print both.
 *
 * MOVED, NEVER CLONED -- one kind over from SectionCapture's own probe
 * (see that file's header). Probed again 2026-08-30, this direction:
 * setBlockId()+move() on the ORIGINAL entities queried out of the block
 * survives being committed in the SAME operation as deleting the (by
 * then empty) block definition -- nothing vanishes, because nothing was
 * ever cloned. A clone()+delete-the-source here would walk straight
 * into the same trap that broke the sweep the other direction: this
 * file deletes the block definition in the very same operation that
 * empties it, which is exactly "the entity it was cloned from deleted
 * in this op or a later one."
 *
 * THE EMPTIED BLOCK DEFINITION IS DELETED, NOT LEFT BEHIND. Every
 * capture mints a fresh CalloutId (CsCallout.newId()), so a re-capture
 * after this edit never refills THIS definition -- left in place, it
 * would be dead weight, once per edit, forever. Probed 2026-08-30:
 * doc.queryBlock(id) returns a real RBlock object; RemoveBlock.js (this
 * build's own "delete a block" tool, scripts/Block/RemoveBlock/
 * RemoveBlock.js) deletes one with RDeleteObjectsOperation, but a plain
 * RAddObjectsOperation's own deleteObject() takes a block object too,
 * on the SAME operation as the content move, one undo step for the
 * whole reopen. The entities already moved out are untouched by it --
 * confirmed by the same probe, run both as two operations and as one.
 *
 * THE SCAN COMES BACK AT ITS STORED SCALE, NOT A FRESH GUESS. SketchSection.
 * addScan auto-fits a scan to the CURRENT ghost, but a sketch's tracing
 * never regenerates (SOURCE_SKETCH is refreshSections' gate) while the
 * survey underneath it can still drift, so "the current ghost" and "the
 * ghost this tracing was drawn against" are not always the same shape.
 * This tool never hands SketchSection.run a scan path at all; it places
 * the scan itself afterward, from the fit STORED on the reference
 * (SECTION_FIT), scaled exactly as recorded and simply re-centred on
 * wherever this bay landed -- frameRectFor parks against the CURRENT
 * plan extents, so the bay itself can move even when the ghost does
 * not.
 *
 * USAGE:
 *   select a sketched section, then
 *   Cave Survey > Edit Sketch   (or "sectionedit" / "ske")
 */
include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");
include(includeBasePath + "/../Callout/CalloutWrite.js");
include(includeBasePath + "/SketchSection.js");

function SectionEdit(guiAction) {
    EAction.call(this, guiAction);
}

SectionEdit.prototype = new EAction();

SectionEdit.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    SectionEdit.run();
    this.terminate();
};

SectionEdit.run = function() {
    var doc = EAction.getDocument();
    var di = EAction.getDocumentInterface();
    if (isNull(doc) || isNull(di)) {
        return;
    }
    var ref = SectionEdit.selectedSection(doc);
    if (ref === null) {
        SketchSection.say(qsTr("Select the cross section to edit " +
            "first -- click the section itself, not its leader."));
        return;
    }
    if (CsTags.get(ref, CsCallout.KEY.SECTION_SOURCE) !==
            CsCallout.SOURCE_SKETCH) {
        SketchSection.say(qsTr("That section was computed from the " +
            "survey's own LRUD, not traced, so there is no sketch to " +
            "reopen.\n\nDraw re-derives it whenever the survey changes."));
        return;
    }

    var station = CsTags.get(ref, CsCallout.KEY.SECTION_STATION);
    var scan = CsTags.get(ref, CsCallout.KEY.SECTION_SCAN);
    var fit = CsSectionBay.parseFit(CsTags.get(ref, CsCallout.KEY.SECTION_FIT));

    // Checked BEFORE the bay opens, and the path is never handed to
    // SketchSection.run -- that function's own addScan would show its
    // OWN "could not be read" message for exactly this case, and this
    // tool never delegates scan placement to it at all (see the file
    // header), so a bad path only ever produces ONE message, not two.
    var scanExists = scan !== "" && (new QFile(scan)).exists();
    if (scan !== "" && !scanExists) {
        SketchSection.say(qsTr("The scan this section was traced from " +
            "is not where it was:\n\n%1\n\nThe bay is open with the " +
            "tracing and the outline; the underlay is missing.")
            .arg(scan));
    }

    var bayId = SketchSection.run(null, station);
    if (bayId === null) {
        return;
    }

    if (scanExists && fit !== null) {
        var origin = SectionEdit.bayOriginOf(doc, bayId);
        // origin === null here would mean the bay this line just opened
        // cannot be found -- nothing safe to place a scan against, and
        // explodeInto below will hit the same wall and quietly give up.
        if (origin !== null) {
            SectionEdit.reopenScan(doc, di, scan, fit, origin, bayId);
        }
    }

    SectionEdit.explodeInto(doc, di, ref, bayId);
};

/** The one selected block reference that is a section, or null. */
SectionEdit.selectedSection = function(doc) {
    if (!doc.hasSelection()) {
        return null;
    }
    var ids = doc.querySelectedEntities();
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        if (CsTags.get(e, CsCallout.KEY.KIND) === CsCallout.KIND_SECTION &&
                CsTags.get(e, CsCallout.KEY.ROLE) === CsCallout.ROLE_BLOCK) {
            return e;
        }
    }
    return null;
};

/**
 * Put the block's entities back into the bay, loose, and remove the
 * placed reference, its leaders and the now-empty block definition --
 * all in ONE operation, so reopening is one undo step. See the file
 * header for why moving (not cloning) and deleting the definition here
 * is safe.
 */
SectionEdit.explodeInto = function(doc, di, ref, bayId) {
    var blockId = ref.getData().getReferencedBlockId();
    var origin = SectionEdit.bayOriginOf(doc, bayId);
    if (origin === null) {
        return;
    }

    var calloutId = CsTags.get(ref, CsCallout.KEY.ID);
    var members = CalloutWrite.members(doc, calloutId);

    var op = new RAddObjectsOperation();
    op.setText("Reopen section sketch");

    // Every layer this single operation touches -- the tracing's own
    // (whatever the caver drew on), the reference's, and each leader's.
    // None of these are suite-LOCKED (CsLayers.LOCKED is only the two
    // CTRL-*-BOX layers, untouched here), but any of them could be OFF
    // or FROZEN by the caver's own choice, and an OFF/FROZEN layer
    // refuses an add, a modify AND a delete SILENTLY -- the rest of a
    // mixed operation still commits, which here would mean the content
    // moves out while the reference stays behind: the section would
    // exist in TWO places at once, the one thing this tool exists to
    // prevent.
    var layerNames = [];
    var msBlockId = doc.getModelSpaceBlockId();
    var ids = doc.queryBlockEntities(blockId);
    var i, e;
    for (i = 0; i < ids.length; i++) {
        e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        // MOVED, not cloned -- see the file header.
        e.setBlockId(msBlockId);
        e.move(new RVector(origin.x, origin.y));
        op.addObject(e, false);
        layerNames.push(doc.getLayerName(e.getLayerId()));
    }

    layerNames.push(doc.getLayerName(ref.getLayerId()));
    op.deleteObject(ref);
    for (i = 0; i < members.leaders.length; i++) {
        layerNames.push(doc.getLayerName(members.leaders[i].getLayerId()));
        op.deleteObject(members.leaders[i]);
    }

    // The definition itself, now empty -- see the file header for why
    // this is deleted rather than left as dead weight, and how it was
    // confirmed safe in the SAME operation as the content move above.
    var blockObj = doc.queryBlock(blockId);
    if (!isNull(blockObj)) {
        op.deleteObject(blockObj);
    }

    SectionEdit.withLayersOn(doc, di, layerNames, function() {
        di.applyOperation(op);
    });
};

/**
 * The centre the just-reopened bay's tracing hangs from: the ghost's
 * centre when there is one, the frame's (== the rect's) otherwise.
 * This is the EXACT preference SectionCapture.originOf uses -- not
 * "whichever tagged entity turns up first" (queryAllEntities is not
 * insertion-ordered, so that would be a coin flip) -- because ghost and
 * frame do not generally share a centre: SketchSection.addGhost centres
 * the GHOST SHAPE, which is rarely symmetric about the frame's own
 * middle, while the frame IS the rect. Capture and reopen must agree on
 * which one is "the origin," or a captured block's local coordinates
 * and a reopened bay's origin drift apart on every round trip.
 */
SectionEdit.bayOriginOf = function(doc, bayId) {
    var ids = doc.queryAllEntities(false, true);
    var frame = null, ghost = null;
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || CsTags.get(e, SketchSection.TAG_BAY) !== bayId) {
            continue;
        }
        var role = CsTags.get(e, "SectionBayRole");
        if (role === SketchSection.ROLE_FRAME) {
            frame = e;
        } else if (role === SketchSection.ROLE_GHOST) {
            ghost = e;
        }
    }
    var target = (ghost !== null) ? ghost : frame;
    if (target === null) {
        return null;
    }
    // Bounding boxes are CACHED -- this bay was built moments ago in
    // the same script, but a stale box read is exactly the trap that
    // has shipped before, so update() runs even here.
    target.update();
    var b = target.getBoundingBox();
    return { x: (b.getMinimum().x + b.getMaximum().x) / 2,
             y: (b.getMinimum().y + b.getMaximum().y) / 2 };
};

/**
 * Place the scan into a freshly opened bay at the fit STORED on the
 * reference, recentred on THIS bay's own origin. See the file header
 * for why the scale is taken from storage while the position is not:
 * the scale is what the caver's tracing was drawn against and must
 * survive any drift in the survey since; the position has to follow
 * the bay, which can land somewhere new every time (frameRectFor parks
 * against the CURRENT plan extents).
 *
 * Built the same RImageData-BY-CONSTRUCTOR way SketchSection.addScan
 * is (see that file's own comment): setters on an already-placed
 * RImageData are not what any working image insert in this suite
 * trusts, so this never edits a placed image -- it only ever builds a
 * fresh one, exactly as addScan does, just from a caller-supplied fit
 * instead of one computed by CsSectionBay.fitTransform.
 */
SectionEdit.reopenScan = function(doc, di, path, fit, origin, bayId) {
    var img = new QImage(path);
    if (img.isNull()) {
        SketchSection.say(qsTr("The scan could not be read: ") + path);
        return;
    }
    var pxW = img.width(), pxH = img.height();
    if (pxW < 1 || pxH < 1) {
        SketchSection.say(qsTr("The scan has no size: ") + path);
        return;
    }
    var tx = origin.x - (pxW * fit.sx) / 2;
    var ty = origin.y - (pxH * fit.sy) / 2;

    var entity;
    try {
        var data = new RImageData(path,
            new RVector(tx, ty),
            new RVector(fit.sx, 0),
            new RVector(0, fit.sy),
            pxW, pxH, 0);
        try {
            data.setFade(50);
        } catch (eFade) {
            // an engine without setFade gets a full-strength scan
        }
        entity = new RImageEntity(doc, data);
    } catch (e) {
        SketchSection.say(qsTr("The scan could not be placed: ") + e);
        return;
    }
    entity.setLayerId(doc.getLayerId(CsLayers.CTRL_SECTION_SCAN));
    // Tag BEFORE adding, so the tags land in the SAME operation as the
    // geometry, and so a Capture run right after this reopen finds and
    // excludes this scan exactly as it would one SketchSection placed.
    CsTags.set(entity, SketchSection.TAG_BAY, bayId);
    CsTags.set(entity, "SectionBayRole", SketchSection.ROLE_SCAN);
    CsTags.set(entity, CsCallout.KEY.SECTION_SCAN, path);
    CsTags.set(entity, CsCallout.KEY.SECTION_FIT,
        CsSectionBay.serializeFit({ sx: fit.sx, sy: fit.sy, rot: 0,
            tx: tx, ty: ty }));
    // To the back, under whatever the caver traces over it -- the same
    // underlay treatment every scan in this suite gets.
    entity.setDrawOrder(doc.getStorage().getMinDrawOrder() - 1);

    var op = new RAddObjectsOperation();
    op.setText("Underlay section scan");
    op.addObject(entity, false);
    CsLayers.withLayerOn(doc, di, CsLayers.CTRL_SECTION_SCAN, function() {
        di.applyOperation(op);
    });
};

/** Nest CsLayers.withLayerOn for every distinct name in `names`, then
 *  run fn once, wrapped by all of them -- SectionCapture's own fixed
 *  three-layer nesting (CTRL-SECTION-BOX/OUTLINE/SCAN), generalised to
 *  however many layers a single reopen happens to touch, since the
 *  tracing's own layers are the caver's choice and not known in
 *  advance. */
SectionEdit.withLayersOn = function(doc, di, names, fn) {
    var seen = {};
    var unique = [];
    var i;
    for (i = 0; i < names.length; i++) {
        if (names[i] !== "" && !seen.hasOwnProperty(names[i])) {
            seen[names[i]] = true;
            unique.push(names[i]);
        }
    }
    var wrap = function(idx) {
        if (idx >= unique.length) {
            return fn();
        }
        return CsLayers.withLayerOn(doc, di, unique[idx], function() {
            return wrap(idx + 1);
        });
    };
    return wrap(0);
};

SectionEdit.init = function(basePath) {
    var action = new RGuiAction(qsTr("Edit Sketch"),
                                RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/SectionEdit.js");
    action.setIcon(basePath + "/SectionEdit.svg");
    action.setStatusTip(qsTr("Reopen a traced cross section's bay, with " +
        "its scan, to carry on sketching"));
    action.setDefaultCommands(["sectionedit", "ske"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(49);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
