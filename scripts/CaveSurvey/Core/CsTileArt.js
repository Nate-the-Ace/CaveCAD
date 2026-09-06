// CsTileArt.js -- drawing a panel tile's picture: a little of the cave
// map, rendered from the geometry the tool would actually produce.
//
// Part of the Cave Survey Core library. GUI context only (QPixmap,
// QPainter), but never an interactive ACTION's context -- panels call
// this, actions do not, and nothing here reaches for a simple.js global
// either way.
//
// WHY IT EXISTS. Two panels want the same thing: the Symbol Palette
// draws each symbol from its block, and Feature Trace draws each
// feature from the line it makes. Both had the same twenty lines of
// point-cloud-to-pixmap painting, and a second copy is a second place
// for a tile to quietly stop matching what it names. The rule for both
// is the same: A TILE IS A PICTURE OF WHAT YOU GET, generated from the
// same geometry, never hand-drawn beside it.
//
// Everything degrades to null rather than throwing: a bridge that
// refuses a painter costs a picture, never a panel.

var CsTileArt = {};

/** Margin inside a tile, in pixels, so strokes never touch the edge. */
CsTileArt.MARGIN = 3;

/** How finely a shape is sampled into points. Coarse on purpose: this
 *  is a 30px picture, and a curve is a handful of segments there. */
CsTileArt.STEP = 0.05;

/**
 * Point clouds for a list of RShape objects.
 *
 * getPointCloud is on RShape itself, so one path covers lines, arcs,
 * splines and polylines rather than four.
 *
 * \return [[{x, y}, ...], ...], empty when nothing could be sampled.
 */
CsTileArt.cloudsOfShapes = function(shapes) {
    var out = [];
    if (isNull(shapes)) {
        return out;
    }
    for (var i = 0; i < shapes.length; i++) {
        var pts = null;
        try {
            pts = shapes[i].getPointCloud(CsTileArt.STEP);
        } catch (eCloud) {
            pts = null;
        }
        if (isNull(pts) || pts.length < 2) {
            continue;
        }
        var cloud = [];
        for (var j = 0; j < pts.length; j++) {
            cloud.push({ x: pts[j].x, y: pts[j].y });
        }
        out.push(cloud);
    }
    return out;
};

/** Point clouds for a list of ENTITIES, by way of their shapes. */
CsTileArt.cloudsOfEntities = function(entities) {
    var out = [];
    if (isNull(entities)) {
        return out;
    }
    for (var i = 0; i < entities.length; i++) {
        var shapes = null;
        try {
            shapes = entities[i].getShapes();
        } catch (eShape) {
            shapes = null;
        }
        var clouds = CsTileArt.cloudsOfShapes(shapes);
        for (var c = 0; c < clouds.length; c++) {
            out.push(clouds[c]);
        }
    }
    return out;
};

/**
 * The bounding box of a set of clouds, or null when there is nothing
 * in them. Pure.
 */
CsTileArt.extentOf = function(clouds) {
    var minX = null, minY = null, maxX = null, maxY = null;
    for (var i = 0; i < clouds.length; i++) {
        for (var j = 0; j < clouds[i].length; j++) {
            var p = clouds[i][j];
            if (isNaN(p.x) || isNaN(p.y)) {
                continue;
            }
            if (minX === null || p.x < minX) { minX = p.x; }
            if (maxX === null || p.x > maxX) { maxX = p.x; }
            if (minY === null || p.y < minY) { minY = p.y; }
            if (maxY === null || p.y > maxY) { maxY = p.y; }
        }
    }
    if (minX === null) {
        return null;
    }
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
};

/**
 * The scale and centre that fit `extent` into a tile of `size`.
 *
 * A shape with one zero extent -- a single horizontal stroke -- would
 * divide by zero and paint nothing, so the larger side decides and a
 * flat one is simply not scaled.
 *
 * Pure, and the reason a tile of a 20 ft pit and a tile of a 6 in
 * stalactite are both legible.
 */
CsTileArt.fitOf = function(extent, size) {
    var span = Math.max(extent.maxX - extent.minX, extent.maxY - extent.minY);
    var usable = size - 2 * CsTileArt.MARGIN;
    return {
        factor: (span <= 0) ? 1.0 : usable / span,
        cx: (extent.minX + extent.maxX) / 2,
        cy: (extent.minY + extent.maxY) / 2
    };
};

/**
 * Paints clouds into a square QIcon.
 *
 * `pen` is optional: { color, width, dashed }. A dashed pen is how an
 * inferred wall reads as inferred in its own tile -- the tile carries
 * the layer's meaning, not just its shape.
 *
 * Y IS FLIPPED. Drawing space counts up and a pixmap counts down, and a
 * symbol drawn upside down is a different symbol: a stalactite becomes
 * a stalagmite, hachures point the wrong way.
 *
 * \return a QIcon, or null when this build's painter refuses.
 */
CsTileArt.iconOfClouds = function(clouds, size, pen) {
    if (isNull(clouds) || clouds.length === 0) {
        return null;
    }
    var extent = CsTileArt.extentOf(clouds);
    if (extent === null) {
        return null;
    }
    var fit = CsTileArt.fitOf(extent, size);
    try {
        var pixmap = new QPixmap(size, size);
        pixmap.fill(new QColor(0, 0, 0, 0));
        var painter = new QPainter();
        painter.begin(pixmap);
        try {
            painter.setRenderHint(QPainter.Antialiasing, true);
        } catch (eHint) {
        }
        var qpen = new QPen(isNull(pen) || isNull(pen.color) ?
            new QColor(30, 30, 30) : pen.color);
        qpen.setWidth(isNull(pen) || isNull(pen.width) ? 1 : pen.width);
        if (!isNull(pen) && pen.dashed === true) {
            try {
                qpen.setStyle(Qt.DashLine);
            } catch (eDash) {
                // a solid tile for a dashed layer is a small loss
            }
        }
        painter.setPen(qpen);
        for (var i = 0; i < clouds.length; i++) {
            for (var j = 0; j < clouds[i].length - 1; j++) {
                var a = clouds[i][j], b = clouds[i][j + 1];
                painter.drawLine(
                    size / 2 + (a.x - fit.cx) * fit.factor,
                    size / 2 - (a.y - fit.cy) * fit.factor,
                    size / 2 + (b.x - fit.cx) * fit.factor,
                    size / 2 - (b.y - fit.cy) * fit.factor);
            }
        }
        painter.end();
        return new QIcon(pixmap);
    } catch (ePaint) {
        return null;
    }
};

/** An icon from RShape objects. */
CsTileArt.iconOfShapes = function(shapes, size, pen) {
    return CsTileArt.iconOfClouds(CsTileArt.cloudsOfShapes(shapes), size, pen);
};

/** An icon from entities. */
CsTileArt.iconOfEntities = function(entities, size, pen) {
    return CsTileArt.iconOfClouds(CsTileArt.cloudsOfEntities(entities),
        size, pen);
};

/**
 * The pen a REGISTRY LAYER draws its own tile with: the layer's colour,
 * and dashed when the layer's linetype is.
 *
 * The tile then says what the layer means as well as what it draws --
 * an inferred wall is dashed in the panel because it is dashed on the
 * map. Read through CsLayers.styleOf, which is the one place layer
 * appearance is resolved, so a tile cannot disagree with the map.
 */
CsTileArt.penForLayer = function(layerName) {
    var pen = { color: null, width: 1, dashed: false };
    try {
        var style = CsLayers.styleOf(layerName);
        pen.color = new QColor(String(style[0]));
        var linetype = String(style[1]).toUpperCase();
        pen.dashed = (linetype.indexOf("DASH") !== -1 ||
            linetype.indexOf("HIDDEN") !== -1 ||
            linetype.indexOf("DOT") !== -1);
    } catch (e) {
        pen.color = null;
    }
    return pen;
};

/**
 * A gentle S-curve through a box `feet` across, as {x, y} points.
 *
 * THE SAMPLE STROKE every line tile is drawn from. A straight line
 * would hide exactly what a caver looks for -- which way hachures
 * point, how scallops sit on a bend -- and a real cave line is never
 * straight anyway.
 *
 * Pure.
 */
CsTileArt.sampleCurve = function(feet, steps) {
    if (isNull(steps) || steps < 2) {
        steps = 24;
    }
    var out = [];
    var half = feet / 2;
    for (var i = 0; i <= steps; i++) {
        var t = i / steps;
        out.push({
            x: -half + t * feet,
            y: Math.sin(t * Math.PI * 1.6) * (feet * 0.16)
        });
    }
    return out;
};

/** A closed ring `feet` across, for the tile of a closed feature (the
 *  pit). Pure. */
CsTileArt.sampleRing = function(feet, steps) {
    if (isNull(steps) || steps < 3) {
        steps = 20;
    }
    var out = [];
    var r = feet / 2;
    for (var i = 0; i < steps; i++) {
        var a = (i / steps) * Math.PI * 2;
        out.push({ x: Math.cos(a) * r, y: Math.sin(a) * r * 0.72 });
    }
    return out;
};
