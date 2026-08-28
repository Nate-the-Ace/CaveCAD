// CsShapeLine.js -- Shaped Lines core: cave-map line symbology (ledge
// hachures, flowstone/rimstone scallops) generated as REAL entities
// along a spine curve, and regenerated whenever the spine changes.
//
// Part of the Cave Survey Core library. The geometry functions are
// pure JS (node-testable); everything that needs the engine is grouped
// at the bottom and guarded, following the Core convention.
//
// WHY REAL GEOMETRY AND NOT A SHAPED LINETYPE. The fork's engine can
// render complex linetypes (the machinery is GPL; only a Pro-plugin
// check gates the parser), but RDxfExporter::writeLinetype persists
// DASH LENGTHS ONLY -- a shaped linetype survives until the first
// save, then reopens as plain dashes. Cave maps live as DXF on Drive
// and get exchanged; symbology must survive the file's own life
// cycle. See docs/superpowers/specs/2026-08-28-shaped-lines-design.md.
//
// The NSS 1976 direction rule all five styles encode: ORNAMENT LIVES
// ON THE DOWN SIDE ("hachures point down"). Geometry cannot know which
// side is down, so side is a per-feature tag the caver can flip.

var CsShapeLine = {};

/**
 * Tag keys, all in the CaveSurvey custom-property group via CsTags.
 *
 * The spine carries STYLE/ID/SIDE/SCALE/SIG; every decoration entity
 * carries DECOR=<the spine's id>. Decor is DERIVED state: never edit
 * it, always rebuild it from the spine.
 */
CsShapeLine.KEY = {
    STYLE: "ShapeStyle",
    ID: "ShapeId",
    SIDE: "ShapeSide",
    SCALE: "ShapeScale",
    SIG: "ShapeSig",
    DECOR: "ShapeDecor"
};

/**
 * The five styles. Sizes are in FEET and converted per drawing unit at
 * decorate time (CsTrace.spacingFor), so one number means the same
 * thing in a foot drawing and a metre one -- the FeatureTrace
 * convention.
 *
 * kind "ticks":    perpendicular hachures every spacingFeet, sizeFeet
 *                  long, on the SIDE side of travel.
 * kind "scallops": one polyline of arc bulges, chord spacingFeet,
 *                  bowing to the SIDE side. The spine under a scallop
 *                  style is scaffolding, not map ink -- it lives on
 *                  CTRL-SHAPE-SPINE, which is created OFF.
 *
 * Every layer here must be a CsLayers constant, never a literal --
 * a unit test walks this table against the registry.
 */
CsShapeLine.STYLES = {
    "floorledge": {
        label: "Floor Ledge",
        kind: "ticks", spacingFeet: 3.0, sizeFeet: 2.0,
        spineLayer: CsLayers.LEDGE_FLOOR, decorLayer: CsLayers.LEDGE_FLOOR,
        close: false
    },
    "ceilingledge": {
        label: "Ceiling Ledge",
        kind: "ticks", spacingFeet: 5.0, sizeFeet: 2.0,
        spineLayer: CsLayers.LEDGE_CEILING, decorLayer: CsLayers.LEDGE_CEILING,
        close: false
    },
    "pit": {
        label: "Pit",
        kind: "ticks", spacingFeet: 3.0, sizeFeet: 2.0,
        spineLayer: CsLayers.LEDGE_FLOOR, decorLayer: CsLayers.LEDGE_FLOOR,
        close: true
    },
    "flowstone": {
        label: "Flowstone",
        kind: "scallops", spacingFeet: 3.0, bulge: 0.5,
        spineLayer: CsLayers.SHAPE_SPINE, decorLayer: CsLayers.FLOWSTONE,
        close: false
    },
    "rimstone": {
        label: "Rimstone Dam",
        kind: "scallops", spacingFeet: 2.0, bulge: 0.62,
        spineLayer: CsLayers.SHAPE_SPINE, decorLayer: CsLayers.RIMSTONE,
        close: false
    }
};

// ---------------------------------------------------------------------
// Pure geometry. Points are plain {x, y}; paths are arrays of them.
// ---------------------------------------------------------------------

CsShapeLine.dist = function(a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
};

/**
 * Cumulative arc length over a path. For a closed path the closing
 * segment (last point back to first) is INCLUDED as one extra entry,
 * so cum[cum.length-1] is always the total walkable length.
 */
CsShapeLine.cumulative = function(pts, closed) {
    var cum = [0];
    for (var i = 1; i < pts.length; i++) {
        cum.push(cum[i - 1] + CsShapeLine.dist(pts[i - 1], pts[i]));
    }
    if (closed && pts.length > 1) {
        cum.push(cum[cum.length - 1] +
            CsShapeLine.dist(pts[pts.length - 1], pts[0]));
    }
    return cum;
};

/** The point at arc distance d, plus the unit tangent of the segment
 *  it falls on. Closed paths wrap through the closing segment. */
CsShapeLine.pointAt = function(pts, closed, cum, d) {
    var total = cum[cum.length - 1];
    if (total <= 0) {
        return { x: pts[0].x, y: pts[0].y, tx: 1, ty: 0 };
    }
    if (closed) {
        d = ((d % total) + total) % total;
    } else {
        d = Math.max(0, Math.min(d, total));
    }
    var i = 1;
    while (i < cum.length && cum[i] < d) {
        i++;
    }
    if (i >= cum.length) {
        i = cum.length - 1;
    }
    var a = pts[i - 1];
    var b = (i < pts.length) ? pts[i] : pts[0];   // closing segment
    var segLen = cum[i] - cum[i - 1];
    var t = (segLen > 0) ? (d - cum[i - 1]) / segLen : 0;
    var tx = b.x - a.x, ty = b.y - a.y;
    var n = Math.sqrt(tx * tx + ty * ty);
    if (n > 0) { tx /= n; ty /= n; }
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
             tx: tx, ty: ty };
};

/**
 * Decoration anchor stations: evenly spaced along the path, INSET half
 * a spacing from open ends (a tick exactly on an endpoint reads like a
 * pen slip), evenly DIVIDED around a closed path so the seam is clean.
 * Each station is {x, y, tx, ty}.
 */
CsShapeLine.stations = function(pts, closed, spacing) {
    if (pts.length < 2 || spacing <= 0) {
        return [];
    }
    var cum = CsShapeLine.cumulative(pts, closed);
    var total = cum[cum.length - 1];
    if (total <= 0) {
        return [];
    }
    var out = [];
    var n, step, i;
    if (closed) {
        n = Math.max(4, Math.round(total / spacing));
        step = total / n;
        for (i = 0; i < n; i++) {
            out.push(CsShapeLine.pointAt(pts, closed, cum, step * (i + 0.5)));
        }
    } else {
        n = Math.max(1, Math.floor(total / spacing));
        step = total / n;
        for (i = 0; i < n; i++) {
            out.push(CsShapeLine.pointAt(pts, closed, cum, step * (i + 0.5)));
        }
    }
    return out;
};

/**
 * Hachure segments: one short line per station, from the spine out to
 * the SIDE side. side=+1 is the RIGHT of the direction of travel
 * (right normal of tangent (tx,ty) is (ty,-tx)); side=-1 the left.
 * Returns [[{x,y},{x,y}], ...].
 */
CsShapeLine.ticks = function(pts, closed, spacing, len, side) {
    var st = CsShapeLine.stations(pts, closed, spacing);
    var out = [];
    for (var i = 0; i < st.length; i++) {
        var nx = st[i].ty * side, ny = -st[i].tx * side;
        out.push([{ x: st[i].x, y: st[i].y },
                  { x: st[i].x + nx * len, y: st[i].y + ny * len }]);
    }
    return out;
};

/**
 * Scallop chain: vertices along the path at (roughly) chord spacing,
 * every segment bulged toward SIDE. A POSITIVE DXF bulge bows RIGHT of
 * travel -- probed against RPolyline.getSegmentAt, whose +0.5 bulge
 * from (0,0) to (10,0) has its middle point at (5,-2.5) -- so side +1
 * (right) is the positive bulge.
 * Returns {points: [...], bulges: [...], closed: bool}; bulges[i]
 * belongs to the segment STARTING at points[i], QCAD's convention.
 */
CsShapeLine.scallops = function(pts, closed, chord, bulgeMag, side) {
    if (pts.length < 2 || chord <= 0) {
        return { points: [], bulges: [], closed: !!closed };
    }
    var cum = CsShapeLine.cumulative(pts, closed);
    var total = cum[cum.length - 1];
    if (total <= 0) {
        return { points: [], bulges: [], closed: !!closed };
    }
    var n = Math.max(closed ? 3 : 1, Math.round(total / chord));
    var step = total / n;
    var bulge = side * bulgeMag;
    var points = [], bulges = [];
    var count = closed ? n : n + 1;
    for (var i = 0; i < count; i++) {
        var p = CsShapeLine.pointAt(pts, closed, cum, step * i);
        points.push({ x: p.x, y: p.y });
        // the last vertex of an OPEN chain starts no segment
        bulges.push((!closed && i === count - 1) ? 0 : bulge);
    }
    return { points: points, bulges: bulges, closed: !!closed };
};

/**
 * Geometry signature: what the listener compares to know whether a
 * transaction actually MOVED the spine. Coordinates rounded to 0.001
 * drawing units -- looser and a grip nudge goes unnoticed, tighter and
 * float noise regenerates forever (the no-op-write freeze lesson).
 * FNV-1a over the rounded stream, plus count and closedness.
 */
CsShapeLine.signature = function(pts, closed) {
    var h = 2166136261;
    var mix = function(v) {
        h = h ^ (v & 0xff); h = (h * 16777619) >>> 0;
        h = h ^ ((v >> 8) & 0xff); h = (h * 16777619) >>> 0;
        h = h ^ ((v >> 16) & 0xff); h = (h * 16777619) >>> 0;
        h = h ^ ((v >> 24) & 0xff); h = (h * 16777619) >>> 0;
    };
    for (var i = 0; i < pts.length; i++) {
        mix(Math.round(pts[i].x * 1000) | 0);
        mix(Math.round(pts[i].y * 1000) | 0);
    }
    return (closed ? "c" : "o") + pts.length + "-" + h.toString(36);
};

/** Signed area of a closed path (shoelace). Positive = counter-
 *  clockwise. What the pit tool uses to aim its hachures inward:
 *  around a CCW loop the interior is LEFT of travel (side -1). */
CsShapeLine.signedArea = function(pts) {
    var a = 0;
    for (var i = 0; i < pts.length; i++) {
        var p = pts[i], q = pts[(i + 1) % pts.length];
        a += p.x * q.y - q.x * p.y;
    }
    return a / 2;
};

/** The side value that points INTO a closed path. */
CsShapeLine.inwardSide = function(pts) {
    return CsShapeLine.signedArea(pts) > 0 ? -1 : 1;
};

/**
 * Decoration primitives for one spine, as plain data.
 * spec: a CsShapeLine.STYLES value. spacing/size already in DRAWING
 * units (the caller applied perFoot and the feature's scale).
 * Returns {lines: [[p,q],...], polylines: [{points,bulges,closed}]}.
 */
CsShapeLine.prims = function(pts, closed, spec, side, spacing, size) {
    var out = { lines: [], polylines: [] };
    if (spec.kind === "ticks") {
        out.lines = CsShapeLine.ticks(pts, closed, spacing, size, side);
    } else if (spec.kind === "scallops") {
        var s = CsShapeLine.scallops(pts, closed, spacing, spec.bulge, side);
        if (s.points.length >= 2) {
            out.polylines.push(s);
        }
    }
    return out;
};

/** How many decor ENTITIES prims produce -- the listener's cheap
 *  "is the decoration complete" count. */
CsShapeLine.primCount = function(prims) {
    return prims.lines.length + prims.polylines.length;
};

// ---------------------------------------------------------------------
// Engine adapter. Everything below needs QCAD types and is guarded so
// this file still evals under node for the pure tests above.
// ---------------------------------------------------------------------

if (typeof RVector !== "undefined") {

/** Sample step for a style, in drawing units: fine enough that the
 *  walk cannot cut a corner a tick would visibly miss. */
CsShapeLine.sampleStep = function(spacingDrawing) {
    return Math.max(spacingDrawing / 6, 1e-6);
};

CsShapeLine.sampleLineSeg = function(a, b, step, out) {
    var d = CsShapeLine.dist(a, b);
    var n = Math.max(1, Math.ceil(d / step));
    for (var i = 1; i <= n; i++) {
        out.push({ x: a.x + (b.x - a.x) * i / n,
                   y: a.y + (b.y - a.y) * i / n });
    }
};

/** Sample a bulge segment (DXF bulge = tan(theta/4)). Calibrated
 *  against the engine, not convention lore: RPolyline.getSegmentAt on
 *  a +0.5 bulge from (0,0) to (10,0) answers center (5, 3.75) and
 *  middle point (5, -2.5) -- a positive bulge bows RIGHT of travel and
 *  its center sits on the LEFT. Emits everything AFTER the start
 *  point. */
CsShapeLine.sampleBulgeSeg = function(a, b, bulge, step, out) {
    if (Math.abs(bulge) < 1e-12) {
        CsShapeLine.sampleLineSeg(a, b, step, out);
        return;
    }
    var theta = 4 * Math.atan(bulge);           // signed CCW sweep
    var chord = CsShapeLine.dist(a, b);
    if (chord < 1e-12) {
        return;
    }
    var r = chord / (2 * Math.sin(Math.abs(theta) / 2));
    var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    var ux = (b.x - a.x) / chord, uy = (b.y - a.y) / chord;
    var h = Math.sqrt(Math.max(0, r * r - (chord / 2) * (chord / 2)));
    // left normal of travel
    var lx = -uy, ly = ux;
    // positive bulge: center LEFT of the chord (arc bows right); the
    // major arc (|theta| > PI) puts it on the other side
    var s = (Math.abs(theta) > Math.PI) ? -1 : 1;
    var sgn = (bulge > 0) ? 1 : -1;
    var cx = mx + lx * h * s * sgn, cy = my + ly * h * s * sgn;
    var a1 = Math.atan2(a.y - cy, a.x - cx);
    var arcLen = Math.abs(theta) * r;
    var n = Math.max(2, Math.ceil(arcLen / step));
    for (var i = 1; i <= n; i++) {
        var ang = a1 + theta * i / n;
        out.push({ x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) });
    }
};

/**
 * Any supported entity -> {points, closed}, or null for a type the
 * tool does not understand. Line, arc and circle are closed-form;
 * polylines walk their vertices+bulges (getPointsWithDistanceToEnd on
 * a polyline returns points from BOTH ends -- probed -- so it is
 * useless for a directed walk); splines go through the engine, the
 * one type where that API behaves (probed: one point, FromStart
 * honored).
 */
CsShapeLine.sampleEntity = function(entity, step) {
    if (isNull(entity)) {
        return null;
    }
    var type;
    try {
        type = entity.getType();
    } catch (e) {
        return null;
    }
    var out = [];
    var data;

    if (type === RS.EntityLine) {
        data = entity.getData();
        var s = data.getStartPoint(), e2 = data.getEndPoint();
        out.push({ x: s.x, y: s.y });
        CsShapeLine.sampleLineSeg({ x: s.x, y: s.y }, { x: e2.x, y: e2.y },
            step, out);
        return { points: out, closed: false };
    }

    if (type === RS.EntityArc) {
        data = entity.getData();
        var c = data.getCenter(), r = data.getRadius();
        var a1 = data.getStartAngle(), a2 = data.getEndAngle();
        var rev = data.isReversed();
        var sweep = rev ? a1 - a2 : a2 - a1;
        // normalise into (0, 2*PI]
        while (sweep <= 0) { sweep += 2 * Math.PI; }
        while (sweep > 2 * Math.PI) { sweep -= 2 * Math.PI; }
        var dir = rev ? -1 : 1;
        var n = Math.max(2, Math.ceil((sweep * r) / step));
        for (var i = 0; i <= n; i++) {
            var ang = a1 + dir * sweep * i / n;
            out.push({ x: c.x + r * Math.cos(ang),
                       y: c.y + r * Math.sin(ang) });
        }
        return { points: out, closed: false };
    }

    if (type === RS.EntityCircle) {
        data = entity.getData();
        var cc = data.getCenter(), cr = data.getRadius();
        var cn = Math.max(8, Math.ceil((2 * Math.PI * cr) / step));
        for (var k = 0; k < cn; k++) {
            var ca = 2 * Math.PI * k / cn;
            out.push({ x: cc.x + cr * Math.cos(ca),
                       y: cc.y + cr * Math.sin(ca) });
        }
        return { points: out, closed: true };
    }

    if (type === RS.EntityPolyline) {
        data = entity.getData();
        var count = data.countVertices();
        if (count < 2) {
            return null;
        }
        var closed = false;
        try { closed = data.isClosed(); } catch (eC) {}
        var v0 = data.getVertexAt(0);
        out.push({ x: v0.x, y: v0.y });
        var segs = closed ? count : count - 1;
        for (var si = 0; si < segs; si++) {
            var pa = data.getVertexAt(si);
            var pb = data.getVertexAt((si + 1) % count);
            var bu = 0;
            try { bu = data.getBulgeAt(si); } catch (eB) { bu = 0; }
            CsShapeLine.sampleBulgeSeg({ x: pa.x, y: pa.y },
                { x: pb.x, y: pb.y }, bu, step, out);
        }
        if (closed) {
            out.pop();   // the walk re-emits the first point; drop it
        }
        return { points: out, closed: closed };
    }

    if (type === RS.EntitySpline) {
        // NOT getShapes(): on a spline that has never been added to a
        // document the shape it returns reports getLength() as NaN --
        // and update() does not cure it (probed 2026-08-28). The draw
        // tool samples its spine BEFORE adding it, so that path must
        // work. getData().castToShape() returns a live RSpline with a
        // real length in both the un-added and the queried case.
        var sh = null;
        try { sh = entity.getData().castToShape(); } catch (eS) { sh = null; }
        if (isNull(sh)) {
            try {
                var shapes = entity.getShapes();
                sh = (shapes.length > 0) ? shapes[0] : null;
            } catch (eS2) { sh = null; }
        }
        if (isNull(sh)) {
            return null;
        }
        // The FIRST getLength() on a freshly cast, never-added spline
        // answers NaN and the SECOND answers the real length (lazy
        // internal update; probed 2026-08-28, twice, because it is that
        // hard to believe). Ask again before giving up.
        var L = sh.getLength();
        if (!(L > 0)) {
            L = sh.getLength();
        }
        if (!(L > 0)) {
            return null;
        }
        var sn = Math.max(2, Math.ceil(L / step));
        for (var d = 0; d <= sn; d++) {
            var pts = sh.getPointsWithDistanceToEnd(L * d / sn, RS.FromStart);
            if (pts.length > 0) {
                out.push({ x: pts[0].x, y: pts[0].y });
            }
        }
        if (out.length < 2) {
            return null;
        }
        var spClosed = false;
        try { spClosed = sh.isClosed(); } catch (eSc) {}
        return { points: out, closed: spClosed };
    }

    return null;
};

/** True for a type sampleEntity understands -- what Decorate
 *  Selection filters on. */
CsShapeLine.isSupported = function(entity) {
    var t;
    try { t = entity.getType(); } catch (e) { return false; }
    return t === RS.EntityLine || t === RS.EntityArc ||
        t === RS.EntityCircle || t === RS.EntityPolyline ||
        t === RS.EntitySpline;
};

/** Drawing units per foot for this document. */
CsShapeLine.perFoot = function(doc) {
    var unit = CsUnits.fromDrawingUnit(doc.getUnit(), RS);
    return CsTrace.spacingFor(unit);
};

/** Every spine in the drawing: [{entity, id}]. Full scan -- manual
 *  sync and startup only, never the listener's gate. */
CsShapeLine.spines = function(doc) {
    var out = [];
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        var sid = CsTags.get(e, CsShapeLine.KEY.ID);
        if (sid !== "" && CsTags.get(e, CsShapeLine.KEY.STYLE) !== "") {
            out.push({ entity: e, id: sid });
        }
    }
    return out;
};

/** The spine tagged with this id, or null. */
CsShapeLine.spineOf = function(doc, id) {
    var want = String(id);
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        if (CsTags.get(e, CsShapeLine.KEY.ID) === want) {
            return e;
        }
    }
    return null;
};

/** Every decoration entity carrying DECOR=<id>. */
CsShapeLine.decorOf = function(doc, id) {
    var want = String(id);
    var out = [];
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        if (CsTags.get(e, CsShapeLine.KEY.DECOR) === want) {
            out.push(e);
        }
    }
    return out;
};

/** The distinct ShapeIds the current selection names -- a caver clicks
 *  the ticks as often as the spine under them, so decor resolves to
 *  its spine's id too. Shared by Flip and Sync so "what does this
 *  selection name" has one definition, not two. */
CsShapeLine.selectionIds = function(doc) {
    var seen = {};
    var out = [];
    var ids = doc.querySelectedEntities();
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        var sid = CsTags.get(e, CsShapeLine.KEY.ID);
        if (sid === "") {
            sid = CsTags.get(e, CsShapeLine.KEY.DECOR);
        }
        if (sid !== "" && !seen[sid]) {
            seen[sid] = true;
            out.push(sid);
        }
    }
    return out;
};

/** Side/scale read off a spine, with defaults. */
CsShapeLine.sideOf = function(spine) {
    var v = parseInt(CsTags.get(spine, CsShapeLine.KEY.SIDE), 10);
    return (v === -1) ? -1 : 1;
};

CsShapeLine.scaleOf = function(spine) {
    var v = parseFloat(CsTags.get(spine, CsShapeLine.KEY.SCALE));
    return (!isNaN(v) && v > 0) ? v : 1;
};

/**
 * Build the decoration ENTITIES for a spine's current geometry --
 * shared by the first draw (before the spine is even added) and every
 * regeneration. Returns {entities, sig, count} or null when the spine
 * cannot be decorated (unknown style, degenerate geometry).
 */
CsShapeLine.buildDecor = function(doc, spine) {
    var styleKey = CsTags.get(spine, CsShapeLine.KEY.STYLE);
    var spec = CsShapeLine.STYLES[styleKey];
    if (isNull(spec)) {
        return null;
    }
    var side = CsShapeLine.sideOf(spine);
    var scale = CsShapeLine.scaleOf(spine);
    var perFoot = CsShapeLine.perFoot(doc);
    var spacing = spec.spacingFeet * perFoot * scale;
    var size = (spec.sizeFeet || 0) * perFoot * scale;

    var sample = CsShapeLine.sampleEntity(spine,
        CsShapeLine.sampleStep(spacing));
    if (isNull(sample) || sample.points.length < 2) {
        return null;
    }

    var prims = CsShapeLine.prims(sample.points, sample.closed, spec,
        side, spacing, size);
    var sid = CsTags.get(spine, CsShapeLine.KEY.ID);
    var layerId = doc.getLayerId(spec.decorLayer);

    var entities = [];
    var i;
    for (i = 0; i < prims.lines.length; i++) {
        var seg = prims.lines[i];
        var le = new RLineEntity(doc, new RLineData(
            new RVector(seg[0].x, seg[0].y),
            new RVector(seg[1].x, seg[1].y)));
        le.setLayerId(layerId);
        CsTags.set(le, CsShapeLine.KEY.DECOR, sid);
        entities.push(le);
    }
    for (i = 0; i < prims.polylines.length; i++) {
        var pd = prims.polylines[i];
        var pl = new RPolyline();
        for (var v = 0; v < pd.points.length; v++) {
            pl.appendVertex(new RVector(pd.points[v].x, pd.points[v].y),
                pd.bulges[v] || 0.0);
        }
        if (pd.closed) {
            pl.setClosed(true);
        }
        var pe = new RPolylineEntity(doc, new RPolylineData(pl));
        pe.setLayerId(layerId);
        CsTags.set(pe, CsShapeLine.KEY.DECOR, sid);
        entities.push(pe);
    }

    return {
        entities: entities,
        sig: CsShapeLine.signature(sample.points, sample.closed),
        count: entities.length,
        decorLayer: spec.decorLayer
    };
};

/**
 * Regenerate one shaped line in place: delete its decor, rebuild from
 * the spine's CURRENT geometry, restamp ShapeSig. `group` joins every
 * write to the caller's transaction group (the listener passes the
 * triggering edit's, so one Ctrl+Z takes both).
 *
 * NOTHING TO DO IS NOT A WRITE (the CalloutWrite freeze lesson): when
 * the signature matches the stamp and the decor count is right, this
 * returns without a single operation.
 *
 * Returns "unchanged" | "decorated" | "failed".
 */
CsShapeLine.decorate = function(doc, di, spine, group) {
    var sid = CsTags.get(spine, CsShapeLine.KEY.ID);
    if (sid === "") {
        return "failed";
    }
    var built = CsShapeLine.buildDecor(doc, spine);
    if (isNull(built)) {
        return "failed";
    }

    var existing = CsShapeLine.decorOf(doc, sid);
    if (built.sig === CsTags.get(spine, CsShapeLine.KEY.SIG) &&
            existing.length === built.count) {
        return "unchanged";
    }

    CsLayers.ensure(doc, di, built.decorLayer);
    var grouped = function(op) {
        if (group !== null && group !== undefined && group >= 0) {
            op.setTransactionGroup(group);
        }
        di.applyOperation(op);
    };

    CsLayers.withLayerOn(doc, di, built.decorLayer, function() {
        if (existing.length > 0) {
            var del = new RDeleteObjectsOperation();
            for (var d = 0; d < existing.length; d++) {
                del.deleteObject(existing[d]);
            }
            grouped(del);
        }
        var add = new RAddObjectsOperation();
        for (var a = 0; a < built.entities.length; a++) {
            add.addObject(built.entities[a], false);
        }
        grouped(add);
    });

    // restamp the signature on the spine, same group
    CsTags.set(spine, CsShapeLine.KEY.SIG, built.sig);
    var mod = new RModifyObjectsOperation();
    mod.addObject(spine, false);
    grouped(mod);

    return "decorated";
};

/**
 * Bring one shaped line back to a consistent state -- the listener's
 * verb, CalloutListener.reconcile's shape. The deletion cases are
 * asymmetric ON PURPOSE, mirroring callouts:
 *
 *   spine gone      -> decor is orphaned. Delete it; ticks around
 *                      nothing are not information.
 *   ALL decor gone  -> the SPINE SURVIVES as an ordinary curve, its
 *                      Shape* tags stripped. The caver deleted the
 *                      ornament, not their line -- forgetting the
 *                      feature is the respectful reading.
 *   anything else   -> regenerate (decorate() self-guards against
 *                      no-op writes).
 */
CsShapeLine.reconcile = function(doc, di, id, group) {
    var spine = CsShapeLine.spineOf(doc, id);
    var decor = CsShapeLine.decorOf(doc, id);

    if (isNull(spine)) {
        if (decor.length === 0) {
            return "nothing";
        }
        var del = new RDeleteObjectsOperation();
        for (var i = 0; i < decor.length; i++) {
            del.deleteObject(decor[i]);
        }
        if (group !== null && group !== undefined && group >= 0) {
            del.setTransactionGroup(group);
        }
        di.applyOperation(del);
        return "orphans-removed";
    }

    if (decor.length === 0 &&
            CsTags.get(spine, CsShapeLine.KEY.SIG) !== "") {
        CsTags.remove(spine, CsShapeLine.KEY.STYLE);
        CsTags.remove(spine, CsShapeLine.KEY.ID);
        CsTags.remove(spine, CsShapeLine.KEY.SIDE);
        CsTags.remove(spine, CsShapeLine.KEY.SCALE);
        CsTags.remove(spine, CsShapeLine.KEY.SIG);
        var mod = new RModifyObjectsOperation();
        mod.addObject(spine, false);
        if (group !== null && group !== undefined && group >= 0) {
            mod.setTransactionGroup(group);
        }
        di.applyOperation(mod);
        return "unlinked";
    }

    var r = CsShapeLine.decorate(doc, di, spine, group);
    return (r === "unchanged") ? "unchanged" : "reflowed";
};

}
