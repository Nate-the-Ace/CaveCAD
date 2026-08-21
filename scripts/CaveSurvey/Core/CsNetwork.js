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
 *               distance, kind}] misclosure of each closure leg:
 *               computed minus already-known; kind "loop" | "tie"
 *               matches which of the two lists below it landed in
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

    // ---- classify each usable shot as a bridge or a cycle edge ---
    //
    // A closure (both ends already known when the pass loop reaches
    // it) is a genuine LOOP when some path other than the shot itself
    // already connects its two ends -- removing it leaves the survey
    // just as connected. It is a control TIE only when it is the one
    // and only connection between its ends: a graph bridge. This is a
    // property of the raw shot graph alone, worked out once here from
    // ALL usable shots, before any resolution happens -- so it never
    // depends on which order shots resolve in or which station ends
    // up which spanning-tree root. That independence matters: two
    // fixed stations on the SAME ring anchor at two different roots
    // (the pass loop treats each as its own tree), even though the
    // ring is one component throughout, so "did the parent chains
    // meet" is the wrong question -- it is a spanning-forest-root
    // test, not a connectivity test, and the two coincide only when a
    // component has at most one anchor.
    //
    // A whole-graph union-find does not distinguish them either: it
    // would need to include the very shot being asked about, which
    // trivially unions its own endpoints and calls every leg a loop,
    // including a real tie's one connecting shot. The question that
    // actually distinguishes a tie from a loop is "excluding just
    // this shot, are its ends still connected via the others" -- a
    // bridge test, not a reachability test. Rebuilding a small
    // union-find per shot (surveys are not enormous) answers exactly
    // that, and does so correctly even when a ring carries several
    // fixed stations and so produces several closures around it.
    var isBridge = [];
    for (i = 0; i < usable.length; i++) {
        var ufParent = {};
        var ufFind = function(x) {
            var root = x;
            while (ufParent.hasOwnProperty(root) && ufParent[root] !== root) {
                root = ufParent[root];
            }
            while (ufParent.hasOwnProperty(x) && ufParent[x] !== root) {
                var next = ufParent[x];
                ufParent[x] = root;
                x = next;
            }
            return root;
        };
        var ufUnion = function(a, b) {
            var ra = ufFind(a), rb = ufFind(b);
            if (ra !== rb) {
                ufParent[ra] = rb;
            }
        };
        for (var bj = 0; bj < usable.length; bj++) {
            if (bj === i) {
                continue;
            }
            ufUnion(usable[bj].from, usable[bj].to);
        }
        isBridge.push(ufFind(usable[i].from) !== ufFind(usable[i].to));
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

                // A loop closes a ring: some other path already joins
                // its ends, so this shot is not the only connection
                // between them (isBridge[i] false). A control TIE is
                // the opposite -- this shot is the one and only link
                // between two otherwise separate components, the
                // everyday case being a cave with two *fix'ed
                // entrances. A tie has no ring, so a "percent of
                // traverse length" computed for it is meaningless and
                // used to make CsValidate cry blunder over nothing.
                var sameComponent = !isBridge[i];
                mis.kind = sameComponent ? "loop" : "tie";
                closures.push(mis);

                var described = CsNetwork.describeLoop(shot, mis, parent,
                    tapeMode, sameComponent);
                if (sameComponent) {
                    legs.push({ shot: shot, from: shot.from, to: shot.to,
                        kind: "closure" });
                    loops.push(described);
                } else {
                    legs.push({ shot: shot, from: shot.from, to: shot.to,
                        kind: "tie" });
                    ties.push(described);
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
 * Builds the human-facing description of one loop or tie from a
 * closure shot: the path of stations around it, its surveyed length,
 * and the misclosure as a distance and a percentage of that length.
 *
 * \param sameComponent true when the caller's bridge test found this
 *        shot is not the only connection between its ends (a loop);
 *        false for a genuine control tie (a bridge).
 */
CsNetwork.describeLoop = function(shot, misclosure, parent, tapeMode,
        sameComponent) {
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

    // sum leg distances along a chain, up to (not including) index
    // "upto" -- the shared helper for both branches below
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

    var path = [];
    var traverseLength = shot.distance;
    if (meet >= 0) {
        // The chains share a root: a plain single-anchor ring. Walk
        // out from each end only as far as the meeting point.
        for (i = 0; i <= meet; i++) {
            path.push(fromChain[i]);
        }
        for (i = meetTo - 1; i >= 0; i--) {
            path.push(toChain[i]);
        }
        traverseLength += walk(fromChain, meet) + walk(toChain, meetTo);
    } else if (sameComponent) {
        // The chains never meet, yet the bridge test says this shot
        // is not the only link between its ends -- two different
        // fixed stations on the SAME ring, each rooting its own half.
        // The ring still closes; it closes THROUGH the two controls,
        // so the circuit is this shot plus both full chains out to
        // their own anchors.
        path = fromChain.concat(toChain.slice().reverse());
        traverseLength += walk(fromChain, fromChain.length) +
            walk(toChain, toChain.length);
    } else {
        // Genuinely separate components: no ring, report the two
        // endpoints only.
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
