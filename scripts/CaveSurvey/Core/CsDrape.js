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

// ---------------------------------------------------------------------
// The profile half. Pure; tested under node.
//
// A PROFILE SKETCH IS DRAWN AGAINST AN UNROLLED AXIS. Its x is distance
// travelled along the passage, not a direction, so there is no single
// plane in three dimensions it belongs on -- it has to be walked back
// onto the centreline it was unrolled from.
//
// CsProfile.unrollBand is the forward map, returning legs carrying
// fromX/toX in band-local space. These invert it.
// ---------------------------------------------------------------------

/**
 * The leg of a band spanning a band-local x, and how far along it.
 *
 * CLAMPS rather than extrapolating past either end: a sketch drawn
 * wider than the band it sits in has run out of passage, not gained
 * some.
 *
 * \return {from, to, t} or null when the band has no legs
 */
CsDrape.alongBand = function(band, x) {
    if (band === null || band === undefined) { return null; }
    var legs = band.legs || [];
    if (legs.length === 0) { return null; }

    var first = legs[0], last = legs[legs.length - 1];
    if (x <= first.fromX) {
        return { from: first.from, to: first.to, t: 0 };
    }
    if (x >= last.toX) {
        return { from: last.from, to: last.to, t: 1 };
    }
    for (var i = 0; i < legs.length; i++) {
        var leg = legs[i];
        var span = leg.toX - leg.fromX;
        // A zero-length span would divide by zero; the NEXT leg owns
        // that x instead. Deterministic, so a point exactly on a leg
        // boundary always lands on the same side of it.
        if (span > 1e-12 && x >= leg.fromX && x < leg.toX) {
            return { from: leg.from, to: leg.to,
                     t: (x - leg.fromX) / span };
        }
    }
    return { from: last.from, to: last.to, t: 1 };
};

/**
 * A band-local point as a real position in the cave.
 *
 * x walks the centreline; y IS elevation and is taken straight across.
 * There is no vertical exaggeration to undo -- it was removed from this
 * suite in 0.9.123.0, so a band's y is simply elevation.
 *
 * \return {x, y, z} or null
 */
CsDrape.bandPointTo3d = function(band, resolved, x, y) {
    var hit = CsDrape.alongBand(band, x);
    if (hit === null) { return null; }
    var a = resolved.stations[hit.from];
    var b = resolved.stations[hit.to];
    if (a === undefined || b === undefined) { return null; }
    return {
        x: a.x + (b.x - a.x) * hit.t,
        y: a.y + (b.y - a.y) * hit.t,
        z: y
    };
};

/**
 * A profile scan as strips, one per leg it spans.
 *
 * STRIPS, NOT ONE QUAD. Band-local x maps linearly onto a leg, but only
 * WITHIN that leg -- a single quad stretched across a bend would cut the
 * corner and lay the sketch through rock the passage goes around.
 *
 * A BAND IS DRAWN 1:1 AT AN OFFSET, so recovering band-local coordinates
 * is a TRANSLATION, not a rescaling. The offset comes from the box: its
 * minimum corner is the band's own minimum corner, moved to wherever the
 * region was drawn. Treating it as a rescaling instead puts a sketch
 * below the cave, which is what it did the first time.
 *
 * \return {positions, uvs, indices}
 */
CsDrape.profileStrips = function(quad, box, band, resolved) {
    var out = { positions: [], uvs: [], indices: [] };
    if (quad === null || box === null || band === null ||
            quad === undefined || box === undefined || band === undefined) {
        return out;
    }
    var legs = (band.legs || []);
    var stations = (band.stations || []);
    if (legs.length === 0 || stations.length === 0) {
        return out;
    }

    var x0 = quad.origin.x;
    var x1 = quad.origin.x + quad.u.x;
    var yBottom = quad.origin.y;
    var yTop = quad.origin.y + quad.v.y;
    if (!(Math.abs(x1 - x0) > 1e-9) || !(Math.abs(yTop - yBottom) > 1e-9)) {
        return out;
    }

    // The band's own extent, and therefore where the drawing put it.
    var bandX0 = legs[0].fromX;
    var bandYMin = stations[0].y, bandYMax = stations[0].y;
    for (var si = 1; si < stations.length; si++) {
        if (stations[si].y < bandYMin) { bandYMin = stations[si].y; }
        if (stations[si].y > bandYMax) { bandYMax = stations[si].y; }
    }
    var offX = box.minX - bandX0;
    var offY = box.minY - bandYMin;

    var toBandX = function(drawX) { return drawX - offX; };
    var toElev = function(drawY) { return drawY - offY; };

    // A column at each end, and one at every leg boundary the scan
    // spans, so every bend in the passage gets a seam in the sketch.
    var lo = Math.min(x0, x1), hi = Math.max(x0, x1);
    var cuts = [x0];
    for (var i = 0; i < legs.length; i++) {
        var legDrawX = legs[i].toX + offX;
        if (legDrawX > lo && legDrawX < hi) {
            cuts.push(legDrawX);
        }
    }
    cuts.push(x1);
    cuts.sort(function(a, b) { return a - b; });

    for (var c = 0; c < cuts.length; c++) {
        var dx = cuts[c];
        var bx = toBandX(dx);
        var pBottom = CsDrape.bandPointTo3d(band, resolved, bx,
            toElev(yBottom));
        var pTop = CsDrape.bandPointTo3d(band, resolved, bx,
            toElev(yTop));
        if (pBottom === null || pTop === null) {
            return { positions: [], uvs: [], indices: [] };
        }
        var s = (dx - x0) / (x1 - x0);
        out.positions.push(pBottom.x, pBottom.y, pBottom.z);
        out.uvs.push(s, 0);
        out.positions.push(pTop.x, pTop.y, pTop.z);
        out.uvs.push(s, 1);
    }

    for (var q = 0; q + 1 < cuts.length; q++) {
        var a = q * 2, b = a + 1, cc = a + 2, d = a + 3;
        out.indices.push(a, cc, d, a, d, b);
    }
    return out;
};
