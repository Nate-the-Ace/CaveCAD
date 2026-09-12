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

/** The handle of the window this session has open, or null. */
Cave3D.handle = null;

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
        return { survey: survey, resolved: CsNetwork.resolve(survey),
                 anchored: false };
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

    return { survey: survey, resolved: resolved, anchored: true };
};

/** One line for the window's status bar. */
Cave3D.statusText = function(read, mesh) {
    var triangles = mesh.triangles.indices.length / 3;
    var segments = mesh.lines.indices.length / 2;
    var unit = read.survey.distanceUnit === "m" ? "m" : "ft";
    var depth = mesh.bounds.max.z - mesh.bounds.min.z;
    var text = qsTr("%1 triangles, %2 centerline segments, %3 %4 of relief")
        .arg(triangles).arg(segments).arg(depth.toFixed(1)).arg(unit);
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
        mesh = CsMesh3d.build(read.survey, read.resolved);
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

    if (!Cave3D.connected) {
        // The window's Refresh button comes back as a signal carrying
        // the handle. Connected once, for the life of the application.
        cave3d.refreshRequested.connect(function(handle) {
            if (handle === Cave3D.handle) {
                Cave3D.refresh();
            }
        });
        Cave3D.connected = true;
    }

    Cave3D.refresh();
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
