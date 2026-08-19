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
CsLayers.LRUD_WALL_LEFT = "CTRL-LRUD-WALL-LEFT";
CsLayers.LRUD_WALL_RIGHT = "CTRL-LRUD-WALL-RIGHT";
CsLayers.GRID = "CTRL-GRID";

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
    "CTRL-LRUD": ["yellow", "CONTINUOUS", "Weight025"],
    "CTRL-LRUD-WALL-LEFT": ["gray", "DASHED", "Weight000"],
    "CTRL-LRUD-WALL-RIGHT": ["gray", "DASHED", "Weight000"],
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
    "ENTRANCE": ["white", "CONTINUOUS", "Weight035"]
};

/**
 * Ensures a layer exists in the current document, creating it with
 * its registry defaults if not. QCAD context only (uses simple.js's
 * hasLayer/addLayer).
 */
CsLayers.ensure = function(name) {
    if (hasLayer(name)) {
        return;
    }
    var d = CsLayers.DEFAULTS[name] || ["white", "CONTINUOUS", "Weight025"];
    addLayer(name, d[0], d[1], RLineweight[d[2]]);
};

/** Ensures the layers every survey-drawing tool relies on. */
CsLayers.ensureSurveyLayers = function() {
    CsLayers.ensure(CsLayers.SHOTS);
    CsLayers.ensure(CsLayers.STATIONS);
    CsLayers.ensure(CsLayers.STATION_LABELS);
    CsLayers.ensure(CsLayers.LRUD);
};
