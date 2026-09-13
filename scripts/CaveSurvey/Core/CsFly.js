// CsFly.js -- a camera path down the surveyed passage.
//
// Part of the Cave Survey Core library. PURE: no Q* or R* symbols, so
// tests/js_unit.js exercises all of it.
//
// WHAT THIS IS FOR. Looking at a cave from outside tells a
// cartographer the shape of it; flying down the middle of it tells
// them what it is like to be in it, which is the thing a map is trying
// to convey and the thing a passage drawn as a tube does not.
//
// THE PATH IS THE CENTRELINE, IN SURVEY ORDER. Not a smoothed curve
// through the stations and not a route solved for prettiness: the legs
// as they were walked. A caver watching this is matching what they see
// against what they remember of walking it, and a path that took its
// own line through the passage would be showing them a trip nobody
// made.
//
// WHERE IT BREAKS, IT BREAKS. A survey is not one continuous walk: it
// branches, and the next leg in order often starts somewhere else
// entirely. Those jumps are kept as jumps rather than being bridged
// with invented passage -- see CsFly.runs.

var CsFly = {};

/** Samples closer together than this are the same place. Drawing
 *  units squared. */
CsFly.MIN_STEP_SQ = 1e-9;

/**
 * The centreline as runs of connected legs, in survey order.
 *
 * A new run begins wherever the next leg does not start where the last
 * one finished. Splays are left out: they are wall hits, not passage
 * anyone walked.
 *
 * \return [[{x,y,z}, ...], ...]
 */
CsFly.runs = function(resolved) {
    var out = [];
    if (resolved === null || resolved === undefined ||
            resolved.legs === null || resolved.legs === undefined ||
            resolved.stations === null || resolved.stations === undefined) {
        return out;
    }
    var at = null;
    var current = null;
    var lastName = null;
    for (var i = 0; i < resolved.legs.length; i++) {
        var leg = resolved.legs[i];
        if (leg === null || leg === undefined) { continue; }
        if (leg.splay === true || leg.excludeFromAll === true) { continue; }
        var a = resolved.stations[leg.from];
        var b = resolved.stations[leg.to];
        if (!CsFly.usable(a) || !CsFly.usable(b)) { continue; }
        if (current === null || lastName !== leg.from) {
            // A leg that does not carry on from the last one starts a
            // new run rather than being joined to it through passage
            // nobody surveyed.
            current = [{ x: a.x, y: a.y, z: a.z }];
            out.push(current);
        }
        current.push({ x: b.x, y: b.y, z: b.z });
        lastName = leg.to;
        at = b;
    }
    return out;
};

/** A station with a position that can be flown to. */
CsFly.usable = function(st) {
    return st !== null && st !== undefined &&
        typeof st.x === "number" && typeof st.y === "number" &&
        typeof st.z === "number" &&
        isFinite(st.x) && isFinite(st.y) && isFinite(st.z);
};

/** How long a run is, walked end to end. */
CsFly.lengthOf = function(points) {
    var total = 0;
    if (points === null || points === undefined) { return 0; }
    for (var i = 1; i < points.length; i++) {
        total += CsFly.distance(points[i - 1], points[i]);
    }
    return total;
};

CsFly.distance = function(a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

/**
 * One run resampled at an even spacing.
 *
 * EVEN SPACING IS WHAT MAKES THE SPEED CONSTANT. Stations are not
 * evenly spaced -- a tight crawl gets a shot every few feet and a
 * walking passage one every fifty -- so a camera that spent the same
 * time between each would crawl through the open passage and race
 * through the tight bits, which is the opposite of what is worth
 * seeing.
 */
CsFly.resample = function(points, step) {
    if (points === null || points === undefined || points.length === 0) {
        return [];
    }
    if (points.length === 1 || !(step > 0)) {
        return [{ x: points[0].x, y: points[0].y, z: points[0].z }];
    }
    var out = [{ x: points[0].x, y: points[0].y, z: points[0].z }];
    var carry = 0;
    for (var i = 1; i < points.length; i++) {
        var a = points[i - 1], b = points[i];
        var seg = CsFly.distance(a, b);
        if (!(seg > 0)) { continue; }
        var walked = step - carry;
        while (walked <= seg) {
            var t = walked / seg;
            out.push({ x: a.x + (b.x - a.x) * t,
                       y: a.y + (b.y - a.y) * t,
                       z: a.z + (b.z - a.z) * t });
            walked += step;
        }
        carry = seg - (walked - step);
    }
    var last = points[points.length - 1];
    var tail = out[out.length - 1];
    if (CsFly.distance(tail, last) > 1e-9) {
        out.push({ x: last.x, y: last.y, z: last.z });
    }
    return out;
};

/**
 * The whole flight: every run resampled, one after another, with the
 * index at which each run starts so a jump is not mistaken for passage.
 *
 * \param step how far apart the samples sit; defaults to a fiftieth of
 *        the longest run, so a cave of any size takes a similar number
 *        of samples
 * \return {points: [{x,y,z}], breaks: [index, ...], length: <units>}
 */
CsFly.path = function(resolved, step) {
    var runs = CsFly.runs(resolved);
    var out = { points: [], breaks: [], length: 0 };
    if (runs.length === 0) { return out; }
    var use = step;
    if (!(use > 0)) {
        var longest = 0;
        for (var r = 0; r < runs.length; r++) {
            longest = Math.max(longest, CsFly.lengthOf(runs[r]));
        }
        use = (longest > 0) ? (longest / 50.0) : 1.0;
    }
    for (var i = 0; i < runs.length; i++) {
        var sampled = CsFly.resample(runs[i], use);
        if (sampled.length === 0) { continue; }
        if (out.points.length > 0) {
            // Where one run ends and the next begins: the camera is
            // somewhere else now, and a viewer should be told rather
            // than shown a swoop through solid rock.
            out.breaks.push(out.points.length);
        }
        for (var s = 0; s < sampled.length; s++) {
            out.points.push(sampled[s]);
        }
        out.length += CsFly.lengthOf(runs[i]);
    }
    return out;
};

/** The path as a flat [x,y,z,...] array, which is what the view takes. */
CsFly.flatten = function(points) {
    var out = [];
    if (points === null || points === undefined) { return out; }
    for (var i = 0; i < points.length; i++) {
        out.push(points[i].x, points[i].y, points[i].z);
    }
    return out;
};

/** A stamp for a folder name: when this animation was made. Local time,
 *  because it is for a caver looking at their own folder, not a log. */
CsFly.stamp = function(now) {
    var d = (now === undefined || now === null) ? new Date() : now;
    function two(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) +
        "-" + two(d.getHours()) + two(d.getMinutes());
};
