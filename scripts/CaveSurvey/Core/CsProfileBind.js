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
// THE BIGGEST DIVERGENCE FROM PLAN-VIEW PARITY: this index carries
// STATION POINTS ONLY -- no ceiling, no floor. CsBind.stationIndex on
// the plan side ALSO indexes LRUD tips and splay endpoints, because
// CsDraw tags each one with the station it belongs to; a wall traced
// snugly against a plan wall run therefore usually gets exact-match
// binding for every vertex. Nothing analogous exists here:
// CsProfile.bandWallRuns hands back ceiling/floor runs as bare
// [{x,y}] with no station name attached at all (see that function's
// own comment -- LRUD data collapses into a run, the station identity
// does not survive the collapse), so there is no tag CsProfileBind
// could read off a ceiling/floor vertex even if it wanted to. A sketch
// traced onto the GENERATED CEILING OR FLOOR can therefore never reach
// stationsForPoints' exact-coincidence path -- it can only ever fall
// back to stationsInBox's proximity match against nearby STATION
// points (see tests/profile_draw_roundtrip.js fixture 5's own banner
// for the exact-match case this asymmetry rules out here). The
// practical cost: a long traced ceiling line spanning many stations
// binds to all of them by proximity, and CsRevise.moveLinework's
// residual check (LINEWORK_RESIDUAL_FRACTION) refuses any fit that
// does not describe every bound point as one rigid piece -- so the
// longer such a line is, the more likely SOME bend among the stations
// it spans pushes the residual over tolerance. Long traced ceiling/
// floor lines are, perversely, the sketches in this whole feature
// LEAST likely to survive a revision moving with it; a short line
// snapped to one or two nearby stations is far more robust.
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
//
// ROTATION IS ACCEPTED HERE, UNCHANGED FROM PLAN, ON PURPOSE -- AND IT
// IS NOT FREE. CsRevise.similarityFit (and so moveLinework) fits a
// full rotate+scale+translate, which is the right answer in PLAN,
// where a survey correction can genuinely rotate a passage. In an
// EXTENDED ELEVATION, X is unrolled along-passage distance and Y is
// elevation -- a "rotation" of the sketch has no cave-geometry meaning
// at all, it is purely an artifact of how similarityFit describes a
// shape change with too few points to pin down anything better. The
// user's explicit decision (see this feature's own commit history) was
// to reuse similarityFit UNCHANGED rather than fork a
// translation-and-scale-only variant for profiles -- measured cost,
// so this is not a hypothetical: correcting ONE leg's inclination from
// 0 degrees to 20 degrees, with a ceiling polyline bound across that
// leg's two endpoints (a 2-point fit, always zero-residual, so nothing
// here refuses it and nothing reports it), tilts the sketch by 10.000
// degrees -- exactly half the 20-degree correction -- at scale
// 0.98481 and maxResidual 4.4e-16. A stroke traced running straight up
// (90.00 degrees) comes back at 100.00 degrees, its length shrunk from
// 5.000 to 4.924. Only a ONE-station sketch is safe from this (a
// 1-pair fit is pure translation, theta forced to 0 -- see
// similarityFit's own 1-pair branch); anything spanning two or more
// stations inherits plan's rotation tolerance whether or not a
// rotation is what actually happened to the passage.

var CsProfileBind = {};

/** The one spelling of a profile station's key. */
CsProfileBind.key = function(run, station) {
    return String(run) + "/" + String(station);
};

/**
 * Profile station positions as a binding index: [{name, x, y}] with
 * run-qualified names, which is the shape CsBind's inference expects.
 *
 * BOTH a ProfileStation tag AND membership in one of
 * CsProfileDraw.LAYERS() are required -- mirroring exactly the
 * ownership test CsProfileDraw.erase() applies before deleting
 * anything, and for the identical reason. A station point a
 * cartographer PROMOTED (changed the layer of, to keep it past the
 * next erase -- see erase()'s own docblock for the motivating
 * workflow) still carries ProfileStation/ProfileRun afterward: XDATA
 * survives a layer change. Without the layer check, the very next
 * render() draws a FRESH point at the recomputed position under the
 * SAME run-qualified key, and this index would then hand back TWO
 * entries for one key with no principled way to choose between them --
 * queryAllEntities' enumeration order is not guaranteed anywhere in
 * this codebase, so whichever one positions() below happened to see
 * first would be arbitrary, and WRONG FOREVER: the stale, promoted
 * point never moves again once it is off CsProfileDraw's own layers,
 * so every later revision would carry a sketch bound to that key by
 * whatever bogus delta separates the stale point from the real one.
 * Requiring the layer drops the promoted point out of the index
 * entirely, the same way it already drops out of erase()'s victim
 * list -- there is exactly one live position per key again.
 */
CsProfileBind.stationIndex = function(doc) {
    var out = [];
    var ownLayers = {};
    var ownLayerNames = CsProfileDraw.LAYERS();
    for (var ln = 0; ln < ownLayerNames.length; ln++) {
        ownLayers[ownLayerNames[ln]] = true;
    }

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
        // ownership test (see this function's own docblock above): a
        // tag alone is not proof this point is CURRENT, only that it
        // was once ours.
        var layerName;
        try {
            layerName = doc.getLayerName(e.getLayerId());
        } catch (eLayer) {
            continue;   // layer unreadable: not provably current, skip
        }
        if (ownLayers[layerName] !== true) {
            continue;
        }
        var station = CsTags.get(e, "ProfileStation");
        if (station === null || station === "") {
            continue;
        }
        var run = CsTags.get(e, "ProfileRun");
        if (run === null || run === "") {
            // Every entity CsProfileDraw.band draws carries BOTH tags
            // together (its own acceptance criterion) -- a station
            // point with no run is not a real draw this module ever
            // produced, and String(null) + "/" + station would silently
            // mint a "/A2"-shaped key that can never match anything in
            // positionsOf's own run-qualified map, yet would still
            // occupy that wrong slot permanently. Skip it rather than
            // index a key nothing can ever look up.
            continue;
        }
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
        // first writer wins -- stationIndex() above is now the single
        // gate that keeps this a genuine one-key-one-position map (its
        // own docblock has the full reasoning: same tag + same layer
        // membership is required, so a promoted duplicate never reaches
        // here at all). This is no longer a defense against a
        // hypothetical "bug in the draw" -- it is dead code for the
        // ordinary case (stationIndex never emits two entries for the
        // same key any more) kept only as a last-resort guard against
        // an index that somehow still did.
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
 * REFUSES to write anything when CsBind.autoBindEnabled() is false --
 * the same first guard CsBind.planAutoBind applies on the plan side
 * ("Empty when the switch is off"), for the identical reason: this
 * function WRITES TAGS onto geometry the user drew themselves, which
 * is the one thing in this suite that touches their own work unasked.
 * The Survey Notebook's binding switch is a prominent, explicit
 * preference (its OFF tooltip promises "revising a trip will move the
 * survey and leave your tracing behind") -- honoring it here is not
 * optional politeness, it is the one thing standing between a user's
 * considered choice and a silent, unauthorised write to their drawing.
 * CsRevise.moveLinework's own docblock already reasons that an
 * untagged entity may be untagged ON PURPOSE, "because ... the user
 * switched automatic binding off" -- that reasoning is simply false
 * for profile linework unless this function actually honors the
 * switch, which is exactly what was missing before this guard existed.
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
 *
 * NO DEFENSIVE typeof GUARD for CsBind, CsRevise or CsProfileDraw --
 * unlike CsRevise.moveLinework's own "soft dependency" on CsBind (that
 * module can be loaded stand-alone by something that never heard of
 * binding at all). CsAll.js's own load order is explicit that this is
 * not true here: "After both CsBind and CsRevise: CsProfileBind calls
 * into each" is a HARD guarantee this file's only production loader
 * gives, and stationIndex()/isProfileGeometry() above already call
 * CsProfileDraw unconditionally on that same guarantee. One policy,
 * stated once: CsProfileBind treats CsBind, CsRevise and CsProfileDraw
 * as hard dependencies throughout, never as optional ones.
 */
CsProfileBind.claim = function(doc, di) {
    var result = { tagged: 0, skipped: 0, skippedLabels: [] };
    if (!CsBind.autoBindEnabled()) {
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
