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
        lines.push(qsTr("Survey: %1").arg(survey.caveName || survey.name));
    }
    lines.push(qsTr("Stations plotted: %1").arg(drawn.stationsDrawn));
    // Loop closures and control ties are counted apart from ordinary
    // shots by CsDraw, so both have to be named here or the printed
    // total is smaller than the drawing. A tie is not a closure -- it
    // is the single leg joining two separately fixed components -- so
    // it gets its own words. A `drawn` object from before tiesDrawn
    // existed simply says nothing about ties.
    var extraLegs = [];
    if (drawn.closuresDrawn > 0) {
        extraLegs.push((drawn.closuresDrawn === 1 ? qsTr("%1 loop closure") :
            qsTr("%1 loop closures")).arg(drawn.closuresDrawn));
    }
    if (drawn.tiesDrawn !== undefined && drawn.tiesDrawn > 0) {
        extraLegs.push((drawn.tiesDrawn === 1 ? qsTr("%1 control tie") :
            qsTr("%1 control ties")).arg(drawn.tiesDrawn));
    }
    lines.push(qsTr("Shots drawn: %1").arg(drawn.shotsDrawn) +
        (extraLegs.length > 0 ? (" (+" + extraLegs.join(", ") + ")") : ""));
    if (drawn.wallsDrawn !== undefined && drawn.wallsDrawn > 0) {
        lines.push(qsTr("Wall runs drawn: %1" +
            " (dashed = approximate; trace real walls over them)")
            .arg(drawn.wallsDrawn));
    }
    if (drawn.splaysDrawn !== undefined && drawn.splaysDrawn > 0) {
        lines.push(qsTr("Splays drawn: %1 (thin rays on CTRL-SPLAYS)")
            .arg(drawn.splaysDrawn));
    }
    // Named apart from the generic "Skipped" line below: that one
    // means excluded or never-connected, but an unmeasurable splay's
    // OWN station did connect -- the gap is that nobody recorded a
    // distance or a reading for the splay itself. Conflating the two
    // would tell a surveyor to go check a connection that is fine.
    if (drawn.splaysSkipped !== undefined && drawn.splaysSkipped > 0) {
        lines.push(qsTr("Splays not drawn: %1" +
            " (no distance, or no azimuth/inclination, on record)")
            .arg(drawn.splaysSkipped));
    }
    if (drawn.wallPointsSkipped !== undefined && drawn.wallPointsSkipped > 0) {
        lines.push(qsTr("Wall points skipped: %1" +
            " (splay had no distance, or no azimuth/inclination, on record)")
            .arg(drawn.wallPointsSkipped));
    }
    if (drawn.skipped > 0) {
        lines.push(qsTr("Skipped: %1" +
            " (excluded shots, or shots that never connected)")
            .arg(drawn.skipped));
    }
    // The AUTOMATIC profile pass's own outcome, folded into the ordinary
    // draw summary every production caller already shows -- without
    // this, CsReport.profileSummary (which says the identical thing in
    // the identical words) is only ever read by the MANUAL GenerateProfile
    // tool, so a plan draw that skipped the profile for size, a
    // ProfileAuto switched off, an unsaved drawing, or a profile pass
    // that threw, never told the user anything at all: `drawn.profile`
    // was a real field on CsDraw.survey's return value that nothing
    // shipped ever read. Same wording as profileSummary's own skip line
    // so the two paths never describe the same event two different ways.
    if (drawn.profile !== undefined && drawn.profile !== null &&
            drawn.profile.skipped) {
        lines.push(qsTr("Profile: not written -- %1.")
            .arg(drawn.profile.reason));
    }
    // THE SAME DEFECT, TWICE MORE. `drawn.elevations` was a real field
    // on CsDraw.survey's return that nothing shipped ever read -- a
    // spot elevation whose leg had vanished was counted `lost` and the
    // count went nowhere. `drawn.sections` arrived with the cross
    // sections and would have gone the same way. Both are printed here,
    // and only when there is something to say: a draw that re-derived
    // nothing stays quiet.
    var elevLine = CsReport.refreshLine(qsTr("Elevation labels"),
        drawn.elevations, ["updated", "upgraded", "downgraded", "lost"]);
    if (elevLine !== null) {
        lines.push(elevLine);
    }
    var sectionLine = CsReport.refreshLine(qsTr("Cross sections"),
        drawn.sections, ["updated", "frozen", "lost", "refused"]);
    if (sectionLine !== null) {
        lines.push(sectionLine);
    }
    // Scans that followed the survey -- or could not. A scan left
    // behind by a correction is exactly the kind of stale thing that
    // reaches a plotted map unnoticed.
    var scanLine = CsReport.refreshLine(qsTr("Aligned scans"), drawn.scans,
        ["moved", "stale", "refused", "backfilled"]);
    if (scanLine !== null) {
        lines.push(scanLine);
    }

    if (survey.declination !== 0 && survey.declinationSource !== "") {
        var srcWord = { file: qsTr("from the file"),
            user: qsTr("entered by hand"),
            igrf: qsTr("IGRF estimate") }[survey.declinationSource] ||
            survey.declinationSource;
        lines.push(qsTr("Declination applied: %1 (%2)")
            .arg(CsAngles.formatDeclination(survey.declination))
            .arg(srcWord));
    }

    for (var i = 0; i < resolved.loops.length; i++) {
        var loop = resolved.loops[i];
        lines.push((loop.percent <= 1.0 ?
            qsTr("Loop %1 to %2: closes %3 off over %4 surveyed (%5%)" +
                " -- good [horizontal %6, vertical %7]") :
            qsTr("Loop %1 to %2: closes %3 off over %4 surveyed (%5%)" +
                " [horizontal %6, vertical %7]"))
            .arg(loop.from).arg(loop.to)
            .arg(loop.error.toFixed(2))
            .arg(loop.traverseLength.toFixed(1))
            .arg(loop.percent.toFixed(2))
            .arg(loop.horizontal.toFixed(2))
            .arg(loop.vertical.toFixed(2)));
    }

    // A control tie is not a loop: it is the single leg joining two
    // separately fixed components, with no ring to quote a percentage
    // of. CsNetwork sets `percent: null` on every tie for exactly that
    // reason, so this block must never call .toFixed() on it -- only
    // `error`, `horizontal` and `vertical`, which are always real
    // numbers here.
    var ties = resolved.ties || [];
    for (i = 0; i < ties.length; i++) {
        var tieItem = ties[i];
        lines.push(qsTr("Control tie %1 to %2: %3 between fixed points " +
            "[horizontal %4, vertical %5]")
            .arg(tieItem.from).arg(tieItem.to)
            .arg(tieItem.error.toFixed(2))
            .arg(tieItem.horizontal.toFixed(2))
            .arg(tieItem.vertical.toFixed(2)));
    }

    // What the adjustment did -- or plainly that none was made, so a
    // reader is never left guessing which centreline they are looking
    // at. `resolved.adjusted` is `undefined` on a plain
    // CsNetwork.resolve() result (never adjusted at all) and `false`
    // on a CsAdjust.unadjusted() pass-through (switched off, or a
    // solve that didn't converge); both must fall into the same
    // "not adjusted" wording, not just the exact boolean false.
    if (resolved.adjusted === true) {
        var sum = resolved.summary;
        if (sum.movedCount > 0) {
            lines.push(qsTr("Adjusted by least squares: %1" +
                " moved, most of all %2 at %3 (%4).")
                .arg((sum.movedCount === 1 ? qsTr("%1 station") :
                    qsTr("%1 stations")).arg(sum.movedCount))
                .arg(sum.worstStation)
                .arg(CsReport.length(sum.worstShift, survey.distanceUnit))
                .arg((sum.iterations === 1 ? qsTr("%1 iteration") :
                    qsTr("%1 iterations")).arg(sum.iterations)));
        } else if (sum.stationCount > 0) {
            lines.push(qsTr("Adjusted by least squares: nothing moved -- " +
                "the survey already closes within tolerance."));
        }
        if (sum.stationCount > 0) {
            lines.push(qsTr("The as-surveyed centreline is on layer " +
                "CTRL-RAW, switched off -- turn it on to see exactly " +
                "what moved."));
        }
        lines.push(qsTr("Held fixed: %1").arg(sum.pinned.length > 0 ?
            sum.pinned.join(", ") : qsTr("nothing")));
    } else if (resolved.summary !== undefined && resolved.summary !== null &&
            resolved.summary.warning !== undefined) {
        // A half-solved network is worse than an unsolved one, because
        // it LOOKS adjusted -- CsAdjust already refused to hand back
        // coordinates in this case, and this warning is its own words,
        // verbatim, not a paraphrase.
        lines.push("");
        lines.push(qsTr("WARNING -- %1").arg(resolved.summary.warning));
    } else if (resolved.loops.length > 0 && ties.length > 0) {
        lines.push(qsTr("Not adjusted: the misclosures above are still " +
            "as surveyed."));
    } else if (resolved.loops.length > 0) {
        lines.push(qsTr("Not adjusted: the misclosure is still on the " +
            "closing leg, as surveyed."));
    } else if (ties.length > 0) {
        lines.push(qsTr("Not adjusted: the gap against fixed control is " +
            "still as surveyed."));
    }

    // Task 1b: when an explicit anchor and *fix control shared a
    // station, resolve() may have translated OTHER fixed stations
    // into the anchor's frame (see CsNetwork.resolve's controlFrame),
    // or -- when it had nothing to translate them WITH -- left them
    // for ordinary traversal and named them instead of silently
    // dropping their control. Either way, say so once, in drawing
    // units, so a beginner reading the summary knows their fixed
    // points either moved on paper (not in the real world) or weren't
    // used at all.
    var cf = resolved.controlFrame;
    if (cf !== undefined && cf !== null) {
        var unit = survey.distanceUnit;
        if (cf.offset !== null && cf.applied.length > 0) {
            var planShift = Math.sqrt(cf.offset.dx * cf.offset.dx +
                cf.offset.dy * cf.offset.dy);
            // %3 is always present: a surplus .arg() logs a warning
            var dzText = cf.offset.dz === 0 ? "" :
                CsReport.length(Math.abs(cf.offset.dz), unit);
            lines.push((cf.offset.dz === 0 ?
                qsTr("Fixed control %1 shifted %2 in plan%3" +
                    " to line up with the anchor -- the survey's shape " +
                    "didn't change, only where it's drawn.") :
                cf.offset.dz > 0 ?
                qsTr("Fixed control %1 shifted %2 in plan and %3 up" +
                    " to line up with the anchor -- the survey's shape " +
                    "didn't change, only where it's drawn.") :
                qsTr("Fixed control %1 shifted %2 in plan and %3 down" +
                    " to line up with the anchor -- the survey's shape " +
                    "didn't change, only where it's drawn."))
                .arg(cf.applied.join(", "))
                .arg(CsReport.length(planShift, unit))
                .arg(dzText));
        }
        if (cf.notHonored.length > 0) {
            lines.push("");
            lines.push(qsTr("WARNING -- fixed control not used for %1: %2.")
                .arg(cf.notHonored.join(", ")).arg(cf.reason));
        }
    }

    if (resolved.unresolved.length > 0) {
        lines.push("");
        lines.push(qsTr("WARNING -- %1 shot(s) never connected " +
            "(check station names):").arg(resolved.unresolved.length));
        for (i = 0; i < resolved.unresolved.length; i++) {
            var u = resolved.unresolved[i];
            lines.push("  " + u.from + " -> " + u.to);
        }
    }

    if (findings !== undefined && findings !== null && findings.length > 0) {
        lines.push("");
        lines.push(qsTr("Checks (advisory -- your notes are the authority):"));
        for (i = 0; i < findings.length; i++) {
            lines.push("  " + findings[i].severity.toUpperCase() + ": " +
                findings[i].message);
        }
    }

    return lines.join("\n");
};

/** Summary block for Survey Stats. */
/**
 * One line for a refresh pass's counts, or null when it did nothing
 * worth saying.
 *
 * `frozen`, `lost` and `refused` are the ones that MATTER: a stale
 * section on a plotted map is the failure the whole refresh exists to
 * prevent, so a count of them is never swallowed.
 *
 * \param counts an object of name -> number, or null
 * \param keys   which counts to report, in the order to report them
 */
CsReport.refreshLine = function(label, counts, keys) {
    if (counts === undefined || counts === null) {
        return null;
    }
    var words = {
        moved: qsTr("re-fitted to the moved survey"),
        matched: qsTr("already in place"),
        backfilled: qsTr("given anchors for the first time"),
        updated: qsTr("re-derived"), upgraded: qsTr("upgraded"),
        downgraded: qsTr("downgraded"), unchanged: qsTr("unchanged"),
        frozen: qsTr("frozen"), lost: qsTr("whose basis is gone"),
        refused: qsTr("no longer cuttable")
    };
    var parts = [];
    for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var n = counts[k];
        if (n === undefined || n === null || n === 0) {
            continue;
        }
        parts.push(n + " " + (words[k] || k));
    }
    if (parts.length === 0) {
        return null;
    }
    return label + ": " + parts.join(", ") + ".";
};

CsReport.statsSummary = function(survey, stats, grade) {
    var unit = survey.distanceUnit;
    var lines = [];
    lines.push(qsTr("Surveyed length: %1  (plan: %2)")
        .arg(CsReport.length(stats.surveyedLength, unit))
        .arg(CsReport.length(stats.planLength, unit)));
    lines.push(qsTr("Vertical extent: %1").arg(CsReport.length(stats.depth, unit)) +
        (stats.depth > 0 ? "  " + qsTr("(%1 lowest, %2 highest)")
            .arg(stats.lowest).arg(stats.highest) : ""));
    lines.push(qsTr("Stations: %1   Shots: %2   Loops: %3")
        .arg(stats.stationCount).arg(stats.shotCount).arg(stats.loopCount));
    if (stats.worstLoop !== null) {
        lines.push(qsTr("Worst loop closure: %1% (%2 to %3, horizontal %4, " +
            "vertical %5)")
            .arg(stats.worstLoop.percent.toFixed(2))
            .arg(stats.worstLoop.from).arg(stats.worstLoop.to)
            .arg(stats.worstLoop.horizontal.toFixed(2))
            .arg(stats.worstLoop.vertical.toFixed(2)));
    }
    lines.push("");
    lines.push(qsTr("Centreline grade: %1").arg(grade.centrelineText));
    lines.push(qsTr("Detail grade: %1").arg(grade.detailText));
    lines.push(qsTr("Sheet designation: %1").arg(grade.uis));
    for (var i = 0; i < grade.notes.length; i++) {
        lines.push(qsTr("Note: %1").arg(grade.notes[i]));
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
        lines.push(qsTr("Revision applied as one rigid move: the whole drawing " +
            "turned and shifted as a single body, hand-drawn linework " +
            "included."));
    } else {
        lines.push(qsTr("Revision changed the survey's shape: the survey marks " +
            "were erased and redrawn from the revised data."));
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
            lines.push(qsTr("Anchor station: %1 -- it held still " +
                "because it is the georeferenced station, the drawing's " +
                "one tie to real-world coordinates.").arg(au.name));
        } else if (au.source === "stale") {
            lines.push("");
            lines.push(qsTr("WARNING -- anchor station %1" +
                " could not be found in the drawing; its last known " +
                "position was used instead.").arg(au.name));
        } else {
            lines.push(qsTr("Anchor station: %1 (trip 0's anchor).")
                .arg(au.name));
        }

        if (report.anchorMoved !== undefined && report.anchorMoved !== null) {
            var dx = report.anchorMoved.dx, dy = report.anchorMoved.dy;
            var hasOffset = dx !== undefined && dx !== null &&
                dy !== undefined && dy !== null;
            var offset = hasOffset ? Math.sqrt(dx * dx + dy * dy) : null;
            lines.push(qsTr("Anchor station %1 had been moved%2" +
                " since the survey was last read from the drawing; the " +
                "revision followed its current position -- the drawing " +
                "is the truth.").arg(au.name)
                .arg(offset !== null ? " " + offset.toFixed(2) : ""));
        }
    }

    lines.push(qsTr("Stations moved: %1").arg(report.stationsChanged));
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
        lines.push((after.percent <= 1.0 ?
            qsTr("Loop %1 to %2: closes %3%4 off (%5%) -- good") :
            qsTr("Loop %1 to %2: closes %3%4 off (%5%)"))
            .arg(after.from).arg(after.to)
            .arg(before !== null ? before.error.toFixed(2) + " -> " : "")
            .arg(after.error.toFixed(2))
            .arg(after.percent.toFixed(2)));
    }

    if (!report.rigid) {
        // One vocabulary for the linework outcome, spoken by whoever
        // moved the linework: CsRevise. The notebook's Draw says the
        // same sentences from the same function with no report object
        // in hand, so the two revision paths cannot drift apart.
        // Missing fields are handled there -- absent reads as
        // "nothing bound" -- so hand them over as they are.
        var linework = CsRevise.lineworkSummary(report.lineworkMoved,
            report.lineworkUnmoved, report.lineworkBound, undefined,
            report.lineworkWarped);
        for (i = 0; i < linework.length; i++) {
            lines.push(linework[i]);
        }
    }

    // The profile pass's own outcome -- present only when CsRevise.apply
    // actually called CsDraw.survey (the non-rigid path; see that
    // function's own profileOutcome declaration). Same field, same
    // wording as CsReport.drawSummary's identical block, so a profile
    // skipped for size, for ProfileAuto being off, for an unsaved
    // drawing, or because the pass threw, reads the same words whether
    // it happened on an import, a notebook Draw, or "Revise a trip" --
    // this feature's own flagship workflow, which used to say nothing
    // about it at all (CsRevise.apply discarded CsDraw.survey's return
    // value outright). Silent on a SUCCESSFUL profile pass, matching
    // drawSummary's own convention -- the manual GenerateProfile command
    // is where the full counts/findings report lives (CsReport.
    // profileSummary); this is only the "something you expected did not
    // happen" channel.
    if (report.profile !== undefined && report.profile !== null &&
            report.profile.skipped) {
        lines.push(qsTr("Profile: not written -- %1.")
            .arg(report.profile.reason));
    }
    return lines.join("\n");
};

/** One line for an IGRF estimate, always labelled as one. */
CsReport.igrfLine = function(result, lat, lon, dateText) {
    return qsTr("IGRF estimate for %1 at %2, %3: %4" +
        " (model accuracy is a fraction of a degree -- fine against any compass)")
        .arg(dateText).arg(lat.toFixed(4)).arg(lon.toFixed(4))
        .arg(CsAngles.formatDeclination(result.declination));
};

/**
 * What the extended elevation drew, and what it could not show.
 *
 * The findings half is the point: a profile that quietly dropped a
 * side lead, drew a spur at the wrong junction, or skipped an
 * unmeasurable splay looks exactly like a complete one. EVERY field of
 * CsProfile.build's `findings` is named here, not just the ones an
 * acceptance checklist happened to enumerate -- an omission in this
 * function is exactly the silent-gap failure mode the whole feature
 * exists to avoid.
 *
 * orphans and strandedRoots read DIFFERENTLY on purpose: an orphan
 * means a tie shot is genuinely missing (go shoot one); a strandedRoot
 * means the data is fine and the band simply starts its own stack.
 * Wording them the same would send someone hunting for a shot that
 * already exists.
 *
 * outcome.counts.linework and .claimed are named here too, for the
 * identical reason: CsProfileDraw.render folds a caught binding/move
 * exception into exactly those two fields, and a field this function
 * never reads is a field the user never hears about no matter how
 * loudly the code underneath it screams.
 *
 * outcome.counts.stationsMoved distinguishes the two reasons
 * c.linework.moved can read 0: nothing existed to move yet (a first-
 * ever profile, or an idempotent redraw of an unchanged one -- render's
 * own positionsMoved guard runs on EVERY draw, automatic or manual,
 * unlike the plan side's revision-only callers of lineworkSummary), or
 * stations genuinely moved and bound linework failed to follow. Only
 * the second is a real warning; passing stationsMoved through to
 * CsRevise.lineworkSummary is what tells them apart instead of warning
 * "your tracing did not move with the survey" on every clean run of a
 * feature that draws on every plan draw (CRITICAL 1 in this feature's
 * review history).
 *
 * \param profile CsProfile.build() result, or null when nothing was built
 * \param outcome CsDraw.profile() result: {skipped, reason} or
 *                {counts, profile}
 */
CsReport.profileSummary = function(profile, outcome) {
    var lines = [];
    if (outcome !== undefined && outcome !== null && outcome.skipped) {
        lines.push(qsTr("Profile: not written -- %1.").arg(outcome.reason));
        return lines.join("\n");
    }
    if (profile === null || profile === undefined) {
        return qsTr("Profile: nothing to draw.");
    }

    var c = (outcome && outcome.counts) ? outcome.counts : {};
    // "in this drawing", not a file name: the elevation is a REGION of
    // the drawing the user is looking at now, not a sibling file they
    // would have to go and open. Naming a path here again would send a
    // reader looking for a file that no longer exists.
    lines.push(qsTr("Profile drawn in this drawing, below the plan"));
    lines.push("  " + qsTr("%1 band(s), %2 leg(s), %3 station(s)")
        .arg(c.bandsDrawn || 0).arg(c.legsDrawn || 0)
        .arg(c.stationsDrawn || 0));
    lines.push("  " + qsTr("%1 ceiling run(s), %2 floor run(s), " +
        "%3 level splay tick(s)")
        .arg(c.ceilingRuns || 0).arg(c.floorRuns || 0)
        .arg(c.flatTicks || 0));
    // level splays are counted, not hidden: a splay inside the dead
    // zone contributed nothing to either line, and a reader who cannot
    // see how many there were cannot judge whether the dead zone is
    // set sensibly for this cave

    // The linework outcome -- moved/unmoved traced sketch, and how many
    // previously untagged sketches this run bound to the survey itself
    // -- reaches the user through the exact same words CsRevise.
    // lineworkSummary already gives the PLAN side (see
    // CsReport.revisionSummary above): one vocabulary for "did my
    // tracing follow the revision", not two. CsProfileDraw.render
    // ALWAYS sets c.linework/c.claimed on a real counts object (even
    // when claim()/moveLinework threw -- see that function's own
    // \return docblock), so their absence here means this outcome was
    // never handed a counts object at all, which already returned
    // above ({skipped: ...} or profile === null) -- not a legitimate
    // "nothing to report" state reached from here.
    //
    // c.claimed.tagged IS the "bound" count lineworkSummary expects,
    // not merely A SUBSET of it the way CsRevise.apply's own
    // lineworkBound is on the plan side: every tag CsProfileBind.claim
    // writes is brand new (a profile drawing has no prior-tagged
    // linework concept the way a revised plan does), so there is no
    // larger "already bound" total to carve this one out of.
    if (c.linework !== undefined) {
        var pLines = CsRevise.lineworkSummary(c.linework.moved,
            c.linework.unmoved, c.claimed ? c.claimed.tagged : 0,
            c.stationsMoved, c.linework.warped);
        for (var pi = 0; pi < pLines.length; pi++) {
            // Not "  " + pLines[pi] unconditionally: lineworkSummary
            // inserts a deliberate BLANK line as a separator before its
            // own WARNING blocks, and prefixing that blank line here
            // turned it into a two-space trailing-whitespace line in
            // the dialog -- invisible, but not actually blank.
            lines.push(pLines[pi] === "" ? "" : "  " + pLines[pi]);
        }
    }
    // A THROWN exception is a different claim from "this sketch simply
    // has no station to follow": lineworkSummary's own WARNING above
    // already surfaces a caught "move failed:" entry (CsProfileDraw.
    // render folds it into c.linework.unmoved), but a binding failure
    // inside claim()/positions() itself has nowhere else to go --
    // c.claimed.error is set instead of c.claimed.tagged/skipped ever
    // being reached at all, and a caught exception that reaches no one
    // is worse than a crash that at least stops the show.
    if (c.claimed && c.claimed.error) {
        lines.push("  " + qsTr("WARNING -- binding traced linework to the survey " +
            "failed, so nothing was claimed or moved for it this run: %1")
            .arg(c.claimed.error));
    }

    var f = profile.findings;
    var i;
    if (f.mismatches.length > 0) {
        for (i = 0; i < f.mismatches.length; i++) {
            lines.push("  " + qsTr("CHECK the name: run %1" +
                " reads as a spur of %2 but ties in at %3" +
                " -- drawn at the surveyed junction")
                .arg(f.mismatches[i].run).arg(f.mismatches[i].expected)
                .arg(f.mismatches[i].actual));
        }
    }
    if (f.omitted.length > 0) {
        lines.push("  " + qsTr("off the main chain, not drawn: %1")
            .arg(f.omitted.join(", ")));
    }
    if (f.secondTies.length > 0) {
        for (i = 0; i < f.secondTies.length; i++) {
            lines.push("  " + qsTr("run %1 also touches %2" +
                " (drawn as a tie line, not a second band)")
                .arg(f.secondTies[i].run).arg(f.secondTies[i].otherStation));
        }
    }
    if (f.orphans.length > 0) {
        // Disconnected means exactly that: no leg of any kind reaches
        // the rest of the cave. This one IS actionable -- a connecting
        // shot is missing.
        lines.push("  " + qsTr("no connection to the rest of the survey, a tie " +
            "shot is missing: %1").arg(f.orphans.join(", ")));
    }
    if (f.strandedRoots !== undefined && f.strandedRoots.length > 0) {
        // Connected, but not attached as anyone's child. The data is
        // fine and nothing needs surveying -- the band simply starts its
        // own stack. Saying "no connection" here would send someone
        // hunting for a shot that already exists.
        lines.push("  " + qsTr("connected, but drawn as its own band rather than " +
            "hanging off another: %1").arg(f.strandedRoots.join(", ")));
    }
    if (f.stopped.length > 0) {
        // stoppedReason distinguishes THREE causes, not two -- collapsing
        // "unmeasurable" into "no resolved elevation" would send a
        // surveyor to re-check a station's depth gauge when the actual
        // gap is a shot with no usable distance/azimuth/inclination on
        // record (CsProfile.unrollBand's own "no-z"/"no-leg"/
        // "unmeasurable" split, see its docblock).
        for (i = 0; i < f.stopped.length; i++) {
            var st = f.stopped[i];
            var why;
            if (st.reason === "no-leg") {
                why = qsTr("no leg reaches it");
            } else if (st.reason === "unmeasurable") {
                why = qsTr("the leg to it has no usable distance, azimuth " +
                    "or inclination on record");
            } else {
                // "no-z", and any future reason this function does not
                // yet know the name of -- silence here would be worse
                // than a slightly generic label
                why = qsTr("no resolved elevation");
            }
            lines.push("  " + qsTr("band stopped at %1: %2")
                .arg(st.station).arg(why));
        }
    }
    if (f.ungrouped.length > 0) {
        lines.push("  " + qsTr("station names that could not be read as a run: %1")
            .arg(f.ungrouped.join(", ")));
    }
    if (f.wallPointsSkipped !== undefined && f.wallPointsSkipped > 0) {
        lines.push("  " + qsTr("%1 splay wall point(s) " +
            "skipped (no usable distance, or no azimuth/inclination, " +
            "on record)").arg(f.wallPointsSkipped));
    }
    if (f.undrawn !== undefined && f.undrawn.length > 0) {
        // Every leg CsNetwork.resolve() produced is either drawn in a
        // band above or named here with why -- see CsProfile.build's
        // own C2 docblock. Grouped by reason (in first-appearance
        // order, so this never depends on this engine's object-key
        // enumeration order, unlike a for-in walk would) rather than
        // naming each leg individually: a survey with many ordinary
        // loop closures would otherwise bury the findings that ARE
        // worth a look under a list of the ones that are not.
        var byReason = {}, reasonOrder = [];
        for (i = 0; i < f.undrawn.length; i++) {
            var urKey = f.undrawn[i].reason;
            if (!byReason.hasOwnProperty(urKey)) {
                byReason[urKey] = 0;
                reasonOrder.push(urKey);
            }
            byReason[urKey]++;
        }
        var undrawnParts = [];
        for (var ro = 0; ro < reasonOrder.length; ro++) {
            undrawnParts.push(byReason[reasonOrder[ro]] + " " +
                reasonOrder[ro]);
        }
        lines.push("  " + qsTr("legs not drawn on any band (%1): %2")
            .arg(f.undrawn.length).arg(undrawnParts.join(", ")));
    }
    return lines.join("\n");
};
