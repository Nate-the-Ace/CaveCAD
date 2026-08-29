/**
 * CrossSection -- a rough cross section anywhere along the alignment,
 * in two clicks.
 *
 * Pick a point on the surveyed centreline, pick where the section goes.
 * No dialog: there is nothing to type, because the passage IS the
 * answer.
 *
 * WHAT IT DRAWS, AND WHAT THAT COSTS. A cut between two stations is
 * LOFTED from their own measured wall points -- LRUD and splays, in 3D
 * (CsSectionCut). Nothing is carried in from a neighbouring passage and
 * nothing is smoothed. Between stations it is an interpolation and says
 * so: every section's caption states how far the cut is from the nearer
 * station that fed it, so a reader can tell a near-measurement from a
 * guess without being told the difference is small.
 *
 * ONE BLOCK PER SECTION. The section is a block reference on a leader,
 * so it drags as a unit and can be edited without touching any other
 * section. Draw redefines the block in place; it never moves the
 * reference. A caver who wants to keep hand edits freezes that section.
 *
 * USAGE:
 *   Cave Survey > Cross Section   (or "crosssection" / "cxs")
 */
include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");
include(includeBasePath + "/../Callout/CalloutWrite.js");

function CrossSection(guiAction) {
    EAction.call(this, guiAction);
    this.tips = [];
    this.pick = null;        // {from, to, t} the cut, taken on click one
    this.cut = null;         // the CsSectionCut result for it
    this.position = null;
    this.previewPos = undefined;
    this.leader = CsCallout.LEADER_DEFAULT;
}

CrossSection.prototype = new EAction();

CrossSection.State = {
    PickingCut: 0,
    PickingPosition: 1
};

CrossSection.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    var doc = this.getDocument();
    var di = this.getDocumentInterface();
    if (isNull(doc) || isNull(di)) {
        this.terminate();
        return;
    }
    CsLayers.ensure(doc, di, CsLayers.SECTION_OUTLINE);
    this.setState(CrossSection.State.PickingCut);
};

CrossSection.prototype.initState = function() {
    var di = this.getDocumentInterface();
    if (isNull(di)) {
        return;
    }
    this.setCrosshairCursor();
    di.setClickMode(RAction.PickCoordinate);

    switch (this.state) {
    case CrossSection.State.PickingCut:
        di.clearPreview();
        di.repaintViews();
        this.setCommandPrompt(qsTr("Pick the point on the survey to cut " +
            "a section at"));
        this.setLeftMouseTip(qsTr("Point on the passage to cut at"));
        this.setRightMouseTip(EAction.trCancel);
        EAction.showSnapTools();
        break;

    case CrossSection.State.PickingPosition:
        this.setCommandPrompt(qsTr("Pick where the section goes"));
        this.setLeftMouseTip(qsTr("Position of the section"));
        this.setRightMouseTip(EAction.trBack);
        EAction.showSnapTools();
        break;
    }
};

CrossSection.prototype.escapeEvent = function() {
    switch (this.state) {
    case CrossSection.State.PickingPosition:
        this.previewPos = undefined;
        this.setState(CrossSection.State.PickingCut);
        break;
    default:
        EAction.prototype.escapeEvent.call(this);
        break;
    }
};

/** One "Cross Section: ..." message, however this build can show it. */
CrossSection.prototype.say = function(text) {
    try {
        QMessageBox.information(RMainWindowQt.getMainWindow(),
            qsTr("Cross Section"), text);
    } catch (e) {
        EAction.handleUserWarning(text);
    }
};

CrossSection.prototype.pickCoordinate = function(event, preview) {
    var di = this.getDocumentInterface();
    if (isNull(di)) {
        return;
    }
    var doc = this.getDocument();
    var pos = event.getModelPosition();

    switch (this.state) {
    case CrossSection.State.PickingCut:
        if (!preview) {
            // Resolve NOW, on the click. This is the expensive call --
            // it rebuilds the survey from the drawing -- and it runs
            // once per placement, never once per mouse move.
            var asDrawn = null;
            try {
                asDrawn = CsRevise.resolveAsDrawn(doc);
            } catch (eRes) {
                asDrawn = null;
            }
            if (asDrawn === null || isNull(asDrawn.resolved)) {
                this.say(qsTr("This drawing has no survey to cut a " +
                    "section from."));
                this.terminate();
                return;
            }
            var leg = CsSectionCut.nearestLeg(asDrawn.resolved,
                { x: pos.x, y: pos.y });
            if (leg === null) {
                this.say(qsTr("No survey leg near that point, so there " +
                    "is no passage to cut through.\n\nClick on or beside " +
                    "the centreline."));
                this.terminate();
                return;
            }
            var cut = CsSectionCut.cut(asDrawn.survey, asDrawn.resolved,
                leg.from, leg.to, leg.t, {});
            if (cut.refused === true) {
                // Refused, with the reason -- never a section drawn from
                // two points and a hope.
                this.say(qsTr("No section could be cut there: ") +
                    cut.reason + ".");
                this.terminate();
                return;
            }
            this.pick = leg;
            this.cut = cut;
            this.survey = asDrawn.survey;
            this.tips = [{ x: pos.x, y: pos.y }];
            di.setRelativeZero(pos);
            EAction.handleUserMessage(
                qsTr("Cutting %1->%2 at %3% -- %4 from the nearest station")
                    .arg(leg.from).arg(leg.to)
                    .arg(Math.round(leg.t * 100))
                    .arg(CsSectionDraw.round1(cut.nearest)));
            this.setState(CrossSection.State.PickingPosition);
        }
        break;

    case CrossSection.State.PickingPosition:
        this.previewPos = { x: pos.x, y: pos.y };
        if (!preview) {
            this.position = { x: pos.x, y: pos.y };
            di.setRelativeZero(pos);
            this.finish();
        }
        break;
    }
};

CrossSection.prototype.finish = function() {
    var doc = this.getDocument();
    var di = this.getDocumentInterface();
    if (isNull(doc) || isNull(di) || this.cut === null) {
        this.terminate();
        return;
    }
    try {
        var id = CalloutWrite.createSection(doc, di, {
            cut: this.cut,
            from: this.pick.from,
            to: this.pick.to,
            t: this.pick.t,
            position: this.position,
            tips: this.tips,
            leader: this.leader
        });
        if (id === null) {
            this.say(qsTr("The section could not be drawn -- its block " +
                "was refused by this drawing."));
        } else {
            var notes = [];
            if (this.cut.reentrant === true) {
                notes.push(qsTr("a re-entrant was simplified"));
            }
            if (this.cut.reseeded === true) {
                notes.push(qsTr("the section is rotated to keep a steady " +
                    "up on this pitch"));
            }
            EAction.handleUserMessage(
                qsTr("Section cut from %1 measured points at %2 and %3 " +
                    "at %4")
                    .arg(this.cut.measuredFrom + this.cut.measuredTo)
                    .arg(this.pick.from).arg(this.pick.to)
                    .arg(this.pick.from + "->" + this.pick.to) +
                (notes.length > 0 ? " -- " + notes.join(", ") : ""));
        }
    } catch (e) {
        // LOCKED and FROZEN layers refuse writes SILENTLY in this build,
        // so the alternative is a command that looks like it worked and
        // drew nothing.
        this.say(qsTr("The section could not be drawn.\n\n") + e);
    }
    this.terminate();
};

CrossSection.init = function(basePath) {
    var action = new RGuiAction(qsTr("Cross Section"),
                                RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/CrossSection.js");
    action.setIcon(basePath + "/CrossSection.svg");
    action.setStatusTip(qsTr("Two clicks: a point on the passage to cut " +
        "a rough cross section at, then where the section goes"));
    action.setDefaultCommands(["crosssection", "cxs"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(46);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
