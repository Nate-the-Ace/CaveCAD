// Layers.js -- the one place layer names live.
//
// Part of the Cave Survey Core library. The registry itself is pure
// data; ensure() touches the document and is the only function here
// that does.
//
// The vocabulary is the NSS plan template's: CTRL- prefixed control
// layers for survey data, named feature layers for the map itself.
// The old importer invented its own layer names (ALIGNMENT, LRUD,
// STATIONS) that existed in no template; every tool now draws to the
// same names the templates carry, and this registry is tested against
// the template files so the two cannot drift apart again.

var CsLayers = {};

// Control layers -- survey data, not map art.
CsLayers.SHOTS = "CTRL-SHOTS";
CsLayers.STATIONS = "CTRL-STATIONS";
CsLayers.STATION_LABELS = "CTRL-STATION-LABELS";
CsLayers.LRUD = "CTRL-LRUD";
CsLayers.SPLAYS = "CTRL-SPLAYS";
CsLayers.HIDDEN = "CTRL-HIDDEN";
CsLayers.RAW = "CTRL-RAW";
CsLayers.LRUD_WALL_LEFT = "CTRL-LRUD-WALL-LEFT";
CsLayers.LRUD_WALL_RIGHT = "CTRL-LRUD-WALL-RIGHT";
CsLayers.PROFILE_FLOOR = "CTRL-PROFILE-FLOOR";
CsLayers.PROFILE_CEILING = "CTRL-PROFILE-CEILING";
CsLayers.GRID = "CTRL-GRID";
CsLayers.AERIAL = "CTRL-AERIAL";

// Feature layers the tools write to.
CsLayers.WALLS_SURVEYED = "WALLS-SURVEYED";
CsLayers.WALLS_INFERRED = "WALLS-INFERRED";
CsLayers.BREAKDOWN = "BREAKDOWN";
CsLayers.BREAKDOWN_BOUNDARY = "BREAKDOWN-BOUNDARY";
CsLayers.CROSS_SECTION_MARKERS = "CROSS-SECTION-MARKERS";
CsLayers.NORTH_ARROW = "NORTH-ARROW";
CsLayers.SCALE_BAR = "SCALE-BAR";
CsLayers.TITLE_BLOCK = "TITLE-BLOCK";
CsLayers.LEGEND = "LEGEND";
CsLayers.BORDER = "BORDER";
CsLayers.TEXT_LABELS = "TEXT-LABELS";
CsLayers.TEXT_NOTES = "TEXT-NOTES";
CsLayers.ENTRANCE = "ENTRANCE";

// Defaults for creating a layer that is missing from the drawing
// (someone working without the template still gets sane colors).
// name -> [colorName, linetype, lineweightKey]
// lineweightKey is resolved against RLineweight at ensure() time so
// this table stays loadable outside QCAD.
CsLayers.DEFAULTS = {
    "CTRL-SHOTS": ["gray", "CONTINUOUS", "Weight025"],
    "CTRL-STATIONS": ["red", "CONTINUOUS", "Weight025"],
    "CTRL-STATION-LABELS": ["red", "CONTINUOUS", "Weight025"],
    "CTRL-LRUD": ["pink", "CONTINUOUS", "Weight025"],
    "CTRL-SPLAYS": ["gray", "CONTINUOUS", "Weight000"],
    "CTRL-HIDDEN": ["gray", "CONTINUOUS", "Weight000"],
    "CTRL-RAW": ["gray", "DASHED", "Weight000"],
    "CTRL-LRUD-WALL-LEFT": ["gray", "DASHED", "Weight000"],
    "CTRL-LRUD-WALL-RIGHT": ["gray", "DASHED", "Weight000"],
    "CTRL-PROFILE-FLOOR": ["gray", "DASHED", "Weight000"],
    "CTRL-PROFILE-CEILING": ["gray", "DASHED", "Weight000"],
    "CTRL-AERIAL": ["gray", "CONTINUOUS", "Weight000"],
    "WALLS-SURVEYED": ["white", "CONTINUOUS", "Weight050"],
    "WALLS-INFERRED": ["gray", "DASHED", "Weight025"],
    "BREAKDOWN": ["white", "CONTINUOUS", "Weight000"],
    "BREAKDOWN-BOUNDARY": ["cyan", "DASHED", "Weight000"],
    "CROSS-SECTION-MARKERS": ["white", "CONTINUOUS", "Weight035"],
    "NORTH-ARROW": ["white", "CONTINUOUS", "Weight025"],
    "SCALE-BAR": ["white", "CONTINUOUS", "Weight025"],
    "TITLE-BLOCK": ["white", "CONTINUOUS", "Weight025"],
    "LEGEND": ["white", "CONTINUOUS", "Weight018"],
    "TEXT-LABELS": ["white", "CONTINUOUS", "Weight018"],
    "TEXT-NOTES": ["white", "CONTINUOUS", "Weight009"],
    "ENTRANCE": ["white", "CONTINUOUS", "Weight035"],
    "CTRL-DATA": ["gray", "CONTINUOUS", "Weight000"]
};

// Layers created switched OFF (invisible): the data store, CTRL-HIDDEN
// for legs that must persist but never plot, and CTRL-RAW, the
// as-surveyed ghost -- reference geometry showing where the survey
// was before adjustment moved it, not the map itself, so a reader
// switches it on deliberately rather than seeing it by default. NOT
// frozen -- frozen, off and locked layers ALL silently refuse entity
// adds in this build (RAddObjectsOperation just drops them), so
// nothing can be drawn onto these layers while they are off: a
// writer must wrap its add operation in CsLayers.withLayerOn below,
// which flips the layer visible for the write and restores it after.
CsLayers.OFF = { "CTRL-DATA": true, "CTRL-HIDDEN": true, "CTRL-RAW": true };

/**
 * Runs fn with the named layer switched ON, then restores the layer's
 * previous off state -- even when fn throws. Exists because this
 * build's RAddObjectsOperation silently refuses to add entities to a
 * layer that is off (see CsLayers.OFF above): any write targeting a
 * normally-off layer must happen inside this wrapper or it is lost
 * without an error. Defensive throughout: a missing layer or a bridge
 * without layer toggling just runs fn as-is. QCAD context only.
 *
 * \return whatever fn returns
 */
CsLayers.withLayerOn = function(doc, di, layerName, fn) {
    var wasOff = false;
    try {
        var lay = doc.queryLayer(layerName);
        if (!isNull(lay) && lay.isOff()) {
            lay.setOff(false);
            var opOn = new RModifyObjectsOperation();
            opOn.addObject(lay, false);
            di.applyOperation(opOn);
            wasOff = true;
        }
    } catch (e) {
        wasOff = false; // could not toggle; fn still runs
    }
    var result, thrown = null, didThrow = false;
    try {
        result = fn();
    } catch (e2) {
        thrown = e2;
        didThrow = true;
    }
    if (wasOff) {
        try {
            var layOff = doc.queryLayer(layerName);
            if (!isNull(layOff)) {
                layOff.setOff(true);
                var opOff = new RModifyObjectsOperation();
                opOff.addObject(layOff, false);
                di.applyOperation(opOff);
            }
        } catch (e3) {
            // restoring visibility is a nicety; the data already landed
        }
    }
    if (didThrow) {
        throw thrown;
    }
    return result;
};

/**
 * Ensures a layer exists, creating it with its registry defaults if
 * not. Direct RLayer construction -- simple.js's addLayer relies on
 * current-layer plumbing that fails silently in the QJS bridge.
 * QCAD context only.
 */
CsLayers.ensure = function(doc, di, name) {
    if (doc.hasLayer(name)) {
        return;
    }
    var d = CsLayers.DEFAULTS[name] || ["white", "CONTINUOUS", "Weight025"];
    var layer = new RLayer(doc, name, false, false,
        new RColor(d[0]), doc.getLinetypeId(d[1]),
        RLineweight[d[2]], CsLayers.OFF[name] === true);
    var op = new RAddObjectsOperation();
    op.addObject(layer);
    di.applyOperation(op);
};

/** Ensures the layers every survey-drawing tool relies on. */
CsLayers.ensureSurveyLayers = function(doc, di) {
    CsLayers.ensure(doc, di, CsLayers.SHOTS);
    CsLayers.ensure(doc, di, CsLayers.STATIONS);
    CsLayers.ensure(doc, di, CsLayers.STATION_LABELS);
    CsLayers.ensure(doc, di, CsLayers.LRUD);
    CsLayers.ensure(doc, di, CsLayers.SPLAYS);
    CsLayers.ensure(doc, di, CsLayers.HIDDEN);
    CsLayers.ensure(doc, di, CsLayers.AERIAL);
};
