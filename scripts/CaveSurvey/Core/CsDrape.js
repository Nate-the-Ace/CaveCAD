// CsDrape.js -- a scanned sketch laid onto the passage it was drawn of.
//
// Part of the Cave Survey Core library. The half above the QCAD banner
// is PURE -- plain {x, y, z}, no RVector, no document -- and is the half
// worth testing.
//
// THIS INTERPOLATES ELEVATION BETWEEN STATIONS, which is inventing data
// of the same class CsLrud refuses to invent when it will not guess wall
// detail between measured points. What makes it defensible here, and
// ONLY here, is that the 3D panel DRAWS NO ENTITY AND WRITES NO TAG. It
// has always been a view. Inventing a surface to look at is not
// inventing survey data.
//
// NOTHING FROM THIS MODULE MAY EVER BE WRITTEN BACK INTO A DRAWING.
// That is the whole of its licence to guess, and it is a standing
// constraint rather than a note.
//
// Weighted by inverse square distance -- the same weighting CsWarp uses
// for linework, guarded the same way against a query point sitting
// exactly on a station.
//
// BOTH DRAPES ARE ONE IDEA: sample the survey for the coordinate the
// sketch does not carry. A plan sketch carries x and y and needs z; a
// profile sketch carries distance-along-run and elevation and needs x
// and y.

var CsDrape = {};

/** Guards 1/distSq against a literal divide by zero, for a query point
 *  sitting exactly on a station. Squared drawing units. */
CsDrape.MIN_DIST_SQ = 1e-9;

/** Past this from EVERY station the drape goes flat. Beyond the survey
 *  there is no trend to follow, and a plane is an honest answer where a
 *  guessed slope is not. Drawing units. */
CsDrape.REACH = 200;

/** How finely a scan's quad is subdivided. A plan sketch is flat and
 *  the passage under it is not, so the grid is what lets the sheet
 *  follow the cave; too coarse and it bridges over a drop. */
CsDrape.DIVISIONS = 24;

/**
 * The elevation to drape a plan point at.
 *
 * \param stations {name: {x, y, z}} as CsNetwork.resolve returns
 * \return z, or null when there is no station to sample at all
 */
CsDrape.elevationAt = function(point, stations) {
    var sumW = 0, sumZ = 0;
    var nearest = null, nearestD2 = Infinity;
    var reach2 = CsDrape.REACH * CsDrape.REACH;
    for (var name in stations) {
        if (!stations.hasOwnProperty(name)) { continue; }
        var st = stations[name];
        if (st === null || st === undefined) { continue; }
        if (typeof st.z !== "number" || !isFinite(st.z)) { continue; }
        var dx = point.x - st.x, dy = point.y - st.y;
        var d2 = dx * dx + dy * dy;
        if (d2 < nearestD2) {
            nearestD2 = d2;
            nearest = st;
        }
        if (d2 > reach2) { continue; }
        var w = 1.0 / Math.max(d2, CsDrape.MIN_DIST_SQ);
        sumW += w;
        sumZ += w * st.z;
    }
    if (sumW > 0) {
        return sumZ / sumW;
    }
    // Nothing within reach: the nearest station's own elevation, flat.
    // Extrapolating a slope out past the last station would invent a
    // cave going somewhere nobody surveyed.
    return (nearest === null) ? null : nearest.z;
};

/**
 * A scan's quad as a grid draped onto the passage.
 *
 * \param quad      {origin, u, v} where u and v span the WHOLE image
 * \param divisions cells per side
 * \return {positions, uvs, indices}; empty when nothing can be sampled
 */
CsDrape.grid = function(quad, divisions, stations) {
    var empty = { positions: [], uvs: [], indices: [] };
    if (quad === null || quad === undefined) {
        return empty;
    }
    var out = { positions: [], uvs: [], indices: [] };
    var n = Math.max(1, Math.floor(divisions));
    for (var j = 0; j <= n; j++) {
        for (var i = 0; i <= n; i++) {
            var s = i / n, t = j / n;
            var x = quad.origin.x + quad.u.x * s + quad.v.x * t;
            var y = quad.origin.y + quad.u.y * s + quad.v.y * t;
            var z = CsDrape.elevationAt({ x: x, y: y }, stations);
            if (z === null || !isFinite(x) || !isFinite(y)) {
                // No survey to drape onto is not a degenerate grid to
                // draw; it is nothing to draw.
                return empty;
            }
            out.positions.push(x, y, z);
            // v flipped: an image's rows run down from its top, and a
            // drawing's y runs up.
            out.uvs.push(s, 1 - t);
        }
    }
    for (var jj = 0; jj < n; jj++) {
        for (var ii = 0; ii < n; ii++) {
            var a = jj * (n + 1) + ii;
            var b = a + 1;
            var c = a + (n + 1);
            var d = c + 1;
            out.indices.push(a, b, d, a, d, c);
        }
    }
    return out;
};
