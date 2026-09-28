// CsTripPlan.js -- a trip plan: where to go, how, how long, what to carry.
//
// Part of the Cave Survey Core library: pure ES5, no document, no GUI.
//
// THE SURVEY LINE IS NOT A WALKING ROUTE. A crawl, a squeeze, water, a
// climb or a loose section only shows up if somebody wrote it in a note
// or the LRUD is tight. Everything here says "follows the survey line"
// and surfaces the notes and tightness it finds on the way. It never
// claims a route is safe or easy.
//
// A PITCH HAS NO BEARING. A plumb leg carries bearing null and its
// step never prints a heading (docs/vertical-caves.md).
//
// A MISSING z IS null, and null z prints no vertical wording. Never 0.
//
// NO COORDINATES in any output a person reads. Positions are used to
// measure and are not repeated in text or in the packet.
//
// The 'Cs' prefix is mandatory: include() dedupes by basename.

include(includeBasePath + "/CsFrontier.js");
include(includeBasePath + "/CsPitch.js");
include(includeBasePath + "/CsUnits.js");

var CsTripPlan = {};

/** A leg whose plan run is under this fraction of its length is plumb. */
CsTripPlan.PLUMB_FRACTION = 0.05;

/**
 * The survey as an adjacency map over LEGS.
 *
 * \return {station: [{from, to, len, dz, bearing, dx, dy, shot}]} where
 *   len is the straight-line length between the resolved ends (3D when
 *   both ends have a z, plan otherwise), dz is null when either end has
 *   no z, bearing is degrees from north or null for a plumb leg, and
 *   shot is the index into survey.shots (for LRUD lookups)
 */
CsTripPlan.graph = function(survey, resolved) {
    var adj = {};
    if (survey === undefined || survey === null || resolved === undefined ||
            resolved === null || resolved.stations === undefined ||
            resolved.stations === null) {
        return adj;
    }
    var finite = function(v) { return typeof v === "number" && isFinite(v); };
    var add = function(a, b, pa, pb, shotIndex) {
        var dx = pb.x - pa.x;
        var dy = pb.y - pa.y;
        var plan = Math.sqrt(dx * dx + dy * dy);
        var known = finite(pa.z) && finite(pb.z);
        var dz = known ? pb.z - pa.z : null;
        var len = known ? Math.sqrt(plan * plan + dz * dz) : plan;
        var bearing = null;
        if (plan > len * CsTripPlan.PLUMB_FRACTION && plan > 0) {
            bearing = Math.atan2(dx, dy) * 180 / Math.PI;
            if (bearing < 0) { bearing += 360; }
        }
        if (adj[a] === undefined) { adj[a] = []; }
        adj[a].push({ from: a, to: b, len: len, dz: dz, bearing: bearing,
            dx: dx, dy: dy, shot: shotIndex });
    };
    for (var i = 0; i < survey.shots.length; i++) {
        var shot = survey.shots[i];
        if (!CsFrontier.isLeg(shot)) { continue; }
        var a = CsFrontier.clean(shot.from);
        var b = CsFrontier.clean(shot.to);
        var pa = resolved.stations[a];
        var pb = resolved.stations[b];
        if (pa === undefined || pa === null || pb === undefined || pb === null) {
            continue;
        }
        add(a, b, pa, pb, i);
        add(b, a, pb, pa, i);
    }
    return adj;
};

/** Dijkstra from one station. \return {dist, prev} */
CsTripPlan.shortest = function(adj, source) {
    var dist = {};
    var prev = {};
    dist[source] = 0;
    var heap = [[0, source]];
    var push = function(item) {
        heap.push(item);
        var i = heap.length - 1;
        while (i > 0) {
            var p = (i - 1) >> 1;
            if (heap[p][0] <= heap[i][0]) { break; }
            var t = heap[p]; heap[p] = heap[i]; heap[i] = t;
            i = p;
        }
    };
    var pop = function() {
        var top = heap[0];
        var last = heap.pop();
        if (heap.length > 0) {
            heap[0] = last;
            var i = 0;
            for (;;) {
                var l = 2 * i + 1;
                var r = l + 1;
                var m = i;
                if (l < heap.length && heap[l][0] < heap[m][0]) { m = l; }
                if (r < heap.length && heap[r][0] < heap[m][0]) { m = r; }
                if (m === i) { break; }
                var t = heap[m]; heap[m] = heap[i]; heap[i] = t;
                i = m;
            }
        }
        return top;
    };
    while (heap.length > 0) {
        var cur = pop();
        var d = cur[0];
        var u = cur[1];
        if (d > dist[u]) { continue; }
        var edges = adj[u] || [];
        for (var k = 0; k < edges.length; k++) {
            var e = edges[k];
            var nd = d + e.len;
            if (dist[e.to] === undefined || nd < dist[e.to]) {
                dist[e.to] = nd;
                prev[e.to] = e;
                push([nd, e.to]);
            }
        }
    }
    return { dist: dist, prev: prev };
};

/** The edges from the source to target, or null when unreachable. */
CsTripPlan.pathTo = function(sp, target) {
    if (sp.dist[target] === undefined) { return null; }
    var edges = [];
    var at = target;
    var guard = 0;
    while (sp.prev[at] !== undefined && guard++ < 1000000) {
        edges.push(sp.prev[at]);
        at = sp.prev[at].from;
    }
    edges.reverse();
    return edges;
};

/**
 * The order to visit stops, start to start.
 *
 * Up to 8 reachable stops are ordered by exhaustive search (the true
 * minimum round trip); more use nearest-neighbour, which is honest about
 * being an approximation (approximate: true).
 *
 * \return {order: [station], unreachable: [station], roundTrip, approximate}
 */
CsTripPlan.order = function(adj, start, targets) {
    var from = {};
    from[start] = CsTripPlan.shortest(adj, start);
    var reach = [];
    var unreachable = [];
    var seen = {};
    var i;
    for (i = 0; i < targets.length; i++) {
        var t = targets[i];
        if (seen[t] === true || t === start) { continue; }
        seen[t] = true;
        if (from[start].dist[t] === undefined) { unreachable.push(t); }
        else { reach.push(t); }
    }
    for (i = 0; i < reach.length; i++) {
        from[reach[i]] = CsTripPlan.shortest(adj, reach[i]);
    }
    var d = function(a, b) { return from[a].dist[b]; };

    var best = null;
    var bestLen = Infinity;
    var approximate = false;
    if (reach.length <= 8) {
        var perm = function(rest, chain, len, at) {
            if (len >= bestLen) { return; }
            if (rest.length === 0) {
                var total = len + d(at, start);
                if (total < bestLen) { bestLen = total; best = chain.slice(0); }
                return;
            }
            for (var k = 0; k < rest.length; k++) {
                var next = rest[k];
                var left = rest.slice(0, k).concat(rest.slice(k + 1));
                chain.push(next);
                perm(left, chain, len + d(at, next), next);
                chain.pop();
            }
        };
        perm(reach, [], 0, start);
    } else {
        approximate = true;
        var rest = reach.slice(0);
        var at = start;
        best = [];
        bestLen = 0;
        while (rest.length > 0) {
            var pick = 0;
            for (var r = 1; r < rest.length; r++) {
                if (d(at, rest[r]) < d(at, rest[pick])) { pick = r; }
            }
            bestLen += d(at, rest[pick]);
            at = rest[pick];
            best.push(at);
            rest.splice(pick, 1);
        }
        bestLen += d(at, start);
    }
    if (best === null) { best = []; bestLen = 0; }
    return { order: best, unreachable: unreachable, roundTrip: bestLen,
        approximate: approximate };
};

/** 45-degree sector name for a heading. */
CsTripPlan.compass = function(degrees) {
    var names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    return names[Math.round(((degrees % 360) + 360) % 360 / 45) % 8];
};

/** A distance the way a caver would say it: whole units. */
CsTripPlan.dist = function(value, unit) {
    return String(Math.round(value)) + " " + unit;
};

/**
 * Turn-by-turn steps for a list of edges.
 *
 * \param ctx {degree: {station: legs}, notes: {station: [{text}]},
 *             pitchOfEdge: function(edge) -> pitch index or -1, unit}
 * \return [{kind: "walk"|"pitch", from, to, length, dz, vertical:
 *           "up"|"down"|"", heading, edges, atJunction, notes, text}]
 */
CsTripPlan.describe = function(edges, ctx) {
    var unit = ctx.unit === "m" ? "m" : "ft";
    var steps = [];
    var cur = null;
    var flush = function() { if (cur !== null) { steps.push(cur); cur = null; } };
    var isJunction = function(name) { return (ctx.degree[name] || 0) >= 3; };

    for (var i = 0; i < edges.length; i++) {
        var e = edges[i];
        var pitch = ctx.pitchOfEdge(e);
        var kind = pitch >= 0 ? "pitch" : "walk";
        if (cur !== null && (cur.kind !== kind || cur.pitch !== pitch ||
                isJunction(cur.to))) {
            flush();
        }
        if (cur === null) {
            cur = { kind: kind, pitch: pitch, from: e.from, to: e.to,
                length: 0, dz: 0, dzKnown: true, dx: 0, dy: 0, edges: [] };
        }
        cur.to = e.to;
        cur.length += e.len;
        if (e.dz === null) { cur.dzKnown = false; } else { cur.dz += e.dz; }
        cur.dx += e.dx; cur.dy += e.dy;
        cur.edges.push(e);
    }
    flush();

    for (var s = 0; s < steps.length; s++) {
        var st = steps[s];
        st.vertical = "";
        if (st.dzKnown && Math.abs(st.dz) >= 1 && st.kind === "walk") {
            st.vertical = st.dz < 0 ? "down" : "up";
        }
        if (st.kind === "pitch") {
            st.vertical = (st.dzKnown && st.dz > 0) ? "up" : "down";
        }
        st.heading = "";
        if (st.kind === "walk") {
            var plan = Math.sqrt(st.dx * st.dx + st.dy * st.dy);
            if (plan > 0) {
                var b = Math.atan2(st.dx, st.dy) * 180 / Math.PI;
                st.heading = CsTripPlan.compass(b);
            }
        }
        st.atJunction = isJunction(st.to) && s < steps.length - 1;
        st.notes = [];
        var stations = [];
        for (var q = 0; q < st.edges.length; q++) { stations.push(st.edges[q].to); }
        for (var n = 0; n < stations.length; n++) {
            var ns = ctx.notes[stations[n]] || [];
            for (var m = 0; m < ns.length; m++) {
                st.notes.push(stations[n] + ": " + ns[m].text);
            }
        }
        var text = st.from + " to " + st.to + ": ";
        if (st.kind === "pitch") {
            var parts = [];
            for (var p = 0; p < st.edges.length; p++) {
                if (st.edges[p].dz !== null) {
                    parts.push(String(Math.round(Math.abs(st.edges[p].dz))));
                }
            }
            var total = st.dzKnown ? Math.round(Math.abs(st.dz)) : null;
            text += "pitch " + st.vertical + (total === null ? "" :
                " " + total + " " + unit);
            if (parts.length > 1) { text += " (" + parts.join(" + ") + ")"; }
        } else {
            text += CsTripPlan.dist(st.length, unit);
            if (st.heading !== "") { text += " heading " + st.heading; }
            if (st.vertical !== "") {
                text += ", " + st.vertical + " " +
                    Math.round(Math.abs(st.dz)) + " " + unit;
            }
        }
        st.text = text;
        if (st.atJunction && steps[s + 1].kind === "walk" &&
                steps[s + 1].heading !== "") {
            st.text += ". At " + st.to + " (junction) leave by the branch heading " +
                steps[s + 1].heading;
        } else if (st.atJunction) {
            st.text += ". At " + st.to + " (junction) take the next branch as listed";
        }
    }
    return steps;
};
