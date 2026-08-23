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
// exactly this namespace, which is what makes regeneration replace the
// generator's own output and leave hand-drawn work alone.
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
    "ProfileBandLabel", "ProfileZOffset"];

/** Layers the profile writes to, created if the drawing lacks them.
 *  CTRL-LRUD is NOT here -- see the TAGS docblock above; this module
 *  never draws a separate LRUD tick, so ensuring that layer would
 *  promise geometry that never lands on it. */
CsProfileDraw.LAYERS = function() {
    return [CsLayers.SHOTS, CsLayers.STATIONS, CsLayers.STATION_LABELS,
        CsLayers.SPLAYS, CsLayers.PROFILE_FLOOR, CsLayers.PROFILE_CEILING,
        CsLayers.TEXT_LABELS];
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
 * Any Profile* tag marks an entity as ours. Nothing else is touched:
 * hand-drawn linework on PROFILE-FLOOR / PROFILE-CEILING (the plain,
 * un-prefixed pair the PROFILE template reserves for tracing) carries
 * no Profile* tag, so it is invisible to this scan -- which is the
 * whole reason the generated lines went onto a CTRL- pair of their own
 * rather than sharing those layers.
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
    var victims = [];
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        for (var t = 0; t < CsProfileDraw.TAGS.length; t++) {
            var v = CsTags.get(e, CsProfileDraw.TAGS[t]);
            if (v !== null && v !== "") {
                victims.push(ids[i]);
                break;
            }
        }
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
 * `stations` itself comes back empty), and `null + number` in this
 * language silently coerces to the same fabricated zero that "never
 * default a missing Z to 0" exists to forbid everywhere else in this
 * codebase. Returning a literal 0.0 here is not that default in
 * disguise: no station, wall point, or leg is ever drawn at this
 * height for this band (there is nothing left to draw), and
 * CsProfileDraw.labelText's caption for this same case names the real
 * station and reason a reader would otherwise have to guess at.
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
    var label = CsDraw.addText(doc, op, CsLayers.TEXT_LABELS, text,
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
CsProfileDraw.band = function(doc, op, band, counts, opts) {
    var dz = band.zOffset || 0.0;
    var at = function(x, y) {
        return new RVector(x, y + dz);
    };
    var runTag = { ProfileRun: band.key };
    var i;

    for (i = 0; i < band.legs.length; i++) {
        var leg = band.legs[i];
        CsDraw.addLine(doc, op, CsLayers.SHOTS,
            at(leg.fromX, leg.fromY), at(leg.toX, leg.toY),
            "ProfileShot", leg.from + "->" + leg.to, runTag);
        counts.legsDrawn++;
    }

    for (i = 0; i < band.stations.length; i++) {
        var st = band.stations[i];
        var pt = CsDraw.addPoint(doc, op, CsLayers.STATIONS, at(st.x, st.y));
        CsTags.set(pt, "ProfileStation", st.name);
        CsTags.set(pt, "ProfileRun", band.key);
        op.addObject(pt, false);
        counts.stationsDrawn++;

        var label = CsDraw.addText(doc, op, CsLayers.STATION_LABELS,
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
        CsDraw.addLine(doc, op, CsLayers.SPLAYS,
            at(f.x, f.y - half), at(f.x, f.y + half),
            "ProfileSplay", f.name, runTag);
        counts.flatTicks++;
    }

    if (opts.labelBands !== false) {
        CsProfileDraw.label(doc, op, band, at);
    }
};

/**
 * Draws a whole built profile into (doc, di).
 *
 * \param profile CsProfile.build() result
 * \param opts    {labelBands: bool (default true)}
 * \return {bandsDrawn, legsDrawn, stationsDrawn, ceilingRuns,
 *          floorRuns, flatTicks, erased}
 */
CsProfileDraw.render = function(doc, di, profile, opts) {
    opts = opts || {};
    var layers = CsProfileDraw.LAYERS();
    for (var l = 0; l < layers.length; l++) {
        CsLayers.ensure(doc, di, layers[l]);
    }

    var erased = CsProfileDraw.erase(doc, di);

    var counts = { bandsDrawn: 0, legsDrawn: 0, stationsDrawn: 0,
        ceilingRuns: 0, floorRuns: 0, flatTicks: 0, erased: erased };

    var op = new RAddObjectsOperation();
    op.setText("Draw extended elevation");

    var bands = (profile && profile.bands) ? profile.bands : [];
    for (var b = 0; b < bands.length; b++) {
        CsProfileDraw.band(doc, op, bands[b], counts, opts);
        counts.bandsDrawn++;
    }

    // Wrapped exactly like erase()'s delete, and for the identical
    // reason: any layer in CsProfileDraw.LAYERS() may be off by the
    // time this runs (a user's own choice, not a template default --
    // see CsProfileDraw.withOwnLayersOn), and this build drops adds to
    // an off layer with no error at all.
    CsProfileDraw.withOwnLayersOn(doc, di, function() {
        di.applyOperation(op);
    });
    return counts;
};
