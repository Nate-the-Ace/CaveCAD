// CsSectionBay.js -- the staging bay a cross section is sketched in.
//
// Part of the Cave Survey Core library. PURE: plain {x, y} and
// {x1, y1, x2, y2} objects, no RVector, no document, no widget. Every
// function here is node-testable, which is the whole reason the bay's
// decisions live in this file rather than in the tool that draws them.
//
// WHAT A BAY IS. A rectangle parked clear of the plan, holding a
// scanned field-book section and the computed LRUD outline for the same
// station. The caver scales the scan onto that outline and traces. What
// ends up INSIDE the rectangle becomes the block; the scan, the outline
// and the rectangle itself do not.
//
// WHY CONTAINMENT AND NOT LAYERS. A stray line left on a section layer
// by the previous sketch would join the next block silently. A frame is
// visible: what is in and what is out can be seen before committing.
// Flush with the frame counts as IN -- a caver who traces right up to
// the edge meant to.

var CsSectionBay = {};

/** How far the bay sits from the drawing's own extent. */
CsSectionBay.GAP = 20;

/** How far the block must clear an obstacle when it is placed. */
CsSectionBay.MARGIN = 4;

/** March step, in drawing units, and how many steps before giving up.
 *  The cap matters: an unbounded march past a boxed-in station would
 *  fling the section somewhere the caver will never scroll to. */
CsSectionBay.STEP = 2;
CsSectionBay.CAP = 400;

/**
 * Where the bay goes.
 *
 * Right of the drawing's extent by GAP, bottom-aligned with it, unless
 * the caver has moved the bay before -- then it goes back where they
 * put it. A drawing with no extent yet (a fresh template) parks at the
 * origin rather than at NaN.
 *
 * \param planBox {x1,y1,x2,y2} of the drawing, or null
 * \param size {w, h}
 * \param remembered {x, y} lower-left corner, or null
 * \return {x1, y1, x2, y2}. Pure.
 */
CsSectionBay.frameRectFor = function(planBox, size, remembered) {
    var w = (size && size.w > 0) ? size.w : 40;
    var h = (size && size.h > 0) ? size.h : 40;
    if (remembered !== null && remembered !== undefined &&
            !isNaN(remembered.x) && !isNaN(remembered.y)) {
        return { x1: remembered.x, y1: remembered.y,
                 x2: remembered.x + w, y2: remembered.y + h };
    }
    if (planBox === null || planBox === undefined ||
            isNaN(planBox.x2) || isNaN(planBox.y1)) {
        return { x1: 0, y1: 0, x2: w, y2: h };
    }
    var x1 = planBox.x2 + CsSectionBay.GAP;
    var y1 = planBox.y1;
    return { x1: x1, y1: y1, x2: x1 + w, y2: y1 + h };
};

/** Is a box wholly inside a rect? Flush counts as inside. Pure. */
CsSectionBay.contains = function(rect, box) {
    if (rect === null || rect === undefined ||
            box === null || box === undefined) {
        return false;
    }
    return box.x1 >= rect.x1 && box.x2 <= rect.x2 &&
           box.y1 >= rect.y1 && box.y2 <= rect.y2;
};

/**
 * The capture set: the ids of every item wholly inside the rect, minus
 * the excluded ones (the scan, the ghost, the frame).
 *
 * \param items [{id, box}]
 * \param excludeIds array of ids
 * \return array of ids, in input order. Pure.
 */
CsSectionBay.sweepOf = function(items, rect, excludeIds) {
    var out = [];
    var skip = {};
    var i;
    if (excludeIds !== null && excludeIds !== undefined) {
        for (i = 0; i < excludeIds.length; i++) {
            skip[String(excludeIds[i])] = true;
        }
    }
    for (i = 0; i < items.length; i++) {
        if (skip[String(items[i].id)] === true) {
            continue;
        }
        if (CsSectionBay.contains(rect, items[i].box)) {
            out.push(items[i].id);
        }
    }
    return out;
};

/**
 * How the scan should sit over the ghost when the bay opens.
 *
 * UNIFORM, always. A scan squashed to fill the ghost's box would make
 * every traced width a lie, and the caver would have no way to see it:
 * a squashed passage still looks like a passage. Scaled to the ghost's
 * WIDTH and centred; the caver adjusts from there.
 *
 * A NaN anywhere in either box (an entity whose extent has not been
 * computed yet is the recurring source) must not ride through into
 * tx/ty -- a NaN transform still LOOKS like a transform to the caller,
 * which would insert the scan at an unreachable point with no error.
 * Caught at the boundary, once, on the finished numbers, rather than
 * validating every input field individually.
 *
 * \return a fit: {ux, uy, vx, vy, tx, ty}. Pure. See serializeFit for
 *         what the six numbers mean.
 */
CsSectionBay.fitTransform = function(scanBox, ghostBox) {
    var sw = scanBox.x2 - scanBox.x1;
    var gw = ghostBox.x2 - ghostBox.x1;
    var k = (sw > 0 && gw > 0) ? (gw / sw) : 1;
    var cx = (ghostBox.x1 + ghostBox.x2) / 2;
    var cy = (ghostBox.y1 + ghostBox.y2) / 2;
    var sh = (scanBox.y2 - scanBox.y1) * k;
    // Axis-aligned, because an auto-fit has no rotation to express:
    // u runs along +x at the fitted scale, v along +y.
    var fit = { ux: k, uy: 0, vx: 0, vy: k,
                tx: cx - (sw * k) / 2, ty: cy - sh / 2 };
    if (isNaN(fit.ux) || isNaN(fit.vy) || isNaN(fit.tx) || isNaN(fit.ty)) {
        return { ux: 1, uy: 0, vx: 0, vy: 1, tx: 0, ty: 0 };
    }
    return fit;
};

/**
 * The fit as a tag value.
 *
 * THE TWO VECTORS, NOT A DECOMPOSITION. `u` and `v` are the image's own
 * per-pixel edge vectors -- exactly what `RImageData` carries and
 * exactly what an `RImageData` constructor takes back -- so they hold
 * scale AND rotation together with nothing to decompose and nothing to
 * recompose. The fit this replaced stored `sx, sy, rot` and rebuilt
 * `u = (sx, 0)`, `v = (0, sy)`, a shape that cannot express a rotation
 * at all: a caver who turned the scan onto the ghost got it back
 * square, and `rot` was written 0 every time regardless.
 *
 * `tx, ty` are the insertion point RELATIVE TO THE SECTION'S OWN
 * ORIGIN (the ghost centre, which is also the block's 0,0). Absolute
 * coordinates would be meaningless on reopen: the bay parks against the
 * CURRENT plan extents and lands somewhere new every time.
 *
 * Fixed precision and six fields, so the serialized length is bounded
 * by construction -- no tag in this suite is ever allowed to grow
 * without a limit.
 */
CsSectionBay.serializeFit = function(fit) {
    var n = function(v) {
        return (isNaN(v) ? 0 : v).toFixed(6);
    };
    return [n(fit.ux), n(fit.uy), n(fit.vx), n(fit.vy),
            n(fit.tx), n(fit.ty)].join(",");
};

/**
 * The fit back from a tag value, or NULL when it is not one. Never
 * throws: a corrupt tag must reopen the bay without an underlay, not
 * take the tool down.
 *
 * THE OLD FIVE-FIELD FORMAT (`sx,sy,rot,tx,ty`) READS AS NULL, on
 * purpose. Its numbers do not mean what these six mean -- its `tx,ty`
 * were absolute world coordinates in a bay that no longer exists -- so
 * reading it as if it were this format would place the scan at a point
 * hundreds of units off the reopened bay. Null instead sends the caller
 * down its own fallback (SectionEdit auto-fits the scan to the ghost,
 * exactly as SketchSection does when a bay first opens), which is what
 * a pre-change section was getting anyway.
 */
CsSectionBay.parseFit = function(text) {
    if (text === null || text === undefined || String(text) === "") {
        return null;
    }
    var parts = String(text).split(",");
    if (parts.length !== 6) {
        return null;
    }
    var nums = [];
    for (var i = 0; i < 6; i++) {
        var v = parseFloat(parts[i]);
        if (isNaN(v)) {
            return null;
        }
        nums.push(v);
    }
    return { ux: nums[0], uy: nums[1], vx: nums[2], vy: nums[3],
             tx: nums[4], ty: nums[5] };
};

/** Two boxes overlapping, once one is grown by a margin. Pure. */
CsSectionBay.overlaps = function(a, b, margin) {
    var m = (margin === undefined || margin === null) ? 0 : margin;
    return !(a.x2 + m < b.x1 || a.x1 - m > b.x2 ||
             a.y2 + m < b.y1 || a.y1 - m > b.y2);
};

/** A block-local box translated to an insertion point. Pure. */
CsSectionBay.boxAt = function(localBox, at) {
    return { x1: localBox.x1 + at.x, y1: localBox.y1 + at.y,
             x2: localBox.x2 + at.x, y2: localBox.y2 + at.y };
};

/**
 * Walk outward from the station until the block clears everything.
 *
 * CAPPED on purpose. A station boxed in on every side is a real
 * situation (a maze, a chamber full of breakdown), and the honest
 * answer there is "you place it" -- not a section flung a thousand feet
 * off the sheet where the caver will never find it.
 *
 * \param origin {x, y} the station
 * \param dir {x, y} unit outward direction
 * \param blockBox block-local {x1,y1,x2,y2}
 * \param obstacles array of {x1,y1,x2,y2}
 * \return {x, y} or null. Pure.
 */
CsSectionBay.marchOut = function(origin, dir, blockBox, obstacles, margin,
        cap) {
    var steps = (cap === undefined || cap === null) ? CsSectionBay.CAP : cap;
    var m = (margin === undefined || margin === null) ?
        CsSectionBay.MARGIN : margin;
    for (var s = 1; s <= steps; s++) {
        var at = { x: origin.x + dir.x * CsSectionBay.STEP * s,
                   y: origin.y + dir.y * CsSectionBay.STEP * s };
        var box = CsSectionBay.boxAt(blockBox, at);
        var clear = true;
        for (var i = 0; i < obstacles.length; i++) {
            if (CsSectionBay.overlaps(box, obstacles[i], m)) {
                clear = false;
                break;
            }
        }
        if (clear) {
            return at;
        }
    }
    return null;
};

/** The unit perpendicular of a direction. Pure.
 *
 * `!(len >= 1e-12)`, not `len < 1e-12` -- every comparison against a
 * NaN is false, including `NaN < 1e-12`, so a NaN length (a zero-length
 * leg divided by its own length somewhere upstream) would slip past a
 * `<` guard, divide anyway, and hand marchOut a NaN direction that
 * "succeeds" at every candidate point. Negating `>=` instead of testing
 * `< || isNaN(...)` catches NaN and the too-short case in one
 * comparison, since NaN fails every ordering. */
CsSectionBay.perpOf = function(d) {
    var len = Math.sqrt(d.x * d.x + d.y * d.y);
    if (!(len >= 1e-12)) {
        return { x: 0, y: 1 };
    }
    return { x: -d.y / len, y: d.x / len };
};

/**
 * Which way along a perpendicular has more room: +1 or -1.
 *
 * Counted, not measured. A count of obstacles within a probe box is
 * crude and stable; a nearest-distance measure flips on one stray note
 * and moves the section between runs, which reads as the tool being
 * random.
 *
 * A TIE GOES POSITIVE, so an empty drawing answers the same way twice.
 * Pure.
 */
CsSectionBay.clearerSide = function(origin, perp, obstacles, probe) {
    var reach = (probe === undefined || probe === null) ? 50 : probe;
    var count = function(sign) {
        var tip = { x: origin.x + perp.x * reach * sign,
                    y: origin.y + perp.y * reach * sign };
        var box = { x1: Math.min(origin.x, tip.x),
                    y1: Math.min(origin.y, tip.y),
                    x2: Math.max(origin.x, tip.x),
                    y2: Math.max(origin.y, tip.y) };
        var n = 0;
        for (var i = 0; i < obstacles.length; i++) {
            if (CsSectionBay.overlaps(box, obstacles[i], 0)) {
                n++;
            }
        }
        return n;
    };
    return (count(-1) < count(1)) ? -1 : 1;
};
