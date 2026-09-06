/**
 * CsRepair.js
 *
 * The three repair passes, run together and reported together.
 *
 * They were three menu entries once, which meant the honest answer to
 * "which one do I run?" was "all three, in this order" -- an order
 * nobody had written down. The order matters: rebuild first, because a
 * legacy drawing's tags have to be current before anything reads them;
 * restyle second, because rebuild can add layers; callout sync last,
 * because a restyle can move a note's layer out from under its arrows.
 */
var CsRepair = {};

/**
 * Needs an ACTIVE drawing, not merely the doc handed in. The restyle and
 * callout passes work on whatever doc/di they are given, but the rebuild
 * pass redraws through CsDraw.survey, and CsDraw.survey reads the GUI's
 * own getDocument()/getDocumentInterface() rather than taking a document
 * (CsDraw.js, in survey()). In the application the two are the same
 * drawing, so this costs nothing there -- but called against a document
 * that is not the active one, the rebuild pass throws inside CsLayers
 * and the other two passes quietly succeed against a different drawing.
 * Measured, not guessed. Do not "fix" it by passing doc further down:
 * CsDraw.survey's contract is shared with three other tools.
 *
 * \param opts Object with boolean rebuild, restyle, callouts. A missing
 *             key means run that pass -- the dialog's default is all three.
 * \return {lines: Array of String, changed: Boolean}
 */
CsRepair.run = function(doc, di, opts) {
    if (isNull(opts)) {
        opts = {};
    }
    var lines = [];
    var changed = false;

    if (opts.rebuild !== false) {
        var r = CsRebuild.rebuild(doc, di);
        if (r.warning !== "") {
            lines.push(qsTr("Survey data: ") + r.warning);
        } else if (r.dialog !== "") {
            lines.push(qsTr("Survey data: ") + r.dialog);
            changed = true;
        } else {
            lines.push(qsTr("Survey data: ") + r.message);
            changed = true;
        }
    } else {
        lines.push(qsTr("Survey data: skipped."));
    }

    if (opts.restyle !== false) {
        var s = CsRestyle.ensureAndApply(doc, di);
        if (s.changed.length === 0 && s.added === 0) {
            lines.push(qsTr("Layers: already match the palette."));
        } else {
            lines.push(qsTr("Layers: %1 restyled, %2 added.")
                .arg(s.changed.length).arg(s.added));
            changed = true;
        }
    } else {
        lines.push(qsTr("Layers: skipped."));
    }

    if (opts.callouts !== false) {
        lines.push(qsTr("Callouts: ") + CsCalloutSync.run(doc, di));
        changed = true;
    } else {
        lines.push(qsTr("Callouts: skipped."));
    }

    return { lines: lines, changed: changed };
};
