// CsSheetFile.js -- the mark that says "this drawing is a SHEET", and
// the refusal every editing tool owes it.
//
// Part of the Cave Survey Core library.
//
// WHY A SHEET IS NOT A DRAWING TO WORK IN (Nathan, 2026-09-10: "I don't
// want the sheet file to be where people make edits").
//
// A sheet is DERIVED. Sheet Setup builds it from the cave's record, and
// building it again rebuilds it from scratch -- which is the whole
// point, because that is how a sheet picks up another trip's survey.
// Anything drawn INTO the sheet is therefore work with a demolition
// date on it, and nothing about the file says so. A caver who traces a
// passage onto a sheet loses it the next time anybody presses Build
// Sheet, and loses it silently, weeks later, with no way back.
//
// The failure is worse than losing the work, because the work is not
// obviously lost: the sheet still looks like the cave. It has the whole
// survey in it, the tracing, the symbols. It is an excellent thing to
// draw on and a terrible thing to have drawn on.
//
// So a sheet carries a mark, and every tool that WRITES to a drawing
// checks it and refuses, saying where the edit belongs instead. The
// tools that only READ -- Check Map, Survey Stats -- are welcome: a
// sheet is exactly the thing you want to check before plotting it.
//
// TWO WAYS TO KNOW, deliberately. The mark is an entity, and an entity
// can be deleted -- by a caver tidying up, by a round trip through
// another CAD program, by accident. So the file's own PATH counts too:
// a drawing inside a cave's sheets/ folder is a sheet whatever its
// contents say. Either is enough.

var CsSheetFile = {};

/** The tag a marked drawing carries. */
CsSheetFile.TAG = "SheetFile";

/** The layer the mark lives on: hidden, plan-frame, suite-owned. */
CsSheetFile.LAYER = "CTRL-HIDDEN";

/**
 * Marks a document as a sheet. QCAD only.
 *
 * One point entity, on a layer nobody draws on, carrying the tag. It is
 * put in during the build, in the same operation as everything else the
 * sheet gets, so a sheet cannot exist unmarked.
 *
 * \return true when the mark went in.
 */
CsSheetFile.mark = function(doc, di) {
    var ok = false;
    try {
        CsLayers.ensure(doc, di, CsSheetFile.LAYER);
        // ITS OWN OPERATION, INSIDE withLayerOn. CTRL-HIDDEN ships OFF,
        // and an off layer refuses adds in silence in this build -- so
        // the mark went into the caller's pending operation, that
        // operation was applied with the layer still off, and every
        // sheet came out unmarked while every return value said it had
        // worked. Caught by tests/sheet_setup_run.js reading the built
        // file back. The same trap that let a sanitized package keep
        // its aerial photograph, one file over.
        CsLayers.withLayerOn(doc, di, CsSheetFile.LAYER, function() {
            var e = new RPointEntity(doc, new RPointData(new RVector(0, 0)));
            e.setLayerId(doc.getLayerId(CsSheetFile.LAYER));
            CsTags.set(e, CsSheetFile.TAG, "1");
            var own = new RAddObjectsOperation();
            own.addObject(e, false);
            di.applyOperation(own);
            ok = true;
        });
    } catch (eMark) {
        return false;
    }
    return ok;
};

/** Is this path inside a cave's sheets folder? Pure. */
CsSheetFile.pathIsSheet = function(path) {
    if (isNull(path) || String(path) === "") {
        return false;
    }
    return String(path).indexOf("/" + CsSheetSetup.SHEETS_FOLDER + "/") >= 0;
};

/**
 * Is this drawing a sheet? QCAD only.
 *
 * The mark first, the path second -- see the header on why both.
 */
CsSheetFile.isSheet = function(doc) {
    if (isNull(doc)) {
        return false;
    }
    try {
        if (CsSheetFile.pathIsSheet(String(doc.getFileName()))) {
            return true;
        }
    } catch (ePath) {
    }
    try {
        var ids = doc.queryAllEntities(false, true);
        for (var i = 0; i < ids.length; i++) {
            var e = doc.queryEntity(ids[i]);
            if (!isNull(e) && CsTags.get(e, CsSheetFile.TAG) !== "") {
                return true;
            }
        }
    } catch (eScan) {
    }
    return false;
};

/**
 * What a tool says when it will not work here, or "" when it will.
 *
 * ONE SENTENCE, and it has to answer the question the caver is actually
 * asking, which is not "why won't it" but "where do I do this then".
 */
CsSheetFile.refusal = function(toolName) {
    return toolName + ": this is a SHEET, not the cave's drawing.\n\n" +
        "A sheet is built from the cave's record and rebuilt every " +
        "time you press Build Sheet, so anything drawn here is lost " +
        "the next time anybody does -- silently, and with no way " +
        "back. Open the cave's own drawing, make the change there, " +
        "and build the sheet again.";
};

/**
 * The guard an editing tool runs first.
 *
 * \return true when the tool should STOP. Warns the caver itself, so a
 *         caller is one line: `if (CsSheetFile.blocks(doc, "Feature
 *         Trace")) { return; }`
 */
CsSheetFile.blocks = function(doc, toolName) {
    if (!CsSheetFile.isSheet(doc)) {
        return false;
    }
    try {
        warning(CsSheetFile.refusal(toolName));
    } catch (eWarn) {
    }
    return true;
};
