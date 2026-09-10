// CsLegend.js -- what a legend should say, and in what order.
//
// Part of the Cave Survey Core library. The row logic is pure -- it
// reads a `usage` object -- so it can be tested without a document;
// CsLegend.usage and CsLegend.sampleFor are the QCAD halves.
//
// WHAT CHANGED, AND WHY. Build Legend explained SYMBOLS only: the
// stalactites, the flow arrows, the pits. It never mentioned the lines,
// which is most of what a cave map is made of -- and the lines are
// where a beginner reader is most likely to be wrong, because a solid
// wall and a dashed one look like a drawing choice and are in fact a
// statement about how much of this map was measured. A legend that
// explains the stalactite and not the dashed wall explains the easy
// half.
//
// So a legend now carries three kinds of row:
//
//   line    a traced feature layer -- walls, ceiling, floor, breakdown
//   shape   a shaped line -- ledges, pit, flowstone, rimstone, slope --
//           drawn with its ornament, because the ornament IS the symbol
//   symbol  a catalogue block, as before
//
// AND IT SAYS WHAT THEY MEAN. One sentence per row, from CsHelp -- the
// same words the Feature Trace and Symbol Palette tooltips carry, so a
// caver is taught a convention once and then hands a reader a map that
// states it. Switch the sentences off with CaveSurvey/LegendExplain
// when a sheet is tight or a judge wants the terse form.
//
// NOTHING IS INVENTED, which was already this tool's rule and now
// covers three kinds of row instead of one: a feature the map does not
// use does not appear. A legend explaining a rimstone dam that is
// nowhere on the sheet is worse than no legend, because a reader will
// go looking for it.

var CsLegend = {};

/** How the rows are ordered.
 *
 *  LINES BEFORE SYMBOLS, and walls before everything: a reader meets
 *  the passage outline first, because that is what they are looking at
 *  first. Within the lines, the order is the order a cave is drawn --
 *  walls, then what is inside them, then the ornamented edges. */
CsLegend.FEATURE_ORDER = [
    "layer:WALLS-SURVEYED",
    "layer:WALLS-INFERRED",
    "layer:ENTRANCE",
    "layer:CEILING",
    "layer:FLOOR",
    "layer:BREAKDOWN",
    "layer:BREAKDOWN-BOUNDARY",
    "style:floorledge",
    "style:ceilingledge",
    "style:pit",
    "style:slope",
    "style:flowstone",
    "style:rimstone"
];

/** The setting that turns the one-line meanings off. On by default:
 *  the people this suite is for are the people who need them. */
CsLegend.SETTING_EXPLAIN = "CaveSurvey/LegendExplain";

/** How long a line sample is drawn, in feet of cave.
 *
 *  Long enough for a dash pattern to show at least one gap, and for
 *  EVERY shaped line to carry two ornaments -- a one-tick sample reads
 *  as a mistake rather than as a pattern. The widest spacing in
 *  CsShapeLine.STYLES is the slope fan at 6 ft, so the sample has to
 *  clear twice that; the ceiling ledge at 5 ft showed a single tick at
 *  the 8 ft this started at (seen on Truitt Cave, 2026-09-10). */
CsLegend.SAMPLE_FEET = 14.0;

/**
 * How big a symbol is drawn in the legend, in feet of cave.
 *
 * NORMALISED, not placed at scale 1. The shipped blocks are drawn about
 * a foot across; a symbol a caver draws for themselves may be anything
 * up to the palette's 10 ft working square, and at scale 1 Truitt
 * Cave's own mud slope came out taller than the five rows above it.
 * Every symbol in a legend has to read at the same size, because the
 * legend is a list and a list has rows.
 */
CsLegend.SYMBOL_FEET = 1.6;

/**
 * The scale that makes a symbol of half-size `radius` come out
 * `sizeFeet` across. The same arithmetic the Symbol Palette places by,
 * so a legend row and the thing it explains are drawn the same way.
 *
 * 1.0 when the radius is unknown -- an empty block, or a store that
 * could not be read. A symbol at its own scale is at worst the wrong
 * size; a symbol at scale 0 is invisible, which in a legend reads as a
 * row that forgot its picture.
 */
CsLegend.scaleForSize = function(sizeFeet, radius, perFoot) {
    if (isNull(radius) || !(radius > 0) || isNull(sizeFeet) ||
            !(sizeFeet > 0) || isNull(perFoot) || !(perFoot > 0)) {
        return 1.0;
    }
    return (sizeFeet * perFoot) / (2 * radius);
};

/** How wide the meaning sentence is allowed to run, in characters,
 *  before it wraps to another line. */
CsLegend.EXPLAIN_CHARS = 52;

/** Headings, so a reader can see the legend has two halves. Only
 *  printed when BOTH halves have rows -- a map with no symbols does
 *  not need to be told that the lines are lines. */
CsLegend.HEADING_LINES = "LINES";
CsLegend.HEADING_SYMBOLS = "SYMBOLS";

/**
 * The rows a legend should hold, in order, from what the map uses.
 *
 * `usage` is { features: { "<key>": count }, symbols: [catalog entry] }
 * -- the features keyed the way CsHelp.FEATURE is keyed, the symbols
 * already resolved to catalogue rows (the caller has the document and
 * the block names; this does not).
 *
 * Rows come back as:
 *   { kind: "heading", label }
 *   { kind: "line",   key, label, means, layer }
 *   { kind: "shape",  key, label, means, style }
 *   { kind: "symbol", key, label, means, block, layer }
 */
CsLegend.rowsFor = function(usage) {
    var lines = [];
    var symbols = [];
    var i, help;

    var features = isNull(usage) || isNull(usage.features) ?
        {} : usage.features;
    for (i = 0; i < CsLegend.FEATURE_ORDER.length; i++) {
        var key = CsLegend.FEATURE_ORDER[i];
        if (!(features[key] > 0)) {
            continue;
        }
        help = CsHelp.FEATURE[key];
        if (isNull(help)) {
            continue;   // a key nothing explains is a key nothing prints
        }
        var isShape = key.indexOf("style:") === 0;
        lines.push({
            kind: isShape ? "shape" : "line",
            key: key,
            label: help.label,
            means: help.means,
            style: isShape ? key.substring(6) : "",
            layer: isShape ? "" : key.substring(6)
        });
    }

    var used = isNull(usage) || isNull(usage.symbols) ? [] : usage.symbols;
    for (i = 0; i < used.length; i++) {
        var entry = used[i];
        help = CsHelp.forSymbol(entry.block);
        var label = entry.nss;
        if (!isNull(entry.uis) && entry.uis !== "" && entry.uis !== entry.nss) {
            label += "  (UIS: " + entry.uis + ")";
        }
        symbols.push({
            kind: "symbol",
            key: "symbol:" + entry.block,
            label: label,
            // A custom symbol has no entry in CsHelp and gets no
            // sentence -- it means whatever its author drew it to mean,
            // and the legend is not the place to guess.
            means: isNull(help) ? "" : help.means,
            block: entry.block,
            layer: entry.layer
        });
    }

    var out = [];
    var both = lines.length > 0 && symbols.length > 0;
    if (both) {
        out.push({ kind: "heading", label: CsLegend.HEADING_LINES });
    }
    for (i = 0; i < lines.length; i++) {
        out.push(lines[i]);
    }
    if (both) {
        out.push({ kind: "heading", label: CsLegend.HEADING_SYMBOLS });
    }
    for (i = 0; i < symbols.length; i++) {
        out.push(symbols[i]);
    }
    return out;
};

/** Greedy word wrap, returning the lines. Same fill CsPanel uses on a
 *  tooltip; a word longer than the budget gets a line to itself rather
 *  than being cut in half. */
CsLegend.wrap = function(text, budget) {
    var words = String(isNull(text) ? "" : text).split(" ");
    var lines = [];
    var line = "";
    for (var i = 0; i < words.length; i++) {
        if (words[i] === "") {
            continue;
        }
        if (line.length === 0) {
            line = words[i];
        } else if (line.length + 1 + words[i].length <= budget) {
            line += " " + words[i];
        } else {
            lines.push(line);
            line = words[i];
        }
    }
    if (line.length > 0) {
        lines.push(line);
    }
    return lines;
};

/** The sentences printed under one row's name -- none when the row has
 *  no meaning, or when explaining is switched off. */
CsLegend.explainLines = function(row, explain) {
    if (explain !== true || isNull(row.means) || row.means === "") {
        return [];
    }
    return CsLegend.wrap(row.means, CsLegend.EXPLAIN_CHARS);
};

/**
 * How tall one row is, in ROW UNITS (1 = the height of a plain row).
 *
 * A row grows to fit its sentence rather than the whole legend using
 * the tallest row's height: a legend of thirty rows spaced for the one
 * three-line meaning is a legend of mostly whitespace.
 */
CsLegend.heightOf = function(row, explain) {
    if (row.kind === "heading") {
        return 1.0;
    }
    var extra = CsLegend.explainLines(row, explain).length;
    return 1.0 + (extra * 0.6);
};

// ---------------------------------------------------------------------
// The QCAD half.
// ---------------------------------------------------------------------

/** Is the meanings column switched on? */
CsLegend.explaining = function() {
    try {
        return RSettings.getBoolValue(CsLegend.SETTING_EXPLAIN, true);
    } catch (e) {
        return true;
    }
};

/**
 * What this drawing actually uses.
 *
 * A feature counts when anything sits on its plan-frame layer OR on one
 * of that layer's per-view twins -- a ceiling traced only in the
 * elevation is still a ceiling this map draws, and a legend that missed
 * it would be lying by omission. A shaped line counts by its spines'
 * STYLE tag, which is the only thing that separates a flowstone from a
 * rimstone dam: they share a spine layer.
 *
 * QCAD only.
 */
CsLegend.usage = function(doc) {
    var out = { features: {}, symbols: [] };
    if (isNull(doc)) {
        return out;
    }

    // THE CAVER'S OWN SYMBOLS COUNT. CsSymbols.byBlock knows only the
    // shipped 28, so a map using a custom symbol had it silently left
    // out of the legend -- Truitt Cave has 32 mud slopes on it and the
    // legend never mentioned them, which is the one thing a legend
    // must not do. merged() is the catalogue plus the caver's own
    // library; it degrades to the shipped list wherever the store
    // cannot be read.
    var catalogue = {};
    var known = CsSymbols.CATALOG;
    try {
        var all = CsSymbols.merged();
        if (!isNull(all) && !isNull(all.entries) && all.entries.length > 0) {
            known = all.entries;
        }
    } catch (eMerged) {
        known = CsSymbols.CATALOG;
    }
    for (var k = 0; k < known.length; k++) {
        catalogue[known[k].block] = known[k];
    }

    var seenSymbol = {};
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        // The generated legend does not count as usage -- rebuilding
        // would otherwise keep every row it drew last time alive.
        if (CsTags.get(e, CsLegend.TAG) !== "") {
            continue;
        }
        var layer = CsBind.layerNameOf(doc, e);
        // planBaseOf answers NULL for a layer that is already in the
        // plan frame -- it exists to turn PROFILE-CEILING into CEILING,
        // not to echo names back. Reading its null as the answer meant
        // every plan-frame feature registered as "layer:null" and no
        // legend ever mentioned the surveyed walls. Caught by
        // tests/build_legend_run.js on its first run.
        var base = layer;
        try {
            var twinBase = CsLayers.planBaseOf(layer);
            if (!isNull(twinBase) && twinBase !== "") {
                base = twinBase;
            }
        } catch (eBase) {
            base = layer;
        }
        var key = "layer:" + base;
        if (!isNull(CsHelp.FEATURE[key])) {
            out.features[key] = (out.features[key] || 0) + 1;
        }
        var style = CsTags.get(e, CsShapeLine.KEY.STYLE);
        if (style !== "" && !isNull(CsShapeLine.STYLES[style])) {
            var skey = "style:" + style;
            out.features[skey] = (out.features[skey] || 0) + 1;
        }
        if (e.getType() === RS.EntityBlockRef) {
            try {
                var block = doc.queryBlock(e.getReferencedBlockId());
                var entry = isNull(block) ? null :
                    catalogue[String(block.getName())];
                if (!isNull(entry) && seenSymbol[entry.block] !== true) {
                    seenSymbol[entry.block] = true;
                    out.symbols.push(entry);
                }
            } catch (eBlock) {
            }
        }
    }

    // Catalogue order, so two runs over the same map give the same
    // legend -- entity order is whatever the storage hands back. The
    // shipped symbols first in their own order, then the caver's own by
    // name: a legend where somebody's custom symbol had shuffled into
    // the middle of the NSS set would read as though it were one.
    var ordered = [];
    var c;
    for (c = 0; c < CsSymbols.CATALOG.length; c++) {
        if (seenSymbol[CsSymbols.CATALOG[c].block] === true) {
            ordered.push(CsSymbols.CATALOG[c]);
            seenSymbol[CsSymbols.CATALOG[c].block] = "listed";
        }
    }
    var mine = [];
    for (c = 0; c < known.length; c++) {
        if (seenSymbol[known[c].block] === true) {
            mine.push(known[c]);
            seenSymbol[known[c].block] = "listed";
        }
    }
    mine.sort(function(a, b) {
        return String(a.nss) < String(b.nss) ? -1 :
            (String(a.nss) > String(b.nss) ? 1 : 0);
    });
    out.symbols = ordered.concat(mine);
    return out;
};

/** The tag every generated legend entity carries, so the next run can
 *  clear exactly what the last one drew. */
CsLegend.TAG = "LegendRow";
