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
 * and CsProfile.legBetween's kind filter (Task 3) MUST stay identical.
 * They are written to agree BY STATEMENT, not by luck (Task 2's review
 * flagged that the earlier draft only agreed incidentally) -- both
 * exclude exactly "closure" (and, belt-and-braces, a splay shot,
 * which resolve() never actually emits as a leg). If either filter
 * ever changes without the other, a chain step this graph offers
 * becomes one legBetween cannot resolve, and the band search stops
 * dead at it with no error, just a short band.
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
 * TWO PHASES, not one ranked pass. Phase 1 assigns parents using ONLY
 * "new" legs (a measured placement fact -- the directional seq test is
 * safe here) and breaks any cycle it finds among them; a cycle in
 * phase 1 is genuine, because every edge involved really did place a
 * station. Phase 2 then lets a run still parentless after phase 1 use
 * its closure/tie contacts to fill the gap, but skips any candidate
 * that is already a descendant of this run -- an ordinary loop (a
 * spur closing a ring back onto its own trunk) is the everyday case
 * this guards: the spur already has the trunk as parent from phase 1,
 * so the trunk seeing the SAME closure from its own side must not
 * also claim the spur as ITS parent. A skipped candidate creates no
 * parent, no cycle, and no secondTie -- it is the same physical
 * junction the descendant already reported from its own side, and
 * reporting it twice would not be new information. This is why an
 * ordinary loop-closing survey reports an EMPTY `cycles` -- only a
 * loop made entirely of "new" legs (phase 1) is a real ambiguity;
 * every closure/tie ambiguity has an escape hatch (skip and let the
 * other side keep it) that a "new"-leg loop does not.
 *
 * The name-derived tie (CsProfile.tieNameOfRun) is used only as a
 * cross-check -- when the two disagree the graph wins, because it is
 * the measured fact, and the disagreement is reported as a likely
 * naming blunder. That check runs even when the graph found NO
 * contact at all, in either phase: a named spur with zero contacts
 * still had a name asserting a tie, and reporting nothing there would
 * hide the single most suspicious state this function can produce.
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
 *   orphans:    [runKey] runs with no determinable parent in EITHER
 *               phase (a genuinely disconnected component),
 *   cycles:     [[runKey, ...]] any loop found among phase-1 ("new"-leg)
 *               parents and broken -- see the phase-1 cycle-breaking
 *               pass below. Empty for an ordinary closure/tie loop,
 *               which phase 2 resolves without ever needing to detect
 *               a cycle at all
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

    // Per run, split contacts into two lists by leg kind. Each list is
    // already in ascending seq (leg-index) order because contactLegs
    // itself is iterated in that order and entries are only ever
    // appended, never reordered -- but each is sorted explicitly below
    // anyway, so the guarantee does not quietly depend on that staying
    // true. seq is a leg's unique index and one leg contributes at most
    // one entry to a given run's list (both endpoints in this run is
    // skipped below), so within a list this can never tie for distinct
    // entries.
    var rank0ByRun = {}, rank1ByRun = {};
    for (i = 0; i < grouped.order.length; i++) {
        var key = grouped.order[i];
        var stations = grouped.runs[key].stations;
        var inRun = {};
        for (k = 0; k < stations.length; k++) {
            inRun[stations[k]] = true;
        }
        var r0 = [], r1 = [];
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
            if (cg.kind === "new") {
                // A "new" leg's smaller-seq end genuinely is the parent
                // side -- that is also what makes a backwards-entered
                // spur (A2a1->A2) resolve correctly.
                if (seqOf(other) >= seqOf(mine)) {
                    continue;
                }
                r0.push({ station: other, otherRun: otherRun, seq: cg.seq });
            } else {
                // "closure"/"tie": both ends were already placed by the
                // time this leg was walked, so seq says nothing about
                // parentage -- and a *fix'ed station is SEEDED before
                // any traversal at all (CsNetwork.seedFixed), so its
                // seq can be artificially tiny despite the survey
                // reaching it, graph-wise, very late. Kept, unfiltered,
                // as a rank-1 candidate for phase 2 below -- never used
                // to assign a phase-1 parent.
                r1.push({ station: other, otherRun: otherRun, seq: cg.seq });
            }
        }
        r0.sort(function(a, b) { return a.seq - b.seq; });
        r1.sort(function(a, b) { return a.seq - b.seq; });
        rank0ByRun[key] = r0;
        rank1ByRun[key] = r1;
    }

    // ---- Phase 1: parents from "new" legs only ---------------------
    //
    // This is the only source of a PRIMARY tie: a "new" leg is the leg
    // that actually placed a station, so its direction is a measured
    // fact. Multiple qualifying "new" contacts for the same run are
    // rare but possible; the earliest becomes the tie, the rest become
    // ordinary secondTies.
    for (i = 0; i < grouped.order.length; i++) {
        var p1Key = grouped.order[i];
        var p1r0 = rank0ByRun[p1Key];
        if (p1r0.length === 0) {
            parents[p1Key] = null;
            ties[p1Key] = null;
        } else {
            parents[p1Key] = p1r0[0].otherRun;
            ties[p1Key] = p1r0[0].station;
            var seen0 = {};
            seen0[p1r0[0].station] = true;
            for (k = 1; k < p1r0.length; k++) {
                var st0 = p1r0[k].station;
                if (seen0.hasOwnProperty(st0)) {
                    continue;   // same junction reached twice, not a second tie
                }
                seen0[st0] = true;
                secondTies.push({
                    run: p1Key,
                    station: st0,
                    otherRun: p1r0[k].otherRun
                });
            }
        }
    }

    // ---- break any cycle among phase-1 (new-leg-only) parents -------
    //
    // Each run has at most one parent, so `parents` is a functional
    // graph: walking parent pointers from any run either reaches a
    // null-parent root, or loops back on itself. A loop here is genuine
    // -- every edge involved is a "new" leg, a measured placement fact
    // -- unlike a closure/tie edge, which phase 1 never sees at all. A
    // side passage renumbered back into the trunk (A1..A3, B1-B2,
    // A4-A5, every leg "new") is exactly this: each run's own contact
    // list independently and correctly picks a "new" edge to the
    // other, and only walking the parent chain afterward finds the
    // resulting cycle.
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

    // ---- Phase 2: closure/tie legs fill remaining gaps only ---------
    //
    // A run still parentless after phase 1 gets ONE more chance: its
    // closure/tie contacts, in seq order, become candidate parents --
    // but a candidate is skipped when it is ALREADY a descendant of
    // this run, because that is the SAME physical junction the
    // descendant already reported from its own side (an ordinary
    // trunk-with-a-spur-that-closes-a-loop is the everyday case: the
    // spur's "new" leg already gives it the trunk as parent in phase 1,
    // so the trunk seeing the SAME closure from its own side must not
    // also claim the spur as ITS parent). A skipped candidate creates
    // no parent, no cycle, and no secondTie -- reporting it again would
    // describe one physical junction twice.
    //
    // Processed from the LATEST-anchored run back to the earliest --
    // the reverse of grouped.order, which is itself ordered by each
    // run's earliest station (see earliestSeqOfRun). This lets a run
    // whose entire connection to an already-established run is a
    // single closure/tie leg (never a "new" one -- e.g. two separately
    // *fixed* components joined only by a tie) claim that connection as
    // ITS parent before the earlier, already-established run gets a
    // chance to see the very same leg from its own side and mistake it
    // for a parent claim of its own: by the time the earlier run is
    // examined, the later one already has it recorded as a live parent,
    // so the descendant check (which reads the CURRENT parents map, not
    // a frozen phase-1 snapshot) correctly recognizes it and skips it.
    var isDescendant = function(ancestorKey, candidateKey) {
        var cur2 = candidateKey;
        var guard = 0;
        while (cur2 !== null && cur2 !== undefined && parents.hasOwnProperty(cur2)) {
            if (cur2 === ancestorKey) {
                return true;
            }
            cur2 = parents[cur2];
            guard++;
            if (guard > grouped.order.length + 1) {
                break;   // parents is acyclic by this point; belt-and-braces
            }
        }
        return false;
    };

    for (i = grouped.order.length - 1; i >= 0; i--) {
        var p2Key = grouped.order[i];
        var p2r1 = rank1ByRun[p2Key];

        if (parents[p2Key] !== null) {
            // Already has a phase-1 parent: its closure/tie contacts
            // are ordinary secondTies, not primary-candidate material.
            var seenHas = {};
            seenHas[ties[p2Key]] = true;
            for (k = 0; k < p2r1.length; k++) {
                var stHas = p2r1[k].station;
                if (seenHas.hasOwnProperty(stHas)) {
                    continue;
                }
                seenHas[stHas] = true;
                secondTies.push({
                    run: p2Key,
                    station: stHas,
                    otherRun: p2r1[k].otherRun
                });
            }
            continue;
        }

        // Still parentless: look for the first closure/tie candidate
        // that is not already a descendant of this run.
        var chosen = null;
        var extras = [];
        for (k = 0; k < p2r1.length; k++) {
            if (isDescendant(p2Key, p2r1[k].otherRun)) {
                continue;
            }
            if (chosen === null) {
                chosen = p2r1[k];
            } else {
                extras.push(p2r1[k]);
            }
        }
        if (chosen !== null) {
            parents[p2Key] = chosen.otherRun;
            ties[p2Key] = chosen.station;
            var seenFill = {};
            seenFill[chosen.station] = true;
            for (k = 0; k < extras.length; k++) {
                var stFill = extras[k].station;
                if (seenFill.hasOwnProperty(stFill)) {
                    continue;
                }
                seenFill[stFill] = true;
                secondTies.push({
                    run: p2Key,
                    station: stFill,
                    otherRun: extras[k].otherRun
                });
            }
        }
    }

    // ---- final pass: orphans and name/graph mismatches --------------
    //
    // Both need the FINAL tie, which phase 2 may have set after phase 1
    // left it null, so this runs only after both phases are done.
    for (i = 0; i < grouped.order.length; i++) {
        var fKey = grouped.order[i];
        if (parents[fKey] === null && i > 0) {
            // the root run (i === 0), or a run in its own disconnected
            // component that no phase found a contact for at all
            orphans.push(fKey);
        }

        // Reachable regardless of whether a contact was found: a named
        // spur (expected !== null) that the graph ties nowhere at all
        // is exactly as much a mismatch as one the graph ties somewhere
        // else -- actual is null in that case, not silently skipped.
        var expected = CsProfile.tieNameOfRun(fKey);
        if (expected !== null && expected !== ties[fKey]) {
            mismatches.push({
                run: fKey,
                expected: expected,
                actual: ties[fKey]
            });
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

/** The numeric value of a station's sequence, or a large number when
 *  it is not numeric -- so lettered sequences sort after numbered. */
CsProfile.seqNumOf = function(name) {
    var s = CsProfile.splitName(name);
    if (s === null || !/^[0-9]+$/.test(s.seq)) {
        return Number.MAX_VALUE;
    }
    return parseInt(s.seq, 10);
};

/**
 * Is `path` a better chain than `best`? Longer wins. Equal length is
 * broken by the LOWEST station sequence in the path, then by the
 * highest -- so A1-A2-A3-A4 beats A9-A2-A3-A4, and A13-A14-A15 beats
 * A13-A14-A99. Still tied (same multiset of sequence extremes), the
 * path's own text breaks it, so two genuinely distinct paths never
 * compare equal.
 *
 * WHY A TIE-BREAK IS REQUIRED, not a nicety: a spur one leg long off
 * an interior station produces an alternative path of EXACTLY the same
 * length as the main chain, so "longest wins" alone leaves the band's
 * contents decided by object iteration order. That is a band that
 * changes shape between runs for no reason the user did anything to.
 *
 * NOT fed to Array.prototype.sort (so CaveCAD's unstable sort is not
 * directly in play here), but the same discipline applies for the same
 * reason: this is called as a boolean "is path better" predicate while
 * walking a deterministic DFS order (run.stations is already sorted by
 * CsProfile.seqOrder, and adjacency lists are built in resolved.legs
 * order -- neither depends on this engine's sort), so as long as no two
 * DISTINCT paths ever both return false against each other here, the
 * winner is independent of which one the walk reaches first. The final
 * `path.join(",") < best.join(",")` branch is what guarantees that: two
 * different station lists never produce equal strings.
 */
CsProfile.betterChain = function(path, best) {
    if (path.length !== best.length) {
        return path.length > best.length;
    }
    if (path.length === 0) {
        return false;
    }
    var stat = function(list) {
        var lo = Number.MAX_VALUE, hi = -1;
        for (var i = 0; i < list.length; i++) {
            var v = CsProfile.seqNumOf(list[i]);
            if (v < lo) { lo = v; }
            if (v > hi) { hi = v; }
        }
        return { lo: lo, hi: hi };
    };
    var a = stat(path), b = stat(best);
    if (a.lo !== b.lo) {
        return a.lo < b.lo;
    }
    if (a.hi !== b.hi) {
        return a.hi < b.hi;
    }
    // Still tied: decide on the station names themselves rather than on
    // which one the walk happened to reach first. Search order is not a
    // property a band's contents should depend on.
    return path.join(",") < best.join(",");
};

/**
 * The longest simple path through one run's own stations.
 *
 * Runs are chains in practice, so an exhaustive depth-first search
 * from every member is affordable and exact -- no heuristic to be
 * wrong about. Cost is bounded by the run's own size, not the survey's,
 * because the walk only ever crosses edges into stations `inRun`.
 *
 * A run graph built from "new"/"tie" edges (CsProfile.adjacency) is a
 * tree in the ordinary case -- any loop-closing shot within one
 * connected component resolves as "closure" and adjacency excludes
 * it -- so this search is linear-ish in practice (each start explores
 * its own tree once). If a run's own members ever did carry an
 * internal cycle through "new"/"tie" edges only, the `visited` guard
 * still stops the walk from looping forever; it can just cost more.
 *
 * MEASURED, not assumed (node, this repo's fixtures' scale plus a
 * synthetic stress run): a straight 300-station chain -- an ordinary
 * run's actual shape -- unrolls in ~10ms; a straight 1000-station chain
 * in ~70ms, whether or not it also carries a one-leg spur off every
 * fifth station (the shape that forces betterChain's tie-break). The
 * cost that actually hurts is BRANCHING, not length: a run gerrymandered
 * into a balanced binary tree instead of a chain -- not how real spurs
 * get named or promoted, see the file banner -- runs ~156ms at 509
 * stations and ~3.1s at 2045. A real survey run does not take that
 * shape; if one ever does, this is where to look first.
 *
 * \return {chain: [name], omitted: [name]} omitted = run members not
 *         on the chain, in sequence order
 */
CsProfile.longestChain = function(run, resolved) {
    var adj = CsProfile.adjacency(resolved);
    var inRun = {};
    var i;
    for (i = 0; i < run.stations.length; i++) {
        inRun[run.stations[i]] = true;
    }

    var best = [];
    var walk = function(at, visited, path) {
        path.push(at);
        if (CsProfile.betterChain(path, best)) {
            best = path.slice(0);
        }
        var links = adj[at] || [];
        for (var k = 0; k < links.length; k++) {
            var nxt = links[k].other;
            if (!inRun[nxt] || visited[nxt]) {
                continue;
            }
            visited[nxt] = true;
            walk(nxt, visited, path);
            visited[nxt] = false;
        }
        path.pop();
    };
    for (i = 0; i < run.stations.length; i++) {
        var visited = {};
        visited[run.stations[i]] = true;
        walk(run.stations[i], visited, []);
    }

    var onChain = {};
    for (i = 0; i < best.length; i++) {
        onChain[best[i]] = true;
    }
    var omitted = [];
    for (i = 0; i < run.stations.length; i++) {
        if (!onChain[run.stations[i]]) {
            omitted.push(run.stations[i]);
        }
    }

    // orient the chain by sequence: a survey reads from its low
    // numbers outward, so the band should too
    if (best.length >= 2) {
        var a = CsProfile.splitName(best[0]);
        var b = CsProfile.splitName(best[best.length - 1]);
        if (a !== null && b !== null &&
                CsProfile.seqOrder(a.seq, b.seq) > 0) {
            best.reverse();
        }
    }

    return { chain: best, omitted: omitted };
};

/**
 * The leg joining two named stations, or null. FOR INTERIOR CHAIN
 * STEPS ONLY -- see CsProfile.tieLegBetween for the one step (a run's
 * tie into its parent) that this deliberately does not cover.
 *
 * INVARIANT (see CsProfile.adjacency's own docblock): this function's
 * kind filter and adjacency's MUST stay identical, both excluding
 * exactly "closure" (and, belt-and-braces, a splay shot -- resolve()
 * never actually emits one as a leg). The chain walk finds candidate
 * steps through adjacency and resolves each one through this function;
 * if the two filters ever disagreed, a step adjacency offers could
 * become one this cannot resolve, and unrollBand would silently stop
 * the band there instead of erroring.
 */
CsProfile.legBetween = function(a, b, resolved) {
    for (var i = 0; i < resolved.legs.length; i++) {
        var leg = resolved.legs[i];
        if (leg.kind === "closure") {
            continue;
        }
        if (leg.shot !== undefined && leg.shot !== null && leg.shot.splay) {
            continue;
        }
        if ((leg.from === a && leg.to === b) ||
                (leg.from === b && leg.to === a)) {
            return leg;
        }
    }
    return null;
};

/**
 * The leg joining two named stations, closures included -- the TIE
 * STEP's lookup, and deliberately not the same one CsProfile.legBetween
 * gives interior chain steps.
 *
 * WHY THIS IS A DIFFERENT FUNCTION, not a flag on legBetween: a flag
 * that quietly widens a filter is exactly how two filters that are
 * supposed to agree drift apart again -- see the INVARIANT on
 * CsProfile.adjacency and CsProfile.legBetween, which this function is
 * explicitly NOT bound by, and says so by having its own name.
 *
 * legBetween excludes "closure" because ITS caller is the interior
 * chain walk: CsProfile.adjacency only ever OFFERS a step across a
 * "new"/"tie" edge in the first place, so legBetween refusing a closure
 * is resolving a graph that already never proposed one -- there is
 * nothing to disagree about.
 *
 * A run's TIE is not a step the chain walk ever proposes; it comes from
 * CsProfile.hierarchy, which deliberately DOES consider closure and tie
 * legs when deciding where a run attaches -- a run whose only surveyed
 * contact anywhere is a ring-closing shot still has to attach
 * somewhere, and hierarchy's phase 2 exists to let it. Resolving that
 * same edge against a lookup that refuses closures would be the actual
 * inconsistency: the edge was chosen by a graph that admits closures,
 * so it must be resolved by one that does too, or the result is a band
 * that silently stops one station in -- exactly the failure the
 * legBetween/adjacency invariant exists to prevent, just relocated to
 * the one edge that invariant was never about.
 *
 * Geometrically this is sound, not merely permitted: a closure leg is
 * a real surveyed shot with a real length. An extended elevation draws
 * every leg at its own resolved coordinates -- X cumulative along the
 * band, Y each station's own resolved Z -- so a closure leg's
 * misclosure is already absorbed into those coordinates before this
 * function ever sees it, exactly as it is in plan. Drawing it
 * introduces no contradiction.
 */
CsProfile.tieLegBetween = function(a, b, resolved) {
    for (var i = 0; i < resolved.legs.length; i++) {
        var leg = resolved.legs[i];
        if (leg.shot !== undefined && leg.shot !== null && leg.shot.splay) {
            continue;
        }
        if ((leg.from === a && leg.to === b) ||
                (leg.from === b && leg.to === a)) {
            return leg;
        }
    }
    return null;
};

/**
 * Unrolls one run into a band.
 *
 * X advances by each leg's PLAN distance (d * cos inc) and Y is the
 * station's resolved Z, so the drawn leg length is its slope distance
 * and every leg appears at true length. X only ever increases: a
 * passage that doubles back in plan does not double back here, which
 * is what "extended" means.
 *
 * The band OPENS AT ITS TIE STATION, at X = 0, so the leg joining the
 * run to its parent is drawn inside this band. Without that, the tie
 * leg belongs to no band at all and vanishes from the profile.
 *
 * NEVER DEFAULTS A MISSING Z TO 0. A station with no resolved Z ends
 * the band right there (`stopped`), including the tie station itself
 * or the chain's very first member -- `datum` in that case comes back
 * null, not 0, because a fabricated sea-level datum for a cave
 * surveyed to an unrelated absolute datum is exactly the bug class
 * this codebase keeps finding and closing doors on.
 *
 * \param run      one grouped run {key, stations}
 * \param tie      the tie station name, or null for the root run
 * \param resolved CsNetwork.resolve() result
 * \param hier     CsProfile.hierarchy() result (unused today; passed so
 *                 callers need not special-case, and so a future
 *                 orientation rule has it to hand)
 * \param opts     {exaggeration: number (default 1), tapeMode}
 *
 * \return {
 *   key, tie, datum,
 *   stations: [{name, x, y, z}],
 *   legs:     [{shot, from, to, fromX, fromY, toX, toY}],
 *   omitted:  [name] run members off the chain,
 *   stopped:  name | null -- station that ended the band early, either
 *             for having no resolved Z or because a chain step has no
 *             leg to resolve it with (legBetween for an interior step,
 *             CsProfile.tieLegBetween for the tie step -- see that
 *             function for why the tie step alone may see a closure)
 * }
 */
CsProfile.unrollBand = function(run, tie, resolved, hier, opts) {
    opts = opts || {};
    var exag = (opts.exaggeration === undefined ||
        opts.exaggeration === null) ? 1.0 : opts.exaggeration;
    var tapeMode = opts.tapeMode || CsTraverse.SLOPE;

    var found = CsProfile.longestChain(run, resolved);
    var chain = found.chain.slice(0);
    // tied marks which chain INDEX (0, once unshift below runs) is the
    // tie station, so the main loop knows its one step -- to index 1 --
    // is the tie step and must resolve through tieLegBetween, not
    // legBetween: that step's edge came from CsProfile.hierarchy, which
    // admits closures, not from the interior chain walk, which doesn't.
    var tied = false;
    if (tie !== null && tie !== undefined &&
            resolved.stations.hasOwnProperty(tie)) {
        // the chain end nearer the tie leads, so the tie leg is real.
        // tieLegBetween, not legBetween: the tie edge itself may be a
        // closure (see CsProfile.tieLegBetween), and asking legBetween
        // here would misjudge -- or fail to find -- that very edge.
        if (chain.length >= 2 &&
                CsProfile.tieLegBetween(tie, chain[chain.length - 1], resolved) !== null &&
                CsProfile.tieLegBetween(tie, chain[0], resolved) === null) {
            chain.reverse();
        }
        chain.unshift(tie);
        tied = true;
    }

    var zOf = function(name) {
        var st = resolved.stations[name];
        if (st === undefined || st.z === undefined || st.z === null) {
            return null;   // NEVER 0: that would rebase an absolute datum
        }
        return st.z;
    };

    // null, not 0, when the chain is empty OR its first member's Z is
    // unresolved -- either way there is no real elevation to report,
    // and the main loop below stops at chain[0] itself in the second
    // case, so no station ever gets drawn against a fabricated datum.
    var datum = (chain.length > 0) ? zOf(chain[0]) : null;
    var yOf = function(z) {
        return datum + (z - datum) * exag;
    };

    var stations = [], legs = [], stopped = null;
    var x = 0.0;
    for (var i = 0; i < chain.length; i++) {
        var name = chain[i];
        var z = zOf(name);
        if (z === null) {
            stopped = name;
            break;
        }
        if (i > 0) {
            // only the tie step (index 0 -> 1, and only when a tie was
            // actually unshifted on) may resolve through a closure --
            // every interior step keeps legBetween's stricter filter
            var leg = (tied && i === 1)
                ? CsProfile.tieLegBetween(chain[i - 1], name, resolved)
                : CsProfile.legBetween(chain[i - 1], name, resolved);
            if (leg === null) {
                stopped = name;   // chain broken: stop, do not invent a link
                break;
            }
            var o = CsTraverse.offset(leg.shot, tapeMode);
            x += Math.abs(o.plan);
            legs.push({
                shot: leg.shot,
                from: chain[i - 1],
                to: name,
                fromX: stations[stations.length - 1].x,
                fromY: stations[stations.length - 1].y,
                toX: x,
                toY: yOf(z)
            });
        }
        stations.push({ name: name, x: x, y: yOf(z), z: z });
    }

    return {
        key: run.key,
        tie: (tie === undefined) ? null : tie,
        datum: datum,
        stations: stations,
        legs: legs,
        omitted: found.omitted,
        stopped: stopped
    };
};
