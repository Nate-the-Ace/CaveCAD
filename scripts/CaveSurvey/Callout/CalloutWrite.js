/**
 * CalloutWrite -- every QCAD-context write a callout needs.
 *
 * The pure geometry lives in Core/CsCallout.js. This file is the only
 * place that constructs entities, applies operations or reads a
 * document, so there is exactly ONE definition of what a callout looks
 * like in a drawing -- shared by all three commands and the listener.
 *
 * NOT loaded by tests/js_unit.js (it cannot run under node).
 * tests/callout_write.js covers it in CaveCAD's own engine.
 *
 * Takes `doc` as a parameter to every function and never caches one on
 * the module: a freed RDocument cannot be detected from script and
 * touching one SEGFAULTS (exit 139, not a catchable exception).
 */
function CalloutWrite() {}

/** Every CalloutId present in the drawing, as strings, deduped. */
CalloutWrite.existingIds = function(doc) {
    var out = [];
    var seen = {};
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        var cid = CsTags.get(e, CsCallout.KEY.ID);
        if (cid !== "" && !seen.hasOwnProperty(cid)) {
            seen[cid] = true;
            out.push(cid);
        }
    }
    return out;
};

/** The members of one callout: {text: entity|null, leaders: [entity]}. */
CalloutWrite.members = function(doc, id) {
    var want = String(id);
    var res = { text: null, leaders: [] };
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || CsTags.get(e, CsCallout.KEY.ID) !== want) {
            continue;
        }
        var role = CsTags.get(e, CsCallout.KEY.ROLE);
        if (role === CsCallout.ROLE_TEXT) {
            res.text = e;
        } else if (role === CsCallout.ROLE_LEADER) {
            res.leaders.push(e);
        }
    }
    return res;
};

/** The text's bounding box as the plain {x1,y1,x2,y2} CsCallout wants. */
CalloutWrite.boxOf = function(textEntity) {
    var b = textEntity.getBoundingBox();
    var c1 = b.getCorner1();
    var c2 = b.getCorner2();
    return {
        x1: Math.min(c1.x, c2.x), y1: Math.min(c1.y, c2.y),
        x2: Math.max(c1.x, c2.x), y2: Math.max(c1.y, c2.y)
    };
};

/** The current entity id set, as a {id: true} map. */
CalloutWrite.idSet = function(doc) {
    var m = {};
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        m[ids[i]] = true;
    }
    return m;
};

/**
 * Ids present now that were not in `before`.
 *
 * The only correct way to learn which entity an add operation just
 * created: queryAllEntities is NOT insertion-ordered, so
 * ids[ids.length - 1] is arbitrary and only appears to work on an
 * empty document. Do not "simplify" a caller back to that.
 */
CalloutWrite.newIds = function(doc, before) {
    var out = [];
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        if (!before.hasOwnProperty(ids[i])) {
            out.push(ids[i]);
        }
    }
    return out;
};

/**
 * Place a new callout. Returns its id.
 *
 * \param spec {text, position: {x,y}, tips: [{x,y}], style, kind,
 *              height, tags: {extra XDATA} }
 */
CalloutWrite.create = function(doc, di, spec) {
    var style = spec.style || CsCallout.STYLE_DEFAULT;
    var layerName = CsCallout.STYLES[style] || CsCallout.STYLES[
        CsCallout.STYLE_DEFAULT];
    CsLayers.ensure(doc, di, layerName);

    var id = CsCallout.nextId(CalloutWrite.existingIds(doc));

    // --- the text ----------------------------------------------------
    // Built with the FULL RTextData constructor, position and alignment
    // point both, exactly as CsDraw.addText does (CsDraw.js:55). Not
    // with setters.
    //
    // setPosition() ALONE IS A LIE: it reads back whatever you gave it
    // while getAlignmentPoint() stays 0,0, and the entity RENDERS at the
    // alignment point -- so the text lands on the origin. Measured:
    // setPosition(100,50) alone gives a bounding box of
    // (0,-4)..(16.78,0). That shipped once, and it also dragged the
    // leaders with it, because CalloutWrite.boxOf feeds the same box to
    // CsCallout.reflow. Passing both points to the constructor makes the
    // mistake structurally impossible rather than merely fixed.
    //
    // VAlignMiddle so the pick point is the note's vertical MIDDLE:
    // reflow attaches the landing at the box's vertical middle too, so
    // the arrow leaves at exactly the height the caver clicked.
    //
    // Not CsDraw.caps(): station labels are capitalised by convention,
    // but a caver's own note is theirs as typed.
    var at = new RVector(spec.position.x, spec.position.y);
    var textData = new RTextData(at, at, spec.height, 100.0,
        RS.VAlignMiddle, RS.HAlignLeft, RS.LeftToRight, RS.Exact,
        1.0, spec.text, "standard", false, false, 0.0, false);
    var textEntity = new RTextEntity(doc, textData);
    textEntity.setLayerId(doc.getLayerId(layerName));

    // Tag BEFORE adding, not with a follow-up CsTags.commit.
    // CsDraw.js's own header names this the working pattern in this
    // bridge: setCustomProperty on the script-side entity, THEN
    // op.addObject(entity, false), so the tags land as part of the
    // SAME operation as the add. CsTags.commit is the wrong tool for a
    // brand-new entity -- it applies its OWN, separate, UNGROUPED
    // RModifyObjectsOperation after the add, which is exactly what
    // made a grouped reflow non-atomic (see writeLeaders below, where
    // this was a real, reproduced bug: undoing a transaction group
    // reverted the add but not the follow-up tagging modify, leaving
    // an untagged leader that members() could no longer see).
    var tags = {};
    tags[CsCallout.KEY.ID] = id;
    tags[CsCallout.KEY.ROLE] = CsCallout.ROLE_TEXT;
    tags[CsCallout.KEY.KIND] = spec.kind || CsCallout.KIND_TEXT;
    tags[CsCallout.KEY.STYLE] = style;
    tags[CsCallout.KEY.SIDE] = "auto";
    if (spec.tags) {
        for (var k in spec.tags) {
            if (spec.tags.hasOwnProperty(k)) {
                tags[k] = spec.tags[k];
            }
        }
    }
    for (var tk in tags) {
        if (tags.hasOwnProperty(tk)) {
            CsTags.set(textEntity, tk, tags[tk]);
        }
    }

    // idSet/newIds is now VERIFICATION ONLY -- the entity is already
    // tagged, so nothing here needs to look it up by id. The hazard it
    // guards stays real: an operation can "succeed" and add nothing at
    // all (a LOCKED or FROZEN layer refuses silently, and withLayerOn
    // covers OFF only), so this still throws rather than returning a
    // half-built callout.
    var before = CalloutWrite.idSet(doc);
    CsLayers.withLayerOn(doc, di, layerName, function() {
        var op = new RAddObjectsOperation();
        op.addObject(textEntity, false);
        di.applyOperation(op);
    });
    if (CalloutWrite.newIds(doc, before).length !== 1) {
        throw new Error("callout text was not added -- layer " +
            layerName + " may be locked or frozen");
    }

    // --- the leaders -------------------------------------------------
    CalloutWrite.writeLeaders(doc, di, id, spec.tips, style, layerName, null);

    return id;
};

/**
 * Delete this callout's leaders and write one per tip, reflowed against
 * the text's CURRENT box. `group` is a transaction group id or null.
 */
CalloutWrite.writeLeaders = function(doc, di, id, tips, style, layerName,
        group) {
    var m = CalloutWrite.members(doc, id);
    if (m.text === null) {
        return;
    }

    var side = CsTags.get(m.text, CsCallout.KEY.SIDE);
    var geom = CsCallout.reflow(CalloutWrite.boxOf(m.text), tips, {
        side: (side === "" ? "auto" : side),
        // NOT DIMASZ/DIMSCALE. Measured in a real drawing they are
        // 0.0833 and 1, which would put a 0.08-unit landing on a
        // 0.5-unit-tall note -- a shoulder too short to see. reflow's
        // own fallback is half the text height, which stays right at
        // every scale because it is expressed IN the note's own size.
        dimasz: null,
        dimscale: null
    });

    CsLayers.withLayerOn(doc, di, layerName, function() {
        // out with the old
        if (m.leaders.length > 0) {
            var del = new RDeleteObjectsOperation();
            for (var d = 0; d < m.leaders.length; d++) {
                // ONE argument -- every other caller in this codebase
                // (CsStore, CsProfileDraw, CsDraw, ScatterBreakdown,
                // BuildLegend, AerialBasemap) agrees, and the engine
                // itself warns "Too many arguments, ignoring 1" on the
                // two-argument form the plan's draft called for.
                del.deleteObject(m.leaders[d]);
            }
            if (group !== null && group !== undefined) {
                del.setTransactionGroup(group);
            }
            di.applyOperation(del);
        }

        // in with the new
        for (var b = 0; b < geom.branches.length; b++) {
            var pl = new RPolyline();
            var pts = geom.branches[b];
            for (var p = 0; p < pts.length; p++) {
                pl.appendVertex(new RVector(pts[p].x, pts[p].y));
            }
            var data = new RLeaderData(pl, true);   // true = arrowHead
            var ent = new RLeaderEntity(doc, data);
            ent.setLayerId(doc.getLayerId(layerName));

            // Tag BEFORE adding -- see create()'s own comment. This is
            // what makes a grouped reflow ATOMIC: the add below is the
            // ONLY operation that writes this leader, tags included,
            // and it is the one that carries `group`. A separate,
            // ungrouped CsTags.commit() after the add (the previous
            // shape of this loop) meant undoing the group reverted the
            // add's geometry but not the tagging modify next to it --
            // reproduced by hand: a leader survived undo with no
            // CalloutId/CalloutRole at all, invisible to members()
            // from that point on.
            CsTags.set(ent, CsCallout.KEY.ID, String(id));
            CsTags.set(ent, CsCallout.KEY.ROLE, CsCallout.ROLE_LEADER);
            CsTags.set(ent, CsCallout.KEY.STYLE, style);

            // Verification only, same as create() -- an add that lands
            // nothing (locked/frozen layer) must not pass silently.
            var before = CalloutWrite.idSet(doc);
            var op = new RAddObjectsOperation();
            op.addObject(ent, false);
            if (group !== null && group !== undefined) {
                op.setTransactionGroup(group);
            }
            di.applyOperation(op);

            if (CalloutWrite.newIds(doc, before).length !== 1) {
                throw new Error("callout leader was not added -- layer " +
                    layerName + " may be locked or frozen");
            }
        }
    });
};

/**
 * Reflow an existing callout in place: read its current tips off its
 * current leaders, then rewrite them against the text's current box.
 *
 * A leader's tip is its FIRST vertex (reflow emits tip, elbow, landing),
 * which is what lets a caver drag the tip grip and have the elbow
 * follow rather than the other way round.
 */
CalloutWrite.applyReflow = function(doc, di, id, group) {
    var m = CalloutWrite.members(doc, id);
    if (m.text === null || m.leaders.length === 0) {
        return;
    }
    var style = CsTags.get(m.text, CsCallout.KEY.STYLE) ||
        CsCallout.STYLE_DEFAULT;
    var layerName = CsCallout.STYLES[style] ||
        CsCallout.STYLES[CsCallout.STYLE_DEFAULT];

    var tips = [];
    for (var i = 0; i < m.leaders.length; i++) {
        var v = m.leaders[i].getData().getVertexAt(0);
        tips.push({ x: v.x, y: v.y });
    }
    CalloutWrite.writeLeaders(doc, di, id, tips, style, layerName, group);
};

/**
 * Text height for a new callout: the SAME height every other label in
 * this suite uses.
 *
 * NOT the drawing's DIMTXT. That was the first attempt and it is wrong
 * by two orders of magnitude on a real cave map: measured in a caver's
 * own drawing, DIMTXT is 0.0833 (one inch, in a drawing whose unit is
 * feet) with DIMSCALE 1, which put a "test test test" note in a box
 * 0.55 x 0.08 units across a passage spanning ~200 feet. Invisible.
 * DIMTXT is sized for dimension annotation on a plotted sheet, not for
 * map lettering.
 *
 * CsDraw.TEXT_HEIGHT is what station labels are drawn at, so a note
 * comes out the same size as the labels beside it -- which is what a
 * caver expects and the only definition of "right size" this suite
 * actually has.
 */
CalloutWrite.textHeight = function(doc) {
    return CsDraw.TEXT_HEIGHT;
};

/**
 * The elevation-label unit suffix for this drawing: "'" for an
 * imperial drawing, " m" for a metric one -- CsCallout.elevLabel's own
 * `suffix` parameter. Off the drawing's own unit via CsUnits, never a
 * constant, so a metric survey does not get labelled in feet. Lives
 * here rather than on either CalloutElev or CalloutSync because BOTH
 * need it, and a command reaching into a sibling command's file for a
 * helper is how a silent include failure gets introduced.
 */
CalloutWrite.suffixFor = function(doc) {
    var unit = CsUnits.fromDrawingUnit(doc.getUnit(), RS);
    return (unit === CsUnits.METERS) ? " m" : "'";
};

/** Strip callout tags off an entity, leaving it as ordinary geometry. */
CalloutWrite.unlink = function(di, entity) {
    var t = {};
    t[CsCallout.KEY.ID] = "";
    t[CsCallout.KEY.ROLE] = "";
    CsTags.commit(di, entity, t);
};
