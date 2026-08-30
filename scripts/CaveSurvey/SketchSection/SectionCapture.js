/**
 * SectionCapture -- turn a traced bay into a placed section block.
 *
 * THE SWEEP IS GEOMETRIC. Everything wholly inside the bay frame joins
 * the block, minus the frame, the ghost and the scan, which are tagged
 * and excluded by tag rather than by layer. Not "everything on the
 * section layers": a stray line from the previous sketch would join
 * this block silently, and nothing on the drawing would say so.
 *
 * THE TRACED ENTITIES ARE MOVED INTO THE BLOCK, NEVER CLONED. Probed
 * 2026-08-30 against a real RDocument: entity.clone() DOES exist and a
 * clone's setBlockId()+move() DOES survive its own add -- right up until
 * the entity it was cloned FROM is deleted, in this op or any LATER one.
 * At that point the clone vanishes too, silently: a block built from
 * clone()+deleteObject(original) came back with a correct-looking id
 * count on the very same script line and an EMPTY block definition once
 * the transaction actually landed -- the caver's tracing gone, nothing
 * in its place, no error. clone() and its source appear to share
 * identity below the script binding until the source is independently
 * committed and never touched again. Setting the ORIGINAL entity's own
 * blockId and moving IT sidesteps the whole problem: nothing is cloned,
 * nothing is deleted, the entity that was loose tracing simply becomes
 * the block's content by relocation. Confirmed by the same probe.
 *
 * THE BLOCK IS BLOCK-LOCAL about the ghost's centre, which is where the
 * centreline of the passage was. So the reference's insertion point IS
 * the centreline on the sheet, exactly as a computed section's is --
 * the two kinds drag, snap and leader identically.
 *
 * PLACEMENT IS PROPOSED, NOT IMPOSED. The march is a good guess: Enter
 * takes it, a click puts it somewhere else. A march that finds nowhere
 * clear inside its cap hands the placement over rather than flinging the
 * section off-sheet.
 *
 * TEARDOWN RESTORES THE SNAP. SketchSection tags the bay's own frame
 * with the snap class the caver was using before the bay switched it to
 * free (SketchSection.snapFree/recordSnap) -- restoring it THERE, on
 * open, would undo the free snap the instant the bay appeared, since
 * SketchSection's own action terminates right after opening it. This is
 * the bay's teardown, so this is where the snap comes back: a fresh
 * instance built from the tagged class name, never the old object
 * itself (di.setSnap() takes ownership -- see restoreSnap).
 *
 * USAGE:
 *   Cave Survey > Capture Section   (or "sectioncapture" / "skc")
 */
include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");
include(includeBasePath + "/../Callout/CalloutWrite.js");
include(includeBasePath + "/SketchSection.js");

function SectionCapture(guiAction) {
    EAction.call(this, guiAction);
    this.bay = null;
    this.proposed = null;
    this.previewPos = undefined;
}

SectionCapture.prototype = new EAction();

SectionCapture.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    var doc = this.getDocument();
    var di = this.getDocumentInterface();
    if (isNull(doc) || isNull(di)) {
        this.terminate();
        return;
    }
    this.bay = SectionCapture.findBay(doc);
    if (this.bay === null) {
        SketchSection.say(qsTr("There is no open section bay in this " +
            "drawing.\n\nSketch Section opens one."));
        this.terminate();
        return;
    }
    if (this.bay.traced.length === 0) {
        SketchSection.say(qsTr("Nothing has been traced inside the bay " +
            "yet, so there is no section to capture."));
        this.terminate();
        return;
    }
    this.proposed = SectionCapture.proposePosition(doc, this.bay);
    if (this.proposed === null) {
        // Boxed in. Honest answer: the caver places it.
        this.setCommandPrompt(qsTr("No clear spot found -- pick where " +
            "the section goes"));
        this.setLeftMouseTip(qsTr("Position of the section"));
        this.setRightMouseTip(EAction.trCancel);
        EAction.showSnapTools();
        this.setCrosshairCursor();
        di.setClickMode(RAction.PickCoordinate);
        return;
    }
    this.setCommandPrompt(qsTr("Enter to accept the proposed spot, or " +
        "pick another"));
    this.setLeftMouseTip(qsTr("Position of the section"));
    this.setRightMouseTip(EAction.trCancel);
    EAction.showSnapTools();
    this.setCrosshairCursor();
    di.setClickMode(RAction.PickCoordinate);
};

/** Enter takes the proposal. */
SectionCapture.prototype.enterEvent = function() {
    if (this.proposed !== null) {
        this.finish(this.proposed);
    }
};

SectionCapture.prototype.pickCoordinate = function(event, preview) {
    var pos = event.getModelPosition();
    if (preview) {
        this.previewPos = { x: pos.x, y: pos.y };
        return;
    }
    this.finish({ x: pos.x, y: pos.y });
};

/**
 * The open bay: its frame, its rect, its station, its furniture and the
 * tracing inside it.
 *
 * The id set is DIFFED rather than ordered -- queryAllEntities is not
 * insertion-ordered, so "the last entity" means nothing here.
 *
 * \return {id, rect, station, frame, ghost, scan, traced: [ids]} or null
 */
SectionCapture.findBay = function(doc) {
    var ids = doc.queryAllEntities(false, true);
    var frame = null, ghost = null, scan = null, bayId = null;
    var i, e;
    for (i = 0; i < ids.length; i++) {
        e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        var tag = CsTags.get(e, SketchSection.TAG_BAY);
        if (tag === "") {
            continue;
        }
        var role = CsTags.get(e, "SectionBayRole");
        if (role === SketchSection.ROLE_FRAME) {
            frame = e;
            bayId = tag;
        } else if (role === SketchSection.ROLE_GHOST) {
            ghost = e;
        } else if (role === SketchSection.ROLE_SCAN) {
            scan = e;
        }
    }
    if (frame === null) {
        return null;
    }
    // The frame may have been dragged since it was drawn, and a
    // bounding box is CACHED across a modify -- read it only after an
    // update(), or the sweep is measured against where the frame used
    // to be.
    frame.update();
    var fb = frame.getBoundingBox();
    var rect = { x1: fb.getMinimum().x, y1: fb.getMinimum().y,
                 x2: fb.getMaximum().x, y2: fb.getMaximum().y };

    var exclude = [frame.getId()];
    if (ghost !== null) { exclude.push(ghost.getId()); }
    if (scan !== null) { exclude.push(scan.getId()); }

    var items = [];
    for (i = 0; i < ids.length; i++) {
        e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        e.update();
        var b = e.getBoundingBox();
        items.push({ id: ids[i],
                     box: { x1: b.getMinimum().x, y1: b.getMinimum().y,
                            x2: b.getMaximum().x, y2: b.getMaximum().y } });
    }
    return {
        id: bayId,
        rect: rect,
        station: CsTags.get(frame, "SectionBayStation"),
        frame: frame,
        ghost: ghost,
        scan: scan,
        traced: CsSectionBay.sweepOf(items, rect, exclude)
    };
};

/** The bay's origin: the ghost's centre, or the frame's if there is no
 *  ghost. This becomes the block's 0,0 and therefore the centreline. */
SectionCapture.originOf = function(bay) {
    if (bay.ghost !== null) {
        bay.ghost.update();
        var g = bay.ghost.getBoundingBox();
        return { x: (g.getMinimum().x + g.getMaximum().x) / 2,
                 y: (g.getMinimum().y + g.getMaximum().y) / 2 };
    }
    return { x: (bay.rect.x1 + bay.rect.x2) / 2,
             y: (bay.rect.y1 + bay.rect.y2) / 2 };
};

/** The tracing's own extent, block-local. */
SectionCapture.localBoxOf = function(doc, bay, origin) {
    var x1 = 0, y1 = 0, x2 = 0, y2 = 0, seen = false;
    for (var i = 0; i < bay.traced.length; i++) {
        var e = doc.queryEntity(bay.traced[i]);
        if (isNull(e)) {
            continue;
        }
        e.update();
        var b = e.getBoundingBox();
        var bx1 = b.getMinimum().x - origin.x;
        var by1 = b.getMinimum().y - origin.y;
        var bx2 = b.getMaximum().x - origin.x;
        var by2 = b.getMaximum().y - origin.y;
        if (!seen) {
            x1 = bx1; y1 = by1; x2 = bx2; y2 = by2;
            seen = true;
        } else {
            if (bx1 < x1) { x1 = bx1; }
            if (by1 < y1) { y1 = by1; }
            if (bx2 > x2) { x2 = bx2; }
            if (by2 > y2) { y2 = by2; }
        }
    }
    return { x1: x1, y1: y1, x2: x2, y2: y2 };
};

/** Everything the section must not land on: plan-frame linework and
 *  every section already placed. The bay's own contents are excluded --
 *  they are about to stop existing. */
SectionCapture.obstaclesOf = function(doc, bay) {
    var out = [];
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        if (CsTags.get(e, SketchSection.TAG_BAY) !== "") {
            continue;                      // bay furniture
        }
        var layerName = doc.getLayerName(e.getLayerId());
        if (CsLayers.frameOf(layerName) !== "plan") {
            continue;                      // profile, section, sheet
        }
        e.update();
        var b = e.getBoundingBox();
        out.push({ x1: b.getMinimum().x, y1: b.getMinimum().y,
                   x2: b.getMaximum().x, y2: b.getMaximum().y });
    }
    return out;
};

/** March outward from the station and propose a spot, or null. */
SectionCapture.proposePosition = function(doc, bay) {
    var stations = CsTags.collectStations(doc);
    var at = null;
    for (var i = 0; i < stations.length; i++) {
        if (stations[i].name === bay.station) {
            at = { x: stations[i].pos.x, y: stations[i].pos.y };
            break;
        }
    }
    if (at === null) {
        return null;
    }
    var origin = SectionCapture.originOf(bay);
    var localBox = SectionCapture.localBoxOf(doc, bay, origin);
    var obstacles = SectionCapture.obstaclesOf(doc, bay);

    var tangent = SectionCapture.tangentAt(doc, bay.station);
    var perp = CsSectionBay.perpOf(tangent);
    var side = CsSectionBay.clearerSide(at, perp, obstacles, 50);
    var dir = { x: perp.x * side, y: perp.y * side };

    return CsSectionBay.marchOut(at, dir, localBox, obstacles,
        CsSectionBay.MARGIN, CsSectionBay.CAP);
};

/** The local leg direction at a station -- the survey's own, so the
 *  section goes out SIDEWAYS from the passage rather than along it. */
SectionCapture.tangentAt = function(doc, station) {
    try {
        var asDrawn = CsRevise.resolveAsDrawn(doc);
        var here = asDrawn.resolved.stations[station];
        var leg = CsSectionCut.nearestLeg(asDrawn.resolved,
            { x: here.x, y: here.y });
        var a = asDrawn.resolved.stations[leg.from];
        var b = asDrawn.resolved.stations[leg.to];
        return { x: b.x - a.x, y: b.y - a.y };
    } catch (e) {
        return { x: 1, y: 0 };
    }
};

/** Build the block, place it, leader it, tear the bay down. */
SectionCapture.prototype.finish = function(position) {
    var doc = this.getDocument();
    var di = this.getDocumentInterface();
    if (isNull(doc) || isNull(di) || this.bay === null) {
        this.terminate();
        return;
    }
    try {
        var id = SectionCapture.capture(doc, di, this.bay, position);
        if (id === null) {
            SketchSection.say(qsTr("The section could not be placed -- " +
                "its block was refused by this drawing."));
        } else {
            EAction.handleUserMessage(
                qsTr("Section at %1 captured from %2 traced entities")
                    .arg(this.bay.station).arg(this.bay.traced.length));
        }
    } catch (e) {
        // LOCKED and FROZEN layers refuse writes SILENTLY here, so the
        // alternative is a command that looks like it worked and drew
        // nothing.
        SketchSection.say(qsTr("The section could not be placed.\n\n") + e);
    }
    this.terminate();
};

/**
 * The whole capture, as one callable so the headless test can drive it
 * without a GUI event.
 *
 * \return the callout id, or null
 */
SectionCapture.capture = function(doc, di, bay, position) {
    var origin = SectionCapture.originOf(bay);
    var scale = CsSectionDraw.scaleOf();
    var id = CsCallout.newId();
    var name = CsSectionDraw.blockName(id);

    // Read the snap to restore BEFORE the frame that carries it is
    // queued for deletion below -- see the file header.
    var snapClass = (bay.frame !== null) ?
        CsTags.get(bay.frame, SketchSection.TAG_SNAP) : "";

    var blockId = doc.getBlockId(name);
    if (blockId === RBlock.INVALID_ID || blockId === undefined ||
            blockId === null || blockId < 0) {
        var block = new RBlock(doc, name, new RVector(0, 0));
        di.applyOperation(new RAddObjectOperation(block, false));
        blockId = doc.getBlockId(name);
    }
    if (blockId === RBlock.INVALID_ID || blockId < 0) {
        return null;
    }

    var op = new RAddObjectsOperation();
    op.setText("Capture sketched section");
    var i, e;
    for (i = 0; i < bay.traced.length; i++) {
        e = doc.queryEntity(bay.traced[i]);
        if (isNull(e)) {
            continue;
        }
        // MOVED into the block, not cloned -- see the file header. The
        // entity that was loose tracing a moment ago simply becomes the
        // block's content; nothing is duplicated and nothing needs a
        // separate delete.
        e.setBlockId(blockId);
        e.move(new RVector(-origin.x, -origin.y));
        op.addObject(e, false);
    }

    var layerName = CsCallout.STYLES["annotation"] ||
        CsCallout.STYLES[CsCallout.STYLE_DEFAULT];
    CsLayers.ensure(doc, di, layerName);
    var at = new RVector(position.x, position.y);
    var ref = new RBlockReferenceEntity(doc,
        new RBlockReferenceData(blockId, at, new RVector(1, 1), 0.0));
    ref.setLayerId(doc.getLayerId(layerName));

    // Tag BEFORE adding, so the tags land in the SAME operation as the
    // geometry.
    CsTags.set(ref, CsCallout.KEY.ID, id);
    CsTags.set(ref, CsCallout.KEY.ROLE, CsCallout.ROLE_BLOCK);
    CsTags.set(ref, CsCallout.KEY.KIND, CsCallout.KIND_SECTION);
    CsTags.set(ref, CsCallout.KEY.STYLE, "annotation");
    CsTags.set(ref, CsCallout.KEY.SIDE, "auto");
    CsTags.set(ref, CsCallout.KEY.LEADER, CsCallout.LEADER_DEFAULT);
    CsTags.set(ref, CsCallout.KEY.SECTION_SOURCE, CsCallout.SOURCE_SKETCH);
    CsTags.set(ref, CsCallout.KEY.SECTION_STATION, bay.station);
    CsTags.set(ref, CsCallout.KEY.SECTION_SCALE, String(scale));
    if (bay.scan !== null) {
        var path = CsTags.get(bay.scan, CsCallout.KEY.SECTION_SCAN);
        var fit = CsTags.get(bay.scan, CsCallout.KEY.SECTION_FIT);
        if (path !== "") { CsTags.set(ref, CsCallout.KEY.SECTION_SCAN, path); }
        if (fit !== "") { CsTags.set(ref, CsCallout.KEY.SECTION_FIT, fit); }
    }
    op.addObject(ref, false);

    // The bay's furniture, gone in the same operation -- one undo. The
    // frame's own layer, CTRL-SECTION-BOX, ships LOCKED (a caver's
    // protection against dragging the boundary the sweep was measured
    // against) and a locked layer refuses a delete exactly as silently
    // as an off one does. withLayerOn alone only clears off/frozen, so
    // the frame's delete additionally needs withLayerUnlocked, nested
    // exactly as SketchSection.addFrame nests them for the ADD.
    // CTRL-SECTION-OUTLINE and CTRL-SECTION-SCAN are not suite-locked,
    // but a caver may have switched either off since the bay opened, so
    // both still need withLayerOn around this same single commit or a
    // hidden ghost or scan silently survives teardown and is swept into
    // the NEXT section.
    if (bay.frame !== null) { op.deleteObject(bay.frame); }
    if (bay.ghost !== null) { op.deleteObject(bay.ghost); }
    if (bay.scan !== null) { op.deleteObject(bay.scan); }

    CsLayers.withLayerOn(doc, di, CsLayers.CTRL_SECTION_BOX, function() {
        CsLayers.withLayerUnlocked(doc, di, CsLayers.CTRL_SECTION_BOX,
            function() {
                CsLayers.withLayerOn(doc, di, CsLayers.CTRL_SECTION_OUTLINE,
                    function() {
                        CsLayers.withLayerOn(doc, di,
                            CsLayers.CTRL_SECTION_SCAN, function() {
                                di.applyOperation(op);
                            });
                    });
            });
    });

    SectionCapture.addLeader(doc, di, id, bay.station, position, layerName);
    SectionCapture.restoreSnap(di, snapClass);
    return id;
};

/** One straight leader from the station to the section. Straight, not
 *  curved: a DXF LEADER record has no bulge, and an arc leader loses
 *  its arrow tip on a round trip. */
SectionCapture.addLeader = function(doc, di, id, station, position,
        layerName) {
    var stations = CsTags.collectStations(doc);
    var tip = null;
    for (var i = 0; i < stations.length; i++) {
        if (stations[i].name === station) {
            tip = stations[i].pos;
            break;
        }
    }
    if (tip === null) {
        return;
    }
    var pl = new RPolyline();
    // The tip FIRST: RLeaderData puts its arrowhead on the first vertex
    // (CalloutWrite.addSectionLeaders proves the same shape against this
    // bridge), and the arrow belongs at the station, not at the section.
    pl.appendVertex(new RVector(tip.x, tip.y));
    pl.appendVertex(new RVector(position.x, position.y));
    var leader = new RLeaderEntity(doc, new RLeaderData(pl, true));
    leader.setLayerId(doc.getLayerId(layerName));
    CsTags.set(leader, CsCallout.KEY.ID, id);
    CsTags.set(leader, CsCallout.KEY.ROLE, CsCallout.ROLE_LEADER);
    var op = new RAddObjectsOperation();
    op.setText("Leader a sketched section");
    op.addObject(leader, false);
    di.applyOperation(op);
};

/** Every snap class SketchSection might have tagged the frame with, by
 *  name. RSnapCoordinate does NOT exist in this build -- probed
 *  2026-08-30, ReferenceError on construction -- so it is deliberately
 *  absent here; a frame tagged with it (there will never be one, since
 *  SketchSection.recordSnap can only tag a name it actually read off a
 *  live snap) would just fall through restoreSnap's "unknown" branch. */
SectionCapture.SNAP_CTORS = {
    "RSnapFree": function() { return new RSnapFree(); },
    "RSnapAuto": function() { return new RSnapAuto(); },
    "RSnapGrid": function() { return new RSnapGrid(); },
    "RSnapEnd": function() { return new RSnapEnd(); },
    "RSnapCenter": function() { return new RSnapCenter(); },
    "RSnapMiddle": function() { return new RSnapMiddle(); },
    "RSnapIntersection": function() { return new RSnapIntersection(); },
    "RSnapDistance": function() { return new RSnapDistance(); },
    "RSnapOnEntity": function() { return new RSnapOnEntity(); },
    "RSnapPerpendicular": function() { return new RSnapPerpendicular(); },
    "RSnapReference": function() { return new RSnapReference(); },
    "RSnapTangential": function() { return new RSnapTangential(); }
};

/**
 * Put the snap back to what it was before the bay switched it to free.
 *
 * di.setSnap() TAKES OWNERSHIP of whatever is passed to it, so holding
 * the OLD snap object across the bay's whole lifetime and handing it
 * back here would be a use-after-free the moment anything else in QCAD
 * sets a different snap in between. Nothing is held: only the CLASS
 * NAME survived, tagged on the frame at snapFree time, and this builds
 * a genuinely FRESH instance from it. A name this build does not know
 * (or no name at all, e.g. a bay opened before this existed) leaves the
 * snap exactly where Capture found it -- free -- rather than guessing.
 */
SectionCapture.restoreSnap = function(di, className) {
    if (className === null || className === undefined || className === "") {
        return;
    }
    var make = SectionCapture.SNAP_CTORS[className];
    if (typeof make !== "function") {
        return;
    }
    try {
        di.setSnap(make());
    } catch (e) {
        // leaving the snap on free is survivable; a crash is not
    }
};

SectionCapture.init = function(basePath) {
    var action = new RGuiAction(qsTr("Capture Section"),
                                RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/SectionCapture.js");
    action.setIcon(basePath + "/SectionCapture.svg");
    action.setStatusTip(qsTr("Turn what is traced in the section bay " +
        "into a block, placed clear of the cave walls"));
    action.setDefaultCommands(["sectioncapture", "skc"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(48);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
