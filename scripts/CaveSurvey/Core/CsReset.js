// CsReset.js -- emptying a cave drawing without losing what was
// expensive to put in it.
//
// Part of the Cave Survey Core library. Pure ES5: no R*/Q* anywhere in
// this file, so tests/js_unit.js runs every line of it under node. The
// document work -- the walk, the delete, the carrier, the layer table
// -- lives in ResetDrawing/ResetDrawing.js.
//
// WHAT A RESET IS FOR. Teaching a class means handing out the same
// starting point over and over: a cave folder whose images are already
// in place -- the georeferenced aerial under the map, the sketch scans
// trimmed, warped and anchored where the caver drew them -- and whose
// drawing is otherwise empty, so the lesson starts at "import the
// survey" and runs to a finished map. Testing wants the same thing for
// the same reason.
//
// Teaching Cave (CsTeach) resets a whole FOLDER from a pristine master,
// which is the right tool for handing out a cave and the wrong one for
// emptying the drawing already open.
//
// THE RESET IS FULL. Survey data goes with everything else, because a
// class begins by importing the survey and leaving the stations behind
// would skip the first lesson. Two things survive:
//
//   THE IMAGES     a placed scan is an IMAGE entity whose file pointer
//                  lives in the DXF's IMAGEDEF, and that pointer is the
//                  fragile part of this system -- Truitt Cave lost all
//                  forty-seven at once (CsScanRelink). So the reset
//                  never touches an image entity, never moves the
//                  drawing to another path and never rebuilds an
//                  IMAGEDEF. Trim box, warp and placement ride through
//                  because nothing asks them to. It is also why the
//                  reset works IN PLACE rather than writing a fresh
//                  file beside the original: a drawing that changes
//                  folders loses its scan paths.
//   THE LOCATION   GeoLat/GeoLon/GeoStation ride an ENTITY, normally
//                  the anchor station, and a full wipe takes that
//                  station with everything else. CsRevise hits the same
//                  problem on its non-rigid path and answers it the
//                  same way: read the anchor before, write it back
//                  after -- here onto a CARRIER point, since there is
//                  no station left to hold it.
//
// THE CARRIER'S POSITION IS NOT DECORATION. CsLocationPick compares the
// anchor entity's position against the GeoDrawX/GeoDrawY it was pinned
// at and, past MOVE_EPS, asks whether the station moved and the
// coordinate should be recomputed. A carrier at the pinned position
// keeps that question unasked. A drawing georeferenced before those
// tags existed has no pin, and the carrier goes where the old anchor
// entity itself sat.
//
// This works at all because CsLocationPick.anchorRecord scans ANY
// entity for GeoLat/GeoLon -- it was never station-specific. The
// carrier is marked GeoCarrier so a real anchor station, once imported,
// takes precedence over it rather than racing it.

var CsReset = {};

/** Layers whose images survive a reset: the sketch scans, plan,
 *  profile and section, and the aerial basemap. */
CsReset.KEEP_LAYERS = ["CTRL-SCAN", "CTRL-PROFILE-SCAN",
                       "CTRL-SECTION-SCAN", "CTRL-AERIAL"];

/** The tags a placed scan carries naming the page it came from. An
 *  image wearing one of these is kept wherever it sits. */
CsReset.SCAN_TAGS = ["SketchScan", "SectionScan"];

/** Marks the point a reset parks the georeference on. */
CsReset.CARRIER_TAG = "GeoCarrier";

/** Where the carrier is put: already kept, already printless. */
CsReset.CARRIER_LAYER = "CTRL-AERIAL";

/** The tags that travel from the old anchor onto the carrier. */
CsReset.GEO_TAGS = ["GeoLat", "GeoLon", "GeoStation",
                    "GeoDrawX", "GeoDrawY"];

/**
 * Does this entity survive the reset?
 *
 * \param info {isImage, layer, tags} -- tags is a plain object of the
 *        entity's CaveSurvey tags, `{}` where it has none.
 *
 * TYPE **AND** LAYER. A line somebody drew on CTRL-SCAN is not a scan
 * and goes with everything else; keeping the layer rather than the
 * entity kind would leave a class starting on the last student's stray
 * geometry, which is the thing this tool exists to remove.
 */
CsReset.keepsEntity = function(info) {
    if (info === null || info === undefined || info.isImage !== true) {
        return false;
    }
    var tags = (info.tags === null || info.tags === undefined) ? {} : info.tags;
    for (var t = 0; t < CsReset.SCAN_TAGS.length; t++) {
        var v = tags[CsReset.SCAN_TAGS[t]];
        if (v !== undefined && v !== null && String(v) !== "") {
            return true;
        }
    }
    var layer = (info.layer === null || info.layer === undefined) ? "" :
        String(info.layer);
    for (var i = 0; i < CsReset.KEEP_LAYERS.length; i++) {
        if (layer === CsReset.KEEP_LAYERS[i]) {
            return true;
        }
    }
    return false;
};

/**
 * Which counted kind a doomed entity falls in: "survey" for the
 * control skeleton the importer draws, "drawn" for everything a caver
 * put on the map by hand.
 *
 * The split is the CTRL- prefix, deliberately, rather than a table of
 * every layer family. A count is there to tell somebody what they are
 * about to lose in the two terms they think in -- the survey, and the
 * map drawn over it -- and a finer tally would drift out of step with
 * the layer registry the first time a layer was added.
 */
CsReset.countKind = function(info) {
    var layer = (info === null || info === undefined ||
        info.layer === null || info.layer === undefined) ? "" :
        String(info.layer);
    return layer.indexOf("CTRL-") === 0 ? "survey" : "drawn";
};

/**
 * Totals a walked drawing.
 *
 * \param infos array of {isImage, layer, tags}
 * \return {total, survey, drawn, images}  -- total is what will be
 *         deleted; images is what will be kept.
 */
CsReset.tally = function(infos) {
    var out = { total: 0, survey: 0, drawn: 0, images: 0 };
    if (Object.prototype.toString.call(infos) !== "[object Array]") {
        return out;
    }
    for (var i = 0; i < infos.length; i++) {
        if (CsReset.keepsEntity(infos[i])) {
            out.images++;
            continue;
        }
        out.total++;
        out[CsReset.countKind(infos[i])]++;
    }
    return out;
};

/**
 * What a reset will do, decided before anything is touched -- the same
 * shape CsTeach.planReset answers in, and for the same reason: a
 * refusal has to come back as words somebody can act on, never as a
 * throw.
 *
 * \param state {hasDocument, docPath, inCaveFolder, isSheet, caveName,
 *               counts, modified}
 * \return {can, reason, warning}
 */
CsReset.planReset = function(state) {
    var s = (state === null || state === undefined) ? {} : state;
    if (s.hasDocument !== true) {
        return { can: false, reason: "There is no drawing open to reset." };
    }
    if (s.isSheet === true) {
        return { can: false, reason: "That is a sheet, not a drawing to " +
            "work in -- it is rebuilt from the cave's record every time " +
            "Build Sheet is pressed. Reset the cave's drawing instead." };
    }
    var path = (s.docPath === null || s.docPath === undefined) ? "" :
        String(s.docPath);
    if (path === "") {
        // No file on disk means no backup, and no backup means no wipe.
        return { can: false, reason: "This drawing has never been saved, " +
            "so there is nothing to keep a copy of. Save it into its " +
            "cave folder first." };
    }
    if (s.inCaveFolder !== true) {
        return { can: false, reason: "This drawing is not in a cave " +
            "project folder. Reset only runs inside one, where a backup " +
            "has somewhere to go and the scans have somewhere to be." };
    }
    var counts = (s.counts === null || s.counts === undefined) ?
        { total: 0 } : s.counts;
    if (counts.total === 0) {
        return { can: false, reason: "This drawing is already clear -- " +
            "there is nothing in it but its images." };
    }
    return {
        can: true, reason: "",
        warning: "This empties the drawing. The images stay and the " +
            "cave's location stays; everything else goes."
    };
};

/** A number with thousands separators, so 1830 reads as 1,830. */
CsReset.groupNumber = function(n) {
    var v = Math.round(Number(n));
    if (!isFinite(v)) {
        return "0";
    }
    var text = String(Math.abs(v));
    var out = "";
    while (text.length > 3) {
        out = "," + text.substring(text.length - 3) + out;
        text = text.substring(0, text.length - 3);
    }
    return (v < 0 ? "-" : "") + text + out;
};

/**
 * The dialog's body, as lines: what goes, what stays, where the copy
 * went, and -- where the drawing is modified -- that the copy is of the
 * file on disk and not of the unsaved edits in front of them.
 *
 * \param state {caveName, counts, backupPath, modified}
 */
CsReset.summaryText = function(state) {
    var s = (state === null || state === undefined) ? {} : state;
    var c = (s.counts === null || s.counts === undefined) ? {} : s.counts;
    var num = CsReset.groupNumber;
    var name = (s.caveName === null || s.caveName === undefined ||
        String(s.caveName) === "") ? "this cave" : String(s.caveName);
    var lines = [];
    lines.push("Empties the drawing of " + name + ".");
    lines.push("");
    lines.push("Deletes " + num(c.total || 0) + " entities: " +
        num(c.survey || 0) + " survey (stations, legs, LRUD) and " +
        num(c.drawn || 0) + " drawn (linework, symbols, notes).");
    lines.push("Keeps " + num(c.images || 0) +
        (c.images === 1 ? " image" : " images") +
        " and the cave's location.");
    lines.push("");
    if (s.backupPath !== null && s.backupPath !== undefined &&
            String(s.backupPath) !== "") {
        lines.push("A copy of the saved drawing is at " +
            String(s.backupPath) + ".");
    }
    if (s.modified === true) {
        // Said plainly rather than implied: the backup is a file copy,
        // and edits that were never written are in neither place once
        // this runs.
        lines.push("Unsaved changes in the open drawing are NOT in that " +
            "copy and will be lost.");
    }
    lines.push("");
    lines.push("Type the cave's name to confirm.");
    return lines;
};

/**
 * Does the typed confirmation match? Trimmed and case-insensitive: the
 * box is there to stop a stray Return in front of a class, not to test
 * anybody's typing.
 */
CsReset.matchesName = function(typed, caveName) {
    var a = (typed === null || typed === undefined) ? "" :
        String(typed).replace(/^\s+|\s+$/g, "").toLowerCase();
    var b = (caveName === null || caveName === undefined) ? "" :
        String(caveName).replace(/^\s+|\s+$/g, "").toLowerCase();
    return b !== "" && a === b;
};

/**
 * Where the georeference is parked, and what it carries.
 *
 * \param rec a CsLocationPick.anchorRecord, or null
 * \return {x, y, tags} or null when the drawing has no location
 *
 * The position is the PIN (GeoDrawX/GeoDrawY), so the carrier lands
 * exactly where the coordinate was declared and nothing downstream
 * reads it as a station that has moved. A drawing georeferenced before
 * those tags existed has no pin; the carrier then goes where the old
 * anchor entity itself sat, which is the same place for every drawing
 * whose anchor was never dragged.
 */
CsReset.carrierFrom = function(rec) {
    if (rec === null || rec === undefined) {
        return null;
    }
    if (rec.lat === null || rec.lat === undefined ||
            rec.lon === null || rec.lon === undefined) {
        return null;
    }
    var x = rec.pinX;
    var y = rec.pinY;
    if (x === null || x === undefined || y === null || y === undefined) {
        if (rec.pos === null || rec.pos === undefined) {
            return null;
        }
        x = rec.pos.x;
        y = rec.pos.y;
    }
    var tags = {
        GeoLat: rec.lat,
        GeoLon: rec.lon,
        GeoDrawX: x,
        GeoDrawY: y
    };
    tags[CsReset.CARRIER_TAG] = "1";
    if (rec.station !== null && rec.station !== undefined &&
            String(rec.station) !== "") {
        tags.GeoStation = rec.station;
    }
    return { x: x, y: y, tags: tags };
};

/** What is said once it is done. Names the backup, because the one
 *  question after a reset anybody regrets is where the old one went. */
CsReset.doneText = function(state) {
    var s = (state === null || state === undefined) ? {} : state;
    var c = (s.counts === null || s.counts === undefined) ? {} : s.counts;
    var num = CsReset.groupNumber;
    var lines = [];
    lines.push("Reset: " + num(c.total || 0) + " entities deleted, " +
        num(c.images || 0) + (c.images === 1 ? " image" : " images") +
        " kept.");
    lines.push(s.carrier === true ?
        "The cave's location was carried across." :
        "This drawing had no location to carry across.");
    if (s.backupPath !== null && s.backupPath !== undefined &&
            String(s.backupPath) !== "") {
        lines.push("The drawing as it was: " + String(s.backupPath));
    }
    lines.push("Nothing has been saved yet -- close without saving to " +
        "undo all of this.");
    return lines;
};
