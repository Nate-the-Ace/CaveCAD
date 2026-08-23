// CsProfileFile.js -- finding (or making) the drawing the extended
// elevation lives in.
//
// Part of the Cave Survey Core library. The pure half (siblingPath) runs
// anywhere; everything else is QCAD context and says so.
//
// WHY THE PROFILE IS ITS OWN FILE: an extended elevation's X axis is
// distance along the passage, not northing. Every global operation that
// means something on a plan -- rotate to grid north, scale, morph onto
// an aerial -- means nothing applied to an elevation, and a window
// select or a layer-wide edit in a shared drawing catches both. The
// profile is also going to be SKETCHED ON, which rules out hiding it in
// a block: block editing hides the rest of the sheet, and every
// existing tool queries model space, so block contents would go stale
// with no redraw able to clean them.
//
// WHERE IT DRAWS, in order of preference:
//
//   an open tab   if the sibling file is already open, we draw straight
//                 into that tab's document interface. The user sees it
//                 update, undo works there, and their own unsaved
//                 sketching is not clobbered by a file rewritten
//                 underneath them.
//   off screen    otherwise: a memory document from the PROFILE
//                 template, drawn into, exported to the sibling path,
//                 then revealed in a tab.
//
// Tab enumeration is exactly what library.js's own openFiles() does --
// mdiArea.subWindowList(), then getDocument() on each child -- so this
// is a supported path, not a trick (verified by reading library.js:
// openFiles() does precisely this before deciding whether a file is
// already open). RMdiChildQt also exposes getDocumentInterface() (see
// RMdiChildQt.cpp), which is the piece that lets us DRAW there.

var CsProfileFile = {};

CsProfileFile.SUFFIX = "-PROFILE";

/**
 * The profile file that belongs beside a plan drawing. Pure.
 *
 * null when there is no path at all: an unsaved drawing has nowhere to
 * put a sibling, and inventing a location would scatter files into
 * whatever the working directory happens to be.
 *
 * The result is ALWAYS .dxf, regardless of the plan's own extension.
 * Verified against the fork's source (src/io/ has exactly one format
 * plugin -- dxf; there is no DWG, SVG, or anything else registered),
 * so a document in this build can never be written back out as
 * anything but DXF. If the plan path carried a different extension --
 * or none -- naively preserving it would name a sibling file this
 * application can never successfully export to, since CsProfileFile's
 * whole export path (see dxfFilter/commit below) is DXF-specific.
 *
 * The idempotence check on the -PROFILE suffix is case-INSENSITIVE
 * (this build targets macOS and Windows, both case-insensitive-but-
 * case-preserving -- see templatePath's own docblock for the other
 * place that matters). Without that, a plan saved as "Cave-profile.dxf"
 * (a capitalisation a surveyor could easily type by habit) would not
 * be recognised as already a profile, and would instead be handed back
 * a garbled "Cave-profile-PROFILE.dxf" -- suffixed twice, since only
 * the trailing ".dxf" got stripped before the check failed on case and
 * the whole -PROFILE suffix got appended fresh. The returned path
 * keeps the CALLER's original casing regardless (this only decides
 * whether to treat it as already-a-profile, not to re-case it).
 */
CsProfileFile.siblingPath = function(planPath) {
    if (planPath === undefined || planPath === null) {
        return null;
    }
    var p = String(planPath);
    if (p === "") {
        return null;
    }
    var dot = p.lastIndexOf(".");
    var slash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
    var stem = (dot > slash) ? p.substring(0, dot) : p;
    if (stem.length >= CsProfileFile.SUFFIX.length &&
            stem.substring(stem.length - CsProfileFile.SUFFIX.length)
                .toUpperCase() === CsProfileFile.SUFFIX) {
        return p;   // already the profile file -- returned verbatim,
                    // extension included, so this stays idempotent
    }
    return stem + CsProfileFile.SUFFIX + ".dxf";
};

/**
 * The DXF writer that persists custom properties. QCAD context only.
 *
 * WHY THIS MATTERS IN GENERAL: RFileExporterRegistry::getFileExporter
 * picks the LOWEST positive canExport() score across every registered
 * exporter, and RDxfExporterFactory::canExport scores a name filter
 * containing "dxflib" at 1 versus 100 for a bare .dxf suffix match --
 * so on an install with more than one exporter able to touch .dxf,
 * naming the dxflib filter is what guarantees the writer CaveCAD taught
 * to emit custom properties as XDATA (see RDxfExporter.cpp) is the one
 * that gets instantiated, rather than a lower-priority stock DXF writer
 * that would silently drop every tag.
 *
 * VERIFIED AGAINST THIS FORK: read RDxfExporterFactory.cpp,
 * RFileExporterRegistry.cpp and RDxfPlugin.cpp directly. This build in
 * fact registers exactly one DXF exporter (RDxfExporterFactory,
 * instantiating RDxfExporter unconditionally, XDATA and all) --
 * src/io/ has no other format plugin at all. So on THIS install calling
 * exportFile with "" would currently reach the identical writer just by
 * suffix-matching at priority 100. Naming the filter explicitly is
 * still the correct, defensive choice -- it is what makes the writer
 * selection A DELIBERATE FACT instead of an accident of "nothing else
 * happens to be registered," and it is what the whole tagging scheme
 * should keep depending on if a second exporter is ever added -- but
 * the failure mode described above ("every profile tag silently
 * dropped") does not currently exist in this fork. Recorded here so a
 * future reader does not need to re-derive it.
 */
CsProfileFile.dxfFilter = function() {
    try {
        var filters = RFileExporterRegistry.getFilterStrings();
        for (var i = 0; i < filters.length; i++) {
            if (String(filters[i]).indexOf("dxflib") >= 0) {
                return filters[i];
            }
        }
    } catch (e) {
        // no registry in this context: let the caller pass "" through
    }
    return "";
};

/**
 * Absolute, symlink- and on-disk-case-normalised form of a path, for
 * comparing "is this the same file" rather than "is this the same
 * string". Degrades to the raw path on any failure (including under
 * node, where QFileInfo does not exist at all) rather than throwing --
 * a raw-string fallback is still SOME comparison, and this function
 * has no context to report a failure to.
 *
 * QFileInfo.canonicalFilePath() resolves symlinks and (on a
 * case-insensitive-but-case-preserving filesystem, i.e. the default on
 * macOS and Windows) normalises to the case actually stored on disk --
 * exactly what is needed so two tabs naming the same file by different
 * routes (a symlinked survey folder, or "Cave-Profile.dxf" typed where
 * the file on disk is "Cave-PROFILE.dxf") still compare equal.
 *
 * canonicalFilePath() returns "" when the file does not exist, which
 * would make every not-yet-written path compare equal to every OTHER
 * not-yet-written path (including an untitled document's empty file
 * name) -- so that case falls back to plain absoluteFilePath(), which
 * never resolves symlinks or case but at least does not collapse
 * distinct nonexistent paths into the same empty string.
 *
 * DELIBERATE DIVERGENCE FROM library.js's openFiles(), which compares
 * plain absoluteFilePath() only (see its own tab-matching loop). This
 * function's canonicalFilePath()-first comparison is the more correct
 * one, but the two CAN disagree about whether a file is "the same" --
 * and only in one direction. canonicalFilePath() cannot manufacture a
 * FALSE POSITIVE (two genuinely different on-disk files never share a
 * canonical path, and the absoluteFilePath() fallback only fires for a
 * path that does not exist, so two different not-yet-written paths
 * only "match" by being the literal same string already). It CAN
 * produce a FALSE NEGATIVE: if `want` and `have` are computed on
 * different sides of the exists/does-not-exist line (one file was
 * open, then deleted out from under the tab, or one side's on-disk
 * reality changed between the two calls), one gets canonicalFilePath()
 * and the other gets the absoluteFilePath() fallback, and those two
 * strings need not agree even for the same intended file. A false
 * negative is the DANGEROUS direction here: openTabFor() reports "not
 * open" for a file that actually is, resolve() then builds an
 * off-screen copy instead, and commit() overwrites the file the user
 * has open -- including whatever unsaved sketching is in it -- with
 * that copy. There is no known way to hit this in the ordinary
 * open-a-file-then-look-for-its-own-tab flow (both sides see the same
 * existing file), only in the edited-out-from-under-it case above.
 */
CsProfileFile._comparablePath = function(path) {
    try {
        var fi = new QFileInfo(path);
        var canonical = fi.canonicalFilePath();
        return (canonical !== "") ? canonical : fi.absoluteFilePath();
    } catch (e) {
        return path;
    }
};

/**
 * Every open MDI child window, or [] on any failure (including no MDI
 * area at all -- true of every headless run, GUI or not: `-no-gui` has
 * no main window). Split out from openTabFor so the matching logic
 * below can be unit-tested against a fake list of children instead of
 * a real MDI area, which no headless script -- node OR CaveCAD's own
 * `-no-gui` engine -- can ever construct.
 */
CsProfileFile._listOpenChildren = function() {
    try {
        var appWin = RMainWindowQt.getMainWindow();
        if (isNull(appWin)) {
            return [];
        }
        return appWin.getMdiArea().subWindowList();
    } catch (e) {
        return [];
    }
};

/**
 * The open tab showing a given file, or null.
 *
 * \param path     the file to look for
 * \param children optional: an explicit list of {getDocument,
 *                 getDocumentInterface} objects to search, in place of
 *                 the real MDI area (CsProfileFile._listOpenChildren()
 *                 is used when this is omitted). Existing ONLY so this
 *                 matching logic can be unit-tested with fakes -- no
 *                 real caller needs to pass it.
 * \return {doc, di} or null
 */
CsProfileFile.openTabFor = function(path, children) {
    if (path === null || path === undefined || path === "") {
        return null;
    }
    if (children === undefined) {
        children = CsProfileFile._listOpenChildren();
    }
    var want = CsProfileFile._comparablePath(path);
    for (var i = 0; i < children.length; i++) {
        try {
            var doc = children[i].getDocument();
            if (isNull(doc)) {
                continue;
            }
            var have = CsProfileFile._comparablePath(doc.getFileName());
            if (have === want) {
                return { doc: doc, di: children[i].getDocumentInterface() };
            }
        } catch (e) {
            // one malformed child must not sink the whole scan
            continue;
        }
    }
    return null;
};

/**
 * The PROFILE template, wherever this install keeps it. QCAD only.
 *
 * WORTH KNOWING, NOT FIXING: the first candidate below is
 * `<install>/../Templates/...` -- capital T -- and this repo's own
 * checkout keeps the file under lowercase `templates/`. The candidate
 * only ever matches in development because macOS (and Windows) are
 * case-insensitive-but-case-preserving, so the fallback chain below is
 * not actually being exercised the way running the tests appears to
 * exercise it, and this candidate would silently miss on a
 * case-sensitive filesystem (Linux). Left as is rather than fixed
 * alone: the shape matches CaveTemplateApply.js's identical PLAN-side
 * lookup exactly, and diverging just the PROFILE side would make the
 * two templates' resolution rules disagree for no reason a future
 * reader could see.
 */
CsProfileFile.templatePath = function() {
    var candidates = [
        includeBasePath + "/../Templates/NSS_Cave_Template_PROFILE.dxf",
        RSettings.getStringValue("CaveSurvey/ProfileTemplatePath", ""),
        QDir.homePath() +
            "/Documents/Cave/templates/NSS_Cave_Template_PROFILE.dxf"
    ];
    for (var i = 0; i < candidates.length; i++) {
        if (candidates[i] !== "" && new QFileInfo(candidates[i]).exists()) {
            return candidates[i];
        }
    }
    return null;
};

/**
 * Does an already-imported document actually look like a profile
 * drawing? QCAD context only. Cheap and meaningful because Task 6
 * pinned CsLayers.PROFILE_CEILING ("CTRL-PROFILE-CEILING") into the
 * PROFILE template specifically so a later check would have something
 * reliable to look for -- every profile this tool has ever written
 * carries it, template-fresh or not.
 *
 * WHY THIS CHECK EXISTS: dxflib's DXF parser is lenient -- verified in
 * tests/profile_file_roundtrip.js -- so a stray non-DXF file sitting at
 * the sibling path imports as an empty, valid-looking document instead
 * of failing. Without this check resolve() would hand that empty
 * document back with reason: null, render() would draw into it and
 * create its own seven layers on demand, and commit() would write a
 * plausible-looking DXF over whatever was there -- permanently, since
 * from then on the sibling path exists and the PROFILE template is
 * never consulted again. That silently strips every other piece of
 * template furniture the profile is supposed to have, including the
 * PROFILE-CEILING tracing layer the surveyor is meant to sketch on.
 */
CsProfileFile._looksLikeProfile = function(doc) {
    try {
        return doc.hasLayer(CsLayers.PROFILE_CEILING) ||
            doc.hasLayer("PROFILE-CEILING");
    } catch (e) {
        return false;
    }
};

/**
 * The document to draw the profile into. QCAD context only. Never
 * throws -- every failure comes back as doc: null plus a human-readable
 * reason, because this runs on every plan draw and a thrown exception
 * here must not be able to interrupt drawing the plan itself.
 *
 * \param planPath the plan drawing's file name (doc.getFileName())
 * \return {
 *   doc, di,          the document to draw into, or null on failure
 *   path,             the sibling path
 *   offscreen,        true when doc/di must be exported and destroyed
 *   created,          true when the file did not exist before
 *   reason            why doc is null, in words, when it is
 * }
 */
CsProfileFile.resolve = function(planPath) {
    var path = CsProfileFile.siblingPath(planPath);
    if (path === null) {
        return { doc: null, di: null, path: null, offscreen: false,
            created: false,
            reason: "the drawing has no file name yet -- save it and " +
                "the profile will be written beside it" };
    }

    // A plan whose OWN name already ends in -PROFILE is the case
    // siblingPath's idempotence branch exists for -- its sibling IS
    // itself. Without this check, openTabFor would then match the
    // plan's own open tab, resolve() would hand back the plan's own
    // doc/di, and CsProfileDraw.render would erase and draw the
    // elevation directly on top of the plan's own CTRL-SHOTS/
    // CTRL-STATIONS geometry: precisely the outcome "the profile needs
    // to be its own file" exists to prevent. Compared through
    // _comparablePath rather than by string suffix, so this also
    // catches a plan reached via a different-cased or symlinked route
    // to the identical file.
    if (CsProfileFile._comparablePath(path) ===
            CsProfileFile._comparablePath(planPath)) {
        return { doc: null, di: null, path: path, offscreen: false,
            created: false,
            reason: "this drawing is already a profile; the elevation " +
                "is generated from the plan beside it" };
    }

    var open = CsProfileFile.openTabFor(path);
    if (open !== null) {
        return { doc: open.doc, di: open.di, path: path,
            offscreen: false, created: false, reason: null };
    }

    try {
        var exists = new QFileInfo(path).exists();
        var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
        var di = new RDocumentInterface(doc);
        var source = exists ? path : CsProfileFile.templatePath();
        if (source === null) {
            destr(di);
            return { doc: null, di: null, path: path, offscreen: false,
                created: false,
                reason: "NSS_Cave_Template_PROFILE.dxf not found beside " +
                    "the add-on or in Documents/Cave/templates" };
        }
        if (di.importFile(source, "", false) !==
                RDocumentInterface.IoErrorNoError) {
            destr(di);
            return { doc: null, di: null, path: path, offscreen: false,
                created: false, reason: "could not read " + source };
        }
        // An EXISTING sibling that imported "successfully" may still be
        // garbage: dxflib's parser is lenient enough that a non-DXF
        // text file comes back as an empty, valid-looking document
        // rather than an import error (see _looksLikeProfile's own
        // docblock for why this matters and what it would silently
        // cost). A freshly-poured template is never checked here --
        // Task 6 pinned PROFILE-CEILING into it, so it always passes,
        // and this branch only needs to catch the EXISTING-file case
        // where that is not guaranteed.
        //
        // DECISION: refuse and report, not repour from the template.
        // Silently rewriting a file sitting at this path is worse than
        // telling the surveyor about it -- they may have put it there
        // deliberately (a hand-restored backup, a file copied in from
        // elsewhere), and a tool that quietly replaces user files on a
        // heuristic is a worse failure mode than one that stops and
        // asks. The surveyor can always delete or move the file aside
        // and rerun to get a fresh template-based profile.
        if (exists && !CsProfileFile._looksLikeProfile(doc)) {
            destr(di);
            return { doc: null, di: null, path: path, offscreen: false,
                created: false,
                reason: path + " exists but does not look like a " +
                    "profile drawing (no PROFILE-CEILING layer) -- " +
                    "move it aside or delete it so the profile can be " +
                    "rebuilt from the template" };
        }

        return { doc: doc, di: di, path: path, offscreen: true,
            created: !exists, reason: null };
    } catch (e) {
        return { doc: null, di: null, path: path, offscreen: false,
            created: false,
            reason: "could not build the profile document: " + e };
    }
};

/**
 * Writes an off-screen profile document to its path and disposes of it.
 * QCAD context only. Returns true on success.
 */
CsProfileFile.commit = function(resolved) {
    if (resolved.doc === null || !resolved.offscreen) {
        return resolved.doc !== null;   // an open tab needs no export
    }
    var okWritten = false;
    try {
        okWritten = (resolved.di.exportFile(resolved.path,
            CsProfileFile.dxfFilter()) === true);
    } catch (e) {
        okWritten = false;
    }
    try {
        destr(resolved.di);
    } catch (e2) {
        // disposal is a nicety; the export already happened
    }
    return okWritten;
};

/** Shows the profile file in a tab, without stealing an existing one. */
CsProfileFile.reveal = function(path) {
    try {
        openFiles([path], false);
    } catch (e) {
        // no GUI (headless run): nothing to reveal
    }
};
