// CsSheetSetup.js -- turning a drawn cave into a finished SHEET: the
// plot scale, the border, the scale bar's divisions, the text heights
// that will still be readable on paper, and the credits the map owes
// the people who surveyed it.
//
// Part of the Cave Survey Core library. Every function here is pure --
// it takes numbers and a survey and answers numbers and strings -- so
// the arithmetic that decides whether a map prints legibly is testable
// without a document.
//
// THE PROBLEM THIS SOLVES. A cave is drawn at 1 unit = 1 foot, and a
// sheet is measured in inches: the NSS template's border is 36 x 24,
// its title block text 0.14, its scale bar 3 long. Those are INCHES of
// paper sitting in the same model space as a cave 1400 feet across, and
// the template ships them as reference pieces for a cartographer to
// copy and scale by hand. A beginner does not know the plot scale is
// the number that reconciles the two, so the pieces stay in the corner
// of the template and the map goes out with no scale bar at all --
// which is exactly what Check Map finds on real drawings.
//
// So: pick a plot scale, and every sheet measurement is an inch of
// paper multiplied by it. 0.14 inch of title block text at 1" = 50 ft
// is 7 feet of drawing, and prints at 0.14 inch. That one multiplication
// is the whole idea, and it is why nothing here is measured in "units".

var CsSheetSetup = {};

/**
 * The plot scales a cave map is drawn at, in FEET PER INCH.
 *
 * Standard values, not whatever number makes the cave exactly fill the
 * paper. A reader who knows caves can look at "1 inch = 50 feet" and
 * estimate a passage without reading the bar at all, and a survey group
 * whose maps all use round scales can lay two of them side by side.
 */
/**
 * Every plot scale offered, imperial first and metric after.
 *
 * `feetPerInch` is the one number the rest of this file works in: feet
 * of cave per inch of paper. An imperial scale states it outright
 * ("1\" = 50 ft"); a metric one states a RATIO instead, because that
 * is how a metric map says it -- 1:500 means one of anything on paper
 * is five hundred of the same thing in the cave, and it is the same
 * scale whether the reader has a ruler in millimetres or inches. One
 * inch of paper at 1:500 is 500 inches of cave, which is 500/12 feet,
 * and that is the whole conversion.
 *
 * METRIC AT THE BOTTOM, for the reason the metric papers are: a list
 * is a statement about what you will probably want, and these caves
 * are surveyed in feet.
 */
CsSheetSetup.SCALE_ROWS = [
    { label: "1\" = 10 ft", feetPerInch: 10, metric: false },
    { label: "1\" = 20 ft", feetPerInch: 20, metric: false },
    { label: "1\" = 25 ft", feetPerInch: 25, metric: false },
    { label: "1\" = 30 ft", feetPerInch: 30, metric: false },
    { label: "1\" = 40 ft", feetPerInch: 40, metric: false },
    { label: "1\" = 50 ft", feetPerInch: 50, metric: false },
    { label: "1\" = 60 ft", feetPerInch: 60, metric: false },
    { label: "1\" = 80 ft", feetPerInch: 80, metric: false },
    { label: "1\" = 100 ft", feetPerInch: 100, metric: false },
    { label: "1\" = 150 ft", feetPerInch: 150, metric: false },
    { label: "1\" = 200 ft", feetPerInch: 200, metric: false },
    { label: "1\" = 300 ft", feetPerInch: 300, metric: false },
    { label: "1\" = 400 ft", feetPerInch: 400, metric: false },
    { label: "1\" = 500 ft", feetPerInch: 500, metric: false },
    { label: "1:100", feetPerInch: 100 / 12, metric: true },
    { label: "1:200", feetPerInch: 200 / 12, metric: true },
    { label: "1:250", feetPerInch: 250 / 12, metric: true },
    { label: "1:500", feetPerInch: 500 / 12, metric: true },
    { label: "1:1000", feetPerInch: 1000 / 12, metric: true },
    { label: "1:2000", feetPerInch: 2000 / 12, metric: true }
];

/** The scales as bare feet-per-inch, in the same order. Derived, so
 *  the two can never disagree about what is offered. */
CsSheetSetup.SCALES = (function() {
    var out = [];
    for (var i = 0; i < CsSheetSetup.SCALE_ROWS.length; i++) {
        out.push(CsSheetSetup.SCALE_ROWS[i].feetPerInch);
    }
    return out;
})();

/** The row one feet-per-inch belongs to, or null. */
CsSheetSetup.scaleRow = function(feetPerInch) {
    for (var i = 0; i < CsSheetSetup.SCALE_ROWS.length; i++) {
        if (Math.abs(CsSheetSetup.SCALE_ROWS[i].feetPerInch -
                feetPerInch) < 1e-9) {
            return CsSheetSetup.SCALE_ROWS[i];
        }
    }
    return null;
};

/** Is this scale a metric one? Decides whether the bar counts metres
 *  and whether the caption reads as a ratio. */
CsSheetSetup.isMetric = function(feetPerInch) {
    var row = CsSheetSetup.scaleRow(feetPerInch);
    return !isNull(row) && row.metric === true;
};

/** Metres in a foot, for the metric bar. */
CsSheetSetup.M_PER_FT = 0.3048;

/** Inches in a millimetre, for the metric papers below. */
CsSheetSetup.MM = 1 / 25.4;

/**
 * The sheets a cave map is plotted on. ALWAYS IN INCHES internally,
 * whatever the paper is called: the plot scale is feet per inch, and
 * one unit through the whole file beats two and a conversion at every
 * use.
 *
 * IMPERIAL FIRST, METRIC AFTER (Nathan, 2026-09-10). This suite's
 * caves are surveyed in feet and plotted on ARCH D; the ISO papers are
 * here because a cave map is not only a North American thing, and they
 * are at the bottom because a list is a statement about what you will
 * probably want. The metric names carry their MILLIMETRES, because
 * that is what a caver reaching for A1 recognises -- the inches are
 * this file's business, not theirs.
 */
CsSheetSetup.SHEETS = [
    { name: "ANSI A -- 11 x 8.5", w: 11, h: 8.5 },
    { name: "ANSI B -- 17 x 11", w: 17, h: 11 },
    { name: "ANSI C -- 22 x 17", w: 22, h: 17 },
    { name: "ARCH C -- 24 x 18", w: 24, h: 18 },
    { name: "ANSI D -- 34 x 22", w: 34, h: 22 },
    { name: "ARCH D -- 36 x 24", w: 36, h: 24 },
    { name: "ARCH E -- 48 x 36", w: 48, h: 36 },
    { name: "ISO A4 -- 297 x 210 mm",
        w: 297 * CsSheetSetup.MM, h: 210 * CsSheetSetup.MM },
    { name: "ISO A3 -- 420 x 297 mm",
        w: 420 * CsSheetSetup.MM, h: 297 * CsSheetSetup.MM },
    { name: "ISO A2 -- 594 x 420 mm",
        w: 594 * CsSheetSetup.MM, h: 420 * CsSheetSetup.MM },
    { name: "ISO A1 -- 841 x 594 mm",
        w: 841 * CsSheetSetup.MM, h: 594 * CsSheetSetup.MM },
    { name: "ISO A0 -- 1189 x 841 mm",
        w: 1189 * CsSheetSetup.MM, h: 841 * CsSheetSetup.MM }
];

/** The NSS template's own sheet, and so the default. */
CsSheetSetup.DEFAULT_SHEET = "ARCH D -- 36 x 24";

/** How much of the sheet is kept clear of the cave, as a fraction of
 *  the sheet's short side. The title block, the legend and the scale
 *  bar have to live somewhere, and a map drawn to the paper's edge
 *  cannot be bound, trimmed or held. */
CsSheetSetup.MARGIN_FRACTION = 0.12;

/** Printed text heights, in INCHES on the finished sheet. Everything
 *  drawn by this tool is one of these multiplied by the plot scale.
 *  The values are the NSS template's own, so a sheet this tool builds
 *  and one assembled by hand from the template's reference pieces come
 *  out the same size. */
CsSheetSetup.TEXT = {
    caveName: 0.42,
    heading: 0.18,
    body: 0.14,
    small: 0.11
};

/** The scale bar, in inches of paper. */
CsSheetSetup.BAR = {
    length: 3.0,      // how long the bar is drawn
    height: 0.16,     // the depth of the alternating blocks
    tick: 0.06        // how far the labels sit below it
};

CsSheetSetup.sheetByName = function(name) {
    for (var i = 0; i < CsSheetSetup.SHEETS.length; i++) {
        if (CsSheetSetup.SHEETS[i].name === name) {
            return CsSheetSetup.SHEETS[i];
        }
    }
    return null;
};

/**
 * The smallest standard scale that fits a cave of this size on this
 * sheet, or the largest scale there is when nothing fits.
 *
 * SMALLEST means most detail: 1" = 20 ft shows more than 1" = 100 ft,
 * so the answer is the first scale in the list that works rather than
 * the one that leaves the least white space.
 *
 * The cave is measured either way round -- a long thin cave on a
 * landscape sheet may only fit turned -- and the answer says whether it
 * had to be turned, because that is a decision a cartographer must make
 * knowingly rather than discover at the plotter.
 */
CsSheetSetup.fit = function(caveWidthFeet, caveHeightFeet, sheet,
        footerInches) {
    var margin = Math.min(sheet.w, sheet.h) * CsSheetSetup.MARGIN_FRACTION;
    var footer = (isNull(footerInches) || !(footerInches > 0)) ? 0 :
        footerInches;
    var usableW = sheet.w - margin * 2;
    // The FOOTER is the band the title block, scale bar and north arrow
    // occupy. Counting it as usable is how a cave comes out overlapping
    // its own credits: Truitt Cave's title block is four inches tall
    // and the margin is under three, so the block rose into the map.
    var usableH = sheet.h - margin * 2 - footer;
    var w = Math.max(caveWidthFeet, 0.0001);
    var h = Math.max(caveHeightFeet, 0.0001);
    for (var i = 0; i < CsSheetSetup.SCALES.length; i++) {
        var s = CsSheetSetup.SCALES[i];
        if (w / s <= usableW && h / s <= usableH) {
            return { scale: s, turned: false, fits: true };
        }
        if (h / s <= usableW && w / s <= usableH) {
            return { scale: s, turned: true, fits: true };
        }
    }
    return {
        scale: CsSheetSetup.SCALES[CsSheetSetup.SCALES.length - 1],
        turned: false,
        fits: false
    };
};

/**
 * The scale bar's divisions: a round number of feet per block, and
 * enough blocks to fill the bar.
 *
 * ROUND FEET PER BLOCK, not a round bar length. A bar three inches long
 * at 1" = 30 ft is 90 feet, which divides into 6 blocks of 15 -- and 15
 * is a number a reader can count in their head. The alternative, a bar
 * of exactly 100 ft, comes out an odd length on the paper and buys
 * nothing.
 */
CsSheetSetup.barFor = function(scale) {
    // A METRIC SCALE COUNTS METRES. A bar under "1:500" marked off in
    // feet asks a reader to convert in their head, which is the one
    // thing a scale bar exists to spare them.
    var metric = CsSheetSetup.isMetric(scale);
    var perDisplay = metric ? CsSheetSetup.M_PER_FT : 1;   // display / ft
    var wanted = CsSheetSetup.BAR.length * scale * perDisplay;
    var steps = metric ?
        [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000] :
        [1, 2, 5, 10, 15, 20, 25, 50, 100, 200, 250, 500, 1000];
    var best = null;
    for (var i = 0; i < steps.length; i++) {
        var blocks = Math.floor(wanted / steps[i]);
        if (blocks < 2) {
            continue;
        }
        // Four to eight blocks reads as a scale bar; two is a domino
        // and twenty is a ruler nobody counts.
        var score = Math.abs(blocks - 6);
        if (blocks > 10) {
            continue;
        }
        if (best === null || score < best.score) {
            best = { perBlock: steps[i], blocks: blocks, score: score };
        }
    }
    if (best === null) {
        best = { perBlock: Math.max(1, Math.round(wanted / 4)), blocks: 4 };
    }
    return {
        // What the LABELS say, in the display unit.
        perBlock: best.perBlock,
        blocks: best.blocks,
        unit: metric ? "M" : "FT",
        // And what the GEOMETRY is drawn from, always in feet: the
        // drawing is measured in feet whatever the sheet is captioned
        // in, and mixing the two is how a bar comes out the wrong
        // length while its numbers look right.
        perBlockFeet: best.perBlock / perDisplay,
        totalFeet: (best.perBlock * best.blocks) / perDisplay
    };
};

/**
 * The tag that carries a title block field's WHOLE value on the first
 * of its wrapped lines.
 *
 * Wrapping a field across several text entities means the drawing no
 * longer holds the value anywhere in one piece: CsSheet.readField finds
 * the first fragment and answers that, so a second run of Sheet Setup
 * read back "SURVEYED BY: JEANNE PARK, MATT LEWIS, TIM" and quietly
 * dropped eighteen of Truitt Cave's twenty-one surveyors. Caught by
 * tests/sheet_setup_run.js, which counted the sheet shrinking.
 *
 * So the full text rides along on the first line as its own tag, and a
 * re-run prefers it. CsSheet is left alone: it answers what is VISIBLE
 * on the sheet, which is what Survey Stats and the title block editor
 * want, and this is a fact about how the line was printed.
 */
CsSheetSetup.TAG_FULL = "TBFull";

/** How wide the title block column is, in inches of paper. */
// Six inches of a thirty-six inch sheet. Wider than it first was:
// at 4.2 inches Truitt Cave's twenty-one surveyors wrapped to six
// lines and the block grew taller than the margin it lives in.
CsSheetSetup.TITLE_INCHES = 6.0;

/** How far apart stacked lines sit, as a multiple of their own height. */
CsSheetSetup.LINE_SPACING = 1.9;

/**
 * How many characters of a given printed size fit across the title
 * block column.
 *
 * 0.55 of the height per character is the usual rule of thumb for a
 * plain stroke font, and it only has to be close: the cost of being a
 * little narrow is a line break one word early, and the cost of being
 * too wide is a name running off the paper.
 */
CsSheetSetup.charsPerLine = function(textInches) {
    if (isNull(textInches) || !(textInches > 0)) {
        return 40;
    }
    return Math.max(8,
        Math.floor(CsSheetSetup.TITLE_INCHES / (textInches * 0.55)));
};

/**
 * THE TITLE BLOCK, LAID OUT AS LINES.
 *
 * Pure, and separate from the drawing, because this is where a title
 * block goes wrong: Truitt Cave credits twenty-one surveyors, and the
 * first version of this tool put all of them in ONE text entity, which
 * wrapped inside itself and printed over the six lines below it. Twenty
 * names is not an edge case for a cave map -- it is what a real survey
 * looks like -- so the wrapping is done here, one line at a time, and
 * the caller only has to walk the list.
 *
 * `values` is { fieldId: text }; a field with nothing in it is printed
 * anyway when it is REQUIRED (an empty line is an invitation to type
 * one) and skipped when it is not.
 *
 * Each line is { text, inches, fieldId }. Only the FIRST line of a
 * field carries the fieldId, so the tag that lets Survey Stats stamp a
 * value later lands once rather than on every wrapped fragment.
 */
CsSheetSetup.titleLines = function(values, fields) {
    var out = [];
    var rows = isNull(fields) ? CsSheet.FIELDS : fields;
    var have = isNull(values) ? {} : values;
    for (var i = 0; i < rows.length; i++) {
        var field = rows[i];
        var value = have.hasOwnProperty(field.id) ?
            String(have[field.id]) : "";
        var blank = value.replace(/\s/g, "") === "";
        if (blank && field.required !== true) {
            continue;
        }
        var isName = (field.id === "caveName");
        var inches = isName ? CsSheetSetup.TEXT.caveName :
            CsSheetSetup.TEXT.body;
        var full = isName ? (blank ? "CAVE NAME" : value) :
            (field.prefix + value);
        var wrapped = CsSheetSetup.wrapText(full,
            CsSheetSetup.charsPerLine(inches));
        for (var w = 0; w < wrapped.length; w++) {
            out.push({
                text: wrapped[w],
                inches: inches,
                // The tag goes on the first line only: one field, one
                // taggged entity, however many lines it took to print.
                fieldId: (w === 0) ? field.id : ""
            });
        }
    }
    return out;
};

/** How tall a stack of title lines is, in inches of paper. */
CsSheetSetup.linesHeight = function(lines) {
    var total = 0;
    for (var i = 0; i < lines.length; i++) {
        total += lines[i].inches * CsSheetSetup.LINE_SPACING;
    }
    return total;
};

/** Greedy word wrap. A word longer than the budget keeps its own line
 *  rather than being cut in half -- a surname is not divisible. */
CsSheetSetup.wrapText = function(text, budget) {
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
    return lines.length === 0 ? [""] : lines;
};

/** A printed height in inches, as drawing feet at this plot scale. */
CsSheetSetup.atScale = function(inches, scale) {
    return inches * scale;
};

/** What the bar is captioned with: "1" = 50 FT", or "1:500". */
CsSheetSetup.scaleText = function(scale) {
    var row = CsSheetSetup.scaleRow(scale);
    if (!isNull(row)) {
        return "SCALE:  " + row.label.toUpperCase();
    }
    return "SCALE:  1\" = " + scale + " FT";
};

/** How far apart two sheets sit in the drawing, in inches of paper.
 *  Wide enough that nobody mistakes one border for the other's edge,
 *  and that a plotter set to "window" cannot catch both. */
CsSheetSetup.SHEET_GUTTER = 2.0;

/** What the second sheet is for. Its own kind, because the two sheets
 *  do not carry the same furniture: an elevation has no north. */
CsSheetSetup.PLAN_SHEET = "plan";
CsSheetSetup.ELEVATION_SHEET = "elevation";

/**
 * Where the elevation sheet is drawn IN THE PREVIEW: the same paper, at
 * the same scale, beside the plan's.
 *
 * TWO SHEETS, NOT ONE BIGGER ONE. The elevation has to be drawn at the
 * plan's scale -- a map carrying two scales is a lie -- and a cave
 * whose plan fits ARCH D at 1" = 40 rarely has room left for eight
 * elevation bands at the same scale. The alternatives were a scale step
 * nobody asked for or paper nobody can print.
 *
 * THE PREVIEW ONLY. The two sheets are separate FILES, each holding one
 * sheet at its own origin; this places them side by side so the panel
 * can show both pages at once, which is how a cartographer thinks about
 * them even though no drawing ever holds both.
 */
CsSheetSetup.elevationSheetBox = function(planBox, scale) {
    var gutter = CsSheetSetup.SHEET_GUTTER * scale;
    // STACKED, NOT SIDE BY SIDE (Nathan, 2026-09-10). A dock is tall
    // and narrow; two landscape pages beside each other in it come out
    // as two postage stamps. One above the other fills the width, and
    // the width is what a landscape page needs.
    return {
        minX: planBox.minX,
        maxX: planBox.maxX,
        minY: planBox.minY - gutter - planBox.height,
        maxY: planBox.minY - gutter,
        width: planBox.width,
        height: planBox.height,
        footer: planBox.footer,
        margin: planBox.margin
    };
};

/**
 * The sheet's own rectangle in DRAWING coordinates, centred on the
 * cave.
 *
 * `turned` swaps the paper, not the cave: rotating a surveyed cave to
 * make it fit would rotate north with it, and a map whose north arrow
 * is a lie is worse than one that did not fit the paper.
 */
CsSheetSetup.borderBox = function(caveBox, sheet, scale, turned,
        footerInches) {
    var w = (turned === true ? sheet.h : sheet.w) * scale;
    var h = (turned === true ? sheet.w : sheet.h) * scale;
    var footer = ((isNull(footerInches) || !(footerInches > 0)) ? 0 :
        footerInches) * scale;
    var cx = (caveBox.minX + caveBox.maxX) / 2;
    // Centred in the space ABOVE the footer, not in the whole sheet.
    // The SHEET drops by half the footer, which is the same thing as
    // the cave rising by half of it: the band the title block occupies
    // is reserved rather than shared, and the credits stop printing
    // over the passage.
    var cy = (caveBox.minY + caveBox.maxY) / 2 - footer / 2;
    return {
        minX: cx - w / 2, maxX: cx + w / 2,
        minY: cy - h / 2, maxY: cy + h / 2,
        width: w, height: h,
        footer: footer,
        margin: Math.min(sheet.w, sheet.h) *
            CsSheetSetup.MARGIN_FRACTION * scale
    };
};

// ---------------------------------------------------------------------
// THE PREVIEW.
//
// Pure: it answers rectangles, and the panel paints them. A caver
// choosing paper and scale is answering "will this fit, and where will
// everything sit", and answering that by building the file and looking
// is a slow way to find out you wanted the next size up.
//
// ROUGH ON PURPOSE. The boxes are where things go, not what they look
// like: a title block is a block, the cave is its own footprint, the
// elevation is its bands. A preview that tried to be the drawing would
// be the drawing, slowly.
// ---------------------------------------------------------------------

/**
 * Every rectangle a sheet layout puts on the paper, in DRAWING units.
 *
 * \param state {
 *   caveBox      the plan's own extents
 *   sheet        a row from CsSheetSetup.SHEETS
 *   scale        feet per inch
 *   turned       paper turned?
 *   footerInches how tall the furniture band is
 *   wants        {border, bar, north, title}
 *   elevation    true to include the second sheet
 *   bands        [{minX, minY, maxX, maxY}] the elevation's own boxes
 * }
 *
 * \return { bounds: {minX, minY, maxX, maxY}, items: [{kind, box}] }
 *
 * `kind` is one of "sheet", "elevation-sheet", "cave", "title", "bar",
 * "north", "band" -- the panel colours by it and the tests read it.
 */
CsSheetSetup.preview = function(state) {
    var out = { bounds: null, items: [] };
    if (isNull(state) || isNull(state.caveBox) || isNull(state.sheet)) {
        return out;
    }
    var scale = state.scale;
    var wants = isNull(state.wants) ? {} : state.wants;
    var box = CsSheetSetup.borderBox(state.caveBox, state.sheet, scale,
        state.turned === true, state.footerInches);

    var add = function(kind, minX, minY, maxX, maxY) {
        out.items.push({ kind: kind,
            box: { minX: minX, minY: minY, maxX: maxX, maxY: maxY } });
    };

    add("sheet", box.minX, box.minY, box.maxX, box.maxY);
    add("cave", state.caveBox.minX, state.caveBox.minY,
        state.caveBox.maxX, state.caveBox.maxY);

    var inch = function(v) { return v * scale; };
    var foot = box.minY + box.margin * 0.55;

    if (wants.title === true) {
        var titleH = isNull(state.footerInches) ? 2 : state.footerInches;
        add("title", box.minX + box.margin,
            box.minY + box.margin * 0.35,
            box.minX + box.margin + inch(CsSheetSetup.TITLE_INCHES),
            box.minY + box.margin * 0.35 + inch(titleH));
    }
    if (wants.bar === true) {
        var barX = box.minX + box.width * 0.45;
        add("bar", barX, foot, barX + inch(CsSheetSetup.BAR.length),
            foot + inch(CsSheetSetup.BAR.height * 3));
    }
    if (wants.north === true) {
        var nx = box.maxX - box.margin;
        add("north", nx - inch(0.2), foot, nx + inch(0.2),
            foot + inch(1.4));
    }

    if (state.elevation === true) {
        var second = CsSheetSetup.elevationSheetBox(box, scale);
        add("elevation-sheet", second.minX, second.minY,
            second.maxX, second.maxY);
        var bands = isNull(state.bands) ? [] : state.bands;
        if (bands.length > 0) {
            // The bands as they will land: the region keeps its own
            // stacking and is slid into the sheet's top-left inset,
            // which is exactly what SheetSetup.moveElevation does.
            var bMinX = null, bMaxY = null;
            for (var i = 0; i < bands.length; i++) {
                if (bMinX === null || bands[i].minX < bMinX) {
                    bMinX = bands[i].minX;
                }
                if (bMaxY === null || bands[i].maxY > bMaxY) {
                    bMaxY = bands[i].maxY;
                }
            }
            var inset = (second.maxX - second.minX) *
                CsSheetSetup.MARGIN_FRACTION;
            var dx = (second.minX + inset) - bMinX;
            var dy = (second.maxY - inset) - bMaxY;
            for (i = 0; i < bands.length; i++) {
                add("band", bands[i].minX + dx, bands[i].minY + dy,
                    bands[i].maxX + dx, bands[i].maxY + dy);
            }
        }
    }

    for (var k = 0; k < out.items.length; k++) {
        var b = out.items[k].box;
        if (out.bounds === null) {
            out.bounds = { minX: b.minX, minY: b.minY,
                maxX: b.maxX, maxY: b.maxY };
        } else {
            out.bounds.minX = Math.min(out.bounds.minX, b.minX);
            out.bounds.minY = Math.min(out.bounds.minY, b.minY);
            out.bounds.maxX = Math.max(out.bounds.maxX, b.maxX);
            out.bounds.maxY = Math.max(out.bounds.maxY, b.maxY);
        }
    }
    return out;
};

/**
 * Does everything the preview holds actually sit on its own paper?
 *
 * The one question a preview exists to answer before a file is built.
 * A band hanging off the elevation sheet is the common way to be wrong:
 * the elevation is drawn at the plan's scale and does not shrink to
 * fit, so a long cave overruns and the answer is bigger paper.
 */
CsSheetSetup.previewFits = function(preview) {
    var sheets = [];
    var i, item;
    for (i = 0; i < preview.items.length; i++) {
        item = preview.items[i];
        if (item.kind === "sheet" || item.kind === "elevation-sheet") {
            sheets.push(item.box);
        }
    }
    var out = { fits: true, spilling: [] };
    for (i = 0; i < preview.items.length; i++) {
        item = preview.items[i];
        if (item.kind === "sheet" || item.kind === "elevation-sheet") {
            continue;
        }
        var inside = false;
        for (var s = 0; s < sheets.length; s++) {
            if (item.box.minX >= sheets[s].minX - 0.001 &&
                    item.box.maxX <= sheets[s].maxX + 0.001 &&
                    item.box.minY >= sheets[s].minY - 0.001 &&
                    item.box.maxY <= sheets[s].maxY + 0.001) {
                inside = true;
            }
        }
        if (!inside) {
            out.fits = false;
            if (out.spilling.indexOf(item.kind) === -1) {
                out.spilling.push(item.kind);
            }
        }
    }
    return out;
};

// ---------------------------------------------------------------------
// WHAT THE TITLE BLOCK CAN BE TOLD WITHOUT ASKING.
//
// Everything below reads the survey the drawing already holds. Nothing
// is invented, and one field is deliberately never filled in at all --
// see locationFor.
// ---------------------------------------------------------------------

/** "2024-04-06 to 2024-11-03", or the one date, or "". */
CsSheetSetup.datesFor = function(survey) {
    if (isNull(survey) || isNull(survey.trips)) {
        return "";
    }
    var seen = [];
    for (var i = 0; i < survey.trips.length; i++) {
        var d = survey.trips[i].date;
        if (isNull(d) || String(d) === "") {
            continue;
        }
        if (seen.indexOf(String(d)) === -1) {
            seen.push(String(d));
        }
    }
    if (seen.length === 0) {
        return "";
    }
    seen.sort();
    return seen.length === 1 ? seen[0] :
        (seen[0] + " to " + seen[seen.length - 1]);
};

/**
 * Everyone who appears on a trip team, in the order they first
 * surveyed, comma separated.
 *
 * EVERY name, never a count and never "and others". The people who
 * carried the tape are the reason the map exists, and a map that
 * credits three of nine is a map that has picked favourites. A team
 * field too long for the title block is a layout problem, and layout
 * problems are the cartographer's to solve.
 */
CsSheetSetup.surveyedByFor = function(survey) {
    if (isNull(survey) || isNull(survey.trips)) {
        return "";
    }
    var names = [];
    for (var i = 0; i < survey.trips.length; i++) {
        var team = survey.trips[i].team;
        if (isNull(team) || String(team) === "") {
            continue;
        }
        var parts = String(team).split(",");
        for (var p = 0; p < parts.length; p++) {
            var name = parts[p].replace(/^\s+|\s+$/g, "");
            if (name !== "" && names.indexOf(name) === -1) {
                names.push(name);
            }
        }
    }
    return names.join(", ");
};

/**
 * THE LOCATION FIELD IS NEVER FILLED IN BY THIS TOOL. It answers the
 * empty string, always, and the tool prints the field with nothing in
 * it for a human to complete.
 *
 * This is the suite's first rule, in the one place most likely to break
 * it: the drawing usually knows exactly where the cave is (the geo
 * anchor, the aerial imagery it fetched), and the title block asks for
 * a location. Filling it automatically would put an entrance's
 * coordinates on every sheet anybody plotted, forever, without one
 * decision being made by a person.
 *
 * A cartographer who wants "SMITH COUNTY, TENNESSEE" on the sheet types
 * it. That is one sentence of work and a deliberate act.
 */
CsSheetSetup.locationFor = function() {
    return "";
};

/** What this tool can fill in, as { fieldId: value }. Fields it has no
 *  answer for are absent rather than blank, so a value already typed
 *  into the drawing is never overwritten with nothing. */
CsSheetSetup.autoFill = function(survey, stats, grade) {
    var out = {};
    if (!isNull(survey)) {
        var name = survey.caveName || survey.name || "";
        if (String(name) !== "") {
            out.caveName = String(name);
        }
        var by = CsSheetSetup.surveyedByFor(survey);
        if (by !== "") {
            out.surveyedBy = by;
        }
        var dates = CsSheetSetup.datesFor(survey);
        if (dates !== "") {
            out.date = dates;
        }
    }
    if (!isNull(stats) && !isNull(survey)) {
        var unit = survey.distanceUnit || "ft";
        out.length = CsReport.length(stats.surveyedLength, unit);
        out.depth = CsReport.length(stats.depth, unit);
    }
    if (!isNull(grade) && !isNull(grade.uis) && String(grade.uis) !== "") {
        out.surveyCode = String(grade.uis);
    }
    return out;
};

// ---------------------------------------------------------------------
// THE QCAD HALF. Everything above is pure and is where the arithmetic
// lives; this is the one thing that has to read a document, and it is
// here rather than in the tool because Core needs it too:
// CsProfileDraw asks where the elevation sheet is every time it draws.
// ---------------------------------------------------------------------

/** Where a cave's sheet drawings live, under the cave's own folder. */
CsSheetSetup.SHEETS_FOLDER = "sheets";

/**
 * The file a cave's sheet is written to.
 *
 * A SEPARATE FILE, not the drawing (Nathan, 2026-09-10: "do NOT modify
 * the layout of the original map file"). The record drawing is the
 * cave: survey, trips, tracing, the elevation where the generator puts
 * it. A sheet is a DECISION about how to present that on paper at one
 * scale on one size of paper -- and laying one out moves the elevation
 * and adds a border round everything, which is a layout nobody asked
 * the record to carry.
 *
 * In its own subfolder rather than beside the drawing, because a second
 * .dxf in a cave folder is a second candidate for "which file IS this
 * cave" -- CsShelf.pickDrawing has to choose, and a generated sheet is
 * the wrong answer.
 */
CsSheetSetup.sheetPathFor = function(caveFolder, caveName, kind) {
    var folder = isNull(caveFolder) ? "" :
        String(caveFolder).replace(/\/+$/, "");
    var name = CsPackage.safeName(isNull(caveName) ? "" : caveName);
    if (name === "") {
        name = "Cave";
    }
    // ONE SHEET PER FILE (Nathan, 2026-09-10: "it's not easy to print
    // if they're combined"). Two sheets side by side in one drawing is
    // one drawing a plotter sees as one enormous page: printing either
    // of them means a window selection by hand, every time, for every
    // copy. A file per sheet is a file per press of Print.
    var which = (kind === CsSheetSetup.ELEVATION_SHEET) ?
        " Profile Sheet.dxf" : " Plan Sheet.dxf";
    return folder + "/" + CsSheetSetup.SHEETS_FOLDER + "/" + name + which;
};

/**
 * The cave's own drawing, given one of its sheets. The inverse of
 * sheetPathFor, and the reason a caver can press Build Sheet while
 * looking AT a sheet: the record it was built from is one folder up,
 * named after the cave.
 *
 * "" when the path is not a sheet path at all.
 */
CsSheetSetup.recordPathFor = function(sheetPath) {
    // Works for either sheet: the cave folder is what is above the
    // sheets folder, and its own name is the drawing's.
    var path = isNull(sheetPath) ? "" : String(sheetPath);
    var marker = "/" + CsSheetSetup.SHEETS_FOLDER + "/";
    var at = path.lastIndexOf(marker);
    if (at < 0) {
        return "";
    }
    var caveFolder = path.substring(0, at);
    var slash = caveFolder.lastIndexOf("/");
    var caveName = slash < 0 ? caveFolder : caveFolder.substring(slash + 1);
    return caveFolder + "/" + caveName + ".dxf";
};

/** The tag every generated sheet piece carries. Its VALUE says which
 *  sheet the piece belongs to. */
CsSheetSetup.TAG = "SheetPiece";

/**
 * The box of one sheet, read back off the drawing, or null.
 *
 * THE BORDER IS WHERE A SHEET'S POSITION LIVES. Not a stored
 * coordinate, not a setting: the thing that is drawn. Sheet Setup
 * recomputes the sheet from the plan every time it runs, so a
 * remembered position would be stale the first time the cave grew --
 * the same reasoning CsProfileDraw.computeOrigin gives for refusing to
 * store its own anchor.
 *
 * QCAD only.
 */
CsSheetSetup.sheetBoxOn = function(doc, kind) {
    if (isNull(doc)) {
        return null;
    }
    var box = null;
    try {
        var ids = doc.queryAllEntities(false, false);
        for (var i = 0; i < ids.length; i++) {
            var e = doc.queryEntity(ids[i]);
            if (isNull(e) || CsTags.get(e, CsSheetSetup.TAG) !== kind) {
                continue;
            }
            var b = e.getBoundingBox();
            var mn = b.getMinimum(), mx = b.getMaximum();
            if (box === null) {
                box = { minX: mn.x, minY: mn.y, maxX: mx.x, maxY: mx.y };
            } else {
                box.minX = Math.min(box.minX, mn.x);
                box.minY = Math.min(box.minY, mn.y);
                box.maxX = Math.max(box.maxX, mx.x);
                box.maxY = Math.max(box.maxY, mx.y);
            }
        }
    } catch (eBox) {
        return null;
    }
    return box;
};
