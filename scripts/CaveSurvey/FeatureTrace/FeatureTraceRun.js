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

    this.samples = [];    // {x, y} in drawing coordinates
    this.region = null;   // cached profile-frame box; see refreshRegion
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
FeatureTraceRun.targetLayer = function() {
    if (typeof FeatureTrace !== "undefined" && !isNull(FeatureTrace.target)) {
        return FeatureTrace.target;
    }
    return CsLayers.WALLS_SURVEYED;
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
};

FeatureTraceRun.prototype.setState = function(state) {
    EAction.prototype.setState.call(this, state);

    this.getDocumentInterface().setClickMode(RAction.PickCoordinate);
    this.setCrosshairCursor();

    switch (this.state) {
    case FeatureTraceRun.State.Idle:
        var trStart = qsTr("Press and drag to trace %1")
            .arg(FeatureTraceRun.targetLayer());
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
        FeatureTraceRun.targetLayer(), here);
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
    if (CsTrace.pathFrame(this.region, this.samples) === null) {
        EAction.handleUserMessage(qsTr("That run crossed between the plan " +
            "and the elevation. Nothing was drawn -- trace within one view."));
        return;
    }

    var unit = CsUnits.fromDrawingUnit(doc.getUnit(), RS);
    var spacing = CsTrace.spacingFor(unit);
    var layerName = FeatureTraceRun.targetLayer();
    var result = CsTrace.emit(doc, di, layerName, this.samples,
        spacing, spacing / 2.0);

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
