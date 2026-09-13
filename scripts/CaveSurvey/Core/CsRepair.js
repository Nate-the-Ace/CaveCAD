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
 * All three passes work on the doc/di they are handed -- the rebuild
 * pass included, since CsDraw.survey now takes its document through
 * options.doc/options.di instead of reading the GUI's globals. Verified
 * against a document that is NOT the active one: all three passes
 * succeed on the drawing passed in.
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

    if (opts.relinkScans !== false) {
        var rl = CsScanRelink.run(doc, di);
        lines.push(CsScanRelink.summary(rl));
        if (rl.relinked > 0) {
            changed = true;
        }
    } else {
        lines.push(qsTr("Scan images: skipped."));
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
