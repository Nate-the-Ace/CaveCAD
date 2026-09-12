// CsSection3d.js -- a captured cross section, standing in the 3D view.
//
// Part of the Cave Survey Core library. The half above the QCAD banner
// is PURE -- plain {x, y, z}, no RVector, no document -- and is the half
// worth testing. The half below reads block references out of a
// document and is QCAD-only, the same split CsBind and CsScanTrim use.
//
// WHAT A SECTION ALREADY KNOWS ABOUT ITSELF. Its block reference carries
// the station it belongs to, the scale it was drawn at, and (for a
// sketched one) the scan it was traced from. And the block is
// BLOCK-LOCAL about the ghost's centre, which is where the centreline of
// the passage was -- so block-local (0,0) IS the station, and nothing
// has to be registered. See SectionCapture.js's own header.
//
// THE FRAME IS NOT DERIVED HERE. CsSectionCut.frameForLeg already
// answers "which way is up and right at this station", and it carries
// theta from leg to leg so sections do not spin as you walk the passage.
// Deriving a second frame here would be a second answer to a settled
// question, and the first place the two would disagree is a PITCH --
// which is exactly where a spinning section is most obvious and least
// forgivable.
//
// WHY OFFSET AND NOT IN PLACE. A section drawn through the passage hides
// the passage. In 2D it is a callout parked to one side with a leader
// home, and which side is a decision the caver already made by dragging
// it; this reads that decision back rather than making a new one.

include(includeBasePath + "/CsSectionCut.js");

var CsSection3d = {};

/** Beyond this many passage widths from its station, a block's
 *  direction says nothing about which side the caver meant -- it is
 *  parked in a bay, or laid out on a sheet. */
CsSection3d.FAR_FACTOR = 12;

/** How far clear of the passage wall a section stands, as a fraction of
 *  the passage width at that station. */
CsSection3d.CLEARANCE = 0.6;

/**
 * Which side of the passage a section hangs on, as a unit vector.
 *
 * The caver already chose: SectionCapture marches the block to a spot
 * near its station and the caver may then have dragged it, so the plan
 * vector from station to block carries the answer. Only its SIGN along
 * the frame's r axis is used -- a section stands square to the passage
 * whichever way the block drifted.
 *
 * \param width the passage width at that station, for the far test
 * \return {x,y,z} unit vector, +r or -r
 */
CsSection3d.sideFor = function(blockPos, stationPos, frame, width) {
    var r = frame.r;
    var dx = blockPos.x - stationPos.x;
    var dy = blockPos.y - stationPos.y;
    var far = Math.max(width, 1) * CsSection3d.FAR_FACTOR;
    if (Math.sqrt(dx * dx + dy * dy) > far) {
        return { x: r.x, y: r.y, z: r.z };
    }
    var along = dx * r.x + dy * r.y;
    if (along < 0) {
        return { x: -r.x, y: -r.y, z: -r.z };
    }
    return { x: r.x, y: r.y, z: r.z };
};

/**
 * Block-local polylines placed into the world.
 *
 * \param polylines [[{x,y}, ...], ...] block-local, origin at the
 *                  passage centreline
 * \param opts      {station, frame, scale, side, offset}
 *
 * SCALE IS DRAWING UNITS PER REAL UNIT, SO IT DIVIDES. A section drawn
 * at two units to the foot is HALF the size of its own numbers, not
 * twice; inverted, every section comes out microscopic or the size of
 * the cave. This is the failure this module most expects, which is why
 * it has a test with a known value rather than an eyeball.
 *
 * \return [[{x,y,z}, ...], ...], empty when there is no usable frame
 */
CsSection3d.place = function(polylines, opts) {
    var out = [];
    if (polylines === undefined || polylines === null ||
            opts === undefined || opts === null) {
        return out;
    }
    var frame = opts.frame;
    if (frame === null || frame === undefined ||
            frame.r === undefined || frame.s === undefined) {
        return out;
    }
    var scale = opts.scale;
    if (typeof scale !== "number" || !isFinite(scale) ||
            Math.abs(scale) < 1e-9) {
        scale = 1;
    }
    var st = opts.station;
    var side = opts.side;
    var offset = (typeof opts.offset === "number" && isFinite(opts.offset))
        ? opts.offset : 0;

    var ox = st.x + side.x * offset;
    var oy = st.y + side.y * offset;
    var oz = st.z + side.z * offset;

    for (var i = 0; i < polylines.length; i++) {
        var line = polylines[i];
        var made = [];
        for (var j = 0; j < line.length; j++) {
            var u = line[j].x / scale;
            var v = line[j].y / scale;
            if (!isFinite(u) || !isFinite(v)) {
                continue;
            }
            made.push({
                x: ox + frame.r.x * u + frame.s.x * v,
                y: oy + frame.r.y * u + frame.s.y * v,
                z: oz + frame.r.z * u + frame.s.z * v
            });
        }
        if (made.length >= 2) {
            out.push(made);
        }
    }
    return out;
};

/** The leader: from where the section stands, home to its station. */
CsSection3d.leaderFor = function(opts) {
    var st = opts.station;
    var side = opts.side;
    var offset = (typeof opts.offset === "number" && isFinite(opts.offset))
        ? opts.offset : 0;
    return [
        { x: st.x + side.x * offset,
          y: st.y + side.y * offset,
          z: st.z + side.z * offset },
        { x: st.x, y: st.y, z: st.z }
    ];
};
