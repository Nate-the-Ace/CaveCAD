// CsArea -- the thirteen UIS/Therion area patterns and a repeatable
// dice roll.
//
// This is the catalog only: what a pattern is called, whether it is
// drawn as a filled hatch region or a scatter of picture elements, and
// which layers it and its boundary belong to. The polygon maths that
// turn a boundary into a fill (Task 3), the picture-element blocks
// named here (Task 4), and everything that writes into a document
// (Tasks 5-11) live elsewhere. This file is GUI-free: no QWidget, no
// QPixmap, no simple.js global -- so it loads and runs the same way
// under node as it does inside CaveCAD.
//
// The dice are seeded because a scatter fill is DERIVED and rebuilt
// every time its boundary moves (the same model Shaped Lines uses for
// its spine and decoration). An unseeded Math.random reshuffles a
// whole boulder room's rubble on every rebuild, which reads as the
// floor changing texture out from under you as you drag its edge. A
// seed carried on the boundary keeps one area's scatter looking the
// same across edits, undo, reload, and a redraw on someone else's
// machine.

var CsArea = {};

/**
 * A repeatable random source.
 *
 * Park-Miller minimal standard, NOT an LCG with a big multiplier and
 * NOT Math.imul: this bridge is ES5, Math.imul is absent, and a
 * multiplier over ~2^24 loses bits in a double long before it wraps.
 * 16807 * 2^31 stays under 2^53, so every step is exact.
 *
 * Math.random cannot be seeded, and an unseeded scatter reshuffles a
 * whole boulder room every time the listener fires.
 */
CsArea.rng = function(seed) {
    var state = Math.floor(Math.abs(isNull(seed) ? 1 : seed)) % 2147483647;
    if (state === 0) {
        state = 1;
    }
    return function() {
        state = (state * 16807) % 2147483647;
        return (state - 1) / 2147483646;
    };
};

/** A seed for a new area. Math.random is fine HERE -- it is rolled
 *  once, written to the boundary, and never rolled again. */
CsArea.newSeed = function() {
    return 1 + Math.floor(Math.random() * 2147483645);
};

// Therion's own split is copied deliberately: water, sump, flowstone
// and moonmilk render as a FILLED region (a hatch entity, an
// "ansi31"/"dots" .pat pattern, or a solid fill); blocks, debris,
// pebbles, sand, clay, ice/snow, guano and bones render by randomly
// SCATTERING picture elements, which is why a repeating .pat pattern
// is not the engine for those -- gravel does not tile. Bedrock is the
// degenerate filled member: pattern null, meaning it draws no fill at
// all, only its printed boundary.
CsArea.CATALOG = {
    BLOCKS: { name: "Blocks", engine: "scatter", layer: "BREAKDOWN",
        boundaryLayer: "CTRL-AREA-BOUNDARY",
        blocks: ["SYM_BREAKDOWN", "SYM_BREAKDOWN_B", "SYM_BREAKDOWN_C"],
        density: 16, scaleMin: 0.7, scaleMax: 1.5, rotate: true },
    DEBRIS: { name: "Debris", engine: "scatter", layer: "BREAKDOWN",
        boundaryLayer: "CTRL-AREA-BOUNDARY",
        blocks: ["SYM_BREAKDOWN", "SYM_BREAKDOWN_B", "SYM_BREAKDOWN_C"],
        density: 40, scaleMin: 0.25, scaleMax: 0.5, rotate: true },
    PEBBLES: { name: "Pebbles", engine: "scatter",
        layer: "SEDIMENT-SAND-GRAVEL", boundaryLayer: "CTRL-AREA-BOUNDARY",
        blocks: ["AREA_PEBBLE"], density: 55,
        scaleMin: 0.6, scaleMax: 1.2, rotate: true },
    SAND: { name: "Sand", engine: "scatter",
        layer: "SEDIMENT-SAND-GRAVEL", boundaryLayer: "CTRL-AREA-BOUNDARY",
        blocks: ["AREA_STIPPLE"], density: 120,
        scaleMin: 0.8, scaleMax: 1.2, rotate: false },
    CLAY: { name: "Clay / Silt", engine: "scatter",
        layer: "SEDIMENT-CLAY-MUD", boundaryLayer: "CTRL-AREA-BOUNDARY",
        blocks: ["AREA_STIPPLE"], density: 45,
        scaleMin: 0.7, scaleMax: 1.0, rotate: false },
    BEDROCK: { name: "Bedrock", engine: "filled", layer: "FLOOR",
        boundaryLayer: "FLOOR", solid: false, pattern: null },
    WATER: { name: "Water / Lake", engine: "filled",
        layer: "WATER-POOL-SUMP", boundaryLayer: "WATER-POOL-SUMP",
        solid: true, pattern: "SOLID" },
    SUMP: { name: "Sump", engine: "filled", layer: "WATER-POOL-SUMP",
        boundaryLayer: "WATER-POOL-SUMP", solid: false,
        pattern: "ansi31", patternScale: 2.0, patternAngle: 0.0 },
    FLOWSTONE: { name: "Flowstone", engine: "filled", layer: "FLOWSTONE",
        boundaryLayer: "FLOWSTONE", solid: false,
        pattern: "ansi31", patternScale: 1.0, patternAngle: Math.PI / 4 },
    MOONMILK: { name: "Moonmilk", engine: "filled",
        layer: "FORMATIONS-MOONMILK-POPCORN",
        boundaryLayer: "CTRL-AREA-BOUNDARY", solid: false,
        pattern: "dots", patternScale: 1.0, patternAngle: 0.0 },
    GUANO: { name: "Guano", engine: "scatter", layer: "GUANO",
        boundaryLayer: "CTRL-AREA-BOUNDARY", blocks: ["AREA_DASH"],
        density: 60, scaleMin: 0.8, scaleMax: 1.3, rotate: true },
    ICE: { name: "Ice / Snow", engine: "scatter", layer: "ICE-SNOW",
        boundaryLayer: "CTRL-AREA-BOUNDARY", blocks: ["AREA_CRYSTAL"],
        density: 30, scaleMin: 0.8, scaleMax: 1.4, rotate: true },
    BONES: { name: "Bones", engine: "scatter", layer: "ARCHAEOLOGY",
        boundaryLayer: "CTRL-AREA-BOUNDARY", blocks: ["AREA_BONE"],
        density: 6, scaleMin: 0.9, scaleMax: 1.3, rotate: true }
};

/** A catalog entry by key, built-in or (from Task 11) custom. */
CsArea.entryFor = function(key) {
    if (!isNull(CsArea.CATALOG[key])) {
        return CsArea.CATALOG[key];
    }
    return null;
};

/** Even-odd point in polygon. A self-intersecting boundary is answered
 *  by this rule and not repaired -- a figure-eight fills its lobes. */
CsArea.pointInPolygon = function(px, py, verts) {
    var inside = false;
    var n = verts.length;
    if (n < 3) {
        return false;
    }
    var x1 = verts[0].x, y1 = verts[0].y;
    for (var i = 1; i <= n; i++) {
        var x2 = verts[i % n].x, y2 = verts[i % n].y;
        if ((y1 > py) !== (y2 > py)) {
            var xInt = (x2 - x1) * (py - y1) / (y2 - y1) + x1;
            if (px < xInt) {
                inside = !inside;
            }
        }
        x1 = x2;
        y1 = y2;
    }
    return inside;
};

/**
 * Unsigned area of a polygon, via the signed shoelace sum.
 *
 * Self-intersecting boundaries are not repaired in v1 (see
 * pointInPolygon above): a figure-eight's two lobes wind opposite ways,
 * so THIS sum cancels them rather than adding them, even though
 * pointInPolygon fills both lobes. The area a figure-eight is scattered
 * against is therefore smaller than its visible footprint, and it
 * comes out sparser than it looks -- a known, accepted v1 gap, not a
 * bug to chase here.
 */
CsArea.polygonArea = function(verts) {
    var a = 0;
    for (var i = 0; i < verts.length; i++) {
        var p1 = verts[i], p2 = verts[(i + 1) % verts.length];
        a += p1.x * p2.y - p2.x * p1.y;
    }
    return Math.abs(a) / 2;
};

/** The bounding box of a polygon: {minX, minY, maxX, maxY}, or null for
 *  an empty vertex list -- every current caller already guards against
 *  fewer than 3 verts, but this is exported and must not throw. */
CsArea.bounds = function(verts) {
    if (verts.length === 0) {
        return null;
    }
    var b = { minX: verts[0].x, minY: verts[0].y,
              maxX: verts[0].x, maxY: verts[0].y };
    for (var i = 1; i < verts.length; i++) {
        b.minX = Math.min(b.minX, verts[i].x);
        b.minY = Math.min(b.minY, verts[i].y);
        b.maxX = Math.max(b.maxX, verts[i].x);
        b.maxY = Math.max(b.maxY, verts[i].y);
    }
    return b;
};

/**
 * Where a scattered pattern's elements go.
 *
 * Rejection sampling inside the bounding box, with a cap so a boundary
 * that is nearly all box -- a long thin passage cutting a diagonal --
 * cannot spin. The cap is generous: a 10% hit rate still fills.
 *
 * \return [{x, y, block, scale, angle}, ...]
 */
CsArea.placements = function(verts, entry, seed, scale, density) {
    var out = [];
    if (verts.length < 3 || entry.engine !== "scatter" ||
        isNull(entry.blocks) || entry.blocks.length === 0) {
        return out;
    }
    var area = CsArea.polygonArea(verts);
    var want = Math.round((area / 100) * entry.density *
        (isNull(density) ? 1.0 : density));
    if (want <= 0) {
        return out;
    }
    var b = CsArea.bounds(verts);
    var w = b.maxX - b.minX, h = b.maxY - b.minY;
    var rand = CsArea.rng(seed);
    var tries = 0, cap = want * 60 + 500;
    var mul = isNull(scale) ? 1.0 : scale;
    while (out.length < want && tries < cap) {
        tries++;
        // These draws happen BEFORE the inside test, every attempt, hit
        // or miss. That is what makes the sequence depend only on the
        // seed and the geometry -- never on how many points happened to
        // land outside -- so the same seed always reproduces the same
        // placements. Reordering "to save a draw on a miss" breaks that.
        var x = b.minX + rand() * w;
        var y = b.minY + rand() * h;
        var pickBlock = rand();
        var pickScale = rand();
        var pickAngle = rand();
        if (!CsArea.pointInPolygon(x, y, verts)) {
            continue;
        }
        var blockIndex = Math.min(entry.blocks.length - 1,
            Math.floor(pickBlock * entry.blocks.length));
        out.push({
            x: x, y: y,
            block: entry.blocks[blockIndex],
            scale: mul * (entry.scaleMin +
                pickScale * (entry.scaleMax - entry.scaleMin)),
            angle: entry.rotate ? pickAngle * 2 * Math.PI : 0.0
        });
    }
    return out;
};

// ---------------------------------------------------------------------
// Building and clearing a fill in a real document (Task 5). Everything
// above this line is pure geometry and never touches doc/op; everything
// below writes into one.
// ---------------------------------------------------------------------

/** The XDATA key every generated fill entity carries. Read back by
 *  ownedBy/clear so a boundary's fill can be found and thrown away
 *  without remembering which entities it made. */
CsArea.OWNER_KEY = "AreaOwner";

/** Keys on the boundary itself -- not read by this file, but named here
 *  so the stroke action (Task 6) and the listener (Task 7) agree with
 *  each other on what an area's XDATA looks like. */
CsArea.ID_KEY = "AreaId";
CsArea.PATTERN_KEY = "AreaPattern";
CsArea.SCALE_KEY = "AreaScale";
CsArea.DENSITY_KEY = "AreaDensity";
CsArea.SEED_KEY = "AreaSeed";

/** How finely a boundary curve is sampled into a polygon. */
CsArea.STEP = 0.25;

/**
 * A boundary entity as [{x, y}, ...].
 *
 * THE SPLINE PROXY TRAP. shape.getPointCloud() on an RSpline delegates
 * (RSpline.cpp) to approximateWithArcs(), which needs a spline proxy
 * plugin that a `-no-gui -autostart` run never loads -- measured EMPTY
 * there for both an open and a closed spline, while the identical call
 * returns real points inside the GUI. Branching on WHETHER that first
 * attempt came back empty would make one boundary sample differently in
 * the two environments: polygonArea, bounds and pointInPolygon would
 * then disagree with themselves across environments, and the same seed
 * would scatter differently in a screenshot than in this test. So the
 * branch below is fixed by the shape's TYPE, not by what getPointCloud
 * happened to return -- a spline ALWAYS goes through getExploded()'s
 * line/arc segments (not proxy-dependent, and not "an optimisation" to
 * skip when getPointCloud looks like it worked), and everything else
 * (polyline, circle, arc, line, ellipse) ALWAYS samples directly, which
 * is both cheaper and exactly as accurate for those shapes in both
 * environments. Do not turn this back into an emptiness check.
 */
CsArea.vertsOf = function(entity) {
    var out = [];
    var shape;
    try {
        shape = entity.getData().castToShape();
    } catch (e) {
        return [];
    }
    if (isNull(shape)) {
        return [];
    }
    try {
        if (shape.getShapeType() === RShape.Spline) {
            var segments = entity.getExploded();
            for (var s = 0; s < segments.length; s++) {
                var pts = segments[s].getPointCloud(CsArea.STEP);
                for (var p = 0; p < pts.length; p++) {
                    out.push({ x: pts[p].x, y: pts[p].y });
                }
            }
        } else {
            var cloud = shape.getPointCloud(CsArea.STEP);
            for (var i = 0; i < cloud.length; i++) {
                out.push({ x: cloud[i].x, y: cloud[i].y });
            }
        }
    } catch (eSample) {
        return [];
    }
    return out;
};

/**
 * Builds one area's fill into an operation the caller applies.
 *
 * Never throws: a missing block or an unshaped boundary comes back as
 * {ok: false, reason} so a caller (the stroke action, the listener) can
 * report it to the caver instead of crashing a transaction.
 *
 * \param opts {id, seed, scale, density, layer}
 * \return {ok, count, reason}
 */
CsArea.build = function(doc, op, boundary, entry, opts) {
    if (isNull(entry)) {
        return { ok: false, count: 0, reason: "no such pattern" };
    }
    var verts = CsArea.vertsOf(boundary);
    if (verts.length < 3) {
        return { ok: false, count: 0, reason: "the boundary has no area" };
    }
    if (entry.engine === "filled") {
        return CsArea.buildHatch(doc, op, boundary, entry, opts);
    }
    var places = CsArea.placements(verts, entry, opts.seed, opts.scale,
        opts.density);
    // Built into a local array FIRST, queued into `op` only once every
    // placement has cleared the missing-block check. Calling
    // op.addObject as each one passes would leave a LATER failure with
    // earlier references already sitting in the caller's operation --
    // and since this function reports {ok: false}, a caller has every
    // reason to think applying that op is safe. It is not: op does not
    // know "ok" from "false", only what was queued into it. Nothing
    // partial may ever reach op.
    var refs = [];
    for (var i = 0; i < places.length; i++) {
        var block = doc.queryBlock(places[i].block);
        // isNull, not a truthiness check: a missing block comes back as
        // a WRAPPED non-null object (typeof "object", getId()
        // undefined), not JS null -- see the file header on CsArea and
        // tools/make_area_blocks.js for the same trap.
        if (isNull(block)) {
            return { ok: false, count: 0,
                reason: "this drawing has no " + places[i].block + " block" };
        }
        var data = new RBlockReferenceData(block.getId(),
            new RVector(places[i].x, places[i].y),
            new RVector(places[i].scale, places[i].scale),
            places[i].angle, 1, 1, 1, 1);
        var ref = new RBlockReferenceEntity(doc, data);
        ref.setLayerId(doc.getLayerId(opts.layer));
        CsTags.set(ref, CsArea.OWNER_KEY, opts.id);
        refs.push(ref);
    }
    for (var r = 0; r < refs.length; r++) {
        op.addObject(refs[r], false);
    }
    return { ok: true, count: refs.length, reason: "" };
};

/**
 * One hatch entity over the boundary loop. BEDROCK has no pattern and
 * draws nothing: its edge IS the symbol, so there is nothing to fill.
 *
 * THE POLYLINE TRAP. RHatchData.addBoundary will not stand a closed
 * POLYLINE up as a single boundary shape -- QCAD's own Hatch tool
 * (scripts/Draw/Hatch/HatchFromSelection/HatchFromSelection.js,
 * .traverse) never tries: for a closed polyline it explodes into line
 * and arc segments and adds each one to the loop, and only a circle,
 * full ellipse or closed SPLINE goes in whole via
 * getData().castToShape().clone(). Duck-typed on getVertices rather
 * than the simple.js/library.js global isPolylineEntity, which this
 * Core file has no business assuming is loaded.
 */
CsArea.buildHatch = function(doc, op, boundary, entry, opts) {
    if (isNull(entry.pattern)) {
        return { ok: true, count: 0, reason: "" };
    }
    var data = new RHatchData(entry.solid === true,
        isNull(entry.patternScale) ? 1.0 : entry.patternScale,
        isNull(entry.patternAngle) ? 0.0 : entry.patternAngle,
        entry.pattern);
    data.newLoop();
    try {
        var bd = boundary.getData();
        if (typeof bd.getVertices === "function" &&
                typeof boundary.getExploded === "function") {
            var segments = boundary.getExploded();
            for (var i = 0; i < segments.length; i++) {
                data.addBoundary(segments[i].clone());
            }
        } else {
            data.addBoundary(bd.castToShape().clone());
        }
    } catch (eShape) {
        return { ok: false, count: 0,
            reason: "this boundary has no usable shape" };
    }
    var hatch = new RHatchEntity(doc, data);
    hatch.setLayerId(doc.getLayerId(opts.layer));
    CsTags.set(hatch, CsArea.OWNER_KEY, opts.id);
    op.addObject(hatch, false);
    return { ok: true, count: 1, reason: "" };
};

/** Every entity id belonging to one area's fill. */
CsArea.ownedBy = function(doc, areaId) {
    var out = [];
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        if (CsTags.get(e, CsArea.OWNER_KEY) === areaId) {
            out.push(ids[i]);
        }
    }
    return out;
};

/** How many entities belong to one area's fill. */
CsArea.countOwned = function(doc, areaId) {
    return CsArea.ownedBy(doc, areaId).length;
};

/** Deletes one area's fill into an operation the caller applies. Only
 *  entities tagged with THIS areaId -- a neighbour's fill, or anything
 *  else in the drawing, is untouched. */
CsArea.clear = function(doc, op, areaId) {
    var ids = CsArea.ownedBy(doc, areaId);
    for (var i = 0; i < ids.length; i++) {
        op.deleteObject(doc.queryEntityDirect(ids[i]));
    }
    return ids.length;
};
