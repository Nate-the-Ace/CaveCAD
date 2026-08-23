// CsProfileBind.js -- which profile stations a hand-drawn line belongs
// to, so that a regeneration MOVES it instead of leaving it behind.
//
// Part of the Cave Survey Core library. QCAD context only.
//
// The plan already solves this problem (CsBind + CsRevise.moveLinework)
// and this module changes exactly one thing about it: the INDEX. Plan
// binding matches a sketch's vertices against Station / LRUDName /
// SplayName tagged geometry; a profile drawing carries none of those,
// its station points carry ProfileStation. Point the same inference at
// a different index and the whole apparatus works here.
//
// WHY THE KEYS ARE RUN-QUALIFIED. A station name is not unique in a
// profile drawing: a tie station appears once in its own band and again
// at the origin of every band hanging off it, at different coordinates.
// "A2" alone cannot say which copy a sketch was traced against, so
// every key here is run + "/" + station. CsRevise.moveLinework does
// nothing but look names up in two maps, so a composite key costs it
// nothing -- both frames simply have to agree, which is why key() is
// the only place the composite is spelled.
//
// OFF LAYERS. This build silently refuses MODIFIES on an off layer
// exactly as it refuses adds and deletes (see CsLayers.withLayerOn's
// own note, and CsBind.tagEntities' identical concern for the plan
// side). claim() below WRITES tags -- an RModifyObjectsOperation -- so
// its di.applyOperation runs inside CsRevise.withOffLayersOn, which
// sweeps every layer in the document holding entities (not just this
// module's own, the way CsProfileDraw.withOwnLayersOn does -- that
// wrapper only knows the generator's OWN layer set, and the tracing
// layer a user hid to sketch on is never in it). The move in
// CsProfileDraw.render wraps CsRevise.moveLinework the same way, for
// the same reason: hiding the generated ceiling to trace over it on the
// plain PROFILE-CEILING layer is the exact workflow this whole feature
// exists for, and it must not be the one workflow that silently drops
// the sketch on the next revision.

var CsProfileBind = {};

/** The one spelling of a profile station's key. */
CsProfileBind.key = function(run, station) {
    return String(run) + "/" + String(station);
};

/**
 * Profile station positions as a binding index: [{name, x, y}] with
 * run-qualified names, which is the shape CsBind's inference expects.
 */
CsProfileBind.stationIndex = function(doc) {
    var out = [];
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || typeof e.getPosition !== "function") {
            continue;
        }
        // The station's point AND its text label carry ProfileStation
        // identically (CsProfileDraw.band tags both, on purpose -- see
        // that file's own acceptance criterion that every drawn entity
        // must carry ProfileRun). That is unlike the plan side, where
        // CsBind.stationIndex's "Station" tag never lands on a label at
        // all -- a label there carries a DIFFERENT tag, StationLabel,
        // so the two never collide. Without this getType() check, every
        // station contributes TWO index entries a fraction of a unit
        // apart (the label sits TEXT_HEIGHT*1.5 above its point), and
        // CsBind.marginFor's median-nearest-neighbour scan -- which has
        // no notion of "this pair is one feature counted twice" -- reads
        // that self-distance as the drawing's typical feature spacing
        // instead of the real distance between stations, collapsing the
        // proximity margin to a sliver of what it should be and making
        // the box fallback miss ceiling/floor tracing that is genuinely
        // near a station. Keeping only the POINT is the same choice
        // CsBind.stationIndex's own docblock makes for the identical
        // reason, just enforced by entity type here instead of by tag
        // name.
        if (typeof e.getType !== "function" ||
                e.getType() !== RS.EntityPoint) {
            continue;
        }
        var station = CsTags.get(e, "ProfileStation");
        if (station === null || station === "") {
            continue;
        }
        var run = CsTags.get(e, "ProfileRun");
        var pos;
        try {
            pos = e.getPosition();
        } catch (e2) {
            continue;
        }
        if (isNull(pos)) {
            continue;
        }
        out.push({ name: CsProfileBind.key(run, station),
            x: pos.x, y: pos.y });
    }
    return out;
};

/**
 * The CURRENT positions of every profile station, keyed the same way:
 * moveLinework's "before" frame.
 *
 * Read from the DRAWING, not from a rebuild, because the drawing is
 * the only record of where the sketch was traced against -- the survey
 * that produced those coordinates no longer exists once it has been
 * revised. Same reasoning as CsBind's, one file over.
 */
CsProfileBind.positions = function(doc) {
    var index = CsProfileBind.stationIndex(doc);
    var out = {};
    for (var i = 0; i < index.length; i++) {
        // first writer wins: a station drawn twice under one run key
        // would be a bug in the draw, not something to average away
        if (!out.hasOwnProperty(index[i].name)) {
            out[index[i].name] = { x: index[i].x, y: index[i].y };
        }
    }
    return out;
};

/**
 * Tags untagged linework in the profile drawing with the stations it
 * was traced against. Returns {tagged, skipped, skippedLabels}.
 *
 * skippedLabels names, "LAYER #id" each (moveLinework's own label
 * shape), every entity that binds to NO station at all -- an entity
 * moveLinework itself will never mention, because it never gets a tag
 * to make it visible to that function in the first place (an untagged
 * entity is invisible to moveLinework's own scan, by CsRevise's explicit
 * design: "what is still untagged when this runs is untagged on
 * purpose"). CsProfileDraw.render folds this list into counts.linework.
 * unmoved so a sketch drawn nowhere near the survey is named SOMEWHERE
 * in the report the user sees, not only in a count that says how many
 * without saying which.
 *
 * Runs BEFORE the erase, from the mover's own vantage point -- the same
 * guarantee CsBind's revision-time pass gives in plan, and for the same
 * reason: it needs no listener to have been armed and it works on a
 * drawing made before any of this existed.
 *
 * The write is wrapped in CsRevise.withOffLayersOn: see this file's own
 * banner comment for why an untagged sketch on a layer the user hid
 * would otherwise never get tagged at all, and so could never move no
 * matter what the caller does with moveLinework afterward.
 */
CsProfileBind.claim = function(doc, di) {
    var result = { tagged: 0, skipped: 0, skippedLabels: [] };
    if (typeof CsBind === "undefined") {
        return result;
    }
    var index = CsProfileBind.stationIndex(doc);
    if (index.length === 0) {
        return result;
    }
    var epsilon = CsBind.epsilonFor(doc);
    var op = new RModifyObjectsOperation();
    op.setText("Bind traced profile linework");
    var any = false;

    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        // our own output is never linework, whatever layer it landed on
        if (CsProfileBind.isProfileGeometry(e)) {
            continue;
        }
        var layer = CsBind.layerNameOf(doc, e);
        if (!CsBind.isLineworkLayer(layer)) {
            continue;
        }
        if (CsBind.hasLineworkTags(e)) {
            continue;   // already claimed, by this pass or an earlier one
        }
        var pts = CsBind.pointsOf(e);
        var names = CsBind.stationsForPoints(pts, index, epsilon);
        if (names.length === 0) {
            names = CsBind.stationsInBox(CsBind.boxOfPoints(pts), index,
                CsBind.marginFor(index));
        }
        if (names.length === 0) {
            result.skipped++;
            result.skippedLabels.push(layer + " #" + e.getId());
            continue;
        }
        CsTags.set(e, CsBind.STATIONS_TAG, CsBind.encodeStations(names));
        op.addObject(e, false);
        any = true;
        result.tagged++;
    }
    if (any) {
        // see this file's banner: a tag write is a MODIFY, and this
        // build drops a MODIFY on an off layer with no error at all
        CsRevise.withOffLayersOn(doc, di, function() {
            di.applyOperation(op);
        });
    }
    return result;
};

/** True for anything CsProfileDraw drew. */
CsProfileBind.isProfileGeometry = function(entity) {
    for (var t = 0; t < CsProfileDraw.TAGS.length; t++) {
        var v = CsTags.get(entity, CsProfileDraw.TAGS[t]);
        if (v !== null && v !== "") {
            return true;
        }
    }
    return false;
};
