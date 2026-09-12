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

// =====================================================================
// QCAD context below this line. Everything above runs under node.
//
// CsTags, CsCave and CsScanFrame are used at CALL time only and not
// included: CsAll's order already loads them, and pulling them earlier
// from here would reorder their own dependencies.
// =====================================================================

/** The XDATA key a scan's path is stored under, relative to scans/. */
CsDrape.PATH_TAG = "SketchScan";

/**
 * Every scan of one kind, with its file and the quad it occupies.
 *
 * THE ENTITY DOES NOT KNOW ITS OWN FILE. Probed against Truitt Cave's 28
 * plan scans: getFileName() comes back EMPTY and getWidth()/getHeight()
 * come back ZERO, through BOTH the method route and the property route.
 * Taking those at face value gives a drape that finds no images and says
 * nothing about why.
 *
 * The path is in XDATA, relative to the cave's scans folder -- the
 * convention CsCave documents -- and the pixel size has to come from the
 * file itself.
 *
 * \param kind "plan" | "profile" | "section", as CsScanFrame names them
 * \return [{path, widthPx, heightPx, quad: {origin, u, v}}]
 */
CsDrape.readScans = function(doc, kind) {
    var out = [];
    if (isNull(doc)) {
        return out;
    }
    var layerName = CsScanFrame.layerFor(kind);
    var scans = CsCave.scansDir(doc.getFileName());
    var ids;
    try {
        ids = doc.queryAllEntities(false, true);
    } catch (e) {
        return out;
    }
    for (var i = 0; i < ids.length; i++) {
        try {
            var e = doc.queryEntity(ids[i]);
            if (isNull(e) || e.getType() !== RS.EntityImage) {
                continue;
            }
            if (String(doc.getLayerName(e.getLayerId())) !== layerName) {
                continue;
            }
            var stored = CsTags.get(e, CsDrape.PATH_TAG);
            if (typeof stored !== "string" || stored === "") {
                continue;
            }
            var path = CsCave.resolveUnderScans(scans, stored);
            if (path === null || !(new QFileInfo(path)).exists()) {
                // A scan whose file has gone is SKIPPED. A blank quad
                // hanging over the passage says something false about
                // what was drawn there.
                continue;
            }
            var img = new QImage(path);
            if (img.isNull()) {
                continue;
            }
            var wpx = img.width(), hpx = img.height();
            if (!(wpx > 0) || !(hpx > 0)) {
                continue;
            }
            var ip = e.getInsertionPoint();
            var u = e.getUVector();
            var v = e.getVVector();
            out.push({
                path: path,
                widthPx: wpx,
                heightPx: hpx,
                // u AND v ARE PER PIXEL. The quad spans the whole image,
                // so each is multiplied by that dimension's pixel count.
                quad: { origin: { x: ip.x, y: ip.y },
                        u: { x: u.x * wpx, y: u.y * wpx },
                        v: { x: v.x * hpx, y: v.y * hpx } }
            });
        } catch (eRead) {
            // One unreadable scan must not take the whole drape down.
            continue;
        }
    }
    return out;
};
