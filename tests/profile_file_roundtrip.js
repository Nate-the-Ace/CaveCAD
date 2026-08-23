// profile_file_roundtrip.js -- proves the profile file keeps its tags.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/profile_file_roundtrip.js "$PWD"
//
// The whole regeneration scheme rests on this: profile geometry is
// found again by its tags, so a writer that drops custom properties
// would leave every past profile undeletable and every redraw would
// double it. Verified, not assumed -- see CsProfileFile.dxfFilter.
//
// Everything here is QCAD-context-only machinery (RDocument,
// RDocumentInterface, real file I/O), which is exactly why it cannot
// live in tests/js_unit.js: that file also runs under plain node, and
// node has none of this.

// Some builds' -autostart engines don't preload library.js (same note
// as tests/js_unit.js) -- shim the handful of its globals this script
// needs, matching library.js's own implementations.
if (typeof isNull === "undefined") {
    isNull = function(v) {
        if (v === undefined || v === null) {
            return true;
        }
        try {
            if (typeof v.isNull === "function") {
                return v.isNull();
            }
        } catch (e) {
        }
        return false;
    };
}
if (typeof createSpatialIndex === "undefined") {
    createSpatialIndex = function() {
        return new RSpatialIndexNavel();
    };
}
if (typeof destr === "undefined") {
    destr = function(obj) {
        if (RSettings.getQtVersion() >= 0x060000) {
            obj.destr();
        } else if (typeof obj.destroy === "function") {
            obj.destroy();
        }
    };
}

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];

function loadRepoScript(rel) {
    var file = new QFile(repoRoot + "/" + rel);
    if (!file.open(QIODevice.ReadOnly | QIODevice.Text)) {
        throw new Error("cannot open " + rel);
    }
    var stream = new QTextStream(file);
    var src = stream.readAll();
    file.close();
    // Indirect eval: a direct eval() here would land CsTags/
    // CsProfileFile in THIS FUNCTION's scope, invisible to the rest of
    // the script the moment loadRepoScript() returns -- the exact
    // reason tests/js_unit.js's own loader uses this same trick.
    (0, eval)(src);
}

loadRepoScript("scripts/CaveSurvey/Core/CsLayers.js");
loadRepoScript("scripts/CaveSurvey/Core/CsTags.js");
loadRepoScript("scripts/CaveSurvey/Core/CsProfileFile.js");

var failures = [];
function ok(cond, what) {
    if (!cond) { failures.push(what); }
}

var tmp = QDir.tempPath() + "/cs_profile_roundtrip.dxf";
new QFile(tmp).remove();

// ---------------------------------------------------------------------
// 1. write a tagged line into a fresh document, export, reimport,
//    read back -- the core claim this whole feature depends on.
// ---------------------------------------------------------------------

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var di = new RDocumentInterface(doc);
var op = new RAddObjectsOperation();
var line = new RLineEntity(doc,
    new RLineData(new RVector(0, 0), new RVector(10, 5)));
CsTags.set(line, "ProfileShot", "A1->A2");
CsTags.set(line, "ProfileRun", "A");
op.addObject(line, false);
di.applyOperation(op);

var filter = CsProfileFile.dxfFilter();
var haveDxflib = filter.indexOf("dxflib") >= 0;
ok(haveDxflib, "a dxflib DXF writer is registered (got: '" + filter + "')");
ok(di.exportFile(tmp, filter) === true, "export succeeded");
destr(di);

// The whole tagging scheme depends on the dxflib writer. If it is not
// registered, every assertion below would just be measuring a
// different, unrelated failure (whatever the fallback writer does with
// custom properties) -- skip them and let the loud FAIL above carry
// the report, per the brief: "STOP and report rather than working
// around it."
if (haveDxflib) {
    var back = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var backDi = new RDocumentInterface(back);
    ok(backDi.importFile(tmp, "", false) ===
        RDocumentInterface.IoErrorNoError, "reimport succeeded");

    var ids = back.queryAllEntities(false, false);
    var foundShot = null, foundRun = null;
    for (var i = 0; i < ids.length; i++) {
        var e = back.queryEntity(ids[i]);
        if (isNull(e)) { continue; }
        var v = CsTags.get(e, "ProfileShot");
        if (v !== null && v !== "") {
            foundShot = v;
            foundRun = CsTags.get(e, "ProfileRun");
        }
    }
    ok(foundShot === "A1->A2", "ProfileShot survived the round trip (got " +
        foundShot + ")");
    ok(foundRun === "A", "ProfileRun survived too (got " + foundRun + ")");
    destr(backDi);
}
new QFile(tmp).remove();

// ---------------------------------------------------------------------
// 2. sibling path derivation, in the real engine as well as node --
//    the brief's five node cases, run again here so a divergence
//    between engines (there is precedent for that in this feature --
//    see the unstable-sort convention) cannot hide.
// ---------------------------------------------------------------------

ok(CsProfileFile.siblingPath("/x/Cave.dxf") === "/x/Cave-PROFILE.dxf",
    "sibling path in the CaveCAD engine");
ok(CsProfileFile.siblingPath("/x/Cave.dwg") === "/x/Cave-PROFILE.dxf",
    "forced .dxf extension in the CaveCAD engine too");
ok(CsProfileFile.siblingPath("") === null,
    "unsaved drawing has no sibling, in the CaveCAD engine too");

// ---------------------------------------------------------------------
// 3. resolve() against an UNSAVED plan -- no path at all. Must not
//    throw, must say why in words a surveyor could act on.
// ---------------------------------------------------------------------

var r1 = CsProfileFile.resolve("");
ok(r1.doc === null, "resolve('') refuses to invent a location");
ok(r1.reason === "the drawing has no file name yet -- save it and the " +
        "profile will be written beside it",
    "resolve('') explains itself in these exact words (got: '" +
    r1.reason + "')");

// ---------------------------------------------------------------------
// 3b. resolve() when the "plan" IS already a profile drawing -- the
//     WORST finding from this task's review. siblingPath is idempotent
//     for a path already ending -PROFILE (by design: the profile file
//     is its own sibling), which means resolve() must refuse here
//     rather than matching the plan's own open tab and drawing the
//     elevation directly on top of the plan's own CTRL-SHOTS/
//     CTRL-STATIONS geometry -- precisely what "the profile needs to be
//     its own file" exists to prevent.
// ---------------------------------------------------------------------

var selfPlanPath = QDir.tempPath() + "/cs_profile_roundtrip_self-PROFILE.dxf";
ok(CsProfileFile.siblingPath(selfPlanPath) === selfPlanPath,
    "sanity: siblingPath is idempotent here, exactly the trap condition");

var rSelf = CsProfileFile.resolve(selfPlanPath);
ok(rSelf.doc === null,
    "resolve() refuses when the plan's own path is already a profile");
ok(rSelf.reason === "this drawing is already a profile; the elevation " +
        "is generated from the plan beside it",
    "the reason says so in these exact words (got: '" + rSelf.reason + "')");

// _comparablePath's cross-case file-identity matching, isolated from
// siblingPath's OWN case handling (tested separately, purely, in
// tests/js_unit.js -- CsProfileFile.siblingPath's suffix check is
// case-insensitive so a plan named "Cave-profile.dxf" is not handed a
// garbled double-suffixed sibling). This is the mechanism the
// self-target refusal above relies on for a same-file, different-case
// route: canonicalFilePath() only normalises case for a file that
// EXISTS, so this needs a real marker file on disk to mean anything.
var caseFile = QDir.tempPath() + "/cs_profile_roundtrip_case-PROFILE.dxf";
new QFile(caseFile).remove();
var caseMarker = new QFile(caseFile);
caseMarker.open(QIODevice.WriteOnly);
caseMarker.close();

var caseFileLower = caseFile.toLowerCase();
if (new QFileInfo(caseFileLower).exists()) {
    // Confirms this filesystem really is case-insensitive (true on the
    // macOS/Windows this add-on ships for) before treating a match here
    // as meaningful, rather than asserting a platform-dependent fact as
    // if it always held.
    ok(CsProfileFile._comparablePath(caseFile) ===
            CsProfileFile._comparablePath(caseFileLower),
        "_comparablePath treats a differently-cased path to the same " +
        "EXISTING file as identical (proves canonicalFilePath() is " +
        "doing the normalising, not a fluke of the fallback)");
}
// else: this filesystem is case-sensitive, so the lowercase variant
// really is a different file and correctly does NOT match -- nothing
// to assert on this platform.
new QFile(caseFile).remove();

// ---------------------------------------------------------------------
// 4a. resolve() when the sibling path exists but is EMPTY (0 bytes) --
//     a truncated file, or one that died mid-write. RDocumentInterface
//     itself refuses zero-size files (IoErrorZeroSize), so this is a
//     real, catchable failure and resolve() must pass it through
//     rather than swallowing it into a false success.
// ---------------------------------------------------------------------

var emptyPath = QDir.tempPath() + "/cs_profile_roundtrip_empty-PROFILE.dxf";
new QFile(emptyPath).remove();
var emptyFile = new QFile(emptyPath);
emptyFile.open(QIODevice.WriteOnly);
emptyFile.close();   // 0 bytes on disk

var planPathForEmpty = QDir.tempPath() + "/cs_profile_roundtrip_empty.dxf";
ok(CsProfileFile.siblingPath(planPathForEmpty) === emptyPath,
    "sanity: the empty file really is where resolve() will look");

var r2 = CsProfileFile.resolve(planPathForEmpty);
ok(r2.doc === null,
    "resolve() refuses a zero-byte sibling instead of pretending it worked");
ok(r2.reason === "could not read " + emptyPath,
    "the reason names the file in these exact words (got: '" +
    r2.reason + "')");
new QFile(emptyPath).remove();

// ---------------------------------------------------------------------
// 4b. resolve() when the sibling path exists but holds GARBAGE --
//     syntactically present, non-empty, but not actually a DXF file.
//
//     dxflib's parser is lenient about content it cannot understand:
//     RDxfImporter reports no error for a non-DXF text file, and
//     importFile() comes back RDocumentInterface.IoErrorNoError with an
//     EMPTY document rather than failing -- TESTED, not assumed. There
//     is no zero-size or permission signal to catch this at the
//     importFile() level, so resolve() checks the document's CONTENT
//     afterward instead: _looksLikeProfile() looks for the
//     PROFILE-CEILING layer Task 6 pinned into the real template, which
//     an empty "imported" garbage document will never have. Without
//     this check the garbage file would be blessed permanently -- from
//     the moment commit() next wrote a plausible DXF over it, `exists`
//     would be true forever after and the PROFILE template would never
//     be consulted again, silently stripping every piece of template
//     furniture including the PROFILE-CEILING tracing layer the
//     surveyor is meant to sketch on (removing Task 11's premise).
//
//     DECISION: refuse and report, not silently repour from the
//     template -- see CsProfileFile.resolve's own comment for why.
// ---------------------------------------------------------------------

var garbagePath =
    QDir.tempPath() + "/cs_profile_roundtrip_garbage-PROFILE.dxf";
new QFile(garbagePath).remove();
var garbage = new QFile(garbagePath);
garbage.open(QIODevice.WriteOnly | QIODevice.Text);
var garbageStream = new QTextStream(garbage);
garbageStream.writeString("this is not a DXF file, just noise\n");
garbage.close();

var planPathForGarbage = QDir.tempPath() + "/cs_profile_roundtrip_garbage.dxf";
ok(CsProfileFile.siblingPath(planPathForGarbage) === garbagePath,
    "sanity: the garbage file really is where resolve() will look");

var r3 = CsProfileFile.resolve(planPathForGarbage);
ok(r3.doc === null,
    "resolve() refuses a garbage sibling instead of blessing it " +
    "permanently (got doc === null: " + (r3.doc === null) + ")");
ok(r3.reason === garbagePath + " exists but does not look like a " +
        "profile drawing (no PROFILE-CEILING layer) -- move it aside " +
        "or delete it so the profile can be rebuilt from the template",
    "the reason explains what's wrong and what to do about it " +
    "(got: '" + r3.reason + "')");
if (r3.doc !== null && r3.offscreen) {
    try { destr(r3.di); } catch (eCleanup) { }
}
new QFile(garbagePath).remove();

// ---------------------------------------------------------------------
// 4c. resolve() on the HAPPY, first-time path: the sibling does not
//     exist anywhere yet, so it must be built from the PROFILE template
//     -- and commit() must be able to write that fresh document out to
//     disk. This is the ordinary case (generating a profile for a
//     drawing that has never had one) and none of 4a/4b exercise it,
//     since both left a file sitting at the sibling path.
// ---------------------------------------------------------------------

var freshSibling =
    QDir.tempPath() + "/cs_profile_roundtrip_fresh-PROFILE.dxf";
new QFile(freshSibling).remove();
var planPathForFresh = QDir.tempPath() + "/cs_profile_roundtrip_fresh.dxf";
ok(CsProfileFile.siblingPath(planPathForFresh) === freshSibling,
    "sanity: the fresh sibling really does not exist yet");
ok(!new QFileInfo(freshSibling).exists(),
    "sanity: confirmed nothing is sitting at the fresh sibling path");

var tpl = CsProfileFile.templatePath();
ok(tpl !== null,
    "the PROFILE template ships with the repo and templatePath() finds " +
    "it (Task 6) -- got null, so the happy path below cannot be reached");

if (tpl !== null) {
    var r4 = CsProfileFile.resolve(planPathForFresh);
    ok(r4.doc !== null,
        "resolve() builds a document from the PROFILE template when no " +
        "sibling exists yet (reason: '" + r4.reason + "')");
    ok(r4.offscreen === true,
        "a freshly built document is offscreen -- nothing to draw into" +
        " it live yet");
    ok(r4.created === true,
        "created is true: nothing was at this path before");
    if (r4.doc !== null) {
        ok(CsProfileFile.commit(r4) === true,
            "commit() writes the fresh offscreen document out to disk");
        ok(new QFileInfo(freshSibling).exists(),
            "the sibling file actually landed on disk after commit()");

        // 4c-ii. NO FALSE POSITIVE: _looksLikeProfile must accept this
        // file the SECOND time around too -- a real, template-derived
        // profile committed to disk must not be mistaken for garbage
        // by the same check that refuses r3's garbage file above.
        var r4b = CsProfileFile.resolve(planPathForFresh);
        ok(r4b.doc !== null,
            "a real, already-committed profile is accepted on a second " +
            "resolve(), not refused as garbage (reason: '" +
            r4b.reason + "')");
        ok(r4b.created === false,
            "created is false the second time: the file was already there");
        if (r4b.doc !== null && r4b.offscreen) {
            try { destr(r4b.di); } catch (eCleanup2) { }
        }
    }
}
new QFile(freshSibling).remove();

// ---------------------------------------------------------------------
// 4e. commit() must report the TRUE result of the export, not just
//     "there was a document" -- built by resolving a fresh offscreen
//     document (same as 4c) and then pointing it at a path that cannot
//     possibly be written (a directory that does not exist), so the
//     underlying exportFile() call genuinely fails.
// ---------------------------------------------------------------------

if (tpl !== null) {
    var unwritableSibling =
        QDir.tempPath() + "/cs_profile_roundtrip_nowhere/Cave-PROFILE.dxf";
    var planPathForUnwritable =
        QDir.tempPath() + "/cs_profile_roundtrip_nowhere_plan.dxf";
    // resolve() only cares whether ITS OWN computed sibling path
    // exists, and this one deliberately does not (the parent directory
    // itself is absent) -- so it falls through to the template, same
    // as 4c, and we then substitute the unwritable path before commit.
    var r6 = CsProfileFile.resolve(planPathForUnwritable);
    ok(r6.doc !== null,
        "sanity: resolve() still builds the offscreen document " +
        "(reason: '" + r6.reason + "')");
    if (r6.doc !== null) {
        r6.path = unwritableSibling;
        var committed = CsProfileFile.commit(r6);
        ok(committed === false,
            "commit() reports failure when the export genuinely cannot " +
            "be written (got: " + committed + ")");
        ok(!new QFileInfo(unwritableSibling).exists(),
            "and nothing was actually written to the unwritable path");
    }
}

// ---------------------------------------------------------------------
// 4d. resolve() when even the PROFILE template cannot be found. Rather
//     than moving the real template on disk (which every other test in
//     this file, and every other tool, relies on), templatePath() is
//     monkey-patched the same way tests/js_unit.js patches
//     CsProfile.hierarchy -- save it, force it to null, restore it in
//     a finally.
// ---------------------------------------------------------------------

var savedTemplatePath = CsProfileFile.templatePath;
CsProfileFile.templatePath = function() { return null; };
try {
    var noTplSibling =
        QDir.tempPath() + "/cs_profile_roundtrip_notpl-PROFILE.dxf";
    new QFile(noTplSibling).remove();
    var planPathForNoTpl = QDir.tempPath() + "/cs_profile_roundtrip_notpl.dxf";
    var r5 = CsProfileFile.resolve(planPathForNoTpl);
    ok(r5.doc === null,
        "resolve() refuses when no template can be found");
    ok(r5.reason === "NSS_Cave_Template_PROFILE.dxf not found beside " +
            "the add-on or in Documents/Cave/templates",
        "the reason says so in these exact words (got: '" +
        r5.reason + "')");
} finally {
    CsProfileFile.templatePath = savedTemplatePath;
}

// ---------------------------------------------------------------------
// 5. openTabFor degrades to null in a headless run (-no-gui has no MDI
//    area at all) instead of throwing. This is the most a headless
//    script can prove about the REAL MDI area, since -no-gui by
//    definition does not have one. The matching logic itself --
//    actually finding a tab among several candidates -- is instead
//    proven against INJECTED fake children in tests/js_unit.js's own
//    CsProfileFile section (CsProfileFile._listOpenChildren is exactly
//    the seam that makes that possible under node too).
// ---------------------------------------------------------------------

ok(CsProfileFile.openTabFor("/x/Cave-PROFILE.dxf") === null,
    "openTabFor degrades to null with no MDI area (headless)");
ok(CsProfileFile._listOpenChildren().length === 0,
    "there really is no MDI area to enumerate in this headless run");

// ---------------------------------------------------------------------
// 5b. resolve() and commit() actually CONSULT an open tab when there is
//     one, end to end -- not just that openTabFor itself finds one.
//     There is no real MDI area to open a tab in under -no-gui, so
//     openTabFor is monkey-patched (same technique as templatePath
//     above) to report a fake tab for this one path, proving resolve()
//     takes the open-tab branch (offscreen: false, no template or
//     import involved) and commit() takes its no-export short-circuit
//     for it, rather than silently falling through to the offscreen
//     path regardless of what openTabFor says.
// ---------------------------------------------------------------------

var savedOpenTabFor = CsProfileFile.openTabFor;
var fakeOpenDoc = { MARKER: "fake open tab's document" };
var fakeOpenDi = { MARKER: "fake open tab's document interface" };
var openTabForCalledWith = null;
CsProfileFile.openTabFor = function(path) {
    openTabForCalledWith = path;
    return { doc: fakeOpenDoc, di: fakeOpenDi };
};
try {
    var openPlanPath = QDir.tempPath() + "/cs_profile_roundtrip_open.dxf";
    var openSiblingPath = CsProfileFile.siblingPath(openPlanPath);
    var r7 = CsProfileFile.resolve(openPlanPath);
    ok(openTabForCalledWith === openSiblingPath,
        "resolve() actually calls openTabFor with the sibling path, " +
        "not skipping it (got called with: '" + openTabForCalledWith + "')");
    ok(r7.doc === fakeOpenDoc && r7.di === fakeOpenDi,
        "resolve() returns the OPEN TAB's doc/di, not a fresh one, " +
        "when openTabFor reports one is open");
    ok(r7.offscreen === false,
        "an open tab is not offscreen -- nothing to export or destroy");
    ok(r7.created === false,
        "an already-open tab was not just created");

    // commit() must take the no-export short-circuit for this result:
    // resolved.di here is the FAKE di above, which has no exportFile()
    // at all -- if commit() ever tried to call it, this would throw
    // instead of returning cleanly.
    ok(CsProfileFile.commit(r7) === true,
        "commit() short-circuits an open tab's result without " +
        "attempting to export it");
} finally {
    CsProfileFile.openTabFor = savedOpenTabFor;
}

// ---------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------

if (failures.length === 0) {
    print("### PROFILE FILE OK");
} else {
    for (i = 0; i < failures.length; i++) {
        print("FAIL  " + failures[i]);
    }
    print("### PROFILE FILE FAIL");
}
