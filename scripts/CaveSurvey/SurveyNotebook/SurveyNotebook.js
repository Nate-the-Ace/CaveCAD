// SurveyNotebook.js
//
// QCAD add-on tool: the Survey Notebook -- a docked panel laid out
// the way a cave survey NOTES PAGE is laid out. Stations run down the
// left with their LRUD beside them; each shot's tape/compass/clino
// (foresight AND backsight) sits on the line BETWEEN the two stations
// it connects, exactly where a hand would write it:
//
//   Station | Dist  Azm fs  Azm bs  Inc fs  Inc bs | L  R  U  D
//   A1      |                                      | 2  4  8  1
//           | 12.4   45.0   226.0    -3.0    +2.5  |
//   A2      |                                      | 3  3 12  0
//           | 18.1  112.5     --      1.5     --   |
//   A3      |                                      | ...
//
// Azimuth cells hold what the COMPASS read -- magnetic -- and the
// header's declination (typed, or IGRF-inferred) converts them to the
// true bearings the drawing uses. Editing the declination swings the
// whole survey on the next refresh or Draw.
//
// Backsights are optional; when present the shot is computed with the
// standard fs/bs correction (circular mean of foresight and reversed
// backsight) and a disagreement over 3 degrees is flagged beside the
// running stats. LRUD belongs to the station it is written beside;
// the first station's LRUD rides along as the survey's start LRUD.
//
// [+ Station] grows the page as the survey expands; totals, loop
// closures, the honest grade and any warnings update as you type.
// Draw plots the survey in ONE undo step. Import fills the page from
// any supported file; Export writes Compass/Walls/Survex/CSV.
//
// BRANCHES AND SPLAYS live on the ladder too -- there is no other
// mode, and the conventions are the paper ones. A BLANK station line
// is a separator: the chain breaks, and the next named line
// re-anchors it -- write an earlier station's name again and the
// shots after it branch from there. A station named <anchor>.<n>
// (A3.1, A3.2 while the chain stands at A3) is a SPLAY: azimuth and
// distance to a wall, no new station, chain stays at the anchor
// ("-" and ".." mean the same anonymously, the Survex way). Imports
// write these shapes automatically, so any file the suite reads
// lands on the page.
//
// THE PAGE IS ALSO THE REVISION UI. Load Drawing reconstructs the
// survey already drawn (CsRevise.surveyFromDocument, exact tag schema
// v3), asks which trip when there are several -- one page = ONE trip
// -- and fills the header and ladder from it, azimuths converted back
// to magnetic by stripping that trip's declination. Edit the shots
// and press Draw: when a trip with the same fingerprint (date |
// declination | team, see CsModel.tripFingerprint) already exists in
// the drawing, the page's shots REPLACE that trip inside the full
// merged survey -- everything is erased by station name and the whole
// merged survey redraws once, so junctions with other trips stay
// consistent. No fingerprint match appends the page as a new trip.
// A drawing with no (or only legacy pre-v3) survey data draws exactly
// the way it always did: plain draw, trip 0.
//
// The dock is a singleton; the engine stays alive, so a global
// holds it.

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

var csNotebookDock = csNotebookDock || undefined;

function SurveyNotebook(guiAction) {
    EAction.call(this, guiAction);
}

SurveyNotebook.prototype = new EAction();

/** Connects a signal, reporting rather than dying when absent. */
SurveyNotebook.safeConnect = function(signal, fn, what, problems) {
    try {
        signal.connect(fn);
        return true;
    } catch (e) {
        problems.push(what + " (" + e + ")");
        return false;
    }
};

// ---------------------------------------------------------------------
// Ladder <-> model
// ---------------------------------------------------------------------

/** Numeric cell: "" -> null, junk -> null, number -> number. */
SurveyNotebook.cellNumber = function(edit) {
    var v = String(edit.text).replace(/^\s+|\s+$/g, "");
    if (v === "" || v === "--") {
        return null;
    }
    var n = parseFloat(v);
    return isNaN(n) ? null : n;
};

/** Reads the whole panel into a CsModel survey. */
SurveyNotebook.sheetSurvey = function(w) {
    var survey = CsModel.newSurvey();
    survey.name = String(w.nameEdit.text);
    survey.date = String(w.dateEdit.text);
    survey.team = String(w.teamEdit.text);
    survey.declination = parseFloat(w.declEdit.text) || 0.0;
    survey.declinationSource = w.declSource;
    survey.distanceUnit = w.unit;

    var num = SurveyNotebook.cellNumber;
    var rows = w.rows;

    // The page reads like paper notes:
    //   - a BLANK station line is a separator: the chain is broken,
    //     and the next named line RE-ANCHORS it -- write an earlier
    //     station's name again and the following shots branch from it
    //     (that line declares a station; its measurements are ignored)
    //   - a station named <anchor>.<digits> (A3.1, A3.2 while the
    //     chain stands at A3) is a SPLAY: azimuth+distance to a wall,
    //     no new station, and the chain stays at the anchor ("-" and
    //     ".." mean the same, anonymously)
    //   - anything else is the next station in the chain
    var lastStation = "";
    var pendingAnchor = true; // page start, and after every blank line
    var startCaptured = false;
    for (var i = 0; i < rows.length; i++) {
        var name = String(rows[i].name.text).replace(/^\s+|\s+$/g, "");
        if (name === "") {
            pendingAnchor = true;
            continue;
        }
        if (pendingAnchor) {
            lastStation = name;
            pendingAnchor = false;
            if (!startCaptured) {
                startCaptured = true;
                var s0L = CsModel.parseLrudEntry(rows[i].l.text);
                var s0R = CsModel.parseLrudEntry(rows[i].r.text);
                var s0U = CsModel.parseLrudEntry(rows[i].u.text);
                var s0D = CsModel.parseLrudEntry(rows[i].d.text);
                if (s0L.value !== null || s0R.value !== null ||
                    s0U.value !== null || s0D.value !== null) {
                    survey.startLrud = {
                        left: s0L.value, right: s0R.value,
                        up: s0U.value, down: s0D.value,
                        leftAll: s0L.all, rightAll: s0R.all,
                        upAll: s0U.all, downAll: s0D.all
                    };
                }
                survey.startNote = String(rows[i].notes.toPlainText())
                    .replace(/^\s+|\s+$/g, "");
            }
            continue;
        }
        var splay = (name === "-" || name === ".." ||
            (name.length > lastStation.length + 1 &&
             name.indexOf(lastStation + ".") === 0 &&
             /^\d+$/.test(name.substring(lastStation.length + 1))));
        var to = splay ? "" : name;
        var dist = num(rows[i].dist);
        var shot = CsModel.newShot();
        shot.from = lastStation;
        shot.to = to;
        shot.splay = splay;
        shot.distance = dist === null ? 0.0 : dist;
        // The page records what the COMPASS said (magnetic); the
        // header's declination converts to the true bearings the
        // model stores. Change the declination and the whole survey
        // swings on the next refresh/Draw -- as it should.
        var az = num(rows[i].az);
        shot.azimuth = az === null ? 0.0 :
            CsAngles.applyDeclination(az, survey.declination);
        var inc = num(rows[i].inc);
        shot.inclination = inc === null ? 0.0 : inc;
        // backsights live in the scanned notes, not on this page
        // LRUD cells speak notes shorthand: "P" = passage (0),
        // "5/10" = both readings (both are drawn; the larger is the
        // wall). See CsModel.parseLrudEntry.
        var eL = CsModel.parseLrudEntry(rows[i].l.text);
        var eR = CsModel.parseLrudEntry(rows[i].r.text);
        var eU = CsModel.parseLrudEntry(rows[i].u.text);
        var eD = CsModel.parseLrudEntry(rows[i].d.text);
        shot.left = eL.value; shot.leftAll = eL.all;
        shot.right = eR.value; shot.rightAll = eR.all;
        shot.up = eU.value; shot.upAll = eU.all;
        shot.down = eD.value; shot.downAll = eD.all;
        shot.notes = String(rows[i].notes.toPlainText()).replace(/^\s+|\s+$/g, "");
        survey.shots.push(shot);
        if (!splay) {
            lastStation = name;
        }
    }
    return survey;
};

/** Fills the panel from a survey -- any survey: chains fill straight
 *  down; a branch gets a blank separator line and its origin station
 *  re-written as the new anchor; splays land as <anchor>.<n> rows. */
SurveyNotebook.setSurvey = function(w, survey) {
    w.loading = true;
    w.nameEdit.text = survey.name;
    w.dateEdit.text = survey.date;
    w.teamEdit.text = survey.team;
    w.declEdit.text = String(survey.declination || 0);
    w.declSource = survey.declinationSource || "user";
    w.unit = survey.distanceUnit;

    // rebuild the ladder rows, one per shot, in the file's own order
    SurveyNotebook.clearLadder(w);
    var put = function(edit, v) {
        edit.text = (v === null || v === undefined) ? "" : String(v);
    };

    if (survey.shots.length === 0) {
        var only = SurveyNotebook.addStationRow(w, "A1");
        only.notes.setPlainText(survey.startNote === undefined ||
            survey.startNote === null ? "" : String(survey.startNote));
        w.loading = false;
        SurveyNotebook.refresh(w);
        return;
    }

    // first row: the start station, carrying the survey's start LRUD
    var first = SurveyNotebook.addStationRow(w, survey.shots[0].from);
    if (survey.startLrud) {
        put(first.l, survey.startLrud.left);
        put(first.r, survey.startLrud.right);
        put(first.u, survey.startLrud.up);
        put(first.d, survey.startLrud.down);
    }
    first.notes.setPlainText(survey.startNote === undefined ||
        survey.startNote === null ? "" : String(survey.startNote));

    var lastStation = survey.shots[0].from;
    var splayCounts = {};
    for (var i = 0; i < survey.shots.length; i++) {
        var shot = survey.shots[i];
        // a shot leaving the chain: blank separator line, then the
        // origin station re-written as the new anchor -- paper-style
        if (shot.from !== lastStation) {
            SurveyNotebook.addStationRow(w, "");
            SurveyNotebook.addStationRow(w, shot.from);
            lastStation = shot.from;
        }
        var rowName;
        if (shot.splay) {
            splayCounts[shot.from] = (splayCounts[shot.from] || 0) + 1;
            rowName = shot.from + "." + splayCounts[shot.from];
        } else {
            rowName = shot.to;
        }
        var row = SurveyNotebook.addStationRow(w, rowName);
        put(row.dist, shot.distance);
        // cells hold compass readings: strip the declination the
        // model has applied, so round-trips never double-correct
        put(row.az, CsAngles.normalizeAzimuth(
            shot.azimuth - (survey.declination || 0)).toFixed(2));
        put(row.inc, shot.inclination);
        put(row.l, CsModel.lrudEntryText(shot.left, shot.leftAll));
        put(row.r, CsModel.lrudEntryText(shot.right, shot.rightAll));
        put(row.u, CsModel.lrudEntryText(shot.up, shot.upAll));
        put(row.d, CsModel.lrudEntryText(shot.down, shot.downAll));
        row.notes.setPlainText(shot.notes === undefined ||
            shot.notes === null ? "" : String(shot.notes));
        if (!shot.splay && shot.to !== "") {
            lastStation = shot.to;
        }
    }
    w.loading = false;
    SurveyNotebook.refresh(w);
};

// ---------------------------------------------------------------------
// Ladder construction
// ---------------------------------------------------------------------

SurveyNotebook.EDIT_WIDTH = 64;   // measurement cells
SurveyNotebook.CELL_HEIGHT = 30;  // uniform input height
SurveyNotebook.FONT_SIZE = 14;    // readable at arm's length

/** Applies the page's font and height to an input widget. Resizes
 *  the widget's OWN font -- constructing QFont with an empty family
 *  yields an invalid font and garbles rendering. */
SurveyNotebook.styleCell = function(e, height) {
    try {
        var f = e.font;
        f.setPointSize(SurveyNotebook.FONT_SIZE);
        e.font = f;
    } catch (eF) {
        // font stays at default
    }
    e.minimumHeight = height || SurveyNotebook.CELL_HEIGHT;
    if (height === undefined) {
        e.maximumHeight = SurveyNotebook.CELL_HEIGHT;
    }
    return e;
};

/**
 * Makes an edit record in ALL CAPS as you type, the way a notes page
 * is written. textEdited fires only on user edits, so writing the
 * uppercased text back cannot loop; the cursor stays put.
 */
SurveyNotebook.upperCase = function(w, edit) {
    SurveyNotebook.safeConnect(edit.textEdited, function() {
        var t = String(edit.text);
        var u = t.toUpperCase();
        if (u !== t) {
            var pos = edit.cursorPosition;
            edit.text = u;
            try {
                edit.cursorPosition = pos;
            } catch (e) {
                // cursor jump to end -- cosmetic
            }
        }
    }, "caps", w.problems);
    return edit;
};

SurveyNotebook.makeCell = function(w, width) {
    var e = SurveyNotebook.styleCell(new QLineEdit());
    e.maximumWidth = width || SurveyNotebook.EDIT_WIDTH;
    e.minimumWidth = width || SurveyNotebook.EDIT_WIDTH;
    SurveyNotebook.safeConnect(e.textEdited, function() {
        SurveyNotebook.refresh(w);
    }, "cell refresh", w.problems);
    return e;
};

/**
 * Appends one station to the page: a shot line (unless it is the
 * first station) then the station line, paper-style. Returns the row
 * record {name, dist, az, inc, l, r, u, d, notes}; the first
 * station's shot edits exist but stay hidden, so every record has
 * the same shape.
 */
SurveyNotebook.addStationRow = function(w, stationName) {
    var grid = w.grid;
    var row = {
        name: SurveyNotebook.upperCase(w, SurveyNotebook.makeCell(w, 84)),
        dist: SurveyNotebook.makeCell(w),
        az: SurveyNotebook.makeCell(w, 72),
        inc: SurveyNotebook.makeCell(w, 72),
        l: SurveyNotebook.makeCell(w, 48),
        r: SurveyNotebook.makeCell(w, 48),
        u: SurveyNotebook.makeCell(w, 48),
        d: SurveyNotebook.makeCell(w, 48),
        notes: new QPlainTextEdit(),
        widgets: []
    };
    row.name.toolTip = "Station name. Blank line = separator: the " +
        "next named line re-anchors the chain (write an earlier " +
        "station to branch from it). <station>.<n> (A3.1) = splay " +
        "shot off the current station: azimuth + distance to a wall.";
    // Notes are INTENTIONAL: click to write one. ClickFocus keeps Tab
    // from ever landing here, so flying through measurements skips the
    // box -- but once you're IN a note, Tab moves on to the next
    // station's name (tabChangesFocus), or grows the page via the "+"
    // catcher when this is the last station. A small multiline box,
    // tall enough to actually read.
    SurveyNotebook.styleCell(row.notes, 48);
    row.notes.minimumWidth = 170;
    row.notes.maximumHeight = 48;
    try {
        row.notes.focusPolicy = Qt.ClickFocus;
    } catch (eFp) {
        // policy unsupported: it stays out of the setTabOrder chain
        // regardless, which covers the common path
    }
    try {
        row.notes.tabChangesFocus = true;
    } catch (eTc) {
        // older bridge: Tab keeps inserting a tab character here
    }
    row.notes.placeholderText = "note...";
    row.notes.toolTip = "Station note -- stored with the survey data " +
        "(and exported as the shot's comment). Click to edit; Tab " +
        "moves on to the next station.";
    SurveyNotebook.safeConnect(row.notes.textChanged, function() {
        SurveyNotebook.refresh(w);
    }, "note refresh", w.problems);
    row.name.text = stationName || "";

    var isFirst = (w.rows.length === 0);

    // the shot line, written between the previous station and this one
    if (!isFirst) {
        var shotRow = w.gridRow++;
        grid.addWidget(row.dist, shotRow, 1);
        grid.addWidget(row.az, shotRow, 2);
        grid.addWidget(row.inc, shotRow, 3);
        row.widgets.push(row.dist, row.az, row.inc);
    } else {
        row.dist.visible = false;
        row.az.visible = false;
        row.inc.visible = false;
    }

    // the station line: name on the left, LRUD on the right
    var stRow = w.gridRow++;
    grid.addWidget(row.name, stRow, 0);
    grid.addWidget(row.l, stRow, 4);
    grid.addWidget(row.r, stRow, 5);
    grid.addWidget(row.u, stRow, 6);
    grid.addWidget(row.d, stRow, 7);
    // one grid cell: the box's own height makes the station line
    // taller, which keeps it aligned with its row (a 2-row span put
    // the LAST station's note into the stretchy slack row and sent
    // it drifting down the panel)
    grid.addWidget(row.notes, stRow, 8);
    row.widgets.push(row.name, row.l, row.r, row.u, row.d, row.notes);

    // Pin the page to the TOP of the scroll area: all the vertical
    // slack lives in ONE stretchy empty row below the last station,
    // tracked explicitly -- the previous stretch row gets reused by
    // the next station's widgets, so its stretch must be cleared or
    // the slack lands mid-page (header at top, new rows at bottom).
    try {
        if (w.stretchRow !== undefined) {
            grid.setRowStretch(w.stretchRow, 0);
        }
        w.stretchRow = w.gridRow;
        grid.setRowStretch(w.stretchRow, 1);
    } catch (e) {
        // older bridge without setRowStretch: cosmetic only
    }

    w.rows.push(row);
    SurveyNotebook.applyTabOrder(w);
    return row;
};

/** Removes the last station line (and its shot line) from the page. */
SurveyNotebook.removeLastStation = function(w) {
    if (w.rows.length <= 1) {
        return; // a page keeps at least its first station
    }
    var row = w.rows.pop();
    for (var i = 0; i < row.widgets.length; i++) {
        row.widgets[i].visible = false; // grid rows can't be removed
    }
    SurveyNotebook.applyTabOrder(w);
    SurveyNotebook.refresh(w);
};

/**
 * Tab order follows the ORDER OF TAKING READINGS, not the layout:
 * from a station, Tab goes to the shot's measurements (dist, azm
 * fs/bs, inc fs/bs), then to the NEW station's name, then that
 * station's LRUD -- because you measure the passage where you just
 * arrived -- then on down the page. The first station's LRUD (no
 * incoming shot) comes at the very end of the chain.
 */
SurveyNotebook.applyTabOrder = function(w) {
    var rows = w.rows;
    if (rows.length === 0) {
        return;
    }
    // Station name, the shot's measurements, then the LRUD of the
    // station you are LEAVING, then down the page: name, shot, that
    // station's LRUD, ... The last station's LRUD closes the chain.
    // First segment: both names, the shot, then BOTH stations' LRUD
    // (the start station's has no other home). Every later segment:
    // name, shot, then only the NEW station's LRUD -- the previous
    // station's was filled last cycle and is never revisited.
    // Each station's NOTE sits in the chain directly before the next
    // station's name. Normal traversal skips it (ClickFocus widgets are
    // never tabbed INTO), so the measurement flow is untouched -- but
    // Tab pressed INSIDE a note (tabChangesFocus) leaves for the next
    // thing in the chain: the next station's name, or the "+" catcher
    // after the last station, which grows the page like tabbing off
    // the last D does.
    var order = [rows[0].name];
    if (rows.length > 1) {
        var r1 = rows[1];
        order.push(rows[0].notes,
            r1.name, r1.dist, r1.az, r1.inc,
            rows[0].l, rows[0].r, rows[0].u, rows[0].d,
            r1.l, r1.r, r1.u, r1.d);
    }
    for (var i = 2; i < rows.length; i++) {
        var r = rows[i];
        order.push(rows[i - 1].notes,
            r.name, r.dist, r.az, r.inc,
            r.l, r.r, r.u, r.d);
    }
    order.push(rows[rows.length - 1].notes);
    if (w.sentinel !== undefined) {
        order.push(w.sentinel);
    }
    try {
        for (var k = 1; k < order.length; k++) {
            QWidget.setTabOrder(order[k - 1], order[k]);
        }
    } catch (e) {
        // older bridge without setTabOrder: keep default order
    }
};

/**
 * Tab off the last station's D and the page GROWS: focus landing on
 * the small "+" catcher adds the next station (name pre-incremented)
 * and moves focus into it, so continuous entry never needs the mouse.
 */
SurveyNotebook.autoAddStation = function(w) {
    var prevName = w.rows.length > 0 ?
        String(w.rows[w.rows.length - 1].name.text) : "";
    var row = SurveyNotebook.addStationRow(w,
        CsModel.nextStationName(prevName));
    try {
        row.name.setFocus();
    } catch (e) {
        // focus is a nicety
    }
    // a station added below the fold is scrolled into view -- its D
    // is the farthest-right, lowest thing the user is about to need
    try {
        w.ladderArea.ensureWidgetVisible(row.d);
    } catch (e2) {
        // scrolling is a nicety too
    }
    SurveyNotebook.refresh(w);
};

/** Hides every ladder row (rebuild path for imports). */
SurveyNotebook.clearLadder = function(w) {
    for (var i = 0; i < w.rows.length; i++) {
        for (var k = 0; k < w.rows[i].widgets.length; k++) {
            w.rows[i].widgets[k].visible = false;
        }
    }
    w.rows = [];
};

// ---------------------------------------------------------------------
// Live feedback
// ---------------------------------------------------------------------

SurveyNotebook.refresh = function(w) {
    if (w.loading) {
        return;
    }
    var survey = SurveyNotebook.sheetSurvey(w);
    if (survey.shots.length === 0) {
        w.statusLabel.setPlainText("No shots yet. Shots are written " +
            "between the stations they connect; azimuth clockwise from " +
            "north, distance along the tape, backsights optional. LRUD " +
            "sits beside its station.");
        return;
    }
    var resolved = CsNetwork.resolve(survey, {});
    var findings = CsValidate.check(survey, resolved);
    var stats = CsStats.compute(survey, resolved, CsTraverse.SLOPE);
    var grade = CsGrade.compute(survey, resolved, stats);

    var lines = [];
    lines.push("Length " + CsReport.length(stats.surveyedLength, w.unit) +
        "   Depth " + CsReport.length(stats.depth, w.unit) +
        "   Stations " + stats.stationCount +
        "   Grade " + grade.uis);
    for (var i = 0; i < resolved.loops.length; i++) {
        var loop = resolved.loops[i];
        lines.push("Loop " + loop.from + " to " + loop.to + ": " +
            loop.error.toFixed(2) + " over " + loop.traverseLength.toFixed(1) +
            " (" + loop.percent.toFixed(2) + "%)");
    }
    var shown = 0;
    for (i = 0; i < findings.length && shown < 4; i++) {
        lines.push(findings[i].severity.toUpperCase() + ": " +
            findings[i].message);
        shown++;
    }
    if (findings.length > shown) {
        lines.push("(" + (findings.length - shown) + " more -- see Draw's report)");
    }
    w.statusLabel.setPlainText(lines.join("\n"));
};

// ---------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------

SurveyNotebook.drawSurvey = function(w) {
    // Any failure in here must be SEEN, not swallowed by the engine.
    try {
        SurveyNotebook.drawSurveyInner(w);
    } catch (e) {
        QMessageBox.warning(null, "Survey Notebook",
            "Draw failed inside this build's bridge:\n\n" + e +
            "\n\n" + (e.stack ? String(e.stack).substring(0, 600) : "") +
            "\n\nPlease report this text.");
    }
};

SurveyNotebook.drawSurveyInner = function(w) {
    var doc = getDocument();
    if (doc === undefined || doc === null) {
        QMessageBox.warning(null, "Survey Notebook", "No drawing is open.");
        return;
    }
    var survey = SurveyNotebook.sheetSurvey(w);
    if (survey.shots.length === 0) {
        QMessageBox.information(null, "Survey Notebook", "No shots to draw.");
        return;
    }

    // A drawing that already holds exact (v3) survey data makes Draw
    // TRIP-AWARE: the page's shots replace (or join) their trip inside
    // the full merged survey, and the whole thing redraws once.
    // Anything else -- empty drawing, untagged linework, legacy pre-v3
    // tags -- takes the plain path below, exactly as it always has.
    var recon = null;
    try {
        recon = CsRevise.surveyFromDocument(doc);
    } catch (eRecon) {
        recon = null; // unreadable tags: treat as no existing survey
    }
    if (recon !== null && recon.legacy !== true &&
            recon.survey.shots.length > 0) {
        SurveyNotebook.drawMergedSurvey(w, doc, survey, recon);
        return;
    }

    // Anchor priority: an explicitly selected station wins; otherwise,
    // if the page's FIRST station name already exists in the drawing,
    // the new survey ties into it automatically -- name the tie-in
    // station on the first line of the notes and the surveys connect,
    // position and elevation both.
    var anchor;
    var tieIn = null;
    var sel = CsPick.startPointFromSelection(doc, "Survey Notebook");
    if (sel !== undefined && survey.shots.length > 0) {
        anchor = { name: survey.shots[0].from, x: sel.pos.x, y: sel.pos.y, z: 0 };
    } else if (survey.shots.length > 0) {
        var firstName = survey.shots[0].from;
        var existing = CsTags.collectStations(doc);
        for (var ei = 0; ei < existing.length; ei++) {
            if (existing[ei].name === firstName) {
                var z = CsTags.getNumber(existing[ei].entity, "Elevation");
                anchor = { name: firstName, x: existing[ei].pos.x,
                    y: existing[ei].pos.y, z: z === null ? 0 : z };
                tieIn = firstName;
                break;
            }
        }
    }

    var resolved = CsNetwork.resolve(survey, { anchor: anchor });
    var findings = CsValidate.check(survey, resolved);

    // Redrawing REPLACES: everything previously drawn for the stations
    // on THIS page -- points, labels, LRUD, and shots between page
    // stations -- is removed first, so Draw never stacks duplicates.
    // Older surveys' marks survive untouched (a tie-in shot from an
    // earlier trip keeps its line: only one of its ends is on this
    // page). The erase is its own undo step before the draw.
    var seqBase = CsTags.collectStations(doc).length;
    var pageNames = CsModel.stationNames(survey);
    var replaced = CsDraw.eraseStations(doc, pageNames);

    var drawn = CsDraw.survey(survey, resolved, undefined, undefined, seqBase);
    CsDraw.zoomToSurvey(survey, resolved);

    QMessageBox.information(null, "Survey Notebook",
        (tieIn !== null ? ("Tied into existing station " + tieIn +
            " -- the new survey continues from its position and " +
            "elevation.\n\n") : "") +
        (replaced > 0 ? ("Replaced " + replaced + " previously drawn " +
            "mark" + (replaced === 1 ? "" : "s") + " for this page's " +
            "stations (undo twice to restore them).\n\n") : "") +
        CsReport.drawSummary(survey, resolved, drawn, findings) +
        "\n\nDrawn as one undo step" +
        (replaced > 0 ? " after the replace" : "") + ".");
};

// ---------------------------------------------------------------------
// Drawing round-trip: the page as the shot-revision UI.
//
// The pure half first (no GUI, no document access -- testable
// headless): cloneShot / tripSurvey / mergeTripIntoSurvey /
// tripChoiceLabel. The document-touching half (loadFromDrawing,
// drawMergedSurvey) sits below them.
// ---------------------------------------------------------------------

/** Shallow copy of one shot (own enumerable fields; the leftAll-style
 *  arrays stay shared -- nothing downstream mutates them). Pure. */
SurveyNotebook.cloneShot = function(shot) {
    var out = {};
    for (var k in shot) {
        if (shot.hasOwnProperty(k)) {
            out[k] = shot[k];
        }
    }
    return out;
};

/**
 * Extracts ONE trip from a (possibly multi-trip) survey as a fresh
 * single-trip survey the ladder can hold: header fields from the trip
 * record, shots cloned and re-based to trip 0, notebook order
 * preserved. setSurvey then fills the page from it and strips the
 * trip's declination from the azimuth cells the same way it does for
 * imports. Pure -- no GUI, no document access.
 */
SurveyNotebook.tripSurvey = function(survey, tripId) {
    CsModel.ensureTrips(survey);
    var trip = survey.trips[tripId];
    var out = CsModel.newSurvey();
    out.name = trip.name;
    out.caveName = survey.caveName;
    out.date = trip.date;
    out.team = trip.team;
    out.declination = trip.declination;
    out.declinationSource = trip.declinationSource;
    out.distanceUnit = trip.distanceUnit;
    out.startNote = trip.startNote || "";
    out.startLrud = trip.startLrud || null;
    for (var i = 0; i < survey.shots.length; i++) {
        if ((survey.shots[i].trip || 0) !== tripId) {
            continue;
        }
        var c = SurveyNotebook.cloneShot(survey.shots[i]);
        c.trip = 0;
        out.shots.push(c);
    }
    return out;
};

/**
 * Carries the fields the ladder has no cells for from a trip's OLD
 * shots onto the page's revised ones. The page holds station name,
 * distance, azimuth, inclination, LRUD and notes -- it has nowhere to
 * write a backsight or a Compass exclusion flag, so a page-blank value
 * must never be allowed to erase what the drawing was already
 * carrying. Without this, loading a trip and correcting one distance
 * would quietly throw away every backsight and flag in it.
 *
 * Matching is by identity of the leg, in notebook order: a normal shot
 * takes the next unconsumed old shot with the same (from, to) pair, a
 * splay takes the next unconsumed old splay off the same station. Each
 * old shot is consumed at most once, so duplicate legs and repeated
 * station pairs pair off one-for-one in the order they were written. A
 * page shot with no counterpart is a leg the user just typed: it keeps
 * its own blank values, which is correct, not a loss.
 *
 * Flags carry over unconditionally. A BACKSIGHT does not: it lives in
 * the same frame as azimuth (true, declination applied), so the moment
 * the user edits a shot's azimuth on the page the old backsight stops
 * describing that leg. A reading that silently disagrees with its
 * foresight is worse than no reading, so that shot's backAzimuth is
 * dropped and counted -- backInclination likewise against inclination.
 *
 * newShots are mutated in place; callers pass clones. oldShots are
 * only read. Pure -- no GUI, no document access.
 *
 * \return { backsights, droppedBacksights, flags } -- shot counts for
 *         the Draw report: shots that kept a carried-over backsight
 *         reading, shots whose backsight was dropped as edited, and
 *         shots that kept at least one carried-over exclusion flag.
 */
SurveyNotebook.carryHiddenFields = function(oldShots, newShots) {
    var EPS = 1e-9;
    var FLAGS = ["excludeFromPlot", "excludeFromAll",
        "excludeFromLength", "noAdjust"];
    // A splay has no "to", so its identity is its base station plus
    // its position among that station's splays -- hence one key for
    // all of them and the queue below does the ordering.
    var legKey = function(s) {
        return s.splay ? (s.from + " <splay>") :
            (s.from + " " + s.to);
    };
    var queues = {};    // leg identity -> old shots, notebook order
    var heads = {};     // leg identity -> how many are consumed
    var i;
    for (i = 0; i < oldShots.length; i++) {
        var k = legKey(oldShots[i]);
        if (queues[k] === undefined) {
            queues[k] = [];
        }
        queues[k].push(oldShots[i]);
    }

    var out = { backsights: 0, droppedBacksights: 0, flags: 0 };
    for (i = 0; i < newShots.length; i++) {
        var ns = newShots[i];
        var nk = legKey(ns);
        var q = queues[nk];
        var at = heads[nk] === undefined ? 0 : heads[nk];
        if (q === undefined || at >= q.length) {
            continue; // a genuinely new leg: there is nothing to carry
        }
        heads[nk] = at + 1;
        var os = q[at];

        var kept = false;
        var dropped = false;
        if (os.backAzimuth !== null && os.backAzimuth !== undefined) {
            if (Math.abs(ns.azimuth - os.azimuth) > EPS) {
                dropped = true; // page moved the foresight: stale
            } else {
                ns.backAzimuth = os.backAzimuth;
                kept = true;
            }
        }
        if (os.backInclination !== null && os.backInclination !== undefined) {
            if (Math.abs(ns.inclination - os.inclination) > EPS) {
                dropped = true;
            } else {
                ns.backInclination = os.backInclination;
                kept = true;
            }
        }
        if (kept) {
            out.backsights++;
        }
        if (dropped) {
            out.droppedBacksights++;
        }

        var flagged = false;
        for (var f = 0; f < FLAGS.length; f++) {
            if (os[FLAGS[f]] === true) {
                ns[FLAGS[f]] = true;
                flagged = true;
            }
        }
        if (flagged) {
            out.flags++;
        }
    }
    return out;
};

/**
 * The merge decision: given the RECONSTRUCTED survey (the whole
 * drawing), the page's trip record and the page's shots, builds the
 * merged survey the drawing should now hold. A trip whose fingerprint
 * (date | declination | team -- CsModel.tripFingerprint) matches the
 * page is REPLACED: its old shots drop out, the page's shots take its
 * trip id, and its trip record is overwritten by the page's (name and
 * start note/LRUD included -- the page is the revision authority).
 * No match appends the page as a new trip.
 *
 * Pure -- no GUI, no document access. reconSurvey's shots and trip
 * records are not mutated (kept shots are shared by reference; the
 * page's shots are cloned before re-stamping their trip id), though
 * CsModel.ensureTrips normalizes reconSurvey in place, the suite-wide
 * idiom.
 *
 * \return {
 *   survey     the merged CsModel survey (fresh object; fixed copied
 *              so callers may add seed points freely)
 *   tripId     the trip id the page's shots now carry
 *   replaced   true when an existing trip was replaced (fingerprint
 *              matched), false when the page landed as a new trip
 *   droppedStationNames  station names touched by the replaced trip's
 *              OLD shots -- the erase set must include the ones the
 *              revision no longer uses, or their marks would linger
 *   carried    what the ladder-invisible fields did on the way in --
 *              see carryHiddenFields (all zeros for a new trip, which
 *              has no old shots to carry from)
 * }
 */
SurveyNotebook.mergeTripIntoSurvey = function(reconSurvey, tripRecord, shots) {
    CsModel.ensureTrips(reconSurvey);
    var merged = CsModel.newSurvey();
    merged.caveName = reconSurvey.caveName;
    merged.fixed = {};
    for (var fn in reconSurvey.fixed) {
        if (reconSurvey.fixed.hasOwnProperty(fn)) {
            merged.fixed[fn] = reconSurvey.fixed[fn];
        }
    }
    merged.trips = reconSurvey.trips.slice();

    var fp = CsModel.tripFingerprint(tripRecord);
    var tripId = -1;
    for (var t = 0; t < merged.trips.length; t++) {
        if (CsModel.tripFingerprint(merged.trips[t]) === fp) {
            tripId = t;
            break;
        }
    }
    var replaced = tripId >= 0;
    if (replaced) {
        // once trips exist they are the authority (see ensureTrips):
        // the revision writes the trip SLOT, never top-level fields
        merged.trips[tripId] = tripRecord;
    } else {
        merged.trips.push(tripRecord);
        tripId = merged.trips.length - 1;
    }

    var droppedSeen = {};
    var droppedStationNames = [];
    var dropName = function(n) {
        if (n !== "" && droppedSeen[n] !== true) {
            droppedSeen[n] = true;
            droppedStationNames.push(n);
        }
    };
    var oldTripShots = [];
    for (var i = 0; i < reconSurvey.shots.length; i++) {
        var s = reconSurvey.shots[i];
        if ((s.trip || 0) === tripId) {
            // replaced trip's old shot: dropped (never matches when
            // the page landed as a NEW trip -- no old shot has its id),
            // but kept aside first so what the page can't show survives
            oldTripShots.push(s);
            dropName(s.from);
            if (!s.splay) {
                dropName(s.to);
            }
            continue;
        }
        merged.shots.push(s);
    }
    var pageShots = [];
    for (i = 0; i < shots.length; i++) {
        var c = SurveyNotebook.cloneShot(shots[i]);
        c.trip = tripId;
        pageShots.push(c);
    }
    // The page is the authority on what it can express -- and only on
    // that. Backsights and exclusion flags have no cells, so they come
    // across from the shots this trip already had.
    var carried = SurveyNotebook.carryHiddenFields(oldTripShots, pageShots);
    for (i = 0; i < pageShots.length; i++) {
        merged.shots.push(pageShots[i]);
    }
    CsModel.ensureTrips(merged); // mirror trips[0] up to the top level
    return { survey: merged, tripId: tripId, replaced: replaced,
        droppedStationNames: droppedStationNames, carried: carried };
};

/** One trip as a chooser line: "0: ENT 1998-07-04 NS/JB (12 shots)".
 *  "|" is getItem's separator, so it is flattened out of the free
 *  text. Pure. */
SurveyNotebook.tripChoiceLabel = function(tripId, trip, shotCount) {
    var clean = function(v) {
        return String(v === undefined || v === null ? "" : v)
            .replace(/\|/g, "/").replace(/^\s+|\s+$/g, "");
    };
    var parts = [tripId + ":"];
    if (clean(trip.name) !== "") {
        parts.push(clean(trip.name));
    }
    if (clean(trip.date) !== "") {
        parts.push(clean(trip.date));
    }
    if (clean(trip.team) !== "") {
        parts.push(clean(trip.team));
    }
    parts.push("(" + shotCount + " shot" +
        (shotCount === 1 ? "" : "s") + ")");
    return parts.join(" ");
};

/**
 * Load Drawing: reconstructs the survey from the open drawing and
 * fills the page from ONE of its trips -- the ladder becomes that
 * trip's revision UI. Multi-trip drawings get a chooser; legacy
 * (pre-v3) drawings are pointed at Rebuild Survey Data instead, since
 * a chain-guessed reconstruction is not safe to revise from.
 */
SurveyNotebook.loadFromDrawing = function(w) {
    var doc = getDocument();
    if (doc === undefined || doc === null) {
        QMessageBox.warning(null, "Survey Notebook", "No drawing is open.");
        return;
    }
    var recon;
    try {
        recon = CsRevise.surveyFromDocument(doc);
    } catch (eRe) {
        QMessageBox.warning(null, "Survey Notebook",
            "Couldn't read the survey back from this drawing (" + eRe + ").");
        return;
    }
    if (recon.legacy === true) {
        QMessageBox.information(null, "Survey Notebook",
            "This drawing's survey predates the exact tag schema, so " +
            "its shots can't be loaded back faithfully.\n\n" +
            "Run Rebuild Survey Data (command: rebuildsurveydata) " +
            "first -- it upgrades the tags in place -- then Load " +
            "Drawing again.");
        return;
    }
    if (recon.survey.shots.length === 0) {
        QMessageBox.warning(null, "Survey Notebook",
            "No survey shots found in this drawing -- nothing to load.");
        return;
    }

    // one page = ONE trip: count shots per trip, choose when several
    var counts = {};
    for (var i = 0; i < recon.survey.shots.length; i++) {
        var tid = recon.survey.shots[i].trip || 0;
        counts[tid] = (counts[tid] || 0) + 1;
    }
    var withShots = [];
    for (var t = 0; t < recon.survey.trips.length; t++) {
        if ((counts[t] || 0) > 0) {
            withShots.push(t);
        }
    }
    if (withShots.length === 0) {
        // shots tagged with a trip id no trip record covers (a
        // hand-edited drawing): no header to load them under
        QMessageBox.warning(null, "Survey Notebook",
            "This drawing's shots don't belong to any trip recorded in " +
            "it, so there's no trip header to load them under.");
        return;
    }
    var tripId;
    if (withShots.length === 1) {
        tripId = withShots[0];
    } else {
        var labels = [];
        for (i = 0; i < withShots.length; i++) {
            labels.push(SurveyNotebook.tripChoiceLabel(withShots[i],
                recon.survey.trips[withShots[i]], counts[withShots[i]]));
        }
        var choice = getItem("Survey Notebook",
            "This drawing holds " + withShots.length + " trips -- one " +
            "page is one trip. Load which?", labels.join("|"), 0, "|");
        if (choice === undefined) {
            return;
        }
        tripId = null;
        for (i = 0; i < labels.length; i++) {
            if (labels[i] === choice) {
                tripId = withShots[i];
            }
        }
        if (tripId === null) {
            return;
        }
    }

    SurveyNotebook.setSurvey(w,
        SurveyNotebook.tripSurvey(recon.survey, tripId));
    EAction.handleUserMessage("Survey Notebook: loaded trip " + tripId +
        " (" + counts[tripId] + " shot" +
        (counts[tripId] === 1 ? "" : "s") + ") from the drawing. Edit " +
        "the page and Draw to revise that trip in place. (Backsights " +
        "and Compass-style exclusion flags don't fit on this page, but " +
        "they are preserved through the redraw -- except that editing " +
        "a shot's azimuth drops that shot's backsight, since the two " +
        "would then disagree.)");
};

/**
 * Trip-aware Draw: merges the page into the reconstructed survey
 * (see mergeTripIntoSurvey), erases EVERY station the merged survey
 * owns -- plus any the replaced trip no longer uses -- and redraws
 * the whole merged survey once. Redrawing everything keeps junction
 * geometry between trips consistent instead of stitching pages.
 */
SurveyNotebook.drawMergedSurvey = function(w, doc, survey, recon) {
    var tripRecord = CsModel.newTrip();
    tripRecord.name = survey.name;
    tripRecord.date = survey.date;
    tripRecord.team = survey.team;
    tripRecord.declination = survey.declination;
    tripRecord.declinationSource = survey.declinationSource;
    tripRecord.distanceUnit = survey.distanceUnit;
    tripRecord.startNote = survey.startNote || "";
    tripRecord.startLrud = survey.startLrud || null;

    var merge = SurveyNotebook.mergeTripIntoSurvey(recon.survey,
        tripRecord, survey.shots);
    var merged = merge.survey;

    // Anchor: hold the drawing WHERE IT STANDS. The reconstruction's
    // trip-0 anchor at its drawn position when its station survives
    // the merge; otherwise any drawn station the merged survey still
    // names. Only a page that renamed every station falls through --
    // then the merged data anchors at the old anchor's position so the
    // drawing at least stays in its own neighborhood.
    var mergedNames = CsModel.stationNames(merged);
    var inMerged = {};
    for (var i = 0; i < mergedNames.length; i++) {
        inMerged[mergedNames[i]] = true;
    }
    var anchor = null;
    var existing = CsTags.collectStations(doc);
    for (i = 0; i < existing.length; i++) {
        if (inMerged[existing[i].name] !== true) {
            continue;
        }
        var isRecAnchor = (existing[i].name === recon.anchorName);
        if (anchor === null || isRecAnchor) {
            var z = CsTags.getNumber(existing[i].entity, "Elevation");
            anchor = { name: existing[i].name, x: existing[i].pos.x,
                y: existing[i].pos.y, z: z === null ? 0 : z };
            if (isRecAnchor) {
                break;
            }
        }
    }
    if (anchor === null) {
        var firstFrom = "";
        for (i = 0; i < merged.shots.length; i++) {
            var fs = merged.shots[i];
            if (!fs.excludeFromAll && !fs.splay &&
                    fs.from !== "" && fs.to !== "") {
                firstFrom = fs.from;
                break;
            }
        }
        anchor = { name: firstFrom,
            x: recon.anchorPos !== null ? recon.anchorPos.x : 0.0,
            y: recon.anchorPos !== null ? recon.anchorPos.y : 0.0,
            z: 0.0 };
    }

    // An explicitly selected start point seeds the PAGE's first
    // station as a fixed point -- CsNetwork only consults fixed seeds
    // for stations the anchored component never reaches, so this
    // places a genuinely NEW, disconnected trip where the user asked
    // and changes nothing when the page ties into the existing survey.
    var sel = CsPick.startPointFromSelection(doc, "Survey Notebook");
    if (sel !== undefined && survey.shots.length > 0) {
        var firstPage = survey.shots[0].from;
        if (firstPage !== "" && firstPage !== anchor.name &&
                merged.fixed[firstPage] === undefined) {
            merged.fixed[firstPage] = { x: sel.pos.x, y: sel.pos.y, z: 0.0 };
        }
    }

    var resolved = CsNetwork.resolve(merged, { anchor: anchor });
    var findings = CsValidate.check(merged, resolved);

    // Erase by station name: everything the merged survey owns, plus
    // the stations the replaced trip's revision dropped. CTRL-HIDDEN
    // is toggled on around the erase -- this build silently refuses
    // deletes on an off layer, and excluded legs live there.
    var eraseNames = mergedNames.slice();
    for (i = 0; i < merge.droppedStationNames.length; i++) {
        if (inMerged[merge.droppedStationNames[i]] !== true) {
            eraseNames.push(merge.droppedStationNames[i]);
        }
    }
    var di = getDocumentInterface();
    var replaced = CsLayers.withLayerOn(doc, di, CsLayers.HIDDEN,
        function() {
            return CsDraw.eraseStations(doc, eraseNames);
        });

    // fresh Seq numbering continues after whatever survived the erase
    var seqBase = CsTags.collectStations(doc).length;
    var drawn = CsDraw.survey(merged, resolved, undefined, undefined, seqBase);
    CsDraw.zoomToSurvey(merged, resolved);

    var fp = CsModel.tripFingerprint(merged.trips[merge.tripId]);
    var tripLine = merge.replaced ?
        ("Replaced trip " + merge.tripId + " (" + fp + ") with this " +
            "page's shots; the whole survey redrew as one merged model.") :
        ("Added this page as new trip " + merge.tripId + " (" + fp +
            ") alongside the drawing's existing trips.");

    // What the page couldn't show, said out loud: the user has to be
    // able to tell preserved data from lost data without opening tags.
    var carried = merge.carried;
    var carryBits = [];
    var shotWord = function(n) {
        return n + " shot" + (n === 1 ? "" : "s");
    };
    if (carried.backsights > 0) {
        carryBits.push("kept the backsight readings on " +
            shotWord(carried.backsights));
    }
    if (carried.flags > 0) {
        carryBits.push("kept the exclusion flags on " +
            shotWord(carried.flags));
    }
    if (carried.droppedBacksights > 0) {
        carryBits.push("dropped the backsight on " +
            shotWord(carried.droppedBacksights) + " whose azimuth or " +
            "inclination the page changed, since it would no longer " +
            "agree with the foresight");
    }
    var carryLine = carryBits.length === 0 ? "" :
        (" Backsights and exclusion flags have no cells on the page, " +
            "so they carried over from the shots the drawing already " +
            "held: " + carryBits.join("; ") + ".");

    EAction.handleUserMessage("Survey Notebook: " + tripLine + carryLine);
    QMessageBox.information(null, "Survey Notebook",
        tripLine + carryLine + "\n\n" +
        (replaced > 0 ? ("Replaced " + replaced + " previously drawn " +
            "mark" + (replaced === 1 ? "" : "s") + " (undo twice to " +
            "restore them).\n\n") : "") +
        CsReport.drawSummary(merged, resolved, drawn, findings) +
        "\n\nDrawn as one undo step" +
        (replaced > 0 ? " after the replace" : "") + ".");
};

SurveyNotebook.importFile = function(w) {
    var fileName = QFileDialog.getOpenFileName(null,
        "Import survey file", "", CsFormatRegistry.combinedFileFilter());
    if (!fileName) {
        return;
    }
    var f = new QFile(fileName);
    if (!f.open(QIODevice.ReadOnly | QIODevice.Text)) {
        QMessageBox.warning(null, "Survey Notebook",
            "Could not open " + fileName);
        return;
    }
    var content = new QTextStream(f).readAll();
    f.close();

    var format = CsFormatRegistry.detect(fileName, content);
    if (format === null) {
        QMessageBox.warning(null, "Survey Notebook",
            "Couldn't detect the format of that file.");
        return;
    }
    var survey = format.parse(content);
    if (survey.shots.length === 0) {
        QMessageBox.warning(null, "Survey Notebook",
            "No shots parsed (format tried: " + format.label + ").");
        return;
    }
    SurveyNotebook.setSurvey(w, survey);
};

SurveyNotebook.exportFile = function(w) {
    var survey = SurveyNotebook.sheetSurvey(w);
    if (survey.shots.length === 0) {
        QMessageBox.information(null, "Survey Notebook", "Nothing to export.");
        return;
    }
    var labels = [];
    for (var i = 0; i < CsFormatRegistry.FORMATS.length; i++) {
        labels.push(CsFormatRegistry.FORMATS[i].label);
    }
    var choice = getItem("Survey Notebook", "Export as which format?",
        labels.join("|"), 0, "|");
    if (choice === undefined) {
        return;
    }
    var format = null;
    for (i = 0; i < CsFormatRegistry.FORMATS.length; i++) {
        if (CsFormatRegistry.FORMATS[i].label === choice) {
            format = CsFormatRegistry.FORMATS[i];
        }
    }
    var fileName = QFileDialog.getSaveFileName(null,
        "Export " + format.label, "", format.fileFilter);
    if (!fileName) {
        return;
    }
    var content = format.write(survey);
    var f = new QFile(fileName);
    if (!f.open(QIODevice.WriteOnly | QIODevice.Text)) {
        QMessageBox.warning(null, "Survey Notebook",
            "Could not write " + fileName);
        return;
    }
    var stream = new QTextStream(f);
    stream.writeString(content);
    f.close();
    EAction.handleUserMessage("Survey Notebook: exported " +
        survey.shots.length + " shots to " + fileName);
};

SurveyNotebook.inferDeclination = function(w) {
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(w.dateEdit.text));
    if (m === null) {
        QMessageBox.information(null, "Survey Notebook",
            "Enter the survey date (YYYY-MM-DD) in the header first -- " +
            "declination drifts over the years, so the date matters.");
        return;
    }

    // the drawing's anchor is authoritative and skips the prompt;
    // otherwise ask, prefilled with the last declared location
    var coord = null;
    var shared = CsLocationPick.getShared(getDocument());
    if (shared !== null && shared.source === "anchor") {
        coord = shared;
    } else {
        coord = CsLocationPick.ask("Survey Notebook", "");
        if (coord === null) {
            return;
        }
    }

    var result = CsGeomag.declination(coord.lat, coord.lon, {
        year: parseInt(m[1], 10), month: parseInt(m[2], 10),
        day: parseInt(m[3], 10)
    });
    if (result === null) {
        QMessageBox.warning(null, "Survey Notebook",
            "That date is before 1900 -- outside the IGRF model.");
        return;
    }
    w.declEdit.text = result.declination.toFixed(2);
    w.declSource = "igrf";
    QMessageBox.information(null, "Survey Notebook",
        CsReport.igrfLine(result, coord.lat, coord.lon, String(w.dateEdit.text)) +
        "\n\nFilled into the header -- edit it freely; it stays your call.");
};

// ---------------------------------------------------------------------
// Widget construction
// ---------------------------------------------------------------------

SurveyNotebook.buildDock = function(appWin) {
    var dock = new QDockWidget("Survey Notebook", appWin);
    dock.objectName = "CaveSurveyNotebookDock";

    var w = {};
    w.loading = false;
    w.declSource = "user";
    w.unit = "ft";
    w.problems = [];
    w.rows = [];
    w.gridRow = 1; // row 0 is the header line
    var doc = getDocument();
    if (doc !== undefined && doc !== null) {
        w.unit = CsUnits.fromDrawingUnit(doc.getUnit(), RS);
    }

    var body = new QWidget(dock);
    var layout = new QVBoxLayout();

    // ---- trip header ------------------------------------------------
    var head1 = new QHBoxLayout();
    head1.addWidget(new QLabel("Survey"), 0, 0);
    w.nameEdit = SurveyNotebook.upperCase(w, new QLineEdit());
    head1.addWidget(w.nameEdit, 1, 0);
    head1.addWidget(new QLabel("Date"), 0, 0);
    w.dateEdit = new QLineEdit();
    w.dateEdit.placeholderText = "YYYY-MM-DD";
    w.dateEdit.maximumWidth = 110;
    head1.addWidget(w.dateEdit, 0, 0);
    layout.addLayout(head1, 0);

    var head2 = new QHBoxLayout();
    head2.addWidget(new QLabel("Team"), 0, 0);
    w.teamEdit = SurveyNotebook.upperCase(w, new QLineEdit());
    head2.addWidget(w.teamEdit, 1, 0);
    head2.addWidget(new QLabel("Decl"), 0, 0);
    w.declEdit = new QLineEdit();
    w.declEdit.placeholderText = "0.0 (E+)";
    w.declEdit.maximumWidth = 80;
    head2.addWidget(w.declEdit, 0, 0);
    w.inferButton = new QPushButton("Infer");
    w.inferButton.toolTip =
        "Estimate declination from the survey date and the cave's " +
        "location (IGRF model, 1900 to present). Always editable.";
    head2.addWidget(w.inferButton, 0, 0);
    layout.addLayout(head2, 0);

    var columnHelp =
        "The notes page: shots are written between the stations they " +
        "connect.\n" +
        "Azm: what the COMPASS reads (magnetic, clockwise from north);\n" +
        "the header's Decl converts to true for the drawing.\n" +
        "Dist: along the tape. Inc: + up, - down.\n" +
        "L/R face the direction of travel; LRUD sits beside its station.\n" +
        "Blank = not measured; 0 = wall at the station; P = passage " +
        "(no wall, recorded 0); 5/10 = two readings, both drawn.\n" +
        "Blank station line = separator; the next named line " +
        "re-anchors the chain (branching, paper-style).\n" +
        "Station A3.1 while the chain stands at A3 = splay: azimuth + " +
        "distance to a wall, no new station.";

    // ---- the notes page (ladder) --------------------------------------
    {
        var inner = new QWidget();
        w.grid = new QGridLayout();
        try {
            w.grid.setHorizontalSpacing(4);
            w.grid.setVerticalSpacing(2);
            w.grid.setContentsMargins(4, 4, 4, 4);
        } catch (eSp) {
            // spacing stays at defaults
        }

        var headers = ["Station", "Dist", "Azm", "Inc",
            "L", "R", "U", "D", "Notes"];
        for (var h = 0; h < headers.length; h++) {
            var hd = new QLabel(headers[h]);
            try {
                var hf = hd.font;
                hf.setPointSize(SurveyNotebook.FONT_SIZE);
                hd.font = hf;
                hd.alignment = Qt.AlignCenter;
            } catch (eHf) {
            }
            w.grid.addWidget(hd, 0, h);
        }
        // scrollbar appears when the page outgrows the panel; the
        // stretch row (maintained in addStationRow) keeps everything
        // pinned to the top rather than centered
        try {
            w.grid.setColumnStretch(headers.length, 1);
            // the Notes column soaks up spare width
            w.grid.setColumnStretch(8, 1);
        } catch (e) {
            // cosmetic only
        }

        inner.setLayout(w.grid);
        inner.toolTip = columnHelp;

        w.ladderArea = new QScrollArea();
        w.ladderArea.widgetResizable = true;
        w.ladderArea.setWidget(inner);
        // added to the splitter below, beside the status box

        var rowBar = new QWidget();
        var rowButtons = new QHBoxLayout();
        // The "+" catcher: tabbing off the last station's D lands here,
        // which adds the next station automatically (see focusChanged
        // wiring below). A LINE EDIT, not a button: macOS excludes
        // buttons from Tab navigation unless the system-wide "full
        // keyboard access" setting is on, which would break the whole
        // point. Read-only so nothing can be typed into it.
        w.sentinel = new QLineEdit();
        w.sentinel.text = "+";
        w.sentinel.readOnly = true;
        w.sentinel.objectName = "CaveSurveyNotebookAutoAdd";
        w.sentinel.maximumWidth = 32;
        w.sentinel.alignment = Qt.AlignCenter;
        w.sentinel.toolTip = "Next station: Tab lands here from the " +
            "last D and adds it automatically";
        w.addRowButton = new QPushButton("+ Station");
        w.delRowButton = new QPushButton("- Station");
        rowButtons.addWidget(w.sentinel, 0, 0);
        rowButtons.addWidget(w.addRowButton, 0, 0);
        rowButtons.addWidget(w.delRowButton, 0, 0);
        rowButtons.addStretch(1);
        rowBar.setLayout(rowButtons);
        w.rowButtonBar = rowBar;
        // added after the splitter below, so it sits under the page
    }

    // ---- live status -----------------------------------------------
    // The status box shares a vertical SPLITTER with the notes page:
    // drag the handle to give either more room; the button rows below
    // never move. Read-only, NoFocus, and toggleable via the Status
    // button in the action row (visibility remembered).
    w.statusLabel = new QPlainTextEdit();
    w.statusLabel.readOnly = true;
    w.statusLabel.minimumHeight = 40;
    try {
        w.statusLabel.focusPolicy = Qt.NoFocus;
    } catch (eFp) {
        // cosmetic
    }

    {
        w.splitter = new QSplitter(Qt.Vertical);
        w.splitter.addWidget(w.ladderArea);
        w.splitter.addWidget(w.statusLabel);
        try {
            w.splitter.setStretchFactor(0, 4); // the page gets the growth
            w.splitter.setStretchFactor(1, 1);
        } catch (eSf) {
            // cosmetic
        }
        // the page/status split is part of the layout the user set up:
        // restore it, and remember every drag of the handle
        try {
            var savedSplit = RSettings.getStringValue(
                "CaveSurvey/NotebookSplitterSizes", "");
            if (savedSplit.length > 0) {
                var splitParts = savedSplit.split(",");
                var splitSizes = [];
                for (var si = 0; si < splitParts.length; si++) {
                    splitSizes.push(parseInt(splitParts[si], 10));
                }
                if (splitSizes.length === 2 &&
                    !isNaN(splitSizes[0]) && !isNaN(splitSizes[1])) {
                    w.splitter.setSizes(splitSizes);
                }
            } else {
                // no saved split yet: the status box starts small --
                // about two lines of text -- with the page taking the
                // rest; drag the handle for more and it is remembered
                w.splitter.setSizes([10000, 56]);
            }
            w.splitter.splitterMoved.connect(function() {
                RSettings.setValue("CaveSurvey/NotebookSplitterSizes",
                    w.splitter.sizes().join(","));
            });
        } catch (eSplit) {
            // bridge without sizes()/setSizes(): stretch factors stand
        }
        layout.addWidget(w.splitter, 1, 0);
        layout.addWidget(w.rowButtonBar, 0, 0);
    }
    w.statusLabel.visible =
        RSettings.getBoolValue("CaveSurvey/NotebookStatusVisible", true);

    // ---- actions ------------------------------------------------------
    var actions = new QHBoxLayout();
    w.drawButton = new QPushButton("Draw");
    w.drawButton.toolTip = "Draw the survey into the drawing, one undo step.";
    w.importButton = new QPushButton("Import File...");
    w.exportButton = new QPushButton("Export File...");
    w.statusButton = new QPushButton("Status");
    w.statusButton.toolTip = "Show/hide the live status box (drag the " +
        "bar above it to resize).";
    w.clearButton = new QPushButton("Clear");
    w.clearButton.toolTip = "Empty the page for the next survey. The " +
        "trip header (name, date, team, declination) is kept; nothing " +
        "in the drawing is touched.";
    w.loadDrawingButton = new QPushButton("Load from drawing");
    w.loadDrawingButton.toolTip = "Fill the page from a trip already in " +
        "the drawing, so this page becomes that trip's revision sheet. " +
        "Edit and Draw to replace it in place.";
    actions.addWidget(w.drawButton, 0, 0);
    actions.addWidget(w.importButton, 0, 0);
    actions.addWidget(w.exportButton, 0, 0);
    actions.addWidget(w.statusButton, 0, 0);
    actions.addWidget(w.clearButton, 0, 0);
    actions.addWidget(w.loadDrawingButton, 0, 0);
    layout.addLayout(actions, 0);

    body.setLayout(layout);
    dock.setWidget(body);

    // ---- wiring ----------------------------------------------------
    {
        SurveyNotebook.safeConnect(w.addRowButton.clicked, function() {
            var prevName = w.rows.length > 0 ?
                String(w.rows[w.rows.length - 1].name.text) : "";
            SurveyNotebook.addStationRow(w,
                CsModel.nextStationName(prevName));
        }, "+ Station button", w.problems);
        SurveyNotebook.safeConnect(w.delRowButton.clicked, function() {
            SurveyNotebook.removeLastStation(w);
        }, "- Station button", w.problems);
        // Focus landing on the "+" catcher = grow the page. Identity
        // is compared by objectName: the bridge wraps the same widget
        // in a fresh object per signal emission. The application
        // object is reached however this build exposes it.
        w.focusAddWired = false;
        var app = null;
        try {
            if (typeof qApp !== "undefined") {
                app = qApp;
            } else if (typeof QApplication !== "undefined" &&
                       typeof QApplication.instance === "function") {
                app = QApplication.instance();
            } else if (typeof QCoreApplication !== "undefined" &&
                       typeof QCoreApplication.instance === "function") {
                app = QCoreApplication.instance();
            }
        } catch (eApp) {
            app = null;
        }
        if (app !== null) {
            try {
                app.focusChanged.connect(function(oldW, newW) {
                    if (newW !== null && newW !== undefined &&
                        String(newW.objectName) === "CaveSurveyNotebookAutoAdd") {
                        // consume the click that may follow this focus
                        // change, so the click path can't double-add
                        w.sentinelFocusAdd = true;
                        SurveyNotebook.autoAddStation(w);
                    }
                });
                w.focusAddWired = true;
            } catch (eSig) {
                // fall through to the click path
            }
        }
        // Enter on "+" always works, focus signal or not (clicking it
        // focuses it, which the focus path already handles). The flag
        // guards against a focus-add and an Enter-add stacking.
        SurveyNotebook.safeConnect(w.sentinel.returnPressed, function() {
            if (w.sentinelFocusAdd === true) {
                w.sentinelFocusAdd = false;
                return;
            }
            SurveyNotebook.autoAddStation(w);
        }, "+ catcher Enter", w.problems);
        if (!w.focusAddWired) {
            w.sentinel.toolTip = "Next station: Tab here from the last " +
                "D, then press Enter (this build's bridge has no focus " +
                "signal, so the extra keypress is needed)";
        }
    }
    SurveyNotebook.safeConnect(w.drawButton.clicked, function() {
        SurveyNotebook.drawSurvey(w);
    }, "Draw button", w.problems);
    SurveyNotebook.safeConnect(w.importButton.clicked, function() {
        SurveyNotebook.importFile(w);
    }, "Import button", w.problems);
    SurveyNotebook.safeConnect(w.exportButton.clicked, function() {
        SurveyNotebook.exportFile(w);
    }, "Export button", w.problems);
    SurveyNotebook.safeConnect(w.inferButton.clicked, function() {
        SurveyNotebook.inferDeclination(w);
    }, "Infer button", w.problems);
    SurveyNotebook.safeConnect(w.statusButton.clicked, function() {
        w.statusLabel.visible = !w.statusLabel.visible;
        RSettings.setValue("CaveSurvey/NotebookStatusVisible",
            w.statusLabel.visible);
    }, "Status button", w.problems);
    SurveyNotebook.safeConnect(w.clearButton.clicked, function() {
        var sure = QMessageBox.question(null, "Survey Notebook",
            "Clear the page? The trip header stays; the drawing is " +
            "not touched.", QMessageBox.Yes | QMessageBox.No);
        if (sure !== QMessageBox.Yes) {
            return;
        }
        SurveyNotebook.clearLadder(w);
        SurveyNotebook.addStationRow(w, "A1");
        SurveyNotebook.addStationRow(w, "A2");
        SurveyNotebook.refresh(w);
    }, "Clear button", w.problems);
    SurveyNotebook.safeConnect(w.loadDrawingButton.clicked, function() {
        SurveyNotebook.loadFromDrawing(w);
    }, "Load from drawing button", w.problems);

    // a fresh sheet starts with its first two stations
    SurveyNotebook.addStationRow(w, "A1");
    SurveyNotebook.addStationRow(w, "A2");

    if (w.problems.length > 0) {
        EAction.handleUserWarning("Survey Notebook: this build's script " +
            "bridge refused: " + w.problems.join("; ") +
            " -- those controls are inert; the rest of the panel works.");
    }

    SurveyNotebook.refresh(w);
    return dock;
};

// ---------------------------------------------------------------------
// Tool entry: the dock is created at startup (init), the action just
// toggles it.
// ---------------------------------------------------------------------

/** Builds the dock and hands it to the main window. Idempotent. */
SurveyNotebook.ensureDock = function() {
    if (csNotebookDock !== undefined && csNotebookDock !== null) {
        return csNotebookDock;
    }
    var appWin = RMainWindowQt.getMainWindow();
    csNotebookDock = SurveyNotebook.buildDock(appWin);
    appWin.addDockWidget(Qt.RightDockWidgetArea, csNotebookDock);
    return csNotebookDock;
};

SurveyNotebook.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);

    try {
        var existed = (csNotebookDock !== undefined && csNotebookDock !== null);
        var dock = SurveyNotebook.ensureDock();
        dock.visible = existed ? !dock.visible : true;
    } catch (e) {
        csNotebookDock = undefined;
        warning("Survey Notebook: this QCAD build refused the docked " +
            "panel (" + e + "). Azimuth Traverse and Import Cave Survey " +
            "cover the same work meanwhile -- please report this.");
    }

    this.terminate();
};

SurveyNotebook.init = function(basePath) {
    var action = new RGuiAction(qsTr("Survey Notebook"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(false);
    action.setScriptFile(basePath + "/SurveyNotebook.js");
    action.setIcon(basePath + "/SurveyNotebook.svg");
    action.setStatusTip(qsTr("A docked survey notes page: stations down the side, shots between them, closures live"));
    action.setDefaultCommands(["surveynotebook", "snb"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(15);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);

    // Build the dock NOW, during add-on init: the main window's
    // readSettings()/restoreState() runs after init and can only place
    // (and re-show) a dock that already exists. Created hidden; the
    // saved window state decides whether it opens, exactly like QCAD's
    // own docks. First-ever run: stays hidden until the action shows it.
    try {
        var dock = SurveyNotebook.ensureDock();
        dock.visible = false;
    } catch (eInit) {
        // no dock at startup: the action's beginEvent will retry and
        // report if it still fails
        csNotebookDock = undefined;
    }
};
