/**
 * CsCalloutElev -- a spot floor elevation, in two clicks.
 *
 * Pick what the arrow points at, pick where the label goes. No dialog:
 * there is nothing to type, because the number IS the note.
 *
 * WHY THIS EXISTS ALONGSIDE THE CALLOUT TOOL. The callout tool can
 * already place an elevation -- choose the Elevation style and it fills
 * the text for you. But spot elevations get placed over and over across
 * a map, and a dialog per placement is friction with nothing to show for
 * it. This is the same callout, minus the asking.
 *
 * Everything downstream is shared: CalloutWrite builds it, so it gets the
 * text flip, the single-operation undo and the live preview; and because
 * it is an ordinary callout carrying its provenance, CalloutListener
 * reflows it and CsCalloutSync re-derives it exactly like any other.
 */
include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");
include(includeBasePath + "/../Callout/CalloutWrite.js");

function CalloutElev(guiAction) {
    EAction.call(this, guiAction);
    this.tips = [];
    this.position = null;
    this.previewPos = undefined;
    this.sample = null;        // the floor reading, taken on the first pick
    this.label = undefined;
    this.style = "elevation";
    this.leader = CsCallout.LEADER_DEFAULT;
}

CalloutElev.prototype = new EAction();

CalloutElev.State = {
    PickingTip: 0,
    PickingPosition: 1
};

CalloutElev.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    var doc = this.getDocument();
    var di = this.getDocumentInterface();
    if (isNull(doc) || isNull(di)) {
        this.terminate();
        return;
    }
    CsLayers.ensureCalloutLayers(doc, di);
    this.setState(CalloutElev.State.PickingTip);
};

CalloutElev.prototype.initState = function() {
    var di = this.getDocumentInterface();
    if (isNull(di)) {
        return;
    }
    this.setCrosshairCursor();
    di.setClickMode(RAction.PickCoordinate);

    switch (this.state) {
    case CalloutElev.State.PickingTip:
        // Clear explicitly: this state draws no preview by design, and a
        // leftover label from a position we backed out of is invisible in
        // every headless test and obvious the moment a human tries it.
        di.clearPreview();
        di.repaintViews();
        this.setCommandPrompt(qsTr("Pick the point to take the floor " +
            "elevation at"));
        this.setLeftMouseTip(qsTr("Point to take the elevation at"));
        this.setRightMouseTip(EAction.trCancel);
        EAction.showSnapTools();
        break;

    case CalloutElev.State.PickingPosition:
        this.setCommandPrompt(qsTr("Pick where the elevation label goes"));
        this.setLeftMouseTip(qsTr("Position of the label"));
        this.setRightMouseTip(EAction.trBack);
        EAction.showSnapTools();
        break;
    }
};

CalloutElev.prototype.escapeEvent = function() {
    switch (this.state) {
    case CalloutElev.State.PickingPosition:
        this.previewPos = undefined;
        this.setState(CalloutElev.State.PickingTip);
        break;
    default:
        EAction.prototype.escapeEvent.call(this);
        break;
    }
};

CalloutElev.prototype.pickCoordinate = function(event, preview) {
    var di = this.getDocumentInterface();
    if (isNull(di)) {
        return;
    }
    var doc = this.getDocument();
    var pos = event.getModelPosition();

    switch (this.state) {
    case CalloutElev.State.PickingTip:
        if (!preview) {
            this.tips = [{ x: pos.x, y: pos.y }];
            di.setRelativeZero(pos);

            // Sample NOW, on the click, so the second pick can preview
            // the real label. This is the expensive call -- it resolves
            // the whole survey network -- and it happens once per
            // placement, not once per mouse move.
            var got = CalloutWrite.sampleElevationAt(doc, this.tips[0]);
            if (got === null) {
                // No leg near enough for an honest answer. A dedicated
                // elevation tool has nothing to place without one, so it
                // says why and stops rather than inventing a number or
                // dropping an empty label.
                try {
                    QMessageBox.information(RMainWindowQt.getMainWindow(),
                        qsTr("Elevation Callout"),
                        qsTr("No survey leg near that point, so no floor " +
                            "elevation could be worked out.\n\nUse the " +
                            "Callout tool if you want to place a note " +
                            "there anyway."));
                } catch (e) {
                    EAction.handleUserWarning(
                        qsTr("No survey leg near that point."));
                }
                this.terminate();
                return;
            }
            this.sample = got.sample;
            this.label = got.label;
            // The style follows the BASIS, never a preference: a
            // survey-line stand-in goes on the muted fallback layer so a
            // plot cannot pass it off as a measurement.
            this.style = CsCallout.elevStyle(this.sample);
            this.setState(CalloutElev.State.PickingPosition);
        }
        break;

    case CalloutElev.State.PickingPosition:
        this.previewPos = { x: pos.x, y: pos.y };
        if (preview) {
            this.updatePreview();
        } else {
            this.position = { x: pos.x, y: pos.y };
            di.setRelativeZero(pos);
            this.finish();
        }
        break;
    }
};

/** The live preview IS the real label, via the same builder that writes
 *  it. Returns undefined for the non-preview call: the real write goes
 *  through CalloutWrite.create, which ensures the layer and verifies the
 *  entities landed. */
CalloutElev.prototype.getOperation = function(preview) {
    if (!preview) {
        return undefined;
    }
    var doc = this.getDocument();
    if (isNull(doc) || this.tips.length === 0 ||
            this.label === undefined ||
            this.previewPos === undefined || this.previewPos === null) {
        return undefined;
    }
    try {
        return CalloutWrite.buildOp(doc, {
            text: this.label,
            position: this.previewPos,
            tips: this.tips,
            style: this.style,
            leader: this.leader,
            kind: CsCallout.KIND_ELEV,
            tags: CalloutWrite.elevTags(this.sample),
            height: CalloutWrite.textHeight(doc)
        }).op;
    } catch (e) {
        return undefined;   // a preview must never take the tool down
    }
};

CalloutElev.prototype.finish = function() {
    var doc = this.getDocument();
    var di = this.getDocumentInterface();
    if (isNull(doc) || isNull(di)) {
        this.terminate();
        return;
    }
    try {
        CalloutWrite.create(doc, di, {
            text: this.label,
            position: this.position,
            tips: this.tips,
            style: this.style,
            leader: this.leader,
            kind: CsCallout.KIND_ELEV,
            tags: CalloutWrite.elevTags(this.sample),
            height: CalloutWrite.textHeight(doc)
        });
    } catch (e) {
        // create() throws when the layer refused the write. LOCKED and
        // FROZEN layers refuse SILENTLY here, so the alternative is a
        // command that looks like it worked and drew nothing.
        try {
            QMessageBox.information(RMainWindowQt.getMainWindow(),
                qsTr("Elevation Callout"),
                qsTr("The label could not be drawn.\n\n") + e);
        } catch (eMsg) {
            EAction.handleUserWarning(String(e));
        }
    }
    this.terminate();
};

CalloutElev.init = function(basePath) {
    var action = new RGuiAction(qsTr("Elevation Callout"),
                                RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/CalloutElev.js");
    action.setIcon(basePath + "/CalloutElev.svg");
    action.setStatusTip(qsTr("Two clicks: the point to take the floor " +
        "elevation at, then where the label goes"));
    action.setDefaultCommands(["calloutelev", "cel", "cscalloutelev", "cselev"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(90);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
