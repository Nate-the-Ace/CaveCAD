// Stats.js -- the numbers the title block wants.
//
// Part of the Cave Survey Core library: pure functions.

var CsStats = {};

/**
 * \param survey the CsModel survey
 * \param resolved CsNetwork.resolve() result
 * \return {
 *   surveyedLength   sum of tape lengths of drawn, non-splay shots
 *   planLength       same shots projected to plan
 *   stationCount
 *   shotCount
 *   loopCount
 *   depth            vertical range over resolved stations
 *   highest, lowest  station names at the extremes
 *   worstLoop        the loop with the largest percent error, or null
 * } -- lengths in survey.distanceUnit.
 */
CsStats.compute = function(survey, resolved, tapeMode) {
    var surveyed = 0.0;
    var plan = 0.0;
    var shotCount = 0;

    for (var i = 0; i < survey.shots.length; i++) {
        var s = survey.shots[i];
        if (s.excludeFromAll || s.splay || s.from === "" || s.to === "") {
            continue;
        }
        shotCount++;
        surveyed += s.distance;
        plan += CsTraverse.offset(s, tapeMode).plan;
    }

    var minZ = null, maxZ = null, highest = "", lowest = "";
    var stationCount = 0;
    for (var name in resolved.stations) {
        if (!resolved.stations.hasOwnProperty(name)) {
            continue;
        }
        stationCount++;
        var z = resolved.stations[name].z;
        if (minZ === null || z < minZ) {
            minZ = z;
            lowest = name;
        }
        if (maxZ === null || z > maxZ) {
            maxZ = z;
            highest = name;
        }
    }

    var worstLoop = null;
    for (i = 0; i < resolved.loops.length; i++) {
        if (worstLoop === null || resolved.loops[i].percent > worstLoop.percent) {
            worstLoop = resolved.loops[i];
        }
    }

    return {
        surveyedLength: surveyed,
        planLength: plan,
        stationCount: stationCount,
        shotCount: shotCount,
        loopCount: resolved.loops.length,
        depth: (minZ === null) ? 0.0 : (maxZ - minZ),
        highest: highest,
        lowest: lowest,
        worstLoop: worstLoop
    };
};
