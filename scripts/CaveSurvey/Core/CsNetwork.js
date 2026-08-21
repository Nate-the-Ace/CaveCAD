// Network.js -- resolves a survey's shots into station coordinates,
// finds loops, and measures how well they close.
//
// Part of the Cave Survey Core library: pure functions.
//
// Resolution is by repeated passes over the shot list until nothing
// more resolves, so shots may appear in any order, branches and
// resumed traverses work, and a shot whose TO is already known
// becomes a closure rather than a duplicate station. Both directions
// resolve: a shot can also fix its FROM station from a known TO.
//
// Anchors, in priority order: an explicit anchor passed by the caller
// (e.g. a selected station in the drawing), then any #Fix / *fix
// stations, then the first usable shot's FROM at (0,0,0). If fixed
// points exist for several disconnected components, each component
// anchors on its own fixed point.

var CsNetwork = {};

/**
 * \param survey the CsModel survey
 * \param opts {
 *   tapeMode: CsTraverse mode (default slope),
 *   anchor: {name, x, y, z} to pin one station explicitly
 * }
 *
 * \return {
 *   stations:   {name: {x, y, z, seq}}  seq = resolution order, the
 *               survey order LRUDWalls and labels rely on
 *   legs:       [{shot, from, to, kind}] kind "new" | "closure" | "tie",
 *               in resolution order -- what the drawing draws
 *   closures:   [{shot, atStation, dx, dy, dz, horizontal, vertical,
 *               distance}] misclosure of each closure leg: computed
 *               minus already-known
 *   loops:      [{from, to, path, traverseLength, error, horizontal,
 *               vertical, percent}] one per closure ring, path =
 *               station names around the loop
 *   ties:       the same shape, for legs that join two separately
 *               anchored components -- control ties, not rings, so
 *               they carry no meaningful percent
 *   anchors:    [name] stations placed with no parent, in placement
 *               order: the explicit anchor, the #Fix / *fix seeds, or
 *               the first usable shot's FROM. CsAdjust pins these.
 *   unresolved: [shot] shots whose stations never connected
 *   skipped:    [shot] excluded / splay shots not resolved
 * }
 */
CsNetwork.resolve = function(survey, opts) {
    opts = opts || {};
    var tapeMode = opts.tapeMode || CsTraverse.SLOPE;

    var stations = {};
    var legs = [];
    var closures = [];
    var loops = [];
    var ties = [];
    var anchors = [];
    var skipped = [];
    var seq = 0;

    // parent links for loop path recovery: station -> {prev, shot}
    var parent = {};

    var place = function(name, x, y, z, from) {
        stations[name] = { x: x, y: y, z: z, seq: seq++ };
        parent[name] = from; // null for anchors
        if (from === null || from === undefined) {
            anchors.push(name);
        }
    };

    // ---- pick anchors --------------------------------------------
    var usable = [];
    for (var i = 0; i < survey.shots.length; i++) {
        var s = survey.shots[i];
        if (s.excludeFromAll || s.splay || s.from === "" || s.to === "") {
            skipped.push(s);
        } else {
            usable.push(s);
        }
    }

    if (opts.anchor !== undefined && opts.anchor !== null) {
        place(opts.anchor.name, opts.anchor.x, opts.anchor.y,
            opts.anchor.z || 0.0, null);
    }

    var fixedNames = [];
    for (var fname in survey.fixed) {
        if (survey.fixed.hasOwnProperty(fname)) {
            fixedNames.push(fname);
        }
    }
    // Fixed stations anchor whatever the explicit anchor doesn't.
    // If an explicit anchor exists, fixed stations in ITS component
    // would fight it, so this only seeds stations not yet placed.
    //
    // It seeds EVERY not-yet-placed fixed station, not just one:
    // seeding them one-per-call used to leave every fixed point but
    // the first to be discovered lazily, only once the pass loop got
    // stuck. That is too late when a shot ties two fixed components
    // together -- such a leg can be processed in the very first pass
    // (its FROM end resolves and its TO end is reached in the same
    // pass), before the loop ever gets stuck, so the second fixed
    // point would be reached first as an ordinary "new" station and
    // its known coordinate silently discarded, along with the
    // misclosure against it. Seeding every fixed station up front
    // means a tying leg always finds both ends already known, so it
    // is honestly reported as a closure or tie (see below) instead of
    // quietly overwriting a control point. Re-called (again seeding
    // everything still unplaced) if the pass loop still gets stuck --
    // e.g. when an explicit opts.anchor skipped the up-front call.
    var seedFixed = function() {
        var used = false;
        for (var k = 0; k < fixedNames.length; k++) {
            var fn = fixedNames[k];
            if (!stations.hasOwnProperty(fn)) {
                var f = survey.fixed[fn];
                place(fn, f.x, f.y, f.z || 0.0, null);
                used = true;
            }
        }
        return used;
    };


    if (opts.anchor === undefined || opts.anchor === null) {
        if (!seedFixed() && usable.length > 0) {
            place(usable[0].from, 0.0, 0.0, 0.0, null);
        }
    }

    // ---- resolve by repeated passes ------------------------------
    var resolvedFlags = [];
    for (i = 0; i < usable.length; i++) {
        resolvedFlags.push(false);
    }

    var progress = true;
    while (progress) {
        progress = false;
        for (i = 0; i < usable.length; i++) {
            if (resolvedFlags[i]) {
                continue;
            }
            var shot = usable[i];
            var haveFrom = stations.hasOwnProperty(shot.from);
            var haveTo = stations.hasOwnProperty(shot.to);

            if (!haveFrom && !haveTo) {
                continue;
            }

            resolvedFlags[i] = true;
            progress = true;

            if (haveFrom && haveTo) {
                // closure: both ends already known
                var o = CsTraverse.offset(shot, tapeMode);
                var fromSt = stations[shot.from];
                var toSt = stations[shot.to];
                var mis = {
                    shot: shot,
                    atStation: shot.to,
                    dx: fromSt.x + o.dx - toSt.x,
                    dy: fromSt.y + o.dy - toSt.y,
                    dz: fromSt.z + o.dz - toSt.z
                };
                mis.horizontal = Math.sqrt(mis.dx * mis.dx + mis.dy * mis.dy);
                mis.vertical = Math.abs(mis.dz);
                mis.distance = Math.sqrt(mis.horizontal * mis.horizontal +
                    mis.dz * mis.dz);
                closures.push(mis);

                // A loop is a ring in ONE component: both ends trace
                // back to the same anchor. Two separately anchored
                // components joined by a leg is a control TIE -- a real
                // and useful check against the fixed coordinates, but
                // it has no ring, so a "percent of traverse length"
                // computed for it is meaningless and used to make
                // CsValidate cry blunder over a cave with two fixed
                // entrances.
                var described = CsNetwork.describeLoop(shot, mis, parent,
                    tapeMode);
                if (described.path.length === 2 &&
                        described.traverseLength === shot.distance) {
                    legs.push({ shot: shot, from: shot.from, to: shot.to,
                        kind: "tie" });
                    ties.push(described);
                } else {
                    legs.push({ shot: shot, from: shot.from, to: shot.to,
                        kind: "closure" });
                    loops.push(described);
                }
            } else if (haveFrom) {
                var of = CsTraverse.offset(shot, tapeMode);
                var fs = stations[shot.from];
                place(shot.to, fs.x + of.dx, fs.y + of.dy, fs.z + of.dz,
                    { prev: shot.from, shot: shot });
                legs.push({ shot: shot, from: shot.from, to: shot.to,
                    kind: "new" });
            } else {
                // know TO only: walk the shot backwards
                var ob = CsTraverse.reverseOffset(shot, tapeMode);
                var ts = stations[shot.to];
                place(shot.from, ts.x + ob.dx, ts.y + ob.dy, ts.z + ob.dz,
                    { prev: shot.to, shot: shot });
                legs.push({ shot: shot, from: shot.from, to: shot.to,
                    kind: "new" });
            }
        }

        // a disconnected component with its own fixed point?
        if (!progress) {
            var remaining = false;
            for (i = 0; i < usable.length; i++) {
                if (!resolvedFlags[i]) {
                    remaining = true;
                    break;
                }
            }
            if (remaining && seedFixed()) {
                progress = true;
            }
        }
    }

    var unresolved = [];
    for (i = 0; i < usable.length; i++) {
        if (!resolvedFlags[i]) {
            unresolved.push(usable[i]);
        }
    }

    return {
        stations: stations,
        legs: legs,
        closures: closures,
        loops: loops,
        ties: ties,
        anchors: anchors,
        unresolved: unresolved,
        skipped: skipped
    };
};

/**
 * Builds the human-facing description of one loop from a closure
 * shot: the path of stations around it, its surveyed length, and the
 * misclosure as a distance and a percentage of that length.
 */
CsNetwork.describeLoop = function(shot, misclosure, parent, tapeMode) {
    // Walk both ends' ancestor chains back to their common root, which
    // closes the loop path. Chains are short (a survey's depth), so
    // the simple quadratic meet-finder is fine.
    var chain = function(name) {
        var out = [name];
        var p = parent[name];
        var guard = 0;
        while (p !== null && p !== undefined && guard++ < 100000) {
            out.push(p.prev);
            p = parent[p.prev];
        }
        return out;
    };
    var fromChain = chain(shot.from);
    var toChain = chain(shot.to);

    var toSet = {};
    for (var i = 0; i < toChain.length; i++) {
        toSet[toChain[i]] = i;
    }
    var meet = -1, meetTo = -1;
    for (i = 0; i < fromChain.length; i++) {
        if (toSet.hasOwnProperty(fromChain[i])) {
            meet = i;
            meetTo = toSet[fromChain[i]];
            break;
        }
    }

    var path = [];
    var traverseLength = shot.distance;
    if (meet >= 0) {
        for (i = 0; i <= meet; i++) {
            path.push(fromChain[i]);
        }
        for (i = meetTo - 1; i >= 0; i--) {
            path.push(toChain[i]);
        }
        // sum leg distances around the path
        var walk = function(chainArr, upto) {
            var sum = 0.0;
            for (var k = 0; k < upto; k++) {
                var p = parent[chainArr[k]];
                if (p !== null && p !== undefined) {
                    sum += p.shot.distance;
                }
            }
            return sum;
        };
        traverseLength += walk(fromChain, meet) + walk(toChain, meetTo);
    } else {
        // separately-anchored components meeting: no ring, report the
        // two endpoints only
        path = [shot.from, shot.to];
    }

    var percent = traverseLength > 0 ?
        (misclosure.distance / traverseLength) * 100.0 : 0.0;

    return {
        from: shot.from,
        to: shot.to,
        path: path,
        traverseLength: traverseLength,
        error: misclosure.distance,
        horizontal: misclosure.horizontal,
        vertical: misclosure.vertical,
        percent: percent
    };
};
