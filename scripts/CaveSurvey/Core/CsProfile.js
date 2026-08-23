// CsProfile.js -- the extended elevation: unrolling a survey onto one
// horizontal axis, and the floor and ceiling lines that go with it.
//
// Part of the Cave Survey Core library: pure functions. Nothing here
// touches a document, so the whole module runs under plain node.
//
// AN EXTENDED ELEVATION IS NOT A PROJECTED PROFILE. The horizontal
// axis is distance travelled along the passage, so no passage hides
// behind another and every leg draws at its true length. A projected
// profile -- real coordinates flattened onto one vertical plane -- is
// a different tool and writes to a different layer.
//
// ONE BAND PER SURVEY RUN, and a run is decided by the STATION NAME,
// because that is where the surveyor's own intent already lives. Split
// a name into alternating letter and digit groups; the run key is
// every group but the last, the sequence within the run is the last:
//
//   A20       -> run A,        seq 20
//   A13a1     -> run A13a,     seq 1     (a spur, tying in at A13)
//   A13b1     -> run A13b,     seq 1     (a second spur off A13)
//   A13a2b1   -> run A13a2b,   seq 1     (a spur off a spur)
//   B1        -> run B,        seq 1
//
// A lowercase group means a spur, and dropping it gives the station it
// ties to. A spur long enough to deserve promotion becomes its own
// letter run (B1, B2, ...) -- the surveyor's decision, made by typing
// a name. THERE IS NO LENGTH THRESHOLD ANYWHERE IN THIS FILE.
//
// Names decide MEMBERSHIP; the shot GRAPH decides ORDER. A run's
// parent is the run owning the station its first leg ties to. That is
// what makes A13a1 and B1 behave identically -- A13a lands under A
// because its tie station is A13, not because its name looks nested.

var CsProfile = {};

/**
 * Splits a station name into {base, seq} on its trailing group of
 * like characters. Returns null for anything that is not a station
 * name: empty, null, or a splay (which carries a dot).
 *
 * A name with only one group (e.g. "A", "12") has no trailing group to
 * peel off, so the WHOLE name becomes the base and the sequence comes
 * back empty -- it still JOINS the run its base names ("A" joins run
 * "A" alongside "A1", "A2", ...), it does not become a separate run
 * of its own. It is that run's ORIGIN, though, not just another
 * member: seqOrder (below) sorts an empty sequence ahead of every
 * numeric one for exactly that reason, so "A" leads "A1, A2, A10"
 * instead of sorting after them.
 */
CsProfile.splitName = function(name) {
    if (name === undefined || name === null) {
        return null;
    }
    var s = String(name);
    if (s === "" || s.indexOf(".") >= 0) {
        return null;   // splays are named A3.1 and are not stations
    }
    // groups of digits, of lowercase, of uppercase, or of anything else
    var groups = s.match(/[0-9]+|[a-z]+|[A-Z]+|[^0-9a-zA-Z]+/g);
    if (groups === null || groups.length === 0) {
        return null;
    }
    if (groups.length === 1) {
        return { base: s, seq: "" };
    }
    var seq = groups[groups.length - 1];
    return { base: s.substring(0, s.length - seq.length), seq: seq };
};

/** The run a station belongs to, or null when the name is not one. */
CsProfile.runKeyOf = function(name) {
    var s = CsProfile.splitName(name);
    return (s === null) ? null : s.base;
};

/**
 * The station a run ties in at, read from its own key: drop a
 * trailing lowercase group. "A13a" -> "A13"; "A13a2b" -> "A13a2".
 * null for a letter run (B, A), which has no name-derived tie and
 * must get its parent from the graph.
 *
 * TAKES A RUN KEY, NOT A STATION NAME -- hence the name. Fed a station
 * name it returns null (no trailing lowercase group), which is the
 * same value that legitimately means "letter run, ask the graph", so
 * the mistake would look like an answer. Read call sites as
 * tieNameOfRun(runKeyOf(name)).
 */
CsProfile.tieNameOfRun = function(runKey) {
    if (runKey === undefined || runKey === null) {
        return null;
    }
    var s = String(runKey);
    var m = s.match(/[a-z]+$/);
    if (m === null) {
        return null;
    }
    var tie = s.substring(0, s.length - m[0].length);
    return (tie === "") ? null : tie;
};

/**
 * Total order for a run's members. NOT a style preference: CaveCAD's
 * own Array.prototype.sort is UNSTABLE (measured -- it scrambled 24
 * elements that an always-0 comparator called equal, where node's
 * stable sort left the same input alone), so two DISTINCT stations
 * this ever ranks as equal would come back in a different order in
 * each engine, and node's stability would hide the bug from
 * `node tests/js_unit.js` completely. Every branch below must
 * therefore end in a real order, never a tie between different inputs.
 *
 * An empty sequence -- the run's origin station, e.g. bare "A" beside
 * "A1", "A2" -- always sorts first. It is where the run starts, not
 * merely a string that happens to precede "1".
 *
 * Numeric sequences compare as numbers, so A10 follows A9. Two
 * sequences that parse to the same number but differ in text (A1 vs
 * A01 -- distinct stations, if a survey really has both) fall back to
 * a text compare instead of reporting them equal.
 *
 * Everything else compares as text.
 */
CsProfile.seqOrder = function(a, b) {
    if (a === "" || b === "") {
        return (a === b) ? 0 : ((a === "") ? -1 : 1);
    }
    var na = /^[0-9]+$/.test(a), nb = /^[0-9]+$/.test(b);
    if (na && nb) {
        var d = parseInt(a, 10) - parseInt(b, 10);
        // equal value, different text ("A1" vs "A01"): order by text, so a
        // zero-padded name and a bare one never depend on sort stability --
        // this engine's sort does not have any
        return (d !== 0) ? d : ((a < b) ? -1 : ((a > b) ? 1 : 0));
    }
    if (na !== nb) {
        return na ? -1 : 1;   // numbered stations before lettered ones
    }
    return (a < b) ? -1 : ((a > b) ? 1 : 0);
};

/**
 * Groups a resolved survey's stations into runs.
 *
 * Every resolved station's .seq is REQUIRED, not optional --
 * CsNetwork.resolve assigns it and CsAdjust preserves it through
 * adjustment. Sorting by it below is not defensive extra credit: this
 * engine's `for...in` property order is not guaranteed to match
 * resolution order at all -- a purely-numeric station name (e.g. "9")
 * is a canonical array index by the language spec and enumerates
 * ahead of every non-numeric key regardless of when it was inserted,
 * even under node -- so skipping the sort silently reorders any run
 * whose stations happen to include one. If .seq were ever missing,
 * `undefined - undefined` is NaN, every comparison reads as "unchanged",
 * and CaveCAD's unstable sort (see seqOrder above) then scrambles run
 * order completely -- so this is written to depend on .seq existing,
 * not to tolerate its absence.
 *
 * \param resolved CsNetwork.resolve() result, or undefined/null for
 *                 no survey resolved yet
 * \return {
 *   runs:  {runKey: {key, stations: [name] in sequence order}},
 *   order: [runKey] in first-appearance order (resolution order),
 *   ungrouped: [name] station names CsProfile.splitName refuses --
 *              empty, null, or dotted (splay) names, NOT simply every
 *              name that looks unusual: "?", "A#", "A1-" all parse
 *              into a run just fine and never land here
 * }
 */
CsProfile.groupRuns = function(resolved) {
    var runs = {}, order = [], ungrouped = [];
    if (resolved === undefined || resolved === null ||
            resolved.stations === undefined || resolved.stations === null) {
        return { runs: runs, order: order, ungrouped: ungrouped };
    }

    var names = [];
    for (var n in resolved.stations) {
        if (resolved.stations.hasOwnProperty(n)) {
            names.push(n);
        }
    }
    // resolution order, so run order follows the survey rather than
    // whatever order the engine hands properties back in -- see the
    // docblock above for why this is not a no-op even when property
    // order happens to already agree
    names.sort(function(a, b) {
        return resolved.stations[a].seq - resolved.stations[b].seq;
    });

    for (var i = 0; i < names.length; i++) {
        var s = CsProfile.splitName(names[i]);
        if (s === null) {
            ungrouped.push(names[i]);
            continue;
        }
        if (!runs.hasOwnProperty(s.base)) {
            runs[s.base] = { key: s.base, stations: [] };
            order.push(s.base);
        }
        // carries the sequence splitName already parsed, so the sort
        // below doesn't re-split every name a second time
        runs[s.base].stations.push({ name: names[i], seq: s.seq });
    }

    for (var k = 0; k < order.length; k++) {
        var members = runs[order[k]].stations;
        members.sort(function(a, b) {
            return CsProfile.seqOrder(a.seq, b.seq);
        });
        var flat = [];
        for (var m = 0; m < members.length; m++) {
            flat.push(members[m].name);
        }
        // ordered by NAME (via its sequence), which is what makes a
        // later chain search and its omitted-station list deterministic.
        // This is NOT the band's unroll order -- a later task derives
        // that from the shot graph, not from how stations are named.
        runs[order[k]].stations = flat;
    }

    return { runs: runs, order: order, ungrouped: ungrouped };
};

/**
 * Station -> the legs that touch it, closures and splays excluded.
 * THE WALKED-CHAIN GRAPH: its consumer is the chain search that lays
 * out a band (CsProfile.longestChain), which resolves each step through
 * CsProfile.legBetween -- and that skips closures. Letting a closure in
 * here would let a chain include a step legBetween cannot resolve, and
 * the band would stop at it.
 *
 * INVARIANT: this function's kind filter (closures out, "new"/"tie" in)
 * and CsProfile.legBetween's kind filter (Task 5) MUST stay identical.
 * They agree today only because both happen to skip exactly "closure" --
 * if either one's filter changes without the other, a chain step this
 * graph offers becomes one legBetween cannot resolve, and the band
 * search stops dead at it with no error, just a short band.
 *
 * Run hierarchy does NOT use this graph; it builds its own from
 * resolved.legs, closures included, because a second contact through a
 * ring is exactly the thing it has to report. See hierarchy().
 *
 * \return {stationName: [{leg, other, seq}]} seq = leg index, so
 *         "which contact came first" is answerable
 */
CsProfile.adjacency = function(resolved) {
    var adj = {};
    if (resolved === undefined || resolved === null ||
            resolved.legs === undefined || resolved.legs === null) {
        return adj;   // same empty-input tolerance as groupRuns()
    }
    var add = function(at, other, leg, seq) {
        if (!adj.hasOwnProperty(at)) {
            adj[at] = [];
        }
        adj[at].push({ leg: leg, other: other, seq: seq });
    };
    for (var i = 0; i < resolved.legs.length; i++) {
        var leg = resolved.legs[i];
        if (leg.kind === "closure") {
            continue;
        }
        // Belt-and-braces: CsNetwork.resolve routes splay shots to
        // `skipped` and never emits a splay leg at all, so this branch
        // has no live case today. Kept so a future change to resolve()
        // can't silently let a splay leg into the walked-chain graph.
        if (leg.shot !== undefined && leg.shot !== null && leg.shot.splay) {
            continue;
        }
        add(leg.from, leg.to, leg, i);
        add(leg.to, leg.from, leg, i);
    }
    return adj;
};

/**
 * Which run each run hangs off, where it ties in, and what order the
 * bands go in.
 *
 * The parent is decided by the GRAPH, not simply by "earliest seq" --
 * see the per-kind ranking below, RANK before SEQ, for why raw seq
 * alone is not safe. The name-derived tie (CsProfile.tieNameOfRun) is
 * used only as a cross-check -- when the two disagree the graph wins,
 * because it is the measured fact, and the disagreement is reported as
 * a likely naming blunder. That check runs even when the graph found
 * NO contact at all: a named spur with zero contacts still had a name
 * asserting a tie, and reporting nothing there would hide the single
 * most suspicious state this function can produce.
 *
 * \param grouped CsProfile.groupRuns() result
 * \param resolved CsNetwork.resolve() result
 * \return {
 *   parents:    {runKey: parentRunKey | null},
 *   ties:       {runKey: stationName | null},
 *   order:      [runKey] depth first, siblings by junction distance,
 *   secondTies: [{run, station, otherRun}] further contacts -- otherRun
 *               is simply the run TOUCHED at that second station, not
 *               necessarily this run's parent (the parent can lie in a
 *               third run while a second contact lands in yet another),
 *   mismatches: [{run, expected, actual}] name vs graph; actual is null
 *               when the graph found no contact at all,
 *   orphans:    [runKey] runs with no determinable parent,
 *   cycles:     [[runKey, ...]] any loop found in the parent map and
 *               broken -- see the cycle-breaking pass below
 * }
 */
CsProfile.hierarchy = function(grouped, resolved) {
    if (grouped === undefined || grouped === null ||
            grouped.order === undefined || grouped.order === null ||
            resolved === undefined || resolved === null ||
            resolved.legs === undefined || resolved.legs === null ||
            resolved.stations === undefined || resolved.stations === null) {
        // Same empty-input tolerance as groupRuns(): a caller can hand
        // this an unresolved/empty survey and get the all-empty shape
        // back rather than a TypeError -- the first stage of this
        // pipeline (groupRuns) already tolerates that, and the next two
        // stages should not be the ones that crash on it.
        return { parents: {}, ties: {}, order: [], secondTies: [],
            mismatches: [], orphans: [], cycles: [] };
    }

    var parents = {}, ties = {}, secondTies = [], mismatches = [];
    var orphans = [];
    var runOf = {};
    var i, k;

    for (i = 0; i < grouped.order.length; i++) {
        var run = grouped.runs[grouped.order[i]];
        for (k = 0; k < run.stations.length; k++) {
            runOf[run.stations[k]] = run.key;
        }
    }

    // CONTACTS USE A DIFFERENT GRAPH FROM adjacency(), deliberately.
    // Closure and tie legs count here: a closure is a real surveyed
    // shot, and a run that touches its parent a second time through a
    // ring (B1-A4 closing B1-A3-A4) has to be able to report that
    // second contact -- excluded, secondTies can never populate at all.
    // adjacency() stays closure-free because ITS consumer is the chain
    // search, which resolves each step through CsProfile.legBetween --
    // and that skips closures too, so a chain routed through a leg
    // legBetween cannot find would truncate its own band.
    var contactLegs = [];
    for (i = 0; i < resolved.legs.length; i++) {
        var cl = resolved.legs[i];
        // Belt-and-braces, same as adjacency(): resolve() never emits a
        // splay leg, so this branch has no live case today.
        if (cl.shot !== undefined && cl.shot !== null && cl.shot.splay) {
            continue;
        }
        contactLegs.push({ from: cl.from, to: cl.to, kind: cl.kind, seq: i });
    }

    var seqOf = function(name) {
        var st = resolved.stations[name];
        return (st === undefined || st === null || st.seq === undefined ||
            st.seq === null) ? Number.MAX_VALUE : st.seq;
    };

    // The earliest (smallest-seq) station in each run -- used only to
    // break a cycle in the parent map, below. Computed once here
    // because it depends solely on run membership, not on contacts.
    var earliestSeqOfRun = {};
    for (i = 0; i < grouped.order.length; i++) {
        var erKey = grouped.order[i];
        var erStations = grouped.runs[erKey].stations;
        var erMin = Number.MAX_VALUE;
        for (k = 0; k < erStations.length; k++) {
            var erSeq = seqOf(erStations[k]);
            if (erSeq < erMin) {
                erMin = erSeq;
            }
        }
        earliestSeqOfRun[erKey] = erMin;
    }

    for (i = 0; i < grouped.order.length; i++) {
        var key = grouped.order[i];
        var stations = grouped.runs[key].stations;
        var inRun = {};
        for (k = 0; k < stations.length; k++) {
            inRun[stations[k]] = true;
        }
        var contacts = [];
        for (k = 0; k < contactLegs.length; k++) {
            var cg = contactLegs[k];
            var mine = null, other = null;
            if (inRun[cg.from] === true) {
                mine = cg.from;
                other = cg.to;
            } else if (inRun[cg.to] === true) {
                mine = cg.to;
                other = cg.from;
            } else {
                continue;
            }
            var otherRun = runOf[other];
            if (otherRun === undefined || otherRun === key) {
                continue;
            }
            // RANK BEFORE SEQ. A "new" leg's smaller-seq end genuinely
            // is the parent side -- that is also what makes a
            // backwards-entered spur (A2a1->A2) resolve correctly, so
            // it is kept exactly as before. But a "closure" or "tie"
            // leg connects two stations that were BOTH already placed
            // by the time it was walked, so seq says nothing about
            // parentage there -- and worse, a *fix'ed station is
            // SEEDED before any traversal at all (CsNetwork.seedFixed),
            // so its seq can be artificially tiny despite the survey
            // reaching it, graph-wise, very late. Applying the "new"
            // leg's directional rule to a closure/tie leg is exactly
            // what let a fixed entrance's seed-time seq masquerade as
            // "this run already existed," corrupting the whole
            // hierarchy on real two-entrance surveys. So a closure/tie
            // leg is kept as a candidate in EITHER direction, but
            // ranked after every "new" contact (rank 1 vs rank 0) --
            // it only wins when nothing better ties this run in, and a
            // symmetric candidate on both sides of such a leg is
            // exactly what the cycle-breaking pass below exists to
            // resolve.
            var rank;
            if (cg.kind === "new") {
                if (seqOf(other) >= seqOf(mine)) {
                    continue;
                }
                rank = 0;
            } else {
                rank = 1;
            }
            contacts.push({
                station: other,
                otherRun: otherRun,
                rank: rank,
                seq: cg.seq
            });
        }
        // (rank, seq) is a total order: rank is 0 or 1, and within a
        // rank, seq is the leg's index in resolved.legs -- unique per
        // leg, and one leg cannot contribute two contacts to the same
        // run (both endpoints in this run is skipped above) -- so this
        // comparator can never return 0 for distinct entries, which is
        // required of every comparator here: this engine's sort is not
        // stable.
        contacts.sort(function(a, b) {
            if (a.rank !== b.rank) {
                return a.rank - b.rank;
            }
            return a.seq - b.seq;
        });

        var expected = CsProfile.tieNameOfRun(key);

        if (contacts.length === 0) {
            // the root run, or a run in its own disconnected component
            parents[key] = null;
            ties[key] = null;
            if (i > 0) {
                orphans.push(key);
            }
        } else {
            parents[key] = contacts[0].otherRun;
            ties[key] = contacts[0].station;
            // Dedupe against every station already emitted for this
            // run, not just contacts[0]'s -- a junction reached a THIRD
            // time (two different closure legs both landing back on
            // the same station) is still only one second contact worth
            // reporting, not two identical rows.
            var seenStation = {};
            seenStation[contacts[0].station] = true;
            for (k = 1; k < contacts.length; k++) {
                var stK = contacts[k].station;
                if (seenStation.hasOwnProperty(stK)) {
                    continue;
                }
                seenStation[stK] = true;
                secondTies.push({
                    run: key,
                    station: stK,
                    otherRun: contacts[k].otherRun
                });
            }
        }

        // Reachable regardless of whether a contact was found: a named
        // spur (expected !== null) that the graph ties nowhere at all
        // is exactly as much a mismatch as one the graph ties somewhere
        // else -- actual is null in that case, not silently skipped.
        if (expected !== null && expected !== ties[key]) {
            mismatches.push({
                run: key,
                expected: expected,
                actual: ties[key]
            });
        }
    }

    // ---- break any cycle in the parent map -----------------------
    //
    // Each run has at most one parent, so `parents` is a functional
    // graph: walking parent pointers from any run either reaches a
    // null-parent root, or loops back on itself. A loop is possible
    // even after the per-kind ranking above -- two runs can each pick
    // a DIFFERENT qualifying edge to the other (a fixed-entrance ring
    // where each side's own best contact points at the other; a side
    // passage renumbered back into the trunk, where each run's own
    // "new"-leg contact happens to point at the other run), each edge
    // locally legitimate, together forming a cycle no single run's own
    // contact list could ever reveal.
    //
    // The loop member whose EARLIEST station (by resolution .seq) is
    // smallest becomes the root: it is the one that was on the ground
    // first, so its claim to being upstream of the rest of the loop is
    // at least as good as any other member's. Its own discarded
    // parent/tie is not thrown away -- it becomes a secondTie, so the
    // graph fact it carried is demoted, not deleted.
    var cycles = [];
    var settled = {};
    var breakCycle = function(members) {
        var electedRoot = members[0];
        var bestSeq = earliestSeqOfRun[electedRoot];
        for (var m = 1; m < members.length; m++) {
            var s = earliestSeqOfRun[members[m]];
            if (s < bestSeq) {
                bestSeq = s;
                electedRoot = members[m];
            }
        }
        var discardedParent = parents[electedRoot];
        var discardedTie = ties[electedRoot];
        if (discardedTie !== null && discardedTie !== undefined) {
            var already = false;
            for (var si = 0; si < secondTies.length; si++) {
                if (secondTies[si].run === electedRoot &&
                        secondTies[si].station === discardedTie) {
                    already = true;
                    break;
                }
            }
            if (!already) {
                secondTies.push({
                    run: electedRoot,
                    station: discardedTie,
                    otherRun: discardedParent
                });
            }
        }
        parents[electedRoot] = null;
        ties[electedRoot] = null;
    };

    for (i = 0; i < grouped.order.length; i++) {
        var startKey = grouped.order[i];
        if (settled.hasOwnProperty(startKey)) {
            continue;
        }
        var path = [], indexInPath = {};
        var cur = startKey;
        while (true) {
            if (settled.hasOwnProperty(cur)) {
                break;   // walks into an already-settled acyclic chain
            }
            if (indexInPath.hasOwnProperty(cur)) {
                var cycleMembers = path.slice(indexInPath[cur]);
                breakCycle(cycleMembers);
                cycles.push(cycleMembers);
                break;
            }
            indexInPath[cur] = path.length;
            path.push(cur);
            var p = parents[cur];
            if (p === null || p === undefined || !grouped.runs.hasOwnProperty(p)) {
                break;   // reached a root
            }
            cur = p;
        }
        for (var pi = 0; pi < path.length; pi++) {
            settled[path[pi]] = true;
        }
    }

    return {
        parents: parents,
        ties: ties,
        order: CsProfile.bandOrder(grouped, parents, ties, resolved),
        secondTies: secondTies,
        mismatches: mismatches,
        orphans: orphans,
        cycles: cycles
    };
};

/**
 * Depth-first band order. Siblings are ordered by how far along their
 * parent they tie in, measured by the tie station's resolution order
 * (seq) -- along-distance itself is not known until the parent has
 * been unrolled, and seq is monotone along a chain, so it gives the
 * same answer without the circular dependency.
 *
 * A run whose parent never gets placed (a disconnected component) is
 * appended at the end rather than dropped. hierarchy() breaks every
 * cycle in `parents` before calling this, so in normal use `seen`
 * below is belt-and-braces, not a load-bearing path -- but this
 * function is public and can be called directly with a hand-built
 * parents/ties map that DOES still carry an unbroken cycle, and in
 * that case `seen` is what stops the walk from recursing forever, and
 * the unreached-fallback loop is what stops a cyclic parents map from
 * silently emitting an empty order (a pure cycle has no null-parent
 * root, so `roots` alone would be empty and the walk would never run
 * at all).
 */
CsProfile.bandOrder = function(grouped, parents, ties, resolved) {
    var children = {}, roots = [];
    var i, key;

    for (i = 0; i < grouped.order.length; i++) {
        key = grouped.order[i];
        var p = parents[key];
        if (p === null || p === undefined || !grouped.runs.hasOwnProperty(p)) {
            roots.push(key);
            continue;
        }
        if (!children.hasOwnProperty(p)) {
            children[p] = [];
        }
        children[p].push(key);
    }

    var seqOfTie = function(runKey) {
        var t = ties[runKey];
        if (t === null || t === undefined ||
                !resolved.stations.hasOwnProperty(t)) {
            return Number.MAX_VALUE;
        }
        return resolved.stations[t].seq;
    };
    for (key in children) {
        if (children.hasOwnProperty(key)) {
            children[key].sort(function(a, b) {
                var d = seqOfTie(a) - seqOfTie(b);
                if (d !== 0) {
                    return d;
                }
                // two runs leaving the SAME station tie here, and this
                // engine's sort is unstable -- without a second key the
                // band order would differ between runs of the same
                // drawing. Run key is unique, so it ends the tie.
                return (a < b) ? -1 : ((a > b) ? 1 : 0);
            });
        }
    }

    var out = [], seen = {};
    var walk = function(runKey) {
        if (seen.hasOwnProperty(runKey)) {
            return;   // a cycle in the parent map cannot loop us forever
        }
        seen[runKey] = true;
        out.push(runKey);
        var kids = children[runKey] || [];
        for (var c = 0; c < kids.length; c++) {
            walk(kids[c]);
        }
    };
    for (i = 0; i < roots.length; i++) {
        walk(roots[i]);
    }
    // anything unreached (parent cycle, or parent in another component)
    for (i = 0; i < grouped.order.length; i++) {
        if (!seen.hasOwnProperty(grouped.order[i])) {
            walk(grouped.order[i]);
        }
    }
    return out;
};
