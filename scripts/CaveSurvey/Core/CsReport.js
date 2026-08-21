// Report.js -- plain-language summaries.
//
// Part of the Cave Survey Core library: pure string building. Every
// tool ends by saying what it did, in drawing units, in sentences a
// beginner understands -- these builders keep that voice consistent.

var CsReport = {};

/** "148.2 ft" with sensible precision. */
CsReport.length = function(value, unit) {
    var precision = value >= 100 ? 1 : 2;
    return value.toFixed(precision) + " " + unit;
};

/** Summary of an import or a notebook draw. */
CsReport.drawSummary = function(survey, resolved, drawn, findings) {
    var lines = [];
    // Prefer the drawing-level cave name over the trip name -- it's
    // the more meaningful label when both are present.
    if (survey.caveName || survey.name) {
        lines.push("Survey: " + (survey.caveName || survey.name));
    }
    lines.push("Stations plotted: " + drawn.stationsDrawn);
    lines.push("Shots drawn: " + drawn.shotsDrawn +
        (drawn.closuresDrawn > 0 ?
            (" (+" + drawn.closuresDrawn + " loop closure" +
                (drawn.closuresDrawn === 1 ? "" : "s") + ")") : ""));
    if (drawn.wallsDrawn !== undefined && drawn.wallsDrawn > 0) {
        lines.push("Wall runs drawn: " + drawn.wallsDrawn +
            " (dashed = approximate; trace real walls over them)");
    }
    if (drawn.splaysDrawn !== undefined && drawn.splaysDrawn > 0) {
        lines.push("Splays drawn: " + drawn.splaysDrawn +
            " (thin rays on CTRL-SPLAYS)");
    }
    if (drawn.skipped > 0) {
        lines.push("Skipped: " + drawn.skipped +
            " (excluded shots, or shots that never connected)");
    }
    if (survey.declination !== 0 && survey.declinationSource !== "") {
        var srcWord = { file: "from the file", user: "entered by hand",
            igrf: "IGRF estimate" }[survey.declinationSource] ||
            survey.declinationSource;
        lines.push("Declination applied: " +
            CsAngles.formatDeclination(survey.declination) +
            " (" + srcWord + ")");
    }

    for (var i = 0; i < resolved.loops.length; i++) {
        var loop = resolved.loops[i];
        lines.push("Loop " + loop.from + " to " + loop.to + ": closes " +
            loop.error.toFixed(2) + " off over " +
            loop.traverseLength.toFixed(1) + " surveyed (" +
            loop.percent.toFixed(2) + "%)" +
            (loop.percent <= 1.0 ? " -- good" : ""));
    }

    if (resolved.unresolved.length > 0) {
        lines.push("");
        lines.push("WARNING -- " + resolved.unresolved.length +
            " shot(s) never connected (check station names):");
        for (i = 0; i < resolved.unresolved.length; i++) {
            var u = resolved.unresolved[i];
            lines.push("  " + u.from + " -> " + u.to);
        }
    }

    if (findings !== undefined && findings !== null && findings.length > 0) {
        lines.push("");
        lines.push("Checks (advisory -- your notes are the authority):");
        for (i = 0; i < findings.length; i++) {
            lines.push("  " + findings[i].severity.toUpperCase() + ": " +
                findings[i].message);
        }
    }

    return lines.join("\n");
};

/** Summary block for Survey Stats. */
CsReport.statsSummary = function(survey, stats, grade) {
    var unit = survey.distanceUnit;
    var lines = [];
    lines.push("Surveyed length: " + CsReport.length(stats.surveyedLength, unit) +
        "  (plan: " + CsReport.length(stats.planLength, unit) + ")");
    lines.push("Vertical extent: " + CsReport.length(stats.depth, unit) +
        (stats.depth > 0 ? "  (" + stats.lowest + " lowest, " +
            stats.highest + " highest)" : ""));
    lines.push("Stations: " + stats.stationCount + "   Shots: " + stats.shotCount +
        "   Loops: " + stats.loopCount);
    if (stats.worstLoop !== null) {
        lines.push("Worst loop closure: " + stats.worstLoop.percent.toFixed(2) +
            "% (" + stats.worstLoop.from + " to " + stats.worstLoop.to + ")");
    }
    lines.push("");
    lines.push("Centreline grade: " + grade.centrelineText);
    lines.push("Detail grade: " + grade.detailText);
    lines.push("Sheet designation: " + grade.uis);
    for (var i = 0; i < grade.notes.length; i++) {
        lines.push("Note: " + grade.notes[i]);
    }
    return lines.join("\n");
};

// How many unmoved traced items a revision summary names before it
// says "and N more". Lives with the other report-shaping numbers, and
// is read by CsRevise.lineworkSummary, which does the naming.
CsReport.UNMOVED_SHOWN = 8;

/** Summary of an applied revision (CsRevise.apply's report). */
CsReport.revisionSummary = function(report) {
    var lines = [];
    if (report.rigid) {
        lines.push("Revision applied as one rigid move: the whole drawing " +
            "turned and shifted as a single body, hand-drawn linework " +
            "included.");
    } else {
        lines.push("Revision changed the survey's shape: the survey marks " +
            "were erased and redrawn from the revised data.");
    }

    // Name the station the revision held fixed -- it decides what
    // "the drawing rotated" even means geometrically -- and flag a
    // dragged anchor separately: that's a silent change nobody asked
    // for, and worth a line even though it isn't an error. Both fields
    // are absent on reports from older callers, so say nothing rather
    // than print "undefined".
    if (report.anchorUsed !== undefined && report.anchorUsed !== null) {
        var au = report.anchorUsed;
        if (au.source === "georef") {
            lines.push("Anchor station: " + au.name + " -- it held still " +
                "because it is the georeferenced station, the drawing's " +
                "one tie to real-world coordinates.");
        } else if (au.source === "stale") {
            lines.push("");
            lines.push("WARNING -- anchor station " + au.name +
                " could not be found in the drawing; its last known " +
                "position was used instead.");
        } else {
            lines.push("Anchor station: " + au.name + " (trip 0's anchor).");
        }

        if (report.anchorMoved !== undefined && report.anchorMoved !== null) {
            var dx = report.anchorMoved.dx, dy = report.anchorMoved.dy;
            var hasOffset = dx !== undefined && dx !== null &&
                dy !== undefined && dy !== null;
            var offset = hasOffset ? Math.sqrt(dx * dx + dy * dy) : null;
            lines.push("Anchor station " + au.name + " had been moved" +
                (offset !== null ? " " + offset.toFixed(2) : "") +
                " since the survey was last read from the drawing; the " +
                "revision followed its current position -- the drawing " +
                "is the truth.");
        }
    }

    lines.push("Stations moved: " + report.stationsChanged);
    var top = Math.min(5, report.moved.length);
    for (var i = 0; i < top; i++) {
        lines.push("  " + report.moved[i].name + ": " +
            report.moved[i].dist.toFixed(2));
    }

    for (i = 0; i < report.loopsAfter.length; i++) {
        var after = report.loopsAfter[i];
        var before = null;
        for (var j = 0; j < report.loopsBefore.length; j++) {
            if (report.loopsBefore[j].from === after.from &&
                    report.loopsBefore[j].to === after.to) {
                before = report.loopsBefore[j];
                break;
            }
        }
        lines.push("Loop " + after.from + " to " + after.to + ": closes " +
            (before !== null ? before.error.toFixed(2) + " -> " : "") +
            after.error.toFixed(2) + " off (" +
            after.percent.toFixed(2) + "%)" +
            (after.percent <= 1.0 ? " -- good" : ""));
    }

    if (!report.rigid) {
        // One vocabulary for the linework outcome, spoken by whoever
        // moved the linework: CsRevise. The notebook's Draw says the
        // same sentences from the same function with no report object
        // in hand, so the two revision paths cannot drift apart.
        // Missing fields are handled there -- absent reads as
        // "nothing bound" -- so hand them over as they are.
        var linework = CsRevise.lineworkSummary(report.lineworkMoved,
            report.lineworkUnmoved, report.lineworkBound);
        for (i = 0; i < linework.length; i++) {
            lines.push(linework[i]);
        }
    }
    return lines.join("\n");
};

/** One line for an IGRF estimate, always labelled as one. */
CsReport.igrfLine = function(result, lat, lon, dateText) {
    return "IGRF estimate for " + dateText + " at " +
        lat.toFixed(4) + ", " + lon.toFixed(4) + ": " +
        CsAngles.formatDeclination(result.declination) +
        " (model accuracy is a fraction of a degree -- fine against any compass)";
};
