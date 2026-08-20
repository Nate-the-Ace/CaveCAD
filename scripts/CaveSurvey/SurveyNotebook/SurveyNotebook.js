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
// COMPATIBILITY: the QJSEngine widget bridge exposes a slightly
// different method set from build to build. The ladder needs only
// line edits, labels, grid layouts and a scroll area -- wrapped in
// every build seen so far -- and still probes them at startup,
// falling back to a text sheet (one shot per line, CSV columns,
// parsed by Core's own CSV reader) rather than dying. A branched
// survey doesn't fit a single notes page; importing one switches to
// the text sheet too.
//
// The dock is a singleton; QCAD keeps the engine alive, so a global
// holds it.

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

var csNotebookDock = csNotebookDock || undefined;

function SurveyNotebook(guiAction) {
    EAction.call(this, guiAction);
}

SurveyNotebook.prototype = new EAction();

// ---------------------------------------------------------------------
// Bridge probing
// ---------------------------------------------------------------------

/** True when the ladder's widgets all answer in this build. */
SurveyNotebook.ladderSupported = function() {
    var needed = ["QLineEdit", "QLabel", "QGridLayout", "QScrollArea",
        "QWidget", "QPushButton"];
    for (var i = 0; i < needed.length; i++) {
        if ((0, eval)("typeof " + needed[i]) === "undefined") {
            return false;
        }
    }
    try {
        var probe = new QLineEdit();
        probe.text = "x";
        if (String(probe.text) !== "x") {
            return false;
        }
        var g = new QGridLayout();
        g.addWidget(new QLabel("p"), 0, 0);
        return true;
    } catch (e) {
        return false;
    }
};

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

    if (w.mode === "text") {
        var parsed = CsFormatCsv.parse(String(w.editor.toPlainText()));
        survey.shots = parsed.shots;
        return survey;
    }

    var num = SurveyNotebook.cellNumber;
    var rows = w.rows;

    if (rows.length > 0) {
        var r0 = rows[0];
        var s0L = CsModel.parseLrudEntry(r0.l.text);
        var s0R = CsModel.parseLrudEntry(r0.r.text);
        var s0U = CsModel.parseLrudEntry(r0.u.text);
        var s0D = CsModel.parseLrudEntry(r0.d.text);
        if (s0L.value !== null || s0R.value !== null ||
            s0U.value !== null || s0D.value !== null) {
            survey.startLrud = {
                left: s0L.value, right: s0R.value,
                up: s0U.value, down: s0D.value,
                leftAll: s0L.all, rightAll: s0R.all,
                upAll: s0U.all, downAll: s0D.all
            };
        }
    }

    if (rows.length > 0) {
        survey.startNote = String(rows[0].notes.toPlainText()).replace(/^\s+|\s+$/g, "");
    }

    for (var i = 1; i < rows.length; i++) {
        var from = String(rows[i - 1].name.text).replace(/^\s+|\s+$/g, "");
        var to = String(rows[i].name.text).replace(/^\s+|\s+$/g, "");
        var dist = num(rows[i].dist);
        if (from === "" && to === "") {
            continue;
        }
        var shot = CsModel.newShot();
        shot.from = from;
        shot.to = to;
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
    }
    return survey;
};

/** True when a survey reads as one linear notes page. */
SurveyNotebook.isChain = function(survey) {
    var prev = null;
    for (var i = 0; i < survey.shots.length; i++) {
        var s = survey.shots[i];
        if (s.splay || s.excludeFromAll) {
            return false;
        }
        if (prev !== null && s.from !== prev) {
            return false;
        }
        prev = s.to;
    }
    return true;
};

/** Fills the panel from a survey; branched surveys go to text mode. */
SurveyNotebook.setSurvey = function(w, survey) {
    w.loading = true;
    w.nameEdit.text = survey.name;
    w.dateEdit.text = survey.date;
    w.teamEdit.text = survey.team;
    w.declEdit.text = String(survey.declination || 0);
    w.declSource = survey.declinationSource || "user";
    w.unit = survey.distanceUnit;

    if (w.mode === "ladder" && !SurveyNotebook.isChain(survey)) {
        SurveyNotebook.switchToText(w,
            "This survey branches or holds splays -- a single notes " +
            "page is a straight line, so it opened as the text sheet.");
    }

    if (w.mode === "text") {
        w.editor.setPlainText(CsFormatCsv.write(survey));
        w.loading = false;
        SurveyNotebook.refresh(w);
        return;
    }

    // rebuild the ladder rows
    SurveyNotebook.clearLadder(w);
    var names = [];
    var byTo = {};
    if (survey.shots.length > 0) {
        names.push(survey.shots[0].from);
        for (var i = 0; i < survey.shots.length; i++) {
            names.push(survey.shots[i].to);
            byTo[survey.shots[i].to] = survey.shots[i];
        }
    } else {
        names.push("A1");
    }
    for (i = 0; i < names.length; i++) {
        var row = SurveyNotebook.addStationRow(w, names[i]);
        var shot = byTo[names[i]];
        var put = function(edit, v) {
            edit.text = (v === null || v === undefined) ? "" : String(v);
        };
        if (shot !== undefined && i > 0) {
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
        } else if (i === 0 && survey.startLrud) {
            put(row.l, survey.startLrud.left);
            put(row.r, survey.startLrud.right);
            put(row.u, survey.startLrud.up);
            put(row.d, survey.startLrud.down);
        }
        if (i === 0) {
            row.notes.setPlainText(survey.startNote === undefined ||
                survey.startNote === null ? "" : String(survey.startNote));
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
 * record {name, dist, azFs, azBs, incFs, incBs, l, r, u, d}; the
 * first station's shot edits exist but stay hidden, so every record
 * has the same shape.
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
    // Notes are INTENTIONAL: click to write one. Never in the tab
    // order, so flying through measurements can't land here. A small
    // multiline box, tall enough to actually read.
    SurveyNotebook.styleCell(row.notes, 48);
    row.notes.minimumWidth = 170;
    row.notes.maximumHeight = 48;
    try {
        row.notes.focusPolicy = Qt.ClickFocus;
    } catch (eFp) {
        // policy unsupported: it stays out of the setTabOrder chain
        // regardless, which covers the common path
    }
    row.notes.placeholderText = "note...";
    row.notes.toolTip = "Station note -- stored with the survey data " +
        "(and exported as the shot's comment). Click to edit; Tab " +
        "never lands here.";
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
    var order = [rows[0].name];
    if (rows.length > 1) {
        var r1 = rows[1];
        order.push(r1.name, r1.dist, r1.az, r1.inc,
            rows[0].l, rows[0].r, rows[0].u, rows[0].d,
            r1.l, r1.r, r1.u, r1.d);
    }
    for (var i = 2; i < rows.length; i++) {
        var r = rows[i];
        order.push(r.name, r.dist, r.az, r.inc,
            r.l, r.r, r.u, r.d);
    }
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

/** Swaps the ladder for the text sheet (branched imports). */
SurveyNotebook.switchToText = function(w, why) {
    if (w.mode === "text") {
        return;
    }
    w.mode = "text";
    if (w.ladderArea !== undefined) {
        w.ladderArea.visible = false;
    }
    if (w.rowButtonBar !== undefined) {
        w.rowButtonBar.visible = false;
    }
    w.editor.visible = true;
    if (why) {
        EAction.handleUserMessage("Survey Notebook: " + why);
    }
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
        "(no wall, recorded 0); 5/10 = two readings, both drawn.";

    w.mode = SurveyNotebook.ladderSupported() ? "ladder" : "text";

    // ---- the notes page (ladder) --------------------------------------
    if (w.mode === "ladder") {
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

    // ---- the text sheet (fallback / branched surveys) ------------------
    w.editor = new QPlainTextEdit(body);
    w.editor.toolTip = columnHelp;
    w.editor.setPlainText(
        "from,to,distance,azimuth,inclination,left,right,up,down,notes\n");
    layout.addWidget(w.editor, 1, 0);
    w.editor.visible = (w.mode === "text");

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

    if (w.mode === "ladder") {
        w.splitter = new QSplitter(Qt.Vertical);
        w.splitter.addWidget(w.ladderArea);
        w.splitter.addWidget(w.statusLabel);
        try {
            w.splitter.setStretchFactor(0, 4); // the page gets the growth
            w.splitter.setStretchFactor(1, 1);
        } catch (eSf) {
            // cosmetic
        }
        layout.addWidget(w.splitter, 1, 0);
        layout.addWidget(w.rowButtonBar, 0, 0);
    } else {
        layout.addWidget(w.statusLabel, 0, 0);
        w.statusLabel.maximumHeight = 96;
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
    actions.addWidget(w.drawButton, 0, 0);
    actions.addWidget(w.importButton, 0, 0);
    actions.addWidget(w.exportButton, 0, 0);
    actions.addWidget(w.statusButton, 0, 0);
    actions.addWidget(w.clearButton, 0, 0);
    layout.addLayout(actions, 0);

    body.setLayout(layout);
    dock.setWidget(body);

    // ---- wiring ----------------------------------------------------
    if (w.mode === "ladder") {
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
    } else {
        SurveyNotebook.safeConnect(w.editor.textChanged, function() {
            SurveyNotebook.refresh(w);
        }, "live refresh", w.problems);
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
        if (w.mode === "text") {
            w.editor.setPlainText(
                "from,to,distance,azimuth,inclination,left,right,up,down,notes\n");
        } else {
            SurveyNotebook.clearLadder(w);
            SurveyNotebook.addStationRow(w, "A1");
            SurveyNotebook.addStationRow(w, "A2");
        }
        SurveyNotebook.refresh(w);
    }, "Clear button", w.problems);

    // a fresh sheet starts with its first two stations
    if (w.mode === "ladder") {
        SurveyNotebook.addStationRow(w, "A1");
        SurveyNotebook.addStationRow(w, "A2");
    }

    if (w.problems.length > 0) {
        EAction.handleUserWarning("Survey Notebook: this build's script " +
            "bridge refused: " + w.problems.join("; ") +
            " -- those controls are inert; the rest of the panel works.");
    }

    SurveyNotebook.refresh(w);
    return dock;
};

// ---------------------------------------------------------------------
// Tool entry: create the dock once, then toggle it.
// ---------------------------------------------------------------------

SurveyNotebook.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);

    var appWin = RMainWindowQt.getMainWindow();
    try {
        if (csNotebookDock === undefined || csNotebookDock === null) {
            csNotebookDock = SurveyNotebook.buildDock(appWin);
            appWin.addDockWidget(Qt.RightDockWidgetArea, csNotebookDock);
            csNotebookDock.visible = true;
        } else {
            csNotebookDock.visible = !csNotebookDock.visible;
        }
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
};
