// generate_profile_run.js -- drives GenerateProfile's OWN run function,
// not just the Core library it calls.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/generate_profile_run.js "$PWD"
//
// Every other test in this suite proves the Core library works; none of
// them ever calls a TOOL file's own entry point. That is a real gap for
// GenerateProfile specifically: it is the user-facing command for the
// whole extended-elevation feature, and this repo's own history is that
// "verified by reading" is not enough here -- include() basename dedupe
// and the include("scripts/CaveSurvey/...") path both shipped as "works
// on every review, undefined in the real GUI" before a headless proof
// existed for them. Two claims specifically had no executed coverage
// before this file:
//   1. the tool rebuilds from CsTags.surveyFromDocument (the drawing's
//      own tags), not some cached or empty survey;
//   2. the report reaches the user through QMessageBox.information,
//      never EAction.handleUserMessage -- the newline-collapsing bug
//      this whole convention exists to avoid is invisible in source and
//      invisible in a passing test that never inspects the text it
//      produced, so this file asserts the captured string CONTAINS a
//      newline, not just that some function was called.
//
// HOW A TOOL'S run() GETS DRIVEN HEADLESSLY: GenerateProfile.run() opens
// with `getDocument()` (simple.js's global, not EAction's), which in
// -no-gui mode resolves through RMainWindowQt.getMainWindow()
// .getDocumentInterface() -- and getMdiArea() is null headlessly (no
// window system, so no MDI area is ever built), so that path can never
// hand back a real "current" document no matter what is passed on the
// command line. Confirmed empirically before writing this file, not
// assumed. The fix is not to restructure the tool -- getDocument() and
// getDocumentInterface() are plain global functions, so this test
// simply reassigns them (identical to tests/js_unit.js's own
// freshDoc() helper, written for the same problem when CsDraw.survey's
// hookup was tested in Task 9) to return a real off-screen
// RDocument/RDocumentInterface pair instead. GenerateProfile.js itself
// is loaded byte-for-byte unmodified, through the real include()
// mechanism -- see the loader section below for why that, rather than
// this suite's usual loadRepoScript() trick, is what this file needs.

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

// ---------------------------------------------------------------------
// Loader: the REAL include(), not this suite's usual loadRepoScript()
// indirect-eval trick.
//
// profile_file_roundtrip.js and profile_draw_roundtrip.js only ever
// load specific Core files by hand-picked list, so loadRepoScript()'s
// bypass of include()'s own basename bookkeeping never collides with
// anything. GenerateProfile.js is different: its own first three lines
// ARE `include(...)` calls (EAction.js, simple.js, then
// includeBasePath-relative Core/CsAll.js), and those have to run for
// real -- loading GenerateProfile.js's TEXT through loadRepoScript
// would either skip that header (defeating the point: an
// include("scripts/CaveSurvey/...") mistake is exactly the silent-
// failure class this file exists to catch) or, if the header runs
// anyway, load the whole Core library a SECOND time under a bookkeeping
// system (loadRepoScript) that does not know include()'s registry
// exists -- harmless for files that only define functions, but not
// provably harmless for one that registers something cumulatively
// (Core/Format/CsRegistry.js), and "provably harmless" is the bar this
// feature holds itself to.
//
// So this file uses include() for everything, exactly the sequence
// QCAD itself runs for a real menu click: EAction.js and simple.js by
// their real (app-relative) paths, then includeBasePath pointed at
// Core/ for CsAll.js, then repointed at GenerateProfile/ for the tool
// itself -- proven empirically (a throwaway probe script) to load the
// whole chain once, correctly, with every dependency visible by the
// time GenerateProfile.js's own header re-includes EAction.js/simple.js/
// CsAll.js and finds each already-seen basename a no-op.
include("scripts/EAction.js");
include("scripts/simple.js");

includeBasePath = repoRoot + "/scripts/CaveSurvey/Core";
include(includeBasePath + "/CsAll.js");

includeBasePath = repoRoot + "/scripts/CaveSurvey/GenerateProfile";
include(includeBasePath + "/GenerateProfile.js");

// ---------------------------------------------------------------------
// Assertion harness -- same shape and same rule as tests/js_unit.js's
// own: eqs() names the expected AND actual value so a failure is
// readable without re-running by hand, and every assertion below
// checks an EXACT string, never a substring -- this feature's own
// convention exists because a bundled substring check once passed on
// text from an entirely unrelated feature.
// ---------------------------------------------------------------------

var failures = [];
function ok(condition, what) {
    if (!condition) {
        failures.push(what);
    }
}
function eqs(a, b, what) {
    ok(a === b, what + " (expected " + JSON.stringify(b) +
        ", got " + JSON.stringify(a) + ")");
}

function shotOf(from, to, d, az, inc) {
    var s = CsModel.newShot();
    s.from = from;
    s.to = to;
    s.distance = d;
    s.azimuth = az;
    s.inclination = inc || 0;
    return s;
}

// ---------------------------------------------------------------------
// Fixture: one real off-screen document carrying a real, tagged, four-
// station survey (P1-P2-P3-P4, a plain chain with no branching -- kept
// simple deliberately, since the point of this file is proving the
// PLUMBING works, not re-testing CsProfile's own geometry, which
// tests/js_unit.js and tests/profile_draw_roundtrip.js already do).
//
// getDocument/getDocumentInterface are reassigned here, exactly as
// tests/js_unit.js's own freshDoc() helper does for the identical
// problem in CsDraw.survey's Task 9 tests -- see this file's header for
// why that is the fix rather than a workaround.
// ---------------------------------------------------------------------

var fixtureDoc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var fixtureDi = new RDocumentInterface(fixtureDoc);
getDocument = function() { return fixtureDoc; };
getDocumentInterface = function() { return fixtureDi; };

// CaveSurvey/ProfileAuto is a persistent, real RSettings value (this is
// the same store the installed app reads), so drawing the fixture below
// must not leave it changed for whatever runs next -- saved and
// restored exactly like tests/js_unit.js's own Task 9 block.
var KEY_AUTO = "CaveSurvey/ProfileAuto";
var hadAuto = RSettings.getBoolValue(KEY_AUTO, true);
RSettings.setValue(KEY_AUTO, false); // the fixture draw is not what this
                                      // file is testing; keep it inert
try {
    var fixtureSurvey = CsModel.newSurvey();
    fixtureSurvey.shots = [
        shotOf("P1", "P2", 10, 0, 0),
        shotOf("P2", "P3", 10, 90, 0),
        shotOf("P3", "P4", 10, 180, 0)
    ];
    CsDraw.survey(fixtureSurvey, CsNetwork.resolve(fixtureSurvey, {}));
} finally {
    RSettings.setValue(KEY_AUTO, hadAuto);
}

// Ground truth for "rebuilt from the drawing's own tags, not zero": the
// count CsTags.collectStations() reads directly off the entities just
// drawn, independent of the in-memory `fixtureSurvey` object above (a
// regression that read some cached/stale survey instead of the tags
// could still match `fixtureSurvey`'s own shot count by coincidence; it
// cannot coincidentally match a count taken from the drawing itself).
var taggedStationCount = CsTags.collectStations(fixtureDoc).length;
ok(taggedStationCount === 4,
    "sanity: the fixture drew 4 tagged stations (got " +
    taggedStationCount + ") -- otherwise every assertion below is " +
    "measuring the wrong thing");

var tplPath = CsProfileFile.templatePath();
ok(tplPath !== null,
    "sanity: the PROFILE template is found -- otherwise the happy-path " +
    "scenario below cannot be reached at all");

// ---------------------------------------------------------------------
// Spy helpers: wrap a Cs* function, call straight through to the real
// implementation, and record what passed through. Every spy is
// restored in a `finally` -- these are real globals other stages of
// this run share, and a spy left in place would silently corrupt
// whatever ran next.
// ---------------------------------------------------------------------

function withSpies(fn) {
    var savedSurveyFromDocument = CsTags.surveyFromDocument;
    var savedRender = CsProfileDraw.render;
    var savedInformation = QMessageBox.information;
    var savedHandleUserMessage = EAction.handleUserMessage;
    var savedWarningHandler = warning.handler;

    var spy = {
        capturedSurvey: null,
        capturedBuilt: null,
        capturedCounts: null,
        informationCalls: [],
        handleUserMessageCalls: [],
        warnings: []
    };

    CsTags.surveyFromDocument = function(doc) {
        var s = savedSurveyFromDocument(doc);
        spy.capturedSurvey = s;
        return s;
    };
    CsProfileDraw.render = function(doc, di, built, opts) {
        spy.capturedBuilt = built;
        var counts = savedRender(doc, di, built, opts);
        spy.capturedCounts = counts;
        return counts;
    };
    QMessageBox.information = function(parent, title, text) {
        spy.informationCalls.push({ title: title, text: text });
    };
    EAction.handleUserMessage = function(message, escape) {
        spy.handleUserMessageCalls.push(message);
    };
    warning.handler = function(msg) {
        spy.warnings.push(msg);
    };

    try {
        fn(spy);
    } finally {
        CsTags.surveyFromDocument = savedSurveyFromDocument;
        CsProfileDraw.render = savedRender;
        QMessageBox.information = savedInformation;
        EAction.handleUserMessage = savedHandleUserMessage;
        warning.handler = savedWarningHandler;
    }
}

// =======================================================================
// Scenario A: happy path -- a saved plan with real survey tags rebuilds
// a real sibling PROFILE file and reports through QMessageBox only.
// =======================================================================

if (tplPath !== null) {
    var planPathA = QDir.tempPath() + "/cs_generate_profile_run_planA.dxf";
    var siblingPathA = CsProfileFile.siblingPath(planPathA);
    new QFile(siblingPathA).remove();
    fixtureDoc.setFileName(planPathA);

    withSpies(function(spy) {
        generateProfileRun();

        // ---- claim 1: rebuilt from CsTags.surveyFromDocument, not a
        // notebook, and not zero stations -----------------------------
        ok(spy.capturedSurvey !== null,
            "generateProfileRun() called CsTags.surveyFromDocument to " +
            "rebuild the survey (a tool that read a notebook, a cache, " +
            "or nothing at all would leave this null)");
        var distinctStations = {};
        if (spy.capturedSurvey !== null) {
            for (var i = 0; i < spy.capturedSurvey.shots.length; i++) {
                distinctStations[spy.capturedSurvey.shots[i].from] = true;
                distinctStations[spy.capturedSurvey.shots[i].to] = true;
            }
        }
        var rebuiltStationCount = 0;
        for (var name in distinctStations) {
            if (distinctStations.hasOwnProperty(name)) {
                rebuiltStationCount++;
            }
        }
        eqs(rebuiltStationCount, taggedStationCount,
            "the survey it profiled has the station count the " +
            "drawing's tags carry, not zero and not some other number");

        // ---- claim 2: the report goes through QMessageBox.information,
        // never EAction.handleUserMessage, and IS multi-line ------------
        eqs(spy.informationCalls.length, 1,
            "QMessageBox.information was called exactly once");
        eqs(spy.handleUserMessageCalls.length, 0,
            "EAction.handleUserMessage was never called on the happy path");
        if (spy.informationCalls.length === 1) {
            eqs(spy.informationCalls[0].title, "Generate Profile",
                "the message box title");
            ok(spy.informationCalls[0].text.indexOf("\n") >= 0,
                "PROOF: the report text actually contains a newline -- " +
                "the specific regression worth pinning, since a report " +
                "collapsed to one line is invisible until a human " +
                "looks at the dialog (got: " +
                JSON.stringify(spy.informationCalls[0].text) + ")");
        }

        // ---- claim 3 (bonus, not asked for but free once the spies
        // exist): the text is EXACTLY what CsReport.profileSummary
        // would produce from what was actually drawn -- an exact-string
        // check, not a substring one, per this feature's own rule
        // against bundled substring assertions. -------------------------
        if (spy.informationCalls.length === 1 &&
                spy.capturedBuilt !== null) {
            var expectedText = CsReport.profileSummary(spy.capturedBuilt, {
                path: siblingPathA, created: true, counts: spy.capturedCounts
            });
            eqs(spy.informationCalls[0].text, expectedText,
                "the report text is exactly CsReport.profileSummary's " +
                "own output for what was actually built and drawn");
        }
    });

    ok(new QFileInfo(siblingPathA).exists(),
        "PROOF: the sibling PROFILE.dxf actually landed on disk");
    new QFile(siblingPathA).remove();
} else {
    failures.push("SKIPPED scenario A entirely -- no PROFILE template " +
        "found, so nothing above it could be proven either");
}

// =======================================================================
// Scenario B: refusal -- an unsaved drawing. No path to write to, and
// CsProfileFile.resolve() says so in words; the tool must surface that
// reason (not a generic failure) and must not attempt any report.
// =======================================================================

fixtureDoc.setFileName("");
withSpies(function(spy) {
    generateProfileRun();
    eqs(spy.warnings.length, 1, "exactly one warning fired");
    eqs(spy.warnings[0],
        "Generate Profile: the drawing has no file name yet -- save " +
        "it and the profile will be written beside it.",
        "the refusal reason for an unsaved drawing, in these exact words");
    eqs(spy.informationCalls.length, 0,
        "a refusal shows no report -- there is nothing built to report on");
    eqs(spy.handleUserMessageCalls.length, 0,
        "a refusal does not fall through to handleUserMessage either");
});

// =======================================================================
// Scenario C: refusal -- this drawing IS a profile (its own sibling
// path is itself, by siblingPath's idempotence rule). Drawing the
// elevation directly onto the plan's own CTRL-SHOTS/CTRL-STATIONS
// geometry is exactly what "the profile needs to be its own file"
// exists to prevent, so this must refuse and say why, not just refuse.
// =======================================================================

var selfPath = QDir.tempPath() +
    "/cs_generate_profile_run_self-PROFILE.dxf";
fixtureDoc.setFileName(selfPath);
withSpies(function(spy) {
    generateProfileRun();
    eqs(spy.warnings.length, 1, "exactly one warning fired");
    eqs(spy.warnings[0],
        "Generate Profile: this drawing is already a profile; the " +
        "elevation is generated from the plan beside it.",
        "the refusal reason for a plan that is itself a profile, in " +
        "these exact words");
    eqs(spy.informationCalls.length, 0,
        "a refusal shows no report here either");
});

// =======================================================================
// Scenario D: a drawing with no survey tags at all -- not a refusal
// CsProfileFile ever sees (the tool never gets that far), so it is
// tested separately from B/C above. Established convention across
// every tool in this suite (SurveyStats, BuildLegend, ImportCaveSurvey,
// ScatterBreakdown) is to WARN rather than stay silent when a tool
// finds nothing to work with -- checked against those tools' own
// source before writing GenerateProfile.js, not assumed.
// =======================================================================

var emptyDoc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var emptyDi = new RDocumentInterface(emptyDoc);
emptyDoc.setFileName(QDir.tempPath() + "/cs_generate_profile_run_empty.dxf");
getDocument = function() { return emptyDoc; };
getDocumentInterface = function() { return emptyDi; };
withSpies(function(spy) {
    generateProfileRun();
    eqs(spy.warnings.length, 1, "exactly one warning fired");
    eqs(spy.warnings[0],
        "Generate Profile: no tagged survey stations found.\n" +
        "Run Azimuth Traverse, Import Cave Survey or the Survey " +
        "Notebook first.",
        "the refusal reason for a drawing with no survey tags, in " +
        "these exact words");
    eqs(spy.informationCalls.length, 0,
        "a refusal shows no report here either");
});

// ---------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------

destr(fixtureDi);
destr(emptyDi);

if (failures.length === 0) {
    print("### GENERATE PROFILE RUN OK");
} else {
    for (var f = 0; f < failures.length; f++) {
        print("FAIL  " + failures[f]);
    }
    print("### GENERATE PROFILE RUN FAIL");
}
