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
    this.bays = [];         // cached open section-bay rects; same refresh
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

/** True when the escape hatch is armed: trace onto whatever layer the
 *  drawing is set to, whichever view that turns out to be in. */
FeatureTraceRun.isCurrentLayer = function() {
    return typeof FeatureTrace !== "undefined" &&
        FeatureTrace.target === FeatureTrace.CURRENT_LAYER;
};

/**
 * The armed FEATURE, as its plan-frame layer name.
 *
 * The panel arms a feature, not a view: WALLS-SURVEYED means "surveyed
 * walls", and which of WALLS-SURVEYED / PROFILE-WALLS-SURVEYED /
 * SECTION-WALLS-SURVEYED it becomes is decided by where the stroke
 * lands (targetLayer below). The plan name is the base the whole
 * registry derives its twins from -- see CsLayers.twinFor -- so it is
 * the natural spelling for "the feature itself".
 *
 * A frame-prefixed target is folded back to its plan base rather than
 * refused, so a caller holding an older per-view name still arms the
 * feature that name describes.
 *
 * Falls back to WALLS-SURVEYED so this action works before the panel
 * exists, and if the panel ever fails to build.
 */
FeatureTraceRun.baseLayer = function(doc) {
    if (typeof FeatureTrace === "undefined" || isNull(FeatureTrace.target)) {
        return CsLayers.WALLS_SURVEYED;
    }
    if (FeatureTraceRun.isCurrentLayer()) {
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
    var target = FeatureTrace.target;
    if (CsLayers.frameOf(target) === "plan") {
        return target;
    }
    var plan = CsLayers.planBaseOf(target);
    return plan === null ? target : plan;
};

/**
 * The layer a stroke in `frame` actually lands on, or null when the
 * armed feature has no layer in that view.
 *
 * THIS IS THE WHOLE POINT OF THE TOOL'S SECOND DESIGN. There used to be
 * one button per feature PER VIEW, and pressing the wrong one was
 * refused at the cursor. The refusal was the tool asking the caver to
 * re-state, in a button, a fact the drawing already knew: the bay
 * boxes and the profile band boxes say which view a point is in, so
 * the view a stroke is drawn in IS the answer. One button per feature,
 * and location routes it.
 *
 * The current-layer escape hatch is exempt from all of it: its layer is
 * whatever the caver chose, sheet layers included, and rewriting that
 * to a twin would defeat the button.
 *
 * `points` and `boxes` are the profile-run half of the same idea and
 * are optional: with a path in hand, a stroke drawn inside one band's
 * bounding box lands on that band's run variant. Without one (the
 * prompt, the panel's readout) the shared layer is the honest answer,
 * because no stroke exists yet to read a run off.
 */
FeatureTraceRun.targetLayer = function(doc, frame, points, boxes) {
    var base = FeatureTraceRun.baseLayer(doc);
    if (FeatureTraceRun.isCurrentLayer()) {
        return base;
    }

    var layer = CsLayers.twinFor(base, isNull(frame) ? "plan" : frame);
    if (layer === null) {
        return null;
    }
    if (CsLayers.frameOf(layer) !== "profile") {
        return layer;
    }

    // A profile feature belongs to ONE survey run: each run is drawn as
    // its own band, and CsProfile lays bands out so they never overlap,
    // so nothing traced along one run can meet anything traced along
    // another. Segregating them also stops the no-gap tie-in welding
    // one band's ceiling to the next band's floor when the two happen
    // to be laid out within a foot of each other. Plan features are
    // untouched: the plan is one continuous map and a wall runs
    // straight through survey boundaries.
    var run = FeatureTraceRun.runToken();
    if (run === null && FeatureTraceRun.runIsAuto() && !isNull(points) &&
            !isNull(doc)) {
        try {
            run = CsProfileBox.runForPath(
                isNull(boxes) ? CsProfileBox.boxes(doc) : boxes, points);
        } catch (eAuto) {
            // location could not answer: the shared layer is always a
            // safe place for the work to land
            run = null;
        }
    }
    if (run !== null) {
        var variant = CsLayerVariants.nameFor(layer, run);
        if (variant !== null) {
            return variant;
        }
    }
    return layer;
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

/** Whether the run should come from the stroke's location -- the
 *  panel's combo says, and NO panel at all means auto (a standalone
 *  drag has nobody else to name a run). */
FeatureTraceRun.runIsAuto = function() {
    if (typeof FeatureTrace !== "undefined" &&
            !isNull(FeatureTrace.runIsAuto)) {
        return FeatureTrace.runIsAuto();
    }
    return true;
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
 * Why the armed feature has no layer in `frame`, as a sentence.
 *
 * The only surviving refusal about frames, and it is about the REGISTRY
 * rather than about the caver: CsLayers.twinFor answers null for a
 * plan layer the registry deliberately does not twin (CsLayers.NO_TWIN
 * -- the north arrow, the aerial, the cut mark). Nothing in the panel's
 * feature list is one of those today; this speaks if one is ever added,
 * instead of the trace vanishing onto a layer nobody registered.
 *
 * The old press-time frame guard lived here and is deliberately gone.
 * It refused a stroke whose view disagreed with the armed BUTTON, and
 * there is no longer a per-view button to disagree with.
 */
FeatureTraceRun.noLayerReason = function(base, frame) {
    return qsTr("%1 has no layer in the %2 view, so there is nowhere for " +
        "that trace to land. Nothing was drawn.").arg(base).arg(frame);
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
        // The FEATURE, not a layer: the layer is not known until the
        // stroke exists, because the view it is drawn in chooses it.
        var trStart = qsTr("Press and drag to trace %1 -- the view you " +
            "draw in picks the layer")
            .arg(FeatureTraceRun.baseLayer(this.getDocument()));
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
 * Recomputes the cached profile region and the open section bays.
 *
 * Called when the action starts, at the top of every press, and again
 * after every committed trace: a trace onto a profile layer GROWS the
 * region, so a stale box would refuse the next stroke just past the
 * previous one -- and a bay can be OPENED (Sketch Section) or CAPTURED
 * (Capture Section) between one stroke and the next, which would leave
 * a stale bay list refusing every section stroke, or accepting strokes
 * into a bay that is no longer there.
 *
 * Cached at all because each of these walks EVERY entity in the
 * drawing, and the cursor readout asks per mouse-move event. On a real
 * cave that is thousands of entities per mouse move. Once per press is
 * the same cost the post-commit refresh already pays.
 */
FeatureTraceRun.prototype.refreshRegion = function() {
    var doc = this.getDocument();
    this.region = isNull(doc) ? null : CsTrace.profileRegion(doc);
    this.bays = isNull(doc) ? [] : CsTrace.sectionBays(doc);
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

    // Once per stroke: Sketch Section and Capture Section can open and
    // close a bay while this action is still armed, and commit() routes
    // the finished stroke from this list -- a stale one would file the
    // work under a bay that is no longer there.
    //
    // NO PRESS-TIME REFUSAL any more. Every press is in some view, and
    // every view has a layer for the armed feature, so there is nothing
    // left for a press to be wrong about. The readout still says which
    // view the cursor is in, and now which layer that means.
    this.refreshRegion();

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
            var over = CsTrace.frameIn(this.region, here, this.bays);
            // The LAYER as well as the view, because the layer is what
            // the caver is choosing now that no button states it. No
            // points are passed: there is no stroke yet, so this names
            // the shared profile layer where a run would refine it.
            FeatureTrace.showCursorFrame(over,
                FeatureTraceRun.targetLayer(this.getDocument(), over));
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

    // WHERE THE STROKE IS decides which view it belongs to, and the view
    // decides the layer. The whole path has to agree on one view: a wall
    // crossing the gutter describes nothing in either of them.
    var pathFrame = CsTrace.pathFrame(this.region, this.samples, this.bays);

    if (pathFrame === null) {
        EAction.handleUserMessage(qsTr("That run crossed from one view " +
            "into another. Nothing was drawn -- trace within one view."));
        return;
    }

    // The samples go in, so a profile stroke picks up its band's run
    // from the same call. The current-layer escape hatch comes back out
    // of here untouched, by targetLayer's own first guard.
    var layerName = FeatureTraceRun.targetLayer(doc, pathFrame,
        this.samples);
    if (layerName === null) {
        EAction.handleUserMessage(FeatureTraceRun.noLayerReason(
            FeatureTraceRun.baseLayer(doc), pathFrame));
        return;
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
        // The layer is NAMED in the message, every time. With no
        // per-view button to arm, this line is the caver's confirmation
        // that the view they drew in was the view they meant -- an
        // elevation wall traced a foot outside the band boxes says
        // WALLS-SURVEYED here, and one undo puts it right.
        EAction.handleUserMessage(qsTr("%1: %2 sampled, %3 kept")
            .arg(layerName).arg(result.sampled).arg(result.kept));
        if (typeof FeatureTrace !== "undefined" &&
                !isNull(FeatureTrace.reportTrace)) {
            FeatureTrace.reportTrace(layerName, result);
        }
        this.stampSection(doc, di, pathFrame, result.id);
        this.warnUnclaimedProfile(pathFrame, layerName);
    }

    // A trace onto a profile layer grew the region. (Section linework
    // does not: profileRegion unions only profile-frame layers, so a
    // stroke inside a bay leaves the elevation's extent alone -- which
    // is what keeps a sketched section from dragging the profile frame
    // out across the sheet to meet it.)
    this.refreshRegion();
};

/** The tags a section trace carries: which bay it was drawn in, and the
 *  station that bay is a section OF.
 *
 *  Their own names rather than SketchSection's SectionBay/
 *  SectionBayRole pair, deliberately. Those two mark the bay's own
 *  FURNITURE -- the frame, the ghost, the scan -- and SectionCapture
 *  and SectionEdit both walk the drawing looking for them. Traced
 *  linework wearing the same tag with no role would sit inside those
 *  sweeps as a permanent "what is this?", and the day one of them stops
 *  checking the role it would be swept up as furniture. */
FeatureTraceRun.BAY_TAG = "SectionTraceBay";
FeatureTraceRun.STATION_TAG = "SectionTraceStation";

/**
 * Stamps a section trace with the station its bay belongs to.
 *
 * WHY AT TRACE TIME. A section's station is not derivable from the
 * linework later: CsBind refuses the section frame outright (one
 * station, no chain, nothing for its maths to bind against), and the
 * bay that knew the answer is TORN DOWN by Capture. Between tracing and
 * capturing -- which can be days, and may never happen at all for a
 * sketch left open -- the drawing had no record of which station the
 * work described. It does now.
 *
 * Silent about everything: a missing id, a stroke that wandered out of
 * its bay, a bay with no station tag. A stamp is provenance, and
 * failing to add provenance must never cost the caver the line they
 * just drew.
 */
FeatureTraceRun.prototype.stampSection = function(doc, di, frame, id) {
    if (frame !== "section" || isNull(id) || isNull(doc) || isNull(di)) {
        return;
    }
    try {
        var bay = CsTrace.bayForPath(this.bays, this.samples);
        if (bay === null || isNull(bay.station) || bay.station === "") {
            return;
        }
        var e = doc.queryEntity(id);
        if (isNull(e)) {
            return;
        }
        CsTags.set(e, FeatureTraceRun.BAY_TAG, bay.bay);
        CsTags.set(e, FeatureTraceRun.STATION_TAG, bay.station);
        var op = new RModifyObjectsOperation();
        op.addObject(e, false);
        di.applyOperation(op);
    } catch (eStamp) {
        // provenance is a nicety; the line is already drawn
    }
};

/**
 * Says so when a profile trace landed on the SHARED layer.
 *
 * A profile feature that belongs to no run is the one quiet way this
 * tool can still cost work. CsProfileBind moves traced linework by the
 * run its layer names; on the shared layer there is no run, so binding
 * falls back to guessing by distance and silently skips anything traced
 * far from its stations -- and a revision then tears the sketch off the
 * passage. The old panel prevented it by DISABLING the profile group
 * until a run was chosen. There is no profile group any more, and the
 * information is better as an answer than as a locked door: it names
 * what happened, after the line is safely drawn.
 */
FeatureTraceRun.prototype.warnUnclaimedProfile = function(frame, layerName) {
    if (frame !== "profile" || FeatureTraceRun.isCurrentLayer()) {
        return;
    }
    if (CsLayerVariants.split(layerName) !== null) {
        return;   // it landed on a run's layer; nothing to say
    }
    EAction.handleUserMessage(qsTr("That line is on the shared %1 -- no " +
        "band's box claims where it was drawn, so it belongs to no survey " +
        "run and will not move with a band when the survey is revised. " +
        "Trace inside a band, or pick the run above.").arg(layerName));
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
