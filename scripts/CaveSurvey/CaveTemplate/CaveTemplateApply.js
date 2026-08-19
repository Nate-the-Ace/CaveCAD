// CaveTemplateApply.js
//
// The post-new hook body: pours the NSS plan template into a freshly
// created document. Included by QCAD's NewFile machinery after every
// File > New (registered in CaveTemplate.init), which then calls
// initNewFile(mdiChild).
//
// GATED: runs only when Cave Mode is active, the TemplateOnNew
// setting is true, or New Cave Map set the one-shot flag -- a stock
// QCAD install with the suite merely present keeps its plain New.
//
// The paste copies ALL layers (the template's empty CTRL- layers are
// the point) and empty blocks (the unused SYM_* symbols are the
// point), and the new document keeps no file name, so Save can never
// silently overwrite the template.

function initNewFile(mdiChild) {
    // ---- gate -------------------------------------------------------
    var once = RSettings.getBoolValue("CaveSurvey/TemplateOnNewOnce", false);
    if (once) {
        RSettings.setValue("CaveSurvey/TemplateOnNewOnce", false);
    }
    var enabled = once ||
        RSettings.getBoolValue("CaveSurvey/TemplateOnNew", false) ||
        RSettings.getBoolValue("CaveSurvey/CaveModeActive", false);
    if (!enabled) {
        return;
    }

    if (mdiChild === undefined || mdiChild === null) {
        return;
    }
    var di = mdiChild.getDocumentInterface();
    if (di === undefined || di === null) {
        return;
    }

    // ---- find the template -------------------------------------------
    // Beside the add-on first (the package build puts it there), then
    // the published Cave folder as a fallback for repo checkouts.
    var candidates = [
        includeBasePath + "/../Templates/NSS_Cave_Template_PLAN.dxf",
        RSettings.getStringValue("CaveSurvey/TemplatePath", ""),
        QDir.homePath() + "/Documents/Cave/templates/NSS_Cave_Template_PLAN.dxf"
    ];
    var tpl = null;
    for (var i = 0; i < candidates.length; i++) {
        if (candidates[i] !== "" &&
            new QFileInfo(candidates[i]).exists()) {
            tpl = candidates[i];
            break;
        }
    }
    if (tpl === null) {
        EAction.handleUserWarning("Cave template: " +
            "NSS_Cave_Template_PLAN.dxf not found beside the add-on or " +
            "in Documents/Cave/templates -- new drawing left empty.");
        return;
    }

    // ---- pour it in -----------------------------------------------------
    var sourceDi = new RDocumentInterface(
        new RDocument(new RMemoryStorage(), createSpatialIndex()));
    try {
        if (sourceDi.importFile(tpl, "", false) !==
                RDocumentInterface.IoErrorNoError) {
            EAction.handleUserWarning("Cave template: could not read " + tpl);
            return;
        }

        var op = new RPasteOperation(sourceDi.getDocument());
        op.setOffset(new RVector(0, 0));
        op.setCopyAllLayers(true);   // the empty CTRL- layers matter
        op.setCopyEmptyBlocks(true); // the unused SYM_* blocks matter
        di.applyOperation(op);

        // match the template's units so distances mean what they say
        try {
            di.getDocument().setUnit(sourceDi.getDocument().getUnit());
        } catch (eUnit) {
            // unit stays at the application default
        }

        try {
            di.autoZoom();
        } catch (eZoom) {
            // zoom is a nicety
        }

        EAction.handleUserMessage("New cave map: NSS template loaded " +
            "(layers, symbols, title block). The drawing has no file " +
            "name yet -- Save will ask where to put it.");
    } finally {
        destr(sourceDi);
    }
}
