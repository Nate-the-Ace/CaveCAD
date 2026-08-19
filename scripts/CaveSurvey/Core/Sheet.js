// Sheet.js -- the map sheet: title block fields and the judge's
// checklist.
//
// Part of the Cave Survey Core library. FIELDS is pure data; the
// readers/writers and the checklist need a document.
//
// The field registry mirrors the NSS Cartography Salon core elements
// -- the published checklist of what a cave map must contain -- and
// maps each onto the TB_* blocks the plan template carries. "required"
// marks salon Core Elements; the rest are conventions worth having.

var CsSheet = {};

// id, block, label, required, hint
CsSheet.FIELDS = [
    { id: "caveName", block: "TB_CAVE_NAME", label: "Cave name",
        required: true,
        hint: "Unabbreviated. The salon docks points for abbreviations." },
    { id: "location", block: "TB_LOCATION", label: "Geographic location",
        required: true,
        hint: "State and county at minimum. Coordinates must name their system, units and datum." },
    { id: "surveyedBy", block: "TB_SURVEYED_BY", label: "Surveyed by",
        required: true,
        hint: "Who held the instruments. Credit is a required element, not a courtesy." },
    { id: "cartographyBy", block: "TB_CARTOGRAPHY_BY", label: "Cartography by",
        required: true,
        hint: "Who drew the map, with the year." },
    { id: "date", block: "TB_DATE", label: "Survey date(s)",
        required: true,
        hint: "The date range of the fieldwork, not the drafting." },
    { id: "surveyMethod", block: "TB_SURVEY_METHOD", label: "Survey method",
        required: false,
        hint: "Instruments used (e.g. Suunto and tape, DistoX) or the survey grade." },
    { id: "length", block: "TB_LENGTH", label: "Surveyed length",
        required: false,
        hint: "Total surveyed length -- Survey Stats computes this." },
    { id: "depth", block: "TB_DEPTH", label: "Vertical extent",
        required: false,
        hint: "Total vertical range -- Survey Stats computes this." },
    { id: "personnel", block: "TB_PERSONNEL", label: "Personnel",
        required: false,
        hint: "Full crew list, if different from Surveyed by." },
    { id: "surveyCode", block: "TB_SURVEY_CODE", label: "Survey grade",
        required: false,
        hint: "e.g. UISv2 5-c. Survey Stats derives the defensible one." },
    { id: "copyright", block: "TB_COPYRIGHT", label: "Copyright",
        required: false,
        hint: "If present, must carry a year." }
];

CsSheet.fieldById = function(id) {
    for (var i = 0; i < CsSheet.FIELDS.length; i++) {
        if (CsSheet.FIELDS[i].id === id) {
            return CsSheet.FIELDS[i];
        }
    }
    return null;
};

// ---------------------------------------------------------------------
// Reading and writing TB_* block text. The title block fields are
// one-off blocks holding text entities; editing the text inside the
// block definition is exactly what updating the sheet means.
// ---------------------------------------------------------------------

/** Text entities inside a named block definition: [entity]. */
CsSheet.textEntitiesInBlock = function(doc, blockName) {
    var block = doc.queryBlock(blockName);
    if (isNull(block)) {
        return [];
    }
    var out = [];
    var ids = doc.queryBlockEntities(block.getId());
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        if (isTextEntity(e) || isTextBasedEntity(e)) {
            out.push(e);
        }
    }
    return out;
};

/** The current text of a field, "" when absent/empty. */
CsSheet.readField = function(doc, field) {
    var texts = CsSheet.textEntitiesInBlock(doc, field.block);
    var parts = [];
    for (var i = 0; i < texts.length; i++) {
        var t = texts[i].getText();
        if (t !== undefined && t !== null && t !== "") {
            parts.push(t);
        }
    }
    return parts.join(" ");
};

/**
 * Writes a field's text, replacing the LAST text entity in the block
 * (the value line; earlier entities are usually the printed label).
 * Caller owns the transaction. Returns false when the block or a
 * text entity to write is missing.
 */
CsSheet.writeField = function(doc, op, field, value) {
    var texts = CsSheet.textEntitiesInBlock(doc, field.block);
    if (texts.length === 0) {
        return false;
    }
    var target = texts[texts.length - 1];
    target.setText(value);
    op.addObject(target, false);
    return true;
};

// ---------------------------------------------------------------------
// The sheet checklist -- "what would a judge mark missing?"
// ---------------------------------------------------------------------

/** True when a layer exists and holds at least one entity. */
CsSheet.layerHasEntities = function(doc, layerName) {
    if (!doc.hasLayer(layerName)) {
        return false;
    }
    var layerId = doc.getLayerId(layerName);
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (!isNull(e) && e.getLayerId() === layerId) {
            return true;
        }
    }
    return false;
};

/** True when at least one reference to blockName (or prefix match) exists. */
CsSheet.hasBlockReference = function(doc, blockNamePrefix) {
    var ids = doc.queryAllEntities(false, false, RS.EntityBlockRef);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        var block = doc.queryBlock(e.getReferencedBlockId());
        if (!isNull(block) && block.getName().indexOf(blockNamePrefix) === 0) {
            return true;
        }
    }
    return false;
};

/**
 * Runs the checklist. Returns [{item, ok, why}] in salon order --
 * plain language, each "why" telling the beginner what convention
 * asks for and how to satisfy it.
 */
CsSheet.checklist = function(doc) {
    var results = [];
    var add = function(item, ok, why) {
        results.push({ item: item, ok: ok, why: why });
    };

    var fieldFilled = function(id) {
        var f = CsSheet.fieldById(id);
        var v = CsSheet.readField(doc, f);
        // template placeholders look like "CAVE NAME" / "..." -- treat
        // pure placeholder-ish values as empty
        return v !== "" && !/^[.\s_-]*$/.test(v);
    };

    add("Cave name", fieldFilled("caveName"),
        "Every map names its cave, unabbreviated, most prominently on the sheet.");
    add("Geographic location", fieldFilled("location"),
        "State/county at minimum; coordinates must include system, units and datum.");
    add("Surveyor credit and dates", fieldFilled("surveyedBy") && fieldFilled("date"),
        "Who surveyed, and when the fieldwork was done.");
    add("Cartographer", fieldFilled("cartographyBy"),
        "Who drew the map, with the year.");
    add("North arrow", CsSheet.hasBlockReference(doc, "SYM_NORTH_ARROW") ||
        CsSheet.hasBlockReference(doc, "TB_NORTH_ARROW") ||
        CsSheet.layerHasEntities(doc, CsLayers.NORTH_ARROW),
        "True north preferred; a magnetic arrow must state its date.");
    add("Bar scale", CsSheet.hasBlockReference(doc, "TB_BAR_SCALE") ||
        CsSheet.layerHasEntities(doc, CsLayers.SCALE_BAR),
        "A graphic bar scale is required -- text-only scales lose points, ratio-only scales fail. Place Scale Bar does this.");
    add("Entrance", CsSheet.hasBlockReference(doc, "SYM_ENTRANCE") ||
        CsSheet.layerHasEntities(doc, CsLayers.ENTRANCE),
        "An obvious entrance, or a clearly indicated connection to the rest of the cave.");
    add("Legend", CsSheet.layerHasEntities(doc, CsLayers.LEGEND),
        "Non-standard symbols must be defined; Build Legend generates one from the symbols actually used.");
    add("Cross-sections", CsSheet.layerHasEntities(doc, CsLayers.CROSS_SECTION_MARKERS),
        "Cross-sections keyed to the plan with arrowed view direction. The single most-omitted element.");
    add("Border", CsSheet.layerHasEntities(doc, CsLayers.BORDER),
        "A border defines the document limits.");
    add("Vertical control", CsSheet.layerHasEntities(doc, "CEILING-HEIGHT") ||
        CsSheet.layerHasEntities(doc, "PITS-DOMES") ||
        CsSheet.layerHasEntities(doc, "FLOOR-SLOPE"),
        "Elevation must be readable somewhere: profile, ceiling heights, pit depths or slope ticks.");
    add("Passage walls", CsSheet.layerHasEntities(doc, CsLayers.WALLS_SURVEYED) ||
        CsSheet.layerHasEntities(doc, CsLayers.WALLS_INFERRED),
        "A centerline alone is a line plot, not a map -- trace walls from LRUD and scans.");

    return results;
};
