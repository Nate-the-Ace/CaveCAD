// ShapedLinesRun.js -- the shared freehand draw action behind every
// Shaped Lines toolbar button. Press, drag, release: the drag becomes
// the SPINE (spline, or closed polyline for the pit), and the style's
// decoration -- ledge hachures or scallops -- is generated in the same
// operation, so one undo removes the whole feature.
//
// The press/drag/release shape, screen-space sampling and snap
// suspension are FeatureTraceRun's, which in turn derives from QCAD's
// LineFreehand (GPLv3). Resample/reduce/fit are CsTrace's; the
// decoration math is CsShapeLine's.
//
// NOT an add-on QCAD can find on its own (AddOn.getAddOns only builds
// <dir>/<dir>.js). ShapedLines.init() registers the five per-style
// subclasses in the sibling *Draw.js files; each of those sets
// prototype.styleKey and nothing else.

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");

function ShapedLinesRun(guiAction) {
    EAction.call(this, guiAction);

    this.samples = [];      // {x, y} in drawing coordinates
    this.region = null;     // cached profile-frame box
    this.bays = [];         // cached open section-bay rects
    this.savedSnap = null;  // snap CLASS NAME to restore on exit
}

ShapedLinesRun.prototype = new EAction();

/** Subclasses override. Kept on the prototype so one file carries the
 *  whole behavior and a subclass is three lines. */
ShapedLinesRun.prototype.styleKey = "floorledge";

ShapedLinesRun.State = {
    Idle: 0,
    Drawing: 1
};

/** Screen pixels between kept samples -- FeatureTraceRun's value, for
 *  FeatureTraceRun's reasons (drawing-space thresholds are sub-pixel
 *  zoomed out and laggy zoomed in). */
ShapedLinesRun.SAMPLE_PIXELS = 6;

/** Spine fidelity: resample interval in FEET and the reduce tolerance
 *  as a fraction of it. FeatureTrace's defaults (1 ft, Fine). */
ShapedLinesRun.INTERVAL_FEET = 1.0;
ShapedLinesRun.TOLERANCE_FRACTION = 0.05;

ShapedLinesRun.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    this.setState(ShapedLinesRun.State.Idle);
    this.refreshFrames();

    // Grid snap staircases a freehand drag; suspend, restore in
    // finishEvent whatever way the action ends.
    this.savedSnap = CsTrace.suspendSnap(this.getDocumentInterface());
};

ShapedLinesRun.prototype.finishEvent = function() {
    EAction.prototype.finishEvent.call(this);
    CsTrace.restoreSnap(this.getDocumentInterface(), this.savedSnap);
    this.savedSnap = null;
};

ShapedLinesRun.prototype.setState = function(state) {
    EAction.prototype.setState.call(this, state);

    this.getDocumentInterface().setClickMode(RAction.PickCoordinate);
    this.setCrosshairCursor();

    var spec = CsShapeLine.STYLES[this.styleKey];
    var label = isNull(spec) ? this.styleKey : spec.label;

    switch (this.state) {
    case ShapedLinesRun.State.Idle:
        var trStart = qsTr("Press and drag to draw: %1").arg(label);
        this.setCommandPrompt(trStart);
        this.setLeftMouseTip(trStart);
        this.setRightMouseTip(EAction.trCancel);
        this.samples = [];
        break;

    case ShapedLinesRun.State.Drawing:
        var trStop = qsTr("Release to finish");
        this.setCommandPrompt(trStop);
        this.setLeftMouseTip(trStop);
        this.setRightMouseTip("");
        break;
    }
};

/**
 * Recomputes the cached profile region and the open section bays.
 *
 * Both walk EVERY entity in the drawing, which is why they are cached
 * at all. Refreshed at the start of the action and again at the top of
 * every press, because Sketch Section and Capture Section can open and
 * close a bay while this action is still armed -- a stale bay list
 * would route a section stroke to the plan family, or a plan stroke to
 * a bay that is no longer there.
 */
ShapedLinesRun.prototype.refreshFrames = function() {
    var doc = this.getDocument();
    this.region = isNull(doc) ? null : CsTrace.profileRegion(doc);
    this.bays = isNull(doc) ? [] : CsTrace.sectionBays(doc);
};

/** SAMPLE_PIXELS at the current zoom, in drawing units. */
ShapedLinesRun.prototype.sampleThreshold = function() {
    try {
        var view = this.getGraphicsView();
        if (!isNull(view)) {
            var factor = view.getFactor();
            if (factor > 0) {
                return ShapedLinesRun.SAMPLE_PIXELS / factor;
            }
        }
    } catch (e) {
        // no measurable view; over-sample rather than under-sample
    }
    return 1.0;
};

ShapedLinesRun.prototype.escapeEvent = function() {
    if (this.state === ShapedLinesRun.State.Drawing) {
        this.setState(ShapedLinesRun.State.Idle);
        return;
    }
    EAction.prototype.escapeEvent.call(this);
};

ShapedLinesRun.prototype.mousePressEvent = function(event) {
    if (event.button() !== Qt.LeftButton) {
        return;
    }
    if (event.modifiers().valueOf() === Qt.ControlModifier.valueOf()) {
        return;
    }
    if (this.state !== ShapedLinesRun.State.Idle) {
        return;
    }
    var p = event.getModelPosition();
    // Once per stroke, before the frame that routes this feature's
    // layers is decided from it. See refreshFrames.
    this.refreshFrames();
    this.setState(ShapedLinesRun.State.Drawing);
    this.samples = [{ x: p.x, y: p.y }];
};

ShapedLinesRun.prototype.mouseMoveEvent = function(event) {
    if (!(event.buttons().valueOf() & Qt.LeftButton.valueOf())) {
        return;
    }
    if (event.modifiers().valueOf() === Qt.ControlModifier.valueOf()) {
        return;
    }
    if (this.state !== ShapedLinesRun.State.Drawing) {
        return;
    }
    var p = event.getModelPosition();
    var here = { x: p.x, y: p.y };
    var last = this.samples[this.samples.length - 1];
    if (isNull(last) ||
            CsTrace.distance(last, here) >= this.sampleThreshold()) {
        this.samples.push(here);
        this.updatePreview();
    }
};

ShapedLinesRun.prototype.mouseReleaseEvent = function(event) {
    if (event.button() !== Qt.LeftButton) {
        return;
    }
    if (this.state !== ShapedLinesRun.State.Drawing) {
        return;
    }
    this.commit();
    this.setState(ShapedLinesRun.State.Idle);
};

/** The preview is the raw captured path -- FeatureTraceRun's choice,
 *  for its reason: refitting per mouse move buys nothing visible. */
ShapedLinesRun.prototype.getOperation = function(preview) {
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

/**
 * Build the spine + decoration and add BOTH in one operation.
 *
 * One operation is not a nicety: the listener hears every transaction,
 * and a spine landing in its own transaction with no decor yet would
 * match reconcile()'s "all decor gone -> unlink" branch and strip the
 * tags before the decor op arrived. One add = one transaction = the
 * listener only ever sees the feature whole.
 */
ShapedLinesRun.prototype.commit = function() {
    var doc = this.getDocument();
    var di = this.getDocumentInterface();
    if (isNull(doc) || isNull(di) || this.samples.length < 2) {
        return;
    }

    var spec = CsShapeLine.STYLES[this.styleKey];
    if (isNull(spec)) {
        return;
    }

    // ONE button, ALL THREE views: the stroke's LOCATION decides
    // whether this is plan, elevation or cross-section linework (an
    // open bay for the section, the band bounding boxes for the
    // elevation -- see CsTrace.frameIn and CsProfileBox), and the
    // layers route to the frame's own family so a ledge drawn in the
    // elevation never counts toward the plan's data window, and one
    // drawn inside a sketching bay lands on SECTION-LEDGE-FLOOR rather
    // than being swept into the block as plan ink. Only a stroke
    // CROSSING between frames is refused -- it describes nothing in
    // any of them.
    var pathFrame = CsTrace.pathFrame(this.region, this.samples, this.bays);
    if (pathFrame === null) {
        EAction.handleUserMessage(qsTr("%1: that stroke crossed from one " +
            "view into another. Nothing was drawn -- draw within one " +
            "view.").arg(spec.label));
        return;
    }
    var frameLayers = CsShapeLine.layersFor(spec, pathFrame);

    var perFoot = CsShapeLine.perFoot(doc);
    var spacing = perFoot * ShapedLinesRun.INTERVAL_FEET;
    var tolerance = spacing * ShapedLinesRun.TOLERANCE_FRACTION;

    var spaced = CsTrace.resample(this.samples, spacing);
    var kept = CsTrace.reduce(spaced, tolerance);
    if (kept.length < 2) {
        return;
    }

    var spine;
    var side = 1;   // right of travel; Flip Shaped Side is one command
    if (spec.close) {
        // A pit is a CLOSED loop: weld the release point to the press
        // point and keep the spine an ordinary polyline -- a periodic
        // spline is a Pro feature and fails silently in this build.
        if (kept.length > 2 && CsShapeLine.dist(kept[0],
                kept[kept.length - 1]) < spacing) {
            kept.pop();
        }
        if (kept.length < 3) {
            EAction.handleUserMessage(qsTr("A pit needs a loop -- drag " +
                "around the edge and release near where you pressed."));
            return;
        }
        var pl = new RPolyline();
        for (var v = 0; v < kept.length; v++) {
            pl.appendVertex(new RVector(kept[v].x, kept[v].y), 0.0);
        }
        pl.setClosed(true);
        spine = new RPolylineEntity(doc, new RPolylineData(pl));
        side = CsShapeLine.inwardSide(kept);   // hachures point IN
    } else {
        spine = CsTrace.fitSpline(doc, kept);
        if (spine === null) {
            return;
        }
    }

    CsLayers.ensure(doc, di, frameLayers.spine);
    CsLayers.ensure(doc, di, frameLayers.decor);
    spine.setLayerId(doc.getLayerId(frameLayers.spine));

    // Tag BEFORE adding (the CalloutWrite lesson: the add is then the
    // ONLY operation that writes this entity, tags included, so undo
    // is atomic and nothing survives half-tagged). The frame rides on
    // the spine so every regeneration keeps drawing into the family
    // the stroke chose, even after the spine is dragged around.
    CsTags.set(spine, CsShapeLine.KEY.ID, CsUuid.v4());
    CsTags.set(spine, CsShapeLine.KEY.STYLE, this.styleKey);
    CsTags.set(spine, CsShapeLine.KEY.SIDE, String(side));
    CsTags.set(spine, CsShapeLine.KEY.SCALE, "1");
    CsTags.set(spine, CsShapeLine.KEY.FRAME, pathFrame);

    var built = CsShapeLine.buildDecor(doc, spine);
    if (isNull(built)) {
        EAction.handleUserMessage(qsTr("%1: could not decorate that " +
            "stroke. Nothing was drawn.").arg(spec.label));
        return;
    }
    CsTags.set(spine, CsShapeLine.KEY.SIG, built.sig);

    var before = doc.queryAllEntities(false, true).length;
    var that = this;
    CsLayers.withLayerOn(doc, di, frameLayers.spine, function() {
        CsLayers.withLayerOn(doc, di, frameLayers.decor, function() {
            var op = new RAddObjectsOperation();
            op.setText(spec.label);
            op.addObject(spine, false);
            for (var a = 0; a < built.entities.length; a++) {
                op.addObject(built.entities[a], false);
            }
            di.applyOperation(op);
        });
    });
    var after = doc.queryAllEntities(false, true).length;

    if (after <= before) {
        EAction.handleUserMessage(qsTr("Nothing was drawn: layer %1 or " +
            "%2 refused the add (locked or frozen?).")
            .arg(frameLayers.spine).arg(frameLayers.decor));
        return;
    }
    EAction.handleUserMessage(qsTr("%1: %2 decoration entities along " +
        "%3 points").arg(spec.label).arg(built.count).arg(kept.length));
};

ShapedLinesRun.init = function(basePath) {
    // Registered so the engine knows the script; reached from the five
    // per-style buttons, never from a menu of its own. The variable is
    // deliberately not called "action" -- the structural sort-order test
    // greps the folder-named file, and spare matches elsewhere keep the
    // same discipline suite-wide.
    var runAction = new RGuiAction(qsTr("Shaped Line Run"),
        RMainWindowQt.getMainWindow());
    runAction.setRequiresDocument(true);
    runAction.setScriptFile(basePath + "/ShapedLinesRun.js");
};
