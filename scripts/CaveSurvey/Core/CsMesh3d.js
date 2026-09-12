// CsMesh3d.js -- the surveyed passage as a three-dimensional surface.
//
// Part of the Cave Survey Core library: pure functions, no document, no
// GUI, so the headless harness tests all of it. The GL window that
// draws the result never sees a Survey -- it takes vertex and index
// buffers and knows nothing about caves. This file is the entire
// translation between the two, and that is deliberate: teaching the
// renderer about survey data would mean a second implementation of tag
// parsing, in a second language, kept in step by hand.
//
// THE SHAPE OF THE SURFACE. At each station, the wall points actually
// measured there -- the four LRUD ticks AND the tip of every splay shot
// from it -- are projected into the plane perpendicular to the passage
// and sorted by angle. That ordered ring is the station's cross
// section. Consecutive rings are lofted with triangle strips.
//
// A SPLAY IS A WALL POINT. This is CsLrud's argument in plan, and it is
// no less true in three dimensions: "a splay tip is a measured wall hit
// -- the same kind of fact an LRUD number is, just aimed where the
// caver pointed". A design that swept only the LRUD rectangle would
// render LESS than was measured; a splay up into a dome would dent the
// tube instead of showing the void.
//
// AND NOTHING BETWEEN THE MEASURED POINTS. The ring is what was
// measured, in order; the loft is straight strips between rings. No
// smoothing, no inferred curvature, for the reason CsLrud gives: wall
// detail between stations that isn't in the data misrepresents the
// passage.
//
// JUNCTIONS END A RUN. Three or more non-splay shots meeting is a place
// one ring cannot describe, so the loft stops rather than guessing a
// surface across it. Same rule as CsLrud.wallRuns, reached through the
// same CsLrud.legCounts rather than re-derived.
//
// Z IS NEVER DEFAULTED. A station without a resolved elevation is an
// error that refuses to build. This suite has closed five separate
// doors on a z quietly defaulting to 0 and rebasing an absolute-datum
// cave to sea level; this is the sixth, held shut on purpose.
//
// The 'Cs' prefix is mandatory: CaveCAD's include() dedupes by
// basename, and the global must match the file name.

include(includeBasePath + "/CsTraverse.js");
include(includeBasePath + "/CsLrud.js");

var CsMesh3d = {};

// ---------------------------------------------------------------------
// Vectors. Plain objects, because that is what the rest of the Core
// library passes around and RVector does not exist under node.
// ---------------------------------------------------------------------

CsMesh3d.sub = function(a, b) {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
};

CsMesh3d.cross = function(a, b) {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x
    };
};

CsMesh3d.dot = function(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
};

CsMesh3d.norm = function(a) {
    return Math.sqrt(CsMesh3d.dot(a, a));
};

/**
 * Unit vector, or null when there is no direction to normalize.
 *
 * Null rather than a zero vector: a caller that wants a direction and
 * is handed {0,0,0} carries on and produces NaN three operations
 * later, where the cause is no longer visible.
 */
CsMesh3d.normalize = function(a) {
    var len = CsMesh3d.norm(a);
    if (!isFinite(len) || len < 1e-12) {
        return null;
    }
    return { x: a.x / len, y: a.y / len, z: a.z / len };
};

/**
 * An orthonormal frame for a passage heading in `dir`.
 *
 * World is Z-up, matching the survey's own frame. `right` comes out
 * horizontal wherever the passage is not vertical, so a cross section
 * drawn in this frame stands the way a caver would draw it.
 *
 * In a vertical shaft that choice is degenerate -- every horizontal
 * direction is equally perpendicular -- and a near-zero cross product
 * would let floating-point noise pick one, so the frame would spin
 * from station to station down the same pitch. North is used as the
 * reference instead: arbitrary, but the SAME arbitrary every time.
 *
 * \return {forward, right, up} unit vectors, or null when `dir` has no
 *         length at all.
 */
CsMesh3d.frameAt = function(dir) {
    var forward = CsMesh3d.normalize(dir);
    if (forward === null) {
        return null;
    }
    var right = CsMesh3d.normalize(
        CsMesh3d.cross(forward, { x: 0, y: 0, z: 1 }));
    if (right === null) {
        right = CsMesh3d.normalize(
            CsMesh3d.cross(forward, { x: 0, y: 1, z: 0 }));
    }
    var up = CsMesh3d.normalize(CsMesh3d.cross(right, forward));
    if (up === null) {
        return null;
    }
    return { forward: forward, right: right, up: up };
};

/**
 * One station's cross section: the measured wall points around it, in
 * angular order, as world coordinates.
 *
 * `lrud` is {left, right, up, down}. Null (or undefined) means NOT
 * MEASURED and contributes nothing. Zero means the wall passes through
 * the station -- a real measurement -- and contributes a point AT it.
 * That distinction is CsLrud.tickEnd's, and it was dead code there
 * once, which is exactly how it and the docblock drifted apart; it is
 * restated here so a mesh cannot quietly re-break it.
 *
 * A splay aimed straight along the passage is on the centerline and
 * belongs to neither wall, so it contributes nothing -- the same call
 * CsLrud makes.
 *
 * \param splays   shots from this station with splay === true
 * \param tapeMode CsTraverse.SLOPE (default) or HORIZONTAL
 * \return [{x, y, z}] in angular order, possibly empty
 */
CsMesh3d.ringAt = function(station, dir, lrud, splays, tapeMode) {
    var frame = CsMesh3d.frameAt(dir);
    if (frame === null) {
        return [];
    }
    if (tapeMode === undefined || tapeMode === null) {
        tapeMode = CsTraverse.SLOPE;
    }
    if (splays === undefined || splays === null) {
        splays = [];
    }
    lrud = lrud || {};

    // The ring is built in the frame's own plane: u along `right`, v
    // along `up`, the station at the origin. Sorting by angle there is
    // what puts the points in ring order.
    var local = [];

    var add = function(u, v) {
        if (!isFinite(u) || !isFinite(v)) {
            return;
        }
        local.push({ u: u, v: v, angle: Math.atan2(v, u) });
    };

    var tick = function(name, uSign, vSign) {
        var d = lrud[name];
        if (d === null || d === undefined || !isFinite(d)) {
            return;
        }
        add(uSign * d, vSign * d);
    };
    tick("right", 1, 0);
    tick("left", -1, 0);
    tick("up", 0, 1);
    tick("down", 0, -1);

    for (var i = 0; i < splays.length; i++) {
        var shot = splays[i];
        var o = CsTraverse.offset(shot, tapeMode);
        if (o === null) {
            continue;
        }
        var vec = { x: o.dx, y: o.dy, z: o.dz };
        var u = CsMesh3d.dot(vec, frame.right);
        var v = CsMesh3d.dot(vec, frame.up);
        if (Math.abs(u) < 1e-9 && Math.abs(v) < 1e-9) {
            // Aimed along the passage: on the centerline, a wall point
            // for neither side.
            continue;
        }
        add(u, v);
    }

    local.sort(function(a, b) { return a.angle - b.angle; });

    var out = [];
    for (var k = 0; k < local.length; k++) {
        out.push({
            x: station.x + local[k].u * frame.right.x +
                           local[k].v * frame.up.x,
            y: station.y + local[k].u * frame.right.y +
                           local[k].v * frame.up.y,
            z: station.z + local[k].u * frame.right.z +
                           local[k].v * frame.up.z,
            // The angle this point sat at in its own station's frame,
            // carried out so the loft can match two rings up by WHERE
            // the wall was rather than by position in a list. See
            // CsMesh3d.loft.
            angle: local[k].angle
        });
    }
    return out;
};

// ---------------------------------------------------------------------
// The whole surface
// ---------------------------------------------------------------------

// Colours a trip index cycles through. Deliberately few, and chosen to
// stay apart from one another against the dark ground the GL window
// draws on.
CsMesh3d.TRIP_COLORS = [
    [0.85, 0.84, 0.78], [0.90, 0.55, 0.30], [0.40, 0.70, 0.90],
    [0.60, 0.85, 0.45], [0.88, 0.48, 0.62], [0.75, 0.70, 0.35]
];

/** Colour for a depth, shallow (1) to deep (0), as a cool ramp. */
CsMesh3d.depthColor = function(t) {
    if (!isFinite(t)) { t = 0.5; }
    if (t < 0) { t = 0; }
    if (t > 1) { t = 1; }
    return [0.25 + 0.60 * t, 0.45 + 0.40 * t, 0.70 + 0.25 * (1 - t)];
};

/**
 * The direction the passage runs at a station: the mean of the unit
 * vectors of the non-splay legs touching it.
 *
 * At a junction this averages branches heading different ways, which is
 * meaningless -- so build() never asks for it there. It passes the
 * leg's own direction instead, which is what each branch's own surface
 * should be squared to, and is how CsLrud ends a wall run at a junction
 * with the geometry of the run that arrived.
 */
CsMesh3d.directionAt = function(name, legsByStation, resolved) {
    var legs = legsByStation[name] || [];
    var sum = { x: 0, y: 0, z: 0 };
    var n = 0;
    for (var i = 0; i < legs.length; i++) {
        var a = resolved.stations[legs[i].from];
        var b = resolved.stations[legs[i].to];
        if (a === undefined || b === undefined) {
            continue;
        }
        var v = CsMesh3d.normalize(CsMesh3d.sub(b, a));
        if (v === null) {
            continue;
        }
        sum.x += v.x;
        sum.y += v.y;
        sum.z += v.z;
        n += 1;
    }
    if (n === 0) {
        return null;
    }
    return CsMesh3d.normalize(sum);
};

/**
 * The LRUD recorded AT a station. It lives on the shot that ARRIVED
 * there -- "LRUD at the TO station, facing travel" is CsModel's
 * convention and CsLrud's -- so the first non-splay shot whose `to` is
 * this station is the one that measured it.
 */
CsMesh3d.lrudAt = function(name, survey) {
    for (var i = 0; i < survey.shots.length; i++) {
        var s = survey.shots[i];
        if (s.splay !== true && s.to === name && !s.excludeFromAll) {
            return { left: s.left, right: s.right,
                     up: s.up, down: s.down };
        }
    }
    return { left: null, right: null, up: null, down: null };
};

/**
 * The trip a station belongs to: the trip of the shot that arrived
 * there. The very first station of a survey was never arrived at, and
 * takes the trip of the shot that LEAVES it instead -- otherwise every
 * cave's first station is coloured trip 0 whether or not trip 0 is
 * where it came from.
 */
CsMesh3d.tripAt = function(name, survey) {
    var i, s;
    for (i = 0; i < survey.shots.length; i++) {
        s = survey.shots[i];
        if (s.splay !== true && s.to === name) {
            return s.trip || 0;
        }
    }
    for (i = 0; i < survey.shots.length; i++) {
        s = survey.shots[i];
        if (s.splay !== true && s.from === name) {
            return s.trip || 0;
        }
    }
    return 0;
};

/** One quad as two triangles, each with its own flat normal. */
CsMesh3d.quad = function(tri, p0, p1, p2, p3, colorA, colorB) {
    var emit = function(a, b, c, col) {
        var nrm = CsMesh3d.normalize(
            CsMesh3d.cross(CsMesh3d.sub(b, a), CsMesh3d.sub(c, a)));
        if (nrm === null) {
            // Degenerate -- three collinear or coincident points, which
            // a zero LRUD beside a measured one produces honestly.
            // There is no surface here to draw.
            return;
        }
        var base = tri.positions.length / 3;
        var pts = [a, b, c];
        for (var i = 0; i < 3; i++) {
            tri.positions.push(pts[i].x, pts[i].y, pts[i].z);
            tri.normals.push(nrm.x, nrm.y, nrm.z);
            tri.colors.push(col[0], col[1], col[2]);
        }
        tri.indices.push(base, base + 1, base + 2);
    };
    emit(p0, p1, p2, colorB);
    emit(p0, p2, p3, colorA);
};

/**
 * The ring point lying nearest a given angle, measured the short way
 * round so that -179 degrees and +179 degrees are two degrees apart
 * rather than three hundred and fifty eight.
 */
CsMesh3d.nearestByAngle = function(ring, angle) {
    var best = ring[0];
    var bestGap = Infinity;
    for (var i = 0; i < ring.length; i++) {
        var gap = Math.abs(ring[i].angle - angle);
        if (gap > Math.PI) {
            gap = 2 * Math.PI - gap;
        }
        if (gap < bestGap) {
            bestGap = gap;
            best = ring[i];
        }
    }
    return best;
};

/**
 * Triangle strip between two rings.
 *
 * MATCHED BY ANGLE, NOT BY INDEX. Rings rarely have the same number of
 * points -- one station may have four LRUD ticks and its neighbour
 * eleven splays -- and pairing them by position in the list silently
 * assumes the two lists divide the circle the same way. They do not:
 * four evenly spread ticks against eleven splays clustered up one wall
 * would pair the floor of one station with the ceiling of the next, and
 * the strip would twist through the passage rather than skin it.
 *
 * So both rings are sampled at the same set of angles, taken around the
 * circle. Each sample picks the MEASURED point nearest that angle,
 * repeating one where a ring is sparse rather than interpolating a
 * wall position nobody recorded.
 *
 * Flat normals throughout. Smoothing across the strip would imply the
 * passage curves between stations in a way the data does not say.
 */
CsMesh3d.loft = function(tri, ringA, ringB, colorA, colorB) {
    var n = Math.max(ringA.length, ringB.length);
    if (n < 3 || ringA.length < 1 || ringB.length < 1) {
        return;
    }
    var angleOf = function(i) {
        return -Math.PI + (2 * Math.PI) * ((i % n) / n);
    };
    for (var i = 0; i < n; i++) {
        var a0 = CsMesh3d.nearestByAngle(ringA, angleOf(i));
        var a1 = CsMesh3d.nearestByAngle(ringA, angleOf(i + 1));
        var b0 = CsMesh3d.nearestByAngle(ringB, angleOf(i));
        var b1 = CsMesh3d.nearestByAngle(ringB, angleOf(i + 1));
        CsMesh3d.quad(tri, a0, a1, b1, b0, colorA, colorB);
    }
};

/**
 * The whole passage surface, ready for the GL window.
 *
 * \param survey   a Survey (CsModel)
 * \param resolved CsNetwork.resolve(survey)
 * \param opts     {colorBy: "trip"|"depth", tapeMode}
 *
 * \return {triangles: {positions, normals, colors, indices},
 *          lines:     {positions, colors, indices},
 *          bounds:    {min: {x,y,z}, max: {x,y,z}}}
 *
 * WALKS THE SPANNING TREE, not a name order. `resolved.legs` arrives in
 * resolution order tagged "new" / "closure" / "tie", and the "new" legs
 * are exactly the tree: each attaches a newly placed station to one
 * already placed, so its two ends are adjacent BY CONSTRUCTION. A walk
 * over station names in first-appearance order carries no such promise
 * -- two consecutive names can sit in different parts of the cave, and
 * lofting between their rings would stretch a surface across open air.
 *
 * Closure and tie legs are drawn on the centerline but never lofted: a
 * closure joins two stations the tree has already reached by other
 * routes, so lofting it would lay a second surface over passage that is
 * already covered.
 *
 * THROWS when a station on a plotted leg has no resolved elevation.
 * That is not defensive noise -- a z quietly defaulting to 0 rebases an
 * absolute-datum cave to sea level, and this suite has closed five
 * separate doors on exactly that.
 */
CsMesh3d.build = function(survey, resolved, opts) {
    opts = opts || {};
    var tapeMode = opts.tapeMode || CsTraverse.SLOPE;
    var colorBy = opts.colorBy || "trip";

    var tri = { positions: [], normals: [], colors: [], indices: [] };
    var lin = { positions: [], colors: [], indices: [] };
    var min = { x: Infinity, y: Infinity, z: Infinity };
    var max = { x: -Infinity, y: -Infinity, z: -Infinity };

    if (survey === null || survey === undefined ||
            resolved === null || resolved === undefined) {
        return { triangles: tri, lines: lin,
                 bounds: { min: { x: 0, y: 0, z: 0 },
                           max: { x: 0, y: 0, z: 0 } } };
    }

    var counts = CsLrud.legCounts(resolved.legs);
    var splays = CsLrud.splaysByStation(survey);

    var legsByStation = {};
    var noteLeg = function(name, leg) {
        if (!legsByStation.hasOwnProperty(name)) {
            legsByStation[name] = [];
        }
        legsByStation[name].push(leg);
    };
    var li;
    for (li = 0; li < resolved.legs.length; li++) {
        noteLeg(resolved.legs[li].from, resolved.legs[li]);
        noteLeg(resolved.legs[li].to, resolved.legs[li]);
    }

    var requireStation = function(name) {
        var st = resolved.stations[name];
        if (st === undefined) {
            return null;
        }
        if (typeof st.z !== "number" || !isFinite(st.z)) {
            throw new Error("CsMesh3d: station " + name + " has no " +
                "resolved elevation. Refusing to build a mesh that " +
                "would place it at datum zero.");
        }
        return st;
    };

    // The depth ramp needs the cave's own z range before any colour is
    // chosen, and stations are the cheap place to read it.
    var zLow = Infinity, zHigh = -Infinity;
    var name;
    for (name in resolved.stations) {
        if (resolved.stations.hasOwnProperty(name)) {
            var sz = resolved.stations[name].z;
            if (typeof sz === "number" && isFinite(sz)) {
                if (sz < zLow) { zLow = sz; }
                if (sz > zHigh) { zHigh = sz; }
            }
        }
    }
    var zSpan = zHigh - zLow;

    var colorAt = function(stationName, st) {
        if (colorBy === "depth") {
            return CsMesh3d.depthColor(
                zSpan > 1e-9 ? (st.z - zLow) / zSpan : 0.5);
        }
        var t = CsMesh3d.tripAt(stationName, survey);
        return CsMesh3d.TRIP_COLORS[t % CsMesh3d.TRIP_COLORS.length];
    };

    var grow = function(p) {
        if (p.x < min.x) { min.x = p.x; }
        if (p.y < min.y) { min.y = p.y; }
        if (p.z < min.z) { min.z = p.z; }
        if (p.x > max.x) { max.x = p.x; }
        if (p.y > max.y) { max.y = p.y; }
        if (p.z > max.z) { max.z = p.z; }
    };

    // --- the centerline: every leg the network resolved ---
    for (li = 0; li < resolved.legs.length; li++) {
        var cl = resolved.legs[li];
        var ca = requireStation(cl.from);
        var cb = requireStation(cl.to);
        if (ca === null || cb === null) {
            continue;
        }
        var colA = colorAt(cl.from, ca);
        var colB = colorAt(cl.to, cb);
        var lbase = lin.positions.length / 3;
        lin.positions.push(ca.x, ca.y, ca.z, cb.x, cb.y, cb.z);
        lin.colors.push(colA[0], colA[1], colA[2],
                        colB[0], colB[1], colB[2]);
        lin.indices.push(lbase, lbase + 1);
        grow(ca);
        grow(cb);
    }

    // --- the surface: one loft per spanning-tree leg ---
    //
    // A station's ring is cached, because most stations are shared by
    // two legs and rebuilding the ring would re-project every splay
    // twice. A JUNCTION is not cached: each branch squares its own
    // surface to its own approach, so the ring there depends on which
    // leg is asking.
    var ringCache = {};

    var ringFor = function(stationName, st, dir) {
        var junction = (counts[stationName] || 0) >= 3;
        if (!junction && ringCache.hasOwnProperty(stationName)) {
            return ringCache[stationName];
        }
        var ring = CsMesh3d.ringAt(st, dir,
            CsMesh3d.lrudAt(stationName, survey),
            splays[stationName] || [], tapeMode);
        if (!junction) {
            ringCache[stationName] = ring;
        }
        return ring;
    };

    for (li = 0; li < resolved.legs.length; li++) {
        var leg = resolved.legs[li];
        if (leg.kind !== "new") {
            continue;
        }
        var a = requireStation(leg.from);
        var b = requireStation(leg.to);
        if (a === null || b === null) {
            continue;
        }
        var along = CsMesh3d.normalize(CsMesh3d.sub(b, a));
        if (along === null) {
            // Two stations in the same place: no passage between them
            // to put a surface on.
            continue;
        }

        var dirA = ((counts[leg.from] || 0) >= 3)
            ? along
            : CsMesh3d.directionAt(leg.from, legsByStation, resolved);
        var dirB = ((counts[leg.to] || 0) >= 3)
            ? along
            : CsMesh3d.directionAt(leg.to, legsByStation, resolved);
        if (dirA === null) { dirA = along; }
        if (dirB === null) { dirB = along; }

        var ringA = ringFor(leg.from, a, dirA);
        var ringB = ringFor(leg.to, b, dirB);
        if (ringA.length < 3 || ringB.length < 3) {
            // Not enough measured wall at one end to make a section.
            // Drawing something anyway would be drawing a guess.
            continue;
        }

        CsMesh3d.loft(tri, ringA, ringB,
            colorAt(leg.from, a), colorAt(leg.to, b));

        var gi;
        for (gi = 0; gi < ringA.length; gi++) { grow(ringA[gi]); }
        for (gi = 0; gi < ringB.length; gi++) { grow(ringB[gi]); }
    }

    if (!isFinite(min.x)) {
        min = { x: 0, y: 0, z: 0 };
        max = { x: 0, y: 0, z: 0 };
    }
    return { triangles: tri, lines: lin, bounds: { min: min, max: max } };
};
