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
// A REAL LIMIT OF THIS PATH, NOT JUST OF THE AUTOMATIC ONE: this tool
// rebuilds its survey from the DRAWING's own tags (CsTags.
// surveyFromDocument), which walks Station-tagged points only. Splay
// geometry is tagged SplayName, not Station, so no splay shot is ever
// reconstructed here -- a cave whose floor and ceiling come partly or
// entirely from splays gets a profile built from LRUD alone, with the
// splay contribution silently missing, UNLESS the drawing's own splays
// still exist and this tool can at least COUNT them against what it
// recovered (see splayLossWarning below). This is a real gap, not
// nothing: it means "floor and ceiling lines from LRUD and splays," the
// phrase the automatic path earns, is not a claim this manual path can
// make for itself without checking.
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
 * CRITICAL C: detect -- not recover -- the splay-loss gap named in this
 * file's own header comment. `survey` is CsTags.surveyFromDocument's own
 * reconstruction, which never sets a shot's `.splay` flag at all (it
 * only walks Station-tagged points), so CsLrud.splaysByStation(survey)
 * is CURRENTLY ALWAYS EMPTY for it -- there is no live case today where
 * this comes back anything but "every drawn splay is unrecovered." It is
 * still written as a genuine comparison, not a bare "drawnSplays > 0"
 * check: if surveyFromDocument is ever taught to recover SOME splays (a
 * separate task -- see the header comment), this keeps reporting exactly
 * the remaining gap instead of continuing to claim total loss.
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
    return "\n\nWARNING -- " + drawn + " splay(s) tagged in the drawing " +
        "could not be recovered by this tool: it rebuilds the survey " +
        "from Station-tagged centerline points only (CsTags." +
        "surveyFromDocument), and splay geometry is tagged SplayName, " +
        "not Station. The floor and ceiling lines above come from LRUD " +
        "alone -- run Import Cave Survey or the Survey Notebook instead " +
        "if the splay data needs to be part of the profile.";
}

function generateProfileRun() {
    var doc = getDocument();
    if (doc === undefined || doc === null) {
        generateProfileRefuse("no active drawing document");
        return;
    }

    // From the DRAWING, not a notebook that may not be open: the survey
    // model lives on the entities themselves, so a profile can be
    // rebuilt from any drawing the suite has ever drawn. See this file's
    // own header comment for the real limit that comes with rebuilding
    // from tags rather than from a notebook: splays are never recovered
    // this way, only detected (generateProfileSplayLossWarning below).
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
    // post-gate sequence (resolve where to draw, build, draw, commit,
    // reveal) that CsDraw.profile itself calls once its own two gates
    // pass. revealPolicy: "always" -- this command's entire reason to
    // exist is "show me my profile now", so it must open the drawing on
    // every successful run, not only when the sibling happened to be
    // freshly created. Without this, the common case -- a sibling that
    // already exists on disk but is not currently open as a tab -- would
    // rewrite the file and tell the user about it in a dialog while
    // never actually showing them the drawing. See CsDraw.profileNow's
    // own docblock for why the AUTOMATIC pass must not do the same
    // (it would steal focus on every ordinary plan draw).
    var settings = CsProfile.settings();
    var outcome = CsDraw.profileNow(doc, survey, resolved, settings,
        "always");
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
