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
    var before = CalloutWrite.idSet(doc);

    var textData = new RTextData();
    textData.setText(spec.text);
    textData.setPosition(new RVector(spec.position.x, spec.position.y));
    textData.setTextHeight(spec.height);
    var textEntity = new RTextEntity(doc, textData);
    textEntity.setLayerId(doc.getLayerId(layerName));

    CsLayers.withLayerOn(doc, di, layerName, function() {
        var op = new RAddObjectsOperation();
        op.addObject(textEntity, false);
        di.applyOperation(op);
    });

    var added = CalloutWrite.newIds(doc, before);
    if (added.length !== 1) {
        // An operation that "succeeded" may have added nothing: a
        // LOCKED or FROZEN layer refuses silently and withLayerOn
        // covers OFF only.
        throw new Error("callout text was not added -- layer " +
            layerName + " may be locked or frozen");
    }
    var textId = added[0];
    var text = doc.queryEntity(textId);

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
    CsTags.commit(di, text, tags);

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
        dimasz: CalloutWrite.dimVar(doc, RS.DIMASZ),
        dimscale: CalloutWrite.dimVar(doc, RS.DIMSCALE)
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
            var before = CalloutWrite.idSet(doc);
            var pl = new RPolyline();
            var pts = geom.branches[b];
            for (var p = 0; p < pts.length; p++) {
                pl.appendVertex(new RVector(pts[p].x, pts[p].y));
            }
            var data = new RLeaderData(pl, true);   // true = arrowHead
            var ent = new RLeaderEntity(doc, data);
            ent.setLayerId(doc.getLayerId(layerName));

            var op = new RAddObjectsOperation();
            op.addObject(ent, false);
            if (group !== null && group !== undefined) {
                op.setTransactionGroup(group);
            }
            di.applyOperation(op);

            var added = CalloutWrite.newIds(doc, before);
            if (added.length === 1) {
                var live = doc.queryEntity(added[0]);
                var t = {};
                t[CsCallout.KEY.ID] = String(id);
                t[CsCallout.KEY.ROLE] = CsCallout.ROLE_LEADER;
                t[CsCallout.KEY.STYLE] = style;
                CsTags.commit(di, live, t);
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
 * One dimension variable, or null when the drawing has not set it.
 *
 * The default MUST be numeric: getKnownVariable(handle, null) returns
 * undefined and prints "RJSHelper::js2cpp_QVariant: no wrapper", and
 * the one-argument form returns undefined too. 0 comes back for an
 * unset variable, and 0 is not a usable length -- so it maps to null
 * and lets CsCallout.reflow's landing-length fallback carry it.
 */
CalloutWrite.dimVar = function(doc, handle) {
    var v = doc.getKnownVariable(handle, 0);
    if (v === null || v === undefined || v <= 0) {
        return null;
    }
    return v;
};

/**
 * Text height for a new callout: the drawing's own DIMTXT, so a note
 * matches the sheet's other annotation at whatever scale it plots. Lives
 * here rather than on any one command because all of them need it.
 */
CalloutWrite.textHeight = function(doc) {
    var h = CalloutWrite.dimVar(doc, RS.DIMTXT);
    return (h === null) ? 2.5 : h;   // 2.5 is a last resort, not a default
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
