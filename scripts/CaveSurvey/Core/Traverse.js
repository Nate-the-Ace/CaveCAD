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
 * The offset a shot moves, as {dx, dy, dz, plan}: drawing-plane x/y,
 * vertical rise, and the plan-projected length.
 *
 * \param shot {distance, azimuth, inclination} (degrees; azimuth
 *             clockwise from north)
 * \param tapeMode CsTraverse.SLOPE (default) or HORIZONTAL
 */
CsTraverse.offset = function(shot, tapeMode) {
    var azRad = shot.azimuth * Math.PI / 180.0;
    var incRad = shot.inclination * Math.PI / 180.0;

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
