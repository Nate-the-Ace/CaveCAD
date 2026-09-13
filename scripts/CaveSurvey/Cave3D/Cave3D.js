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
Cave3D.SETTING_SECTIONS = "Cave3D/ShowSections";
Cave3D.SETTING_SCANS = "Cave3D/ShowScans";
/** Station names written over the passage. */
Cave3D.SETTING_STATIONS = "Cave3D/ShowStations";
/** Frames an exported animation is written as. Twenty-four seconds at
 *  twenty-five a second: long enough to follow a passage, short enough
 *  that a caver is not left waiting on a folder of PNGs. */
Cave3D.EXPORT_FRAMES = 600;
/** How fast the camera runs, as a multiple of its usual pace.
 *
 *  REMEMBERED, unlike the camera mode. Which way a caver likes to be
 *  carried through a cave is a preference; whether the view is
 *  currently flying is a thing they just did. */
Cave3D.SETTING_CAMERA_SPEED = "Cave3D/CameraSpeed";
/** Where a draped scan stops being pencil and starts being paper, as a
 *  luminance 0 to 1. Remembered because it is a property of the CAVER'S
 *  SCANNER, not of any one drawing: whoever photographs their books in
 *  an entrance gets the same grey every time, and should not have to
 *  find the setting again on every cave. */
Cave3D.SETTING_SCAN_INK = "Cave3D/ScanInk";
/** What the C++ view starts at. Kept in step with
 *  RCave3dView::DEFAULT_SCAN_INK; a disagreement only means the slider
 *  jumps once on the first run. */
Cave3D.DEFAULT_SCAN_INK = 0.62;

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

/** The colour every section is drawn in.
 *
 *  ONE COLOUR, AND NOT THE ACTIVE COLOUR MODE. A section is annotation
 *  -- somebody's drawing of a place -- not another way of reading the
 *  survey. Colouring it by depth or by trip would say something about
 *  it that is not true. */
Cave3D.SECTION_COLOR = [0.95, 0.80, 0.45];

/** Dimmer, so a leader reads as a tether and not as more passage. */
Cave3D.LEADER_COLOR = [0.55, 0.47, 0.28];

/**
 * Every captured section, placed into the world as line segments.
 *
 * Each section stands square to its passage on CsSectionCut's frame,
 * offset clear on the side the caver put it on in plan, with a leader
 * home to its station.
 *
 * \return {positions, colors, indices}
 */
Cave3D.sectionsBuffer = function(doc, survey, resolved) {
    var buf = { positions: [], colors: [], indices: [] };
    var found;
    try {
        found = CsSection3d.readAll(doc);
    } catch (e) {
        return buf;
    }
    if (found.length === 0) {
        return buf;
    }

    var splays = CsLrud.splaysByStation(survey);
    var legsByStation = {};
    var noteLeg = function(name, leg) {
        if (!legsByStation.hasOwnProperty(name)) {
            legsByStation[name] = [];
        }
        legsByStation[name].push(leg);
    };
    var li;
    for (li = 0; li < resolved.legs.length; li++) {
        noteLeg(resolved.legs[li].from, resolved.legs[li]);
        noteLeg(resolved.legs[li].to, resolved.legs[li]);
    }

    var push = function(a, b, col) {
        var base = buf.positions.length / 3;
        buf.positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
        buf.colors.push(col[0], col[1], col[2], col[0], col[1], col[2]);
        buf.indices.push(base, base + 1);
    };

    for (var i = 0; i < found.length; i++) {
        var sec = found[i];
        var st = resolved.stations[sec.station];
        if (st === undefined || typeof st.z !== "number" ||
                !isFinite(st.z)) {
            // A section naming a station this drawing no longer has.
            continue;
        }
        var leg = CsSectionCut.nearestLeg(resolved, st, 1e9);
        if (leg === null) { continue; }
        var got = CsSectionCut.frameForLeg(resolved, leg.from, leg.to);
        if (got === null || got.frame === null) { continue; }
        var frame = got.frame;

        // The passage's own size here, so a section clears the passage
        // it belongs to rather than a guess at how wide that is.
        var width = 0;
        var dir = CsMesh3d.directionAt(sec.station, legsByStation, resolved);
        if (dir !== null) {
            var ring = CsMesh3d.ringAt(st, dir,
                CsMesh3d.lrudAt(sec.station, survey),
                splays[sec.station] || [], CsTraverse.SLOPE);
            for (var ri = 0; ri < ring.length; ri++) {
                var d = CsMesh3d.norm(CsMesh3d.sub(ring[ri], st));
                if (d > width) { width = d; }
            }
        }
        if (!(width > 0)) { width = 5; }

        // Plus the section's OWN reach, or a big section would straddle
        // the passage it was meant to stand clear of.
        var reach = 0;
        for (var pi = 0; pi < sec.polylines.length; pi++) {
            for (var pj = 0; pj < sec.polylines[pi].length; pj++) {
                var q = sec.polylines[pi][pj];
                var rr = Math.sqrt(q.x * q.x + q.y * q.y) / sec.scale;
                if (isFinite(rr) && rr > reach) { reach = rr; }
            }
        }

        var side = CsSection3d.sideFor(sec.blockPos, st, frame, width);
        var offset = width * (1 + CsSection3d.CLEARANCE) + reach;

        var placed = CsSection3d.place(sec.polylines, {
            station: st, frame: frame, scale: sec.scale,
            side: side, offset: offset
        });
        for (var k = 0; k < placed.length; k++) {
            for (var m = 0; m + 1 < placed[k].length; m++) {
                push(placed[k][m], placed[k][m + 1],
                     Cave3D.SECTION_COLOR);
            }
        }

        var lead = CsSection3d.leaderFor({ station: st, side: side,
            offset: offset });
        push(lead[0], lead[1], Cave3D.LEADER_COLOR);
    }
    return buf;
};

/**
 * Every sketch scan of one kind, draped onto the passage.
 *
 * ONE BUFFER, MANY TEXTURES. `runs` says how many indices belong to each
 * scan in turn, so the view binds one texture per scan without ever
 * being told what a scan is.
 *
 * \return {positions, uvs, indices, paths, runs}
 */
/**
 * One profile scan's strips, finding the band it sits in and unrolling
 * that run to invert.
 *
 * A scan in no band is skipped: without a band there is no unrolled axis
 * to walk back, and guessing one would lay the sketch along a passage
 * nobody drew it against.
 */
Cave3D.profileGridFor = function(scan, boxes, bandCache, survey, resolved,
                                 drawnStations) {
    var empty = { positions: [], uvs: [], indices: [] };
    var centre = { x: scan.quad.origin.x + scan.quad.u.x / 2,
                   y: scan.quad.origin.y + scan.quad.v.y / 2 };

    // WHICH BAND, BY ELEVATION. Bands are stacked in y and each starts
    // at the same x, so y is what tells them apart -- and a scan is
    // routinely WIDER than the band box it was fitted over (measured on
    // Truitt: a scan centred at x 606 against a box ending at 423), so
    // asking for a box that contains the whole centre point misses
    // eleven of sixteen.
    //
    // CsProfileBox.at returns the KEY, not the box, so the box itself
    // still has to be found to get its span.
    var box = null;
    for (var bi = 0; bi < boxes.length; bi++) {
        if (centre.y >= boxes[bi].minY - CsProfileBox.EDGE_EPS &&
                centre.y <= boxes[bi].maxY + CsProfileBox.EDGE_EPS) {
            box = boxes[bi];
            break;
        }
    }
    if (box === null) {
        // Not in any band's elevation range: no unrolled axis to walk
        // back, and guessing one would lay the sketch along a passage
        // nobody drew it against.
        return empty;
    }
    var band = bandCache[box.key];
    if (band === undefined) {
        var grouped = CsProfile.groupRuns(resolved);
        var run = grouped.runs[box.key];
        band = (run === undefined) ? null : CsProfile.unrollBand(run, null,
            resolved, CsProfile.hierarchy(grouped, resolved), {});
        bandCache[box.key] = band;
    }
    if (band === null) {
        return empty;
    }
    // WHERE THE DRAWING PUT THE BAND, from its own drawn stations.
    // The box's corner is not the band's first station -- it is drawn
    // around the band with padding, and below it by however far the
    // floor drops -- so taking the corner shifted every sketch forward
    // along the passage and lifted it above the cave.
    var place = CsDrape.placeBand(band, drawnStations);
    if (place === null) {
        // Either this band has no drawn stations to anchor on, or they
        // disagree with the survey as it now stands. Nothing is drawn
        // rather than something placed by guesswork.
        return empty;
    }
    return CsDrape.profileStrips(scan.quad, place, band, resolved);
};

Cave3D.scansBuffer = function(doc, survey, resolved, kind) {
    var buf = { positions: [], uvs: [], indices: [], paths: [], runs: [] };
    var scans;
    try {
        scans = CsDrape.readScans(doc, kind);
    } catch (e) {
        return buf;
    }
    // A profile scan needs the band it sits in; a plan scan does not.
    var boxes = [];
    var drawnStations = {};
    if (kind === "profile") {
        try { boxes = CsProfileBox.boxes(doc); } catch (eBox) { boxes = []; }
        // Read once for the whole buffer: it walks every entity in the
        // drawing, and a cave has more scans than it has bands.
        try {
            drawnStations = CsProfileBind.positions(doc);
        } catch (ePos) {
            drawnStations = {};
        }
    }
    var bandCache = {};

    for (var i = 0; i < scans.length; i++) {
        var g;
        try {
            if (kind === "profile") {
                g = Cave3D.profileGridFor(scans[i], boxes, bandCache,
                    survey, resolved, drawnStations);
            } else {
                g = CsDrape.grid(scans[i].quad, CsDrape.DIVISIONS,
                    resolved.stations);
            }
        } catch (eGrid) {
            continue;
        }
        if (g.positions.length === 0 || g.indices.length === 0) {
            // Nothing to sample under it. Skipped rather than drawn
            // flat at some arbitrary elevation.
            continue;
        }
        var base = buf.positions.length / 3;
        var k;
        for (k = 0; k < g.positions.length; k++) {
            buf.positions.push(g.positions[k]);
        }
        for (k = 0; k < g.uvs.length; k++) {
            buf.uvs.push(g.uvs[k]);
        }
        for (k = 0; k < g.indices.length; k++) {
            buf.indices.push(base + g.indices[k]);
        }
        buf.paths.push(scans[i].path);
        buf.runs.push(g.indices.length);
    }
    return buf;
};

/** Two scan buffers as one, keeping each scan's own run length so the
 *  view still binds one texture per scan. */
Cave3D.mergeScanBuffers = function(a, b) {
    var out = { positions: [], uvs: [], indices: [], paths: [], runs: [] };
    [a, b].forEach(function(src) {
        var base = out.positions.length / 3;
        var i;
        for (i = 0; i < src.positions.length; i++) {
            out.positions.push(src.positions[i]);
        }
        for (i = 0; i < src.uvs.length; i++) { out.uvs.push(src.uvs[i]); }
        for (i = 0; i < src.indices.length; i++) {
            out.indices.push(base + src.indices[i]);
        }
        for (i = 0; i < src.paths.length; i++) {
            out.paths.push(src.paths[i]);
            out.runs.push(src.runs[i]);
        }
    });
    return out;
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
    // The sections ride along on the same mesh object. Their own
    // buffer, so showing and hiding them never rebuilds anything.
    try {
        mesh.sections = Cave3D.sectionsBuffer(getDocument(), read.survey,
            read.resolved);
    } catch (eSections) {
        mesh.sections = { positions: [], colors: [], indices: [] };
    }

    try {
        var planScans = Cave3D.scansBuffer(getDocument(), read.survey,
            read.resolved, "plan");
        var profScans = Cave3D.scansBuffer(getDocument(), read.survey,
            read.resolved, "profile");
        mesh.scans = Cave3D.mergeScanBuffers(planScans, profScans);
    } catch (eScans) {
        mesh.scans = { positions: [], uvs: [], indices: [], paths: [],
                       runs: [] };
    }

    cave3d.setMesh(Cave3D.handle, mesh);
    if (cave3d.setFlyPath !== undefined) {
        // GUARDED: the tools can be updated without the application.
        var flight = { points: [], breaks: [] };
        try {
            // THROUGH THE MIDDLE OF THE PASSAGE, not along the line
            // of the stations: the mesh worked out where the middle is
            // when it built the cross sections.
            flight = CsFly.path(read.resolved, null,
                CsFly.centresFrom(mesh.outlines));
        } catch (eFly) {
        }
        cave3d.setFlyPath(Cave3D.handle, CsFly.flatten(flight.points),
            flight.breaks, flight.turns || []);
    }
    cave3d.setStatus(Cave3D.handle, Cave3D.statusText(read, mesh));
};

/**
 * Writes the running animation out, a numbered PNG per frame.
 *
 * FRAMES, NOT A FILM. Encoding video would mean shipping an encoder or
 * depending on whatever the caver happens to have installed, and a
 * folder of numbered frames is something every editor on every platform
 * will take. The command that turns them into a film is printed, so
 * anyone who does have ffmpeg is one paste away.
 *
 * INTO THE CAVE'S OWN FOLDER by default, beside the drawing the
 * animation is of, rather than wherever a file dialog last pointed.
 */
Cave3D.exportAnimation = function() {
    if (Cave3D.handle === null || !cave3d.isOpen(Cave3D.handle)) {
        return;
    }
    if (cave3d.exportFrames === undefined) {
        warning(qsTr("Exporting an animation needs a newer CaveCAD."));
        return;
    }
    var mode = "manual";
    try { mode = String(cave3d.getCameraMode(Cave3D.handle)); } catch (e) {}
    if (mode === "manual") {
        // NOTHING IS MOVING, so there is nothing to write. Saying so
        // beats six hundred copies of one frame.
        warning(qsTr("Turn on Fly or Spin first -- an export writes "
            + "whichever the camera is running."));
        return;
    }

    var doc = getDocument();
    var folder = CsCave.folderOf(isNull(doc) ? null : doc.getFileName());
    var base = (folder === null) ? QDir.tempPath() : folder;
    var name = "3d-" + mode + "-" + CsFly.stamp();
    var dir = base + "/" + name;

    var picked = QFileDialog.getExistingDirectory(
        RMainWindowQt.getMainWindow(),
        qsTr("Where should the frames go?"), base);
    if (picked === null || picked === undefined || String(picked) === "") {
        return;
    }
    dir = String(picked) + "/" + name;

    var written = -1;
    try {
        written = cave3d.exportFrames(Cave3D.handle, dir,
            Cave3D.EXPORT_FRAMES);
    } catch (eExp) {
        written = -1;
    }
    if (written <= 0) {
        warning(qsTr("No frames could be written to %1.").arg(dir));
        return;
    }
    // The recipe, written beside the frames: a caver who comes back to
    // this folder in a year should not have to ask what it was for.
    var note = "These are the frames of a " + mode + " animation of "
        + (isNull(doc) ? "a cave" : CsCave.nameOf(doc.getFileName()))
        + ", written by CaveCAD.\n\n"
        + "To make a film of them, with ffmpeg installed:\n\n"
        + "  ffmpeg -framerate 25 -i frame_%05d.png "
        + "-c:v libx264 -pix_fmt yuv420p " + name + ".mp4\n\n"
        + "Or drop the whole folder into any video editor as an image "
        + "sequence.\n";
    try {
        var f = new QFile(dir + "/README.txt");
        if (f.open(QIODevice.WriteOnly | QIODevice.Text)) {
            var ts = new QTextStream(f);
            ts.writeString(note);
            ts.flush();
            f.close();
        }
    } catch (eNote) {
    }
    cave3d.setStatus(Cave3D.handle,
        qsTr("Wrote %1 frames to %2").arg(written).arg(dir));
};

/**
 * Wires the panel's signals to this tool, once.
 *
 * CALLED FROM TWO PLACES and it has to be. The tool calls it when a
 * caver opens the 3D view; init calls it after pre-building the panel,
 * because a dock Qt restores from the saved layout comes up VISIBLE
 * before the tool has ever run and asks for a mesh through
 * refreshRequested -- with nothing listening, the caver gets an empty
 * 3D view that looks broken.
 *
 * Connected once for the life of the application: the bridge outlives
 * every run of the tool, so connecting per run would stack up duplicate
 * handlers that all fire.
 */
/**
 * The panel's own furniture: its title, its colour modes and the
 * overlay switches, restored from what the caver last chose.
 *
 * SEPARATE FROM THE MESH because a panel can exist without one -- Qt
 * puts the dock back where the caver left it on the next start, before
 * this tool has run at all.
 */
Cave3D.dress = function() {
    if (Cave3D.handle === null || !cave3d.isOpen(Cave3D.handle)) {
        return;
    }
    var doc = getDocument();
    if (!isNull(doc)) {
        var name = CsCave.nameOf(doc.getFileName());
        // open() on a panel that is already there only renames it and
        // brings it forward.
        cave3d.open(isNull(name) ? "" : name);
    }
    var keys = [], labels = [];
    for (var mi = 0; mi < Cave3D.MODES.length; mi++) {
        keys.push(Cave3D.MODES[mi].key);
        labels.push(Cave3D.MODES[mi].label);
    }
    cave3d.setColorModes(Cave3D.handle, keys, labels, Cave3D.currentMode());
    cave3d.setShowLeads(Cave3D.handle,
        RSettings.getBoolValue(Cave3D.SETTING_LEADS, false));
};

Cave3D.connectOnce = function() {
    if (Cave3D.connected) {
        return;
    }

        // The panel's buttons come back as signals carrying the handle.
        // Connected once, for the life of the application -- the bridge
        // outlives every run of this tool, so connecting per run would
        // stack up duplicate handlers that all fire.
        cave3d.refreshRequested.connect(function(handle) {
            if (handle !== Cave3D.handle) { return; }
            // A PANEL QT RESTORED HAS NOTHING IN IT -- no colour modes,
            // no title, no toggles -- because the tool has never run.
            // Dress it before drawing into it, or the caver's first
            // sight of the 3D view is a cave in an unnamed window with
            // an empty mode dropdown.
            Cave3D.dress();
            Cave3D.refresh();
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
            var key = Cave3D.SETTING_LEADS;
            if (which === "ghost") {
                key = Cave3D.SETTING_GHOST;
            } else if (which === "sections") {
                key = Cave3D.SETTING_SECTIONS;
            } else if (which === "scans") {
                key = Cave3D.SETTING_SCANS;
            } else if (which === "stations") {
                key = Cave3D.SETTING_STATIONS;
            }
            RSettings.setValue(key, on);
        });
        if (cave3d.cameraSpeedChanged !== undefined) {
            cave3d.cameraSpeedChanged.connect(function(handle, factor) {
                if (handle !== Cave3D.handle) { return; }
                RSettings.setValue(Cave3D.SETTING_CAMERA_SPEED, factor);
            });
        }
        if (cave3d.exportRequested !== undefined) {
            cave3d.exportRequested.connect(function(handle) {
                if (handle !== Cave3D.handle) { return; }
                Cave3D.exportAnimation();
            });
        }
        if (cave3d.cameraModeChanged !== undefined) {
            cave3d.cameraModeChanged.connect(function(handle, mode) {
                if (handle !== Cave3D.handle) { return; }
                // Not remembered between sessions: a cave opens still,
                // and a view that started spinning on its own would be
                // a surprise rather than a setting.
                Cave3D.cameraMode = mode;
            });
        }
        if (cave3d.scanInkChanged !== undefined) {
            // GUARDED. The tools can be updated without the
            // application, and an older CaveCAD has no such signal --
            // reaching for it would take the whole panel down with a
            // TypeError at connect time.
            cave3d.scanInkChanged.connect(function(handle, value) {
                if (handle !== Cave3D.handle) { return; }
                // Remembered, not rebuilt: the threshold is a shader
                // uniform, so the view has already redrawn with it.
                RSettings.setValue(Cave3D.SETTING_SCAN_INK, value);
            });
        }
    Cave3D.connected = true;
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

    Cave3D.connectOnce();

    Cave3D.refresh();

    // The ghost's toggle is only meaningful once a mesh has said
    // whether there is a ghost to show, which is why this follows the
    // refresh rather than sitting with the other restores above.
    cave3d.setShowGhost(Cave3D.handle,
        RSettings.getBoolValue(Cave3D.SETTING_GHOST, false));
    // Same reason as the ghost: only a built mesh knows whether this
    // drawing holds any sections to show.
    cave3d.setShowSections(Cave3D.handle,
        RSettings.getBoolValue(Cave3D.SETTING_SECTIONS, false));
    cave3d.setShowScans(Cave3D.handle,
        RSettings.getBoolValue(Cave3D.SETTING_SCANS, false));
    if (cave3d.setShowStations !== undefined) {
        // GUARDED: the tools can be updated without the application,
        // and an older CaveCAD has no station labels to switch on.
        cave3d.setShowStations(Cave3D.handle,
            RSettings.getBoolValue(Cave3D.SETTING_STATIONS, false));
    }
    if (cave3d.setCameraSpeed !== undefined) {
        cave3d.setCameraSpeed(Cave3D.handle,
            RSettings.getDoubleValue(Cave3D.SETTING_CAMERA_SPEED, 1.0));
    }
    if (cave3d.setScanInk !== undefined) {
        cave3d.setScanInk(Cave3D.handle,
            RSettings.getDoubleValue(Cave3D.SETTING_SCAN_INK,
                Cave3D.DEFAULT_SCAN_INK));
    }
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

    // BUILD THE PANEL NOW, HIDDEN. A QOpenGLWidget appearing in a
    // window makes Qt rebuild that window natively, and macOS then
    // reshuffles its Spaces around the new one -- which a caver sees as
    // the desktop sliding and the screen going black for about a
    // second. It cannot be avoided, so it is paid here, at startup,
    // while the window is being put together anyway, rather than in the
    // middle of their session the first time they open the 3D view.
    //
    // Guarded twice over: an older CaveCAD has no such call, and a
    // failure to pre-build must not stop the tool being installed.
    try {
        if (typeof cave3d !== "undefined" && !isNull(cave3d) &&
                cave3d.prewarm !== undefined) {
            // THE HANDLE COMES BACK, and is kept. Qt remembers where
            // the caver put the dock and puts it BACK on the next
            // start, visible, before this tool has ever run -- and the
            // panel then asks for a mesh through refreshRequested.
            // Without the handle that request arrives for a window this
            // side does not think it owns, and is dropped: the caver
            // gets an empty 3D view that looks broken.
            Cave3D.handle = cave3d.prewarm();
            Cave3D.connectOnce();
        }
    } catch (ePrewarm) {
    }
};
