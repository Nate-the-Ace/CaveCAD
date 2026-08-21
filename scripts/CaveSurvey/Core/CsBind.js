// CsBind.js -- which stations a hand-drawn entity belongs to.
//
// Part of the Cave Survey Core library. The pure half (layer gate,
// suffix stripping, coincidence and box tests, tag encoding) runs
// anywhere, including plain node -- nothing at file scope touches R*.
// The document half (stationIndex, pointsOf, bindEntity, tagEntities,
// adoptable) is QCAD context only and says so on each function.
//
// WHY THIS EXISTS: a rigid revision moves the whole drawing, so traced
// walls follow the survey for free. The NON-RIGID path does not -- it
// erases and redraws the tagged survey geometry and leaves everything
// else exactly where it was, which tears the traced walls off the
// passage they were traced against. Moving them needs an answer to
// "which stations does this entity belong to?", and that answer has to
// be stored on the entity, because the survey it was traced against no
// longer exists once it has been revised.
//
// The binding signal is better than it sounds. CsDraw already draws
// LRUD tips (LRUDName) and splay tips (SplayName) precisely so wall
// tracing can snap to them, so a wall traced by snapping has vertices
// that COINCIDE EXACTLY with tagged geometry. That is an exact answer,
// not a proximity guess -- the guess is only the fallback.

var CsBind = {};

// The two tags, in the shared CaveSurvey property group.
//   LineworkTrip     integer trip id -- the stable per-drawing key.
//                    NOT the date|team fingerprint, which goes stale
//                    the moment a date typo or a team spelling is
//                    corrected. Same choice already made for legs.
//   LineworkStations "A3|A4|A5" -- the stations traced against, in the
//                    same form WallRunStations already uses. Absent
//                    when nothing could be identified.
CsBind.TRIP_TAG = "LineworkTrip";
CsBind.STATIONS_TAG = "LineworkStations";
CsBind.SEPARATOR = "|";

// ---------------------------------------------------------------------
// The layer gate
// ---------------------------------------------------------------------

// Layer name prefixes that are NEVER linework:
//   CTRL-   the suite's own geometry (stations, shots, LRUD, splays,
//           generated wall runs, the aerial basemap). Claiming our own
//           output as the user's tracing would make a revision move it
//           twice -- once by redrawing it, once by "binding" it.
//   TB_     sheet furniture: it belongs to the paper, not the cave.
//
// CsRevise.WORLD_FIXED_LAYERS ("TB_*", "CTRL-AERIAL") is the canonical
// list of what must not move with the cave, and both of its current
// members already fall under the two prefixes above. It is consulted
// as well, when loaded, so that a layer ADDED to that list is honored
// here without a second edit -- but only softly (typeof guard): this
// module's pure half must stay loadable on its own, and the prefixes
// below are enough of a gate by themselves.
CsBind.NEVER_LINEWORK_PREFIXES = ["CTRL-", "TB_"];

/**
 * The single gate deciding what may EVER be tagged or moved as
 * linework. Pure. An unknown or empty layer name is refused: this
 * returning true is a licence to write tags onto an entity and later
 * move it, so the default has to be "no".
 */
CsBind.isLineworkLayer = function(layerName) {
    if (layerName === undefined || layerName === null) {
        return false;
    }
    var name = String(layerName);
    if (name === "") {
        return false;
    }
    for (var i = 0; i < CsBind.NEVER_LINEWORK_PREFIXES.length; i++) {
        var p = CsBind.NEVER_LINEWORK_PREFIXES[i];
        if (name.indexOf(p) === 0) {
            return false;
        }
    }
    // soft: honors a widened WORLD_FIXED_LAYERS without a second edit
    if (typeof CsRevise !== "undefined" &&
            typeof CsRevise.isWorldFixedLayer === "function" &&
            CsRevise.isWorldFixedLayer(name)) {
        return false;
    }
    return true;
};

// ---------------------------------------------------------------------
// Suffix stripping -- the ONE canonical version
// ---------------------------------------------------------------------
//
// These lived inside CsDraw.eraseStations as local helpers (baseOf,
// splayBaseOf). They are lifted here and eraseStations now calls them,
// so the erase rules and the binding index cannot disagree about which
// station "A3.L2" belongs to -- a disagreement that is exactly how a
// tip point gets orphaned by a redraw.

/**
 * "A3.L" / "A3.R" / "A3.L2" / "A3.R3" -> "A3". Anything else is
 * returned unchanged. Pure.
 *
 * The optional trailing digits are the multi-reading LRUD indices
 * CsDraw writes for a side recorded "5/10": the outer wall is ".L",
 * inner ledges are ".L2", ".L3". The old inline version matched only
 * a bare L or R, so a ".L2" tip never reduced to its station.
 */
CsBind.lrudBase = function(tagged) {
    if (tagged === undefined || tagged === null) {
        return "";
    }
    var m = /^(.*)\.([LR]\d*)$/.exec(String(tagged));
    return m === null ? String(tagged) : m[1];
};

/** "A3.2" -> "A3" (splay names are <station>.<n>). Pure. */
CsBind.splayBase = function(tagged) {
    if (tagged === undefined || tagged === null) {
        return "";
    }
    var m = /^(.*)\.(\d+)$/.exec(String(tagged));
    return m === null ? String(tagged) : m[1];
};

/**
 * The station a tagged tip name belongs to, whichever flavour of
 * suffix it carries. Pure. Used when building the station index, where
 * LRUD tips and splay tips arrive mixed together.
 */
CsBind.stationBase = function(tagged) {
    var s = (tagged === undefined || tagged === null) ? "" : String(tagged);
    var lr = CsBind.lrudBase(s);
    if (lr !== s) {
        return lr; // it was an LRUD tip name
    }
    return CsBind.splayBase(s);
};

// ---------------------------------------------------------------------
// Tag encoding -- the "A|B|C" form WallRunStations already uses
// ---------------------------------------------------------------------

/** Names -> "A|B|C". Drops empties, collapses duplicates, keeps first
 *  appearance order. Pure. */
CsBind.encodeStations = function(names) {
    if (names === undefined || names === null) {
        return "";
    }
    var seen = {};
    var out = [];
    for (var i = 0; i < names.length; i++) {
        var n = (names[i] === undefined || names[i] === null) ? "" :
            String(names[i]);
        if (n === "" || seen[n] === true) {
            continue;
        }
        seen[n] = true;
        out.push(n);
    }
    return out.join(CsBind.SEPARATOR);
};

/** "A|B|C" -> names. Pure. NOT trimmed: a station name may legally
 *  contain a space, and trimming would quietly rename it. */
CsBind.decodeStations = function(text) {
    if (text === undefined || text === null) {
        return [];
    }
    var s = String(text);
    if (s === "") {
        return [];
    }
    var parts = s.split(CsBind.SEPARATOR);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
        if (parts[i] !== "") {
            out.push(parts[i]);
        }
    }
    return out;
};

// ---------------------------------------------------------------------
// Coincidence and proximity -- pure geometry over a station index
// ---------------------------------------------------------------------
//
// A station index is simply [{name, x, y}]: station points, LRUD tips
// and splay tips, all with their suffixes already stripped, so several
// entries commonly share a name. Duplicate names collapse on the way
// out.

// Coincidence epsilon as a fraction of the drawing's extent, and the
// floor under it. RELATIVE on purpose: a cave surveyed in metres and
// the same cave in feet must behave identically, which a hard-coded
// "0.001" cannot do. A snapped vertex is bit-identical when drawn and
// only loses a few digits through a DXF round trip, so 1e-6 of the
// extent (0.1 mm across a 100 m drawing) is generous for float noise
// and still far tighter than any two distinct survey features.
CsBind.EPSILON_FRACTION = 1e-6;
CsBind.MIN_EPSILON = 1e-9;
CsBind.FALLBACK_EPSILON = 1e-6; // empty/unmeasurable drawing

// Proximity margin: the box grows by this many times the drawing's own
// typical feature spacing (median nearest-neighbour distance in the
// station index -- see CsBind.marginFor). Also unit-free: the spacing
// scales with the drawing, so metres and feet give the same answer.
CsBind.PROXIMITY_FACTOR = 2.0;
CsBind.MARGIN_SAMPLE_CAP = 300; // nearest-neighbour scan is O(n*m)

/**
 * The station names in stationIndex coinciding with any of points,
 * within epsilon. Pure -- no document access. Order of first
 * appearance; duplicates collapsed.
 */
CsBind.stationsForPoints = function(points, stationIndex, epsilon) {
    var out = [];
    if (points === undefined || points === null ||
            stationIndex === undefined || stationIndex === null) {
        return out;
    }
    var eps = (epsilon === undefined || epsilon === null ||
        !isFinite(epsilon) || epsilon < 0) ? CsBind.FALLBACK_EPSILON : epsilon;
    var seen = {};
    for (var p = 0; p < points.length; p++) {
        var pt = points[p];
        if (pt === undefined || pt === null) {
            continue;
        }
        for (var s = 0; s < stationIndex.length; s++) {
            var st = stationIndex[s];
            if (st === undefined || st === null || !st.name ||
                    seen[st.name] === true) {
                continue;
            }
            if (Math.abs(st.x - pt.x) <= eps && Math.abs(st.y - pt.y) <= eps) {
                seen[st.name] = true;
                out.push(st.name);
            }
        }
    }
    return out;
};

/**
 * The station names whose position falls inside box grown by margin.
 * Pure. box is the plain {minX, minY, maxX, maxY} form (not an RBox)
 * so this stays testable outside QCAD.
 */
CsBind.stationsInBox = function(box, stationIndex, margin) {
    var out = [];
    if (box === undefined || box === null ||
            stationIndex === undefined || stationIndex === null) {
        return out;
    }
    var m = (margin === undefined || margin === null || !isFinite(margin) ||
        margin < 0) ? 0 : margin;
    var minX = box.minX - m, maxX = box.maxX + m;
    var minY = box.minY - m, maxY = box.maxY + m;
    var seen = {};
    for (var i = 0; i < stationIndex.length; i++) {
        var st = stationIndex[i];
        if (st === undefined || st === null || !st.name ||
                seen[st.name] === true) {
            continue;
        }
        if (st.x >= minX && st.x <= maxX && st.y >= minY && st.y <= maxY) {
            seen[st.name] = true;
            out.push(st.name);
        }
    }
    return out;
};

/** The plain box of a list of {x, y}; null when there are none. Pure. */
CsBind.boxOfPoints = function(points) {
    if (points === undefined || points === null || points.length === 0) {
        return null;
    }
    var minX = null, minY = null, maxX = null, maxY = null;
    for (var i = 0; i < points.length; i++) {
        var p = points[i];
        if (p === undefined || p === null || !isFinite(p.x) || !isFinite(p.y)) {
            continue;
        }
        if (minX === null || p.x < minX) { minX = p.x; }
        if (maxX === null || p.x > maxX) { maxX = p.x; }
        if (minY === null || p.y < minY) { minY = p.y; }
        if (maxY === null || p.y > maxY) { maxY = p.y; }
    }
    if (minX === null) {
        return null;
    }
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
};

/**
 * The proximity margin for a drawing, read off the drawing itself:
 * the median nearest-neighbour distance between index points, times
 * PROXIMITY_FACTOR. Pure.
 *
 * WHY not a fraction of the drawing extent: extent says nothing about
 * how far apart the features are. A 5 km cave and a 50 m cave surveyed
 * with the same 10 m shots want the same "near", and the spacing gives
 * it while a percentage of extent does not. The scan is sampled
 * (MARGIN_SAMPLE_CAP) because a big cave's index runs to thousands of
 * points and the honest scan is quadratic.
 */
CsBind.marginFor = function(stationIndex) {
    if (stationIndex === undefined || stationIndex === null ||
            stationIndex.length < 2) {
        return 0;
    }
    var n = stationIndex.length;
    var stride = Math.ceil(n / CsBind.MARGIN_SAMPLE_CAP);
    if (stride < 1) {
        stride = 1;
    }
    var dists = [];
    for (var i = 0; i < n; i += stride) {
        var a = stationIndex[i];
        if (a === undefined || a === null) {
            continue;
        }
        var best = null;
        for (var j = 0; j < n; j++) {
            if (j === i) {
                continue;
            }
            var b = stationIndex[j];
            if (b === undefined || b === null) {
                continue;
            }
            var dx = b.x - a.x, dy = b.y - a.y;
            var d = Math.sqrt(dx * dx + dy * dy);
            // coincident points (a tip drawn AT its station, wall at
            // distance 0) say nothing about spacing
            if (d > 0 && (best === null || d < best)) {
                best = d;
            }
        }
        if (best !== null) {
            dists.push(best);
        }
    }
    if (dists.length === 0) {
        return 0;
    }
    dists.sort(function(x, y) { return x - y; });
    var median = dists[Math.floor(dists.length / 2)];
    return median * CsBind.PROXIMITY_FACTOR;
};

// ---------------------------------------------------------------------
// Document side -- QCAD context only from here down
// ---------------------------------------------------------------------

// Tags that mark an entity as the SUITE's own output rather than the
// user's tracing. The layer gate already keeps us off CTRL-*, but the
// suite also writes to plain feature layers -- note leaders and labels
// on TEXT-NOTES, breakdown on BREAKDOWN, legend rows on LEGEND, the
// basemap image -- and adopting those would have a revision move
// geometry it is about to redraw anyway.
CsBind.SUITE_TAGS = ["Station", "StationLabel", "Shot", "LRUDName",
    "LRUDLine", "LRUDNote", "Splay", "SplayName", "SplayLabel",
    "NoteLabel", "NoteLeader", "WallRun", "WallRunStations",
    "BoundaryId", "LegendRow", "AerialBasemap"];

/** True when the entity carries any suite-generated tag. QCAD only. */
CsBind.isSuiteGeometry = function(entity) {
    for (var i = 0; i < CsBind.SUITE_TAGS.length; i++) {
        if (CsTags.get(entity, CsBind.SUITE_TAGS[i]) !== "") {
            return true;
        }
    }
    return false;
};

/** True when the entity already carries either linework tag. QCAD only. */
CsBind.hasLineworkTags = function(entity) {
    return CsTags.get(entity, CsBind.TRIP_TAG) !== "" ||
        CsTags.get(entity, CsBind.STATIONS_TAG) !== "";
};

/** An entity's layer name, "" when it cannot be read. QCAD only. */
CsBind.layerNameOf = function(doc, entity) {
    try {
        var name = doc.getLayerName(entity.getLayerId());
        return (name === undefined || name === null) ? "" : String(name);
    } catch (e) {
        return "";
    }
};

/**
 * The coincidence epsilon for this drawing, derived from its extent
 * (see EPSILON_FRACTION). QCAD only.
 */
CsBind.epsilonFor = function(doc) {
    var scale = 0;
    try {
        var bb = doc.getBoundingBox();
        if (!isNull(bb)) {
            var lo = bb.getMinimum(), hi = bb.getMaximum();
            scale = Math.max(Math.abs(hi.x - lo.x), Math.abs(hi.y - lo.y));
        }
    } catch (e) {
        scale = 0;
    }
    if (!isFinite(scale) || scale <= 0) {
        return CsBind.FALLBACK_EPSILON;
    }
    var eps = scale * CsBind.EPSILON_FRACTION;
    return eps < CsBind.MIN_EPSILON ? CsBind.MIN_EPSILON : eps;
};

/**
 * One scan of the drawing collecting every point a tracing could have
 * snapped to: station points (Station), LRUD tips (LRUDName) and splay
 * tips (SplayName), suffixes stripped, as [{name, x, y}]. QCAD only.
 *
 * Label entities carrying the same names are deliberately skipped --
 * their position is the text's, offset from the feature, so a vertex
 * never coincides with one.
 */
CsBind.stationIndex = function(doc) {
    if (typeof CsStore !== "undefined") {
        CsStore.ensureLoaded(doc);
    }
    var out = [];
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || typeof e.getPosition !== "function") {
            continue;
        }
        var name = CsTags.get(e, "Station");
        if (name === "") {
            name = CsBind.lrudBase(CsTags.get(e, "LRUDName"));
        }
        if (name === "") {
            name = CsBind.splayBase(CsTags.get(e, "SplayName"));
        }
        if (name === "") {
            continue;
        }
        var pos;
        try {
            pos = e.getPosition();
        } catch (e2) {
            continue;
        }
        if (isNull(pos)) {
            continue;
        }
        out.push({ name: name, x: pos.x, y: pos.y });
    }
    return out;
};

/**
 * The points of an entity that a tracing snap could have landed on:
 * every vertex of a polyline, the insertion point of a block
 * reference, a point's position, the endpoints of a line or arc.
 * QCAD only.
 *
 * NEVER THROWS. An entity type this bridge exposes differently -- or
 * not at all -- returns []. A binding that cannot see an entity's
 * points falls back to proximity, which is a worse answer; a binding
 * that throws takes the whole tagging pass down with it.
 *
 * The accessor order is empirical, probed in this build: there is no
 * getVertices() on anything, polylines answer countVertices() /
 * getVertexAt(), points and block references answer getPosition(),
 * lines and arcs answer getStartPoint() / getEndPoint(), and
 * getEndPoints() exists on everything as the last resort (it returns
 * [] for a block reference, so it cannot replace getPosition).
 */
CsBind.pointsOf = function(entity) {
    var out = [];
    if (entity === undefined || entity === null) {
        return out;
    }
    try {
        if (typeof entity.countVertices === "function" &&
                typeof entity.getVertexAt === "function") {
            var n = entity.countVertices();
            for (var i = 0; i < n; i++) {
                var v = entity.getVertexAt(i);
                if (!isNull(v)) {
                    out.push({ x: v.x, y: v.y });
                }
            }
            if (out.length > 0) {
                return out;
            }
        }
    } catch (e) {
        out = [];
    }
    try {
        if (typeof entity.getPosition === "function") {
            var p = entity.getPosition();
            if (!isNull(p)) {
                return [{ x: p.x, y: p.y }];
            }
        }
    } catch (e2) {
        // fall through
    }
    try {
        if (typeof entity.getStartPoint === "function" &&
                typeof entity.getEndPoint === "function") {
            var s = entity.getStartPoint(), t = entity.getEndPoint();
            if (!isNull(s) && !isNull(t)) {
                return [{ x: s.x, y: s.y }, { x: t.x, y: t.y }];
            }
        }
    } catch (e3) {
        // fall through
    }
    try {
        if (typeof entity.getEndPoints === "function") {
            var eps = entity.getEndPoints();
            var res = [];
            for (var k = 0; k < eps.length; k++) {
                if (!isNull(eps[k])) {
                    res.push({ x: eps[k].x, y: eps[k].y });
                }
            }
            return res;
        }
    } catch (e4) {
        // fall through
    }
    return [];
};

/**
 * The entity's plain {minX, minY, maxX, maxY} box, from its own
 * bounding box where the bridge offers one and from its points
 * otherwise. null when neither is available. QCAD only.
 */
CsBind.boxOf = function(entity, points) {
    try {
        if (typeof entity.getBoundingBox === "function") {
            var bb = entity.getBoundingBox();
            if (!isNull(bb)) {
                var lo = bb.getMinimum(), hi = bb.getMaximum();
                if (isFinite(lo.x) && isFinite(hi.x)) {
                    return { minX: Math.min(lo.x, hi.x),
                        minY: Math.min(lo.y, hi.y),
                        maxX: Math.max(lo.x, hi.x),
                        maxY: Math.max(lo.y, hi.y) };
                }
            }
        }
    } catch (e) {
        // fall through to the points
    }
    return CsBind.boxOfPoints(points !== undefined && points !== null ?
        points : CsBind.pointsOf(entity));
};

/**
 * Which stations this entity belongs to. QCAD only. WRITES NOTHING --
 * the caller decides whether to commit, which is what lets the adopt
 * action show a preview first.
 *
 * The spec's ordered rules, first hit wins:
 *   1 "snap"       a vertex / endpoint / insertion point coincides
 *                  with a tagged point. Exact, because CsDraw drew
 *                  those tips for tracing to snap to.
 *   2 "proximity"  nothing coincided: the stations inside the
 *                  entity's box grown by the drawing's own feature
 *                  spacing. For freehand that snapped to nothing.
 *   3 "trip"       nothing found: no station list, and the entity
 *                  follows its trip as a whole.
 *
 * \return {stations, source, trip}
 */
CsBind.bindEntity = function(doc, entity, tripId, index, epsilon) {
    var trip = (tripId === undefined || tripId === null) ? 0 : tripId;
    var idx = (index === undefined || index === null) ?
        CsBind.stationIndex(doc) : index;
    var eps = (epsilon === undefined || epsilon === null) ?
        CsBind.epsilonFor(doc) : epsilon;

    var points = CsBind.pointsOf(entity);
    var snapped = CsBind.stationsForPoints(points, idx, eps);
    if (snapped.length > 0) {
        return { stations: snapped, source: "snap", trip: trip };
    }
    var box = CsBind.boxOf(entity, points);
    if (box !== null) {
        var near = CsBind.stationsInBox(box, idx, CsBind.marginFor(idx));
        if (near.length > 0) {
            return { stations: near, source: "proximity", trip: trip };
        }
    }
    return { stations: [], source: "trip", trip: trip };
};

/**
 * Writes LineworkTrip / LineworkStations onto entities already in the
 * document, in ONE RModifyObjectsOperation so the whole tagging pass
 * is one undo step. QCAD only.
 *
 * entries: [{entity, trip, stations}] -- stations optional.
 *
 * Off layers are handled: this build silently refuses adds, MODIFIES
 * and deletes on a layer that is off, so a tag written to an entity
 * sitting on one would vanish without an error. Every off layer in the
 * batch is flipped on around the single operation via
 * CsLayers.withLayerOn (nested, one wrapper per layer) and restored
 * after.
 *
 * \return number of entities tagged
 */
CsBind.tagEntities = function(doc, di, entries) {
    if (entries === undefined || entries === null || entries.length === 0) {
        return 0;
    }
    // which layers in this batch are off, and so need flipping
    var offLayers = [];
    var offSeen = {};
    for (var i = 0; i < entries.length; i++) {
        var ln = CsBind.layerNameOf(doc, entries[i].entity);
        if (ln === "" || offSeen[ln] === true) {
            continue;
        }
        offSeen[ln] = true;
        try {
            var lay = doc.queryLayer(ln);
            if (!isNull(lay) && lay.isOff()) {
                offLayers.push(ln);
            }
        } catch (e) {
            // no layer toggling here; the write is attempted anyway
        }
    }

    var write = function() {
        var op = new RModifyObjectsOperation();
        op.setText("Tag linework");
        var n = 0;
        for (var k = 0; k < entries.length; k++) {
            var en = entries[k];
            if (en === undefined || en === null || isNull(en.entity)) {
                continue;
            }
            CsTags.set(en.entity, CsBind.TRIP_TAG,
                (en.trip === undefined || en.trip === null) ? 0 : en.trip);
            var text = CsBind.encodeStations(en.stations);
            if (text !== "") {
                CsTags.set(en.entity, CsBind.STATIONS_TAG, text);
            }
            // false: keeps the entity on the layer it is already on
            op.addObject(en.entity, false);
            n++;
        }
        di.applyOperation(op);
        return n;
    };

    // nest one withLayerOn per off layer -- the same recursion
    // CsRevise.apply uses for the same reason
    var withOffLayersOn = function(idx, fn) {
        if (idx >= offLayers.length) {
            return fn();
        }
        return CsLayers.withLayerOn(doc, di, offLayers[idx], function() {
            return withOffLayersOn(idx + 1, fn);
        });
    };
    return withOffLayersOn(0, write);
};

/**
 * Every entity that COULD be adopted as linework for tripId, with the
 * binding it would get: [{entity, layer, stations, source, trip}].
 * QCAD only. Writes nothing -- this is what the adopt preview counts
 * before asking.
 *
 * Skipped: anything the layer gate refuses, anything already carrying
 * a linework tag (re-adopting is a deliberate retag, not a duplicate),
 * and anything carrying a suite tag (our own geometry).
 */
CsBind.adoptable = function(doc, tripId) {
    var out = [];
    var idx = CsBind.stationIndex(doc);
    var eps = CsBind.epsilonFor(doc);
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        var layer = CsBind.layerNameOf(doc, e);
        if (!CsBind.isLineworkLayer(layer)) {
            continue;
        }
        if (CsBind.hasLineworkTags(e) || CsBind.isSuiteGeometry(e)) {
            continue;
        }
        var bound = CsBind.bindEntity(doc, e, tripId, idx, eps);
        out.push({ entity: e, layer: layer, stations: bound.stations,
            source: bound.source, trip: bound.trip });
    }
    return out;
};
