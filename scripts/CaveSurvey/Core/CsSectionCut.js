// CsSectionCut.js -- cutting a rough cross section anywhere along the
// surveyed alignment.
//
// Part of the Cave Survey Core library. PURE: plain {x, y, z} objects,
// no RVector, no document. Everything QCAD-shaped lives in
// CsSectionDraw.js.
//
// WHY THIS IS POSSIBLE AT ALL. CsTraverse.offset already returns
// {dx, dy, dz} -- every splay is a 3D wall hit and always was.
// CsLrud.stationWallPoints DISCARDS dz because the plan view has no use
// for it. That single discard is the only reason the suite looked like
// it had no 3D model to cut.
//
// WHAT MAKES THE MATHS SMALL. A survey leg is STRAIGHT, so the tangent
// is constant along it: one plane normal serves every cut on a leg, and
// there is no twist to integrate. Two consequences worth stating --
//   * no junction ambiguity for a cut: a leg has exactly two ends, so
//     the stations bounding the cut are simply those two;
//   * the frame problem reduces to choosing theta = 0.
//
// AND WHY THAT LAST PART IS STILL NOT TRIVIAL. theta = 0 wants to be
// world up projected into the section plane, which DEGENERATES on a
// pitch: near vertical, up lies along the leg, the projection goes to
// zero, and theta = 0 becomes noise -- sections spin from leg to leg in
// exactly the passages where a reader needs them steady. So the
// reference is carried between legs by a rotation-minimizing frame
// (double reflection, Wang et al. 2008), which is stable where a Frenet
// frame flips at an inflection.

var CsSectionCut = {};

/** Below this, a vector is zero for our purposes. */
CsSectionCut.EPS = 1e-12;
/** |up projected into the plane| below this and the seed is refused:
 *  the leg is a pitch and theta = 0 would be noise. */
CsSectionCut.SEED_MIN = 0.2;
/** Carried frames drift. Past this many degrees from the up-projected
 *  reference -- and only where that reference is well conditioned --
 *  the frame is RE-SEEDED, so a long cave does not accumulate an
 *  arbitrary roll. A re-seed is a visible discontinuity in the drawing,
 *  so callers report it rather than swallowing it. */
CsSectionCut.RESEED_DEG = 15;

CsSectionCut.dot = function(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
};

CsSectionCut.cross = function(a, b) {
    return { x: a.y * b.z - a.z * b.y,
             y: a.z * b.x - a.x * b.z,
             z: a.x * b.y - a.y * b.x };
};

CsSectionCut.sub = function(a, b) {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
};

CsSectionCut.scale = function(a, k) {
    return { x: a.x * k, y: a.y * k, z: a.z * k };
};

CsSectionCut.add = function(a, b) {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
};

CsSectionCut.length = function(a) {
    return Math.sqrt(CsSectionCut.dot(a, a));
};

/** \return the unit vector, or null when there is no direction. */
CsSectionCut.normalize = function(a) {
    var m = CsSectionCut.length(a);
    if (m < CsSectionCut.EPS) {
        return null;
    }
    return { x: a.x / m, y: a.y / m, z: a.z / m };
};

/**
 * A frame from world up alone: r = up with the along-leg part removed.
 * \return {d, r, s} orthonormal, or null when the leg is too steep for
 *         up to say anything (a pitch).
 */
CsSectionCut.seedFrame = function(d) {
    var dn = CsSectionCut.normalize(d);
    if (dn === null) {
        return null;
    }
    var up = { x: 0, y: 0, z: 1 };
    var proj = CsSectionCut.sub(up,
        CsSectionCut.scale(dn, CsSectionCut.dot(up, dn)));
    if (CsSectionCut.length(proj) < CsSectionCut.SEED_MIN) {
        return null;
    }
    var r = CsSectionCut.normalize(proj);
    return { d: dn, r: r, s: CsSectionCut.cross(dn, r) };
};

/**
 * The double-reflection step (Wang et al. 2008): carry `prev`'s
 * reference onto the next leg with the least possible rotation.
 *
 * \param prev {d, r, s} on the previous leg
 * \param x0, x1 the previous leg's start and the new leg's start
 * \param d1 the new leg's direction
 * \return {d, r, s} orthonormal on the new leg
 */
CsSectionCut.carryFrame = function(prev, x0, x1, d1) {
    var dn = CsSectionCut.normalize(d1);
    if (dn === null || prev === null || prev === undefined) {
        return CsSectionCut.seedFrame(d1);
    }
    var v1 = CsSectionCut.sub(x1, x0);
    var c1 = CsSectionCut.dot(v1, v1);
    var rL = prev.r, dL = prev.d;
    if (c1 > CsSectionCut.EPS) {
        rL = CsSectionCut.sub(prev.r,
            CsSectionCut.scale(v1, 2 * CsSectionCut.dot(v1, prev.r) / c1));
        dL = CsSectionCut.sub(prev.d,
            CsSectionCut.scale(v1, 2 * CsSectionCut.dot(v1, prev.d) / c1));
    }
    var v2 = CsSectionCut.sub(dn, dL);
    var c2 = CsSectionCut.dot(v2, v2);
    var r1 = rL;
    if (c2 > CsSectionCut.EPS) {
        r1 = CsSectionCut.sub(rL,
            CsSectionCut.scale(v2, 2 * CsSectionCut.dot(v2, rL) / c2));
    }
    // Re-orthonormalise against the new tangent: the reflections are
    // exact in theory and drift in floating point over a long cave.
    var perp = CsSectionCut.sub(r1,
        CsSectionCut.scale(dn, CsSectionCut.dot(r1, dn)));
    var r = CsSectionCut.normalize(perp);
    if (r === null) {
        var fallback = CsSectionCut.seedFrame(d1);
        if (fallback !== null) {
            return fallback;
        }
        return { d: dn, r: { x: 1, y: 0, z: 0 }, s: { x: 0, y: 1, z: 0 } };
    }
    return { d: dn, r: r, s: CsSectionCut.cross(dn, r) };
};

/**
 * The frame for a leg, given the previous one: carried, then re-seeded
 * if it has drifted and the seed is trustworthy again.
 *
 * \return {frame, reseeded} -- `reseeded` is true when theta = 0 jumped,
 *         which the caller REPORTS rather than hides.
 */
CsSectionCut.frameFor = function(prev, x0, x1, d1) {
    if (prev === null || prev === undefined) {
        var seeded = CsSectionCut.seedFrame(d1);
        if (seeded !== null) {
            return { frame: seeded, reseeded: false };
        }
        // A run that OPENS on a pitch has nothing to carry and nothing
        // to seed from. Any perpendicular is as good as any other; what
        // matters is that it is recorded as arbitrary.
        var dn = CsSectionCut.normalize(d1);
        if (dn === null) {
            return { frame: null, reseeded: false };
        }
        var any = Math.abs(dn.x) < 0.9 ? { x: 1, y: 0, z: 0 } :
            { x: 0, y: 1, z: 0 };
        var perp = CsSectionCut.normalize(CsSectionCut.sub(any,
            CsSectionCut.scale(dn, CsSectionCut.dot(any, dn))));
        return { frame: { d: dn, r: perp, s: CsSectionCut.cross(dn, perp) },
                 reseeded: true };
    }
    var carried = CsSectionCut.carryFrame(prev, x0, x1, d1);
    var seed = CsSectionCut.seedFrame(d1);
    if (seed === null || carried === null) {
        return { frame: carried, reseeded: false };
    }
    var cosA = Math.max(-1, Math.min(1,
        CsSectionCut.dot(carried.r, seed.r)));
    var driftDeg = Math.acos(cosA) * 180 / Math.PI;
    if (driftDeg > CsSectionCut.RESEED_DEG) {
        return { frame: seed, reseeded: true };
    }
    return { frame: carried, reseeded: false };
};
