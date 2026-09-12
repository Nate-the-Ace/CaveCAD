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
                           local[k].v * frame.up.z
        });
    }
    return out;
};
