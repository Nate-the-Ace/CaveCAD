// CaveTemplateApply.js
//
// The post-new hook body: pours the NSS plan template into a freshly
// created document. Included by QCAD's NewFile machinery after every
// File > New (registered in CaveTemplate.init), which then calls
// initNewFile(mdiChild).
//
// ON BY DEFAULT: this is a cave mapping build, so every File > New
// starts as an NSS cave map. Setting CaveSurvey/TemplateOnNew to
// FALSE (explicitly, per machine) is the only way to get a plain new
// document back; New Cave Map's one-shot flag overrides even that.
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
    // Default TRUE: absent the setting, pour the template. Only an
    // explicit false switches it off, and the one-shot flag beats it.
    var enabled = once ||
        RSettings.getBoolValue("CaveSurvey/TemplateOnNew", true);
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

        // Switch the registry's hidden layers OFF. The template cannot
        // carry this itself: a layer's off state does not survive a DXF
        // round trip in this build (probed 2026-08-28 -- exported off,
        // reimported ON), so every CTRL-RAW / CTRL-HIDDEN / CTRL-DATA /
        // CTRL-SHAPE-SPINE arrived VISIBLE in template-poured drawings.
        // Only here, at document creation -- a caver who switches
        // CTRL-RAW on in a real drawing and saves must keep that choice.
        try {
            if (typeof CsLayers === "undefined") {
                throw new Error("CsLayers not loaded");
            }
            var doc = di.getDocument();
            for (var offName in CsLayers.OFF) {
                if (!CsLayers.OFF.hasOwnProperty(offName) ||
                        CsLayers.OFF[offName] !== true) {
                    continue;
                }
                var lay = doc.queryLayer(offName);
                // A missing layer can come back NULL-WRAPPED (truthy,
                // every method undefined), so detect by demanding a real
                // boolean -- the CsMcpBridge.mainWindow pattern.
                if (lay === undefined || lay === null ||
                        typeof lay.isOff !== "function" ||
                        lay.isOff() !== false) {
                    continue;   // absent, unreadable, or already off
                }
                lay.setOff(true);
                var offOp = new RModifyObjectsOperation();
                offOp.addObject(lay);
                di.applyOperation(offOp);
            }
        } catch (eOff) {
            // visible scaffolding is a nuisance, not a failure
        }

        // Same round-trip loss, same cure, for the suite's LOCKED
        // layers (CTRL-PROFILE-BOX): the lock does not survive the
        // template's DXF either, so re-place it right after the pour.
        try {
            if (typeof CsLayers === "undefined") {
                throw new Error("CsLayers not loaded");
            }
            var doc2 = di.getDocument();
            for (var lockName in CsLayers.LOCKED) {
                if (!CsLayers.LOCKED.hasOwnProperty(lockName) ||
                        CsLayers.LOCKED[lockName] !== true) {
                    continue;
                }
                var lay2 = doc2.queryLayer(lockName);
                if (lay2 === undefined || lay2 === null ||
                        typeof lay2.isLocked !== "function" ||
                        lay2.isLocked() !== false) {
                    continue;   // absent, unreadable, or already locked
                }
                lay2.setLocked(true);
                var lockOp = new RModifyObjectsOperation();
                lockOp.addObject(lay2);
                di.applyOperation(lockOp);
            }
        } catch (eLock) {
            // an unlocked bookkeeping layer is a nuisance, not a failure
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
