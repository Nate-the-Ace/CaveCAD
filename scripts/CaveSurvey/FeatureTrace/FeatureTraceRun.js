// FeatureTraceRun.js -- the interactive half of Feature Trace.
//
// Derived from QCAD's scripts/Draw/Line/LineFreehand/LineFreehand.js
// (Copyright 2011-2018 Andrew Mustun, GPLv3 -- the same licence as this
// fork), which is where the press/drag/release shape and the
// Ctrl-modifier exclusion come from.
//
// NOT an add-on QCAD can find. AddOn.getAddOns only ever builds an
// add-on from <dir>/<dir>.js, so this file's init() is never called by
// QCAD and FeatureTrace.init() calls it instead. That is also why the
// structural tests -- which read only the folder-named file -- do not
// require a menu entry, icon, sort order or command name here.

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");

function FeatureTraceRun(guiAction) {
    EAction.call(this, guiAction);

    this.samples = [];      // {x, y} in drawing coordinates
    this.region = null;     // cached profile-frame box; see refreshRegion
    this.savedSnap = null;  // snap CLASS NAME to restore on exit
}

FeatureTraceRun.prototype = new EAction();

FeatureTraceRun.State = {
    Idle: 0,
    Drawing: 1
};

/** Screen distance, in pixels, between kept samples.
 *
 *  Screen-space and not drawing-space on purpose. A fixed 1 ft drawing
 *  threshold is sub-pixel when zoomed out -- every mouse pixel would
 *  emit several samples -- and lags a foot behind the cursor when
 *  zoomed in. The 1 ft spacing the feature is named for is applied
 *  later, by CsTrace.resample, where it means a foot of cave. */
FeatureTraceRun.SAMPLE_PIXELS = 6;

/** The armed layer. Module state on FeatureTrace, set by the panel.
 *  Falls back to WALLS-SURVEYED so this action works before the panel
 *  exists, and if the panel ever fails to build. */
FeatureTraceRun.targetLayer = function(doc) {
    if (typeof FeatureTrace === "undefined" || isNull(FeatureTrace.target)) {
        return CsLayers.WALLS_SURVEYED;
    }
    if (FeatureTrace.target !== FeatureTrace.CURRENT_LAYER) {
        // A profile feature belongs to ONE survey run: each run is drawn
        // as its own band, and CsProfile lays bands out so they never
        // overlap, so nothing traced along one run can meet anything
        // traced along another. Segregating them also stops the no-gap
        // tie-in welding one band's ceiling to the next band's floor
        // when the two happen to be laid out within a foot of each
        // other. Plan features are untouched: the plan is one
        // continuous map and a wall runs straight through survey
        // boundaries.
        var run = FeatureTraceRun.runToken();
        if (run !== null &&
                CsLayers.frameOf(FeatureTrace.target) === "profile") {
            var variant = CsLayerVariants.nameFor(FeatureTrace.target, run);
            if (variant !== null) {
                return variant;
            }
        }
        return FeatureTrace.target;
    }
    if (FeatureTrace.target === FeatureTrace.CURRENT_LAYER) {
        // Resolved HERE and not when the button was clicked: the current
        // layer can change between arming and drawing, and the caver
        // means the layer that is current when the line is drawn.
        if (isNull(doc)) {
            return CsLayers.WALLS_SURVEYED;
        }
        var name = doc.getLayerName(doc.getCurrentLayerId());
        if (isNull(name) || String(name).length === 0) {
            return CsLayers.WALLS_SURVEYED;
        }
        return name;
    }
    return FeatureTrace.target;
};

/**
 * Why an add was refused, as a sentence for the command line.
 *
 * Locked and frozen layers refuse adds SILENTLY in this build, and
 * CsLayers.withLayerOn covers only the off case -- so a caver who
 * locked a layer earlier gets no error at all, just a missing line.
 * Reading the state back is the only way to say which it was.
 */
FeatureTraceRun.refusalReason = function(doc, layerName) {
    var lay = null;
    try {
        lay = doc.queryLayer(layerName);
    } catch (e) {
        lay = null;
    }
    if (isNull(lay)) {
        return qsTr("Nothing was drawn: layer %1 could not be found or " +
            "created.").arg(layerName);
    }
    var locked = false, frozen = false;
    try { locked = lay.isLocked(); } catch (e1) {}
    try { frozen = lay.isFrozen(); } catch (e2) {}
    if (locked) {
        return qsTr("Nothing was drawn: layer %1 is LOCKED. Unlock it in " +
            "the Layer List and trace again.").arg(layerName);
    }
    if (frozen) {
        return qsTr("Nothing was drawn: layer %1 is FROZEN. Thaw it in the " +
            "Layer List and trace again.").arg(layerName);
    }
    return qsTr("Nothing was drawn: layer %1 refused the line, and this " +
        "build reports no reason. Please report this.").arg(layerName);
};

/** The survey run the panel has selected, or null for the shared layer.
 *  Read through a helper like the other panel values so the drag action
 *  still works with no panel at all. */
FeatureTraceRun.runToken = function() {
    if (typeof FeatureTrace !== "undefined" && !isNull(FeatureTrace.runToken)) {
        return FeatureTrace.runToken();
    }
    return null;
};

/** The panel's sample interval in feet, or 1.0 without a panel.
 *  Every panel read goes through a helper like this so the drag action
 *  works standalone -- it is usable before the panel exists and if the
 *  panel ever fails to build. */
FeatureTraceRun.intervalFeet = function() {
    if (typeof FeatureTrace !== "undefined" &&
            !isNull(FeatureTrace.intervalFeet)) {
        return FeatureTrace.intervalFeet();
    }
    return 1.0;
};

/** The panel's reduce tolerance as a fraction of the spacing, or a half. */
FeatureTraceRun.toleranceFraction = function() {
    if (typeof FeatureTrace !== "undefined" &&
            !isNull(FeatureTrace.toleranceFraction)) {
        return FeatureTrace.toleranceFraction();
    }
    return 0.5;
};

/**
 * null when `layerName` may be traced at `point`, otherwise the reason
 * it may not.
 *
 * Takes the cached region BOX, not the document: this runs on every
 * press and, via the cursor readout, every mouse move -- and
 * CsTrace.profileRegion walks every entity in the drawing.
 *
 * REFUSES rather than correcting. There is no unambiguous counterpart to
 * correct to: plan WALLS-SURVEYED maps to the elevation's ceiling or its
 * floor depending on what the caver meant, and a guess would write real
 * geometry from an assumption. A refusal costs one re-arm.
 */
FeatureTraceRun.frameGuard = function(box, layerName, point) {
    var want = CsLayers.frameOf(layerName);
    var got = CsTrace.frameIn(box, point);
    if (want === got) {
        return null;
    }
    return qsTr("%1 belongs to the %2 frame, but the cursor is in the %3 " +
        "frame. Arm the %3 row instead, or move to the %2 view.")
        .arg(layerName).arg(want).arg(got);
};

FeatureTraceRun.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    this.setState(FeatureTraceRun.State.Idle);
    this.refreshRegion();

    // Grid snap would quantise every sample onto the grid: a traced wall
    // comes out a staircase, and the collapsed samples get thrown away
    // by the reduce step. Restored in finishEvent below. setSnap only --
    // triggering a snap action from an action lifecycle event frees the
    // running action and segfaults; see CsTrace.suspendSnap.
    this.savedSnap = CsTrace.suspendSnap(this.getDocumentInterface());
};

/** Restores the snap the caver had.
 *
 *  finishEvent and not mouseReleaseEvent: this fires however the action
 *  ends -- Escape, another tool taking over, the window closing -- so
 *  the snap cannot be left switched off by an exit path nobody thought
 *  about. */
FeatureTraceRun.prototype.finishEvent = function() {
    EAction.prototype.finishEvent.call(this);
    CsTrace.restoreSnap(this.getDocumentInterface(), this.savedSnap);
    this.savedSnap = null;
};

FeatureTraceRun.prototype.setState = function(state) {
    EAction.prototype.setState.call(this, state);

    this.getDocumentInterface().setClickMode(RAction.PickCoordinate);
    this.setCrosshairCursor();

    switch (this.state) {
    case FeatureTraceRun.State.Idle:
        var trStart = qsTr("Press and drag to trace %1")
            .arg(FeatureTraceRun.targetLayer(this.getDocument()));
        this.setCommandPrompt(trStart);
        this.setLeftMouseTip(trStart);
        this.setRightMouseTip(EAction.trCancel);
        this.samples = [];
        break;

    case FeatureTraceRun.State.Drawing:
        var trStop = qsTr("Release to finish the run");
        this.setCommandPrompt(trStop);
        this.setLeftMouseTip(trStop);
        this.setRightMouseTip("");
        break;
    }
};

/**
 * Recomputes the cached profile region.
 *
 * Called when the action starts and again after every committed trace:
 * a trace onto a profile layer GROWS the region, so a stale box would
 * refuse the next stroke just past the previous one.
 *
 * Cached at all because CsTrace.profileRegion walks EVERY entity in the
 * drawing, and the cursor readout asks per mouse-move event. On a real
 * cave that is thousands of entities per mouse move.
 */
FeatureTraceRun.prototype.refreshRegion = function() {
    var doc = this.getDocument();
    this.region = isNull(doc) ? null : CsTrace.profileRegion(doc);
};

/** SAMPLE_PIXELS converted to drawing units at the current zoom.
 *  A view we cannot measure falls back to one drawing unit, which
 *  OVER-samples rather than under-samples: too many points is a slow
 *  trace, too few is a wrong one. */
FeatureTraceRun.prototype.sampleThreshold = function() {
    try {
        var view = this.getGraphicsView();
        if (!isNull(view)) {
            var factor = view.getFactor();
            if (factor > 0) {
                return FeatureTraceRun.SAMPLE_PIXELS / factor;
            }
        }
    } catch (e) {
        // no measurable view; fall through
    }
    return 1.0;
};

FeatureTraceRun.prototype.escapeEvent = function() {
    if (this.state === FeatureTraceRun.State.Drawing) {
        // Abandon the run. The add happens on release, so there is
        // nothing applied yet and nothing to undo.
        this.setState(FeatureTraceRun.State.Idle);
        return;
    }
    EAction.prototype.escapeEvent.call(this);
};

FeatureTraceRun.prototype.mousePressEvent = function(event) {
    if (event.button() !== Qt.LeftButton) {
        return;
    }
    if (event.modifiers().valueOf() === Qt.ControlModifier.valueOf()) {
        return;   // reserved, as in LineFreehand
    }
    if (this.state !== FeatureTraceRun.State.Idle) {
        return;
    }

    var p = event.getModelPosition();
    var here = { x: p.x, y: p.y };

    var refusal = FeatureTraceRun.frameGuard(this.region,
        FeatureTraceRun.targetLayer(this.getDocument()), here);
    if (refusal !== null) {
        EAction.handleUserMessage(refusal);
        return;   // nothing captured, nothing to undo
    }

    this.setState(FeatureTraceRun.State.Drawing);
    this.samples = [here];
};

FeatureTraceRun.prototype.mouseMoveEvent = function(event) {
    var p = event.getModelPosition();
    var here = { x: p.x, y: p.y };

    if (!(event.buttons().valueOf() & Qt.LeftButton.valueOf())) {
        // Button up: report which view the cursor is over, from the
        // CACHED box. This is the readout's whole point -- it can still
        // change the caver's mind before the press.
        if (typeof FeatureTrace !== "undefined" &&
                !isNull(FeatureTrace.showCursorFrame)) {
            FeatureTrace.showCursorFrame(CsTrace.frameIn(this.region, here));
        }
        return;
    }
    if (event.modifiers().valueOf() === Qt.ControlModifier.valueOf()) {
        return;
    }
    if (this.state !== FeatureTraceRun.State.Drawing) {
        return;
    }

    var last = this.samples[this.samples.length - 1];
    if (isNull(last) ||
            CsTrace.distance(last, here) >= this.sampleThreshold()) {
        this.samples.push(here);
        this.updatePreview();
    }
};

FeatureTraceRun.prototype.mouseReleaseEvent = function(event) {
    if (event.button() !== Qt.LeftButton) {
        return;
    }
    if (this.state !== FeatureTraceRun.State.Drawing) {
        return;
    }

    this.commit();
    this.setState(FeatureTraceRun.State.Idle);
};

/** Resample, reduce, fit and add the captured drag. */
FeatureTraceRun.prototype.commit = function() {
    var doc = this.getDocument();
    var di = this.getDocumentInterface();
    if (isNull(doc) || isNull(di) || this.samples.length < 2) {
        return;
    }

    // The press was in frame; the RELEASE is what proves the whole path
    // was. A wall crossing the gutter describes nothing in either view.
    var layerName = FeatureTraceRun.targetLayer(doc);
    var pathFrame = CsTrace.pathFrame(this.region, this.samples);

    if (pathFrame === null) {
        EAction.handleUserMessage(qsTr("That run crossed between the plan " +
            "and the elevation. Nothing was drawn -- trace within one view."));
        return;
    }

    // The press-time guard checked the FIRST point only. A drag that
    // starts outside the region and ends deep inside it has a single
    // frame for its whole path, so pathFrame above is happy -- but that
    // frame can still be the wrong one for the armed layer. Without this
    // second check a profile row traced entirely up in the plan lands
    // there, which a headless probe of commit() caught doing exactly
    // that.
    //
    // The current-layer escape hatch is exempt on purpose: its layer is
    // whatever the caver chose, "sheet" frame layers included, and
    // refusing those would defeat the point of the button.
    if (FeatureTrace.target !== FeatureTrace.CURRENT_LAYER) {
        var wantFrame = CsLayers.frameOf(layerName);
        if (wantFrame !== pathFrame) {
            EAction.handleUserMessage(qsTr("%1 belongs to the %2 frame, but " +
                "that run is in the %3 frame. Nothing was drawn.")
                .arg(layerName).arg(wantFrame).arg(pathFrame));
            return;
        }
    }

    var unit = CsUnits.fromDrawingUnit(doc.getUnit(), RS);
    // spacingFor gives drawing units per FOOT, so multiplying by the
    // panel's interval keeps that field in feet whatever the drawing is
    // in. Tolerance is a fraction of the spacing for the same reason:
    // one smoothing setting means the same thing in both.
    var perFoot = CsTrace.spacingFor(unit);
    var spacing = perFoot * FeatureTraceRun.intervalFeet();
    var tolerance = spacing * FeatureTraceRun.toleranceFraction();

    // No-gap walls: a stroke starting or ending within a foot of an
    // existing wall end begins or ends exactly THERE instead. Our own
    // distance test, not QCAD's snapping -- native snap is a global mode
    // that would fight the free-snap a drag needs, and it would catch
    // everything rather than wall ends on this one layer.
    var tied = CsTrace.tieEnds(doc, this.samples, layerName,
        perFoot * CsTrace.TIE_FEET);

    var result = CsTrace.emit(doc, di, layerName, tied, spacing, tolerance);

    if (!result.added) {
        // Something refused the add and this build raises no error for
        // any of the ways that can happen. Name the likely cause rather
        // than leaving the caver to wonder where the line went.
        EAction.handleUserMessage(
            FeatureTraceRun.refusalReason(doc, layerName));
        this.refreshRegion();
        return;
    }
    if (result.added) {
        EAction.handleUserMessage(qsTr("%1: %2 sampled, %3 kept")
            .arg(layerName).arg(result.sampled).arg(result.kept));
        if (typeof FeatureTrace !== "undefined" &&
                !isNull(FeatureTrace.reportTrace)) {
            FeatureTrace.reportTrace(layerName, result);
        }
    }

    // A trace onto a profile layer grew the region.
    this.refreshRegion();
};

/** The preview is the CAPTURED path, not the fitted spline.
 *  Re-running resample/reduce/fit on every sampled move buys nothing a
 *  caver can see mid-drag and makes the tool feel heavy. */
FeatureTraceRun.prototype.getOperation = function(preview) {
    if (this.samples.length < 2) {
        return undefined;
    }
    var op = new RAddObjectsOperation();
    op.setText(this.getToolTitle());
    op.setLimitPreview(false);
    for (var i = 0; i < this.samples.length - 1; i++) {
        op.addObject(new RLineEntity(this.getDocument(), new RLineData(
            new RVector(this.samples[i].x, this.samples[i].y),
            new RVector(this.samples[i + 1].x, this.samples[i + 1].y))),
            false);
    }
    return op;
};

FeatureTraceRun.init = function(basePath) {
    // No widget names, no sort order, no icon: this action is reached
    // from the Feature Trace panel and never from a menu. Its variable
    // is deliberately NOT called "action" -- test_sort_orders_are_unique
    // reads "action.setSortOrder" out of the folder-named file, and a
    // second match there would make which one it reads a coin flip.
    var runAction = new RGuiAction(qsTr("Trace Feature"),
        RMainWindowQt.getMainWindow());
    runAction.setRequiresDocument(true);
    runAction.setScriptFile(basePath + "/FeatureTraceRun.js");
};
