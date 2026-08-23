// CsTrace.js -- the math behind Feature Trace.
//
// Part of the Cave Survey Core library. resample(), reduce() and
// spacingFor() are PURE: plain {x, y} objects in and out, no document,
// no R* type, so the headless harness calls them under node. The
// document-touching half of this file is added by later tasks and is
// QCAD-only.
//
// Named CsTrace and not Trace because QCAD's include() dedupes by
// BASENAME: a Trace.js colliding with anything QCAD already loaded
// would be skipped in silence.

var CsTrace = {};

/**
 * Drawing-unit distance that means "one foot of cave".
 *
 * The trace samples one control point per foot, and a foot is a foot
 * whatever the drawing is in -- a metric cave must not get points a
 * metre apart just because its unit is bigger. Anything unrecognised
 * answers 1.0: treating an unknown unit as feet keeps the tool usable
 * and merely mis-spaces a curve, where refusing would block tracing
 * entirely.
 *
 * NOTE for anyone tempted to divide this by the profile's vertical
 * exaggeration: don't. This spacing and reduce()'s tolerance govern how
 * smooth the drawn curve looks ON THE SHEET, not how anything is
 * measured. An exaggerated elevation wants the same sheet smoothness as
 * a 1:1 one, so scaling by exaggeration only makes profile traces lumpy.
 */
CsTrace.spacingFor = function(unitName) {
    if (unitName === CsUnits.METERS) {
        return CsUnits.convert(1.0, CsUnits.FEET, CsUnits.METERS);
    }
    return 1.0;
};

/** Plain 2D distance between two {x, y}. */
CsTrace.distance = function(a, b) {
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
};

/** A shallow copy of a point list, so no caller's array is aliased. */
CsTrace.copyOf = function(points) {
    var out = [];
    if (isNull(points)) {
        return out;
    }
    for (var i = 0; i < points.length; i++) {
        out.push({ x: points[i].x, y: points[i].y });
    }
    return out;
};

/**
 * The captured drag, respaced to a point every `spacing` units of
 * arc length along it.
 *
 * The capture itself samples on a SCREEN-space threshold (see
 * FeatureTraceRun), which is what keeps the drag responsive at any
 * zoom -- but it also means the raw samples are spaced by whatever the
 * zoom happened to be. This is the step that makes the spacing mean
 * something in the cave rather than on the monitor.
 *
 * The last input point is always kept even when it lands less than
 * `spacing` past the previous one: the end of a wall is a place the
 * caver chose, and rounding it back to the last whole foot visibly
 * shortens the run.
 *
 * Degenerate input is returned as a copy rather than refused. A
 * one-point drag is a click, not an error, and a spacing of zero would
 * loop forever -- both are the caller's business to notice, and
 * neither is worth a throw mid-drag.
 */
CsTrace.resample = function(points, spacing) {
    if (isNull(points) || points.length < 2 || !(spacing > 0)) {
        return CsTrace.copyOf(points);
    }

    var out = [{ x: points[0].x, y: points[0].y }];
    var carried = 0;   // distance already walked past the last emitted point
    var i;

    for (i = 1; i < points.length; i++) {
        var from = points[i - 1];
        var to = points[i];
        var segment = CsTrace.distance(from, to);
        if (!(segment > 0)) {
            // A zero-length segment has no direction to walk. NOT a
            // divide-by-zero guard, though it reads like one: walked is
            // spacing - carried and carried is strictly < spacing, so
            // walked > 0 and the while below can never run when segment
            // is 0. Removing this is behaviour-preserving -- it is kept
            // to say so out loud, and a mutation test confirms no test
            // can kill it.
            continue;
        }

        var walked = spacing - carried;
        while (walked <= segment) {
            var t = walked / segment;
            out.push({
                x: from.x + (to.x - from.x) * t,
                y: from.y + (to.y - from.y) * t
            });
            walked = walked + spacing;
        }
        carried = segment - (walked - spacing);
    }

    var last = points[points.length - 1];
    var tail = out[out.length - 1];
    if (CsTrace.distance(tail, last) > 0) {
        out.push({ x: last.x, y: last.y });
    }
    return out;
};

/** Perpendicular distance from p to the infinite line through a and b. */
CsTrace.perpendicular = function(p, a, b) {
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (!(len > 0)) {
        return CsTrace.distance(p, a);   // a and b coincide: it is a point
    }
    return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
};

/**
 * Ramer-Douglas-Peucker: drop every point that lies within `tolerance`
 * of the polyline its neighbours already describe.
 *
 * This is what makes the output a spline rather than a polyline in a
 * costume. Fitting a spline through one point per foot gives a
 * 400-fit-point curve on a 400 ft passage: visually identical to the
 * polyline, slow to redraw, and unusable to hand-edit. After reduction
 * a straight passage carries a handful of points and a scalloped wall
 * carries many, which is the shape a cartographer would have clicked
 * by hand.
 *
 * The first and last points are structurally never candidates -- the
 * recursion only ever examines the interior of a span.
 */
CsTrace.reduce = function(points, tolerance) {
    if (isNull(points) || points.length < 3) {
        return CsTrace.copyOf(points);
    }

    var keep = [];
    var i;
    for (i = 0; i < points.length; i++) {
        keep.push(false);
    }
    keep[0] = true;
    keep[points.length - 1] = true;

    CsTrace.reduceSpan(points, 0, points.length - 1, tolerance, keep);

    var out = [];
    for (i = 0; i < points.length; i++) {
        if (keep[i]) {
            out.push({ x: points[i].x, y: points[i].y });
        }
    }
    return out;
};

/**
 * Marks the one interior point of [first, last] furthest from the chord
 * when that distance exceeds tolerance, then recurses either side of it.
 * Recursive rather than iterative because the depth is bounded by the
 * number of KEPT points, not the number of samples.
 */
CsTrace.reduceSpan = function(points, first, last, tolerance, keep) {
    if (last <= first + 1) {
        return;
    }

    var worst = -1;
    var worstAt = -1;
    var i;
    for (i = first + 1; i < last; i++) {
        var d = CsTrace.perpendicular(points[i], points[first], points[last]);
        if (d > worst) {
            worst = d;
            worstAt = i;
        }
    }

    if (worstAt < 0 || !(worst > tolerance)) {
        return;   // every interior point is inside tolerance: drop them all
    }

    keep[worstAt] = true;
    CsTrace.reduceSpan(points, first, worstAt, tolerance, keep);
    CsTrace.reduceSpan(points, worstAt, last, tolerance, keep);
};

// ---------------------------------------------------------------------
// The point-to-frame test. QCAD context only -- it reads a document.
// ---------------------------------------------------------------------

/**
 * The bounding box of everything drawn in the profile frame, as
 * {minX, minY, maxX, maxY}, or null when this drawing has no profile
 * geometry in it at all.
 *
 * Delegates to CsProfileDraw.frameExtents rather than carrying its own
 * union: that function already walks the entities, asks
 * CsLayers.frameOf, survives an entity whose layer or bounding box the
 * bridge refuses, and does NOT assume getCorner1() holds the smaller
 * coordinate. A second copy here would have to keep agreeing with it
 * about all four.
 *
 * Derived from ENTITIES, deliberately, rather than from
 * CsProfileDraw.regionOrigin(). The origin marker gives a POINT and not
 * an extent, so a region test built on it would have to re-derive the
 * band bounds from the survey model -- work this tool has no reason to
 * do. And the caver's own tracing legitimately GROWS the region: a
 * floor sketched below the generated band is profile-frame geometry,
 * and a region that stopped at the generator's output would call the
 * caver's own linework plan.
 */
CsTrace.profileRegion = function(doc) {
    return CsProfileDraw.frameExtents(doc, "profile");
};

/**
 * Which view a POINT falls in, given a region box: "profile" inside it,
 * "plan" everywhere else.
 *
 * Pure -- a box and a point, no document -- so node tests it and, more
 * importantly, so a caller can compute the box ONCE and ask this many
 * times. The cursor readout asks per mouse-move event, and the box
 * costs a walk of every entity in the drawing.
 *
 * "plan" is the answer for anything outside the region, INCLUDING the
 * gutter between the two views and every point in a drawing with no
 * elevation yet. That matches CsLayers.frameOf's own deliberate
 * default: the dangerous mistake is a profile-scoped operation claiming
 * ground it does not own, so unclaimed ground belongs to the frame that
 * owns the drawing's origin.
 */
CsTrace.frameIn = function(box, point) {
    if (isNull(box) || box === null) {
        return "plan";
    }
    if (point.x < box.minX || point.x > box.maxX ||
            point.y < box.minY || point.y > box.maxY) {
        return "plan";
    }
    return "profile";
};

/**
 * frameIn against the region this document happens to have right now.
 *
 * Convenience only, and NOT for use per mouse-move event: it walks
 * every entity in the drawing. Anything asking repeatedly must call
 * profileRegion once, hold the box, and use frameIn.
 */
CsTrace.frameAt = function(doc, point) {
    return CsTrace.frameIn(CsTrace.profileRegion(doc), point);
};

/**
 * The one frame every point of a path shares, or null when they
 * disagree.
 *
 * null is what makes a cross-gutter drag refusable at release. A wall
 * that starts in the plan and ends in the elevation describes nothing
 * in either view, and letting it land would put linework into a
 * drawing whose whole binding model assumes frames do not mix.
 *
 * Takes the BOX, not the document: once per drag instead of once per
 * point keeps this O(points) rather than O(points x entities).
 */
CsTrace.pathFrame = function(box, points) {
    if (isNull(points) || points.length === 0) {
        return null;
    }
    var first = CsTrace.frameIn(box, points[0]);
    for (var i = 1; i < points.length; i++) {
        if (CsTrace.frameIn(box, points[i]) !== first) {
            return null;
        }
    }
    return first;
};

/**
 * A cubic spline whose CONTROL points are `points`, or null when there
 * is no curve to make.
 *
 * Control points, not fit points: FIT-POINT SPLINES ARE A QCAD PRO
 * FEATURE, and this suite targets CaveCAD, a fork of the Community
 * edition. There is no interpolation engine here to turn fit points
 * into a curve.
 *
 * It fails SILENTLY, which is what cost a release: appendFitPoint
 * leaves getControlPoints() empty, the entity's bounding box is 0 x 0,
 * nothing renders, and the DXF exporter writes no SPLINE record at all
 * -- so a trace vanished on save. updateFromFitPoints() does not help.
 * Worst of all isValid() still answers TRUE, which is exactly why no
 * assertion caught it. Never assert a spline by isValid(); assert its
 * BOUNDING BOX and a DXF round trip.
 *
 * The trade: a control-point spline APPROXIMATES its points rather than
 * passing through them, so the curve sits a little inside a tight bend.
 * A cubic B-spline stays within the convex hull of its control polygon,
 * so at one point per foot the deviation is inches -- invisible at
 * survey scale. On a sharp corner it rounds more, which is what the
 * panel's Smoothing control is for: Fine keeps more points and holds
 * the corner tighter.
 *
 * setDegree(3) explicitly: a control-point spline does not inherit a
 * degree from anywhere, and a test pins that the result is cubic.
 */
CsTrace.fitSpline = function(doc, points) {
    if (isNull(points) || points.length < 2) {
        return null;
    }
    var spline = new RSpline();
    spline.setDegree(CsTrace.degreeFor(points.length));
    spline.setPeriodic(false);
    for (var i = 0; i < points.length; i++) {
        spline.appendControlPoint(new RVector(points[i].x, points[i].y));
    }
    return new RSplineEntity(doc, new RSplineData(spline));
};

/**
 * The highest degree `count` control points can actually carry, capped
 * at cubic.
 *
 * A B-spline of degree d needs at least d + 1 control points. Ask for
 * cubic with two and the curve is degenerate: no geometry, no bounding
 * box, no DXF record, and -- as ever in this build -- no error either.
 *
 * This is not a corner case. A STRAIGHT passage is the commonest thing
 * a caver traces, reduce() collapses it to exactly its two endpoints,
 * and every straight wall would silently vanish. Two points give a
 * degree-1 spline, which is the straight line that trace actually was.
 */
CsTrace.degreeFor = function(count) {
    if (count <= 2) {
        return 1;
    }
    if (count === 3) {
        return 2;
    }
    return 3;
};

/**
 * Switches snapping to free and returns whatever snap was on, so it can
 * be put back. QCAD context only.
 *
 * ANY freehand trace tool must do this. Grid snapping quantises every
 * sampled point to the grid, so a traced wall comes out as a staircase
 * -- and worse, the samples collapse onto each other, so the reduce
 * step throws most of the trace away.
 *
 * Driven through the snap GuiAction rather than di.setSnap alone, so the
 * snap toolbar shows the truth while tracing; a silently-changed snap
 * that the buttons disagree with is its own bug. di.setSnap is the
 * fallback when the action cannot be found.
 *
 * \return the RGuiAction to restore, or null if nothing was checked
 */
CsTrace.suspendSnap = function(di) {
    var saved = null;
    try {
        var actions = RGuiAction.getActions();
        for (var i = 0; i < actions.length; i++) {
            var a = actions[i];
            if (isNull(a)) {
                continue;
            }
            if (a.getGroup() === "snaps" && a.isChecked()) {
                saved = a;
                break;
            }
        }
    } catch (e) {
        saved = null;   // cannot read the snap state; still go free below
    }

    var went = false;
    try {
        var free = RGuiAction.getByScriptFile(
            "scripts/Snap/SnapFree/SnapFree.js");
        if (!isNull(free)) {
            free.trigger();
            went = true;
        }
    } catch (e2) {
        went = false;
    }
    if (!went) {
        try {
            di.setSnap(new RSnapFree());
        } catch (e3) {
            // no snap control at all; tracing still works, just snapped
        }
    }
    return saved;
};

/**
 * Puts back the snap suspendSnap saved.
 *
 * A null saved snap means nothing was checked when we started, so free
 * is already the right state and this does nothing -- restoring some
 * default would be inventing a setting the user never had.
 */
CsTrace.restoreSnap = function(di, saved) {
    if (isNull(saved)) {
        return;
    }
    try {
        saved.trigger();
    } catch (e) {
        // the action went away (tool closed, window torn down); the
        // user's next snap click puts it right and nothing is damaged
    }
};

/**
 * The whole pipeline: resample the captured drag, reduce it, fit a
 * spline, and add it to `layerName`.
 *
 * Wrapped in CsLayers.withLayerOn because this build's
 * RAddObjectsOperation silently refuses an add to a layer that is off
 * -- no error, no exception, the entity simply never lands. Switching
 * the feature layer off to see the scanned sketch underneath is the
 * ordinary way to use this tool, so without the wrapper the tool would
 * appear to work and draw nothing.
 *
 * Deliberately does NOT tag the result for binding. The existing
 * CsBind.tagEntities sweep picks up new linework on a bindable layer
 * already; tagging here would bind it twice.
 *
 * \return {added: bool, sampled: int, kept: int}
 */
CsTrace.emit = function(doc, di, layerName, points, spacing, tolerance) {
    var spaced = CsTrace.resample(points, spacing);
    var kept = CsTrace.reduce(spaced, tolerance);
    var spline = CsTrace.fitSpline(doc, kept);
    if (spline === null) {
        return { added: false, sampled: spaced.length, kept: kept.length };
    }

    CsLayers.ensure(doc, di, layerName);
    var layerId = doc.getLayerId(layerName);
    spline.setLayerId(layerId);

    // COUNTED, not assumed. An earlier version returned added:true
    // whenever a curve could be built, so the panel cheerfully reported
    // "44 sampled, 10 kept" for a trace that never reached the drawing
    // -- this build refuses adds silently in more ways than one, and a
    // report that cannot be wrong is worth the extra query.
    var before = doc.queryLayerEntities(layerId, true).length;

    CsLayers.withLayerOn(doc, di, layerName, function() {
        var op = new RAddObjectsOperation();
        op.addObject(spline, false);
        di.applyOperation(op);
    });

    var after = doc.queryLayerEntities(layerId, true).length;
    return {
        added: (after > before),
        sampled: spaced.length,
        kept: kept.length
    };
};
