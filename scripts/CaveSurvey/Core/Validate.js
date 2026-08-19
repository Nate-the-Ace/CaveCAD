// Validate.js -- blunder hunting: the mistakes that stop a beginner's
// first survey from closing.
//
// Part of the Cave Survey Core library: pure functions.
//
// Every finding is ADVISORY. The surveyor is the authority on their
// own notes; these are flags, not gates, and the Notebook shows them
// beside the row without blocking entry. Each finding:
//
//   { severity: "error" | "warning",
//     shotIndex: index into survey.shots, or -1 for survey-wide,
//     code: short machine tag,
//     message: one plain-language sentence }
//
// "error" = the data cannot be drawn as given (bad number, self
// loop). "warning" = drawable but suspicious (probable backsight,
// duplicate disagreeing shot, big misclosure).

var CsValidate = {};

CsValidate.CLOSURE_WARN_PERCENT = 2.0; // BCRA grade 3 expects 1-5%

/** True when any finding is an error (vs merely a warning). */
CsValidate.checkHasErrors = function(findings) {
    for (var i = 0; i < findings.length; i++) {
        if (findings[i].severity === "error") {
            return true;
        }
    }
    return false;
};

/** Runs every check. resolved (from CsNetwork) is optional. */
CsValidate.check = function(survey, resolved) {
    var findings = [];
    var shots = survey.shots;
    var i, j, s;

    var pairKey = function(a, b) {
        return a < b ? a + " " + b : b + " " + a;
    };
    var byPair = {};

    for (i = 0; i < shots.length; i++) {
        s = shots[i];
        if (s.excludeFromAll) {
            continue;
        }

        // ---- field sanity ----------------------------------------
        if (!s.splay && s.from !== "" && s.from === s.to) {
            findings.push({ severity: "error", shotIndex: i, code: "self-loop",
                message: "Shot goes from " + s.from + " to itself." });
        }
        if (!(s.distance > 0)) {
            findings.push({ severity: "error", shotIndex: i, code: "bad-distance",
                message: "Distance must be a positive number." });
        }
        if (s.azimuth < 0 || s.azimuth >= 360) {
            findings.push({ severity: "warning", shotIndex: i, code: "azimuth-range",
                message: "Azimuth " + s.azimuth + " is outside 0-360 and will be wrapped." });
        }
        if (s.inclination < -90 || s.inclination > 90) {
            findings.push({ severity: "error", shotIndex: i, code: "inclination-range",
                message: "Inclination " + s.inclination + " is outside -90 to +90." });
        }
        var lrudFields = [["left", s.left], ["right", s.right],
            ["up", s.up], ["down", s.down]];
        for (j = 0; j < lrudFields.length; j++) {
            var v = lrudFields[j][1];
            if (v !== null && v !== undefined && v < 0) {
                findings.push({ severity: "warning", shotIndex: i, code: "negative-lrud",
                    message: "Negative " + lrudFields[j][0] +
                        " reading; negative LRUD usually means 'not measured'." });
            }
        }

        // fs/bs pairs on ONE shot: the built-in instrument check.
        if (s.backAzimuth !== null && s.backAzimuth !== undefined) {
            var bsDiff = CsAngles.azimuthDifference(
                s.azimuth, s.backAzimuth + 180.0);
            if (bsDiff > 3.0) {
                findings.push({ severity: "warning", shotIndex: i,
                    code: "fsbs-azimuth-disagree",
                    message: "Shot " + s.from + " to " + s.to +
                        ": foresight and backsight compass disagree by " +
                        bsDiff.toFixed(1) + " deg (over 3) -- re-read, or " +
                        "one instrument needs calibrating." });
            }
        }
        if (s.backInclination !== null && s.backInclination !== undefined) {
            var incDiff = Math.abs(s.inclination - (-s.backInclination));
            if (incDiff > 3.0) {
                findings.push({ severity: "warning", shotIndex: i,
                    code: "fsbs-inclination-disagree",
                    message: "Shot " + s.from + " to " + s.to +
                        ": foresight and backsight clino disagree by " +
                        incDiff.toFixed(1) + " deg (over 3)." });
            }
        }

        // Nearly plumb shots are common in vertical caves but also a
        // classic sign-flip/typo site -- flag once, gently.
        if (Math.abs(s.inclination) > 85 && s.distance > 0) {
            findings.push({ severity: "warning", shotIndex: i, code: "near-plumb",
                message: "Inclination " + s.inclination +
                    " is nearly plumb; fine if this was a plumbed pitch." });
        }

        if (!s.splay && s.from !== "" && s.to !== "") {
            var key = pairKey(s.from, s.to);
            if (byPair[key] === undefined) {
                byPair[key] = [];
            }
            byPair[key].push(i);
        }
    }

    // ---- duplicates and probable backsights -----------------------
    for (var key2 in byPair) {
        if (!byPair.hasOwnProperty(key2) || byPair[key2].length < 2) {
            continue;
        }
        var idxs = byPair[key2];
        for (i = 0; i < idxs.length; i++) {
            for (j = i + 1; j < idxs.length; j++) {
                var a = shots[idxs[i]], b = shots[idxs[j]];
                var sameDir = (a.from === b.from);
                // What b's azimuth should read if it agrees with a:
                var expected = sameDir ? a.azimuth : a.azimuth + 180.0;
                var azDiff = CsAngles.azimuthDifference(expected, b.azimuth);
                var distDiff = Math.abs(a.distance - b.distance);

                if (azDiff < 5.0 &&
                    distDiff < Math.max(a.distance, b.distance) * 0.05) {
                    // agreeing duplicate / backsight pair: normal
                    // practice, say nothing
                    continue;
                }
                var flippedDiff = CsAngles.azimuthDifference(
                    expected + 180.0, b.azimuth);
                if (flippedDiff < 5.0) {
                    findings.push({ severity: "warning", shotIndex: idxs[j],
                        code: "backsight-as-foresight",
                        message: "Shot " + b.from + " to " + b.to +
                            " reads about 180 deg from its duplicate -- was a backsight entered as a foresight?" });
                } else {
                    findings.push({ severity: "warning", shotIndex: idxs[j],
                        code: "duplicate-disagrees",
                        message: "Shots between " + a.from + " and " + a.to +
                            " disagree (azimuth differs " + azDiff.toFixed(1) +
                            " deg, distance " + distDiff.toFixed(2) + ")." });
                }
            }
        }
    }

    // ---- network-level checks -------------------------------------
    if (resolved !== undefined && resolved !== null) {
        for (i = 0; i < resolved.loops.length; i++) {
            var loop = resolved.loops[i];
            if (loop.percent > CsValidate.CLOSURE_WARN_PERCENT) {
                findings.push({ severity: "warning", shotIndex: -1, code: "loop-misclosure",
                    message: "Loop " + loop.from + " ... " + loop.to + " closes " +
                        loop.error.toFixed(2) + " off over " +
                        loop.traverseLength.toFixed(1) + " surveyed (" +
                        loop.percent.toFixed(1) + "%). Over " +
                        CsValidate.CLOSURE_WARN_PERCENT +
                        "% usually means a blunder somewhere on the loop." });
            }
        }
        for (i = 0; i < resolved.unresolved.length; i++) {
            var u = resolved.unresolved[i];
            findings.push({ severity: "error", shotIndex: shots.indexOf(u),
                code: "unconnected",
                message: "Shot " + u.from + " to " + u.to +
                    " never connects to the rest of the survey -- check the station names." });
        }
    }

    return findings;
};
