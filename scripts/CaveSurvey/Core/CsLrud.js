// Lrud.js -- LRUD passage dimensions to wall geometry.
//
// Part of the Cave Survey Core library: pure functions.
//
// L and R are measured facing the direction of travel, at the TO
// station of the shot that recorded them. Right = azimuth + 90,
// Left = azimuth - 90. U and D are vertical and can't be drawn in
// plan; they become a text note.
//
// SPLAYS COUNT TOO. A splay tip is a measured wall hit -- the same
// kind of fact an LRUD number is, just aimed where the caver pointed
// -- so every splay from a station joins that station's wall points.
// Which side it joins comes from the sign of (splay azimuth - passage
// azimuth); where it sits within the side comes from its along-passage
// projection, so a backward splay lands before the station's LRUD tick
// and a forward one after it, and the wall advances instead of
// zigzagging. A splay lying exactly along the passage axis is on the
// centerline and belongs to neither wall. No steepness filter: a splay
// aimed at the ceiling contributes its (short) plan projection like
// any other, which is what "use every splay" means -- in a dome or a
// pit that pulls the wall in toward the station, and that is the data
// talking.
//
// Walls derived this way are PREVISUALIZATION: straight segments
// between measured points, never curves, because implying wall detail
// between stations that isn't in the data would misrepresent the
// passage (that's also why they belong on an "inferred" layer, drawn
// faint). Junction stations -- three or more non-splay shots meeting
// -- end a wall run rather than guessing across the junction.

var CsLrud = {};

/**
 * Endpoint of one LRUD tick. Returns {x, y} or null when the
 * measurement is null (not taken) or 0 (wall at the station -- the
 * wall point IS the station, but there is no tick to draw).
 *
 * \param side "L" or "R"
 */
CsLrud.tickEnd = function(station, azimuthDeg, side, length) {
    if (length === null || length === undefined || length === 0) {
        return null;
    }
    var perp = (side === "R") ? azimuthDeg + 90.0 : azimuthDeg - 90.0;
    var rad = perp * Math.PI / 180.0;
    return {
        x: station.x + length * Math.sin(rad),
        y: station.y + length * Math.cos(rad)
    };
};

/**
 * How many resolved, drawn legs touch each station -- the junction
 * test. Returns {stationName: count}.
 */
CsLrud.legCounts = function(legs) {
    var counts = {};
    var bump = function(n) {
        counts[n] = (counts[n] || 0) + 1;
    };
    for (var i = 0; i < legs.length; i++) {
        bump(legs[i].from);
        bump(legs[i].to);
    }
    return counts;
};

/**
 * Splays that may become wall points, grouped by their FROM station.
 * A splay kept out of the plot is kept out of the walls as well --
 * CsDraw does not draw its ray, and a wall must never be built from
 * geometry the map doesn't show.
 *
 * \return {stationName: [shot]} in survey order.
 */
CsLrud.splaysByStation = function(survey) {
    var map = {};
    for (var i = 0; i < survey.shots.length; i++) {
        var s = survey.shots[i];
        if (!s.splay || s.excludeFromAll || s.excludeFromPlot) {
            continue;
        }
        if (s.from === "") {
            continue;
        }
        if (!map.hasOwnProperty(s.from)) {
            map[s.from] = [];
        }
        map[s.from].push(s);
    }
    return map;
};

/** Signed angle from a to b in degrees, normalized to (-180, 180]. */
CsLrud.relativeBearing = function(a, b) {
    var d = (b - a) % 360.0;
    if (d <= -180.0) {
        d += 360.0;
    } else if (d > 180.0) {
        d -= 360.0;
    }
    return d;
};

/**
 * One station's wall points on one side, in along-passage order.
 *
 * The station's LRUD tick (where measured) and every splay that falls
 * on this side, sorted by how far along the passage direction each
 * one sits. Ties keep their input order, LRUD tick first.
 *
 * \param st        resolved station {x, y}
 * \param passageAz azimuth of the leg that reached the station (deg)
 * \param lrud      CsModel.lrudForStation result, or null
 * \param splays    [shot] from this station, or undefined
 * \param side      "L" or "R"
 * \param tapeMode  CsTraverse.SLOPE (default) or HORIZONTAL
 * \param stats     optional {skipped: n} accumulator: bumped once per
 *                  splay this call could not place (see below) so a
 *                  caller can report the gap instead of it vanishing
 *                  silently into an empty return
 *
 * \return [{x, y}] -- possibly empty
 */
CsLrud.stationWallPoints = function(st, passageAz, lrud, splays, side,
        tapeMode, stats) {
    var entries = [];

    if (lrud !== null && lrud !== undefined) {
        var len = (side === "L") ? lrud.left : lrud.right;
        if (len !== null && len !== undefined) {
            // 0 means the wall is AT the station: a wall point, no tick
            var p = (len === 0) ? { x: st.x, y: st.y } :
                CsLrud.tickEnd(st, lrud.azimuth, side, len);
            if (p !== null) {
                // the tick is perpendicular to the passage, so it sits
                // at along-passage 0 and leads its ties
                entries.push({ p: p, t: 0.0, order: -1 });
            }
        }
    }

    if (splays !== undefined && splays !== null) {
        var azRad = passageAz * Math.PI / 180.0;
        var alongX = Math.sin(azRad), alongY = Math.cos(azRad);
        for (var i = 0; i < splays.length; i++) {
            var sp = splays[i];
            var rel = CsLrud.relativeBearing(passageAz,
                CsTraverse.effectiveAzimuth(sp));
            // exactly along the axis: on the centerline, neither wall
            if (rel === 0.0 || rel === 180.0 || rel === -180.0) {
                continue;
            }
            var onRight = (rel > 0.0);
            if ((side === "R") !== onRight) {
                continue;
            }
            var o = CsTraverse.offset(sp, tapeMode);
            if (o === null) {
                // no distance or no inclination/azimuth on record: a
                // wall point at the station would assert "the wall is
                // exactly here" for a measurement nobody took, so this
                // splay contributes NOTHING rather than a fabricated
                // point (see CsTraverse.offset's own docblock -- 0
                // IS a measurement and is never skipped here; this
                // branch is only ever null, absent, non-finite input)
                if (stats !== undefined && stats !== null) {
                    stats.skipped++;
                }
                continue;
            }
            entries.push({
                p: { x: st.x + o.dx, y: st.y + o.dy },
                t: o.dx * alongX + o.dy * alongY,
                order: i
            });
        }
    }

    // stable by along-passage distance -- comparing order on ties
    // rather than trusting the engine's sort to be stable
    entries.sort(function(a, b) {
        if (a.t < b.t) { return -1; }
        if (a.t > b.t) { return 1; }
        return a.order - b.order;
    });

    var out = [];
    for (i = 0; i < entries.length; i++) {
        out.push(entries[i].p);
    }
    return out;
};

/**
 * Wall polylines for a resolved survey.
 *
 * Walks the legs in resolution order, collecting each side's wall
 * points -- the station's LRUD tick end (or the station itself where
 * a side reads 0) plus every splay that hit that side. A run breaks
 * at a junction station, at a station with NO wall evidence at all
 * (neither LRUD nor splays), and at a closure leg -- each break
 * starts a new polyline rather than inventing a connection.
 *
 * \param survey   the CsModel survey (for LRUD and splay lookup)
 * \param resolved CsNetwork.resolve() result
 * \param tapeMode CsTraverse.SLOPE (default) or HORIZONTAL -- how the
 *                 splay tapes are read, matching what CsDraw plots
 *
 * \return {left: [{points:[{x,y}], stations:[name]}],
 *          right: [{points:[{x,y}], stations:[name]}], skipped: n}
 *
 *         Each run pairs its points with the station names it was
 *         built from, IN THE SAME OBJECT -- not two same-indexed arrays
 *         (`points`/`stations` alongside `left`/`right`). A caller that
 *         reads `left[i]` and `stations[i]` has to trust two counters
 *         stay in lockstep across every flush(); a caller that reads
 *         `left[i].stations` cannot get that pairing wrong, because
 *         there is only ever one array to index into. That is the
 *         whole reason this task exists (a `WallRunStations` tag that
 *         quietly stopped matching the run it was written on), so the
 *         return shape is chosen to make the same class of mistake
 *         impossible here, at the one call site that pays for it
 *         (`CsDraw.survey`) and in every test in `tests/js_unit.js`
 *         that reads this return, which is where nearly all of the
 *         cost landed.
 *
 *         `stations` lists the run's OWN arrival stations, in run
 *         order, deduplicated, and only for a station that actually
 *         contributed at least one point on THAT side -- a station
 *         with an LRUD tick on the left but nothing on the right
 *         appears in that run's `left[].stations` and not in the
 *         matching `right` run. Runs shorter than 2 points are dropped
 *         (as before), and `skipped` is unchanged: the count of splays
 *         that had no usable distance/azimuth/inclination and so
 *         contributed no wall point at all.
 */
CsLrud.wallRuns = function(survey, resolved, tapeMode) {
    if (tapeMode === undefined || tapeMode === null) {
        tapeMode = CsTraverse.SLOPE;
    }
    var counts = CsLrud.legCounts(resolved.legs);
    var splays = CsLrud.splaysByStation(survey);
    var leftRuns = [], rightRuns = [];
    var left = [], right = [];
    var leftNames = [], leftSeen = {};
    var rightNames = [], rightSeen = {};
    var stats = { skipped: 0 };

    var flush = function() {
        if (left.length >= 2) {
            leftRuns.push({ points: left, stations: leftNames });
        }
        if (right.length >= 2) {
            rightRuns.push({ points: right, stations: rightNames });
        }
        left = [];
        right = [];
        leftNames = [];
        leftSeen = {};
        rightNames = [];
        rightSeen = {};
    };

    var pointsFor = function(stationName, side, lrud, passageAz) {
        var st = resolved.stations[stationName];
        if (st === undefined) {
            return [];
        }
        return CsLrud.stationWallPoints(st, passageAz, lrud,
            splays[stationName], side, tapeMode, stats);
    };

    // Records `stationName` against the run currently being built, for
    // whichever side just received a point -- the station whose points
    // are being appended is known right here, which is what lets the
    // name and the point travel together instead of being reconciled
    // afterwards.
    var append = function(target, pts, names, seen, stationName) {
        if (pts.length === 0) {
            return;
        }
        for (var k = 0; k < pts.length; k++) {
            target.push(pts[k]);
        }
        if (seen[stationName] !== true) {
            seen[stationName] = true;
            names.push(stationName);
        }
    };

    for (var i = 0; i < resolved.legs.length; i++) {
        var leg = resolved.legs[i];
        if (leg.kind === "closure") {
            flush();
            continue;
        }
        // The leg reached a new station (leg.to for forward legs).
        var name = leg.to;
        var lrud = CsModel.lrudForStation(survey, name);
        // The passage direction at that station: the leg that reached
        // it. Available even where LRUD is not, which is what lets a
        // splay-only station carry walls at all.
        //
        // DECLARED DIVERGENCE FROM CsProfile.bandWallRuns (review
        // minor): if this leg's own azimuth is unusable (no usable
        // reading, no backsight to fall back on), `passageAz` here is
        // `null` or `NaN` -- and unlike CsProfile.bandWallRuns's
        // `hasDir` flag, nothing below guards against it. `azRad =
        // passageAz * Math.PI / 180` then quietly becomes `0` (null
        // coerces) or `NaN` (undefined/NaN propagates), so `alongX`/
        // `alongY` become a wrong-but-finite direction, or NaN. NO
        // COORDINATE is ever wrong from this: every point in
        // `entries` comes from `CsTraverse.offset`/`CsLrud.tickEnd`
        // directly, never from `passageAz`, and the sort's `order`
        // tiebreak is a total order, so a NaN `t` only ever falls back
        // to input order rather than corrupting anything -- the
        // no-NaN-coordinate criterion holds. What breaks is the
        // along-passage ORDERING promise in this function's own
        // docblock, silently, for a leg whose own azimuth cannot be
        // read. Unreachable today (every current writer of a leg's
        // shot supplies a real azimuth), reachable the moment the
        // upstream parser task starts passing one through as absent.
        // Left unguarded rather than adding a second `hasDir`-style
        // fallback here: that is real design work (what SHOULD the
        // order fall back to?) that belongs with whichever task first
        // makes it reachable, not bolted on defensively now.
        var passageAz = CsTraverse.effectiveAzimuth(leg.shot);

        var lp = pointsFor(name, "L", lrud, passageAz);
        var rp = pointsFor(name, "R", lrud, passageAz);

        if (counts[name] > 2 || (lp.length === 0 && rp.length === 0)) {
            // junction, or a station with nothing measured about its
            // walls: close out the runs. A junction station's own
            // points still terminate them.
            append(left, lp, leftNames, leftSeen, name);
            append(right, rp, rightNames, rightSeen, name);
            flush();
            continue;
        }

        append(left, lp, leftNames, leftSeen, name);
        append(right, rp, rightNames, rightSeen, name);
    }
    flush();

    return { left: leftRuns, right: rightRuns, skipped: stats.skipped };
};
