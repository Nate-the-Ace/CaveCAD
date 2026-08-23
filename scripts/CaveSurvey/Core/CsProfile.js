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
