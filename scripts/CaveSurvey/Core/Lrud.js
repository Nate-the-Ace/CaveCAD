// Lrud.js -- LRUD passage dimensions to wall geometry.
//
// Part of the Cave Survey Core library: pure functions.
//
// L and R are measured facing the direction of travel, at the TO
// station of the shot that recorded them. Right = azimuth + 90,
// Left = azimuth - 90. U and D are vertical and can't be drawn in
// plan; they become a text note.
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
 * Wall polylines for a resolved survey.
 *
 * Walks the legs in resolution order, collecting each side's wall
 * points (LRUD tick ends where measured, the station itself where a
 * side reads 0). A run breaks at a junction station, at a station
 * with no LRUD at all, and at a closure leg -- each break starts a
 * new polyline rather than inventing a connection.
 *
 * \param survey   the CsModel survey (for LRUD lookup per station)
 * \param resolved CsNetwork.resolve() result
 *
 * \return {left: [[{x,y}]], right: [[{x,y}]]} -- arrays of point runs;
 *         runs shorter than 2 points are dropped.
 */
CsLrud.wallRuns = function(survey, resolved) {
    var counts = CsLrud.legCounts(resolved.legs);
    var leftRuns = [], rightRuns = [];
    var left = [], right = [];

    var flush = function() {
        if (left.length >= 2) {
            leftRuns.push(left);
        }
        if (right.length >= 2) {
            rightRuns.push(right);
        }
        left = [];
        right = [];
    };

    var pointFor = function(stationName, side, lrud) {
        var st = resolved.stations[stationName];
        if (st === undefined || lrud === null) {
            return null;
        }
        var len = (side === "L") ? lrud.left : lrud.right;
        if (len === null || len === undefined) {
            return null;
        }
        if (len === 0) {
            return { x: st.x, y: st.y };
        }
        return CsLrud.tickEnd(st, lrud.azimuth, side, len);
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

        if (counts[name] > 2 || lrud === null) {
            // junction or unmeasured station: close out the runs; a
            // junction station's own point still terminates them if
            // it has LRUD
            var lp = pointFor(name, "L", lrud);
            var rp = pointFor(name, "R", lrud);
            if (lp !== null) { left.push(lp); }
            if (rp !== null) { right.push(rp); }
            flush();
            continue;
        }

        var l = pointFor(name, "L", lrud);
        var r = pointFor(name, "R", lrud);
        if (l !== null) { left.push(l); }
        if (r !== null) { right.push(r); }
    }
    flush();

    return { left: leftRuns, right: rightRuns };
};
