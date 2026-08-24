/**
 * CsElevation -- elevation at an arbitrary point along the survey
 * alignment, and specifically the elevation of the PASSAGE FLOOR.
 *
 * PURE. Plain {x, y} in, plain values out, no document, so
 * tests/js_unit.js exercises it under node as well as inside CaveCAD's
 * own engine.
 *
 * Built as a primitive, not just as CsCalloutElev's helper: the
 * forthcoming entrance-elevation and lidar work needs exactly this
 * question answered -- "what is the elevation at this point on the
 * alignment" -- and must call in here rather than growing a second,
 * drifting copy.
 *
 * WHY THE FLOOR AND NOT THE SURVEY LINE. A survey line runs at
 * instrument height through the middle of the passage. A caver reading
 * an elevation off a map wants to know what they will be standing on.
 * Labelling the line would be off by the whole height of the passage,
 * and in a big room that is tens of feet.
 */
function CsElevation() {}

/** How far from a leg a point may be and still be sampled, in drawing
 *  units. Beyond this there is no honest answer and sampleFloor says so
 *  by returning null. */
CsElevation.DEFAULT_TOLERANCE = 10.0;

/**
 * The WALKABLE floor offset below the survey line at a station, from a
 * parsed LRUD Down entry.
 *
 * THE SHALLOWEST reading, where CsProfile uses parseLrudEntry's own
 * `value` (the DEEPEST). This divergence is deliberate and must NOT be
 * "unified" -- the two answer different questions:
 *
 *   - CsProfile draws the passage ENVELOPE. A pit belongs inside it, so
 *     the deepest reading is the right one there.
 *   - A callout labels WHERE A CAVER STANDS. A station reading 2/6 has
 *     walkable floor at 2 with a pit dropping to 6; labelling that spot
 *     at 6 is wrong on a map somebody navigates by.
 *
 * Same shape of intentional asymmetry as CsProfile.classifySplay's
 * plan-versus-elevation dead zone (see its docblock), and the same
 * instruction: do not make them agree.
 *
 * null in, null out. An absent reading is UNKNOWN, not zero. `P` parses
 * to a real 0 and stays 0, meaning the floor is at the survey line --
 * CsLrud.tickEnd already draws that same null-versus-0 distinction and
 * this honours it.
 *
 * \param entry a CsModel.parseLrudEntry result for the Down field
 * \return number, or null when nothing was measured
 */
CsElevation.floorWalkable = function(entry) {
    if (entry === null || entry === undefined) {
        return null;
    }
    if (entry.all !== null && entry.all !== undefined &&
            entry.all.length > 0) {
        var min = entry.all[0];
        for (var i = 1; i < entry.all.length; i++) {
            if (entry.all[i] < min) {
                min = entry.all[i];
            }
        }
        return min;
    }
    if (entry.value === null || entry.value === undefined) {
        return null;
    }
    return entry.value;
};

/**
 * The resolved leg nearest `point`, or null when none is within `tol`.
 *
 * \return {from, to, fraction, distance} -- fraction 0 at `from`, 1 at
 *         `to`, CLAMPED, so a point beyond a leg's end reports that end
 *         rather than extrapolating off into rock.
 */
CsElevation.nearestLeg = function(resolved, point, tol) {
    var best = null;
    var legs = (resolved && resolved.legs) ? resolved.legs : [];

    for (var i = 0; i < legs.length; i++) {
        var leg = legs[i];
        var a = resolved.stations[leg.from];
        var b = resolved.stations[leg.to];
        if (a === undefined || b === undefined) {
            continue;   // a leg whose ends did not resolve is not a leg
        }

        var dx = b.x - a.x;
        var dy = b.y - a.y;
        var len2 = dx * dx + dy * dy;

        var t;
        if (len2 === 0) {
            t = 0.0;    // zero-length leg: the station itself
        } else {
            t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2;
            if (t < 0.0) { t = 0.0; }
            if (t > 1.0) { t = 1.0; }
        }

        var px = a.x + dx * t;
        var py = a.y + dy * t;
        var d = Math.sqrt((point.x - px) * (point.x - px) +
                          (point.y - py) * (point.y - py));

        if (d <= tol && (best === null || d < best.distance)) {
            best = { from: leg.from, to: leg.to, fraction: t, distance: d };
        }
    }
    return best;
};

/**
 * Floor evidence along one leg, in along-passage order.
 *
 * \return {points: [{t, z}] sorted by t, multi: bool}
 *
 * Same shape as the profile's floor run: the endpoints' own LRUD floor
 * points, plus every down-classified splay, each placed by how far along
 * the leg it sits. Interpolating between ADJACENT evidence rather than
 * just between the two stations is what lets a splay into a floor pocket
 * actually change the answer.
 */
CsElevation.floorEvidence = function(survey, resolved, hit, opts) {
    var o = opts || {};
    var tapeMode = o.tapeMode;
    var points = [];
    var multi = false;

    var a = resolved.stations[hit.from];
    var b = resolved.stations[hit.to];
    var legDx = b.x - a.x;
    var legDy = b.y - a.y;
    var legLen2 = legDx * legDx + legDy * legDy;
    var ends = [{ name: hit.from, t: 0.0 }, { name: hit.to, t: 1.0 }];
    var e;

    // --- the endpoints' own LRUD ------------------------------------
    for (e = 0; e < ends.length; e++) {
        var st = resolved.stations[ends[e].name];
        if (st === undefined) {
            continue;
        }
        var lrud = CsModel.lrudForStation(survey, ends[e].name);
        if (lrud === null) {
            continue;
        }
        // lrudForStation hands back already-parsed fields, so rebuild the
        // shape floorWalkable expects.
        var d = CsElevation.floorWalkable({ value: lrud.down,
                                            all: lrud.downAll });
        if (d === null) {
            continue;
        }
        points.push({ t: ends[e].t, z: st.z - d });
        if (lrud.downAll !== null && lrud.downAll !== undefined &&
                lrud.downAll.length > 1) {
            multi = true;
        }
    }

    // --- down splays from either endpoint ---------------------------
    var byStation = CsLrud.splaysByStation(survey);
    for (var k = 0; k < ends.length; k++) {
        var host = resolved.stations[ends[k].name];
        if (host === undefined) {
            continue;
        }
        var sps = byStation[ends[k].name] || [];
        for (var j = 0; j < sps.length; j++) {
            var sp = sps[j];

            // CsTraverse.offset refuses a shot with no distance, no
            // effective azimuth OR no inclination -- a strict superset of
            // "no inclination on record". This is the ONLY correct place
            // to drop an unusable splay: falling through to
            // classifySplay would read it as "flat" and plant a phantom
            // floor point at exactly centreline, which is the
            // fabrication that whole guard exists to stop.
            var off = CsTraverse.offset(sp, tapeMode);
            if (off === null) {
                continue;
            }
            if (CsProfile.classifySplay(sp, o.flatSplayDeg) !== "floor") {
                continue;
            }

            var t;
            if (legLen2 === 0) {
                t = ends[k].t;
            } else {
                t = ends[k].t +
                    ((off.dx * legDx + off.dy * legDy) / legLen2);
                if (t < 0.0) { t = 0.0; }
                if (t > 1.0) { t = 1.0; }
            }
            points.push({ t: t, z: host.z + off.dz });
        }
    }

    points.sort(function(p, q) { return p.t - q.t; });
    return { points: points, multi: multi };
};

/**
 * Linear interpolation over sorted floor evidence.
 *
 * Outside the evidence range the nearest entry's z is returned rather
 * than an extrapolation: past the last measurement the honest answer is
 * "as far as anyone measured, this", not a projected slope nobody saw.
 */
CsElevation.interpolate = function(points, t, fallbackZ) {
    if (points.length === 0) {
        return fallbackZ;
    }
    if (t <= points[0].t) {
        return points[0].z;
    }
    var last = points[points.length - 1];
    if (t >= last.t) {
        return last.z;
    }
    for (var i = 1; i < points.length; i++) {
        var lo = points[i - 1];
        var hi = points[i];
        if (t <= hi.t) {
            var span = hi.t - lo.t;
            if (span === 0) {
                return hi.z;
            }
            return lo.z + (hi.z - lo.z) * ((t - lo.t) / span);
        }
    }
    return last.z;
};

/**
 * Floor elevation at `point`.
 *
 * \param survey   the CsModel survey (LRUD and splay lookup)
 * \param resolved CsNetwork.resolve() result -- {stations, legs, ...}
 * \param point    {x, y} in drawing coordinates
 * \param opts     {tolerance, tapeMode, flatSplayDeg}
 * \return {z, basis: "floor"|"line", from, to, fraction, multi} or null
 *
 * null means NO ANSWER -- no leg within tolerance. The caller must abort
 * and say so; it must never substitute a number.
 *
 * basis "line" means the survey-line elevation is standing in because no
 * floor evidence exists at all. That is a DIFFERENT ANSWER, not a
 * degraded one, and CsCalloutElev renders it differently on purpose. It
 * is NEVER 0: a fabricated zero would rebase an absolute-datum cave,
 * which is this suite's recurring bug family.
 */
CsElevation.sampleFloor = function(survey, resolved, point, opts) {
    var o = opts || {};
    var tol = (o.tolerance === null || o.tolerance === undefined) ?
        CsElevation.DEFAULT_TOLERANCE : o.tolerance;

    var hit = CsElevation.nearestLeg(resolved, point, tol);
    if (hit === null) {
        return null;
    }

    var a = resolved.stations[hit.from];
    var b = resolved.stations[hit.to];
    var lineZ = a.z + (b.z - a.z) * hit.fraction;

    var evidence = CsElevation.floorEvidence(survey, resolved, hit, o);
    if (evidence.points.length === 0) {
        return {
            z: lineZ, basis: CsCallout.BASIS_LINE,
            from: hit.from, to: hit.to, fraction: hit.fraction,
            multi: false
        };
    }

    return {
        z: CsElevation.interpolate(evidence.points, hit.fraction, lineZ),
        basis: CsCallout.BASIS_FLOOR,
        from: hit.from, to: hit.to, fraction: hit.fraction,
        multi: evidence.multi
    };
};
