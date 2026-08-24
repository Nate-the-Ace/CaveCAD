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

/** A plain {x1,y1,x2,y2} from a text's DATA, before it is added. */
CalloutWrite.boxOfData = function(textData) {
    var b = textData.getBoundingBox();
    var c1 = b.getCorner1();
    var c2 = b.getCorner2();
    return {
        x1: Math.min(c1.x, c2.x), y1: Math.min(c1.y, c2.y),
        x2: Math.max(c1.x, c2.x), y2: Math.max(c1.y, c2.y)
    };
};

/**
 * Build the WHOLE callout -- text and every leader -- into ONE
 * operation, without applying it. Returns {op, id, box, side}.
 *
 * ONE operation matters twice over.
 *
 * UNDO: the previous version applied the text in its own operation and
 * then each leader in another, so undoing a freshly placed callout took
 * as many presses as it had arrows. One operation is one undo, which is
 * what a caver expects from one gesture.
 *
 * PREVIEW: an operation that has not been applied can be handed to
 * di.previewOperation(), so the live preview is the REAL text in the
 * REAL font at the REAL size with its REAL leaders -- not an
 * approximation that then disagrees with what lands.
 *
 * What makes both possible: a text's bounding box is available BEFORE it
 * is added to a document. Measured -- getBoundingBox() pre-add returns
 * x 100.00..115.22 for a note whose post-add box is identical, and it
 * already honours the alignment. So the leaders can be solved against
 * the real box with no document round trip.
 */
CalloutWrite.buildOp = function(doc, spec) {
    var style = spec.style || CsCallout.STYLE_DEFAULT;
    var layerName = CsCallout.STYLES[style] ||
        CsCallout.STYLES[CsCallout.STYLE_DEFAULT];
    var shape = spec.leader || CsCallout.LEADER_DEFAULT;
    var id = CsCallout.newId();
    var layerId = doc.getLayerId(layerName);
    var op = new RAddObjectsOperation();

    var at = new RVector(spec.position.x, spec.position.y);

    // THE FLIP: the note grows AWAY from the arrow, so its near edge is
    // the pick point and the leader never crosses its own letters.
    // Measured: pick at x=100 with a 15-unit note boxes 100..115 under
    // HAlignLeft and 84.78..100 under HAlignRight -- either way the edge
    // facing the arrow IS the pick. The side comes from the pick point
    // because the text does not exist yet; CsCallout.sideFor is shared
    // with reflow so the two rules cannot drift.
    var side = CsCallout.sideFor(spec.tips, spec.position.x);
    var halign = (side === "left") ? RS.HAlignLeft : RS.HAlignRight;

    // Position AND alignment point, via the full constructor, as
    // CsDraw.addText does. setPosition() alone reads back correctly
    // while the entity renders at the ORIGIN -- that shipped once.
    var textData = new RTextData(at, at, spec.height, 100.0,
        RS.VAlignMiddle, halign, RS.LeftToRight, RS.Exact,
        1.0, spec.text, "standard", false, false, 0.0, false);

    var textEntity = new RTextEntity(doc, textData);
    textEntity.setLayerId(layerId);

    // Tag BEFORE adding (CsDraw.js:10), so the tags land in the SAME
    // operation as the geometry. CsTags.commit applies its own separate
    // ungrouped modify, which broke atomicity once already.
    var tags = {};
    tags[CsCallout.KEY.ID] = id;
    tags[CsCallout.KEY.ROLE] = CsCallout.ROLE_TEXT;
    tags[CsCallout.KEY.KIND] = spec.kind || CsCallout.KIND_TEXT;
    tags[CsCallout.KEY.STYLE] = style;
    tags[CsCallout.KEY.SIDE] = "auto";
    tags[CsCallout.KEY.LEADER] = shape;
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
    op.addObject(textEntity, false);

    var box = CalloutWrite.boxOfData(textData);
    var geom = CsCallout.reflow(box, spec.tips, {
        side: "auto",
        leader: shape,
        // Not DIMASZ/DIMSCALE: measured at 0.0833 in a real drawing,
        // a shoulder too short to see on a half-unit note. reflow falls
        // back to half the text height, right at every scale because it
        // is expressed in the note's own size.
        dimasz: null,
        dimscale: null
    });

    for (var b = 0; b < geom.branches.length; b++) {
        var pl = new RPolyline();
        var pts = geom.branches[b];
        for (var v = 0; v < pts.length; v++) {
            // Second argument is the BULGE, which in QCAD belongs to the
            // vertex a segment STARTS at. A curved leader carries its arc
            // on the tip; the shoulder stays straight.
            pl.appendVertex(new RVector(pts[v].x, pts[v].y),
                pts[v].bulge || 0.0);
        }
        var ent = new RLeaderEntity(doc, new RLeaderData(pl, true));
        ent.setLayerId(layerId);
        CsTags.set(ent, CsCallout.KEY.ID, id);
        CsTags.set(ent, CsCallout.KEY.ROLE, CsCallout.ROLE_LEADER);
        CsTags.set(ent, CsCallout.KEY.STYLE, style);
        op.addObject(ent, false);
    }

    return { op: op, id: id, box: box, side: geom.side };
};

/**
 * Place a new callout, in a single operation. Returns its id.
 *
 * \param spec {text, position: {x,y}, tips: [{x,y}], style, leader,
 *              kind, height, tags: {extra XDATA}}
 */
CalloutWrite.create = function(doc, di, spec) {
    var style = spec.style || CsCallout.STYLE_DEFAULT;
    var layerName = CsCallout.STYLES[style] ||
        CsCallout.STYLES[CsCallout.STYLE_DEFAULT];
    CsLayers.ensure(doc, di, layerName);

    var built = CalloutWrite.buildOp(doc, spec);
    CsLayers.withLayerOn(doc, di, layerName, function() {
        di.applyOperation(built.op);
    });

    // An operation that "succeeded" may have added nothing: LOCKED and
    // FROZEN layers refuse silently, withLayerOn covers OFF only, and
    // applyOperation reports nothing useful either way. Read the callout
    // back rather than trusting the call.
    var m = CalloutWrite.members(doc, built.id);
    if (m.text === null || m.leaders.length !== spec.tips.length) {
        throw new Error("callout did not land on layer " + layerName +
            " -- it may be locked or frozen (text=" +
            (m.text === null ? "missing" : "ok") + ", leaders=" +
            m.leaders.length + " of " + spec.tips.length + ")");
    }
    return built.id;
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
    // The leader SHAPE is read back off the text, not passed in, so a
    // reflow after a move or an edit keeps the curve the caver chose.
    var shape = CsTags.get(m.text, CsCallout.KEY.LEADER);
    var geom = CsCallout.reflow(CalloutWrite.boxOf(m.text), tips, {
        leader: (shape === "" ? CsCallout.LEADER_DEFAULT : shape),
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
                // The second argument is the BULGE, which in QCAD
                // belongs to the vertex a segment STARTS at. A straight
                // leader passes 0.0 throughout; a curved one carries the
                // arc on its tip vertex. Probed: RLeaderData(polyline,
                // true) preserves bulges AND its arrowhead.
                pl.appendVertex(new RVector(pts[p].x, pts[p].y),
                    pts[p].bulge || 0.0);
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

/**
 * Strip EVERY callout tag off an entity, leaving ordinary geometry.
 *
 * Uses CsTags.remove, not CsTags.set(key, ""). set() returns early on an
 * empty value by design -- so the original version of this function
 * silently did nothing, and a note that had lost its last arrow kept its
 * CalloutId and stayed a half-callout that members() still matched.
 * Caught by the listener's own test.
 *
 * Strips the whole key set, not just the id: a text left carrying
 * CalloutStyle or CalloutLeader is litter that reads as meaningful to
 * the next person who greps for it.
 */
CalloutWrite.unlink = function(di, entity) {
    if (isNull(entity)) {
        return;
    }
    for (var name in CsCallout.KEY) {
        if (CsCallout.KEY.hasOwnProperty(name)) {
            CsTags.remove(entity, CsCallout.KEY[name]);
        }
    }
    var op = new RModifyObjectsOperation();
    op.addObject(entity, false);
    di.applyOperation(op);
};
