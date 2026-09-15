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

/**
 * How much of the sheet is kept clear at every edge, in INCHES of
 * paper. A map drawn to the paper's edge cannot be bound, trimmed or
 * held, and a plotter's own unprintable border is about this wide.
 *
 * HALF AN INCH, FLAT (Nathan, 2026-09-14). It used to be a twelfth of
 * the sheet's short side, which on ARCH D is nearly THREE inches all
 * round -- seven per cent of the paper's area given to white space, and
 * enough to cost a cave a whole scale step. A margin is a physical
 * allowance for the plotter and the binder; it does not get bigger
 * because the paper did.
 */
CsSheetSetup.MARGIN_INCHES = 0.5;

/**
 * How far inside its own border the extended elevation's bands are
 * parked, as a fraction of the sheet's width.
 *
 * A FRACTION and not inches, unlike the margin above, because the only
 * thing known where this is used is a border already drawn in a
 * drawing: CsProfileDraw finds the elevation sheet by its border and
 * has no paper size and no plot scale to turn inches into units with.
 * The same number is used everywhere the bands are placed OR previewed,
 * which is what matters -- the picture and the placement have to agree.
 */
CsSheetSetup.BAND_INSET_FRACTION = 0.03;

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
    var margin = CsSheetSetup.MARGIN_INCHES;
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
        footerInches, shiftInches) {
    var w = (turned === true ? sheet.h : sheet.w) * scale;
    var h = (turned === true ? sheet.w : sheet.h) * scale;
    var footer = ((isNull(footerInches) || !(footerInches > 0)) ? 0 :
        footerInches) * scale;
    // THE PAPER MOVES, NOT THE CAVE. A cartographer who drags the cave
    // across the preview is asking for the map to sit elsewhere on the
    // page -- and the cave's coordinates are survey data, so the only
    // thing that may move is the sheet under it. `shiftInches` is that
    // drag, negated by the caller: see SheetSetup.draw.
    var shift = CsSheetSetup.offsetOf({ sheet: shiftInches }, "sheet");
    var cx = (caveBox.minX + caveBox.maxX) / 2 + shift.x * scale;
    // Centred in the space ABOVE the footer, not in the whole sheet.
    // The SHEET drops by half the footer, which is the same thing as
    // the cave rising by half of it: the band the title block occupies
    // is reserved rather than shared, and the credits stop printing
    // over the passage.
    var cy = (caveBox.minY + caveBox.maxY) / 2 - footer / 2 +
        shift.y * scale;
    return {
        minX: cx - w / 2, maxX: cx + w / 2,
        minY: cy - h / 2, maxY: cy + h / 2,
        width: w, height: h,
        footer: footer,
        margin: CsSheetSetup.MARGIN_INCHES * scale
    };
};

// ---------------------------------------------------------------------
// MAGNETIC NORTH, BESIDE THE TRUE ONE.
//
// The suite rotates every azimuth by the trip's declination as it
// draws, so what is on the sheet is TRUE north -- and a caver standing
// in the cave is holding a compass that points somewhere else. A map
// that shows only true north is asking its reader to know the
// declination and do the arithmetic in the dark.
//
// So the arrow carries both: true north up, and a magnetic arm at the
// declination of the LATEST trip, labelled with that declination and
// the date it belongs to. Declination drifts -- a degree every few
// years in most of North America -- so "magnetic north" without a date
// is a number with a shelf life and no label on it.
//
// THE LATEST TRIP, not the first: a reader takes a map underground to
// use it, and the most recent survey is the closest thing the map has
// to the compass in their hand.
// ---------------------------------------------------------------------

/**
 * The declination to draw magnetic north at, and the date it came
 * from. Null when the survey cannot say.
 *
 * \return { declination, date } -- date "" when the trip has none.
 *
 * Dates are ISO ("2024-11-03"), so they sort as text; a trip with no
 * date cannot be the latest by date and is only fallen back on when
 * NOTHING in the survey is dated. Ties go to the trip further down the
 * list, which is the order the file was written in.
 *
 * A DECLINATION OF ZERO IS NOT AN ANSWER. It is the suite's own default
 * for a trip nobody has told, and this build cannot tell that apart
 * from a place where the needle really does point true: Truitt Cave's
 * eleven trips all read 0.0 with a source of "user" (measured live,
 * 2026-09-14). Drawing a magnetic arm there would put a second arrow
 * exactly on top of the true one and print "MAGNETIC NORTH 0.0°" on a
 * sheet, which is a claim about the world that nothing in the drawing
 * supports. So zero answers null: true north only, and the map says
 * nothing it cannot back up.
 */
CsSheetSetup.latestDeclination = function(survey) {
    if (isNull(survey) || isNull(survey.trips)) {
        return null;
    }
    var best = null;
    var undated = null;
    for (var i = 0; i < survey.trips.length; i++) {
        var trip = survey.trips[i];
        if (isNull(trip)) {
            continue;
        }
        var d = trip.declination;
        if (isNull(d) || !isFinite(d) || Number(d) === 0) {
            continue;
        }
        var date = isNull(trip.date) ? "" : String(trip.date);
        if (date === "") {
            undated = { declination: Number(d), date: "" };
            continue;
        }
        if (best === null || date >= best.date) {
            best = { declination: Number(d), date: date };
        }
    }
    return best !== null ? best : undated;
};

/**
 * Which way magnetic north points on a sheet drawn in TRUE north.
 *
 * Declination is positive EAST (see Core/CsModel.js), and east is +x
 * on a drawing whose north is +y -- so a positive declination swings
 * the needle clockwise from up. A unit vector, so the caller decides
 * how long the arm is.
 */
CsSheetSetup.magneticUnit = function(declination) {
    var d = (isNull(declination) || !isFinite(declination)) ? 0 :
        Number(declination);
    var rad = d * Math.PI / 180;
    return { x: Math.sin(rad), y: Math.cos(rad) };
};

/** The arrow, in inches of paper. The magnetic arm is drawn shorter
 *  than the true one so the two cannot be mistaken for each other at a
 *  glance, and its head smaller for the same reason. */
CsSheetSetup.NORTH = {
    height: 1.4,
    headLength: 0.4,
    headHalf: 0.18,
    magneticHeight: 0.85,
    magneticHeadLength: 0.18,
    magneticHeadHalf: 0.075
};

/** The magnetic arm's grey. Secondary, the way a compass rose draws it:
 *  the true arrow is what the map is drawn in, and the arm is a fact
 *  about a needle. Dark enough to survive a plot and a photocopy. */
CsSheetSetup.MAGNETIC_GREY = [128, 128, 128];

/**
 * How the magnetic arm is captioned, under the true north line:
 * "MAGNETIC NORTH 3.2° E (2024-11-03)".
 *
 * THE DATE IS PART OF THE FACT. Declination drifts about a degree every
 * few years, so a magnetic north with no date on it is a number with a
 * shelf life and no label -- and the date this carries is the LATEST
 * trip's, which is the survey nearest the compass a reader is holding.
 */
CsSheetSetup.magneticText = function(reading) {
    if (isNull(reading)) {
        return "";
    }
    var d = reading.declination;
    var side = d > 0 ? "E" : (d < 0 ? "W" : "");
    var out = "MAGNETIC NORTH " + Math.abs(d).toFixed(1) + "°" +
        (side === "" ? "" : " " + side);
    if (!isNull(reading.date) && reading.date !== "") {
        out += " (" + reading.date + ")";
    }
    return out;
};

// ---------------------------------------------------------------------
// ARRANGING THE PAGE BY HAND.
//
// The layout this file computes is a sensible default, not a law: the
// title block goes bottom left, the bar at 45% across, the arrow at the
// right margin. A real map has a reason to break that -- a cave whose
// plan runs down the left of the sheet leaves the bar sitting on top of
// it, and the only cartographer who can see that is the one looking at
// the preview.
//
// So each piece carries an OFFSET, measured in INCHES OF PAPER from
// where the default put it. Inches and not drawing units because the
// scale is one of the two things the panel is for changing: a bar
// nudged two inches to the right stays two inches to the right when the
// scale steps, rather than leaping across the page.
//
// Everything below is pure -- boxes, offsets and hit tests -- so the
// arithmetic a drag depends on is testable without a mouse.
// ---------------------------------------------------------------------

/** The pieces a caver may drag. "cave" moves the PAPER under the cave;
 *  see CsSheetSetup.borderBox. */
CsSheetSetup.MOVABLE = ["cave", "title", "bar", "north"];

/** How near an edge has to come before it snaps to one, in INCHES of
 *  paper. A tenth of an inch is about a pen width on the finished
 *  sheet: near enough that nobody meant to be that close by accident,
 *  far enough that a hand on a mouse can hit it. */
CsSheetSetup.SNAP_INCHES = 0.1;

/** Is this a piece a caver may drag? */
CsSheetSetup.isMovable = function(kind) {
    return CsSheetSetup.MOVABLE.indexOf(kind) >= 0;
};

/** One piece's offset, in inches of paper, defaulted to no move at
 *  all. Tolerates null, a missing entry and a half-written one. */
CsSheetSetup.offsetOf = function(offsets, kind) {
    var out = { x: 0, y: 0 };
    if (isNull(offsets) || isNull(offsets[kind])) {
        return out;
    }
    var off = offsets[kind];
    if (!isNull(off.x) && isFinite(off.x)) {
        out.x = off.x;
    }
    if (!isNull(off.y) && isFinite(off.y)) {
        out.y = off.y;
    }
    return out;
};

/** Has anything been moved at all? Decides whether the panel's Reset
 *  is worth offering. */
CsSheetSetup.anyMoved = function(offsets) {
    if (isNull(offsets)) {
        return false;
    }
    for (var i = 0; i < CsSheetSetup.MOVABLE.length; i++) {
        var off = CsSheetSetup.offsetOf(offsets, CsSheetSetup.MOVABLE[i]);
        if (Math.abs(off.x) > 1e-9 || Math.abs(off.y) > 1e-9) {
            return true;
        }
    }
    return false;
};

/** `offsets` with one piece moved a further dx, dy INCHES. Answers a
 *  new object; the one passed in is never written to, so a drag in
 *  progress can be thrown away by forgetting its result. */
CsSheetSetup.withOffset = function(offsets, kind, dxInches, dyInches) {
    var out = {};
    var k;
    if (!isNull(offsets)) {
        for (k in offsets) {
            if (offsets.hasOwnProperty(k)) {
                out[k] = { x: CsSheetSetup.offsetOf(offsets, k).x,
                           y: CsSheetSetup.offsetOf(offsets, k).y };
            }
        }
    }
    var was = CsSheetSetup.offsetOf(offsets, kind);
    out[kind] = { x: was.x + dxInches, y: was.y + dyInches };
    return out;
};

/**
 * The margin rectangle inside one sheet: the line a map is kept inside
 * so it can be bound, trimmed and held.
 *
 * Drawn DASHED in the preview and never on the sheet itself -- it is a
 * guide, not furniture, which is why previewFits skips it.
 */
CsSheetSetup.marginBox = function(sheetBox) {
    var m = isNull(sheetBox.margin) ? 0 : sheetBox.margin;
    return { minX: sheetBox.minX + m, minY: sheetBox.minY + m,
             maxX: sheetBox.maxX - m, maxY: sheetBox.maxY - m };
};

/**
 * A rectangle cut into dashes, as [{x1, y1, x2, y2}].
 *
 * The preview document is built from scratch every repaint and holds no
 * linetype table worth the name, so the dashes are GEOMETRY. That also
 * makes the margin outline testable: a dashed line either has the right
 * segments or it does not.
 */
CsSheetSetup.dashRect = function(box, dashLength) {
    var out = [];
    var len = (isNull(dashLength) || !(dashLength > 0)) ? 1 : dashLength;
    var run = function(x1, y1, x2, y2) {
        var dx = x2 - x1, dy = y2 - y1;
        var total = Math.sqrt(dx * dx + dy * dy);
        if (!(total > 0)) {
            return;
        }
        var ux = dx / total, uy = dy / total;
        var at = 0;
        while (at < total) {
            var end = Math.min(at + len, total);
            out.push({ x1: x1 + ux * at, y1: y1 + uy * at,
                       x2: x1 + ux * end, y2: y1 + uy * end });
            at = end + len;   // one dash, one gap
        }
    };
    run(box.minX, box.minY, box.maxX, box.minY);
    run(box.maxX, box.minY, box.maxX, box.maxY);
    run(box.maxX, box.maxY, box.minX, box.maxY);
    run(box.minX, box.maxY, box.minX, box.minY);
    return out;
};

/**
 * Which piece is under a point, or null.
 *
 * TOPMOST FIRST, which is the order they were added in reverse: the
 * title block sits inside the cave's own footprint on nearly every map,
 * and a caver reaching for the title block is not reaching for the
 * thousand-foot rectangle behind it.
 *
 * `pad` widens the catch, in drawing units, so a north arrow four
 * tenths of an inch wide can still be grabbed.
 */
CsSheetSetup.pickAt = function(preview, x, y, pad) {
    if (isNull(preview) || isNull(preview.items)) {
        return null;
    }
    var grow = (isNull(pad) || !(pad > 0)) ? 0 : pad;
    for (var i = preview.items.length - 1; i >= 0; i--) {
        var item = preview.items[i];
        if (!CsSheetSetup.isMovable(item.kind)) {
            continue;
        }
        var b = item.box;
        if (x >= b.minX - grow && x <= b.maxX + grow &&
                y >= b.minY - grow && y <= b.maxY + grow) {
            return item;
        }
    }
    return null;
};

/**
 * The lines a dragged piece may snap to, in DRAWING units.
 *
 * The paper's own edges, the margin, and every other piece's edges and
 * middle -- which is what "line the bar up under the title block" and
 * "centre the arrow on the page" both mean. The piece being dragged is
 * left out: a box cannot snap to itself.
 */
CsSheetSetup.snapLines = function(preview, kind) {
    var out = { xs: [], ys: [], xMid: [], yMid: [] };
    if (isNull(preview) || isNull(preview.items)) {
        return out;
    }
    var push = function(list, v) {
        if (list.indexOf(v) === -1) { list.push(v); }
    };
    for (var i = 0; i < preview.items.length; i++) {
        var item = preview.items[i];
        if (item.kind === kind) {
            continue;
        }
        var b = item.box;
        push(out.xs, b.minX);
        push(out.xs, b.maxX);
        push(out.ys, b.minY);
        push(out.ys, b.maxY);
        // MIDLINES ARE KEPT APART from the edges, and `xs`/`ys` carry
        // them too so an EDGE may still land on one. The separate list
        // is what lets a centring snap win a tie: see snapMove.
        push(out.xMid, (b.minX + b.maxX) / 2);
        push(out.yMid, (b.minY + b.maxY) / 2);
        push(out.xs, (b.minX + b.maxX) / 2);
        push(out.ys, (b.minY + b.maxY) / 2);
    }
    return out;
};

/**
 * A drag, pulled onto the nearest edge it nearly hit.
 *
 * Each axis is decided on its own -- an edge that lines up vertically
 * should not have to give up its horizontal place to say so -- and what
 * comes back names the line it took, so the preview can draw it and the
 * caver can see WHY the piece stopped where it did.
 *
 * \param box   where the piece sits now, before this drag
 * \param dx,dy the drag, in drawing units
 * \param lines from CsSheetSetup.snapLines
 * \param tol   how near counts, in drawing units
 * \return {dx, dy, guideX, guideY, centredX, centredY} -- the guides
 *         null when nothing was near enough, and the centred flags true
 *         when the piece was pulled onto a MIDLINE rather than an edge,
 *         so the panel can say so and draw the guide differently.
 */
CsSheetSetup.snapMove = function(box, dx, dy, lines, tol) {
    var out = { dx: dx, dy: dy, guideX: null, guideY: null,
        centredX: false, centredY: false };
    if (isNull(lines) || !(tol > 0)) {
        return out;
    }
    var midX = (box.minX + box.maxX) / 2 + dx;
    var midY = (box.minY + box.maxY) / 2 + dy;
    var best = function(edges, candidates) {
        var pick = null;
        if (isNull(candidates)) {
            return null;
        }
        for (var e = 0; e < edges.length; e++) {
            for (var c = 0; c < candidates.length; c++) {
                var gap = candidates[c] - edges[e];
                if (Math.abs(gap) > tol) {
                    continue;
                }
                if (pick === null || Math.abs(gap) < Math.abs(pick.gap)) {
                    pick = { gap: gap, line: candidates[c] };
                }
            }
        }
        return pick;
    };
    // CENTRING WINS A TIE (Nathan, 2026-09-14). "Put the scale bar in
    // the middle of the page" is the snap a cartographer most wants and
    // the one hardest to hit by hand -- and a page's midline usually
    // has another piece's edge somewhere near it, which would otherwise
    // grab the drag first and leave the bar a hair off centre. So the
    // MIDDLE of the dragged box is offered the midlines on their own
    // before everything is considered together.
    var axis = function(edges, mid, mids, all) {
        var centred = best([mid], mids);
        if (centred !== null) {
            return { gap: centred.gap, line: centred.line, centred: true };
        }
        var any = best(edges, all);
        if (any === null) {
            return null;
        }
        return { gap: any.gap, line: any.line, centred: false };
    };
    var x = axis([box.minX + dx, box.maxX + dx, midX], midX,
        lines.xMid, lines.xs);
    if (x !== null) {
        out.dx = dx + x.gap;
        out.guideX = x.line;
        out.centredX = x.centred;
    }
    var y = axis([box.minY + dy, box.maxY + dy, midY], midY,
        lines.yMid, lines.ys);
    if (y !== null) {
        out.dy = dy + y.gap;
        out.guideY = y.line;
        out.centredY = y.centred;
    }
    return out;
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
 *   offsets      {kind: {x, y}} -- hand-arranged moves, in INCHES of
 *                paper, for the pieces in CsSheetSetup.MOVABLE
 *   declination  the latest trip's declination, so the north box
 *                covers the magnetic arm the sheet will draw
 *   elevation    true to include the second sheet
 *   bands        [{minX, minY, maxX, maxY}] the elevation's own boxes
 * }
 *
 * \return { bounds: {minX, minY, maxX, maxY}, items: [{kind, box}] }
 *
 * `kind` is one of "sheet", "elevation-sheet", "margin", "cave",
 * "title", "bar", "north", "band" -- the panel colours by it and the
 * tests read it.
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

    // EVERY MOVABLE PIECE IS ADDED THROUGH ITS OWN OFFSET. A drag is
    // remembered in inches of paper, so it survives a scale step and a
    // paper change -- and the drawn sheet reads the same numbers, which
    // is what makes the preview a preview rather than a picture.
    var add = function(kind, minX, minY, maxX, maxY) {
        var off = CsSheetSetup.offsetOf(state.offsets, kind);
        var dx = off.x * scale, dy = off.y * scale;
        out.items.push({ kind: kind,
            box: { minX: minX + dx, minY: minY + dy,
                   maxX: maxX + dx, maxY: maxY + dy } });
    };

    add("sheet", box.minX, box.minY, box.maxX, box.maxY);
    // THE MARGIN, DASHED. The band a map is kept out of so it can be
    // bound and trimmed -- invisible until now, which is why furniture
    // dragged by hand had nothing to be square with.
    var planMargin = CsSheetSetup.marginBox(box);
    add("margin", planMargin.minX, planMargin.minY,
        planMargin.maxX, planMargin.maxY);
    add("cave", state.caveBox.minX, state.caveBox.minY,
        state.caveBox.maxX, state.caveBox.maxY);

    var inch = function(v) { return v * scale; };
    // ON THE MARGIN LINE. With a margin of nearly three inches the
    // furniture could sit at a fraction of it and still be inside the
    // guide; at half an inch, anything less than the whole margin is
    // furniture printed in the plotter's own unprintable border.
    var foot = box.minY + box.margin;

    if (wants.title === true) {
        var titleH = isNull(state.footerInches) ? 2 : state.footerInches;
        add("title", box.minX + box.margin,
            box.minY + box.margin,
            box.minX + box.margin + inch(CsSheetSetup.TITLE_INCHES),
            box.minY + box.margin + inch(titleH));
    }
    if (wants.bar === true) {
        var barX = box.minX + box.width * 0.45;
        add("bar", barX, foot, barX + inch(CsSheetSetup.BAR.length),
            foot + inch(CsSheetSetup.BAR.height * 3));
    }
    if (wants.north === true) {
        var nx = box.maxX - box.margin;
        // BOTH ARMS, and the two letters at the magnetic tip: the box
        // is what a caver grabs and what the fit check measures, so it
        // has to be the whole piece rather than the true arrow alone.
        var arm = CsSheetSetup.magneticUnit(state.declination);
        var reach = CsSheetSetup.NORTH.magneticHeight;
        var armX = arm.x * reach;
        var armY = arm.y * reach;
        add("north",
            nx + inch(Math.min(-0.2, armX - 0.1)), foot,
            nx + inch(Math.max(0.2, armX + 0.35)),
            foot + inch(Math.max(CsSheetSetup.NORTH.height, armY)));
    }

    if (state.elevation === true) {
        var second = CsSheetSetup.elevationSheetBox(box, scale);
        add("elevation-sheet", second.minX, second.minY,
            second.maxX, second.maxY);
        var elevMargin = CsSheetSetup.marginBox(second);
        add("margin", elevMargin.minX, elevMargin.minY,
            elevMargin.maxX, elevMargin.maxY);
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
                CsSheetSetup.BAND_INSET_FRACTION;
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
        if (item.kind === "sheet" || item.kind === "elevation-sheet" ||
                item.kind === "margin") {
            // A MARGIN IS A GUIDE, NOT A PIECE. It is drawn inside its
            // own sheet by construction, and counting it would make the
            // answer "everything fits" say nothing.
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
