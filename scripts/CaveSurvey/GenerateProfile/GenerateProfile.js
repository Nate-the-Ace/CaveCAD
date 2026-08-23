// GenerateProfile.js
//
// QCAD add-on tool: force a rebuild of the extended elevation and show
// what it could not draw.
//
// The profile normally rebuilds itself on every plan draw (CsDraw.profile,
// gated by CaveSurvey/ProfileAuto and CaveSurvey/ProfileAutoMaxStations --
// see CsDraw.js's own docblock). This tool exists for what that gate
// cannot cover: the setting is off, the survey's total station count is
// over the automatic size limit, or -- the more common reason to reach
// for it -- the user wants to SEE the report the automatic pass only ever
// writes silently into its own return value: every side lead left out,
// every spur whose name disagrees with its surveyed junction, every leg
// the profile could not draw, and every station with no resolved
// elevation. This command is never gated by ProfileAuto or
// ProfileAutoMaxStations -- forcing past both is the point of running it
// by hand.
//
// WHAT REBUILDING FROM THE DRAWING COSTS, AND WHAT IT NO LONGER COSTS:
// this tool rebuilds its survey from the DRAWING's own tags
// (CsTags.surveyFromDocument) rather than from a notebook that may not
// be open. Splays USED TO BE LOST that way -- that reader walked
// Station-tagged points only, and splay geometry is tagged Splay (on
// the ray) and SplayName (on the tip), so a cave whose floor and
// ceiling come from splays got a profile built from LRUD alone. It no
// longer does: CsTags.collectSplays rebuilds each splay from its ray's
// own schema-v3 shot tags, exactly, and falls back to the tip's
// position where a pre-v3 ray has no readings on it. So "floor and
// ceiling lines from LRUD and splays" is a claim this manual path
// earns too.
//
// TWO RESIDUAL GAPS, both reported rather than silent:
//   * a splay recovered from its TIP alone has no inclination on
//     record (a plan drawing shows only the horizontal projection), so
//     it places no floor or ceiling point -- counted in the profile
//     report's own "splay wall point(s) skipped" line;
//   * splay geometry whose base station is gone from the drawing has
//     nothing to hang on and is not recovered at all -- counted by
//     generateProfileSplayLossWarning below.
//
// USAGE:
//   Cave Survey > Generate Profile   (or type "gp")

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

/** One "Generate Profile: <reason>." warning, the one wording every
 *  refusal in this tool shares -- see the file's own review history for
 *  why this used to be three separately-worded warning() calls instead
 *  of one shared helper. `reason` carries no trailing period of its own. */
function generateProfileRefuse(reason) {
    warning("Generate Profile: " + reason + ".");
}

/**
 * How many distinct splays the DRAWING itself still carries (one
 * SplayName-tagged tip point per splay -- CsDraw.survey's own shape),
 * regardless of whether this tool's own survey rebuild could recover
 * any of them. QCAD only.
 */
function generateProfileCountDrawnSplays(doc) {
    var seen = {};
    var count = 0;
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        var name = CsTags.get(e, "SplayName");
        if (name === "" || seen.hasOwnProperty(name)) {
            continue;
        }
        seen[name] = true;
        count++;
    }
    return count;
}

/** How many splay shots the rebuilt `survey` itself carries. Pure. */
function generateProfileCountRecoveredSplays(survey) {
    var byStation = CsLrud.splaysByStation(survey);
    var count = 0;
    for (var k in byStation) {
        if (byStation.hasOwnProperty(k)) {
            count += byStation[k].length;
        }
    }
    return count;
}

/**
 * The splay geometry the rebuild could not account for at all.
 *
 * CsTags.collectSplays recovers a splay from its ray's shot tags, or
 * from its tip's position, and this compares what it produced against
 * what the drawing still shows. On a drawing this suite drew the two
 * agree and this says nothing. It fires for the one case the reader
 * deliberately refuses: splay geometry whose base station is no longer
 * in the drawing (a station point erased by hand, its splays left
 * behind), which has no origin to measure a tip from and which
 * CsDraw.survey would not redraw either.
 *
 * NOT a "splays are never recovered" notice any more -- that is what
 * this used to be, when the comparison could only ever come back
 * "all of them." It was written as a genuine comparison rather than a
 * bare `drawn > 0` check precisely so that teaching the reader to
 * recover splays would leave it reporting the REMAINING gap instead of
 * a claim that had stopped being true; this is that.
 *
 * A splay recovered from its tip alone, with no inclination on record,
 * is NOT counted here: it came back as real data and the profile's own
 * report names it under "splay wall point(s) skipped."
 *
 * \return a warning line (leading blank line included) or "" when the
 *         counts agree (nothing to report, including the ordinary case
 *         of a survey with no splays drawn at all)
 */
function generateProfileSplayLossWarning(doc, survey) {
    var drawn = generateProfileCountDrawnSplays(doc);
    var recovered = generateProfileCountRecoveredSplays(survey);
    if (drawn === recovered) {
        return "";
    }
    return "\n\nWARNING -- " + drawn + " splay(s) tagged in the drawing, " +
        "but only " + recovered + " could be rebuilt from it: a splay " +
        "whose own station is no longer in the drawing has nothing to " +
        "hang on. The floor and ceiling lines above are missing that " +
        "many splays -- run Rebuild Survey Data to repair the drawing, " +
        "or Import Cave Survey or the Survey Notebook to draw it again " +
        "from the notes.";
}

function generateProfileRun() {
    var doc = getDocument();
    if (doc === undefined || doc === null) {
        generateProfileRefuse("no active drawing document");
        return;
    }

    // From the DRAWING, not a notebook that may not be open: the survey
    // model lives on the entities themselves, so a profile can be
    // rebuilt from any drawing the suite has ever drawn -- splays
    // included (CsTags.collectSplays). See this file's own header
    // comment for the two residual gaps that rebuilding from tags
    // still has, and where each one is reported.
    var survey = CsTags.surveyFromDocument(doc);
    if (survey.shots.length === 0) {
        generateProfileRefuse("no tagged survey stations found.\n" +
            "Run Azimuth Traverse, Import Cave Survey or the Survey " +
            "Notebook first");
        return;
    }

    // Resolve-and-adjust under THIS DRAWING's own recorded adjustment --
    // SurveyStats.js follows the identical rule, for the identical
    // reason: this tool reports on and redraws EXISTING geometry rather
    // than creating it, so it has to reproduce whatever already solved
    // the sheet on screen, not re-solve under today's global setting.
    //
    // WHY resolveAndAdjust AND NOT A BARE CsNetwork.resolve, MEASURED,
    // NOT ASSUMED: an earlier version of this comment claimed a bare
    // resolve() would "disagree with the automatically drawn one on any
    // survey with loop closures" -- checked against a real loop-closing
    // survey (a 3-unit misclosure, a real Adjustment=lsq tag) and that
    // claim is FALSE: max plan shift 0, max Z shift 0, bare resolve() and
    // resolveAndAdjust produce IDENTICAL coordinates. The reason is
    // CsTags.surveyFromDocument itself: it puts EVERY station it reads
    // into survey.fixed (Critical C's own finding, one review round
    // later), so CsNetwork.resolve finds the whole network already
    // pinned before it ever walks a shot -- every leg comes back kind
    // "tie", nothing is left for a solve to move, and the tags already
    // carry whatever coordinates the LAST adjustment (by whoever drew
    // this sheet) actually produced. resolveAndAdjust is still the right
    // call, for two reasons that have nothing to do with the false claim
    // above: it matches SurveyStats.js's own rule (one convention for
    // "reporting on an existing drawing," not two), and it is
    // future-proof against a later change to surveyFromDocument that
    // recovers less than 100% of the tags as `fixed` (at which point a
    // bare resolve() really could disagree with the plan, and this call
    // would already be doing the right thing without anyone having to
    // remember to fix it).
    var resolved = CsAdjust.resolveAndAdjust(survey, {},
        CsAdjust.optionsFromTags(
            CsRevise.adjustTagsOn(CsRevise.trip0Anchor(doc))));

    // BOTH of CsDraw.profile's own gates (ProfileAuto, size) are bypassed
    // on purpose -- forcing past both is the entire point of a manual
    // command -- so this calls CsDraw.profileNow directly: the shared
    // post-gate sequence (build, draw) that CsDraw.profile itself calls
    // once its own two gates pass.
    //
    // NO REVEAL POLICY ANY MORE, and nothing lost with it: the
    // elevation used to be written to a sibling -PROFILE.dxf, so "show
    // me my profile now" meant opening a second drawing, and this
    // command had to ask for that explicitly (the automatic pass must
    // not, or it would steal focus on every plan draw). The elevation
    // is a region of THIS drawing now, below the plan -- it is already
    // on screen the moment it is drawn, for both callers.
    var settings = CsProfile.settings();
    var outcome = CsDraw.profileNow(doc, getDocumentInterface(), survey,
        resolved, settings);
    if (outcome.skipped) {
        generateProfileRefuse(outcome.reason);
        return;
    }

    var text = CsReport.profileSummary(outcome.profile, outcome);
    text += generateProfileSplayLossWarning(doc, survey);

    // handleUserMessage CANNOT show this: RS.escape does not convert
    // newlines, so every one collapses to a space and a multi-line
    // report reads back as one run-on sentence parsed as rich text.
    // QMessageBox.information is what SurveyStats.js and
    // ImportCaveSurvey.js already use for exactly this reason. Wrapped
    // defensively per this feature's own rule that a failure must
    // degrade, not crash -- by this point the rebuild above already
    // drew real geometry into the drawing, so a dialog that fails to
    // open must not make the command look like it did nothing.
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
