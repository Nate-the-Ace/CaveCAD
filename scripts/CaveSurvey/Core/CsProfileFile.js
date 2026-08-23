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
            stem.substring(stem.length - CsProfileFile.SUFFIX.length) ===
            CsProfileFile.SUFFIX) {
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
 * string". QCAD context only (QFileInfo).
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
 */
CsProfileFile._comparablePath = function(path) {
    var fi = new QFileInfo(path);
    var canonical = fi.canonicalFilePath();
    return (canonical !== "") ? canonical : fi.absoluteFilePath();
};

/**
 * The open tab showing a given file, or null. QCAD context only.
 *
 * \return {doc, di} or null
 */
CsProfileFile.openTabFor = function(path) {
    if (path === null || path === undefined || path === "") {
        return null;
    }
    try {
        var appWin = RMainWindowQt.getMainWindow();
        if (isNull(appWin)) {
            return null;
        }
        var children = appWin.getMdiArea().subWindowList();
        var want = CsProfileFile._comparablePath(path);
        for (var i = 0; i < children.length; i++) {
            var doc = children[i].getDocument();
            if (isNull(doc)) {
                continue;
            }
            var have = CsProfileFile._comparablePath(doc.getFileName());
            if (have === want) {
                return { doc: doc, di: children[i].getDocumentInterface() };
            }
        }
    } catch (e) {
        // headless, or a bridge without the MDI area: fall through
    }
    return null;
};

/** The PROFILE template, wherever this install keeps it. QCAD only. */
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
