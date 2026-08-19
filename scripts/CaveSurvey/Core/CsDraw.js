// Draw.js -- the only Core module that draws.
//
// Part of the Cave Survey Core library. QCAD context only: everything
// here goes through scripts/simple.js and runs inside whatever
// transaction the CALLER opened. Tools own the transaction so each
// user action stays one undo step; Draw just adds entities.
//
// Text size: TEXT_HEIGHT drawing units, shared by every label the
// suite makes so the sheet's lettering stays consistent.

var CsDraw = {};

CsDraw.TEXT_HEIGHT = 0.5;

/**
 * Draws one station: point on CTRL-STATIONS (tagged), label on
 * CTRL-STATION-LABELS. Label text is the name plus elevation when
 * meaningfully nonzero, offset away from the incoming shot direction
 * (or northeast for an anchor with no incoming shot).
 *
 * \param data {name, seq, azimuth, inclination, left, right, up,
 *              down, z} -- all optional except name
 * \return the point entity (for further tagging), or undefined
 */
CsDraw.station = function(pos, data) {
    setCurrentLayer(CsLayers.STATIONS);
    var pt = addPoint(pos);
    CsTags.tagStation(pt, data);

    if (data.name !== undefined && data.name !== "") {
        var label = data.name;
        if (data.z !== undefined && data.z !== null && Math.abs(data.z) > 1e-6) {
            label += " (Z" + (data.z >= 0 ? "+" : "") + data.z.toFixed(1) + ")";
        }
        var rad = (data.azimuth === undefined || data.azimuth === null) ?
            (Math.PI / 4.0) : ((data.azimuth - 90.0) * Math.PI / 180.0);
        var off = CsDraw.TEXT_HEIGHT * 1.5;
        setCurrentLayer(CsLayers.STATION_LABELS);
        addSimpleText(label,
            new RVector(pos.x + off * Math.sin(rad), pos.y + off * Math.cos(rad)),
            CsDraw.TEXT_HEIGHT, 0, "standard",
            RS.VAlignMiddle, RS.HAlignRight, false, false);
    }
    return pt;
};

/** Draws one centerline shot line on CTRL-SHOTS. */
CsDraw.shotLine = function(fromPos, toPos) {
    setCurrentLayer(CsLayers.SHOTS);
    addLine(fromPos, toPos);
};

/**
 * Draws a station's LRUD: L/R tick lines with tagged tip points on
 * CTRL-LRUD (so LRUDWalls can find them by name), and the U/D note on
 * CTRL-STATION-LABELS. null measurements draw nothing; 0 draws no
 * tick but still drops the tagged tip point AT the station, because
 * 0 means "the wall is here", which is exactly what a wall builder
 * needs to know.
 */
CsDraw.lrud = function(pos, name, azimuthDeg, left, right, up, down) {
    setCurrentLayer(CsLayers.LRUD);

    var sides = [["L", left], ["R", right]];
    for (var i = 0; i < sides.length; i++) {
        var side = sides[i][0];
        var len = sides[i][1];
        if (len === null || len === undefined) {
            continue;
        }
        var tipPos;
        if (len === 0) {
            tipPos = new RVector(pos.x, pos.y);
        } else {
            var end = CsLrud.tickEnd(pos, azimuthDeg, side, len);
            addLine(pos, new RVector(end.x, end.y));
            tipPos = new RVector(end.x, end.y);
        }
        if (name !== undefined && name !== "") {
            var tip = addPoint(tipPos);
            CsTags.set(tip, "LRUDName", name + "." + side);
        }
    }

    var hasUp = up !== null && up !== undefined;
    var hasDown = down !== null && down !== undefined;
    if ((hasUp && up !== 0) || (hasDown && down !== 0)) {
        var text = "U" + (hasUp ? up.toFixed(2) : "-") +
            " D" + (hasDown ? down.toFixed(2) : "-");
        var rad = (azimuthDeg + 90.0) * Math.PI / 180.0;
        var off = CsDraw.TEXT_HEIGHT * 1.5;
        setCurrentLayer(CsLayers.STATION_LABELS);
        addSimpleText(text,
            new RVector(pos.x + off * Math.sin(rad), pos.y + off * Math.cos(rad)),
            CsDraw.TEXT_HEIGHT, 0, "standard",
            RS.VAlignMiddle, RS.HAlignLeft, false, false);
    }
};

/**
 * Draws a whole resolved survey: stations, shot lines, LRUD, all
 * tagged, offset so that originStation lands on originPos (both
 * optional). Survey-level metadata is tagged onto the first station's
 * point. Caller owns the transaction.
 *
 * \return {stationsDrawn, shotsDrawn, closuresDrawn, skipped}
 */
CsDraw.survey = function(survey, resolved, originStation, originPos, seqBase) {
    // seqBase continues station ordering across surveys in one
    // drawing: without it a second survey's Seq tags restart at 0 and
    // interleave with the first survey's when read back in Seq order.
    if (seqBase === undefined || seqBase === null) {
        seqBase = 0;
    }
    CsLayers.ensureSurveyLayers();

    var offX = 0, offY = 0;
    if (originStation !== undefined && originStation !== null &&
        resolved.stations.hasOwnProperty(originStation) &&
        originPos !== undefined && originPos !== null) {
        offX = originPos.x - resolved.stations[originStation].x;
        offY = originPos.y - resolved.stations[originStation].y;
    }

    var at = function(name) {
        var st = resolved.stations[name];
        return new RVector(st.x + offX, st.y + offY);
    };

    // stations in resolution order, so Seq mirrors the survey
    var names = [];
    for (var n in resolved.stations) {
        if (resolved.stations.hasOwnProperty(n)) {
            names.push(n);
        }
    }
    names.sort(function(a, b) {
        return resolved.stations[a].seq - resolved.stations[b].seq;
    });

    // The first drawn leg's azimuth orients the start station's LRUD.
    var firstLegAzimuth;
    for (var li = 0; li < resolved.legs.length; li++) {
        if (!resolved.legs[li].shot.excludeFromPlot) {
            firstLegAzimuth = CsTraverse.effectiveAzimuth(resolved.legs[li].shot);
            break;
        }
    }

    var stationsDrawn = 0;
    var firstPoint;
    for (var i = 0; i < names.length; i++) {
        var name = names[i];
        var lrud = CsModel.lrudForStation(survey, name);
        // the anchor station: no incoming shot, so its LRUD comes from
        // the notes page's first-station row (survey.startLrud)
        if (lrud === null && i === 0 && survey.startLrud !== null &&
            survey.startLrud !== undefined && firstLegAzimuth !== undefined) {
            lrud = {
                left: survey.startLrud.left,
                right: survey.startLrud.right,
                up: survey.startLrud.up,
                down: survey.startLrud.down,
                azimuth: firstLegAzimuth
            };
        }
        var pt = CsDraw.station(at(name), {
            name: name,
            seq: resolved.stations[name].seq + seqBase,
            azimuth: lrud !== null ? lrud.azimuth : undefined,
            left: lrud !== null ? lrud.left : undefined,
            right: lrud !== null ? lrud.right : undefined,
            up: lrud !== null ? lrud.up : undefined,
            down: lrud !== null ? lrud.down : undefined,
            z: resolved.stations[name].z
        });
        if (firstPoint === undefined) {
            firstPoint = pt;
        }
        if (lrud !== null) {
            CsDraw.lrud(at(name), name, lrud.azimuth,
                lrud.left, lrud.right, lrud.up, lrud.down);
        }
        stationsDrawn++;
    }

    var shotsDrawn = 0, closuresDrawn = 0;
    for (i = 0; i < resolved.legs.length; i++) {
        var leg = resolved.legs[i];
        if (leg.shot.excludeFromPlot) {
            continue;
        }
        CsDraw.shotLine(at(leg.from), at(leg.to));
        if (leg.kind === "closure") {
            closuresDrawn++;
        } else {
            shotsDrawn++;
        }
    }

    // survey metadata rides on the first station point
    if (firstPoint !== undefined) {
        CsTags.set(firstPoint, "SurveyName", survey.name);
        CsTags.set(firstPoint, "SurveyDate", survey.date);
        CsTags.set(firstPoint, "SurveyTeam", survey.team);
        CsTags.set(firstPoint, "Declination", survey.declination);
        CsTags.set(firstPoint, "DeclinationSource", survey.declinationSource);
        CsTags.set(firstPoint, "DistanceUnit", survey.distanceUnit);
    }

    return {
        stationsDrawn: stationsDrawn,
        shotsDrawn: shotsDrawn,
        closuresDrawn: closuresDrawn,
        skipped: resolved.skipped.length
    };
};

/**
 * Zooms the focused view to the extents of a just-drawn survey --
 * NOT autoZoom, which fits ALL entities and leaves a fresh survey a
 * speck beside a template's border. Pads by the largest LRUD reach
 * plus a margin. Falls back to autoZoom when the view API refuses.
 */
CsDraw.zoomToSurvey = function(survey, resolved) {
    try {
        var minX = null, minY = null, maxX = null, maxY = null;
        for (var name in resolved.stations) {
            if (!resolved.stations.hasOwnProperty(name)) {
                continue;
            }
            var st = resolved.stations[name];
            if (minX === null || st.x < minX) { minX = st.x; }
            if (maxX === null || st.x > maxX) { maxX = st.x; }
            if (minY === null || st.y < minY) { minY = st.y; }
            if (maxY === null || st.y > maxY) { maxY = st.y; }
        }
        if (minX === null) {
            autoZoom();
            return;
        }
        // LRUD ticks stick out past the stations; pad by the largest
        var reach = 0;
        for (var i = 0; i < survey.shots.length; i++) {
            var sh = survey.shots[i];
            var vals = [sh.left, sh.right];
            for (var k = 0; k < vals.length; k++) {
                if (vals[k] !== null && vals[k] !== undefined &&
                    vals[k] > reach) {
                    reach = vals[k];
                }
            }
        }
        var pad = reach + Math.max((maxX - minX), (maxY - minY)) * 0.05 + 1;
        var box = new RBox(new RVector(minX - pad, minY - pad),
            new RVector(maxX + pad, maxY + pad));
        var view = getDocumentInterface().getLastKnownViewWithFocus();
        view.zoomTo(box, 10);
    } catch (e) {
        try {
            autoZoom();
        } catch (e2) {
            // zoom is a nicety
        }
    }
};
