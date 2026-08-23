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

function splayOf(from, d, az, inc) {
    var s = CsModel.newShot();
    s.from = from;
    s.to = "";
    s.distance = d;
    s.azimuth = az;
    s.inclination = inc || 0;
    s.splay = true;
    return s;
}

// ---------------------------------------------------------------------
// Fixture: one real off-screen document carrying a real, tagged, four-
// station survey (P1-P2-P3-P4, a plain chain with no branching -- kept
// simple deliberately, since the point of this file is proving the
// PLUMBING works, not re-testing CsProfile's own geometry, which
// tests/js_unit.js and tests/profile_draw_roundtrip.js already do).
//
// P2 carries real LRUD (so the profile draws a real ceiling/floor from
// it) AND a real splay. The splay was added when the tool could only
// DETECT that it had dropped every splay; it stays because the tool now
// RECOVERS it, and a fixture with no splay at all could prove neither.
// Scenario F below is the harder version of the same claim: a cave
// whose floor and ceiling come from splays and NOTHING else.
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
    // LRUD is attributed to the shot's ARRIVING (TO) station, the same
    // convention tests/js_unit.js's own splayFixture() uses -- so P1->P2
    // and P2->P3 each carrying up/down puts real LRUD on P2 AND P3,
    // adjacent stations, which is what actually gives CsProfile.
    // bandWallRuns two points to connect into one real ceiling run and
    // one real floor run (a single LRUD point alone is not a "run").
    var fixtureP1p2 = shotOf("P1", "P2", 10, 0, 0);
    fixtureP1p2.up = 1;
    fixtureP1p2.down = 0.5;
    var fixtureP2 = shotOf("P2", "P3", 10, 90, 0);
    fixtureP2.left = 2;
    fixtureP2.right = 3;
    fixtureP2.up = 1;
    fixtureP2.down = 0.5;
    fixtureSurvey.shots = [
        fixtureP1p2,
        fixtureP2,
        shotOf("P3", "P4", 10, 180, 0),
        splayOf("P2", 4, 45, 20)
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
        // IMPORTANT (untested behaviours): driven through the tool's
        // OWN wired entry point, new GenerateProfile(null).beginEvent(),
        // not the bare generateProfileRun() free function every
        // scenario in this file used to call directly. Deleting the
        // generateProfileRun() call OUT of beginEvent survived every
        // other test here, because they all call the free function
        // themselves -- a miswired beginEvent would mean a menu item
        // that does nothing, with a fully green suite. guiAction is
        // null: this action was never triggered from an actual menu
        // click, which EAction's own constructor already tolerates
        // (isNull(guiAction) guards every place it matters).
        new GenerateProfile(null).beginEvent();

        // ---- claim 1: rebuilt from CsTags.surveyFromDocument, not a
        // notebook, and not zero stations -----------------------------
        ok(spy.capturedSurvey !== null,
            "generateProfileRun() called CsTags.surveyFromDocument to " +
            "rebuild the survey (a tool that read a notebook, a cache, " +
            "or nothing at all would leave this null)");
        // SPLAY SHOTS ARE SKIPPED HERE, and that is not a workaround:
        // the rebuild now recovers them (see the splay claims below),
        // a splay has no TO station by definition, and counting its
        // "" would make this a station count of 5 for a four-station
        // drawing -- measuring the wrong thing, which is exactly what
        // this assertion's own message warns against.
        var distinctStations = {};
        if (spy.capturedSurvey !== null) {
            for (var i = 0; i < spy.capturedSurvey.shots.length; i++) {
                if (spy.capturedSurvey.shots[i].splay) {
                    continue;
                }
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
            }) + generateProfileSplayLossWarning(fixtureDoc,
                spy.capturedSurvey);
            eqs(spy.informationCalls[0].text, expectedText,
                "the report text is exactly CsReport.profileSummary's " +
                "own output for what was actually built and drawn, plus " +
                "the CRITICAL C splay-loss warning");
        }

        // ---- claim 3b: THE SPLAY GAP IS CLOSED, driven end to end.
        // The fixture's own P2 splay is drawn in the plan (fixtureDoc)
        // and now survives the rebuild -- CsTags.surveyFromDocument
        // reads it back off its own Splay/SplayName geometry. Both
        // halves are asserted: the splay IS in the survey the tool
        // profiled, AND the dialog carries no splay-loss warning, since
        // there is no longer any loss to report. This used to be the
        // opposite pair of assertions (0 recovered, a WARNING line in
        // the text) -- the whole point of the change. -----------------
        if (spy.capturedSurvey !== null) {
            eqs(generateProfileCountRecoveredSplays(spy.capturedSurvey), 1,
                "the tool's own rebuild recovers the drawing's splay " +
                "(0 was the gap this closed)");
        }
        if (spy.informationCalls.length === 1) {
            ok(spy.informationCalls[0].text.indexOf("WARNING -- ") < 0 ||
                spy.informationCalls[0].text.indexOf(
                    "splay(s) tagged in the drawing") < 0,
                "no splay-loss warning on a drawing whose splays all " +
                "came back, got:\n" + spy.informationCalls[0].text);
        }
        if (spy.capturedSurvey !== null) {
            eqs(generateProfileSplayLossWarning(fixtureDoc,
                spy.capturedSurvey), "",
                "and the warning helper itself returns nothing for it");
        }
        // sanity: the fixture's own LRUD still produces a real ceiling
        // and floor run -- so a failure in the splay claims above reads
        // as "the splays broke", not "the whole profile came back
        // empty".
        if (spy.capturedCounts !== null) {
            ok(spy.capturedCounts.ceilingRuns > 0 &&
                spy.capturedCounts.floorRuns > 0,
                "sanity: the fixture's LRUD (recovered from tags, unlike " +
                "its splay) still produces a real ceiling/floor run, " +
                "got ceilingRuns=" + spy.capturedCounts.ceilingRuns +
                " floorRuns=" + spy.capturedCounts.floorRuns);
        }

        // ---- claim 4: CsProfileBind is actually WIRED into CsAll.js,
        // and its outcome actually reaches the dialog, through the REAL
        // include() chain -- not tests/profile_draw_roundtrip.js's own
        // hand-picked CORE file list, which bypasses CsAll.js's
        // basename bookkeeping entirely and so can never prove a
        // dropped `include(".../CsProfileBind.js")` line would be
        // caught. This file is the one that drives the real include(),
        // so this is the one place that regression is actually
        // reachable. ------------------------------------------------
        if (spy.capturedCounts !== null) {
            ok(spy.capturedCounts.claimed !== undefined &&
                spy.capturedCounts.claimed.error === undefined,
                "CsProfileBind.claim() ran through the real CsAll.js " +
                "include chain with no error (got " +
                JSON.stringify(spy.capturedCounts.claimed) + ")");
            eqs(spy.capturedCounts.claimed.tagged, 0,
                "sanity: nothing to claim on a document with no prior " +
                "sketch");
            ok(spy.capturedCounts.linework !== undefined,
                "the linework outcome is present on a real render()");
            eqs(spy.capturedCounts.linework.moved, 0,
                "sanity: nothing moves on a document's first-ever draw");
        }
        if (spy.informationCalls.length === 1) {
            ok(spy.informationCalls[0].text.indexOf(
                "Traced linework moved with its stations: 0") >= 0,
                "THE LINEWORK OUTCOME REACHED THE ACTUAL DIALOG TEXT, " +
                "via CsReport.profileSummary -> CsRevise.lineworkSummary, " +
                "driven by the tool's OWN run() through the real " +
                "CsAll.js include chain (text was:\n" +
                spy.informationCalls[0].text + ")");
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

// =======================================================================
// Scenario E: MINOR (untested behaviours) -- the commit-failure branch,
// now shared with CsDraw.profile through CsDraw.profileNow, had no
// coverage on the MANUAL tool's own side (tests/js_unit.js's Task 9
// block covers the automatic path). CsProfileFile.commit() returning
// false (a real write failure) must surface as a named refusal, not be
// swallowed or reported as success.
// =======================================================================

if (tplPath !== null) {
    var planPathE = QDir.tempPath() + "/cs_generate_profile_run_planE.dxf";
    var siblingPathE = CsProfileFile.siblingPath(planPathE);
    new QFile(siblingPathE).remove();
    fixtureDoc.setFileName(planPathE);
    getDocument = function() { return fixtureDoc; };
    getDocumentInterface = function() { return fixtureDi; };

    var savedCommitE = CsProfileFile.commit;
    CsProfileFile.commit = function() { return false; };
    withSpies(function(spy) {
        try {
            generateProfileRun();
        } finally {
            CsProfileFile.commit = savedCommitE;
        }
        eqs(spy.warnings.length, 1, "exactly one warning fired");
        eqs(spy.warnings[0],
            "Generate Profile: could not write " + siblingPathE + ".",
            "MINOR now covered: a commit() failure is reported by name, " +
            "not silently treated as success");
        eqs(spy.informationCalls.length, 0,
            "a commit failure shows no report -- nothing was actually " +
            "written to show");
    });
    ok(!new QFileInfo(siblingPathE).exists(),
        "PROOF: the forced commit failure wrote nothing to the sibling " +
        "path");
} else {
    failures.push("SKIPPED scenario E entirely -- no PROFILE template " +
        "found, so nothing above it could be proven either");
}

// =======================================================================
// Scenario F: THE MEASURED CONSEQUENCE, end to end -- a cave whose floor
// and ceiling come ENTIRELY from splays, with no LRUD anywhere.
//
// This is the shape the whole splay-recovery task was reported against:
// through the automatic pass (which is handed the live survey model) it
// recovered 4 splays and drew 1 ceiling run and 1 floor run; through
// THIS tool, which rebuilds from the drawing instead, it recovered 0 and
// drew 0 and 0. Scenario A's fixture cannot show that -- its P2 LRUD
// draws a ceiling and a floor run whether or not a single splay comes
// back, so its run counts are identical either way. Here they are the
// whole assertion: revert the recovery and this scenario reports
// ceilingRuns 0, floorRuns 0.
// =======================================================================

if (tplPath !== null) {
    var splayDoc = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var splayDi = new RDocumentInterface(splayDoc);
    getDocument = function() { return splayDoc; };
    getDocumentInterface = function() { return splayDi; };

    var hadAutoF = RSettings.getBoolValue(KEY_AUTO, true);
    RSettings.setValue(KEY_AUTO, false); // the fixture draw is inert here too
    try {
        var splaySurvey = CsModel.newSurvey();
        // Two adjacent stations each carrying an UP and a DOWN splay --
        // two ceiling points and two floor points, which is what makes a
        // RUN (a single point on a line is not one, same rule as
        // CsLrud.wallRuns). No left/right/up/down anywhere: every wall
        // point this cave has is a splay.
        splaySurvey.shots = [
            shotOf("F1", "F2", 10, 0, 0),
            shotOf("F2", "F3", 10, 0, 0),
            splayOf("F2", 4, 90, 60),    // ceiling
            splayOf("F2", 3, 270, -60),  // floor
            splayOf("F3", 4, 90, 60),    // ceiling
            splayOf("F3", 3, 270, -60)   // floor
        ];
        var splayDrawn = CsDraw.survey(splaySurvey,
            CsNetwork.resolve(splaySurvey, {}));
        eqs(splayDrawn.splaysDrawn, 4,
            "sanity: the splay-only fixture drew 4 splay rays");
    } finally {
        RSettings.setValue(KEY_AUTO, hadAutoF);
    }

    var planPathF = QDir.tempPath() + "/cs_generate_profile_run_planF.dxf";
    var siblingPathF = CsProfileFile.siblingPath(planPathF);
    new QFile(siblingPathF).remove();
    splayDoc.setFileName(planPathF);

    withSpies(function(spy) {
        new GenerateProfile(null).beginEvent();

        if (spy.capturedSurvey !== null) {
            eqs(generateProfileCountRecoveredSplays(spy.capturedSurvey), 4,
                "SPLAY-ONLY CAVE: all 4 splays are recovered from the " +
                "drawing (this was 0 -- the whole gap)");
        }
        if (spy.capturedCounts !== null) {
            ok(spy.capturedCounts.ceilingRuns > 0,
                "SPLAY-ONLY CAVE: a real ceiling run is drawn from the " +
                "splays alone (this was 0), got " +
                spy.capturedCounts.ceilingRuns);
            ok(spy.capturedCounts.floorRuns > 0,
                "SPLAY-ONLY CAVE: a real floor run is drawn from the " +
                "splays alone (this was 0), got " +
                spy.capturedCounts.floorRuns);
        }
        eqs(spy.informationCalls.length, 1,
            "SPLAY-ONLY CAVE: the report still reaches the user exactly " +
            "once");
    });
    ok(new QFileInfo(siblingPathF).exists(),
        "SPLAY-ONLY CAVE: the sibling PROFILE.dxf landed on disk");
    new QFile(siblingPathF).remove();
} else {
    failures.push("SKIPPED scenario F entirely -- no PROFILE template " +
        "found, so nothing above it could be proven either");
}

// =======================================================================
// Scenario G: the splay-loss warning is not dead code. It no longer
// fires for "splays are never recovered" (they are), but it still fires
// for the one case CsTags.collectSplays deliberately refuses: splay
// geometry whose base station is no longer in the drawing -- a station
// point erased by hand, its splays left behind. There is no origin to
// measure such a tip from and CsDraw.survey would not redraw it either,
// so the tool has to SAY the profile is missing it.
// =======================================================================

if (tplPath !== null) {
    var ghostDoc = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var ghostDi = new RDocumentInterface(ghostDoc);
    getDocument = function() { return ghostDoc; };
    getDocumentInterface = function() { return ghostDi; };

    var hadAutoG = RSettings.getBoolValue(KEY_AUTO, true);
    RSettings.setValue(KEY_AUTO, false);
    try {
        var ghostSurvey = CsModel.newSurvey();
        var ghostUp = shotOf("G1", "G2", 10, 0, 0);
        ghostUp.up = 1;
        ghostUp.down = 1;
        var ghostUp2 = shotOf("G2", "G3", 10, 0, 0);
        ghostUp2.up = 1;
        ghostUp2.down = 1;
        ghostSurvey.shots = [ghostUp, ghostUp2, splayOf("G2", 4, 90, 40)];
        CsDraw.survey(ghostSurvey, CsNetwork.resolve(ghostSurvey, {}));
    } finally {
        RSettings.setValue(KEY_AUTO, hadAutoG);
    }

    // ORPHAN the drawn splay by renaming its tip and its ray onto a
    // station this drawing does not have. Renaming, rather than deleting
    // G2, is what leaves the rest of the survey intact so the profile
    // still builds and still has a report to carry the warning.
    var ghostOp = new RModifyObjectsOperation();
    var ghostIds = ghostDoc.queryAllEntities(false, false);
    var ghostRetagged = 0;
    for (var gi = 0; gi < ghostIds.length; gi++) {
        var ge = ghostDoc.queryEntity(ghostIds[gi]);
        if (isNull(ge)) {
            continue;
        }
        if (CsTags.get(ge, "SplayName") !== "") {
            CsTags.set(ge, "SplayName", "GONE.1");
            ghostOp.addObject(ge, false);
            ghostRetagged++;
        } else if (CsTags.get(ge, "Splay") !== "") {
            CsTags.set(ge, "Splay", "GONE.1");
            ghostOp.addObject(ge, false);
            ghostRetagged++;
        }
    }
    ghostDi.applyOperation(ghostOp);
    eqs(ghostRetagged, 2,
        "sanity: both carriers of the splay (its ray and its tip) were " +
        "re-tagged onto a station the drawing does not have");

    var planPathG = QDir.tempPath() + "/cs_generate_profile_run_planG.dxf";
    var siblingPathG = CsProfileFile.siblingPath(planPathG);
    new QFile(siblingPathG).remove();
    ghostDoc.setFileName(planPathG);

    withSpies(function(spy) {
        new GenerateProfile(null).beginEvent();

        if (spy.capturedSurvey !== null) {
            eqs(generateProfileCountRecoveredSplays(spy.capturedSurvey), 0,
                "ORPHANED SPLAY: it is refused, not hung on a station " +
                "that is not there");
        }
        eqs(spy.informationCalls.length, 1,
            "ORPHANED SPLAY: the report still reaches the user");
        if (spy.informationCalls.length === 1) {
            ok(spy.informationCalls[0].text.indexOf(
                "WARNING -- 1 splay(s) tagged in the drawing, but only " +
                "0 could be rebuilt from it") >= 0,
                "ORPHANED SPLAY: the warning still fires, and names both " +
                "counts, got:\n" + spy.informationCalls[0].text);
        }
    });
    new QFile(siblingPathG).remove();
    destr(ghostDi);
} else {
    failures.push("SKIPPED scenario G entirely -- no PROFILE template " +
        "found, so nothing above it could be proven either");
}

// ---------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------

destr(fixtureDi);
destr(emptyDi);
if (typeof splayDi !== "undefined") {
    destr(splayDi);
}

if (failures.length === 0) {
    print("### GENERATE PROFILE RUN OK");
} else {
    for (var f = 0; f < failures.length; f++) {
        print("FAIL  " + failures[f]);
    }
    print("### GENERATE PROFILE RUN FAIL");
}
