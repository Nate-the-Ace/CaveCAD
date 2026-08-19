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
CsDraw.survey = function(survey, resolved, originStation, originPos) {
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
            seq: resolved.stations[name].seq,
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
