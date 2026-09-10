// CsErase.js -- taking back the last thing you drew, and the one you
// clicked on.
//
// Part of the Cave Survey Core library. QCAD-only: every function here
// touches a document.
//
// WHY THIS IS NOT UNDO. Undo is a stack, and a caver tracing a passage
// makes a bad stroke in the middle of good ones: the third of five
// walls comes out wrong, and Ctrl+Z three times costs the two good
// strokes that followed it. Both routes here delete ONE thing and leave
// everything else standing.
//
// WHAT MAY BE ERASED. The caller hands in the layers it owns, and
// nothing off those layers is ever picked. That is what keeps a click
// meant for a wall from taking the centerline, a station, a scan or a
// dimension with it: those live on CTRL- layers no panel lists. It is
// the caller's list and not a rule in here because the two panels own
// different layers, and a rule here would be a third opinion about
// which -- free to disagree with both.
//
// A FEATURE IS ERASED WHOLE. A shaped line is a spine plus the ornament
// generated along it; deleting the spine and leaving forty hachures
// behind would leave litter no tool can name and no caver can select.
// Clicking the ornament erases the same feature the spine would, which
// is what a caver who clicked the ticks meant.

if (typeof CsErase === "undefined") {
    var CsErase = {};
}

/** How near a click has to be, in FEET of cave, to erase what it
 *  points at. The same distance CsTrace.TIE_FEET uses for "these two
 *  ends are the same end" -- one number for "close enough to mean
 *  that one" throughout the tracing tools. */
CsErase.PICK_FEET = 1.0;

/**
 * The last thing either panel drew: {id, doc, label, kind, extended}.
 *
 * MODULE STATE, for FeatureTraceRun.lastTrace's reason: arming a tile
 * builds a new action, so anything remembered on an instance is
 * forgotten every time the caver changes feature -- which is the middle
 * of tracing a passage.
 *
 * ONE record for both panels and all three kinds of thing (a traced
 * feature, a shaped line, a placed symbol), because "the last thing I
 * drew" is one fact from where the caver sits. Two records, one per
 * panel, would mean Delete Last in Feature Trace cheerfully deleting a
 * wall three symbols later.
 *
 * `doc` is the drawing's identity (CsTrace.docKey), so the last stroke
 * in one drawing can never be deleted out of another that happens to
 * share an entity id.
 */
CsErase.lastDrawn = null;

/**
 * Records what was just drawn.
 *
 * `extended` marks a stroke that GREW an existing line rather than
 * making a new one. Delete Last refuses those, and says why: the
 * entity is the wall it always was, and deleting it would take the
 * five earlier strokes with it. Ctrl+Z is the right tool for that one
 * -- an extension is a single transaction group, so one undo takes
 * exactly the addition.
 */
CsErase.noteDrawn = function(doc, id, label, kind, extended) {
    if (isNull(doc) || isNull(id)) {
        CsErase.lastDrawn = null;
        return;
    }
    CsErase.lastDrawn = {
        id: id,
        doc: CsTrace.docKey(doc),
        label: (label === undefined || label === null) ? "" : String(label),
        kind: (kind === undefined || kind === null) ? "feature" : String(kind),
        extended: (extended === true)
    };
};

/** Forgets the record, without deleting anything. */
CsErase.forget = function() {
    CsErase.lastDrawn = null;
};

/**
 * The record, if it still describes something real in THIS drawing --
 * otherwise null, and forgotten.
 *
 * The caver may have undone it, deleted it by hand, or opened another
 * drawing since. A stale id is not an error; it is the ordinary state
 * of a record that outlived what it pointed at.
 */
CsErase.lastIn = function(doc) {
    var last = CsErase.lastDrawn;
    if (isNull(doc) || last === null) {
        return null;
    }
    if (last.doc !== CsTrace.docKey(doc)) {
        return null;   // another drawing: not ours to delete, not stale
    }
    if (isNull(doc.queryEntity(last.id))) {
        CsErase.lastDrawn = null;
        return null;
    }
    return last;
};

/**
 * The entity nearest `point` on one of `layers`, within `tolerance` --
 * {id, distance, layer}, or null.
 *
 * Distance to the GEOMETRY, not to a bounding box or an insertion
 * point: a wall is a long curve and a click lands beside the middle of
 * it, nowhere near either end.
 *
 * A layer that is OFF or FROZEN is skipped, by CsLayers.refusesEdits --
 * the same test every writer in the suite uses. queryLayerEntities does
 * NOT filter by visibility, so without this a click would erase a line
 * the caver cannot see and has no way to notice going: the layer is
 * hidden, so nothing on screen changes. A locked layer is left in the
 * list on purpose, for that function's own reason -- the delete then
 * refuses, and the caller reports it, which is an answer rather than a
 * silence.
 */
CsErase.nearestOn = function(doc, point, layers, tolerance) {
    if (isNull(doc) || isNull(point) || isNull(layers)) {
        return null;
    }
    var at = new RVector(point.x, point.y);
    var best = null;
    for (var i = 0; i < layers.length; i++) {
        var name = layers[i];
        if (!doc.hasLayer(name)) {
            continue;
        }
        var layerId = doc.getLayerId(name);
        if (CsLayers.refusesEdits(doc.queryLayer(layerId))) {
            continue;
        }
        var ids = doc.queryLayerEntities(layerId, false);
        for (var j = 0; j < ids.length; j++) {
            var e = doc.queryEntity(ids[j]);
            if (isNull(e)) {
                continue;
            }
            var d;
            try {
                d = e.getDistanceTo(at);
            } catch (eDist) {
                continue;
            }
            if (isNull(d) || isNaN(d) || d > tolerance) {
                continue;
            }
            if (best === null || d < best.distance) {
                best = { id: ids[j], distance: d, layer: name };
            }
        }
    }
    return best;
};

/**
 * Everything that has to go with `id`, as a list of ids.
 *
 * A shaped line resolves to its spine AND all its ornament, from
 * whichever of the two was clicked. Anything else is just itself.
 */
CsErase.wholeFeature = function(doc, id) {
    if (isNull(doc) || isNull(id)) {
        return [];
    }
    var e = doc.queryEntity(id);
    if (isNull(e)) {
        return [];
    }
    var sid = CsTags.get(e, CsShapeLine.KEY.ID);
    if (sid === "") {
        sid = CsTags.get(e, CsShapeLine.KEY.DECOR);
    }
    if (sid === "") {
        return [id];
    }
    var out = [];
    var seen = {};
    var spine = CsShapeLine.spineOf(doc, sid);
    if (!isNull(spine)) {
        out.push(spine.getId());
        seen[spine.getId()] = true;
    }
    var decor = CsShapeLine.decorOf(doc, sid);
    for (var i = 0; i < decor.length; i++) {
        var did = decor[i].getId();
        if (seen[did] !== true) {
            out.push(did);
            seen[did] = true;
        }
    }
    if (seen[id] !== true) {
        out.push(id);   // a half-tagged leftover still goes
    }
    return out;
};

/**
 * Deletes entities, in ONE transaction so a shaped line's spine and its
 * forty hachures come back together on a single Ctrl+Z.
 *
 * The shaped-line listener is held off across the delete the way
 * ShapedFlip holds it off: it hears the spine go, and would set about
 * reconciling a feature that is halfway through being removed.
 *
 * \return how many entities were deleted
 */
CsErase.remove = function(doc, di, ids) {
    if (isNull(doc) || isNull(di) || isNull(ids) || ids.length === 0) {
        return 0;
    }
    var hadListener = (typeof ShapedLinesListener !== "undefined");
    if (hadListener) {
        ShapedLinesListener.busy = true;
    }
    var gone = 0;
    try {
        var op = new RDeleteObjectsOperation();
        for (var i = 0; i < ids.length; i++) {
            var e = doc.queryEntity(ids[i]);
            if (isNull(e)) {
                continue;
            }
            op.deleteObject(e);
            gone++;
        }
        if (gone > 0) {
            di.applyOperation(op);
        }
    } catch (eDel) {
        gone = 0;
    } finally {
        if (hadListener) {
            ShapedLinesListener.busy = false;
        }
    }
    if (gone > 0 && CsErase.lastDrawn !== null) {
        // whatever the record pointed at may have just gone with them.
        // BREAK, not carry on: clearing the record mid-loop and then
        // reading its id on the next id is a null dereference, and a
        // shaped line hands this forty ids to walk.
        var wasId = CsErase.lastDrawn.id;
        for (var k = 0; k < ids.length; k++) {
            if (ids[k] === wasId) {
                CsErase.lastDrawn = null;
                break;
            }
        }
    }
    return gone;
};

/**
 * Erases what a click points at, on the caller's own layers.
 *
 * \return {gone, layer} on a hit, or null when nothing of the caller's
 *         was near enough -- which the caller reports rather than
 *         deleting the nearest thing at any distance. A click that
 *         missed must do nothing at all: erasing whatever happened to
 *         be closest is how a tool takes the wall beside the one you
 *         pointed at.
 */
CsErase.eraseAt = function(doc, di, point, layers, tolerance) {
    var hit = CsErase.nearestOn(doc, point, layers, tolerance);
    if (hit === null) {
        return null;
    }
    var gone = CsErase.remove(doc, di, CsErase.wholeFeature(doc, hit.id));
    return gone === 0 ? null : { gone: gone, layer: hit.layer };
};

/**
 * Deletes the last thing either panel drew.
 *
 * \return {status, label, gone} -- status is one of:
 *         "deleted"  it is gone
 *         "nothing"  there is no record, or what it pointed at is
 *                    already gone (undone, deleted, another drawing)
 *         "extended" the last stroke GREW an existing line. Refused on
 *                    purpose: the entity is the whole line, every
 *                    earlier stroke included, and deleting it to take
 *                    back the last six feet would be the worst kind of
 *                    helpful. Ctrl+Z takes the addition alone -- an
 *                    extension is one transaction group.
 *         "failed"   the delete was refused (a locked or frozen layer)
 *
 * The WORDS are the caller's: this file has no idea which panel is
 * asking or what it calls things.
 */
CsErase.deleteLast = function(doc, di) {
    var last = CsErase.lastIn(doc);
    if (last === null) {
        return { status: "nothing", label: "", gone: 0 };
    }
    if (last.extended === true) {
        return { status: "extended", label: last.label, gone: 0 };
    }
    var gone = CsErase.remove(doc, di, CsErase.wholeFeature(doc, last.id));
    return {
        status: (gone > 0) ? "deleted" : "failed",
        label: last.label,
        gone: gone
    };
};
