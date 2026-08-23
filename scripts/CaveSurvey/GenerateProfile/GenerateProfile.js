// GenerateProfile.js
//
// QCAD add-on tool: force a rebuild of the extended elevation and show
// what it could not draw.
//
// The profile normally rebuilds itself on every plan draw (CsDraw.profile,
// gated by CaveSurvey/ProfileAuto and CaveSurvey/ProfileAutoMaxStations --
// see CsDraw.js's own docblock). This tool exists for what that gate
// cannot cover: the setting is off, the survey's largest run is over the
// automatic size limit, or -- the more common reason to reach for it --
// the user wants to SEE the report the automatic pass only ever writes
// silently into its own return value: every side lead left out, every
// spur whose name disagrees with its surveyed junction, every leg the
// profile could not draw, and every station with no resolved elevation.
// This command is never gated by ProfileAuto or ProfileAutoMaxStations --
// forcing past both is the point of running it by hand.
//
// USAGE:
//   Cave Survey > Generate Profile   (or type "gp")

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

function generateProfileRun() {
    var doc = getDocument();
    if (doc === undefined || doc === null) {
        warning("Generate Profile: no active drawing document.");
        return;
    }

    // From the DRAWING, not a notebook that may not be open: the survey
    // model lives on the entities themselves, so a profile can be
    // rebuilt from any drawing the suite has ever drawn.
    var survey = CsTags.surveyFromDocument(doc);
    if (survey.shots.length === 0) {
        warning("Generate Profile: no tagged survey stations found.\n" +
            "Run Azimuth Traverse, Import Cave Survey or the Survey " +
            "Notebook first.");
        return;
    }

    // Resolve-and-adjust under THIS DRAWING's own recorded adjustment --
    // SurveyStats.js follows the identical rule, for the identical
    // reason: this tool reports on and redraws EXISTING geometry rather
    // than creating it, so it has to reproduce whatever already solved
    // the sheet on screen, not re-solve under today's global setting
    // (which could silently move every band relative to the plan beside
    // it). CsDraw.profile's automatic path gets its `resolved` the same
    // way one level up: every caller of CsDraw.survey builds it via
    // CsAdjust.resolveAndAdjust before handing it down to CsDraw.profile.
    var resolved = CsAdjust.resolveAndAdjust(survey, {},
        CsAdjust.optionsFromTags(
            CsRevise.adjustTagsOn(CsRevise.trip0Anchor(doc))));

    var target = CsProfileFile.resolve(doc.getFileName());
    if (target.doc === null) {
        // resolve() refuses for good reasons -- an unsaved drawing, a
        // drawing that IS a profile, an existing sibling that isn't a
        // valid profile drawing -- and hands back which one in `reason`
        // rather than a bare failure, so surface it instead of
        // swallowing it into a generic message.
        warning("Generate Profile: " + target.reason + ".");
        return;
    }

    var settings = CsProfile.settings();
    var built = CsProfile.build(survey, resolved, {
        exaggeration: settings.exaggeration,
        flatSplayDeg: settings.flatSplayDeg
    });
    var counts = CsProfileDraw.render(target.doc, target.di, built, {});
    if (!CsProfileFile.commit(target)) {
        warning("Generate Profile: could not write " + target.path + ".");
        return;
    }
    CsProfileFile.reveal(target.path);

    var text = CsReport.profileSummary(built, {
        path: target.path, created: target.created, counts: counts
    });

    // handleUserMessage CANNOT show this: RS.escape does not convert
    // newlines, so every one collapses to a space and a multi-line
    // report reads back as one run-on sentence parsed as rich text.
    // QMessageBox.information is what SurveyStats.js and
    // ImportCaveSurvey.js already use for exactly this reason. Wrapped
    // defensively per this feature's own rule that a failure must
    // degrade, not crash -- by this point the rebuild above already
    // committed real geometry to the profile file, so a dialog that
    // fails to open must not make the command look like it did nothing.
    try {
        QMessageBox.information(getMainWindow(), "Generate Profile", text);
    } catch (e) {
        try {
            EAction.handleUserMessage(text.replace(/\n/g, "  "));
        } catch (e2) {
            print(text);
        }
    }
}

// ============================================================
// Add-on wiring -- the standard pattern; see docs.
// ============================================================

function GenerateProfile(guiAction) {
    EAction.call(this, guiAction);
}

GenerateProfile.prototype = new EAction();

GenerateProfile.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    generateProfileRun();
    this.terminate();
};

GenerateProfile.init = function(basePath) {
    var action = new RGuiAction(qsTr("Generate Profile"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/GenerateProfile.js");
    action.setIcon(basePath + "/GenerateProfile.svg");
    action.setStatusTip(qsTr("Rebuild the extended elevation and show what it could not draw"));
    action.setDefaultCommands(["genprofile", "gp"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(75);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
