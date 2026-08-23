// CsProfileDraw.js -- putting a built extended elevation into a drawing.
//
// Part of the Cave Survey Core library. QCAD context only: every
// function here that touches a document takes the document and
// interface EXPLICITLY, because the profile lives in a sibling drawing
// that is usually not the current one -- getDocument() would draw the
// elevation on top of the plan. (CsProfileDraw.labelText and
// CsProfileDraw.labelY0 are the one exception: pure text/number
// helpers, no document involved, tested under node as well as CaveCAD.)
//
// TAG NAMESPACE. Profile geometry carries Profile* tags, a namespace of
// its own, so that plan-side scanners (CsDraw.eraseStations,
// RebuildSurveyData, CsRevise) can never mistake an elevation for a
// plan even if the two drawings are one day merged. erase() keys on
// BOTH this namespace AND layer membership (CsProfileDraw.LAYERS()) --
// the tag alone is what THIS module writes, never a guarantee about
// what every entity in the drawing carries: a generated line promoted
// to a plain tracing layer (see erase()'s own docblock) keeps its tag
// through the move, and only the layer check is what then tells the
// two apart. That pairing is what makes regeneration replace the
// generator's own output and leave hand-drawn -- and hand-promoted --
// work alone.
//
//   ProfileRun         every entity of a band: its run key
//   ProfileStation     station point and its label
//   ProfileShot        centerline leg, "A1->A2"
//   ProfileSplay       a near-horizontal splay's flat tick
//   ProfileFloorRun    generated floor polyline
//   ProfileCeilingRun  generated ceiling polyline
//   ProfileBandLabel   the band's caption
//   ProfileZOffset     on the caption: the datum shift, when displaced
//
// NO ProfileLrud TAG, DELIBERATELY. An earlier draft of this table
// carried one for a station's own U/D tick, but the acceptance
// criteria for this file are explicit that no such tick is drawn: the
// up/down measurement is already the first point of the ceiling/floor
// run it belongs to (CsProfile.bandWallRuns pushes it with `order: -1`
// so it sorts first), so a second, separate tick would just be the
// same evidence drawn twice. Keeping an unused tag name in this table
// would misdescribe what the code below actually does.

var CsProfileDraw = {};

CsProfileDraw.TAGS = ["ProfileRun", "ProfileStation", "ProfileShot",
    "ProfileSplay", "ProfileFloorRun", "ProfileCeilingRun",
    "ProfileBandLabel", "ProfileZOffset", "ProfileOrigin",
    "ProfileExaggerationStamp"];

/** Layers the profile writes to, created if the drawing lacks them.
 *  CTRL-PROFILE-LRUD is NOT here -- see the TAGS docblock above;
 *  this module never draws a separate LRUD tick, so ensuring it would
 *  promise geometry that never lands on it. */
CsProfileDraw.LAYERS = function() {
    return [CsLayers.PROFILE_SHOTS, CsLayers.PROFILE_STATIONS,
        CsLayers.PROFILE_STATION_LABELS, CsLayers.PROFILE_SPLAYS,
        CsLayers.PROFILE_FLOOR, CsLayers.PROFILE_CEILING,
        CsLayers.PROFILE_TEXT_LABELS];
};

/**
 * Runs fn with EVERY layer this module writes to switched on, then
 * restores each one's own previous on/off state after -- nested via
 * CsLayers.withLayerOn, the same closure-chaining CsDraw.eraseStations
 * uses for CTRL-HIDDEN/CTRL-RAW.
 *
 * None of CsProfileDraw.LAYERS() ships off by default, unlike
 * CTRL-HIDDEN/CTRL-RAW. But this build refuses adds AND deletes on an
 * off layer with no error at all, and a user can switch any layer off
 * by hand at any time -- turning off the generated CTRL-PROFILE-CEILING
 * to see past it while tracing on the plain PROFILE-CEILING layer is
 * exactly the workflow this feature exists for. Without this wrapper,
 * that ordinary act would silently break the NEXT redraw: erase()
 * would fail to remove the old ceiling run (it survives, off-screen but
 * present) and render() would fail to add the new one (also silently
 * dropped), so the redraw would appear to do nothing at all rather than
 * doubling or erroring -- the quietest possible failure.
 *
 * The layer SET is fixed and small (CsProfileDraw.LAYERS()), so this
 * wraps all of them unconditionally rather than detecting per-entity
 * which layers are actually touched (the way CsDraw.eraseStations does
 * for its much larger, open-ended set of layers) -- CsLayers.withLayerOn
 * itself is already a no-op but for one cheap queryLayer() call when a
 * layer is not off, so wrapping a layer that never needed it costs
 * nothing worth avoiding.
 *
 * \return whatever fn returns
 */
CsProfileDraw.withOwnLayersOn = function(doc, di, fn) {
    var layers = CsProfileDraw.LAYERS();
    var wrapped = fn;
    for (var i = 0; i < layers.length; i++) {
        wrapped = (function(layerName, inner) {
            return function() {
                return CsLayers.withLayerOn(doc, di, layerName, inner);
            };
        })(layers[i], wrapped);
    }
    return wrapped();
};

/**
 * Erases every entity this module drew, and only those.
 *
 * BOTH a Profile* tag AND a layer in CsProfileDraw.LAYERS() are
 * required -- a tag alone is NOT proof of ownership. The obvious
 * cartographer move is to take a generated CTRL-PROFILE-CEILING
 * polyline worth keeping and change ITS LAYER to the plain,
 * un-prefixed PROFILE-CEILING tracing layer, rather than retracing it
 * by hand. XDATA is per-entity and survives a layer change, so that
 * promoted line still carries every Profile* tag it was drawn with --
 * a tag-only scan destroyed it on the very next redraw, exactly the
 * "regeneration must not eat MY work" property this whole module
 * exists to protect, on the one piece of kept work that happens to
 * still answer to our own tags. Checking the layer too costs nothing
 * against the generator's own output (render() never draws anywhere
 * else) and is what makes the promoted line survive: the scan still
 * finds it (it IS tagged), but its layer is not one of ours, so it is
 * left alone and a fresh copy is drawn beside it instead.
 *
 * Ordinary hand-drawn linework typically carries no Profile* tag at
 * all, which is most of why a plain sketch survives -- but that is a
 * fact about how people usually draw, not something this function can
 * safely rely on by itself; the layer check is what makes the
 * ownership test hold for every case, promoted lines included.
 *
 * The delete runs inside CsProfileDraw.withOwnLayersOn: off layers
 * refuse deletes as silently as they refuse adds in this build, so
 * without that wrapper a victim on a layer the user switched off would
 * survive, and the very next render() would draw a second copy beside
 * it -- the eraseStations bug this whole feature's brief calls out by
 * name, reproduced here if this wrapper is ever dropped.
 *
 * \return number of entities removed
 */
CsProfileDraw.erase = function(doc, di) {
    var ownLayers = {};
    var ownLayerNames = CsProfileDraw.LAYERS();
    for (var ln = 0; ln < ownLayerNames.length; ln++) {
        ownLayers[ownLayerNames[ln]] = true;
    }

    var victims = [];
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        var tagged = false;
        for (var t = 0; t < CsProfileDraw.TAGS.length; t++) {
            var v = CsTags.get(e, CsProfileDraw.TAGS[t]);
            if (v !== null && v !== "") {
                tagged = true;
                break;
            }
        }
        if (!tagged) {
            continue;
        }
        // Tagged is not enough on its own (see above): also require
        // the entity to still be sitting on one of OUR layers. A
        // promoted line's layer name is not in this set, so it never
        // reaches `victims` even though the tag loop just found it.
        var layerName;
        try {
            layerName = doc.getLayerName(e.getLayerId());
        } catch (eLayer) {
            continue;   // layer unreadable: not provably ours, leave it
        }
        if (ownLayers[layerName] !== true) {
            continue;
        }
        victims.push(ids[i]);
    }
    if (victims.length === 0) {
        return 0;
    }
    var op = new RDeleteObjectsOperation();
    op.setText("Erase generated profile");
    for (i = 0; i < victims.length; i++) {
        var ent = doc.queryEntity(victims[i]);
        if (!isNull(ent)) {
            op.deleteObject(ent);
        }
    }
    CsProfileDraw.withOwnLayersOn(doc, di, function() {
        di.applyOperation(op);
    });
    return victims.length;
};

/**
 * The band's caption, as pure text -- no document, no RVector, so this
 * one function runs (and is unit-tested) under plain node as well as
 * CaveCAD. Everything about WHERE the caption goes lives in
 * CsProfileDraw.label() below; this is only WHAT it says.
 */
CsProfileDraw.labelText = function(band) {
    var text = band.key + " SURVEY";
    if (band.tie !== null && band.tie !== undefined && band.tie !== "") {
        text += " (FROM " + band.tie + ")";
    }
    if (band.stations.length === 0) {
        // Nothing at all was drawn for this band: CsProfile.unrollBand
        // stopped it at its own first chain station (the only way
        // `stations` comes back empty -- see CsProfileDraw.labelY0's
        // docblock for why that also means `datum` is null, not 0).
        // Name the station and the reason instead of drawing a caption
        // that could read as if the band existed at some elevation.
        text += " -- STOPPED AT " + band.stopped +
            " (" + band.stoppedReason + ")";
        return text;
    }
    var dz = band.zOffset || 0.0;
    if (Math.abs(dz) > 1e-9) {
        // A displaced band that did not say so would misinform a
        // reader about depth -- the offset is written here precisely
        // because it is also tagged (CsProfileDraw.label), not merely
        // a decoration.
        text += " -- SHOWN " + Math.abs(dz).toFixed(1) +
            (dz < 0 ? " BELOW" : " ABOVE") + " TRUE ELEVATION";
    }
    return text;
};

/**
 * The caption's pre-offset Y -- band.zOffset is added separately by the
 * caller's own `at()`, exactly like every other coordinate a band
 * draws, so this returns the same TRUE-elevation value the band's own
 * geometry is built from, not a drawing-space one.
 *
 * band.stations[0].y when the band drew a first station: true
 * elevation (already exaggerated -- unrollBand's own yOf), the same
 * height the leftmost centerline point sits at.
 *
 * 0.0, EXPLICITLY, when it did not (band.stations.length === 0). The
 * tempting shortcut -- `band.datum` -- is null in EXACTLY this case
 * (CsProfile.unrollBand: datum is null whenever the chain is empty or
 * its first member's Z never resolved, which is also the only way
 * `stations` itself comes back empty). NOT A BUG FIX, TO BE CLEAR:
 * `null + h` and `0.0 + h` are the same number in this language, so a
 * caller using `band.datum` directly would have drawn at exactly this
 * same height -- nothing was ever drawn wrong, and a mutation that
 * reverts this to `band.datum` is an EQUIVALENT mutant, not a covered
 * one. What this buys is that the code no longer DEPENDS on that
 * coercion to reach the right number by accident: reading `0.0` here
 * says plainly "no station, wall point, or leg is drawn at this height
 * for this band" rather than resting on `null`'s arithmetic behavior,
 * which is exactly the kind of implicit reliance the "never default a
 * missing Z to 0" convention exists to keep out of code that touches
 * real survey elevations -- even though, this one time, the coercion
 * and the explicit value happen to agree. CsProfileDraw.labelText's
 * caption for this same case names the real station and reason a
 * reader would otherwise have to guess at.
 */
CsProfileDraw.labelY0 = function(band) {
    if (band.stations.length > 0) {
        return band.stations[0].y;
    }
    return 0.0;
};

/**
 * The band's caption entity: its run, its tie, and -- when the band had
 * to be pushed off true elevation to clear another, or drew nothing at
 * all -- why. See CsProfileDraw.labelText for what it says.
 */
CsProfileDraw.label = function(doc, op, band, at) {
    var text = CsProfileDraw.labelText(band);
    var y = CsProfileDraw.labelY0(band);
    var label = CsDraw.addText(doc, op, CsLayers.PROFILE_TEXT_LABELS, text,
        at(0, y + CsDraw.TEXT_HEIGHT * 4.0), RS.HAlignLeft,
        "ProfileBandLabel", band.key);
    // CsDraw.addText already queued `label` into `op` via its own
    // op.addObject(entity, false) -- this second CsTags.set, applied to
    // the SAME entity reference before di.applyOperation(op) actually
    // commits it, is the identical pattern CsDraw.survey uses to add
    // Trip*/Survey* tags onto a station point well after that point's
    // own op.addObject call (see its anchor0/tripAnchor handling), not
    // a new or untested one.
    CsTags.set(label, "ProfileRun", band.key);
    var dz = band.zOffset || 0.0;
    if (Math.abs(dz) > 1e-9) {
        CsTags.set(label, "ProfileZOffset", String(dz));
    }
};

/** One generated polyline (a ceiling or floor run). */
CsProfileDraw.run = function(doc, op, layerName, points, at, tagKey,
        tagValue, runKey) {
    if (points.length < 2) {
        return;   // CsProfile.bandWallRuns never emits a shorter run,
                  // but this stays defensive rather than assuming it
    }
    // vertices go into the DATA, then the data into the entity -- the
    // same order CsDraw's wall-run drawing uses (CsDraw.survey's
    // drawRuns); there is no appendVertex on the entity in this bridge.
    var data = new RPolylineData();
    for (var i = 0; i < points.length; i++) {
        data.appendVertex(at(points[i].x, points[i].y));
    }
    var pl = new RPolylineEntity(doc, data);
    pl.setLayerId(doc.getLayerId(layerName));
    CsTags.set(pl, tagKey, tagValue);
    CsTags.set(pl, "ProfileRun", runKey);
    op.addObject(pl, false);
};

/** One band, into an operation already open. */
CsProfileDraw.band = function(doc, op, band, counts, origin) {
    var dz = band.zOffset || 0.0;
    // TWO offsets, and they are not the same thing. dz is the band's
    // own displacement, part of what the elevation SAYS (a spur shown
    // below true elevation so it does not overprint the trunk, and
    // labelled as such). The origin is where the whole region was
    // placed in the drawing, which says nothing about the cave at all.
    var ox = (origin === undefined || origin === null) ? 0 : origin.x;
    var oy = (origin === undefined || origin === null) ? 0 : origin.y;
    var at = function(x, y) {
        return new RVector(ox + x, oy + y + dz);
    };
    var runTag = { ProfileRun: band.key };
    var i;

    for (i = 0; i < band.legs.length; i++) {
        var leg = band.legs[i];
        CsDraw.addLine(doc, op, CsLayers.PROFILE_SHOTS,
            at(leg.fromX, leg.fromY), at(leg.toX, leg.toY),
            "ProfileShot", leg.from + "->" + leg.to, runTag);
        counts.legsDrawn++;
    }

    for (i = 0; i < band.stations.length; i++) {
        var st = band.stations[i];
        var pt = CsDraw.addPoint(doc, op, CsLayers.PROFILE_STATIONS,
            at(st.x, st.y));
        CsTags.set(pt, "ProfileStation", st.name);
        CsTags.set(pt, "ProfileRun", band.key);
        op.addObject(pt, false);
        counts.stationsDrawn++;

        var label = CsDraw.addText(doc, op, CsLayers.PROFILE_STATION_LABELS,
            st.name, at(st.x, st.y + CsDraw.TEXT_HEIGHT * 1.5),
            RS.HAlignCenter, "ProfileStation", st.name);
        // Same after-the-fact tagging as CsProfileDraw.label above:
        // CsDraw.addText's own single tagKey/tagValue slot already
        // wrote ProfileStation; ProfileRun rides on afterward so the
        // label entity carries BOTH -- every entity this module draws
        // must carry ProfileRun (the acceptance criterion this fixes:
        // an earlier draft left the station label as the one entity
        // missing it).
        CsTags.set(label, "ProfileRun", band.key);
    }

    for (i = 0; i < band.ceiling.length; i++) {
        CsProfileDraw.run(doc, op, CsLayers.PROFILE_CEILING,
            band.ceiling[i], at, "ProfileCeilingRun",
            band.key + "." + (i + 1), band.key);
        counts.ceilingRuns++;
    }
    for (i = 0; i < band.floor.length; i++) {
        CsProfileDraw.run(doc, op, CsLayers.PROFILE_FLOOR,
            band.floor[i], at, "ProfileFloorRun",
            band.key + "." + (i + 1), band.key);
        counts.floorRuns++;
    }

    // Flat (near-horizontal) splays get a short tick, same shape an
    // LRUD tip takes -- they are NOT part of any ceiling/floor run
    // (CsProfile.bandWallRuns routes them to band.flat, not
    // ceiling/floor, for exactly this reason), so this is their only
    // appearance in the drawing; a "ray to the wall" would double them
    // with the along-passage point that already exists nowhere else.
    for (i = 0; i < band.flat.length; i++) {
        var f = band.flat[i];
        var half = CsDraw.TEXT_HEIGHT;
        CsDraw.addLine(doc, op, CsLayers.PROFILE_SPLAYS,
            at(f.x, f.y - half), at(f.x, f.y + half),
            "ProfileSplay", f.name, runTag);
        counts.flatTicks++;
    }

    CsProfileDraw.label(doc, op, band, at);
};

/**
 * Where every station WILL be once this profile is drawn, keyed the way
 * CsProfileBind keys them: moveLinework's "after" frame.
 */
CsProfileDraw.positionsOf = function(profile, origin) {
    var out = {};
    // The region's own placement in the drawing. Omitted means (0, 0):
    // the band coordinates themselves, which is what a caller comparing
    // one BUILD against another wants. render() passes the real origin,
    // because what it compares against is what is on the paper.
    var ox = (origin === undefined || origin === null) ? 0 : origin.x;
    var oy = (origin === undefined || origin === null) ? 0 : origin.y;
    var bands = (profile && profile.bands) ? profile.bands : [];
    for (var b = 0; b < bands.length; b++) {
        var band = bands[b];
        var dz = band.zOffset || 0.0;
        for (var i = 0; i < band.stations.length; i++) {
            var st = band.stations[i];
            out[CsProfileBind.key(band.key, st.name)] =
                { x: ox + st.x, y: oy + st.y + dz };
        }
    }
    return out;
};

/**
 * The exaggeration factor as it is written on the drawing: 2 reads
 * "2x", 1.5 reads "1.5x". Pure.
 *
 * A whole number loses its ".0" -- "2.0x" reads like a measurement to
 * one decimal place, which is not what a factor of two is -- and
 * anything else keeps exactly the digits it needs, trailing zeros
 * trimmed, so 1.50 and 1.5 are the same stamp.
 */
CsProfileDraw.exaggerationText = function(exag) {
    var n = Number(exag);
    if (!isFinite(n)) {
        return "";
    }
    var text;
    if (Math.abs(n - Math.round(n)) < 1e-9) {
        text = String(Math.round(n));
    } else {
        text = n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
    }
    return text + "x";
};

/**
 * The stamp an exaggerated elevation carries, or null when there is
 * nothing to say. Pure -- CsProfileDraw.stamp draws what this returns.
 *
 * WHY IT EXISTS. A vertical exaggeration makes the cave look deeper
 * than it is, and the sheet's own scale bar measures the PLAN. A reader
 * scaling a height off the elevation with that bar gets a wrong number
 * and has nothing in the drawing to tell them so. At 1.0 -- the default
 * -- there is nothing to warn about, and a notice that is always there
 * is one nobody reads, so there is no stamp at all.
 */
CsProfileDraw.stampText = function(profile) {
    var bands = (profile && profile.bands) ? profile.bands : [];
    if (bands.length === 0) {
        return null;
    }
    // Every band is unrolled under the SAME opts.exaggeration
    // (CsProfile.build passes one value to unrollBand for all of them),
    // so the first band's factor is the region's factor.
    var exag = (bands[0].exaggeration === undefined ||
        bands[0].exaggeration === null) ? 1.0 : Number(bands[0].exaggeration);
    if (!isFinite(exag) || Math.abs(exag - 1.0) < 1e-9) {
        return null;
    }
    return "Vertical exaggeration " + CsProfileDraw.exaggerationText(exag) +
        " -- not to sheet scale";
};

/**
 * Draws the exaggeration stamp, if there is one, into an operation
 * already open. Tagged ProfileExaggerationStamp, which is in
 * CsProfileDraw.TAGS, so erase() takes it with the rest of the
 * generated geometry and a redraw replaces it rather than stacking a
 * second copy on the first.
 *
 * Through CsDraw.addText like every other string this suite draws: the
 * capitalisation is that function's business, at one chokepoint, not
 * something written into the sentence above by hand.
 */
CsProfileDraw.stamp = function(doc, op, profile, origin, bounds) {
    var text = CsProfileDraw.stampText(profile);
    if (text === null || bounds === null) {
        return null;
    }
    var ox = (origin === undefined || origin === null) ? 0 : origin.x;
    var oy = (origin === undefined || origin === null) ? 0 : origin.y;
    // Above the region's own top edge, clear of the topmost band
    // caption (which sits TEXT_HEIGHT * 4 above its band).
    var pos = new RVector(ox + bounds.minX,
        oy + bounds.maxY + CsDraw.TEXT_HEIGHT * 7.0);
    return CsDraw.addText(doc, op, CsLayers.PROFILE_TEXT_LABELS, text, pos,
        RS.HAlignLeft, "ProfileExaggerationStamp", text);
};

// ---------------------------------------------------------------------
// THE REGION: where the elevation is placed in the plan drawing.
// ---------------------------------------------------------------------

/** Blank drawing units between the plan's southern edge and the top of
 *  the elevation. Twenty label heights: enough that the plan's own
 *  bottom labels and the elevation's top band caption cannot collide at
 *  any zoom, and small enough that both still frame together on screen.
 *  In DRAWING units, so it scales with the survey's own units the way
 *  every other spacing in this suite does. */
CsProfileDraw.REGION_GUTTER = 20.0;

/**
 * The bounding box of everything in the PLAN frame, as
 * {minX, minY, maxX, maxY}, or null when the drawing holds no plan
 * geometry at all. QCAD only.
 *
 * Frame-scoped rather than doc.getBoundingBox(): the elevation is IN
 * this drawing, so the document's own extents already include the
 * region being placed. Feeding that back in would push the region
 * further down on every single redraw -- a drawing that walks south
 * forever, one gutter at a time.
 */
CsProfileDraw.planExtents = function(doc) {
    var ids = doc.queryAllEntities(false, false);
    var out = null, i, e, box, lname;
    for (i = 0; i < ids.length; i++) {
        e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        try {
            lname = doc.getLayerName(e.getLayerId());
        } catch (eLayer) {
            continue;
        }
        if (CsLayers.frameOf(lname) !== "plan") {
            continue;
        }
        try {
            box = e.getBoundingBox();
        } catch (eBox) {
            continue;
        }
        if (isNull(box)) {
            continue;
        }
        var c1 = box.getCorner1(), c2 = box.getCorner2();
        if (out === null) {
            out = { minX: Math.min(c1.x, c2.x), minY: Math.min(c1.y, c2.y),
                maxX: Math.max(c1.x, c2.x), maxY: Math.max(c1.y, c2.y) };
        } else {
            out.minX = Math.min(out.minX, c1.x, c2.x);
            out.minY = Math.min(out.minY, c1.y, c2.y);
            out.maxX = Math.max(out.maxX, c1.x, c2.x);
            out.maxY = Math.max(out.maxY, c1.y, c2.y);
        }
    }
    return out;
};

/**
 * The bounding box of a BUILT profile's own coordinates (band X from
 * zero, Y at true elevation, each band's zOffset included), as
 * {minX, minY, maxX, maxY}, or null for a profile with nothing in it.
 * Pure -- no document.
 *
 * Stations and legs only. Wall runs hang off the stations they belong
 * to by at most the passage's own height, which the gutter already
 * covers, and scanning them would double this function's cost on the
 * one code path that is already quadratic in the survey total.
 */
CsProfileDraw.regionBounds = function(profile) {
    var bands = (profile && profile.bands) ? profile.bands : [];
    var out = null, b, i, dz;
    var see = function(x, y) {
        if (out === null) {
            out = { minX: x, minY: y, maxX: x, maxY: y };
            return;
        }
        out.minX = Math.min(out.minX, x);
        out.minY = Math.min(out.minY, y);
        out.maxX = Math.max(out.maxX, x);
        out.maxY = Math.max(out.maxY, y);
    };
    for (b = 0; b < bands.length; b++) {
        dz = bands[b].zOffset || 0.0;
        for (i = 0; i < bands[b].stations.length; i++) {
            see(bands[b].stations[i].x, bands[b].stations[i].y + dz);
        }
        for (i = 0; i < bands[b].legs.length; i++) {
            see(bands[b].legs[i].fromX, bands[b].legs[i].fromY + dz);
            see(bands[b].legs[i].toX, bands[b].legs[i].toY + dz);
        }
    }
    return out;
};

/**
 * Where to put the region THIS time: the offset added to every band
 * coordinate so the elevation lands below the plan, left edges lined
 * up. QCAD only.
 *
 * RECOMPUTED EVERY DRAW rather than stored once and kept. A stored
 * anchor would go stale the moment the survey grew southward -- the
 * elevation would end up overlapping the plan it is supposed to sit
 * under, and no redraw would ever fix it. The cost of recomputing is
 * that the region MOVES, which is why CsProfileDraw.translateRegion
 * exists: the user's own tracing has to travel with it.
 *
 * A drawing with no plan geometry (the elevation drawn first, or drawn
 * alone) has nothing to sit below, so the region stays at the origin
 * and the band coordinates are the drawing's coordinates.
 */
CsProfileDraw.computeOrigin = function(doc, profile) {
    var plan = CsProfileDraw.planExtents(doc);
    var bounds = CsProfileDraw.regionBounds(profile);
    if (plan === null || bounds === null) {
        return new RVector(0, 0);
    }
    return new RVector(plan.minX - bounds.minX,
        plan.minY - CsProfileDraw.REGION_GUTTER - bounds.maxY);
};

/**
 * Where the region was put LAST time, as {x, y}, or null when this
 * drawing has no elevation in it yet. QCAD only.
 *
 * Read from a marker point the draw itself leaves behind, tagged
 * ProfileOrigin -- the drawing is the record, the same principle the
 * rest of this suite works on. The marker is generator-owned (its tag
 * is in CsProfileDraw.TAGS) so erase() clears it and the next draw
 * writes a fresh one; a user who deletes it gets a drawing that reads
 * as "no region yet", which costs one un-translated redraw and nothing
 * worse.
 */
CsProfileDraw.regionOrigin = function(doc) {
    var ids = doc.queryAllEntities(false, false);
    var i, e, v;
    for (i = 0; i < ids.length; i++) {
        e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        v = CsTags.get(e, "ProfileOrigin");
        if (v === null || v === "") {
            continue;
        }
        var parts = String(v).split(",");
        if (parts.length !== 2) {
            continue;
        }
        var x = parseFloat(parts[0]), y = parseFloat(parts[1]);
        if (isNaN(x) || isNaN(y)) {
            // A marker that cannot be read is not a position: a
            // fabricated one would translate the whole region by a
            // wrong delta, which is worse than redrawing it in place.
            continue;
        }
        return { x: x, y: y };
    }
    return null;
};

/**
 * Moves EVERY entity in the profile frame by one vector. QCAD only.
 * \return the number of entities moved
 *
 * ONE VECTOR OVER A FRAME-SCOPED SELECTION -- not a per-entity
 * similarity fit. The cross-file version of this feature needed a fit
 * (CsRevise.similarityFit) because the stations themselves had moved
 * relative to each other; here nothing has changed shape at all, only
 * where the region was placed, so there is nothing to fit, no residual
 * to report and no refusal to make. Every entity moves by the same
 * delta or the region is not rigid.
 *
 * Generated geometry is moved too, even though the redraw that follows
 * replaces it at the new origin anyway: the cost is one translation of
 * geometry about to be erased, and the benefit is that this function
 * has ONE rule -- everything in the frame moves -- rather than a
 * carve-out that a later reader would have to re-derive.
 *
 * Runs inside CsRevise.withOffLayersOn: this MODIFIES user linework,
 * which may well sit on a layer the user switched off to sketch
 * undisturbed, and this build drops a modify on an off layer as
 * silently as it drops an add.
 */
CsProfileDraw.translateRegion = function(doc, di, dx, dy) {
    if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) {
        return 0;   // the region did not move
    }
    var offset = new RVector(dx, dy);
    var ids = doc.queryAllEntities(false, false);
    var op = new RModifyObjectsOperation();
    op.setText("Move the elevation region");
    var moved = 0, i, e, lname;
    for (i = 0; i < ids.length; i++) {
        e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        try {
            lname = doc.getLayerName(e.getLayerId());
        } catch (eLayer) {
            continue;
        }
        if (CsLayers.frameOf(lname) !== "profile") {
            continue;
        }
        e.move(offset);
        op.addObject(e, false);
        moved++;
    }
    if (moved > 0) {
        CsRevise.withOffLayersOn(doc, di, function() {
            di.applyOperation(op);
        });
    }
    return moved;
};

/**
 * Draws a whole built profile into (doc, di).
 *
 * \param profile CsProfile.build() result
 * \param opts    reserved for future options; currently unused (a
 *                 labelBands suppress-the-caption switch was dropped --
 *                 no caller ever set it, Task 10's tool has no reason
 *                 to suppress a band's label, and a dead option left in
 *                 place only accumulates). Kept as a parameter, not
 *                 removed outright, so a real future option does not
 *                 have to change this function's call signature.
 * \return {bandsDrawn, legsDrawn, stationsDrawn, ceilingRuns,
 *          floorRuns, flatTicks, erased, claimed, linework,
 *          stationsMoved} --
 *          claimed and linework are CsProfileBind.claim's own result
 *          and CsRevise.moveLinework's own result (or this function's
 *          {error: ...} / {moved: 0, unmoved: ["move failed: ..."]}
 *          stand-ins when either step threw); CsReport.profileSummary
 *          is what turns both into the words a user actually reads --
 *          see that function for why neither may be dropped silently.
 *          stationsMoved is true only when CsRevise.positionsMoved found
 *          at least one profile station that actually shifted between
 *          the pre-erase drawing and this redraw -- false on a brand
 *          new profile (nothing existed to compare against) and on an
 *          idempotent redraw of an unchanged one. CsReport.profileSummary
 *          reads it to tell "nothing moved, so there was nothing for a
 *          sketch to follow" apart from "stations moved but a sketch
 *          failed to follow them" -- moved===0 means something very
 *          different in each case, and only one of them is worth a
 *          warning (see CRITICAL 1 in this feature's review history).
 *          `erased` (how many stale generator-owned entities this call
 *          deleted before redrawing -- CsProfileDraw.erase's own return
 *          value) is DELIBERATELY internal-only, not merely dropped:
 *          it counts THIS module's own prior output being replaced, not
 *          anything the surveyor did or needs to act on -- there is no
 *          "warning" or "check this" reading of it the way there is for
 *          claimed/linework/stationsMoved above. It exists so a caller
 *          debugging a doubled- or dropped-entity regression (the two
 *          failure modes this file's own tests, e.g. tests/profile_draw
 *          _roundtrip.js's off-layer fixture, exist to catch) has a
 *          number to compare against bandsDrawn/legsDrawn without
 *          re-deriving it from a queryAllEntities() scan by hand.
 */
CsProfileDraw.render = function(doc, di, profile, opts) {
    opts = opts || {};   // accepted, currently unread -- see \param opts
    var layers = CsProfileDraw.LAYERS();
    for (var l = 0; l < layers.length; l++) {
        CsLayers.ensure(doc, di, layers[l]);
    }

    // WHERE THE REGION GOES THIS TIME, and the move that gets the
    // drawing there. Both happen BEFORE `before` is read below: the
    // translation shifts the old generated geometry AND the user's
    // tracing by the same vector, so reading positions afterward
    // compares like with like. Read them first and moveLinework would
    // see the region delta as a station movement and apply it to the
    // sketch a SECOND time.
    var origin = CsProfileDraw.computeOrigin(doc, profile);
    var previous = CsProfileDraw.regionOrigin(doc);
    if (previous !== null) {
        CsProfileDraw.translateRegion(doc, di, origin.x - previous.x,
            origin.y - previous.y);
    }

    // ORDER MATTERS, and each step is only correct in this position:
    //   before  read FIRST -- claim() only writes TAGS, it never moves
    //           a station point, so reading old positions ahead of it
    //           sees exactly the same drawing claim() itself would
    //   claim   untagged sketch is bound while the OLD geometry it was
    //           traced against is still in the drawing to match
    //           against -- but ONLY when this redraw will actually move
    //           something (the positionsMoved check right below): an
    //           add-only first draw, or a re-render of an unchanged
    //           profile, has no old/new position mismatch anywhere, so
    //           claiming now would cost the user an undo step
    //           (RModifyObjectsOperation) for a tag a LATER, real
    //           revision will still write when it actually matters,
    //           against whatever is on the ground at that time
    //   erase   only now can the generator's own output go
    //   draw    the new geometry lands
    //   move    the sketch is carried to the new positions
    var claimed = { tagged: 0, skipped: 0 };
    var before = {};
    try {
        before = CsProfileBind.positions(doc);
        // A PREVIEW only, purely to decide whether claim() below is
        // worth running at all: positionsOf(profile) is a pure function
        // of the already-built profile object, no document access
        // needed, so computing it here costs nothing ahead of the real
        // move's own after/extent further down (which recompute the
        // identical values -- `profile` does not change across this
        // call, so there is nothing to gain by threading one copy
        // through both places instead of asking for it twice).
        var previewAfter = CsProfileDraw.positionsOf(profile, origin);
        var previewExtent = CsRevise.positionsExtent(previewAfter);
        if (CsRevise.positionsMoved(before, previewAfter,
                previewExtent) > 0) {
            claimed = CsProfileBind.claim(doc, di);
        }
    } catch (eBind) {
        // binding is an improvement on leaving the sketch behind, not a
        // precondition for drawing a profile at all
        claimed = { tagged: 0, skipped: 0, error: String(eBind) };
    }

    var erased = CsProfileDraw.erase(doc, di);

    var counts = { bandsDrawn: 0, legsDrawn: 0, stationsDrawn: 0,
        ceilingRuns: 0, floorRuns: 0, flatTicks: 0, erased: erased };

    var op = new RAddObjectsOperation();
    op.setText("Draw extended elevation");

    var bands = (profile && profile.bands) ? profile.bands : [];
    for (var b = 0; b < bands.length; b++) {
        CsProfileDraw.band(doc, op, bands[b], counts, origin);
        counts.bandsDrawn++;
    }

    CsProfileDraw.stamp(doc, op, profile, origin,
        CsProfileDraw.regionBounds(profile));

    // The marker that lets the NEXT draw know where this one put the
    // region, so it can translate the user's tracing by the difference.
    // Written last, into the same operation as the geometry it belongs
    // with, and erased by the next erase() like every other tagged
    // thing this module owns.
    var marker = CsDraw.addPoint(doc, op, CsLayers.PROFILE_STATIONS,
        new RVector(origin.x, origin.y));
    CsTags.set(marker, "ProfileOrigin", origin.x + "," + origin.y);
    op.addObject(marker, false);
    counts.origin = { x: origin.x, y: origin.y };

    // Wrapped exactly like erase()'s delete, and for the identical
    // reason: any layer in CsProfileDraw.LAYERS() may be off by the
    // time this runs (a user's own choice, not a template default --
    // see CsProfileDraw.withOwnLayersOn), and this build drops adds to
    // an off layer with no error at all.
    CsProfileDraw.withOwnLayersOn(doc, di, function() {
        di.applyOperation(op);
    });

    counts.claimed = claimed;
    counts.linework = { moved: 0, unmoved: [] };
    // Recorded BEFORE moveLinework runs (and kept even if moveLinework
    // then throws, below): CsReport.profileSummary needs to tell "no
    // station moved, so there was nothing for a sketch to follow" apart
    // from "a station moved but the sketch didn't follow it" -- both
    // read as counts.linework.moved === 0, and only the second is worth
    // a warning. See this function's own \return docblock and CRITICAL 1
    // in this feature's review history.
    counts.stationsMoved = false;
    try {
        var after = CsProfileDraw.positionsOf(profile, origin);
        // the tolerance basis and the "did anything actually move"
        // question both already have one tested answer in CsRevise --
        // a second spelling here is how a cave in feet and the same
        // cave in metres start deciding differently
        var extent = CsRevise.positionsExtent(after);
        if (CsRevise.positionsMoved(before, after, extent) > 0) {
            counts.stationsMoved = true;
            // moveLinework MODIFIES entities (tag rewrite aside, the
            // rotate/scale/move themselves are modifies): the tracing
            // layer a user hid to sketch on undisturbed is not in
            // CsProfileDraw.LAYERS() and so is untouched by
            // withOwnLayersOn above -- exactly the layer this move
            // needs to reach. CsRevise.withOffLayersOn sweeps every
            // off layer in the document holding entities, this one
            // included, and restores each afterward.
            CsRevise.withOffLayersOn(doc, di, function() {
                // {} for tripStations, ALWAYS: that fallback exists on
                // the plan side for a sketch that snapped to no listed
                // station at all, so moveLinework can still fit it over
                // its trip's OTHER stations instead of giving up. A
                // profile has no equivalent -- one trip's stations are
                // scattered across however many bands it touches, at
                // different X/Y entirely (that is the whole reason keys
                // are run-qualified, see this file's own banner), so
                // there is no single coherent "this trip's stations"
                // position set to fall back to the way plan's one flat
                // drawing has. An entity with no resolvable station list
                // here has nothing left to fall back on and is reported
                // unmoved, which is the honest answer.
                counts.linework = CsRevise.moveLinework(doc, di, before,
                    after, {}, extent);
            });
        }
    } catch (eMove) {
        counts.linework = { moved: 0, unmoved: ["move failed: " + eMove] };
    }

    // An entity claim() could bind to NO station at all never gets a
    // tag, so moveLinework never sees it and never names it -- by
    // CsRevise's own explicit design, an untagged entity is not that
    // function's problem. Folding claim()'s own skipped labels in here
    // is what makes "drawn nowhere near the survey" show up SOMEWHERE
    // in the one list the caller reads for "what didn't move and why",
    // rather than only as a bare count with no entity behind it.
    if (claimed.skippedLabels && claimed.skippedLabels.length > 0) {
        counts.linework.unmoved =
            counts.linework.unmoved.concat(claimed.skippedLabels);
    }

    return counts;
};
