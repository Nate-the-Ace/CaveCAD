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

// ---------------------------------------------------------------------
// Pace, gear, assembly
// ---------------------------------------------------------------------

/**
 * Every number a team may want to change. All in FEET and MINUTES.
 * These are STARTING VALUES for a plan, not measurements: a training
 * trip and an expedition differ, and the team overrides them in the
 * sidecar (settings.pace). Hiking pace (3 mph) is the horizontal default.
 */
CsTripPlan.DEFAULTS = {
    paceFtPerMin: 264,
    descendFtPerMin: 30,
    ascendFtPerMin: 10,
    rigMin: 10,
    rebelayMin: 5,
    leadWorkMin: 20,
    ropeMargin: 0.10,
    rebelaySlackFt: 10,
    tightFt: 3
};

/** Defaults overlaid with the team's values; bad values are ignored. */
CsTripPlan.config = function(overrides) {
    var out = {};
    var o = overrides || {};
    for (var key in CsTripPlan.DEFAULTS) {
        if (!Object.prototype.hasOwnProperty.call(CsTripPlan.DEFAULTS, key)) {
            continue;
        }
        var v = o[key];
        out[key] = (typeof v === "number" && isFinite(v) && v > 0) ? v :
            CsTripPlan.DEFAULTS[key];
    }
    return out;
};

var csTpFeet = function(value, unit) {
    return unit === "m" ? CsUnits.convert(value, "m", "ft") : value;
};

/** Minutes to walk a length given in the survey's unit. */
CsTripPlan.walkMinutes = function(length, unit, cfg) {
    return csTpFeet(length, unit) / cfg.paceFtPerMin;
};

/**
 * Minutes for one step. `inbound` is true on the way in: a descent is
 * rigged then (rig time once), and the way out finds it rigged.
 */
CsTripPlan.stepMinutes = function(step, unit, cfg, inbound) {
    if (step.kind !== "pitch") {
        return CsTripPlan.walkMinutes(step.length, unit, cfg);
    }
    var drop = step.dzKnown ? csTpFeet(Math.abs(step.dz), unit) :
        csTpFeet(step.length, unit);
    var rebelays = Math.max(0, step.edges.length - 1);
    var going = (step.vertical === "down");
    var rate = going ? cfg.descendFtPerMin : cfg.ascendFtPerMin;
    var minutes = drop / rate + rebelays * cfg.rebelayMin;
    if (inbound) { minutes += cfg.rigMin; }
    return minutes;
};

/** One rope line for a pitch: length to pack and how it is made up. */
CsTripPlan.ropeLine = function(pitch, unit, cfg) {
    var slack = unit === "m" ? CsUnits.convert(cfg.rebelaySlackFt, "ft", "m") :
        cfg.rebelaySlackFt;
    var step = unit === "m" ? 5 : 10;
    var want = pitch.drop * (1 + cfg.ropeMargin) + pitch.rebelays * slack;
    var need = Math.ceil(want / step - 1e-9) * step;
    var parts = [];
    for (var i = 0; i < pitch.segments.length; i++) {
        parts.push(String(Math.round(pitch.segments[i].drop)));
    }
    var text = "Pitch " + pitch.top + " to " + pitch.bottom + ": " +
        Math.round(pitch.drop) + " " + unit + " drop";
    if (parts.length > 1) {
        text += " (" + parts.join(" + ") + "), " + pitch.rebelays +
            " rebelay" + (pitch.rebelays === 1 ? "" : "s");
    }
    text += " -- pack " + need + " " + unit + " of rope";
    return { top: pitch.top, bottom: pitch.bottom, need: need, text: text };
};

/** The starting personal kit. A template: the team edits it. */
CsTripPlan.BASE_KIT = ["Helmet", "Primary light", "Two backup lights",
    "Warm layer", "Gloves", "Water and food", "Survey notebook and pencils"];
CsTripPlan.VERTICAL_KIT = ["Harness", "Descender",
    "Ascending system", "Lanyards", "Carabiners", "Rope protectors"];

/**
 * The gear list for the pitches a route crosses.
 *
 * \param pitches CsPitch.find entries on the route (may be [])
 * \param packing the team's packing text from the sidecar, verbatim
 * \return {rope: [line], hardware: [text], kit: [text], packing}
 *
 * Anchor counts are NOT read from the map yet: every pitch says "rig not
 * on map, confirm" rather than inventing a count.
 */
CsTripPlan.gear = function(pitches, unit, cfg, packing) {
    var rope = [];
    var hardware = [];
    for (var i = 0; i < pitches.length; i++) {
        rope.push(CsTripPlan.ropeLine(pitches[i], unit, cfg));
        hardware.push("Pitch " + pitches[i].top + " to " + pitches[i].bottom +
            ": rig not on map, confirm anchors and hangers");
    }
    var kit = CsTripPlan.BASE_KIT.slice(0);
    if (pitches.length > 0) { kit = kit.concat(CsTripPlan.VERTICAL_KIT); }
    return { rope: rope, hardware: hardware, kit: kit,
        packing: (packing === undefined || packing === null) ? "" : String(packing) };
};

/** A warning per station on the path where LRUD says the passage is tight. */
CsTripPlan.tightWarnings = function(survey, edges, unit, cfg) {
    var out = [];
    var limit = unit === "m" ? CsUnits.convert(cfg.tightFt, "ft", "m") : cfg.tightFt;
    var num = function(v) { return typeof v === "number" && isFinite(v) ? v : null; };
    for (var i = 0; i < edges.length; i++) {
        var sh = survey.shots[edges[i].shot];
        if (sh === undefined || sh === null) { continue; }
        var l = num(sh.left), r = num(sh.right), u = num(sh.up), d = num(sh.down);
        var width = (l !== null && r !== null) ? l + r : null;
        var height = (u !== null && d !== null) ? u + d : null;
        var bits = [];
        if (height !== null && height < limit) {
            bits.push("height " + (Math.round(height * 10) / 10) + " " + unit);
        }
        if (width !== null && width < limit) {
            bits.push("width " + (Math.round(width * 10) / 10) + " " + unit);
        }
        if (bits.length > 0) {
            out.push("tight near " + edges[i].to + " (" + bits.join(", ") + ")");
        }
    }
    return out;
};

/**
 * Assemble a plan.
 *
 * \param opts {start, targets: [station], unit, config, packing, notes}
 *   start defaults to the survey's first station. `notes` is
 *   CsStationTable.notesByStation(survey) if the caller has it; it is
 *   computed when omitted.
 * \return {stops: [{station, steps, minutesIn}], back: {steps, minutes},
 *   totals: {lengthIn, lengthAll, minutesIn, minutesWork, minutesOut,
 *   minutesAll, netDrop}, pitches, gear, warnings, unreachable, approximate}
 */
CsTripPlan.build = function(survey, resolved, opts) {
    var o = opts || {};
    var unit = o.unit === "m" ? "m" : "ft";
    var cfg = CsTripPlan.config(o.config);
    var first = CsFrontier.firstLeg(survey);
    var start = (o.start !== undefined && o.start !== "") ? o.start :
        (first === null ? "" : CsFrontier.clean(first.from));
    var adj = CsTripPlan.graph(survey, resolved);
    var warnings = [];
    var plan = { stops: [], back: { steps: [], minutes: 0 }, warnings: warnings,
        unreachable: [], approximate: false, pitches: [],
        totals: { lengthIn: 0, lengthAll: 0, minutesIn: 0, minutesWork: 0,
            minutesOut: 0, minutesAll: 0, netDrop: 0 },
        gear: null, start: start, unit: unit };
    if (start === "" || adj[start] === undefined) {
        warnings.push("The start station is not on the surveyed line.");
        plan.gear = CsTripPlan.gear([], unit, cfg, o.packing);
        return plan;
    }
    var order = CsTripPlan.order(adj, start, o.targets || []);
    plan.unreachable = order.unreachable;
    plan.approximate = order.approximate;
    for (var u = 0; u < order.unreachable.length; u++) {
        warnings.push(order.unreachable[u] + " cannot be reached from " + start +
            " along the surveyed line.");
    }
    if (order.approximate) {
        warnings.push("More than 8 stops: the visiting order is approximate.");
    }

    var pitches = CsPitch.find(survey, resolved);
    var pitchIndex = {};
    var pp;
    for (pp = 0; pp < pitches.length; pp++) {
        for (var s2 = 0; s2 + 1 < pitches[pp].stations.length; s2++) {
            pitchIndex[pitches[pp].stations[s2] + "|" + pitches[pp].stations[s2 + 1]] = pp;
            pitchIndex[pitches[pp].stations[s2 + 1] + "|" + pitches[pp].stations[s2]] = pp;
        }
    }
    var pitchOfEdge = function(e) {
        var i = pitchIndex[e.from + "|" + e.to];
        return i === undefined ? -1 : i;
    };
    var notes = o.notes || CsStationTable.notesByStation(survey);
    var ctx = { degree: CsFrontier.degrees(survey), notes: notes,
        pitchOfEdge: pitchOfEdge, unit: unit };

    var at = start;
    var allEdges = [];
    var used = {};
    var i;
    for (i = 0; i < order.order.length; i++) {
        var target = order.order[i];
        var edges = CsTripPlan.pathTo(CsTripPlan.shortest(adj, at), target);
        var steps = CsTripPlan.describe(edges, ctx);
        var mins = 0;
        for (var k = 0; k < steps.length; k++) {
            steps[k].minutes = CsTripPlan.stepMinutes(steps[k], unit, cfg, true);
            mins += steps[k].minutes;
            if (steps[k].kind === "pitch") { used[steps[k].pitch] = true; }
            plan.totals.lengthIn += steps[k].length;
            if (steps[k].dzKnown) { plan.totals.netDrop -= steps[k].dz; }
        }
        plan.stops.push({ station: target, steps: steps, minutesIn: mins });
        plan.totals.minutesIn += mins;
        plan.totals.minutesWork += cfg.leadWorkMin;
        allEdges = allEdges.concat(edges);
        at = target;
    }
    // The way out: the same route home, walked as a return leg.
    var homeEdges = CsTripPlan.pathTo(CsTripPlan.shortest(adj, at), start) || [];
    var backSteps = CsTripPlan.describe(homeEdges, ctx);
    for (var b = 0; b < backSteps.length; b++) {
        backSteps[b].minutes = CsTripPlan.stepMinutes(backSteps[b], unit, cfg, false);
        plan.back.minutes += backSteps[b].minutes;
        plan.totals.lengthAll += backSteps[b].length;
        if (backSteps[b].kind === "pitch") { used[backSteps[b].pitch] = true; }
    }
    plan.back.steps = backSteps;
    plan.totals.lengthAll += plan.totals.lengthIn;
    plan.totals.minutesOut = plan.back.minutes;
    plan.totals.minutesAll = plan.totals.minutesIn + plan.totals.minutesWork +
        plan.totals.minutesOut;

    var onRoute = [];
    for (var key in used) {
        if (Object.prototype.hasOwnProperty.call(used, key)) {
            onRoute.push(pitches[parseInt(key, 10)]);
        }
    }
    plan.pitches = onRoute;
    plan.gear = CsTripPlan.gear(onRoute, unit, cfg, o.packing);
    var tight = CsTripPlan.tightWarnings(survey, allEdges.concat(homeEdges), unit, cfg);
    var seenTight = {};
    for (var t = 0; t < tight.length; t++) {
        if (seenTight[tight[t]] !== true) { seenTight[tight[t]] = true; warnings.push(tight[t]); }
    }
    return plan;
};
