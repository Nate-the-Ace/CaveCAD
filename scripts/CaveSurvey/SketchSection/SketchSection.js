/**
 * SketchSection -- open a staging bay to trace a scanned cross section
 * in.
 *
 * The bay is a locked rectangle on CTRL-SECTION-BOX parked clear of the
 * plan, holding two things: the scan, and the COMPUTED section for the
 * same station, dashed, at the scale the finished block will be drawn
 * at. The caver scales the scan onto that outline and traces with the
 * suite's own tools.
 *
 * WHY THE GHOST. A scan has no scale and no up. The station's own LRUD
 * has both, and it is already in the drawing. One dashed outline is the
 * ruler, the protractor and a visible check of the tracing against what
 * was measured -- and it is deleted at Capture, so it never reaches the
 * block.
 *
 * WHAT THIS TOOL DOES NOT DO. It does not draw. Everything inside the
 * frame is drawn by the caver with Feature Trace, Shaped Lines, arcs --
 * whatever the passage needs. SectionCapture turns that into a block.
 *
 * USAGE:
 *   Cave Survey > Sketch Section   (or "sketchsection" / "sks")
 */
include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

function SketchSection(guiAction) {
    EAction.call(this, guiAction);
}

SketchSection.prototype = new EAction();

/** The setting holding where the caver last left a bay, per cave. */
SketchSection.SETTING_CORNER = "CaveSurvey/SectionBayCorner";

/** Tags carried by the bay's own furniture, so Capture can tell the
 *  frame and the underlay from the tracing without guessing. */
SketchSection.TAG_BAY = "SectionBay";
SketchSection.ROLE_FRAME = "frame";
SketchSection.ROLE_GHOST = "ghost";
SketchSection.ROLE_SCAN = "scan";

/** The snap class the caver was using before the bay switched to free,
 *  so SectionCapture's teardown can put it back. Carried on the FRAME,
 *  the one piece of bay furniture guaranteed to exist for the bay's
 *  whole lifetime -- see SketchSection.currentSnapClassName, where
 *  SketchSection.run reads it, and SectionCapture.restoreSnap, where
 *  it is rebuilt. */
SketchSection.TAG_SNAP = "SectionBaySnap";

SketchSection.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    SketchSection.run(null, null);
    this.terminate();
};

/** One "Sketch Section: ..." message, however this build can show it. */
SketchSection.say = function(text) {
    try {
        QMessageBox.information(RMainWindowQt.getMainWindow(),
            qsTr("Sketch Section"), text);
    } catch (e) {
        EAction.handleUserWarning(text);
    }
};

/**
 * Open a bay.
 *
 * \param scanPath absolute path to the scan, or null to ask
 * \param station station name, or null to ask
 * \return the bay id, or null
 */
SketchSection.run = function(scanPath, station) {
    var doc = EAction.getDocument();
    var di = EAction.getDocumentInterface();
    if (isNull(doc) || isNull(di)) {
        return null;
    }

    var name = station;
    if (name === null || name === undefined || name === "") {
        name = SketchSection.askStation(doc);
        if (name === null) {
            return null;                 // cancelled, silently
        }
    }

    var asDrawn = null;
    try {
        asDrawn = CsRevise.resolveAsDrawn(doc);
    } catch (eRes) {
        asDrawn = null;
    }

    var cut = SketchSection.cutAt(asDrawn, name);
    var scale = CsSectionDraw.scaleOf();
    var ghostBox = (cut === null) ? { x1: -5, y1: -5, x2: 5, y2: 5 } :
        CsSectionDraw.localBox(cut, scale, CsSectionDraw.textHeight(doc));

    var size = { w: (ghostBox.x2 - ghostBox.x1) * 3,
                 h: (ghostBox.y2 - ghostBox.y1) * 3 };
    var rect = CsSectionBay.frameRectFor(
        SketchSection.planBoxOf(doc), size,
        SketchSection.rememberedCorner(doc));

    var bayId = CsUuid.v4();

    // Read the CURRENT snap's class BEFORE anything below switches it to
    // free -- di.getSnap() after the switch would just read back "free".
    // Tagged onto the frame in the SAME add below, so SectionCapture's
    // teardown can rebuild and restore it later without ever holding the
    // snap object itself across the bay's lifetime (di.setSnap() takes
    // ownership -- see SectionCapture.restoreSnap).
    var priorSnapClass = SketchSection.currentSnapClassName(di);

    // Every layer this bay writes to must exist before doc.getLayerId
    // is asked for it, or the entity lands on layer 0 with no error at
    // all. CsLayers.ensure() is a no-op once the template already has
    // the layer, so calling it every time costs nothing.
    CsLayers.ensure(doc, di, CsLayers.CTRL_SECTION_BOX);
    CsLayers.ensure(doc, di, CsLayers.CTRL_SECTION_OUTLINE);
    CsLayers.ensure(doc, di, CsLayers.CTRL_SECTION_SCAN);

    SketchSection.addFrame(doc, di, rect, bayId, name, priorSnapClass);
    if (cut !== null) {
        SketchSection.addGhost(doc, di, cut, scale, rect, bayId);
    }
    if (scanPath !== null && scanPath !== undefined && scanPath !== "") {
        SketchSection.addScan(doc, di, scanPath, ghostBox, rect, bayId);
    }

    SketchSection.zoomTo(di, rect);
    SketchSection.snapFree(di);

    if (cut === null) {
        SketchSection.say(qsTr("No cuttable LRUD at %1, so the bay has " +
            "no outline to scale the scan against.\n\nScale the scan by " +
            "hand: draw a line of a known length inside the frame and " +
            "match the scan to it.").arg(name));
    }
    return bayId;
};

/** The section the drawing would compute at this station, or null. */
SketchSection.cutAt = function(asDrawn, station) {
    if (asDrawn === null || isNull(asDrawn.resolved)) {
        return null;
    }
    var pos = asDrawn.resolved.stations[station];
    if (pos === undefined) {
        return null;
    }
    var leg = CsSectionCut.nearestLeg(asDrawn.resolved,
        { x: pos.x, y: pos.y });
    if (leg === null) {
        return null;
    }
    var cut = CsSectionCut.cut(asDrawn.survey, asDrawn.resolved,
        leg.from, leg.to, leg.t, {});
    return (cut.refused === true) ? null : cut;
};

/** The plan's own extent, or null when the drawing is empty. */
SketchSection.planBoxOf = function(doc) {
    try {
        var b = doc.getBoundingBox(true, true);
        if (isNull(b)) {
            return null;
        }
        return { x1: b.getMinimum().x, y1: b.getMinimum().y,
                 x2: b.getMaximum().x, y2: b.getMaximum().y };
    } catch (e) {
        return null;
    }
};

/** Where this cave's bay was last left, or null. */
SketchSection.rememberedCorner = function(doc) {
    try {
        var raw = RSettings.getStringValue(
            SketchSection.SETTING_CORNER, "");
        if (raw === "") {
            return null;
        }
        var all = JSON.parse(raw);
        var key = String(doc.getFileName());
        if (all[key] === undefined) {
            return null;
        }
        return { x: all[key].x, y: all[key].y };
    } catch (e) {
        return null;
    }
};

/** The frame: a closed polyline, tagged, and LOCKED so a rubber-band
 *  selection over the tracing cannot drag the boundary the sweep is
 *  measured against. Also carries the snap class the caver was using
 *  before the bay switched to free, so SectionCapture can put it back
 *  at teardown -- the frame is the one bit of furniture guaranteed to
 *  outlive the whole bay. */
SketchSection.addFrame = function(doc, di, rect, bayId, station,
        priorSnapClass) {
    var pl = new RPolyline();
    pl.appendVertex(new RVector(rect.x1, rect.y1));
    pl.appendVertex(new RVector(rect.x2, rect.y1));
    pl.appendVertex(new RVector(rect.x2, rect.y2));
    pl.appendVertex(new RVector(rect.x1, rect.y2));
    pl.setClosed(true);
    var e = new RPolylineEntity(doc, new RPolylineData(pl));
    e.setLayerId(doc.getLayerId(CsLayers.CTRL_SECTION_BOX));
    // Tag BEFORE adding, so the tags land in the SAME operation as the
    // geometry.
    CsTags.set(e, SketchSection.TAG_BAY, bayId);
    CsTags.set(e, "SectionBayRole", SketchSection.ROLE_FRAME);
    CsTags.set(e, "SectionBayStation", station);
    // CsTags.set no-ops on null/undefined/"" by design (see CsTags.js),
    // so a snap this build could not name just leaves the tag absent --
    // SectionCapture.restoreSnap already treats an absent tag as "leave
    // the snap alone" rather than guessing.
    CsTags.set(e, SketchSection.TAG_SNAP, priorSnapClass);
    var op = new RAddObjectsOperation();
    op.setText("Open section bay");
    op.addObject(e, false);
    // CTRL-SECTION-BOX ships LOCKED (CsLayers.LOCKED) -- a caver's own
    // protection against dragging the frame the sweep is measured
    // against -- and locked refuses adds exactly as silently as off
    // does. withLayerOn alone only clears OFF/FROZEN; the lock needs
    // withLayerUnlocked, the counterpart CsProfileDraw's own box layer
    // uses for the identical reason.
    CsLayers.withLayerOn(doc, di, CsLayers.CTRL_SECTION_BOX, function() {
        CsLayers.withLayerUnlocked(doc, di, CsLayers.CTRL_SECTION_BOX,
            function() {
                di.applyOperation(op);
            });
    });
};

/** The ghost: the computed outline, dashed, centred in the bay. */
SketchSection.addGhost = function(doc, di, cut, scale, rect, bayId) {
    var pts = CsSectionDraw.localPoints(cut, scale);
    if (pts.length < 3) {
        return;
    }
    var cx = (rect.x1 + rect.x2) / 2;
    var cy = (rect.y1 + rect.y2) / 2;
    var pl = new RPolyline();
    for (var i = 0; i < pts.length; i++) {
        pl.appendVertex(new RVector(cx + pts[i].x, cy + pts[i].y));
    }
    pl.setClosed(true);
    var e = new RPolylineEntity(doc, new RPolylineData(pl));
    e.setLayerId(doc.getLayerId(CsLayers.CTRL_SECTION_OUTLINE));
    CsTags.set(e, SketchSection.TAG_BAY, bayId);
    CsTags.set(e, "SectionBayRole", SketchSection.ROLE_GHOST);
    var op = new RAddObjectsOperation();
    op.setText("Draw section ghost");
    op.addObject(e, false);
    // OFF layers refuse adds SILENTLY in this build -- CTRL-SECTION-
    // OUTLINE ships visible, but a caver may since have switched it
    // off, and the bay must not open with a missing ghost and nothing
    // to say why.
    CsLayers.withLayerOn(doc, di, CsLayers.CTRL_SECTION_OUTLINE,
        function() {
            di.applyOperation(op);
        });
};

/** The scan, scaled onto the ghost, faded, at the back. */
SketchSection.addScan = function(doc, di, path, ghostBox, rect, bayId) {
    var img = new QImage(path);
    if (img.isNull()) {
        SketchSection.say(qsTr("The scan could not be read: ") + path);
        return;
    }
    // width()/height() are METHODS on this build's QImage, not
    // properties -- probed 2026-08-29 (js.width returns "function").
    // Reading them as properties would hand the fit maths a function
    // object instead of a pixel count and produce a NaN transform with
    // no error.
    var pxW = img.width(), pxH = img.height();
    if (pxW < 1 || pxH < 1) {
        SketchSection.say(qsTr("The scan has no size: ") + path);
        return;
    }
    var cx = (rect.x1 + rect.x2) / 2;
    var cy = (rect.y1 + rect.y2) / 2;
    var scanBox = { x1: 0, y1: 0, x2: pxW, y2: pxH };
    var ghostHere = { x1: cx + ghostBox.x1, y1: cy + ghostBox.y1,
                      x2: cx + ghostBox.x2, y2: cy + ghostBox.y2 };
    var fit = CsSectionBay.fitTransform(scanBox, ghostHere);

    // RImageData BY CONSTRUCTOR, not by setFileName/setInsertionPoint/
    // setUVector/setVVector. Probed 2026-08-29: those setters exist and
    // do not throw, but every WORKING image insert in this suite
    // (SketchScans.insert, SketchScans.insertFitted, ScanView.js,
    // AerialBasemap.js) builds RImageData through the seven-argument
    // constructor and never through setters -- so the constructor form
    // is what is trusted to actually place a readable image, and this
    // follows it rather than a shape that merely accepts calls.
    var entity;
    try {
        var data = new RImageData(path,
            new RVector(fit.tx, fit.ty),
            new RVector(fit.sx, 0),
            new RVector(0, fit.sy),
            pxW, pxH, 0);
        try {
            data.setFade(50);
        } catch (eFade) {
            // an engine without setFade gets a full-strength scan
        }
        entity = new RImageEntity(doc, data);
    } catch (e) {
        SketchSection.say(qsTr("The scan could not be placed: ") + e);
        return;
    }
    entity.setLayerId(doc.getLayerId(CsLayers.CTRL_SECTION_SCAN));
    CsTags.set(entity, SketchSection.TAG_BAY, bayId);
    CsTags.set(entity, "SectionBayRole", SketchSection.ROLE_SCAN);
    CsTags.set(entity, CsCallout.KEY.SECTION_SCAN, path);
    CsTags.set(entity, CsCallout.KEY.SECTION_FIT,
        CsSectionBay.serializeFit(fit));
    // To the back, under whatever the caver traces over it -- the same
    // underlay treatment every scan in this suite gets (SketchScans.
    // insert), one below getMinDrawOrder() because this entity is not
    // in storage yet.
    entity.setDrawOrder(doc.getStorage().getMinDrawOrder() - 1);
    var op = new RAddObjectsOperation();
    op.setText("Underlay section scan");
    op.addObject(entity, false);
    CsLayers.withLayerOn(doc, di, CsLayers.CTRL_SECTION_SCAN,
        function() {
            di.applyOperation(op);
        });
};

/** Zoom the view to the bay, so the caver is looking at it. */
SketchSection.zoomTo = function(di, rect) {
    try {
        var box = new RBox(new RVector(rect.x1, rect.y1),
                           new RVector(rect.x2, rect.y2));
        di.zoomTo(box, 20);
    } catch (e) {
        // a build that cannot zoom still opened the bay
    }
};

/**
 * Snapping goes FREE while a bay is open.
 *
 * Grid snap quantises every freehand sample onto the grid: the wall
 * comes out a staircase and the collapsed samples get discarded by
 * curve reduction. Set through di, NOT by triggering the snap action --
 * triggering from inside an action lifecycle event frees the action
 * still running and takes the process with it.
 *
 * NOT restored here. This action terminates the instant the bay is
 * open (see beginEvent), so undoing the switch on its own finish would
 * take the free snap away before the caver has drawn a single point.
 * The snap comes back at TEARDOWN instead -- SectionCapture.capture --
 * from the class name SketchSection.run already read via
 * currentSnapClassName and tagged onto the frame, before this function
 * ran.
 */
SketchSection.snapFree = function(di) {
    try {
        di.setSnap(new RSnapFree());
    } catch (e) {
        // no snap change is survivable; a crash is not
    }
};

/** The current snap's class name -- "RSnapGrid", not "RSnapGrid [JS]" --
 *  or null when it cannot be read. Probed 2026-08-30: di.getSnap()
 *  String()s as "<ClassName> [JS]"; the base "RSnap" (no concrete snap
 *  ever set) and anything unreadable both come back null rather than a
 *  name nothing can rebuild. */
SketchSection.currentSnapClassName = function(di) {
    try {
        var s = String(di.getSnap());
        var i = s.indexOf(" ");
        var name = (i < 0) ? s : s.substring(0, i);
        return (name === "" || name === "RSnap") ? null : name;
    } catch (e) {
        return null;
    }
};

/** Ask which station this section is cut at. Plan stations, in walk
 *  order -- the order the survey visited them, not name order, so a
 *  branch reads the way the notebook does. */
SketchSection.askStation = function(doc) {
    var stations = CsTags.collectStations(doc);
    if (stations.length === 0) {
        SketchSection.say(qsTr("This drawing has no plotted stations to " +
            "hang a section on."));
        return null;
    }
    var names = [];
    var i;
    try {
        var asDrawn = CsRevise.resolveAsDrawn(doc);
        var order = CsStationOrder.walkOrder(asDrawn.survey);
        var plotted = {};
        for (i = 0; i < stations.length; i++) {
            plotted[stations[i].name] = true;
        }
        for (i = 0; i < order.length; i++) {
            if (plotted[order[i]] === true) {
                names.push(order[i]);
            }
        }
    } catch (e) {
        names = [];
    }
    if (names.length === 0) {
        for (i = 0; i < stations.length; i++) {
            names.push(stations[i].name);
        }
    }
    // A DIALOG INSTANCE, NOT QInputDialog.getItem. SketchScans.js's own
    // takePick already found this the hard way: the static convenience
    // function's C++ signature reports Cancel through an `ok`
    // OUT-PARAMETER that this binding drops, so Cancel returned the
    // selected item exactly as OK did -- Cancel simply did not work. An
    // instance carries the answer in its own result: exec() returns
    // QDialog.Accepted only when the caver pressed OK.
    var chosen = null;
    try {
        var dlg = new QInputDialog(RMainWindowQt.getMainWindow());
        dlg.windowTitle = qsTr("Sketch Section");
        dlg.setLabelText(qsTr("Station this section is cut at:"));
        dlg.setComboBoxEditable(false);
        dlg.setComboBoxItems(names);
        if (dlg.exec() !== QDialog.Accepted) {
            return null;                 // cancelled: nothing chosen
        }
        chosen = dlg.textValue();
    } catch (eDlg) {
        chosen = null;
    }
    if (chosen === null || chosen === undefined || chosen === "") {
        return null;
    }
    return String(chosen);
};

SketchSection.init = function(basePath) {
    var action = new RGuiAction(qsTr("Sketch Section"),
                                RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/SketchSection.js");
    action.setIcon(basePath + "/SketchSection.svg");
    action.setStatusTip(qsTr("Open a bay to trace a scanned cross " +
        "section in, over the station's own measured outline"));
    action.setDefaultCommands(["sketchsection", "sks"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(47);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
