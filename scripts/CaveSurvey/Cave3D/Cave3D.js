// Cave3D.js
//
// QCAD add-on tool: look at the surveyed passage in three dimensions.
//
//   Cave Survey > 3D View   (or type "cave3d" / "c3")
//
// A DOCKED PANEL, not a separate window. The caver is comparing this
// against the map, and two top-level windows have to be arranged by
// hand and re-arranged after every application switch. Docked, the 3D
// view sits beside the drawing with every other panel in the suite --
// and QDockWidget still lets anyone who wants it tear the panel off and
// float it.
//
// WHY. Every other view this suite draws is flat by construction -- the
// plan looks down, the extended elevation looks sideways, a cross
// section looks along. Each is a projection chosen to be drawn on
// paper, and each throws away the axis it is not about. A caver reading
// them has to hold the third dimension in their head, and a passage
// that climbs while it turns is exactly where that fails.
//
// So this draws none of them. It takes the same survey those views are
// projections OF, and shows it whole.
//
// NOTHING HERE DRAWS INTO THE DRAWING. The panel is a view, not a
// tool: it adds no entity, writes no tag, and a drawing that has been
// looked at in 3D is byte-identical to one that has not.
//
// THE GEOMETRY IS THE DRAWING'S OWN. The stations are resolved through
// CsAdjust.resolveAndAdjust with the anchor, datum and adjustment
// settings the drawing itself records -- the same call CsRebuild.redraw
// makes. A second, simpler resolve here would put the passage somewhere
// the map does not agree with, and the disagreement would be invisible
// until somebody measured it.

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

function Cave3D(guiAction) {
    EAction.call(this, guiAction);
}

Cave3D.prototype = new EAction();

/** The handle of the panel this session has open, or null. */
Cave3D.handle = null;

/**
 * The colour modes, in the order they appear in the dropdown.
 *
 * The keys are CsMesh3d colorBy values EXACTLY. One list, so a mode
 * cannot be offered here that the mesh does not implement -- and a
 * typo shows up as a missing entry rather than as a silent fallback to
 * trip colouring that looks like it worked.
 */
Cave3D.MODES = [
    { key: "trip",     label: qsTr("Trip") },
    { key: "depth",    label: qsTr("Depth") },
    { key: "distance", label: qsTr("Distance in") },
    { key: "size",     label: qsTr("Passage size") },
    { key: "date",     label: qsTr("Survey date") },
    { key: "closure",  label: qsTr("Closure shift") },
    { key: "splay",    label: qsTr("Splay coverage") }
];

Cave3D.SETTING_MODE = "Cave3D/ColorMode";
Cave3D.SETTING_GHOST = "Cave3D/ShowGhost";
Cave3D.SETTING_LEADS = "Cave3D/ShowLeads";

/** The chosen mode, read from settings the first time it is asked for.
 *  Not read at file scope: RSettings is not necessarily up when an
 *  add-on is loaded. */
Cave3D.mode = null;

Cave3D.isKnownMode = function(key) {
    for (var i = 0; i < Cave3D.MODES.length; i++) {
        if (Cave3D.MODES[i].key === key) {
            return true;
        }
    }
    return false;
};

Cave3D.currentMode = function() {
    if (Cave3D.mode === null) {
        var saved = RSettings.getStringValue(Cave3D.SETTING_MODE, "trip");
        Cave3D.mode = Cave3D.isKnownMode(saved) ? saved : "trip";
    }
    return Cave3D.mode;
};

/** Whether the refresh signal has been connected. Once only: the
 *  bridge outlives every run of this tool, so connecting on each run
 *  would stack up duplicate handlers that all fire. */
Cave3D.connected = false;

/**
 * The survey and its stations, positioned exactly as the drawing has
 * them.
 *
 * \return {survey, resolved} or null when the drawing holds no survey
 */
Cave3D.read = function(doc) {
    if (isNull(doc)) {
        return null;
    }
    var recon = CsRevise.surveyFromDocument(doc);
    if (recon === null || isNull(recon.survey) ||
            recon.survey.shots.length === 0) {
        return null;
    }
    var survey = recon.survey;
    CsModel.ensureTrips(survey);

    if (recon.anchorName === "" || isNull(recon.anchorPos)) {
        // No anchor: resolve from whatever the survey fixes itself.
        // The mesh is still correct relative to itself; it simply is
        // not pinned where the drawing pins it.
        var plain = CsNetwork.resolve(survey);
        return { survey: survey, resolved: plain, anchored: false,
                 anchorName: "", adjusted: plain.adjusted === true };
    }

    // anchorZ is the drawing's vertical datum. A cave surveyed to an
    // absolute one keeps it nowhere else, so dropping it here would
    // rebase the whole cave to zero -- the bug family this suite has
    // now closed six doors on, and the one a 3D view would show most
    // convincingly while being most wrong.
    var anchorZ = CsRevise.anchorZOf(recon, recon.anchorName);
    var resolved = CsAdjust.resolveAndAdjust(survey, {
        anchor: { name: recon.anchorName,
                  x: recon.anchorPos.x, y: recon.anchorPos.y,
                  z: anchorZ }
    }, CsAdjust.optionsFromTags(recon.adjustTags));

    return { survey: survey, resolved: resolved, anchored: true,
             anchorName: recon.anchorName,
             adjusted: resolved.adjusted === true };
};

/** One line for the panel's status bar. */
Cave3D.statusText = function(read, mesh) {
    var triangles = mesh.triangles.indices.length / 3;
    var unit = read.survey.distanceUnit === "m" ? "m" : "ft";
    var depth = mesh.bounds.max.z - mesh.bounds.min.z;
    var text = qsTr("%1  --  %2 triangles, %3 %4 of relief")
        .arg(mesh.legend.title).arg(triangles)
        .arg(depth.toFixed(1)).arg(unit);

    if (mesh.ghost.indices.length === 0) {
        // WHICH reason matters. One is a setting the caver can change
        // and the other is a solve that failed and wants looking at, and
        // "no ghost" alone leaves them unable to tell which they have.
        text += read.adjusted === true
            ? qsTr("  --  no ghost: the adjustment did not converge")
            : qsTr("  --  no ghost: adjustment is off");
    }
    if (read.anchored !== true) {
        text += qsTr("  --  no anchor station: not pinned to the " +
            "drawing's datum");
    }
    return text;
};

/** Rebuild the mesh from the drawing and push it into the window. */
Cave3D.refresh = function() {
    if (Cave3D.handle === null || !cave3d.isOpen(Cave3D.handle)) {
        return;
    }
    var read = Cave3D.read(getDocument());
    if (read === null) {
        cave3d.clear(Cave3D.handle);
        cave3d.setStatus(Cave3D.handle,
            qsTr("No tagged survey in this drawing."));
        return;
    }
    var mesh;
    try {
        mesh = CsMesh3d.build(read.survey, read.resolved, {
            colorBy: Cave3D.currentMode(),
            anchorName: read.anchorName
        });
    } catch (e) {
        // CsMesh3d refuses to build rather than place a station at datum
        // zero. Say so in the panel instead of leaving the last mesh up
        // and letting it pass for the current one.
        cave3d.clear(Cave3D.handle);
        cave3d.setStatus(Cave3D.handle, qsTr("Could not build: %1")
            .arg(String(e.message !== undefined ? e.message : e)));
        return;
    }
    cave3d.setMesh(Cave3D.handle, mesh);
    cave3d.setStatus(Cave3D.handle, Cave3D.statusText(read, mesh));
};

function cave3dRun() {
    // The 3D view is a C++ panel in CaveCAD itself, reached through the
    // global `cave3d`. An add-on can outlive the application it was
    // installed into -- a caver who updates the tools but not CaveCAD
    // would otherwise meet a bare ReferenceError from a menu entry that
    // looks like every other one.
    if (typeof cave3d === "undefined" || isNull(cave3d)) {
        warning(qsTr("3D View needs a newer CaveCAD.\n" +
            "This version of the application has no 3D panel in it. " +
            "Everything else in the Cave Survey suite works as before."));
        return;
    }

    var doc = getDocument();
    var read = Cave3D.read(doc);
    if (read === null) {
        warning(qsTr("3D View: no tagged survey stations found.\n" +
            "Import a survey or type one into the Survey Notebook " +
            "first -- there is no passage to look at without shots."));
        return;
    }

    if (Cave3D.handle !== null && cave3d.isOpen(Cave3D.handle)) {
        cave3d.raiseWindow(Cave3D.handle);
    } else {
        var name = CsCave.nameOf(doc.getFileName());
        Cave3D.handle = cave3d.open(isNull(name) ? "" : name);
    }

    // Fill the dropdown before the first refresh, so the panel opens
    // showing the mode it is about to draw in.
    var keys = [], labels = [];
    for (var mi = 0; mi < Cave3D.MODES.length; mi++) {
        keys.push(Cave3D.MODES[mi].key);
        labels.push(Cave3D.MODES[mi].label);
    }
    cave3d.setColorModes(Cave3D.handle, keys, labels, Cave3D.currentMode());
    cave3d.setShowLeads(Cave3D.handle,
        RSettings.getBoolValue(Cave3D.SETTING_LEADS, false));

    if (!Cave3D.connected) {
        // The panel's buttons come back as signals carrying the handle.
        // Connected once, for the life of the application -- the bridge
        // outlives every run of this tool, so connecting per run would
        // stack up duplicate handlers that all fire.
        cave3d.refreshRequested.connect(function(handle) {
            if (handle === Cave3D.handle) {
                Cave3D.refresh();
            }
        });
        cave3d.colorModeChanged.connect(function(handle, mode) {
            if (handle !== Cave3D.handle) { return; }
            if (!Cave3D.isKnownMode(mode)) { return; }
            Cave3D.mode = mode;
            RSettings.setValue(Cave3D.SETTING_MODE, mode);
            Cave3D.refresh();
        });
        cave3d.overlayToggled.connect(function(handle, which, on) {
            if (handle !== Cave3D.handle) { return; }
            // Remembered, but NOT rebuilt: both overlays have their own
            // buffer precisely so that showing and hiding them costs
            // nothing.
            RSettings.setValue(which === "ghost"
                ? Cave3D.SETTING_GHOST : Cave3D.SETTING_LEADS, on);
        });
        Cave3D.connected = true;
    }

    Cave3D.refresh();

    // The ghost's toggle is only meaningful once a mesh has said
    // whether there is a ghost to show, which is why this follows the
    // refresh rather than sitting with the other restores above.
    cave3d.setShowGhost(Cave3D.handle,
        RSettings.getBoolValue(Cave3D.SETTING_GHOST, false));
}

// ============================================================
// Add-on wiring -- the standard pattern; see docs.
// ============================================================

Cave3D.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    cave3dRun();
    this.terminate();
};

Cave3D.init = function(basePath) {
    var action = new RGuiAction(qsTr("3D View"),
        RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/Cave3D.js");
    action.setIcon(basePath + "/Cave3D.svg");
    action.setStatusTip(qsTr("Look at the surveyed passage in three " +
        "dimensions"));
    action.setDefaultCommands(["cave3d", "c3"]);
    // Stage 2, beside Loop Errors: a question about the survey itself,
    // asked before and during drawing rather than after it.
    action.setGroupSortOrder(451);
    action.setSortOrder(50);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
