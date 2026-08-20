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
    if (survey.name !== "") {
        lines.push("Survey: " + survey.name);
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

/** One line for an IGRF estimate, always labelled as one. */
CsReport.igrfLine = function(result, lat, lon, dateText) {
    return "IGRF estimate for " + dateText + " at " +
        lat.toFixed(4) + ", " + lon.toFixed(4) + ": " +
        CsAngles.formatDeclination(result.declination) +
        " (model accuracy is a fraction of a degree -- fine against any compass)";
};
