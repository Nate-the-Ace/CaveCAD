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
