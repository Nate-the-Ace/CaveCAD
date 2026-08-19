// Symbols.js -- the symbol catalog: every SYM_* block the templates
// carry, with its NSS name, UIS alias, home layer and default scale.
//
// Part of the Cave Survey Core library. The catalog is pure data;
// only insert() touches the document.
//
// NSS naming is canonical (the templates are NSS-style and a judged
// US map is measured against the NSS set); the UIS alias rides along
// so legends and exports can speak both. A tool placing a symbol
// through this catalog physically cannot put a stalactite on the
// water layer -- the layer comes from here, not from the user.

var CsSymbols = {};

// block, nss, uis, layer, category
CsSymbols.CATALOG = [
    { block: "SYM_ENTRANCE", nss: "Entrance", uis: "Cave entrance",
        layer: "ENTRANCE", category: "Structure" },
    { block: "SYM_PIT", nss: "Pit", uis: "Pit / vertical drop",
        layer: "PITS-DOMES", category: "Structure" },
    { block: "SYM_DOME", nss: "Dome", uis: "Dome / aven",
        layer: "PITS-DOMES", category: "Structure" },
    { block: "SYM_BREAKDOWN", nss: "Breakdown", uis: "Stone blocks",
        layer: "BREAKDOWN", category: "Floor" },
    { block: "SYM_BREAKDOWN_B", nss: "Breakdown (variant B)", uis: "Stone blocks",
        layer: "BREAKDOWN", category: "Floor" },
    { block: "SYM_BREAKDOWN_C", nss: "Breakdown (variant C)", uis: "Stone blocks",
        layer: "BREAKDOWN", category: "Floor" },
    { block: "SYM_STALACTITE", nss: "Stalactite", uis: "Stalactite",
        layer: "FORMATIONS-DRIP", category: "Formations" },
    { block: "SYM_STALAGMITE", nss: "Stalagmite", uis: "Stalagmite",
        layer: "FORMATIONS-DRIP", category: "Formations" },
    { block: "SYM_COLUMN", nss: "Column", uis: "Column",
        layer: "FORMATIONS-DRIP", category: "Formations" },
    { block: "SYM_FLOWSTONE", nss: "Flowstone", uis: "Sinter / flowstone",
        layer: "FORMATIONS-FLOWSTONE", category: "Formations" },
    { block: "SYM_DRAPERY", nss: "Drapery", uis: "Curtain / drapery",
        layer: "FORMATIONS-DRAPERY", category: "Formations" },
    { block: "SYM_RIMSTONE_DAM", nss: "Rimstone dam", uis: "Gours / rimstone",
        layer: "FORMATIONS-RIMSTONE", category: "Formations" },
    { block: "SYM_MOONMILK_POPCORN", nss: "Moonmilk / popcorn", uis: "Moonmilk",
        layer: "FORMATIONS-MOONMILK-POPCORN", category: "Formations" },
    { block: "SYM_CLAY_MUD_TICK", nss: "Clay / mud", uis: "Clay",
        layer: "SEDIMENT-CLAY-MUD", category: "Floor" },
    { block: "SYM_SAND_GRAVEL_DOT", nss: "Sand / gravel", uis: "Sand",
        layer: "SEDIMENT-SAND-GRAVEL", category: "Floor" },
    { block: "SYM_GUANO", nss: "Guano", uis: "Guano",
        layer: "GUANO", category: "Floor" },
    { block: "SYM_NORTH_ARROW", nss: "North arrow", uis: "North arrow",
        layer: "NORTH-ARROW", category: "Sheet" },
    { block: "SYM_FIXED_POINT", nss: "Fixed survey point", uis: "Survey point",
        layer: "CTRL-STATIONS", category: "Survey" },
    { block: "SYM_SECTION_MARKER", nss: "Cross-section marker", uis: "Cross-section line",
        layer: "CROSS-SECTION-MARKERS", category: "Survey" },
    { block: "SYM_CEILING_HEIGHT", nss: "Ceiling height", uis: "Ceiling height",
        layer: "CEILING-HEIGHT", category: "Annotation" },
    { block: "SYM_SIPHON", nss: "Siphon", uis: "Siphon",
        layer: "WATER-SIPHON", category: "Water" },
    { block: "SYM_SPRING", nss: "Spring / resurgence", uis: "Spring",
        layer: "WATER-SPRING-RESURGENCE", category: "Water" },
    { block: "SYM_DRIP_SEEP", nss: "Drip / seep", uis: "Water drip",
        layer: "WATER-DRIP-SEEP", category: "Water" },
    { block: "SYM_SUMP", nss: "Sump", uis: "Sump",
        layer: "WATER-POOL-SUMP", category: "Water" },
    { block: "SYM_FLOW_ARROW", nss: "Water flow arrow", uis: "Stream flow direction",
        layer: "WATER-FLOW-ARROWS", category: "Water" },
    { block: "SYM_SLOPE_TICK", nss: "Floor slope", uis: "Gradient arrow",
        layer: "FLOOR-SLOPE", category: "Floor" },
    { block: "SYM_CLIMB_ARROW", nss: "Climb", uis: "Climb direction",
        layer: "CLIMBS-CHIMNEYS", category: "Structure" },
    { block: "SYM_JOINT_TICK", nss: "Joint / fracture", uis: "Fissure / joint",
        layer: "GEOLOGY-JOINTS-FRACTURES", category: "Geology" }
];

CsSymbols.byBlock = function(blockName) {
    for (var i = 0; i < CsSymbols.CATALOG.length; i++) {
        if (CsSymbols.CATALOG[i].block === blockName) {
            return CsSymbols.CATALOG[i];
        }
    }
    return null;
};

CsSymbols.categories = function() {
    var seen = {};
    var out = [];
    for (var i = 0; i < CsSymbols.CATALOG.length; i++) {
        var c = CsSymbols.CATALOG[i].category;
        if (!seen[c]) {
            seen[c] = true;
            out.push(c);
        }
    }
    return out;
};

/**
 * Inserts one catalog symbol into the document at pos, on ITS layer,
 * inside the caller's transaction. QCAD context only.
 *
 * \return the block reference entity, or null when the block is
 *         missing from this drawing (i.e. not started from the
 *         template) -- callers report that in plain language.
 */
CsSymbols.insert = function(doc, entry, pos, scale, rotationRad) {
    var block = doc.queryBlock(entry.block);
    if (isNull(block)) {
        return null;
    }
    CsLayers.ensure(entry.layer);
    if (scale === undefined) {
        scale = 1.0;
    }
    if (rotationRad === undefined) {
        rotationRad = 0.0;
    }
    var data = new RBlockReferenceData(block.getId(), pos,
        new RVector(scale, scale), rotationRad, 1, 1, 1, 1);
    var ref = new RBlockReferenceEntity(doc, data);
    ref.setLayerId(doc.getLayerId(entry.layer));
    return ref;
};
