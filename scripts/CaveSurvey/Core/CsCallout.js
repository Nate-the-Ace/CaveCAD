/**
 * CsCallout -- the pure engine behind the Cave Survey callout
 * (multileader) tools.
 *
 * QCAD has no multileader. Its RLeaderEntity is a polyline plus an
 * arrowHead flag with NO text member, so a callout here is a LINKED
 * PAIR: one RTextEntity and one RLeaderEntity per branch, joined by a
 * shared CalloutId in CsTags XDATA.
 *
 * THIS FILE IS PURE. It takes and returns plain {x, y} objects, never
 * RVector, and never touches a document -- which is what lets
 * tests/js_unit.js run it under node. Every QCAD-shaped write lives in
 * Callout/CalloutWrite.js. Do not import a QCAD symbol here.
 */
function CsCallout() {}

/**
 * XDATA keys, under the CsTags "CaveSurvey" group. Nothing outside
 * this table may hard-code a tag string: a typo in a literal is a
 * silent orphan, and an orphaned member is a leader that no longer
 * reflows.
 */
CsCallout.KEY = {
    ID: "CalloutId",
    ROLE: "CalloutRole",
    KIND: "CalloutKind",
    STYLE: "CalloutStyle",
    SIDE: "CalloutSide",
    ELEV_BASIS: "ElevBasis",
    ELEV_FROM: "ElevFrom",
    ELEV_TO: "ElevTo",
    ELEV_FRACTION: "ElevFraction",
    ELEV_VALUE: "ElevValue",
    ELEV_MULTI: "ElevMulti"
};

CsCallout.ROLE_TEXT = "text";
CsCallout.ROLE_LEADER = "leader";
CsCallout.KIND_TEXT = "text";
CsCallout.KIND_ELEV = "elev";
CsCallout.BASIS_FLOOR = "floor";
CsCallout.BASIS_LINE = "line";

/** Style name -> layer. A callout member goes on its STYLE's layer,
 *  never on the current layer: a note drawn onto WALLS-SURVEYED
 *  silently becomes wall linework on the next layer-driven operation. */
CsCallout.STYLES = {
    "hazard": "NOTES-HAZARD",
    "dig": "NOTES-DIG",
    "equipment": "NOTES-EQUIPMENT",
    "name": "NOTES-NAME",
    "elevation": "NOTES-ELEVATION",
    "elevation-line": "NOTES-ELEVATION-LINE"
};

CsCallout.STYLE_DEFAULT = "name";

/**
 * A fresh CalloutId. Delegates to CsUuid, the suite's general identity
 * library -- more dynamically linked labels and objects are planned and
 * they should all draw from one place. See CsUuid's own docblock for
 * when an opaque id is the right key and when a survey-meaningful one
 * is (CsBind's integer trip id being the counter-example).
 */
CsCallout.newId = function() {
    return CsUuid.v4();
};

/**
 * Solve the leader geometry for one callout.
 *
 * \param box  the text's bounding box as {x1, y1, x2, y2}, x1 < x2 and
 *             y1 < y2 -- plain numbers, NOT an RBox (this file is pure)
 * \param tips [{x, y}] one arrow tip per branch, possibly empty
 * \param opts {side: "auto"|"left"|"right",
 *              dimasz: number|null, dimscale: number|null}
 * \return {side, landing: {x, y}, branches: [[{x,y},{x,y},{x,y}]]}
 *
 * WHY THE LANDING ATTACHES AT THE VERTICAL MIDDLE and not at the first
 * line's baseline (which is the more AutoCAD-ish choice): these notes
 * get EDITED. A caver adds a second line to "bad air" and a
 * baseline-attached landing jumps by a full line height, so every arrow
 * in the callout visibly swings. Middle attachment moves by half a line
 * instead, and moves the same amount whichever end the line was added
 * to. The cost is that a tall multi-line note's arrow leaves from the
 * middle of the block rather than beside its first line; that reads
 * fine on a map and does not move when the note is reworded.
 */
CsCallout.reflow = function(box, tips, opts) {
    var o = opts || {};
    var list = tips || [];

    var height = Math.abs(box.y2 - box.y1);
    var centerX = (box.x1 + box.x2) / 2.0;
    var midY = (box.y1 + box.y2) / 2.0;

    // Landing length. dimasz x dimscale is the arrow size the drawing's
    // dimension style already uses, so a callout matches the sheet's
    // other annotation. Absent either, half the text height: a fixed
    // number would be wrong at every scale but one, and this drawing's
    // text height IS its scale, expressed.
    var landingLen;
    if (o.dimasz !== null && o.dimasz !== undefined &&
            o.dimscale !== null && o.dimscale !== undefined &&
            o.dimasz > 0 && o.dimscale > 0) {
        landingLen = o.dimasz * o.dimscale;
    } else {
        landingLen = height * 0.5;
    }

    // Side. "auto" compares the mean tip x against the box centre: the
    // landing should leave the text TOWARD the thing being pointed at,
    // or the leader crosses its own text.
    var side = o.side;
    if (side !== "left" && side !== "right") {
        var sum = 0;
        for (var i = 0; i < list.length; i++) {
            sum += list[i].x;
        }
        var meanX = (list.length > 0) ? (sum / list.length) : centerX;
        side = (meanX <= centerX) ? "left" : "right";
    }

    var landing = {
        x: (side === "left") ? box.x1 : box.x2,
        y: midY
    };
    var elbowX = (side === "left") ?
        (landing.x - landingLen) : (landing.x + landingLen);

    var branches = [];
    for (var k = 0; k < list.length; k++) {
        branches.push([
            { x: list[k].x, y: list[k].y },
            { x: elbowX, y: landing.y },
            { x: landing.x, y: landing.y }
        ]);
    }

    return { side: side, landing: landing, branches: branches };
};
