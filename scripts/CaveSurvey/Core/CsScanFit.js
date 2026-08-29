// CsScanFit.js -- fitting a scan onto known stations, and turning that
// fit into the three vectors an image entity is placed by.
//
// Part of the Cave Survey Core library. PURE: plain {x, y} objects, no
// RVector, no document, so tests/js_unit.js exercises all of it under
// node.
//
// WHY THIS EXISTS SEPARATELY FROM AlignImage. Align Image fits a scan
// that is ALREADY IN THE DRAWING: the caver inserts it, hunts for it,
// zooms, and clicks stations on it in the CAD view. Picking the
// stations on the SCAN ITSELF, in the Sketch Scans viewer, means the
// fit is known BEFORE the image is placed -- so the image is inserted
// already aligned and the hunt never happens.
//
// COORDINATES. Source points are pixels on the scan, as the preview
// document reports them: one drawing unit per pixel, origin at the
// image's bottom-left, y running UP (the preview is a drawing, not a
// bitmap). Destination points are the drawing's own plotted stations.
// The fit maps the first onto the second.

var CsScanFit = {};

CsScanFit.TOLERANCE = 1.0e-9;
/** Below this (scaled by the spread of the sources) three points are in
 *  a line and no affine can be worked out from them. */
CsScanFit.COLLINEAR_TOLERANCE = 1.0e-8;

/** One point through an affine {a,b,c,d,e,f}:
 *  x' = a*x + b*y + c ;  y' = d*x + e*y + f */
CsScanFit.apply = function(m, p) {
    return { x: m.a * p.x + m.b * p.y + m.c,
             y: m.d * p.x + m.e * p.y + m.f };
};

/**
 * The move / rotate / uniform-resize through TWO pairs, as an affine.
 *
 * Exact: both points land on their targets. The scan keeps its shape,
 * which is what two stations can honestly say -- anything more would be
 * a stretch nobody measured.
 *
 * \return {a,b,c,d,e,f} or null when the two source or target points
 *         coincide (no direction, no scale).
 */
CsScanFit.similarityFrom = function(p1, q1, p2, q2) {
    var sx = p2.x - p1.x, sy = p2.y - p1.y;
    var dx = q2.x - q1.x, dy = q2.y - q1.y;
    var sLen2 = sx * sx + sy * sy;
    var dLen2 = dx * dx + dy * dy;
    if (sLen2 < CsScanFit.TOLERANCE || dLen2 < CsScanFit.TOLERANCE) {
        return null;
    }
    // The complex ratio (d / s) IS the rotation and the scale together.
    var k = (dx * sx + dy * sy) / sLen2;   // cos(theta) * factor
    var h = (dy * sx - dx * sy) / sLen2;   // sin(theta) * factor
    return { a: k, b: -h, c: q1.x - (k * p1.x - h * p1.y),
             d: h, e: k,  f: q1.y - (h * p1.x + k * p1.y) };
};

/**
 * The affine fitting THREE OR MORE pairs as closely as possible: move,
 * rotate, stretch differently across and down, and skew. Exact with
 * three; least squares with more.
 *
 * \return {a,b,c,d,e,f}, or null when the sources are collinear.
 */
CsScanFit.affineFrom = function(pairs) {
    if (pairs === undefined || pairs === null || pairs.length < 3) {
        return null;
    }
    var sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0, n = pairs.length;
    var txx = 0, txy = 0, tx = 0, tyx = 0, tyy = 0, ty = 0;
    for (var i = 0; i < n; i++) {
        var px = pairs[i].source.x, py = pairs[i].source.y;
        var qx = pairs[i].dest.x,   qy = pairs[i].dest.y;
        sxx += px * px; sxy += px * py; syy += py * py;
        sx += px; sy += py;
        txx += qx * px; txy += qx * py; tx += qx;
        tyx += qy * px; tyy += qy * py; ty += qy;
    }
    var m = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
    var det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
              m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
              m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    var spread = Math.max(sxx + syy, CsScanFit.TOLERANCE);
    if (Math.abs(det) < CsScanFit.COLLINEAR_TOLERANCE * spread * spread) {
        return null;
    }
    var solve = function(r0, r1, r2) {
        var d0 = r0 * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
                 m[0][1] * (r1 * m[2][2] - m[1][2] * r2) +
                 m[0][2] * (r1 * m[2][1] - m[1][1] * r2);
        var d1 = m[0][0] * (r1 * m[2][2] - m[1][2] * r2) -
                 r0 * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
                 m[0][2] * (m[1][0] * r2 - r1 * m[2][0]);
        var d2 = m[0][0] * (m[1][1] * r2 - r1 * m[2][1]) -
                 m[0][1] * (m[1][0] * r2 - r1 * m[2][0]) +
                 r0 * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
        return [d0 / det, d1 / det, d2 / det];
    };
    var row1 = solve(txx, txy, tx);
    var row2 = solve(tyx, tyy, ty);
    return { a: row1[0], b: row1[1], c: row1[2],
             d: row2[0], e: row2[1], f: row2[2] };
};

/**
 * The best fit the given pairs support: two pairs keep the scan's
 * shape, three or more allow the stretch and skew that takes a
 * scanner's distortion out. Three points in a LINE say nothing about
 * the direction across that line, so they fall back to the first two.
 *
 * \return {matrix, kind: "similarity"|"affine"} or null
 */
CsScanFit.fit = function(pairs) {
    if (pairs === undefined || pairs === null || pairs.length < 2) {
        return null;
    }
    if (pairs.length >= 3) {
        var affine = CsScanFit.affineFrom(pairs);
        if (affine !== null) {
            return { matrix: affine, kind: "affine" };
        }
    }
    var sim = CsScanFit.similarityFrom(pairs[0].source, pairs[0].dest,
        pairs[1].source, pairs[1].dest);
    return sim === null ? null : { matrix: sim, kind: "similarity" };
};

/**
 * The three vectors QCAD places an image by, from a fit.
 *
 * An image is an insertion point plus one vector along a pixel row and
 * one down a pixel column. The scan's pixels are the fit's SOURCE
 * space, so the answer falls straight out of where the unit square
 * lands: the origin, and the two unit steps from it.
 *
 * THE INSERTION POINT IS THE BOTTOM-LEFT, AND v POINTS UP. That is the
 * convention QCAD places an image by, and the same one the preview
 * document itself uses: it inserts the scan at (0, 0) with u = (1, 0)
 * and v = (0, 1) and the image occupies 0..width by 0..height, growing
 * UPWARD from the insertion point.
 *
 * An earlier version of this derived the placement from the image's TOP
 * left with v stepping DOWN, on the reasoning that an image's rows run
 * downward. That is true of the pixels and irrelevant here: the source
 * coordinates ARE the preview's model coordinates, where y already runs
 * up from the bottom. Deriving from the top flipped every placed scan
 * vertically -- and once a rotation was in the fit, flipped and turned.
 *
 * \return {position, u, v} in world coordinates
 */
CsScanFit.imageVectors = function(m) {
    var origin = CsScanFit.apply(m, { x: 0, y: 0 });
    var right = CsScanFit.apply(m, { x: 1, y: 0 });
    var up = CsScanFit.apply(m, { x: 0, y: 1 });
    return {
        position: origin,
        u: { x: right.x - origin.x, y: right.y - origin.y },
        v: { x: up.x - origin.x, y: up.y - origin.y }
    };
};

/** How far each pair's mapped source misses its target.
 *  \return {average, worst, worstIndex} -- worstIndex counted from 1. */
CsScanFit.residuals = function(pairs, m) {
    var total = 0, worst = 0, worstIndex = 0;
    for (var i = 0; i < pairs.length; i++) {
        var got = CsScanFit.apply(m, pairs[i].source);
        var dx = got.x - pairs[i].dest.x, dy = got.y - pairs[i].dest.y;
        var miss = Math.sqrt(dx * dx + dy * dy);
        total += miss;
        if (miss > worst) { worst = miss; worstIndex = i + 1; }
    }
    return { average: pairs.length === 0 ? 0 : total / pairs.length,
             worst: worst, worstIndex: worstIndex };
};
