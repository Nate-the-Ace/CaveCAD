// Traverse.js -- one shot to a coordinate offset. The shortest file in
// Core, and the one that fixes the suite's oldest bug.
//
// Part of the Cave Survey Core library: pure functions.
//
// Compass, Walls and Survex tape lengths are SLOPE distances -- the
// tape is stretched along the shot, not held level. So:
//
//   plan offset = distance * cos(inclination)
//   rise        = distance * sin(inclination)
//
// The previous generation of these tools treated the tape as already
// horizontal (plan = distance, rise = distance * tan(inclination)),
// which plots every inclined passage too long -- 15% too long at 30
// degrees -- and overstates the rise steeply. tapeMode "horizontal"
// preserves that interpretation for data genuinely recorded that way
// (some old US surveys with a level tape), but "slope" is what the
// file formats mean and is the default everywhere.

var CsTraverse = {};

CsTraverse.SLOPE = "slope";
CsTraverse.HORIZONTAL = "horizontal";

/**
 * The azimuth a shot is computed with. With only a foresight, that
 * foresight; with a backsight too, the circular mean of the foresight
 * and the reversed backsight -- the standard fs/bs correction, worth
 * half the instrument error for free.
 */
CsTraverse.effectiveAzimuth = function(shot) {
    if (shot.backAzimuth === null || shot.backAzimuth === undefined) {
        return shot.azimuth;
    }
    var fs = shot.azimuth * Math.PI / 180.0;
    var bs = (shot.backAzimuth + 180.0) * Math.PI / 180.0;
    // circular mean, so 359/001 averages to 0, not 180:
    var x = Math.cos(fs) + Math.cos(bs);
    var y = Math.sin(fs) + Math.sin(bs);
    var mean = Math.atan2(y, x) * 180.0 / Math.PI;
    return ((mean % 360.0) + 360.0) % 360.0;
};

/** Same for inclination: backsight reads sign-flipped. */
CsTraverse.effectiveInclination = function(shot) {
    if (shot.backInclination === null || shot.backInclination === undefined) {
        return shot.inclination;
    }
    return (shot.inclination + (-shot.backInclination)) / 2.0;
};

/**
 * The offset a shot moves, as {dx, dy, dz, plan}: drawing-plane x/y,
 * vertical rise, and the plan-projected length.
 *
 * \param shot {distance, azimuth, inclination} (degrees; azimuth
 *             clockwise from north)
 * \param tapeMode CsTraverse.SLOPE (default) or HORIZONTAL
 */
CsTraverse.offset = function(shot, tapeMode) {
    var azRad = CsTraverse.effectiveAzimuth(shot) * Math.PI / 180.0;
    var incRad = CsTraverse.effectiveInclination(shot) * Math.PI / 180.0;

    var plan, dz;
    if (tapeMode === CsTraverse.HORIZONTAL) {
        plan = shot.distance;
        dz = shot.distance * Math.tan(incRad);
    } else {
        plan = shot.distance * Math.cos(incRad);
        dz = shot.distance * Math.sin(incRad);
    }

    return {
        dx: plan * Math.sin(azRad),
        dy: plan * Math.cos(azRad),
        dz: dz,
        plan: plan
    };
};

/** The same shot walked backwards (for resolving against a known TO). */
CsTraverse.reverseOffset = function(shot, tapeMode) {
    var o = CsTraverse.offset(shot, tapeMode);
    return { dx: -o.dx, dy: -o.dy, dz: -o.dz, plan: o.plan };
};
